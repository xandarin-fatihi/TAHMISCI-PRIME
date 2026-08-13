"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { analyzeDataImport, catalogFingerprint } = require("../src/data-import");
const { defaultStore, normalizeStore } = require("../src/store/file-store");

function sheet(headers, records) {
  const rows = records.map((record) => ({ ...record }));
  rows.headers = [...headers];
  return rows;
}

function workbook(definitions) {
  return {
    SheetNames: Object.keys(definitions),
    Sheets: Object.fromEntries(Object.entries(definitions).map(([name, rows]) => [name, rows]))
  };
}

function emptyData() {
  return defaultStore("test-password-hash", "test-recipe-password-hash");
}

function analyze(data, workbooks, suffix) {
  return analyzeDataImport(data, { workbooks, files: {} }, {
    analysisId: `data-import-analysis-domain-${suffix}`,
    now: "2026-08-12T08:00:00.000Z"
  });
}

function menuWorkbook(rows) {
  return workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu", "Ürün İçeriği"], rows)
  });
}

function pricingWorkbook(rows) {
  return workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu", "Standart"], rows)
  });
}

function recipeWorkbook(rows) {
  return workbook({
    SICAKLAR: sheet([
      "Kategori", "Ürün Adı", "Ürün Kodu", "Ölçü",
      "İçerik (ölçüsüz)", "Hazırlanış (ölçüler dahil)"
    ], rows),
    Tümü: sheet(["Kategori", "Ürün Adı", "Ürün Kodu", "Ölçü"], rows)
  });
}

function stockWorkbook(rows) {
  return workbook({
    SÜTLER: sheet(["Ürün Adı", "Ürün Kodu", "Ürün Adedi", "Sipariş Eşiği"], rows)
  });
}

function legacyMenuConflict(data) {
  data.menuState.categories = [
    {
      id: "legacy-hot",
      name: "SICAKLAR",
      active: true,
      order: 0,
      products: [
      {
        id: "legacy-white-nut-a", name: "White Nut", productCode: "SIC-WHT-NUT",
        active: true, order: 0, manualContent: "Birinci içerik",
        pricing: { typeId: "standard", values: { standard: { price: 100, active: true } } },
        sourceType: "legacy", sourcePresent: true
      }
      ]
    },
    {
      id: "legacy-cold",
      name: "SOĞUKLAR",
      active: true,
      order: 1,
      products: [
      {
        id: "legacy-white-nut-b", name: "WHITE NUT", productCode: "SIC-WHT-NUT",
        active: true, order: 1, manualContent: "Çakışan içerik",
        pricing: { typeId: "standard", values: { standard: { price: 125, active: true } } },
        sourceType: "legacy", sourcePresent: true
      }
      ]
    }
  ];
  return data;
}

function cleanRecipeRows() {
  return [{
    Kategori: "SICAKLAR", "Ürün Adı": "Bağımsız Reçete", "Ürün Kodu": "REC-BGM-001",
    Ölçü: "14 oz", "İçerik (ölçüsüz)": "Kahve", "Hazırlanış (ölçüler dahil)": "14 oz hazırlanır"
  }];
}

function cleanStockRows() {
  return [{
    "Ürün Adı": "Barista Süt", "Ürün Kodu": "STK-SUT-001", "Ürün Adedi": "10 koli", "Sipariş Eşiği": 2
  }];
}

