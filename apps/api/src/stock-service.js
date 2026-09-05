"use strict";

const NORMALIZED_STOCK_SNAPSHOT = Symbol.for("tahmisci.stock.normalized-snapshot");

// Central, location-aware inventory operations.  Routes intentionally pass the
// current store object into this module so a balance update, movement record and
// transfer status always live in one FileStore transaction.

const crypto = require("crypto");
const { normalizeStockState } = require("./store/migrations");
const { isValidProductCode, normalizeProductCode, normalizeProductCodeList } = require("./store/product-code-registry");
const { FORMULA_VALUE_MISSING, readWorkbookCells } = require("./simple-xlsx");

const CAFE_LOCATION_ID = "stock-location-cafe";
const GENERAL_LOCATION_ID = "stock-location-general";
const LOCATION_TYPES = new Set(["cafe", "central", "other"]);
const CONTROLLED_UNITS = new Set([
  "adet", "paket", "şişe", "kutu", "koli", "kasa", "çuval",
  "kg", "gr", "litre", "ml", "porsiyon", "bardak", "rulo", "set", "çift", "metre"
]);
const MOVEMENT_TYPES = new Set([
  "opening_balance", "manual_in", "manual_out", "waste", "inbound_shipment",
  "shipment_in", "transfer", "transfer_out", "transfer_in", "adjustment",
  "correction", "reversal", "stock_in", "stock_out", "import"
]);
const PERSONNEL_OUT_MOVEMENT_TYPES = new Set(["waste", "manual_out"]);
const TRANSFER_STATUSES = new Set(["draft", "pending", "approved", "rejected", "cancelled"]);
const OPERATION_LIMIT = 1000;
const MOVEMENT_LIMIT = 5000;

function stockError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function nowIso(value) {
  return value || new Date().toISOString();
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? round(number) : null;
}

function normalizeUnit(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.value ?? value.code ?? value.unit ?? value.baseUnit ?? value.name ?? value.label ?? ""
    : value;
  const unit = String(source || "").trim().toLocaleLowerCase("tr-TR");
  return {
    l: "litre", lt: "litre", liter: "litre", kilogram: "kg", gram: "gr", g: "gr",
    tane: "adet", sise: "şişe"
  }[unit] || unit;
}

function controlledUnit(value, fallback = "") {
  const unit = normalizeUnit(value);
  if (CONTROLLED_UNITS.has(unit)) return unit;
  return unit && unit.length <= 30 && /^[\p{L}\p{N} _-]+$/u.test(unit) ? unit : fallback;
}

function productUnitMetadata(product = {}, options = {}) {
  const allowDefaultBaseUnit = options.allowDefaultBaseUnit !== false
    && product.excelSourceBaseUnitMissing !== true
    && product.excelBaseUnitMissing !== true
    && product.baseUnitMissing !== true;
  const fallbackBaseUnit = allowDefaultBaseUnit ? "adet" : "";
  const baseUnit = controlledUnit(product.baseUnit || product.unit || fallbackBaseUnit, fallbackBaseUnit);
  const bulkUnit = controlledUnit(product.bulkUnit || product.caseUnit || product.purchaseUnit || "", "");
  const unitsPerBulkUnit = finitePositive(product.unitsPerBulkUnit ?? product.unitsPerCase ?? product.packageSize
    ?? product.packSize ?? product.piecesPerBox ?? product.koliIci
    ?? (product.packageInfo && typeof product.packageInfo === "object" ? product.packageInfo.unitsPerCase || product.packageInfo.quantity : null)) || 0;
  const allowDecimal = typeof product.allowDecimal === "boolean"
    ? product.allowDecimal
    : ["kg", "gr", "litre", "ml"].includes(baseUnit);
  const defaultMovementUnit = normalizeUnit(product.defaultMovementUnit || baseUnit) === bulkUnit && bulkUnit && unitsPerBulkUnit
    ? bulkUnit
    : baseUnit;
  return { baseUnit, bulkUnit, unitsPerBulkUnit, allowDecimal, defaultMovementUnit };
}

function sameUnitSchema(left = {}, right = {}) {
  return normalizeUnit(left.baseUnit) === normalizeUnit(right.baseUnit)
    && normalizeUnit(left.bulkUnit) === normalizeUnit(right.bulkUnit)
    && Number(left.unitsPerBulkUnit || 0) === Number(right.unitsPerBulkUnit || 0)
    && Boolean(left.allowDecimal) === Boolean(right.allowDecimal)
    && normalizeUnit(left.defaultMovementUnit || left.baseUnit) === normalizeUnit(right.defaultMovementUnit || right.baseUnit);
}

function unitSchemaEntry(metadata, version, validFrom = null, validUntil = null) {
  return {
    version,
    baseUnit: metadata.baseUnit,
    bulkUnit: metadata.bulkUnit,
    unitsPerBulkUnit: metadata.unitsPerBulkUnit,
    allowDecimal: metadata.allowDecimal,
    defaultMovementUnit: metadata.defaultMovementUnit,
    validFrom: validFrom || null,
    validUntil: validUntil || null
  };
}

function recordProductUnitSchemaTransition(product, targetSchema, timestamp = nowIso()) {
  const current = productUnitMetadata(product);
  const target = productUnitMetadata({ ...product, ...targetSchema, unit: targetSchema.baseUnit, caseUnit: targetSchema.bulkUnit, unitsPerCase: targetSchema.unitsPerBulkUnit });
  const history = (Array.isArray(product.unitSchemaHistory) ? product.unitSchemaHistory : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({ ...entry }))
    .sort((left, right) => Number(left.version || 0) - Number(right.version || 0));
  const maxVersion = history.reduce((maximum, entry) => Math.max(maximum, Number(entry.version || 0)), 0);
  const currentVersion = Math.max(1, Number(product.unitSchemaVersion || 0), maxVersion || 1);
  let currentEntry = history.find((entry) => Number(entry.version) === currentVersion && sameUnitSchema(entry, current));
  if (!currentEntry) {
    currentEntry = unitSchemaEntry(current, currentVersion, product.unitSchemaUpdatedAt || product.createdAt || null, null);
    history.push(currentEntry);
  }
  if (sameUnitSchema(current, target)) {
    currentEntry.validUntil = null;
    product.unitSchemaHistory = history.sort((left, right) => Number(left.version) - Number(right.version));
    product.unitSchemaVersion = currentVersion;
    return currentVersion;
  }
  currentEntry.validUntil = timestamp;
  const nextVersion = Math.max(currentVersion, maxVersion) + 1;
  history.push(unitSchemaEntry(target, nextVersion, timestamp, null));
  product.unitSchemaHistory = history.sort((left, right) => Number(left.version) - Number(right.version));
  product.unitSchemaVersion = nextVersion;
  return nextVersion;
}

function allowedProductUnits(product) {
  const metadata = productUnitMetadata(product);
  const result = new Set([metadata.baseUnit]);
  if (metadata.bulkUnit && metadata.unitsPerBulkUnit > 0) result.add(metadata.bulkUnit);
  return Array.from(result).filter(Boolean);
}

function requireProductBaseUnit(product) {
  const metadata = productUnitMetadata(product, { allowDefaultBaseUnit: false });
  if (!metadata.baseUnit) {
    throw stockError(`${productName(product)} için temel birim tanımlanmadan stok hareketi yapılamaz.`, 409);
  }
  return metadata;
}

