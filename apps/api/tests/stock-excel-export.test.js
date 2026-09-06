"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const ExcelJS = require("exceljs");
const express = require("express");
const stock = require("../src/stock-service");
const { normalizeStockState } = require("../src/store/migrations");
const { createFileStore } = require("../src/store/file-store");
const { registerStockLocationRoutes } = require("../src/stock-location-routes");
const CAFE = stock.CAFE_LOCATION_ID;
const GENERAL = stock.GENERAL_LOCATION_ID;
const ADMIN = { type: "admin", id: "export-manager", name: "Yönetici" };

function fixture() {
  return normalizeStockState({
    categories: [{ id: "drinks", name: "Meşrubatlar", active: true }, { id: "supplies", name: "Yeni Sarf", active: true }],
    products: [
      { id: "drink", name: "İçecek", categoryId: "drinks", category: "Meşrubatlar", productCode: "STK-EXPORT-DRINK", baseUnit: "adet", bulkUnit: "koli", unitsPerBulkUnit: 24, active: true },
      { id: "single", name: "Tek Birimli Ürün", categoryId: "supplies", category: "Yeni Sarf", productCode: "STK-EXPORT-SINGLE", baseUnit: "adet", bulkUnit: "", unitsPerBulkUnit: 0, active: true },
      { id: "weight", name: "Kesirli Ürün", categoryId: "supplies", category: "Yeni Sarf", productCode: "STK-EXPORT-WEIGHT", baseUnit: "kg", bulkUnit: "paket", unitsPerBulkUnit: 2.5, active: true },
      { id: "trash", name: "Silinen Ürün", categoryId: "supplies", category: "Yeni Sarf", productCode: "STK-EXPORT-TRASH", baseUnit: "adet", active: true }
    ],
    locations: [{ id: CAFE, code: "CAFE", type: "cafe", name: "Kafe Deposu", active: true }, { id: GENERAL, code: "GENEL", type: "central", name: "Dış Depo", active: true }],
    balances: [
      { locationId: CAFE, productId: "drink", quantity: 53, criticalThreshold: 5, orderThreshold: 10, targetLevel: 20, revision: 2 },
      { locationId: GENERAL, productId: "drink", quantity: 960, criticalThreshold: 100, orderThreshold: 200, targetLevel: 300, revision: 3 },
      { locationId: CAFE, productId: "single", quantity: 17 },
      { locationId: CAFE, productId: "weight", quantity: 5.125, criticalThreshold: 0.125, orderThreshold: 1.25, targetLevel: 10.125 }
    ],
    locationMigrationVersion: 1
  });
}

const readWorkbook = async (buffer) => { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); return workbook; };

