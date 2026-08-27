"use strict";

const {
  validateMenuState,
  validateRecipeCatalog,
  validateRecipeState,
  validateSiteState
} = require("./validators");
const { normalizeStockState, reconcileRecipeCatalog } = require("./store/migrations");
const { migratePricingSystem } = require("./pricing");

class IdempotentReplay extends Error {
  constructor(response) {
    super("idempotent-replay");
    this.response = response;
  }
}

function registerPublishRoutes(options) {
  const { app, store, auth, requireAdminRequestOrigin, onPublished } = options;

  app.get("/api/admin/publish-state", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      res.json({
        ok: true,
        revision: revisionOf(data),
        updatedAt: data.publishUpdatedAt || null,
        panelConfig: data.panelConfig || null
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/publish", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const requestId = requestIdOf(req);
      const expectedRevision = Number(req.body && req.body.expectedRevision);
      const changes = req.body && req.body.changes;
      const inputError = validatePublishInput(requestId, expectedRevision, changes);
      if (inputError) return res.status(400).json({ ok: false, message: inputError });

      validateChanges(changes);
      let response;
      let nextStore;

      try {
        nextStore = await store.update((data) => {
          const existing = findRequest(data, requestId);
          if (existing) throw new IdempotentReplay(existing.response);

          const currentRevision = revisionOf(data);
          if (expectedRevision !== currentRevision) {
            const conflict = new Error("Veri başka bir oturumda güncellendi. Güncel veriyi yükleyip tekrar deneyin.");
            conflict.status = 409;
            conflict.currentRevision = currentRevision;
            throw conflict;
          }

          const updatedAt = new Date().toISOString();
          const changedScopes = applyChanges(data, changes, updatedAt);
          const revision = currentRevision + 1;
          data.revisions = { ...(data.revisions || {}), publish: revision };
          data.publishUpdatedAt = updatedAt;
          data.auditLog = appendLimited(data.auditLog, {
            id: `publish-${requestId}`,
            type: "admin_publish",
            requestId,
            revision,
            changedScopes,
            actor: req.admin && (req.admin.userId || req.admin.sub) || "admin",
            createdAt: updatedAt
          }, 5000);
          response = { ok: true, requestId, revision, updatedAt, changedScopes };
          data.idempotencyRequests = appendLimited(data.idempotencyRequests, {
            scope: "admin_publish",
            requestId,
            response,
            createdAt: updatedAt
          }, 500);
          return data;
        });
      } catch (error) {
        if (error instanceof IdempotentReplay) return res.json(error.response);
        if (Number(error && error.status) === 409) {
          return res.status(409).json({
            ok: false,
            code: "REVISION_CONFLICT",
            message: error.message,
            currentRevision: error.currentRevision
          });
        }
        throw error;
      }

      if (typeof onPublished === "function") await onPublished(nextStore, response);
      res.json(response);
    } catch (error) {
      if (Number(error && error.status)) return res.status(error.status).json({ ok: false, message: error.message });
      next(error);
    }
  });
}

function validatePublishInput(requestId, expectedRevision, changes) {
  if (!/^[a-zA-Z0-9._:-]{12,160}$/.test(requestId)) return "Geçerli bir requestId gerekli.";
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return "Geçerli expectedRevision gerekli.";
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
    return "Kaydedilecek değişiklik bulunamadı.";
  }
  return "";
}

function validateChanges(changes) {
  const allowed = new Set(["menuState", "recipeState", "recipeCatalog", "siteState", "stockState", "panelConfig"]);
  const unknown = Object.keys(changes).find((key) => !allowed.has(key));
  if (unknown) throw invalid(`Desteklenmeyen kayıt alanı: ${unknown}`);
  if (Object.prototype.hasOwnProperty.call(changes, "menuState")) {
    const error = validateMenuState(changes.menuState);
    if (error) throw invalid(error);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "recipeState")) {
    const error = validateRecipeState(changes.recipeState);
    if (error) throw invalid(error);
    const catalog = reconcileRecipeCatalog(changes.recipeState, changes.recipeCatalog);
    const catalogError = validateRecipeCatalog(catalog, changes.recipeState);
    if (catalogError) throw invalid(catalogError);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "siteState")) {
    const error = validateSiteState(changes.siteState);
    if (error) throw invalid(error);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "panelConfig") && (
    !changes.panelConfig || typeof changes.panelConfig !== "object" || Array.isArray(changes.panelConfig)
  )) throw invalid("Panel ayarları geçersiz.");
}

function applyChanges(data, changes, updatedAt) {
  const scopes = [];
  if (Object.prototype.hasOwnProperty.call(changes, "menuState")) {
    const beforePricing = menuPricingFingerprint(data.menuState, data.pricing);
    const migrated = migratePricingSystem(changes.menuState.pricing || data.pricing, changes.menuState);
    data.menuState = migrated.menuState;
    data.pricing = migrated.pricing;
    if (beforePricing !== menuPricingFingerprint(data.menuState, data.pricing)) {
      data.revisions = {
        ...(data.revisions || {}),
        pricing: pricingRevisionOf(data) + 1
      };
      data.pricingUpdatedAt = updatedAt;
    }
    data.menuUpdatedAt = updatedAt;
    scopes.push("menu");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "recipeState")) {
    data.recipeState = changes.recipeState;
    data.recipeCatalog = reconcileRecipeCatalog(changes.recipeState, changes.recipeCatalog);
    data.recipeUpdatedAt = updatedAt;
    scopes.push("recipes");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "siteState")) {
    data.siteState = changes.siteState;
    data.siteUpdatedAt = updatedAt;
    scopes.push("site");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "stockState")) {
    data.stockState = normalizeStockState(changes.stockState);
    data.stockUpdatedAt = updatedAt;
    scopes.push("stock");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "panelConfig")) {
    data.panelConfig = changes.panelConfig;
    data.panelConfigUpdatedAt = updatedAt;
    scopes.push("panel");
  }
  return scopes;
}

function pricingRevisionOf(data) {
  const value = Number(data && data.revisions && data.revisions.pricing || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function menuPricingFingerprint(menuState, pricing) {
  const rows = [];
  for (const category of (menuState && menuState.categories || [])) {
    for (const product of (category.products || [])) {
      rows.push([
        String(product.id || ""),
        product.pricing || null,
        product.priceMode || "",
        product.prices || null,
        product.variants || null
      ]);
    }
  }
  return JSON.stringify({ pricing, rows });
}

function requestIdOf(req) {
  return String(req.get("Idempotency-Key") || req.get("X-Request-ID") || req.body && req.body.requestId || "").trim();
}

function revisionOf(data) {
  const value = Number(data && data.revisions && data.revisions.publish || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function findRequest(data, requestId) {
  return (Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : [])
    .find((entry) => entry && entry.scope === "admin_publish" && entry.requestId === requestId);
}

function appendLimited(list, entry, limit) {
  return (Array.isArray(list) ? list : []).concat(entry).slice(-limit);
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = { registerPublishRoutes };
