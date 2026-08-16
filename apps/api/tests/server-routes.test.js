"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const runRoot = path.join(os.tmpdir(), `tahmisci-server-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATA_FILE = path.join(runRoot, "store.json");
process.env.MEDIA_DIR = path.join(runRoot, "media");
process.env.DEFAULT_PANEL_PASSWORD = "Panel123456";
process.env.DEFAULT_RECIPE_PASSWORD = "Recipe123456";
process.env.JWT_SECRET = "test-secret-that-is-longer-than-thirty-two-characters-123456789";
process.env.COOKIE_SECURE = "false";
process.env.ALLOW_LOCALHOST_ORIGINS = "true";
process.env.ALLOWED_ORIGINS = "https://admin.allowed.test,https://public.allowed.test";
process.env.PASSWORD_RESET_EMAIL = "reset@tahmisci.test";
process.env.PASSWORD_RESET_TEST_CODE = "654321";

const { app, prepareRuntime, store } = require("../src/server");
const { createFileStore } = require("../src/store/file-store");
const { defaultPricingCatalog } = require("../src/pricing");
const { stableRecipeId } = require("../src/store/migrations");
const { readWorkbook } = require("../src/simple-xlsx");
const menuDesignSchema = require("../../../shared/scripts/menu-design-schema");

let server;
let baseUrl;

test.before(async () => {
  await prepareRuntime();
  const recipeId = stableRecipeId("Sıcaklar", "Entegrasyon Kahvesi");
  await store.update((data) => {
    data.pricing = defaultPricingCatalog();
    data.recipeState = {
      Sıcaklar: {
        "Entegrasyon Kahvesi": {
          Standart: {
            id: "recipe-item-integration-coffee",
            content: "Kahve, su",
            preparation: "Güvenli test hazırlığı",
            active: true,
            sourceType: "manual",
            statusSource: "manual"
          }
        }
      }
    };
    data.recipeCatalog = [{ id: recipeId, category: "Sıcaklar", product: "Entegrasyon Kahvesi", active: true }];
    data.menuState = {
      settings: {},
      categories: [{
        id: "integration-category-hot",
        name: "Sıcaklar",
        active: true,
        order: 0,
        sourceType: "manual",
        statusSource: "manual",
        products: [{
          id: "integration-product-coffee",
          name: "Entegrasyon Kahvesi",
          active: true,
          order: 0,
          sourceType: "manual",
          statusSource: "manual",
          pricing: { typeId: "standard", values: { standard: { price: 80, active: true } } },
          contentMode: "recipe",
          recipeId,
          recipeSize: "Standart",
          manualContent: ""
        }]
      }]
    };
    return data;
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(runRoot, { recursive: true, force: true });
});

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

async function login() {
  const { response, body } = await json("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "Panel123456" })
  });
  assert.equal(response.status, 200);
  assert.ok(body.token);
  return body.token;
}

function adminHeaders(token, contentType = "application/json") {
  return { Authorization: `Bearer ${token}`, Origin: baseUrl, "Content-Type": contentType };
}

function responseCookie(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

test("QR menü açılır, devre dışı modüller 410 ve public bootstrap 200 döner", async () => {
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  const contentSecurityPolicy = String(home.headers.get("content-security-policy") || "");
  assert.match(contentSecurityPolicy, /frame-ancestors 'self' https:\/\/admin\.allowed\.test https:\/\/public\.allowed\.test/);
  assert.match(await home.text(), /Tahmis/i);
  const mudavim = await fetch(`${baseUrl}/mudavim/`);
  assert.equal(mudavim.status, 410);
  const qr = await fetch(`${baseUrl}/qr-menu/`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /Tahmisçi Dijital Menü/);
  const asset = await fetch(`${baseUrl}/assets/images/hero/tahmisci-barista-main.jpg`);
  assert.equal(asset.status, 200);

  const { response, body } = await json("/api/public/bootstrap");
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.menu);

  const previewConfig = await json("/api/public/preview-config");
  assert.equal(previewConfig.response.status, 200);
  assert.equal(previewConfig.body.schemaVersion, 1);
  assert.ok(previewConfig.body.allowedOrigins.includes(baseUrl));
  assert.equal(previewConfig.response.headers.get("cache-control"), "no-store");
});

test("PWA kimlik manifestleri ve bütün üretim ikonları gerçek statik yoldan yayınlanır", async () => {
  const applications = [
    {
      manifestPath: "/qr-menu/manifest.webmanifest",
      iconRoot: "/assets/app-icons/menu",
      name: "Tahmisçi Dijital Menü",
      shortName: "Tahmisçi",
      id: "/",
      startUrl: "/",
      scope: "/"
    },
    {
      manifestPath: "/personel/manifest.webmanifest",
      iconRoot: "/assets/app-icons/personel",
      name: "Tahmisçi Personel",
      shortName: "Personel",
      id: "/personel/",
      startUrl: "/personel/",
      scope: "/personel/"
    },
    {
      manifestPath: "/yonetici/manifest.webmanifest",
      iconRoot: "/assets/app-icons/yonetici",
      name: "Tahmisçi Yönetici",
      shortName: "Yönetici",
      id: "/yonetici/",
      startUrl: "/yonetici/",
      scope: "/yonetici/"
    }
  ];
  const iconSizes = new Map([
    ["favicon-32.png", 32],
    ["favicon-48.png", 48],
    ["apple-touch-icon-180.png", 180],
    ["icon-192.png", 192],
    ["icon-maskable-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
    ["master-1024.png", 1024]
  ]);

  for (const application of applications) {
    const manifestResponse = await fetch(`${baseUrl}${application.manifestPath}`);
    assert.equal(manifestResponse.status, 200, application.manifestPath);
    assert.match(String(manifestResponse.headers.get("content-type") || ""), /application\/(manifest\+json|json)/i);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, application.name);
    assert.equal(manifest.short_name, application.shortName);
    assert.equal(manifest.id, application.id);
    assert.equal(manifest.start_url, application.startUrl);
    assert.equal(manifest.scope, application.scope);
    assert.deepEqual(manifest.icons.map((icon) => icon.purpose), ["any", "any", "maskable", "maskable"]);

    for (const [filename, size] of iconSizes) {
      const iconResponse = await fetch(`${baseUrl}${application.iconRoot}/${filename}`);
      assert.equal(iconResponse.status, 200, `${application.iconRoot}/${filename}`);
      assert.match(String(iconResponse.headers.get("content-type") || ""), /^image\/png/i);
      const bytes = Buffer.from(await iconResponse.arrayBuffer());
      assert.equal(bytes.toString("ascii", 1, 4), "PNG");
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
    }
  }
});

test("vintage reçete SVG'leri gerçek production /assets route'undan yayınlanır", async () => {
  const logo = await fetch(`${baseUrl}/assets/brand/logo-primary.png`);
  assert.equal(logo.status, 200);
  assert.match(String(logo.headers.get("content-type") || ""), /^image\/png\b/i);

  const assetNames = ["cezve.svg", "cold-glass.svg", "barista.svg", "pour-over.svg", "recipe-notes.svg"];
  for (const name of assetNames) {
    const response = await fetch(`${baseUrl}/assets/images/recipe-vintage/${name}`);
    assert.equal(response.status, 200, `${name} production static route üzerinden bulunmalı`);
    assert.match(String(response.headers.get("content-type") || ""), /^image\/svg\+xml\b/i, `${name} SVG Content-Type dönmeli`);
    const body = await response.text();
    assert.ok(body.trim().startsWith("<svg"), `${name} gerçek SVG gövdesi dönmeli`);
    assert.doesNotMatch(body, /<!doctype\s+html|<html\b/i, `${name} HTML fallback dönmemeli`);
  }
});

test("reçete ve admin yazma uçları yetkisiz erişime kapalıdır", async () => {
  assert.equal((await fetch(`${baseUrl}/api/recipes`, { redirect: "manual" })).status, 401);
  assert.equal((await fetch(`${baseUrl}/recipe-data.js`, { redirect: "manual" })).status, 410);
  assert.equal((await fetch(`${baseUrl}/menu-data.js`, { redirect: "manual" })).status, 410);
  const current = (await json("/api/menu")).body.menuState;
  const denied = await json("/api/menu", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ menuState: current })
  });
  assert.equal(denied.response.status, 401);
  const previewDenied = await json("/api/admin/preview-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ mode: "menu" })
  });
  assert.equal(previewDenied.response.status, 401);
  assert.equal((await json("/api/admin/pricing/history")).response.status, 401);
  const pricingUndoDenied = await json("/api/admin/pricing/history/pricing-operation-test/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, "Idempotency-Key": "unauthorized-pricing-undo" },
    body: JSON.stringify({ requestId: "unauthorized-pricing-undo", expectedRevision: 0 })
  });
  assert.equal(pricingUndoDenied.response.status, 401);
});

test("eski Excel aktarım uçları güvenle 410 döner ve Veri Merkezi akışına dokunmaz", async () => {
  const token = await login();
  const retiredPaths = [
    "/api/admin/products/import-excel",
    "/api/admin/pricing/import-excel/analyze",
    "/api/admin/pricing/import-excel/apply",
    "/api/admin/recipes/import-excel",
    "/api/admin/stock/import-excel"
  ];

  const unauthorized = await json(retiredPaths[0], {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/octet-stream" },
    body: Buffer.from("yetkisiz")
  });
  assert.equal(unauthorized.response.status, 401, "emekli uçlarda Yönetici yetkisi denetimi korunmalı");

  const rejectedOrigin = await json(retiredPaths[0], {
    method: "POST",
    headers: { ...adminHeaders(token, "application/octet-stream"), Origin: "https://evil.example" },
    body: Buffer.from("geçersiz-origin")
  });
  assert.equal(rejectedOrigin.response.status, 403, "origin denetimi 410 yanıtından önce çalışmalı");

  const before = await store.read();
  const beforeCatalogs = JSON.stringify({
    menuState: before.menuState,
    pricing: before.pricing,
    recipeState: before.recipeState,
    stockState: before.stockState,
    revisions: before.revisions,
    history: before.dataImportHistory
  });

  for (const pathname of retiredPaths) {
    const isApply = pathname.endsWith("/apply");
    const result = await json(pathname, {
      method: "POST",
      headers: adminHeaders(token, isApply ? "application/json" : "application/octet-stream"),
      body: isApply ? JSON.stringify({}) : Buffer.from("eski-excel-verisi")
    });
    assert.equal(result.response.status, 410, `${pathname} kalıcı olarak emekli olmalı`);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, "EXCEL_IMPORT_ENDPOINT_RETIRED");
    assert.equal(result.body.replacement, "/api/admin/data-imports");
    assert.match(result.body.message, /Excel Veri Merkezi/i);
  }

  const after = await store.read();
  const afterCatalogs = JSON.stringify({
    menuState: after.menuState,
    pricing: after.pricing,
    recipeState: after.recipeState,
    stockState: after.stockState,
    revisions: after.revisions,
    history: after.dataImportHistory
  });
  assert.equal(afterCatalogs, beforeCatalogs, "emekli uçlar store üzerinde hiçbir yazma yapmamalı");

  const dataImportHistory = await json("/api/admin/data-imports/history?limit=1", {
    headers: adminHeaders(token)
  });
  assert.equal(dataImportHistory.response.status, 200, "yeni Excel Veri Merkezi akışı erişilebilir kalmalı");
  assert.equal(dataImportHistory.body.ok, true);
});

