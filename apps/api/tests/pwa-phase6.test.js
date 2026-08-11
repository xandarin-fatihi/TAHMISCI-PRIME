"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..", "..", "..");

const applications = [
  {
    id: "menu",
    html: "apps/qr-menu/index.html",
    manifest: "apps/qr-menu/manifest.webmanifest",
    worker: "apps/qr-menu/sw.js",
    workerUrl: "/qr-menu/sw.js",
    offlineUrl: "/qr-menu/offline.html",
    scope: "/",
    name: "Tahmisçi Dijital Menü"
  },
  {
    id: "personel",
    html: "apps/personel/index.html",
    manifest: "apps/personel/manifest.webmanifest",
    worker: "apps/personel/sw.js",
    workerUrl: "/personel/sw.js",
    offlineUrl: "/personel/offline.html",
    scope: "/personel/",
    name: "Tahmisçi Personel"
  },
  {
    id: "yonetici",
    html: "apps/admin/index.html",
    manifest: "apps/admin/manifest.webmanifest",
    worker: "apps/admin/sw.js",
    workerUrl: "/yonetici/sw.js",
    offlineUrl: "/yonetici/offline.html",
    scope: "/yonetici/",
    name: "Tahmisçi Yönetici"
  }
];

test("üç uygulama ayrı manifest, service worker, scope ve cache kimliği kullanır", () => {
  const cacheIds = new Set();

  for (const app of applications) {
    const html = read(app.html);
    const manifest = JSON.parse(read(app.manifest));
    const config = evaluateWorkerConfig(app.worker);

    assert.equal(manifest.id, app.scope);
    assert.equal(manifest.start_url, app.scope);
    assert.equal(manifest.scope, app.scope);
    assert.equal(manifest.name, app.name);
    assert.ok(manifest.icons.some((icon) => icon.purpose === "any" && icon.sizes === "512x512"));
    assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512"));

    assert.match(html, new RegExp(`data-pwa-worker=["']${escapeRegex(app.workerUrl)}["']`));
    assert.match(html, new RegExp(`data-pwa-scope=["']${escapeRegex(app.scope)}["']`));
    assert.match(html, new RegExp(`<title>${escapeRegex(app.name)}</title>`));
    assert.match(html, /\/shared\/scripts\/pwa-client\.js/);
    assert.match(html, /\/shared\/styles\/pwa-ui\.css/);

    assert.equal(config.scopePath, app.scope);
    assert.equal(config.offlineUrl, app.offlineUrl);
    assert.equal(config.appId, app.id);
    assert.ok(config.version);
    assert.ok(config.neverCachePrefixes.includes("/api/"));
    assert.ok(config.staticPrefixes.length > 0);
    assert.equal(cacheIds.has(config.appId), false);
    cacheIds.add(config.appId);
  }
});

test("service worker runtime yalnız güvenli statikleri cache'ler ve hassas yolları ağda bırakır", () => {
  const source = read("shared/scripts/pwa-sw-runtime.js");

  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /"POST", "PUT", "PATCH", "DELETE"/);
  assert.match(source, /sensitivePathPattern/);
  assert.match(source, /\(\?:api\|auth\|login\|logout\|session\|sessions\)/);
  assert.match(source, /request\.headers\.has\("authorization"\)/);
  assert.match(source, /request\.headers\.has\("cookie"\)/);
  assert.match(source, /no-store\|private/);
  assert.match(source, /text\\\/event-stream\|application\\\/json/);
  assert.match(source, /!options\.allowHtml && \/text\\\/html\//);
  assert.match(source, /response\.headers\.has\("set-cookie"\)/);
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /networkFirstNavigation/);
  assert.match(source, /offlineCache\.match/);
  assert.match(source, /\(config\.precache \|\| \[\]\)\.concat\(config\.offlineAssets \|\| \[\]\)/);
  assert.match(source, /name\.startsWith\(cachePrefix\)/);
  assert.doesNotMatch(source.match(/addEventListener\("install"[\s\S]*?\n  \}\);/)?.[0] || "", /skipWaiting/);
});

