"use strict";
// Developer: Uzeyir | System Key: xandar | Backend runtime marker

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { performance } = require("perf_hooks");

const { config, validateConfig } = require("./config");
const { createAuthMiddleware } = require("./middleware/auth");
const { createFileStore } = require("./store/file-store");
const { seedStoreIfEmpty } = require("./store/seed-defaults");
const { normalizeStockState, reconcileRecipeCatalog } = require("./store/migrations");
const { normalizeProductCode } = require("./store/product-code-registry");
const stockService = require("./stock-service");
const { registerStockLocationRoutes } = require("./stock-location-routes");
const { registerWorkforceRoutes } = require("./workforce-routes");
const { hasPersonelSectionAccess, normalizePersonelSectionAccess } = require("./personel-section-access");
const { registerProcurementRoutes, resolveActorFromRequest } = require("./procurement-routes");
const { hasCapability: hasProcurementCapability } = require("./procurement-service");
const { createProcurementDocumentService } = require("./procurement-documents");
const { createProcurementImageProcessor } = require("./procurement-image-processor");
const { registerPublishRoutes } = require("./publish-routes");
const { registerPricingRoutes } = require("./pricing-routes");
const { registerDataImportRoutes } = require("./data-import-routes");
const { registerCatalogCleanupRoutes } = require("./catalog-cleanup-routes");
const { registerAdminDefaultRoutes } = require("./admin-defaults");
const {
  appendSecurityAudit,
  assignUnverifiedAccountEmail,
  normalizeAccountEmail,
  publicAccountSecurity,
  registerAccountSecurityRoutes
} = require("./account-security-routes");
const notificationService = require("./notification-service");
const { registerNotificationRoutes } = require("./notification-routes");
const { createNotificationDeliveryWorker } = require("./notification-delivery");
const { createNotificationScheduler } = require("./notification-scheduler");
const { createMailService } = require("./mail-service");
const { createPushService } = require("./push-service");
const { retiredExcelImportHandler } = require("./retired-excel-import");
const { migratePricingSystem, serializeLegacyMenuState } = require("./pricing");
const { buildPublicBootstrap, buildPublicMenu, buildPublicMudavim, buildPublicSite } = require("./public-bootstrap");
const {
  validateMenuProductCodes,
  validateRecipeProductCodes
} = require("./store/product-code-registry");
const { migrateSiteState } = require("./site-state");
const simpleXlsx = require("./simple-xlsx");
const { validateMenuState, validateRecipeCatalog, validateRecipeState, validateSiteState, validatePassword } = require("./validators");

validateConfig();

const app = express();
const store = createFileStore(config.dataFile, {
  bcryptRounds: config.bcryptRounds,
  defaultPanelPassword: config.defaultPanelPassword,
  defaultRecipePassword: config.defaultRecipePassword,
  externalCheckIntervalMs: config.storeExternalCheckIntervalMs,
  eventLoopResolutionMs: config.eventLoopDelayResolutionMs
});
const auth = createAuthMiddleware(config, store);
const mailService = createMailService(config);
const mudavimMailService = createMailService({
  ...config,
  smtpHost: config.mudavimSmtpHost,
  smtpPort: config.mudavimSmtpPort,
  smtpSecure: config.mudavimSmtpSecure,
  smtpUser: config.mudavimSmtpUser,
  smtpPass: config.mudavimSmtpPass,
  smtpFrom: config.mudavimSmtpFrom
});
const pushService = createPushService(config);
const notificationDeliveryWorker = createNotificationDeliveryWorker({
  store,
  config,
  mailService,
  mudavimMailService,
  pushService,
  logError: logRuntimeError
});
const notificationScheduler = createNotificationScheduler({ store, intervalMs: config.notificationReminderIntervalMs, logError: logRuntimeError });
const procurementImageProcessor = createProcurementImageProcessor();
const procurementDocumentService = createProcurementDocumentService({
  documentsDir: config.procurementDocumentsDir,
  maxUploadBytes: config.procurementMaxUploadBytes,
  imageProcessor: procurementImageProcessor,
  strictImageProcessing: true
});
const sseClients = new Set();
const recipeSseClients = new Set();
const siteSseClients = new Set();
const publicSseClients = new Set();
const feedbackSseClients = new Set();
const stockSseClients = new Set();
const authenticatedEventClients = new Set();
const SSE_RETRY_MS = 5000;
const SSE_HEARTBEAT_MS = 25000;
const SSE_HISTORY_LIMIT = 64;
const sseStreamState = new Map();
let xlsxModule = null;
const RECIPE_ACTIVITY_LIMIT = 5000;

const projectRoot = config.projectRoot;
const siteRoot = path.join(projectRoot, "apps", "website");
const adminRoot = path.join(projectRoot, "apps", "admin");
const recipeRoot = path.join(projectRoot, "apps", "recipe");
const qrMenuRoot = path.join(projectRoot, "apps", "qr-menu");
const mudavimRoot = path.join(siteRoot, "mudavim");
const personelRoot = path.join(projectRoot, "apps", "personel");
const faturaRoot = path.join(projectRoot, "apps", "fatura");
const authRoot = path.join(projectRoot, "apps", "auth");
const assetsRoot = path.join(projectRoot, "public", "assets");
const sharedRoot = path.join(projectRoot, "shared");
const staticOptions = {
  dotfiles: "deny",
  etag: true,
  index: false,
  maxAge: 0,
  setHeaders: setStaticResponseHeaders
};
const cspAllowedOrigins = config.allowedOrigins.filter((origin) => origin && origin !== "*");
const normalJsonParser = express.json({ limit: config.apiJsonLimitBytes, strict: true });
const imageMediaParser = express.raw({ type: () => true, limit: "15mb" });
const videoMediaParser = express.raw({ type: () => true, limit: "120mb" });

app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "connect-src": ["'self'", ...cspAllowedOrigins],
      "font-src": ["'self'", "data:"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'self'", ...cspAllowedOrigins],
      "frame-src": ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
      "img-src": ["'self'", "https:", "data:", "blob:"],
      "media-src": ["'self'", "https:", "data:", "blob:"],
      "object-src": ["'none'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"]
    }
  },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan(config.isProduction ? "combined" : "dev", {
  stream: {
    write(line) {
      process.stdout.write(sanitizeLogLine(line));
    }
  }
}));
app.use((req, res, next) => {
  const startedAt = performance.now();
  const originalWriteHead = res.writeHead;
  res.writeHead = function performanceWriteHead(...args) {
    if (config.performanceServerTiming && !res.headersSent) {
      const snapshotMs = Number(req.storeContext && req.storeContext.timings && req.storeContext.timings.snapshotResolveMs || 0);
      const routeMs = performance.now() - startedAt;
      res.setHeader("Server-Timing", `store;dur=${snapshotMs.toFixed(2)}, route;dur=${routeMs.toFixed(2)}`);
    }
    return originalWriteHead.apply(this, args);
  };
  res.once("finish", () => {
    const elapsedMs = performance.now() - startedAt;
    if (!config.performanceDebug && elapsedMs < config.performanceSlowRequestMs) return;
    const metrics = typeof store.getMetrics === "function" ? store.getMetrics() : {};
    console.warn("Tahmisci yavaş istek", {
      method: req.method,
      path: String(req.path || "").slice(0, 240),
      status: res.statusCode,
      durationMs: Number(elapsedMs.toFixed(2)),
      storeRevision: req.storeRevision || metrics.revision || 0,
      snapshotResolveMs: Number(req.storeContext && req.storeContext.timings && req.storeContext.timings.snapshotResolveMs || 0),
      eventLoopDelayP95Ms: Number(metrics.eventLoopDelayP95Ms || 0)
    });
  });
  next();
});
app.use((req, res, next) => {
  if (/^\/api\/admin\/data-imports\/analyze\/?$/.test(req.path)) return next();
  return normalJsonParser(req, res, next);
});
app.use(express.urlencoded({
  extended: false,
  limit: config.apiUrlEncodedLimitBytes,
  parameterLimit: 200
}));
app.use(cors({
  origin: corsOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", "Authorization", "Idempotency-Key", "X-Request-ID", "X-Manager-Key",
    "X-File-Name", "X-Media-Kind", "X-Document-Type", "X-Supplier-Id", "X-Shipment-Ids",
    "X-Shipment-Item-Ids", "X-Document-Number", "X-Document-Date", "X-Expected-Revision",
    "X-Expected-Inventory-Revision", "X-Expected-Catalog-Revision",
    "X-Tahmisci-Device-Id", "X-Tahmisci-App-Id", "X-Tahmisci-App-Target"
  ],
  credentials: true
}));
app.use((req, res, next) => {
  if (isSensitiveApiRequest(req)) {
    res.set({
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0"
    });
  }
  setDocumentResponseHeaders(req, res);
  const cameraPolicy = String(req.path || "").startsWith("/fatura") ? "camera=(self)" : "camera=()";
  res.set("Permissions-Policy", `${cameraPolicy}, microphone=(), geolocation=(), payment=(), usb=()`);
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    ok: false,
    message: "Cok fazla hatali giris denemesi yapildi. Lutfen 15 dakika sonra tekrar deneyin."
  })
});

const recipeLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    ok: false,
    message: "Cok fazla hatali recete giris denemesi yapildi. Lutfen 15 dakika sonra tekrar deneyin."
  })
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === "test"
});

const passwordResetConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === "test"
});

registerAccountSecurityRoutes({
  app,
  store,
  auth,
  config,
  mailService,
  mudavimMailService,
  bcrypt,
  validatePassword,
  requireRequestOrigin: requireAdminOrMainRequestOrigin,
  requestLimiter: passwordResetRequestLimiter,
  confirmLimiter: passwordResetConfirmLimiter
});

const importOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === "test",
  handler: (_req, res) => res.status(429).json({
    ok: false,
    message: "Çok fazla Excel aktarım işlemi yapıldı. Lütfen daha sonra tekrar deneyin."
  })
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === "test",
  handler: (_req, res) => res.status(429).json({
    ok: false,
    message: "Çok fazla dosya yükleme isteği yapıldı. Lütfen daha sonra tekrar deneyin."
  })
});

registerPublishRoutes({
  app,
  store,
  auth,
  requireAdminRequestOrigin,
  onPublished(nextStore, result) {
    const scopes = new Set(result.changedScopes || []);
    if (scopes.has("menu")) broadcastMenuUpdate(
      serializeLegacyMenuState(nextStore.menuState, nextStore.pricing),
      result.updatedAt,
      nextStore.pricing,
      nextStore.revisions && nextStore.revisions.pricing,
      nextStore.revisions && nextStore.revisions.catalog
    );
    if (scopes.has("recipes")) broadcastRecipeUpdate(nextStore.recipeState, result.updatedAt, nextStore.recipeCatalog, nextStore.revisions && nextStore.revisions.catalog);
    if (scopes.has("site")) broadcastSiteUpdate(nextStore.siteState, result.updatedAt, nextStore.revisions && nextStore.revisions.site);
    if (scopes.has("menu") || scopes.has("recipes") || scopes.has("site")) broadcastPublicUpdate(nextStore, "publish");
  }
});

registerAdminDefaultRoutes({
  app,
  store,
  auth,
  requireAdminRequestOrigin
});

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