test("legacy menü conflict yalnız stok veya reçete analizini bloke etmez", () => {
  const data = normalizeStore(legacyMenuConflict(emptyData()));
  const catalogBefore = catalogFingerprint(data, ["menu", "pricing"]);
  const recipesBefore = catalogFingerprint(data, ["recipes"]);

  const stock = analyze(data, { stock: stockWorkbook(cleanStockRows()) }, "legacy-stock");
  assert.equal(stock.domains.stock.selected, true);
  assert.equal(stock.domains.stock.canApply, true);
  assert.equal(stock.domains.catalog.selected, false);
  assert.equal(stock.issues.some((issue) => issue.code === "ambiguous_merge_conflict"), false);
  assert.equal(catalogFingerprint(stock.plan, ["menu", "pricing"]), catalogBefore);
  assert.equal(catalogFingerprint(stock.plan, ["recipes"]), recipesBefore);

  const recipes = analyze(data, { recipe: recipeWorkbook(cleanRecipeRows()) }, "legacy-recipe");
  assert.equal(recipes.domains.recipes.selected, true);
  assert.equal(recipes.domains.recipes.canApply, true);
  assert.equal(recipes.issues.some((issue) => issue.code === "ambiguous_merge_conflict"), false);
  assert.equal(catalogFingerprint(recipes.plan, ["menu", "pricing"]), catalogBefore);
  assert.equal(catalogFingerprint(recipes.plan, ["stock"]), catalogFingerprint(data, ["stock"]));
});

test("reçete fingerprint'i menü bağlantı metadata'sından bağımsızdır", () => {
  const data = normalizeStore(emptyData());
  data.recipeState = {
    SICAKLAR: {
      "Bağımsız Reçete": {
        "14 oz": {
          id: "recipe-fingerprint-item", productCode: "REC-FPR-001",
          content: "Kahve", preparation: "Hazırla", active: true
        }
      }
    }
  };
  data.recipeCatalog = [{
    id: "recipe-fingerprint-record", category: "SICAKLAR", product: "Bağımsız Reçete",
    productCode: "REC-FPR-001", menuProductId: "menu-old", menuProductIds: ["menu-old"]
  }];
  data.recipeLinkReview = [{ productId: "menu-old", categoryId: "menu-category", reason: "not-found" }];
  const before = catalogFingerprint(data, ["recipes"]);

  data.recipeCatalog[0].menuProductId = "menu-new";
  data.recipeCatalog[0].menuProductIds = ["menu-new"];
  data.recipeLinkReview = [{ productId: "menu-new", categoryId: "menu-new-category", reason: "ambiguous" }];

  assert.equal(catalogFingerprint(data, ["recipes"]), before);
});

test("temiz Menu+Fiyat snapshot kategoriler arası legacy kod tekrarını canonical tek kayda indirir", () => {
  const data = legacyMenuConflict(emptyData());
  const result = analyze(data, {
    menu: menuWorkbook([{
      "Ürün Adı": "White Nut Yeni", "Ürün Kodu": "SIC-WHT-NUT", "Ürün İçeriği": "Incoming canonical içerik"
    }]),
    pricing: pricingWorkbook([{
      "Ürün Adı": "White Nut Yeni", "Ürün Kodu": "SIC-WHT-NUT", Standart: 145
    }])
  }, "clean-catalog");

  assert.equal(result.domains.catalog.canApply, true);
  assert.equal(result.issues.some((issue) => issue.code === "ambiguous_merge_conflict"), false);
  const products = result.plan.menuState.categories.flatMap((category) => category.products || [])
    .filter((product) => product.productCode === "SIC-WHT-NUT");
  assert.equal(products.length, 1);
  assert.equal(products[0].name, "White Nut Yeni");
  assert.equal(products[0].pricing.values.standard.price, 145);
  assert.ok(Object.keys(result.plan.referenceRewrites.menuProducts).length >= 1);
});

