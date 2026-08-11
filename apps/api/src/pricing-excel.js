"use strict";

const {
  normalizePricingCatalog,
  normalizeProductPricing,
  withLegacyPricing
} = require("./pricing");

const PRODUCT_HEADER_ALIASES = new Set(["urun adi", "urun", "product name", "product"]);
const TYPE_ALIASES = new Map([
  ["k", { typeId: "size", optionId: "small", optionLabel: "Küçük" }],
  ["kucuk", { typeId: "size", optionId: "small", optionLabel: "Küçük" }],
  ["o", { typeId: "size", optionId: "medium", optionLabel: "Orta" }],
  ["orta", { typeId: "size", optionId: "medium", optionLabel: "Orta" }],
  ["b", { typeId: "size", optionId: "large", optionLabel: "Büyük" }],
  ["buyuk", { typeId: "size", optionId: "large", optionLabel: "Büyük" }],
  ["single", { typeId: "shot", optionId: "single", optionLabel: "Single" }],
  ["double", { typeId: "shot", optionId: "double", optionLabel: "Double" }],
  ["standart", { typeId: "standard", optionId: "standard", optionLabel: "Standart" }],
  ["standard", { typeId: "standard", optionId: "standard", optionLabel: "Standart" }]
]);
const WEIGHT_TYPE_NAMES = new Set(["gramaj", "agirlik", "weight"]);

function normalizeAnalysisOptions(value, pricing) {
  const source = isRecord(value) ? value : {};
  const blankPolicy = ["preserve", "clear", "deactivate", "error"].includes(String(source.blankPolicy || ""))
    ? String(source.blankPolicy)
    : "preserve";
  const typeById = new Map(normalizePricingCatalog(pricing).types.map((type) => [type.id, type]));
  const mappings = new Map();
  const rawMappings = isRecord(source.columnMapping) ? source.columnMapping : {};
  for (const [header, rawMapping] of Object.entries(rawMappings)) {
    if (!isRecord(rawMapping)) continue;
    if (rawMapping.ignore === true) {
      mappings.set(normalizeMatchText(header), { ignore: true });
      continue;
    }
    const typeId = String(rawMapping.typeId || "").trim();
    const optionId = String(rawMapping.optionId || "").trim();
    const type = typeById.get(typeId);
    const option = type && type.options.find((item) => item.id === optionId);
    if (!type || !option) throw clientError(400, `Excel sütun eşlemesi geçersiz: ${header}`);
    mappings.set(normalizeMatchText(header), {
      typeId,
      optionId,
      optionLabel: option.label,
      family: typeId
    });
  }
  return { blankPolicy, columnMapping: mappings };
}

