"use strict";

const express = require("express");
const {
  createProcurementService,
  hasCapability,
  safeDocumentMetadata
} = require("./procurement-service");
const { normalizeStockState } = require("./store/migrations");
const {
  deriveCapabilitiesFromSectionAccess,
  FATURA_CAPABILITIES,
  hasSectionAccess,
  normalizeSectionAccess,
  templateSectionAccess
} = require("./procurement-access");
const stockService = require("./stock-service");
const stockAnalytics = require("./stock-analytics");

const API_ROOT = "/api/procurement/v1";
const SSE_HEARTBEAT_MS = 25000;

function registerProcurementRoutes(deps = {}) {
  const { app, store, auth } = deps;
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("Procurement route kaydı için Express app gereklidir.");
  }
  if (!store || typeof store.read !== "function") throw new TypeError("Procurement route kaydı için store gereklidir.");
  if (!auth || typeof auth.requireRecipe !== "function") {
    throw new TypeError("Procurement route kaydı mevcut admin/personel auth.requireRecipe middleware'ini gerektirir.");
  }

  const service = deps.service || createProcurementService({
    store,
    notificationService: deps.notificationService,
    notifyWorkforceChange: deps.notifyWorkforceChange
  });
  const documentService = deps.documentService || null;
  const approveWorkforceShipment = deps.approveWorkforceShipment || null;
  const broadcastStockUpdate = typeof deps.broadcastStockUpdate === "function" ? deps.broadcastStockUpdate : null;
  const requireRequestOrigin = deps.requireRequestOrigin || deps.requireAdminOrMainRequestOrigin || pass;
  const riskOperationLimiter = deps.riskOperationLimiter || pass;
  const resolveActor = typeof deps.resolveActor === "function"
    ? deps.resolveActor
    : (req) => resolveActorFromRequest(req, store);
  const authenticated = [auth.requireRecipe, actorMiddleware(resolveActor)];
  const mutationMiddlewares = [requireRequestOrigin, ...authenticated, riskOperationLimiter];
  const parseDocumentBody = express.raw({
    // MIME başlığı eksik olsa da içerik belge servisinde imzayla doğrulanır.
    type: () => true,
    limit: 25 * 1024 * 1024
  });
  const rawImageParser = (req, res, next) => parseDocumentBody(req, res, (error) => {
    if (error && error.type === "entity.too.large") return next(fail("Belge yükleme boyut sınırını aşıyor.", 413, "DOCUMENT_TOO_LARGE"));
    next(error);
  });

  app.get(`${API_ROOT}/context`, ...authenticated, asyncRoute(async (req, res) => {
    res.json(await service.context(req.procurementActor, req.storeSnapshot));
  }));

  registerStockReferenceProjection({
    app,
    store,
    authenticated
  });

  app.get(`${API_ROOT}/analytics/products`, ...authenticated,
    sectionAccess("productAnalysis", "view"), capability("inventory.read"), capability("procurement.read"),
    asyncRoute(async (req, res) => {
      const data = req.storeSnapshot || await store.read();
      res.json({ ok: true, ...stockAnalytics.searchProducts(data, req.query.query, { limit: req.query.limit }) });
    }));

  app.get(`${API_ROOT}/analytics/price-movements`, ...authenticated,
    sectionAccess("productAnalysis", "view"), capability("inventory.read"), capability("procurement.read"),
    asyncRoute(async (req, res) => {
      const data = req.storeSnapshot || await store.read();
      const financialVisible = req.procurementActor.type === "admin"
        || ["accounting.read", "accounting.post", "supplier.manage", "supplierProduct.manage"].some((item) => hasCapability(req.procurementActor, item));
      res.json({ ok: true, ...stockAnalytics.priceMovements(data, req.query.direction, { financialVisible }) });
    }));

  app.get(`${API_ROOT}/analytics/products/:productId`, ...authenticated,
    sectionAccess("productAnalysis", "view"), capability("inventory.read"), capability("procurement.read"),
    asyncRoute(async (req, res) => {
      const data = req.storeSnapshot || await store.read();
      const financialVisible = req.procurementActor.type === "admin"
        || ["accounting.read", "accounting.post", "supplier.manage", "supplierProduct.manage"].some((item) => hasCapability(req.procurementActor, item));
      res.json({ ok: true, ...stockAnalytics.productAnalytics(data, req.params.productId, req.query.range, { financialVisible }) });
    }));

  app.get(`${API_ROOT}/analytics/stock-plan`, ...authenticated, sectionAccess("stock", "view"), capability("inventory.read"),
    asyncRoute(async (req, res) => {
      const data = req.storeSnapshot || await store.read();
      const financialVisible = req.procurementActor.type === "admin"
        || ["accounting.read", "accounting.post", "supplier.manage", "supplierProduct.manage"].some((item) => hasCapability(req.procurementActor, item));
      const shipmentVisible = hasSectionAccess(req.procurementActor, "documents", "view")
        || hasSectionAccess(req.procurementActor, "shipments", "view")
        || hasSectionAccess(req.procurementActor, "suppliers", "view");
      res.json({ ok: true, ...stockAnalytics.stockPlanning(data, req.query.range, { financialVisible, shipmentVisible }) });
    }));

  app.get(`${API_ROOT}/dashboard`, ...authenticated, sectionAccess("dashboard", "view"), capability("procurement.read"), asyncRoute(async (req, res) => {
    res.json(await service.dashboard(req.procurementActor));
  }));

  app.get(`${API_ROOT}/suppliers`, ...authenticated, anySectionAccess(["suppliers", "shipments", "documents", "ledger", "links"]), anyCapability(["supplier.read", "supplier.manage", "receipt.create", "procurement.read", "documents.read", "accounting.read"]), asyncRoute(async (req, res) => {
    res.json(await service.listSuppliers(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/suppliers`, ...mutationMiddlewares, sectionAccess("suppliers", "full"), capability("supplier.manage"), asyncRoute(async (req, res) => {
    const result = await service.createSupplier(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.put(`${API_ROOT}/suppliers/:id`, ...mutationMiddlewares, sectionAccess("suppliers", "full"), capability("supplier.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateSupplier(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/suppliers/:id/deactivate`, ...mutationMiddlewares, sectionAccess("suppliers", "full"), capability("supplier.manage"), asyncRoute(async (req, res) => {
    res.json(await service.deactivateSupplier(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/suppliers/:id/independent-products`, ...authenticated,
    anySectionAccess(["suppliers", "links"]), anyCapability(["supplier.read", "supplier.manage", "supplierProduct.manage"]),
    asyncRoute(async (req, res) => {
      res.json(await service.listSupplierIndependentProducts(req.procurementActor, req.params.id, req.query));
    }));

  app.post(`${API_ROOT}/suppliers/:id/independent-products`, ...mutationMiddlewares,
    anySectionAccess(["suppliers", "links"], "operate"), anyCapability(["supplier.manage", "supplierProduct.manage"]),
    asyncRoute(async (req, res) => {
      const result = await service.createSupplierIndependentProduct(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
      res.status(result.idempotent ? 200 : 201).json(result);
    }));

  app.post(`${API_ROOT}/suppliers/:id/independent-products/bulk`, ...mutationMiddlewares,
    anySectionAccess(["suppliers", "links"], "operate"), anyCapability(["supplier.manage", "supplierProduct.manage"]),
    asyncRoute(async (req, res) => {
      const result = await service.createSupplierIndependentProductsBulk(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
      res.status(result.idempotent ? 200 : 201).json(result);
    }));

  app.put(`${API_ROOT}/suppliers/:id/independent-products/:itemId`, ...mutationMiddlewares,
    anySectionAccess(["suppliers", "links"], "operate"), anyCapability(["supplier.manage", "supplierProduct.manage"]),
    asyncRoute(async (req, res) => {
      res.json(await service.updateSupplierIndependentProduct(req.procurementActor, req.params.id, req.params.itemId, jsonBody(req), mutationInput(req)));
    }));

  app.get(`${API_ROOT}/product-links`, ...authenticated, anySectionAccess(["suppliers", "links"], "view"), anyCapability(["supplier.read", "procurement.read", "receipt.create", "supplierProduct.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.listProductLinks(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/product-links`, ...mutationMiddlewares, anySectionAccess(["suppliers", "links"], "operate"), capability("supplierProduct.manage"), asyncRoute(async (req, res) => {
    const result = await service.createProductLink(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.put(`${API_ROOT}/product-links/:id`, ...mutationMiddlewares, anySectionAccess(["suppliers", "links"], "operate"), capability("supplierProduct.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateProductLink(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/shipments`, ...authenticated, anySectionAccess(["shipments", "documents", "suppliers", "ledger"], "view"), anyCapability(["procurement.read", "supplier.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "accounting.reverse", "supplier.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.listShipments(req.procurementActor, req.query));
  }));

  app.get(`${API_ROOT}/shipments/:id`, ...authenticated, anySectionAccess(["shipments", "documents", "suppliers", "ledger"], "view"), anyCapability(["procurement.read", "supplier.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "accounting.reverse", "supplier.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.getShipment(req.procurementActor, req.params.id));
  }));

  app.post(`${API_ROOT}/shipments`, ...mutationMiddlewares, anySectionAccess(["shipments", "suppliers", "documents"], "operate"), capability("receipt.create"), asyncRoute(async (req, res) => {
    const result = await service.createShipment(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.put(`${API_ROOT}/shipments/:id`, ...mutationMiddlewares, anySectionAccess(["shipments", "documents"], "operate"), capability("receipt.create"), asyncRoute(async (req, res) => {
    res.json(await service.updateShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.delete(`${API_ROOT}/shipments/:id`, ...mutationMiddlewares, anySectionAccess(["shipments", "documents"], "operate"), anyCapability(["receipt.create", "receipt.reject"]), asyncRoute(async (req, res) => {
    res.json(await service.deleteShipment(req.procurementActor, req.params.id, mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/submit`, ...mutationMiddlewares, anySectionAccess(["shipments", "suppliers", "documents"], "operate"), capability("receipt.submit"), asyncRoute(async (req, res) => {
    res.json(await service.submitShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/approve-stock`, ...mutationMiddlewares, anySectionAccess(["shipments", "stock", "suppliers", "documents"], "full"), capability("receipt.approve"), asyncRoute(async (req, res) => {
    if (typeof approveWorkforceShipment !== "function") {
      throw fail("Ortak sevkiyat stok onay servisi yapılandırılmamış.", 503, "STOCK_APPROVAL_SERVICE_UNAVAILABLE");
    }
    const mutation = mutationInput(req);
    const body = jsonBody(req);
    let result;
    try {
      result = await approveWorkforceShipment({
        shipmentId: req.params.id,
        requestId: mutation.requestId,
        internalAuthoritativeRevision: true,
        note: String(body.note || "").trim().slice(0, 500),
        destinationLocationId: String(body.destinationLocationId || "").trim(),
        actor: req.procurementActor,
        req
      });
    } catch (error) {
      if (isRevisionConflict(error)) throw error;
      let failure = null;
      try {
        failure = await withAuthoritativeProcurementRevision(service, req.procurementActor, {
          ...mutation,
          requestId: `${mutation.requestId.slice(0, 140)}:stock-failed`
        }, (authoritativeMutation) => service.recordShipmentStockFailure(req.procurementActor, req.params.id, {
          code: error && error.payload && error.payload.code || error && error.code || "STOCK_TRANSFER_FAILED",
          message: error && error.payload && error.payload.message || error && error.message
        }, authoritativeMutation));
      } catch (_recordError) { /* Ana hata korunur; sevkiyat zaten kalıcıdır. */ }
      if (failure) {
        return res.status(Math.max(400, Math.min(499, Number(error && error.status || 422)))).json({
          ok: false,
          message: error && error.payload && error.payload.message || error && error.message || "Stok aktarımı tamamlanamadı.",
          code: error && error.payload && error.payload.code || error && error.code || "STOCK_TRANSFER_FAILED",
          revision: failure.revision,
          workforceRevision: failure.workforceRevision,
          shipment: failure.shipment,
          stockStatus: "failed"
        });
      }
      throw error;
    }
    try {
      const accounting = await withAuthoritativeProcurementRevision(service, req.procurementActor, {
        ...mutation,
        requestId: `${mutation.requestId.slice(0, 140)}:auto-ledger`
      }, (authoritativeMutation) => service.accountShipmentAfterStock(req.procurementActor, req.params.id, {
        note: "Stok aktarımı sonrası otomatik tedarikçi borcu"
      }, authoritativeMutation));
      return res.json({
        ...(result && typeof result === "object" ? result : {}), ok: true,
        revision: accounting.revision, workforceRevision: accounting.workforceRevision || result && result.revision,
        shipment: accounting.shipment || result && result.shipment, ledgerEntry: accounting.ledgerEntry, accountingStatus: "posted"
      });
    } catch (error) {
      let failure = null;
      try {
        failure = await withAuthoritativeProcurementRevision(service, req.procurementActor, {
          ...mutation,
          requestId: `${mutation.requestId.slice(0, 140)}:ledger-failed`
        }, (authoritativeMutation) => service.recordShipmentAccountingFailure(req.procurementActor, req.params.id, {
          code: error && error.code || "ACCOUNTING_POST_FAILED", message: error && error.message
        }, authoritativeMutation));
      } catch (_recordError) { /* Stok sonucu korunur. */ }
      return res.json({
        ...(result && typeof result === "object" ? result : {}), ok: true,
        revision: failure && failure.revision || result && result.procurementRevision || mutation.expectedRevision,
        workforceRevision: failure && failure.workforceRevision || result && result.revision,
        shipment: failure && failure.shipment || result && result.shipment,
        accountingStatus: "failed", accountingMessage: "Stok işlendi ancak cari kayıt oluşturulamadı. Sevkiyat arşivde korunuyor."
      });
    }
  }));

  app.post(`${API_ROOT}/shipments/:id/decline-stock`, ...mutationMiddlewares, anySectionAccess(["shipments", "documents", "suppliers"], "full"), capability("receipt.approve"), asyncRoute(async (req, res) => {
    res.json(await service.declineShipmentStock(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/account-without-stock`, ...mutationMiddlewares, anySectionAccess(["shipments", "documents", "ledger"], "operate"), anyCapability(["receipt.approve", "accounting.post"]), asyncRoute(async (req, res) => {
    const result = await withAuthoritativeProcurementRevision(service, req.procurementActor, mutationInput(req), (authoritativeMutation) =>
      service.accountShipmentWithoutStock(req.procurementActor, req.params.id, jsonBody(req), authoritativeMutation));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/shipments/:id/remove`, ...mutationMiddlewares, anySectionAccess(["shipments", "documents"], "full"), capability("receipt.reject"), asyncRoute(async (req, res) => {
    const result = await service.removeShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    if (!result.idempotent && result.stockReversalMovementIds?.length && broadcastStockUpdate) {
      broadcastStockUpdate(null, result.stockUpdatedAt || new Date().toISOString(), result.inventoryRevision, "inventory");
    }
    res.json(result);
  }));

  app.post(`${API_ROOT}/shipments/:id/reject`, ...mutationMiddlewares, anySectionAccess(["shipments", "documents"], "full"), capability("receipt.reject"), asyncRoute(async (req, res) => {
    res.json(await service.rejectShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/account`, ...mutationMiddlewares, sectionAccess("ledger", "operate"), capability("accounting.post"), asyncRoute(async (req, res) => {
    const result = await service.accountShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/shipments/:id/reverse-accounting`, ...mutationMiddlewares, sectionAccess("ledger", "full"), capability("accounting.reverse"), asyncRoute(async (req, res) => {
    const result = await service.reverseShipmentAccounting(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.get(`${API_ROOT}/documents`, ...authenticated, sectionAccess("documents", "view"), capability("documents.read"), asyncRoute(async (req, res) => {
    res.json(await service.listDocuments(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/documents`, requireRequestOrigin, ...authenticated, riskOperationLimiter, anySectionAccess(["documents", "suppliers", "ledger"], "operate"), capability("documents.upload"), rawImageParser, asyncRoute(async (req, res) => {
    if (!documentService || typeof documentService.storeUpload !== "function") {
      throw fail("Özel belge depolama servisi yapılandırılmamış.", 503, "DOCUMENT_SERVICE_UNAVAILABLE");
    }
    const mutation = mutationInput(req);
    const prior = await service.findIdempotentResponse(req.procurementActor, "document.upload", mutation.requestId);
    if (prior) return res.json(prior);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail("Belge dosyası zorunludur.", 400, "DOCUMENT_FILE_REQUIRED");
    let storedFile = null;
    try {
      storedFile = await documentService.storeUpload({
        buffer: req.body,
        originalName: decodeHeaderValue(requestHeader(req, "X-File-Name")),
        declaredMimeType: req.get("Content-Type")
      });
      const input = documentInputFromHeaders(req);
      const result = await service.recordDocument(req.procurementActor, input, storedFile, mutation);
      if (result.duplicateContent && typeof documentService.removePhysicalFiles === "function") {
        await documentService.removePhysicalFiles(storedFile);
      } else if (typeof documentService.commitUpload === "function") {
        await documentService.commitUpload(storedFile);
      }
      res.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      if (storedFile && typeof documentService.removePhysicalFiles === "function") {
        try { await documentService.removePhysicalFiles(storedFile); } catch (_cleanupError) { /* best effort */ }
      }
      throw error;
    }
  }));

  app.get(`${API_ROOT}/documents/:id/content`, ...authenticated, anySectionAccess(["documents", "ledger"], "view"), capability("documents.read"), asyncRoute(async (req, res) => {
    if (!documentService || typeof documentService.resolveContent !== "function") {
      throw fail("Özel belge depolama servisi yapılandırılmamış.", 503, "DOCUMENT_SERVICE_UNAVAILABLE");
    }
    const { document } = await service.getDocument(req.procurementActor, req.params.id);
    const resolved = await documentService.resolveContent(document, { thumbnail: req.query.thumbnail === "1" });
    const buffer = Buffer.isBuffer(resolved) ? resolved : resolved && resolved.buffer;
    if (!Buffer.isBuffer(buffer)) throw fail("Belge içeriği bulunamadı.", 404, "DOCUMENT_CONTENT_NOT_FOUND");
    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Content-Type": String(resolved && resolved.mimeType || document.mimeType || "application/octet-stream"),
      "Content-Length": String(buffer.length),
      "Content-Disposition": `${String(resolved && resolved.mimeType || document.mimeType) === "application/pdf" ? "attachment" : "inline"}; filename="${safeHeaderFilename(document.originalName || "belge")}"`,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff"
    });
    res.send(buffer);
  }));

  app.post(`${API_ROOT}/documents/:id/archive`, ...mutationMiddlewares, sectionAccess("documents", "full"), capability("documents.archive"), asyncRoute(async (req, res) => {
    res.json(await service.archiveDocument(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/ledger`, ...authenticated, sectionAccess("ledger", "view"), capability("accounting.read"), asyncRoute(async (req, res) => {
    res.json(await service.listLedger(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/ledger`, ...mutationMiddlewares, sectionAccess("ledger", "operate"), capability("accounting.post"), asyncRoute(async (req, res) => {
    const result = await service.createLedgerEntry(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/ledger/:id/reverse`, ...mutationMiddlewares, sectionAccess("ledger", "full"), capability("accounting.reverse"), asyncRoute(async (req, res) => {
    const result = await service.reverseLedgerEntry(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/payments`, ...mutationMiddlewares, sectionAccess("ledger", "operate"), capability("payment.create"), asyncRoute(async (req, res) => {
    const result = await service.createPayment(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/payments/:id/reverse`, ...mutationMiddlewares, sectionAccess("ledger", "full"), capability("payment.reverse"), asyncRoute(async (req, res) => {
    const result = await service.reversePayment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.get(`${API_ROOT}/trash`, ...authenticated, sectionAccess("trash", "view"), anyCapability(["procurement.read", "accounting.read", "documents.read", "inventory.read"]), asyncRoute(async (req, res) => {
    res.json(await service.listTrash(req.procurementActor));
  }));

  app.post(`${API_ROOT}/trash/:type/:id/purge`, ...mutationMiddlewares, sectionAccess("trash", "view"), anyCapability(["receipt.reject", "payment.reverse", "accounting.reverse"]), asyncRoute(async (req, res) => {
    res.json(await service.purgeTrashRecord(req.procurementActor, req.params.type, req.params.id, mutationInput(req)));
  }));

  app.get(`${API_ROOT}/audit`, ...authenticated, sectionAccess("settings", "full"), capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    res.json(await service.listAudit(req.procurementActor, req.query));
  }));

  app.get(`${API_ROOT}/users`, ...authenticated, sectionAccess("users", "full"), capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    res.json(await service.listUsers(req.procurementActor));
  }));

  app.put(`${API_ROOT}/users/:id/access`, ...mutationMiddlewares, sectionAccess("users", "full"), capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateUserAccess(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/settings`, ...authenticated, sectionAccess("settings", "full"), capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    const result = await service.context(req.procurementActor);
    res.json({ ok: true, revision: result.revision, settings: result.procurement.settings });
  }));

  app.put(`${API_ROOT}/settings`, ...mutationMiddlewares, sectionAccess("settings", "full"), capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateSettings(req.procurementActor, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/export`, ...authenticated, asyncRoute(async (req, res) => {
    const file = await service.exportData(req.procurementActor, req.query);
    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${safeHeaderFilename(file.filename)}"`,
      "X-Content-Type-Options": "nosniff"
    });
    res.send(file.body);
  }));

  app.get(`${API_ROOT}/events`, ...authenticated, anyCapability([...FATURA_CAPABILITIES]), (req, res) => {
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, max-age=0, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write(`retry: 5000\n${sseEvent("ready", { ok: true })}`);
    const unsubscribe = service.subscribe((event) => {
      if (res.writableEnded) return;
      const payload = req.procurementActor && req.procurementActor.type === "admin"
        ? event
        : {
            type: "procurement.invalidated",
            revision: Number(event && event.revision || 0),
            requiresRefetch: true,
            createdAt: event && event.createdAt || new Date().toISOString()
          };
      res.write(sseEvent("procurement", payload));
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);
    if (typeof heartbeat.unref === "function") heartbeat.unref();
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return { service };
}

// /api/procurement/v1/stock/* canonical Fatura stok facade'ıdır ve mevcut
// canonical stock service'i kullanır; /api/admin/stock/* yalnız compatibility adapter'ıdır.
function registerStockReferenceProjection(deps) {
  const { app, store, authenticated } = deps;
  const actorForStock = (actor) => ({
    type: actor && actor.type === "admin" ? "admin" : "personel",
    id: String(actor && actor.id || ""),
    name: String(actor && actor.name || "Yönetici"),
    branchId: String(actor && actor.branchId || "main"),
    stockLocationId: String(actor && actor.stockLocationId || ""),
    inventoryManage: Boolean(actor && (actor.type === "admin" || hasCapability(actor, "inventory.manage"))),
    inventoryTransfer: Boolean(actor && (actor.type === "admin" || hasCapability(actor, "inventory.transfer.create"))),
    inventoryScope: actor && actor.type === "admin" ? "all" : "assigned"
  });
  const publicLocations = (stock, actor) => {
    const locations = stockService.getLocations(stock);
    if (actor.type === "admin" || hasCapability(actor, "inventory.manage")) return locations;
    const ownId = stockService.actorLocationId(stock, actorForStock(actor));
    return locations.filter((item) => String(item.id) === String(ownId));
  };
  const responseBase = (data) => ({
    ok: true,
    revision: Math.max(0, Number(data && data.revisions && data.revisions.catalog || 0)),
    inventoryRevision: Math.max(0, Number(data && data.revisions && data.revisions.inventory || 0)),
    catalogRevision: Math.max(0, Number(data && data.revisions && data.revisions.catalog || 0)),
    revisions: {
      inventory: Math.max(0, Number(data && data.revisions && data.revisions.inventory || 0)),
      catalog: Math.max(0, Number(data && data.revisions && data.revisions.catalog || 0)),
      stock: Math.max(0, Number(data && data.revisions && data.revisions.stock || 0))
    },
    publishRevision: Number(data.revisions && data.revisions.publish || 0),
    updatedAt: data.stockUpdatedAt || data.stockState && data.stockState.updatedAt || null
  });

  app.get(`${API_ROOT}/stock/references`, ...authenticated,
    anySectionAccess(["stock", "productAnalysis", "shipments", "links", "suppliers", "documents"]),
    anyCapability(["inventory.read", "supplier.read", "procurement.read", "receipt.create", "receipt.approve", "supplierProduct.manage", "documents.read"]),
    asyncRoute(async (req, res) => {
      const data = req.storeSnapshot || await store.read();
      const stock = normalizeStockState(data.stockState);
      const products = Array.isArray(data.stockState && data.stockState.products) ? data.stockState.products : [];
      const stockProducts = products.filter((item) => item && item.id && item.active !== false && item.sourcePresent !== false
        && item.trashed !== true && !item.archivedAt && !item.removedAt && !item.deletedAt && !item.purgedAt).map((item) => ({
        id: String(item.id),
        name: String(item.name || item.productName || "Stok ürünü"),
        productCode: String(item.productCode || ""),
        categoryId: String(item.categoryId || ""),
        category: String(item.category || stock.categories.find((category) => String(category.id) === String(item.categoryId))?.name || "Genel"),
        baseUnit: String(item.baseUnit || item.unit || ""),
        unit: String(item.baseUnit || item.unit || ""),
        bulkUnit: String(item.bulkUnit || item.caseUnit || ""),
        unitsPerBulkUnit: Number(item.unitsPerBulkUnit || item.unitsPerCase || 0),
        defaultMovementUnit: String(item.defaultMovementUnit || item.baseUnit || item.unit || "adet"),
        allowedUnits: stockService.allowedProductUnits(item)
      }));
      const stockLocations = publicLocations(stock, req.procurementActor).map((item) => ({
        id: String(item.id), code: String(item.code || ""), name: String(item.name || "Depo"),
        type: String(item.type || "other"), active: item.active !== false, isDefault: item.isDefault === true
      }));
      const unitDefinitions = {
        base: Array.isArray(stock.unitDefinitions && stock.unitDefinitions.base) ? stock.unitDefinitions.base : [],
        bulk: Array.isArray(stock.unitDefinitions && stock.unitDefinitions.bulk) ? stock.unitDefinitions.bulk : []
      };
      res.json({ ...responseBase(data), stockProducts, stockLocations, unitDefinitions });
    }));
}

function actorMiddleware(resolveActor) {
  return async function attachProcurementActor(req, res, next) {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ ok: false, message: "Tahmisçi Fatura oturumu gerekli.", code: "PROCUREMENT_AUTH_REQUIRED" });
      req.procurementActor = actor;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function resolveActorFromRequest(req, store) {
  const session = req.authSession || {};
  const payload = req.recipe || req.admin || {};
  // Önizleme tokenı yalnız reçete iframe akışına aittir; Fatura Merkezi
  // kullanıcısı veya Yönetici oturumu olarak yükseltilemez.
  if (payload.role === "preview" || payload.previewRole) return null;
  const sessionRole = String(session.role || payload.sessionRole || "");
  if (sessionRole === "admin" || payload.role === "admin") {
    return {
      type: "admin",
      id: "admin",
      name: "Yönetici",
      role: "yönetici",
      branchId: "main",
      capabilities: [...FATURA_CAPABILITIES],
      accessEnabled: true,
      template: "yonetici",
      sectionAccess: templateSectionAccess("yonetici")
    };
  }
  if (sessionRole !== "personel" && payload.sessionRole !== "personel") return null;
  const userId = String(payload.userId || session.userId || "").trim();
  const data = req.storeSnapshot || await store.read();
  const user = req.recipeUser || (data.recipeUsers || []).find((item) => item && String(item.id) === userId);
  if (!user || user.active === false) throw fail("Aktif personel hesabı gerekli.", 403, "ACTIVE_PERSONEL_REQUIRED");
  const allowManagement = user.faturaTemplate === "yonetici" || user.faturaRole === "yönetici";
  const normalizedSectionAccess = normalizeSectionAccess(user.faturaSectionAccess, {
    capabilities: user.faturaCapabilities,
    allowManagement
  });
  const storedCapabilities = (Array.isArray(user.faturaCapabilities) ? user.faturaCapabilities : [])
    .map((item) => String(item || "").trim())
    .filter((item) => FATURA_CAPABILITIES.has(item));
  const derivedCapabilities = deriveCapabilitiesFromSectionAccess(normalizedSectionAccess, { allowManagement });
  return {
    type: "personel",
    id: String(user.id),
    name: String(user.name || user.username || "Personel"),
    role: String(user.faturaRole || "operasyon"),
    branchId: String(user.branchId || "main"),
    stockLocationId: String(user.stockLocationId || ""),
    accessEnabled: user.faturaAccessEnabled !== false,
    template: String(user.faturaTemplate || "ozel"),
    sectionAccess: normalizedSectionAccess,
    capabilities: user.faturaAccessEnabled === false
      ? []
      : [...new Set([...storedCapabilities, ...derivedCapabilities])]
  };
}

function sectionAccess(sectionId, minimumLevel = "view") {
  return function requireProcurementSection(req, res, next) {
    if (hasSectionAccess(req.procurementActor, sectionId, minimumLevel)) return next();
    return res.status(403).json({
      ok: false,
      message: "Bu Fatura bölümüne erişim yetkiniz yok.",
      code: "PROCUREMENT_SECTION_ACCESS_REQUIRED",
      sectionId,
      minimumLevel
    });
  };
}

function anySectionAccess(sectionIds, minimumLevel = "view") {
  return function requireAnyProcurementSection(req, res, next) {
    if ((sectionIds || []).some((sectionId) => hasSectionAccess(req.procurementActor, sectionId, minimumLevel))) return next();
    return res.status(403).json({
      ok: false,
      message: "Bu Fatura verisine erişim yetkiniz yok.",
      code: "PROCUREMENT_SECTION_ACCESS_REQUIRED",
      sectionIds,
      minimumLevel
    });
  };
}

function capability(required) {
  return function requireProcurementCapability(req, res, next) {
    if (hasCapability(req.procurementActor, required)) return next();
    return res.status(403).json({
      ok: false,
      message: "Bu işlem için yetkiniz yok.",
      code: "PROCUREMENT_CAPABILITY_REQUIRED",
      capability: required
    });
  };
}

function anyCapability(required) {
  return function requireAnyProcurementCapability(req, res, next) {
    if (required.some((item) => hasCapability(req.procurementActor, item))) return next();
    return res.status(403).json({
      ok: false,
      message: "Bu işlem için yetkiniz yok.",
      code: "PROCUREMENT_CAPABILITY_REQUIRED",
      capabilities: required
    });
  };
}

function mutationInput(req) {
  const body = jsonBody(req);
  return {
    requestId: String(req.get("Idempotency-Key") || req.get("X-Request-ID") || body.requestId || "").trim(),
    expectedRevision: firstDefined(req.get("X-Expected-Revision"), body.expectedRevision)
  };
}

async function withAuthoritativeProcurementRevision(service, actor, mutation, operation) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await service.context(actor);
    try {
      return await operation({ ...mutation, expectedRevision: current.revision });
    } catch (error) {
      if (!isRevisionConflict(error) || attempt === 1) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function isRevisionConflict(error) {
  const code = String(error && (error.code || error.payload && error.payload.code) || "");
  const message = String(error && (error.message || error.payload && error.payload.message) || "");
  return code === "PROCUREMENT_REVISION_CONFLICT" || /(?:procurement|workforce).*revision|verisi başka bir işlemle güncellendi/i.test(message);
}

function documentInputFromHeaders(req) {
  return {
    originalName: decodeHeaderValue(requestHeader(req, "X-File-Name")),
    documentType: decodeHeaderValue(requestHeader(req, "X-Document-Type")),
    supplierId: requestHeader(req, "X-Supplier-Id"),
    shipmentIds: splitHeader(requestHeader(req, "X-Shipment-Ids")),
    shipmentItemIds: splitHeader(requestHeader(req, "X-Shipment-Item-Ids")),
    documentNumber: decodeHeaderValue(requestHeader(req, "X-Document-Number")),
    documentDate: requestHeader(req, "X-Document-Date")
  };
}

function decodeHeaderValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try { return decodeURIComponent(text); } catch (_error) { return text; }
}

function jsonBody(req) {
  return req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && !Array.isArray(req.body) ? req.body : {};
}

function requestHeader(req, name) {
  return String(req.get(name) || "").trim();
}

function splitHeader(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeUploadLimit(value) {
  const bytes = Number(value || 10 * 1024 * 1024);
  return Number.isInteger(bytes) && bytes >= 1024 && bytes <= 50 * 1024 * 1024 ? bytes : 10 * 1024 * 1024;
}

function safeHeaderFilename(value) {
  return String(value || "belge")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\r\n"\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._\-]/g, "_")
    .slice(0, 180) || "belge";
}

function sseEvent(name, payload) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function asyncRoute(handler) {
  return function procurementAsyncRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function pass(req, res, next) {
  return next();
}

function fail(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

module.exports = {
  API_ROOT,
  registerProcurementRoutes,
  resolveActorFromRequest,
  safeHeaderFilename
};
