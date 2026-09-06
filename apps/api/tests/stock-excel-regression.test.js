"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const ExcelJS = require("exceljs");
const { normalizeStockState, migrateStore } = require("../src/store/migrations");
const stock = require("../src/stock-service");
const { registerStockLocationRoutes } = require("../src/stock-location-routes");
const ADMIN = { type: "admin", id: "test-manager", name: "Yönetici" };
const FROM = stock.GENERAL_LOCATION_ID;
const TO = stock.CAFE_LOCATION_ID;

function fixture() {
  return normalizeStockState({
    categories: [{ id: "cups", name: "Bardaklar", active: true }],
    products: [{ id: "cup", name: "12 oz bardak", productCode: "STK-CUP-12", categoryId: "cups", category: "Bardaklar", unit: "adet", baseUnit: "adet", bulkUnit: "koli", unitsPerBulkUnit: 50, active: true, stockQuantity: 0 }],
    locations: [{ id: FROM, code: "GENEL", type: "central", name: "Dış Depo", active: true }, { id: TO, code: "CAFE", type: "cafe", name: "Kafe Deposu", active: true }],
    balances: [{ locationId: FROM, productId: "cup", quantity: 904, revision: 3 }, { locationId: TO, productId: "cup", quantity: 256, revision: 2 }],
    locationMigrationVersion: 1
  });
}
function transfer(overrides = {}) {
  return { productId: "cup", fromLocationId: FROM, toLocationId: TO, bulkQuantity: 4, baseQuantity: 6, sourceExpectedRevision: 3, destinationExpectedRevision: 2, requestId: "mixed-transfer-0001", ...overrides };
}
function workbookRecord(overrides = {}) {
  return { category: "Bardaklar", productName: "12 oz bardak", productCode: "STK-CUP-12", baseUnit: "", bulkUnit: "koli", unitsPerBulkUnit: 50, factorProvided: true, baseQuantity: 4, bulkQuantity: 18, warnings: [], ...overrides };
}
function importWorkbook(state, overrides = {}, id = "excel-import-0001") {
  const parsed = { categories: ["Bardaklar"], products: [workbookRecord(overrides)], categoriesFound: 1, productsFound: 1, errors: [] };
  return stock.applyStockExcelImport(state, parsed, { targetLocationId: FROM, requestId: id }, ADMIN);
}

async function serverFor(t, initial = fixture()) {
  let data = { stockState: initial, revisions: { inventory: 0, catalog: 0, stock: 0 }, recipeUsers: [{ id: "person", active: true, stockLocationId: TO }] };
  const events = [];
  const noChange = Symbol("no-change");
  const store = {
    read: async () => structuredClone(data),
    update: async (callback) => {
      const draft = structuredClone(data);
      const result = await callback(draft, { noChange });
      if (result !== noChange) data = draft;
      return structuredClone(data);
    }
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.recipeUser = { id: "person", active: true, stockLocationId: TO }; next(); });
  const pass = (req, res, next) => next();
  registerStockLocationRoutes({ app, store,
    auth: { requireAdmin: pass, requireRecipe: pass, requireActivePersonel: pass, requirePersonelSection: () => pass },
    requireAdminRequestOrigin: pass, requireAdminOrMainRequestOrigin: pass,
    resolveProcurementActor: async () => ADMIN, hasProcurementCapability: () => true,
    broadcastStockUpdate: (...args) => events.push(args)
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ ok: false, message: error.message, code: error.code }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, method = "GET", body) => {
    if (body && body.expectedRevision === undefined) body = { expectedInventoryRevision: data.revisions.inventory, expectedCatalogRevision: data.revisions.catalog, ...body };
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { request, read: () => data, events, store };
}

test("Excel eksik temel birim uyarısı canonical birimi korur ve normalizasyonda yenilenir", () => {
  const result = importWorkbook(fixture());
  const p = result.stockState.products[0];
  assert.equal(p.baseUnit, "adet");
  assert.equal(p.excelSourceBaseUnitMissing, true);
  assert.equal(p.needsAttention, true);
  assert.ok(p.attentionReasons.includes("MISSING_BASE_UNIT"));
  assert.ok(p.attentionMessages.some((m) => m.includes("Excel dosyasında temel birim eksik.")));
  p.needsAttention = false;
  p.attentionReasons = [];
  p.attentionMessages = [];
  const refreshed = normalizeStockState(result.stockState);
  assert.equal(refreshed.products[0].needsAttention, true);
  stock.updateAllProductTotals(refreshed);
  assert.ok(refreshed.products[0].attentionReasons.includes("MISSING_BASE_UNIT"));
});

