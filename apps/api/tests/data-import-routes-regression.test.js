"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");

const { registerDataImportRoutes } = require("../src/data-import-routes");
const { catalogFingerprint, importRevision } = require("../src/data-import");
const { defaultStore, normalizeStore } = require("../src/store/file-store");

function createMemoryStore(initialState) {
  let state = normalizeStore(structuredClone(initialState));
  let corruptNextReadback = false;
  let rollbackCount = 0;

  return {
    async read() {
      const readback = structuredClone(state);
      if (corruptNextReadback) {
        corruptNextReadback = false;
        const categories = readback.menuState && Array.isArray(readback.menuState.categories)
          ? readback.menuState.categories
          : [];
        if (categories[0] && categories[0].products && categories[0].products[0]) {
          categories[0].products[0].name = `${categories[0].products[0].name} / BOZUK READBACK`;
        } else {
          categories.push({ id: "readback-corruption", name: "Bozuk Readback", active: true, order: 0, products: [] });
        }
      }
      return readback;
    },
    async update(mutator) {
      const failedBefore = new Set((state.dataImportHistory || [])
        .filter((item) => item.status === "failed_readback")
        .map((item) => item.id));
      const next = normalizeStore(await mutator(structuredClone(state)));
      const failedAfter = (next.dataImportHistory || [])
        .filter((item) => item.status === "failed_readback" && !failedBefore.has(item.id));
      if (failedAfter.length) rollbackCount += 1;
      state = next;
      return structuredClone(state);
    },
    armReadbackMismatch() {
      corruptNextReadback = true;
    },
    snapshot() {
      return structuredClone(state);
    },
    get rollbackCount() {
      return rollbackCount;
    }
  };
}

