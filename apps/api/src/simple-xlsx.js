"use strict";

const zlib = require("zlib");
const MAX_ZIP_ENTRIES = 5000;
const MAX_XML_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 128 * 1024 * 1024;
const FORMULA_VALUE_MISSING = "__TAHMISCI_XLSX_FORMULA_VALUE_MISSING__";

function readWorkbook(buffer) {
  const { files, sharedStrings, sheets } = readWorkbookParts(buffer);
  const result = { SheetNames: [], Sheets: {} };

  sheets.forEach((sheet) => {
    const xml = files.get(sheet.path);
    if (!xml) return;
    result.SheetNames.push(sheet.name);
    result.Sheets[sheet.name] = parseSheetRows(xml, sharedStrings);
  });

  return result;
}

function readWorkbookCells(buffer) {
  const { files, sharedStrings, sheets } = readWorkbookParts(buffer);
  const result = { SheetNames: [], Sheets: {}, worksheets: [] };

  sheets.forEach((sheet) => {
    const xml = files.get(sheet.path);
    if (!xml) return;
    const grid = parseSheetGrid(xml, sharedStrings);
    const worksheet = {
      name: sheet.name,
      actualRowCount: grid.actualRowCount,
      getCell(row, column) {
        const rowIndex = Math.trunc(Number(row)) - 1;
        const columnIndex = Math.trunc(Number(column)) - 1;
        return {
          value: rowIndex >= 0 && columnIndex >= 0 && grid.rows[rowIndex]
            ? grid.rows[rowIndex][columnIndex] ?? ""
            : ""
        };
      }
    };
    result.SheetNames.push(sheet.name);
    result.Sheets[sheet.name] = worksheet;
    result.worksheets.push(worksheet);
  });

  return result;
}

function readWorkbookParts(buffer) {
  const input = Buffer.from(buffer || []);
  if (input.length < 4 || input.readUInt32LE(0) !== 0x04034b50) throw new Error("XLSX dosya imzası geçersiz.");
  const files = readZipFiles(input);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml") || "");
  const rels = parseWorkbookRels(files.get("xl/_rels/workbook.xml.rels") || "");
  const sheets = parseWorkbookSheets(files.get("xl/workbook.xml") || "", rels);
  return { files, sharedStrings, sheets };
}

function sheetToJson(sheet) {
  if (Array.isArray(sheet)) return sheet;
  return [];
}