function productName(product) {
  return String(product && (product.productName || product.name) || "Stok ürünü");
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeState(stockState) {
  if (stockState && stockState[NORMALIZED_STOCK_SNAPSHOT] === true) return stockState;
  const state = normalizeStockState(stockState || {});
  Object.defineProperty(state, NORMALIZED_STOCK_SNAPSHOT, { value: true, enumerable: false });
  return state;
}

function prepareSnapshot(stockState) {
  return normalizeState(stockState);
}

function getLocations(stockState, options = {}) {
  const state = normalizeState(stockState);
  return state.locations
    .filter((location) => options.includeInactive || location.active !== false)
    .slice()
    .sort((first, second) => Number(first.sortOrder || 0) - Number(second.sortOrder || 0)
      || String(first.name).localeCompare(String(second.name), "tr"));
}

function defaultCafeLocation(state) {
  const locations = getLocations(state, { includeInactive: true });
  return locations.find((location) => location.active !== false && location.code === "CAFE")
    || locations.find((location) => location.active !== false && location.type === "cafe")
    || locations.find((location) => location.code === "CAFE")
    || locations.find((location) => location.type === "cafe")
    || null;
}

function defaultGeneralLocation(state) {
  const locations = getLocations(state, { includeInactive: true });
  return locations.find((location) => location.active !== false && location.code === "GENEL")
    || locations.find((location) => location.active !== false && location.type === "central")
    || locations.find((location) => location.code === "GENEL")
    || locations.find((location) => location.type === "central")
    || null;
}

function getLocation(stockState, locationId, options = {}) {
  const state = normalizeState(stockState);
  const id = String(locationId || "").trim();
  const location = getLocations(state, { includeInactive: options.includeInactive === true })
    .find((item) => String(item.id) === id || String(item.code) === id.toUpperCase());
  if (!location) throw stockError("Stok lokasyonu bulunamadı.", 404);
  if (!options.allowInactive && location.active === false) throw stockError("Stok lokasyonu aktif değil.", 409);
  return location;
}

function actorLocationId(stockState, actor) {
  const state = normalizeState(stockState);
  if (actor && (actor.type === "admin" || actor.inventoryManage === true || actor.inventoryScope === "all")) return null;
  const requested = String(actor && (actor.stockLocationId || actor.locationId) || "").trim();
  if (requested) {
    const location = getLocation(state, requested);
    if (location.type !== "cafe") throw stockError("Personel stok işlemleri yalnızca atanmış Kafe Deposunda yapılabilir.", 403);
    if (location.personnelVisible === false) throw Object.assign(stockError("Bu depo personel görünümüne kapalıdır.", 403), { code: "STOCK_LOCATION_HIDDEN" });
    return location.id;
  }
  const cafe = defaultCafeLocation(state);
  if (!cafe || cafe.active === false) throw stockError("Personel için aktif Kafe Deposu bulunamadı.", 404);
  if (cafe.personnelVisible === false) throw Object.assign(stockError("Bu depo personel görünümüne kapalıdır.", 403), { code: "STOCK_LOCATION_HIDDEN" });
  return cafe.id;
}

function getProduct(stockState, productId, productCode) {
  const state = normalizeState(stockState);
  const wantedId = String(productId || "").trim();
  const wantedCode = normalizeProductCode(productCode);
  if (!wantedId && !wantedCode) throw stockError("Stok ürünü kimliği zorunludur.");
  let product = null;
  if (wantedId) product = state.products.find((item) => String(item.id) === wantedId) || null;
  if (!product && !wantedId && wantedCode) {
    const matches = state.products.filter((item) => normalizeProductCode(item.productCode) === wantedCode);
    if (matches.length > 1) throw stockError("Stok ürün kodu birden fazla kayıtla eşleşiyor.", 409);
    product = matches[0] || null;
  }
  if (!product) throw stockError("Stok ürünü bulunamadı.", 404);
  if (product.active === false || product.sourcePresent === false || product.archivedAt
    || product.trashed === true || product.removedAt || product.deletedAt || product.purgedAt) {
    throw stockError("Stok ürünü aktif katalogda bulunamadı.", 409);
  }
  if (wantedCode && normalizeProductCode(product.productCode) !== wantedCode) {
    throw stockError("Stok ürün kodu güncel katalogla eşleşmiyor.", 409);
  }
  return product;
}

function ensureBalances(state) {
  if (!Array.isArray(state.balances)) state.balances = [];
  return state.balances;
}

function findBalance(state, locationId, productId, create = false) {
  const balances = ensureBalances(state);
  const found = balances.find((item) => String(item.locationId) === String(locationId)
    && String(item.productId) === String(productId));
  if (found || !create) return found || null;
  const product = state.products.find((item) => String(item.id) === String(productId));
  const balance = {
    id: `stock-balance-${crypto.createHash("sha256").update(`${locationId}\u0000${productId}`, "utf8").digest("hex").slice(0, 20)}`,
    locationId: String(locationId),
    productId: String(productId),
    quantity: 0,
    revision: 0,
    criticalThreshold: Math.max(0, Number(product && product.criticalThreshold || 0)),
    orderThreshold: Math.max(0, Number(product && product.orderThreshold || 0)),
    targetLevel: Math.max(0, Number(product && product.targetLevel || 0)),
    reconciliationRequired: false,
    reconciliationReasonCode: "",
    reconciliationReason: "",
    previousQuantity: null,
    previousBaseUnit: "",
    targetBaseUnit: "",
    baseUnitSnapshot: productUnitMetadata(product || {}).baseUnit,
    bulkUnitSnapshot: productUnitMetadata(product || {}).bulkUnit,
    unitsPerBulkUnitSnapshot: productUnitMetadata(product || {}).unitsPerBulkUnit,
    unitSchemaVersionAtBalance: Math.max(1, Number(product && product.unitSchemaVersion || 1)),
    reconciliationCreatedAt: null,
    reconciliationResolvedAt: null,
    updatedAt: null
  };
  balances.push(balance);
  return balance;
}

function getProductBalance(stockState, locationId, productId) {
  const state = normalizeState(stockState);
  const balance = findBalance(state, locationId, productId, false);
  return balance ? { ...balance } : {
    locationId: String(locationId), productId: String(productId), quantity: 0,
    revision: 0, criticalThreshold: 0, orderThreshold: 0, targetLevel: 0, updatedAt: null
  };
}

function calculateTotalStock(stockState, productId) {
  const state = normalizeState(stockState);
  return round(ensureBalances(state)
    .filter((balance) => String(balance.productId) === String(productId))
    .reduce((total, balance) => total + Number(balance.quantity || 0), 0));
}

function refreshProductAttentionState(state, product) {
  const reconciliationRequired = (state.balances || []).some((balance) => String(balance.productId) === String(product.id)
    && balance.reconciliationRequired === true);
  const baseUnitMissing = !productUnitMetadata(product, { allowDefaultBaseUnit: false }).baseUnit;
  const reasonCodes = new Set((Array.isArray(product.attentionReasons) ? product.attentionReasons : [])
    .map((value) => String(value || "").trim()).filter(Boolean));
  let messages = (Array.isArray(product.attentionMessages) ? product.attentionMessages : [])
    .map((value) => String(value || "").trim()).filter(Boolean);

  if (reconciliationRequired) {
    reasonCodes.add("BALANCE_RECONCILIATION_REQUIRED");
    if (!messages.some((message) => /mutabakat|güvenli şekilde dönüştürülemedi/i.test(message))) {
      messages.push("Eski stok bakiyesi yeni birime güvenli şekilde dönüştürülemedi. Sayım/mutabakat gerekli.");
    }
  } else {
    reasonCodes.delete("BALANCE_RECONCILIATION_REQUIRED");
    messages = messages.filter((message) => !/mutabakat|eski stok bakiyesi yeni birime güvenli şekilde dönüştürülemedi/i.test(message));
  }

  if (baseUnitMissing || product.excelSourceBaseUnitMissing === true) {
    reasonCodes.add("MISSING_BASE_UNIT");
    messages = messages.filter((message) => !/temel birim.*eksik/i.test(message));
    messages.push(product.excelSourceBaseUnitMissing === true
      ? "Excel dosyasında temel birim eksik." + (baseUnitMissing ? "" : " Mevcut temel birim korunuyor.")
      : "Temel birim eksik.");
  } else {
    reasonCodes.delete("MISSING_BASE_UNIT");
    messages = messages.filter((message) => !/temel birim.*eksik/i.test(message));
  }

  messages = Array.from(new Set(messages));
  if (!messages.length) reasonCodes.delete("EXCEL_IMPORT_WARNING");
  product.attentionReasons = Array.from(reasonCodes);
  product.attentionMessages = messages;
  product.needsAttention = product.attentionReasons.length > 0 || messages.length > 0;
  product.stockQuantityReconciliationRequired = reconciliationRequired;
  return reconciliationRequired;
}

function updateProductTotalProjection(state, productId, timestamp) {
  const product = state.products.find((item) => String(item.id) === String(productId));
  if (!product) return;
  const total = calculateTotalStock(state, productId);
  const reconciliationRequired = refreshProductAttentionState(state, product);
  product.stockQuantity = total;
  product.stockQuantityText = reconciliationRequired
    ? "Mutabakat gerekiyor"
    : `${total} ${productUnitMetadata(product).baseUnit || "birim tanımsız"}`;
  product.updatedAt = timestamp || product.updatedAt || null;
}

function updateAllProductTotals(state, timestamp) {
  for (const product of state.products || []) updateProductTotalProjection(state, product.id, timestamp);
}

function convertToBaseUnit(quantity, requestedUnit, product) {
  const metadata = productUnitMetadata(product);
  const baseUnit = metadata.baseUnit;
  const inputUnit = normalizeUnit(requestedUnit || baseUnit);
  const sourceQuantity = finitePositive(quantity);
  if (!sourceQuantity) throw stockError("Geçerli bir miktar girin.", 422);
  if (!metadata.allowDecimal && !Number.isInteger(sourceQuantity)) {
    throw stockError(`${productName(product)} için kesirli miktar kullanılamaz.`, 422);
  }
  if (!allowedProductUnits(product).includes(inputUnit)) {
    throw stockError(`“${inputUnit}” birimi bu ürün için kullanılamaz.`, 422);
  }
  let result;
  if (!baseUnit || inputUnit === baseUnit) result = { quantity: round(sourceQuantity), factor: 1, baseUnit };
  const mass = { kg: 1000, gr: 1 };
  const volume = { litre: 1000, ml: 1 };
  if (!result && mass[inputUnit] && mass[baseUnit]) {
    const factor = mass[inputUnit] / mass[baseUnit];
    result = { quantity: round(sourceQuantity * factor), factor, baseUnit };
  }
  if (!result && volume[inputUnit] && volume[baseUnit]) {
    const factor = volume[inputUnit] / volume[baseUnit];
    result = { quantity: round(sourceQuantity * factor), factor, baseUnit };
  }
  if (!result && inputUnit === metadata.bulkUnit && metadata.unitsPerBulkUnit > 0) {
    result = {
      quantity: round(sourceQuantity * metadata.unitsPerBulkUnit),
      factor: metadata.unitsPerBulkUnit,
      baseUnit,
      packageInfo: `1 ${metadata.bulkUnit} = ${metadata.unitsPerBulkUnit} ${baseUnit}`
    };
  }
  if (!result) throw stockError(`“${inputUnit}” birimi bu ürünün stok birimi “${baseUnit}” ile uyumlu değil.`, 422);
  if (!metadata.allowDecimal && !Number.isInteger(result.quantity)) {
    throw stockError(`${productName(product)} için kesirli ${baseUnit} miktarı kullanılamaz.`, 422);
  }
  return {
    ...result,
    inputQuantity: sourceQuantity,
    inputUnit,
    bulkUnit: metadata.bulkUnit,
    unitsPerBulkUnit: metadata.unitsPerBulkUnit,
    allowDecimal: metadata.allowDecimal
  };
}

function formatBaseQuantity(product, value) {
  const metadata = productUnitMetadata(product);
  const quantity = Math.max(0, round(Number(value || 0)));
  if (!metadata.bulkUnit || metadata.unitsPerBulkUnit <= 0) {
    return { baseQuantity: quantity, bulkQuantity: 0, remainderQuantity: quantity, display: `${quantity} ${metadata.baseUnit || "birim tanımsız"}` };
  }
  const bulkQuantity = Math.floor((quantity + Number.EPSILON) / metadata.unitsPerBulkUnit);
  const remainderQuantity = round(quantity - bulkQuantity * metadata.unitsPerBulkUnit);
  return {
    baseQuantity: quantity,
    bulkQuantity,
    remainderQuantity,
    display: remainderQuantity > 0
      ? `${bulkQuantity} ${metadata.bulkUnit} + ${remainderQuantity} ${metadata.baseUnit}`
      : `${bulkQuantity} ${metadata.bulkUnit}`,
    conversionText: `1 ${metadata.bulkUnit} = ${metadata.unitsPerBulkUnit} ${metadata.baseUnit}`
  };
}

function balanceUnitMetadata(product, balance = {}) {
  if (balance.reconciliationRequired !== true) return productUnitMetadata(product);
  return {
    baseUnit: controlledUnit(balance.baseUnitSnapshot || balance.previousBaseUnit || "", ""),
    bulkUnit: controlledUnit(balance.bulkUnitSnapshot || "", ""),
    unitsPerBulkUnit: Math.max(0, Number(balance.unitsPerBulkUnitSnapshot || 0)),
    allowDecimal: true,
    defaultMovementUnit: controlledUnit(balance.baseUnitSnapshot || balance.previousBaseUnit || "", "")
  };
}

function formatBalanceQuantity(product, balance = {}, value = balance.quantity) {
  if (balance.aggregateReconciliationRequired === true) {
    return { baseQuantity: null, bulkQuantity: null, remainderQuantity: null, display: "Mutabakat gerekiyor", reconciliationRequired: true };
  }
  const metadata = balanceUnitMetadata(product, balance);
  return {
    ...formatBaseQuantity({ ...product, ...metadata, unit: metadata.baseUnit, caseUnit: metadata.bulkUnit, unitsPerCase: metadata.unitsPerBulkUnit }, value),
    reconciliationRequired: balance.reconciliationRequired === true,
    baseUnitSnapshot: metadata.baseUnit
  };
}

function stockExcelUnitDetail(metadata = {}) {
  const baseUnit = controlledUnit(metadata.baseUnit || "", "");
  const bulkUnit = controlledUnit(metadata.bulkUnit || "", "");
  const unitsPerBulkUnit = round(Number(metadata.unitsPerBulkUnit || 0));
  return {
    baseUnit,
    bulkUnit,
    unitsPerBulkUnit,
    display: bulkUnit && unitsPerBulkUnit > 0
      ? `1 ${bulkUnit} = ${unitsPerBulkUnit} ${baseUnit}`
      : baseUnit || "Tanımsız"
  };
}

function stockExcelThresholdDetail(balance = {}) {
  return {
    criticalThreshold: round(Number(balance.criticalThreshold || 0)),
    orderThreshold: round(Number(balance.orderThreshold || 0)),
    targetLevel: round(Number(balance.targetLevel || 0))
  };
}

function stockExcelSkippedDetail(item = {}) {
  return {
    category: String(item.category || "").slice(0, 120),
    productName: String(item.productName || item.product || "").slice(0, 180),
    reason: String(item.reason || "Ürün içe aktarılamadı.").slice(0, 500)
  };
}

function stockExcelAttentionDetail(item = {}) {
  const reasons = Array.isArray(item.reasons) ? item.reasons : [item.reason];
  const reasonCodes = Array.isArray(item.reasonCodes) ? item.reasonCodes : [item.reasonCode];
  const messages = Array.from(new Set(reasons.map((reason) => String(reason || "").trim()).filter(Boolean))).slice(0, 20);
  const codes = Array.from(new Set(reasonCodes.map((code) => String(code || "").trim()).filter(Boolean))).slice(0, 20);
  return {
    productId: String(item.productId || ""),
    locationId: String(item.locationId || ""),
    categoryId: String(item.categoryId || ""),
    category: String(item.category || "").slice(0, 120),
    categoryName: String(item.categoryName || item.category || "").slice(0, 120),
    productName: String(item.productName || item.product || "").slice(0, 180),
    productCode: String(item.productCode || "").slice(0, 80),
    locationName: String(item.locationName || "").slice(0, 120),
    reasonCodes: codes,
    reasons: messages,
    reasonCode: codes[0] || "EXCEL_IMPORT_WARNING",
    message: String(messages[0] || "Ürün ayarları kontrol edilmeli.").slice(0, 500),
    reason: String(messages[0] || "Ürün ayarları kontrol edilmeli.").slice(0, 500)
  };
}

function emptyStockExcelDetails(errors = []) {
  const attentionProducts = [];
  return {
    updatedProducts: [],
    createdProducts: [],
    createdCategories: [],
    balanceChanges: [],
    attentionProducts,
    attentionItems: attentionProducts,
    skippedProducts: errors.map(stockExcelSkippedDetail)
  };
}

function unitSchemaMigrationFactor(currentMetadata, targetMetadata, hasStoredData) {
  if (currentMetadata.baseUnit === targetMetadata.baseUnit) return 1;
  if (targetMetadata.bulkUnit === currentMetadata.baseUnit && targetMetadata.unitsPerBulkUnit > 0) {
    return targetMetadata.unitsPerBulkUnit;
  }
  if (currentMetadata.bulkUnit === targetMetadata.baseUnit && currentMetadata.unitsPerBulkUnit > 0) {
    return 1 / currentMetadata.unitsPerBulkUnit;
  }
  const measures = {
    kg: { group: "mass", factor: 1000 }, g: { group: "mass", factor: 1 }, gr: { group: "mass", factor: 1 },
    litre: { group: "volume", factor: 1000 }, liter: { group: "volume", factor: 1000 }, lt: { group: "volume", factor: 1000 }, l: { group: "volume", factor: 1000 },
    ml: { group: "volume", factor: 1 }
  };
  const currentMeasure = measures[currentMetadata.baseUnit];
  const targetMeasure = measures[targetMetadata.baseUnit];
  if (currentMeasure && targetMeasure && currentMeasure.group === targetMeasure.group) {
    return round(currentMeasure.factor / targetMeasure.factor);
  }
  if (!hasStoredData) return 1;
  throw stockError("Temel birimler arasında güvenli dönüşüm oranı kurulamadı.", 422);
}

function safeUnitSchemaMigrationFactor(currentMetadata, targetMetadata, hasStoredData) {
  try {
    return { factor: unitSchemaMigrationFactor(currentMetadata, targetMetadata, hasStoredData), reason: "" };
  } catch (error) {
    if (!hasStoredData) return { factor: 1, reason: "" };
    return { factor: null, reason: error && error.message || "Güvenilir birim dönüşüm oranı bulunamadı." };
  }
}

function unitMigrationTarget(product, input = {}) {
  const current = productUnitMetadata(product);
  const baseUnit = controlledUnit(input.targetBaseUnit ?? input.baseUnit, "");
  const bulkUnit = controlledUnit(input.targetBulkUnit ?? input.bulkUnit, "");
  const unitsPerBulkUnit = bulkUnit
    ? finitePositive(input.unitsPerBulkUnit ?? input.unitsPerCase)
    : 0;
  if (!baseUnit) throw stockError("Yeni temel birim zorunludur.", 422);
  if (bulkUnit && !unitsPerBulkUnit) throw stockError("Toplu birim dönüşümü sıfırdan büyük olmalıdır.", 422);
  if (bulkUnit && bulkUnit === baseUnit) throw stockError("Temel ve toplu birim aynı olamaz.", 422);
  const allowDecimal = input.allowDecimal === undefined
    ? current.allowDecimal
    : input.allowDecimal === true;
  const requestedDefault = controlledUnit(input.defaultMovementUnit || current.defaultMovementUnit || baseUnit, baseUnit);
  const defaultMovementUnit = requestedDefault === bulkUnit && bulkUnit && unitsPerBulkUnit > 0
    ? bulkUnit
    : baseUnit;
  return { baseUnit, bulkUnit, unitsPerBulkUnit: unitsPerBulkUnit || 0, allowDecimal, defaultMovementUnit };
}

function unitMigrationProduct(state, productId, options = {}) {
  const product = (state.products || []).find((item) => String(item.id) === String(productId));
  if (!product) throw stockError("Stok ürünü bulunamadı.", 404);
  if (options.allowInactive !== true && (product.active === false || product.sourcePresent === false || product.archivedAt)) {
    throw stockError("Stok ürünü aktif katalogda bulunamadı.", 409);
  }
  return product;
}

function buildUnitMigrationPlan(stockState, productId, input = {}, options = {}) {
  const state = normalizeState(stockState);
  const product = unitMigrationProduct(state, productId, options);
  const current = productUnitMetadata(product, { allowDefaultBaseUnit: false });
  const target = unitMigrationTarget(product, input);
  const balances = (state.balances || []).filter((item) => String(item.productId) === String(product.id));
  const hasHistory = (state.movements || []).some((item) => String(item.productId || item.stockProductId) === String(product.id));
  const baseChanged = current.baseUnit !== target.baseUnit;
  const targetProduct = { ...product, ...target, unit: target.baseUnit, caseUnit: target.bulkUnit, unitsPerCase: target.unitsPerBulkUnit };
  const locations = balances.map((balance) => {
    const snapshotBaseUnit = controlledUnit(balance.baseUnitSnapshot || balance.previousBaseUnit || "", "");
    const hasDistinctBalanceSchema = Boolean(snapshotBaseUnit && snapshotBaseUnit !== current.baseUnit);
    const sourceSchema = balance.reconciliationRequired === true || hasDistinctBalanceSchema
      ? {
          ...current,
          baseUnit: snapshotBaseUnit || current.baseUnit,
          bulkUnit: controlledUnit(balance.bulkUnitSnapshot || "", ""),
          unitsPerBulkUnit: Math.max(0, Number(balance.unitsPerBulkUnitSnapshot || 0))
        }
      : current;
    const storedValues = [balance.quantity, balance.criticalThreshold, balance.orderThreshold, balance.targetLevel];
    const hasStoredData = Number(balance.quantity || 0) !== 0;
    const locationBaseChanged = sourceSchema.baseUnit !== target.baseUnit;
    const requiresMigration = locationBaseChanged || balance.reconciliationRequired === true || hasDistinctBalanceSchema;
    const resolved = locationBaseChanged
      ? safeUnitSchemaMigrationFactor(sourceSchema, target, hasStoredData)
      : { factor: 1, reason: "" };
    const converted = (value) => round(Number(value || 0) * Number(resolved.factor === null ? 1 : resolved.factor));
    const wouldLosePrecision = resolved.factor !== null && !target.allowDecimal
      && storedValues.some((value) => !Number.isInteger(converted(value)));
    const decision = !hasStoredData
      ? "NO_BALANCE"
      : resolved.factor === null || wouldLosePrecision
        ? "RECONCILIATION_REQUIRED"
        : "SAFE_CONVERSION";
    const reason = wouldLosePrecision
      ? `Yeni “${target.baseUnit}” birimi için dönüşüm kesirli bakiye üretiyor.`
      : resolved.reason;
    const currentProduct = { ...product, ...sourceSchema, unit: sourceSchema.baseUnit, caseUnit: sourceSchema.bulkUnit, unitsPerCase: sourceSchema.unitsPerBulkUnit };
    return {
      locationId: String(balance.locationId || ""),
      locationName: (state.locations || []).find((item) => String(item.id) === String(balance.locationId))?.name || "Depo",
      requiresMigration,
      decision,
      reason,
      factor: resolved.factor,
      sourceSchema,
      current: {
        quantity: round(Number(balance.quantity || 0)),
        criticalThreshold: round(Number(balance.criticalThreshold || 0)),
        orderThreshold: round(Number(balance.orderThreshold || 0)),
        targetLevel: round(Number(balance.targetLevel || 0)),
        display: formatBaseQuantity(currentProduct, balance.quantity).display
      },
      next: {
        quantity: decision === "RECONCILIATION_REQUIRED" ? round(Number(balance.quantity || 0)) : converted(balance.quantity),
        criticalThreshold: decision === "RECONCILIATION_REQUIRED" ? round(Number(balance.criticalThreshold || 0)) : converted(balance.criticalThreshold),
        orderThreshold: decision === "RECONCILIATION_REQUIRED" ? round(Number(balance.orderThreshold || 0)) : converted(balance.orderThreshold),
        targetLevel: decision === "RECONCILIATION_REQUIRED" ? round(Number(balance.targetLevel || 0)) : converted(balance.targetLevel),
        display: decision === "RECONCILIATION_REQUIRED"
          ? `${formatBaseQuantity(currentProduct, balance.quantity).display} · Mutabakat gerekiyor`
          : formatBaseQuantity(targetProduct, converted(balance.quantity)).display
      }
    };
  });
  const safeFactors = Array.from(new Set(locations.filter((item) => item.factor !== null).map((item) => Number(item.factor))));
  const factor = safeFactors.length === 1 ? safeFactors[0] : null;
  const currentTotal = round(balances.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  const reconciliationRequired = locations.some((item) => item.decision === "RECONCILIATION_REQUIRED");
  const requiresBalanceMigration = locations.some((item) => item.requiresMigration);
  const nextTotal = reconciliationRequired
    ? null
    : round(locations.reduce((sum, item) => sum + Number(item.next.quantity || 0), 0));
  return {
    productId: String(product.id),
    productName: productName(product),
    baseChanged,
    requiresBalanceMigration,
    factor,
    hasHistory,
    currentSchema: current,
    targetSchema: target,
    currentTotal,
    nextTotal,
    currentDisplay: locations.some((item) => item.requiresMigration && item.sourceSchema.baseUnit !== current.baseUnit)
      ? "Depo bazlı eski birim bakiyeleri"
      : formatBaseQuantity(product, currentTotal).display,
    nextDisplay: reconciliationRequired ? "Mutabakat gerekiyor" : formatBaseQuantity(targetProduct, nextTotal).display,
    reconciliationRequired,
    locations
  };
}

function migrateProductUnitSchema(stockState, productId, input = {}, options = {}) {
  if (input.confirm !== true) throw stockError("Birim dönüşümü için açık onay gereklidir.", 422);
  const state = normalizeState(stockState);
  const plan = buildUnitMigrationPlan(state, productId, input, options);
  if (plan.reconciliationRequired && options.allowReconciliation !== true) {
    throw stockError("Bazı depo bakiyeleri yeni temel birime güvenli biçimde dönüştürülemiyor. Stok sayımı veya manuel mutabakat gerekli.", 422);
  }
  const product = unitMigrationProduct(state, productId, options);
  const timestamp = nowIso(options.now);
  const unitSchemaVersion = recordProductUnitSchemaTransition(product, plan.targetSchema, timestamp);
  if (plan.requiresBalanceMigration) {
    for (const locationPlan of plan.locations) {
      if (!locationPlan.requiresMigration) continue;
      const balance = (state.balances || []).find((item) => String(item.productId) === String(product.id)
        && String(item.locationId) === String(locationPlan.locationId));
      if (!balance) continue;
      if (locationPlan.decision === "RECONCILIATION_REQUIRED") {
        balance.reconciliationRequired = true;
        balance.reconciliationReasonCode = "BALANCE_RECONCILIATION_REQUIRED";
        balance.reconciliationReason = locationPlan.reason || "Güvenilir birim dönüşüm oranı bulunamadı.";
        balance.previousQuantity = locationPlan.current.quantity;
        balance.previousBaseUnit = locationPlan.sourceSchema.baseUnit;
        balance.targetBaseUnit = plan.targetSchema.baseUnit;
        balance.baseUnitSnapshot = locationPlan.sourceSchema.baseUnit;
        balance.bulkUnitSnapshot = locationPlan.sourceSchema.bulkUnit || "";
        balance.unitsPerBulkUnitSnapshot = Number(locationPlan.sourceSchema.unitsPerBulkUnit || 0);
        balance.reconciliationCreatedAt = balance.reconciliationCreatedAt || timestamp;
        balance.reconciliationResolvedAt = null;
      } else {
        for (const field of ["quantity", "criticalThreshold", "orderThreshold", "targetLevel"]) {
          balance[field] = locationPlan.next[field];
        }
        balance.reconciliationRequired = false;
        balance.reconciliationReasonCode = "";
        balance.reconciliationReason = "";
        balance.previousQuantity = null;
        balance.previousBaseUnit = "";
        balance.targetBaseUnit = "";
        balance.baseUnitSnapshot = plan.targetSchema.baseUnit;
        balance.bulkUnitSnapshot = plan.targetSchema.bulkUnit || "";
        balance.unitsPerBulkUnitSnapshot = Number(plan.targetSchema.unitsPerBulkUnit || 0);
        balance.unitSchemaVersionAtBalance = unitSchemaVersion;
        balance.reconciliationResolvedAt = balance.reconciliationCreatedAt ? timestamp : null;
        balance.reconciliationCreatedAt = null;
      }
      balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
      balance.updatedAt = timestamp;
      state.migrationAudit = (Array.isArray(state.migrationAudit) ? state.migrationAudit : []).concat({
        id: `stock-unit-location-${crypto.randomUUID()}`,
        type: "unit_schema_migration",
        decision: locationPlan.decision,
        productId: product.id,
        locationId: balance.locationId,
        oldQuantity: locationPlan.current.quantity,
        newQuantity: locationPlan.next.quantity,
        oldBaseUnit: locationPlan.sourceSchema.baseUnit,
        newBaseUnit: plan.targetSchema.baseUnit,
        conversionRatio: locationPlan.factor,
        source: String(options.source || "manual"),
        requestId: String(options.requestId || input.requestId || ""),
        actorId: String(options.actorId || "system"),
        createdAt: timestamp
      }).slice(-2000);
    }
    if (plan.baseChanged && !plan.reconciliationRequired && Number.isFinite(Number(plan.factor))) {
      for (const field of ["catalogCriticalThreshold", "criticalThreshold", "catalogOrderThreshold", "orderThreshold", "targetLevel", "targetStock"]) {
        if (Number.isFinite(Number(product[field]))) product[field] = round(Number(product[field]) * plan.factor);
      }
    }
  }
  Object.assign(product, {
    baseUnit: plan.targetSchema.baseUnit,
    unit: plan.targetSchema.baseUnit,
    bulkUnit: plan.targetSchema.bulkUnit,
    caseUnit: plan.targetSchema.bulkUnit,
    unitsPerBulkUnit: plan.targetSchema.unitsPerBulkUnit,
    unitsPerCase: plan.targetSchema.unitsPerBulkUnit,
    allowDecimal: plan.targetSchema.allowDecimal,
    defaultMovementUnit: plan.targetSchema.defaultMovementUnit,
    unitSchemaVersion,
    unitSchemaSource: options.source === "excel_import" ? "excel" : "manual",
    unitSchemaLocked: options.source === "excel_import" ? product.unitSchemaLocked === true : true,
    unitSchemaUpdatedAt: timestamp,
    updatedAt: timestamp
  });
  if (plan.targetSchema.baseUnit) {
    product.baseUnitMissing = false;
    product.excelBaseUnitMissing = false;
    if (options.source !== "excel_import" && (input.targetBaseUnit || input.baseUnit || input.unit)) product.excelSourceBaseUnitMissing = false;
  }
  updateProductTotalProjection(state, product.id, timestamp);
  state.updatedAt = timestamp;
  return { state, plan, product };
}

function operationKey(type, requestId) {
  const key = String(requestId || "").trim();
  return key ? `${type}:${key}` : "";
}

function idempotentRecord(state, type, requestId) {
  const key = operationKey(type, requestId);
  if (!key) return null;
  return (state.operationKeys || []).find((item) => item && item.key === key) || null;
}

function recordOperation(state, type, requestId, value, timestamp) {
  const key = operationKey(type, requestId);
  if (!key) return;
  state.operationKeys = (Array.isArray(state.operationKeys) ? state.operationKeys : [])
    .concat({ key, type, requestId: String(requestId), value, createdAt: timestamp })
    .slice(-OPERATION_LIMIT);
}

function movementDirection(type, input = {}) {
  if (type === "manual_in" || type === "stock_in" || type === "inbound_shipment" || type === "shipment_in" || type === "opening_balance" || type === "transfer_in") return 1;
  if (type === "manual_out" || type === "stock_out" || type === "waste") return -1;
  if (type === "transfer_out") return -1;
  if (type === "adjustment" || type === "correction") return Number(input.delta) < 0 ? -1 : 1;
  return 0;
}

function addMovement(state, input) {
  const product = (state.products || []).find((item) => String(item.id) === String(input.productId));
  const fallbackBaseUnit = productUnitMetadata(product || {}).baseUnit;
  const movementBaseUnit = String(input.baseUnit ?? fallbackBaseUnit ?? "");
  const movementInputUnit = String(input.inputUnit || input.sourceUnit || movementBaseUnit);
  const requestedSnapshotVersion = Number(input.unitSchemaVersion
    ?? (input.conversionSnapshot && input.conversionSnapshot.unitSchemaVersion)
    ?? (product && product.unitSchemaVersion)
    ?? 1);
  const snapshotVersion = Number.isInteger(requestedSnapshotVersion) && requestedSnapshotVersion > 0
    ? requestedSnapshotVersion
    : 1;
  const conversionSnapshot = input.conversionSnapshot && typeof input.conversionSnapshot === "object"
    ? { ...input.conversionSnapshot, unitSchemaVersion: snapshotVersion }
    : {
        baseUnit: movementBaseUnit,
        bulkUnit: String(input.bulkUnit || ""),
        unitsPerBulkUnit: Number(input.unitsPerBulkUnit || 0),
        inputUnit: movementInputUnit,
        factor: Number.isFinite(Number(input.conversionFactor)) ? Number(input.conversionFactor) : 1,
        unitSchemaVersion: snapshotVersion
      };
  const movement = {
    id: input.id || createId("stock-movement"),
    type: input.type,
    status: input.status || "approved",
    productId: String(input.productId),
    stockProductId: String(input.productId),
    stockProductCode: normalizeProductCode(input.stockProductCode),
    productCode: normalizeProductCode(input.stockProductCode),
    productName: String(input.productName || ""),
    fromLocationId: input.fromLocationId ? String(input.fromLocationId) : null,
    toLocationId: input.toLocationId ? String(input.toLocationId) : null,
    sourceLocationId: input.fromLocationId ? String(input.fromLocationId) : null,
    destinationLocationId: input.toLocationId ? String(input.toLocationId) : null,
    locationId: input.locationId ? String(input.locationId) : null,
    quantity: round(Number(input.quantity || 0)),
    baseQuantity: round(Math.abs(Number(input.baseQuantity ?? input.quantity ?? input.baseQuantityDelta ?? 0))),
    baseUnit: movementBaseUnit,
    unit: movementBaseUnit,
    sourceQuantity: round(Number(input.sourceQuantity || input.quantity || 0)),
    sourceUnit: String(input.sourceUnit || movementBaseUnit),
    inputQuantity: round(Number(input.inputQuantity ?? input.sourceQuantity ?? input.quantity ?? 0)),
    inputUnit: movementInputUnit,
    baseQuantityDelta: round(Number(input.baseQuantityDelta ?? (Number(input.resultingBalance || 0) - Number(input.previousBalance || 0)))),
    unitSchemaVersion: snapshotVersion,
    conversionFactor: Number.isFinite(Number(input.conversionFactor)) ? Number(input.conversionFactor) : 1,
    conversionSnapshot,
    previousBalance: round(Number(input.previousBalance || 0)),
    resultingBalance: round(Number(input.resultingBalance || 0)),
    // Legacy aliases keep historical consumers operational while all new data
    // uses location-aware balance names above.
    previousStock: round(Number(input.previousBalance || 0)),
    resultingStock: round(Number(input.resultingBalance || 0)),
    referenceType: String(input.referenceType || ""),
    referenceId: String(input.referenceId || ""),
    transferId: String(input.transferId || input.referenceType === "transfer" && input.referenceId || ""),
    shipmentId: String(input.shipmentId || ""),
    requestId: String(input.requestId || ""),
    idempotencyKey: String(input.idempotencyKey || input.requestId || ""),
    expectedRevision: input.expectedRevision === undefined || input.expectedRevision === null
      ? null
      : Math.max(0, Math.trunc(Number(input.expectedRevision) || 0)),
    transactionRef: String(input.transactionRef || ""),
    actorId: String(input.actor && input.actor.id || input.actorId || ""),
    actorRole: String(input.actor && input.actor.type || input.actorRole || "system"),
    actor: input.actor && (input.actor.name || input.actor.id) || String(input.actorName || "system"),
    personnelId: String(input.personnelId || input.actor && input.actor.type === "personel" && input.actor.id || ""),
    approvedBy: String(input.approvedBy || input.actor && input.actor.type === "admin" && input.actor.id || ""),
    note: String(input.note || "").trim().slice(0, 500),
    reason: String(input.reason || "").trim().slice(0, 240),
    createdAt: input.createdAt || nowIso(),
    approvedAt: input.approvedAt || input.createdAt || nowIso(),
    reversedMovementId: input.reversedMovementId || null
  };
  state.movements = [movement, ...(state.movements || [])].slice(0, MOVEMENT_LIMIT);
  return movement;
}

function applyStockMovement(stockState, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const requestedType = String(input.type || "").trim();
  const type = actor && actor.type === "personel" && actor.inventoryManage !== true
    ? ({ consumption: "waste", adjustment_out: "manual_out", stock_out: "manual_out" }[requestedType] || requestedType)
    : requestedType;
  if (!MOVEMENT_TYPES.has(type)) throw stockError("Geçersiz stok hareket türü.", 422);
  if (!actor || !["admin", "personel"].includes(actor.type)) {
    throw stockError("Stok işlemi için yetkili kullanıcı gerekli.", 403);
  }
  if (actor.type === "personel" && actor.inventoryManage !== true && !PERSONNEL_OUT_MOVEMENT_TYPES.has(type)) {
    throw stockError("Personel yalnızca Sarf İşle veya Eksilt hareketi oluşturabilir.", 403);
  }
  const duplicate = idempotentRecord(state, "movement", requestId);
  if (duplicate) {
    const movement = (state.movements || []).find((item) => String(item.id) === String(duplicate.value && duplicate.value.movementId));
    return { stockState: state, movement: movement || null, idempotent: true };
  }
  const product = getProduct(state, input.productId || input.stockProductId, input.productCode || input.stockProductCode);
  requireProductBaseUnit(product);
  const locationId = String(input.locationId || options.locationId || actorLocationId(state, actor) || "").trim();
  const location = getLocation(state, locationId);
  if (actor && actor.type !== "admin" && actor.inventoryManage !== true && String(actorLocationId(state, actor)) !== location.id) {
    throw stockError("Bu stok lokasyonunda işlem yetkiniz yok.", 403);
  }
  const balance = findBalance(state, location.id, product.id, true);
  const reconciliationResolution = balance.reconciliationRequired === true
    && ["adjustment", "correction"].includes(type)
    && ["stock_count", "manual_adjustment", "reconciliation"].includes(String(input.referenceType || ""));
  if (balance.reconciliationRequired === true && !reconciliationResolution) {
    throw stockError("Bu depo bakiyesi birim mutabakatı gerektiriyor. Önce stok sayımı veya manuel düzeltme yapın.", 409);
  }
  const sourceQuantity = finitePositive(input.quantity);
  if (!sourceQuantity) throw stockError("Geçerli bir miktar girin.", 422);
  const conversion = convertToBaseUnit(sourceQuantity, input.unit || product.unit, product);
  const delta = movementDirection(type, input) * conversion.quantity;
  if (!delta) throw stockError("Bu hareket türü için geçerli miktar değişimi gerekli.");
  if (input.expectedBalanceRevision !== undefined && input.expectedBalanceRevision !== null && input.expectedBalanceRevision !== "") {
    const expectedBalanceRevision = Number(input.expectedBalanceRevision);
    if (!Number.isInteger(expectedBalanceRevision) || expectedBalanceRevision < 0) throw stockError("Beklenen ürün-depo revision geçersiz.", 422);
    if (expectedBalanceRevision !== Math.max(0, Number(balance.revision || 0))) {
      throw stockError("Ürün-depo bakiyesi başka bir işlemle güncellendi. Yenileyip tekrar deneyin.", 409);
    }
  }
  const previous = round(Number(balance.quantity || 0));
  const resulting = round(previous + delta);
  if (resulting < 0) throw stockError("Stok miktarı eksiye düşemez.", 409);
  const timestamp = nowIso(options.now);
  balance.quantity = resulting;
  balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
  balance.updatedAt = timestamp;
  if (reconciliationResolution) {
    balance.reconciliationRequired = false;
    balance.reconciliationReasonCode = "";
    balance.reconciliationReason = "";
    balance.previousQuantity = null;
    balance.previousBaseUnit = "";
    balance.targetBaseUnit = "";
    balance.baseUnitSnapshot = productUnitMetadata(product).baseUnit;
    balance.bulkUnitSnapshot = productUnitMetadata(product).bulkUnit;
    balance.unitsPerBulkUnitSnapshot = productUnitMetadata(product).unitsPerBulkUnit;
    balance.unitSchemaVersionAtBalance = Math.max(1, Number(product.unitSchemaVersion || 1));
    balance.reconciliationResolvedAt = timestamp;
    balance.reconciliationCreatedAt = null;
  }
  if (input.criticalThreshold !== undefined) balance.criticalThreshold = Math.max(0, Number(input.criticalThreshold) || 0);
  if (input.orderThreshold !== undefined) balance.orderThreshold = Math.max(0, Number(input.orderThreshold) || 0);
  if (input.targetLevel !== undefined) balance.targetLevel = Math.max(0, Number(input.targetLevel) || 0);
  const movement = addMovement(state, {
    type,
    productId: product.id,
    stockProductCode: product.productCode,
    productName: productName(product),
    locationId: location.id,
    fromLocationId: delta < 0 ? location.id : null,
    toLocationId: delta > 0 ? location.id : null,
    quantity: Math.abs(conversion.quantity), baseUnit: conversion.baseUnit,
    sourceQuantity, sourceUnit: conversion.inputUnit, inputQuantity: sourceQuantity, inputUnit: conversion.inputUnit,
    baseQuantityDelta: delta, conversionFactor: conversion.factor,
    unitSchemaVersion: Math.max(1, Number(product.unitSchemaVersion || 1)),
    conversionSnapshot: { baseUnit: conversion.baseUnit, bulkUnit: conversion.bulkUnit, unitsPerBulkUnit: conversion.unitsPerBulkUnit, inputUnit: conversion.inputUnit, factor: conversion.factor, unitSchemaVersion: Math.max(1, Number(product.unitSchemaVersion || 1)) },
    previousBalance: previous, resultingBalance: resulting,
    expectedRevision: input.expectedBalanceRevision,
    referenceType: input.referenceType || "manual", referenceId: input.referenceId,
    shipmentId: input.shipmentId,
    transactionRef: input.transactionRef,
    personnelId: input.personnelId,
    approvedBy: input.approvedBy,
    requestId, idempotencyKey: requestId, actor,
    note: input.note, reason: input.reason, createdAt: timestamp, approvedAt: timestamp
  });
  updateProductTotalProjection(state, product.id, timestamp);
  state.updatedAt = timestamp;
  recordOperation(state, "movement", requestId, { movementId: movement.id }, timestamp);
  return { stockState: normalizeState(state), movement, idempotent: false };
}

function assertTransferLocations(state, fromLocationId, toLocationId) {
  const from = getLocation(state, fromLocationId);
  const to = getLocation(state, toLocationId);
  if (from.id === to.id) throw stockError("Kaynak ve hedef depo aynı olamaz.");
  return { from, to };
}

function serializeTransfer(state, transfer) {
  if (!transfer) return null;
  const transferItems = Array.isArray(transfer.items) && transfer.items.length
    ? transfer.items
    : [{
        productId: transfer.productId,
        quantity: transfer.quantity,
        baseUnit: transfer.baseUnit,
        sourceQuantity: transfer.sourceQuantity,
        sourceUnit: transfer.sourceUnit,
        conversionFactor: transfer.conversionFactor,
        conversionSnapshot: transfer.conversionSnapshot,
        sourceExpectedRevision: transfer.sourceExpectedRevision,
        destinationExpectedRevision: transfer.destinationExpectedRevision
      }];
  const serializedItems = transferItems.map((item) => {
    const product = (state.products || []).find((candidate) => String(candidate.id) === String(item.productId));
    return {
      ...item,
      product: product ? { id: product.id, name: productName(product), productName: productName(product), unit: product.unit, productCode: product.productCode || "" } : null,
      fromBalance: getProductBalance(state, transfer.fromLocationId, item.productId),
      toBalance: getProductBalance(state, transfer.toLocationId, item.productId)
    };
  });
  const product = serializedItems[0] && serializedItems[0].product;
  const fromLocation = getLocations(state, { includeInactive: true }).find((item) => String(item.id) === String(transfer.fromLocationId));
  const toLocation = getLocations(state, { includeInactive: true }).find((item) => String(item.id) === String(transfer.toLocationId));
  return {
    ...transfer,
    items: serializedItems,
    itemCount: serializedItems.length,
    product: product || null,
    fromLocation: fromLocation || null,
    toLocation: toLocation || null,
    fromBalance: serializedItems[0] && serializedItems[0].fromBalance || null,
    toBalance: serializedItems[0] && serializedItems[0].toBalance || null
  };
}

function createTransferRequest(stockState, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  if (actor && actor.type !== "admin" && actor.inventoryTransfer !== true) {
    throw stockError("Depolar arası transfer işlemi Yönetici yetkisi gerektirir.", 403);
  }
  const duplicate = idempotentRecord(state, "transfer_create", requestId);
  if (duplicate) {
    const transfer = (state.transfers || []).find((item) => String(item.id) === String(duplicate.value && duplicate.value.transferId));
    return { stockState: state, transfer: serializeTransfer(state, transfer), idempotent: true };
  }
  const fromLocationId = String(input.fromLocationId || options.fromLocationId || defaultGeneralLocation(state) && defaultGeneralLocation(state).id || "").trim();
  const toLocationId = String(input.toLocationId || options.toLocationId || actorLocationId(state, actor) || "").trim();
  const { from, to } = assertTransferLocations(state, fromLocationId, toLocationId);
  const rawItems = Array.isArray(input.items) && input.items.length ? input.items : [input];
  const seenProducts = new Set();
  const items = rawItems.map((item) => {
    const product = getProduct(state, item.productId || item.stockProductId, item.productCode || item.stockProductCode);
    requireProductBaseUnit(product);
    if (seenProducts.has(String(product.id))) throw stockError("Aynı ürün bir transferde yalnızca bir kez bulunabilir.", 409);
    seenProducts.add(String(product.id));
    const mixedInput = item.bulkQuantity !== undefined || item.baseQuantity !== undefined;
    const metadata = requireProductBaseUnit(product);
    const bulkQuantity = Number(item.bulkQuantity ?? 0);
    const baseQuantity = Number(item.baseQuantity ?? 0);
    if (mixedInput && (![bulkQuantity, baseQuantity].every((value) => Number.isFinite(value) && value >= 0)
      || bulkQuantity > 0 && (!metadata.bulkUnit || !(metadata.unitsPerBulkUnit > 0)))) {
      throw stockError("Geçerli toplu ve temel miktar girin.", 422);
    }
    const sourceQuantity = mixedInput
      ? bulkQuantity * metadata.unitsPerBulkUnit + baseQuantity
      : finitePositive(item.quantity);
    if (!sourceQuantity) throw stockError("Geçerli bir miktar girin.", 422);
    const conversion = convertToBaseUnit(sourceQuantity, mixedInput ? metadata.baseUnit : item.unit || product.unit, product);
    const sourceBalance = getProductBalance(state, from.id, product.id);
    const destinationBalance = getProductBalance(state, to.id, product.id);
    if (sourceBalance.reconciliationRequired === true || destinationBalance.reconciliationRequired === true) {
      throw stockError(`${productName(product)} için depo bakiyesi mutabakat bekliyor; transfer oluşturulamaz.`, 409);
    }
    for (const [field, balance] of [["sourceExpectedRevision", sourceBalance], ["destinationExpectedRevision", destinationBalance]]) {
      const expected = item[field] ?? input[field];
      if (expected !== undefined && expected !== null) {
        if (!Number.isInteger(Number(expected)) || Number(expected) < 0) throw stockError("Beklenen ürün-depo revision geçersiz.", 422);
        if (Number(expected) !== Number(balance.revision || 0)) throw stockError("Stok miktarı değişti. Güncel miktarı kontrol edip tekrar deneyin.", 409);
      }
    }
    if (Number(sourceBalance.quantity || 0) < conversion.quantity) throw stockError("Kaynak depoda yeterli stok yok.", 409);
    return {
      productId: product.id,
      quantity: conversion.quantity,
      baseUnit: conversion.baseUnit,
      sourceQuantity,
      sourceUnit: conversion.inputUnit,
      conversionFactor: conversion.factor,
      unitSchemaVersion: Math.max(1, Number(product.unitSchemaVersion || 1)),
      conversionSnapshot: { baseUnit: conversion.baseUnit, bulkUnit: conversion.bulkUnit, unitsPerBulkUnit: conversion.unitsPerBulkUnit, inputUnit: conversion.inputUnit, factor: conversion.factor, unitSchemaVersion: Math.max(1, Number(product.unitSchemaVersion || 1)), ...(mixedInput ? { bulkQuantity, baseQuantity } : {}) },
      sourceExpectedRevision: Math.max(0, Number(sourceBalance.revision || 0)),
      destinationExpectedRevision: Math.max(0, Number(destinationBalance.revision || 0))
    };
  });
  const firstItem = items[0];
  const timestamp = nowIso(options.now);
  const transfer = {
    id: createId("stock-transfer"),
    status: input.status === "draft" && actor && actor.type === "admin" ? "draft" : "pending",
    productId: firstItem.productId,
    items,
    fromLocationId: from.id,
    toLocationId: to.id,
    quantity: firstItem.quantity,
    baseUnit: firstItem.baseUnit,
    sourceQuantity: firstItem.sourceQuantity,
    sourceUnit: firstItem.sourceUnit,
    conversionFactor: firstItem.conversionFactor,
    unitSchemaVersion: firstItem.unitSchemaVersion,
    conversionSnapshot: firstItem.conversionSnapshot,
    sourceExpectedRevision: firstItem.sourceExpectedRevision,
    destinationExpectedRevision: firstItem.destinationExpectedRevision,
    urgency: String(input.urgency || "normal").trim().slice(0, 32) || "normal",
    note: String(input.note || input.description || "").trim().slice(0, 500),
    requestedBy: String(actor && actor.id || ""),
    requestedByName: String(actor && actor.name || ""),
    requestId,
    transactionRef: null,
    movementIds: [],
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.transfers = [transfer, ...(state.transfers || [])].slice(0, 2000);
  state.updatedAt = timestamp;
  recordOperation(state, "transfer_create", requestId, { transferId: transfer.id }, timestamp);
  return { stockState: normalizeState(state), transfer: serializeTransfer(state, transfer), idempotent: false };
}

function approveTransfer(stockState, transferId, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "transfer_approve", requestId);
  if (duplicate) {
    const transfer = (state.transfers || []).find((item) => String(item.id) === String(duplicate.value && duplicate.value.transferId));
    return { stockState: state, transfer: serializeTransfer(state, transfer), movements: [], idempotent: true };
  }
  const transfer = (state.transfers || []).find((item) => String(item.id) === String(transferId));
  if (!transfer) throw stockError("Aktarım talebi bulunamadı.", 404);
  if (transfer.status === "approved") {
    return { stockState: state, transfer: serializeTransfer(state, transfer), movements: [], idempotent: true };
  }
  if (!["draft", "pending"].includes(transfer.status)) throw stockError("Bu aktarım talebi artık onaylanamaz.", 409);
  const { from, to } = assertTransferLocations(state, transfer.fromLocationId, transfer.toLocationId);
  const rawItems = Array.isArray(transfer.items) && transfer.items.length ? transfer.items : [transfer];
  const prepared = rawItems.map((item) => {
    const product = getProduct(state, item.productId || transfer.productId);
    requireProductBaseUnit(product);
    const amount = finitePositive(item.quantity);
    if (!amount) throw stockError("Aktarım miktarı geçersiz.");
    const fromBalance = getProductBalance(state, from.id, product.id);
    const toBalance = getProductBalance(state, to.id, product.id);
    if (fromBalance.reconciliationRequired === true || toBalance.reconciliationRequired === true) {
      throw stockError(`${productName(product)} için depo bakiyesi mutabakat bekliyor; transfer onaylanamaz.`, 409);
    }
    const sourceRevision = Math.max(0, Number(fromBalance.revision || 0));
    const destinationRevision = Math.max(0, Number(toBalance.revision || 0));
    if (item.sourceExpectedRevision !== null && item.sourceExpectedRevision !== undefined
      && Number(item.sourceExpectedRevision) !== sourceRevision) {
      throw stockError(`${productName(product)} kaynak depo bakiyesi talep sonrasında değişti. Talebi yenileyin.`, 409);
    }
    if (item.destinationExpectedRevision !== null && item.destinationExpectedRevision !== undefined
      && Number(item.destinationExpectedRevision) !== destinationRevision) {
      throw stockError(`${productName(product)} hedef depo bakiyesi talep sonrasında değişti. Talebi yenileyin.`, 409);
    }
    const beforeFrom = round(Number(fromBalance.quantity || 0));
    const beforeTo = round(Number(toBalance.quantity || 0));
    if (beforeFrom < amount) throw stockError(`${productName(product)} için kaynak depoda yeterli stok bulunmuyor.`, 409);
    return { item, product, amount, fromBalance, toBalance, beforeFrom, beforeTo };
  });
  const timestamp = nowIso(options.now);
  const transactionRef = createId("stock-transfer-transaction");
  const movements = [];
  for (const entry of prepared) {
    const { item, product, amount, beforeFrom, beforeTo } = entry;
    const fromBalance = findBalance(state, from.id, product.id, true);
    const toBalance = findBalance(state, to.id, product.id, true);
    fromBalance.quantity = round(beforeFrom - amount);
    toBalance.quantity = round(beforeTo + amount);
    fromBalance.revision = Math.max(0, Number(fromBalance.revision || 0)) + 1;
    toBalance.revision = Math.max(0, Number(toBalance.revision || 0)) + 1;
    fromBalance.updatedAt = timestamp;
    toBalance.updatedAt = timestamp;
    const common = {
      productId: product.id, stockProductCode: product.productCode, productName: productName(product),
      quantity: amount, baseUnit: item.baseUnit || product.unit, sourceQuantity: item.sourceQuantity || amount,
      sourceUnit: item.sourceUnit || product.unit, conversionFactor: item.conversionFactor || 1,
      unitSchemaVersion: item.unitSchemaVersion || item.conversionSnapshot && item.conversionSnapshot.unitSchemaVersion || product.unitSchemaVersion,
      conversionSnapshot: item.conversionSnapshot || { ...productUnitMetadata(product), inputUnit: item.sourceUnit || product.unit, factor: item.conversionFactor || 1 },
      referenceType: "transfer", referenceId: transfer.id, transferId: transfer.id, requestId, idempotencyKey: requestId,
      transactionRef, actor, note: input.note || transfer.note, reason: "Depolar arası aktarım", createdAt: timestamp, approvedAt: timestamp
    };
    const outgoing = addMovement(state, { ...common, type: "transfer_out", locationId: from.id, fromLocationId: from.id, toLocationId: to.id, baseQuantityDelta: -amount, expectedRevision: item.sourceExpectedRevision, previousBalance: beforeFrom, resultingBalance: fromBalance.quantity });
    const incoming = addMovement(state, { ...common, type: "transfer_in", locationId: to.id, fromLocationId: from.id, toLocationId: to.id, baseQuantityDelta: amount, expectedRevision: item.destinationExpectedRevision, previousBalance: beforeTo, resultingBalance: toBalance.quantity });
    item.movementIds = [outgoing.id, incoming.id];
    movements.push(outgoing, incoming);
    updateProductTotalProjection(state, product.id, timestamp);
  }
  transfer.status = "approved";
  transfer.transactionRef = transactionRef;
  transfer.movementIds = movements.map((movement) => movement.id);
  transfer.approvedBy = String(actor && actor.id || "");
  transfer.approvedAt = timestamp;
  transfer.updatedAt = timestamp;
  if (input.note !== undefined) transfer.note = String(input.note || "").trim().slice(0, 500);
  state.updatedAt = timestamp;
  recordOperation(state, "transfer_approve", requestId, { transferId: transfer.id }, timestamp);
  return { stockState: normalizeState(state), transfer: serializeTransfer(state, transfer), movements, idempotent: false };
}

function rejectTransfer(stockState, transferId, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "transfer_reject", requestId);
  if (duplicate) {
    const transfer = (state.transfers || []).find((item) => String(item.id) === String(duplicate.value && duplicate.value.transferId));
    return { stockState: state, transfer: serializeTransfer(state, transfer), idempotent: true };
  }
  const transfer = (state.transfers || []).find((item) => String(item.id) === String(transferId));
  if (!transfer) throw stockError("Aktarım talebi bulunamadı.", 404);
  if (transfer.status === "rejected") return { stockState: state, transfer: serializeTransfer(state, transfer), idempotent: true };
  if (transfer.status !== "pending") throw stockError("Bu aktarım talebi artık reddedilemez.", 409);
  const timestamp = nowIso(options.now);
  transfer.status = "rejected";
  transfer.rejectedBy = String(actor && actor.id || "");
  transfer.rejectedAt = timestamp;
  transfer.rejectionReason = String(input.note || input.reason || "").trim().slice(0, 500);
  transfer.updatedAt = timestamp;
  state.updatedAt = timestamp;
  recordOperation(state, "transfer_reject", requestId, { transferId: transfer.id }, timestamp);
  return { stockState: normalizeState(state), transfer: serializeTransfer(state, transfer), idempotent: false };
}

function cancelTransfer(stockState, transferId, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "transfer_cancel", requestId);
  if (duplicate) {
    const transfer = (state.transfers || []).find((item) => String(item.id) === String(transferId));
    return { stockState: state, transfer: serializeTransfer(state, transfer), idempotent: true };
  }
  const transfer = (state.transfers || []).find((item) => String(item.id) === String(transferId));
  if (!transfer) throw stockError("Aktarım talebi bulunamadı.", 404);
  if (transfer.status === "cancelled") return { stockState: state, transfer: serializeTransfer(state, transfer), idempotent: true };
  if (!["draft", "pending"].includes(transfer.status)) throw stockError("Bu aktarım artık iptal edilemez.", 409);
  if (actor && actor.type !== "admin" && String(transfer.requestedBy || "") !== String(actor.id || "")) {
    throw stockError("Bu aktarımı iptal etme yetkiniz yok.", 403);
  }
  const timestamp = nowIso(options.now);
  transfer.status = "cancelled";
  transfer.cancelledBy = String(actor && actor.id || "");
  transfer.cancelledAt = timestamp;
  transfer.updatedAt = timestamp;
  if (input.note !== undefined) transfer.note = String(input.note || "").trim().slice(0, 500);
  state.updatedAt = timestamp;
  recordOperation(state, "transfer_cancel", requestId, { transferId: transfer.id }, timestamp);
  return { stockState: normalizeState(state), transfer: serializeTransfer(state, transfer), idempotent: false };
}

