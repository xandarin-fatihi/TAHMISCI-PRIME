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

test("legacy stok bir kez Genel Depoya taşınır ve toplam iki kez yazılmaz", () => {
  const once = normalizeStockState(legacyStockState(100));
  const twice = normalizeStockState(once);
  const cafe = stockService.getProductBalance(once, stockService.CAFE_LOCATION_ID, "milk-1");
  const general = stockService.getProductBalance(once, stockService.GENERAL_LOCATION_ID, "milk-1");

  assert.equal(cafe.quantity, 0);
  assert.equal(general.quantity, 100);
  assert.equal(stockService.calculateTotalStock(once, "milk-1"), 100);
  assert.deepEqual(twice.balances, once.balances);
  assert.equal(stockService.calculateTotalStock(twice, "milk-1"), 100);
});

test("depo transferi atomik, idempotent ve toplam stoğu koruyan bir işlemdir", () => {
  const admin = { type: "admin", id: "manager-1", name: "Yönetici" };
  const initial = normalizeStockState(legacyStockState(100));
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
  assert.equal(replay.idempotent, true);
  assert.equal(stockService.getProductBalance(replay.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 25);
});

test("personel sadece atanmış Kafe Deposundan eksiltebilir ve eksi bakiye oluşmaz", () => {
  const state = stateWithCafeQuantity(20);
  const stockedCafe = state;
  const personel = { type: "personel", id: "person-1", stockLocationId: stockService.CAFE_LOCATION_ID };
  const out = stockService.applyStockMovement(stockedCafe, {
    type: "stock_out", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 4, unit: "adet", requestId: "personel-out-0001"
  }, personel);

  assert.equal(stockService.getProductBalance(out.stockState, stockService.CAFE_LOCATION_ID, "milk-1").quantity, 16);
  assert.equal(stockService.getProductBalance(out.stockState, stockService.GENERAL_LOCATION_ID, "milk-1").quantity, 0);
  assert.throws(() => stockService.applyStockMovement(out.stockState, {
    type: "stock_out", productId: "milk-1", locationId: stockService.GENERAL_LOCATION_ID,
    quantity: 1, unit: "adet", requestId: "personel-out-0002"
  }, personel), /yetkiniz yok/);
  assert.throws(() => stockService.applyStockMovement(out.stockState, {
    type: "waste", productId: "milk-1", locationId: stockService.CAFE_LOCATION_ID,
    quantity: 17, unit: "adet", requestId: "personel-out-0003"
  }, personel), /eksiye düşemez/);
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
