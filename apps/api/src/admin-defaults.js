"use strict";

const menuDesignSchema = require("../../../shared/scripts/menu-design-schema");
const {
  validateDesignSettings,
  validateCategoryDesign,
  validateProductDesign,
  validateSafeState,
  isSafeMediaResource
} = require("./validators");

const SYSTEM_SETTING_KEYS = Object.freeze([
  "cafeName",
  "shortDescription",
  "phone",
  "whatsapp",
  "address",
  "hours",
  "instagram",
  "email",
  "logo",
  "favicon"
]);

class IdempotentReplay extends Error {
  constructor(response) {
    super("idempotent-replay");
    this.response = response;
  }
}

function registerAdminDefaultRoutes({ app, store, auth, requireAdminRequestOrigin }) {
  const guards = [requireAdminRequestOrigin, auth.requireAdmin];

  app.get("/api/admin/defaults", ...guards, async (_req, res, next) => {
    try {
      const data = await store.read();
      res.json({ ok: true, adminDefaults: normalizeAdminDefaults(data.adminDefaults) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/defaults/menu-design", ...guards, async (_req, res, next) => {
    try {
      const data = await store.read();
      res.json({ ok: true, menuDesign: normalizeAdminDefaults(data.adminDefaults).menuDesign });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/defaults/menu-design", ...guards, async (req, res, next) => {
    try {
      const requestId = requestIdOf(req);
      const expectedRevision = Number(req.body && (req.body.revision ?? req.body.expectedRevision));
      const designInput = req.body && (req.body.design || req.body.menuDesign);
      const inputError = validateWriteInput(requestId, expectedRevision, designInput);
      if (inputError) return res.status(400).json({ ok: false, message: inputError });

      const design = menuDesignSchema.normalizeDesignSnapshot(designInput);
      const designError = validateMenuDesignSnapshot(design);
      if (designError) return res.status(400).json({ ok: false, message: designError });

      let response;
      try {
        await store.update((data) => {
          const replay = findRequest(data, "admin_default_menu_design", requestId);
          if (replay) throw new IdempotentReplay(replay.response);
          const defaults = normalizeAdminDefaults(data.adminDefaults);
          const currentRevision = Number(defaults.menuDesign && defaults.menuDesign.revision || 0);
          if (currentRevision !== expectedRevision) throw conflict(currentRevision);
          const savedAt = new Date().toISOString();
          defaults.menuDesign = {
            ...design,
            revision: currentRevision + 1,
            savedAt,
            savedBy: "admin"
          };
          data.adminDefaults = defaults;
          response = { ok: true, menuDesign: defaults.menuDesign };
          rememberRequest(data, "admin_default_menu_design", requestId, response, savedAt);
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
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/defaults/system-settings", ...guards, async (_req, res, next) => {
    try {
      const data = await store.read();
      res.json({ ok: true, systemSettings: normalizeAdminDefaults(data.adminDefaults).systemSettings });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/defaults/system-settings", ...guards, async (req, res, next) => {
    try {
      const requestId = requestIdOf(req);
      const expectedRevision = Number(req.body && (req.body.revision ?? req.body.expectedRevision));
      const settingsInput = req.body && (req.body.settings || req.body.systemSettings);
      const inputError = validateWriteInput(requestId, expectedRevision, settingsInput);
      if (inputError) return res.status(400).json({ ok: false, message: inputError });
      const settings = normalizeSystemSettings(settingsInput);
      const settingsError = validateSystemSettings(settings);
      if (settingsError) return res.status(400).json({ ok: false, message: settingsError });

      let response;
      try {
        await store.update((data) => {
          const replay = findRequest(data, "admin_default_system_settings", requestId);
          if (replay) throw new IdempotentReplay(replay.response);
          const defaults = normalizeAdminDefaults(data.adminDefaults);
          const currentRevision = Number(defaults.systemSettings && defaults.systemSettings.revision || 0);
          if (currentRevision !== expectedRevision) throw conflict(currentRevision);
          const savedAt = new Date().toISOString();
          defaults.systemSettings = {
            revision: currentRevision + 1,
            settings,
            savedAt,
            savedBy: "admin"
          };
          data.adminDefaults = defaults;
          response = { ok: true, systemSettings: defaults.systemSettings };
          rememberRequest(data, "admin_default_system_settings", requestId, response, savedAt);
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
      res.json(response);
    } catch (error) {
      next(error);
    }
  });
}

function normalizeAdminDefaults(value) {
  const source = isRecord(value) ? value : {};
  return {
    menuDesign: normalizeStoredMenuDesign(source.menuDesign),
    systemSettings: normalizeStoredSystemSettings(source.systemSettings)
  };
}

function normalizeStoredMenuDesign(value) {
  if (!isRecord(value)) return null;
  const design = menuDesignSchema.normalizeDesignSnapshot(value);
  if (validateMenuDesignSnapshot(design)) return null;
  return {
    ...design,
    revision: positiveRevision(value.revision),
    savedAt: safeDate(value.savedAt),
    savedBy: safeActor(value.savedBy)
  };
}

function normalizeStoredSystemSettings(value) {
  if (!isRecord(value)) return null;
  const settings = normalizeSystemSettings(value.settings);
  if (validateSystemSettings(settings)) return null;
  return {
    revision: positiveRevision(value.revision),
    settings,
    savedAt: safeDate(value.savedAt),
    savedBy: safeActor(value.savedBy)
  };
}

function normalizeSystemSettings(value) {
  const source = isRecord(value) ? value : {};
  const result = {};
  SYSTEM_SETTING_KEYS.forEach((key) => {
    result[key] = String(source[key] == null ? "" : source[key]).trim().slice(0, key === "shortDescription" ? 1200 : 500);
  });
  return result;
}

function validateMenuDesignSnapshot(value) {
  const safetyError = validateSafeState(value, "adminDefaults.menuDesign", 750_000, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;
  const settingsError = validateDesignSettings(value.settings);
  if (settingsError) return settingsError;
  for (const category of value.categoryDesign || []) {
    if (!category.id) return "Kategori tasarım kimliği gerekli.";
    const error = validateCategoryDesign(category);
    if (error) return error;
  }
  for (const product of value.productDesign || []) {
    if (!product.id) return "Ürün tasarım kimliği gerekli.";
    const error = validateProductDesign(product);
    if (error) return error;
  }
  return "";
}

function validateSystemSettings(value) {
  const safetyError = validateSafeState(value, "adminDefaults.systemSettings", 50_000, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;
  if (!isSafeMediaResource(value.logo) || !isSafeMediaResource(value.favicon)) {
    return "Logo veya favicon adresi güvenli değil.";
  }
  return "";
}

function validateWriteInput(requestId, revision, value) {
  if (!/^[a-zA-Z0-9._:-]{12,160}$/.test(requestId)) return "Geçerli bir requestId gerekli.";
  if (!Number.isSafeInteger(revision) || revision < 0) return "Geçerli revision gerekli.";
  if (!isRecord(value)) return "Kaydedilecek varsayılan verisi gerekli.";
  return "";
}

function requestIdOf(req) {
  return String(req.get("Idempotency-Key") || req.get("X-Request-ID") || req.body && req.body.requestId || "").trim();
}

function findRequest(data, scope, requestId) {
  return (Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : [])
    .find((entry) => entry && entry.scope === scope && entry.requestId === requestId);
}

function rememberRequest(data, scope, requestId, response, createdAt) {
  data.idempotencyRequests = (Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : [])
    .concat({ scope, requestId, response, createdAt })
    .slice(-500);
}

function conflict(currentRevision) {
  const error = new Error("Yönetici varsayılanı başka bir oturumda güncellendi. Güncel kaydı yükleyip tekrar deneyin.");
  error.status = 409;
  error.currentRevision = currentRevision;
  return error;
}

function positiveRevision(value) {
  const revision = Number(value || 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function safeDate(value) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function safeActor(value) {
  return String(value || "admin").trim().slice(0, 80) || "admin";
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

module.exports = {
  registerAdminDefaultRoutes,
  normalizeAdminDefaults,
  normalizeSystemSettings,
  validateMenuDesignSnapshot,
  validateSystemSettings
};