function analyzePricingWorkbook(workbook, menuStateInput, pricingInput, optionsInput = {}) {
  const menuState = isRecord(menuStateInput) ? menuStateInput : { categories: [] };
  const pricing = normalizePricingCatalog(pricingInput || menuState.pricing);
  const analysisOptions = normalizeAnalysisOptions(optionsInput, pricing);
  const sheetNames = Array.isArray(workbook && workbook.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) throw clientError(400, "Excel dosyasında okunabilir sayfa bulunamadı.");

  const categories = Array.isArray(menuState.categories) ? menuState.categories : [];
  const categoryIndex = indexBy(categories, (category) => normalizeMatchText(category && category.name));
  const report = {
    sheetCount: sheetNames.length,
    productCount: 0,
    matchedProducts: 0,
    unmatchedProducts: 0,
    ambiguousProducts: 0,
    invalidPrices: 0,
    unchangedProducts: 0,
    updatedProductCount: 0,
    updatePriceCount: 0,
    newWeightOptions: 0,
    blankPriceCells: 0,
    clearedPriceCells: 0,
    mixedFamilyRows: 0,
    errorCount: 0,
    errorRowCount: 0,
    canApply: false
  };
  const issues = [];
  const changes = [];
  const productUpdates = [];
  const weightContext = createWeightContext(pricing);
  const columnMapping = [];
  const ignoredColumns = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets && workbook.Sheets[sheetName];
    const rows = Array.isArray(sheet) ? sheet : [];
    const headers = Array.isArray(sheet && sheet.headers) ? sheet.headers.filter(Boolean) : inferHeaders(rows);
    const productHeader = headers.find((header) => PRODUCT_HEADER_ALIASES.has(normalizeMatchText(header)));
    const categoryMatches = categoryIndex.get(normalizeMatchText(sheetName)) || [];

    if (!productHeader) {
      addIssue(issues, {
        code: "missing_product_header",
        sheet: sheetName,
        row: 1,
        message: "Ürün adı sütunu bulunamadı. İlk sütunda Ürün Adı başlığı olmalıdır."
      });
      continue;
    }

    const priceColumns = [];
    const sheetMappings = new Set();
    for (const header of headers) {
      if (header === productHeader) continue;
      const explicit = analysisOptions.columnMapping.get(normalizeMatchText(header));
      const inferred = parsePriceHeader(header);
      const column = explicit && explicit.ignore
        ? null
        : explicit
        ? { header, family: explicit.typeId, ...explicit, mappingSource: "explicit" }
        : inferred && { ...inferred, mappingSource: "inferred" };
      if (!column) {
        ignoredColumns.push({
          sheet: String(sheetName),
          header: String(header),
          source: explicit && explicit.ignore ? "explicit-ignore" : "unmatched",
          matched: false,
          typeId: null,
          optionId: null,
          typeName: "",
          optionLabel: ""
        });
        continue;
      }
      const mappingKey = `${column.typeId || column.family}\u0000${column.optionId || column.grams || column.placeholderIndex}`;
      if (sheetMappings.has(mappingKey)) {
        addIssue(issues, {
          code: "duplicate_price_column",
          sheet: sheetName,
          row: 1,
          column: header,
          message: "Aynı fiyat seçeneği bir sayfada birden fazla sütuna eşlenemez."
        });
        continue;
      }
      sheetMappings.add(mappingKey);
      priceColumns.push(column);
      columnMapping.push({
        sheet: sheetName,
        header: String(header),
        source: column.mappingSource,
        matched: true,
        typeId: column.typeId || null,
        optionId: column.optionId || null,
        family: column.family || null,
        typeName: pricingTypeName(column.typeId || column.family, weightContext),
        optionLabel: column.optionLabel || pricingOptionLabel(pricing, column.typeId, column.optionId)
      });
    }
    if (!priceColumns.length) {
      addIssue(issues, {
        code: "missing_price_columns",
        sheet: sheetName,
        row: 1,
        message: "Fiyat sütunu bulunamadı. Sütun eşlemesini kontrol edin."
      });
    }
    for (const [rowIndex, row] of rows.entries()) {
      const productName = cleanText(row && row[productHeader]);
      if (!productName) continue;
      report.productCount += 1;
      const rowNumber = rowIndex + 2;

      if (categoryMatches.length !== 1) {
        const ambiguous = categoryMatches.length > 1;
        if (ambiguous) report.ambiguousProducts += 1;
        else report.unmatchedProducts += 1;
        addIssue(issues, {
          code: ambiguous ? "ambiguous_category" : "category_not_found",
          sheet: sheetName,
          row: rowNumber,
          productName,
          message: ambiguous
            ? "Sayfa adı birden fazla kategoriyle eşleşti."
            : `“${sheetName}” adında bir kategori bulunamadı.`
        });
        continue;
      }

      const category = categoryMatches[0];
      const productMatches = (category.products || []).filter((product) => (
        normalizeMatchText(product && product.name) === normalizeMatchText(productName)
      ));
      if (productMatches.length !== 1) {
        const ambiguous = productMatches.length > 1;
        if (ambiguous) report.ambiguousProducts += 1;
        else report.unmatchedProducts += 1;
        addIssue(issues, {
          code: ambiguous ? "ambiguous_product" : "product_not_found",
          sheet: sheetName,
          row: rowNumber,
          productName,
          message: ambiguous
            ? "Kategori içinde aynı ada sahip birden fazla ürün bulundu."
            : "Ürün bu kategori altında bulunamadı."
        });
        continue;
      }

      report.matchedProducts += 1;
      const product = productMatches[0];
      const populated = [];
      let rowInvalid = false;

      for (const column of priceColumns) {
        let parsed = parsePrice(row && row[column.header]);
        if (parsed.kind === "blank") {
          report.blankPriceCells += 1;
          if (analysisOptions.blankPolicy === "preserve") continue;
          if (analysisOptions.blankPolicy === "error") {
            rowInvalid = true;
            addIssue(issues, {
              code: "blank_price",
              sheet: sheetName,
              row: rowNumber,
              column: column.header,
              productName,
              message: "Boş fiyat hücresi için seçilen politika bu satırın uygulanmasına izin vermiyor."
            });
            continue;
          }
          parsed = analysisOptions.blankPolicy === "deactivate"
            ? { kind: "deactivate", value: null }
            : { kind: "clear", value: null };
        }
        if (parsed.kind === "invalid") {
          report.invalidPrices += 1;
          rowInvalid = true;
          addIssue(issues, {
            code: "invalid_price",
            sheet: sheetName,
            row: rowNumber,
            column: column.header,
            productName,
            message: `“${column.header}” fiyatı geçerli, sıfır veya pozitif bir sayı olmalıdır.`
          });
          continue;
        }

        let resolved = column;
        if (column.family === "weight") {
          resolved = resolveWeightColumn(column, weightContext, !["clear", "deactivate"].includes(parsed.kind));
          if (!resolved) {
            if (["clear", "deactivate"].includes(parsed.kind)) continue;
            rowInvalid = true;
            addIssue(issues, {
              code: "unresolved_weight_header",
              sheet: sheetName,
              row: rowNumber,
              column: column.header,
              productName,
              message: `“${column.header}” gramaj başlığı sayısal değil ve mevcut bir gramaj seçeneğiyle eşleşemedi.`
            });
            continue;
          }
        }
        if (parsed.kind === "clear") report.clearedPriceCells += 1;
        populated.push({ ...resolved, action: parsed.kind, price: parsed.value });
      }

      if (rowInvalid) continue;
      if (!populated.length) {
        report.unchangedProducts += 1;
        continue;
      }

      const typeIds = [...new Set(populated.map((entry) => entry.typeId))];
      if (typeIds.length !== 1) {
        report.mixedFamilyRows += 1;
        addIssue(issues, {
          code: "mixed_pricing_types",
          sheet: sheetName,
          row: rowNumber,
          productName,
          families: typeIds,
          message: "Aynı ürün satırında birden fazla fiyat tipi doldurulmuş. Her ürün için tek fiyat grubu kullanın."
        });
        continue;
      }

      const targetTypeId = typeIds[0];
      const current = normalizeProductPricing(product.pricing);
      const replaceType = current.typeId !== targetTypeId;
      const values = {};
      const rowChanges = [];

      for (const entry of populated) {
        const currentRecord = !replaceType && current.values && current.values[entry.optionId];
        const oldPrice = currentRecord && currentRecord.price !== null ? Number(currentRecord.price) : null;
        const oldActive = currentRecord ? currentRecord.active !== false : false;
        const nextRecord = entry.action === "deactivate"
          ? { price: oldPrice, active: false }
          : entry.action === "clear"
            ? { price: null, active: true }
            : { price: entry.price, active: true };
        values[entry.optionId] = nextRecord;
        if (!replaceType && oldPrice === nextRecord.price && oldActive === nextRecord.active) continue;
        rowChanges.push({
          sheet: sheetName,
          row: rowNumber,
          column: entry.header,
          categoryId: String(category.id || ""),
          categoryName: String(category.name || ""),
          productId: String(product.id || ""),
          productName: String(product.name || productName),
          typeId: targetTypeId,
          typeName: pricingTypeName(targetTypeId, weightContext),
          optionId: entry.optionId,
          optionLabel: entry.optionLabel,
          oldPrice,
          newPrice: nextRecord.price,
          oldActive,
          newActive: nextRecord.active,
          typeChanged: replaceType
        });
      }

      const projectedValues = replaceType ? { ...values } : { ...current.values, ...values };
      const hasActivePrice = Object.values(projectedValues).some((record) => {
        const source = isRecord(record) ? record : { price: record, active: true };
        return source.active !== false && source.price !== null && source.price !== "" && Number.isFinite(Number(source.price));
      });
      if (!hasActivePrice) {
        addIssue(issues, {
          code: "no_active_price",
          sheet: sheetName,
          row: rowNumber,
          productName,
          message: "İşlem ürünü aktif bir fiyat seçeneği olmadan bırakamaz."
        });
        continue;
      }

      if (!rowChanges.length) {
        report.unchangedProducts += 1;
        continue;
      }

      productUpdates.push({
        categoryId: String(category.id || ""),
        productId: String(product.id || ""),
        typeId: targetTypeId,
        replaceType,
        values
      });
      changes.push(...rowChanges);
      report.updatedProductCount += 1;
      report.updatePriceCount += rowChanges.length;
    }
  }

  report.newWeightOptions = weightContext.addedOptions.length;
  report.errorCount = issues.length;
  report.errorRowCount = new Set(issues.map((issue) => `${String(issue.sheet || "")}\u0000${Number(issue.row || 0)}`)).size;
  report.canApply = report.updatePriceCount > 0 && report.errorCount === 0;
  for (const mapping of columnMapping) {
    if (mapping.typeId && mapping.optionId) continue;
    const resolved = changes.find((change) => change.sheet === mapping.sheet && change.column === mapping.header);
    if (!resolved) continue;
    mapping.typeId = resolved.typeId;
    mapping.optionId = resolved.optionId;
    mapping.typeName = resolved.typeName;
    mapping.optionLabel = resolved.optionLabel;
  }
  return {
    report,
    issues,
    changes,
    columnMappings: columnMapping.concat(ignoredColumns),
    ignoredColumns: ignoredColumns.map((item) => ({ sheet: item.sheet, header: item.header })),
    blankPolicy: analysisOptions.blankPolicy,
    plan: {
      productUpdates,
      weightType: serializeWeightPlan(weightContext),
      blankPolicy: analysisOptions.blankPolicy
    }
  };
}