test("Excel Veri Merkezi analiz, atomik apply, idempotent replay, kalıcı yedek ve güvenli undo sağlar", async () => {
  const token = await login();
  const templatePath = path.resolve(__dirname, "../../../data/templates/recipe-import.xlsx");
  const templateBuffer = await fs.readFile(templatePath);
  const contentBase64 = templateBuffer.toString("base64");
  const recipeWorkbook = readWorkbook(templateBuffer);
  const recipeProductNames = [...new Set(recipeWorkbook.SheetNames.flatMap((sheetName) => (
    recipeWorkbook.Sheets[sheetName] || []
  )).map((row) => String(row["Ürün Adı"] || "").trim()).filter(Boolean))];
  await store.update((data) => {
    const category = {
      id: "data-import-recipe-link-fixtures",
      name: "Reçete Import Bağlantıları",
      active: true,
      order: (data.menuState.categories || []).length,
      sourceType: "manual",
      statusSource: "manual",
      products: recipeProductNames.map((name, index) => ({
        id: `data-import-recipe-product-${index + 1}`,
        name,
        active: true,
        order: index,
        sourceType: "manual",
        statusSource: "manual",
        pricing: { typeId: "standard", values: { standard: { price: 1, active: true } } }
      }))
    };
    data.menuState.categories = (data.menuState.categories || []).filter((item) => item.id !== category.id).concat(category);
    return data;
  });
  const analyzeRequestId = `data-import-analyze-${Date.now()}`;
  const analyzeBody = {
    requestId: analyzeRequestId,
    files: { recipe: { filename: "TAHMISCI_RECETE.xlsx", contentBase64 } }
  };
  const analyzed = await json("/api/admin/data-imports/analyze", {
    method: "POST",
    headers: { ...adminHeaders(token), "X-Request-ID": analyzeRequestId },
    body: JSON.stringify(analyzeBody)
  });
  assert.equal(analyzed.response.status, 201);
  assert.equal(analyzed.body.canApply, true);
  assert.ok(analyzed.body.analysisId);
  assert.ok(analyzed.body.report.newRecipes > 0);

  const analyzeReplay = await json("/api/admin/data-imports/analyze", {
    method: "POST",
    headers: { ...adminHeaders(token), "X-Request-ID": analyzeRequestId },
    body: JSON.stringify(analyzeBody)
  });
  assert.equal(analyzeReplay.response.status, 200);
  assert.equal(analyzeReplay.body.analysisId, analyzed.body.analysisId);

  const applyRequestId = `data-import-apply-${Date.now()}`;
  const applyBody = {
    analysisId: analyzed.body.analysisId,
    expectedRevision: analyzed.body.expectedRevision,
    confirmArchiveImpact: analyzed.body.report.requiresArchiveConfirmation === true,
    requestId: applyRequestId
  };
  if (analyzed.body.report.requiresArchiveConfirmation === true) {
    const unconfirmed = await json("/api/admin/data-imports/apply", {
      method: "POST",
      headers: { ...adminHeaders(token), "Idempotency-Key": applyRequestId },
      body: JSON.stringify({ ...applyBody, confirmArchiveImpact: false })
    });
    assert.equal(unconfirmed.response.status, 409);
    assert.match(unconfirmed.body.message, /arşiv/i);
  }
  const applied = await json("/api/admin/data-imports/apply", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": applyRequestId },
    body: JSON.stringify(applyBody)
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.ok(applied.body.operationId);
  assert.equal(applied.body.canUndo, true);

  const applyReplay = await json("/api/admin/data-imports/apply", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": applyRequestId },
    body: JSON.stringify(applyBody)
  });
  assert.equal(applyReplay.response.status, 200);
  assert.equal(applyReplay.body.operationId, applied.body.operationId);
  assert.equal(applyReplay.body.revision, applied.body.revision);

  const restartedStore = createFileStore(process.env.DATA_FILE, {
    defaultPanelPassword: "Panel123456",
    defaultRecipePassword: "Recipe123456"
  });
  const persistedAfterRestart = await restartedStore.read();
  assert.ok((persistedAfterRestart.dataImportHistory || []).some((item) => item.id === applied.body.operationId));
  assert.ok(Object.keys(persistedAfterRestart.recipeState || {}).length > 1, "aktarılmış reçeteler yeni store örneğinde korunmalı");

  const history = await json("/api/admin/data-imports/history?limit=20", { headers: adminHeaders(token) });
  assert.equal(history.response.status, 200);
  const historyItem = history.body.history.find((item) => item.id === applied.body.operationId);
  assert.ok(historyItem);
  assert.equal(historyItem.canUndo, true);

  const backupRoot = path.join(path.dirname(process.env.DATA_FILE), "backups");
  const backupFiles = await fs.readdir(backupRoot);
  assert.ok(backupFiles.some((name) => name.includes("excel-import") && name.endsWith(".json")));

  const undoRequestId = `data-import-undo-${Date.now()}`;
  const undoBody = { expectedRevision: applied.body.revision, requestId: undoRequestId };
  const undone = await json(`/api/admin/data-imports/${encodeURIComponent(applied.body.operationId)}/undo`, {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": undoRequestId },
    body: JSON.stringify(undoBody)
  });
  assert.equal(undone.response.status, 200);
  assert.equal(undone.body.sourceOperationId, applied.body.operationId);

  const undoReplay = await json(`/api/admin/data-imports/${encodeURIComponent(applied.body.operationId)}/undo`, {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": undoRequestId },
    body: JSON.stringify(undoBody)
  });
  assert.equal(undoReplay.response.status, 200);
  assert.equal(undoReplay.body.operationId, undone.body.operationId);
});

test("admin fiyat ve reçete içeriği yayınları public bootstrap'a yansır", async () => {
  const token = await login();
  const menuResult = await json("/api/menu");
  const menu = menuResult.body.menuState;
  const linkedProduct = menu.categories.flatMap((category) => category.products).find((product) => product.recipeId);
  assert.ok(linkedProduct, "başlangıç migration'ı güvenli bir reçete bağlantısı kurmalı");
  const pricingValues = linkedProduct.pricing && linkedProduct.pricing.values;
  const pricingOptionIds = Object.keys(pricingValues || {});
  assert.ok(pricingOptionIds.length, "ürünün kanonik fiyat seçeneği bulunmalı");
  for (const optionId of pricingOptionIds) {
    pricingValues[optionId] = { ...pricingValues[optionId], price: 321, active: true };
  }
  let saved = await json("/api/menu", {
    method: "PUT",
    headers: adminHeaders(token),
    body: JSON.stringify({ menuState: menu })
  });
  assert.equal(saved.response.status, 200);
  let bootstrap = (await json("/api/public/bootstrap")).body;
  assert.equal(bootstrap.menu.products.find((product) => product.id === linkedProduct.id).basePrice, 321);

  const recipesResult = await json("/api/recipes", { headers: adminHeaders(token) });
  assert.equal(recipesResult.response.status, 200);
  const record = recipesResult.body.recipeCatalog.find((item) => item.id === linkedProduct.recipeId);
  assert.ok(record);
  const sizes = recipesResult.body.recipeState[record.category][record.product];
  const sizeName = linkedProduct.recipeSize && sizes[linkedProduct.recipeSize] ? linkedProduct.recipeSize : Object.keys(sizes)[0];
  const previous = sizes[sizeName];
  sizes[sizeName] = typeof previous === "string"
    ? { content: "Public içerik güncellendi", preparation: "Gizli hazırlık" }
    : { ...previous, content: "Public içerik güncellendi", preparation: "Gizli hazırlık" };
  saved = await json("/api/recipes", {
    method: "PUT",
    headers: adminHeaders(token),
    body: JSON.stringify({ recipeState: recipesResult.body.recipeState, recipeCatalog: recipesResult.body.recipeCatalog })
  });
  assert.equal(saved.response.status, 200);
  bootstrap = (await json("/api/public/bootstrap")).body;
  const publicProduct = bootstrap.menu.products.find((product) => product.id === linkedProduct.id);
  assert.equal(publicProduct.content, "Public içerik güncellendi");
  assert.equal(JSON.stringify(bootstrap).includes("Gizli hazırlık"), false);
});

