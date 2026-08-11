"use strict";

const crypto = require("crypto");

const PRICING_SCHEMA_VERSION = 1;

const BUILT_IN_TYPES = Object.freeze([
  {
    id: "standard",
    name: "Standart",
    active: true,
    order: 0,
    options: [{ id: "standard", label: "Standart", unit: "", order: 0, active: true }]
  },
  {
    id: "size",
    name: "Boyut",
    active: true,
    order: 1,
    options: [
      { id: "small", label: "Küçük", unit: "", order: 0, active: true },
      { id: "medium", label: "Orta", unit: "", order: 1, active: true },
      { id: "large", label: "Büyük", unit: "", order: 2, active: true }
    ]
  },
  {
    id: "shot",
    name: "Shot",
    active: true,
    order: 2,
    options: [
      { id: "single", label: "Single", unit: "", order: 0, active: true },
      { id: "double", label: "Double", unit: "", order: 1, active: true }
    ]
  }
]);

function defaultPricingCatalog() {
  return {
    schemaVersion: PRICING_SCHEMA_VERSION,
    types: clone(BUILT_IN_TYPES)
  };
}

function normalizePricingCatalog(value, options = {}) {
  const source = isRecord(value) ? value : {};
  const normalizedTypes = [];
  const seenTypeIds = new Set();

  for (const [index, rawType] of (Array.isArray(source.types) ? source.types : []).entries()) {
    const type = normalizePricingType(rawType, index);
    if (!type || seenTypeIds.has(type.id)) continue;
    seenTypeIds.add(type.id);
    normalizedTypes.push(type);
  }

  if (options.ensureBuiltIns !== false) {
    for (const builtIn of BUILT_IN_TYPES) {
      if (seenTypeIds.has(builtIn.id)) continue;
      normalizedTypes.push(clone(builtIn));
      seenTypeIds.add(builtIn.id);
    }
  }

  normalizedTypes.sort(byOrder);
  return {
    ...source,
    schemaVersion: PRICING_SCHEMA_VERSION,
    types: normalizedTypes
  };
}

function normalizePricingType(value, fallbackOrder = 0) {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name || value.label, 80);
  const id = normalizeId(value.id || slug(name), "pricing-type");
  if (!id || !name) return null;
  const options = [];
  const seenIds = new Set();
  for (const [index, rawOption] of (Array.isArray(value.options) ? value.options : []).entries()) {
    const option = normalizePricingOption(rawOption, index);
    if (!option || seenIds.has(option.id)) continue;
    seenIds.add(option.id);
    options.push(option);
  }
  options.sort(byOrder);
  return {
    ...value,
    id,
    name,
    active: value.active !== false,
    order: finiteNumber(value.order, fallbackOrder),
    options
  };
}

function normalizePricingOption(value, fallbackOrder = 0) {
  if (!isRecord(value)) return null;
  const label = cleanText(value.label || value.name, 80);
  const id = normalizeId(value.id || slug(label), "option");
  if (!id || !label) return null;
  const next = {
    ...value,
    id,
    label,
    unit: cleanText(value.unit, 24),
    order: finiteNumber(value.order, fallbackOrder),
    active: value.active !== false
  };
  if (value.value !== undefined && value.value !== null && value.value !== "") {
    const numericValue = Number(value.value);
    if (Number.isFinite(numericValue)) next.value = numericValue;
    else delete next.value;
  }
  return next;
}