test("Ürün Ayarları temel birim kaydı warning'i temizler; tekrar Excel yeniden oluşturur", async (t) => {
  const initial = importWorkbook(fixture()).stockState;
  const api = await serverFor(t, initial);
  let result = await api.request("/api/procurement/v1/stock/catalog/products/cup", "PATCH", { note: "Sadece not", requestId: "product-note-0001" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(api.read().stockState.products[0].needsAttention, true);
  result = await api.request("/api/procurement/v1/stock/inventory/cup", "PATCH", { locationId: FROM, baseUnit: "adet", requestId: "product-unit-0001" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const fixed = api.read().stockState.products[0];
  assert.equal(fixed.excelSourceBaseUnitMissing, false);
  assert.equal(fixed.needsAttention, false);
  assert.ok(!fixed.attentionReasons.includes("MISSING_BASE_UNIT"));
  assert.equal(importWorkbook(api.read().stockState, {}, "excel-import-0002").stockState.products[0].needsAttention, true);
});

test("Yeni boş birimli Excel ürünü atlanmaz, adet uydurulmaz, stok hareketi engellenir", () => {
  const result = importWorkbook(normalizeStockState({}));
  const p = result.stockState.products[0];
  assert.ok(p);
  assert.equal(p.baseUnit, "");
  assert.equal(p.unit, "");
  assert.equal(p.needsAttention, true);
  assert.equal(result.movements.length, 0);
  const persisted = normalizeStockState(JSON.parse(JSON.stringify(result.stockState)));
  assert.equal(persisted.products[0].baseUnit, "");
  assert.equal(stock.getLocationInventory(persisted, FROM).balances.length, 1);
  assert.throws(() => stock.applyStockMovement(persisted, { type: "manual_in", productId: p.id, locationId: FROM, quantity: 1 }, ADMIN), /temel birim/);
});

test("Aynı Excel yeni requestId ile dahi ürün kategori movement veya warning çoğaltmaz", () => {
  const first = importWorkbook(fixture(), { bulkQuantity: 19 });
  const second = importWorkbook(first.stockState, { bulkQuantity: 19 }, "excel-import-0002");
  assert.equal(second.stockState.products.length, first.stockState.products.length);
  assert.equal(second.stockState.categories.length, first.stockState.categories.length);
  assert.equal(second.stockState.movements.length, first.stockState.movements.length);
  assert.equal(second.movements.length, 0);
  assert.deepEqual(second.stockState.products[0].attentionReasons, first.stockState.products[0].attentionReasons);
  assert.deepEqual(second.stockState.products[0].attentionMessages, first.stockState.products[0].attentionMessages);
  assert.equal(importWorkbook(second.stockState, { bulkQuantity: 19 }, "excel-import-0002").idempotent, true);
});

test("Gerçek xlsx parser boş temel birimli yeni ve mevcut ürünleri döndürür", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Bardaklar");
  sheet.addRows([["12 oz bardak"], ["Toplu birim", "Temel birim", "Birim çarpanı"], ["koli", null, 50], ["Kritik eşik", "Sipariş eşiği", "Hedef stok"], [0, 0, 0], ["koli miktarı", "Temel birim miktarı", "Toplam"], [18, 4, 904]]);
  const parsed = await stock.parseStockExcelWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].baseUnit, "");
  assert.equal(parsed.products[0].productName, "12 oz bardak");
  assert.ok(parsed.products[0].warnings.some((message) => /temel birim.*eksik/i.test(message)));
});

test("Excel manuel pasif ürün kategori ve trash lifecycle durumunu korur", () => {
  for (const flags of [{ active: false, statusSource: "manual" }, { active: false, trashed: true, removedAt: "2026-01-01" }, { active: false, deletedAt: "2026-01-01" }]) {
    const state = fixture();
    Object.assign(state.products[0], flags);
    Object.assign(state.categories[0], { active: false, statusSource: "manual" });
    const result = importWorkbook(state, { baseUnit: "adet" });
    for (const [key, value] of Object.entries(flags)) assert.equal(result.stockState.products[0][key], value);
    assert.equal(result.stockState.categories[0].active, false);
  }
});

test("Güvenilir birim dönüşümü tüm depoları çevirir, bilinmeyen dönüşüm eski etiketi saklar", () => {
  const original = fixture();
  Object.assign(original.products[0], { unit: "koli", baseUnit: "koli", bulkUnit: "", caseUnit: "", unitsPerBulkUnit: 0 });
  original.balances.forEach((b) => { b.quantity = 4; b.baseUnitSnapshot = "koli"; b.bulkUnitSnapshot = ""; b.unitsPerBulkUnitSnapshot = 0; });
  const unknown = importWorkbook(original, { baseUnit: "adet", bulkUnit: "", unitsPerBulkUnit: 0, bulkQuantity: 0, baseQuantity: 6 });
  const target = stock.getProductBalance(unknown.stockState, TO, "cup");
  assert.equal(target.quantity, 4);
  assert.equal(target.reconciliationRequired, true);
  assert.equal(target.previousBaseUnit, "koli");
  assert.equal(target.baseUnitSnapshot, "koli");
  assert.match(stock.getLocationInventory(unknown.stockState, TO).balances[0].quantityDisplay.display, /koli/);
  const repeated = stock.applyStockExcelImport(unknown.stockState, { products: [workbookRecord({ bulkUnit: "", bulkQuantity: 0, baseQuantity: 99 })] }, { targetLocationId: TO, requestId: "uncertain-import-0002" }, ADMIN);
  assert.equal(stock.getProductBalance(repeated.stockState, TO, "cup").quantity, 4);
  assert.equal(stock.getProductBalance(repeated.stockState, TO, "cup").reconciliationRequired, true);
  const safe = fixture();
  const converted = stock.migrateProductUnitSchema(safe, "cup", { targetBaseUnit: "koli", targetBulkUnit: "", allowDecimal: true, confirm: true }, { source: "manual" });
  assert.equal(stock.getProductBalance(converted.state, FROM, "cup").quantity, 18.08);
  assert.equal(stock.getProductBalance(converted.state, TO, "cup").quantity, 5.12);
  assert.ok(converted.product.unitSchemaHistory.length >= 2);
});

test("Depo ismi ve görünürlükle oluşturulur, kod benzersizdir, ayarlar assignment ve stokları korur", async (t) => {
  const api = await serverFor(t);
  for (const visible of [false, true]) {
    const result = await api.request("/api/procurement/v1/stock/locations", "POST", { name: visible ? "Ek Depo" : "Dış Depo 2", personnelVisible: visible, requestId: `location-create-${visible}` });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.location.personnelVisible, visible);
    assert.equal(result.body.location.active, true);
    assert.equal(result.body.location.type, "other");
    assert.ok(result.body.location.code && result.body.location.createdAt && result.body.location.id);
  }
  const old = structuredClone(api.read().stockState.balances);
  const update = await api.request(`/api/procurement/v1/stock/locations/${TO}`, "PATCH", { personnelVisible: false, requestId: "visibility-hide-0001" });
  assert.equal(update.status, 200);
  assert.equal(api.read().recipeUsers[0].stockLocationId, TO);
  assert.deepEqual(api.read().stockState.balances, old);
  assert.equal(api.read().stockState.locations.find((l) => l.id === TO).active, true);
  const hidden = await api.request("/api/workforce/stock");
  assert.equal(hidden.status, 403);
  assert.equal(hidden.body.code, "STOCK_LOCATION_HIDDEN");
  assert.equal((await api.request(`/api/procurement/v1/stock/inventory?locationId=${TO}`)).status, 200);
  assert.equal(api.events.length, 3);
});

