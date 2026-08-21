"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runRoot = path.join(os.tmpdir(), `tahmisci-product-code-e2e-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATA_FILE = path.join(runRoot, "store.json");
process.env.MEDIA_DIR = path.join(runRoot, "media");
process.env.DEFAULT_PANEL_PASSWORD = "Panel123456";
process.env.DEFAULT_RECIPE_PASSWORD = "Recipe123456";
process.env.JWT_SECRET = "product-code-e2e-secret-longer-than-thirty-two-characters";
process.env.COOKIE_SECURE = "false";
process.env.ALLOW_LOCALHOST_ORIGINS = "true";
process.env.NOTIFICATION_WORKERS_ENABLED = "false";

const { app, prepareRuntime, shutdownRuntime, store } = require("../src/server");
const { defaultPricingCatalog } = require("../src/pricing");
const { createFileStore } = require("../src/store/file-store");

let server;
let baseUrl;

test.before(async () => {
  await prepareRuntime();
  await store.update((data) => {
    data.menuState = { settings: {}, categories: [] };
    data.pricing = defaultPricingCatalog();
    data.recipeState = {};
    data.recipeCatalog = [];
    data.stockState = { categories: [], products: [], movements: [] };
    return data;
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await shutdownRuntime(server, { timeoutMs: 2000 });
  await fs.rm(runRoot, { recursive: true, force: true });
});

test("runtime benzersiz productCode Excel -> store -> public menü hattında idempotent ve revision güvenli çalışır", async () => {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  const productCode = `TST-MNU-${suffix}`;
  const unknownCode = `TST-UNK-${suffix}`;
  const categoryName = `E2E KATEGORİ ${suffix}`;
  const originalName = `E2E ÜRÜN ${suffix}`;
  const renamedName = `${originalName} YENİ`;
  const token = await login();
  const staleMenuResponse = await getJson("/api/menu");
  assert.equal(staleMenuResponse.response.status, 200);
  const staleMenuState = structuredClone(staleMenuResponse.body.menuState);
  const stalePricing = structuredClone(staleMenuResponse.body.pricing);
  const stalePublishRevision = (await getJson("/api/admin/publish-state", {
    headers: adminHeaders(token)
  })).body.revision;

  const initialFiles = catalogFiles({
    categoryName,
    productCode,
    productName: originalName,
    prices: { K: 101, O: 202, B: 303 }
  });
  const firstAnalysis = await analyze(token, requestId(suffix, "analyze-first"), initialFiles);
  assert.equal(firstAnalysis.response.status, 201, JSON.stringify(firstAnalysis.body));
  assert.equal(firstAnalysis.body.canApply, true);
  assert.equal(firstAnalysis.body.report.duplicateProductCodes, 0);
  assert.equal(firstAnalysis.body.report.orphanProductCodes, 0);

  const firstApplyId = requestId(suffix, "apply-first");
  const firstApply = await apply(token, firstApplyId, firstAnalysis.body);
  assert.equal(firstApply.response.status, 200, JSON.stringify(firstApply.body));
  assert.deepEqual(new Set(firstApply.body.changedScopes), new Set(["menu", "pricing"]));
  const revisionAfterFirstApply = firstApply.body.revision;
  const publishAfterFirstApply = firstApply.body.publishRevision;

  const firstPersisted = await openPersistedStore();
  const firstMatches = productsByCode(firstPersisted, productCode);
  assert.equal(firstMatches.length, 1, "ilk atomik apply aynı kod için tek kalıcı ürün oluşturmalı");
  const stableProductId = firstMatches[0].id;
  assert.deepEqual(activePrices(firstMatches[0]), [101, 202, 303]);

  const menuAfterFirstApply = await getJson("/api/menu");
  assert.equal(menuAfterFirstApply.response.status, 200);
  const apiMatches = menuProductsByCode(menuAfterFirstApply.body, productCode);
  assert.equal(apiMatches.length, 1, "/api/menu yeni kodlu ürünü tek kayıt olarak yayınlamalı");
  assert.ok(apiMatches[0].pricing && Array.isArray(apiMatches[0].pricing.families));
  assert.deepEqual(activePrices(apiMatches[0]), [101, 202, 303]);

  await assertPublicPrices(productCode, [101, 202, 303], 101);

  const replay = await apply(token, firstApplyId, firstAnalysis.body);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.operationId, firstApply.body.operationId);
  assert.equal(replay.body.revision, revisionAfterFirstApply);
  assert.equal(replay.body.publishRevision, publishAfterFirstApply);
  assert.equal(productsByCode(await openPersistedStore(), productCode).length, 1);

  const unchanged = await analyze(token, requestId(suffix, "analyze-unchanged"), initialFiles);
  assert.equal(unchanged.response.status, 201, JSON.stringify(unchanged.body));
  assert.equal(unchanged.body.canApply, false);
  assert.equal(unchanged.body.report.changeCount, 0);
  assert.equal(productsByCode(await openPersistedStore(), productCode).length, 1);

  const renameFiles = catalogFiles({
    categoryName,
    productCode,
    productName: renamedName,
    prices: { K: 101, O: 202, B: 303 }
  });
  const renameAnalysis = await analyze(token, requestId(suffix, "analyze-rename"), renameFiles);
  assert.equal(renameAnalysis.response.status, 201, JSON.stringify(renameAnalysis.body));
  assert.equal(renameAnalysis.body.canApply, true);
  const renameApply = await apply(token, requestId(suffix, "apply-rename"), renameAnalysis.body);
  assert.equal(renameApply.response.status, 200, JSON.stringify(renameApply.body));
  const renamedMatches = productsByCode(await openPersistedStore(), productCode);
  assert.equal(renamedMatches.length, 1);
  assert.equal(renamedMatches[0].id, stableProductId, "ad değişikliği ürün kimliğini değiştirmemeli");
  assert.equal(renamedMatches[0].name, renamedName);
  assert.ok((renamedMatches[0].nameHistory || []).includes(originalName));

  const priceOnlyFiles = {
    pricing: workbookFile("TAHMISCI-FIYAT.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "K", "O", "B"],
        [renamedName, productCode, 119, 229, 339]
      ]
    })
  };
  const priceAnalysis = await analyze(token, requestId(suffix, "analyze-price-only"), priceOnlyFiles);
  assert.equal(priceAnalysis.response.status, 201, JSON.stringify(priceAnalysis.body));
  assert.equal(priceAnalysis.body.canApply, true);
  assert.equal(priceAnalysis.body.report.orphanProductCodes, 0);
  const priceApply = await apply(token, requestId(suffix, "apply-price-only"), priceAnalysis.body);
  assert.equal(priceApply.response.status, 200, JSON.stringify(priceApply.body));
  assert.deepEqual(priceApply.body.changedScopes, ["pricing"]);
  const priceUpdatedMatches = productsByCode(await openPersistedStore(), productCode);
  assert.equal(priceUpdatedMatches.length, 1);
  assert.equal(priceUpdatedMatches[0].id, stableProductId);
  assert.deepEqual(activePrices(priceUpdatedMatches[0]), [119, 229, 339]);
  await assertPublicPrices(productCode, [119, 229, 339], 119);

  const duplicateFiles = {
    menu: workbookFile("TAHMISCI-MENU.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "Ürün İçeriği"],
        [renamedName, productCode, "İçerik A"],
        [`${renamedName} İKİNCİ`, productCode.toLowerCase(), "İçerik B"]
      ]
    })
  };
  const duplicateAnalysis = await analyze(token, requestId(suffix, "analyze-duplicate"), duplicateFiles);
  assert.equal(duplicateAnalysis.response.status, 201, JSON.stringify(duplicateAnalysis.body));
  assert.equal(duplicateAnalysis.body.canApply, false);
  assert.ok(duplicateAnalysis.body.issues.some((issue) => issue.code === "duplicate_product_code"));
  assert.equal(productsByCode(await openPersistedStore(), productCode).length, 1);

  const duplicatePriceOptionFiles = {
    pricing: workbookFile("TAHMISCI-FIYAT.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "K", " k "],
        [renamedName, productCode, 888, 999]
      ]
    })
  };
  const duplicatePriceOption = await analyze(token, requestId(suffix, "analyze-duplicate-option"), duplicatePriceOptionFiles);
  assert.equal(duplicatePriceOption.response.status, 201, JSON.stringify(duplicatePriceOption.body));
  assert.equal(duplicatePriceOption.body.canApply, false);
  assert.ok(duplicatePriceOption.body.issues.some((issue) => issue.code === "duplicate_price_option"));
  assert.deepEqual(activePrices(productsByCode(await openPersistedStore(), productCode)[0]), [119, 229, 339]);

  const unknownFiles = {
    pricing: workbookFile("TAHMISCI-FIYAT.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "Standart"],
        [`E2E BİLİNMEYEN ${suffix}`, unknownCode, 777]
      ]
    })
  };
  const unknownAnalysis = await analyze(token, requestId(suffix, "analyze-unknown"), unknownFiles);
  assert.equal(unknownAnalysis.response.status, 201, JSON.stringify(unknownAnalysis.body));
  assert.equal(unknownAnalysis.body.canApply, false);
  assert.ok(unknownAnalysis.body.issues.some((issue) => issue.code === "unknown_product_code"));
  assert.equal(productsByCode(await openPersistedStore(), unknownCode).length, 0);

  const pendingCode = `TST-PND-${suffix}`;
  const pendingName = `E2E FİYAT BEKLEYEN ${suffix}`;
  const menuOnlyFiles = {
    menu: workbookFile("TAHMISCI-MENU.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "Ürün İçeriği"],
        [renamedName, productCode, "Mevcut fiyat korunur"],
        [pendingName, pendingCode, "Fiyat dosyası bekleniyor"]
      ]
    })
  };
  const menuOnlyAnalysis = await analyze(token, requestId(suffix, "analyze-menu-only"), menuOnlyFiles);
  assert.equal(menuOnlyAnalysis.response.status, 201, JSON.stringify(menuOnlyAnalysis.body));
  assert.equal(menuOnlyAnalysis.body.canApply, true);
  assert.ok(menuOnlyAnalysis.body.report.pricePendingProducts > 0);
  assert.ok(menuOnlyAnalysis.body.issues.some((issue) => issue.code === "price_pending" && issue.severity === "warning"));
  const menuOnlyApply = await apply(token, requestId(suffix, "apply-menu-only"), menuOnlyAnalysis.body);
  assert.equal(menuOnlyApply.response.status, 200, JSON.stringify(menuOnlyApply.body));
  const afterMenuOnly = await openPersistedStore();
  const pendingMatches = productsByCode(afterMenuOnly, pendingCode);
  assert.equal(pendingMatches.length, 1);
  assert.equal(pendingMatches[0].pricePending, true);
  assert.equal(pendingMatches[0].pricingStatus, "pending");
  assert.deepEqual(activePrices(productsByCode(afterMenuOnly, productCode)[0]), [119, 229, 339], "menü-only aktarım mevcut fiyatı silmemeli");

  const staleMenuPut = await putJson("/api/menu", {
    token,
    requestId: requestId(suffix, "menu-put-stale"),
    body: {
      expectedRevision: stalePublishRevision,
      menuState: staleMenuState,
      pricing: stalePricing
    }
  });
  assert.equal(staleMenuPut.response.status, 409, JSON.stringify(staleMenuPut.body));
  assert.equal(productsByCode(await openPersistedStore(), productCode).length, 1, "eski Yönetici taslağı importu ezmemeli");

  const stalePublish = await postJson("/api/admin/publish", {
    token,
    requestId: requestId(suffix, "publish-stale"),
    body: {
      expectedRevision: stalePublishRevision,
      changes: { panelConfig: {} }
    }
  });
  assert.equal(stalePublish.response.status, 409, JSON.stringify(stalePublish.body));
  assert.equal(stalePublish.body.code, "REVISION_CONFLICT");
});

