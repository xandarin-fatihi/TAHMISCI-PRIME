"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  defaultPricingCatalog,
  migratePricingSystem,
  normalizePricingCatalog,
  operationPrice,
  pricingOptionsForProduct,
  withLegacyPricing
} = require("../src/pricing");
const {
  analyzePricingWorkbook,
  applyPricingImportPlan
} = require("../src/pricing-excel");

function workbook(sheetName, headers, records) {
  const rows = records.map((record) => ({ ...record }));
  rows.headers = headers.slice();
  return { SheetNames: [sheetName], Sheets: { [sheetName]: rows } };
}

function pricingFixture() {
  const pricing = defaultPricingCatalog();
  const menuState = {
    settings: {},
    pricing,
    categories: [{
      id: "kahveler",
      name: "Kahveler",
      products: [{
        id: "filtre-kahve",
        name: "Filtre Kahve",
        active: true,
        pricing: {
          typeId: "standard",
          values: { standard: { price: 80, active: true } }
        }
      }]
    }]
  };
  return { pricing, menuState };
}

test("kanonik fiyat modeli bir ürün için tek fiyat ailesini ve legacy readback'i birlikte korur", () => {
  const pricing = defaultPricingCatalog();
  const menuState = {
    settings: {},
    categories: [{
      id: "sicaklar",
      name: "Sicaklar",
      products: [{
        id: "latte",
        name: "Latte",
        priceMode: "sizes",
        prices: { k: 90, o: 105, b: 120 }
      }]
    }]
  };

  const migrated = migratePricingSystem(pricing, menuState);
  const product = migrated.menuState.categories[0].products[0];
  assert.equal(product.pricing.typeId, "size");
  assert.deepEqual(Object.keys(product.pricing.values).sort(), ["large", "medium", "small"]);
  assert.equal(product.prices.k, 90);
  assert.equal(product.prices.o, 105);
  assert.equal(product.prices.b, 120);

  const roundtrip = withLegacyPricing(product, migrated.pricing);
  assert.equal(roundtrip.pricing.typeId, "size");
  assert.equal(roundtrip.variants.length, 3);
});

test("ürün bazında pasif fiyat seçeneği public seçeneklerden çıkar, yönetim readback'inde korunur", () => {
  const catalog = normalizePricingCatalog({
    schemaVersion: 1,
    types: [{
      id: "weight",
      name: "Gramaj",
      active: true,
      order: 0,
      options: [
        { id: "250-gr", label: "250 gr", value: 250, unit: "gr", active: true, order: 0 },
        { id: "500-gr", label: "500 gr", value: 500, unit: "gr", active: true, order: 1 }
      ]
    }]
  });
  const product = {
    pricing: {
      typeId: "weight",
      values: {
        "250-gr": { price: 140, active: true },
        "500-gr": { price: 250, active: false }
      }
    }
  };

  assert.deepEqual(pricingOptionsForProduct(product, catalog).map((item) => item.id), ["250-gr"]);
  assert.deepEqual(
    pricingOptionsForProduct(product, catalog, { includeInactive: true }).map((item) => item.id),
    ["250-gr", "500-gr"]
  );
});

test("toplu fiyat matematiği doğrudan, tutar, yüzde, alt sınır ve yuvarlamayı aynı kuralla uygular", () => {
  assert.equal(operationPrice(100, "set", 87.25), 87.25);
  assert.equal(operationPrice(100, "add", 12.5), 112.5);
  assert.equal(operationPrice(100, "subtract", 125), 0);
  assert.equal(operationPrice(80, "increase_percent", 25), 100);
  assert.equal(operationPrice(80, "decrease_percent", 25), 60);
  assert.equal(operationPrice(93, "add", 4, 5), 95);
});

test("Excel analizi yeni gramajı dinamik seçenek olarak üretir ve atomik plan ürüne uygulanır", () => {
  const fixture = pricingFixture();
  const input = workbook("Kahveler", ["Urun Adi", "250 gr"], [{
    "Urun Adi": "Filtre Kahve",
    "250 gr": 145
  }]);

  const analysis = analyzePricingWorkbook(input, fixture.menuState, fixture.pricing);
  assert.equal(analysis.report.canApply, true);
  assert.equal(analysis.report.newWeightOptions, 1);
  assert.equal(analysis.report.updatedProductCount, 1);
  assert.equal(analysis.plan.weightType.name, "Gramaj");
  assert.equal(analysis.plan.weightType.options[0].value, 250);
  assert.equal(analysis.plan.weightType.options[0].unit, "gr");

  const original = structuredClone(fixture.menuState);
  const applied = applyPricingImportPlan({
    pricing: fixture.pricing,
    menuState: fixture.menuState
  }, analysis.plan);
  const product = applied.menuState.categories[0].products[0];
  const weightOption = applied.pricing.types.find((type) => type.id === product.pricing.typeId).options[0];
  assert.equal(product.pricing.values[weightOption.id].price, 145);
  assert.equal(product.pricing.values[weightOption.id].active, true);
  assert.deepEqual(fixture.menuState, original, "analiz/apply girdiyi yerinde değiştirmemeli");
});

test("Excel satırında birden fazla fiyat ailesi doldurulursa tek aile kuralı uygulanır", () => {
  const fixture = pricingFixture();
  const input = workbook("Kahveler", ["Urun Adi", "Standart", "K"], [{
    "Urun Adi": "Filtre Kahve",
    Standart: 95,
    K: 90
  }]);

  const analysis = analyzePricingWorkbook(input, fixture.menuState, fixture.pricing);
  assert.equal(analysis.report.canApply, false);
  assert.ok(analysis.issues.some((issue) => issue.code === "mixed_pricing_types"));
  assert.equal(analysis.plan.productUpdates.length, 0);
});

