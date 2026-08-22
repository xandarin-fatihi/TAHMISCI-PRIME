"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readBuffer = (relative) => fs.readFileSync(path.join(root, relative));
const sha256 = (relative) => crypto.createHash("sha256").update(readBuffer(relative)).digest("hex");
const pngSize = (relative) => {
  const image = readBuffer(relative);
  assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
};

test("Fatura Merkezi iframe veya localStorage ticari veri kaynağı kullanmaz", () => {
  const html = read("apps/fatura/index.html");
  const app = read("apps/fatura/scripts/app.js");
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.match(html, /\/fatura\/scripts\/app\.js/);
  assert.doesNotMatch(app, /localStorage\.(?:setItem|getItem)\([^)]*(?:supplier|shipment|document|ledger|payment|stock)/i);
  assert.match(app, /tahmisci:fatura:view/);
  assert.match(app, /tahmisci:fatura:sidebar/);
});

test("Fatura PWA yalnız statik kabuğu cache'ler; API, SSE, belge ve mutasyonları dışlar", () => {
  const worker = read("apps/fatura/sw.js");
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /documents\//);
  assert.match(worker, /text\/event-stream/);
  assert.doesNotMatch(worker.match(/const SHELL = \[[\s\S]*?\];/)[0], /\/api\//);
});

test("Fatura PWA scope'u diğer uygulamalardan ayrıdır ve dört responsive kabul genişliğini kapsar", () => {
  const manifest = JSON.parse(read("apps/fatura/manifest.webmanifest"));
  const html = read("apps/fatura/index.html");
  const css = read("apps/fatura/styles/fatura.css");
  assert.equal(manifest.name, "Tahmisçi Fatura");
  assert.equal(manifest.short_name, "Fatura");
  assert.equal(manifest.id, "/fatura/");
  assert.equal(manifest.start_url, "/fatura/");
  assert.equal(manifest.scope, "/fatura/");
  assert.equal(manifest.display, "standalone");
  assert.match(html, /<title>Tahmisçi Fatura<\/title>/);
  assert.doesNotMatch(`${html}\n${JSON.stringify(manifest)}`, /Fatura Merkezi/);
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith("/assets/app-icons/fatura/")));
  assert.match(css, /@media\s*\([^)]*max-width:\s*1100px/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*820px/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*560px/);
  assert.match(css, /min-height:\s*44px/);
});

test("Fatura kendine ait deterministik ikon ailesini kullanır", () => {
  const expected = {
    "favicon-32.png": 32,
    "favicon-48.png": 48,
    "apple-touch-icon-180.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "maskable-icon-192.png": 192,
    "maskable-icon-512.png": 512
  };
  assert.match(read("public/assets/app-icons/fatura/master.svg"), /<svg[\s\S]*fatura/i);
  for (const [name, size] of Object.entries(expected)) {
    assert.deepEqual(pngSize(`public/assets/app-icons/fatura/${name}`), [size, size], name);
  }
  assert.notEqual(sha256("public/assets/app-icons/fatura/icon-192.png"), sha256("public/assets/app-icons/fatura/maskable-icon-192.png"));
  assert.notEqual(sha256("public/assets/app-icons/fatura/icon-512.png"), sha256("public/assets/app-icons/fatura/maskable-icon-512.png"));
});

