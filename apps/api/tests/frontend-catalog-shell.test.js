const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../../..");

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("personel sidebar tek ve erişilebilir logo düğmesiyle yönetiliyor", () => {
  const html = source("apps/personel/index.html");
  const script = source("apps/personel/personel.js");

  assert.match(html, /<button class="brand-block sidebar-logo-toggle" id="personelSidebarToggle"[^>]*aria-controls="personelSidebar"/);
  assert.equal((html.match(/id="personelSidebarToggle"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="sidebar-toggle"/);
  assert.doesNotMatch(script, /const brandBlock = document\.querySelector/);
  assert.match(script, /collapsed \? "Kenar çubuğunu aç" : "Kenar çubuğunu kapat"/);
  assert.match(script, /region\.inert = Boolean\(mobile && collapsed\)/);
});

test("Yönetici sidebar tek logo düğmesiyle açılır ve mobil kapalı durumda yeniden erişilebilir kalır", () => {
  const html = source("apps/admin/index.html");
  const script = source("apps/admin/scripts/app.js");
  const css = source("apps/admin/styles/admin-compact.css");

  assert.match(html, /<button class="brand-block sidebar-logo-toggle" id="sidebarToggle"[^>]*aria-controls="sidebarPanel"/);
  assert.equal((html.match(/id="sidebarToggle"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="icon-button sidebar-toggle"/);
  assert.match(script, /collapsed \? "Kenar çubuğunu aç" : "Kenar çubuğunu kapat"/);
  assert.match(script, /region\.inert = Boolean\(mobile && collapsed\)/);
  assert.match(css, /\.is-sidebar-collapsed \.sidebar-logo-toggle[\s\S]*?width:\s*48px/);
  assert.match(css, /\.is-sidebar-collapsed \.sidebar-scroll-region[\s\S]*?display:\s*none/);
});

test("Excel Veri Merkezi backend analiz, atomik apply ve revizyon kontrollü undo sözleşmesini kullanır", () => {
  const html = source("apps/admin/index.html");
  const script = source("apps/admin/scripts/app.js");
  const css = source("apps/admin/styles/admin-components.css");

  assert.match(html, /id="dataImportCenter"/);
  assert.match(html, /id="dataImportMenuFile"[^>]*accept="\.xlsx/);
  assert.match(html, /id="dataImportApply"[^>]*disabled>Onayla ve Atomik Uygula</);
  assert.match(script, /\/api\/admin\/data-imports\/analyze/);
  assert.match(script, /\/api\/admin\/data-imports\/apply/);
  assert.match(script, /\/api\/admin\/data-imports\/\$\{encodeURIComponent\(operationId\)\}\/undo/);
  assert.match(script, /"Idempotency-Key": requestId/);
  assert.match(css, /\.data-import-file-grid/);
  assert.match(css, /\.data-import-history-row/);
});

test("QR menü gömülü ürün kataloğu yerine boş API başlangıcı kullanıyor", () => {
  const html = source("apps/qr-menu/index.html");
  const script = source("apps/qr-menu/scripts/app.js");

  assert.match(script, /function loadMenuData\(\)[\s\S]*?categories: \[\]/);
  assert.doesNotMatch(script, /MANGO FROZEN|mango-frozen|window\.MENU|legacyMenuToCategories/);
  assert.match(html, /id="emptyState"[^>]*>Henüz veri aktarılmadı\.</);
});

test("reçete istemcisi yalnız backend ve canlı önizleme durumunu kabul ediyor", () => {
  const html = source("apps/recipe/index.html");
  const script = source("apps/recipe/scripts/app.js");

  assert.doesNotMatch(script, /DEFAULT_RECIPE_DATA|tahmisRecipeMenuData|tahmisci\.recipe\.state/);
  assert.match(script, /function loadRecipes\(\) \{\s*return \{\};\s*\}/);
  assert.match(script, /isRecipeStatePayload\(result\.recipeState\)/);
  assert.match(script, /state\.data = normalizeRecipeData\(result\.recipeState\)/);
  assert.match(html, /id="recipeEmpty"[^>]*>Henüz veri aktarılmadı\.</);
});

test("kullanıcıya açık hesap ve personel işlemleri Yönetici dilini kullanıyor", () => {
  const login = source("apps/auth/login.html");
  const passwordReset = source("apps/auth/password-reset/index.html");
  const workforce = source("apps/personel/workforce.js");

  assert.match(login, /Tahmisçi Yönetici Girişi/);
  assert.match(login, /Tahmisçi Yönetici Paneli/);
  assert.doesNotMatch(login, />Admin Paneli</);
  assert.match(passwordReset, /<h1 id="pageTitle">Şifremi Unuttum<\/h1>/);
  assert.match(passwordReset, /id="accountScopeLabel">Yönetici<\/strong>/);
  assert.doesNotMatch(passwordReset, />Admin(?: ve Personel)? Şifre Değiştirme</);
  assert.match(workforce, /Yöneticiye Bildir/);
  assert.doesNotMatch(workforce, />Admine Bildir</);
});