test("Visibility fallback cafe açık diğer depolar kapalıdır, true yetki genişletmez", () => {
  const state = fixture();
  assert.equal(state.locations.find((l) => l.id === TO).personnelVisible, true);
  assert.equal(state.locations.find((l) => l.id === FROM).personnelVisible, false);
  state.locations.find((l) => l.id === FROM).personnelVisible = true;
  assert.throws(() => stock.actorLocationId(state, { type: "personel", stockLocationId: FROM }), /atanmış Kafe/);
  state.locations.find((l) => l.id === TO).personnelVisible = false;
  assert.throws(() => stock.actorLocationId(state, { type: "personel", stockLocationId: TO }), /görünümüne kapalı/);
  assert.equal(normalizeStockState(state).locations.find((l) => l.id === TO).personnelVisible, false);
});

test("Mixed 4 koli + 6 adet canonical 206, toplam 1160 ve ortak movement snapshot korunur", () => {
  const initial = fixture();
  const created = stock.createTransferRequest(initial, transfer(), ADMIN);
  assert.equal(created.transfer.quantity, 206);
  const approved = stock.approveTransfer(created.stockState, created.transfer.id, { requestId: "mixed-approve-0001" }, ADMIN);
  const state = normalizeStockState(JSON.parse(JSON.stringify(approved.stockState)));
  assert.equal(stock.getProductBalance(state, FROM, "cup").quantity, 698);
  assert.equal(stock.getProductBalance(state, TO, "cup").quantity, 462);
  assert.equal(stock.calculateTotalStock(state, "cup"), 1160);
  assert.equal(stock.formatBaseQuantity(state.products[0], 698).display, "13 koli + 48 adet");
  assert.equal(stock.formatBaseQuantity(state.products[0], 462).display, "9 koli + 12 adet");
  assert.deepEqual(new Set(approved.movements.map((m) => m.type)), new Set(["transfer_out", "transfer_in"]));
  assert.deepEqual(stock.serializeMovements(state, { locationId: FROM }).map((m) => m.type), ["transfer_out"]);
  assert.deepEqual(stock.serializeMovements(state, { locationId: TO }).map((m) => m.type), ["transfer_in"]);
  for (const movement of state.movements) {
    assert.equal(movement.transferId, created.transfer.id);
    assert.equal(movement.transactionRef, approved.transfer.transactionRef);
    assert.equal(movement.sourceLocationId, FROM);
    assert.equal(movement.destinationLocationId, TO);
    assert.equal(movement.conversionSnapshot.bulkQuantity, 4);
    assert.equal(movement.conversionSnapshot.baseQuantity, 6);
    assert.equal(movement.conversionSnapshot.unitsPerBulkUnit, 50);
  }
  const replay = stock.createTransferRequest(state, transfer(), ADMIN);
  assert.equal(replay.idempotent, true);
  assert.equal(stock.getProductBalance(replay.stockState, FROM, "cup").quantity, 698);
});