function serializeCount(state, count) {
  if (!count) return null;
  const location = getLocations(state, { includeInactive: true }).find((item) => String(item.id) === String(count.locationId));
  return {
    ...count,
    location: location || null,
    items: (count.items || []).map((item) => {
      const product = (state.products || []).find((candidate) => String(candidate.id) === String(item.productId));
      return {
        ...item,
        product: product ? {
          id: product.id,
          productCode: product.productCode || "",
          name: productName(product),
          ...productUnitMetadata(product)
        } : null,
        systemDisplay: product ? formatBaseQuantity(product, item.systemQuantity) : null,
        countedDisplay: product && item.countedQuantity !== null ? formatBaseQuantity(product, item.countedQuantity) : null
      };
    })
  };
}

function startStockCount(stockState, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "count_start", requestId);
  if (duplicate) {
    const count = (state.counts || []).find((item) => String(item.id) === String(duplicate.value && duplicate.value.countId));
    return { stockState: state, count: serializeCount(state, count), idempotent: true };
  }
  const location = getLocation(state, input.locationId || options.locationId);
  if ((state.counts || []).some((item) => item.status === "active" && String(item.locationId) === location.id)) {
    throw stockError("Bu depo için devam eden bir sayım zaten var.", 409);
  }
  const timestamp = nowIso(options.now);
  const count = {
    id: createId("stock-count"),
    locationId: location.id,
    status: "active",
    items: (state.products || []).filter((product) => product.active !== false && product.sourcePresent !== false).map((product) => ({
      id: createId("stock-count-item"),
      productId: product.id,
      systemQuantity: round(Number(findBalance(state, location.id, product.id, true).quantity || 0)),
      countedQuantity: null,
      inputQuantity: null,
      inputUnit: productUnitMetadata(product).defaultMovementUnit,
      conversionFactor: 1,
      difference: null,
      note: "",
      movementId: null,
      updatedAt: null
    })),
    startedBy: String(actor && actor.id || ""),
    startedByName: String(actor && actor.name || ""),
    completedBy: null,
    cancelledBy: null,
    requestId,
    movementIds: [],
    note: String(input.note || "").trim().slice(0, 500),
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    appliedAt: null
  };
  state.counts = [count, ...(state.counts || [])].slice(0, 1000);
  state.updatedAt = timestamp;
  recordOperation(state, "count_start", requestId, { countId: count.id }, timestamp);
  return { stockState: normalizeState(state), count: serializeCount(state, count), idempotent: false };
}

