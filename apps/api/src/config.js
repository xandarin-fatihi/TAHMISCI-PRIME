"use strict";
// Developer: Uzeyir | System Key: xandar | Environment contract marker

const crypto = require("crypto");
const net = require("net");
const path = require("path");
const { isKnownLocalCredential, isKnownLocalDataPath } = require("./local-development");

const nodeEnv = String(process.env.NODE_ENV || "development").trim();
const isProduction = nodeEnv === "production";

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const backendRoot = path.resolve(__dirname, "..");

const config = {
  nodeEnv,
  isProduction,
  port: toPort(process.env.PORT, 8080),
  projectRoot,
  backendRoot,
  dataFile: process.env.DATA_FILE
    ? path.resolve(process.env.DATA_FILE)
    : path.join(projectRoot, "storage", "local", "store.json"),
  mediaDir: process.env.MEDIA_DIR
    ? path.resolve(process.env.MEDIA_DIR)
    : path.join(projectRoot, "storage", "media"),
  procurementDocumentsDir: process.env.PROCUREMENT_DOCUMENTS_DIR
    ? path.resolve(process.env.PROCUREMENT_DOCUMENTS_DIR)
    : process.env.DATA_FILE
      ? path.join(path.dirname(path.resolve(process.env.DATA_FILE)), "procurement-documents")
      : path.join(projectRoot, "storage", "local", "procurement-documents"),
  procurementMaxUploadBytes: clampInt(
    process.env.PROCUREMENT_MAX_UPLOAD_BYTES,
    10 * 1024 * 1024,
    256 * 1024,
    25 * 1024 * 1024
  ),
  mainDomain: clean(process.env.MAIN_DOMAIN),
  adminDomain: clean(process.env.ADMIN_DOMAIN),
  publicRootUrl: clean(process.env.PUBLIC_ROOT_URL) || clean(process.env.PUBLIC_SITE_URL),
  // Backward-compatible alias; this value is the public origin, not /site/.
  publicSiteUrl: clean(process.env.PUBLIC_ROOT_URL) || clean(process.env.PUBLIC_SITE_URL),
  websitePath: normalizePublicPath(process.env.WEBSITE_PATH, "/site/"),
  qrMenuPath: normalizePublicPath(process.env.QR_MENU_PATH, "/"),
  mudavimPath: normalizePublicPath(process.env.MUDAVIM_PATH, "/mudavim/"),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  jwtSecret: clean(process.env.JWT_SECRET),
  jwtIssuer: clean(process.env.JWT_ISSUER) || "tahmisci-backend",
  jwtAudience: clean(process.env.JWT_AUDIENCE) || "tahmisci-admin",
  managerKey: clean(process.env.PASSWORD_MANAGER_KEY),
  passwordResetEmail: clean(process.env.PASSWORD_RESET_EMAIL).toLowerCase(),
  passwordResetCodeTtlMinutes: clampInt(process.env.PASSWORD_RESET_CODE_TTL_MINUTES, 10, 3, 30),
  passwordResetResendSeconds: clampInt(process.env.PASSWORD_RESET_RESEND_SECONDS, 60, 15, 3600),
  passwordResetMaxAttempts: clampInt(process.env.PASSWORD_RESET_MAX_ATTEMPTS, 5, 1, 10),
  passwordResetTestCode: nodeEnv === "test" ? clean(process.env.PASSWORD_RESET_TEST_CODE) : "",
  emailVerificationTtlMinutes: clampInt(process.env.EMAIL_VERIFICATION_TTL_MINUTES, 15, 3, 30),
  emailVerificationResendSeconds: clampInt(process.env.EMAIL_VERIFICATION_RESEND_SECONDS, 60, 15, 3600),
  emailVerificationMaxAttempts: clampInt(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS, 5, 1, 10),
  smtpHost: clean(process.env.SMTP_HOST) || "smtp.gmail.com",
  smtpPort: toPort(process.env.SMTP_PORT, 465),
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, true),
  smtpUser: clean(process.env.SMTP_USER),
  smtpPass: clean(process.env.SMTP_PASS),
  smtpFrom: clean(process.env.SMTP_FROM),
  notificationsEmailEnabled: parseBoolean(process.env.NOTIFICATIONS_EMAIL_ENABLED, false),
  notificationsManagerEmail: clean(process.env.NOTIFICATIONS_MANAGER_EMAIL).toLowerCase(),
  vapidSubject: clean(process.env.VAPID_SUBJECT) || "mailto:notifications@tahmiscicoffee.com",
  vapidPublicKey: clean(process.env.VAPID_PUBLIC_KEY),
  vapidPrivateKey: clean(process.env.VAPID_PRIVATE_KEY),
  notificationWorkersEnabled: parseBoolean(process.env.NOTIFICATION_WORKERS_ENABLED, nodeEnv !== "test"),
  notificationWorkerIntervalMs: clampInt(process.env.NOTIFICATION_WORKER_INTERVAL_MS, 15000, 1000, 300000),
  notificationReminderIntervalMs: clampInt(process.env.NOTIFICATION_REMINDER_INTERVAL_MS, 60000, 30000, 3600000),
  notificationMaxAttempts: clampInt(process.env.NOTIFICATION_MAX_ATTEMPTS, 5, 1, 20),
  performanceServerTiming: parseBoolean(process.env.PERFORMANCE_SERVER_TIMING, true),
  performanceDebug: parseBoolean(process.env.PERFORMANCE_DEBUG, false),
  performanceSlowRequestMs: clampInt(process.env.PERFORMANCE_SLOW_REQUEST_MS, 250, 50, 10000),
  storeExternalCheckIntervalMs: clampInt(process.env.STORE_EXTERNAL_CHECK_INTERVAL_MS, 1000, 100, 60000),
  eventLoopDelayResolutionMs: clampInt(process.env.EVENT_LOOP_DELAY_RESOLUTION_MS, 20, 10, 100),
  defaultPanelPassword: clean(process.env.DEFAULT_PANEL_PASSWORD),
  defaultRecipePassword: clean(process.env.DEFAULT_RECIPE_PASSWORD),
  bcryptRounds: clampInt(process.env.BCRYPT_ROUNDS, 12, 10, 14),
  adminCookieName: clean(process.env.ADMIN_COOKIE_NAME) || "tahmisci_admin_session",
  recipeCookieName: clean(process.env.RECIPE_COOKIE_NAME) || "tahmisci_recipe_session",
  mudavimCookieName: clean(process.env.MUDAVIM_COOKIE_NAME) || "tahmisci_mudavim_session",
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, isProduction),
  cookieSameSite: (clean(process.env.COOKIE_SAME_SITE) || "lax").toLowerCase(),
  allowLocalhostOrigins: parseBoolean(process.env.ALLOW_LOCALHOST_ORIGINS, !isProduction),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, isProduction ? 1 : false),
  apiJsonLimitBytes: clampInt(process.env.API_JSON_LIMIT_KB, 1024, 64, 4096) * 1024,
  apiUrlEncodedLimitBytes: clampInt(process.env.API_URLENCODED_LIMIT_KB, 64, 16, 256) * 1024
};