function normalizeProductPricing(value, fallbackTypeId = "standard") {
  const source = isRecord(value) ? value : {};
  const typeId = normalizeId(source.typeId || fallbackTypeId, "standard");
  const values = normalizePricingValues(source.values);
  const families = [];
  const seenFamilyIds = new Set();
  const rawFamilies = Array.isArray(source.families) ? source.families : [];
  for (const rawFamily of rawFamilies) {
    if (!isRecord(rawFamily)) continue;
    const familyTypeId = normalizeId(rawFamily.typeId, "");
    if (!familyTypeId || seenFamilyIds.has(familyTypeId)) continue;
    seenFamilyIds.add(familyTypeId);
    families.push({ ...rawFamily, typeId: familyTypeId, values: normalizePricingValues(rawFamily.values) });
  }
  const primaryIndex = families.findIndex((family) => family.typeId === typeId);
  if (primaryIndex >= 0) families[primaryIndex] = { ...families[primaryIndex], values: { ...families[primaryIndex].values, ...values } };
  else families.unshift({ typeId, values });
  const primary = families.find((family) => family.typeId === typeId) || families[0] || { typeId, values };
  return { ...source, typeId: primary.typeId, values: primary.values, families };
}

function normalizePricingValues(value) {
  const values = {};
  const rawValues = isRecord(value) ? value : {};
  for (const [rawId, rawValue] of Object.entries(rawValues)) {
    const optionId = normalizeId(rawId, "");
    if (!optionId) continue;
    const valueSource = isRecord(rawValue) ? rawValue : { price: rawValue };
    const price = cleanPrice(valueSource.price);
    values[optionId] = {
      ...valueSource,
      price,
      active: valueSource.active !== false
    };
  }
  return values;
}

function migratePricingSystem(catalogInput, menuStateInput) {
  const pricing = normalizePricingCatalog(catalogInput);
  const menuState = isRecord(menuStateInput) ? menuStateInput : { settings: {}, categories: [] };
  const categories = (Array.isArray(menuState.categories) ? menuState.categories : []).map((category) => ({
    ...category,
    products: (Array.isArray(category.products) ? category.products : []).map((product) => {
      const canonical = isRecord(product.pricing) && product.pricing.typeId
        ? normalizeProductPricing(product.pricing)
        : pricingFromLegacyProduct(product, pricing);
      return withLegacyPricing({ ...product, pricing: canonical }, pricing);
    })
  }));
  const normalizedCatalog = normalizePricingCatalog(pricing);
  return {
    pricing: normalizedCatalog,
    menuState: { ...menuState, pricing: normalizedCatalog, categories }
  };
}

function pricingFromLegacyProduct(product, catalog) {
  const source = isRecord(product) ? product : {};
  const prices = isRecord(source.prices) ? source.prices : {};
  const variants = Array.isArray(source.variants) ? source.variants.filter(isRecord) : [];
  const mode = String(source.priceMode || "").trim();

  if (mode === "singleDouble" || hasPrice(prices.single) || hasPrice(prices.double)) {
    return normalizeProductPricing({
      typeId: "shot",
      values: {
        single: { price: cleanPrice(prices.single), active: true },
        double: { price: cleanPrice(prices.double), active: true }
      }
    });
  }

  const sizeValues = legacySizeValues(prices, variants);
  if (mode === "sizes" || Object.values(sizeValues).some((item) => item.price !== null)) {
    return normalizeProductPricing({ typeId: "size", values: sizeValues });
  }

  if (variants.length > 1) {
    const mappedShot = variantsToKnownValues(variants, "shot");
    if (mappedShot) return normalizeProductPricing({ typeId: "shot", values: mappedShot });
    const mappedSize = variantsToKnownValues(variants, "size");
    if (mappedSize) return normalizeProductPricing({ typeId: "size", values: mappedSize });
    const customType = ensureLegacyCustomType(catalog, variants);
    const values = {};
    customType.options.forEach((option, index) => {
      values[option.id] = { price: cleanPrice(variants[index] && variants[index].price), active: true };
    });
    return normalizeProductPricing({ typeId: customType.id, values });
  }

  const variantPrice = variants.length ? variants[0].price : null;
  const standard = firstDefinedPrice(prices.standard, source.price, variantPrice, prices.o, prices.k, prices.b);
  return normalizeProductPricing({
    typeId: "standard",
    values: { standard: { price: standard, active: true } }
  });
}

