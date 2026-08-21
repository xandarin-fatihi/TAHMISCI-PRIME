"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeDataImport,
  catalogFingerprint,
  catalogScopeSnapshot,
  productCodeFingerprint
} = require("../src/data-import");
const { defaultStore, normalizeStore } = require("../src/store/file-store");

function sheet(headers, records) {
  const rows = records.map((record) => ({ ...record }));
  rows.headers = headers.slice();
  return rows;
}

function workbook(definitions) {
  const names = Object.keys(definitions);
  return { SheetNames: names, Sheets: Object.fromEntries(names.map((name) => [name, definitions[name]])) };
}

function emptyData() {
  return defaultStore("test-password-hash", "test-recipe-password-hash");
}

function importedData(base, analysis) {
  const data = structuredClone(base);
  data.menuState = structuredClone(analysis.plan.menuState);
  data.pricing = structuredClone(analysis.plan.pricing);
  data.recipeState = structuredClone(analysis.plan.recipeState);
  data.recipeCatalog = structuredClone(analysis.plan.recipeCatalog);
  data.stockState = structuredClone(analysis.plan.stockState);
  data.dataImportMappings = structuredClone(analysis.plan.mappings);
  return data;
}

function completeWorkbooks() {
  return {
    menu: workbook({
      Sıcaklar: sheet(["Ürün Adı", "Ürün Kalorisi", "Ürün Alerjeni", "Ürün İçeriği"], [{
        "Ürün Adı": "Yeni Kahve",
        "Ürün Kalorisi": "12 kcal",
        "Ürün Alerjeni": "Süt",
        "Ürün İçeriği": "Espresso, süt"
      }]),
      "Revize Notları": sheet(["Not"], [{ Not: "Katalog dışı açıklama" }])
    }),
    pricing: workbook({
      Sıcaklar: sheet(["Ürün Adı", "Standart"], [{ "Ürün Adı": "Yeni Kahve", Standart: 95 }])
    }),
    recipe: workbook({
      Sıcaklar: sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Hazırlanış (ölçüler dahil)"], [{
        Kategori: "Sıcaklar",
        "Ürün Adı": "Yeni Kahve",
        "Ölçü": "Standart",
        "İçerik (ölçüsüz)": "Espresso, süt",
        "Hazırlanış (ölçüler dahil)": "1 shot espresso ve 180 ml süt"
      }]),
      Tümü: sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Hazırlanış (ölçüler dahil)"], [{
        Kategori: "Sıcaklar",
        "Ürün Adı": "Yeni Kahve",
        "Ölçü": "Standart",
        "İçerik (ölçüsüz)": "Kopya",
        "Hazırlanış (ölçüler dahil)": "Kopya"
      }])
    }),
    stock: workbook({
      İçecekler: sheet(["Ürün Adı", "Ürün Adedi", "Sipariş Eşiği"], [
        { "Ürün Adı": "Süt", "Ürün Adedi": "10 koli", "Sipariş Eşiği": "-" },
        { "Ürün Adı": "Karma Paket", "Ürün Adedi": "1 kutu + 5 adet", "Sipariş Eşiği": 2 }
      ])
    })
  };
}

test("boş store örnek katalog üretmez", () => {
  const data = emptyData();
  assert.deepEqual(data.menuState.categories, []);
  assert.deepEqual(data.recipeState, {});
  assert.deepEqual(data.stockState.products, []);
});