test("toplu fiyat işlemi idempotent, revision kontrollü, geçmişe kayıtlı ve güvenle geri alınabilir", async () => {
  const token = await login();
  const pricingResult = await json("/api/admin/pricing", { headers: adminHeaders(token) });
  assert.equal(pricingResult.response.status, 200);
  const menuBefore = (await json("/api/menu")).body.menuState;
  const publicBefore = (await json("/api/public/bootstrap")).body;
  const publicProductIds = new Set((publicBefore.menu && publicBefore.menu.products || []).map((product) => String(product.id)));
  const catalogTypes = new Map((pricingResult.body.pricing.types || []).map((type) => [String(type.id), type]));
  let target = null;
  for (const category of menuBefore.categories || []) {
    for (const product of category.products || []) {
      if (!publicProductIds.has(String(product.id))) continue;
      const productPricing = product.pricing && typeof product.pricing === "object" ? product.pricing : {};
      const type = catalogTypes.get(String(productPricing.typeId || ""));
      if (!type) continue;
      const option = (type.options || []).find((candidate) => {
        const record = productPricing.values && productPricing.values[candidate.id];
        return candidate.active !== false && record && record.active !== false && Number.isFinite(Number(record.price));
      });
      if (!option) continue;
      target = {
        categoryId: String(category.id),
        productId: String(product.id),
        typeId: String(type.id),
        optionId: String(option.id),
        price: Number(productPricing.values[option.id].price)
      };
      break;
    }
    if (target) break;
  }
  assert.ok(target, "toplu fiyat testi için public menüde aktif fiyatlı ürün bulunmalı");

  const nextPrice = Math.round((target.price + 7.25) * 100) / 100;
  const requestId = `pricing-bulk-test-${Date.now()}`;
  const bulkBody = {
    requestId,
    expectedRevision: pricingResult.body.revision,
    typeId: target.typeId,
    optionIds: [target.optionId],
    productIds: [target.productId],
    operation: "set",
    value: nextPrice,
    rounding: null
  };
  const bulkHeaders = { ...adminHeaders(token), "Idempotency-Key": requestId };
  const applied = await json("/api/admin/pricing/bulk-update", {
    method: "POST",
    headers: bulkHeaders,
    body: JSON.stringify(bulkBody)
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.changedRowCount, 1);
  assert.equal(applied.body.affectedProductCount, 1);
  assert.equal(applied.body.canUndo, true);
  assert.ok(applied.body.operationId);

  const replayed = await json("/api/admin/pricing/bulk-update", {
    method: "POST",
    headers: bulkHeaders,
    body: JSON.stringify(bulkBody)
  });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.body.operationId, applied.body.operationId);
  assert.equal(replayed.body.revision, applied.body.revision);

  const conflictId = `pricing-conflict-${Date.now()}`;
  const conflict = await json("/api/admin/pricing/bulk-update", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": conflictId },
    body: JSON.stringify({ ...bulkBody, requestId: conflictId })
  });
  assert.equal(conflict.response.status, 409);

  const menuApplied = (await json("/api/menu")).body.menuState;
  const appliedProduct = menuApplied.categories.flatMap((category) => category.products || [])
    .find((product) => String(product.id) === target.productId);
  assert.equal(appliedProduct.pricing.values[target.optionId].price, nextPrice);
  const publicApplied = (await json("/api/public/bootstrap")).body.menu.products
    .find((product) => String(product.id) === target.productId);
  assert.equal(publicApplied.priceOptions.find((option) => String(option.id) === target.optionId).price, nextPrice);

  let history = await json("/api/admin/pricing/history?limit=20", { headers: adminHeaders(token) });
  assert.equal(history.response.status, 200);
  const historyItem = history.body.history.find((item) => item.id === applied.body.operationId);
  assert.ok(historyItem);
  assert.equal(historyItem.canUndo, true);

  const undoRequestId = `pricing-undo-test-${Date.now()}`;
  const undoBody = { requestId: undoRequestId, expectedRevision: applied.body.revision };
  const undoHeaders = { ...adminHeaders(token), "Idempotency-Key": undoRequestId };
  const undone = await json(`/api/admin/pricing/history/${encodeURIComponent(applied.body.operationId)}/undo`, {
    method: "POST",
    headers: undoHeaders,
    body: JSON.stringify(undoBody)
  });
  assert.equal(undone.response.status, 200);
  assert.equal(undone.body.undoOf, applied.body.operationId);
  assert.equal(undone.body.canUndo, false);

  const undoReplay = await json(`/api/admin/pricing/history/${encodeURIComponent(applied.body.operationId)}/undo`, {
    method: "POST",
    headers: undoHeaders,
    body: JSON.stringify(undoBody)
  });
  assert.equal(undoReplay.response.status, 200);
  assert.equal(undoReplay.body.operationId, undone.body.operationId);
  assert.equal(undoReplay.body.revision, undone.body.revision);

  const secondUndoId = `pricing-second-undo-${Date.now()}`;
  const secondUndo = await json(`/api/admin/pricing/history/${encodeURIComponent(applied.body.operationId)}/undo`, {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": secondUndoId },
    body: JSON.stringify({ requestId: secondUndoId, expectedRevision: undone.body.revision })
  });
  assert.equal(secondUndo.response.status, 409);

  const menuRestored = (await json("/api/menu")).body.menuState;
  const restoredProduct = menuRestored.categories.flatMap((category) => category.products || [])
    .find((product) => String(product.id) === target.productId);
  assert.equal(restoredProduct.pricing.values[target.optionId].price, target.price);
  const publicRestored = (await json("/api/public/bootstrap")).body.menu.products
    .find((product) => String(product.id) === target.productId);
  assert.equal(publicRestored.priceOptions.find((option) => String(option.id) === target.optionId).price, target.price);

  history = await json("/api/admin/pricing/history?limit=20", { headers: adminHeaders(token) });
  const restoredHistoryItem = history.body.history.find((item) => item.id === applied.body.operationId);
  assert.equal(restoredHistoryItem.canUndo, false);
  assert.ok(restoredHistoryItem.undoneAt);
  assert.ok(history.body.history.some((item) => item.undoOf === applied.body.operationId));
});

test("tek admin publish isteği tasarımı canonical readback ve public bootstrap'ta korur", async () => {
  const token = await login();
  const menuResult = await json("/api/menu");
  assert.equal(menuResult.response.status, 200);
  const menu = menuDesignSchema.normalizeMenuState(menuResult.body.menuState);
  const category = menu.categories[0];
  const product = category.products[0];
  assert.ok(category && product, "yayın testi için en az bir kategori ve ürün bulunmalı");

  menu.settings = {
    ...menu.settings,
    appliedPresetId: "integration-api-custom",
    bgColor: "#172b36",
    darkBgColor: "#0c151a",
    accentColor: "#b9502d",
    textColor: "#2c1609",
    buttonTextColor: "#fffaf3",
    cardColor: "rgba(255,250,243,.92)",
    productCardColor: "#fff6e9",
    categoryCardColor: "#f3dfc8",
    socialIconColor: "#6a3821",
    socialIconSize: 36,
    menuBackgroundImage: "/media/api-menu-background.jpg",
    menuBackground: {
      type: "gradient",
      image: "",
      imageUrl: "",
      gradientStart: "#f8eee1",
      gradientEnd: "#dfc2a3",
      gradientAngle: 118,
      overlay: 0.24
    },
    fonts: { title: "API Özel Başlık", category: "API Özel Kategori", product: "API Özel Ürün" },
    typography: { menuTitle: 42, categoryTitle: 28, productTitle: 18, productDesc: 13, productIngredients: 12, productPrice: 15 },
    bottomActions: {
      popular: { type: "solid", color: "#542b19", image: "", imageUrl: "", gradientStart: "#542b19", gradientEnd: "#6a3821", gradientAngle: 90, overlay: 0.08 },
      suggest: { type: "image", color: "#6a3821", image: "", imageUrl: "/media/api-suggest.jpg", gradientStart: "#6a3821", gradientEnd: "#7d4a31", gradientAngle: 135, overlay: 0.21 }
    },
    banner: {
      mode: "video",
      title: "API yayın başlığı",
      subtitle: "Canonical tasarım doğrulaması",
      video: "/media/api-banner.mp4",
      videoUrl: "https://cdn.example.test/api-banner.mp4",
      videos: [{ id: "api-video", src: "https://cdn.example.test/api-banner.mp4", name: "API video", type: "video/mp4", size: 2048, kind: "video" }],
      images: [{ id: "api-image", src: "/media/api-banner.jpg", name: "API görsel", type: "image/jpeg", size: 1024, kind: "image" }],
      productIds: [product.id]
    },
    menuUpdateDate: "2026-08-02",
    adminOnlyRoundtripMarker: "canonical-store-only"
  };
  category.color = "#4c2d1d";
  category.image = "/media/api-category.jpg";
  category.style = {
    type: "gradient",
    color: "#4c2d1d",
    image: "",
    imageUrl: "",
    gradientStart: "#4c2d1d",
    gradientEnd: "#8b634a",
    gradientAngle: 132,
    overlay: 0.19
  };
  product.cardColor = "#fff0dc";
  product.imageUrl = "/media/api-product.jpg";
  product.imageOverlay = 0.17;
  product.style = {
    type: "image",
    color: "#fff0dc",
    image: "",
    imageUrl: "/media/api-product-card.jpg",
    gradientStart: "#fff0dc",
    gradientEnd: "#e2bea0",
    gradientAngle: 147,
    overlay: 0.17
  };

  const publishState = await json("/api/admin/publish-state", { headers: adminHeaders(token) });
  assert.equal(publishState.response.status, 200);
  const requestId = `design-roundtrip-${Date.now()}`;
  const published = await json("/api/admin/publish", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify({
      requestId,
      expectedRevision: publishState.body.revision,
      changes: { menuState: menu }
    })
  });
  assert.equal(published.response.status, 200);
  assert.equal(published.body.ok, true);
  assert.deepEqual(published.body.changedScopes, ["menu"]);

  const readback = await json("/api/menu");
  assert.equal(readback.response.status, 200);
  assert.equal(readback.body.publishRevision, published.body.revision);
  assert.equal(menuDesignSchema.designFingerprint(readback.body.menuState), menuDesignSchema.designFingerprint(menu));
  assert.equal(readback.body.menuState.settings.banner.videos[0].src, "https://cdn.example.test/api-banner.mp4");
  assert.equal(readback.body.menuState.categories[0].style.gradientStart, "#4c2d1d");
  assert.equal(readback.body.menuState.categories[0].products[0].style.imageUrl, "/media/api-product-card.jpg");

  const publicResult = await json("/api/public/bootstrap");
  assert.equal(publicResult.response.status, 200);
  const publicSettings = publicResult.body.menu.settings;
  const publicCategory = publicResult.body.menu.categories.find((item) => item.id === category.id);
  const publicProduct = publicResult.body.menu.products.find((item) => item.id === product.id);
  assert.equal(publicSettings.bgColor, "#172b36");
  assert.equal(publicSettings.fonts.title, "API Özel Başlık");
  assert.equal(publicSettings.typography.menuTitle, 42);
  assert.equal(publicSettings.banner.videoUrl, "https://cdn.example.test/api-banner.mp4");
  assert.equal(publicSettings.banner.images[0].src, "/media/api-banner.jpg");
  assert.equal(publicCategory.style.gradientEnd, "#8b634a");
  assert.equal(publicProduct.cardColor, "#fff0dc");
  assert.equal(publicProduct.style.imageUrl, "/media/api-product-card.jpg");
  assert.equal(JSON.stringify(publicResult.body).includes("canonical-store-only"), false, "admin-only alan public projection'a sızmamalı");
});

test("zararlı siteState ve geçersiz medya admin oturumunda da reddedilir", async () => {
  const token = await login();
  const malicious = await json("/api/site", {
    method: "PUT",
    headers: adminHeaders(token),
    body: JSON.stringify({ siteState: { seo: { canonicalUrl: "javascript:alert(1)" } } })
  });
  assert.equal(malicious.response.status, 410);

  const upload = await fetch(`${baseUrl}/api/media`, {
    method: "POST",
    headers: { ...adminHeaders(token, "image/png"), "X-Media-Kind": "image", "X-File-Name": "fake.png" },
    body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  });
  assert.equal(upload.status, 400);
});

