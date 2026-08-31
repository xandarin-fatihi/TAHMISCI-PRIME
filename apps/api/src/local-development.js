"use strict";

const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const localDataRoot = path.join(projectRoot, "storage", "local");
const localMediaRoot = path.join(projectRoot, "storage", "media");

const LOCAL_DEFAULTS = Object.freeze({
  adminPassword: "Tahmisci-Local-Admin-2026!",
  recipePassword: "Tahmisci-Local-Recete-2026!",
  jwtSecret: "tahmisci-local-development-jwt-secret-2026-never-production",
  managerKey: "tahmisci-local-development-manager-key-2026-never-production"
});

const PRESERVED_DELIVERY_ENV_KEYS = Object.freeze([
  "PASSWORD_RESET_EMAIL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "MUDAVIM_SMTP_HOST",
  "MUDAVIM_SMTP_PORT",
  "MUDAVIM_SMTP_SECURE",
  "MUDAVIM_SMTP_USER",
  "MUDAVIM_SMTP_PASS",
  "MUDAVIM_SMTP_FROM",
  "VAPID_SUBJECT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "NOTIFICATION_WORKERS_ENABLED"
]);

function getLocalPaths(kind = "dev") {
  if (!new Set(["dev", "smoke"]).has(kind)) throw new Error("Invalid local run type.");
  const prefix = kind === "dev" ? "local-dev" : "local-smoke";
  return {
    dataFile: path.join(localDataRoot, `${prefix}-store.json`),
    mediaDir: path.join(localMediaRoot, prefix)
  };
}

function getLocalCredentials(environment = process.env) {
  return {
    adminPassword: String(environment.TAHMISCI_LOCAL_ADMIN_PASSWORD || LOCAL_DEFAULTS.adminPassword),
    recipePassword: String(environment.TAHMISCI_LOCAL_RECIPE_PASSWORD || LOCAL_DEFAULTS.recipePassword)
  };
}

function buildLocalEnvironment({ port = 6060, kind = "dev", environment = process.env } = {}) {
  const safePort = parseLocalPort([], port);
  const paths = getLocalPaths(kind);
  const credentials = getLocalCredentials(environment);
  const localhostOrigin = `http://localhost:${safePort}`;
  const loopbackOrigin = `http://127.0.0.1:${safePort}`;
  const preservedDeliveryEnvironment = Object.fromEntries(PRESERVED_DELIVERY_ENV_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(environment, key))
    .map((key) => [key, String(environment[key])]));
  return {
    NODE_ENV: "development",
    TAHMISCI_LOCAL_DEV: "true",
    PORT: String(safePort),
    MAIN_DOMAIN: "",
    ADMIN_DOMAIN: "",
    PUBLIC_SITE_URL: localhostOrigin,
    PUBLIC_ROOT_URL: localhostOrigin,
    WEBSITE_PATH: "/site/",
    QR_MENU_PATH: "/",
    MUDAVIM_PATH: "/mudavim/",
    ALLOWED_ORIGINS: `${localhostOrigin},${loopbackOrigin}`,
    ALLOW_LOCALHOST_ORIGINS: "true",
    COOKIE_SECURE: "false",
    COOKIE_SAME_SITE: "lax",
    DATA_FILE: paths.dataFile,
    MEDIA_DIR: paths.mediaDir,
    DEFAULT_PANEL_PASSWORD: credentials.adminPassword,
    DEFAULT_RECIPE_PASSWORD: credentials.recipePassword,
    JWT_SECRET: LOCAL_DEFAULTS.jwtSecret,
    PASSWORD_MANAGER_KEY: LOCAL_DEFAULTS.managerKey,
    BCRYPT_ROUNDS: "10",
    ...preservedDeliveryEnvironment
  };
}

function parseLocalPort(args = process.argv.slice(2), fallback = process.env.PORT || 6060) {
  let candidate = fallback;
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index] || "");
    if (argument.startsWith("--port=")) candidate = argument.slice(7);
    if (argument === "--port" && args[index + 1]) candidate = args[index + 1];
  }
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid local port: ${candidate}`);
  }
  return port;
}

function assertOwnedLocalTarget(candidate, expected) {
  const resolved = path.resolve(candidate);
  const exact = path.resolve(expected);
  const dataRelative = path.relative(localDataRoot, resolved);
  const mediaRelative = path.relative(localMediaRoot, resolved);
  const insideLocalData = dataRelative && !dataRelative.startsWith("..") && !path.isAbsolute(dataRelative);
  const insideLocalMedia = mediaRelative && !mediaRelative.startsWith("..") && !path.isAbsolute(mediaRelative);
  if (resolved !== exact || (!insideLocalData && !insideLocalMedia)) {
    throw new Error(`Local safety check rejected target: ${resolved}`);
  }
  return resolved;
}

function isKnownLocalDataPath(value) {
  if (!value) return false;
  const resolved = path.resolve(value);
  return ["dev", "smoke"].some((kind) => {
    const paths = getLocalPaths(kind);
    return resolved === path.resolve(paths.dataFile) || resolved === path.resolve(paths.mediaDir);
  });
}

function isKnownLocalCredential(value) {
  return Object.values(LOCAL_DEFAULTS).includes(String(value || ""));
}

module.exports = {
  LOCAL_DEFAULTS,
  PRESERVED_DELIVERY_ENV_KEYS,
  assertOwnedLocalTarget,
  buildLocalEnvironment,
  getLocalCredentials,
  getLocalPaths,
  isKnownLocalCredential,
  isKnownLocalDataPath,
  localDataRoot,
  localMediaRoot,
  parseLocalPort
};