function updateStockCount(stockState, countId, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "count_update", requestId);
  const count = (state.counts || []).find((item) => String(item.id) === String(countId));
  if (!count) throw stockError("Sayım oturumu bulunamadı.", 404);
  if (duplicate) return { stockState: state, count: serializeCount(state, count), idempotent: true };
  if (count.status !== "active") throw stockError("Bu sayım artık güncellenemez.", 409);
  const entries = Array.isArray(input.items) ? input.items : [input];
  if (!entries.length) throw stockError("Sayım sonucu girin.");
  const timestamp = nowIso(options.now);
  for (const entry of entries) {
    const productId = String(entry.productId || entry.stockProductId || "").trim();
    const item = (count.items || []).find((candidate) => String(candidate.productId) === productId);
    const product = (state.products || []).find((candidate) => String(candidate.id) === productId);
    if (!item || !product) throw stockError("Sayım ürünü bulunamadı.", 404);
    requireProductBaseUnit(product);
    const rawQuantity = Number(entry.quantity ?? entry.countedQuantity ?? entry.inputQuantity);
    if (!Number.isFinite(rawQuantity) || rawQuantity < 0) throw stockError("Sayım miktarı negatif olamaz.");
    const unit = normalizeUnit(entry.unit || entry.inputUnit || productUnitMetadata(product).defaultMovementUnit);
    const conversion = rawQuantity === 0
      ? { quantity: 0, factor: unit === productUnitMetadata(product).bulkUnit ? productUnitMetadata(product).unitsPerBulkUnit : 1, baseUnit: productUnitMetadata(product).baseUnit, inputUnit: unit }
      : convertToBaseUnit(rawQuantity, unit, product);
    item.inputQuantity = round(rawQuantity);
    item.inputUnit = unit;
    item.conversionFactor = Number(conversion.factor || 1);
    item.countedQuantity = round(conversion.quantity);
    item.difference = round(item.countedQuantity - Number(item.systemQuantity || 0));
    item.note = String(entry.note || item.note || "").trim().slice(0, 500);
    item.updatedAt = timestamp;
  }
  if (input.note !== undefined) count.note = String(input.note || "").trim().slice(0, 500);
  count.updatedAt = timestamp;
  state.updatedAt = timestamp;
  recordOperation(state, "count_update", requestId, { countId: count.id }, timestamp);
  return { stockState: normalizeState(state), count: serializeCount(state, count), idempotent: false };
}