test("admin ve personel cookie oturumları birbirinden ayrılır", async () => {
  const adminLogin = await json("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "Panel123456" })
  });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = responseCookie(adminLogin.response);
  assert.ok(adminCookie);

  const username = `faz1-session-${Date.now()}`;
  const password = "Personel123456";
  const created = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(adminLogin.body.token),
    body: JSON.stringify({ name: "Faz 1 Personel", username, password })
  });
  assert.equal(created.response.status, 201);
  const expectedUserId = created.body.user.id;

  const adminOnlyMe = await json("/api/recipe/me", {
    headers: { Origin: baseUrl, Cookie: adminCookie }
  });
  assert.equal(adminOnlyMe.response.status, 401, "admin cookie personel başlangıç oturumu sayılmamalı");

  const invalidPreview = await json("/api/recipe/me?previewToken=invalid", {
    headers: { Origin: baseUrl, Cookie: adminCookie }
  });
  assert.equal(invalidPreview.response.status, 401, "geçersiz preview token admin cookie ile aşılmamalı");

  const preview = await json("/api/admin/preview-token", {
    method: "POST",
    headers: adminHeaders(adminLogin.body.token),
    body: JSON.stringify({ mode: "personel" })
  });
  assert.equal(preview.response.status, 200);
  assert.ok(preview.body.allowedOrigins.includes(baseUrl));
  assert.equal(preview.body.publicOrigin, baseUrl);
  const invalidPreviewSession = await json("/api/public/preview-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ previewToken: "invalid" })
  });
  assert.equal(invalidPreviewSession.response.status, 401);
  const validPreviewSession = await json("/api/public/preview-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ previewToken: preview.body.previewToken })
  });
  assert.equal(validPreviewSession.response.status, 200);
  assert.equal(validPreviewSession.body.mode, "personel");
  const previewMe = await json(`/api/recipe/me?previewToken=${encodeURIComponent(preview.body.previewToken)}`, {
    headers: { Origin: baseUrl }
  });
  assert.equal(previewMe.response.status, 200);
  assert.equal(previewMe.body.role, "preview");
  assert.ok(previewMe.body.user && previewMe.body.user.id);

  const personelLogin = await json("/api/recipe/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username, password })
  });
  assert.equal(personelLogin.response.status, 200);
  const personelCookie = responseCookie(personelLogin.response);
  assert.ok(personelCookie);

  const personelOnly = await json("/api/workforce/me", {
    headers: { Origin: baseUrl, Cookie: personelCookie }
  });
  assert.equal(personelOnly.response.status, 200);
  assert.equal(personelOnly.body.user.id, expectedUserId);

  const bothCookies = `${adminCookie}; ${personelCookie}`;
  const bothWorkforce = await json("/api/workforce/me", {
    headers: { Origin: baseUrl, Cookie: bothCookies }
  });
  assert.equal(bothWorkforce.response.status, 200);
  assert.equal(bothWorkforce.body.user.id, expectedUserId);

  const adminStillActive = await json("/api/admin/me", {
    headers: { Origin: baseUrl, Cookie: bothCookies }
  });
  assert.equal(adminStillActive.response.status, 200);
  assert.equal(adminStillActive.body.role, "admin");

  const avatarBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const avatar = await fetch(`${baseUrl}/api/recipe/profile/avatar`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: personelCookie,
      "Content-Type": "image/png",
      "X-File-Name": "avatar.png"
    },
    body: avatarBytes
  });
  assert.equal(avatar.status, 201, "avatar yolu gerçek personel cookie oturumunu kabul etmeli");

  const adminLogout = await json("/api/admin/logout", {
    method: "POST",
    headers: { Origin: baseUrl, Cookie: bothCookies }
  });
  assert.equal(adminLogout.response.status, 200);
  assert.equal((await json("/api/admin/me", { headers: { Origin: baseUrl, Cookie: adminCookie } })).response.status, 401);
  assert.equal((await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: personelCookie } })).response.status, 200);

  const secondAdminLogin = await json("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "Panel123456" })
  });
  const secondAdminCookie = responseCookie(secondAdminLogin.response);
  const personelLogout = await json("/api/recipe/logout", {
    method: "POST",
    headers: { Origin: baseUrl, Cookie: `${secondAdminCookie}; ${personelCookie}` }
  });
  assert.equal(personelLogout.response.status, 200);
  assert.equal((await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: personelCookie } })).response.status, 401);
  assert.equal((await json("/api/admin/me", { headers: { Origin: baseUrl, Cookie: secondAdminCookie } })).response.status, 200);
});

test("admin personel e-postasını benzersiz ve doğrulama bekleyen hesap alanı olarak yönetir", async () => {
  const token = await login();
  const suffix = Date.now();
  const username = `email-personel-${suffix}`;
  const firstEmail = `Personel-${suffix}@Tahmisci.Test`;
  const created = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({ name: "E-posta Personeli", username, password: "Personel123456", email: firstEmail })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.user.email, firstEmail.toLowerCase());
  assert.equal(created.body.user.emailVerifiedAt, null);
  assert.equal(created.body.user.emailVerificationRequired, true);
  assert.deepEqual(created.body.user.security.email, created.body.user.email);

  const duplicate = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({ name: "Çakışan E-posta", username: `${username}-dup`, password: "Personel123456", email: firstEmail })
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal("users" in duplicate.body, false, "benzersizlik hatası personel listesini sızdırmamalı");

  await store.update((data) => {
    const user = data.recipeUsers.find((item) => item.id === created.body.user.id);
    user.emailVerifiedAt = new Date().toISOString();
    user.emailVerificationRequired = false;
    return data;
  });
  const nextEmail = `yeni-${suffix}@tahmisci.test`;
  const updated = await json(`/api/admin/recipe-users/${encodeURIComponent(created.body.user.id)}`, {
    method: "PUT",
    headers: adminHeaders(token),
    body: JSON.stringify({ name: "E-posta Personeli", username, active: true, email: nextEmail })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.user.email, firstEmail.toLowerCase(), "doğrulanmış adres onay gelene kadar korunmalı");
  assert.equal(updated.body.user.pendingEmail, nextEmail);
  assert.equal(updated.body.user.emailVerificationRequired, true);
  assert.ok((await store.read()).securityAudit.some((item) => item.action === "personnel_email_assigned" && item.accountId === created.body.user.id));
});

test("personel yaşam döngüsü oturumları kapatır, geçmiş kimliği korur ve kalıcı silmeyi güvenle uygular", async () => {
  const adminToken = await login();
  const username = `lifecycle-${Date.now()}`;
  const password = "Personel123456";
  const created = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ name: "Yaşam Döngüsü Personeli", username, password })
  });
  assert.equal(created.response.status, 201);
  const userId = created.body.user.id;

  const firstLogin = await json("/api/recipe/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username, password })
  });
  assert.equal(firstLogin.response.status, 200);
  const firstCookie = responseCookie(firstLogin.response);

  await store.update((data) => {
    data.recipeAssignments = (data.recipeAssignments || []).concat({
      id: `historic-recipe-${userId}`,
      userId,
      name: "Yaşam Döngüsü Personeli",
      username,
      assignmentKind: "homework",
      status: "completed",
      createdAt: new Date().toISOString()
    });
    data.recipeActivity = (data.recipeActivity || []).concat({
      id: `historic-activity-${userId}`,
      type: "homework_completed",
      userId,
      name: "Yaşam Döngüsü Personeli",
      username,
      createdAt: new Date().toISOString()
    });
    data.workforceTasks = (data.workforceTasks || []).concat({
      id: `historic-task-${userId}`,
      title: "Geçmiş görev",
      items: [{ id: "item-1", text: "Korunacak madde" }],
      assignedUserIds: [userId],
      status: "active",
      createdAt: new Date().toISOString()
    });
    data.workforceAssignments = (data.workforceAssignments || []).concat({
      id: `historic-workforce-${userId}`,
      taskId: `historic-task-${userId}`,
      userId,
      userName: "Yaşam Döngüsü Personeli",
      username,
      status: "completed",
      completedItemIds: ["item-1"],
      createdAt: new Date().toISOString()
    });
    return data;
  });

  const deniedPermanentDelete = await json(`/api/admin/recipe-users/${encodeURIComponent(userId)}/permanent`, {
    method: "DELETE",
    headers: { Origin: baseUrl, Cookie: firstCookie }
  });
  assert.ok([401, 403].includes(deniedPermanentDelete.response.status), "personel admin kalıcı silme yoluna erişememeli");

  const deactivated = await json(`/api/admin/recipe-users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: adminHeaders(adminToken)
  });
  assert.equal(deactivated.response.status, 200);
  assert.equal(deactivated.body.users.find((user) => user.id === userId).active, false);
  assert.ok([401, 403].includes((await json("/api/workforce/me", {
    headers: { Origin: baseUrl, Cookie: firstCookie }
  })).response.status), "pasifleştirme mevcut personel oturumunu geçersiz kılmalı");

  let persisted = await store.read();
  assert.equal(persisted.recipeUsers.find((user) => user.id === userId).active, false);
  assert.ok(persisted.authSessions.filter((session) => session.role === "personel" && session.userId === userId).every((session) => session.revokedAt));

  const reactivated = await json(`/api/admin/recipe-users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ name: "Yaşam Döngüsü Personeli", username, password: "", active: true })
  });
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.body.user.active, true);
  assert.ok([401, 403].includes((await json("/api/workforce/me", {
    headers: { Origin: baseUrl, Cookie: firstCookie }
  })).response.status), "yeniden aktifleştirme revoke edilmiş eski oturumu açmamalı");

  const secondLogin = await json("/api/recipe/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username, password })
  });
  assert.equal(secondLogin.response.status, 200);
  const secondCookie = responseCookie(secondLogin.response);
  assert.equal((await json("/api/workforce/me", {
    headers: { Origin: baseUrl, Cookie: secondCookie }
  })).response.status, 200, "aktif personel yeniden girişten sonra workforce verisini almalı");

  const permanentlyDeleted = await json(`/api/admin/recipe-users/${encodeURIComponent(userId)}/permanent`, {
    method: "DELETE",
    headers: adminHeaders(adminToken)
  });
  assert.equal(permanentlyDeleted.response.status, 200);
  assert.equal(permanentlyDeleted.body.users.some((user) => user.id === userId), false);
  assert.ok([401, 403].includes((await json("/api/workforce/me", {
    headers: { Origin: baseUrl, Cookie: secondCookie }
  })).response.status), "kalıcı silme son personel oturumunu da geçersiz kılmalı");

  persisted = await store.read();
  assert.equal(persisted.recipeUsers.some((user) => user.id === userId), false);
  assert.ok(persisted.recipeAssignments.some((item) => item.id === `historic-recipe-${userId}` && item.username === username));
  assert.ok(persisted.recipeActivity.some((item) => item.id === `historic-activity-${userId}` && item.name === "Yaşam Döngüsü Personeli"));
  assert.ok(persisted.recipeActivity.some((item) => item.type === "recipe_user_permanently_deleted" && item.userId === userId && item.username === username));
  assert.ok(persisted.workforceTasks.some((item) => item.id === `historic-task-${userId}`));
  assert.ok(persisted.workforceAssignments.some((item) => item.userId === userId && item.userName === "Yaşam Döngüsü Personeli"));
  assert.ok(persisted.authSessions.filter((session) => session.role === "personel" && session.userId === userId).every((session) => session.revokedAt));

  const missing = await json(`/api/admin/recipe-users/${encodeURIComponent(userId)}/permanent`, {
    method: "DELETE",
    headers: adminHeaders(adminToken)
  });
  assert.equal(missing.response.status, 404);

  const restartedStore = createFileStore(process.env.DATA_FILE, {
    defaultPanelPassword: "Panel123456",
    defaultRecipePassword: "Recipe123456",
    bcryptRounds: 10
  });
  const afterRestart = await restartedStore.read();
  assert.equal(afterRestart.recipeUsers.some((user) => user.id === userId), false);
  assert.ok(afterRestart.workforceAssignments.some((item) => item.userId === userId && item.username === username));
});

