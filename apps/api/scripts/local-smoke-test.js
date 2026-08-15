"use strict";

const assert = require("assert/strict");
const fs = require("fs/promises");
const { once } = require("events");
const {
  assertOwnedLocalTarget,
  buildLocalEnvironment,
  getLocalCredentials,
  getLocalPaths,
  parseLocalPort
} = require("../src/local-development");

const port = parseLocalPort(process.argv.slice(2), 18080);
const paths = getLocalPaths("smoke");
Object.assign(process.env, buildLocalEnvironment({ port, kind: "smoke" }));

const APPLICATIONS = Object.freeze([
  {
    label: "QR Menü",
    page: "/",
    alternatePage: "/qr-menu/",
    pageMarkers: ["/qr-menu/scripts/app.js"],
    manifest: "/qr-menu/manifest.webmanifest",
    worker: "/qr-menu/sw.js",
    offline: "/qr-menu/offline.html",
    id: "/",
    scope: "/",
    startUrl: "/"
  },
  {
    label: "Personel",
    page: "/personel/",
    pageMarkers: ["/personel/personel.js", "/personel/workforce.js"],
    manifest: "/personel/manifest.webmanifest",
    worker: "/personel/sw.js",
    offline: "/personel/offline.html",
    id: "/personel/",
    scope: "/personel/",
    startUrl: "/personel/"
  },
  {
    label: "Yönetici",
    page: "/yonetici/",
    pageMarkers: ["scripts/app.js", "scripts/live-preview.js"],
    manifest: "/yonetici/manifest.webmanifest",
    worker: "/yonetici/sw.js",
    offline: "/yonetici/offline.html",
    id: "/yonetici/",
    scope: "/yonetici/",
    startUrl: "/yonetici/"
  }
]);

let server = null;
let baseUrl = "";
let adminToken = "";

main().catch((error) => {
  console.error(`Lokal smoke test başarısız: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  await cleanSmokeData();
  try {
    const { startServer } = require("../src/server");
    server = await startServer();
    if (!server.listening) {
      await Promise.race([
        once(server, "listening"),
        once(server, "error").then(([error]) => Promise.reject(error))
      ]);
    }
    baseUrl = `http://127.0.0.1:${port}`;

    await checkHealthAndApplicationShells();
    await loginAdmin();
    await checkAdminSession();
    await checkBootstrapSafety();
    await checkDisabledSiteContract();
    await checkStaticAssetChain();
    await checkPwaAssets();

    console.log("\nLokal smoke test: tüm kontroller başarılı.");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanSmokeData();
  }
}

async function checkHealthAndApplicationShells() {
  const health = await jsonRequest("/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.deepEqual(Object.keys(health.body).sort(), ["ok"]);
  pass("Backend başlıyor ve health endpoint'i hassas veri sızdırmadan cevap veriyor");

  for (const application of APPLICATIONS) {
    const pathsToCheck = [application.page, application.alternatePage].filter(Boolean);
    for (const pathname of pathsToCheck) {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
      assert.equal(response.status, 200, `${pathname} HTTP ${response.status}`);
      assert.match(String(response.headers.get("content-type") || ""), /^text\/html\b/i, pathname);
      const html = await response.text();
      for (const marker of application.pageMarkers) {
        assert.ok(html.includes(marker), `${pathname} içinde ${marker} bulunamadı`);
      }
      assert.ok(html.includes(application.manifest), `${pathname} kendi manifestini yüklemiyor`);
    }
  }

  const qrScript = await fetch(`${baseUrl}/qr-menu/scripts/app.js`);
  assert.equal(qrScript.status, 200);
  assert.match(String(qrScript.headers.get("content-type") || ""), /javascript/i);
  assert.ok((await qrScript.text()).length > 100);
  pass("QR Menü, Personel ve Yönetici güncel HTML/JavaScript zincirleri açılıyor");
}

async function loginAdmin() {
  const credentials = getLocalCredentials();
  const result = await jsonRequest("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: credentials.adminPassword })
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.body.token);
  adminToken = result.body.token;
  pass("Lokal Yönetici bilgisiyle gerçek oturum açılabiliyor");
}

async function checkAdminSession() {
  const anonymous = await jsonRequest("/api/admin/me", { headers: { Origin: baseUrl } });
  assert.ok([401, 403].includes(anonymous.response.status), `Anonim Yönetici oturumu HTTP ${anonymous.response.status}`);

  const authenticated = await jsonRequest("/api/admin/me", { headers: adminHeaders() });
  assert.equal(authenticated.response.status, 200);
  assert.equal(authenticated.body.ok, true);
  pass("Yönetici API oturumu anonim ve yetkili istekleri ayırıyor");
}

async function checkBootstrapSafety() {
  const result = await jsonRequest("/api/public/bootstrap");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.menu && typeof result.body.menu === "object");
  assert.equal(Array.isArray(result.body.menu.categories), true);
  assert.equal(Array.isArray(result.body.menu.products), true);
  assert.equal(result.body.menu.categoryCount, result.body.menu.categories.length);
  assert.equal(result.body.menu.productCount, result.body.menu.products.length);

  const nestedProducts = result.body.menu.categories.flatMap((category) => {
    assert.ok(category && typeof category === "object");
    assert.equal(Array.isArray(category.products), true);
    assert.equal(category.productCount, category.products.length);
    return category.products;
  });
  assert.equal(nestedProducts.length, result.body.menu.productCount);

  // Smoke store her çalışmada temiz oluşturulur. Sıfır ürün geçerli bir katalogdur;
  // başlangıç kodu örnek/seed ürün enjekte etmemelidir.
  assert.equal(result.body.menu.productCount, 0, "Temiz smoke store örnek ürün üretmemeli");
  assert.equal(result.body.menu.categoryCount, 0, "Temiz smoke store örnek kategori üretmemeli");

  assertNoForbiddenKeys(result.body, new Set([
    "preparation", "recipeState", "recipeUsers", "recipeAssignments", "recipeActivity",
    "passwordHash", "recipePasswordHash", "admin"
  ]));
  pass("Public bootstrap dinamik/boş katalog şemasını koruyor ve örnek veri üretmiyor");
}

async function checkDisabledSiteContract() {
  const response = await jsonRequest("/api/site", { headers: adminHeaders() });
  assert.equal(response.response.status, 410);
  assert.equal(response.body.ok, false);
  assert.equal(typeof response.body.message, "string");
  assert.ok(response.body.message.trim().length > 0);
  pass("Devre dışı eski website modülü /api/site için belgeli 410 sözleşmesini koruyor");
}

async function checkStaticAssetChain() {
  const documents = APPLICATIONS.flatMap((application) => [application.page, application.alternatePage].filter(Boolean));
  const assetUrls = new Set();

  for (const pathname of documents) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    for (const url of extractAssetUrls(html, `${baseUrl}${pathname}`)) assetUrls.add(url);
  }

  for (const url of assetUrls) {
    const response = await fetch(url, { redirect: "manual" });
    assert.ok(response.status >= 200 && response.status < 400, `${url} HTTP ${response.status}`);
  }

  assert.ok(assetUrls.size > 10, "Uygulama kabuklarının statik varlık zinciri bulunamadı");
  pass(`${assetUrls.size} yerel HTML/static bağlantısı doğrulandı`);
}