test("Legacy quantity/unit ve olmayan hedef bakiyesi aynı global productId ile çalışır", () => {
  const state = fixture();
  state.balances = state.balances.filter((b) => b.locationId !== TO);
  const created = stock.createTransferRequest(state, { productId: "cup", fromLocationId: FROM, toLocationId: TO, quantity: 4, unit: "koli", requestId: "legacy-transfer-0001" }, ADMIN);
  const approved = stock.approveTransfer(created.stockState, created.transfer.id, {}, ADMIN);
  assert.equal(stock.getProductBalance(approved.stockState, TO, "cup").quantity, 200);
  assert.equal(approved.stockState.products.length, 1);
});

test("Geçersiz transfer girdileri ve mutabakat stok değiştirmeden reddedilir", () => {
  const cases = [
    { input: { toLocationId: FROM } },
    { input: { bulkQuantity: 0, baseQuantity: 0 } },
    { input: { bulkQuantity: -1 } },
    { input: { baseQuantity: -1 } },
    { input: { bulkQuantity: 100 } },
    { input: { baseQuantity: "NaN" } },
    { input: { sourceExpectedRevision: 2 } },
    { input: { destinationExpectedRevision: 1 } },
    { change: (s) => { s.products[0].active = false; } },
    { change: (s) => { s.products[0].trashed = true; } },
    { change: (s) => { s.locations[0].active = false; } },
    { change: (s) => { s.balances[0].reconciliationRequired = true; } },
    { change: (s) => { s.balances[1].reconciliationRequired = true; } },
    { change: (s) => { Object.assign(s.products[0], { baseUnit: "", unit: "", baseUnitMissing: true }); } }
  ];
  for (const entry of cases) {
    const state = fixture();
    entry.change?.(state);
    const before = JSON.stringify(state);
    assert.throws(() => stock.createTransferRequest(state, transfer(entry.input), ADMIN));
    assert.equal(JSON.stringify(state), before);
  }
});