if (!config.jwtSecret && !isProduction) {
  config.jwtSecret = crypto.randomBytes(48).toString("hex");
  console.warn("JWT_SECRET is not set. A temporary development secret was generated for this process.");
}

if (!config.allowedOrigins.length) {
  config.allowedOrigins = derivedAllowedOrigins(config);
}

function validateConfig() {
  const errors = [];

  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    errors.push("JWT_SECRET en az 32 karakterlik rastgele bir deger olmali.");
  }

  if (config.isProduction && !config.allowedOrigins.length) {
    errors.push("Production ortaminda ALLOWED_ORIGINS veya MAIN_DOMAIN/ADMIN_DOMAIN zorunludur.");
  }

  if (config.isProduction && config.allowedOrigins.includes("*")) {
    errors.push("Production ortaminda ALLOWED_ORIGINS icinde * kullanilmamali.");
  }

  if (config.isProduction && !config.mainDomain) {
    errors.push("Production ortaminda MAIN_DOMAIN zorunludur.");
  }

  if (config.isProduction && !config.adminDomain) {
    errors.push("Production ortaminda ADMIN_DOMAIN zorunludur.");
  }

  if (config.isProduction && (!config.managerKey || config.managerKey.length < 32)) {
    errors.push("Production ortaminda PASSWORD_MANAGER_KEY en az 32 karakter olmali.");
  }

  if (config.isProduction && /^(1|true|yes|on)$/i.test(String(process.env.TAHMISCI_LOCAL_DEV || ""))) {
    errors.push("Production ortaminda TAHMISCI_LOCAL_DEV kullanilamaz.");
  }

  if (config.isProduction && [config.dataFile, config.mediaDir].some(isKnownLocalDataPath)) {
    errors.push("Production ortaminda local-dev/local-smoke veri yollari kullanilamaz.");
  }

  if (config.isProduction && (!clean(process.env.DATA_FILE) || !clean(process.env.MEDIA_DIR))) {
    errors.push("Production ortaminda kalici DATA_FILE ve MEDIA_DIR yollari acikca tanimlanmali.");
  }

  if (config.isProduction && !clean(process.env.PROCUREMENT_DOCUMENTS_DIR)) {
    errors.push("Production ortaminda kalici PROCUREMENT_DOCUMENTS_DIR yolu acikca tanimlanmali.");
  }

  if (config.isProduction && clean(process.env.PROCUREMENT_DOCUMENTS_DIR) && !path.isAbsolute(clean(process.env.PROCUREMENT_DOCUMENTS_DIR))) {
    errors.push("Production ortaminda PROCUREMENT_DOCUMENTS_DIR mutlak bir yol olmali.");
  }

  if (config.isProduction && [config.dataFile, config.mediaDir].some(isTemporaryProjectPath)) {
    errors.push("Production ortaminda repository icindeki gecici/local veri yollari kullanilamaz.");
  }

  if (config.isProduction && isPathInside(projectRoot, config.procurementDocumentsDir)) {
    errors.push("Production ortaminda PROCUREMENT_DOCUMENTS_DIR repository disinda kalici bir dizin olmali.");
  }

  if (pathsOverlap(config.procurementDocumentsDir, config.mediaDir)) {
    errors.push("PROCUREMENT_DOCUMENTS_DIR public MEDIA_DIR ile ayni veya ic ice olamaz.");
  }

  if (config.isProduction && [config.defaultPanelPassword, config.defaultRecipePassword, config.jwtSecret, config.managerKey].some(isKnownLocalCredential)) {
    errors.push("Production ortaminda bilinen lokal gelistirme bilgileri kullanilamaz.");
  }

  if (config.isProduction && [config.defaultPanelPassword, config.defaultRecipePassword, config.jwtSecret, config.managerKey].filter(Boolean).some(isPlaceholderCredential)) {
    errors.push("Production ortaminda ornek/varsayilan credential degerleri kullanilamaz.");
  }

  if (config.isProduction && config.trustProxy === true) {
    errors.push("Production ortaminda TRUST_PROXY=true yerine guvenilen proxy sayisi veya agi belirtilmeli.");
  }

  if (config.isProduction && !clean(process.env.TRUST_PROXY)) {
    errors.push("Production ortaminda TRUST_PROXY acikca false, proxy sayisi veya guvenilen ag olarak tanimlanmali.");
  }

  if (clean(process.env.TRUST_PROXY) && !isValidTrustProxySetting(process.env.TRUST_PROXY)) {
    errors.push("TRUST_PROXY degeri false, sinirli proxy sayisi veya guvenilen ag olmali.");
  }

  if (config.isProduction && !config.cookieSecure) {
    errors.push("Production ortaminda COOKIE_SECURE=true olmali.");
  }

  if (config.passwordResetEmail && !isEmailLike(config.passwordResetEmail)) {
    errors.push("PASSWORD_RESET_EMAIL gecerli bir e-posta adresi olmali.");
  }

  if (config.passwordResetEmail && (!config.smtpUser || !config.smtpPass)) {
    if (!config.passwordResetTestCode) errors.push("PASSWORD_RESET_EMAIL kullaniliyorsa SMTP_USER ve SMTP_PASS zorunludur.");
  }

  if (config.passwordResetTestCode && !/^\d{6}$/.test(config.passwordResetTestCode)) {
    errors.push("PASSWORD_RESET_TEST_CODE test ortaminda alti haneli olmali.");
  }

  if ((config.smtpUser || config.smtpPass) && (!config.smtpUser || !config.smtpPass)) {
    errors.push("SMTP_USER ve SMTP_PASS birlikte tanimlanmali.");
  }

  if (config.notificationsManagerEmail && !isEmailLike(config.notificationsManagerEmail)) {
    errors.push("NOTIFICATIONS_MANAGER_EMAIL gecerli bir e-posta adresi olmali.");
  }

  if (Boolean(config.vapidPublicKey) !== Boolean(config.vapidPrivateKey)) {
    errors.push("VAPID_PUBLIC_KEY ve VAPID_PRIVATE_KEY birlikte tanimlanmali.");
  }

  if (config.defaultPanelPassword && config.defaultPanelPassword.length > 72) {
    errors.push("DEFAULT_PANEL_PASSWORD bcrypt siniri nedeniyle 72 karakterden uzun olmamali.");
  }

  if (config.defaultRecipePassword && config.defaultRecipePassword.length > 72) {
    errors.push("DEFAULT_RECIPE_PASSWORD bcrypt siniri nedeniyle 72 karakterden uzun olmamali.");
  }

  if (!["lax", "strict", "none"].includes(config.cookieSameSite.toLowerCase())) {
    errors.push("COOKIE_SAME_SITE lax, strict veya none olmali.");
  }

  if (config.cookieSameSite.toLowerCase() === "none" && !config.cookieSecure) {
    errors.push("COOKIE_SAME_SITE=none icin COOKIE_SECURE=true olmali.");
  }

  if (config.publicRootUrl && !normalizeOrigin(config.publicRootUrl)) {
    errors.push("PUBLIC_ROOT_URL (veya eski PUBLIC_SITE_URL) gecerli bir http/https URL olmali.");
  }

  if (errors.length) {
    throw new Error(`Ortam ayarlari eksik veya guvensiz:\n- ${errors.join("\n- ")}`);
  }
}

