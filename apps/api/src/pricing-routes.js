"use strict";

const crypto = require("crypto");
const express = require("express");
const { readWorkbook } = require("./simple-xlsx");
const { analyzePricingWorkbook, applyPricingImportPlan } = require("./pricing-excel");
const { retiredExcelImportHandler } = require("./retired-excel-import");
const {
  createPricingType,
  migratePricingSystem,
  normalizeOperation,
  normalizePricingCatalog,
  normalizeProductPricing,
  operationPrice,
  pricingTypeUsage,
  serializeLegacyMenuState,
  withLegacyPricing
} = require("./pricing");

const IDEMPOTENCY_LIMIT = 500;
const AUDIT_LIMIT = 200;
const IMPORT_DRAFT_LIMIT = 20;
const IMPORT_DRAFT_TTL_MS = 30 * 60 * 1000;
const IDEMPOTENT_REPLAY = Symbol("pricing-idempotent-replay");

function registerPricingRoutes(options) {
  const {
    app,
    store,
    auth,
    requireAdminRequestOrigin,
    riskOperationLimiter = (_req, _res, next) => next(),
    broadcastMenuUpdate,
    broadcastPublicUpdate
  } = options;

  app.get("/api/admin/pricing", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      res.json({
        ok: true,
        pricing: normalizePricingCatalog(data.pricing),
        revision: pricingRevision(data),
        publishRevision: currentPublishRevision(data),
        updatedAt: data.pricingUpdatedAt || data.menuUpdatedAt || null
      });
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.post("/api/admin/pricing/import-excel/analyze", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, retiredExcelImportHandler, express.raw({
    type: () => true,
    limit: "10mb"
  }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        throw clientError(400, "Analiz edilecek Excel dosyasını seçin.");
      }
      let workbook;
      try {
        workbook = readWorkbook(req.body);
      } catch (_error) {
        throw clientError(400, "Excel dosyası okunamadı. Geçerli bir .xlsx dosyası seçin.");
      }

      const now = new Date();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + IMPORT_DRAFT_TTL_MS).toISOString();
      const analysisId = auditId("pricing-import-analysis");
      const actor = actorFromRequest(req);
      const filename = decodeFileName(req.header("X-File-Name"));
      const analysisOptions = parsePricingAnalysisOptions(req.header("X-Pricing-Analysis-Options"));
      let payload = null;
      await store.update((data) => {
        const analysis = analyzePricingWorkbook(workbook, data.menuState, data.pricing, analysisOptions);
        const expectedRevision = pricingRevision(data);
        const expectedPublishRevision = currentPublishRevision(data);
        const draft = {
          id: analysisId,
          actor,
          filename,
          createdAt,
          expiresAt,
          expectedRevision,
          expectedPublishRevision,
          report: analysis.report,
          changes: analysis.changes,
          issues: analysis.issues,
          columnMappings: analysis.columnMappings,
          blankPolicy: analysis.blankPolicy,
          plan: analysis.plan
        };
        data.pricingImportDrafts = activeImportDrafts(data.pricingImportDrafts, now)
          .concat(draft)
          .slice(-IMPORT_DRAFT_LIMIT);
        payload = {
          ok: true,
          analysisId,
          filename,
          createdAt,
          expiresAt,
          expectedRevision,
          expectedPublishRevision,
          report: analysis.report,
          changes: analysis.changes,
          issues: analysis.issues,
          columnMappings: analysis.columnMappings,
          ignoredColumns: analysis.ignoredColumns,
          blankPolicy: analysis.blankPolicy
        };
        return data;
      });
      res.status(201).json(payload);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.post("/api/admin/pricing/import-excel/apply", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, retiredExcelImportHandler, async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const requestId = requireRequestId(req);
      const expectedRevision = requireExpectedRevision(body.expectedRevision);
      const analysisId = String(body.analysisId || "").trim();
      if (!/^pricing-import-analysis-[a-zA-Z0-9-]{12,160}$/.test(analysisId)) {
        throw clientError(400, "Geçerli bir Excel analiz kaydı gerekli.");
      }
      const scope = `pricing:excel-import:${analysisId}`;
      const actor = actorFromRequest(req);
      const response = await runIdempotentMutation(store, scope, requestId, (data) => {
        const now = new Date();
        data.pricingImportDrafts = activeImportDrafts(data.pricingImportDrafts, now);
        const draft = data.pricingImportDrafts.find((item) => item.id === analysisId);
        if (!draft) throw clientError(404, "Excel analizinin süresi doldu. Dosyayı yeniden analiz edin.");
        if (draft.actor !== actor) throw clientError(403, "Bu Excel analizini uygulama yetkiniz yok.");
        if (!draft.report || draft.report.canApply !== true) {
          throw clientError(409, "Eşleşme veya fiyat hataları düzeltilmeden Excel aktarımı uygulanamaz.");
        }
        if (expectedRevision !== draft.expectedRevision) {
          throw clientError(409, "Excel analizi farklı bir fiyat revizyonu için oluşturuldu.");
        }
        assertRevision(data, expectedRevision);
        if (currentPublishRevision(data) !== draft.expectedPublishRevision) {
          throw clientError(409, "Menü analizden sonra değişti. Dosyayı yeniden analiz edin.");
        }

        const beforeProducts = snapshotProductsForPlan(data.menuState, draft.plan);
        const applied = applyPricingImportPlan(data, draft.plan);
        if (!applied.changedRows.length) throw clientError(409, "Uygulanacak fiyat değişikliği bulunamadı.");
        const afterProducts = snapshotProductsForPlan(applied.menuState, draft.plan);
        const updatedAt = now.toISOString();
        const revision = expectedRevision + 1;
        const publishRevision = currentPublishRevision(data) + 1;
        const operationId = auditId("pricing-excel-import");
        data.pricing = applied.pricing;
        data.menuState = applied.menuState;
        data.revisions.pricing = revision;
        data.revisions.publish = publishRevision;
        data.revisions.catalog = currentCatalogRevision(data) + 1;
        data.pricingUpdatedAt = updatedAt;
        data.menuUpdatedAt = updatedAt;
        data.pricingImportDrafts = data.pricingImportDrafts.filter((item) => item.id !== analysisId);
        appendAudit(data, {
          id: operationId,
          kind: "pricing_excel_import",
          requestId,
          analysisId,
          filename: draft.filename,
          revisionBefore: expectedRevision,
          revisionAfter: revision,
          publishRevisionAfter: publishRevision,
          report: draft.report,
          changedRows: applied.changedRows,
          actor,
          createdAt: updatedAt,
          undo: { kind: "restore_products", products: beforeProducts, expectedProducts: afterProducts }
        });
        const payload = {
          ok: true,
          operationId,
          analysisId,
          changedRowCount: applied.changedRows.length,
          affectedProductCount: applied.affectedProductCount,
          newWeightOptions: Number(draft.report.newWeightOptions || 0),
          skippedRowCount: Number(draft.report.unchangedProducts || 0),
          skippedCellCount: draft.blankPolicy === "preserve" ? Number(draft.report.blankPriceCells || 0) : 0,
          errorCount: Number(draft.report.errorCount || 0),
          invalidRowCount: Number(draft.report.errorRowCount || 0),
          canUndo: true,
          revision,
          publishRevision,
          updatedAt
        };
        rememberResponse(data, scope, requestId, payload, updatedAt);
        return payload;
      });
      if (response.updatedAt && !response[IDEMPOTENT_REPLAY]) {
        const latest = await store.read();
        broadcastPricingChange(latest, response.updatedAt, broadcastMenuUpdate, broadcastPublicUpdate);
      }
      res.json(response);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.post("/api/admin/pricing/types", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const requestId = requireRequestId(req);
      const expectedRevision = requireExpectedRevision(req.body && req.body.expectedRevision);
      const typeInput = req.body && (req.body.type || req.body.pricingType);
      const scope = "pricing:type-upsert";
      const response = await runIdempotentMutation(store, scope, requestId, (data) => {
        assertRevision(data, expectedRevision);
        const currentCatalog = normalizePricingCatalog(data.pricing);
        const preparedType = preserveUsedRemovedOptions(typeInput, currentCatalog, data.menuState);
        const previousType = preparedType && preparedType.id
          ? currentCatalog.types.find((item) => item.id === normalizeId(preparedType.id)) || null
          : null;
        const result = createPricingType(preparedType, currentCatalog);
        const migrated = migratePricingSystem(result.catalog, data.menuState);
        const now = new Date().toISOString();
        const revision = expectedRevision + 1;
        const publishRevision = currentPublishRevision(data) + 1;
        data.pricing = migrated.pricing;
        data.menuState = migrated.menuState;
        data.revisions.pricing = revision;
        data.revisions.publish = publishRevision;
        data.revisions.catalog = currentCatalogRevision(data) + 1;
        data.pricingUpdatedAt = now;
        data.menuUpdatedAt = now;
        appendAudit(data, {
          id: auditId("pricing-type"),
          kind: result.created ? "pricing_type_created" : "pricing_type_updated",
          requestId,
          revisionBefore: expectedRevision,
          revisionAfter: revision,
          publishRevisionAfter: publishRevision,
          typeId: result.type.id,
          type: result.type,
          previousType,
          actor: actorFromRequest(req),
          createdAt: now,
          undo: previousType
            ? { kind: "restore_pricing_type", type: previousType }
            : { kind: "delete_pricing_type", typeId: result.type.id }
        });
        const payload = {
          ok: true,
          pricing: data.pricing,
          type: result.type,
          created: result.created,
          revision,
          publishRevision,
          updatedAt: now
        };
        rememberResponse(data, scope, requestId, payload, now);
        return payload;
      });
      if (response.updatedAt && !response[IDEMPOTENT_REPLAY]) {
        const latest = await store.read();
        broadcastPricingChange(latest, response.updatedAt, broadcastMenuUpdate, broadcastPublicUpdate);
      }
      res.status(response.created ? 201 : 200).json(response);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.delete("/api/admin/pricing/types/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const requestId = requireRequestId(req);
      const expectedRevision = requireExpectedRevision(
        (req.body && req.body.expectedRevision) ?? (req.query && req.query.expectedRevision)
      );
      const typeId = normalizeId(req.params.id);
      const scope = `pricing:type-delete:${typeId}`;
      const response = await runIdempotentMutation(store, scope, requestId, (data) => {
        assertRevision(data, expectedRevision);
        const catalog = normalizePricingCatalog(data.pricing);
        const type = catalog.types.find((item) => item.id === typeId);
        if (!type) throw clientError(404, "Fiyat tipi bulunamadı.");
        const usage = pricingTypeUsage(data.menuState, typeId);
        const isBuiltIn = ["standard", "size", "shot"].includes(typeId);
        const action = usage.length || isBuiltIn ? "archived" : "deleted";
        const types = action === "archived"
          ? catalog.types.map((item) => item.id === typeId ? { ...item, active: false } : item)
          : catalog.types.filter((item) => item.id !== typeId);
        const migrated = migratePricingSystem({ ...catalog, types }, data.menuState);
        const now = new Date().toISOString();
        const revision = expectedRevision + 1;
        const publishRevision = currentPublishRevision(data) + 1;
        data.pricing = migrated.pricing;
        data.menuState = migrated.menuState;
        data.revisions.pricing = revision;
        data.revisions.publish = publishRevision;
        data.revisions.catalog = currentCatalogRevision(data) + 1;
        data.pricingUpdatedAt = now;
        data.menuUpdatedAt = now;
        appendAudit(data, {
          id: auditId("pricing-type"),
          kind: action === "archived" ? "pricing_type_archived" : "pricing_type_deleted",
          requestId,
          revisionBefore: expectedRevision,
          revisionAfter: revision,
          publishRevisionAfter: publishRevision,
          typeId,
          previousType: type,
          usage,
          actor: actorFromRequest(req),
          createdAt: now,
          undo: { kind: "restore_pricing_type", type }
        });
        const payload = {
          ok: true,
          pricing: data.pricing,
          typeId,
          action,
          usageCount: usage.length,
          revision,
          publishRevision,
          updatedAt: now
        };
        rememberResponse(data, scope, requestId, payload, now);
        return payload;
      });
      if (response.updatedAt && !response[IDEMPOTENT_REPLAY]) {
        const latest = await store.read();
        broadcastPricingChange(latest, response.updatedAt, broadcastMenuUpdate, broadcastPublicUpdate);
      }
      res.json(response);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.post("/api/admin/pricing/bulk-update", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const requestId = requireRequestId(req);
      const expectedRevision = requireExpectedRevision(body.expectedRevision);
      const typeId = normalizeId(body.typeId);
      const optionIds = uniqueIds(body.optionIds);
      const productIds = uniqueIds(body.productIds);
      const operation = normalizeOperation(body.operation);
      const value = Number(body.value);
      if (!typeId || !optionIds.length || !productIds.length) {
        throw clientError(400, "Fiyat tipi, fiyat seçeneği ve en az bir ürün gerekli.");
      }
      if (!Number.isFinite(value) || value < 0) throw clientError(400, "İşlem değeri sıfır veya pozitif sayı olmalı.");

      const scope = "pricing:bulk-update";
      const response = await runIdempotentMutation(store, scope, requestId, (data) => {
        assertRevision(data, expectedRevision);
        const catalog = normalizePricingCatalog(data.pricing);
        const type = catalog.types.find((item) => item.id === typeId);
        if (!type) throw clientError(404, "Fiyat tipi bulunamadı.");
        const optionById = new Map(type.options.map((item) => [item.id, item]));
        const missingOptions = optionIds.filter((id) => !optionById.has(id));
        if (missingOptions.length) throw clientError(400, `Fiyat seçeneği bulunamadı: ${missingOptions.join(", ")}`);

        const requestedProducts = new Set(productIds);
        const encounteredProducts = new Set();
        const changedRows = [];
        const previousRows = [];
        const categories = (data.menuState.categories || []).map((category) => ({
          ...category,
          products: (category.products || []).map((rawProduct) => {
            if (!requestedProducts.has(String(rawProduct.id))) return rawProduct;
            encounteredProducts.add(String(rawProduct.id));
            const canonical = normalizeProductPricing(rawProduct.pricing);
            if (canonical.typeId !== typeId) {
              throw clientError(409, `${rawProduct.name} artık seçilen fiyat tipini kullanmıyor.`);
            }
            const values = { ...canonical.values };
            for (const optionId of optionIds) {
              const currentValue = values[optionId];
              if (!currentValue || currentValue.active === false || currentValue.price === null) {
                throw clientError(409, `${rawProduct.name} ürününde ${optionById.get(optionId).label} fiyatı güncellenebilir değil.`);
              }
              const oldPrice = Number(currentValue.price);
              const newPrice = operationPrice(oldPrice, operation, value, body.rounding);
              if (oldPrice === newPrice) continue;
              values[optionId] = { ...currentValue, price: newPrice };
              const row = {
                productId: String(rawProduct.id),
                productName: String(rawProduct.name || ""),
                categoryId: String(category.id || ""),
                categoryName: String(category.name || ""),
                typeId,
                typeName: type.name,
                optionId,
                optionLabel: optionById.get(optionId).label,
                oldPrice,
                newPrice,
                oldActive: currentValue.active !== false,
                newActive: currentValue.active !== false,
                change: Math.round((newPrice - oldPrice) * 100) / 100
              };
              changedRows.push(row);
              previousRows.push({
                productId: row.productId,
                typeId,
                optionId,
                price: oldPrice,
                active: currentValue.active !== false
              });
            }
            return withLegacyPricing({ ...rawProduct, pricing: { ...canonical, values } }, catalog);
          })
        }));

        const missingProducts = productIds.filter((id) => !encounteredProducts.has(id));
        if (missingProducts.length) throw clientError(404, `Ürün bulunamadı: ${missingProducts.join(", ")}`);
        if (!changedRows.length) throw clientError(400, "Seçilen fiyatlarda değişiklik oluşmadı.");

        const now = new Date().toISOString();
        const revision = expectedRevision + 1;
        const publishRevision = currentPublishRevision(data) + 1;
        data.menuState = { ...data.menuState, categories };
        data.pricing = catalog;
        data.revisions.pricing = revision;
        data.revisions.publish = publishRevision;
        data.revisions.catalog = currentCatalogRevision(data) + 1;
        data.pricingUpdatedAt = now;
        data.menuUpdatedAt = now;
        const operationId = auditId("pricing-bulk");
        appendAudit(data, {
          id: operationId,
          kind: "pricing_bulk_update",
          requestId,
          revisionBefore: expectedRevision,
          revisionAfter: revision,
          publishRevisionAfter: publishRevision,
          typeId,
          optionIds,
          productIds,
          operation,
          value,
          rounding: body.rounding ?? null,
          changedRows,
          actor: actorFromRequest(req),
          createdAt: now,
          undo: { kind: "restore_prices", rows: previousRows }
        });
        const payload = {
          ok: true,
          operationId,
          changedRows,
          changedRowCount: changedRows.length,
          affectedProductCount: new Set(changedRows.map((item) => item.productId)).size,
          canUndo: true,
          revision,
          publishRevision,
          updatedAt: now
        };
        rememberResponse(data, scope, requestId, payload, now);
        return payload;
      });
      if (response.updatedAt && !response[IDEMPOTENT_REPLAY]) {
        const latest = await store.read();
        broadcastPricingChange(latest, response.updatedAt, broadcastMenuUpdate, broadcastPublicUpdate);
      }
      res.json(response);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.get("/api/admin/pricing/history", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const limit = Math.min(100, Math.max(1, Number(req.query && req.query.limit) || 50));
      const history = (Array.isArray(data.pricingAudit) ? data.pricingAudit : [])
        .slice()
        .reverse()
        .slice(0, limit)
        .map(pricingHistoryRecord);
      res.json({
        ok: true,
        history,
        revision: pricingRevision(data),
        publishRevision: currentPublishRevision(data)
      });
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });

  app.post("/api/admin/pricing/history/:id/undo", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, async (req, res, next) => {
    try {
      const operationId = String(req.params.id || "").trim();
      if (!/^[a-zA-Z0-9._:-]{8,180}$/.test(operationId)) throw clientError(400, "Geçerli bir fiyat işlem kimliği gerekli.");
      const requestId = requireRequestId(req);
      const expectedRevision = requireExpectedRevision(req.body && req.body.expectedRevision);
      const scope = `pricing:undo:${operationId}`;
      const response = await runIdempotentMutation(store, scope, requestId, (data) => {
        assertRevision(data, expectedRevision);
        const audit = (Array.isArray(data.pricingAudit) ? data.pricingAudit : []).find((item) => item && item.id === operationId);
        if (!audit) throw clientError(404, "Geri alınacak fiyat işlemi bulunamadı.");
        if (!audit.undo || audit.undoneAt || audit.undoneByOperationId) throw clientError(409, "Bu fiyat işlemi geri alınamaz veya daha önce geri alınmış.");

        const restored = applyPricingUndo(data, audit);
        const now = new Date().toISOString();
        const revision = expectedRevision + 1;
        const publishRevision = currentPublishRevision(data) + 1;
        const undoOperationId = auditId("pricing-undo");
        data.pricing = restored.pricing;
        data.menuState = restored.menuState;
        data.revisions.pricing = revision;
        data.revisions.publish = publishRevision;
        data.revisions.catalog = currentCatalogRevision(data) + 1;
        data.pricingUpdatedAt = now;
        data.menuUpdatedAt = now;
        audit.undoneAt = now;
        audit.undoneBy = actorFromRequest(req);
        audit.undoneByOperationId = undoOperationId;
        appendAudit(data, {
          id: undoOperationId,
          kind: "pricing_operation_undone",
          requestId,
          undoOf: operationId,
          revisionBefore: expectedRevision,
          revisionAfter: revision,
          publishRevisionAfter: publishRevision,
          changedRows: restored.changedRows,
          actor: actorFromRequest(req),
          createdAt: now
        });
        const payload = {
          ok: true,
          operationId: undoOperationId,
          undoOf: operationId,
          changedRows: restored.changedRows,
          changedRowCount: restored.changedRows.length,
          affectedProductCount: new Set(restored.changedRows.map((item) => item.productId).filter(Boolean)).size,
          revision,
          publishRevision,
          updatedAt: now,
          canUndo: false
        };
        rememberResponse(data, scope, requestId, payload, now);
        return payload;
      });
      if (response.updatedAt && !response[IDEMPOTENT_REPLAY]) {
        const latest = await store.read();
        broadcastPricingChange(latest, response.updatedAt, broadcastMenuUpdate, broadcastPublicUpdate);
      }
      res.json(response);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  });
}

function pricingHistoryRecord(record) {
  const changedRows = Array.isArray(record && record.changedRows) ? record.changedRows : [];
  const report = record && record.report && typeof record.report === "object" ? record.report : {};
  return {
    id: String(record && record.id || ""),
    kind: String(record && record.kind || "pricing_operation"),
    filename: record && record.filename ? String(record.filename) : "",
    typeId: record && record.typeId ? String(record.typeId) : "",
    revisionBefore: Number(record && record.revisionBefore || 0),
    revisionAfter: Number(record && record.revisionAfter || 0),
    publishRevisionAfter: Number(record && record.publishRevisionAfter || 0),
    changedRowCount: changedRows.length || Number(report.updatePriceCount || 0),
    affectedProductCount: new Set(changedRows.map((item) => String(item && item.productId || "")).filter(Boolean)).size
      || Number(report.updatedProductCount || 0),
    createdAt: record && record.createdAt || null,
    actor: record && record.actor ? String(record.actor) : "admin",
    undoOf: record && record.undoOf ? String(record.undoOf) : "",
    undoneAt: record && record.undoneAt || null,
    undoneByOperationId: record && record.undoneByOperationId || null,
    canUndo: Boolean(record && record.undo && !record.undoneAt && !record.undoneByOperationId)
  };
}

function applyPricingUndo(data, audit) {
  const undo = audit && audit.undo || {};
  if (undo.kind === "restore_prices") return restorePriceRows(data, audit, undo.rows);
  if (undo.kind === "restore_products") return restoreProductSnapshots(data, undo.products, undo.expectedProducts);
  if (undo.kind === "restore_pricing_type") return restorePricingType(data, audit, undo.type);
  if (undo.kind === "delete_pricing_type") return deletePricingType(data, audit, undo.typeId);
  throw clientError(409, "Bu fiyat işlemi için güvenli geri alma planı bulunmuyor.");
}

function restorePriceRows(data, audit, rowsInput) {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  if (!rows.length) throw clientError(409, "Geri alma fiyat satırları bulunamadı.");
  const expectedByKey = new Map((Array.isArray(audit.changedRows) ? audit.changedRows : []).map((row) => [
    pricingRowKey(row.productId, row.typeId, row.optionId), row
  ]));
  const restoreByProduct = new Map();
  for (const row of rows) {
    const productId = String(row && row.productId || "");
    const key = pricingRowKey(productId, row && row.typeId, row && row.optionId);
    if (!productId || !expectedByKey.has(key)) throw clientError(409, "Geri alma kaydı eksik veya bozuk.");
    if (!restoreByProduct.has(productId)) restoreByProduct.set(productId, []);
    restoreByProduct.get(productId).push({ ...row, expected: expectedByKey.get(key) });
  }
  const catalog = normalizePricingCatalog(data.pricing);
  const encountered = new Set();
  const changedRows = [];
  const categories = (data.menuState.categories || []).map((category) => ({
    ...category,
    products: (category.products || []).map((product) => {
      const requested = restoreByProduct.get(String(product.id));
      if (!requested) return product;
      encountered.add(String(product.id));
      const pricing = normalizeProductPricing(product.pricing);
      const values = { ...pricing.values };
      for (const row of requested) {
        if (pricing.typeId !== String(row.typeId || "")) throw clientError(409, `${product.name} fiyat tipi işlemden sonra değişmiş.`);
        const current = values[row.optionId];
        const currentPrice = current && current.price !== null ? Number(current.price) : null;
        const currentActive = current ? current.active !== false : false;
        const expectedPrice = row.expected.newPrice === null ? null : Number(row.expected.newPrice);
        const expectedActive = row.expected.newActive !== false;
        if (currentPrice !== expectedPrice || currentActive !== expectedActive) {
          throw clientError(409, `${product.name} fiyatı işlemden sonra değişmiş; eski işlem güvenle geri alınamaz.`);
        }
        const restoredPrice = row.price === null ? null : Number(row.price);
        const restoredActive = row.active !== false;
        values[row.optionId] = { ...(current || {}), price: restoredPrice, active: restoredActive };
        changedRows.push({
          productId: String(product.id),
          productName: String(product.name || ""),
          categoryId: String(category.id || ""),
          typeId: pricing.typeId,
          optionId: String(row.optionId),
          oldPrice: currentPrice,
          newPrice: restoredPrice,
          oldActive: currentActive,
          newActive: restoredActive
        });
      }
      return withLegacyPricing({ ...product, pricing: { ...pricing, values } }, catalog);
    })
  }));
  if (encountered.size !== restoreByProduct.size) throw clientError(409, "Geri alınacak ürünlerden biri artık menüde bulunmuyor.");
  return { pricing: catalog, menuState: { ...data.menuState, pricing: catalog, categories }, changedRows };
}

function restoreProductSnapshots(data, productsInput, expectedInput) {
  const products = Array.isArray(productsInput) ? productsInput : [];
  const expected = new Map((Array.isArray(expectedInput) ? expectedInput : []).map((item) => [
    `${String(item.categoryId)}\u0000${String(item.productId)}`, item
  ]));
  const restore = new Map(products.map((item) => [`${String(item.categoryId)}\u0000${String(item.productId)}`, item]));
  if (!restore.size || restore.size !== expected.size) throw clientError(409, "Excel geri alma kaydı eksik.");
  const catalog = normalizePricingCatalog(data.pricing);
  const encountered = new Set();
  const changedRows = [];
  const categories = (data.menuState.categories || []).map((category) => ({
    ...category,
    products: (category.products || []).map((product) => {
      const key = `${String(category.id)}\u0000${String(product.id)}`;
      const before = restore.get(key);
      if (!before) return product;
      const after = expected.get(key);
      if (!after || !sameJson(normalizeProductPricing(product.pricing), normalizeProductPricing(after.pricing))) {
        throw clientError(409, `${product.name} fiyatları Excel işleminden sonra değişmiş; güvenli geri alma yapılamaz.`);
      }
      encountered.add(key);
      const restoredPricing = normalizeProductPricing(before.pricing);
      changedRows.push({
        productId: String(product.id),
        productName: String(product.name || ""),
        categoryId: String(category.id || ""),
        typeId: restoredPricing.typeId
      });
      return withLegacyPricing({ ...product, pricing: restoredPricing }, catalog);
    })
  }));
  if (encountered.size !== restore.size) throw clientError(409, "Geri alınacak Excel ürünlerinden biri artık bulunmuyor.");
  return { pricing: catalog, menuState: { ...data.menuState, pricing: catalog, categories }, changedRows };
}

function restorePricingType(data, audit, typeInput) {
  if (!typeInput || typeof typeInput !== "object" || !typeInput.id) throw clientError(409, "Geri alınacak fiyat tipi bulunamadı.");
  const catalog = normalizePricingCatalog(data.pricing);
  const typeId = String(typeInput.id);
  const current = catalog.types.find((item) => item.id === typeId) || null;
  if (audit.kind === "pricing_type_updated" && (!current || !sameJson(current, audit.type))) {
    throw clientError(409, "Fiyat tipi işlemden sonra değişmiş; güvenli geri alma yapılamaz.");
  }
  if (audit.kind === "pricing_type_archived" && (!current || current.active !== false)) {
    throw clientError(409, "Arşivlenen fiyat tipi işlemden sonra değişmiş.");
  }
  if (audit.kind === "pricing_type_deleted" && current) throw clientError(409, "Silinen fiyat tipi yeniden oluşturulmuş.");
  const types = current
    ? catalog.types.map((item) => item.id === typeId ? typeInput : item)
    : catalog.types.concat(typeInput);
  const migrated = migratePricingSystem({ ...catalog, types }, data.menuState);
  return {
    pricing: migrated.pricing,
    menuState: migrated.menuState,
    changedRows: [{ typeId, action: "restored" }]
  };
}

function deletePricingType(data, audit, typeIdInput) {
  const typeId = normalizeId(typeIdInput);
  const catalog = normalizePricingCatalog(data.pricing);
  const current = catalog.types.find((item) => item.id === typeId);
  if (!current || !sameJson(current, audit.type)) throw clientError(409, "Oluşturulan fiyat tipi işlemden sonra değişmiş.");
  if (pricingTypeUsage(data.menuState, typeId).length) throw clientError(409, "Kullanımdaki fiyat tipi geri alınarak silinemez.");
  const migrated = migratePricingSystem({ ...catalog, types: catalog.types.filter((item) => item.id !== typeId) }, data.menuState);
  return {
    pricing: migrated.pricing,
    menuState: migrated.menuState,
    changedRows: [{ typeId, action: "deleted" }]
  };
}

function snapshotProductsForPlan(menuState, plan) {
  const keys = new Set((Array.isArray(plan && plan.productUpdates) ? plan.productUpdates : []).map((item) => (
    `${String(item.categoryId)}\u0000${String(item.productId)}`
  )));
  const snapshots = [];
  for (const category of (menuState && menuState.categories || [])) {
    for (const product of (category.products || [])) {
      const key = `${String(category.id)}\u0000${String(product.id)}`;
      if (!keys.has(key)) continue;
      snapshots.push({
        categoryId: String(category.id),
        productId: String(product.id),
        pricing: JSON.parse(JSON.stringify(normalizeProductPricing(product.pricing)))
      });
    }
  }
  if (snapshots.length !== keys.size) throw clientError(409, "Excel analizindeki ürünlerden biri artık bulunmuyor.");
  return snapshots;
}

function parsePricingAnalysisOptions(value) {
  if (!value) return {};
  const raw = String(value).slice(0, 14000);
  try {
    const decoded = raw.startsWith("{") ? raw : decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch (_error) {
    throw clientError(400, "Excel analiz seçenekleri geçersiz.");
  }
}

function pricingRowKey(productId, typeId, optionId) {
  return `${String(productId)}\u0000${String(typeId)}\u0000${String(optionId)}`;
}

function sameJson(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function runIdempotentMutation(store, scope, requestId, mutate) {
  let response = null;
  try {
    await store.update((data) => {
      const prior = (data.idempotencyRequests || []).find((item) => item.requestId === requestId);
      if (prior) {
        if (prior.scope !== scope) throw clientError(409, "requestId daha önce farklı bir işlem için kullanıldı.");
        const replay = new Error("idempotent-replay");
        replay.isIdempotentReplay = true;
        replay.response = prior.response;
        throw replay;
      }
      if (!data.revisions || typeof data.revisions !== "object") data.revisions = { publish: 0, pricing: 0 };
      if (!Array.isArray(data.idempotencyRequests)) data.idempotencyRequests = [];
      if (!Array.isArray(data.pricingAudit)) data.pricingAudit = [];
      response = mutate(data);
      return data;
    });
    return response;
  } catch (error) {
    if (error && error.isIdempotentReplay) {
      const replayed = error.response;
      if (replayed && typeof replayed === "object") {
        Object.defineProperty(replayed, IDEMPOTENT_REPLAY, { value: true, enumerable: false });
      }
      return replayed;
    }
    throw error;
  }
}

function preserveUsedRemovedOptions(typeInput, catalog, menuState) {
  if (!typeInput || typeof typeInput !== "object" || !typeInput.id) return typeInput;
  const existing = catalog.types.find((item) => item.id === normalizeId(typeInput.id));
  if (!existing) return typeInput;
  const incoming = Array.isArray(typeInput.options) ? typeInput.options.slice() : [];
  const incomingIds = new Set(incoming.map((item) => normalizeId(item && item.id)).filter(Boolean));
  const usedIds = new Set();
  for (const category of (menuState && menuState.categories || [])) {
    for (const product of (category.products || [])) {
      if (product && product.pricing && product.pricing.typeId === existing.id) {
        Object.keys(product.pricing.values || {}).forEach((id) => usedIds.add(id));
      }
    }
  }
  existing.options.forEach((option) => {
    if (usedIds.has(option.id) && !incomingIds.has(option.id)) incoming.push({ ...option, active: false });
  });
  return { ...typeInput, id: existing.id, options: incoming };
}

function broadcastPricingChange(data, updatedAt, broadcastMenuUpdate, broadcastPublicUpdate) {
  if (typeof broadcastMenuUpdate === "function") {
    broadcastMenuUpdate(
      serializeLegacyMenuState(data.menuState, data.pricing),
      updatedAt,
      data.pricing,
      pricingRevision(data),
      currentCatalogRevision(data)
    );
  }
  if (typeof broadcastPublicUpdate === "function") broadcastPublicUpdate(data, "pricing");
}

function appendAudit(data, record) {
  data.pricingAudit = (data.pricingAudit || []).concat(record).slice(-AUDIT_LIMIT);
}

function rememberResponse(data, scope, requestId, response, createdAt) {
  data.idempotencyRequests = (data.idempotencyRequests || []).concat({
    scope,
    requestId,
    response,
    createdAt
  }).slice(-IDEMPOTENCY_LIMIT);
}

function assertRevision(data, expectedRevision) {
  const currentRevision = pricingRevision(data);
  if (currentRevision !== expectedRevision) {
    const error = clientError(409, "Fiyat verisi başka bir işlem tarafından güncellendi.");
    error.currentRevision = currentRevision;
    throw error;
  }
}

function pricingRevision(data) {
  const value = data && data.revisions && Number(data.revisions.pricing);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function currentPublishRevision(data) {
  const value = data && data.revisions && Number(data.revisions.publish);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function currentCatalogRevision(data) {
  const value = data && data.revisions && Number(data.revisions.catalog);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function requireExpectedRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) throw clientError(400, "expectedRevision sıfır veya pozitif tam sayı olmalı.");
  return revision;
}

function requireRequestId(req) {
  const value = String(req.body && req.body.requestId || req.query && req.query.requestId || req.header("Idempotency-Key") || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) throw clientError(400, "Geçerli bir requestId gerekli.");
  return value;
}

function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeId).filter(Boolean))];
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function actorFromRequest(req) {
  const payload = req.admin || {};
  return String(payload.sub || payload.userId || payload.role || "admin");
}

function activeImportDrafts(value, now = new Date()) {
  const nowTime = now.getTime();
  return (Array.isArray(value) ? value : []).filter((draft) => {
    const expiry = Date.parse(draft && draft.expiresAt || "");
    return draft && draft.id && Number.isFinite(expiry) && expiry > nowTime;
  });
}

function decodeFileName(value) {
  const raw = String(value || "fiyat-aktarimi.xlsx").slice(0, 240);
  try {
    return decodeURIComponent(raw).replace(/[\\/\u0000-\u001f]/g, "_");
  } catch (_error) {
    return raw.replace(/[\\/\u0000-\u001f]/g, "_");
  }
}

function auditId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleRouteError(error, res, next) {
  if (Number(error && error.status) === 409 && Number.isInteger(error.currentRevision)) {
    return res.status(409).json({
      ok: false,
      code: "PRICING_REVISION_CONFLICT",
      message: error.message,
      currentRevision: error.currentRevision
    });
  }
  return next(error);
}

module.exports = { registerPricingRoutes };
