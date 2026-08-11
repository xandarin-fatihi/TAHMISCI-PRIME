"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const runRoot = path.join(os.tmpdir(), `tahmisci-security-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATA_FILE = path.join(runRoot, "store.json");
process.env.MEDIA_DIR = path.join(runRoot, "media");
process.env.DEFAULT_PANEL_PASSWORD = "Panel123456";
process.env.DEFAULT_RECIPE_PASSWORD = "Recipe123456";
process.env.JWT_SECRET = "security-test-secret-that-is-longer-than-thirty-two-characters";
process.env.COOKIE_SECURE = "false";
process.env.ALLOW_LOCALHOST_ORIGINS = "true";
process.env.ALLOWED_ORIGINS = "https://admin.allowed.test,https://public.allowed.test";

const { app, prepareRuntime, sanitizeLogLine, shutdownRuntime } = require("../src/server");
const { config } = require("../src/config");
const { isXlsxSignature, parseFiles } = require("../src/data-import-routes");
const { createFileStore } = require("../src/store/file-store");

let server;
let baseUrl;

test.before(async () => {
  await prepareRuntime();
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await shutdownRuntime(server, { timeoutMs: 3000 });
  await fs.rm(runRoot, { recursive: true, force: true });
});

test("Faz 6 statik, manifest ve service worker cache/header politikası kapsamları ayırır", async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.match(String(health.headers.get("cache-control") || ""), /no-store/);

  const panel = await fetch(`${baseUrl}/yonetici/`);
  assert.equal(panel.status, 200);
  assert.match(String(panel.headers.get("cache-control") || ""), /no-cache/);
  const csp = String(panel.headers.get("content-security-policy") || "");
  const scriptDirective = csp.split(";").find((item) => item.trim().startsWith("script-src")) || "";
  const connectDirective = csp.split(";").find((item) => item.trim().startsWith("connect-src")) || "";
  assert.doesNotMatch(scriptDirective, /unsafe-inline/);
  assert.match(scriptDirective, /'self'/);
  assert.doesNotMatch(connectDirective, /\bhttps:\s/);

  const managerWithoutSlash = await fetch(`${baseUrl}/yonetici`, { redirect: "manual" });
  assert.equal(managerWithoutSlash.status, 301);
  assert.equal(managerWithoutSlash.headers.get("location"), "/yonetici/");

  const legacyPanel = await fetch(`${baseUrl}/panel/?section=staff`, { redirect: "manual" });
  assert.equal(legacyPanel.status, 301);
  assert.equal(legacyPanel.headers.get("location"), "/yonetici/?section=staff");

  for (const application of [
    { manifest: "/qr-menu/manifest.webmanifest", worker: "/qr-menu/sw.js", scope: "/" },
    { manifest: "/personel/manifest.webmanifest", worker: "/personel/sw.js", scope: "/personel/" },
    { manifest: "/yonetici/manifest.webmanifest", worker: "/yonetici/sw.js", scope: "/yonetici/" }
  ]) {
    const manifest = await fetch(`${baseUrl}${application.manifest}`);
    assert.equal(manifest.status, 200);
    assert.match(String(manifest.headers.get("content-type") || ""), /application\/manifest\+json/i);
    assert.match(String(manifest.headers.get("cache-control") || ""), /no-cache/);

    const worker = await fetch(`${baseUrl}${application.worker}`);
    assert.equal(worker.status, 200);
    assert.match(String(worker.headers.get("content-type") || ""), /javascript/i);
    assert.match(String(worker.headers.get("cache-control") || ""), /no-cache/);
    assert.equal(worker.headers.get("service-worker-allowed"), application.scope);
  }
});

test("tek-domain production geometrisi ana menüyü kökte ve Yönetici'yi yalnız kendi yolunda tutar", async () => {
  const previous = {
    mainDomain: config.mainDomain,
    adminDomain: config.adminDomain,
    publicSiteUrl: config.publicSiteUrl
  };

  config.mainDomain = "127.0.0.1";
  config.adminDomain = "127.0.0.1";
  config.publicSiteUrl = baseUrl;

  try {
    const menu = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.equal(menu.status, 200);
    assert.match(await menu.text(), /\/qr-menu\/scripts\/app\.js/);

    const manager = await fetch(`${baseUrl}/yonetici/`, { redirect: "manual" });
    assert.equal(manager.status, 200);
    assert.match(await manager.text(), /scripts\/app\.js/);
  } finally {
    config.mainDomain = previous.mainDomain;
    config.adminDomain = previous.adminDomain;
    config.publicSiteUrl = previous.publicSiteUrl;
  }
});

test("Origin/fetch metadata ve normal API gövde sınırı riskli isteği reddeder", async () => {
  const crossSite = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    body: JSON.stringify({ password: "Panel123456" })
  });
  assert.equal(crossSite.status, 403);

  const oversized = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "x", padding: "a".repeat(1024 * 1024 + 1024) })
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).message, /boyut sınırını/i);

  const protectedResponse = await fetch(`${baseUrl}/api/admin/me`);
  assert.equal(protectedResponse.status, 401);
  assert.match(String(protectedResponse.headers.get("cache-control") || ""), /no-store/);
});