// Public site and menu bootstrap share the same published read model.
app.get("/api/public/bootstrap", async (req, res, next) => {
  try {
    const data = await store.read();
    const bootstrap = buildPublicBootstrap(data);
    const payload = { ok: true, ...bootstrap };
    const entityTag = catalogEntityTag("public-menu", payload);
    res.set({
      "Cache-Control": "public, max-age=0, must-revalidate",
      "ETag": entityTag,
      "Vary": "Accept-Language"
    });
    if (requestEntityTagMatches(req, entityTag)) return res.status(304).end();
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

registerPublicProjection("/api/public/site", "public-site", buildPublicSite);
registerPublicProjection("/api/public/menu", "public-menu", buildPublicMenu);
registerPublicProjection("/api/public/mudavim", "public-mudavim", buildPublicMudavim);

function registerPublicProjection(route, entityName, projector) {
  app.get(route, async (req, res, next) => {
    try {
      const data = await store.read();
      const payload = { ok: true, ...projector(data) };
      const entityTag = catalogEntityTag(entityName, payload);
      res.set({
        "Cache-Control": "public, max-age=0, must-revalidate",
        "ETag": entityTag,
        "Vary": "Accept-Language"
      });
      if (requestEntityTagMatches(req, entityTag)) return res.status(304).end();
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  });
}

app.get("/api/public/preview-config", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    schemaVersion: 1,
    allowedOrigins: previewAllowedOrigins(req)
  });
});

app.post("/api/public/preview-session", async (req, res, next) => {
  try {
    const token = String(req.body && req.body.previewToken || "").trim();
    const info = auth.previewTokenInfo(token);
    if (!info.mode || !info.sessionId) {
      return res.status(401).json({ ok: false, message: "Önizleme oturumu geçersiz veya süresi dolmuş." });
    }
    const data = await store.read();
    const activeAdminSession = (Array.isArray(data.authSessions) ? data.authSessions : []).some((session) => (
      session && session.id === info.sessionId && session.role === "admin" && !session.revokedAt
    ));
    if (!activeAdminSession) {
      return res.status(401).json({ ok: false, message: "Önizleme oturumu sona ermiş." });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, schemaVersion: 1, mode: info.mode, expiresAt: info.expiresAt });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/public/events", async (req, res, next) => {
  try {
    const data = await store.read();
    openRevisionStream(req, res, publicSseClients, "public", data);
  } catch (error) {
    next(error);
  }
});

app.get("/api/events", requireAdminOrMainRequestOrigin, requireAuthenticatedEventSession, async (req, res, next) => {
  try {
    openAuthenticatedEventStream(req, res);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/login", requireAdminOrMainRequestOrigin, loginLimiter, async (req, res, next) => {
  try {
    const password = String(req.body && req.body.password || "");
    if (!password || password.length > 72) {
      return res.status(401).json({ ok: false, message: "Panel sifresi hatali." });
    }

    const data = await store.read();
    const passwordHash = data && data.admin && data.admin.passwordHash;
    const valid = Boolean(passwordHash) && await bcrypt.compare(password, passwordHash);

    if (!valid) {
      return res.status(401).json({ ok: false, message: "Panel sifresi hatali." });
    }

    const session = await auth.createAdminSession();
    const token = session.token;
    auth.attachAdminCookie(res, token);
    res.json({
      ok: true,
      token,
      tokenType: "Bearer",
      expiresIn: null,
      ...auth.sessionInfoFromPayload(session.payload)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/logout", requireAdminRequestOrigin, async (req, res, next) => {
  try {
    await auth.revokeRequestSession(req, ["admin"]);
    auth.clearAdminCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/logout", requireAdminOrMainRequestOrigin, async (req, res, next) => {
  try {
    await auth.revokeRequestSession(req, ["personel"]);
    auth.clearRecipeCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/session/refresh", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const session = await auth.createAdminSession();
    await auth.revokeRequestSession(req, ["admin"]);
    auth.attachAdminCookie(res, session.token);
    res.json({
      ok: true,
      role: "admin",
      token: session.token,
      tokenType: "Bearer",
      expiresIn: null,
      ...auth.sessionInfoFromPayload(session.payload)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/me", requireAdminOrMainRequestOrigin, auth.requireAdmin, (req, res) => {
  if (req.authToken) auth.attachAdminCookie(res, req.authToken);
  res.json({
    ok: true,
    role: "admin",
    ...auth.sessionInfoFromPayload(req.admin)
  });
});

app.get("/api/admin/mudavim/members", requireAdminRequestOrigin, auth.requireAdmin, (req, res) => {
  const data = req.storeSnapshot;
  if (!data) return res.status(503).json({ ok: false, message: "Müdavim hesapları hazırlanamadı." });
  const members = (Array.isArray(data.mudavimAccounts) ? data.mudavimAccounts : [])
    .filter((account) => account && account.id)
    .map((account) => ({
      id: String(account.id),
      fullName: String(account.fullName || ""),
      alias: String(account.alias || ""),
      email: String(account.emailNormalized || account.email || ""),
      emailVerifiedAt: account.emailVerifiedAt || null,
      status: String(account.status || "pending_email_verification"),
      campaignConsent: account.campaignConsent === true,
      birthDate: String(account.birthDate || ""),
      createdAt: account.createdAt || null,
      updatedAt: account.updatedAt || null
    }))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  res.set("Cache-Control", "private, no-cache, must-revalidate");
  return res.json({ ok: true, total: members.length, members });
});

app.get("/api/admin/summary", requireAdminRequestOrigin, auth.requireAdmin, (req, res) => {
  const data = req.storeSnapshot;
  if (!data) return res.status(503).json({ ok: false, message: "Yönetici özeti hazırlanamadı." });
  const menuState = data.menuState && typeof data.menuState === "object" ? data.menuState : {};
  const categories = Array.isArray(menuState.categories) ? menuState.categories : [];
  const products = categories.flatMap((category) => (Array.isArray(category && category.products) ? category.products : [])
    .map((product) => ({ category, product })));
  const recipeState = data.recipeState && typeof data.recipeState === "object" ? data.recipeState : {};
  const recipeProducts = Object.values(recipeState).reduce((total, category) => (
    total + (category && typeof category === "object" ? Object.keys(category).length : 0)
  ), 0);
  const stockState = normalizeStockState(data.stockState);
  const stockProducts = Array.isArray(stockState.products) ? stockState.products : [];
  const criticalStock = stockProducts.filter((product) => {
    const quantity = Number(product && (product.stockQuantity ?? product.currentStock ?? product.amount) || 0);
    const threshold = Number(product && (product.criticalThreshold ?? product.orderThreshold) || 0);
    return product && product.active !== false && threshold > 0 && quantity <= threshold;
  }).length;
  const pendingShipments = (Array.isArray(data.workforceShipments) ? data.workforceShipments : [])
    .filter((shipment) => shipment && shipment.status === "onay_bekliyor").length;
  const unreadNotifications = (Array.isArray(data.notifications) ? data.notifications : [])
    .filter((notification) => notification && notification.recipientRole === "manager"
      && notification.inAppVisible !== false && !notification.readAt && !notification.archivedAt).length;
  const revision = resolveScopeRevision(data, "menu");
  res.set({
    "Cache-Control": "private, no-cache, must-revalidate",
    "X-Summary-Revision": String(revision)
  });
  res.json({
    ok: true,
    revision,
    summary: {
      totalCategories: categories.length,
      totalProducts: products.length,
      activeProducts: products.filter(({ category, product }) => category.active !== false && product.active !== false && product.stock !== "sold-out").length,
      hiddenProducts: products.filter(({ category, product }) => category.active === false || product.active === false || product.stock === "sold-out").length,
      popularProducts: products.filter(({ product }) => product && product.popular === true).length,
      recipeProducts,
      stockProducts: stockProducts.length,
      criticalStock,
      pendingShipments,
      unreadNotifications,
      mudavimMembers: (Array.isArray(data.mudavimAccounts) ? data.mudavimAccounts : []).length,
      categoryDistribution: categories.map((category) => ({
        id: String(category && category.id || ""),
        name: String(category && category.name || "Kategori"),
        productCount: Array.isArray(category && category.products) ? category.products.length : 0
      })),
      updatedAt: data.menuUpdatedAt || data.updatedAt || null
    }
  });
});

app.post("/api/admin/preview-token", requireAdminRequestOrigin, auth.requireAdmin, (req, res) => {
  try {
    const mode = String(req.body && req.body.mode || "").trim().toLowerCase();
    const token = auth.signPreviewToken(mode, req.admin && req.admin.sessionId);
    const info = auth.previewTokenInfo(token);
    return res.json({
      ok: true,
      token,
      previewToken: token,
      mode: info.mode,
      expiresAt: info.expiresAt,
      allowedOrigins: previewAllowedOrigins(req),
      publicOrigin: configuredPublicOrigin(req)
    });
  } catch (_error) {
    return res.status(400).json({ ok: false, message: "Gecersiz onizleme modu." });
  }
});

app.post("/api/recipe/login", requireAdminOrMainRequestOrigin, recipeLoginLimiter, async (req, res, next) => {
  try {
    const username = normalizeRecipeUsername(req.body && req.body.username);
    const password = String(req.body && req.body.password || "");
    if (!password || password.length > 72) {
      return res.status(401).json({ ok: false, message: "Recete sifresi hatali." });
    }

    const data = await store.read();
    const users = Array.isArray(data.recipeUsers) ? data.recipeUsers : [];

    if (users.length) {
      if (!username) {
        return res.status(401).json({ ok: false, message: "Kullanici adi ve sifre gerekli." });
      }

      const user = users.find((item) => item.username === username);
      const validUser = Boolean(user && user.active !== false && user.passwordHash)
        && await bcrypt.compare(password, user.passwordHash);

      if (!validUser) {
        await recordRecipeActivity({
          type: "login_failed",
          username,
          req
        });
        return res.status(401).json({ ok: false, message: "Kullanici adi veya sifre hatali." });
      }

      const now = new Date().toISOString();
      await store.update((nextData) => {
        const storedUser = (nextData.recipeUsers || []).find((item) => item.id === user.id);
        if (storedUser) {
          storedUser.lastLoginAt = now;
          storedUser.updatedAt = storedUser.updatedAt || now;
        }
        appendRecipeActivity(nextData, makeRecipeActivity({
          type: "login",
          user: storedUser || user,
          req,
          createdAt: now
        }));
        return nextData;
      });

      const session = await auth.createRecipeSession(user);
      const token = session.token;
      auth.attachRecipeCookie(res, token);
      return res.json({
        ok: true,
        token,
        tokenType: "Bearer",
        expiresIn: null,
        ...auth.sessionInfoFromPayload(session.payload),
        user: publicRecipeUser(user)
      });
    }

    const passwordHash = data && data.admin && data.admin.recipePasswordHash;
    const valid = Boolean(passwordHash) && await bcrypt.compare(password, passwordHash);

    if (!valid) {
      return res.status(401).json({ ok: false, message: "Recete sifresi hatali." });
    }

    const session = await auth.createRecipeSession(null);
    const token = session.token;
    auth.attachRecipeCookie(res, token);
    res.json({
      ok: true,
      token,
      tokenType: "Bearer",
      expiresIn: null,
      ...auth.sessionInfoFromPayload(session.payload),
      user: null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipe/me", requireAdminOrMainRequestOrigin, auth.requirePersonelOrPreview, (req, res) => {
  const payload = req.recipe || {};
  const user = req.recipeUser || {};
  const hasNamedRecipeUser = Boolean(req.recipeUser && req.recipeUser.id);
  if (req.authToken) auth.attachRecipeCookie(res, req.authToken);
  res.json({
    ok: true,
    role: payload.role || "recipe",
    userId: hasNamedRecipeUser ? String(req.recipeUser.id) : null,
    ...auth.sessionInfoFromPayload(payload),
    user: hasNamedRecipeUser ? publicRecipeUser(user) : null
  });
});

app.put("/api/recipe/profile", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
  try {
    if (!req.recipeUser) {
      return res.status(400).json({ ok: false, message: "Profil icin personel kullanici oturumu gerekli." });
    }

    const userId = String(req.recipeUser.id || "").trim();
    const name = String(req.body && req.body.name || "").trim().slice(0, 80);
    const avatarUrl = String(req.body && req.body.avatarUrl || "").trim().slice(0, 500);
    const bio = String(req.body && req.body.bio || "").trim().slice(0, 240);
    const now = new Date().toISOString();
    let updatedUser = null;

    const nextStore = await store.update((data) => {
      const user = (data.recipeUsers || []).find((item) => item.id === userId);
      if (!user) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      user.name = name || user.name || user.username;
      user.avatarUrl = avatarUrl;
      user.bio = bio;
      user.updatedAt = now;
      updatedUser = user;
      syncRecipeUserReferences(data, user);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_profile_updated",
        user,
        req,
        createdAt: now
      }));
      return data;
    });

    res.json({
      ok: true,
      user: publicRecipeUser(updatedUser),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/profile/avatar", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, uploadLimiter, express.raw({
  type: () => true,
  limit: "10mb"
}), async (req, res, next) => {
  try {
    if (!req.recipeUser) {
      return res.status(400).json({ ok: false, message: "Profil fotoğrafı için personel kullanıcı oturumu gerekli." });
    }

    const file = validateProfileAvatarUpload(req);
    const avatarPath = `/media/${file.fileName}`;
    const now = new Date().toISOString();
    let oldAvatarPath = "";
    let updatedUser = null;

    await fs.mkdir(config.mediaDir, { recursive: true });
    await fs.writeFile(path.join(config.mediaDir, file.fileName), req.body);

    await store.update((data) => {
      const user = (data.recipeUsers || []).find((item) => item.id === req.recipeUser.id);
      if (!user) {
        const error = new Error("Personel kullanıcısı bulunamadı.");
        error.status = 404;
        throw error;
      }
      oldAvatarPath = String(user.avatarUrl || "");
      user.avatarUrl = avatarPath;
      user.updatedAt = now;
      updatedUser = user;
      syncRecipeUserReferences(data, user);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_avatar_updated",
        user,
        req,
        createdAt: now
      }));
      return data;
    });

    await removeOldProfileAvatar(oldAvatarPath, avatarPath);
    res.status(201).json({
      ok: true,
      avatarUrl: avatarPath,
      avatar: {
        src: avatarPath,
        url: absoluteUrl(req, avatarPath),
        type: file.contentType,
        size: req.body.length
      },
      user: publicRecipeUser(updatedUser)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/session/refresh", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
  const payload = req.recipe || {};
  try {
    const user = req.recipeUser;
    const session = await auth.createRecipeSession(user);
    await auth.revokeRequestSession(req, ["personel"]);
    auth.attachRecipeCookie(res, session.token);
    return res.json({
      ok: true,
      role: "recipe",
      token: session.token,
      tokenType: "Bearer",
      expiresIn: null,
      ...auth.sessionInfoFromPayload(session.payload),
      user: publicRecipeUser(user)
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/recipe-access", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const data = req.storeSnapshot;
    res.json({
      ok: true,
      revision: Math.max(0, Number(data.revisions && data.revisions.workforce || 0)),
      users: (data.recipeUsers || []).map(publicRecipeUser),
      activity: publicRecipeActivity(data.recipeActivity || []),
      assignments: publicRecipeAssignments(data.recipeAssignments || [], true)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/recipe-users/:id/section-access", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const access = normalizePersonelSectionAccess(req.body && req.body.personelSectionAccess);
    const now = new Date().toISOString();
    let updatedUser = null;
    let revision = 0;
    const nextStore = await store.update((data) => {
      updatedUser = (data.recipeUsers || []).find((item) => String(item.id || "") === id) || null;
      if (!updatedUser) throw Object.assign(new Error("Personel bulunamadı."), { status: 404 });
      updatedUser.personelSectionAccess = access;
      updatedUser.updatedAt = now;
      appendRecipeActivity(data, makeRecipeActivity({ type: "personel_section_access_updated", user: updatedUser, req, createdAt: now }));
      revision = touchWorkforceRevision(data);
      return data;
    });
    publishAuthenticatedEvent({
      topic: "workforce",
      type: "personel.section-access.updated",
      entityType: "personel",
      entityId: id,
      revision,
      actorId: "admin",
      targets: ["personel", "yonetici"]
    });
    res.json({
      ok: true,
      revision,
      user: publicRecipeUser(updatedUser),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/recipe-users", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const requestId = workforceLifecycleRequestId(req);
    const name = String(req.body && req.body.name || "").trim().slice(0, 80);
    const username = normalizeRecipeUsername(req.body && req.body.username);
    const password = String(req.body && req.body.password || "");
    const rawEmail = String(req.body && req.body.email || "").trim();
    const email = normalizeAccountEmail(rawEmail);

    const userError = validateRecipeUserInput({ name, username, password, requirePassword: true });
    if (userError) return res.status(400).json({ ok: false, message: userError });
    if (rawEmail && (rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({ ok: false, message: "Geçerli bir e-posta adresi girin." });
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const now = new Date().toISOString();
    const user = {
      id: `barista-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`,
      name: name || username,
      username,
      passwordHash,
      active: true,
      email: "",
      emailNormalized: "",
      pendingEmail: "",
      emailVerifiedAt: null,
      emailVerificationRequired: true,
      emailVerificationVersion: 0,
      lastPasswordResetAt: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      personelSectionAccess: normalizePersonelSectionAccess(req.body && req.body.personelSectionAccess)
    };
    let response = null;
    let replayed = false;

    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_create", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      if ((data.recipeUsers || []).some((item) => item.username === username)) {
        const error = new Error("Bu kullanici adi zaten kayitli.");
        error.status = 409;
        throw error;
      }
      if (email) {
        assignUnverifiedAccountEmail(data, "personel", user, email, now);
        appendSecurityAudit(data, req, {
          action: "personnel_email_assigned",
          scope: "personel",
          accountId: user.id,
          result: "pending_verification",
          createdAt: now
        }, config);
      }
      data.recipeUsers = (data.recipeUsers || []).concat(user);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_created",
        user,
        req,
        createdAt: now
      }));
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        user: publicRecipeUser(user),
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_create", requestId, response, now);
      return data;
    });

    res.status(replayed ? 200 : 201).json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      user: publicRecipeUser(user),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/recipe-users/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestId = workforceLifecycleRequestId(req);
    const name = String(req.body && req.body.name || "").trim().slice(0, 80);
    const username = normalizeRecipeUsername(req.body && req.body.username);
    const password = String(req.body && req.body.password || "");
    const active = req.body && req.body.active !== false;
    const emailSupplied = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "email"));
    const rawEmail = emailSupplied ? String(req.body.email || "").trim() : "";
    const email = normalizeAccountEmail(rawEmail);
    const sectionAccessSupplied = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "personelSectionAccess"));

    const userError = validateRecipeUserInput({ name, username, password, requirePassword: false });
    if (userError) return res.status(400).json({ ok: false, message: userError });
    if (rawEmail && (rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({ ok: false, message: "Geçerli bir e-posta adresi girin." });
    }

    const passwordHash = password ? await bcrypt.hash(password, config.bcryptRounds) : "";
    const now = new Date().toISOString();
    let updatedUser = null;
    let response = null;
    let replayed = false;

    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_update", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      const users = data.recipeUsers || [];
      const user = users.find((item) => item.id === id);
      if (!user) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      if (users.some((item) => item.id !== id && item.username === username)) {
        const error = new Error("Bu kullanici adi zaten kayitli.");
        error.status = 409;
        throw error;
      }

      const wasActive = user.active !== false;
      user.name = name || username;
      user.username = username;
      user.active = active;
      user.updatedAt = now;
      if (sectionAccessSupplied) user.personelSectionAccess = normalizePersonelSectionAccess(req.body.personelSectionAccess);
      if (emailSupplied) {
        const security = assignUnverifiedAccountEmail(data, "personel", user, email, now);
        appendSecurityAudit(data, req, {
          action: email ? "personnel_email_assigned" : "personnel_email_cleared",
          scope: "personel",
          accountId: user.id,
          result: email ? (security.emailVerifiedAt && !security.pendingEmail ? "verified_unchanged" : "pending_verification") : "cleared",
          createdAt: now
        }, config);
      }
      if (passwordHash) user.passwordHash = passwordHash;
      if (passwordHash || active === false) {
        revokeStoredSessions(data, (session) => session.role === "personel" && session.userId === id, now);
      }
      if (active === false) suspendPersonnelNotificationDelivery(data, id, now);
      syncRecipeUserReferences(data, user);
      if (wasActive !== active) {
        appendRecipeActivity(data, makeRecipeActivity({
          type: active ? "recipe_user_reactivated" : "recipe_user_deactivated",
          user,
          req,
          createdAt: now
        }));
      }
      updatedUser = user;
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        user: publicRecipeUser(updatedUser),
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_update", requestId, response, now);
      return data;
    });

    if (!replayed && updatedUser && updatedUser.active === false) {
      closeRecipeClientsForUser(updatedUser.id);
    }

    res.json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      user: publicRecipeUser(updatedUser),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/recipe-users/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestId = workforceLifecycleRequestId(req);
    const now = new Date().toISOString();
    let response = null;
    let replayed = false;
    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_deactivate", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      const user = (data.recipeUsers || []).find((item) => item.id === id);
      if (!user) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      const wasActive = user.active !== false;
      user.active = false;
      user.updatedAt = now;
      revokeStoredSessions(data, (session) => session.role === "personel" && session.userId === id, now);
      suspendPersonnelNotificationDelivery(data, id, now);
      if (wasActive) {
        appendRecipeActivity(data, makeRecipeActivity({
          type: "recipe_user_deactivated",
          user,
          req,
          createdAt: now
        }));
      }
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        user: publicRecipeUser(user),
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_deactivate", requestId, response, now);
      return data;
    });

    if (!replayed) closeRecipeClientsForUser(id);

    res.json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/recipe-users/:id/permanent", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestId = workforceLifecycleRequestId(req);
    const now = new Date().toISOString();
    let removedUser = null;
    let response = null;
    let replayed = false;
    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_permanent_delete", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      const users = data.recipeUsers || [];
      removedUser = users.find((item) => item.id === id) || null;
      if (!removedUser) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      data.recipeUsers = users.filter((item) => item.id !== id);
      revokeStoredSessions(data, (session) => session.role === "personel" && session.userId === id, now);
      suspendPersonnelNotificationDelivery(data, id, now);
      preserveDeletedPersonnelReferences(data, removedUser, now);
      data.deletedRecipeUsers = (Array.isArray(data.deletedRecipeUsers) ? data.deletedRecipeUsers : [])
        .filter((item) => String(item.id || item.userId || "") !== id)
        .concat({
          id,
          userId: id,
          name: removedUser.name || removedUser.username || "Silinmiş personel",
          username: removedUser.username || "",
          deletedAt: now,
          deletedBy: "admin",
          usernameReusable: true
        })
        .slice(-1000);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_permanently_deleted",
        user: removedUser,
        req,
        createdAt: now
      }));
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        deletedUser: {
          id,
          name: removedUser.name || removedUser.username || "Silinmiş personel",
          username: removedUser.username || "",
          usernameReusable: true
        },
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_permanent_delete", requestId, response, now);
      return data;
    });

    if (!replayed) closeRecipeClientsForUser(id);

    res.json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/recipe-assignments", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.body && req.body.userId || "").trim();
    const category = String(req.body && req.body.category || "").trim();
    const product = String(req.body && req.body.product || "").trim();
    const size = String(req.body && req.body.size || "").trim();
    const assignmentKind = normalizeAssignmentKind(req.body && (req.body.assignmentKind || req.body.assignmentType));
    const assignmentType = normalizeAssignmentType(req.body && req.body.assignmentType);
    const scopeType = normalizeScopeType(req.body && req.body.scopeType);
    const questionCount = normalizeQuestionCount(req.body && req.body.questionCount, assignmentKind === "quick_quiz" ? 3 : 8);
    const difficulty = normalizeDifficulty(req.body && req.body.difficulty);
    const passingScore = normalizePassingScore(req.body && req.body.passingScore);
    const adminNote = String(req.body && req.body.adminNote || "").trim().slice(0, 1000);
    const now = new Date().toISOString();
    let assignment = null;

    const nextStore = await store.update((data) => {
      const user = (data.recipeUsers || []).find((item) => item.id === userId);
      if (!user || user.active === false) {
        const error = new Error("Aktif barista kullanicisi secin.");
        error.status = 400;
        throw error;
      }

      const targets = resolveAssignmentTargets(data, {
        userId,
        scopeType,
        category,
        product,
        size,
        selectedProducts: req.body && req.body.selectedProducts
      });
      if (!targets.length) {
        const error = new Error("Gecerli recete, urun ve olcu secin.");
        error.status = 400;
        throw error;
      }
      const primary = targets[0];
      const title = assignmentTitleFor({ assignmentKind, scopeType, category, product: primary.product, size: primary.size, count: targets.length });
      const needsQuestions = ["quick_quiz", "exam", "retraining"].includes(assignmentKind);
      const questions = needsQuestions
        ? buildRecipeAssignmentQuestions(data.recipeState, {
          targets,
          questionCount,
          difficulty
        })
        : [];
      if (needsQuestions && !questions.length) {
        const error = new Error("Bu kapsam icin yeterli soru uretilemedi.");
        error.status = 400;
        throw error;
      }

      assignment = {
        id: `odev-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`,
        userId: user.id,
        username: user.username,
        name: user.name,
        title,
        category: primary.category,
        product: primary.product,
        size: primary.size,
        assignmentKind,
        assignmentType,
        scopeType,
        recipeItems: targets.map(publicRecipeItem),
        questionCount,
        difficulty,
        passingScore,
        trainingContent: buildAssignmentTrainingContent(data.recipeState, targets, { adminNote }),
        adminNote,
        questions,
        status: "pending",
        score: 0,
        total: questions.length,
        answers: [],
        viewedItems: [],
        completedItems: [],
        failedItems: [],
        percent: 0,
        passed: null,
        startedAt: null,
        completedAt: null,
        reviewedAt: null,
        retryCount: 0,
        createdAt: now,
        updatedAt: now
      };
      data.recipeAssignments = (data.recipeAssignments || []).concat(assignment);
      appendRecipeActivity(data, makeRecipeActivity({
        type: assignmentAssignedEvent(assignmentKind),
        user,
        category: assignment.category,
        product: assignment.product,
        size: assignment.size,
        assignment,
        status: assignment.status,
        req,
        createdAt: now
      }));
      return data;
    });

    res.status(201).json({
      ok: true,
      assignment: publicRecipeAssignment(assignment, true),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/recipe-assignments/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const nextStore = await store.update((data) => {
      data.recipeAssignments = (data.recipeAssignments || []).filter((item) => item.id !== id);
      return data;
    });

    res.json({
      ok: true,
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipe/assignments", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.json({ ok: true, assignments: [] });
    }

    const data = req.storeSnapshot;
    const assignments = (data.recipeAssignments || [])
      .filter((item) => item.userId === payload.userId);
    res.json({
      ok: true,
      assignments: publicRecipeAssignments(assignments, false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/assignments/:id/start", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.status(403).json({ ok: false, message: "Barista oturumu gerekli." });
    }

    const id = String(req.params.id || "").trim();
    const now = new Date().toISOString();
    let updatedAssignment = null;

    const nextStore = await store.update((data) => {
      const assignment = (data.recipeAssignments || []).find((item) => item.id === id && item.userId === payload.userId);
      if (!assignment) {
        const error = new Error("Odev bulunamadi.");
        error.status = 404;
        throw error;
      }

      if (assignment.status !== "completed") {
        assignment.status = "in_progress";
        assignment.startedAt = assignment.startedAt || now;
        assignment.updatedAt = now;
      }
      updatedAssignment = assignment;

      appendRecipeActivity(data, makeRecipeActivity({
        type: assignmentStartedEvent(assignment.assignmentKind || assignment.assignmentType),
        user: {
          id: payload.userId,
          username: payload.username,
          name: payload.name
        },
        assignment,
        status: assignment.status,
        category: assignment.category,
        product: assignment.product,
        size: assignment.size,
        req,
        createdAt: now
      }));
      return data;
    });

    res.json({
      ok: true,
      assignment: publicRecipeAssignment(updatedAssignment, false),
      assignments: publicRecipeAssignments((nextStore.recipeAssignments || []).filter((item) => item.userId === payload.userId), false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/assignments/:id/submit", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.status(403).json({ ok: false, message: "Barista oturumu gerekli." });
    }

    const id = String(req.params.id || "").trim();
    const answers = Array.isArray(req.body && req.body.answers)
      ? req.body.answers.map((answer) => Number(answer))
      : [];
    const now = new Date().toISOString();
    let updatedAssignment = null;

    const nextStore = await store.update((data) => {
      const assignment = (data.recipeAssignments || []).find((item) => item.id === id && item.userId === payload.userId);
      if (!assignment) {
        const error = new Error("Odev bulunamadi.");
        error.status = 404;
        throw error;
      }
      if (assignment.status === "completed") {
        const error = new Error("Bu odev zaten tamamlandi.");
        error.status = 400;
        throw error;
      }

      const kind = normalizeAssignmentKind(assignment.assignmentKind || assignment.assignmentType);
      const itemKeys = (assignment.recipeItems || []).map((item) => item.key).filter(Boolean);
      if (kind === "training") {
        assignment.status = "completed";
        assignment.viewedItems = itemKeys;
        assignment.completedItems = itemKeys;
        assignment.percent = 100;
        assignment.passed = true;
        assignment.completedAt = now;
        assignment.updatedAt = now;
        updatedAssignment = assignment;

        appendRecipeActivity(data, makeRecipeActivity({
          type: "training_completed",
          user: {
            id: payload.userId,
            username: payload.username,
            name: payload.name
          },
          assignment,
          status: assignment.status,
          category: assignment.category,
          product: assignment.product,
          size: assignment.size,
          req,
          createdAt: now
        }));
        return data;
      }

      if (kind === "homework") {
        const requestedCompleted = Array.isArray(req.body && req.body.completedItems)
          ? req.body.completedItems.map((item) => String(item || "").trim()).filter(Boolean)
          : itemKeys;
        const allowed = new Set(itemKeys);
        const completedItems = [...new Set(requestedCompleted.filter((item) => allowed.has(item)))];
        assignment.viewedItems = [...new Set((assignment.viewedItems || []).concat(completedItems))];
        assignment.completedItems = completedItems;
        assignment.percent = itemKeys.length ? Math.round((completedItems.length / itemKeys.length) * 100) : 100;
        assignment.status = assignment.percent >= 100 ? "completed" : "in_progress";
        assignment.completedAt = assignment.status === "completed" ? now : null;
        assignment.updatedAt = now;
        updatedAssignment = assignment;

        appendRecipeActivity(data, makeRecipeActivity({
          type: assignment.status === "completed" ? "homework_completed" : "homework_started",
          user: {
            id: payload.userId,
            username: payload.username,
            name: payload.name
          },
          assignment,
          status: assignment.status,
          category: assignment.category,
          product: assignment.product,
          size: assignment.size,
          req,
          createdAt: now
        }));
        return data;
      }

      const normalizedAnswers = assignment.questions.map((_question, index) => {
        const answer = Number(answers[index]);
        return Number.isInteger(answer) ? answer : -1;
      });
      const score = assignment.questions.reduce((total, question, index) => (
        total + (question.correctIndex === normalizedAnswers[index] ? 1 : 0)
      ), 0);
      const total = assignment.questions.length;
      const passingScore = normalizePassingScore(assignment.passingScore);
      const scorePercent = total ? Math.round((score / total) * 100) : 0;
      const passed = scorePercent >= passingScore;
      const failedItems = assignment.questions
        .map((question, index) => question.correctIndex === normalizedAnswers[index] ? null : failedItemFromQuestion(question, normalizedAnswers[index]))
        .filter(Boolean);

      assignment.status = passed ? "completed" : "retry_required";
      assignment.score = score;
      assignment.total = total;
      assignment.passingScore = passingScore;
      assignment.answers = normalizedAnswers;
      assignment.percent = scorePercent;
      assignment.passed = passed;
      assignment.failedItems = failedItems;
      assignment.completedAt = now;
      assignment.updatedAt = now;
      assignment.retryCount = passed ? (assignment.retryCount || 0) : (Number(assignment.retryCount || 0) + 1);
      updatedAssignment = assignment;

      appendRecipeActivity(data, makeRecipeActivity({
        type: assignmentCompletedEvent(kind, passed),
        user: {
          id: payload.userId,
          username: payload.username,
          name: payload.name
        },
        assignment,
        status: assignment.status,
        score,
        total,
        category: assignment.category,
        product: assignment.product,
        size: assignment.size,
        req,
        createdAt: now
      }));
      return data;
    });

    res.json({
      ok: true,
      assignment: publicRecipeAssignment(updatedAssignment, false),
      assignments: publicRecipeAssignments((nextStore.recipeAssignments || []).filter((item) => item.userId === payload.userId), false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/activity", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.json({ ok: true });
    }

    await recordRecipeActivity({
      type: String(req.body && req.body.type || "view_recipe").trim().slice(0, 60),
      user: {
        id: payload.userId,
        username: payload.username,
        name: payload.name
      },
      category: req.body && req.body.category,
      product: req.body && req.body.product,
      size: req.body && req.body.size,
      panel: req.body && req.body.panel,
      req
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/password", requireAdminRequestOrigin, passwordLimiter, async (req, res, next) => {
  try {
    if (!config.managerKey) {
      return res.status(503).json({
        ok: false,
        message: "PASSWORD_MANAGER_KEY server ortaminda tanimli degil."
      });
    }

    const providedKey = String(req.header("X-Manager-Key") || req.body.managerKey || "");
    if (!safeEqual(providedKey, config.managerKey)) {
      return res.status(401).json({ ok: false, message: "Yetkili anahtar hatali." });
    }

    const newPassword = String(req.body && req.body.newPassword || "");
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ ok: false, message: passwordError });
    }

    const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await store.update((data) => {
      data.admin.passwordHash = passwordHash;
      data.admin.updatedAt = new Date().toISOString();
      revokeStoredSessions(data, (session) => session.role === "admin", data.admin.updatedAt);
      return data;
    });

    res.json({ ok: true, message: "Panel sifresi guncellendi." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/menu", async (req, res, next) => {
  try {
    const data = await store.read();
    const payload = buildMenuApiPayload(data);
    const entityTag = catalogEntityTag("menu", payload);
    res.set({
      "Cache-Control": "no-cache, must-revalidate",
      "ETag": entityTag,
      "X-Menu-Revision": String(payload.streamRevision),
      "X-Publish-Revision": String(payload.publishRevision)
    });
    if (requestEntityTagMatches(req, entityTag)) return res.status(304).end();
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.put("/api/menu", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const menuState = req.body && req.body.menuState;
    const pricingInput = req.body && req.body.pricing || menuState && menuState.pricing;
    const incomingMenuState = pricingInput && menuState ? { ...menuState, pricing: pricingInput } : menuState;
    const hasExpectedRevision = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "expectedRevision"));
    const expectedRevision = hasExpectedRevision ? Number(req.body.expectedRevision) : null;
    if (hasExpectedRevision && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      return res.status(400).json({ ok: false, message: "Geçerli expectedRevision gerekli." });
    }
    const validationError = validateMenuState(incomingMenuState);
    const productCodeError = validateMenuProductCodes(incomingMenuState);

    if (validationError || productCodeError) {
      return res.status(400).json({ ok: false, message: validationError || productCodeError });
    }

    const updatedAt = new Date().toISOString();
    const nextStore = await store.update((data) => {
      const currentPublishRevision = Math.max(0, Number(data.revisions && data.revisions.publish || 0));
      if (hasExpectedRevision && expectedRevision !== currentPublishRevision) {
        const conflict = new Error("Menü verisi başka bir işlem tarafından güncellendi. Güncel veriyi yükleyip tekrar deneyin.");
        conflict.status = 409;
        conflict.code = "REVISION_CONFLICT";
        conflict.currentRevision = currentPublishRevision;
        throw conflict;
      }
      const beforePricing = menuPricingFingerprint(data.menuState, data.pricing);
      const migrated = migratePricingSystem(pricingInput || data.pricing, incomingMenuState);
      markManualMenuStatusChanges(data.menuState, migrated.menuState);
      data.menuState = migrated.menuState;
      data.pricing = migrated.pricing;
      if (beforePricing !== menuPricingFingerprint(data.menuState, data.pricing)) {
        data.revisions.pricing = Number(data.revisions.pricing || 0) + 1;
        data.pricingUpdatedAt = updatedAt;
      }
      data.revisions.catalog = Math.max(0, Number(data.revisions.catalog || 0)) + 1;
      incrementPublishRevision(data);
      data.menuUpdatedAt = updatedAt;
      return data;
    });

    const publicMenuState = serializeLegacyMenuState(nextStore.menuState, nextStore.pricing);
    broadcastMenuUpdate(publicMenuState, updatedAt, nextStore.pricing, nextStore.revisions.pricing, nextStore.revisions.catalog);
    broadcastPublicUpdate(nextStore, "menu");
    res.json({
      ok: true,
      menuState: publicMenuState,
      pricing: nextStore.pricing,
      revision: nextStore.revisions.pricing,
      catalogRevision: nextStore.revisions.catalog,
      publishRevision: nextStore.revisions.publish,
      recipeLinkReview: nextStore.recipeLinkReview,
      updatedAt
    });
  } catch (error) {
    if (Number(error && error.status) === 409 && error.code === "REVISION_CONFLICT") {
      return res.status(409).json({
        ok: false,
        code: error.code,
        message: error.message,
        currentRevision: error.currentRevision
      });
    }
    next(error);
  }
});

app.post("/api/admin/products/import-excel", requireAdminRequestOrigin, auth.requireAdmin, retiredExcelImportHandler);

app.post("/api/media", requireAdminRequestOrigin, auth.requireAdmin, uploadLimiter, parseMediaUploadBody, async (req, res, next) => {
  try {
    const file = validateMediaUpload(req);
    await fs.mkdir(config.mediaDir, { recursive: true });
    await fs.writeFile(path.join(config.mediaDir, file.fileName), req.body);

    const mediaPath = `/media/${file.fileName}`;
    res.status(201).json({
      ok: true,
      media: {
        id: file.id,
        url: absoluteUrl(req, mediaPath),
        src: mediaPath,
        name: file.originalName,
        kind: file.kind,
        type: file.contentType,
        size: req.body.length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/media", requireAdminRequestOrigin, auth.requireAdmin, async (_req, res, next) => {
  try {
    await fs.mkdir(config.mediaDir, { recursive: true });
    const names = await fs.readdir(config.mediaDir);
    const media = await Promise.all(names.filter(isSafeMediaFileName).map(async (name) => {
      const stats = await fs.stat(path.join(config.mediaDir, name));
      return { name, src: `/media/${name}`, size: stats.size, updatedAt: stats.mtime.toISOString() };
    }));
    res.json({ ok: true, media: media.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/media/:name", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.params.name || "");
    if (!isSafeMediaFileName(name)) return res.status(400).json({ ok: false, message: "Gecersiz medya adi." });
    const data = req.storeSnapshot;
    const reference = `/media/${name}`;
    const publishedData = JSON.stringify({ menuState: data.menuState, siteState: data.siteState });
    if (publishedData.includes(reference)) {
      return res.status(409).json({ ok: false, message: "Bu medya yayindaki menu veya site tarafindan kullaniliyor." });
    }
    await fs.unlink(path.join(config.mediaDir, name));
    res.json({ ok: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return res.status(404).json({ ok: false, message: "Medya bulunamadi." });
    next(error);
  }
});

app.get("/api/menu/events", async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    openRevisionStream(req, res, sseClients, "menu", data);
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipes", requireAdminOrMainRequestOrigin, auth.requireRecipe, requireActiveRecipeUser, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    res.json({
      ok: true,
      recipeState: data.recipeState,
      recipeCatalog: data.recipeCatalog || [],
      recipeLinkReview: data.recipeLinkReview || [],
      revision: resolveScopeRevision(data, "recipes"),
      publishRevision: data.revisions && data.revisions.publish || 0,
      updatedAt: data.recipeUpdatedAt || null
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/recipes", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const recipeState = req.body && req.body.recipeState;
    const requestedCatalog = req.body && req.body.recipeCatalog;
    const validationError = validateRecipeState(recipeState);
    const productCodeError = validateRecipeProductCodes(recipeState);

    if (validationError || productCodeError) {
      return res.status(400).json({ ok: false, message: validationError || productCodeError });
    }

    const recipeCatalog = reconcileRecipeCatalog(recipeState, requestedCatalog);
    const catalogError = validateRecipeCatalog(recipeCatalog, recipeState);
    if (catalogError) {
      return res.status(400).json({ ok: false, message: catalogError });
    }

    const updatedAt = new Date().toISOString();
    const nextStore = await store.update((data) => {
      markManualRecipeStatusChanges(data.recipeState, recipeState);
      data.recipeState = recipeState;
      data.recipeCatalog = recipeCatalog;
      data.revisions.catalog = Math.max(0, Number(data.revisions.catalog || 0)) + 1;
      incrementPublishRevision(data);
      data.recipeUpdatedAt = updatedAt;
      return data;
    });

    broadcastRecipeUpdate(nextStore.recipeState, updatedAt, nextStore.recipeCatalog, nextStore.revisions.catalog);
    broadcastPublicUpdate(nextStore, "recipes");
    res.json({
      ok: true,
      recipeState: nextStore.recipeState,
      recipeCatalog: nextStore.recipeCatalog,
      recipeLinkReview: nextStore.recipeLinkReview,
      catalogRevision: nextStore.revisions.catalog,
      publishRevision: nextStore.revisions.publish,
      updatedAt
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/recipes/import-excel", requireAdminRequestOrigin, auth.requireAdmin, retiredExcelImportHandler);

app.get("/api/recipes/events", requireAdminOrMainRequestOrigin, auth.requireRecipe, requireActiveRecipeUser, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    openRevisionStream(req, res, recipeSseClients, "recipes", data, {
      userId: req.recipe && req.recipe.userId || ""
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/feedback", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const data = req.storeSnapshot;
    res.json({ ok: true, feedbackItems: data.feedbackItems || [], updatedAt: data.feedbackUpdatedAt || null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/feedback", async (req, res, next) => {
  try {
    const item = normalizeFeedbackItem(req.body && req.body.feedback || req.body || {});
    if (!item) {
      return res.status(400).json({ ok: false, message: "Geri bildirim icin mesaj, favori icecek veya puan gerekli." });
    }

    const updatedAt = new Date().toISOString();
    const nextStore = await store.update((data) => {
      data.feedbackItems = (data.feedbackItems || []).concat(item).slice(-1000);
      data.feedbackUpdatedAt = updatedAt;
      return data;
    });

    broadcastFeedbackUpdate(nextStore.feedbackItems, updatedAt);
    res.status(201).json({ ok: true, feedback: item, updatedAt });
  } catch (error) {
    next(error);
  }
});

app.put("/api/feedback", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.feedbackItems)
      ? req.body.feedbackItems.map(normalizeFeedbackItem).filter(Boolean)
      : [];
    const updatedAt = new Date().toISOString();
    await store.update((data) => {
      data.feedbackItems = items.slice(-1000);
      data.feedbackUpdatedAt = updatedAt;
      return data;
    });

    broadcastFeedbackUpdate(items, updatedAt);
    res.json({ ok: true, feedbackItems: items, updatedAt });
  } catch (error) {
    next(error);
  }
});

app.get("/api/feedback/events", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const data = req.storeSnapshot;
    sendSse(res, "ready", {
      scope: "feedback",
      revision: resolveScopeRevision(data, "feedback"),
      updatedAt: data.feedbackUpdatedAt || null
    });

    const client = { res };
    feedbackSseClients.add(client);

    req.on("close", () => {
      feedbackSseClients.delete(client);
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stock", requireAdminOrMainRequestOrigin, auth.requireRecipe, requireActiveRecipeUser, requirePersonelSection("stock"), requireNonPreviewRecipeSession, async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    const fullState = normalizeStockState(data.stockState);
    const actor = stockActorFromRequest(req);
    const stockState = actor.type === "admin" ? fullState : stockStateForPersonnel(fullState, actor);
    res.json({
      ok: true,
      stockState,
      revision: currentInventoryRevision(data),
      inventoryRevision: currentInventoryRevision(data),
      catalogRevision: currentCatalogRevision(data),
      stockRevision: currentStockRevision(data),
      revisions: {
        inventory: currentInventoryRevision(data),
        catalog: currentCatalogRevision(data),
        stock: currentStockRevision(data)
      },
      publishRevision: data.revisions && data.revisions.publish || 0,
      updatedAt: data.stockUpdatedAt || null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stock/events", requireAdminOrMainRequestOrigin, auth.requireRecipe, requireActiveRecipeUser, requirePersonelSection("stock"), requireNonPreviewRecipeSession, async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    openRevisionStream(req, res, stockSseClients, "stock", data);
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/stock", requireAdminRequestOrigin, auth.requireAdmin, (_req, res) => {
  res.status(410).json({
    ok: false,
    code: "STOCK_BULK_REPLACE_RETIRED",
    message: "Toplu stok üzerine yazma kaldırıldı; granular stok işlemlerini kullanın."
  });
});

app.post("/api/admin/stock/import-excel", requireAdminRequestOrigin, auth.requireAdmin, retiredExcelImportHandler);

app.post("/api/stock/movements", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("stock"), async (req, res, next) => {
  try {
    const actor = stockActorFromRequest(req);
    const submitted = req.body && req.body.movement || req.body || {};
    const operationId = String(req.get("Idempotency-Key") || req.get("X-Request-ID") || submitted.requestId || "").trim().slice(0, 160);
    if (!operationId) return res.status(400).json({ ok: false, message: "Stok işlemi için requestId zorunludur." });
    const movementInput = { ...submitted, requestId: operationId, idempotencyKey: operationId };
    const updatedAt = new Date().toISOString();
    let stockState = null;
    let movement = null;
    let idempotent = false;
    const pendingNotifications = [];

    const nextStore = await store.update((data, context) => {
      const previousStockState = normalizeStockState(data.stockState);
      const result = stockService.applyStockMovement(previousStockState, movementInput, actor, { requestId: operationId });
      stockState = result.stockState;
      movement = result.movement;
      idempotent = result.idempotent === true;
      if (idempotent) return context.noChange;
      const expectedRevision = movementInput.expectedInventoryRevision
        ?? (req.body && req.body.expectedInventoryRevision)
        ?? movementInput.expectedRevision
        ?? (req.body && req.body.expectedRevision);
      const currentRevision = currentInventoryRevision(data);
      if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) !== currentRevision) {
        const error = new Error("Stok verisi değişti. Güncel bakiyeyi alıp işlemi yeniden deneyin.");
        error.status = 409;
        throw error;
      }
      data.stockState = stockState;
      queueStockThresholdNotifications(data, pendingNotifications, previousStockState, stockState, {
        operationId: movement && movement.id || movementInput.requestId,
        updatedAt
      });
      data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
      data.revisions.inventory = Math.max(0, Number(data.revisions.inventory || 0)) + 1;
      data.revisions.stock = Math.max(Number(data.revisions.stock || 0) + 1, data.revisions.inventory);
      data.recipeActivity = (Array.isArray(data.recipeActivity) ? data.recipeActivity : []).concat({
        id: `stock-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        type: "stock.movement.create", action: "stock.movement.create",
        actorId: String(actor.id || ""), actorRole: actor.type,
        entityType: "stock_movement", entityId: String(movement && movement.id || ""),
        requestId: operationId, createdAt: updatedAt
      }).slice(-5000);
      data.stockUpdatedAt = updatedAt;
      return data;
    });

    if (!idempotent) broadcastStockUpdate(
      stockState || nextStore.stockState,
      updatedAt,
      Number(nextStore.revisions && nextStore.revisions.inventory || 0),
      "inventory"
    );
    publishAppNotifications(pendingNotifications);
    res.status(idempotent ? 200 : 201).json({
      ok: true,
      stockState: actor.type === "admin"
        ? (stockState || normalizeStockState(nextStore.stockState))
        : stockStateForPersonnel(stockState || normalizeStockState(nextStore.stockState), actor),
      movement,
      idempotent,
      revision: currentInventoryRevision(nextStore),
      inventoryRevision: currentInventoryRevision(nextStore),
      catalogRevision: currentCatalogRevision(nextStore),
      stockRevision: currentStockRevision(nextStore),
      revisions: {
        inventory: currentInventoryRevision(nextStore),
        catalog: currentCatalogRevision(nextStore),
        stock: currentStockRevision(nextStore)
      },
      publishRevision: nextStore.revisions.publish,
      updatedAt
    });
  } catch (error) {
    next(error);
  }
});

registerStockLocationRoutes({
  app,
  store,
  auth,
  requireAdminRequestOrigin,
  requireAdminOrMainRequestOrigin,
  broadcastStockUpdate,
  resolveProcurementActor: (req) => resolveActorFromRequest(req, store),
  hasProcurementCapability,
  notificationService,
  queueStockThresholdNotifications
});

let procurementRuntime = null;
const workforceRuntime = registerWorkforceRoutes({
  app, store, auth, crypto, normalizeStockState,
  requireAdminRequestOrigin, requireAdminOrMainRequestOrigin,
  broadcastStockUpdate,
  queueStockThresholdNotifications,
  notificationService,
  publishGatewayEvent: publishAuthenticatedEvent,
  notifyProcurementChange(event) {
    if (procurementRuntime && procurementRuntime.service) procurementRuntime.service.publishExternalEvent(event);
  }
});

procurementRuntime = registerProcurementRoutes({
  app,
  store,
  auth,
  config,
  notificationService,
  notifyWorkforceChange: workforceRuntime.invalidateWorkforce,
  documentService: procurementDocumentService,
  approveWorkforceShipment: workforceRuntime.approveWorkforceShipment,
  requireRequestOrigin: requireAdminOrMainRequestOrigin,
  riskOperationLimiter: importOperationLimiter
});

if (procurementRuntime && procurementRuntime.service && typeof procurementRuntime.service.subscribe === "function") {
  procurementRuntime.service.subscribe((event) => publishAuthenticatedEvent({
    topic: event && event.entityType === "shipment" ? "shipment" : "procurement",
    type: event && event.type || "procurement.updated",
    entityType: event && event.entityType || "procurement",
    entityId: event && event.entityId || "",
    revision: event && event.entityType === "shipment"
      ? event && (event.shipmentRevision || event.revision) || 0
      : event && event.revision || 0,
    timestamp: event && event.createdAt,
    targets: ["fatura", "yonetici"]
  }));
}

notificationService.subscribeNotificationEvents((notification) => publishAuthenticatedEvent({
  topic: "notification",
  type: "notification.updated",
  entityType: notification && notification.entityType || "notification",
  entityId: notification && (notification.entityId || notification.id) || "",
  revision: notification && notification.revision || 0,
  actorId: "system",
  timestamp: notification && notification.updatedAt || notification && notification.createdAt,
  targets: [notification && notification.appTarget || (notification && notification.recipientRole === "manager"
    ? "yonetici" : notification && notification.recipientRole === "mudavim" ? "mudavim" : "personel")]
}));

registerNotificationRoutes({
  app,
  store,
  auth,
  config,
  deliveryWorker: notificationDeliveryWorker,
  pushService,
  requireAdminRequestOrigin,
  requireAdminOrMainRequestOrigin,
  riskOperationLimiter: importOperationLimiter
});

registerPricingRoutes({
  app, store, auth, requireAdminRequestOrigin,
  riskOperationLimiter: importOperationLimiter,
  broadcastMenuUpdate, broadcastPublicUpdate
});

const dataImportRuntime = registerDataImportRoutes({
  app,
  store,
  auth,
  requireAdminRequestOrigin,
  riskOperationLimiter: importOperationLimiter,
  broadcastMenuUpdate,
  broadcastRecipeUpdate,
  broadcastStockUpdate,
  broadcastPublicUpdate
});

registerCatalogCleanupRoutes({
  app,
  store,
  auth,
  requireAdminRequestOrigin,
  riskOperationLimiter: importOperationLimiter,
  broadcastMenuUpdate,
  broadcastRecipeUpdate,
  broadcastStockUpdate,
  broadcastPublicUpdate
});

app.get("/api/site", async (_req, res, next) => {
  try {
    const data = await store.read();
    res.json({ ok: true, siteState: data.siteState, updatedAt: data.siteUpdatedAt || null });
  } catch (error) {
    next(error);
  }
});

app.put("/api/site", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const siteState = migrateSiteState(req.body && req.body.siteState);
    const validationError = validateSiteState(siteState);

    if (validationError) {
      return res.status(400).json({ ok: false, message: validationError });
    }

    const updatedAt = new Date().toISOString();
    siteState.updatedAt = updatedAt;
    const nextStore = await store.update((data) => {
      if (data.siteState && Object.keys(data.siteState).length) {
        data.siteRevisions = (data.siteRevisions || []).concat({
          id: `site-revision-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
          createdAt: updatedAt,
          siteState: data.siteState
        }).slice(-10);
      }
      data.siteState = siteState;
      data.siteUpdatedAt = updatedAt;
      data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions) ? data.revisions : {};
      data.revisions.site = Math.max(0, Number(data.revisions.site || 0)) + 1;
      return data;
    });

    broadcastSiteUpdate(nextStore.siteState, updatedAt, nextStore.revisions && nextStore.revisions.site);
    broadcastPublicUpdate(nextStore, "site");
    res.json({ ok: true, siteState: nextStore.siteState, revision: nextStore.revisions && nextStore.revisions.site || 0, updatedAt });
  } catch (error) {
    next(error);
  }
});

app.get("/api/site/events", async (req, res, next) => {
  try {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const data = await store.read();
    sendSse(res, "site", {
      siteState: data.siteState,
      updatedAt: data.siteUpdatedAt || null
    });

    const client = { res };
    siteSseClients.add(client);

    req.on("close", () => {
      siteSseClients.delete(client);
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/site/revisions", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const data = req.storeSnapshot;
    res.json({
      ok: true,
      revisions: (data.siteRevisions || []).map((item) => ({ id: item.id, createdAt: item.createdAt })).reverse()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/site/revisions/:id/restore", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const revisionId = String(req.params.id || "");
    const updatedAt = new Date().toISOString();
    let restored = null;
    const nextStore = await store.update((data) => {
      const revision = (data.siteRevisions || []).find((item) => item.id === revisionId);
      if (!revision) {
        const error = new Error("Site revizyonu bulunamadi.");
        error.status = 404;
        throw error;
      }
      data.siteRevisions = (data.siteRevisions || []).concat({
        id: `site-revision-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        createdAt: updatedAt,
        siteState: data.siteState
      }).slice(-10);
      restored = migrateSiteState(revision.siteState);
      data.siteState = restored;
      data.siteUpdatedAt = updatedAt;
      data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions) ? data.revisions : {};
      data.revisions.site = Math.max(0, Number(data.revisions.site || 0)) + 1;
      return data;
    });
    broadcastSiteUpdate(restored, updatedAt, nextStore.revisions && nextStore.revisions.site);
    broadcastPublicUpdate(nextStore, "site");
    res.json({ ok: true, siteState: restored, revision: nextStore.revisions && nextStore.revisions.site || 0, updatedAt });
  } catch (error) {
    next(error);
  }
});

app.use("/admin-password", requireAdminHost, express.static(path.join(config.backendRoot, "public"), {
  ...staticOptions,
  index: "index.html",
  maxAge: 0
}));

app.get("/login.html", requireAdminHost, (_req, res) => res.redirect(302, "/yonetici/"));
app.get("/password-reset", requireKnownHost, sendAuthFile("password-reset/index.html"));
app.get("/password-reset/", requireKnownHost, sendAuthFile("password-reset/index.html"));
app.get("/index.html", (req, res, next) => {
  if (isAdminHost(req) && config.publicSiteUrl) {
    return redirectToPublicSite(req, res, "index.html");
  }

  return requireMainHost(req, res, () => res.redirect(301, "/"));
});

app.get(["/panel", "/panel/", "/panel/panel.html"], (req, res) => {
  const query = String(req.originalUrl || "").includes("?")
    ? `?${String(req.originalUrl).split("?").slice(1).join("?")}`
    : "";
  const canonicalPath = `/yonetici/${query}`;
  if (!isAdminHost(req)) return redirectToAdmin(req, res, canonicalPath, 301);
  return res.redirect(301, canonicalPath);
});

app.get("/recete/index.html", (req, res) => {
  if (!isMainHost(req) && !isAdminHost(req)) return notFound(req, res);
  return res.redirect(301, "/personel/");
});

app.get("/", (req, res, next) => {
  if (isConfiguredAdminHost(req)) {
    return auth.requireAdminPage(req, res, () => res.redirect(302, "/yonetici/"));
  }

  if (!isMainHost(req)) return notFound(req, res);

  return res.sendFile(path.join(qrMenuRoot, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.get(/^\/site$/, requireMainHost, (_req, res) => res.redirect(301, "/site/"));
app.use("/site/", requireMainHost, express.static(siteRoot, { ...staticOptions, index: "index.html" }));
app.use("/mudavim", requireMainHost, express.static(mudavimRoot, { ...staticOptions, index: "index.html" }));

app.use("/assets", requireKnownHost, express.static(assetsRoot, staticOptions));
app.use("/shared", requireKnownHost, express.static(sharedRoot, staticOptions));
app.use("/styles", requireMainHost, express.static(path.join(siteRoot, "styles"), staticOptions));
app.use("/scripts", requireMainHost, express.static(path.join(siteRoot, "scripts"), staticOptions));
app.get("/sw.js", requireMainHost, sendSiteFile("sw.js"));

app.use("/qr-menu", requireMainHost, express.static(qrMenuRoot, {
  ...staticOptions,
  index: "index.html"
}));

app.get("/personel/stok", requireMainHost, (_req, res) => res.redirect(302, "/personel/"));
app.get("/personel/stok/", requireMainHost, (_req, res) => res.redirect(302, "/personel/"));

app.use("/personel/recete-embed", requireMainHost, auth.requirePersonelOrPreview, express.static(recipeRoot, {
  ...staticOptions,
  index: "index.html"
}));

app.use("/personel", requireMainHost, express.static(personelRoot, {
  ...staticOptions,
  index: "index.html"
}));

app.get(/^\/fatura$/, requireKnownHost, (_req, res) => res.redirect(301, "/fatura/"));
app.use("/fatura", requireKnownHost, express.static(faturaRoot, {
  ...staticOptions,
  index: "index.html"
}));

app.get("/stok", requireMainHost, (_req, res) => res.redirect(302, "/personel/"));
app.get("/stok/", requireMainHost, (_req, res) => res.redirect(302, "/personel/"));

// Express'in varsayilan gevsek trailing-slash eslesmesi `/yonetici/` yolunu da
// yakalayarak kendi uzerine 301 dongusu olusturur. Yalniz slashsiz legacy
// girdiyi canonical dizin yoluna tasiyoruz.
app.get(/^\/yonetici$/, (req, res) => {
  const query = String(req.originalUrl || "").includes("?")
    ? `?${String(req.originalUrl).split("?").slice(1).join("?")}`
    : "";
  const canonicalPath = `/yonetici/${query}`;
  if (!isAdminHost(req)) return redirectToAdmin(req, res, canonicalPath, 301);
  return res.redirect(301, canonicalPath);
});

app.use("/yonetici", (req, res, next) => {
  if (!isAdminHost(req)) return redirectToAdmin(req, res);
  return next();
}, express.static(adminRoot, {
  ...staticOptions,
  index: "index.html"
}));

app.use("/recete", requireKnownHost, (_req, res) => res.redirect(302, "/personel/"));

app.get("/recipe-data.js", requireKnownHost, (_req, res) => {
  res.status(410).type("application/javascript").send("/* Gömülü reçete kataloğu kaldırıldı; /api/recipes kullanılır. */\n");
});
app.get("/favicon.png", requireKnownHost, (_req, res, next) => {
  res.sendFile(path.join(assetsRoot, "brand", "favicon.png"), (error) => {
    if (error) next(error);
  });
});
app.get("/menu-data.js", requireKnownHost, (_req, res) => {
  res.status(410).type("application/javascript").send("/* Gömülü menü kataloğu kaldırıldı; /api/menu kullanılır. */\n");
});

app.get("/menu.js", requireMainHost, (_req, res) => res.redirect(301, "/qr-menu/scripts/app.js"));
app.get("/styles.css", requireMainHost, (_req, res) => res.redirect(301, "/qr-menu/styles/qr-menu.css"));


app.get("/media/:name", requireKnownHost, serveMediaFile);
app.head("/media/:name", requireKnownHost, serveMediaFile);

app.use(notFound);

app.use((error, req, res, _next) => {
  const status = error && (error.type === "entity.too.large" || Number(error.status) === 413)
    ? 413
    : Number(error && error.status || 500);
  if (status >= 500) logRuntimeError(error);
  const message = status === 413
    ? "İstek gövdesi izin verilen boyut sınırını aşıyor."
    : error && error.status ? error.message : "Backend hatasi olustu.";
  return sendError(req, res, status, message);
});

async function prepareRuntime() {
  await Promise.all([
    store.ensure(),
    fs.mkdir(config.mediaDir, { recursive: true }),
    procurementDocumentService.init(),
    dataImportRuntime.ready()
  ]);
  await seedStoreIfEmpty(store, projectRoot);
  const currentStore = await store.read();
  await procurementDocumentService.cleanupOrphans({
    documents: currentStore.procurement && currentStore.procurement.documents
  });
  if (config.notificationWorkersEnabled) {
    notificationDeliveryWorker.start();
    notificationScheduler.start();
  }
}

async function startServer() {
  await prepareRuntime();
  return app.listen(config.port, () => {
    const origin = `http://localhost:${config.port}`;
    console.log([
      "Tahmisci backend hazır:",
      `QR Menü   : ${origin}/`,
      `Site      : ${origin}/site/`,
      `Müdavim   : ${origin}/mudavim/`,
      `Yönetici  : ${origin}/yonetici/`,
      `Personel  : ${origin}/personel/`,
      `Fatura    : ${origin}/fatura/`,
      `Health    : ${origin}/api/health`
    ].join("\n"));
  });
}

async function shutdownRuntime(server, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
  await Promise.all([
    notificationScheduler.stop(),
    notificationDeliveryWorker.stop()
  ]);
  await Promise.all([mailService.close(), mudavimMailService.close()]);
  const closePromise = new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  });
  closeSseClients();
  let timeout;
  await Promise.race([
    closePromise,
    new Promise((resolve) => {
      timeout = setTimeout(() => {
        if (server && typeof server.closeAllConnections === "function") server.closeAllConnections();
        resolve();
      }, timeoutMs);
      if (typeof timeout.unref === "function") timeout.unref();
    })
  ]);
  if (timeout) clearTimeout(timeout);
  await store.drain();
}

let gracefulShutdownInstalled = false;
function installGracefulShutdown(server) {
  if (gracefulShutdownInstalled) return;
  gracefulShutdownInstalled = true;
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`Tahmisci backend ${signal} sinyaliyle güvenli biçimde kapatılıyor.`);
    try {
      await shutdownRuntime(server);
    } catch (error) {
      process.exitCode = 1;
      logRuntimeError(error, "Backend güvenli kapatma hatası");
    }
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

function closeSseClients() {
  for (const clients of [sseClients, recipeSseClients, siteSseClients, publicSseClients, feedbackSseClients, stockSseClients, authenticatedEventClients]) {
    for (const client of clients) {
      if (client && client.heartbeat) clearInterval(client.heartbeat);
      try { if (client && client.res && !client.res.writableEnded) client.res.end(); } catch (_error) {}
    }
    clients.clear();
  }
}

function logRuntimeError(error, context = "Backend runtime error") {
  if (!config.isProduction) {
    console.error(context, error);
    return;
  }
  const safe = {
    name: String(error && error.name || "Error").slice(0, 80),
    code: String(error && error.code || "").slice(0, 80),
    status: Number(error && error.status || 500),
    message: sanitizeLogLine(String(error && error.message || "Beklenmeyen hata")).slice(0, 500)
  };
  console.error(context, safe);
}

if (require.main === module) {
  startServer()
    .then((server) => installGracefulShutdown(server))
    .catch((error) => {
      logRuntimeError(error, "Backend baslatilamadi");
      process.exitCode = 1;
    });
}

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (config.allowedOrigins.includes("*") && !config.isProduction) return callback(null, true);
  if (config.allowedOrigins.includes(origin)) return callback(null, true);

  if (config.allowLocalhostOrigins && isLocalOrigin(origin)) {
    return callback(null, true);
  }

  return callback(null, false);
}

function requireAdminHost(req, res, next) {
  if (isAdminHost(req) || isMainHost(req)) return next();
  return notFound(req, res);
}

function requireMainHost(req, res, next) {
  if (isMainHost(req)) return next();
  return notFound(req, res);
}

function requireKnownHost(req, res, next) {
  if (isMainHost(req) || isAdminHost(req)) return next();
  return notFound(req, res);
}

function requireAdminRequestOrigin(req, res, next) {
  if (requestOriginAllowed(req, (origin) => isAdminOrigin(origin) || isMainOrigin(origin))) return next();

  return res.status(403).json({
    ok: false,
    message: "Yönetici API yalnızca yetkili kaynak üzerinden kullanılabilir."
  });
}

function requireAdminOrMainRequestOrigin(req, res, next) {
  if (requestOriginAllowed(req, (origin) => isAdminOrigin(origin) || isMainOrigin(origin))) return next();

  return res.status(403).json({
    ok: false,
    message: "Bu API yalnizca yetkili origin uzerinden kullanilabilir."
  });
}

async function requireActiveRecipeUser(req, res, next) {
  try {
    const payload = req.recipe || {};
    if (payload.role === "admin" || payload.role === "preview") return next();

    const userId = String(payload.userId || payload.sub || "").trim();
    const data = req.storeSnapshot || await store.read();
    const users = Array.isArray(data.recipeUsers) ? data.recipeUsers : [];

    if (!users.length && userId === "recipe") return next();

    const user = users.find((item) => item.id === userId);
    if (!user || user.active === false) {
      await auth.revokeRequestSession(req, ["personel"]);
      auth.clearRecipeCookie(res);
      return res.status(403).json({
        ok: false,
        message: "Recete erisimi pasif. Lutfen yonetici ile gorusun."
      });
    }

    req.recipeUser = user;
    req.recipe = Object.assign({}, payload, {
      userId: user.id,
      username: user.username,
      name: user.name
    });
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireNonPreviewRecipeSession(req, res, next) {
  if (req.recipe && req.recipe.role === "preview") {
    return res.status(403).json({ ok: false, message: "Önizleme oturumu bu özel veri akışına erişemez." });
  }
  return next();
}

function requirePersonelSection(section) {
  return (req, res, next) => {
    const payload = req.recipe || req.admin || {};
    if (payload.role === "admin" || payload.role === "preview") return next();
    if (!req.recipeUser && payload.role === "recipe" && String(payload.userId || payload.sub || "") === "recipe") return next();
    if (req.recipeUser && hasPersonelSectionAccess(req.recipeUser, section)) return next();
    return res.status(403).json({
      ok: false,
      code: "PERSONEL_SECTION_FORBIDDEN",
      section,
      message: "Bu Personel bölümü için erişim yetkiniz bulunmuyor."
    });
  };
}

function requireAuthenticatedEventSession(req, res, next) {
  const appId = String(req.query && (req.query.appId || req.query.appTarget) || "")
    .trim()
    .toLocaleLowerCase("tr-TR");
  if (!new Set(["yonetici", "personel", "fatura"]).has(appId)) {
    return res.status(400).json({ ok: false, message: "Geçerli uygulama hedefi gerekli." });
  }
  req.requestedEventAppId = appId;
  if (appId === "yonetici") return auth.requireAdmin(req, res, next);
  if (appId === "personel") return auth.requireActivePersonel(req, res, next);
  return auth.requireRecipe(req, res, (recipeError) => {
    if (recipeError) return next(recipeError);
    return requireActiveRecipeUser(req, res, (activeError) => {
      if (activeError) return next(activeError);
      return requireNonPreviewRecipeSession(req, res, (previewError) => {
        if (previewError) return next(previewError);
        const payload = req.recipe || req.admin || {};
        if (payload.role === "admin") return next();
        const user = req.recipeUser || {};
        const allowed = user.faturaAccessEnabled !== false
          && Array.isArray(user.faturaCapabilities)
          && user.faturaCapabilities.length > 0;
        return allowed
          ? next()
          : res.status(403).json({ ok: false, message: "Tahmisçi Fatura erişim yetkisi gerekli." });
      });
    });
  });
}

function isConfiguredAdminHost(req) {
  // Tek-domain production mimarisinde MAIN_DOMAIN ve ADMIN_DOMAIN aynidir;
  // bu durumda ana `/` dijital menu olarak kalir, Yonetici yalniz
  // `/yonetici/` yolundan acilir. Farkli bir legacy admin hostu ancak iki
  // domain gercekten ayriksa kendi kokunden Yonetici'ye yonlenir.
  return Boolean(
    config.adminDomain
      && normalizeHost(config.adminDomain) !== normalizeHost(config.mainDomain)
      && isAdminHost(req)
  );
}

function isAdminHost(req) {
  return isAdminHostname(requestHostname(req));
}

function isMainHost(req) {
  return isMainHostname(requestHostname(req));
}

function isAdminHostname(host) {
  const normalized = normalizeHost(host);
  if (config.adminDomain) return normalized === normalizeHost(config.adminDomain);
  return isLocalHost(normalized);
}

function isMainHostname(host) {
  const normalized = normalizeHost(host);
  if (config.mainDomain) {
    const main = normalizeHost(config.mainDomain);
    return normalized === main || normalized === `www.${main}`;
  }

  return isLocalHost(normalized);
}

function requestHostname(req) {
  return normalizeHost(req.hostname || req.header("host") || "");
}

function normalizeHost(value) {
  const host = String(value || "").toLowerCase().trim();
  if (host.startsWith("[")) {
    const bracketEnd = host.indexOf("]");
    return bracketEnd > -1 ? host.slice(1, bracketEnd) : host;
  }
  if (host === "::1") return host;
  if ((host.match(/:/g) || []).length === 1) return host.split(":")[0];
  return host;
}

function isLocalHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLocalOrigin(origin) {
  try {
    return isLocalHost(new URL(origin).hostname);
  } catch (_error) {
    return false;
  }
}

function configuredPublicOrigin(req) {
  if (config.publicSiteUrl) {
    try {
      return new URL(config.publicSiteUrl).origin;
    } catch (_error) {}
  }
  if (config.mainDomain) return `https://${config.mainDomain}`;
  return `${req.protocol}://${req.get("host")}`;
}

function previewAllowedOrigins(req) {
  const origins = new Set((config.allowedOrigins || []).filter((origin) => origin && origin !== "*"));
  origins.add(configuredPublicOrigin(req));
  origins.add(`${req.protocol}://${req.get("host")}`);
  if (config.mainDomain) origins.add(`https://${config.mainDomain}`);
  if (config.mainDomain) origins.add(`https://www.${config.mainDomain}`);
  if (config.adminDomain) origins.add(`https://${config.adminDomain}`);
  if (config.allowLocalhostOrigins && isLocalHost(requestHostname(req))) {
    const port = req.socket && req.socket.localPort ? `:${req.socket.localPort}` : (config.port ? `:${config.port}` : "");
    origins.add(`${req.protocol}://localhost${port}`);
    origins.add(`${req.protocol}://127.0.0.1${port}`);
  }
  return [...origins].filter((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
      return false;
    }
  });
}

function isAdminOrigin(origin) {
  try {
    const url = new URL(origin);
    if (config.allowLocalhostOrigins && isLocalHost(url.hostname)) return true;
    if (!isAdminHostname(url.hostname)) return false;
    return !config.isProduction || url.origin === `https://${normalizeHost(config.adminDomain)}`;
  } catch (_error) {
    return false;
  }
}

function isMainOrigin(origin) {
  try {
    const url = new URL(origin);
    if (config.allowLocalhostOrigins && isLocalHost(url.hostname)) return true;
    if (!isMainHostname(url.hostname)) return false;
    if (!config.isProduction) return true;
    const main = normalizeHost(config.mainDomain);
    return new Set([`https://${main}`, `https://www.${main}`]).has(url.origin);
  } catch (_error) {
    return false;
  }
}

function requestOriginAllowed(req, predicate) {
  const origin = String(req.header("Origin") || "").trim();
  if (origin) return predicate(origin);
  const referer = String(req.header("Referer") || "").trim();
  if (referer) {
    try {
      if (!predicate(new URL(referer).origin)) return false;
    } catch (_error) {
      return false;
    }
  }
  return String(req.header("Sec-Fetch-Site") || "").toLowerCase() !== "cross-site";
}

function redirectToAdmin(req, res, pathName, status) {
  if (!config.adminDomain) return notFound(req, res);
  const protocol = config.cookieSecure ? "https" : req.protocol;
  return res.redirect(status || 302, `${protocol}://${config.adminDomain}${pathName || req.originalUrl || "/"}`);
}

function redirectToPublicSite(_req, res, fileName) {
  const pathName = fileName === "index.html" ? "/" : `/${fileName}`;
  return res.redirect(302, new URL(pathName, config.publicSiteUrl).toString());
}

function sendSiteFile(fileName) {
  return (_req, res, next) => {
    res.sendFile(path.join(siteRoot, fileName), (error) => {
      if (error) next(error);
    });
  };
}

function sendAuthFile(fileName) {
  return (_req, res, next) => {
    res.sendFile(path.join(authRoot, fileName), (error) => {
      if (error) next(error);
    });
  };
}

function setStaticResponseHeaders(res, filePath) {
  const requestPath = String(res.req && (res.req.originalUrl || res.req.url) || "").split("?")[0];
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  if (extension === ".html" || extension === ".webmanifest" || fileName === "sw.js") {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  } else if (requestPath.startsWith("/media/")) {
    res.setHeader("Cache-Control", config.isProduction ? "public, max-age=2592000, immutable" : "no-cache");
  } else if (/\.[a-f0-9]{8,}\.(?:css|js|png|jpe?g|webp|svg|woff2?)$/i.test(fileName)) {
    res.setHeader("Cache-Control", config.isProduction ? "public, max-age=31536000, immutable" : "no-cache");
  } else {
    res.setHeader("Cache-Control", config.isProduction ? "public, max-age=3600, must-revalidate" : "no-cache");
  }

  const workerScopes = new Map([
    ["/qr-menu/sw.js", "/"],
    ["/personel/sw.js", "/personel/"],
    ["/yonetici/sw.js", "/yonetici/"],
    ["/fatura/sw.js", "/fatura/"]
  ]);
  if (workerScopes.has(requestPath)) {
    res.setHeader("Service-Worker-Allowed", workerScopes.get(requestPath));
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  }
}

function setDocumentResponseHeaders(req, res) {
  if (!["GET", "HEAD"].includes(req.method)) return;
  const requestPath = String(req.path || "");
  if (requestPath === "/"
    || requestPath.endsWith("/")
    || requestPath.endsWith(".html")
    || requestPath.endsWith(".webmanifest")
    || requestPath.endsWith("/sw.js")) {
    res.set("Cache-Control", "no-cache, must-revalidate");
  }
}

function isSensitiveApiRequest(req) {
  if (!String(req.path || "").startsWith("/api/")) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  return /^\/api\/(?:account(?:\/|$)|admin|notifications(?:\/|$)|workforce|procurement(?:\/|$)|recipe(?:\/|$)|recipes(?:\/|$)|stock(?:\/|$)|media(?:\/|$)|feedback(?:\/|$))/i.test(req.path);
}

function sanitizeLogLine(value) {
  return String(value || "")
    .replace(/([?&](?:previewToken|token|access_token|session|password|code|secret)=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s",;]+/gi, "$1[REDACTED]")
    .replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]");
}

function notFound(req, res) {
  return sendError(req, res, 404, `${req.method} ${req.path} bulunamadi.`);
}

function sendError(req, res, status, message) {
  if (wantsJson(req)) {
    return res.status(status).json({ ok: false, message });
  }

  return res
    .status(status)
    .type("html")
    .send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${status}</title></head><body><main style="font-family:Arial,sans-serif;max-width:620px;margin:12vh auto;padding:24px"><h1>${status}</h1><p>${escapeHtml(message)}</p></main></body></html>`);
}

function wantsJson(req) {
  return req.path.startsWith("/api/") || String(req.get("Accept") || "").includes("application/json");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readExcelWorkbook(buffer, fileName) {
  try {
    if (!xlsxModule) {
      try {
        xlsxModule = require("xlsx");
      } catch (_error) {
        xlsxModule = {
          read: simpleXlsx.readWorkbook,
          utils: { sheet_to_json: simpleXlsx.sheetToJson }
        };
      }
    }
  } catch (error) {
    error.message = "Excel aktarımı için XLSX okuyucu başlatılamadı.";
    error.status = 500;
    throw error;
  }

  try {
    return xlsxModule.read(buffer, {
      type: "buffer",
      cellDates: false,
      raw: false,
      WTF: false
    });
  } catch (error) {
    error.message = `${fileName || "Excel"} dosyasi okunamadi. XLSX, XLS, CSV veya TSV dosyasi yukleyin.`;
    error.status = 400;
    throw error;
  }
}

function workbookToRows(workbook) {
  const sheetName = workbook && workbook.SheetNames && workbook.SheetNames[0];
  const sheet = sheetName && workbook.Sheets[sheetName];
  if (!sheet) return [];
  return xlsxModule.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
    blankrows: false
  });
}

function workbookToProductImportRows(workbook) {
  const sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  const rows = [];

  sheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets && workbook.Sheets[sheetName];
    if (!sheet) return;
    const sheetRows = xlsxModule.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      blankrows: false
    });
    sheetRows.forEach((row, index) => {
      if (!Object.values(row || {}).some((value) => String(value ?? "").trim())) return;
      const productNameEntry = Object.entries(row || {}).find(([header]) => {
        return STOCK_IMPORT_HEADER_MAP[normalizeImportHeader(header)] === "productName";
      });
      if (!productNameEntry || !String(productNameEntry[1] ?? "").trim()) return;
      rows.push({
        sheetName: normalizeStockDisplayText(sheetName),
        rowNumber: index + 2,
        values: row
      });
    });
  });

  return rows;
}

async function createRecipeImportBackup() {
  const backupDir = path.join(path.dirname(config.dataFile), "backups", "recipe-imports");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `recipe-import-${stamp}.json`;
  const target = path.join(backupDir, fileName);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(config.dataFile, target);
    return { fileName, path: target };
  } catch (_error) {
    return { fileName: "", path: "" };
  }
}

async function createProductImportBackup() {
  const backupDir = path.join(path.dirname(config.dataFile), "backups", "product-imports");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `product-import-${stamp}.json`;
  const target = path.join(backupDir, fileName);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(config.dataFile, target);
    return { fileName, path: target };
  } catch (_error) {
    return { fileName: "", path: "" };
  }
}

function createRecipeImportReport(rows) {
  return {
    totalRows: Array.isArray(rows) ? rows.length : 0,
    updatedCount: 0,
    createdCount: 0,
    unchangedCount: 0,
    errorCount: 0,
    changes: [],
    errors: [],
    backupFile: "",
    backupPath: "",
    updatedAt: ""
  };
}

function createProductImportReport(rows) {
  return {
    totalRows: Array.isArray(rows) ? rows.length : 0,
    updatedCount: 0,
    createdCount: 0,
    unchangedCount: 0,
    errorCount: 0,
    changes: [],
    errors: [],
    backupFile: "",
    backupPath: "",
    updatedAt: ""
  };
}

function applyProductImportRows(menuState, rows) {
  const nextState = cloneJson(menuState || {});
  if (!Array.isArray(nextState.categories)) nextState.categories = [];

  const report = createProductImportReport(rows);
  const changedKeys = new Set();
  const unchangedKeys = new Set();

  rows.forEach((row) => {
    const parsed = normalizeProductImportRow(row);
    const rowPreview = productImportRowPreview(row);
    if (!parsed.category || !parsed.product) {
      report.errors.push({
        sheetName: row.sheetName || "",
        rowNumber: row.rowNumber || "-",
        category: parsed.category || row.sheetName || "",
        product: parsed.product || "",
        rowPreview,
        message: "Sayfa/kategori ve Urun Adi zorunludur."
      });
      return;
    }

    const category = findProductImportCategory(nextState.categories, parsed.category);
    if (!category) {
      report.errors.push({
        sheetName: row.sheetName || parsed.category,
        rowNumber: row.rowNumber || "-",
        category: parsed.category,
        product: parsed.product,
        rowPreview,
        message: `Kategori bulunamadi: ${parsed.category}`
      });
      return;
    }

    const product = findProductImportProduct(category.products, parsed.product);
    if (!product) {
      report.errors.push({
        sheetName: row.sheetName || parsed.category,
        rowNumber: row.rowNumber || "-",
        category: category.name || parsed.category,
        product: parsed.product,
        rowPreview,
        message: `Urun bulunamadi: ${parsed.product}`
      });
      return;
    }

    if (!product.details || typeof product.details !== "object" || Array.isArray(product.details)) {
      product.details = {};
    }

    const recordKey = productImportRecordKey(category.name || parsed.category, product.name || parsed.product);
    const fieldChanges = [];

    PRODUCT_IMPORT_FIELDS.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(parsed.values, field)) return;
      const nextValue = parsed.values[field];
      const oldValue = product.details[field] ?? "";
      if (String(oldValue ?? "") === String(nextValue ?? "")) return;
      product.details[field] = nextValue;
      fieldChanges.push({
        row: row.rowNumber || "-",
        sheetName: row.sheetName || "",
        category: category.name || parsed.category,
        product: product.name || parsed.product,
        field: productImportFieldLabel(field),
        oldValue: summarizeImportValue(oldValue),
        newValue: summarizeImportValue(nextValue),
        status: "Güncellendi",
        changeType: `${productImportFieldLabel(field)} değişti`
      });
    });

    if (fieldChanges.length) {
      changedKeys.add(recordKey);
      report.changes.push(...fieldChanges);
    } else {
      unchangedKeys.add(recordKey);
      report.changes.push({
        row: row.rowNumber || "-",
        sheetName: row.sheetName || "",
        category: category.name || parsed.category,
        product: product.name || parsed.product,
        field: "-",
        oldValue: "",
        newValue: "",
        status: "Aynı kaldı",
        changeType: "Değişiklik yok"
      });
    }
  });

  report.updatedCount = changedKeys.size;
  report.createdCount = 0;
  report.unchangedCount = Array.from(unchangedKeys).filter((key) => !changedKeys.has(key)).length;
  report.errorCount = report.errors.length;

  return { menuState: nextState, report };
}

function applyRecipeImportRows(recipeState, rows) {
  const nextState = cloneJson(recipeState || {});
  const report = createRecipeImportReport(rows);
  const changedRecordKeys = new Set();
  const createdRecordKeys = new Set();
  const unchangedRecordKeys = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const parsed = normalizeRecipeImportRow(row);
    if (!parsed.category || !parsed.product || !parsed.size) {
      report.errors.push({
        rowNumber,
        message: "Kategori, Ürün Adı ve Ölçü alanları zorunludur."
      });
      return;
    }
    if (parsed.error) {
      report.errors.push({
        rowNumber,
        category: parsed.category,
        product: parsed.product,
        size: parsed.size,
        message: parsed.error
      });
      return;
    }

    const recordKey = recipeImportRecordKey(parsed);
    if (!nextState[parsed.category]) nextState[parsed.category] = {};
    if (!nextState[parsed.category][parsed.product]) nextState[parsed.category][parsed.product] = {};
    const sizes = nextState[parsed.category][parsed.product];
    const existed = Object.prototype.hasOwnProperty.call(sizes, parsed.size);
    const current = normalizeRecipeImportItem(sizes[parsed.size]);
    const nextItem = Object.assign({}, current);
    const fieldChanges = [];

    RECIPE_IMPORT_FIELDS.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(parsed.values, field)) return;
      const nextValue = parsed.values[field];
      const oldValue = current[field];
      if (String(oldValue ?? "") === String(nextValue ?? "")) return;
      nextItem[field] = nextValue;
      fieldChanges.push({
        row: rowNumber,
        category: parsed.category,
        product: parsed.product,
        size: parsed.size,
        field: recipeImportFieldLabel(field),
        oldValue: summarizeImportValue(oldValue),
        newValue: summarizeImportValue(nextValue),
        status: existed ? "Güncellendi" : "Yeni eklendi",
        changeType: recipeImportChangeType(field, existed)
      });
    });

    if (!existed) {
      sizes[parsed.size] = nextItem;
      createdRecordKeys.add(recordKey);
      report.changes.push({
        row: rowNumber,
        category: parsed.category,
        product: parsed.product,
        size: parsed.size,
        field: "Yeni kayıt",
        oldValue: "",
        newValue: summarizeImportValue(nextItem.content || nextItem.preparation || parsed.product),
        status: "Yeni eklendi",
        changeType: "Yeni ölçü eklendi"
      }, ...fieldChanges);
      return;
    }

    if (fieldChanges.length) {
      sizes[parsed.size] = nextItem;
      changedRecordKeys.add(recordKey);
      report.changes.push(...fieldChanges);
    } else {
      unchangedRecordKeys.add(recordKey);
      report.changes.push({
        row: rowNumber,
        category: parsed.category,
        product: parsed.product,
        size: parsed.size,
        field: "-",
        oldValue: "",
        newValue: "",
        status: "Aynı kaldı",
        changeType: "Değişiklik yok"
      });
    }
  });

  report.updatedCount = changedRecordKeys.size;
  report.createdCount = createdRecordKeys.size;
  report.unchangedCount = Array.from(unchangedRecordKeys).filter((key) => !changedRecordKeys.has(key) && !createdRecordKeys.has(key)).length;
  report.errorCount = report.errors.length;

  return { recipeState: nextState, report };
}

function workbookToStockImportRows(workbook) {
  const sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) {
    throw Object.assign(new Error("Excel dosyasında okunabilir çalışma sayfası bulunamadı."), { status: 400 });
  }
  const rows = [];
  const requiredHeaders = ["urun adi", "urun adedi", "siparis esigi"];

  sheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets && workbook.Sheets[sheetName];
    if (!sheet) {
      throw Object.assign(new Error(`"${sheetName}" sayfası okunamadı.`), { status: 400 });
    }
    const sheetRows = xlsxModule.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      blankrows: false
    });
    const headers = (Array.isArray(sheetRows.headers) ? sheetRows.headers : Object.keys(sheetRows[0] || {}))
      .map(normalizeImportHeader);
    if (!headers.length && !sheetRows.length) return;
    const missing = requiredHeaders.filter((header) => !headers.includes(header));
    if (missing.length) {
      const labels = { "urun adi": "Ürün Adı", "urun adedi": "Ürün Adedi", "siparis esigi": "Sipariş Eşiği" };
      throw Object.assign(new Error(`"${sheetName}" sayfasında eksik sütun: ${missing.map((key) => labels[key]).join(", ")}.`), { status: 400 });
    }
    sheetRows.forEach((row, index) => {
      if (!Object.values(row || {}).some((value) => String(value ?? "").trim())) return;
      rows.push({
        sheetName,
        rowNumber: index + 2,
        values: row
      });
    });
  });

  if (!rows.length) {
    throw Object.assign(new Error("Excel dosyasında aktarılabilir stok satırı bulunamadı."), { status: 400 });
  }
  return rows;
}

function applyStockImportRows(stockState, rows) {
  const nextState = normalizeStockState(stockState || {});
  const report = createStockImportReport(rows);
  const categoryMap = new Map(nextState.categories.map((category) => [normalizeImportHeader(category.name), category]));
  const productMap = new Map(nextState.products.map((product) => [`${product.categoryId}|${normalizeImportHeader(product.name)}`, product]));
  const now = new Date().toISOString();
  const createdCategoryIds = new Set();
  const uniqueRows = [];
  const rowIndexes = new Map();

  rows.forEach((row) => {
    const parsed = normalizeStockImportRow(row);
    const productKey = `${normalizeImportHeader(parsed.categoryName || row.sheetName || "Genel")}|${normalizeImportHeader(parsed.productName)}`;
    if (!parsed.productName || !rowIndexes.has(productKey)) {
      rowIndexes.set(productKey, uniqueRows.length);
      uniqueRows.push(row);
      return;
    }
    uniqueRows[rowIndexes.get(productKey)] = row;
    report.skippedCount += 1;
  });

  uniqueRows.forEach((row) => {
    const parsed = normalizeStockImportRow(row);
    if (!parsed.productName || parsed.productName === "-") {
      if (parsed.productName === "-") {
        report.skippedCount += 1;
        return;
      }
      report.errors.push({ rowNumber: row.rowNumber || "-", sheetName: row.sheetName || "", message: "Ürün adı zorunludur." });
      return;
    }

    const categoryName = parsed.categoryName || row.sheetName || "Genel";
    const categoryKey = normalizeImportHeader(categoryName);
    let category = categoryMap.get(categoryKey);
    if (!category) {
      category = {
        id: stableStockImportId("stock-category", categoryName),
        name: categoryName,
        order: nextState.categories.length,
        active: true
      };
      nextState.categories.push(category);
      categoryMap.set(categoryKey, category);
      createdCategoryIds.add(category.id);
    }

    const productKey = `${category.id}|${normalizeImportHeader(parsed.productName)}`;
    let product = productMap.get(productKey);
    const created = !product;
    if (!product) {
      product = {
        id: stableStockImportId("stock-product", `${category.id}-${parsed.productName}`),
        categoryId: category.id,
        name: parsed.productName,
        supplier: "",
        unit: parsed.unit || "adet",
        stockQuantity: 0,
        stockQuantityText: "",
        orderThreshold: 0,
        orderThresholdText: "",
        criticalThreshold: 0,
        imageUrl: "",
        note: "",
        active: true,
        order: nextState.products.length,
        updatedAt: now
      };
      nextState.products.push(product);
      productMap.set(productKey, product);
    }

    const changes = [];
    applyStockImportField(product, "categoryId", category.id, changes);
    applyStockImportField(product, "name", parsed.productName, changes);
    if (parsed.unit) applyStockImportField(product, "unit", parsed.unit, changes);
    if (parsed.supplier) applyStockImportField(product, "supplier", parsed.supplier, changes);
    if (parsed.note) applyStockImportField(product, "note", parsed.note, changes);
    if (Object.prototype.hasOwnProperty.call(parsed, "stockQuantityText")) {
      applyStockImportField(product, "stockQuantityText", parsed.stockQuantityText, changes);
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "orderThresholdText")) {
      applyStockImportField(product, "orderThresholdText", parsed.orderThresholdText, changes);
    }
    ["stockQuantity", "orderThreshold", "criticalThreshold"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(parsed, field)) {
        applyStockImportField(product, field, parsed[field], changes);
      }
    });

    if (created || changes.length) {
      product.updatedAt = now;
      report.changes.push({
        row: row.rowNumber || "-",
        sheetName: row.sheetName || "",
        category: category.name,
        product: product.name,
        status: created ? "Yeni eklendi" : "Güncellendi",
        fields: changes.join(", ") || "Yeni ürün"
      });
      if (created) report.createdCount += 1;
      else report.updatedCount += 1;
    } else {
      report.unchangedCount += 1;
    }
  });

  report.errorCount = report.errors.length;
  report.createdCategoryCount = createdCategoryIds.size;
  report.skippedCount += report.errors.length;
  nextState.updatedAt = now;
  return { stockState: normalizeStockState(nextState), report };
}

function createStockImportReport(rows) {
  return {
    totalRows: Array.isArray(rows) ? rows.length : 0,
    updatedCount: 0,
    createdCount: 0,
    createdCategoryCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    changes: [],
    errors: []
  };
}

function normalizeStockImportRow(row) {
  const parsed = {};
  const values = row && row.values ? row.values : row || {};
  Object.entries(values).forEach(([header, rawValue]) => {
    const key = STOCK_IMPORT_HEADER_MAP[normalizeImportHeader(header)];
    if (!key) return;
    const value = String(rawValue ?? "").trim();
    if (!value && key !== "stockQuantity") return;
    if (["stockQuantity", "orderThreshold", "criticalThreshold"].includes(key)) {
      if (key === "stockQuantity") parsed.stockQuantityText = value;
      if (key === "orderThreshold") parsed.orderThresholdText = value;
      const numberValue = stockNumberOrNull(value);
      if (numberValue !== null) parsed[key] = numberValue;
      return;
    }
    parsed[key] = ["categoryName", "productName"].includes(key) ? normalizeStockDisplayText(value) : value;
  });
  return parsed;
}

function normalizeStockDisplayText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function applyStockImportField(product, field, value, changes) {
  if (String(product[field] ?? "") === String(value ?? "")) return;
  product[field] = value;
  changes.push(stockFieldLabel(field));
}

function stockActorFromRequest(req) {
  if (req.recipe && req.recipe.role === "admin") {
    return { type: "admin", id: req.recipe.sub || "admin", name: "Yönetici" };
  }
  if (req.recipeUser) {
    return {
      type: req.recipeUser.role === "admin" ? "admin" : "personel",
      id: req.recipeUser.id || req.recipeUser.username || "",
      name: req.recipeUser.name || req.recipeUser.displayName || req.recipeUser.username || "Personel",
      branchId: req.recipeUser.branchId || "main",
      stockLocationId: req.recipeUser.stockLocationId || ""
    };
  }
  if (req.adminUser || req.user) {
    const user = req.adminUser || req.user;
    return { type: "admin", id: user.id || "", name: user.name || user.username || "Yönetici" };
  }
  return { type: "personel", name: "Personel" };
}

function stockStateForPersonnel(stockState, actor) {
  const state = normalizeStockState(stockState || {});
  const locationId = stockService.actorLocationId(state, actor);
  const inventory = stockService.getLocationInventory(state, locationId);
  const quantities = new Map(inventory.balances.map((balance) => [String(balance.productId), Number(balance.quantity || 0)]));
  return {
    ...state,
    locations: inventory.location ? [inventory.location] : [],
    balances: state.balances.filter((balance) => String(balance.locationId) === String(locationId)),
    products: state.products.map((product) => {
      const {
        generalQuantity: _generalQuantity,
        otherLocationQuantity: _otherLocationQuantity,
        totalQuantity: _totalQuantity,
        suggestedTransfer: _suggestedTransfer,
        ...publicProduct
      } = product;
      const stockQuantity = quantities.get(String(product.id)) || 0;
      return {
        ...publicProduct,
        stockQuantity,
        stockQuantityText: `${stockQuantity} ${product.unit || "adet"}`
      };
    }),
    movements: state.movements.filter((movement) =>
      String(movement.locationId || "") === String(locationId)
      || String(movement.fromLocationId || "") === String(locationId)
      || String(movement.toLocationId || "") === String(locationId)
    ),
    transfers: state.transfers.filter((transfer) =>
      String(transfer.requestedBy || "") === String(actor && actor.id || "")
      && (String(transfer.fromLocationId || "") === String(locationId) || String(transfer.toLocationId || "") === String(locationId))
    )
  };
}

function stableStockImportId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12)}`;
}

function stockNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", ".").trim();
  if (!cleaned) return 0;
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function stockNumberOrNull(value) {
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function roundStockNumber(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function stockFieldLabel(field) {
  return {
    categoryId: "Kategori",
    name: "Ürün adı",
    unit: "Birim",
    stockQuantity: "Mevcut stok",
    orderThreshold: "Sipariş eşiği",
    criticalThreshold: "Kritik eşik",
    supplier: "Tedarikçi",
    note: "Not"
  }[field] || field;
}

const RECIPE_IMPORT_FIELDS = [
  "content",
  "preparation",
  "note",
  "active",
  "order"
];

const PRODUCT_IMPORT_FIELDS = [
  "calories",
  "allergens",
  "ingredients"
];

const PRODUCT_IMPORT_HEADER_MAP = {
  kategori: "category",
  "urun adi": "product",
  urun: "product",
  product: "product",
  "urun kalorisi": "calories",
  kalori: "calories",
  calories: "calories",
  kcal: "calories",
  "urun alerjeni": "allergens",
  alerjen: "allergens",
  allergens: "allergens",
  allergen: "allergens",
  "urun icerigi": "ingredients",
  icerik: "ingredients",
  ingredients: "ingredients",
  content: "ingredients"
};

const STOCK_IMPORT_HEADER_MAP = {
  kategori: "categoryName",
  category: "categoryName",
  "urun adi": "productName",
  "urun": "productName",
  "stok urunu": "productName",
  product: "productName",
  "product name": "productName",
  name: "productName",
  birim: "unit",
  unit: "unit",
  "mevcut stok": "stockQuantity",
  "urun adedi": "stockQuantity",
  stok: "stockQuantity",
  stock: "stockQuantity",
  mevcut: "stockQuantity",
  quantity: "stockQuantity",
  "siparis esigi": "orderThreshold",
  "siparis eşiği": "orderThreshold",
  "order threshold": "orderThreshold",
  threshold: "orderThreshold",
  "kritik esik": "criticalThreshold",
  "kritik eşik": "criticalThreshold",
  "critical threshold": "criticalThreshold",
  critical: "criticalThreshold",
  tedarikci: "supplier",
  tedarikçi: "supplier",
  supplier: "supplier",
  marka: "supplier",
  brand: "supplier",
  not: "note",
  note: "note",
  aciklama: "note",
  açıklama: "note"
};

const RECIPE_IMPORT_HEADER_MAP = {
  kategori: "category",
  "urun adi": "product",
  urun: "product",
  olcu: "size",
  icerik: "content",
  "icerik olcusuz": "content",
  hazirlanisi: "preparation",
  hazirlanis: "preparation",
  "hazirlanis olculer dahil": "preparation",
  "hazirlanisi olculer dahil": "preparation",
  "urun notu": "note",
  "urun not": "note",
  productnote: "note",
  "product note": "note",
  not: "note",
  aktif: "active",
  siralama: "order"
};

function normalizeProductImportRow(row) {
  const normalized = {
    category: String(row && row.sheetName || "").trim(),
    product: "",
    values: {}
  };

  Object.entries(row && row.values || {}).forEach(([header, value]) => {
    const key = PRODUCT_IMPORT_HEADER_MAP[normalizeImportHeader(header)];
    if (!key) return;
    const rawText = String(value ?? "");
    const text = rawText.trim();
    if (key === "category") normalized.category = text || normalized.category;
    else if (key === "product") normalized.product = text;
    else {
      if (!text) return;
      normalized.values[key] = isClearToken(text) ? "" : rawText;
    }
  });

  return normalized;
}

function productImportRowPreview(row) {
  const entries = Object.entries(row && row.values || {})
    .map(([header, value]) => {
      const text = summarizeImportValue(value);
      if (!text) return "";
      return `${header}: ${text}`;
    })
    .filter(Boolean)
    .slice(0, 6);

  return entries.join(" | ");
}

function normalizeRecipeImportRow(row) {
  const normalized = {
    category: "",
    product: "",
    size: "",
    values: {},
    error: ""
  };

  Object.entries(row || {}).forEach(([header, value]) => {
    const key = RECIPE_IMPORT_HEADER_MAP[normalizeImportHeader(header)];
    if (!key) return;
    const rawText = String(value ?? "");
    const text = rawText.trim();
    if (key === "category") normalized.category = text;
    else if (key === "product") normalized.product = text;
    else if (key === "size") normalized.size = text;
    else if (key === "active") {
      if (!text) return;
      if (isClearToken(text)) {
        normalized.values.active = true;
        return;
      }
      const activeValue = parseImportBoolean(text);
      if (activeValue === null) normalized.error = "Aktif alanı evet/hayır, aktif/pasif veya 1/0 olmalı.";
      else normalized.values.active = activeValue;
    } else if (key === "order") {
      if (!text) return;
      if (isClearToken(text)) {
        normalized.values.order = 0;
        return;
      }
      const orderValue = Number(String(text).replace(",", "."));
      if (!Number.isFinite(orderValue)) normalized.error = "Sıralama alanı sayı olmalı.";
      else normalized.values.order = orderValue;
    } else {
      if (!text) return;
      normalized.values[key] = isClearToken(text) ? "" : rawText;
    }
  });

  return normalized;
}

function findProductImportCategory(categories, categoryName) {
  const normalizedName = normalizeImportHeader(categoryName);
  if (!normalizedName || !Array.isArray(categories)) return null;
  const exact = categories.find((category) => normalizeImportHeader(category && category.name) === normalizedName);
  if (exact) return exact;

  if (normalizedName.length < 8) return null;
  const prefixMatches = categories.filter((category) => {
    const candidate = normalizeImportHeader(category && category.name);
    return candidate.startsWith(normalizedName) || normalizedName.startsWith(candidate);
  });
  return prefixMatches.length === 1 ? prefixMatches[0] : null;
}

function findProductImportProduct(products, productName) {
  const normalizedName = normalizeImportHeader(productName);
  if (!normalizedName || !Array.isArray(products)) return null;
  return products.find((product) => normalizeImportHeader(product && product.name) === normalizedName) || null;
}

function productImportRecordKey(category, product) {
  return [category, product]
    .map((part) => normalizeImportHeader(part))
    .join("|");
}

function productImportFieldLabel(field) {
  return {
    calories: "Kalori",
    allergens: "Alerjen",
    ingredients: "Ürün içeriği"
  }[field] || field;
}

function normalizeImportHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/\u00c4\u00b1/g, "i")
    .replace(/\u00c4\u00b0/g, "I")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseImportBoolean(value) {
  const normalized = normalizeImportHeader(value);
  if (["1", "evet", "true", "aktif", "active", "yes"].includes(normalized)) return true;
  if (["0", "hayir", "false", "pasif", "inactive", "no"].includes(normalized)) return false;
  return null;
}

function isClearToken(value) {
  return normalizeImportHeader(value) === "bosalt";
}

function normalizeRecipeImportItem(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const content = String(value.content ?? value.recipe ?? value.ingredients ?? "");
    const preparation = String(value.preparation ?? value.method ?? value.steps ?? value.description ?? "");
    return {
      content,
      preparation,
      note: String(value.note ?? value.productNote ?? ""),
      active: value.active !== false && String(value.active || "").toLowerCase() !== "false",
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0
    };
  }
  return {
    content: String(value ?? ""),
    preparation: "",
    note: "",
    active: true,
    order: 0
  };
}

function recipeImportRecordKey(row) {
  return [row.category, row.product, row.size]
    .map((part) => normalizeImportHeader(part))
    .join("|");
}

function recipeImportFieldLabel(field) {
  return {
    content: "İçerik",
    preparation: "Hazırlanışı",
    note: "Ürün Notu",
    active: "Aktif",
    order: "Sıralama"
  }[field] || field;
}

function recipeImportChangeType(field, existed) {
  if (!existed) return "Yeni ölçü eklendi";
  return {
    content: "İçerik değişti",
    preparation: "Hazırlanışı değişti",
    note: "Ürün notu değişti",
    active: "Aktiflik değişti",
    order: "Sıralama değişti"
  }[field] || "Alan değişti";
}

function summarizeImportValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function broadcastMenuUpdate(_menuState, updatedAt, _pricing, revision, catalogRevision = 0) {
  broadcastScopeInvalidation(sseClients, "menu", "menu", { updatedAt, revision });
  publishAuthenticatedEvent({
    topic: "catalog",
    type: "menu.updated",
    entityType: "menu",
    revision: Math.max(0, Number(catalogRevision || revision || 0)),
    timestamp: updatedAt,
    targets: ["yonetici"]
  });
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

function markManualMenuStatusChanges(previousState, nextState) {
  const previousCategories = new Map((previousState && previousState.categories || []).map((category) => [String(category.id), category]));
  const previous = new Map((previousState && previousState.categories || []).flatMap((category) => (
    (category.products || []).map((product) => [String(product.id), product])
  )));
  for (const category of nextState && nextState.categories || []) {
    const oldCategory = previousCategories.get(String(category.id));
    if (!oldCategory) {
      category.sourceType = "manual";
      category.sourceWorkbook = "";
      category.sourcePresent = true;
      category.statusSource = "manual";
      category.manualActive = category.active !== false;
    } else if (oldCategory.active !== category.active) {
      category.statusSource = "manual";
      category.manualActive = category.active !== false;
      if (!category.sourceType) category.sourceType = "manual";
    }
    for (const product of category.products || []) {
      const oldProduct = previous.get(String(product.id));
      if (!oldProduct) {
        product.sourceType = "manual";
        product.sourceWorkbook = "";
        product.sourcePresent = true;
        product.statusSource = "manual";
        product.manualActive = product.active !== false;
      } else if (oldProduct.active !== product.active) {
        product.statusSource = "manual";
        product.manualActive = product.active !== false;
        if (!product.sourceType) product.sourceType = "manual";
      }
    }
  }
}

function markManualRecipeStatusChanges(previousState, nextState) {
  for (const [category, products] of Object.entries(nextState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, item] of Object.entries(sizes || {})) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const oldItem = previousState && previousState[category] && previousState[category][product] && previousState[category][product][size];
        if (!oldItem) {
          item.sourceType = "manual";
          item.sourceWorkbook = "";
          item.sourcePresent = true;
          item.statusSource = "manual";
          item.manualActive = item.active !== false;
        } else if (typeof oldItem === "object" && oldItem.active !== item.active) {
          item.statusSource = "manual";
          item.manualActive = item.active !== false;
          if (!item.sourceType) item.sourceType = "manual";
        }
      }
    }
  }
}

function incrementPublishRevision(data) {
  if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) {
    data.revisions = { publish: 0, pricing: 0 };
  }
  data.revisions.publish = Number(data.revisions.publish || 0) + 1;
  return data.revisions.publish;
}

function broadcastRecipeUpdate(_recipeState, updatedAt, _recipeCatalog = [], revision = 0) {
  broadcastScopeInvalidation(recipeSseClients, "recipes", "recipes", { updatedAt });
  publishAuthenticatedEvent({ topic: "catalog", type: "recipe.updated", entityType: "recipe", revision, timestamp: updatedAt, targets: ["personel", "yonetici"] });
}

function closeRecipeClientsForUser(userId) {
  const targetId = String(userId || "").trim();
  if (!targetId) return;

  for (const client of Array.from(recipeSseClients)) {
    if (client.userId !== targetId) continue;
    try {
      const revision = nextScopeRevision("recipes", Date.now());
      sendSse(client.res, "recipes", {
        revision,
        scope: "recipes",
        action: "revoked",
        requiresRefetch: false,
        revoked: true,
        updatedAt: new Date().toISOString()
      }, { id: revision });
    } catch (_error) {}
    closeRevisionClient(client, recipeSseClients);
  }
}

function broadcastSiteUpdate(siteState, updatedAt, revision = 0) {
  const payload = { siteState, updatedAt };
  for (const client of siteSseClients) {
    sendSse(client.res, "site", payload);
  }
  publishAuthenticatedEvent({ topic: "site", type: "site.updated", entityType: "site", revision, timestamp: updatedAt, targets: ["yonetici"] });
}

function broadcastPublicUpdate(data, reason) {
  broadcastScopeInvalidation(publicSseClients, "public", "bootstrap", {
    revision: resolveScopeRevision(data, "public"),
    action: reason || "invalidate",
    updatedAt: data && (data.siteUpdatedAt || data.menuUpdatedAt) || new Date().toISOString()
  });
}

function broadcastFeedbackUpdate(feedbackItems, updatedAt) {
  const payload = { feedbackItems, updatedAt };
  for (const client of feedbackSseClients) {
    sendSse(client.res, "feedback", payload);
  }
  publishAuthenticatedEvent({ topic: "feedback", type: "feedback.updated", entityType: "feedback", timestamp: updatedAt, targets: ["yonetici"] });
}

function broadcastStockUpdate(_stockState, updatedAt, revision = 0, domain = "inventory") {
  const invalidation = broadcastScopeInvalidation(stockSseClients, "stock", "stock", { updatedAt, revision });
  const topic = domain === "catalog" ? "catalog" : "inventory";
  const eventRevision = Math.max(0, Number(revision || invalidation.revision));
  publishAuthenticatedEvent({
    eventId: `${topic}:${eventRevision}`,
    topic,
    type: `${topic}.updated`,
    entityType: topic,
    revision: eventRevision,
    timestamp: updatedAt,
    targets: ["fatura", "personel", "yonetici"]
  });
}

function queueAppNotification(data, pending, input) {
  try {
    const notification = notificationService.createNotificationInStore(data, input);
    if (notification) pending.push(notification);
    return notification;
  } catch (error) {
    logRuntimeError(error, "Bildirim kaydı oluşturulamadı");
    return null;
  }
}

function publishAppNotifications(pending) {
  for (const notification of pending) {
    try {
      notificationService.publishNotificationEvent(notification);
    } catch (error) {
      logRuntimeError(error, "Bildirim SSE olayı yayınlanamadı");
    }
  }
}

function queueStockThresholdNotifications(data, pending, previousState, nextState, context = {}) {
  const operationId = String(context.operationId || context.updatedAt || Date.now()).slice(0, 160);
  const before = normalizeStockState(previousState || {});
  const after = normalizeStockState(nextState || {});
  const beforeBalances = new Map((before.balances || []).map((balance) => [`${balance.locationId}\u0000${balance.productId}`, balance]));
  const afterBalances = new Map((after.balances || []).map((balance) => [`${balance.locationId}\u0000${balance.productId}`, balance]));
  const general = (after.locations || []).find((location) => location.code === "GENEL" || location.type === "central") || null;

  for (const location of after.locations || []) {
    if (location.active === false) continue;
    for (const product of after.products || []) {
      if (!product || product.active === false) continue;
      const key = `${location.id}\u0000${product.id}`;
      const previousBalance = beforeBalances.get(key) || {};
      const balance = afterBalances.get(key) || {};
      const previousKind = stockBalanceAlertKind(previousBalance, location, beforeBalances.get(`${general && general.id}\u0000${product.id}`));
      const kind = stockBalanceAlertKind(balance, location, afterBalances.get(`${general && general.id}\u0000${product.id}`));
      if (kind === previousKind) continue;

      const quantity = roundStockNumber(balance.quantity);
      const unit = String(product.unit || "adet");
      const threshold = roundStockNumber(kind === "critical" ? balance.criticalThreshold : balance.orderThreshold);
      const generalQuantity = general ? roundStockNumber((afterBalances.get(`${general.id}\u0000${product.id}`) || {}).quantity) : 0;
      const transition = kind === "ok" ? "recovered" : kind;
      const title = kind === "transfer"
        ? "Kafe deposu için transfer önerisi"
        : kind === "procurement" ? "Genel depoda tedarik ihtiyacı"
          : kind === "critical" ? "Kafe deposunda kritik stok" : "Stok tekrar yeterli seviyede";
      const body = kind === "transfer"
        ? `${product.name} ${location.name} için eşik altına düştü; Genel Depoda ${generalQuantity} ${unit} bulunuyor.`
        : kind === "ok"
          ? `${product.name} ${location.name} için güvenli stok seviyesine çıktı: ${quantity} ${unit}.`
          : `${product.name} ${location.name} için ${quantity} ${unit} seviyesine düştü.`;
      queueAppNotification(data, pending, {
        recipientRole: "manager",
        recipientId: "manager",
        category: "stock",
        eventType: `stock_${transition}`,
        title,
        body,
        severity: kind === "critical" ? "critical" : kind === "ok" ? "success" : "warning",
        entityType: "stock_balance",
        entityId: `${location.id}:${product.id}`,
        deepLink: `/fatura/?view=stock&locationId=${encodeURIComponent(location.id)}&stockProductId=${encodeURIComponent(product.id)}`,
        dedupeKey: `stock-${transition}:${location.id}:${product.id}:${operationId}`,
        metadata: {
          productName: product.name,
          productCode: normalizeProductCode(product.productCode), locationId: location.id,
          locationName: location.name, quantity, threshold, generalQuantity, unit, transition
        },
        createdAt: context.updatedAt
      });
    }
  }
}

function stockBalanceAlertKind(balance, location, generalBalance) {
  const quantity = Number(balance && balance.quantity || 0);
  const critical = Number(balance && balance.criticalThreshold || 0);
  const order = Number(balance && balance.orderThreshold || 0);
  const generalQuantity = Number(generalBalance && generalBalance.quantity || 0);
  if (critical > 0 && quantity <= critical) return location && location.type === "central" ? "procurement" : "critical";
  if (order > 0 && quantity <= order) return location && location.type === "cafe" && generalQuantity > 0 ? "transfer" : "procurement";
  return "ok";
}

function suspendPersonnelNotificationDelivery(data, userId, updatedAt) {
  const recipientId = String(userId || "").trim();
  if (!recipientId) return;
  data.pushSubscriptions = (Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [])
    .filter((item) => !(item && item.ownerRole === "personnel" && String(item.ownerId) === recipientId));
  data.notificationOutbox = (Array.isArray(data.notificationOutbox) ? data.notificationOutbox : []).map((item) => {
    if (!item
      || item.recipientRole !== "personnel"
      || String(item.recipientId) !== recipientId
      || item.status === "sent"
      || item.status === "cancelled") return item;
    return {
      ...item,
      status: "cancelled",
      lockedAt: null,
      nextAttemptAt: null,
      lastError: "Personel hesabı aktif olmadığı için teslim durduruldu.",
      updatedAt
    };
  });
}

function sendSse(res, event, payload, options = {}) {
  if (options.id !== undefined && options.id !== null && String(options.id)) {
    res.write(`id: ${String(options.id).replace(/[\r\n]/g, "")}\n`);
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function openAuthenticatedEventStream(req, res) {
  const payload = req.recipe || req.admin || {};
  const role = String(payload.role || payload.sessionRole || "personel").toLocaleLowerCase("tr-TR");
  const appId = String(req.requestedEventAppId || "personel");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity"
  });
  if (res.socket) res.socket.setTimeout(0);
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);
  const ready = canonicalEventEnvelope({ topic: "system", type: "system.ready", entityType: "session", targets: [appId] });
  sendSse(res, "event", ready, { id: ready.eventId });
  const client = {
    res,
    appId,
    actorId: String(payload.userId || payload.sub || role),
    heartbeat: setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS)
  };
  if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
  authenticatedEventClients.add(client);
  req.once("close", () => closeRevisionClient(client, authenticatedEventClients, false));
}

function canonicalEventEnvelope(input = {}) {
  const targets = Array.from(new Set((Array.isArray(input.targets) ? input.targets : [])
    .map((item) => String(item || "").trim().toLocaleLowerCase("tr-TR"))
    .filter((item) => ["yonetici", "personel", "fatura", "mudavim", "public"].includes(item))));
  const revision = Math.max(0, Math.trunc(Number(input.revision || 0)));
  return {
    eventId: String(input.eventId || `evt-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`),
    topic: String(input.topic || "system").slice(0, 60),
    type: String(input.type || "system.updated").slice(0, 120),
    entityType: String(input.entityType || "").slice(0, 100),
    entityId: String(input.entityId || "").slice(0, 180),
    revision,
    actorId: String(input.actorId || "").slice(0, 180),
    timestamp: input.timestamp || new Date().toISOString(),
    targets
  };
}

function publishAuthenticatedEvent(input = {}) {
  const envelope = canonicalEventEnvelope(input);
  for (const client of authenticatedEventClients) {
    if (!client || !client.res || client.res.writableEnded) continue;
    if (envelope.targets.length && !envelope.targets.includes(client.appId)) continue;
    sendSse(client.res, "event", envelope, { id: envelope.eventId });
  }
  return envelope;
}

function openRevisionStream(req, res, clients, scope, data, clientData = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity"
  });
  if (res.socket) res.socket.setTimeout(0);
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);

  const revision = seedScopeRevision(scope, resolveScopeRevision(data, scope));
  const lastEventId = parseLastEventId(req);
  sendSse(res, "ready", {
    eventId: `${scope}:${revision}`,
    topic: scope === "public" ? "site" : scope === "stock" ? "inventory" : scope === "menu" || scope === "recipes" ? "catalog" : scope,
    type: `${scope}.ready`,
    entityType: scope,
    entityId: "",
    revision,
    actorId: "",
    timestamp: new Date().toISOString(),
    targets: scope === "public" ? ["public", "mudavim"] : [],
    scope,
    action: "ready",
    requiresRefetch: lastEventId > 0 && lastEventId < revision
  }, { id: revision });

  const clientId = cleanSseClientId(req.query && req.query.clientId);
  if (clientId) {
    for (const existing of Array.from(clients)) {
      if (existing.clientId !== clientId) continue;
      closeRevisionClient(existing, clients);
    }
  }

  const client = {
    ...clientData,
    res,
    clientId,
    heartbeat: setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS)
  };
  if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
  clients.add(client);
  req.once("close", () => closeRevisionClient(client, clients, false));
  return client;
}

function broadcastScopeInvalidation(clients, scope, event, options = {}) {
  const revision = nextScopeRevision(scope, options.revision || Date.parse(options.updatedAt || ""));
  const payload = {
    eventId: `${scope}:${revision}`,
    topic: scope === "public" ? "site" : scope === "stock" ? "inventory" : scope === "menu" || scope === "recipes" ? "catalog" : scope,
    type: `${scope}.${options.action || "invalidate"}`,
    entityType: scope,
    entityId: "",
    revision,
    actorId: String(options.actorId || ""),
    timestamp: options.updatedAt || new Date().toISOString(),
    targets: scope === "public" ? ["public", "mudavim"] : [],
    scope,
    action: options.action || "invalidate",
    changedIds: Array.isArray(options.changedIds) ? options.changedIds.slice(0, 50).map((id) => String(id).slice(0, 120)) : [],
    requiresRefetch: options.requiresRefetch !== false,
    updatedAt: options.updatedAt || new Date().toISOString()
  };
  rememberScopeEvent(scope, event, payload);
  for (const client of clients) {
    if (!client || !client.res || client.res.writableEnded) continue;
    sendSse(client.res, event, payload, { id: revision });
  }
  return payload;
}

function buildMenuApiPayload(data) {
  const revisions = data && data.revisions || {};
  return {
    ok: true,
    menuState: serializeLegacyMenuState(data.menuState, data.pricing),
    pricing: data.pricing,
    revision: Math.max(0, Number(revisions.pricing || 0)),
    publishRevision: Math.max(0, Number(revisions.publish || 0)),
    catalogRevision: Math.max(0, Number(revisions.catalog || revisions.dataImportCatalog || 0)),
    dataImportRevision: Math.max(0, Number(revisions.dataImport || 0)),
    streamRevision: resolveScopeRevision(data, "menu"),
    updatedAt: latestIsoTimestamp(data.menuUpdatedAt, data.pricingUpdatedAt)
  };
}

function catalogEntityTag(scope, payload) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("base64url")
    .slice(0, 27);
  return `"${scope}-${digest}"`;
}

function requestEntityTagMatches(req, entityTag) {
  const header = String(req && req.headers && req.headers["if-none-match"] || "").trim();
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === entityTag || normalized.replace(/^W\//, "") === entityTag;
  });
}

function latestIsoTimestamp(...values) {
  return values
    .filter(Boolean)
    .sort((first, second) => Date.parse(first) - Date.parse(second))
    .pop() || null;
}

function resolveScopeRevision(data, scope) {
  const updatedAt = {
    menu: data && data.menuUpdatedAt,
    recipes: data && data.recipeUpdatedAt,
    stock: data && data.stockUpdatedAt,
    public: data && (data.siteUpdatedAt || data.menuUpdatedAt),
    feedback: data && data.feedbackUpdatedAt
  }[scope];
  const timestamp = Date.parse(updatedAt || "");
  if (Number.isSafeInteger(timestamp) && timestamp > 0) return timestamp;
  const revisions = data && data.revisions || {};
  if (scope === "workforce") return Math.max(0, Number(revisions.workforce || 0));
  if (scope === "menu") return Math.max(0, Number(revisions.publish || 0), Number(revisions.pricing || 0));
  return Math.max(0, Number(revisions.publish || 0));
}

function currentStockRevision(data) {
  const revisions = data && data.revisions || {};
  return Math.max(0, Number(revisions.stock || 0));
}

function currentInventoryRevision(data) {
  const revisions = data && data.revisions || {};
  return Math.max(0, Number(revisions.inventory || 0));
}

function currentCatalogRevision(data) {
  const revisions = data && data.revisions || {};
  return Math.max(0, Number(revisions.catalog || 0));
}

function seedScopeRevision(scope, revision) {
  const state = scopeStreamState(scope);
  const numeric = Number(revision || 0);
  if (Number.isSafeInteger(numeric) && numeric > state.revision) state.revision = numeric;
  return state.revision;
}

function nextScopeRevision(scope, hint) {
  const state = scopeStreamState(scope);
  const numericHint = Number(hint || 0);
  state.revision = Number.isSafeInteger(numericHint) && numericHint > state.revision
    ? numericHint
    : state.revision + 1;
  return state.revision;
}

function rememberScopeEvent(scope, event, payload) {
  const state = scopeStreamState(scope);
  state.history.push({ event, payload });
  if (state.history.length > SSE_HISTORY_LIMIT) state.history.splice(0, state.history.length - SSE_HISTORY_LIMIT);
}

function scopeStreamState(scope) {
  if (!sseStreamState.has(scope)) sseStreamState.set(scope, { revision: 0, history: [] });
  return sseStreamState.get(scope);
}

function parseLastEventId(req) {
  const value = String(req.get && req.get("last-event-id") || "").split(":").pop();
  const revision = Number(value || 0);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function cleanSseClientId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9._:-]{8,128}$/i.test(id) ? id : "";
}

function closeRevisionClient(client, clients, end = true) {
  if (!client) return;
  if (client.heartbeat) clearInterval(client.heartbeat);
  clients.delete(client);
  if (end) {
    try { if (client.res && !client.res.writableEnded) client.res.end(); } catch (_error) {}
  }
}

function validateRecipeUserInput({ name, username, password, requirePassword }) {
  if (!name || name.length < 2) return "Ad soyad en az 2 karakter olmali.";
  if (!username || username.length < 3) return "Kullanici adi en az 3 karakter olmali.";
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return "Kullanici adi sadece kucuk harf, rakam, nokta, tire veya alt tire icermeli.";
  }
  if (requirePassword || password) {
    return validatePassword(password);
  }
  return "";
}

function normalizeRecipeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
}

function publicRecipeUser(user) {
  if (!user) return null;
  const security = publicAccountSecurity(user);
  return {
    id: user.id,
    name: user.name || user.username,
    username: user.username,
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || "",
    active: user.active !== false,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    email: security.email,
    pendingEmail: security.pendingEmail,
    emailVerifiedAt: security.emailVerifiedAt,
    emailVerificationRequired: security.emailVerificationRequired,
    lastPasswordResetAt: security.lastPasswordResetAt,
    personelSectionAccess: normalizePersonelSectionAccess(user.personelSectionAccess),
    security
  };
}

function publicRecipeActivity(items) {
  return (items || []).slice(-300).reverse().map((item) => ({
    id: item.id,
    type: item.type,
    userId: item.userId || "",
    username: item.username || "",
    name: item.name || "",
    category: item.category || "",
    product: item.product || "",
    size: item.size || "",
    panel: item.panel || "",
    assignmentId: item.assignmentId || "",
    assignmentTitle: item.assignmentTitle || "",
    assignmentKind: item.assignmentKind || "",
    status: item.status || "",
    score: Number(item.score || 0) || 0,
    total: Number(item.total || 0) || 0,
    createdAt: item.createdAt || null
  }));
}

function publicRecipeAssignments(items, includeAnswers) {
  return (items || []).slice().reverse().map((item) => publicRecipeAssignment(item, includeAnswers));
}

function publicRecipeAssignment(item, includeAnswers) {
  if (!item) return null;
  return {
    id: item.id,
    userId: item.userId,
    username: item.username || "",
    name: item.name || "",
    title: item.title || `${item.product || "Recete"} / ${item.size || ""}`,
    category: item.category || "",
    product: item.product || "",
    size: item.size || "",
    assignmentKind: normalizeAssignmentKind(item.assignmentKind || item.assignmentType),
    assignmentType: normalizeAssignmentType(item.assignmentType),
    scopeType: normalizeScopeType(item.scopeType),
    recipeItems: normalizeRecipeItemsForPublic(item.recipeItems, item),
    questionCount: normalizeQuestionCount(item.questionCount, (item.questions || []).length || 3),
    difficulty: normalizeDifficulty(item.difficulty),
    passingScore: normalizePassingScore(item.passingScore),
    trainingContent: normalizeTrainingContent(item.trainingContent),
    adminNote: item.adminNote || "",
    status: normalizeAssignmentStatus(item.status),
    score: Number(item.score || 0) || 0,
    total: Number(item.total || (item.questions || []).length) || 0,
    answers: includeAnswers ? (item.answers || []) : undefined,
    viewedItems: item.viewedItems || [],
    completedItems: item.completedItems || [],
    failedItems: item.failedItems || [],
    percent: Number(item.percent || 0) || 0,
    passed: typeof item.passed === "boolean" ? item.passed : null,
    startedAt: item.startedAt || null,
    completedAt: item.completedAt || null,
    reviewedAt: item.reviewedAt || null,
    retryCount: Number(item.retryCount || 0) || 0,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    questions: (item.questions || []).map((question) => ({
      text: question.text,
      options: question.options,
      category: question.category || "",
      product: question.product || "",
      size: question.size || "",
      key: question.key || "",
      questionType: question.questionType || "",
      correctIndex: includeAnswers ? question.correctIndex : undefined
    }))
  };
}

async function recordRecipeActivity({ type, user, username, category, product, size, panel, assignment, status, score, total, req, createdAt }) {
  await store.update((data) => {
    appendRecipeActivity(data, makeRecipeActivity({
      type,
      user,
      username,
      category,
      product,
      size,
      panel,
      assignment,
      status,
      score,
      total,
      req,
      createdAt
    }));
    return data;
  });
}

function appendRecipeActivity(data, item) {
  data.recipeActivity = (data.recipeActivity || []).concat(item).slice(-RECIPE_ACTIVITY_LIMIT);
}

function makeRecipeActivity({ type, user, username, category, product, size, panel, assignment, status, score, total, req, createdAt }) {
  const source = user && typeof user === "object" ? user : {};
  const assignmentSource = assignment && typeof assignment === "object" ? assignment : {};
  return {
    id: `activity-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    type: String(type || "activity").trim().slice(0, 60),
    userId: String(source.id || source.userId || "").trim(),
    username: normalizeRecipeUsername(source.username || username),
    name: String(source.name || "").trim().slice(0, 80),
    category: String(category || "").trim().slice(0, 160),
    product: String(product || "").trim().slice(0, 160),
    size: String(size || "").trim().slice(0, 80),
    panel: String(panel || "").trim().slice(0, 40),
    assignmentId: String(assignmentSource.id || "").trim().slice(0, 80),
    assignmentTitle: String(assignmentSource.title || assignmentSource.product || "").trim().slice(0, 160),
    assignmentKind: assignmentSource.assignmentKind ? normalizeAssignmentKind(assignmentSource.assignmentKind || assignmentSource.assignmentType) : "",
    status: status || assignmentSource.status ? normalizeAssignmentStatus(status || assignmentSource.status) : "",
    score: Math.max(0, Number(score || assignmentSource.score || 0) || 0),
    total: Math.max(0, Number(total || assignmentSource.total || 0) || 0),
    ip: req ? String(req.ip || "").slice(0, 80) : "",
    userAgent: req ? String(req.get("User-Agent") || "").slice(0, 220) : "",
    createdAt: createdAt || new Date().toISOString()
  };
}

function syncRecipeUserReferences(data, user) {
  (data.recipeAssignments || []).forEach((item) => {
    if (item.userId !== user.id) return;
    item.username = user.username;
    item.name = user.name;
  });
  (data.recipeActivity || []).forEach((item) => {
    if (item.userId !== user.id) return;
    item.username = user.username;
    item.name = user.name;
  });
}

function normalizeAssignmentType(value) {
  const type = String(value || "").trim();
  if (type === "training_quiz" || type === "retraining") return type;
  return "quiz";
}

function normalizeAssignmentKind(value) {
  const kind = String(value || "").trim();
  if (["quick_quiz", "training", "homework", "exam", "retraining"].includes(kind)) return kind;
  if (kind === "training_quiz") return "retraining";
  return "quick_quiz";
}

function normalizeScopeType(value) {
  const scopeType = String(value || "").trim();
  if (["all", "category", "products", "failed_items"].includes(scopeType)) return scopeType;
  return "products";
}

function normalizeQuestionCount(value, fallback) {
  const count = Number(value);
  if (!Number.isFinite(count)) return Math.max(1, Math.min(30, Number(fallback || 3) || 3));
  return Math.max(1, Math.min(30, Math.round(count)));
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "").trim();
  if (["easy", "normal", "hard"].includes(difficulty)) return difficulty;
  return "normal";
}

function normalizeAssignmentStatus(value) {
  const status = String(value || "").trim();
  if (["pending", "in_progress", "completed", "failed", "retry_required"].includes(status)) {
    return status;
  }
  return "pending";
}

function normalizePassingScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 70;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeTrainingContent(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    generatedFromRecipe: source.generatedFromRecipe !== false,
    productName: String(source.productName || "").trim().slice(0, 160),
    category: String(source.category || "").trim().slice(0, 160),
    size: String(source.size || "").trim().slice(0, 80),
    shortDescription: String(source.shortDescription || "").trim().slice(0, 600),
    criticalMeasures: normalizeTextList(source.criticalMeasures, 8, 180),
    preparationSteps: normalizeTextList(source.preparationSteps, 12, 220),
    cautions: normalizeTextList(source.cautions, 8, 220),
    commonMistakes: normalizeTextList(source.commonMistakes, 8, 220),
    adminNote: String(source.adminNote || "").trim().slice(0, 1000),
    items: normalizeTrainingItems(source.items)
  };
}

function normalizeTextList(value, limit, itemLimit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim().slice(0, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeTrainingItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const category = String(source.category || "").trim().slice(0, 160);
      const product = String(source.product || "").trim().slice(0, 160);
      const size = String(source.size || "").trim().slice(0, 80);
      if (!category || !product || !size) return null;
      return {
        key: source.key || recipeItemKey({ category, product, size }),
        category,
        product,
        size,
        content: normalizeTextList(source.content, 12, 220),
        preparation: normalizeTextList(source.preparation, 12, 220)
      };
    })
    .filter(Boolean)
    .slice(0, 120);
}

function buildRecipeTrainingContent(recipeValue, target) {
  const recipe = normalizeRecipeForQuestion(recipeValue);
  const contentSteps = splitTrainingText(recipe.content);
  const preparationSteps = splitTrainingText(recipe.preparation);
  const missingText = "Belirsiz / Yönetici tarafından tamamlanmalı";
  const shortDescription = contentSteps[0] || recipe.content || missingText;
  return normalizeTrainingContent({
    generatedFromRecipe: true,
    productName: target.product,
    category: target.category,
    size: target.size,
    shortDescription,
    criticalMeasures: uniqueStrings([target.size].concat(contentSteps)).slice(0, 6),
    preparationSteps: preparationSteps.length ? preparationSteps : [missingText],
    cautions: [missingText],
    commonMistakes: [missingText],
    adminNote: target.adminNote || ""
  });
}

function splitTrainingText(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  return text
    .split(/\n+|;\s+|\s+-\s+|\s+\+\s+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function resolveAssignmentTargets(data, options) {
  const recipeState = data.recipeState || {};
  const allEntries = recipeEntries(recipeState);
  const scopeType = normalizeScopeType(options.scopeType);
  let targets = [];

  if (scopeType === "all") {
    targets = allEntries;
  } else if (scopeType === "category") {
    targets = allEntries.filter((item) => item.category === options.category);
  } else if (scopeType === "failed_items") {
    const failedKeys = new Set();
    (data.recipeAssignments || []).forEach((assignment) => {
      if (assignment.userId !== options.userId) return;
      (assignment.failedItems || []).forEach((item) => {
        if (item && item.key) failedKeys.add(item.key);
        else if (item) failedKeys.add(recipeItemKey(item));
      });
    });
    targets = allEntries.filter((item) => failedKeys.has(item.key));
  } else {
    const selected = normalizeSelectedProducts(options.selectedProducts);
    if (!selected.length && options.category && options.product && options.size) {
      selected.push({
        category: options.category,
        product: options.product,
        size: options.size
      });
    }
    const selectedKeys = new Set(selected.map(recipeItemKey));
    targets = allEntries.filter((item) => selectedKeys.has(item.key));
  }

  return uniqueRecipeEntries(targets);
}

function recipeEntries(recipeState) {
  const entries = [];
  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, recipe] of Object.entries(sizes || {})) {
        if (!category || !product || !size) continue;
        entries.push({
          key: recipeItemKey({ category, product, size }),
          category,
          product,
          size,
          recipe
        });
      }
    }
  }
  return entries;
}

function normalizeSelectedProducts(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const category = String(source.category || "").trim();
      const product = String(source.product || "").trim();
      const size = String(source.size || "").trim();
      return category && product && size ? { category, product, size } : null;
    })
    .filter(Boolean)
    .slice(0, 120);
}

function uniqueRecipeEntries(entries) {
  const seen = new Set();
  return (entries || []).filter((item) => {
    if (!item || !item.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function publicRecipeItem(item) {
  return {
    key: item.key || recipeItemKey(item),
    category: item.category || "",
    product: item.product || "",
    size: item.size || ""
  };
}

function recipeItemKey(item) {
  return [item.category, item.product, item.size].map((part) => String(part || "").trim()).join("::");
}

function normalizeRecipeItemsForPublic(items, fallback) {
  const normalized = Array.isArray(items)
    ? items.map((item) => {
      const source = item && typeof item === "object" ? item : {};
      const category = String(source.category || "").trim();
      const product = String(source.product || "").trim();
      const size = String(source.size || "").trim();
      return category && product && size ? publicRecipeItem({ category, product, size }) : null;
    }).filter(Boolean)
    : [];
  if (normalized.length) return normalized;
  if (fallback && fallback.category && fallback.product && fallback.size) {
    return [publicRecipeItem(fallback)];
  }
  return [];
}

function assignmentTitleFor({ assignmentKind, scopeType, category, product, size, count }) {
  const kindLabel = {
    quick_quiz: "Hizli Quiz",
    training: "Egitim Paketi",
    homework: "Calisma Odevi",
    exam: "Hakimiyet Sinavi",
    retraining: "Tekrar Egitimi"
  }[assignmentKind] || "Gorev";
  if (scopeType === "all") return `${kindLabel} / Tum receteler`;
  if (scopeType === "category") return `${kindLabel} / ${category || "Kategori"}`;
  if (count > 1) return `${kindLabel} / ${count} recete`;
  return `${kindLabel} / ${product || "Recete"} / ${size || ""}`.trim();
}

function buildAssignmentTrainingContent(recipeState, targets, options = {}) {
  return {
    generatedFromRecipe: true,
    productName: targets.length === 1 ? targets[0].product : `${targets.length} recete`,
    category: targets.length === 1 ? targets[0].category : "Karma",
    size: targets.length === 1 ? targets[0].size : "Coklu",
    shortDescription: "Bu egitim icerigi recete verisinden otomatik olusturuldu.",
    criticalMeasures: targets.map((item) => `${item.product} / ${item.size}`).slice(0, 12),
    preparationSteps: targets.flatMap((item) => {
      const recipe = normalizeRecipeForQuestion(item.recipe);
      return splitTrainingText(recipe.preparation).map((step) => `${item.product}: ${step}`);
    }).slice(0, 18),
    cautions: ["Belirsiz / Yönetici tarafından tamamlanmalı"],
    commonMistakes: ["Belirsiz / Yönetici tarafından tamamlanmalı"],
    adminNote: String(options.adminNote || "").trim().slice(0, 1000),
    items: targets.map((item) => {
      const recipe = normalizeRecipeForQuestion(recipeState[item.category][item.product][item.size]);
      return {
        key: item.key,
        category: item.category,
        product: item.product,
        size: item.size,
        content: splitTrainingText(recipe.content),
        preparation: splitTrainingText(recipe.preparation),
        note: splitTrainingText(recipe.note)
      };
    })
  };
}

function assignmentAssignedEvent(kind) {
  return {
    quick_quiz: "assignment_created",
    training: "training_assigned",
    homework: "homework_assigned",
    exam: "exam_assigned",
    retraining: "retry_training_suggested"
  }[normalizeAssignmentKind(kind)] || "assignment_created";
}

function assignmentStartedEvent(kind) {
  return {
    quick_quiz: "assignment_started",
    training: "training_started",
    homework: "homework_started",
    exam: "exam_started",
    retraining: "training_started"
  }[normalizeAssignmentKind(kind)] || "assignment_started";
}

function assignmentCompletedEvent(kind, passed) {
  if (normalizeAssignmentKind(kind) === "exam") return passed ? "exam_completed" : "exam_failed";
  if (normalizeAssignmentKind(kind) === "retraining") return passed ? "training_completed" : "exam_failed";
  return passed ? "assignment_completed" : "assignment_retry_required";
}

function buildRecipeAssignmentQuestions(recipeState, target) {
  const targets = uniqueRecipeEntries((target.targets || []).length ? target.targets : recipeEntries(recipeState).slice(0, 1));
  const allEntries = recipeEntries(recipeState);
  const questionCount = normalizeQuestionCount(target.questionCount, 3);
  const questionPool = [];

  targets.forEach((entry) => {
    const recipe = normalizeRecipeForQuestion(entry.recipe);
    const contentTerms = extractQuestionTerms(recipe.content);
    const preparationTerms = extractQuestionTerms(recipe.preparation);
    const otherTerms = collectRecipeQuestionTerms(recipeState, entry);
    const otherProducts = collectRecipeProducts(recipeState, entry);

    if (contentTerms.length) {
      questionPool.push(makeQuestion(
        `${entry.product} / ${entry.size} icin dogru icerik hangisidir?`,
        contentTerms[0],
        otherTerms,
        entry,
        "content"
      ));
      questionPool.push(makeQuestion(
        `${entry.product} / ${entry.size} recetesinde eksik kalan icerik hangisidir?`,
        contentTerms[contentTerms.length > 1 ? 1 : 0],
        otherTerms,
        entry,
        "missing_content"
      ));
      const wrongTerm = otherTerms.find((term) => !contentTerms.some((item) => normalizeComparable(item) === normalizeComparable(term)));
      if (wrongTerm) {
        questionPool.push(makeQuestion(
          `${entry.product} / ${entry.size} icin yanlis icerik hangisidir?`,
          wrongTerm,
          contentTerms,
          entry,
          "wrong_content"
        ));
      }
      questionPool.push(makeQuestion(
        `"${contentTerms[0]}" icerigi hangi urune aittir?`,
        entry.product,
        otherProducts,
        entry,
        "content_to_product"
      ));
      questionPool.push(makeTrueFalseQuestion(
        `${entry.product} / ${entry.size} recetesinde "${contentTerms[0]}" bilgisi dogrudur.`,
        true,
        entry,
        "true_false_recipe"
      ));
    }

    if (preparationTerms.length) {
      questionPool.push(makeQuestion(
        `${entry.product} / ${entry.size} hazirlanisinda dogru adim hangisidir?`,
        preparationTerms[0],
        otherTerms.concat(contentTerms),
        entry,
        "preparation"
      ));
      questionPool.push(makeQuestion(
        `"${preparationTerms[0]}" hazirlanis adimi hangi urune aittir?`,
        entry.product,
        otherProducts,
        entry,
        "preparation_to_product"
      ));
    }
  });

  while (questionPool.filter(Boolean).length < questionCount && allEntries.length) {
    const entry = allEntries[questionPool.length % allEntries.length];
    questionPool.push(makeQuestion(
      `${entry.product} / ${entry.size} icin dogru recete bilgisi hangisidir?`,
      entry.product,
      collectRecipeProducts(recipeState, entry),
      entry,
      "recipe_product"
    ));
  }

  return orderQuestionsForDifficulty(questionPool.filter(Boolean), target.difficulty).slice(0, questionCount);
}

function orderQuestionsForDifficulty(questions, difficulty) {
  const level = normalizeDifficulty(difficulty);
  if (level === "normal") return shuffle(questions);
  const priority = level === "easy"
    ? ["content", "preparation", "true_false_recipe", "missing_content"]
    : ["wrong_content", "content_to_product", "preparation_to_product", "missing_content"];
  const rank = (question) => {
    const index = priority.indexOf(question.questionType);
    return index === -1 ? priority.length : index;
  };
  return shuffle(questions).sort((a, b) => rank(a) - rank(b));
}

function makeQuestion(text, correct, candidates, target, questionType) {
  const correctText = String(correct || "").trim();
  if (!correctText) return null;

  const fallback = [
    "Double shot espresso",
    "Soguk sut",
    "Buz",
    "3 dakika",
    "Krema",
    "Filtre kahve",
    "Kakao"
  ];
  const options = uniqueStrings([correctText].concat(candidates || [], fallback))
    .filter((item) => normalizeComparable(item) !== normalizeComparable(correctText))
    .slice(0, 2);

  while (options.length < 2) {
    options.push(`Secenek ${options.length + 2}`);
  }

  const allOptions = shuffle([correctText].concat(options)).slice(0, 3);
  return {
    text,
    options: allOptions,
    correctIndex: allOptions.findIndex((item) => normalizeComparable(item) === normalizeComparable(correctText)),
    category: target && target.category || "",
    product: target && target.product || "",
    size: target && target.size || "",
    key: target && target.key || "",
    questionType: questionType || ""
  };
}

function makeTrueFalseQuestion(text, correct, target, questionType) {
  return {
    text,
    options: ["Dogru", "Yanlis", "Belirsiz"],
    correctIndex: correct ? 0 : 1,
    category: target && target.category || "",
    product: target && target.product || "",
    size: target && target.size || "",
    key: target && target.key || "",
    questionType: questionType || "true_false_recipe"
  };
}

function failedItemFromQuestion(question, selectedIndex) {
  if (!question || !question.category || !question.product || !question.size) return null;
  const options = Array.isArray(question.options) ? question.options : [];
  return {
    key: question.key || recipeItemKey(question),
    category: question.category,
    product: question.product,
    size: question.size,
    question: question.text || "",
    selected: options[Number(selectedIndex)] || "",
    correct: options[Number(question.correctIndex)] || ""
  };
}

function normalizeRecipeForQuestion(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const preparation = String(value.preparation || value.method || value.steps || value.description || "").trim();
    return {
      content: String(value.content || value.recipe || value.ingredients || "").trim(),
      preparation,
      note: String(value.note || value.productNote || "").trim()
    };
  }
  return {
    content: String(value || "").trim(),
    preparation: "",
    note: ""
  };
}

function collectRecipeQuestionTerms(recipeState, target) {
  const terms = [];
  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, recipe] of Object.entries(sizes || {})) {
        if (category === target.category && product === target.product && size === target.size) continue;
        const item = normalizeRecipeForQuestion(recipe);
        terms.push(...extractQuestionTerms(item.content), ...extractQuestionTerms(item.preparation));
      }
    }
  }
  return terms;
}

function collectRecipeProducts(recipeState, target) {
  const products = [];
  for (const categoryProducts of Object.values(recipeState || {})) {
    products.push(...Object.keys(categoryProducts || {}));
  }
  return products.filter((product) => product !== target.product);
}

function extractQuestionTerms(text) {
  return uniqueStrings(String(text || "")
    .split(/\n+|;|\+|\s+-\s+|,|\//g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 80)
    .filter((part) => !/kaynakta yok|hen.?z girilmedi/i.test(part)))
    .slice(0, 8);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const text = String(value || "").trim();
    const key = normalizeComparable(text);
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function normalizeComparable(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function shuffle(values) {
  const list = values.slice();
  for (let index = list.length - 1; index > 0; index -= 1) {
    const next = crypto.randomInt(0, index + 1);
    [list[index], list[next]] = [list[next], list[index]];
  }
  return list;
}

function parseMediaUploadBody(req, res, next) {
  return String(req.header("X-Media-Kind") || "").toLowerCase() === "video"
    ? videoMediaParser(req, res, next)
    : imageMediaParser(req, res, next);
}

function validateMediaUpload(req) {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) {
    const error = new Error("Medya dosyasi gerekli.");
    error.status = 400;
    throw error;
  }

  const kind = String(req.header("X-Media-Kind") || "").toLowerCase();
  if (!['image', 'video'].includes(kind)) {
    const error = new Error("Medya turu image veya video olmali.");
    error.status = 400;
    throw error;
  }
  const contentType = String(req.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const originalName = decodeHeaderValue(req.header("X-File-Name")) || (kind === "image" ? "image" : "video");
  const ext = mediaExtension(kind, contentType, originalName);
  const maxBytes = kind === "image" ? 15 * 1024 * 1024 : 120 * 1024 * 1024;

  if (body.length > maxBytes) {
    const error = new Error(kind === "image" ? "Gorsel en fazla 15 MB olabilir." : "Video en fazla 120 MB olabilir.");
    error.status = 413;
    throw error;
  }

  if (!ext) {
    const error = new Error(kind === "image"
      ? "Desteklenmeyen gorsel formati."
      : "Desteklenmeyen video formati. MP4 veya WebM kullanin.");
    error.status = 400;
    throw error;
  }

  if (!contentType.startsWith(`${kind}/`)) {
    const error = new Error("Medya turu dosya tipiyle uyusmuyor.");
    error.status = 400;
    throw error;
  }

  const mimeExtension = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm"
  }[contentType];
  if (!mimeExtension || mimeExtension !== ext) {
    const error = new Error("Dosya uzantisi ile MIME turu uyusmuyor.");
    error.status = 400;
    throw error;
  }

  if (!matchesMediaSignature(body, ext)) {
    const error = new Error("Dosya icerigi bildirilen medya formatıyla uyusmuyor.");
    error.status = 400;
    throw error;
  }

  const id = `${kind}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return {
    id,
    kind,
    originalName,
    contentType,
    fileName: `${id}${ext}`
  };
}

function validateProfileAvatarUpload(req) {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) {
    const error = new Error("Profil fotoğrafı gerekli.");
    error.status = 400;
    throw error;
  }
  if (body.length > 10 * 1024 * 1024) {
    const error = new Error("Profil fotoğrafı en fazla 10 MB olabilir.");
    error.status = 413;
    throw error;
  }

  const contentType = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const originalName = decodeHeaderValue(req.header("X-File-Name")) || "profile";
  const extByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
  };
  const extByName = path.extname(originalName).toLowerCase() === ".jpeg"
    ? ".jpg"
    : path.extname(originalName).toLowerCase();
  const ext = extByMime[contentType] || extByName;

  if (![".jpg", ".png", ".webp"].includes(ext) || !extByMime[contentType]) {
    const error = new Error("JPG, PNG veya WEBP profil fotoğrafı yükleyin.");
    error.status = 400;
    throw error;
  }
  if (!extByName || extByName !== ext) {
    const error = new Error("Dosya uzantısı ile MIME türü uyuşmuyor.");
    error.status = 400;
    throw error;
  }
  if (!matchesMediaSignature(body, ext)) {
    const error = new Error("Dosya içeriği profil fotoğrafı formatıyla uyuşmuyor.");
    error.status = 400;
    throw error;
  }

  return {
    contentType,
    fileName: `profile-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`
  };
}

async function removeOldProfileAvatar(oldAvatarPath, nextAvatarPath) {
  const oldName = path.basename(String(oldAvatarPath || ""));
  if (!oldName || oldAvatarPath === nextAvatarPath || !oldAvatarPath.startsWith("/media/profile-") || !isSafeMediaFileName(oldName)) return;
  try {
    await fs.unlink(path.join(config.mediaDir, oldName));
  } catch (_error) {}
}

function normalizeFeedbackItem(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = normalizeFeedbackType(source.type);
  const text = String(source.text || "").trim().slice(0, 1200);
  const favorite = String(source.favorite || source.favoriteDrink || "").trim().slice(0, 120);
  const rating = Math.max(0, Math.min(5, Number(source.rating || 0) || 0));
  if (!text && !favorite && !rating) return null;
  return {
    id: String(source.id || `feedback-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`).trim(),
    createdAt: String(source.createdAt || new Date().toISOString()),
    type,
    text: text || (type === "favori" ? "Favori icecek bildirimi" : "Puanlama kaydi"),
    favorite,
    rating
  };
}

function normalizeFeedbackType(value) {
  const type = String(value || "").toLowerCase().trim();
  if (type === "sikayet" || type === "şikayet") return "sikayet";
  if (type === "oneri" || type === "öneri") return "oneri";
  if (type === "favori" || type === "favorite") return "favori";
  if (type === "puanlama" || type === "rating") return "puanlama";
  return "istek";
}

function mediaExtension(kind, contentType, originalName) {
  const allowed = kind === "image"
    ? new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"])
    : new Set([".mp4", ".webm"]);
  const fromName = path.extname(String(originalName || "")).toLowerCase();
  const normalizedNameExtension = fromName === ".jpeg" ? ".jpg" : fromName;
  if (!allowed.has(fromName)) return "";

  const byType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm"
  };
  const ext = byType[contentType];
  return allowed.has(ext) && ext === normalizedNameExtension ? ext : "";
}

function matchesMediaSignature(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (extension === ".jpg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === ".gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (extension === ".mp4") return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  if (extension === ".webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

function serveMediaFile(req, res, next) {
  const name = String(req.params && req.params.name || "");
  if (!isSafeMediaFileName(name)) return notFound(req, res);
  const extension = path.extname(name).toLowerCase();
  const contentType = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
  }[extension];
  if (!contentType) return notFound(req, res);
  res.set({
    "Cache-Control": config.isProduction ? "public, max-age=2592000, immutable" : "no-cache",
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff"
  });
  return res.sendFile(path.join(config.mediaDir, name), (error) => {
    if (!error) return;
    if (error.code === "ENOENT") return notFound(req, res);
    return next(error);
  });
}

function isSafeMediaFileName(value) {
  const name = String(value || "");
  return /^[a-z0-9][a-z0-9._-]{2,180}$/i.test(name)
    && path.basename(name) === name
    && new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"]).has(path.extname(name).toLowerCase());
}

function decodeHeaderValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (_error) {
    return text;
  }
}

function absoluteUrl(req, pathname) {
  const origin = req.header("Origin");
  if (origin) {
    try {
      return new URL(pathname, origin).toString();
    } catch (_error) {}
  }

  return `${req.protocol}://${req.get("host")}${pathname}`;
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  if (firstBuffer.length !== secondBuffer.length) return false;

  return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function revokeStoredSessions(data, predicate, revokedAt = new Date().toISOString()) {
  data.authSessions = (Array.isArray(data.authSessions) ? data.authSessions : []).map((session) => {
    if (!session || session.revokedAt || !predicate(session)) return session;
    return { ...session, revokedAt };
  });
}

function workforceLifecycleRequestId(req) {
  const value = String(
    req.header("Idempotency-Key")
    || req.header("X-Request-ID")
    || req.body && req.body.requestId
    || ""
  ).trim().slice(0, 160);
  if (value && !/^[a-zA-Z0-9._:-]{8,160}$/.test(value)) {
    const error = new Error("Geçerli bir requestId veya Idempotency-Key gerekli.");
    error.status = 400;
    throw error;
  }
  return value;
}

function lifecycleReplay(data, operation, requestId) {
  if (!requestId) return null;
  const entries = Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : [];
  const match = entries.find((item) => item && item.scope === "personnel_lifecycle" && item.operation === operation && item.requestId === requestId);
  if (match) return match.response || null;
  if (entries.some((item) => item && item.scope === "personnel_lifecycle" && item.requestId === requestId)) {
    const error = new Error("Bu requestId daha önce farklı bir personel işlemi için kullanıldı.");
    error.status = 409;
    throw error;
  }
  return null;
}

function assertLifecycleExpectedRevision(data, body) {
  if (!body || body.expectedRevision === undefined || body.expectedRevision === null || body.expectedRevision === "") return;
  const expected = Number(body.expectedRevision);
  const current = Math.max(0, Number(data.revisions && data.revisions.workforce || 0));
  if (!Number.isInteger(expected) || expected < 0) {
    const error = new Error("Geçerli bir expectedRevision gerekli.");
    error.status = 400;
    throw error;
  }
  if (expected !== current) {
    const error = new Error("Personel verisi başka bir işlem tarafından güncellendi. Verileri yenileyip tekrar deneyin.");
    error.status = 409;
    error.code = "WORKFORCE_REVISION_CONFLICT";
    error.currentRevision = current;
    throw error;
  }
}

function rememberLifecycleResponse(data, operation, requestId, response, createdAt) {
  if (!requestId) return;
  data.idempotencyRequests = (Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : []).concat({
    scope: "personnel_lifecycle",
    operation,
    requestId,
    response: structuredClone(response),
    createdAt
  }).slice(-500);
}

function touchWorkforceRevision(data) {
  if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) data.revisions = {};
  data.revisions.workforce = Math.max(0, Number(data.revisions.workforce || 0)) + 1;
  return data.revisions.workforce;
}

function preserveDeletedPersonnelReferences(data, user, deletedAt) {
  const userId = String(user && user.id || "");
  const snapshot = {
    personDeleted: true,
    personNameSnapshot: String(user && (user.name || user.username) || "Silinmiş personel"),
    personUsernameSnapshot: String(user && user.username || ""),
    personDeletedAt: deletedAt
  };
  for (const assignment of data.workforceAssignments || []) {
    if (String(assignment.userId || assignment.personnelId || "") !== userId) continue;
    assignment.userName = assignment.userName || snapshot.personNameSnapshot;
    assignment.username = assignment.username || snapshot.personUsernameSnapshot;
    Object.assign(assignment, snapshot);
  }
  for (const shipment of data.workforceShipments || []) {
    if (String(shipment.userId || shipment.personnelId || "") !== userId) continue;
    shipment.userName = shipment.userName || snapshot.personNameSnapshot;
    Object.assign(shipment, snapshot);
  }
  for (const request of data.workforceShiftRequests || []) {
    if (String(request.personId || request.personnelId || "") !== userId) continue;
    request.personName = request.personName || snapshot.personNameSnapshot;
    Object.assign(request, snapshot);
  }
  for (const plan of data.workforceShiftPlans || []) {
    if (String(plan.personId || plan.personnelId || "") !== userId) continue;
    plan.personName = plan.personName || snapshot.personNameSnapshot;
    Object.assign(plan, snapshot);
  }
  for (const revision of data.workforceShiftPlanRevisions || []) {
    for (const plan of revision.plans || []) {
      if (String(plan.personId || plan.personnelId || "") !== userId) continue;
      plan.personName = plan.personName || snapshot.personNameSnapshot;
      Object.assign(plan, snapshot);
    }
  }
  const stockState = data.stockState && typeof data.stockState === "object" ? data.stockState : {};
  for (const movement of stockState.movements || []) {
    if (String(movement.personnelId || movement.userId || "") !== userId) continue;
    Object.assign(movement, snapshot);
  }
}

module.exports = {
  app,
  installGracefulShutdown,
  notificationService,
  prepareRuntime,
  sanitizeLogLine,
  shutdownRuntime,
  startServer,
  store
};