test("stock Excel export: live selected depot, new/zero products, lifecycle, template/dropdowns/formulas and round-trip", async () => {
  const created = stock.createCanonicalStockProduct(fixture(), { name: "Yeni Peçete", baseUnit: "adet" });
  const state = stock.softDeleteStockProduct(created.stockState, "trash", ADMIN).stockState;
  const before = JSON.stringify(state);
  const exported = await stock.exportStockExcelWorkbook(state, CAFE);
  assert.equal(JSON.stringify(state), before, "export does not mutate its input");
  const book = await readWorkbook(exported.buffer);
  const reference = new ExcelJS.Workbook();
  await reference.xlsx.readFile(path.join(__dirname, "../assets/stock-excel-template.xlsx"));
  const parsed = await stock.parseStockExcelWorkbook(exported.buffer);
  assert.equal(parsed.products.length, 4);
  assert.ok(parsed.products.some((item) => item.productName === "Yeni Peçete" && item.baseQuantity === 0));
  assert.ok(!parsed.products.some((item) => item.productName === "Silinen Ürün"));
  assert.ok(parsed.products.every((item) => item.warnings.length === 0));
  const drink = parsed.products.find((item) => item.productCode === "STK-EXPORT-DRINK");
  assert.deepEqual([drink.bulkQuantity, drink.baseQuantity, drink.unitsPerBulkUnit], [2, 5, 24]);
  assert.deepEqual([drink.criticalThreshold, drink.orderThreshold, drink.targetLevel], [5, 10, 20]);
  const single = parsed.products.find((item) => item.productCode === "STK-EXPORT-SINGLE");
  assert.deepEqual([single.bulkUnit, single.unitsPerBulkUnit, single.baseUnit, single.baseQuantity], ["", 0, "adet", 17]);
  const weight = parsed.products.find((item) => item.productCode === "STK-EXPORT-WEIGHT");
  assert.deepEqual([weight.bulkQuantity, weight.baseQuantity, weight.unitsPerBulkUnit], [2, 0.125, 2.5]);
  for (const item of parsed.products) {
    const sheet = book.getWorksheet(item.category);
    const source = reference.getWorksheet(item.category) || reference.worksheets[0];
    assert.deepEqual(sheet.columns.map((column) => column.width), source.columns.map((column) => column.width));
    for (let offset = 0; offset < 8; offset += 1) assert.equal(sheet.getRow(item.sourceRow + offset).height, source.getRow(offset + 1).height);
    for (const column of [1, 2, 3]) assert.deepEqual(sheet.getCell(item.sourceRow + 2, column).dataValidation, source.getCell(3, column).dataValidation);
    assert.equal(sheet.getCell(item.sourceRow, 1).fill.fgColor.argb, source.getCell(1, 1).fill.fgColor.argb);
    assert.equal(sheet.getCell(item.sourceRow + 4, 1).numFmt, source.getCell(5, 1).numFmt);
    for (const [row, column] of [[6, 1], [6, 2], [7, 3]]) {
      const expected = source.getCell(row, column).formula.replace(/([A-Z]+)(\d+)/g, (_, col, n) => `${col}${Number(n) + item.sourceRow - 1}`);
      assert.equal(sheet.getCell(item.sourceRow + row - 1, column).formula, expected);
    }
    assert.equal(sheet.getCell(item.sourceRow + 6, 3).result, Math.round((item.bulkQuantity * item.unitsPerBulkUnit + item.baseQuantity) * 1000) / 1000);
  }
  const codes = book.getWorksheet("Ürün Kodları");
  assert.deepEqual(codes.getRow(1).values, reference.getWorksheet("Ürün Kodları").getRow(1).values);
  assert.ok(codes.getColumn(3).values.includes(created.product.productCode));
  assert.equal(codes.getCell(2, 4).value, "2 koli + 5 adet", "original-stock column uses live values too");
  const imported = stock.applyStockExcelImport(state, parsed, { targetLocationId: CAFE, requestId: "stock-export-roundtrip-0001" }, ADMIN);
  assert.equal(imported.summary.newProducts, 0);
  assert.equal(imported.summary.newCategories, 0);
  assert.equal(imported.summary.changedBalances, 0);
  assert.equal(imported.movements.length, 0);
  for (const old of state.products) {
    const current = imported.stockState.products.find((product) => product.id === old.id);
    for (const key of ["productCode", "baseUnit", "bulkUnit", "unitsPerBulkUnit", "active", "trashed"]) assert.equal(current[key], old[key], `${old.name}: ${key}`);
    for (const location of [CAFE, GENERAL]) {
      const previous = stock.getProductBalance(state, location, old.id);
      const next = stock.getProductBalance(imported.stockState, location, old.id);
      for (const key of ["quantity", "criticalThreshold", "orderThreshold", "targetLevel"]) assert.equal(next[key], previous[key], `${old.name}: ${location}: ${key}`);
    }
  }
  const outside = await stock.parseStockExcelWorkbook((await stock.exportStockExcelWorkbook(state, GENERAL)).buffer);
  assert.equal(outside.products.find((item) => item.productCode === drink.productCode).bulkQuantity, 40);
  const changed = stock.applyStockMovement(state, { productId: "drink", locationId: CAFE, type: "manual_in", quantity: 1, unit: "adet", requestId: "stock-export-new-balance-0001" }, ADMIN);
  const fresh = await stock.parseStockExcelWorkbook((await stock.exportStockExcelWorkbook(changed.stockState, CAFE)).buffer);
  assert.equal(fresh.products.find((item) => item.productCode === drink.productCode).baseQuantity, 6);
});