test("Excel boş hücre varsayılan preserve politikasında mevcut fiyatı değiştirmez", () => {
  const fixture = pricingFixture();
  const input = workbook("Kahveler", ["Urun Adi", "Standart"], [{
    "Urun Adi": "Filtre Kahve",
    Standart: ""
  }]);

  const analysis = analyzePricingWorkbook(input, fixture.menuState, fixture.pricing);
  assert.equal(analysis.report.canApply, false);
  assert.equal(analysis.report.unchangedProducts, 1);
  assert.equal(analysis.report.updatePriceCount, 0);
  assert.equal(analysis.plan.productUpdates.length, 0);
});

test("Excel boş hücre clear, deactivate ve error politikalarında açık ve güvenli davranır", () => {
  const fixture = pricingFixture();
  fixture.menuState.categories[0].products[0].pricing = {
    typeId: "size",
    values: {
      small: { price: 70, active: true },
      medium: { price: 85, active: true },
      large: { price: 100, active: true }
    }
  };
  const input = workbook("Kahveler", ["Urun Adi", "K", "O", "B"], [{
    "Urun Adi": "Filtre Kahve",
    K: "",
    O: 90,
    B: ""
  }]);

  const clearAnalysis = analyzePricingWorkbook(
    input,
    fixture.menuState,
    fixture.pricing,
    { blankPolicy: "clear" }
  );
  assert.equal(clearAnalysis.report.canApply, true);
  const clearUpdate = clearAnalysis.plan.productUpdates[0];
  assert.deepEqual(clearUpdate.values.small, { price: null, active: true });
  assert.deepEqual(clearUpdate.values.medium, { price: 90, active: true });
  assert.deepEqual(clearUpdate.values.large, { price: null, active: true });

  const deactivateAnalysis = analyzePricingWorkbook(
    input,
    fixture.menuState,
    fixture.pricing,
    { blankPolicy: "deactivate" }
  );
  assert.equal(deactivateAnalysis.report.canApply, true);
  const deactivateUpdate = deactivateAnalysis.plan.productUpdates[0];
  assert.deepEqual(deactivateUpdate.values.small, { price: 70, active: false });
  assert.deepEqual(deactivateUpdate.values.medium, { price: 90, active: true });
  assert.deepEqual(deactivateUpdate.values.large, { price: 100, active: false });

  const errorAnalysis = analyzePricingWorkbook(
    input,
    fixture.menuState,
    fixture.pricing,
    { blankPolicy: "error" }
  );
  assert.equal(errorAnalysis.report.canApply, false);
  assert.ok(errorAnalysis.issues.some((issue) => issue.code === "blank_price"));
  assert.equal(errorAnalysis.plan.productUpdates.length, 0);
});

test("Excel clear son aktif fiyatı kaldırmaya çalışırsa ürün fiyatlandırmasız bırakılamaz", () => {
  const fixture = pricingFixture();
  const input = workbook("Kahveler", ["Urun Adi", "Standart"], [{
    "Urun Adi": "Filtre Kahve",
    Standart: ""
  }]);
  const analysis = analyzePricingWorkbook(
    input,
    fixture.menuState,
    fixture.pricing,
    { blankPolicy: "clear" }
  );

  assert.equal(analysis.report.canApply, false);
  assert.ok(analysis.issues.some((issue) => issue.code === "no_active_price"));
  assert.equal(analysis.plan.productUpdates.length, 0);
});

test("Excel açık kolon eşlemesi başlık adından bağımsız doğru fiyat alanını hedefler", () => {
  const fixture = pricingFixture();
  const input = workbook("Kahveler", ["Urun Adi", "Yeni Fiyat"], [{
    "Urun Adi": "Filtre Kahve",
    "Yeni Fiyat": 99
  }]);
  const analysis = analyzePricingWorkbook(
    input,
    fixture.menuState,
    fixture.pricing,
    { columnMapping: { "Yeni Fiyat": { typeId: "standard", optionId: "standard" } } }
  );

  assert.equal(analysis.report.canApply, true);
  assert.equal(analysis.changes.length, 1);
  assert.equal(analysis.changes[0].optionId, "standard");
  assert.equal(analysis.changes[0].newPrice, 99);
});

test("Excel açık ignore eşlemesi otomatik tanınan sütunu bilinçli olarak işlem dışında bırakır", () => {
  const fixture = pricingFixture();
  const input = workbook("Kahveler", ["Urun Adi", "Standart"], [{
    "Urun Adi": "Filtre Kahve",
    Standart: 125
  }]);
  const analysis = analyzePricingWorkbook(
    input,
    fixture.menuState,
    fixture.pricing,
    { columnMapping: { Standart: { ignore: true } } }
  );

  assert.equal(analysis.report.canApply, false);
  assert.equal(analysis.changes.length, 0);
  assert.ok(analysis.ignoredColumns.some((column) => column.header === "Standart"));
});

test("geçersiz Excel apply planı atomik olarak reddedilir ve kaynak veri kısmen değişmez", () => {
  const fixture = pricingFixture();
  const before = structuredClone(fixture.menuState);
  const plan = {
    productUpdates: [
      {
        categoryId: "kahveler",
        productId: "filtre-kahve",
        typeId: "standard",
        replaceType: false,
        values: { standard: 100 }
      },
      {
        categoryId: "kahveler",
        productId: "olmayan-urun",
        typeId: "standard",
        replaceType: false,
        values: { standard: 999 }
      }
    ]
  };

  assert.throws(
    () => applyPricingImportPlan({ pricing: fixture.pricing, menuState: fixture.menuState }, plan),
    /artık menüde bulunmuyor|artÄ±k menÃ¼de bulunmuyor/
  );
  assert.deepEqual(fixture.menuState, before);
});