function clean(value) {
  return String(value || "").trim();
}

function normalizePublicPath(value, fallback) {
  const text = clean(value || fallback);
  const safe = text.startsWith("/") && !text.startsWith("//") ? text : fallback;
  return safe === "/" ? "/" : `/${safe.replace(/^\/+|\/+$/g, "")}/`;
}

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => normalizeOrigin(item.trim()))
    .filter(Boolean);
}

function normalizeOrigin(value) {
  if (!value) return "";
  if (value === "*") return "*";

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch (_error) {
    return "";
  }
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function derivedAllowedOrigins(settings) {
  return [
    settings.mainDomain ? `https://${settings.mainDomain}` : "",
    settings.mainDomain ? `https://www.${settings.mainDomain}` : "",
    settings.adminDomain ? `https://${settings.adminDomain}` : ""
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
}

function toPort(value, fallback) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function clampInt(value, fallback, min, max) {
  const next = Number(value || fallback);
  if (!Number.isInteger(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parseTrustProxy(value, fallback) {
  const text = clean(value);
  if (!text) return fallback;
  if (/^(false|0|off|no)$/i.test(text)) return false;
  if (/^(true|on|yes)$/i.test(text)) return true;
  if (/^\d+$/.test(text)) return Math.min(10, Math.max(0, Number(text)));
  if (/^(loopback|linklocal|uniquelocal)(?:\s*,\s*(?:loopback|linklocal|uniquelocal))*$/i.test(text)) return text;
  if (/^[a-f0-9.:/\s,]+$/i.test(text)) return text;
  return fallback;
}

function isValidTrustProxySetting(value) {
  const text = clean(value);
  if (!text) return false;
  if (/^(false|0|off|no)$/i.test(text)) return true;
  if (/^(true|on|yes)$/i.test(text)) return true;
  if (/^\d+$/.test(text)) return Number(text) >= 0 && Number(text) <= 10;
  if (/^(loopback|linklocal|uniquelocal)(?:\s*,\s*(?:loopback|linklocal|uniquelocal))*$/i.test(text)) return true;
  return text.split(",").map((item) => item.trim()).filter(Boolean).every((entry) => {
    const [address, prefix, ...rest] = entry.split("/");
    if (rest.length || !net.isIP(address)) return false;
    if (prefix === undefined) return true;
    if (!/^\d+$/.test(prefix)) return false;
    const limit = net.isIP(address) === 4 ? 32 : 128;
    return Number(prefix) >= 0 && Number(prefix) <= limit;
  });
}

function isPlaceholderCredential(value) {
  return /(?:change[-_ ]?this|replace[-_ ]?me|example|placeholder|your[-_ ]?(?:secret|password|key)|default)/i.test(String(value || ""));
}

function isTemporaryProjectPath(value) {
  const relative = path.relative(projectRoot, path.resolve(String(value || ""))).replace(/\\/g, "/").toLowerCase();
  return relative === "storage/local"
    || relative.startsWith("storage/local/")
    || relative.includes("local-dev")
    || relative.includes("local-smoke")
    || relative.startsWith("tmp/")
    || relative.startsWith("temp/");
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pathsOverlap(first, second) {
  return isPathInside(first, second) || isPathInside(second, first);
}

module.exports = {
  config,
  validateConfig
};
