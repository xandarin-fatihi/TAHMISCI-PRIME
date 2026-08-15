"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Yönetici yan modülleri yalnız ilgili bölüm açıldığında yüklenir", () => {
  const html = read("apps/admin/index.html");
  const app = read("apps/admin/scripts/app.js");
  assert.doesNotMatch(html, /<script[^>]+scripts\/(?:pricing|workforce)\.js/);
  assert.match(app, /loadScriptOnce\("pricing", "scripts\/pricing\.js/);
  assert.match(app, /loadScriptOnce\("workforce", "scripts\/workforce\.js/);
  assert.match(app, /requestPromises\.has\(dedupeKey\)/);
  assert.match(app, /function renderActiveSection\(section\)/);
  assert.equal((app.match(/renderAll\(\)/g) || []).length, 1, "renderAll yalnız geriye uyumlu tanım olarak kalmalı");
});

test("Personel reçete iframe'i sekme geçişinde korunur ve stok seçilene kadar yüklenmez", () => {
  const shell = read("apps/personel/personel.js");
  const boot = shell.slice(shell.indexOf("async function boot()"), shell.indexOf("async function login", shell.indexOf("async function boot()")));
  const setSection = shell.slice(shell.indexOf("function setSection"), shell.indexOf("function readLastSection", shell.indexOf("function setSection")));
  assert.doesNotMatch(boot, /await loadStock\(/);
  assert.doesNotMatch(setSection, /unloadRecipeFrame\(/);
  assert.match(setSection, /next === "stock"[\s\S]*loadStock\(\)/);
  assert.match(shell, /stockLoadPromise/);
});

test("Workforce 12 saniyelik full polling yerine revision SSE ve scoped GET kullanır", () => {
  const personel = read("apps/personel/workforce.js");
  const admin = read("apps/admin/scripts/workforce.js");
  assert.doesNotMatch(personel, /setInterval\(pollWorkforce,\s*12000\)/);
  assert.match(personel, /\/api\/workforce\/events/);
  assert.match(personel, /\/api\/workforce\/me\?\$\{query\.toString\(\)\}/);
  assert.match(personel, /scope: requestScopesForSection\(section\)/);
  assert.match(admin, /\/api\/admin\/workforce\/events/);
  assert.doesNotMatch(admin, /},\s*12000\)/);
});

test("Kapalı canlı önizleme snapshot/fingerprint üretmez", () => {
  const preview = read("apps/admin/scripts/live-preview.js");
  const update = preview.slice(preview.indexOf("updateForSection(section)"), preview.indexOf("mountOrUpdatePreview()", preview.indexOf("updateForSection(section)")));
  const notify = preview.slice(preview.indexOf("notifyDraft()", preview.indexOf("class GlobalLivePreviewDrawer")), preview.indexOf("markPublished", preview.indexOf("notifyDraft()", preview.indexOf("class GlobalLivePreviewDrawer"))));
  assert.match(update, /if \(this\.isOpen\) \{[\s\S]*captureSectionHistory/);
  assert.doesNotMatch(update.slice(update.indexOf("} else {")), /snapshot\(|fingerprint\(|clone\(/);
  assert.doesNotMatch(notify.slice(notify.indexOf("else")), /captureSectionHistory|snapshot\(|fingerprint\(|clone\(/);
});

test("Reçete istemcisi GET sonucunu korur ve SSE ready/invalidation olayını revision ile dedupe eder", () => {
  const recipe = read("apps/recipe/scripts/app.js");
  assert.match(recipe, /requestPromise/);
  assert.match(recipe, /addEventListener\("ready", handle\)/);
  assert.match(recipe, /scheduleRecipeRefresh\(revision/);
  assert.match(recipe, /incoming <= state\.revision/);
});