test("dört dosyalı analiz yeni ürünü fiyatı, reçetesi ve stok kataloğuyla tek planda oluşturur", () => {
  const workbooks = completeWorkbooks();
  const files = Object.fromEntries(Object.keys(workbooks).map((key) => [key, {
    filename: `TAHMISCI-${key}.xlsx`, hash: `${key}-hash`, size: 100
  }]));
  const analysis = analyzeDataImport(emptyData(), { workbooks, files }, {
    analysisId: "data-import-analysis-combined-fixture",
    now: "2026-08-08T10:00:00.000Z"
  });

  assert.equal(analysis.report.canApply, true);
  assert.deepEqual(analysis.scopes, ["menu", "pricing", "recipes", "stock"]);
  const product = analysis.plan.menuState.categories[0].products[0];
  assert.equal(product.name, "Yeni Kahve");
  assert.equal(product.sourceType, "excel");
  assert.equal(product.sourcePresent, true);
  assert.equal(product.pricing.values.standard.price, 95);
  assert.equal(analysis.plan.recipeState.Sıcaklar["Yeni Kahve"].Standart.content, "Espresso, süt");
  assert.equal(Object.keys(analysis.plan.recipeState.Sıcaklar["Yeni Kahve"]).length, 1, "Tümü sayfası ikinci reçete oluşturmamalı");
  assert.equal(analysis.plan.stockState.products.find((item) => item.productName === "Süt").stockQuantity, 10);
  assert.equal(analysis.plan.stockState.products.find((item) => item.productName === "Süt").unit, "koli");
  assert.equal(analysis.plan.stockState.products.some((item) => item.productName === "Karma Paket"), false);
  assert.ok(analysis.issues.some((issue) => issue.code === "manual_unit_review" && issue.severity === "warning"));
  assert.ok(analysis.issues.some((issue) => issue.code === "ignored_non_catalog_sheet" && issue.severity === "warning"));

  const second = analyzeDataImport(importedData(emptyData(), analysis), { workbooks, files }, {
    analysisId: "data-import-analysis-second-fixture",
    now: "2026-08-08T10:05:00.000Z"
  });
  assert.equal(second.changes.length, 0);
  assert.equal(second.report.canApply, false);
  assert.ok(second.report.unchanged >= 3);
});

test("Excel kaldırması kaydı arşivler, geri dönüş excel kaldırmasını geri açar ve Yönetici pasifliğini korur", () => {
  const full = workbook({
    Sıcaklar: sheet(["Ürün Adı", "Ürün Kalorisi", "Ürün Alerjeni", "Ürün İçeriği"], [{ "Ürün Adı": "Korunan Kahve" }])
  });
  const empty = workbook({ Sıcaklar: sheet(["Ürün Adı", "Ürün Kalorisi", "Ürün Alerjeni", "Ürün İçeriği"], []) });
  const first = analyzeDataImport(emptyData(), { workbooks: { menu: full }, files: {} }, { analysisId: "data-import-analysis-first-removal" });
  const live = importedData(emptyData(), first);
  const productId = live.menuState.categories[0].products[0].id;

  const removed = analyzeDataImport(live, { workbooks: { menu: empty }, files: {} }, { analysisId: "data-import-analysis-remove" });
  const archived = removed.plan.menuState.categories[0].products.find((item) => item.id === productId);
  assert.equal(archived.sourcePresent, false);
  assert.equal(archived.active, false);
  assert.equal(archived.statusSource, "excel_removed");
  assert.equal(removed.report.requiresArchiveConfirmation, true);
  assert.equal(removed.report.archiveRatio, 1);

  const returned = analyzeDataImport(importedData(live, removed), { workbooks: { menu: full }, files: {} }, { analysisId: "data-import-analysis-return" });
  const reactivated = returned.plan.menuState.categories[0].products.find((item) => item.id === productId);
  assert.equal(reactivated.sourcePresent, true);
  assert.equal(reactivated.active, true);

  const manualData = importedData(live, returned);
  const manual = manualData.menuState.categories[0].products.find((item) => item.id === productId);
  manual.active = false;
  manual.manualActive = false;
  manual.statusSource = "manual";
  const preserved = analyzeDataImport(manualData, { workbooks: { menu: full }, files: {} }, { analysisId: "data-import-analysis-manual" });
  const passive = preserved.plan.menuState.categories[0].products.find((item) => item.id === productId);
  assert.equal(passive.active, false);
  assert.equal(passive.statusSource, "manual");
  assert.equal(preserved.report.manualInactivePreserved, 1);

  passive.active = true;
  passive.manualActive = true;
  passive.statusSource = "manual";
  const manuallyActiveRemoved = analyzeDataImport(importedData(manualData, preserved), { workbooks: { menu: empty }, files: {} }, { analysisId: "data-import-analysis-manual-active-removed" });
  const keptActive = manuallyActiveRemoved.plan.menuState.categories[0].products.find((item) => item.id === productId);
  assert.equal(keptActive.sourcePresent, false);
  assert.equal(keptActive.active, true, "Yönetici tarafından aktif tutulan kayıt Excel kaldırmasıyla pasifleştirilmemeli");
  assert.equal(keptActive.statusSource, "manual");
});