test("Onay anında değişen stok ve çok ürünlü hata yarım transfer bırakmaz", () => {
  const created = stock.createTransferRequest(fixture(), transfer(), ADMIN);
  created.stockState.balances.find((b) => b.locationId === TO).revision++;
  const before = JSON.stringify(created.stockState);
  assert.throws(() => stock.approveTransfer(created.stockState, created.transfer.id, {}, ADMIN), /değişti/);
  assert.equal(JSON.stringify(created.stockState), before);
  const multi = fixture();
  const second = { ...multi.products[0], id: "cup2", productCode: "STK-CUP-16", name: "16 oz bardak" };
  multi.products.push(second);
  multi.balances.push({ locationId: FROM, productId: "cup2", quantity: 100, revision: 0 });
  const request = stock.createTransferRequest(multi, { fromLocationId: FROM, toLocationId: TO, items: [{ productId: "cup", quantity: 4 }, { productId: "cup2", quantity: 1 }], requestId: "multi-transfer-0001" }, ADMIN);
  request.stockState.products.find((p) => p.id === "cup2").active = false;
  const snapshot = JSON.stringify(request.stockState);
  assert.throws(() => stock.approveTransfer(request.stockState, request.transfer.id, {}, ADMIN));
  assert.equal(JSON.stringify(request.stockState), snapshot);
});

test("Doğrudan route atomik idempotenttir, SSE ve personel stok yenilemesi görünürlüğü korur", async (t) => {
  const api = await serverFor(t);
  const body = { ...transfer(), directApply: true, expectedRevision: 0 };
  const result = await api.request("/api/procurement/v1/stock/transfers", "POST", body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.transfer.status, "approved");
  const replay = await api.request("/api/procurement/v1/stock/transfers", "POST", body);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotent, true);
  assert.equal(api.events.length, 1);
  const personnel = await api.request("/api/workforce/stock");
  assert.equal(personnel.status, 200);
  assert.equal(personnel.body.balances[0].quantity, 462);
  assert.deepEqual(personnel.body.locations.map((l) => l.id), [TO]);
  const before = JSON.stringify(api.read());
  const failure = await api.request("/api/procurement/v1/stock/transfers", "POST", { ...transfer({ requestId: "failed-transfer-0002", bulkQuantity: 999, sourceExpectedRevision: 4, destinationExpectedRevision: 3 }), directApply: true, expectedRevision: 1 });
  assert.equal(failure.status, 409);
  assert.equal(JSON.stringify(api.read()), before);
  assert.equal(api.events.length, 1);
});

test("Birim kataloğu değiştiğinde eski önizleme transferi conflict olur", async (t) => {
  const api = await serverFor(t);
  const updated = await api.request("/api/procurement/v1/stock/catalog/products/cup", "PATCH", { unitsPerBulkUnit: 60, requestId: "factor-update-0001" });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const before = JSON.stringify(api.read());
  const rejected = await api.request("/api/procurement/v1/stock/transfers", "POST", { ...transfer(), directApply: true, expectedRevision: 0, expectedCatalogRevision: 0 });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
  assert.equal(JSON.stringify(api.read()), before);
});

test("Depoyu pasifleştirmek bakiyeyi geçmişi ve audit kaydını silmez", async (t) => {
  const api = await serverFor(t);
  const transferred = await api.request("/api/procurement/v1/stock/transfers", "POST", { ...transfer(), directApply: true, expectedRevision: 0 });
  assert.equal(transferred.status, 201);
  const before = structuredClone(api.read().stockState);
  const changed = await api.request(`/api/procurement/v1/stock/locations/${FROM}`, "PATCH", { active: false, requestId: "deactivate-location-0001" });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(api.read().stockState.balances, before.balances);
  assert.deepEqual(api.read().stockState.movements, before.movements);
  assert.deepEqual(api.read().stockState.transfers, before.transfers);
  assert.equal(api.read().stockState.locations.find((l) => l.id === FROM).active, false);
  const rejected = await api.request("/api/procurement/v1/stock/transfers", "POST", { ...transfer({ requestId: "inactive-transfer-0001", sourceExpectedRevision: 4, destinationExpectedRevision: 3 }), directApply: true });
  assert.ok([404, 409].includes(rejected.status));
});

test("Manuel birim migration aynı temel birimde de yalnız eksik Excel uyarısını temizler", () => {
  const state = importWorkbook(fixture()).stockState;
  state.products[0].attentionReasons.push("OTHER_WARNING");
  state.products[0].attentionMessages.push("Başka bilgi eksik.");
  const fixed = stock.migrateProductUnitSchema(state, "cup", { targetBaseUnit: "adet", targetBulkUnit: "koli", unitsPerBulkUnit: 50, confirm: true }, { source: "manual" });
  assert.equal(fixed.product.excelSourceBaseUnitMissing, false);
  assert.ok(!fixed.product.attentionReasons.includes("MISSING_BASE_UNIT"));
  assert.ok(fixed.product.attentionReasons.includes("OTHER_WARNING"));
  assert.equal(fixed.product.needsAttention, true);
});