test("admin varsayılanı backend'de kalıcıdır ve QR tasarımı yalnızca publish sonrası değişir", async () => {
  const token = await login();
  const menuResponse = await json("/api/menu");
  const liveBefore = menuResponse.body.menuState;
  const contentBefore = liveBefore.categories.map((category) => ({
    id: category.id,
    name: category.name,
    order: category.order,
    active: category.active,
    products: (category.products || []).map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      prices: product.prices,
      pricing: product.pricing,
      description: product.description,
      ingredients: product.ingredients,
      order: product.order,
      active: product.active,
      image: product.image,
      imageUrl: product.imageUrl
    }))
  }));

  const design = menuDesignSchema.createDesignSnapshot(liveBefore);
  design.settings.bgColor = "#e8d6c1";
  design.settings.darkBgColor = "#201008";
  design.settings.accentColor = "#6b341f";
  const requestId = `admin-default-${Date.now()}`;
  const saved = await json("/api/admin/defaults/menu-design", {
    method: "PUT",
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify({ requestId, revision: 0, design })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.menuDesign.revision, 1);
  assert.equal(saved.body.menuDesign.settings.bgColor, "#e8d6c1");

  const replay = await json("/api/admin/defaults/menu-design", {
    method: "PUT",
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify({ requestId, revision: 0, design })
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.menuDesign.revision, 1);

  const restartedStore = createFileStore(process.env.DATA_FILE, {
    defaultPanelPassword: "Panel123456",
    defaultRecipePassword: "Recipe123456",
    bcryptRounds: 10
  });
  const afterRestart = await restartedStore.read();
  assert.equal(afterRestart.adminDefaults.menuDesign.revision, 1);
  assert.equal(afterRestart.adminDefaults.menuDesign.settings.bgColor, "#e8d6c1", "admin varsayılanı localStorage olmadan store'dan okunmalı");

  const appliedDraft = menuDesignSchema.applyDesignSnapshot(liveBefore, saved.body.menuDesign);
  const stillLive = (await json("/api/menu")).body.menuState;
  assert.equal(menuDesignSchema.designFingerprint(stillLive), menuDesignSchema.designFingerprint(liveBefore), "taslağa uygulama publish olmadan QR menüyü değiştirmemeli");

  const publishState = await json("/api/admin/publish-state", { headers: adminHeaders(token) });
  const publishRequestId = `default-publish-${Date.now()}`;
  const published = await json("/api/admin/publish", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": publishRequestId },
    body: JSON.stringify({
      requestId: publishRequestId,
      expectedRevision: publishState.body.revision,
      changes: { menuState: appliedDraft }
    })
  });
  assert.equal(published.response.status, 200);
  const liveAfter = (await json("/api/menu")).body.menuState;
  assert.equal(menuDesignSchema.designFingerprint(liveAfter), menuDesignSchema.designFingerprint(appliedDraft));
  assert.deepEqual(liveAfter.categories.map((category) => ({
    id: category.id,
    name: category.name,
    order: category.order,
    active: category.active,
    products: (category.products || []).map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      prices: product.prices,
      pricing: product.pricing,
      description: product.description,
      ingredients: product.ingredients,
      order: product.order,
      active: product.active,
      image: product.image,
      imageUrl: product.imageUrl
    }))
  })), contentBefore, "tasarım varsayılanı ürün/kategori içeriğini korumalı");

  const conflictRequestId = `default-conflict-${Date.now()}`;
  const conflict = await json("/api/admin/defaults/menu-design", {
    method: "PUT",
    headers: { ...adminHeaders(token), "Idempotency-Key": conflictRequestId },
    body: JSON.stringify({ requestId: conflictRequestId, revision: 0, design })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, "REVISION_CONFLICT");

  const publicBootstrap = (await json("/api/public/bootstrap")).body;
  assert.equal(JSON.stringify(publicBootstrap).includes("adminDefaults"), false, "admin varsayılanı public bootstrap'a sızmamalı");
});

test("sistem varsayılanı ile cihaz tercihleri ayrı tutulur", async () => {
  const token = await login();
  const requestId = `system-default-${Date.now()}`;
  const settings = {
    cafeName: "Tahmisçi Test Şubesi",
    shortDescription: "Backend kalıcı sistem varsayılanı",
    phone: "+90 555 000 00 00",
    whatsapp: "+90 555 000 00 00",
    address: "Kadıköy",
    hours: "08:00-23:00",
    instagram: "@tahmisci",
    email: "test@tahmisci.test",
    logo: "/assets/brand/logo-primary.png",
    favicon: "/assets/brand/favicon.png"
  };
  const saved = await json("/api/admin/defaults/system-settings", {
    method: "PUT",
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify({ requestId, revision: 0, settings, panelConfig: { sidebarDefaultOpen: false } })
  });
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.body.systemSettings.settings, settings);
  assert.equal("panelConfig" in saved.body.systemSettings.settings, false);

  const readback = await json("/api/admin/defaults/system-settings", { headers: adminHeaders(token) });
  assert.equal(readback.response.status, 200);
  assert.deepEqual(readback.body.systemSettings.settings, settings);
  const denied = await json("/api/admin/defaults/system-settings");
  assert.equal(denied.response.status, 401);
});

test("bireysel personel reseti hedef hesabı günceller, kod bağlamını ve oturum ayrımını korur", async () => {
  const adminToken = await login();
  const suffix = Date.now();
  const firstPassword = "Personel123456";
  const secondPassword = "Personel234567";
  const firstCreated = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ name: "Reset Hedefi", username: `reset-hedef-${suffix}`, password: firstPassword })
  });
  const secondCreated = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ name: "Reset Korunan", username: `reset-korunan-${suffix}`, password: secondPassword })
  });
  assert.equal(firstCreated.response.status, 201);
  assert.equal(secondCreated.response.status, 201);
  const firstId = firstCreated.body.user.id;
  const secondId = secondCreated.body.user.id;

  const firstLogin = await json("/api/recipe/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username: firstCreated.body.user.username, password: firstPassword })
  });
  const secondLogin = await json("/api/recipe/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username: secondCreated.body.user.username, password: secondPassword })
  });
  const firstCookie = responseCookie(firstLogin.response);
  const secondCookie = responseCookie(secondLogin.response);

  const firstEmail = `reset-hedef-${suffix}@tahmisci.test`;
  const changedEmail = await json("/api/account/personel/email/change", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: firstCookie },
    body: JSON.stringify({ email: firstEmail })
  });
  assert.equal(changedEmail.response.status, 200);
  assert.equal(changedEmail.body.security.emailVerificationRequired, true);
  const verification = await json("/api/account/personel/email-verification/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: firstCookie },
    body: JSON.stringify({})
  });
  assert.equal(verification.response.status, 200);
  assert.match(verification.body.maskedEmail, /@tahmisci\.test$/);
  const verified = await json("/api/account/personel/email-verification/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: firstCookie },
    body: JSON.stringify({ challengeId: verification.body.challengeId, code: "654321" })
  });
  assert.equal(verified.response.status, 200);
  assert.ok(verified.body.security.emailVerifiedAt);

  const before = await store.read();
  const firstHashBefore = before.recipeUsers.find((user) => user.id === firstId).passwordHash;
  const secondHashBefore = before.recipeUsers.find((user) => user.id === secondId).passwordHash;
  const sharedHashBefore = before.admin.recipePasswordHash;
  await store.update((data) => {
    const now = new Date().toISOString();
    data.pushSubscriptions.push(
      { ownerRole: "personnel", ownerId: firstId, endpoint: `https://push.test/${firstId}`, createdAt: now, updatedAt: now },
      { ownerRole: "personnel", ownerId: secondId, endpoint: `https://push.test/${secondId}`, createdAt: now, updatedAt: now }
    );
    data.notificationPreferences.push({
      ownerRole: "personnel",
      ownerId: firstId,
      pushEnabled: true,
      emailEnabled: false,
      createdAt: now,
      updatedAt: now
    });
    return data;
  });

  const discovery = await json("/api/account/password-reset/personel/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: "bilinmeyen-personel", scope: "personel" })
  });
  assert.equal(discovery.response.status, 200);
  assert.ok(discovery.body.challengeId, "bilinmeyen hesap da ayrım yapmayan bir challenge almalı");
  assert.equal("personelAccounts" in discovery.body, false);

  const unauthorized = await json("/api/admin/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: firstCreated.body.user.username, scope: "personel" })
  });
  assert.equal(unauthorized.response.status, 400, "eski admin alias'ı personel kapsamına açılamamalı");

  const requested = await json("/api/account/password-reset/personel/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: firstCreated.body.user.username, scope: "personel" })
  });
  assert.equal(requested.response.status, 200);
  assert.ok(requested.body.challengeId);

  const wrongScope = await json("/api/account/password-reset/admin/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      challengeId: requested.body.challengeId,
      scope: "admin",
      code: "654321",
      newPassword: "YeniPersonel123"
    })
  });
  assert.equal(wrongScope.response.status, 400);

  const wrongTarget = await json("/api/account/password-reset/personel/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      challengeId: requested.body.challengeId,
      scope: "admin",
      code: "654321",
      newPassword: "YeniPersonel123"
    })
  });
  assert.equal(wrongTarget.response.status, 400);

  const confirmed = await json("/api/account/password-reset/personel/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      challengeId: requested.body.challengeId,
      scope: "personel",
      code: "654321",
      newPassword: "YeniPersonel123"
    })
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.redirectTo, "/personel/");

  const after = await store.read();
  const firstAfter = after.recipeUsers.find((user) => user.id === firstId);
  const secondAfter = after.recipeUsers.find((user) => user.id === secondId);
  assert.notEqual(firstAfter.passwordHash, firstHashBefore);
  assert.equal(await bcrypt.compare("YeniPersonel123", firstAfter.passwordHash), true);
  assert.equal(secondAfter.passwordHash, secondHashBefore);
  assert.equal(after.admin.recipePasswordHash, sharedHashBefore, "bireysel personel reseti ortak reçete şifresini değiştirmemeli");
  assert.ok(after.authSessions.filter((session) => session.role === "personel" && session.userId === firstId).every((session) => session.revokedAt));
  assert.ok(after.authSessions.some((session) => session.role === "personel" && session.userId === secondId && !session.revokedAt));
  assert.ok(after.pushSubscriptions.filter((item) => item.ownerId === firstId).every((item) => item.revokedAt), "hedef hesabın push abonelikleri iptal edilmeli");
  assert.ok(after.pushSubscriptions.some((item) => item.ownerId === secondId && !item.revokedAt), "diğer hesabın push aboneliği korunmalı");
  assert.equal(after.notificationPreferences.find((item) => item.ownerId === firstId).pushEnabled, false);
  assert.ok(after.securityAudit.some((item) => item.action === "password_reset_completed" && item.accountId === firstId));
  assert.equal((await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: firstCookie } })).response.status, 401);
  assert.equal((await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: secondCookie } })).response.status, 200);

  const reused = await json("/api/account/password-reset/personel/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      challengeId: requested.body.challengeId,
      scope: "personel",
      code: "654321",
      newPassword: "BaskaPersonel123"
    })
  });
  assert.equal(reused.response.status, 400, "kod tek kullanımlık olmalı");

  const newLogin = await json("/api/recipe/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username: firstCreated.body.user.username, password: "YeniPersonel123" })
  });
  assert.equal(newLogin.response.status, 200);
});