test("Tahmisçi sıcak ve soğuk special reçeteleri ayrı katalog kimliğini korur", () => {
  const recipe = workbook({
    "Tahmisci Sıcak Specialler": sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Hazırlanış (ölçüler dahil)"], [{
      Kategori: "Tahmisci Sıcak Specialler", "Ürün Adı": "Sıcak İmza", "Ölçü": "Standart"
    }]),
    "Tahmisci Soğuk Specialler": sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Hazırlanış (ölçüler dahil)"], [{
      Kategori: "Tahmisci Soğuk Specialler", "Ürün Adı": "Soğuk İmza", "Ölçü": "Standart"
    }])
  });
  const analysis = analyzeDataImport(emptyData(), { workbooks: { recipe }, files: {} }, { analysisId: "data-import-analysis-specials" });
  assert.deepEqual(Object.keys(analysis.plan.recipeState).sort(), ["Tahmisçi Sıcak Specialler", "Tahmisçi Soğuk Specialler"].sort());
  assert.deepEqual(Object.keys(analysis.plan.recipeState["Tahmisçi Sıcak Specialler"]), ["Sıcak İmza"]);
  assert.deepEqual(Object.keys(analysis.plan.recipeState["Tahmisçi Soğuk Specialler"]), ["Soğuk İmza"]);
});

test("belirsiz menü tekrarı ve hesaplanmış değeri olmayan fiyat formülü canlı plana uygulanmaz", () => {
  const duplicateMenu = workbook({
    Sıcaklar: sheet(["Ürün Adı"], [{ "Ürün Adı": "Aynı Kahve" }, { "Ürün Adı": "Aynı Kahve" }])
  });
  const duplicate = analyzeDataImport(emptyData(), { workbooks: { menu: duplicateMenu }, files: {} }, { analysisId: "data-import-analysis-duplicate" });
  assert.equal(duplicate.report.canApply, false);
  assert.ok(duplicate.issues.some((issue) => issue.code === "ambiguous_duplicate"));

  const menu = workbook({ Sıcaklar: sheet(["Ürün Adı"], [{ "Ürün Adı": "Formüllü Kahve" }]) });
  const menuAnalysis = analyzeDataImport(emptyData(), { workbooks: { menu }, files: {} }, { analysisId: "data-import-analysis-formula-menu" });
  const data = importedData(emptyData(), menuAnalysis);
  const pricing = workbook({
    Sıcaklar: sheet(["Ürün Adı", "Standart"], [{
      "Ürün Adı": "Formüllü Kahve",
      Standart: "__TAHMISCI_XLSX_FORMULA_VALUE_MISSING__"
    }])
  });
  const formula = analyzeDataImport(data, { workbooks: { pricing }, files: {} }, { analysisId: "data-import-analysis-formula" });
  assert.equal(formula.report.canApply, false);
  assert.ok(formula.issues.some((issue) => ["invalid_price", "invalid_price_value"].includes(issue.code)));
});

