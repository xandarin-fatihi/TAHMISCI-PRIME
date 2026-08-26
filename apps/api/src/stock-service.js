"use strict";

// Central, location-aware inventory operations.  Routes intentionally pass the
// current store object into this module so a balance update, movement record and
// transfer status always live in one FileStore transaction.

const crypto = require("crypto");
const { normalizeStockState } = require("./store/migrations");
const { normalizeProductCode } = require("./store/product-code-registry");

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
  return CONTROLLED_UNITS.has(unit) ? unit : fallback;
}

function productUnitMetadata(product = {}) {
  const baseUnit = controlledUnit(product.baseUnit || product.unit || "adet", "adet");
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

function allowedProductUnits(product) {
  const metadata = productUnitMetadata(product);
  const result = new Set([metadata.baseUnit]);
  if (metadata.bulkUnit && metadata.unitsPerBulkUnit > 0) result.add(metadata.bulkUnit);
  if (["kg", "gr"].includes(metadata.baseUnit)) result.add(metadata.baseUnit === "kg" ? "gr" : "kg");
  if (["litre", "ml"].includes(metadata.baseUnit)) result.add(metadata.baseUnit === "litre" ? "ml" : "litre");
  return Array.from(result).filter(Boolean);
}

function productName(product) {
  return String(product && (product.productName || product.name) || "Stok ürünü");
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeState(stockState) {
  return normalizeStockState(stockState || {});
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
  return getLocations(state, { includeInactive: true }).find((location) => location.code === "CAFE")
    || getLocations(state, { includeInactive: true }).find((location) => location.type === "cafe")
    || null;
}

function defaultGeneralLocation(state) {
  return getLocations(state, { includeInactive: true }).find((location) => location.code === "GENEL")
    || getLocations(state, { includeInactive: true }).find((location) => location.type === "central")
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
  if (actor && actor.type === "admin") return null;
  const requested = String(actor && (actor.stockLocationId || actor.locationId) || "").trim();
  if (requested) {
    const location = getLocation(state, requested);
    if (location.type !== "cafe") throw stockError("Personel stok işlemleri yalnızca atanmış Kafe Deposunda yapılabilir.", 403);
    return location.id;
  }
  const cafe = defaultCafeLocation(state);
  if (!cafe || cafe.active === false) throw stockError("Personel için aktif Kafe Deposu bulunamadı.", 404);
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
  if (product.active === false || product.sourcePresent === false || product.archivedAt) {
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

function updateProductTotalProjection(state, productId, timestamp) {
  const product = state.products.find((item) => String(item.id) === String(productId));
  if (!product) return;
  const total = calculateTotalStock(state, productId);
  product.stockQuantity = total;
  product.stockQuantityText = `${total} ${productUnitMetadata(product).baseUnit}`;
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
    return { baseQuantity: quantity, bulkQuantity: 0, remainderQuantity: quantity, display: `${quantity} ${metadata.baseUnit}` };
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
    locationId: input.locationId ? String(input.locationId) : null,
    quantity: round(Number(input.quantity || 0)),
    baseUnit: String(input.baseUnit || "adet"),
    unit: String(input.baseUnit || "adet"),
    sourceQuantity: round(Number(input.sourceQuantity || input.quantity || 0)),
    sourceUnit: String(input.sourceUnit || input.baseUnit || "adet"),
    inputQuantity: round(Number(input.inputQuantity ?? input.sourceQuantity ?? input.quantity ?? 0)),
    inputUnit: String(input.inputUnit || input.sourceUnit || input.baseUnit || "adet"),
    baseQuantityDelta: round(Number(input.baseQuantityDelta ?? (Number(input.resultingBalance || 0) - Number(input.previousBalance || 0)))),
    conversionFactor: Number.isFinite(Number(input.conversionFactor)) ? Number(input.conversionFactor) : 1,
    conversionSnapshot: input.conversionSnapshot && typeof input.conversionSnapshot === "object"
      ? { ...input.conversionSnapshot }
      : {
          baseUnit: String(input.baseUnit || "adet"),
          bulkUnit: String(input.bulkUnit || ""),
          unitsPerBulkUnit: Number(input.unitsPerBulkUnit || 0),
          inputUnit: String(input.inputUnit || input.sourceUnit || input.baseUnit || "adet"),
          factor: Number.isFinite(Number(input.conversionFactor)) ? Number(input.conversionFactor) : 1
        },
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
  const type = actor && actor.type === "personel"
    ? ({ consumption: "waste", adjustment_out: "manual_out", stock_out: "manual_out" }[requestedType] || requestedType)
    : requestedType;
  if (!MOVEMENT_TYPES.has(type)) throw stockError("Geçersiz stok hareket türü.", 422);
  if (!actor || !["admin", "personel"].includes(actor.type)) {
    throw stockError("Stok işlemi için yetkili kullanıcı gerekli.", 403);
  }
  if (actor.type === "personel" && !PERSONNEL_OUT_MOVEMENT_TYPES.has(type)) {
    throw stockError("Personel yalnızca Sarf İşle veya Eksilt hareketi oluşturabilir.", 403);
  }
  const duplicate = idempotentRecord(state, "movement", requestId);
  if (duplicate) {
    const movement = (state.movements || []).find((item) => String(item.id) === String(duplicate.value && duplicate.value.movementId));
    return { stockState: state, movement: movement || null, idempotent: true };
  }
  const product = getProduct(state, input.productId || input.stockProductId, input.productCode || input.stockProductCode);
  const locationId = String(input.locationId || options.locationId || actorLocationId(state, actor) || "").trim();
  const location = getLocation(state, locationId);
  if (actor && actor.type !== "admin" && String(actorLocationId(state, actor)) !== location.id) {
    throw stockError("Bu stok lokasyonunda işlem yetkiniz yok.", 403);
  }
  const sourceQuantity = finitePositive(input.quantity);
  if (!sourceQuantity) throw stockError("Geçerli bir miktar girin.", 422);
  const conversion = convertToBaseUnit(sourceQuantity, input.unit || product.unit, product);
  const delta = movementDirection(type, input) * conversion.quantity;
  if (!delta) throw stockError("Bu hareket türü için geçerli miktar değişimi gerekli.");
  const balance = findBalance(state, location.id, product.id, true);
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
    conversionSnapshot: { baseUnit: conversion.baseUnit, bulkUnit: conversion.bulkUnit, unitsPerBulkUnit: conversion.unitsPerBulkUnit, inputUnit: conversion.inputUnit, factor: conversion.factor },
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
  if (actor && actor.type !== "admin") {
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
    if (seenProducts.has(String(product.id))) throw stockError("Aynı ürün bir transferde yalnızca bir kez bulunabilir.", 409);
    seenProducts.add(String(product.id));
    const sourceQuantity = finitePositive(item.quantity);
    if (!sourceQuantity) throw stockError("Geçerli bir miktar girin.");
    const conversion = convertToBaseUnit(sourceQuantity, item.unit || product.unit, product);
    const sourceBalance = findBalance(state, from.id, product.id, true);
    const destinationBalance = findBalance(state, to.id, product.id, true);
    return {
      productId: product.id,
      quantity: conversion.quantity,
      baseUnit: conversion.baseUnit,
      sourceQuantity,
      sourceUnit: conversion.inputUnit,
      conversionFactor: conversion.factor,
      conversionSnapshot: { baseUnit: conversion.baseUnit, bulkUnit: conversion.bulkUnit, unitsPerBulkUnit: conversion.unitsPerBulkUnit, inputUnit: conversion.inputUnit, factor: conversion.factor },
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
    const amount = finitePositive(item.quantity);
    if (!amount) throw stockError("Aktarım miktarı geçersiz.");
    const fromBalance = findBalance(state, from.id, product.id, true);
    const toBalance = findBalance(state, to.id, product.id, true);
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
    const { item, product, amount, fromBalance, toBalance, beforeFrom, beforeTo } = entry;
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
    if (!difference) continue;
    const product = getProduct(state, item.productId);
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
  if (actor && actor.type === "personel") {
    const ownLocationId = actorLocationId(state, actor);
    const ownsMovement = String(original.personnelId || original.actorId || "") === String(actor.id || "");
    if (!ownsMovement || String(original.locationId || "") !== String(ownLocationId)) {
      throw stockError("Bu stok hareketini geri alma yetkiniz yok.", 403);
    }
    if (!["waste", "manual_out", "stock_out"].includes(String(original.type || ""))) {
      throw stockError("Personel yalnızca kendi Sarf veya Eksilt hareketini geri alabilir.", 403);
    }
  } else if (!actor || actor.type !== "admin") {
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
  const location = locationId === "total" || locationId === "TOPLAM" ? null : getLocation(state, locationId);
  const cafe = defaultCafeLocation(state);
  const general = defaultGeneralLocation(state);
  const balances = (state.products || []).filter((product) => options.includeInactive || product.active !== false).map((product) => {
    const selected = location
      ? getProductBalance(state, location.id, product.id)
      : { locationId: "total", productId: product.id, quantity: calculateTotalStock(state, product.id), criticalThreshold: 0, orderThreshold: 0, targetLevel: 0, updatedAt: product.updatedAt || null };
    const generalQuantity = general ? Number(getProductBalance(state, general.id, product.id).quantity || 0) : 0;
    const cafeQuantity = cafe ? Number(getProductBalance(state, cafe.id, product.id).quantity || 0) : 0;
    const totalQuantity = calculateTotalStock(state, product.id);
    const otherLocationQuantity = location
      ? round(totalQuantity - Number(selected.quantity || 0))
      : 0;
    const status = location ? stockStatus(selected, generalQuantity) : "Toplam";
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
      quantityDisplay: formatBaseQuantity(product, selected.quantity),
      totalQuantityDisplay: formatBaseQuantity(product, totalQuantity),
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
    if (locationId && String(movement.locationId || "") !== locationId
      && String(movement.fromLocationId || "") !== locationId
      && String(movement.toLocationId || "") !== locationId) return false;
    if (type && movement.type !== type) return false;
    if (productId && String(movement.productId) !== productId) return false;
    return true;
  });
  return items.map((movement) => ({ ...movement }));
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
  TRANSFER_STATUSES,
  actorLocationId,
  applyStockMovement,
  allowedProductUnits,
  approveStockCount,
  approveTransfer,
  cancelStockCount,
  cancelTransfer,
  calculateSuggestedTransfer,
  calculateTotalStock,
  convertToBaseUnit,
  createTransferRequest,
  defaultCafeLocation,
  defaultGeneralLocation,
  getLocation,
  getLocationInventory,
  getLocations,
  getProductBalance,
  formatBaseQuantity,
  rejectTransfer,
  reverseMovement,
  serializeCounts,
  serializeMovements,
  serializeTransfers,
  startStockCount,
  stockError,
  stockStatus,
  updateStockCount,
  updateAllProductTotals,
  updateProductTotalProjection
};
