"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { defaultStore, normalizeStore } = require("../src/store/file-store");
const { STORE_SCHEMA_VERSION } = require("../src/store/migrations");
const {
  validateMenuProductCodes,
  validateRecipeProductCodes,
  validateStockProductCodes
} = require("../src/store/product-code-registry");

test("ürün kodu migration'ı kodları kapsam bazında kaydeder, geçmişi korur ve stok iş referanslarını geri doldurur", () => {
  const source = defaultStore("panel-hash", "recipe-hash");
  source.schemaVersion = 9;
  source.productCodeRegistry = {
    schemaVersion: 1,
    entries: [{
      scope: "menu",
      entityId: "menu-1",
      productCode: "OLD-001",
      canonicalName: "Eski Latte",
      nameHistory: ["İlk Latte"]
    }],
    conflicts: []
  };
  source.menuState = {
    settings: {},
    categories: [{
      id: "menu-category",
      name: "Kahveler",
      products: [{
        id: "menu-1",
        name: "Yeni Latte",
        productCode: " mn-001 ",
        productCodeAliases: ["old-001", " OLD-001 "],
        nameHistory: ["Eski Latte"]
      }]
    }]
  };
  source.recipeState = {
    Kahveler: {
      "Yeni Latte": {
        Standart: { id: "recipe-size-1", content: "Süt", preparation: "Hazırla", productCode: "mn-001" },
        Büyük: { id: "recipe-size-2", content: "Süt", preparation: "Hazırla", productCode: "MN-001" }
      }
    }
  };
  source.stockState = {
    categories: [{ id: "stock-category", name: "Sütler" }],
    products: [{ id: "stock-1", categoryId: "stock-category", name: "Süt", productName: "Süt", productCode: " st-001 ", unit: "adet" }],
    movements: [{ id: "movement-1", productId: "stock-1", productName: "Süt", type: "stock_in", quantity: 2, unit: "adet" }]
  };
  source.workforceShipments = [{ id: "shipment-1", items: [{ productId: "stock-1", name: "Süt" }] }];

  const migrated = normalizeStore(source);
  assert.equal(migrated.schemaVersion, STORE_SCHEMA_VERSION);
  assert.equal(migrated.menuState.categories[0].products[0].productCode, "MN-001");
  assert.deepEqual(migrated.menuState.categories[0].products[0].productCodeAliases, ["OLD-001"]);
  assert.deepEqual(migrated.menuState.categories[0].products[0].nameHistory, ["Eski Latte"]);
  assert.equal(migrated.stockState.products[0].productCode, "ST-001");
  assert.equal(migrated.stockState.movements[0].stockProductCode, "ST-001");
  assert.equal(migrated.workforceShipments[0].items[0].stockProductCode, "ST-001");

  const menuEntry = migrated.productCodeRegistry.entries.find((entry) => entry.scope === "menu" && entry.entityId === "menu-1");
  assert.equal(menuEntry.productCode, "MN-001");
  assert.deepEqual(menuEntry.aliases, ["OLD-001"]);
  assert.ok(menuEntry.nameHistory.includes("Eski Latte"));
  assert.ok(menuEntry.nameHistory.includes("İlk Latte"));
  assert.equal(migrated.productCodeRegistry.entries.some((entry) => entry.scope === "recipe" && entry.productCode === "MN-001"), true, "aynı kod farklı kapsamda kullanılabilir");
  assert.equal(migrated.productCodeRegistry.entries.some((entry) => entry.scope === "stock" && entry.productCode === "ST-001"), true);

  assert.deepEqual(normalizeStore(migrated), migrated, "migration tekrar çalıştığında veri değişmemeli");
});

test("aynı kapsamda iki farklı kaydın aynı ürün kodunu sahiplenmesi deterministik conflict üretir", () => {
  const source = defaultStore("panel-hash", "recipe-hash");
  source.menuState = {
    settings: {},
    categories: [{
      id: "category-1",
      name: "Kahveler",
      products: [
        { id: "menu-a", name: "Birinci", productCode: "DUP-100" },
        { id: "menu-b", name: "İkinci", productCode: "dup-100" }
      ]
    }]
  };

  const migrated = normalizeStore(source);
  const claims = migrated.productCodeRegistry.entries.filter((entry) => entry.scope === "menu" && entry.productCode === "DUP-100");
  assert.equal(claims.length, 1);
  assert.equal(claims[0].entityId, "menu-a");
  assert.ok(migrated.productCodeRegistry.conflicts.some((conflict) => (
    conflict.type === "duplicate_product_code"
    && conflict.scope === "menu"
    && conflict.productCode === "DUP-100"
    && conflict.canonicalEntityId === "menu-a"
    && conflict.conflictingEntityId === "menu-b"
  )));
  assert.equal(migrated.menuState.categories[0].products[1].productCode, "DUP-100", "çakışan kaynak metadata sessizce silinmemeli");
  assert.deepEqual(normalizeStore(migrated), migrated);
});

test("manuel API doğrulayıcıları kodsuz legacy kayıtları kabul eder; biçimsiz ve aynı scope'ta yinelenen kodu reddeder", () => {
  assert.equal(validateMenuProductCodes({ categories: [{ id: "c", name: "K", products: [{ id: "a", name: "Kodsuz" }] }] }), "");
  assert.match(validateMenuProductCodes({ categories: [{ id: "c", name: "K", products: [
    { id: "a", name: "A", productCode: "MNU-GRP-001" },
    { id: "b", name: "B", productCode: "mnu-grp-001" }
  ] }] }), /birden fazla kayda bağlanamaz/);
  assert.match(validateStockProductCodes({ products: [{ id: "s", name: "S", productCode: "BAD CODE" }] }), /STK-/);
  assert.match(validateMenuProductCodes({ categories: [{ id: "c", name: "K", products: [{ id: "a", name: "A", productCode: "SIC-LAT_001" }] }] }), /ASCII büyük harf/);
  assert.match(validateMenuProductCodes({ categories: [{ id: "c", name: "K", products: [{ id: "a", name: "A", productCode: "SIC-ÇAY-001" }] }] }), /ASCII büyük harf/);
  assert.equal(validateRecipeProductCodes({ K: { P: {
    Küçük: { productCode: "REC-GRP-001" },
    Büyük: { productCode: "rec-grp-001" }
  } } }), "", "aynı reçete ürününün farklı ölçüleri aynı kodu taşıyabilir");
  assert.match(validateRecipeProductCodes({ K: {
    P1: { Standart: { productCode: "REC-GRP-001" } },
    P2: { Standart: { productCode: "REC-GRP-001" } }
  } }), /birden fazla kayda bağlanamaz/);
});