function applyPricingImportPlan(data, planInput) {
  const plan = isRecord(planInput) ? planInput : {};
  let catalog = normalizePricingCatalog(data && data.pricing);
  const weightPlan = isRecord(plan.weightType) ? plan.weightType : null;
  if (weightPlan) catalog = mergeWeightPlan(catalog, weightPlan);

  const updates = new Map((Array.isArray(plan.productUpdates) ? plan.productUpdates : []).map((update) => [
    `${String(update.categoryId)}\u0000${String(update.productId)}`,
    update
  ]));
  const applied = [];
  const categories = (data.menuState && Array.isArray(data.menuState.categories) ? data.menuState.categories : []).map((category) => ({
    ...category,
    products: (Array.isArray(category.products) ? category.products : []).map((product) => {
      const key = `${String(category.id)}\u0000${String(product.id)}`;
      const update = updates.get(key);
      if (!update) return product;
      updates.delete(key);
      const type = catalog.types.find((item) => item.id === update.typeId);
      if (!type) throw clientError(409, `Fiyat tipi bulunamadı: ${update.typeId}`);
      const optionIds = new Set(type.options.map((option) => option.id));
      const current = normalizeProductPricing(product.pricing);
      const values = update.replaceType || current.typeId !== update.typeId ? {} : { ...current.values };
      for (const [optionId, rawValue] of Object.entries(update.values || {})) {
        if (!optionIds.has(optionId)) throw clientError(409, `Fiyat seçeneği bulunamadı: ${optionId}`);
        const value = isRecord(rawValue) ? rawValue : { price: rawValue, active: true };
        const price = value.price === null || value.price === "" ? null : Number(value.price);
        if (price !== null && (!Number.isFinite(price) || price < 0)) throw clientError(409, "Excel fiyat planı geçersiz.");
        const active = value.active !== false;
        values[optionId] = { ...(values[optionId] || {}), price, active };
        applied.push({
          categoryId: String(category.id),
          productId: String(product.id),
          typeId: update.typeId,
          optionId,
          price,
          active
        });
      }
      if (!Object.values(values).some((record) => record && record.active !== false && record.price !== null && Number.isFinite(Number(record.price)))) {
        throw clientError(409, `${product.name || "Ürün"} aktif bir fiyat seçeneği olmadan bırakılamaz.`);
      }
      return withLegacyPricing({
        ...product,
        pricing: { typeId: update.typeId, values }
      }, catalog);
    })
  }));

  if (updates.size) throw clientError(409, "Excel analizindeki bazı ürünler artık menüde bulunmuyor. Dosyayı yeniden analiz edin.");
  return {
    pricing: catalog,
    menuState: { ...data.menuState, pricing: catalog, categories },
    changedRows: applied,
    affectedProductCount: new Set(applied.map((row) => row.productId)).size
  };
}