function approveStockCount(stockState, countId, input = {}, actor = {}, options = {}) {
  let state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "count_approve", requestId);
  let count = (state.counts || []).find((item) => String(item.id) === String(countId));
  if (!count) throw stockError("Sayım oturumu bulunamadı.", 404);
  if (duplicate || count.status === "completed") return { stockState: state, count: serializeCount(state, count), movements: [], idempotent: true };
  if (count.status !== "active") throw stockError("Bu sayım onaylanamaz.", 409);
  const countedItems = (count.items || []).filter((item) => item.countedQuantity !== null && item.countedQuantity !== undefined);
  if (!countedItems.length) throw stockError("Onaylanacak fiziksel sayım sonucu bulunmuyor.");
  const timestamp = nowIso(options.now);
  const movements = [];
  for (const item of countedItems) {
    const difference = round(Number(item.countedQuantity || 0) - Number(item.systemQuantity || 0));
    const product = getProduct(state, item.productId);
    if (!difference) {
      const balance = findBalance(state, count.locationId, product.id, true);
      if (balance.reconciliationRequired === true) {
        balance.reconciliationRequired = false;
        balance.reconciliationReasonCode = "";
        balance.reconciliationReason = "";
        balance.previousQuantity = null;
        balance.previousBaseUnit = "";
        balance.targetBaseUnit = "";
        balance.baseUnitSnapshot = productUnitMetadata(product).baseUnit;
        balance.bulkUnitSnapshot = productUnitMetadata(product).bulkUnit;
        balance.unitsPerBulkUnitSnapshot = productUnitMetadata(product).unitsPerBulkUnit;
        balance.unitSchemaVersionAtBalance = Math.max(1, Number(product.unitSchemaVersion || 1));
        balance.reconciliationResolvedAt = timestamp;
        balance.reconciliationCreatedAt = null;
        balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
        balance.updatedAt = timestamp;
        updateProductTotalProjection(state, product.id, timestamp);
      }
      continue;
    }
    const result = applyStockMovement(state, {
      type: "adjustment",
      productId: product.id,
      locationId: count.locationId,
      quantity: Math.abs(difference),
      delta: difference,
      unit: productUnitMetadata(product).baseUnit,
      referenceType: "stock_count",
      referenceId: count.id,
      reason: "Sayım düzeltmesi",
      note: item.note || count.note,
      requestId: `${requestId}:${product.id}`
    }, actor, { now: timestamp });
    state = result.stockState;
    if (result.movement) movements.push(result.movement);
  }
  count = (state.counts || []).find((item) => String(item.id) === String(countId));
  count.status = "completed";
  count.completedBy = String(actor && actor.id || "");
  count.completedAt = timestamp;
  count.appliedAt = timestamp;
  count.updatedAt = timestamp;
  count.movementIds = movements.map((movement) => movement.id);
  for (const item of count.items || []) {
    const movement = movements.find((candidate) => String(candidate.productId) === String(item.productId));
    item.movementId = movement && movement.id || null;
  }
  state.updatedAt = timestamp;
  recordOperation(state, "count_approve", requestId, { countId: count.id, movementIds: count.movementIds }, timestamp);
  return { stockState: normalizeState(state), count: serializeCount(state, count), movements, idempotent: false };
}

function cancelStockCount(stockState, countId, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "count_cancel", requestId);
  const count = (state.counts || []).find((item) => String(item.id) === String(countId));
  if (!count) throw stockError("Sayım oturumu bulunamadı.", 404);
  if (duplicate || count.status === "cancelled") return { stockState: state, count: serializeCount(state, count), idempotent: true };
  if (count.status !== "active") throw stockError("Bu sayım iptal edilemez.", 409);
  const timestamp = nowIso(options.now);
  count.status = "cancelled";
  count.cancelledBy = String(actor && actor.id || "");
  count.cancelledAt = timestamp;
  count.updatedAt = timestamp;
  if (input.note !== undefined) count.note = String(input.note || "").trim().slice(0, 500);
  state.updatedAt = timestamp;
  recordOperation(state, "count_cancel", requestId, { countId: count.id }, timestamp);
  return { stockState: normalizeState(state), count: serializeCount(state, count), idempotent: false };
}

function reverseMovement(stockState, movementId, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || options.requestId || "").trim();
  const duplicate = idempotentRecord(state, "movement_reverse", requestId);
  if (duplicate) return { stockState: state, movements: [], idempotent: true };
  const original = (state.movements || []).find((item) => String(item.id) === String(movementId));
  if (!original) throw stockError("Stok hareketi bulunamadı.", 404);
  if (actor && actor.type === "personel" && actor.inventoryManage !== true) {
    const ownLocationId = actorLocationId(state, actor);
    const ownsMovement = String(original.personnelId || original.actorId || "") === String(actor.id || "");
    if (!ownsMovement || String(original.locationId || "") !== String(ownLocationId)) {
      throw stockError("Bu stok hareketini geri alma yetkiniz yok.", 403);
    }
    if (!["waste", "manual_out", "stock_out"].includes(String(original.type || ""))) {
      throw stockError("Personel yalnızca kendi Sarf veya Eksilt hareketini geri alabilir.", 403);
    }
  } else if (!actor || (actor.type !== "admin" && actor.inventoryManage !== true)) {
    throw stockError("Stok hareketini geri almak için yetkili kullanıcı gerekli.", 403);
  }
  if (original.reversedMovementId || original.type === "reversal") throw stockError("Bu hareket daha önce terslenmiş.", 409);
  const related = original.transactionRef && original.type === "transfer"
    ? (state.movements || []).filter((item) => item.type === "transfer" && item.transactionRef === original.transactionRef)
    : [original];
  if (related.some((item) => item.reversedMovementId)) throw stockError("Bu aktarım daha önce terslenmiş.", 409);
  const product = getProduct(state, original.productId);
  const timestamp = nowIso(options.now);
  const transactionRef = createId("stock-reversal-transaction");
  const reversals = [];
  for (const item of related) {
    const locationId = String(item.locationId || (item.toLocationId && item.previousBalance < item.resultingBalance ? item.toLocationId : item.fromLocationId) || "");
    const balance = findBalance(state, locationId, product.id, true);
    if (balance.reconciliationRequired === true) {
      throw stockError("Bu depo bakiyesi mutabakat beklediği için hareket geri alınamaz.", 409);
    }
    const prior = round(Number(balance.quantity || 0));
    const isIncoming = Number(item.resultingBalance || 0) > Number(item.previousBalance || 0);
    const next = round(prior + (isIncoming ? -Number(item.quantity || 0) : Number(item.quantity || 0)));
    if (next < 0) throw stockError("Ters hareket mevcut stok nedeniyle eksiye düşer.", 409);
    balance.quantity = next;
    balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
    balance.updatedAt = timestamp;
    const reversal = addMovement(state, {
      type: "reversal", productId: product.id, stockProductCode: product.productCode, productName: productName(product),
      locationId, fromLocationId: item.toLocationId, toLocationId: item.fromLocationId,
      quantity: Number(item.quantity || 0), baseUnit: item.baseUnit || product.unit,
      sourceQuantity: Number(item.sourceQuantity || item.quantity || 0), sourceUnit: item.sourceUnit || product.unit,
      inputQuantity: Number(item.inputQuantity ?? item.sourceQuantity ?? item.quantity ?? 0),
      inputUnit: item.inputUnit || item.sourceUnit || product.unit,
      baseQuantityDelta: -Number(item.baseQuantityDelta || (Number(item.resultingBalance || 0) - Number(item.previousBalance || 0))),
      conversionFactor: item.conversionFactor || 1,
      conversionSnapshot: item.conversionSnapshot && typeof item.conversionSnapshot === "object" ? { ...item.conversionSnapshot } : undefined,
      previousBalance: prior, resultingBalance: next,
      referenceType: "movement_reversal", referenceId: item.id, requestId, idempotencyKey: requestId,
      transactionRef, actor, note: input.note || `Ters hareket: ${item.id}`, reason: "Ters hareket", createdAt: timestamp, approvedAt: timestamp
    });
    item.reversedMovementId = reversal.id;
    item.reversedAt = timestamp;
    item.reversedBy = String(actor && actor.id || "");
    reversals.push(reversal);
  }
  updateProductTotalProjection(state, product.id, timestamp);
  state.updatedAt = timestamp;
  recordOperation(state, "movement_reverse", requestId, { movementIds: reversals.map((item) => item.id) }, timestamp);
  return { stockState: normalizeState(state), movements: reversals, idempotent: false };
}