test("eşdeğer eski mükerrerler kanonik üründe birleşir ve kalıcı referans dönüşümü üretir", () => {
  const data = emptyData();
  data.menuState.categories = [{
    id: "category-hot",
    name: "Sıcaklar",
    active: true,
    order: 0,
    products: [
      {
        id: "product-canonical", name: "Tiramisu Latte", active: true, order: 1,
        manualContent: "Espresso ve süt", recipeId: "recipe-tiramisu",
        details: { ingredients: "Espresso ve süt" },
        pricing: { typeId: "standard", values: { standard: { price: 100, active: true } } },
        sourceType: "legacy", sourcePresent: true, statusSource: "legacy"
      },
      {
        id: "product-duplicate", name: "TİRAMİSU LATTE", active: true, order: 2,
        manualContent: "Espresso ve süt", recipeId: "recipe-tiramisu",
        details: { ingredients: "Espresso ve süt" },
        pricing: { typeId: "standard", values: { standard: { price: 100, active: true } } },
        sourceType: "legacy", sourcePresent: true, statusSource: "legacy"
      }
    ]
  }];
  const menu = workbook({
    Sıcaklar: sheet(["Ürün Adı", "Ürün İçeriği"], [{ "Ürün Adı": "Tiramisu Latte", "Ürün İçeriği": "Espresso ve süt" }])
  });

  const analysis = analyzeDataImport(data, { workbooks: { menu }, files: {} }, { analysisId: "data-import-analysis-canonical-merge" });
  assert.equal(analysis.issues.some((issue) => issue.code === "ambiguous_match"), false);
  assert.equal(analysis.plan.menuState.categories[0].products.length, 1);
  assert.equal(analysis.plan.menuState.categories[0].products[0].id, "product-canonical");
  assert.equal(analysis.plan.referenceRewrites.menuProducts["product-duplicate"], "product-canonical");
  assert.equal(analysis.report.mergedDuplicates, 1);
});

test("kararlı eşleme normalize kaydı eski mapping'in önünde tutar ve silinmiş kimliği tekil alias ile çözer", () => {
  const normalizedData = emptyData();
  normalizedData.menuState.categories = [{
    id: "category-hot", name: "Sıcaklar", active: true, order: 0, products: [
      { id: "product-normalized", name: "Filtre Kahve", active: true, order: 0, sourceType: "legacy", sourcePresent: true },
      { id: "product-stale-map", name: "Eski Filtre", active: true, order: 1, sourceType: "legacy", sourcePresent: true }
    ]
  }];
  normalizedData.dataImportMappings.menu = [{
    kind: "product", entityId: "product-stale-map", sheetNormalizedName: "sicaklar",
    sourceNormalizedName: "filtre kahve"
  }];
  const normalizedWorkbook = workbook({
    Sıcaklar: sheet(["Ürün Adı", "Ürün İçeriği"], [{ "Ürün Adı": "Filtre Kahve", "Ürün İçeriği": "Kahve" }])
  });
  const normalized = analyzeDataImport(normalizedData, { workbooks: { menu: normalizedWorkbook }, files: {} }, {
    analysisId: "data-import-analysis-normalized-before-mapping"
  });
  const normalizedProduct = normalized.plan.menuState.categories[0].products.find((item) => item.name === "Filtre Kahve");
  assert.equal(normalizedProduct.id, "product-normalized");

  const aliasData = emptyData();
  aliasData.menuState.categories = [{
    id: "category-hot", name: "Sıcaklar", active: true, order: 0, products: [{
      id: "product-canonical", aliasIds: ["product-retired"], name: "Eski Ad", active: true,
      order: 0, sourceType: "legacy", sourcePresent: true
    }]
  }];
  aliasData.dataImportMappings.menu = [{
    kind: "product", entityId: "product-retired", sheetNormalizedName: "sicaklar",
    sourceNormalizedName: "yeni ad"
  }];
  const aliasWorkbook = workbook({
    Sıcaklar: sheet(["Ürün Adı"], [{ "Ürün Adı": "Yeni Ad" }])
  });
  const alias = analyzeDataImport(aliasData, { workbooks: { menu: aliasWorkbook }, files: {} }, {
    analysisId: "data-import-analysis-alias-fallback"
  });
  assert.equal(alias.report.canApply, true);
  assert.equal(alias.plan.menuState.categories[0].products[0].id, "product-canonical");
  assert.equal(alias.plan.menuState.categories[0].products[0].name, "Yeni Ad");
  assert.equal(alias.issues.some((issue) => issue.code === "stale_mapping"), false);
});