function parsePriceHeader(header) {
  const normalized = normalizeMatchText(header);
  const known = TYPE_ALIASES.get(normalized);
  if (known) return { header, family: known.typeId, ...known };

  const placeholder = normalized.match(/^([xyz])\s*(?:g|gr|gram)$/);
  if (placeholder) {
    return {
      header,
      family: "weight",
      placeholderIndex: { x: 0, y: 1, z: 2 }[placeholder[1]]
    };
  }

  const weight = normalized.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|gram|kg|kilogram)$/);
  if (!weight) return null;
  const numeric = Number(weight[1].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const grams = (weight[2] === "kg" || weight[2] === "kilogram") ? numeric * 1000 : numeric;
  return {
    header,
    family: "weight",
    grams: roundNumber(grams),
    optionLabel: formatWeightLabel(numeric, weight[2])
  };
}

function parsePrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return { kind: "blank" };
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? { kind: "value", value: roundNumber(value) } : { kind: "invalid" };
  }
  let text = String(value).trim().replace(/\s+/g, "").replace(/[₺₴€$£]/g, "");
  if (!text || /[^\d.,+-]/.test(text)) return { kind: "invalid" };
  if (text.includes(",") && text.includes(".")) {
    const decimal = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    text = text.replace(thousands, "").replace(decimal, ".");
  } else if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  }
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? { kind: "value", value: roundNumber(number) } : { kind: "invalid" };
}