test("waiting worker güncellemesi kontrollü ve controllerchange yenilemesi tek seferliktir", () => {
  const source = read("shared/scripts/pwa-client.js");

  assert.match(source, /Yeni sürüm hazır\./);
  assert.match(source, /Şimdi Güncelle/);
  assert.match(source, /postMessage\(\{ type: "SKIP_WAITING" \}\)/);
  assert.match(source, /controllerChangeHandled/);
  assert.match(source, /if \(controllerChangeHandled/);
  assert.match(source, /TahmisciAdminBridge\.hasPendingChanges/);
  assert.match(source, /Kaydedilmemiş değişiklikleriniz var/);
  assert.match(source, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /previouslyFocused\.focus\(\)/);
  assert.match(source, /window\.isSecureContext/);
  assert.match(source, /hostname === "localhost"/);
  assert.match(source, /updateViaCache: "none"/);
  assert.match(source, /PWA çevrimdışı desteği başlatılamadı/);
});

test("offline kabukları gerçek durumu söyler ve çevrimiçi başarı taklidi yapmaz", () => {
  const menuOffline = read("apps/qr-menu/offline.html");
  const personelOffline = read("apps/personel/offline.html");
  const adminOffline = read("apps/admin/offline.html");

  assert.match(menuOffline, /güncelliği garanti edilemez/);
  assert.match(personelOffline, /tamamlanmış sayılmaz/);
  assert.match(adminOffline, /tamamlanmış sayılmaz/);
  for (const source of [menuOffline, personelOffline, adminOffline]) {
    assert.match(source, /Bağlantı yok/);
    assert.doesNotMatch(source, /onclick=|<script\b/i);
  }
});

test("panel çalışma zamanında Google Fonts veya Flaticon zorunluluğu kalmaz", () => {
  const sources = [
    "apps/qr-menu/index.html",
    "apps/qr-menu/styles/qr-menu.css",
    "apps/qr-menu/scripts/app.js",
    "apps/personel/index.html",
    "apps/admin/index.html",
    "apps/admin/styles/admin.css",
    "apps/recipe/index.html",
    "apps/recipe/styles/recipe.css",
    "apps/recipe/scripts/app.js",
    "shared/styles/panel-foundation.css"
  ].map(read).join("\n");

  assert.doesNotMatch(sources, /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn-icons-png\.flaticon\.com/i);
  assert.match(sources, /poppins-regular\.ttf/);
  assert.match(read("apps/qr-menu/index.html"), /<svg class="icon"/);
  assert.match(read("apps/qr-menu/index.html"), /<svg class="theme-icon"/);
});

test("aktif kimlik ve yönlendirme sayfaları CSP uyumlu yerel script kullanır", () => {
  const pages = [
    "apps/auth/login.html",
    "apps/auth/password-reset/index.html",
    "apps/api/public/index.html",
    "apps/api/public/password-reset.html",
    "apps/personel/stok/index.html"
  ];

  for (const page of pages) {
    const source = read(page);
    assert.doesNotMatch(source, /<script(?![^>]*\bsrc=)[^>]*>/i, `${page} inline script içeriyor`);
    assert.match(source, /<script[^>]+src=["']\/assets\/scripts\//i, `${page} yerel script yüklemiyor`);
  }
});

test("viewport ve standalone kabuğu zoom engellemeden safe-area kullanır", () => {
  for (const app of applications) {
    const html = read(app.html);
    assert.match(html, /viewport-fit=cover/);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/i);
  }
  const css = read("shared/styles/pwa-ui.css");
  assert.match(css, /@media \(display-mode: standalone\)/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
});

function evaluateWorkerConfig(relativeFile) {
  const sandbox = {
    self: { addEventListener() {} },
    Object,
    importScripts() {}
  };
  vm.runInNewContext(read(relativeFile), sandbox, { filename: relativeFile });
  return JSON.parse(JSON.stringify(sandbox.self.TAHMISCI_PWA_CONFIG));
}

function read(relativeFile) {
  return fs.readFileSync(path.join(projectRoot, relativeFile), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