test("ürün kodlu reçete kanonik menü ürününe bağlanır ve menüde olmayan ürün bağımsız korunur", () => {
  const workbooks = completeWorkbooks();
  const linked = analyzeDataImport(emptyData(), { workbooks: { menu: workbooks.menu, recipe: workbooks.recipe }, files: {} }, {
    analysisId: "data-import-analysis-recipe-link"
  });
  const catalogRecord = linked.plan.recipeCatalog.find((item) => item.product === "Yeni Kahve");
  const linkedMenuProduct = linked.plan.menuState.categories.flatMap((category) => category.products).find((item) => item.name === "Yeni Kahve");
  assert.ok(catalogRecord);
  assert.equal(catalogRecord.menuProductId, linkedMenuProduct.id);
  assert.equal(linkedMenuProduct.recipeId, catalogRecord.id);

  const orphanRecipe = workbook({
    Sıcaklar: sheet(["Kategori", "Ürün Adı", "Ölçü"], [{ Kategori: "Sıcaklar", "Ürün Adı": "Menüde Yok", "Ölçü": "Standart" }])
  });
  const blocked = analyzeDataImport(importedData(emptyData(), linked), { workbooks: { recipe: orphanRecipe }, files: {} }, {
    analysisId: "data-import-analysis-orphan-recipe"
  });
  assert.equal(blocked.report.canApply, true);
  assert.ok(blocked.plan.recipeCatalog.some((item) => item.product === "Menüde Yok" && !item.menuProductId));
});

test("kodlu dört dosya kanonik Ürün Kodu ile bağlanır ve çoklu fiyat ailelerini kayıpsız korur", () => {
  const workbooks = {
    menu: workbook({
      SICAKLAR: sheet(["Ürün Adı", "Ürün İçeriği", "Ürün Kodu"], [{
        "Ürün Adı": "Kodlu Latte", "Ürün İçeriği": "Espresso ve süt", "Ürün Kodu": "SIC-LAT-KOD"
      }])
    }),
    pricing: workbook({
      SICAKLAR: sheet(["Ürün Adı", "K", "O", "B", "Single", "Double", "Standart", "100 GR", "Ürün Kodu"], [{
        "Ürün Adı": "Eski Latte Adı", K: 100, O: 110, B: 120, Single: 90, Double: 130,
        Standart: 105, "100 GR": 80, "Ürün Kodu": "SIC-LAT-KOD"
      }])
    }),
    recipe: workbook({
      SICAKLAR: sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Hazırlanış (ölçüler dahil)", "Ürün Kodu"], [
        { Kategori: "SICAKLAR", "Ürün Adı": "Kodlu Latte", Ölçü: "14 oz", "İçerik (ölçüsüz)": "Espresso ve süt", "Ürün Kodu": "SIC-LAT-KOD" },
        { Kategori: "SICAKLAR", "Ürün Adı": "Kodlu Latte", Ölçü: "16 oz", "İçerik (ölçüsüz)": "Espresso ve süt", "Ürün Kodu": "SIC-LAT-KOD" }
      ])
    }),
    stock: workbook({
      SÜTLER: sheet(["Ürün Adı", "Ürün Adedi", "Sipariş Eşiği", "Ürün Kodu"], [{
        "Ürün Adı": "Barista Süt", "Ürün Adedi": "12 koli", "Sipariş Eşiği": 3, "Ürün Kodu": "STK-SUT-BAR"
      }])
    })
  };
  const analysis = analyzeDataImport(emptyData(), { workbooks, files: {} }, { analysisId: "data-import-analysis-coded-combined" });
  assert.equal(analysis.report.canApply, true);
  assert.equal(analysis.report.invalidProductCodes, 0);
  assert.equal(analysis.report.duplicateProductCodes, 0);
  assert.equal(analysis.report.orphanProductCodes, 0);
  assert.equal(analysis.issues.some((issue) => issue.code === "mixed_pricing_types"), false);

  const product = analysis.plan.menuState.categories[0].products[0];
  assert.equal(product.productCode, "SIC-LAT-KOD");
  const families = new Map(product.pricing.families.map((family) => [family.typeId, family.values]));
  assert.equal(families.get("size").small.price, 100);
  assert.equal(families.get("size").large.price, 120);
  assert.equal(families.get("shot").double.price, 130);
  assert.equal(families.get("standard").standard.price, 105);
  assert.equal(families.get("weight")["100-gr"].price, 80);
  assert.equal(analysis.plan.recipeState.SICAKLAR["Kodlu Latte"]["14 oz"].productCode, "SIC-LAT-KOD");
  const linkedRecipe = analysis.plan.recipeCatalog.find((item) => item.productCode === "SIC-LAT-KOD");
  assert.equal(linkedRecipe.menuProductId, product.id);
  assert.equal(product.recipeId, linkedRecipe.id);
  assert.equal(analysis.plan.stockState.products[0].productCode, "STK-SUT-BAR");
  assert.ok(analysis.changes.filter((change) => change.product).every((change) => change.productCode || change.workbook === "menu" && change.field === "kategori"));
});

