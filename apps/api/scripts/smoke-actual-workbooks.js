"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { analyzeDataImport } = require("../src/data-import");
const { readWorkbook } = require("../src/simple-xlsx");
const { defaultStore } = require("../src/store/file-store");

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error("Workbook klasörü zorunludur.");

const names = {
  menu: "TAHMISCI-MENU-KODLU.xlsx",
  pricing: "TAHMISCI-FIYAT-KODLU.xlsx",
  recipe: "TAHMISCI-RECETE-KODLU.xlsx",
  stock: "TAHMISCI-STOK-KODLU.xlsx",
};
const workbooks = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, readWorkbook(fs.readFileSync(path.join(sourceDir, name)))]));
const analysis = analyzeDataImport(defaultStore("test-admin", "test-recipe"), { workbooks, files: {} }, {
  analysisId: "actual-workbook-smoke-20260812",
  now: "2026-08-12T12:00:00.000Z",
});
const result = {
  domains: analysis.domains,
  report: analysis.report,
  issues: analysis.issues,
  changes: analysis.changes.length,
};
console.log(JSON.stringify(result, null, 2));
if (!analysis.domains.catalog.canApply || !analysis.domains.recipes.canApply || !analysis.domains.stock.canApply) process.exitCode = 1;