test("Fatura profil, kalıcı bildirim ve capability UI bağlarını tek kaynakla kurar", () => {
  const html = read("apps/fatura/index.html");
  const app = read("apps/fatura/scripts/app.js");
  const accounting = read("apps/fatura/scripts/accounting.js");
  assert.match(html, /id="profileMenu"[\s\S]*id="logoutButton"/);
  assert.equal((html.match(/id="logoutButton"/g) || []).length, 1);
  assert.match(html, /id="notificationDrawer"/);
  assert.match(app, /\/api\/admin\/notifications/);
  assert.match(app, /\/api\/notifications/);
  assert.match(app, /\/read-all/);
  assert.match(accounting, /Mal Kabul Personeli/);
  assert.match(accounting, /Fatura Yöneticisi/);
  assert.match(accounting, /name="faturaAccess"/);
  assert.match(accounting, /key:"mal_kabul"/);
  assert.match(accounting, /key:"satin_alma"/);
  assert.match(accounting, /key:"yonetici"/);
  assert.match(accounting, /key:"ozel"/);
  assert.match(app, /faturaAccessEnabled:\s*accessEnabled/);
  assert.match(app, /faturaTemplate:\s*value\(data,"accessTemplate"\)/);
  assert.match(app, /state\.context\s*&&\s*state\.context\.access\s*&&\s*state\.context\.access\.sections/);
  assert.match(app, /sections\.includes\(view\.id\)/);
  assert.match(app, /procurement_access_updated[\s\S]*refreshAccessContext\(null, \{ firstVisible: true \}\)/);
  assert.match(app, /entityDialog\.addEventListener\("close", cleanupEntityDialog\)/);
  assert.match(app, /detailDialog\.addEventListener\("close", cleanupDetailDialog\)/);
  assert.match(app, /URL\.revokeObjectURL\(currentObjectUrl\)/);
  assert.match(app, /document\.body\.classList\.toggle\("dialog-open", entityDialog\.open \|\| detailDialog\.open\)/);
  assert.match(app, /catch\(error\)\{toast\(error\.message,true\);setBusy\(button,false\);connectEvents\(\);\}/);
});

test("Fatura canlı olayları tek procurement ve tek bildirim SSE bağlantısıyla kapsam bazlı yeniler", () => {
  const app = read("apps/fatura/scripts/app.js");
  assert.equal((app.match(/new EventSource\(/g) || []).length, 2);
  assert.match(app, /new EventSource\("\/api\/procurement\/v1\/events"/);
  assert.match(app, /new EventSource\(`\$\{notificationApiRoot\(\)\}\/events`/);
  assert.match(app, /if\(!window\.EventSource\|\|state\.notificationEventSource\)return/);
  assert.match(app, /state\.notifications\.findIndex\(\(item\)=>item\.id===incoming\.id\)/);
  assert.match(app, /state\.notificationEventSource\.close\(\);state\.notificationEventSource=null/);
  assert.match(app, /EVENT_SCOPES/);
  assert.match(app, /pendingEventScopes/);
  assert.match(app, /setTimeout\(flushEventScopes,180\)/);
  assert.doesNotMatch(app, /invalidate\(\["dashboard","suppliers","links","shipments","documents","ledger","users","settings","audit"\]\)/);
});

test("Fatura modalları çocuk grid genişliğini sınırlar ve mobilde tek kolona düşer", () => {
  const css = read("apps/fatura/styles/fatura.css");
  assert.match(css, /\.dialog-body\{[^}]*overflow-y:auto;overflow-x:hidden/);
  assert.match(css, /\.form-grid>\*\{min-width:0;max-width:100%\}/);
  assert.match(css, /\.form-grid :is\(input,select,textarea\)\{width:100%;max-width:100%;box-sizing:border-box\}/);
  assert.match(css, /@media \(max-width:560px\)[\s\S]*\.form-grid[^}]*grid-template-columns:1fr/);
});

test("Yönetici ve bildirim girişleri aynı origin /fatura hedefini kullanır", () => {
  const adminHtml = read("apps/admin/index.html");
  const adminApp = read("apps/admin/scripts/app.js");
  const personelNotifications = read("apps/personel/notifications.js");
  assert.match(adminHtml, /href="\/fatura\/"/);
  assert.match(adminApp, /\/fatura\//);
  assert.match(personelNotifications, /\/fatura\//);
  assert.doesNotMatch(`${adminApp}\n${personelNotifications}`, /https?:\/\/[^"']+\/fatura/i);
});