function withLegacyPricing(product, catalogInput) {
  const catalog = normalizePricingCatalog(catalogInput);
  const canonical = normalizeProductPricing(product && product.pricing);
  const type = catalog.types.find((item) => item.id === canonical.typeId);
  const values = canonical.values || {};
  const legacyPrices = {};
  let priceMode = "variants";

  if (canonical.typeId === "standard") {
    priceMode = "standard";
    legacyPrices.standard = valuePrice(values.standard);
  } else if (canonical.typeId === "size") {
    priceMode = "sizes";
    legacyPrices.k = valuePrice(values.small);
    legacyPrices.o = valuePrice(values.medium);
    legacyPrices.b = valuePrice(values.large);
  } else if (canonical.typeId === "shot") {
    priceMode = "singleDouble";
    legacyPrices.single = valuePrice(values.single);
    legacyPrices.double = valuePrice(values.double);
  }

  const variants = pricingOptionsForProduct({ pricing: canonical }, catalog, { includeInactive: true })
    .map((option) => ({ name: option.label, label: option.label, price: option.price, typeId: option.typeId, optionId: option.optionId }));

  if (priceMode === "variants") {
    for (const [optionId, rawValue] of Object.entries(values)) {
      legacyPrices[optionId] = valuePrice(rawValue);
    }
  }

  return {
    ...product,
    pricing: canonical,
    priceMode,
    prices: legacyPrices,
    variants: type ? variants : preserveUnknownVariants(product, variants)
  };
}

function pricingOptionsForProduct(product, catalogInput, options = {}) {
  const catalog = normalizePricingCatalog(catalogInput);
  const pricing = normalizeProductPricing(product && product.pricing);
  const result = [];
  const usedIds = new Set();
  for (const [familyIndex, family] of pricing.families.entries()) {
    const type = catalog.types.find((item) => item.id === family.typeId);
    const knownIds = new Set();
    for (const option of (type && type.options || []).slice().sort(byOrder)) {
      knownIds.add(option.id);
      const value = family.values[option.id];
      if (!value) continue;
      if (!options.includeInactive && (option.active === false || value.active === false)) continue;
      if (value.price === null) continue;
      const publicId = usedIds.has(option.id) ? `${family.typeId}:${option.id}` : option.id;
      usedIds.add(publicId);
      result.push({
        id: publicId,
        optionId: option.id,
        typeId: family.typeId,
        familyOrder: familyIndex,
        label: option.label,
        unit: option.unit || "",
        value: option.value,
        order: option.order,
        active: option.active !== false && value.active !== false,
        price: value.price
      });
    }

    // Unknown option keys remain readable so forward-compatible imports are not lossy.
    for (const [optionId, value] of Object.entries(family.values)) {
      if (knownIds.has(optionId) || !value || value.price === null) continue;
      if (!options.includeInactive && value.active === false) continue;
      const publicId = usedIds.has(optionId) ? `${family.typeId}:${optionId}` : optionId;
      usedIds.add(publicId);
      result.push({
        id: publicId,
        optionId,
        typeId: family.typeId,
        familyOrder: familyIndex,
        label: cleanText(value.label || optionId, 80),
        unit: cleanText(value.unit, 24),
        order: finiteNumber(value.order, result.length),
        active: value.active !== false,
        price: value.price
      });
    }
  }
  return result.sort((first, second) => finiteNumber(first.familyOrder, 0) - finiteNumber(second.familyOrder, 0) || byOrder(first, second));
}

function serializeLegacyMenuState(menuState, catalog) {
  const source = isRecord(menuState) ? menuState : {};
  return {
    ...source,
    pricing: normalizePricingCatalog(catalog || source.pricing),
    categories: (Array.isArray(source.categories) ? source.categories : []).map((category) => ({
      ...category,
      products: (Array.isArray(category.products) ? category.products : []).map((product) => withLegacyPricing(product, catalog))
    }))
  };
}