function calculateSuggestedTransfer(stockState, locationId, productId) {
  const state = normalizeState(stockState);
  const location = getLocation(state, locationId, { allowInactive: true });
  const balance = getProductBalance(state, location.id, productId);
  const general = defaultGeneralLocation(state);
  const generalBalance = general ? getProductBalance(state, general.id, productId) : { quantity: 0 };
  const target = Math.max(0, Number(balance.targetLevel || 0));
  return round(Math.max(0, Math.min(target - Number(balance.quantity || 0), Number(generalBalance.quantity || 0))));
}

function stockStatus(balance, generalQuantity = 0) {
  const quantity = Number(balance && balance.quantity || 0);
  const critical = Number(balance && balance.criticalThreshold || 0);
  if (quantity <= 0) return "Tükendi";
  if (critical > 0 && quantity <= critical) return "Kritik";
  return "Yeterli";
}

function getLocationInventory(stockState, locationId, options = {}) {
  const state = normalizeState(stockState);
  const location = locationId === "total" || locationId === "TOPLAM"
    ? null
    : getLocation(state, locationId, { includeInactive: options.allowInactive === true, allowInactive: options.allowInactive === true });
  const cafe = defaultCafeLocation(state);
  const general = defaultGeneralLocation(state);
  const activeLocations = (state.locations || []).filter((item) => item && item.active !== false);
  const balances = (state.products || []).filter((product) => options.includeInactive || product.active !== false).map((product) => {
    const perLocation = location ? [] : activeLocations.map((item) => ({
      locationId: item.id,
      locationName: item.name,
      ...getProductBalance(state, item.id, product.id)
    }));
    const reconciliationLocations = perLocation.filter((item) => item.reconciliationRequired === true);
    const totalQuantity = calculateTotalStock(state, product.id);
    let criticalLocations = perLocation.filter((item) => {
      const threshold = Math.max(0, Number(item.criticalThreshold || 0));
      return threshold > 0 && Number(item.quantity || 0) <= threshold;
    });
    if (!location && totalQuantity <= 0 && !criticalLocations.length && perLocation.length) {
      criticalLocations = [perLocation.find((item) => cafe && String(item.locationId) === String(cafe.id)) || perLocation[0]];
    }
    const selected = location
      ? getProductBalance(state, location.id, product.id)
      : {
          locationId: "total", productId: product.id, quantity: totalQuantity,
          criticalThreshold: perLocation.reduce((sum, item) => sum + Math.max(0, Number(item.criticalThreshold || 0)), 0),
          orderThreshold: perLocation.reduce((sum, item) => sum + Math.max(0, Number(item.orderThreshold || 0)), 0),
          targetLevel: perLocation.reduce((sum, item) => sum + Math.max(0, Number(item.targetLevel || 0)), 0),
          updatedAt: product.updatedAt || null,
          reconciliationRequired: reconciliationLocations.length > 0,
          aggregateReconciliationRequired: reconciliationLocations.length > 0,
          reconciliationLocations: reconciliationLocations.map((item) => ({
            locationId: item.locationId,
            locationName: item.locationName,
            previousQuantity: item.previousQuantity ?? item.quantity,
            previousBaseUnit: item.previousBaseUnit || item.baseUnitSnapshot || "",
            targetBaseUnit: item.targetBaseUnit || product.baseUnit || "",
            reason: item.reconciliationReason || "Güvenilir birim dönüşüm oranı bulunamadı."
          }))
        };
    const generalQuantity = general ? Number(getProductBalance(state, general.id, product.id).quantity || 0) : 0;
    const cafeQuantity = cafe ? Number(getProductBalance(state, cafe.id, product.id).quantity || 0) : 0;
    const otherLocationQuantity = location
      ? round(totalQuantity - Number(selected.quantity || 0))
      : 0;
    const status = location ? stockStatus(selected, generalQuantity) : totalQuantity <= 0 ? "Tükendi" : criticalLocations.length ? "Kritik" : "Yeterli";
    const desired = Math.max(Number(selected.targetLevel || 0), Number(selected.orderThreshold || 0));
    const needed = Math.max(0, round(desired - Number(selected.quantity || 0)));
    const transferAmount = location && location.type === "cafe" ? Math.min(needed, generalQuantity) : 0;
    const recommendation = needed <= 0 ? null : transferAmount > 0
      ? { type: "transfer", quantity: round(transferAmount), fromLocationId: general && general.id || null, toLocationId: location && location.id || null }
      : { type: "purchase", quantity: round(needed), locationId: location && location.id || null };
    return {
      ...selected,
      product: { ...product, stockQuantity: totalQuantity, ...productUnitMetadata(product), allowedUnits: allowedProductUnits(product) },
      totalQuantity,
      cafeQuantity,
      generalQuantity,
      otherLocationQuantity,
      status,
      quantityDisplay: formatBalanceQuantity(product, selected),
      totalQuantityDisplay: reconciliationLocations.length
        ? { display: "Mutabakat gerekiyor", reconciliationRequired: true }
        : formatBaseQuantity(product, totalQuantity),
      criticalLocations: location ? [] : criticalLocations.map((item) => ({
        locationId: String(item.locationId || ""),
        locationName: String(item.locationName || "Depo"),
        quantity: Number(item.quantity || 0),
        quantityDisplay: formatBalanceQuantity(product, item),
        criticalThreshold: Number(item.criticalThreshold || 0),
        status: stockStatus(item)
      })),
      recommendation,
      suggestedTransfer: transferAmount
    };
  });
  const pendingTransfers = (state.transfers || []).filter((transfer) => transfer.status === "pending"
    && (!location || String(transfer.fromLocationId) === location.id || String(transfer.toLocationId) === location.id));
  const today = new Date().toISOString().slice(0, 10);
  const movements = (state.movements || []).filter((movement) => !location || String(movement.locationId) === location.id);
  const inToday = movements.filter((movement) => String(movement.createdAt || "").slice(0, 10) === today
    && Number(movement.resultingBalance || 0) > Number(movement.previousBalance || 0))
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const outToday = movements.filter((movement) => String(movement.createdAt || "").slice(0, 10) === today
    && Number(movement.resultingBalance || 0) < Number(movement.previousBalance || 0))
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  return {
    state,
    location,
    balances,
    summary: {
      totalProducts: balances.length,
      criticalProducts: balances.filter((balance) => balance.status === "Kritik" || balance.status === "Tükendi").length,
      pendingTransfers: pendingTransfers.length,
      todayIn: round(inToday),
      todayOut: round(outToday),
      lastUpdatedAt: state.updatedAt || null
    }
  };
}

function serializeMovements(stockState, options = {}) {
  const state = normalizeState(stockState);
  const locationId = String(options.locationId || "").trim();
  const type = String(options.type || "").trim();
  const productId = String(options.productId || "").trim();
  const items = (state.movements || []).filter((movement) => {
    if (locationId && ["transfer_out", "transfer_in"].includes(movement.type)
      && movement.locationId && String(movement.locationId) !== locationId) return false;
    if (locationId && String(movement.locationId || "") !== locationId
      && String(movement.fromLocationId || "") !== locationId
      && String(movement.toLocationId || "") !== locationId) return false;
    if (type && movement.type !== type) return false;
    if (productId && String(movement.productId) !== productId) return false;
    return true;
  });
  return items.map((movement) => ({ ...movement }));
}

function excelCellValue(cell) {
  const value = cell && cell.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((item) => item && item.text || "").join("");
    if (Object.prototype.hasOwnProperty.call(value, "text")) return value.text;
  }
  return value === null || value === undefined ? "" : value;
}

function excelText(cell) {
  return String(excelCellValue(cell) || "").trim().replace(/\s+/g, " ");
}

function excelIdentity(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function excelNumber(cell, options = {}) {
  const raw = excelCellValue(cell);
  if (raw === "" || raw === null || raw === undefined) return { empty: true, valid: true, value: 0 };
  const value = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value) || value < 0) return { empty: false, valid: false, value: 0 };
  if (options.positive && value <= 0) return { empty: false, valid: false, value: 0 };
  return { empty: false, valid: true, value: round(value) };
}

function excelProductHeadingIsPlaceholder(value) {
  const heading = excelIdentity(value);
  return heading.includes("urun kaydi bulunmuyor") || heading.includes("urun bulunmuyor");
}

function excelQuantityLabelIsValid(labelCell, unitCell, genericUnitLabel, allowGenericWithUnit = false) {
  const rawLabel = excelText(labelCell);
  if (rawLabel === FORMULA_VALUE_MISSING) return true;
  const label = excelIdentity(rawLabel);
  const unit = excelIdentity(excelText(unitCell));
  const generic = `${genericUnitLabel} miktari`;
  if (!label.endsWith(" miktari")) return false;
  if (!unit) return label === generic;
  return label === `${unit} miktari` || allowGenericWithUnit && label === generic;
}

function excelBlockLabelsAreValid(sheet, row) {
  const units = [1, 2, 3].map((column) => excelIdentity(excelText(sheet.getCell(row + 1, column))));
  const thresholds = [1, 2, 3].map((column) => excelIdentity(excelText(sheet.getCell(row + 3, column))));
  const quantities = [1, 2, 3].map((column) => excelIdentity(excelText(sheet.getCell(row + 5, column))));
  return units[0] === "toplu birim"
    && units[1] === "temel birim"
    && units[2] === "birim carpani"
    && thresholds[0] === "kritik esik"
    && thresholds[1] === "siparis esigi"
    && thresholds[2] === "hedef stok"
    && excelQuantityLabelIsValid(sheet.getCell(row + 5, 1), sheet.getCell(row + 2, 1), "toplu birim")
    && excelQuantityLabelIsValid(sheet.getCell(row + 5, 2), sheet.getCell(row + 2, 2), "temel birim", true)
    && quantities[2] === "toplam";
}

async function parseStockExcelWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw stockError("Geçerli bir .xlsx stok dosyası yükleyin.", 422);
  }
  let workbook;
  try {
    workbook = readWorkbookCells(buffer);
  } catch (_error) {
    throw stockError("Excel dosyası okunamadı veya geçerli bir .xlsx dosyası değil.", 422);
  }
  const codeSheet = workbook.worksheets.find((sheet) => excelIdentity(sheet.name) === "urun kodlari");
  const codes = new Map();
  if (codeSheet) {
    for (let row = 2; row <= codeSheet.actualRowCount; row += 1) {
      const category = excelText(codeSheet.getCell(row, 1));
      const productNameValue = excelText(codeSheet.getCell(row, 2));
      const code = normalizeProductCode(excelText(codeSheet.getCell(row, 3)));
      if (category && productNameValue && isValidProductCode(code, { stock: true })) {
        codes.set(`${excelIdentity(category)}\u0000${excelIdentity(productNameValue)}`, code);
      }
    }
  }
  const products = [];
  const errors = [];
  const categoryNames = new Set();
  for (const sheet of workbook.worksheets) {
    if (sheet === codeSheet || excelIdentity(sheet.name) === "urun kodlari") continue;
    categoryNames.add(String(sheet.name || "").trim());
    for (let row = 1; row <= Math.max(1, sheet.actualRowCount); row += 8) {
      const productNameValue = excelText(sheet.getCell(row, 1));
      if (!productNameValue || excelProductHeadingIsPlaceholder(productNameValue)) continue;
      const warnings = [];
      if (!excelBlockLabelsAreValid(sheet, row)) warnings.push("Ürün bloğundaki başlık düzeni stok şablonuyla tam eşleşmiyor.");
      const factor = excelNumber(sheet.getCell(row + 2, 3), { positive: true });
      const critical = excelNumber(sheet.getCell(row + 4, 1));
      const order = excelNumber(sheet.getCell(row + 4, 2));
      const target = excelNumber(sheet.getCell(row + 4, 3));
      const bulkQuantity = excelNumber(sheet.getCell(row + 6, 1));
      const baseQuantity = excelNumber(sheet.getCell(row + 6, 2));
      if (!factor.valid) warnings.push("Birim çarpanı geçersiz veya eksik.");
      if (![critical, order, target].every((item) => item.valid)) warnings.push("Stok eşiklerinden biri geçersiz.");
      if (![bulkQuantity, baseQuantity].every((item) => item.valid)) warnings.push("Stok miktarlarından biri geçersiz.");
      if (critical.valid && order.valid && critical.value > order.value && !order.empty) warnings.push("Kritik eşik sipariş eşiğinden büyük.");
      const bulkUnit = controlledUnit(excelText(sheet.getCell(row + 2, 1)), "");
      const baseUnit = controlledUnit(excelText(sheet.getCell(row + 2, 2)), "");
      if (!baseUnit) warnings.push("Temel birim eksik.");
      if (bulkUnit && (factor.empty || !factor.valid)) warnings.push("Toplu birim çarpanı eksik.");
      products.push({
        category: String(sheet.name || "").trim().slice(0, 120),
        productName: productNameValue.slice(0, 180),
        productCode: codes.get(`${excelIdentity(sheet.name)}\u0000${excelIdentity(productNameValue)}`) || "",
        bulkUnit,
        baseUnit,
        unitsPerBulkUnit: factor.value,
        factorProvided: !factor.empty && factor.valid,
        criticalThreshold: critical.value,
        orderThreshold: order.value,
        targetLevel: target.value,
        bulkQuantity: bulkQuantity.value,
        baseQuantity: baseQuantity.value,
        warnings,
        quantitiesValid: bulkQuantity.valid && baseQuantity.valid,
        thresholdsValid: critical.valid && order.valid && target.valid,
        sourceRow: row
      });
    }
  }
  if (!products.length) throw stockError("Excel dosyasında geçerli stok ürün bloğu bulunamadı.", 422);
  return {
    workbookName: "Tahmisçi Stok Excel",
    categoriesFound: categoryNames.size,
    categories: Array.from(categoryNames).filter(Boolean),
    productsFound: products.length,
    products,
    errors
  };
}