test("Depo trash: pasif ayrımı, gizleme, geri alma ve revision/idempotency korunur", async (t) => {
  const api = await serverFor(t);
  const before = structuredClone(api.read().stockState);
  const base = `/api/procurement/v1/stock/locations/${FROM}`;
  const trashed = await api.request(`${base}/trash`, "POST", { reason: "Depo kapandı", requestId: "location-trash-regression-1" });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));
  assert.equal(trashed.body.location.trashed, true);
  assert.equal(trashed.body.location.active, false);
  assert.ok(!trashed.body.locations.some((location) => location.id === FROM));
  assert.deepEqual(api.read().stockState.balances, before.balances);
  assert.deepEqual(api.read().stockState.movements, before.movements);
  assert.deepEqual(api.read().stockState.transfers, before.transfers);
  const listed = await api.request("/api/procurement/v1/stock/locations");
  assert.ok(!listed.body.locations.some((location) => location.id === FROM));
  assert.equal(listed.body.locationHistory.find((location) => location.id === FROM).name, "Dış Depo");
  const { createProcurementService } = require("../src/procurement-service");
  const service = createProcurementService({ store: api.store });
  const trash = await service.listTrash(ADMIN);
  assert.ok(trash.records.some((record) => record.id === FROM && record.type === "stock-location"));
  const replay = await api.request(`${base}/trash`, "POST", { expectedRevision: 0, requestId: "location-trash-regression-1" });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  const saved = JSON.stringify(api.read());
  assert.equal((await api.request(base, "PATCH", { active: true, requestId: "location-trash-edit-denied" })).status, 409);
  assert.equal((await api.request(`${base}/restore`, "POST", { expectedRevision: 0, requestId: "location-restore-stale" })).status, 409);
  assert.equal(JSON.stringify(api.read()), saved);
  const restored = await api.request(`${base}/restore`, "POST", { requestId: "location-restore-regression" });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.location.active, true);
  assert.equal(restored.body.location.trashed, false);
  assert.equal(restored.body.location.removedAt, null);
  assert.equal(restored.body.location.removedBy, null);
  assert.ok(restored.body.locations.some((location) => location.id === FROM));
  await api.request(base, "PATCH", { active: false, requestId: "location-passive-regression" });
  assert.ok(!(await service.listTrash(ADMIN)).records.some((record) => record.id === FROM));
  await api.request(`${base}/trash`, "POST", { requestId: "location-passive-trash" });
  const passive = await api.request(`${base}/restore`, "POST", { requestId: "location-passive-restore" });
  assert.equal(passive.body.location.active, false);
  assert.ok(api.read().recipeActivity.some((entry) => entry.action === "stock.location.trash"));
  assert.ok(api.read().recipeActivity.some((entry) => entry.action === "stock.location.restore"));
});

test("Depo trash kuralları korunur; purge sevkiyat referansını engellemez ve entity kaldırılır", () => {
  const state = fixture();
  const removed = stock.applyStockLocationLifecycle(state, TO, "trash", ADMIN);
  assert.equal(removed.stockState.locations.find((location) => location.id === FROM).isDefault, true);
  assert.throws(() => stock.applyStockLocationLifecycle(removed.stockState, FROM, "trash", ADMIN), /Son kullanılabilir/);
  assert.throws(() => stock.applyStockLocationLifecycle(fixture(), TO, "trash", ADMIN, { data: { recipeUsers: [{ id: "person", active: true, stockLocationId: TO }] } }), /aktif personel/);
  const empty = normalizeStockState({ locations: [{ id: "empty", code: "EMPTY", name: "Boş Depo", active: true }], locationMigrationVersion: 1 });
  const trash = stock.applyStockLocationLifecycle(empty, "empty", "trash", ADMIN).stockState;
  const purged = stock.applyStockLocationLifecycle(trash, "empty", "purge", ADMIN, { data: { workforceShipments: [{ destinationLocationId: "empty" }] } });
  assert.ok(purged.location.purgedAt);
  assert.equal(purged.location.active, false);
  assert.equal(purged.location.trashed, false);
  assert.ok(!normalizeStockState(purged.stockState).locations.some((location) => location.id === "empty"));
  assert.throws(() => stock.applyStockLocationLifecycle(purged.stockState, "empty", "restore", ADMIN), /bulunamadı/);
  assert.equal(stock.applyStockLocationLifecycle(purged.stockState, "empty", "purge", ADMIN).idempotent, true);
});

