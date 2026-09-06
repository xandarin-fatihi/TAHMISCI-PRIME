"use strict";

const path = require("node:path");

const TEMPLATE_PATH = path.join(__dirname, "../assets/stock-excel-template.xlsx");
const CODE_SHEET = "Ürün Kodları";
const clone = (value) => value === undefined ? undefined : structuredClone(value);

// The code sheet retains full category names when Excel needs a shortened tab name.
function stockExcelSheetNames(categories) {
  const used = new Set([CODE_SHEET.toLocaleLowerCase("tr-TR")]);
  const names = new Map();
  for (const category of categories) {
    if (names.has(category)) continue;
    const base = String(category).replace(/[\\/*?:\[\]\x00-\x1f]/g, " ").replace(/^'+|'+$/g, "").trim() || "Kategori";
    let name = base.slice(0, 31);
    let suffix = 1;
    while (used.has(name.toLocaleLowerCase("tr-TR"))) {
      const ending = ` (${++suffix})`;
      name = base.slice(0, 31 - ending.length) + ending;
    }
    used.add(name.toLocaleLowerCase("tr-TR"));
    names.set(category, name);
  }
  return names;
}

function copySheetLayout(workbook, source, name) {
  const sheet = workbook.addWorksheet(name, {
    properties: clone(source.properties),
    pageSetup: clone(source.pageSetup),
    headerFooter: clone(source.headerFooter),
    views: clone(source.views)
  });
  sheet.columns = source.columns.map((column) => ({ width: column.width, hidden: column.hidden, style: clone(column.style) }));
  return sheet;
}

function copyRow(source, target, from, to, columns) {
  const sourceRow = source.getRow(from);
  const targetRow = target.getRow(to);
  targetRow.height = sourceRow.height;
  targetRow.hidden = sourceRow.hidden;
  for (let column = 1; column <= columns; column += 1) {
    const sourceCell = source.getCell(from, column);
    const cell = target.getCell(to, column);
    cell.style = clone(sourceCell.style);
    if (Object.keys(sourceCell.dataValidation || {}).length) cell.dataValidation = clone(sourceCell.dataValidation);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    if (sourceCell.formula) {
      const formula = sourceCell.formula.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g,
        (reference, letter, absolute, row) => absolute ? reference : `${letter}${Number(row) + to - from}`);
      cell.value = { formula };
    } else cell.value = clone(sourceCell.value);
  }
}

async function createStockExcelWorkbook(categories) {
  const ExcelJS = require("exceljs");
  const template = new ExcelJS.Workbook();
  await template.xlsx.readFile(TEMPLATE_PATH);
  const codeTemplate = template.getWorksheet(CODE_SHEET);
  const categoryTemplate = template.worksheets.find((sheet) => sheet !== codeTemplate);
  if (!categoryTemplate || !codeTemplate) throw new Error("Stok Excel şablonu eksik.");
  const workbook = new ExcelJS.Workbook();
  workbook.properties = clone(template.properties);
  workbook.calcProperties = { fullCalcOnLoad: true };
  const names = stockExcelSheetNames(categories.map((category) => category.name));
  const codeRows = [];
  for (const category of categories) {
    const source = template.getWorksheet(category.name) || categoryTemplate;
    const sheet = copySheetLayout(workbook, source === codeTemplate ? categoryTemplate : source, names.get(category.name));
    const blockSource = source === codeTemplate ? categoryTemplate : source;
    if (!category.products.length) codeRows.push([category.name, null, null, null]);
    for (const [index, product] of category.products.entries()) {
      const start = index * 8 + 1;
      sheet.mergeCells(`A${start}:C${start}`);
      for (let offset = 0; offset < 8; offset += 1) copyRow(blockSource, sheet, offset + 1, start + offset, 3);
      sheet.getCell(start, 1).value = product.name;
      sheet.getCell(start + 2, 1).value = product.bulkUnit || null;
      sheet.getCell(start + 2, 2).value = product.baseUnit || null;
      sheet.getCell(start + 2, 3).value = product.unitsPerBulkUnit || null;
      sheet.getCell(start + 4, 1).value = product.criticalThreshold;
      sheet.getCell(start + 4, 2).value = product.orderThreshold;
      sheet.getCell(start + 4, 3).value = product.targetLevel;
      sheet.getCell(start + 6, 1).value = product.bulkUnit && product.unitsPerBulkUnit > 0 ? product.bulkQuantity : null;
      sheet.getCell(start + 6, 2).value = product.baseQuantity;
      for (const [column, unit, fallback] of [[1, product.bulkUnit, "Toplu birim"], [2, product.baseUnit, "Temel birim"]]) {
        const cell = sheet.getCell(start + 5, column);
        cell.value = { formula: cell.formula, result: `${unit || fallback} miktarı` };
      }
      const total = sheet.getCell(start + 6, 3);
      total.value = { formula: total.formula, result: product.quantity };
      codeRows.push([category.name, product.name, product.productCode || null, product.quantityDisplay]);
    }
  }
  const codes = copySheetLayout(workbook, codeTemplate, CODE_SHEET);
  copyRow(codeTemplate, codes, 1, 1, 4);
  for (const [index, values] of codeRows.entries()) {
    copyRow(codeTemplate, codes, 2, index + 2, 4);
    codes.getRow(index + 2).values = values;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { createStockExcelWorkbook, stockExcelSheetNames };