function createWeightContext(catalog) {
  const existing = catalog.types.find((type) => WEIGHT_TYPE_NAMES.has(normalizeMatchText(type.name)))
    || catalog.types.find((type) => !["standard", "size", "shot"].includes(type.id)
      && type.options.length
      && type.options.every((option) => weightOptionGrams(option) !== null))
    || null;
  return {
    catalog,
    existing,
    typeId: existing ? existing.id : uniqueId("weight", catalog.types.map((type) => type.id)),
    typeName: existing ? existing.name : "Gramaj",
    options: existing ? existing.options.map((option) => ({ ...option })) : [],
    addedOptions: []
  };
}

function resolveWeightColumn(column, context, allowCreate = true) {
  if (Number.isInteger(column.placeholderIndex)) {
    const option = context.options.slice().sort(byOrder)[column.placeholderIndex];
    return option ? {
      ...column,
      typeId: context.typeId,
      optionId: option.id,
      optionLabel: option.label
    } : null;
  }

  const existing = context.options.find((option) => weightOptionGrams(option) === column.grams);
  if (existing) return {
    ...column,
    typeId: context.typeId,
    optionId: existing.id,
    optionLabel: existing.label
  };

  if (!allowCreate) return null;

  const option = {
    id: uniqueId(`${formatPlainNumber(column.grams)}-gr`, context.options.map((item) => item.id)),
    label: column.optionLabel,
    value: column.grams,
    unit: "gr",
    order: context.options.length,
    active: true
  };
  context.options.push(option);
  context.addedOptions.push(option);
  return {
    ...column,
    typeId: context.typeId,
    optionId: option.id,
    optionLabel: option.label
  };
}

