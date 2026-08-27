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

test("personel ve Yönetici stok detayları gerçek Sarf, Eksilt ve güvenli kapatma akışını korur", () => {
  const personelHtml = source("apps/personel/index.html");
  const personelScript = source("apps/personel/personel.js");
  const personelCss = source("apps/personel/personel.css");
  const adminScript = source("apps/fatura/scripts/stock.js");

  assert.match(personelHtml, /id="stockDetailClose"[^>]*type="button"[^>]*aria-label="Ürün detayını kapat"/);
  assert.match(personelHtml, /data-stock-detail-action="waste">Sarf İşle</);
  assert.match(personelHtml, /data-stock-detail-action="manual_out">Eksilt</);
  assert.match(personelScript, /event\.target === els\.stockDetailModal\) closeStockDetail\(\)/);
  assert.match(personelScript, /event\.key === "Escape"[\s\S]*?closeStockDetail\(\)/);
  assert.match(personelScript, /if \(state\.stockAction\) \{[\s\S]*?if \(!state\.stockActionSubmitting\) closeStockAction\(\);[\s\S]*?return;/);
  assert.match(personelScript, /\/api\/stock\/movements/);
  assert.match(personelScript, /\/api\/workforce\/stock\/movements\/\$\{encodeURIComponent\(id\)\}\/reverse/);
  assert.match(personelScript, /stockQuantityToBase\(product, quantity, unit\)/);
  assert.match(personelCss, /stock-personel-modal[\s\S]*?font-family:\s*var\(--panel-font-ui/);
  assert.match(adminScript, /data-stock-drawer-action="manual_out">Eksilt</);
  assert.match(adminScript, /<span>Kafe Deposu<\/span>[\s\S]*?<span>Genel Depo<\/span>[\s\S]*?<span>Tüm Depolar<\/span>/);
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

test("Yönetici ürün select'leri yalnız change, eski düğmeler yalnız click ile işlenir", () => {
  const html = source("apps/admin/index.html");
  const script = source("apps/admin/scripts/app.js");
  const worker = source("apps/admin/sw.js");
  const categoryClick = functionSection(script, "handleProductCategoryTabs", "handleProductCategorySelect");
  const categoryChange = functionSection(script, "handleProductCategorySelect", "handleProductQuickList");
  const productClick = functionSection(script, "handleProductQuickList", "handleProductSelect");
  const productChange = functionSection(script, "handleProductSelect", "handleProductEditorCardClick");

  assert.match(script, /els\.productCategoryTabs\.addEventListener\("click", handleProductCategoryTabs\);/);
  assert.match(script, /els\.productQuickList\.addEventListener\("click", handleProductQuickList\);/);
  assert.match(script, /els\.productCategoryTabs\.addEventListener\("change", handleProductCategorySelect\);/);
  assert.match(script, /els\.productQuickList\.addEventListener\("change", handleProductSelect\);/);

  assert.match(categoryClick, /closest\("\[data-product-category-tab\]"\)/);
  assert.match(categoryClick, /state\.selectedCategoryId = button\.dataset\.productCategoryTab/);
  assert.doesNotMatch(categoryClick, /data-product-category-select|preventDefault\(/);
  assert.match(productClick, /closest\("\[data-product-chip\]"\)/);
  assert.match(productClick, /state\.selectedProductId = button\.dataset\.productChip/);
  assert.doesNotMatch(productClick, /data-product-select|preventDefault\(/);

  assert.match(categoryChange, /closest\("\[data-product-category-select\]"\)/);
  assert.match(categoryChange, /state\.selectedCategoryId = select\.value/);
  assert.match(productChange, /closest\("\[data-product-select\]"\)/);
  assert.match(productChange, /state\.selectedProductId = select\.value/);
  for (const handler of [categoryClick, categoryChange, productClick, productChange]) {
    assert.equal((handler.match(/renderActiveSection\("product"\)/g) || []).length, 1);
  }

  const appVersion = assetVersion(html, "scripts/app.js");
  assert.equal(assetVersion(html, "styles/admin.css"), appVersion);
  assert.match(worker, /version:\s*"(?!2026\.08\.16\.4")[^"]+"/);
  assert.match(worker, /"\/yonetici\/styles\/admin\.css"/);
  assert.match(worker, /"\/yonetici\/scripts\/app\.js"/);
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

function functionSection(script, name, nextName) {
  const start = script.indexOf(`  function ${name}(`);
  const end = script.indexOf(`\n  function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  assert.notEqual(end, -1, `${name} sonu bulunamadı`);
  return script.slice(start, end);
}

function assetVersion(html, relativePath) {
  const escapedPath = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`(?:href|src)="${escapedPath}\\?v=([^"&]+)`));
  assert.ok(match, `${relativePath} sürüm referansı bulunamadı`);
  return match[1];
}