function validatePricingCatalog(catalogInput) {
  if (!isRecord(catalogInput) || !Array.isArray(catalogInput.types)) return "pricing.types dizi olmalı.";
  const typeIds = new Set();
  const typeNames = new Set();
  for (const rawType of catalogInput.types) {
    const type = normalizePricingType(rawType);
    if (!type) return "Her fiyat tipinde id, ad ve seçenekler olmalı.";
    const normalizedName = comparable(type.name);
    if (typeIds.has(type.id) || typeNames.has(normalizedName)) return "Fiyat tipi kimliği ve adı benzersiz olmalı.";
    typeIds.add(type.id);
    typeNames.add(normalizedName);
    if (!type.options.length) return `${type.name} için en az bir fiyat seçeneği gerekli.`;
    const optionIds = new Set();
    const optionNames = new Set();
    for (const option of type.options) {
      const optionName = comparable(option.label);
      if (optionIds.has(option.id) || optionNames.has(optionName)) return `${type.name} seçenek kimlikleri ve adları benzersiz olmalı.`;
      optionIds.add(option.id);
      optionNames.add(optionName);
    }
  }
  return "";
}

function validateProductPricing(value) {
  if (!isRecord(value)) return "Ürün pricing alanı nesne olmalı.";
  if (!normalizeId(value.typeId, "")) return "Ürün fiyat tipi gerekli.";
  if (!isRecord(value.values)) return "Ürün pricing.values alanı nesne olmalı.";
  const families = Array.isArray(value.families) && value.families.length
    ? value.families
    : [{ typeId: value.typeId, values: value.values }];
  const seenFamilies = new Set();
  for (const family of families) {
    if (!isRecord(family) || !normalizeId(family.typeId, "") || !isRecord(family.values)) return "Ürün fiyat ailesi geçersiz.";
    const familyTypeId = normalizeId(family.typeId, "");
    if (seenFamilies.has(familyTypeId)) return "Ürün fiyat aileleri benzersiz olmalı.";
    seenFamilies.add(familyTypeId);
    for (const [optionId, rawValue] of Object.entries(family.values)) {
      if (!normalizeId(optionId, "")) return "Fiyat seçeneği kimliği geçersiz.";
      const source = isRecord(rawValue) ? rawValue : { price: rawValue };
      if (source.price !== null && source.price !== "" && source.price !== undefined) {
        const price = Number(source.price);
        if (!Number.isFinite(price) || price < 0) return "Fiyatlar sıfır veya pozitif sayı olmalı.";
      }
      if (source.active !== undefined && typeof source.active !== "boolean") return "Fiyat seçeneği active alanı boolean olmalı.";
    }
  }
  return "";
}

function createPricingType(input, catalogInput) {
  if (!isRecord(input)) throw clientError(400, "Fiyat tipi bilgisi gerekli.");
  const inputError = validatePricingTypeInput(input);
  if (inputError) throw clientError(400, inputError);
  const catalog = normalizePricingCatalog(catalogInput);
  const requestedId = cleanText(input.id, 80);
  const id = requestedId ? normalizeId(requestedId, "") : uniqueTypeId(input.name, catalog);
  const existing = catalog.types.find((item) => item.id === id);
  const normalized = normalizePricingType({
    ...(existing || {}),
    ...input,
    id,
    options: normalizeTypeOptionsForWrite(input.options, existing && existing.options)
  }, existing ? existing.order : catalog.types.length);
  if (!normalized) throw clientError(400, "Fiyat tipi adı ve en az bir seçenek gerekli.");
  if (!normalized.options.length) throw clientError(400, "En az bir fiyat seçeneği gerekli.");

  const candidate = {
    ...catalog,
    types: existing
      ? catalog.types.map((item) => item.id === id ? normalized : item)
      : catalog.types.concat(normalized)
  };
  const validationError = validatePricingCatalog(candidate);
  if (validationError) throw clientError(400, validationError);
  return { catalog: normalizePricingCatalog(candidate), type: normalized, created: !existing };
}