function serializeWeightPlan(context) {
  if (!context.addedOptions.length) return null;
  return {
    id: context.typeId,
    name: context.typeName,
    create: !context.existing,
    options: context.options
  };
}

function mergeWeightPlan(catalog, plan) {
  const existing = catalog.types.find((type) => type.id === plan.id);
  if (existing) {
    const optionsById = new Map(existing.options.map((option) => [option.id, option]));
    for (const option of (Array.isArray(plan.options) ? plan.options : [])) {
      const current = optionsById.get(option.id);
      if (current && weightOptionGrams(current) !== weightOptionGrams(option)) {
        throw clientError(409, "Gramaj fiyat seçeneği analizden sonra değişti. Dosyayı yeniden analiz edin.");
      }
      if (!current) optionsById.set(option.id, option);
    }
    return normalizePricingCatalog({
      ...catalog,
      types: catalog.types.map((type) => type.id === existing.id
        ? { ...type, active: true, options: [...optionsById.values()] }
        : type)
    });
  }
  if (!plan.create) throw clientError(409, "Gramaj fiyat tipi artık bulunamıyor. Dosyayı yeniden analiz edin.");
  return normalizePricingCatalog({
    ...catalog,
    types: catalog.types.concat({
      id: plan.id,
      name: plan.name || "Gramaj",
      active: true,
      order: catalog.types.length,
      options: Array.isArray(plan.options) ? plan.options : []
    })
  });
}

function pricingTypeName(typeId, weightContext) {
  const type = weightContext.catalog.types.find((item) => item.id === typeId);
  return type ? type.name : typeId === weightContext.typeId ? weightContext.typeName : typeId;
}

function pricingOptionLabel(catalog, typeId, optionId) {
  const type = normalizePricingCatalog(catalog).types.find((item) => item.id === typeId);
  const option = type && type.options.find((item) => item.id === optionId);
  return option ? option.label : "";
}

function weightOptionGrams(option) {
  if (!option) return null;
  if (Number.isFinite(Number(option.value)) && Number(option.value) > 0) {
    const unit = normalizeMatchText(option.unit || "gr");
    return roundNumber(Number(option.value) * (unit === "kg" || unit === "kilogram" ? 1000 : 1));
  }
  const parsed = parsePriceHeader(option.label);
  return parsed && parsed.family === "weight" && Number.isFinite(parsed.grams) ? parsed.grams : null;
}

function formatWeightLabel(value, unit) {
  const canonical = unit === "kg" || unit === "kilogram" ? "kg" : "gr";
  return `${formatPlainNumber(value)} ${canonical}`;
}

function normalizeMatchText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function indexBy(items, keyFor) {
  const result = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  }
  return result;
}

function inferHeaders(rows) {
  return rows.length && isRecord(rows[0]) ? Object.keys(rows[0]) : [];
}

function addIssue(issues, issue) {
  issues.push({ severity: "error", ...issue });
}

function uniqueId(base, usedIds) {
  const used = new Set(usedIds);
  let id = String(base || "pricing-option").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) id = "pricing-option";
  if (!used.has(id)) return id;
  let suffix = 2;
  while (used.has(`${id}-${suffix}`)) suffix += 1;
  return `${id}-${suffix}`;
}

function byOrder(first, second) {
  return Number(first && first.order || 0) - Number(second && second.order || 0);
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatPlainNumber(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : String(roundNumber(value));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  analyzePricingWorkbook,
  applyPricingImportPlan,
  normalizeMatchText,
  parsePriceHeader
};