function catalogFiles({ categoryName, productCode, productName, prices }) {
  return {
    menu: workbookFile("TAHMISCI-MENU.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "Ürün Kalorisi", "Ürün Alerjeni", "Ürün İçeriği"],
        [productName, productCode, "123 kcal", "Süt", "E2E içerik"]
      ]
    }),
    pricing: workbookFile("TAHMISCI-FIYAT.xlsx", {
      [categoryName]: [
        ["Ürün Adı", "Ürün Kodu", "K", "O", "B"],
        [productName, productCode, prices.K, prices.O, prices.B]
      ]
    })
  };
}

async function login() {
  const result = await postJson("/api/admin/login", {
    body: { password: "Panel123456" }
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.ok(result.body.token);
  return result.body.token;
}

async function analyze(token, id, files) {
  return postJson("/api/admin/data-imports/analyze", {
    token,
    requestId: id,
    body: { files }
  });
}

async function apply(token, id, analysis) {
  return postJson("/api/admin/data-imports/apply", {
    token,
    requestId: id,
    body: {
      analysisId: analysis.analysisId,
      expectedRevision: analysis.expectedRevision,
      confirmArchiveImpact: analysis.report && analysis.report.requiresArchiveConfirmation === true
    }
  });
}

async function assertPublicPrices(productCode, expectedPrices, expectedBasePrice) {
  const result = await getJson("/api/public/bootstrap");
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const matches = (result.body.menu && result.body.menu.products || [])
    .filter((product) => product.productCode === productCode);
  assert.equal(matches.length, 1, "public bootstrap aynı kod için tek ürün döndürmeli");
  assert.deepEqual(matches[0].priceOptions.map((option) => option.price).sort(numberSort), expectedPrices);
  assert.equal(matches[0].basePrice, expectedBasePrice);
  assert.notEqual(matches[0].priceLabel, "");
  assert.notEqual(matches[0].priceLabel, "-");
}

async function openPersistedStore() {
  const reopened = createFileStore(process.env.DATA_FILE, {
    defaultPanelPassword: "Panel123456",
    defaultRecipePassword: "Recipe123456",
    bcryptRounds: 10
  });
  return reopened.read();
}

function productsByCode(data, productCode) {
  return (data.menuState && data.menuState.categories || [])
    .flatMap((category) => category.products || [])
    .filter((product) => String(product.productCode || "").trim().toUpperCase() === productCode);
}

function menuProductsByCode(body, productCode) {
  return (body.menuState && body.menuState.categories || [])
    .flatMap((category) => category.products || [])
    .filter((product) => String(product.productCode || "").trim().toUpperCase() === productCode);
}

function activePrices(product) {
  return (product.pricing && product.pricing.families || [])
    .flatMap((family) => Object.values(family.values || {}))
    .filter((value) => value && value.active !== false && Number.isFinite(Number(value.price)))
    .map((value) => Number(value.price))
    .sort(numberSort);
}

function numberSort(first, second) {
  return first - second;
}

function requestId(suffix, action) {
  return `pc-e2e-${action}-${suffix}`.slice(0, 150);
}

function adminHeaders(token, requestIdValue = "") {
  const headers = { "Content-Type": "application/json", Origin: baseUrl };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (requestIdValue) {
    headers["X-Request-ID"] = requestIdValue;
    headers["Idempotency-Key"] = requestIdValue;
  }
  return headers;
}

async function getJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

async function postJson(pathname, { token = "", requestId: requestIdValue = "", body = {} } = {}) {
  if (requestIdValue && body.requestId === undefined) body = { ...body, requestId: requestIdValue };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: adminHeaders(token, requestIdValue),
    body: JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function putJson(pathname, { token = "", requestId: requestIdValue = "", body = {} } = {}) {
  if (requestIdValue && body.requestId === undefined) body = { ...body, requestId: requestIdValue };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "PUT",
    headers: adminHeaders(token, requestIdValue),
    body: JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

function workbookFile(filename, sheets) {
  return {
    filename,
    contentBase64: createWorkbookBuffer(sheets).toString("base64")
  };
}

function createWorkbookBuffer(sheetDefinitions) {
  const names = Object.keys(sheetDefinitions);
  const entries = {
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_name, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`
  };
  names.forEach((name, index) => {
    const rows = sheetDefinitions[name].map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.map((value, columnIndex) => cellXml(columnIndex, rowIndex, value)).join("")}</row>`).join("");
    entries[`xl/worksheets/sheet${index + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  return createStoredZip(entries);
}

function cellXml(columnIndex, rowIndex, value) {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
  if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [entryName, rawContent] of Object.entries(entries)) {
    const filename = Buffer.from(entryName);
    const content = Buffer.from(rawContent);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