function generatedStockProductCode(state, category, name) {
  const ascii = (value) => excelIdentity(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const categoryPart = ascii(category).slice(0, 8) || "GENEL";
  const productPart = ascii(name).slice(0, 24) || "URUN";
  const occupied = new Set((state.products || []).map((item) => normalizeProductCode(item.productCode)).filter(Boolean));
  let code = `STK-${categoryPart}-${productPart}`;
  if (!occupied.has(code)) return code;
  const suffix = crypto.createHash("sha256").update(`${category}\u0000${name}`, "utf8").digest("hex").slice(0, 8).toUpperCase();
  code = `STK-${categoryPart}-${productPart}-${suffix}`;
  let counter = 2;
  while (occupied.has(code)) code = `STK-${categoryPart}-${productPart}-${suffix}-${counter++}`;
  return code;
}

function createCanonicalStockProduct(stockState, input = {}, options = {}) {
  const state = normalizeState(stockState);
  const timestamp = nowIso(options.now);
  const name = String(input.name || input.productName || "").trim().replace(/\s+/g, " ").slice(0, 180);
  if (!name) throw stockError("Ürün adı zorunludur.", 422);
  const duplicate = (state.products || []).find((item) => item && item.active !== false
    && item.sourcePresent !== false && excelIdentity(item.name || item.productName) === excelIdentity(name));
  if (duplicate) throw stockError("Bu ürün stokta mevcut. Mevcut ürünle eşleştirin.", 409);

  const baseUnit = controlledUnit(input.baseUnit || input.unit, "");
  const bulkUnit = controlledUnit(input.bulkUnit || input.caseUnit || input.purchaseUnit, "");
  const unitsPerBulkUnit = bulkUnit
    ? finitePositive(input.unitsPerBulkUnit ?? input.unitsPerCase ?? input.conversionFactor)
    : 0;
  if (!baseUnit) throw stockError("Temel birim zorunludur.", 422);
  if (bulkUnit && !unitsPerBulkUnit) throw stockError("Toplu birim çarpanı sıfırdan büyük olmalıdır.", 422);
  if (bulkUnit && bulkUnit === baseUnit) throw stockError("Temel ve toplu birim aynı olamaz.", 422);

  const canonicalCategoryName = "Kategorisizler";
  let category = (state.categories || []).find((item) => excelIdentity(item.name) === excelIdentity(canonicalCategoryName));
  let createdCategory = false;
  if (!category) {
    category = (state.categories || []).find((item) => excelIdentity(item.name) === excelIdentity("Stokta Olmayanlar"));
    if (category) {
      category.name = canonicalCategoryName;
      category.active = true;
      category.updatedAt = timestamp;
      for (const product of state.products || []) {
        if (String(product.categoryId || "") === String(category.id || "")) product.category = canonicalCategoryName;
      }
    }
  }
  if (!category) {
    category = {
      id: `stock-category-${crypto.randomUUID()}`,
      name: canonicalCategoryName,
      active: true,
      order: (state.categories || []).length,
      sourceType: "supplier",
      statusSource: "supplier",
      sourcePresent: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.categories.push(category);
    createdCategory = true;
  }

  const allowDecimal = input.allowDecimal === true || ["kg", "gr", "litre", "ml"].includes(baseUnit);
  const productCode = generatedStockProductCode(state, category.name, name);
  const product = {
    id: `stock-product-${crypto.randomUUID()}`,
    name,
    productName: name,
    categoryId: category.id,
    category: category.name,
    productCode,
    baseUnit,
    unit: baseUnit,
    bulkUnit,
    caseUnit: bulkUnit,
    unitsPerBulkUnit: unitsPerBulkUnit || 0,
    unitsPerCase: unitsPerBulkUnit || 0,
    allowDecimal,
    defaultMovementUnit: baseUnit,
    active: true,
    sourceType: "supplier",
    statusSource: "supplier",
    sourcePresent: true,
    unitSchemaSource: "supplier",
    unitSchemaLocked: true,
    unitSchemaVersion: 1,
    unitSchemaUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.products.push(product);
  if (!state.unitDefinitions.base.some((unit) => excelIdentity(unit) === excelIdentity(baseUnit))) state.unitDefinitions.base.push(baseUnit);
  if (bulkUnit && !state.unitDefinitions.bulk.some((unit) => excelIdentity(unit) === excelIdentity(bulkUnit))) state.unitDefinitions.bulk.push(bulkUnit);
  state.unitDefinitions.updatedAt = timestamp;
  state.unitDefinitions.updatedBy = String(options.actorId || "system");
  updateProductTotalProjection(state, product.id, timestamp);
  state.updatedAt = timestamp;
  return { stockState: state, product, category, createdCategory };
}

function softDeleteStockProduct(stockState, productId, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const product = (state.products || []).find((item) => String(item.id) === String(productId));
  if (!product) throw stockError("Stok ürünü bulunamadı.", 404);
  if (product.purgedAt || product.archivedAt) throw stockError("Kalıcı olarak arşivlenmiş ürün silinemez.", 409);
  const timestamp = nowIso(options.now);
  if (product.trashed === true && product.removedAt) return { stockState: state, product, idempotent: true };
  Object.assign(product, {
    active: false,
    manuallyInactive: true,
    trashed: true,
    removedAt: timestamp,
    deletedAt: product.deletedAt || timestamp,
    removedBy: String(actor && actor.id || "system"),
    removedByName: String(actor && actor.name || "Yönetici"),
    statusSource: "manual",
    updatedAt: timestamp
  });
  state.updatedAt = timestamp;
  return { stockState: state, product, idempotent: false };
}

function restoreStockProduct(stockState, productId, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const product = (state.products || []).find((item) => String(item.id) === String(productId));
  if (!product) throw stockError("Stok ürünü bulunamadı.", 404);
  if (product.purgedAt || product.archivedAt) throw stockError("Kalıcı olarak arşivlenmiş ürün geri alınamaz.", 409);
  if (product.trashed !== true && !product.removedAt) return { stockState: state, product, idempotent: true };
  const timestamp = nowIso(options.now);
  Object.assign(product, {
    active: true,
    manuallyInactive: false,
    trashed: false,
    removedAt: null,
    deletedAt: null,
    removedBy: "",
    removedByName: "",
    restoredAt: timestamp,
    restoredBy: String(actor && actor.id || "system"),
    statusSource: "manual",
    sourcePresent: true,
    updatedAt: timestamp
  });
  state.updatedAt = timestamp;
  return { stockState: state, product, idempotent: false };
}

function purgeStockProduct(stockState, productId, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const product = (state.products || []).find((item) => String(item.id) === String(productId));
  if (!product) throw stockError("Stok ürünü bulunamadı.", 404);
  if (product.purgedAt || product.archivedAt) return { stockState: state, product, idempotent: true };
  if (product.trashed !== true || !product.removedAt) throw stockError("Yalnız Çöp Kutusu'ndaki stok ürünü kalıcı silinebilir.", 409);
  const timestamp = nowIso(options.now);
  const hasReferences = (state.movements || []).some((item) => String(item.productId || item.stockProductId || "") === String(product.id))
    || (state.transfers || []).some((transfer) => (transfer.items || []).some((item) => String(item.productId || "") === String(product.id)))
    || (state.counts || []).some((count) => (count.items || []).some((item) => String(item.productId || "") === String(product.id)));
  Object.assign(product, {
    active: false,
    manuallyInactive: true,
    trashed: false,
    removedAt: null,
    purgedAt: timestamp,
    purgedBy: String(actor && actor.id || "system"),
    archivedAt: timestamp,
    archiveReason: hasReferences ? "historical_references_preserved" : "permanent_catalog_removal",
    statusSource: "manual",
    sourcePresent: false,
    updatedAt: timestamp
  });
  state.updatedAt = timestamp;
  return { stockState: state, product, hasReferences, idempotent: false };
}

function applyStockExcelImport(stockState, parsedWorkbook, input = {}, actor = {}, options = {}) {
  const state = normalizeState(stockState);
  const requestId = String(input.requestId || input.idempotencyKey || "").trim();
  if (!requestId) throw stockError("Excel içe aktarımı için requestId zorunludur.", 400);
  const replay = idempotentRecord(state, "stock_excel_import", requestId);
  if (replay) {
    const replayErrors = replay.value && replay.value.errors || [];
    const replayDetails = replay.value && replay.value.details || emptyStockExcelDetails(replayErrors);
    const replaySummary = { ...(replay.value && replay.value.summary || {}) };
    replaySummary.matchedProducts = replayDetails.updatedProducts.length;
    replaySummary.updatedProducts = replayDetails.updatedProducts.length;
    replaySummary.newProducts = replayDetails.createdProducts.length;
    replaySummary.newCategories = replayDetails.createdCategories.length;
    replaySummary.changedBalances = replayDetails.balanceChanges.length;
    replaySummary.attentionProducts = (replayDetails.attentionProducts || []).length;
    replaySummary.processedProducts = replayDetails.updatedProducts.length + replayDetails.createdProducts.length;
    replaySummary.skippedProducts = replayDetails.skippedProducts.length;
    replayDetails.attentionItems = replayDetails.attentionProducts || [];
    replaySummary.processedCount = replaySummary.processedProducts;
    replaySummary.updatedCount = replaySummary.updatedProducts;
    replaySummary.createdCount = replaySummary.newProducts;
    replaySummary.attentionCount = replaySummary.attentionProducts;
    return { stockState: state, summary: replaySummary, errors: replayErrors, details: replayDetails, movements: [], idempotent: true };
  }
  const location = getLocation(state, input.locationId || input.targetLocationId);
  const timestamp = nowIso(options.now);
  const summary = {
    categoriesFound: Math.max(0, Number(parsedWorkbook && parsedWorkbook.categoriesFound || 0)),
    productsFound: Math.max(0, Number(parsedWorkbook && parsedWorkbook.productsFound || 0)),
    matchedProducts: 0,
    updatedProducts: 0,
    newProducts: 0,
    newCategories: 0,
    changedBalances: 0,
    processedProducts: 0,
    attentionProducts: 0,
    skippedProducts: 0
  };
  const errors = Array.isArray(parsedWorkbook && parsedWorkbook.errors) ? parsedWorkbook.errors.map((item) => ({ ...item })) : [];
  const details = emptyStockExcelDetails(errors);
  const createdCategoryDetails = new Map();
  const movements = [];
  const processed = new Set();
  const productByCode = new Map((state.products || []).map((product) => [normalizeProductCode(product.productCode), product]).filter(([code]) => code));
  const categoryByName = new Map((state.categories || []).map((category) => [excelIdentity(category.name), category]));

  for (const rawCategory of Array.isArray(parsedWorkbook && parsedWorkbook.categories) ? parsedWorkbook.categories : []) {
    const categoryName = String(rawCategory || "").trim().slice(0, 120);
    const categoryKey = excelIdentity(categoryName);
    if (!categoryName || categoryByName.has(categoryKey)) continue;
    const category = {
      id: `stock-category-${crypto.randomUUID()}`,
      name: categoryName, active: true, order: state.categories.length,
      sourceType: "excel", statusSource: "excel", sourcePresent: true,
      createdAt: timestamp, updatedAt: timestamp, lastImportedAt: timestamp, lastImportOperationId: requestId
    };
    state.categories.push(category);
    categoryByName.set(categoryKey, category);
    summary.newCategories += 1;
    createdCategoryDetails.set(categoryKey, { category: category.name, createdProductCount: 0 });
  }

  for (const record of Array.isArray(parsedWorkbook && parsedWorkbook.products) ? parsedWorkbook.products : []) {
    try {
      const categoryKey = excelIdentity(record.category);
      const nameKey = excelIdentity(record.productName);
      const requestedCode = normalizeProductCode(record.productCode);
      let product = requestedCode ? productByCode.get(requestedCode) : null;
      if (!product && requestedCode) {
        product = (state.products || []).find((candidate) => (candidate.productCodeAliases || [])
          .some((alias) => normalizeProductCode(alias) === requestedCode)) || null;
      }
      if (!product) {
        product = (state.products || []).find((candidate) => excelIdentity(candidate.category) === categoryKey
          && excelIdentity(candidate.name || candidate.productName) === nameKey) || null;
      }
      if (product && processed.has(String(product.id))) {
        details.attentionProducts.push(stockExcelAttentionDetail({
          productId: product.id, locationId: location.id, category: record.category,
          productName: record.productName, productCode: product.productCode,
          reasonCode: "DUPLICATE_WORKBOOK_PRODUCT",
          reason: "Aynı canonical ürün workbook içinde birden fazla kez tanımlanmış; ilk kayıt uygulandı."
        }));
        continue;
      }
      const existing = Boolean(product);
      const warnings = Array.isArray(record.warnings)
        ? record.warnings.filter((message) => !/temel birim.*eksik/i.test(String(message))) : [];
      const warningCodes = warnings.map((message) => {
        const warning = String(message || "");
        if (/temel birim.*eksik/i.test(warning)) return "MISSING_BASE_UNIT";
        if (/çarpan|toplu birim/i.test(warning)) return "MISSING_CONVERSION";
        if (/miktar/i.test(warning)) return "INVALID_QUANTITY";
        if (/eşik/i.test(warning)) return "INVALID_THRESHOLDS";
        if (/başlık|şablon/i.test(warning)) return "TEMPLATE_LABEL_WARNING";
        return "EXCEL_IMPORT_WARNING";
      });
      const addWarning = (code, message) => {
        if (!warnings.includes(message)) warnings.push(message);
        if (!warningCodes.includes(code)) warningCodes.push(code);
      };
      let currentUnits = existing ? productUnitMetadata(product, { allowDefaultBaseUnit: false }) : { baseUnit: "", bulkUnit: "", unitsPerBulkUnit: 0, allowDecimal: false, defaultMovementUnit: "" };
      const originalUnits = { ...currentUnits };
      const singleUnitQuantityUsesBaseUnit = !record.baseUnit
        && !record.factorProvided
        && Boolean(record.bulkUnit)
        && existing
        && !currentUnits.bulkUnit
        && excelIdentity(record.bulkUnit) === excelIdentity(currentUnits.baseUnit);
      const baseUnit = singleUnitQuantityUsesBaseUnit
        ? currentUnits.baseUnit
        : record.baseUnit || currentUnits.baseUnit || "";
      const bulkUnit = singleUnitQuantityUsesBaseUnit ? "" : record.bulkUnit || currentUnits.bulkUnit;
      const unitsPerBulkUnit = singleUnitQuantityUsesBaseUnit
        ? 0
        : record.factorProvided ? Number(record.unitsPerBulkUnit || 0) : Number(currentUnits.unitsPerBulkUnit || 0);
      if (!record.baseUnit) addWarning("MISSING_BASE_UNIT", baseUnit
        ? "Excel dosyasında temel birim eksik. Mevcut temel birim korunuyor."
        : "Excel dosyasında temel birim eksik.");
      if (bulkUnit && !(unitsPerBulkUnit > 0)) addWarning("MISSING_CONVERSION", "Toplu birim çarpanı eksik; toplu miktar bakiyeye uygulanmadı.");
      const targetQuantityReliable = record.quantitiesValid !== false
        && (!Number(record.bulkQuantity || 0) || singleUnitQuantityUsesBaseUnit || Boolean(bulkUnit && unitsPerBulkUnit > 0));
      if (record.bulkUnit && existing && record.bulkUnit !== currentUnits.bulkUnit && !record.factorProvided && !singleUnitQuantityUsesBaseUnit) {
        addWarning("MISSING_CONVERSION", "Toplu birim değişti ancak çarpan verilmedi; mevcut çarpan kullanıldı.");
      }
      const allowDecimal = ["kg", "gr", "litre", "ml"].includes(baseUnit)
        ? true
        : existing ? currentUnits.allowDecimal : false;
      let targetQuantity = singleUnitQuantityUsesBaseUnit
        ? round(Number(record.bulkQuantity || 0) + Number(record.baseQuantity || 0))
        : round(Number(record.bulkQuantity || 0) * Number(unitsPerBulkUnit || 0) + Number(record.baseQuantity || 0));
      let balanceUpdateAllowed = targetQuantityReliable && Boolean(baseUnit);
      if (!allowDecimal && !Number.isInteger(targetQuantity)) {
        addWarning("INVALID_QUANTITY_PRECISION", "Kesirli miktar bu temel birim için uygulanamadı; mevcut bakiye korundu.");
        balanceUpdateAllowed = false;
      }
      let unitMigrationApplied = false;
      if (existing && record.baseUnit && record.baseUnit !== currentUnits.baseUnit) {
        const migration = migrateProductUnitSchema(state, product.id, {
          confirm: true,
          targetBaseUnit: baseUnit,
          targetBulkUnit: bulkUnit,
          unitsPerBulkUnit,
          allowDecimal,
          defaultMovementUnit: baseUnit
        }, {
          now: timestamp,
          allowReconciliation: true,
          allowInactive: true,
          source: "excel_import",
          requestId,
          actorId: String(actor && actor.id || "system")
        });
        product = migration.product;
        product.unitSchemaSource = "excel";
        currentUnits = productUnitMetadata(product, { allowDefaultBaseUnit: false });
        unitMigrationApplied = true;
        if (migration.plan.reconciliationRequired) {
          const affectedLocations = migration.plan.locations
            .filter((item) => item.decision === "RECONCILIATION_REQUIRED"
              && !(String(item.locationId) === String(location.id) && targetQuantityReliable && Boolean(baseUnit)))
            .map((item) => item.locationName)
            .filter(Boolean);
          if (affectedLocations.length) addWarning("BALANCE_RECONCILIATION_REQUIRED", `Eski stok bakiyesi yeni birime güvenli şekilde dönüştürülemedi. Sayım/mutabakat gerekli: ${affectedLocations.join(", ")}.`);
        }
      }
      let category = categoryByName.get(categoryKey);
      if (!category) {
        category = {
          id: `stock-category-${crypto.randomUUID()}`,
          name: String(record.category).slice(0, 120), active: true, order: state.categories.length,
          sourceType: "excel", statusSource: "excel", sourcePresent: true,
          createdAt: timestamp, updatedAt: timestamp, lastImportedAt: timestamp, lastImportOperationId: requestId
        };
        state.categories.push(category);
        categoryByName.set(categoryKey, category);
        summary.newCategories += 1;
        createdCategoryDetails.set(categoryKey, { category: category.name, createdProductCount: 0 });
      } else {
        const categoryLifecycleLocked = category.manuallyInactive === true || category.trashed === true
          || Boolean(category.removedAt || category.deletedAt || category.purgedAt || category.archivedAt)
          || category.active === false && category.statusSource === "manual";
        if (categoryLifecycleLocked) addWarning("CATEGORY_LIFECYCLE_PRESERVED", "Kategori manuel olarak pasif veya arşivde; Excel yaşam döngüsünü değiştirmedi.");
        category.sourcePresent = true;
        category.updatedAt = timestamp;
        category.lastImportedAt = timestamp;
        category.lastImportOperationId = requestId;
      }

      if (!product) {
        const productCode = requestedCode && isValidProductCode(requestedCode, { stock: true })
          ? requestedCode
          : generatedStockProductCode(state, record.category, record.productName);
        product = {
          id: `stock-product-${crypto.randomUUID()}`,
          name: record.productName, productName: record.productName,
          categoryId: category.id, category: category.name, productCode,
          baseUnit, unit: baseUnit, bulkUnit, caseUnit: bulkUnit,
          unitsPerBulkUnit, unitsPerCase: unitsPerBulkUnit,
          allowDecimal, defaultMovementUnit: baseUnit,
          active: true, sourceType: "excel", statusSource: "excel", sourcePresent: true,
          needsAttention: warnings.length > 0,
          attentionReasons: Array.from(new Set(warningCodes)),
          attentionMessages: Array.from(new Set(warnings)),
          excelBaseUnitMissing: !baseUnit,
          excelSourceBaseUnitMissing: !record.baseUnit,
          baseUnitMissing: !baseUnit,
          unitSchemaSource: "excel", unitSchemaLocked: true, unitSchemaVersion: 1,
          unitSchemaUpdatedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
          lastImportedAt: timestamp, lastImportOperationId: requestId
        };
        state.products.push(product);
        productByCode.set(productCode, product);
        summary.newProducts += 1;
        details.createdProducts.push({
          category: category.name,
          productName: productName(product),
          productCode: product.productCode,
          ...stockExcelUnitDetail(productUnitMetadata(product, { allowDefaultBaseUnit: false }))
        });
        if (createdCategoryDetails.has(categoryKey)) createdCategoryDetails.get(categoryKey).createdProductCount += 1;
      } else {
        summary.matchedProducts += 1;
        const lifecycleLocked = product.manuallyInactive === true || product.trashed === true
          || Boolean(product.removedAt || product.deletedAt || product.purgedAt || product.archivedAt)
          || product.active === false && product.statusSource === "manual";
        if (lifecycleLocked) addWarning("PRODUCT_LIFECYCLE_PRESERVED", "Bu ürün Excel dosyasında mevcut ancak Çöp Kutusunda veya manuel olarak pasif; yaşam döngüsü değiştirilmedi.");
        const previousUnits = { ...product, unitSchemaHistory: Array.isArray(product.unitSchemaHistory) ? product.unitSchemaHistory.map((item) => ({ ...item })) : [] };
        const previousProductCode = normalizeProductCode(product.productCode);
        const nextProductCode = requestedCode || previousProductCode;
        const productCodeAliases = normalizeProductCodeList([
          ...(Array.isArray(product.productCodeAliases) ? product.productCodeAliases : []),
          ...(requestedCode && previousProductCode && requestedCode !== previousProductCode ? [previousProductCode] : [])
        ]).filter((code) => code !== nextProductCode);
        const unitChanged = baseUnit !== currentUnits.baseUnit || bulkUnit !== currentUnits.bulkUnit || unitsPerBulkUnit !== currentUnits.unitsPerBulkUnit;
        Object.assign(product, {
          name: record.productName, productName: record.productName,
          categoryId: category.id, category: category.name,
          productCode: nextProductCode,
          productCodeAliases,
          baseUnit, unit: baseUnit, bulkUnit, caseUnit: bulkUnit,
          unitsPerBulkUnit, unitsPerCase: unitsPerBulkUnit,
          defaultMovementUnit: allowedProductUnits({ ...product, baseUnit, unit: baseUnit, bulkUnit, unitsPerBulkUnit }).includes(product.defaultMovementUnit)
            ? product.defaultMovementUnit : baseUnit,
          sourcePresent: true, updatedAt: timestamp,
          needsAttention: warnings.length > 0,
          attentionReasons: Array.from(new Set(warningCodes)),
          attentionMessages: Array.from(new Set(warnings)),
          excelBaseUnitMissing: !baseUnit,
          excelSourceBaseUnitMissing: !record.baseUnit,
          baseUnitMissing: !baseUnit,
          lastImportedAt: timestamp, lastImportOperationId: requestId
        });
        if (!lifecycleLocked && product.active === undefined) product.active = true;
        if (unitChanged) {
          product.unitSchemaVersion = recordProductUnitSchemaTransition(previousUnits, productUnitMetadata(product), timestamp);
          product.unitSchemaHistory = previousUnits.unitSchemaHistory;
          product.unitSchemaSource = "excel";
          product.unitSchemaLocked = true;
          product.unitSchemaUpdatedAt = timestamp;
        }
        if (unitMigrationApplied) {
          product.unitSchemaSource = "excel";
          product.unitSchemaLocked = true;
          product.unitSchemaUpdatedAt = timestamp;
        }
        productByCode.set(normalizeProductCode(product.productCode), product);
        summary.updatedProducts += 1;
      }
      processed.add(String(product.id));
      if (baseUnit && !state.unitDefinitions.base.some((unit) => excelIdentity(unit) === excelIdentity(baseUnit))) state.unitDefinitions.base.push(baseUnit);
      if (bulkUnit && !state.unitDefinitions.bulk.some((unit) => excelIdentity(unit) === excelIdentity(bulkUnit))) state.unitDefinitions.bulk.push(bulkUnit);
      const balance = findBalance(state, location.id, product.id, true);
      const previousBalanceDisplay = formatBalanceQuantity(product, balance).display;
      if (balance.reconciliationRequired === true && !record.baseUnit) {
        balanceUpdateAllowed = false;
        addWarning("BALANCE_RECONCILIATION_REQUIRED", "Bu depo bakiyesi için stok mutabakatı gerekiyor.");
      }
      const wasReconciliationRequired = balance.reconciliationRequired === true;
      const previousBalanceUnit = balance.baseUnitSnapshot || balance.previousBaseUnit || originalUnits.baseUnit || "";
      const previousThresholds = stockExcelThresholdDetail(balance);
      const thresholdsApplicable = record.thresholdsValid !== false;
      const thresholdsChanged = thresholdsApplicable && (Number(balance.criticalThreshold || 0) !== round(Number(record.criticalThreshold || 0))
        || Number(balance.orderThreshold || 0) !== round(Number(record.orderThreshold || 0))
        || Number(balance.targetLevel || 0) !== round(Number(record.targetLevel || 0)));
      if (thresholdsApplicable) {
        balance.criticalThreshold = round(Number(record.criticalThreshold || 0));
        balance.orderThreshold = round(Number(record.orderThreshold || 0));
        balance.targetLevel = round(Number(record.targetLevel || 0));
      }
      const nextThresholds = stockExcelThresholdDetail(balance);
      const previousQuantity = round(Number(balance.quantity || 0));
      if (!balanceUpdateAllowed) targetQuantity = previousQuantity;
      const delta = round(targetQuantity - previousQuantity);
      balance.updatedAt = timestamp;
      if (balanceUpdateAllowed && baseUnit) {
        balance.reconciliationRequired = false;
        balance.reconciliationReasonCode = "";
        balance.reconciliationReason = "";
        balance.previousQuantity = null;
        balance.previousBaseUnit = "";
        balance.targetBaseUnit = "";
        balance.baseUnitSnapshot = baseUnit;
        balance.bulkUnitSnapshot = bulkUnit || "";
        balance.unitsPerBulkUnitSnapshot = Number(unitsPerBulkUnit || 0);
        balance.unitSchemaVersionAtBalance = Math.max(1, Number(product.unitSchemaVersion || 1));
        balance.reconciliationResolvedAt = wasReconciliationRequired ? timestamp : balance.reconciliationResolvedAt || null;
        balance.reconciliationCreatedAt = null;
      }
      const reconciliationChanged = wasReconciliationRequired !== (balance.reconciliationRequired === true);
      if ((thresholdsChanged || reconciliationChanged) && delta === 0) balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
      if (delta !== 0) {
        balance.quantity = targetQuantity;
        balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
        const movement = addMovement(state, {
          type: "adjustment", productId: product.id, stockProductCode: product.productCode,
          productName: productName(product), locationId: location.id,
          fromLocationId: delta < 0 ? location.id : null, toLocationId: delta > 0 ? location.id : null,
          quantity: Math.abs(delta), baseQuantity: Math.abs(delta), baseQuantityDelta: delta,
          baseUnit, sourceQuantity: Math.abs(delta), sourceUnit: baseUnit,
          inputQuantity: Math.abs(delta), inputUnit: baseUnit, conversionFactor: 1,
          conversionSnapshot: {
            baseUnit, bulkUnit, unitsPerBulkUnit, inputUnit: baseUnit, factor: 1,
            unitSchemaVersion: Math.max(1, Number(product.unitSchemaVersion || 1)),
            previousBaseUnit: previousBalanceUnit,
            reconciliationResolution: wasReconciliationRequired
          },
          previousBalance: previousQuantity, resultingBalance: targetQuantity,
          referenceType: "excel_stock_import", referenceId: requestId,
          requestId: `${requestId}:${product.id}`, idempotencyKey: `${requestId}:${product.id}`,
          actor, note: "Excel stok içe aktarımı", createdAt: timestamp, approvedAt: timestamp
        });
        movements.push(movement);
        summary.changedBalances += 1;
        details.balanceChanges.push({
          category: category.name,
          productName: productName(product),
          productCode: product.productCode,
          targetLocation: location.name,
          previousQuantity,
          targetQuantity,
          adjustment: delta,
          previousDisplay: previousBalanceDisplay,
          targetDisplay: formatBaseQuantity(product, targetQuantity).display,
          adjustmentDisplay: `${delta > 0 ? "+" : "−"}${formatBaseQuantity(product, Math.abs(delta)).display}`,
          baseUnit
        });
      }
      if (existing) {
        const previousUnitStructure = stockExcelUnitDetail(originalUnits);
        const newUnitStructure = stockExcelUnitDetail(productUnitMetadata(product));
        const changes = [];
        if (previousUnitStructure.display !== newUnitStructure.display) changes.push({ field: "unitStructure", label: "Birim yapısı", before: previousUnitStructure.display, after: newUnitStructure.display });
        if (previousThresholds.criticalThreshold !== nextThresholds.criticalThreshold) changes.push({ field: "criticalThreshold", label: "Kritik eşik", before: previousThresholds.criticalThreshold, after: nextThresholds.criticalThreshold });
        if (previousThresholds.orderThreshold !== nextThresholds.orderThreshold) changes.push({ field: "orderThreshold", label: "Sipariş eşiği", before: previousThresholds.orderThreshold, after: nextThresholds.orderThreshold });
        if (previousThresholds.targetLevel !== nextThresholds.targetLevel) changes.push({ field: "targetLevel", label: "Hedef stok", before: previousThresholds.targetLevel, after: nextThresholds.targetLevel });
        details.updatedProducts.push({
          category: category.name,
          productName: productName(product),
          productCode: product.productCode,
          previousUnitStructure,
          newUnitStructure,
          previousThresholds,
          newThresholds: nextThresholds,
          changes
        });
      }
      if (warnings.length) {
        details.attentionProducts.push(stockExcelAttentionDetail({
          productId: product.id,
          locationId: location.id,
          locationName: location.name,
          categoryId: category.id,
          category: category.name,
          categoryName: category.name,
          productName: productName(product),
          productCode: product.productCode,
          reasonCodes: warningCodes,
          reasons: warnings
        }));
      }
      updateProductTotalProjection(state, product.id, timestamp);
    } catch (error) {
      throw stockError(`“${record.productName || "Stok ürünü"}” işlenirken içe aktarım durdu: ${error && error.message || "Beklenmeyen hata."}`, Number(error && error.status || 422));
    }
  }
  details.createdCategories = Array.from(createdCategoryDetails.values());
  summary.matchedProducts = details.updatedProducts.length;
  summary.updatedProducts = details.updatedProducts.length;
  summary.newProducts = details.createdProducts.length;
  summary.newCategories = details.createdCategories.length;
  summary.changedBalances = details.balanceChanges.length;
  summary.processedProducts = details.updatedProducts.length + details.createdProducts.length;
  summary.attentionProducts = details.attentionProducts.length;
  summary.skippedProducts = details.skippedProducts.length;
  summary.processedCount = summary.processedProducts;
  summary.updatedCount = summary.updatedProducts;
  summary.createdCount = summary.newProducts;
  summary.attentionCount = summary.attentionProducts;
  details.attentionItems = details.attentionProducts;
  state.unitDefinitions.updatedAt = timestamp;
  state.unitDefinitions.updatedBy = String(actor && actor.id || "system");
  state.updatedAt = timestamp;
  recordOperation(state, "stock_excel_import", requestId, { summary, errors: errors.slice(0, 500), details }, timestamp);
  return { stockState: state, summary, errors, details, movements, idempotent: false, location };
}

function serializeTransfers(stockState, options = {}) {
  const state = normalizeState(stockState);
  const locationId = String(options.locationId || "").trim();
  const userId = String(options.userId || "").trim();
  return (state.transfers || []).filter((transfer) => {
    if (locationId && String(transfer.fromLocationId) !== locationId && String(transfer.toLocationId) !== locationId) return false;
    if (userId && String(transfer.requestedBy) !== userId) return false;
    return true;
  }).map((transfer) => serializeTransfer(state, transfer));
}

function serializeCounts(stockState, options = {}) {
  const state = normalizeState(stockState);
  const locationId = String(options.locationId || "").trim();
  const status = String(options.status || "").trim();
  return (state.counts || []).filter((count) => {
    if (locationId && String(count.locationId) !== locationId) return false;
    if (status && String(count.status) !== status) return false;
    return true;
  }).map((count) => serializeCount(state, count));
}

module.exports = {
  CAFE_LOCATION_ID,
  GENERAL_LOCATION_ID,
  LOCATION_TYPES,
  MOVEMENT_TYPES,
  prepareSnapshot,
  TRANSFER_STATUSES,
  actorLocationId,
  applyStockExcelImport,
  applyStockMovement,
  allowedProductUnits,
  approveStockCount,
  approveTransfer,
  cancelStockCount,
  cancelTransfer,
  calculateSuggestedTransfer,
  calculateTotalStock,
  convertToBaseUnit,
  createCanonicalStockProduct,
  createTransferRequest,
  defaultCafeLocation,
  defaultGeneralLocation,
  getLocation,
  getLocationInventory,
  getLocations,
  getProductBalance,
  formatBaseQuantity,
  buildUnitMigrationPlan,
  migrateProductUnitSchema,
  parseStockExcelWorkbook,
  purgeStockProduct,
  recordProductUnitSchemaTransition,
  rejectTransfer,
  reverseMovement,
  serializeCounts,
  serializeMovements,
  serializeTransfers,
  startStockCount,
  softDeleteStockProduct,
  stockError,
  stockStatus,
  restoreStockProduct,
  updateStockCount,
  updateAllProductTotals,
  updateProductTotalProjection
};