function readZipFiles(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("XLSX merkezi dizini bulunamadı.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error("XLSX çok fazla arşiv kaydı içeriyor.");
  if (centralOffset >= eocdOffset) throw new Error("XLSX merkezi dizin konumu geçersiz.");
  const files = new Map();
  let offset = centralOffset;
  let expandedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) throw new Error("XLSX merkezi dizin sınırı geçersiz.");
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("XLSX merkezi dizin kaydı bozuk.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (offset + 46 + fileNameLength + extraLength + commentLength > buffer.length) throw new Error("XLSX arşiv kaydı sınırı geçersiz.");
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength).replace(/\\/g, "/");
    if (!isSafeZipEntryName(name)) throw new Error("XLSX arşivinde güvenli olmayan dosya yolu bulundu.");
    if (isRequiredXmlEntry(name)) {
      if (uncompressedSize > MAX_XML_ENTRY_BYTES) throw new Error("XLSX XML kaydı izin verilen boyutu aşıyor.");
      expandedBytes += uncompressedSize;
      if (expandedBytes > MAX_TOTAL_XML_BYTES) throw new Error("XLSX açılmış içerik boyutu güvenli sınırı aşıyor.");
      const content = extractLocalFile(buffer, localOffset, method, compressedSize, uncompressedSize);
      files.set(name, content.toString("utf8"));
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function extractLocalFile(buffer, offset, method, compressedSize, uncompressedSize) {
  if (offset + 30 > buffer.length) throw new Error("XLSX lokal dosya sınırı geçersiz.");
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("XLSX lokal dosya başlığı bozuk.");
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  if (dataOffset + compressedSize > buffer.length) throw new Error("XLSX sıkıştırılmış veri sınırı geçersiz.");
  const data = buffer.subarray(dataOffset, dataOffset + compressedSize);
  let content;
  if (method === 0) content = data;
  else if (method === 8) content = zlib.inflateRawSync(data, { maxOutputLength: MAX_XML_ENTRY_BYTES });
  else throw new Error(`Desteklenmeyen XLSX sıkıştırma yöntemi: ${method}`);
  if (content.length !== uncompressedSize) throw new Error("XLSX açılmış veri boyutu arşiv kaydıyla uyuşmuyor.");
  return content;
}

function isSafeZipEntryName(name) {
  const value = String(name || "");
  return Boolean(value) && !value.includes("\0") && !value.startsWith("/") && !value.split("/").includes("..");
}

function isRequiredXmlEntry(name) {
  return name === "xl/sharedStrings.xml"
    || name === "xl/workbook.xml"
    || name === "xl/_rels/workbook.xml.rels"
    || /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:[\w-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?si>/g)].map((match) => {
    return [...match[1].matchAll(/<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/g)]
      .map((item) => decodeXml(item[1]))
      .join("");
  });
}

function parseWorkbookRels(xml) {
  const rels = new Map();
  [...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].forEach((match) => {
    const attrs = parseAttributes(match[1]);
    if (!attrs.Id || !attrs.Target) return;
    const target = attrs.Target.startsWith("/") ? attrs.Target.slice(1) : `xl/${attrs.Target}`.replace(/\/[^/]+\/\.\.\//g, "/");
    rels.set(attrs.Id, target.replace(/\\/g, "/"));
  });
  return rels;
}

function parseWorkbookSheets(xml, rels) {
  return [...xml.matchAll(/<(?:[\w-]+:)?sheet\b([^>]*)\/?>/g)].map((match, index) => {
    const attrs = parseAttributes(match[1]);
    const relId = attrs["r:id"] || attrs.id || "";
    const fallbackPath = `xl/worksheets/sheet${index + 1}.xml`;
    return {
      name: decodeXml(attrs.name || `Sayfa ${index + 1}`),
      path: rels.get(relId) || fallbackPath
    };
  });
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowMatches = [...xml.matchAll(/<(?:[\w-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?row>/g)];
  const table = rowMatches.map((row) => {
    const values = [];
    [...row[1].matchAll(/<(?:[\w-]+:)?c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:[\w-]+:)?c>)/g)].forEach((cell) => {
      const attrs = parseAttributes(cell[1]);
      const columnIndex = columnToIndex((attrs.r || "").replace(/\d+/g, ""));
      values[columnIndex] = readCellValue(attrs, cell[2] || "", sharedStrings);
    });
    return values;
  });
  const headers = (table.shift() || []).map((value) => String(value || "").trim());
  rows.headers = headers;
  table.forEach((values) => {
    const row = {};
    const cells = [];
    headers.forEach((header, index) => {
      if (!header || ["__proto__", "prototype", "constructor"].includes(header.toLowerCase())) return;
      cells.push({ header, value: values[index] === undefined ? "" : values[index], columnIndex: index });
      row[header] = values[index] === undefined ? "" : values[index];
    });
    // Keep the ordinary row object backward compatible while retaining
    // positional cells for duplicate-column validation (for example two
    // "100 GR" price columns).  Non-enumerable metadata cannot leak into API
    // payloads or normal Object.entries consumers.
    Object.defineProperty(row, "__xlsxCells", {
      value: cells,
      enumerable: false,
      configurable: false,
      writable: false
    });
    if (Object.values(row).some((value) => String(value || "").trim())) rows.push(row);
  });
  return rows;
}

function parseSheetGrid(xml, sharedStrings) {
  const rows = [];
  let actualRowCount = 0;
  let nextRowNumber = 1;
  const rowMatches = [...xml.matchAll(/<(?:[\w-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?row>/g)];
  rowMatches.forEach((rowMatch) => {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const explicitRowNumber = Number(rowAttrs.r);
    const rowNumber = Number.isInteger(explicitRowNumber) && explicitRowNumber > 0 ? explicitRowNumber : nextRowNumber;
    const values = [];
    let nextColumnIndex = 0;
    [...rowMatch[2].matchAll(/<(?:[\w-]+:)?c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:[\w-]+:)?c>)/g)].forEach((cell) => {
      const attrs = parseAttributes(cell[1]);
      const reference = String(attrs.r || "").match(/[A-Za-z]+/);
      const columnIndex = reference ? columnToIndex(reference[0]) : nextColumnIndex;
      values[columnIndex] = readCellValue(attrs, cell[2] || "", sharedStrings);
      nextColumnIndex = columnIndex + 1;
    });
    rows[rowNumber - 1] = values;
    actualRowCount = Math.max(actualRowCount, rowNumber);
    nextRowNumber = rowNumber + 1;
  });
  return { rows, actualRowCount };
}

function readCellValue(attrs, body, sharedStrings) {
  const inline = body.match(/<(?:[\w-]+:)?is\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?is>/);
  if (inline) {
    return [...inline[1].matchAll(/<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/g)].map((item) => decodeXml(item[1])).join("");
  }
  const valueMatch = body.match(/<(?:[\w-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?v>/);
  if (/<(?:[\w-]+:)?f\b/i.test(body) && !valueMatch) {
    return FORMULA_VALUE_MISSING;
  }
  const value = valueMatch ? valueMatch[1] : "";
  if (attrs.t === "s") return sharedStrings[Number(value)] || "";
  if (attrs.t === "str") return decodeXml(value);
  return decodeXml(value);
}

function parseAttributes(text) {
  const attrs = Object.create(null);
  [...String(text || "").matchAll(/([:\w-]+)="([^"]*)"/g)].forEach((match) => {
    attrs[match[1]] = decodeXml(match[2]);
  });
  return attrs;
}

function columnToIndex(column) {
  const text = String(column || "").toUpperCase();
  let result = 0;
  for (let index = 0; index < text.length; index += 1) {
    result = result * 26 + (text.charCodeAt(index) - 64);
  }
  return Math.max(0, result - 1);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(parseInt(code, 10)));
}

module.exports = { FORMULA_VALUE_MISSING, parseSheetGrid, parseSheetRows, readWorkbook, readWorkbookCells, sheetToJson };
