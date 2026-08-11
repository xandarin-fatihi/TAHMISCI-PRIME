"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  LOCAL_DEFAULTS,
  assertOwnedLocalTarget,
  buildLocalEnvironment,
  getLocalPaths
} = require("../src/local-development");

test("local dev paths stay outside production storage", () => {
  const environment = buildLocalEnvironment({ port: 8080, kind: "dev", environment: {} });
  const paths = getLocalPaths("dev");
  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.DATA_FILE, paths.dataFile);
  assert.equal(environment.MEDIA_DIR, paths.mediaDir);
  assert.match(environment.DATA_FILE, /local-dev-store\.json$/);
  assert.match(environment.MEDIA_DIR, /storage[\\/]+media[\\/]+local-dev$/);
  assert.notEqual(path.basename(environment.DATA_FILE), "store.json");
});

test("local reset safety check rejects production target", () => {
  const paths = getLocalPaths("dev");
  assert.equal(assertOwnedLocalTarget(paths.dataFile, paths.dataFile), paths.dataFile);
  assert.throws(
    () => assertOwnedLocalTarget(path.join(path.dirname(paths.dataFile), "store.json"), paths.dataFile),
    /Local safety check/
  );
});

test("production mode rejects local development flags and known credentials", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./src/config').validateConfig()"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      MAIN_DOMAIN: "example.com",
      ADMIN_DOMAIN: "admin.example.com",
      PUBLIC_SITE_URL: "https://example.com",
      ALLOWED_ORIGINS: "https://example.com,https://admin.example.com",
      JWT_SECRET: LOCAL_DEFAULTS.jwtSecret,
      PASSWORD_MANAGER_KEY: "production-manager-key-that-is-long-enough-123456",
      DEFAULT_PANEL_PASSWORD: LOCAL_DEFAULTS.adminPassword,
      DEFAULT_RECIPE_PASSWORD: LOCAL_DEFAULTS.recipePassword,
      TAHMISCI_LOCAL_DEV: "true",
      PASSWORD_RESET_EMAIL: "",
      SMTP_USER: "",
      SMTP_PASS: ""
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Production ortaminda/);
});