test("kod aynıyken ad güncellenir; aynı ad farklı kodda ayrı ürün ve uyarı olarak kalır", () => {
  const firstWorkbook = workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu"], [{ "Ürün Adı": "İlk Ad", "Ürün Kodu": "SIC-REN-001" }])
  });
  const first = analyzeDataImport(emptyData(), { workbooks: { menu: firstWorkbook }, files: {} }, { analysisId: "data-import-analysis-code-first" });
  const live = importedData(emptyData(), first);
  const originalId = live.menuState.categories[0].products[0].id;
  const renamedWorkbook = workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu"], [
      { "Ürün Adı": "Yeni Ad", "Ürün Kodu": "SIC-REN-001" },
      { "Ürün Adı": "Yeni Ad", "Ürün Kodu": "SIC-REN-002" }
    ])
  });
  const renamed = analyzeDataImport(live, { workbooks: { menu: renamedWorkbook }, files: {} }, { analysisId: "data-import-analysis-code-rename" });
  const products = renamed.plan.menuState.categories[0].products;
  assert.equal(products.length, 2);
  assert.equal(products.filter((item) => item.productCode === "SIC-REN-001").length, 1, "aynı kod ikinci ürün oluşturmamalı");
  assert.equal(products.find((item) => item.productCode === "SIC-REN-001").id, originalId);
  assert.equal(products.find((item) => item.productCode === "SIC-REN-001").name, "Yeni Ad");
  assert.ok(products.find((item) => item.productCode === "SIC-REN-001").nameHistory.includes("İlk Ad"));
  assert.equal(renamed.report.updatedProducts, 1);
  assert.equal(renamed.report.newProducts, 1, "yalnız farklı kodlu kayıt yeni ürün olmalı");
  assert.equal(renamed.issues.some((issue) => issue.code === "duplicate_product_code" && issue.productCode === "SIC-REN-001"), false);
  assert.ok(renamed.issues.some((issue) => issue.code === "same_name_different_code" && issue.severity === "warning"));
});

