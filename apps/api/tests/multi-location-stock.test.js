"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeStockState } = require("../src/store/migrations");
const stockService = require("../src/stock-service");

function legacyStockState(quantity = 100) {
  return {
    categories: [{ id: "milk", name: "Sütler" }],
    products: [{
      id: "milk-1", productCode: "SUT-001", name: "Tam Yağlı Süt", categoryId: "milk",
      unit: "adet", baseUnit: "adet", bulkUnit: "koli", unitsPerBulkUnit: 12,
      active: true, stockQuantity: quantity, criticalThreshold: 8, orderThreshold: 16, targetLevel: 40
    }],
    movements: []
  };
}

function stateWithCafeQuantity(quantity) {
  const base = normalizeStockState(legacyStockState(0));
  const seeded = stockService.applyStockMovement(base, {
    type: "stock_in",
    productId: "milk-1",
    locationId: stockService.CAFE_LOCATION_ID,
    quantity,
    unit: "adet",
    requestId: `test-cafe-seed-${quantity}`
  }, { type: "admin", id: "test-manager", name: "Test Yönetici" });
  return seeded.stockState;
}

function stateWithGeneralQuantity(quantity) {
  const base = normalizeStockState(legacyStockState(0));
  return stockService.applyStockMovement(base, {
    type: "stock_in", productId: "milk-1", locationId: stockService.GENERAL_LOCATION_ID,
    quantity, unit: "adet", requestId: `test-general-seed-${quantity}`
  }, { type: "admin", id: "test-manager", name: "Test Yönetici" }).stockState;
}

test("legacy stok bir kez Kafe Deposuna taşınır ve toplam iki kez yazılmaz", () => {
  const once = normalizeStockState(legacyStockState(100));
  const twice = normalizeStockState(once);
  const cafe = stockService.getProductBalance(once, stockService.CAFE_LOCATION_ID, "milk-1");
  const general = stockService.getProductBalance(once, stockService.GENERAL_LOCATION_ID, "milk-1");

  assert.equal(cafe.quantity, 100);
  assert.equal(general.quantity, 0);
  assert.equal(stockService.calculateTotalStock(once, "milk-1"), 100);
  assert.deepEqual(twice.balances, once.balances);
  assert.equal(stockService.calculateTotalStock(twice, "milk-1"), 100);
});

test("eski ürün birimleri merkezi kataloglara idempotent taşınır ve bakiye değişmez", () => {
  const legacy = legacyStockState(126);
  legacy.products[0].baseUnit = "Adet";
  legacy.products[0].bulkUnit = "Koli";
  legacy.products[0].unitsPerBulkUnit = 12;
  const once = normalizeStockState(legacy);
  const twice = normalizeStockState(once);
  assert.ok(once.unitDefinitions.base.includes("adet"));
  assert.ok(once.unitDefinitions.bulk.includes("koli"));
  assert.deepEqual(twice.unitDefinitions, once.unitDefinitions);
  assert.equal(stockService.calculateTotalStock(once, "milk-1"), 126);
  assert.equal(stockService.calculateTotalStock(twice, "milk-1"), 126);
  assert.equal(stockService.formatBaseQuantity(once.products[0], 126).display, "10 koli + 6 adet");
});

test("özel temel ve toplu birim katalogları yenilemede korunur ve ürün seçenekleriyle sınırlı kalır", () => {
  const source = legacyStockState(24);
  source.unitDefinitions = { base: ["adet", "porsiyon"], bulk: ["koli", "tepsi"] };
  const state = normalizeStockState(source);
  assert.deepEqual(state.unitDefinitions.base, ["adet", "porsiyon"]);
  assert.deepEqual(state.unitDefinitions.bulk, ["koli", "tepsi"]);
  assert.deepEqual(stockService.allowedProductUnits(state.products[0]), ["adet", "koli"]);
});