function validatePricingTypeInput(input) {
  const name = cleanText(input && input.name, 80);
  if (!name) return "Fiyat tipi adı boş olamaz.";
  if (!Array.isArray(input.options) || !input.options.length) return "En az bir fiyat seçeneği gerekli.";
  const ids = new Set();
  const names = new Set();
  for (const [index, option] of input.options.entries()) {
    if (!isRecord(option)) return "Her fiyat seçeneği nesne olmalı.";
    const label = cleanText(option.label || option.name, 80);
    if (!label) return `Fiyat seçeneği ${index + 1} için ad gerekli.`;
    const id = normalizeId(option.id || slug(label), "");
    const normalizedName = comparable(label);
    if (!id || ids.has(id) || names.has(normalizedName)) return "Fiyat seçeneği kimliği ve adı benzersiz olmalı.";
    ids.add(id);
    names.add(normalizedName);
    if (option.value !== undefined && option.value !== null && option.value !== "" && !Number.isFinite(Number(option.value))) {
      return `${label} sayısal değeri geçersiz.`;
    }
  }
  return "";
}

function normalizeTypeOptionsForWrite(rawOptions, existingOptions) {
  const existingById = new Map((Array.isArray(existingOptions) ? existingOptions : []).map((item) => [item.id, item]));
  return (Array.isArray(rawOptions) ? rawOptions : []).map((option, index) => {
    if (!isRecord(option)) return null;
    const requestedId = cleanText(option.id, 80);
    const id = requestedId ? normalizeId(requestedId, "") : uniqueOptionId(option.label || option.name, existingById, index);
    return { ...(existingById.get(id) || {}), ...option, id };
  }).filter(Boolean);
}