test("reset kodu yenilenince eskisi geçersiz olur, süre ve deneme sınırı uygulanır", async () => {
  const data = await store.read();
  let target = data.recipeUsers.find((user) => user.active !== false && user.passwordHash);
  if (!target) {
    const token = await login();
    const created = await json("/api/admin/recipe-users", {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ name: "Reset Limit Hedefi", username: `reset-limit-${Date.now()}`, password: "Personel123456" })
    });
    assert.equal(created.response.status, 201);
    target = created.body.user;
  }
  assert.ok(target);
  await store.update((next) => {
    const stored = next.recipeUsers.find((user) => user.id === target.id);
    stored.email = `reset-limit-${target.id}@tahmisci.test`;
    stored.emailNormalized = stored.email;
    stored.pendingEmail = "";
    stored.emailVerifiedAt = new Date().toISOString();
    stored.emailVerificationRequired = false;
    return next;
  });
  const request = async () => json("/api/account/password-reset/personel/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: target.username, scope: "personel" })
  });
  const first = await request();
  const throttled = await request();
  assert.equal(first.body.challengeId, throttled.body.challengeId, "yeniden gönderim bekleme süresi uygulanmalı");
  await store.update((next) => {
    const challenge = next.passwordResetChallenges.find((item) => item.id === first.body.challengeId);
    challenge.createdAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    return next;
  });
  const second = await request();
  assert.notEqual(first.body.challengeId, second.body.challengeId);
  const oldCode = await json("/api/account/password-reset/personel/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ challengeId: first.body.challengeId, scope: "personel", code: "654321", newPassword: "SinirPersonel123" })
  });
  assert.equal(oldCode.response.status, 400);

  await store.update((next) => {
    const challenge = next.passwordResetChallenges.find((item) => item.id === second.body.challengeId);
    challenge.expiresAt = new Date(Date.now() - 1000).toISOString();
    return next;
  });
  const expired = await json("/api/account/password-reset/personel/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ challengeId: second.body.challengeId, scope: "personel", code: "654321", newPassword: "SinirPersonel123" })
  });
  assert.equal(expired.response.status, 400);
  assert.match(expired.body.message, /süresi doldu/i);

  const attemptChallenge = await request();
  let last;
  for (let index = 0; index < 6; index += 1) {
    last = await json("/api/account/password-reset/personel/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ challengeId: attemptChallenge.body.challengeId, scope: "personel", code: "000000", newPassword: "SinirPersonel123" })
    });
  }
  assert.equal(last.response.status, 429);
});

test("admin reseti yalnızca admin oturumlarını iptal eder", async () => {
  const adminToken = await login();
  const adminEmail = `admin-security-${Date.now()}@tahmisci.test`;
  const securityBefore = await json("/api/account/admin/security", { headers: adminHeaders(adminToken) });
  assert.equal(securityBefore.response.status, 200);
  assert.equal(typeof securityBefore.body.smtpConfigured, "boolean");
  assert.equal(securityBefore.body.smtpPass, undefined);
  assert.equal(securityBefore.body.vapidPrivateKey, undefined);
  const emailChanged = await json("/api/account/admin/email/change", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ scope: "admin", email: adminEmail })
  });
  assert.equal(emailChanged.response.status, 200);
  const emailChallenge = await json("/api/account/admin/email-verification/request", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ scope: "admin" })
  });
  assert.equal(emailChallenge.response.status, 200);
  const emailVerified = await json("/api/account/admin/email-verification/confirm", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ scope: "admin", challengeId: emailChallenge.body.challengeId, code: "654321" })
  });
  assert.equal(emailVerified.response.status, 200);
  assert.equal(emailVerified.body.security.email, adminEmail);

  const before = await store.read();
  const oldAdminHash = before.admin.passwordHash;
  const activePersonelSession = before.authSessions.find((session) => session.role === "personel" && !session.revokedAt);
  await store.update((data) => {
    const now = new Date().toISOString();
    data.pushSubscriptions.push({ ownerRole: "manager", ownerId: "manager", endpoint: `https://push.test/admin-${Date.now()}`, createdAt: now, updatedAt: now });
    return data;
  });
  const scopeEscape = await json("/api/admin/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: "reset@tahmisci.test", scope: "personel" })
  });
  assert.equal(scopeEscape.response.status, 400);
  const requested = await json("/api/account/password-reset/admin/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: adminEmail, scope: "admin" })
  });
  assert.equal(requested.response.status, 200);
  const confirmed = await json("/api/account/password-reset/admin/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ challengeId: requested.body.challengeId, scope: "admin", code: "654321", newPassword: "YeniAdmin12345" })
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.redirectTo, "/login.html");
  assert.equal((await json("/api/admin/me", { headers: adminHeaders(adminToken) })).response.status, 401);
  const after = await store.read();
  assert.ok(after.authSessions.filter((session) => session.role === "admin").every((session) => session.revokedAt));
  assert.ok(after.pushSubscriptions.filter((item) => item.ownerRole === "manager").every((item) => item.revokedAt));
  assert.ok(after.securityAudit.some((item) => item.action === "password_reset_completed" && item.scope === "admin"));
  if (activePersonelSession) {
    assert.ok(after.authSessions.some((session) => session.id === activePersonelSession.id && !session.revokedAt));
  }
  const newLogin = await json("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "YeniAdmin12345" })
  });
  assert.equal(newLogin.response.status, 200);
  await store.update((next) => {
    next.admin.passwordHash = oldAdminHash;
    next.admin.updatedAt = new Date().toISOString();
    return next;
  });
});

test("eski ortak reçete şifresi yalnızca bireysel personel hesabı bulunmayan legacy durumda kullanılır", async () => {
  const snapshot = await store.read();
  const users = snapshot.recipeUsers;
  const sessions = snapshot.authSessions;
  const challenges = snapshot.passwordResetChallenges;
  const sharedHash = snapshot.admin.recipePasswordHash;
  await store.update((data) => {
    data.recipeUsers = [];
    data.passwordResetChallenges = [];
    return data;
  });

  const requested = await json("/api/account/password-reset/personel/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ identifier: "reset@tahmisci.test", scope: "personel" })
  });
  assert.equal(requested.response.status, 200);
  assert.ok(requested.body.challengeId);
  assert.equal(requested.body.requiresPersonelSelection, undefined);
  const confirmed = await json("/api/account/password-reset/personel/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ challengeId: requested.body.challengeId, scope: "personel", code: "654321", newPassword: "LegacyPersonel123" })
  });
  assert.equal(confirmed.response.status, 200);
  const legacyAfter = await store.read();
  assert.equal(await bcrypt.compare("LegacyPersonel123", legacyAfter.admin.recipePasswordHash), true);

  await store.update((data) => {
    data.recipeUsers = users;
    data.authSessions = sessions;
    data.passwordResetChallenges = challenges;
    data.admin.recipePasswordHash = sharedHash;
    data.admin.recipeUpdatedAt = new Date().toISOString();
    return data;
  });
});

