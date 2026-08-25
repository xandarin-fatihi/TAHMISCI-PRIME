"use strict";

const express = require("express");
const {
  createProcurementService,
  hasCapability,
  safeDocumentMetadata
} = require("./procurement-service");
const { FATURA_CAPABILITIES } = require("./store/migrations");

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
  const requireRequestOrigin = deps.requireRequestOrigin || deps.requireAdminOrMainRequestOrigin || pass;
  const riskOperationLimiter = deps.riskOperationLimiter || pass;
  const resolveActor = typeof deps.resolveActor === "function"
    ? deps.resolveActor
    : (req) => resolveActorFromRequest(req, store);
  const authenticated = [auth.requireRecipe, actorMiddleware(resolveActor)];
  const mutationMiddlewares = [requireRequestOrigin, ...authenticated, riskOperationLimiter];
  const rawUploadLimit = normalizeUploadLimit(deps.maxUploadBytes || deps.config && deps.config.procurementMaxUploadBytes);
  const rawImageParser = express.raw({
    type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"],
    limit: rawUploadLimit
  });

  app.get(`${API_ROOT}/context`, ...authenticated, asyncRoute(async (req, res) => {
    res.json(await service.context(req.procurementActor));
  }));

  app.get(`${API_ROOT}/dashboard`, ...authenticated, capability("procurement.read"), asyncRoute(async (req, res) => {
    res.json(await service.dashboard(req.procurementActor));
  }));

  app.get(`${API_ROOT}/suppliers`, ...authenticated, anyCapability(["supplier.read", "receipt.create", "supplier.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.listSuppliers(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/suppliers`, ...mutationMiddlewares, capability("supplier.manage"), asyncRoute(async (req, res) => {
    const result = await service.createSupplier(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.put(`${API_ROOT}/suppliers/:id`, ...mutationMiddlewares, capability("supplier.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateSupplier(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/suppliers/:id/deactivate`, ...mutationMiddlewares, capability("supplier.manage"), asyncRoute(async (req, res) => {
    res.json(await service.deactivateSupplier(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/product-links`, ...authenticated, anyCapability(["procurement.read", "receipt.create", "supplierProduct.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.listProductLinks(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/product-links`, ...mutationMiddlewares, capability("supplierProduct.manage"), asyncRoute(async (req, res) => {
    const result = await service.createProductLink(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.put(`${API_ROOT}/product-links/:id`, ...mutationMiddlewares, capability("supplierProduct.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateProductLink(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/shipments`, ...authenticated, anyCapability(["procurement.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "accounting.reverse", "supplier.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.listShipments(req.procurementActor, req.query));
  }));

  app.get(`${API_ROOT}/shipments/:id`, ...authenticated, anyCapability(["procurement.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "accounting.reverse", "supplier.manage"]), asyncRoute(async (req, res) => {
    res.json(await service.getShipment(req.procurementActor, req.params.id));
  }));

  app.post(`${API_ROOT}/shipments`, ...mutationMiddlewares, capability("receipt.create"), asyncRoute(async (req, res) => {
    const result = await service.createShipment(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.put(`${API_ROOT}/shipments/:id`, ...mutationMiddlewares, capability("receipt.create"), asyncRoute(async (req, res) => {
    res.json(await service.updateShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/submit`, ...mutationMiddlewares, capability("receipt.submit"), asyncRoute(async (req, res) => {
    res.json(await service.submitShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/approve-stock`, ...mutationMiddlewares, capability("receipt.approve"), asyncRoute(async (req, res) => {
    if (typeof approveWorkforceShipment !== "function") {
      throw fail("Ortak sevkiyat stok onay servisi yapılandırılmamış.", 503, "STOCK_APPROVAL_SERVICE_UNAVAILABLE");
    }
    const mutation = mutationInput(req);
    const body = jsonBody(req);
    const result = await approveWorkforceShipment({
      shipmentId: req.params.id,
      requestId: mutation.requestId,
      expectedRevision: body.workforceExpectedRevision !== undefined ? body.workforceExpectedRevision : body.expectedRevision,
      procurementExpectedRevision: mutation.expectedRevision,
      note: String(body.note || "").trim().slice(0, 500),
      destinationLocationId: String(body.destinationLocationId || "").trim(),
      actor: req.procurementActor,
      req
    });
    const current = await service.context(req.procurementActor);
    res.json({
      ...(result && typeof result === "object" ? result : {}),
      ok: true,
      revision: current.revision,
      workforceRevision: result && result.revision
    });
  }));

  app.post(`${API_ROOT}/shipments/:id/reject`, ...mutationMiddlewares, capability("receipt.reject"), asyncRoute(async (req, res) => {
    res.json(await service.rejectShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.post(`${API_ROOT}/shipments/:id/account`, ...mutationMiddlewares, capability("accounting.post"), asyncRoute(async (req, res) => {
    const result = await service.accountShipment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/shipments/:id/reverse-accounting`, ...mutationMiddlewares, capability("accounting.reverse"), asyncRoute(async (req, res) => {
    const result = await service.reverseShipmentAccounting(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.get(`${API_ROOT}/documents`, ...authenticated, capability("documents.read"), asyncRoute(async (req, res) => {
    res.json(await service.listDocuments(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/documents`, requireRequestOrigin, ...authenticated, riskOperationLimiter, capability("documents.upload"), rawImageParser, asyncRoute(async (req, res) => {
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

  app.get(`${API_ROOT}/documents/:id/content`, ...authenticated, capability("documents.read"), asyncRoute(async (req, res) => {
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
      "Content-Disposition": `inline; filename="${safeHeaderFilename(document.originalName || "belge")}"`,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff"
    });
    res.send(buffer);
  }));

  app.post(`${API_ROOT}/documents/:id/archive`, ...mutationMiddlewares, capability("documents.archive"), asyncRoute(async (req, res) => {
    res.json(await service.archiveDocument(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/ledger`, ...authenticated, capability("accounting.read"), asyncRoute(async (req, res) => {
    res.json(await service.listLedger(req.procurementActor, req.query));
  }));

  app.post(`${API_ROOT}/ledger`, ...mutationMiddlewares, capability("accounting.post"), asyncRoute(async (req, res) => {
    const result = await service.createLedgerEntry(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/ledger/:id/reverse`, ...mutationMiddlewares, capability("accounting.reverse"), asyncRoute(async (req, res) => {
    const result = await service.reverseLedgerEntry(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/payments`, ...mutationMiddlewares, capability("payment.create"), asyncRoute(async (req, res) => {
    const result = await service.createPayment(req.procurementActor, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.post(`${API_ROOT}/payments/:id/reverse`, ...mutationMiddlewares, capability("payment.reverse"), asyncRoute(async (req, res) => {
    const result = await service.reversePayment(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req));
    res.status(result.idempotent ? 200 : 201).json(result);
  }));

  app.get(`${API_ROOT}/audit`, ...authenticated, anyCapability(["procurement.users.manage", "accounting.read"]), asyncRoute(async (req, res) => {
    res.json(await service.listAudit(req.procurementActor, req.query));
  }));

  app.get(`${API_ROOT}/users`, ...authenticated, capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    res.json(await service.listUsers(req.procurementActor));
  }));

  app.put(`${API_ROOT}/users/:id/access`, ...mutationMiddlewares, capability("procurement.users.manage"), asyncRoute(async (req, res) => {
    res.json(await service.updateUserAccess(req.procurementActor, req.params.id, jsonBody(req), mutationInput(req)));
  }));

  app.get(`${API_ROOT}/settings`, ...authenticated, anyCapability(["procurement.read", "procurement.users.manage", "accounting.read"]), asyncRoute(async (req, res) => {
    const result = await service.context(req.procurementActor);
    res.json({ ok: true, revision: result.revision, settings: result.procurement.settings });
  }));

  app.put(`${API_ROOT}/settings`, ...mutationMiddlewares, capability("procurement.users.manage"), asyncRoute(async (req, res) => {
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
      capabilities: [...FATURA_CAPABILITIES]
    };
  }
  if (sessionRole !== "personel" && payload.sessionRole !== "personel") return null;
  const userId = String(payload.userId || session.userId || "").trim();
  const data = req.storeSnapshot || await store.read();
  const user = req.recipeUser || (data.recipeUsers || []).find((item) => item && String(item.id) === userId);
  if (!user || user.active === false) throw fail("Aktif personel hesabı gerekli.", 403, "ACTIVE_PERSONEL_REQUIRED");
  return {
    type: "personel",
    id: String(user.id),
    name: String(user.name || user.username || "Personel"),
    role: String(user.faturaRole || "operasyon"),
    branchId: String(user.branchId || "main"),
    accessEnabled: user.faturaAccessEnabled !== false,
    template: String(user.faturaTemplate || "ozel"),
    capabilities: user.faturaAccessEnabled === false ? [] : [...new Set((Array.isArray(user.faturaCapabilities) ? user.faturaCapabilities : [])
      .map((item) => String(item || "").trim())
      .filter((item) => FATURA_CAPABILITIES.has(item)))]
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

function documentInputFromHeaders(req) {
  return {
    originalName: decodeHeaderValue(requestHeader(req, "X-File-Name")),
    documentType: requestHeader(req, "X-Document-Type"),
    supplierId: requestHeader(req, "X-Supplier-Id"),
    shipmentIds: splitHeader(requestHeader(req, "X-Shipment-Ids")),
    shipmentItemIds: splitHeader(requestHeader(req, "X-Shipment-Item-Ids")),
    documentNumber: requestHeader(req, "X-Document-Number"),
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