test("stock Excel export: long, reserved and colliding category names round-trip without duplicate categories", async () => {
  const state = fixture();
  const names = ["Yeni / Kategori [Özel]", "Çok Uzun Yeni Kategori Adının Birinci Devamı", "Çok Uzun Yeni Kategori Adının İkinci Devamı", "Ürün Kodları"];
  names.forEach((name, index) => {
    state.categories.push({ id: `new-${index}`, name, active: true });
    state.products.push({ id: `new-${index}`, name: `Ürün ${index}`, categoryId: `new-${index}`, category: name, productCode: `STK-NEW-${index}`, baseUnit: "adet", active: true });
  });
  const { buffer } = await stock.exportStockExcelWorkbook(state, CAFE);
  const parsed = await stock.parseStockExcelWorkbook(buffer);
  for (const name of names) assert.ok(parsed.categories.includes(name));
  const imported = stock.applyStockExcelImport(state, parsed, { targetLocationId: CAFE, requestId: "stock-export-category-roundtrip" }, ADMIN);
  assert.equal(imported.summary.newProducts, 0);
  assert.equal(imported.summary.newCategories, 0);
  assert.equal(imported.movements.length, 0);
});

test("stock Excel export route: authenticated permissions, selected depot and persistent read-only operation", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-stock-export-"));
  const store = createFileStore(path.join(directory, "store.json"), { bcryptRounds: 4, defaultPanelPassword: crypto.randomUUID(), enableEventLoopMetrics: false });
  await store.ensure();
  await store.update((data) => { data.stockState = fixture(); });
  let actor = ADMIN;
  let capable = true;
  let broadcasts = 0;
  const pass = (req, res, next) => next();
  const app = express();
  registerStockLocationRoutes({ app, store, auth: { requireAdmin: pass, requireRecipe: pass, requireActivePersonel: pass, requirePersonelSection: () => pass },
    requireAdminRequestOrigin: pass, requireAdminOrMainRequestOrigin: pass,
    resolveProcurementActor: async () => actor, hasProcurementCapability: () => capable, broadcastStockUpdate: () => { broadcasts += 1; }
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await store.drain(); store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/procurement/v1/stock/excel/export`;
  const originalFile = await fs.readFile(store.filePath);
  const originalState = JSON.stringify(await store.read());
  store.resetMetrics();
  const response = await fetch(`${endpoint}?targetLocationId=${CAFE}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition"), /attachment;/);
  assert.match(response.headers.get("content-type"), /spreadsheetml.sheet/);
  assert.equal((await stock.parseStockExcelWorkbook(Buffer.from(await response.arrayBuffer()))).products.length, 4);
  assert.equal(JSON.stringify(await store.read()), originalState);
  assert.deepEqual(await fs.readFile(store.filePath), originalFile);
  assert.equal(store.getMetrics().diskWriteCount, 0);
  assert.equal(broadcasts, 0);
  assert.equal((await fetch(endpoint)).status, 422);
  assert.equal((await fetch(`${endpoint}?targetLocationId=total`)).status, 404);
  capable = false;
  assert.equal((await fetch(`${endpoint}?targetLocationId=${CAFE}`)).status, 403);
  capable = true;
  actor = { type: "employee", id: "limited", sectionAccess: { stock: "view" } };
  assert.equal((await fetch(`${endpoint}?targetLocationId=${CAFE}`)).status, 403);
  actor = null;
  assert.equal((await fetch(`${endpoint}?targetLocationId=${CAFE}`)).status, 401);
});
