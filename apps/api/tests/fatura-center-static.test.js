"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

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
  const css = read("apps/fatura/styles/fatura.css");
  assert.equal(manifest.start_url, "/fatura/");
  assert.equal(manifest.scope, "/fatura/");
  assert.equal(manifest.display, "standalone");
  assert.match(css, /@media\s*\([^)]*max-width:\s*1100px/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*820px/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*560px/);
  assert.match(css, /min-height:\s*44px/);
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