async function startImportApp(store) {
  const app = express();
  app.use(express.json({ limit: "82mb" }));
  registerDataImportRoutes({
    app,
    store,
    auth: {
      requireAdmin(req, _res, next) {
        req.admin = { sessionId: "canonical-import-test-admin" };
        next();
      }
    },
    requireAdminRequestOrigin(_req, _res, next) {
      next();
    }
  });
  app.use((error, _req, res, _next) => {
    res.status(Number(error && error.status) || 500).json({ ok: false, message: String(error && error.message || "Sunucu hatası") });
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

function menuFilePayload() {
  const content = createMenuWorkbookBuffer();
  return {
    menu: {
      filename: "TAHMISCI-MENU.xlsx",
      contentBase64: content.toString("base64")
    }
  };
}

function createMenuWorkbookBuffer() {
  const cells = [
    ["Ürün Adı", "Ürün Kodu", "Ürün Kalorisi", "Ürün Alerjeni", "Ürün İçeriği"],
    ["Kanonik Latte", "SIC-KAN-001", "120 kcal", "Süt", "Espresso ve süt"]
  ];
  const rows = cells.map((values, rowIndex) => {
    const content = values.map((value, columnIndex) => {
      const reference = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${content}</row>`;
  }).join("");
  return createStoredZip({
    "xl/workbook.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"SICAKLAR\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
  });
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name, "utf8");
    const content = Buffer.from(value, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
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
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function requestHeaders(requestId) {
  return {
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
    "Idempotency-Key": requestId
  };
}

async function analyzeMenu(baseUrl, requestId, files) {
  return requestJson(baseUrl, "/api/admin/data-imports/analyze", {
    method: "POST",
    headers: requestHeaders(requestId),
    body: JSON.stringify({ requestId, files })
  });
}

async function applyAnalysis(baseUrl, requestId, analysis) {
  return requestJson(baseUrl, "/api/admin/data-imports/apply", {
    method: "POST",
    headers: requestHeaders(requestId),
    body: JSON.stringify({
      requestId,
      analysisId: analysis.analysisId,
      expectedRevision: analysis.expectedRevision,
      confirmArchiveImpact: analysis.report && analysis.report.requiresArchiveConfirmation === true
    })
  });
}

test("boş katalog ilk menü analiz/apply işlemini tek revision ile uygular; aynı workbook ikinci analizde değişiklik üretmez", async (t) => {
  const store = createMemoryStore(defaultStore("test-hash", "test-recipe-hash"));
  const runtime = await startImportApp(store);
  t.after(runtime.close);
  const files = menuFilePayload();
  const before = store.snapshot();

  const first = await analyzeMenu(runtime.baseUrl, "canonical-menu-analyze-0001", files);
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.canApply, true);
  assert.ok(first.body.report.newCategories > 0);
  assert.ok(first.body.report.newProducts > 0);

  const applied = await applyAnalysis(runtime.baseUrl, "canonical-menu-apply-0001", first.body);
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.revision, importRevision(before) + 1, "apply yalnız bir dataImport revision artırmalı");

  const persisted = store.snapshot();
  assert.equal(importRevision(persisted), importRevision(before) + 1);
  const matchingHistory = (persisted.dataImportHistory || []).filter((item) => item.id === applied.body.operationId);
  assert.equal(matchingHistory.length, 1, "apply için tek history kaydı yazılmalı");
  assert.equal(matchingHistory[0].status, "applied");
  assert.equal(matchingHistory[0].revisionBefore, importRevision(before));
  assert.equal(matchingHistory[0].revisionAfter, importRevision(before) + 1);
  const firstProductIds = persisted.menuState.categories.flatMap((category) => category.products || []).map((product) => product.id).sort();

  const second = await analyzeMenu(runtime.baseUrl, "canonical-menu-analyze-0002", files);
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.canApply, false);
  assert.equal(second.body.report.newCategories, 0);
  assert.equal(second.body.report.newProducts, 0);
  assert.equal(second.body.report.updatedProducts, 0);
  assert.equal(second.body.changes.length, 0);
  assert.ok(second.body.report.unchanged >= first.body.report.newProducts);

  const afterSecondAnalysis = store.snapshot();
  assert.equal(importRevision(afterSecondAnalysis), importRevision(before) + 1, "analiz revision artırmamalı");
  const unchangedAudits = (afterSecondAnalysis.dataImportHistory || [])
    .filter((item) => item.kind === "analyze" && item.analysisId === second.body.analysisId);
  assert.equal(unchangedAudits.length, 1, "değişikliksiz analiz tek audit kaydı üretmeli");
  assert.equal(unchangedAudits[0].status, "unchanged");
  assert.equal(unchangedAudits[0].revisionBefore, importRevision(before) + 1);
  assert.equal(unchangedAudits[0].revisionAfter, importRevision(before) + 1);
  assert.deepEqual(
    afterSecondAnalysis.menuState.categories.flatMap((category) => category.products || []).map((product) => product.id).sort(),
    firstProductIds,
    "aynı workbook mevcut ürün kimliklerini değiştirmemeli"
  );

  const secondReplay = await analyzeMenu(runtime.baseUrl, "canonical-menu-analyze-0002", files);
  assert.equal(secondReplay.response.status, 200);
  assert.equal(secondReplay.body.analysisId, second.body.analysisId);
  const replayState = store.snapshot();
  assert.equal(
    (replayState.dataImportHistory || []).filter((item) => item.kind === "analyze" && item.analysisId === second.body.analysisId).length,
    1,
    "idempotent analiz replay audit kaydını çoğaltmamalı"
  );
  assert.equal(importRevision(replayState), importRevision(before) + 1);
});

test("persisted readback uyuşmazlığı audit bırakır, yalnız bir rollback yapar ve önceki katalog/revision'a döner", async (t) => {
  const store = createMemoryStore(defaultStore("test-hash", "test-recipe-hash"));
  const runtime = await startImportApp(store);
  t.after(runtime.close);
  const files = menuFilePayload();
  const baseline = store.snapshot();
  const baselineRevision = importRevision(baseline);
  const baselinePublishRevision = Number(baseline.revisions && baseline.revisions.publish || 0);
  const baselineFingerprint = catalogFingerprint(baseline, ["menu"]);

  const analyzed = await analyzeMenu(runtime.baseUrl, "mismatch-menu-analyze-0001", files);
  assert.equal(analyzed.response.status, 201, JSON.stringify(analyzed.body));
  assert.equal(analyzed.body.canApply, true);

  store.armReadbackMismatch();
  const failed = await applyAnalysis(runtime.baseUrl, "mismatch-menu-apply-0001", analyzed.body);
  assert.equal(failed.response.status, 500, JSON.stringify(failed.body));
  assert.match(failed.body.message, /doğrulaması başarısız|geri yüklendi/i);

  const after = store.snapshot();
  assert.equal(store.rollbackCount, 1, "readback uyuşmazlığı yalnız bir rollback yazımı üretmeli");
  assert.equal(importRevision(after), baselineRevision, "başarısız apply dataImport revision'ını geri getirmeli");
  assert.equal(Number(after.revisions && after.revisions.publish || 0), baselinePublishRevision, "publish revision geri gelmeli");
  assert.equal(catalogFingerprint(after, ["menu"]), baselineFingerprint, "önceki menü kataloğu eksiksiz geri gelmeli");
  assert.deepEqual(after.menuState.categories, baseline.menuState.categories);

  const failedAudits = (after.dataImportHistory || []).filter((item) => item.status === "failed_readback");
  assert.equal(failedAudits.length, 1, "tek mismatch audit kaydı korunmalı");
  assert.equal(failedAudits[0].rollbackApplied, true);
  assert.equal(failedAudits[0].rollbackVerified, true);
  assert.equal(failedAudits[0].validationDetails.importId, failedAudits[0].id);
  assert.equal(failedAudits[0].validationDetails.valid, false);
  assert.equal(failedAudits[0].validationDetails.validationStatus, "failed");
  assert.equal(failedAudits[0].validationDetails.catalogMatches, false);
  assert.ok(failedAudits[0].validationDetails.committedFingerprint);
  assert.ok(failedAudits[0].validationDetails.persistedFingerprint);
  assert.notEqual(failedAudits[0].validationDetails.committedFingerprint, failedAudits[0].validationDetails.persistedFingerprint);
  assert.equal((after.dataImportIdempotency || []).some((item) => item.requestId === "mismatch-menu-apply-0001"), false);
});