test("depo transferi atomik, idempotent ve toplam stoğu koruyan bir işlemdir", () => {
  const admin = { type: "admin", id: "manager-1", name: "Yönetici" };
  const initial = stateWithGeneralQuantity(100);
  const created = stockService.createTransferRequest(initial, {
    productId: "milk-1", quantity: 25, unit: "adet", requestId: "transfer-create-0001",
    fromLocationId: stockService.GENERAL_LOCATION_ID, toLocationId: stockService.CAFE_LOCATION_ID
  }, admin, { now: "2026-08-25T10:00:00.000Z" });
  const approved = stockService.approveTransfer(created.stockState, created.transfer.id, {
    requestId: "transfer-approve-0001"
  }, admin, { now: "2026-08-25T10:01:00.000Z" });
  const replay = stockService.approveTransfer(approved.stockState, created.transfer.id, {
    requestId: "transfer-approve-0001"
  }, admin, { now: "2026-08-25T10:02:00.000Z" });

  assert.equal(approved.transfer.status, "approved");
  assert.equal(approved.movements.length, 2);
  assert.equal(stockService.getProductBalance(approved.stockState, stockService.GENERAL_LOCATION_ID, "milk-1").quantity, 75);
  assert.equal(stockService.getProductBalance(approved.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 25);
  assert.equal(stockService.calculateTotalStock(approved.stockState, "milk-1"), 100);
  const generalProjection = stockService.getLocationInventory(approved.stockState, stockService.GENERAL_LOCATION_ID)
    .balances.find((balance) => balance.productId === "milk-1");
  assert.equal(generalProjection.cafeQuantity, 25);
  assert.equal(generalProjection.generalQuantity, 75);
  assert.equal(generalProjection.totalQuantity, 100);
  assert.equal(replay.idempotent, true);
  assert.equal(stockService.getProductBalance(replay.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 25);
});

test("personel yalnız atanmış Kafe Deposunda Sarf ve Eksilt hareketi oluşturabilir", () => {
  const state = stateWithCafeQuantity(36);
  const personel = { type: "personel", id: "person-1", stockLocationId: stockService.CAFE_LOCATION_ID };
  const consumed = stockService.applyStockMovement(state, {
    type: "waste", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1, unit: "koli", requestId: "personel-consumption-0001"
  }, personel);
  assert.equal(consumed.movement.type, "waste");
  assert.equal(consumed.movement.baseQuantityDelta, -12);
  assert.equal(consumed.movement.personnelId, "person-1");
  assert.equal(consumed.movement.actorRole, "personel");
  assert.equal(stockService.getProductBalance(consumed.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 24);

  const adjusted = stockService.applyStockMovement(consumed.stockState, {
    type: "stock_out", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 4, unit: "adet", requestId: "personel-adjustment-out-0001"
  }, personel);
  assert.equal(adjusted.movement.type, "manual_out");
  assert.equal(stockService.getProductBalance(adjusted.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 20);

  const replay = stockService.applyStockMovement(adjusted.stockState, {
    type: "stock_out", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 4, unit: "adet", requestId: "personel-adjustment-out-0001"
  }, personel);
  assert.equal(replay.idempotent, true);
  assert.equal(stockService.getProductBalance(replay.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 20);

  assert.throws(() => stockService.applyStockMovement(adjusted.stockState, {
    type: "stock_in", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1, unit: "adet", requestId: "personel-in-forbidden-0001"
  }, personel), /yalnızca Sarf İşle veya Eksilt/);
  assert.throws(() => stockService.applyStockMovement(adjusted.stockState, {
    type: "consumption", productId: "milk-1", locationId: stockService.GENERAL_LOCATION_ID,
    quantity: 1, unit: "adet", requestId: "personel-general-forbidden-0001"
  }, personel), /işlem yetkiniz yok/);
  assert.throws(() => stockService.createTransferRequest(state, {
    productId: "milk-1", quantity: 1, unit: "adet", requestId: "personel-transfer-0001",
    fromLocationId: stockService.GENERAL_LOCATION_ID, toLocationId: stockService.CAFE_LOCATION_ID
  }, personel), /Yönetici yetkisi/);
});

test("personel başka depo atamasıyla Kafe stokuna erişemez", () => {
  const state = stateWithCafeQuantity(20);
  const personel = { type: "personel", id: "person-1", stockLocationId: stockService.GENERAL_LOCATION_ID };
  assert.throws(() => stockService.applyStockMovement(state, {
    type: "consumption", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1, unit: "adet", requestId: "personel-invalid-assignment-0001"
  }, personel), /yalnızca atanmış Kafe Deposunda/);
});

test("personel kendi Sarf hareketini ters hareketle geri alabilir", () => {
  const state = stateWithCafeQuantity(24);
  const personel = { type: "personel", id: "person-1", stockLocationId: stockService.CAFE_LOCATION_ID };
  const consumed = stockService.applyStockMovement(state, {
    type: "consumption", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1, unit: "koli", requestId: "personel-reverse-source-0001"
  }, personel);
  const beforeRevision = stockService.getProductBalance(consumed.stockState, stockService.CAFE_LOCATION_ID, "milk-1").revision;
  const reversed = stockService.reverseMovement(consumed.stockState, consumed.movement.id, {
    requestId: "personel-reverse-0001"
  }, personel);
  const balance = stockService.getProductBalance(reversed.stockState, stockService.CAFE_LOCATION_ID, "milk-1");
  assert.equal(balance.quantity, 24);
  assert.equal(balance.revision, beforeRevision + 1);
  assert.equal(reversed.movements[0].type, "reversal");
  assert.equal(reversed.movements[0].conversionSnapshot.unitsPerBulkUnit, 12);
  assert.equal(Boolean(reversed.stockState.movements.find((item) => item.id === consumed.movement.id).reversedAt), true);

  assert.throws(() => stockService.reverseMovement(consumed.stockState, consumed.movement.id, {
    requestId: "personel-reverse-other-0001"
  }, { ...personel, id: "person-2" }), /geri alma yetkiniz yok/);
});

test("stok hareketi geçersiz birimde 422, yetersiz bakiyede 409 üretir", () => {
  const state = stateWithCafeQuantity(5);
  const personel = { type: "personel", id: "person-1", stockLocationId: stockService.CAFE_LOCATION_ID };
  assert.throws(() => stockService.applyStockMovement(state, {
    type: "consumption", productId: "milk-1", quantity: 1, unit: "litre",
    requestId: "personel-invalid-unit-0001"
  }, personel), (error) => error.status === 422);
  assert.throws(() => stockService.applyStockMovement(state, {
    type: "adjustment_out", productId: "milk-1", quantity: 1, unit: "koli",
    requestId: "personel-insufficient-0001"
  }, personel), (error) => error.status === 409);
  assert.throws(() => stockService.applyStockMovement(stateWithCafeQuantity(24), {
    type: "consumption", productId: "milk-1", quantity: 0.5, unit: "koli",
    requestId: "personel-fractional-package-0001"
  }, personel), (error) => error.status === 422);
});

test("nesne biçimli eski birim değeri güvenli scalar birime normalize edilir", () => {
  const state = normalizeStockState(legacyStockState(0));
  state.products[0].unit = { value: "adet", label: "Adet" };
  state.products[0].baseUnit = { code: "adet" };
  state.products[0].bulkUnit = { value: "koli" };
  const result = stockService.applyStockMovement(state, {
    type: "stock_in", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1, unit: { value: "koli" }, requestId: "object-unit-normalize-0001"
  }, { type: "admin", id: "manager-1" });
  assert.equal(result.movement.inputUnit, "koli");
  assert.equal(result.movement.baseUnit, "adet");
  assert.equal(String(result.movement.inputUnit).includes("[object Object]"), false);
});

test("koli dönüşümü backend tarafından doğrulanır ve hareket snapshot'ına yazılır", () => {
  const state = stateWithCafeQuantity(24);
  const admin = { type: "admin", id: "manager-1", name: "Yönetici" };
  const result = stockService.applyStockMovement(state, {
    type: "waste", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1, unit: "koli", requestId: "case-waste-0001"
  }, admin);
  assert.equal(stockService.getProductBalance(result.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 12);
  assert.equal(result.movement.inputQuantity, 1);
  assert.equal(result.movement.inputUnit, "koli");
  assert.equal(result.movement.baseQuantityDelta, -12);
  assert.equal(result.movement.conversionSnapshot.unitsPerBulkUnit, 12);
  assert.equal(stockService.formatBaseQuantity(result.stockState.products[0], 17).display, "1 koli + 5 adet");
});

test("sayım onaya kadar bakiyeyi değiştirmez, onayda farkı tek hareketle uygular", () => {
  const state = stateWithCafeQuantity(20);
  const admin = { type: "admin", id: "manager-1", name: "Yönetici" };
  const started = stockService.startStockCount(state, { locationId: stockService.CAFE_LOCATION_ID, requestId: "count-start-0001" }, admin);
  const updated = stockService.updateStockCount(started.stockState, started.count.id, {
    items: [{ productId: "milk-1", quantity: 1, unit: "koli" }], requestId: "count-update-0001"
  }, admin);
  assert.equal(stockService.getProductBalance(updated.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 20);
  const approved = stockService.approveStockCount(updated.stockState, started.count.id, { requestId: "count-approve-0001" }, admin);
  assert.equal(approved.count.status, "completed");
  assert.equal(approved.movements.length, 1);
  assert.equal(stockService.getProductBalance(approved.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 12);
});

test("ürün kimliği ile ürün kodu uyuşmazsa hareket reddedilir", () => {
  const state = stateWithCafeQuantity(5);
  assert.throws(() => stockService.applyStockMovement(state, {
    type: "stock_out",
    productId: "milk-1",
    productCode: "BASKA-URUN",
    locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1,
    unit: "adet",
    requestId: "product-code-mismatch-0001"
  }, { type: "admin", id: "manager-1" }), /eşleşmiyor/);
});

test("eski ürün-depo revision'ı ile stok hareketi uygulanmaz", () => {
  const state = stateWithCafeQuantity(5);
  assert.throws(() => stockService.applyStockMovement(state, {
    type: "stock_out",
    productId: "milk-1",
    locationId: stockService.CAFE_LOCATION_ID,
    quantity: 1,
    unit: "adet",
    expectedBalanceRevision: 0,
    requestId: "stale-balance-revision-0001"
  }, { type: "admin", id: "manager-1" }), /başka bir işlemle güncellendi/);
});