test("incoming menü ve stok kod tekrarları yalnız kendi domainlerini bloke eder", () => {
  const duplicateMenu = menuWorkbook([
    { "Ürün Adı": "Birinci", "Ürün Kodu": "SIC-DUP-001" },
    { "Ürün Adı": "İkinci", "Ürün Kodu": "SIC-DUP-001" }
  ]);
  const first = analyze(emptyData(), {
    menu: duplicateMenu,
    recipe: recipeWorkbook(cleanRecipeRows()),
    stock: stockWorkbook(cleanStockRows())
  }, "incoming-menu-duplicate");
  assert.equal(first.domains.catalog.canApply, false);
  assert.equal(first.domains.recipes.canApply, true);
  assert.equal(first.domains.stock.canApply, true);
  assert.ok(first.domains.catalog.blockingIssues.some((issue) => issue.code === "duplicate_product_code"));

  const duplicateStock = stockWorkbook([
    ...cleanStockRows(),
    { "Ürün Adı": "Başka Süt", "Ürün Kodu": "STK-SUT-001", "Ürün Adedi": "3 koli", "Sipariş Eşiği": 1 }
  ]);
  const second = analyze(emptyData(), {
    menu: menuWorkbook([{ "Ürün Adı": "Temiz", "Ürün Kodu": "SIC-CLN-001" }]),
    recipe: recipeWorkbook(cleanRecipeRows()),
    stock: duplicateStock
  }, "incoming-stock-duplicate");
  assert.equal(second.domains.catalog.canApply, true);
  assert.equal(second.domains.recipes.canApply, true);
  assert.equal(second.domains.stock.canApply, false);
  assert.ok(second.domains.stock.blockingIssues.some((issue) => issue.code === "duplicate_product_code"));
});

test("reçete 14/16/20 varyantlarını kabul eder ve aynı kod+ölçü conflictini ayırır", () => {
  const variants = ["14 oz", "16 oz", "20 oz"].map((size) => ({
    Kategori: "SICAKLAR", "Ürün Adı": "Varyant Latte", "Ürün Kodu": "REC-VRY-001",
    Ölçü: size, "İçerik (ölçüsüz)": "Espresso ve süt", "Hazırlanış (ölçüler dahil)": `${size} hazırlanır`
  }));
  const valid = analyze(emptyData(), { recipe: recipeWorkbook(variants) }, "recipe-sizes");
  assert.equal(valid.domains.recipes.canApply, true);
  assert.deepEqual(Object.keys(valid.plan.recipeState.SICAKLAR["Varyant Latte"]).sort(), ["14 oz", "16 oz", "20 oz"]);

  const conflict = analyze(emptyData(), { recipe: recipeWorkbook([
    variants[0],
    { ...variants[0], "İçerik (ölçüsüz)": "Farklı içerik" }
  ]) }, "recipe-conflict");
  assert.equal(conflict.domains.recipes.canApply, false);
  assert.ok(conflict.domains.recipes.blockingIssues.some((issue) => issue.code === "duplicate_recipe_measure"));

  const identical = analyze(emptyData(), { recipe: recipeWorkbook([variants[0], { ...variants[0] }]) }, "recipe-identical");
  assert.equal(identical.domains.recipes.canApply, true);
  assert.ok(identical.issues.some((issue) => issue.code === "duplicate_recipe_measure_identical" && issue.severity === "warning"));
  assert.equal(Object.keys(identical.plan.recipeState.SICAKLAR["Varyant Latte"]).length, 1);
});

test("çoklu analiz domain bazında partial readiness üretir", () => {
  const recipeRows = cleanRecipeRows();
  const result = analyze(emptyData(), {
    menu: menuWorkbook([{ "Ürün Adı": "Temiz Menü", "Ürün Kodu": "SIC-CLN-001" }]),
    pricing: pricingWorkbook([{ "Ürün Adı": "Temiz Menü", "Ürün Kodu": "SIC-CLN-001", Standart: 100 }]),
    recipe: recipeWorkbook([recipeRows[0], { ...recipeRows[0], "Hazırlanış (ölçüler dahil)": "Çakışan hazırlama" }]),
    stock: stockWorkbook(cleanStockRows())
  }, "partial-readiness");

  assert.equal(result.domains.catalog.canApply, true);
  assert.equal(result.domains.recipes.canApply, false);
  assert.equal(result.domains.stock.canApply, true);
  assert.equal(result.report.canApply, true, "en az bir seçili domain uygulanabiliyorsa analiz uygulanabilir olmalı");
});