test("Medya yükleme MIME, uzantı ve gerçek dosya imzasını birlikte doğrular", async () => {
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "Panel123456" })
  });
  const token = (await login.json()).token;
  assert.ok(token);

  const mismatch = await fetch(`${baseUrl}/api/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: baseUrl,
      "Content-Type": "image/png",
      "X-File-Name": "gorsel.jpg",
      "X-Media-Kind": "image"
    },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  });
  assert.equal(mismatch.status, 400);
  assert.match(String(mismatch.headers.get("cache-control") || ""), /no-store/);

  const fake = await fetch(`${baseUrl}/api/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: baseUrl,
      "Content-Type": "image/png",
      "X-File-Name": "gorsel.png",
      "X-Media-Kind": "image"
    },
    body: Buffer.from("not-a-real-png")
  });
  assert.equal(fake.status, 400);

  const oversized = await fetch(`${baseUrl}/api/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: baseUrl,
      "Content-Type": "image/png",
      "X-File-Name": "buyuk.png",
      "X-Media-Kind": "image"
    },
    body: Buffer.alloc(15 * 1024 * 1024 + 1, 0)
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).message, /boyut sınırını/i);
});

test("Excel aktarımı uzantı, MIME, imza ve dosya başına boyut sözleşmesini doğrular", () => {
  assert.equal(isXlsxSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(isXlsxSignature(Buffer.from("not-xlsx")), false);
  assert.throws(() => parseFiles({
    menu: { filename: "menu.xls", contentBase64: Buffer.from("x").toString("base64") }
  }), /yalnızca \.xlsx/i);
  assert.throws(() => parseFiles({
    menu: { filename: "menu.xlsx", mimeType: "text/plain", contentBase64: Buffer.from("x").toString("base64") }
  }), /MIME türü/i);
  assert.throws(() => parseFiles({
    menu: { filename: "menu.xlsx", contentBase64: Buffer.from("not-an-xlsx").toString("base64") }
  }), /dosya imzası/i);
});

test("Log redaksiyonu token, cookie ve yetkilendirme değerlerini maskeleyerek korur", () => {
  const raw = "GET /?previewToken=secret&token=second authorization: Bearer abc.def cookie: sid=private";
  const sanitized = sanitizeLogLine(raw);
  assert.doesNotMatch(sanitized, /secret|second|abc\.def|sid=private/);
  assert.ok((sanitized.match(/\[REDACTED\]/g) || []).length >= 3);
});

test("File store drain devam eden atomik yazma kuyruğunu tamamlar", async () => {
  const dataFile = path.join(runRoot, "drain", "store.json");
  const isolated = createFileStore(dataFile, {
    bcryptRounds: 10,
    defaultPanelPassword: "Panel123456",
    defaultRecipePassword: "Recipe123456"
  });
  await isolated.ensure();
  const pending = isolated.update(async (data) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    data.feedbackUpdatedAt = "drained";
    return data;
  });
  await isolated.drain();
  await pending;
  assert.equal((await isolated.read()).feedbackUpdatedAt, "drained");
});

test("Production örnek credential, belirsiz proxy ve örtük veri yoluyla başlamaz", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./src/config').validateConfig()"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      MAIN_DOMAIN: "example.com",
      ADMIN_DOMAIN: "admin.example.com",
      ALLOWED_ORIGINS: "https://example.com,https://admin.example.com",
      JWT_SECRET: "change-this-with-a-very-long-random-secret-value",
      PASSWORD_MANAGER_KEY: "change-this-with-a-long-random-manager-key-value",
      DEFAULT_PANEL_PASSWORD: "ChangeThisPassword123",
      DEFAULT_RECIPE_PASSWORD: "",
      COOKIE_SECURE: "true",
      TRUST_PROXY: "true",
      DATA_FILE: "",
      MEDIA_DIR: "",
      PASSWORD_RESET_EMAIL: "",
      SMTP_USER: "",
      SMTP_PASS: ""
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /ornek\/varsayilan|TRUST_PROXY|kalici DATA_FILE/i);
});

test("Production trust proxy ayarını örtük veya geçersiz bırakmaz", () => {
  const baseEnv = {
    ...process.env,
    NODE_ENV: "production",
    MAIN_DOMAIN: "tahmisci.example",
    ADMIN_DOMAIN: "admin.tahmisci.example",
    ALLOWED_ORIGINS: "https://tahmisci.example,https://admin.tahmisci.example",
    JWT_SECRET: "a-secure-production-jwt-secret-with-more-than-thirty-two-characters",
    PASSWORD_MANAGER_KEY: "a-secure-production-manager-key-with-more-than-thirty-two-characters",
    DEFAULT_PANEL_PASSWORD: "",
    DEFAULT_RECIPE_PASSWORD: "",
    COOKIE_SECURE: "true",
    DATA_FILE: path.join(runRoot, "persistent", "store.json"),
    MEDIA_DIR: path.join(runRoot, "persistent", "media"),
    PASSWORD_RESET_EMAIL: "",
    SMTP_USER: "",
    SMTP_PASS: ""
  };
  delete baseEnv.TRUST_PROXY;

  const missing = spawnSync(process.execPath, ["-e", "require('./src/config').validateConfig()"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: baseEnv
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /TRUST_PROXY/i);

  const invalid = spawnSync(process.execPath, ["-e", "require('./src/config').validateConfig()"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { ...baseEnv, TRUST_PROXY: "anything" }
  });
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stdout}\n${invalid.stderr}`, /TRUST_PROXY/i);
});
