"use strict";

const crypto = require("crypto");
const { serializeLegacyMenuState } = require("./pricing");
const {
  CATALOG_CLEANUP_CONFIRMATION,
  CATALOG_CLEANUP_VERSION,
  applyCatalogCleanup,
  buildCatalogCleanupPreview,
  catalogCleanupFingerprint,
  catalogCleanupRevision,
  completedCatalogCleanup
} = require("./catalog-cleanup");

function registerCatalogCleanupRoutes(options) {
  const { app, store, auth, requireAdminRequestOrigin, riskOperationLimiter = (_req, _res, next) => next() } = options;

  app.post("/api/admin/catalog-maintenance/legacy-cleanup/preview", requireAdminRequestOrigin, auth.requireAdmin, async (_req, res, next) => {
    try {
      const data = await store.read();
      res.json({ ok: true, ...buildCatalogCleanupPreview(data) });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/catalog-maintenance/legacy-cleanup/apply", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      if (String(body.confirmation || "") !== CATALOG_CLEANUP_CONFIRMATION) {
        return res.status(400).json({ ok: false, message: `Bu tek seferlik işlem için confirmation alanına ${CATALOG_CLEANUP_CONFIRMATION} yazılmalıdır.` });
      }
      const expectedRevision = requiredRevision(body.expectedRevision);
      const expectedFingerprint = requiredFingerprint(body.expectedFingerprint);
      const requestId = requestIdentifier(req, body);
      const actor = String(req.admin && (req.admin.sessionId || req.admin.sub) || "admin");
      const operationId = `catalog-cleanup-${crypto.randomUUID()}`;
      let result;
      let rollbackSnapshot = null;

      const nextStore = await store.update((data) => {
        const completed = completedCatalogCleanup(data);
        if (completed) {
          result = { marker: completed, idempotent: true, summary: completed.summary || {} };
          return data;
        }
        if (catalogCleanupRevision(data) !== expectedRevision) throw clientError(409, "Katalog bakım revizyonu değişti. Önizlemeyi yenileyin.");
        if (catalogCleanupFingerprint(data) !== expectedFingerprint) throw clientError(409, "Katalog önizlemeden sonra değişti. Temizlemeden önce yeniden önizleyin.");
        rollbackSnapshot = structuredClone(data);
        result = applyCatalogCleanup(data, { operationId, actor, requestId, now: new Date().toISOString() });
        return result.data;
      }, {
        backupLabel: `${CATALOG_CLEANUP_VERSION}-${requestId}`,
        shouldBackup: (data) => !completedCatalogCleanup(data)
      });

      const marker = completedCatalogCleanup(nextStore);
      if (!marker || marker.status !== "completed" || (!result.idempotent && marker.afterFingerprint !== catalogCleanupFingerprint(nextStore))) {
        if (rollbackSnapshot) await store.update(() => rollbackSnapshot);
        throw clientError(500, "Katalog temizliği yazma doğrulamasından geçemedi. İşlem başarılı sayılmadı.");
      }
      if (!result.idempotent) broadcastCleanup(nextStore, marker.completedAt, options);
      res.json({
        ok: true,
        operationId: marker.id,
        version: marker.version,
        idempotent: result.idempotent,
        revision: marker.revision,
        publishRevision: nextStore.revisions.publish,
        dataImportRevision: nextStore.revisions.dataImport,
        summary: marker.summary,
        completedAt: marker.completedAt
      });
    } catch (error) {
      if (error && Number(error.status) >= 400 && Number(error.status) < 600) {
        return res.status(Number(error.status)).json({ ok: false, message: error.message });
      }
      return next(error);
    }
  });
}

function broadcastCleanup(data, updatedAt, options) {
  if (typeof options.broadcastMenuUpdate === "function") {
    options.broadcastMenuUpdate(serializeLegacyMenuState(data.menuState, data.pricing), updatedAt, data.pricing, data.revisions.pricing, data.revisions.catalog);
  }
  if (typeof options.broadcastRecipeUpdate === "function") options.broadcastRecipeUpdate(data.recipeState, updatedAt, data.recipeCatalog || [], data.revisions.catalog);
  if (typeof options.broadcastStockUpdate === "function") options.broadcastStockUpdate(data.stockState, updatedAt, data.revisions.inventory, "inventory");
  if (typeof options.broadcastPublicUpdate === "function") options.broadcastPublicUpdate(data, "catalog-cleanup");
}

function requiredRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) throw clientError(400, "Geçerli expectedRevision gerekli.");
  return revision;
}

function requiredFingerprint(value) {
  const fingerprint = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw clientError(400, "Geçerli expectedFingerprint gerekli.");
  return fingerprint;
}

function requestIdentifier(req, body) {
  const value = String(req.header("Idempotency-Key") || req.header("X-Request-ID") || body.requestId || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,180}$/.test(value)) throw clientError(400, "Geçerli requestId veya Idempotency-Key gerekli.");
  return value;
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = { registerCatalogCleanupRoutes };