test("şifre yenileme sayfası giriş kaynağına kilitlenir ve erişilebilir OTP bileşenlerini sunar", async () => {
  const response = await fetch(`${baseUrl}/password-reset/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Güvenli Şifre Yenileme/);
  assert.match(html, /id="accountScope" type="hidden"/);
  assert.doesNotMatch(html, /name="scope"|id="personelInput"/);
  assert.equal((html.match(/aria-label="Doğrulama kodu \d\. hane"/g) || []).length, 6);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /\/assets\/scripts\/password-reset\.js/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /prefers-reduced-motion/);

  const scriptResponse = await fetch(`${baseUrl}/assets/scripts/password-reset.js`);
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get("content-type") || "", /javascript/i);
  const script = await scriptResponse.text();
  assert.match(script, /handleOtpPaste/);
  assert.match(script, /password-reset\/\$\{encodeURIComponent\(state\.scope\)\}/);
  assert.doesNotMatch(script, /personelAccounts/);
});

test("devre dışı site SSE endpoint'i açıkça 410 döner", async () => {
  const { response, body } = await json("/api/public/events");
  assert.equal(response.status, 410);
  assert.equal(body.ok, false);
});

test("manuel menu, reçete ve stok API'leri ürün kodu benzersizliğini doğrular ve registry readback'i korur", async () => {
  const token = await login();
  const snapshot = await store.read();
  try {
    const menuRead = await json("/api/menu");
    const menuState = structuredClone(menuRead.body.menuState);
    const category = menuState.categories[0];
    const firstProduct = category.products[0];
    firstProduct.productCode = "MANUAL-MENU-001";
    category.products.push({ ...structuredClone(firstProduct), id: "manual-menu-duplicate", name: "Kod Çakışması" });
    const menuDuplicate = await json("/api/menu", {
      method: "PUT", headers: adminHeaders(token), body: JSON.stringify({ menuState })
    });
    assert.equal(menuDuplicate.response.status, 400);
    assert.match(menuDuplicate.body.message, /birden fazla kayda bağlanamaz/);
    category.products.pop();
    const menuSaved = await json("/api/menu", {
      method: "PUT", headers: adminHeaders(token), body: JSON.stringify({ menuState })
    });
    assert.equal(menuSaved.response.status, 200);
    assert.equal(menuSaved.body.menuState.categories[0].products[0].productCode, "MANUAL-MENU-001");

    const duplicateRecipes = {
      "Kod Testleri": {
        "Birinci Reçete": { Standart: { content: "A", preparation: "A", productCode: "MANUAL-RECIPE-001" } },
        "İkinci Reçete": { Standart: { content: "B", preparation: "B", productCode: "manual-recipe-001" } }
      }
    };
    const recipeDuplicate = await json("/api/recipes", {
      method: "PUT", headers: adminHeaders(token), body: JSON.stringify({ recipeState: duplicateRecipes, recipeCatalog: [] })
    });
    assert.equal(recipeDuplicate.response.status, 400);
    assert.match(recipeDuplicate.body.message, /birden fazla kayda bağlanamaz/);
    delete duplicateRecipes["Kod Testleri"]["İkinci Reçete"].Standart.productCode;
    const recipeSaved = await json("/api/recipes", {
      method: "PUT", headers: adminHeaders(token), body: JSON.stringify({ recipeState: duplicateRecipes, recipeCatalog: [] })
    });
    assert.equal(recipeSaved.response.status, 200);
    assert.equal(recipeSaved.body.recipeState["Kod Testleri"]["Birinci Reçete"].Standart.productCode, "MANUAL-RECIPE-001");

    const stockState = {
      schemaVersion: 1,
      categories: [{ id: "manual-stock-category", name: "Kod Testleri", active: true }],
      products: [
        { id: "manual-stock-1", categoryId: "manual-stock-category", name: "Birinci Stok", productName: "Birinci Stok", productCode: "STK-MANUAL-001", unit: "adet" },
        { id: "manual-stock-2", categoryId: "manual-stock-category", name: "İkinci Stok", productName: "İkinci Stok", productCode: "stk-manual-001", unit: "adet" }
      ],
      movements: []
    };
    const stockDuplicate = await json("/api/admin/stock", {
      method: "PUT", headers: adminHeaders(token), body: JSON.stringify({ stockState })
    });
    assert.equal(stockDuplicate.response.status, 400);
    assert.match(stockDuplicate.body.message, /birden fazla kayda bağlanamaz/);
    stockState.products[1].productCode = "STK-MANUAL-002";
    const stockSaved = await json("/api/admin/stock", {
      method: "PUT", headers: adminHeaders(token), body: JSON.stringify({ stockState })
    });
    assert.equal(stockSaved.response.status, 200);
    assert.deepEqual(stockSaved.body.stockState.products.map((item) => item.productCode), ["STK-MANUAL-001", "STK-MANUAL-002"]);

    const menuGet = await json("/api/menu");
    assert.equal(menuGet.response.status, 200);
    assert.equal(menuGet.body.menuState.categories[0].products[0].productCode, "MANUAL-MENU-001");

    const recipesGet = await json("/api/recipes", { headers: adminHeaders(token) });
    assert.equal(recipesGet.response.status, 200);
    assert.equal(Object.values(recipesGet.body.recipeState["Kod Testleri"])[0].Standart.productCode, "MANUAL-RECIPE-001");

    const stockGet = await json("/api/stock", { headers: adminHeaders(token) });
    assert.equal(stockGet.response.status, 200);
    assert.deepEqual(stockGet.body.stockState.products.map((item) => item.productCode), ["STK-MANUAL-001", "STK-MANUAL-002"]);

    const publicBootstrap = await json("/api/public/bootstrap");
    assert.equal(publicBootstrap.response.status, 200);
    assert.ok(publicBootstrap.body.menu.products.some((item) => item.productCode === "MANUAL-MENU-001"));

    const readback = await store.read();
    assert.ok(readback.productCodeRegistry.entries.some((entry) => entry.scope === "menu" && entry.productCode === "MANUAL-MENU-001"));
    assert.ok(readback.productCodeRegistry.entries.some((entry) => entry.scope === "recipe" && entry.productCode === "MANUAL-RECIPE-001"));
    assert.ok(readback.productCodeRegistry.entries.some((entry) => entry.scope === "stock" && entry.productCode === "STK-MANUAL-001"));
  } finally {
    await store.update(() => snapshot);
  }
});

test("tek seferlik katalog temizliği yönetici onayı, fingerprint, tam yedek ve idempotent tekrar ile çalışır", async () => {
  const unauthorized = await json("/api/admin/catalog-maintenance/legacy-cleanup/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: "{}"
  });
  assert.equal(unauthorized.response.status, 401);

  const token = await login();
  const before = await store.read();
  const protectedBefore = JSON.stringify({
    admin: before.admin,
    recipeUsers: before.recipeUsers,
    recipeAssignments: before.recipeAssignments,
    recipeActivity: before.recipeActivity,
    workforceTasks: before.workforceTasks,
    workforceAssignments: before.workforceAssignments,
    workforceShipments: before.workforceShipments,
    workforceShiftRequests: before.workforceShiftRequests,
    workforceShiftPlans: before.workforceShiftPlans,
    workforceShiftPlanRevisions: before.workforceShiftPlanRevisions,
    workforceShiftSettings: before.workforceShiftSettings,
    adminDefaults: before.adminDefaults,
    pricingAudit: before.pricingAudit,
    dataImportHistory: before.dataImportHistory
  });
  const backupRoot = path.join(path.dirname(process.env.DATA_FILE), "backups");
  const backupsBefore = await fs.readdir(backupRoot).catch(() => []);

  const preview = await json("/api/admin/catalog-maintenance/legacy-cleanup/preview", {
    method: "POST",
    headers: adminHeaders(token),
    body: "{}"
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.completed, false);
  assert.match(preview.body.expectedFingerprint, /^[a-f0-9]{64}$/);

  const requestId = `catalog-cleanup-route-${Date.now()}`;
  const applyBody = {
    confirmation: preview.body.confirmation,
    expectedRevision: preview.body.expectedRevision,
    expectedFingerprint: preview.body.expectedFingerprint,
    requestId
  };
  const applied = await json("/api/admin/catalog-maintenance/legacy-cleanup/apply", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify(applyBody)
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.idempotent, false);
  assert.ok(applied.body.operationId);

  const replayed = await json("/api/admin/catalog-maintenance/legacy-cleanup/apply", {
    method: "POST",
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify(applyBody)
  });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.body.idempotent, true);
  assert.equal(replayed.body.operationId, applied.body.operationId);

  const after = await store.read();
  assert.equal(after.menuState.categories.length, 0);
  assert.deepEqual(after.recipeState, {});
  assert.equal(after.catalogMigrations.filter((item) => item.version === "legacy-catalog-cleanup-v1").length, 1);
  assert.equal(JSON.stringify({
    admin: after.admin,
    recipeUsers: after.recipeUsers,
    recipeAssignments: after.recipeAssignments,
    recipeActivity: after.recipeActivity,
    workforceTasks: after.workforceTasks,
    workforceAssignments: after.workforceAssignments,
    workforceShipments: after.workforceShipments,
    workforceShiftRequests: after.workforceShiftRequests,
    workforceShiftPlans: after.workforceShiftPlans,
    workforceShiftPlanRevisions: after.workforceShiftPlanRevisions,
    workforceShiftSettings: after.workforceShiftSettings,
    adminDefaults: after.adminDefaults,
    pricingAudit: after.pricingAudit,
    dataImportHistory: after.dataImportHistory
  }), protectedBefore);
  const backupsAfter = await fs.readdir(backupRoot);
  assert.equal(backupsAfter.length, backupsBefore.length + 1);
  assert.ok(backupsAfter.some((name) => name.includes("legacy-catalog-cleanup-v1")));
});

test("sevkiyat stok urun koduyla olusturulur ve onay stogu yalnizca bir kez artirir", async () => {
  const token = await login();
  const snapshot = await store.read();
  try {
    const suffix = Date.now();
    const username = `shipment-code-${suffix}`;
    const password = "Personel123456";
    const created = await json("/api/admin/recipe-users", {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ name: "Kodlu Sevkiyat Personeli", username, password })
    });
    assert.equal(created.response.status, 201);

    const stockSaved = await json("/api/admin/stock", {
      method: "PUT",
      headers: adminHeaders(token),
      body: JSON.stringify({
        stockState: {
          schemaVersion: 1,
          categories: [{ id: "shipment-code-category", name: "Sevkiyat Kod Testi", active: true }],
          products: [{
            id: "shipment-code-product",
            categoryId: "shipment-code-category",
            name: "Kodlu Stok Urunu",
            productName: "Kodlu Stok Urunu",
            productCode: "STK-SHIP-001",
            active: true,
            stockQuantity: 5,
            stockQuantityText: "5 adet",
            unit: "adet"
          }],
          movements: []
        }
      })
    });
    assert.equal(stockSaved.response.status, 200);

    const personelLogin = await json("/api/recipe/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username, password })
    });
    assert.equal(personelLogin.response.status, 200);
    const personelCookie = responseCookie(personelLogin.response);

    const reported = await json("/api/workforce/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: personelCookie },
      body: JSON.stringify({
        items: [{ stockProductCode: "STK-SHIP-001", quantity: 2, unit: "adet" }],
        note: "Urun kodu entegrasyon testi"
      })
    });
    assert.equal(reported.response.status, 201);
    assert.equal(reported.body.shipment.status, "onay_bekliyor");
    assert.equal(reported.body.shipment.items[0].stockProductCode, "STK-SHIP-001");
    assert.equal(reported.body.shipment.items[0].stockProductId, "shipment-code-product");

    const pendingStock = await json("/api/stock", {
      headers: { Origin: baseUrl, Cookie: personelCookie }
    });
    assert.equal(pendingStock.response.status, 200);
    assert.equal(pendingStock.body.stockState.products[0].stockQuantity, 5);

    const approvePath = `/api/admin/workforce/shipments/${encodeURIComponent(reported.body.shipment.id)}/approve`;
    const approved = await json(approvePath, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ note: "Kodla onaylandi" })
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.idempotent, false);
    assert.equal(approved.body.shipment.status, "onayland\u0131");
    assert.equal(approved.body.stockState.products[0].stockQuantity, 7);
    assert.equal(approved.body.stockState.movements.filter((item) => item.shipmentId === reported.body.shipment.id).length, 1);
    assert.equal(approved.body.stockState.movements.find((item) => item.shipmentId === reported.body.shipment.id).stockProductCode, "STK-SHIP-001");

    const repeated = await json(approvePath, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ note: "Tekrar onay denemesi" })
    });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.idempotent, true);
    assert.equal(repeated.body.stockState.products[0].stockQuantity, 7);
    assert.equal(repeated.body.stockState.movements.filter((item) => item.shipmentId === reported.body.shipment.id).length, 1);
  } finally {
    await store.update(() => snapshot);
  }
});

test("Faz 5 workforce görev ve shift akışları revision ile kalıcı ve idempotent çalışır", async () => {
  const snapshot = await store.read();
  const token = await login();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = "Personel123456";
  const adminMutationHeaders = (requestId) => ({
    ...adminHeaders(token),
    "Idempotency-Key": requestId,
    "X-Request-ID": requestId
  });
  const personMutationHeaders = (cookie, requestId) => ({
    "Content-Type": "application/json",
    Origin: baseUrl,
    Cookie: cookie,
    "Idempotency-Key": requestId,
    "X-Request-ID": requestId
  });
  const dateKey = (date) => date.toISOString().slice(0, 10);

  try {
    const createPerson = async (label) => {
      const requestId = `faz5-person-${label}-${suffix}`;
      const created = await json("/api/admin/recipe-users", {
        method: "POST",
        headers: adminMutationHeaders(requestId),
        body: JSON.stringify({ name: `Faz 5 ${label}`, username: `faz5-${label}-${suffix}`, password, requestId })
      });
      assert.equal(created.response.status, 201);
      const loggedIn = await json("/api/recipe/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify({ username: created.body.user.username, password })
      });
      assert.equal(loggedIn.response.status, 200);
      return { user: created.body.user, cookie: responseCookie(loggedIn.response) };
    };

    const personA = await createPerson("a");
    const personB = await createPerson("b");
    let adminWorkforce = await json("/api/admin/workforce", { headers: adminHeaders(token) });
    let revision = adminWorkforce.body.revision;

    const taskRequestId = `faz5-task-${suffix}`;
    const taskBody = {
      title: "Faz 5 bağımsız ilerleme görevi",
      description: "Her personelin ilerlemesi ayrı tutulur.",
      managerNote: "Backend sonucunu bekleyin.",
      items: [{ id: "step-1", text: "Birinci madde" }, { id: "step-2", text: "İkinci madde" }],
      priority: "urgent",
      dueDate: dateKey(new Date(Date.now() + 3 * 86400000)),
      targetType: "selected",
      assignedUserIds: [personA.user.id, personB.user.id],
      expectedRevision: revision,
      requestId: taskRequestId
    };
    const taskCreated = await json("/api/admin/workforce/tasks", {
      method: "POST",
      headers: adminMutationHeaders(taskRequestId),
      body: JSON.stringify(taskBody)
    });
    assert.equal(taskCreated.response.status, 201);
    assert.equal(taskCreated.body.task.assignments.length, 2);
    assert.notEqual(taskCreated.body.task.assignments[0].id, taskCreated.body.task.assignments[1].id);

    const taskReplayed = await json("/api/admin/workforce/tasks", {
      method: "POST",
      headers: adminMutationHeaders(taskRequestId),
      body: JSON.stringify(taskBody)
    });
    assert.equal(taskReplayed.response.status, 200);
    assert.equal(taskReplayed.body.idempotent, true);
    assert.equal(taskReplayed.body.task.id, taskCreated.body.task.id);

    let personPayload = await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: personA.cookie } });
    revision = personPayload.body.revision;
    const aProgressId = `faz5-progress-a-${suffix}`;
    const aProgress = await json(`/api/workforce/tasks/${encodeURIComponent(taskCreated.body.task.id)}/items/step-1`, {
      method: "PATCH",
      headers: personMutationHeaders(personA.cookie, aProgressId),
      body: JSON.stringify({ completed: true, expectedRevision: revision, requestId: aProgressId })
    });
    assert.equal(aProgress.response.status, 200);
    assert.equal(aProgress.body.assignment.progress, 50);

    personPayload = await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: personB.cookie } });
    let trackedTask = personPayload.body.tasks.find((task) => task.id === taskCreated.body.task.id);
    assert.equal(trackedTask.assignments[0].progress, 0, "A personelinin ilerlemesi B personelini değiştirmemeli");
    revision = personPayload.body.revision;
    const bProgressId = `faz5-progress-b-${suffix}`;
    const bProgress = await json(`/api/workforce/tasks/${encodeURIComponent(taskCreated.body.task.id)}/items/step-2`, {
      method: "PATCH",
      headers: personMutationHeaders(personB.cookie, bProgressId),
      body: JSON.stringify({ completed: true, expectedRevision: revision, requestId: bProgressId })
    });
    assert.equal(bProgress.response.status, 200);
    assert.equal(bProgress.body.assignment.progress, 50);

    adminWorkforce = await json("/api/admin/workforce", { headers: adminHeaders(token) });
    trackedTask = adminWorkforce.body.tasks.find((task) => task.id === taskCreated.body.task.id);
    assert.deepEqual(trackedTask.assignments.map((assignment) => assignment.progress).sort(), [50, 50]);
    revision = adminWorkforce.body.revision;
    const cancelId = `faz5-task-cancel-${suffix}`;
    const cancelled = await json(`/api/admin/workforce/tasks/${encodeURIComponent(trackedTask.id)}`, {
      method: "PATCH",
      headers: adminMutationHeaders(cancelId),
      body: JSON.stringify({ status: "iptal_edildi", expectedRevision: revision, requestId: cancelId })
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.task.workflowStatus, "iptal_edildi");
    const readOnlyId = `faz5-task-readonly-${suffix}`;
    const readOnlyAttempt = await json(`/api/workforce/tasks/${encodeURIComponent(trackedTask.id)}/items/step-2`, {
      method: "PATCH",
      headers: personMutationHeaders(personA.cookie, readOnlyId),
      body: JSON.stringify({ completed: true, expectedRevision: cancelled.body.revision, requestId: readOnlyId })
    });
    assert.equal(readOnlyAttempt.response.status, 409);

    personPayload = await json("/api/workforce/me", { headers: { Origin: baseUrl, Cookie: personA.cookie } });
    revision = personPayload.body.revision;
    const pastRequestId = `faz5-shift-past-${suffix}`;
    const pastRequest = await json("/api/workforce/shift-requests", {
      method: "POST",
      headers: personMutationHeaders(personA.cookie, pastRequestId),
      body: JSON.stringify({ type: "leave", date: dateKey(new Date(Date.now() - 2 * 86400000)), expectedRevision: revision, requestId: pastRequestId })
    });
    assert.equal(pastRequest.response.status, 400);

    const futureMonday = new Date();
    futureMonday.setUTCHours(12, 0, 0, 0);
    const weekday = futureMonday.getUTCDay() || 7;
    futureMonday.setUTCDate(futureMonday.getUTCDate() - weekday + 15);
    const weekStart = dateKey(futureMonday);
    const shiftRequestId = `faz5-shift-request-${suffix}`;
    const shiftRequest = await json("/api/workforce/shift-requests", {
      method: "POST",
      headers: personMutationHeaders(personA.cookie, shiftRequestId),
      body: JSON.stringify({ type: "morning", date: weekStart, description: "Sabah tercihi", expectedRevision: revision, requestId: shiftRequestId })
    });
    assert.equal(shiftRequest.response.status, 201);
    revision = shiftRequest.body.revision;

    const duplicateId = `faz5-shift-duplicate-${suffix}`;
    const duplicate = await json("/api/workforce/shift-requests", {
      method: "POST",
      headers: personMutationHeaders(personA.cookie, duplicateId),
      body: JSON.stringify({ type: "morning", date: weekStart, expectedRevision: revision, requestId: duplicateId })
    });
    assert.equal(duplicate.response.status, 409);

    const approveId = `faz5-shift-approve-${suffix}`;
    const approved = await json(`/api/admin/workforce/shift-requests/${encodeURIComponent(shiftRequest.body.request.id)}/approve`, {
      method: "POST",
      headers: adminMutationHeaders(approveId),
      body: JSON.stringify({ note: "Planlama girdisi", expectedRevision: revision, requestId: approveId })
    });
    assert.equal(approved.response.status, 200);
    revision = approved.body.revision;

    const autoId = `faz5-auto-draft-${suffix}`;
    const autoDraft = await json(`/api/admin/workforce/shifts/${weekStart}/auto-draft`, {
      method: "POST",
      headers: adminMutationHeaders(autoId),
      body: JSON.stringify({ expectedRevision: revision, requestId: autoId })
    });
    assert.equal(autoDraft.response.status, 201);
    assert.ok(autoDraft.body.plans.every((plan) => plan.status === "draft"));
    assert.ok(autoDraft.body.proposal.appliedRules.length);
    revision = autoDraft.body.revision;

    const beforePublish = await json(`/api/workforce/me?weekStart=${weekStart}`, { headers: { Origin: baseUrl, Cookie: personA.cookie } });
    assert.equal(beforePublish.body.shiftPlans.length, 0, "taslak plan personele sızmamalı");

    const applyId = `faz5-apply-draft-${suffix}`;
    const appliedDraft = await json(`/api/admin/workforce/shifts/${weekStart}/apply-draft`, {
      method: "POST",
      headers: adminMutationHeaders(applyId),
      body: JSON.stringify({ expectedRevision: revision, requestId: applyId })
    });
    assert.equal(appliedDraft.response.status, 200);
    assert.equal(appliedDraft.body.published, false);
    revision = appliedDraft.body.revision;

    const publishId = `faz5-publish-${suffix}`;
    const publishBody = { plans: autoDraft.body.plans, publish: true, expectedRevision: revision, requestId: publishId };
    const published = await json(`/api/admin/workforce/shifts/${weekStart}`, {
      method: "PUT",
      headers: adminMutationHeaders(publishId),
      body: JSON.stringify(publishBody)
    });
    assert.equal(published.response.status, 200);
    assert.equal(published.body.published, true);
    const publishReplay = await json(`/api/admin/workforce/shifts/${weekStart}`, {
      method: "PUT",
      headers: adminMutationHeaders(publishId),
      body: JSON.stringify(publishBody)
    });
    assert.equal(publishReplay.response.status, 200);
    assert.equal(publishReplay.body.idempotent, true);
    assert.equal(publishReplay.body.publicationRevision, published.body.publicationRevision);

    const afterPublish = await json(`/api/workforce/me?weekStart=${weekStart}`, { headers: { Origin: baseUrl, Cookie: personA.cookie } });
    assert.ok(afterPublish.body.shiftPlans.length > 0);
    assert.ok(afterPublish.body.shiftPlans.every((plan) => plan.status === "published"));

    const persisted = await store.read();
    assert.ok(persisted.recipeActivity.some((entry) => entry.type === "task_progress" && entry.actorId === personA.user.id));
    assert.ok(persisted.recipeActivity.some((entry) => entry.type === "shifts_published" && entry.actorRole === "admin"));
  } finally {
    await store.update(() => snapshot);
  }
});

test("Faz 6 service worker dosyaları doğru MIME, cache politikası ve bağımsız scope başlığıyla yayınlanır", async () => {
  const workers = [
    ["/qr-menu/sw.js", "/"],
    ["/personel/sw.js", "/personel/"],
    ["/yonetici/sw.js", "/yonetici/"]
  ];

  for (const [pathname, scope] of workers) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(String(response.headers.get("content-type") || ""), /(?:java|ecma)script/i, `${pathname} JavaScript MIME ile dönmeli`);
    assert.equal(response.headers.get("service-worker-allowed"), scope, `${pathname} yalnız kendi PWA scope değerini bildirmeli`);
    assert.match(String(response.headers.get("cache-control") || ""), /no-cache|no-store|max-age=0/i, `${pathname} uzun süre bayat kalmamalı`);
    assert.match(await response.text(), /TAHMISCI_PWA_CONFIG/);
  }

  for (const pathname of ["/qr-menu/manifest.webmanifest", "/personel/manifest.webmanifest", "/yonetici/manifest.webmanifest"]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(String(response.headers.get("content-type") || ""), /application\/(?:manifest\+json|json)/i);
    assert.match(String(response.headers.get("cache-control") || ""), /no-cache|no-store|max-age=0/i, `${pathname} yeniden doğrulanmalı`);
  }
});