function uniqueTypeId(name, catalog) {
  const base = normalizeId(slug(name), "pricing-type");
  const ids = new Set(catalog.types.map((item) => item.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function uniqueOptionId(label, existingById, index) {
  const base = normalizeId(slug(label), `option-${index + 1}`);
  if (!existingById.has(base)) return base;
  let suffix = 2;
  while (existingById.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function pricingTypeUsage(menuState, typeId) {
  const rows = [];
  for (const category of (menuState && menuState.categories || [])) {
    for (const product of (category.products || [])) {
      if (product && product.pricing && (product.pricing.typeId === typeId
        || (Array.isArray(product.pricing.families) && product.pricing.families.some((family) => family && family.typeId === typeId)))) {
        rows.push({ productId: product.id, productName: product.name, categoryId: category.id, categoryName: category.name });
      }
    }
  }
  return rows;
}

function operationPrice(oldPrice, operation, rawValue, rounding) {
  const current = Number(oldPrice);
  const value = Number(rawValue);
  if (!Number.isFinite(current) || !Number.isFinite(value) || value < 0) throw clientError(400, "Fiyat işlem değeri geçersiz.");
  const normalizedOperation = normalizeOperation(operation);
  let next = current;
  if (normalizedOperation === "set") next = value;
  if (normalizedOperation === "add") next = current + value;
  if (normalizedOperation === "subtract") next = Math.max(0, current - value);
  if (normalizedOperation === "increase_percent") next = current * (1 + value / 100);
  if (normalizedOperation === "decrease_percent") next = Math.max(0, current * (1 - value / 100));
  const increment = normalizeRounding(rounding);
  if (increment) next = Math.round(next / increment) * increment;
  return Math.round((next + Number.EPSILON) * 100) / 100;
}

function normalizeOperation(value) {
  const operation = String(value || "").trim();
  const aliases = {
    direct: "set", set_price: "set", fixed: "set",
    plus: "add", add_fixed: "add",
    minus: "subtract", subtract_fixed: "subtract",
    percent_add: "increase_percent", percentage_increase: "increase_percent",
    percent_subtract: "decrease_percent", percentage_decrease: "decrease_percent"
  };
  const normalized = aliases[operation] || operation;
  if (!["set", "add", "subtract", "increase_percent", "decrease_percent"].includes(normalized)) {
    throw clientError(400, "Toplu fiyat işlem türü geçersiz.");
  }
  return normalized;
}

function normalizeRounding(value) {
  if (value === true || value === "integer") return 1;
  if (isRecord(value)) return normalizeRounding(value.increment || value.step);
  if (value === false || value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function ensureLegacyCustomType(catalog, variants) {
  const signature = variants.map((variant) => comparable(variant.label || variant.name || "Seçenek")).join("|");
  const id = `legacy-${crypto.createHash("sha256").update(signature || "custom", "utf8").digest("hex").slice(0, 12)}`;
  const existing = catalog.types.find((item) => item.id === id);
  if (existing) return existing;
  const ids = new Set();
  const options = variants.map((variant, index) => {
    let optionId = normalizeId(slug(variant.label || variant.name), `option-${index + 1}`);
    let suffix = 2;
    while (ids.has(optionId)) optionId = `${optionId}-${suffix++}`;
    ids.add(optionId);
    return { id: optionId, label: cleanText(variant.label || variant.name || `Seçenek ${index + 1}`, 80), unit: "", order: index, active: true };
  });
  const type = {
    id,
    name: `Özel (${options.map((item) => item.label).join(" / ")})`,
    active: true,
    order: catalog.types.length,
    legacy: true,
    options
  };
  catalog.types.push(type);
  return type;
}

function variantsToKnownValues(variants, typeId) {
  const mappings = typeId === "shot"
    ? { single: "single", double: "double" }
    : { k: "small", kucuk: "small", küçük: "small", small: "small", o: "medium", orta: "medium", medium: "medium", b: "large", buyuk: "large", büyük: "large", large: "large" };
  const values = {};
  for (const variant of variants) {
    const optionId = mappings[comparable(variant.label || variant.name)];
    if (!optionId) return null;
    values[optionId] = { price: cleanPrice(variant.price), active: true };
  }
  return Object.keys(values).length ? values : null;
}

function legacySizeValues(prices, variants) {
  const mapped = variantsToKnownValues(variants, "size") || {};
  return {
    small: mapped.small || { price: cleanPrice(prices.k), active: true },
    medium: mapped.medium || { price: cleanPrice(prices.o), active: true },
    large: mapped.large || { price: cleanPrice(prices.b), active: true }
  };
}

function preserveUnknownVariants(product, generated) {
  return generated.length ? generated : (Array.isArray(product && product.variants) ? product.variants : []);
}

function valuePrice(value) {
  if (isRecord(value)) return cleanPrice(value.price);
  return cleanPrice(value);
}

function firstDefinedPrice(...values) {
  for (const value of values) {
    const price = cleanPrice(value);
    if (price !== null) return price;
  }
  return null;
}

function hasPrice(value) {
  return cleanPrice(value) !== null;
}

function cleanPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(typeof value === "string" ? value.replace(",", ".") : value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function comparable(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value) {
  return comparable(value).replace(/\s+/g, "-");
}

function normalizeId(value, fallback) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return id || fallback;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function byOrder(first, second) {
  return finiteNumber(first && first.order, 0) - finiteNumber(second && second.order, 0);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  PRICING_SCHEMA_VERSION,
  createPricingType,
  defaultPricingCatalog,
  migratePricingSystem,
  normalizeOperation,
  normalizePricingCatalog,
  normalizePricingOption,
  normalizePricingType,
  normalizeProductPricing,
  operationPrice,
  pricingOptionsForProduct,
  pricingTypeUsage,
  serializeLegacyMenuState,
  validatePricingCatalog,
  validateProductPricing,
  withLegacyPricing
};