async function checkPwaAssets() {
  for (const application of APPLICATIONS) {
    const manifestResponse = await fetch(`${baseUrl}${application.manifest}`);
    assert.equal(manifestResponse.status, 200, application.manifest);
    assert.match(
      String(manifestResponse.headers.get("content-type") || ""),
      /^application\/(?:manifest\+json|json)\b/i,
      `${application.manifest} content-type`
    );
    const manifest = await manifestResponse.json();
    assert.equal(manifest.id, application.id);
    assert.equal(manifest.scope, application.scope);
    assert.equal(manifest.start_url, application.startUrl);
    assert.equal(typeof manifest.name, "string");
    assert.ok(manifest.name.startsWith("Tahmisçi"));
    assert.equal(Array.isArray(manifest.icons), true);
    assert.ok(manifest.icons.length >= 4);

    for (const icon of manifest.icons) {
      assert.ok(icon && typeof icon.src === "string");
      const iconUrl = new URL(icon.src, `${baseUrl}${application.manifest}`);
      assert.equal(iconUrl.origin, baseUrl);
      const iconResponse = await fetch(iconUrl);
      assert.equal(iconResponse.status, 200, iconUrl.pathname);
      assert.match(String(iconResponse.headers.get("content-type") || ""), /^image\/png\b/i, iconUrl.pathname);
    }

    const workerResponse = await fetch(`${baseUrl}${application.worker}`, { cache: "no-store" });
    assert.equal(workerResponse.status, 200, application.worker);
    assert.match(String(workerResponse.headers.get("content-type") || ""), /javascript/i, application.worker);
    assert.ok((await workerResponse.text()).length > 100, `${application.worker} boş`);

    const offlineResponse = await fetch(`${baseUrl}${application.offline}`, { cache: "no-store" });
    assert.equal(offlineResponse.status, 200, application.offline);
    assert.match(String(offlineResponse.headers.get("content-type") || ""), /^text\/html\b/i, application.offline);
  }

  const clientResponse = await fetch(`${baseUrl}/shared/scripts/pwa-client.js`, { cache: "no-store" });
  assert.equal(clientResponse.status, 200);
  assert.match(String(clientResponse.headers.get("content-type") || ""), /javascript/i);
  pass("Üç manifest, ikon ailesi, service worker, offline kabuk ve güncelleme istemcisi yayınlanıyor");
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

function adminHeaders(contentType) {
  return {
    Authorization: `Bearer ${adminToken}`,
    Origin: baseUrl,
    ...(contentType ? { "Content-Type": contentType } : {})
  };
}

function extractAssetUrls(html, documentUrl) {
  const urls = [];
  const pattern = /(?:src|href|poster)=["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const value = String(match[1] || "").trim();
    if (!value || value.startsWith("#") || /^(?:data:|blob:|mailto:|tel:|javascript:)/i.test(value)) continue;
    let url;
    try { url = new URL(value, documentUrl); } catch (_error) { continue; }
    if (url.origin !== baseUrl) continue;
    if (!/\.(?:css|js|png|jpe?g|webp|gif|svg|mp4|webm|woff2?|ttf|otf|webmanifest)$/i.test(url.pathname)) continue;
    urls.push(url.toString());
  }
  return urls;
}

function assertNoForbiddenKeys(value, forbidden, currentPath = "bootstrap") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `${currentPath}.${key} public çıktıda bulunmamalı`);
    assertNoForbiddenKeys(item, forbidden, `${currentPath}.${key}`);
  }
}

async function cleanSmokeData() {
  const dataFile = assertOwnedLocalTarget(paths.dataFile, paths.dataFile);
  const mediaDir = assertOwnedLocalTarget(paths.mediaDir, paths.mediaDir);
  await fs.rm(dataFile, { force: true });
  await fs.rm(mediaDir, { recursive: true, force: true });
}

function pass(message) {
  console.log(`✓ ${message}`);
}