test("scope fingerprint'i normalize(normalize(store)) sonrasında idempotent kalır", () => {
  const raw = emptyData();
  raw.menuState.categories = [{
    id: "fingerprint-category",
    name: "Sıcaklar",
    active: true,
    order: 0,
    sourceType: "excel",
    sourceWorkbook: "menu",
    sourcePresent: true,
    lastImportedAt: "2026-08-09T10:00:00.000Z",
    products: [{
      id: "fingerprint-product",
      name: "Kanonik Latte",
      productCode: "SIC-KAN-LAT",
      active: true,
      order: 0,
      sourceType: "excel",
      sourceWorkbook: "menu",
      sourcePresent: true,
      lastImportedAt: "2026-08-09T10:00:00.000Z",
      pricing: { typeId: "standard", values: { standard: { price: 125, active: true } } }
    }]
  }];
  raw.recipeState = {
    Sıcaklar: {
      "Kanonik Latte": {
        Standart: {
          id: "fingerprint-recipe",
          productCode: "SIC-KAN-LAT",
          active: true,
          sourceType: "excel",
          sourceWorkbook: "recipe",
          sourcePresent: true,
          content: "Espresso ve süt",
          preparation: "Hazırla"
        }
      }
    }
  };
  raw.stockState = {
    categories: [{ id: "fingerprint-stock-category", name: "Sütler", active: true, order: 0 }],
    products: [{
      id: "fingerprint-stock-product",
      categoryId: "fingerprint-stock-category",
      name: "Barista Süt",
      productName: "Barista Süt",
      productCode: "STK-SUT-BAR",
      active: true,
      sourceType: "excel",
      sourceWorkbook: "stock",
      sourcePresent: true,
      stockQuantity: 4,
      unit: "koli"
    }],
    movements: []
  };

  const once = normalizeStore(raw);
  const twice = normalizeStore(once);
  const scopeSets = [["menu"], ["pricing"], ["recipes"], ["stock"], ["menu", "pricing", "recipes", "stock"]];
  for (const scopes of scopeSets) {
    assert.deepEqual(catalogScopeSnapshot(twice, scopes), catalogScopeSnapshot(once, scopes), `${scopes.join(",")} scope projection değişmemeli`);
    assert.equal(catalogFingerprint(twice, scopes), catalogFingerprint(once, scopes), `${scopes.join(",")} katalog fingerprint değişmemeli`);
    assert.equal(productCodeFingerprint(twice, scopes), productCodeFingerprint(once, scopes), `${scopes.join(",")} kod fingerprint değişmemeli`);
  }
});

test("fiyat aktarımı para birimini, Yönetici özel seçeneğini ve boşalan Excel fiyatının arşivini korur", () => {
  const base = emptyData();
  base.pricing.types = [{
    id: "special",
    name: "Özel",
    active: true,
    order: 0,
    options: [{ id: "almond", label: "Badem Sütlü", active: true, order: 0 }]
  }];
  const menu = workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu"], [{ "Ürün Adı": "Özel Latte", "Ürün Kodu": "SIC-LAT-OZL" }])
  });
  const firstPricing = workbook({
    SICAKLAR: sheet(["Ürün Adı", "K", "Standart", "Badem Sütlü", "Ürün Kodu"], [{
      "Ürün Adı": "Özel Latte", K: 100, Standart: "1.234,50 ₺", "Badem Sütlü": 140, "Ürün Kodu": "SIC-LAT-OZL"
    }])
  });
  const first = analyzeDataImport(base, { workbooks: { menu, pricing: firstPricing }, files: {} }, {
    analysisId: "data-import-analysis-pricing-metadata-first",
    now: "2026-08-09T08:00:00.000Z"
  });
  assert.equal(first.report.canApply, true);
  const firstProduct = first.plan.menuState.categories[0].products[0];
  const firstFamilies = new Map(firstProduct.pricing.families.map((family) => [family.typeId, family.values]));
  assert.equal(firstFamilies.get("standard").standard.price, 1234.5);
  assert.equal(firstFamilies.get("special").almond.price, 140);
  assert.equal(firstFamilies.get("special").almond.sourceWorkbook, "pricing");

  const live = importedData(base, first);
  const secondPricing = workbook({
    SICAKLAR: sheet(["Ürün Adı", "K", "Standart", "Badem Sütlü", "Ürün Kodu"], [{
      "Ürün Adı": "Özel Latte", K: "", Standart: "1.300,00 TL", "Badem Sütlü": 140, "Ürün Kodu": "SIC-LAT-OZL"
    }])
  });
  const second = analyzeDataImport(live, { workbooks: { pricing: secondPricing }, files: {} }, {
    analysisId: "data-import-analysis-pricing-metadata-second",
    now: "2026-08-09T09:00:00.000Z"
  });
  const nextProduct = second.plan.menuState.categories[0].products[0];
  const nextFamilies = new Map(nextProduct.pricing.families.map((family) => [family.typeId, family.values]));
  assert.equal(nextFamilies.get("standard").standard.price, 1300);
  assert.equal(nextFamilies.get("size").small.active, false);
  assert.equal(nextFamilies.get("size").small.sourcePresent, false);
  assert.equal(nextFamilies.get("size").small.statusSource, "excel_removed");
  assert.ok(second.changes.some((change) => change.workbook === "pricing" && change.operation === "archive" && change.productCode === "SIC-LAT-OZL"));
});