test("Depo purge: bakiyeli, hareketli, personel atanmış ve son varsayılan depo silinir; geçmiş korunur", async (t) => {
  const initial = fixture();
  Object.assign(initial.locations.find((location) => location.id === FROM), {
    active: false, trashed: true, removedAt: "2026-09-06T00:00:00.000Z", assignedPersonnelIds: ["person"]
  });
  initial.movements = [{ id: "old-movement", productId: "cup", locationId: FROM, type: "manual_in", quantity: 2 }];
  initial.transfers = [{ id: "old-transfer", productId: "cup", fromLocationId: FROM, toLocationId: TO, quantity: 2, status: "approved" }];
  initial.counts = [{ id: "old-count", locationId: FROM, status: "completed", items: [{ productId: "cup", systemQuantity: 904, countedQuantity: 904 }] }];
  const api = await serverFor(t, normalizeStockState(initial));
  await api.store.update((data) => {
    data.recipeUsers[0].stockLocationId = FROM;
    data.workforceShipments = [{ id: "old-shipment", destinationLocationId: FROM, destinationLocationName: "Dış Depo", items: [] }];
    data.recipeActivity = [{ id: "old-audit", action: "stock.adjustment", locationId: FROM }];
    data.procurement = { shipments: [{ id: "old-procurement-shipment", locationId: FROM }], receipts: [{ id: "old-receipt", locationId: FROM }] };
    Object.assign(data, migrateStore(migrateStore(data)));
  });
  const before = structuredClone(api.read());
  const { createProcurementService } = require("../src/procurement-service");
  const service = createProcurementService({ store: api.store });
  assert.ok((await service.listTrash(ADMIN)).records.some((record) => record.id === FROM));
  const base = `/api/procurement/v1/stock/locations/${FROM}/purge`;
  assert.equal((await api.request(base, "POST", {})).status, 400);
  assert.equal((await api.request(base, "POST", { expectedRevision: 99, requestId: "location-purge-stale" })).status, 409);
  assert.deepEqual(api.read(), before);
  const purged = await api.request(base, "POST", { requestId: "location-purge-referenced" });
  assert.equal(purged.status, 200, JSON.stringify(purged.body));
  assert.ok(!purged.body.locations.some((location) => location.id === FROM));
  assert.ok(!api.read().stockState.locations.some((location) => location.id === FROM));
  assert.ok(!(await service.listTrash(ADMIN)).records.some((record) => record.id === FROM));
  const listed = await api.request("/api/procurement/v1/stock/locations");
  assert.ok(!listed.body.locations.some((location) => location.id === FROM));
  assert.ok(!listed.body.locationHistory.some((location) => location.id === FROM));
  const replay = await api.request(base, "POST", { expectedRevision: 0, requestId: "location-purge-referenced" });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal((await api.request(base, "POST", { requestId: "location-purge-repeat" })).body.idempotent, true);
  assert.equal((await api.request(`/api/procurement/v1/stock/locations/${FROM}/restore`, "POST", { requestId: "location-restore-purged" })).status, 404);
  assert.equal(api.read().stockState.locations.length, 1);
  assert.equal(api.read().stockState.locations[0].isDefault, true);
  assert.equal(api.read().stockState.locations[0].active, true);
  const last = await api.request(`/api/procurement/v1/stock/locations/${TO}/purge`, "POST", { requestId: "location-purge-last-default" });
  assert.equal(last.status, 200, JSON.stringify(last.body));
  assert.deepEqual(last.body.locations, []);
  const reopened = migrateStore(JSON.parse(JSON.stringify(api.read())));
  assert.deepEqual(reopened.stockState.locations, []);
  for (const key of ["products", "balances", "movements", "transfers", "counts"]) assert.deepEqual(reopened.stockState[key], before.stockState[key], key);
  for (const key of ["recipeUsers", "workforceShipments", "procurement"]) assert.deepEqual(reopened[key], before[key], key);
  assert.deepEqual(reopened.recipeActivity.find((entry) => entry.id === "old-audit"), before.recipeActivity[0]);
  assert.ok(reopened.recipeActivity.some((entry) => entry.action === "stock.location.purge"));
});