test("geçersiz, mükerrer ve yetim kodlar raporlanır; bağlantısız reçete korunur ve ölçü çakışması engellenir", () => {
  const menu = workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu"], [{ "Ürün Adı": "Kodlu", "Ürün Kodu": "SIC-KOD-001" }])
  });
  const base = analyzeDataImport(emptyData(), { workbooks: { menu }, files: {} }, { analysisId: "data-import-analysis-code-base" });
  const live = importedData(emptyData(), base);
  const recipe = workbook({
    HAZIRLIK: sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Ürün Kodu"], [
      { Kategori: "HAZIRLIK", "Ürün Adı": "Şurup Hazırlığı", Ölçü: "Standart", "İçerik (ölçüsüz)": "Bir", "Ürün Kodu": "HAZ-SRP-001" },
      { Kategori: "HAZIRLIK", "Ürün Adı": "Şurup Hazırlığı", Ölçü: "Standart", "İçerik (ölçüsüz)": "İki", "Ürün Kodu": "HAZ-SRP-001" },
      { Kategori: "HAZIRLIK", "Ürün Adı": "Geçersiz", Ölçü: "Standart", "Ürün Kodu": "bozuk kod" }
    ])
  });
  const analysis = analyzeDataImport(live, { workbooks: { recipe }, files: {} }, { analysisId: "data-import-analysis-code-errors" });
  assert.equal(analysis.report.canApply, false);
  assert.ok(analysis.report.invalidProductCodes >= 1);
  assert.equal(analysis.report.orphanProductCodes, 0, "reçete kodu menü kataloğuna bağımlı olmamalı");
  assert.ok(analysis.report.duplicateProductCodes >= 1);
  assert.ok(analysis.report.duplicateRecipeMeasures >= 1);
  assert.ok(analysis.plan.recipeState.HAZIRLIK["Şurup Hazırlığı"].Standart, "yetim kodlu ilk reçete bağlantısız da olsa planda korunmalı");
});

test("Single ve Double son ekleri aynı kodda güvenli reçete ölçülerine ayrılır", () => {
  const menu = workbook({
    SICAKLAR: sheet(["Ürün Adı", "Ürün Kodu"], [{ "Ürün Adı": "Espresso Macchiato", "Ürün Kodu": "SIC-ESP-MAC" }])
  });
  const recipe = workbook({
    SICAKLAR: sheet(["Kategori", "Ürün Adı", "Ölçü", "İçerik (ölçüsüz)", "Ürün Kodu"], [
      { Kategori: "SICAKLAR", "Ürün Adı": "Espresso Macchiato Single", Ölçü: "Standart", "İçerik (ölçüsüz)": "Tek shot", "Ürün Kodu": "SIC-ESP-MAC" },
      { Kategori: "SICAKLAR", "Ürün Adı": "Espresso Macchiato Double", Ölçü: "Standart", "İçerik (ölçüsüz)": "Çift shot", "Ürün Kodu": "SIC-ESP-MAC" }
    ])
  });
  const analysis = analyzeDataImport(emptyData(), { workbooks: { menu, recipe }, files: {} }, { analysisId: "data-import-analysis-code-recipe-variants" });
  assert.equal(analysis.report.canApply, true);
  assert.deepEqual(Object.keys(analysis.plan.recipeState.SICAKLAR["Espresso Macchiato"]).sort(), ["Double", "Single"]);
});
