"use strict";

const { normalizeProcurement, normalizeStockState } = require("./store/migrations");

const DAY_MS = 86400000;
const RANGE_DAYS = Object.freeze({ "30d": 30, "90d": 90, "6m": 183, "1y": 365, all: 0 });

function searchProducts(data, query = "", options = {}) {
  const stock = normalizeStockState(data && data.stockState);
  const needle = searchable(query);
  const limit = clampInteger(options.limit, 1, 500, 250);
  const products = stock.products
    .filter((product) => product && product.active !== false)
    .map(publicProduct)
    .filter((product) => !needle || searchable(`${product.name} ${product.productCode} ${product.category}`).includes(needle))
    .sort((left, right) => rank(left.name, needle) - rank(right.name, needle) || left.name.localeCompare(right.name, "tr"))
    .slice(0, limit);
  return { products, catalogRevision: revisionOf(data, "catalog") };
}

function productAnalytics(data, productId, range = "30d", options = {}) {
  const stock = normalizeStockState(data && data.stockState);
  const procurement = normalizeProcurement(data && data.procurement);
  const index = createAnalyticsIndex(data, stock, procurement);
  const product = stock.products.find((item) => String(item.id) === String(productId));
  if (!product) throw error("Stok ürünü bulunamadı.", 404, "STOCK_PRODUCT_NOT_FOUND");
  const rangeKey = Object.prototype.hasOwnProperty.call(RANGE_DAYS, range) ? range : "30d";
  const financialVisible = options.financialVisible === true;
  const purchases = purchaseLines(data, procurement, product, rangeKey, index);
  const usage = consumptionModel(stock, product, rangeKey, index);
  const balance = productBalance(stock, product.id, index);
  const supplierComparison = financialVisible ? compareSuppliers(purchases) : [];
  const priceHistory = financialVisible ? purchases.map((entry) => ({
    id: entry.id, shipmentId: entry.shipmentId, date: entry.date,
    baseUnitPriceKurus: entry.baseUnitPriceKurus,
    bulkUnitPriceKurus: entry.bulkUnitPriceKurus,
    supplierId: entry.supplierId, supplierName: entry.supplierName,
    legacyEstimated: entry.legacyEstimated
  })) : [];
  const last = purchases[purchases.length - 1] || null;
  const averageBase = weightedAverageBasePrice(purchases);
  const previous = purchases.length > 1 ? purchases[purchases.length - 2] : null;
  const changePercent = previous && previous.baseUnitPriceKurus > 0
    ? round((last.baseUnitPriceKurus - previous.baseUnitPriceKurus) / previous.baseUnitPriceKurus * 100, 2)
    : null;
  return {
    product: publicProduct(product),
    range: rangeKey,
    financialVisible,
    summary: financialVisible ? {
      lastBaseUnitPriceKurus: last && last.baseUnitPriceKurus || 0,
      lastBulkUnitPriceKurus: last && last.bulkUnitPriceKurus || 0,
      averageBaseUnitPriceKurus: averageBase,
      changePercent,
      lastSupplier: last ? { id: last.supplierId, name: last.supplierName } : null,
      totalSpendKurus: purchases.reduce((sum, item) => sum + item.totalKurus, 0)
    } : null,
    priceHistory,
    purchaseHistory: financialVisible ? purchases.slice().reverse() : [],
    consumption: usage,
    stockCoverage: coverageModel(product, balance, usage),
    supplierComparison,
    revisions: revisionsOf(data)
  };
}

function stockPlanning(data, range = "30d", options = {}) {
  const stock = normalizeStockState(data && data.stockState);
  const procurement = normalizeProcurement(data && data.procurement);
  const index = createAnalyticsIndex(data, stock, procurement);
  const rangeKey = Object.prototype.hasOwnProperty.call(RANGE_DAYS, range) ? range : "30d";
  const financialVisible = options.financialVisible === true;
  const shipmentVisible = options.shipmentVisible === true;
  const products = stock.products.filter((item) => item && item.active !== false);
  const rows = products.map((product) => {
    const balance = productBalance(stock, product.id, index);
    const usage = consumptionModel(stock, product, rangeKey, index);
    const coverage = coverageModel(product, balance, usage);
    coverage.recommendation = locationRecommendation(stock, product, usage, coverage, index);
    return { product: publicProduct(product), ...coverage, consumption: usage };
  });
  const shipments = index.shipments;
  const pendingShipments = shipmentVisible ? shipments.filter(isPendingShipment) : [];
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const allPurchases = financialVisible
    ? products.flatMap((product) => purchaseLines(data, procurement, product, "all", index))
    : [];
  const latestPrices = new Map();
  allPurchases.forEach((entry) => latestPrices.set(entry.productId, entry.baseUnitPriceKurus));
  const totalStockValueKurus = financialVisible ? rows.reduce((sum, row) => sum + Math.round(row.currentStock * Number(latestPrices.get(row.product.id) || 0)), 0) : null;
  const monthPurchaseKurus = financialVisible ? allPurchases
    .filter((entry) => new Date(entry.date).getTime() >= monthStart.getTime())
    .reduce((sum, entry) => sum + entry.totalKurus, 0) : null;
  const activeCounts = stock.counts.filter((count) => count.status === "active");
  const productById = new Map(products.map((item) => [String(item.id), item]));
  const locationById = new Map(stock.locations.map((item) => [String(item.id), item]));
  const allCountDifferenceItems = activeCounts.flatMap((count) => (count.items || []).flatMap((item) => {
    if (item.countedQuantity === null || item.countedQuantity === undefined || item.countedQuantity === "") return [];
    const difference = Number.isFinite(Number(item.difference))
      ? Number(item.difference)
      : Number(item.countedQuantity) - Number(item.systemQuantity || 0);
    if (Math.abs(difference) <= 0.000001) return [];
    const product = productById.get(String(item.productId));
    return [{
      countId: String(count.id || ""), locationId: String(count.locationId || ""),
      locationName: String(locationById.get(String(count.locationId))?.name || "Depo"),
      product: product ? publicProduct(product) : { id: String(item.productId || ""), name: "Stok ürünü", category: "Kategori yok", baseUnit: "adet" },
      systemQuantity: round(item.systemQuantity), countedQuantity: round(item.countedQuantity), difference: round(difference)
    }];
  }));
  const countDifferences = allCountDifferenceItems.length;
  const countDifferenceItems = allCountDifferenceItems.slice(0, 24);
  const critical = rows.filter((row) => row.status === "critical" || row.status === "empty");
  const transferNeeds = rows.filter((row) => row.recommendation && row.recommendation.type === "transfer");
  return {
    range: rangeKey,
    financialVisible,
    kpis: {
      totalStockValueKurus,
      pendingShipmentCount: pendingShipments.length,
      stockItemCount: products.length,
      monthPurchaseKurus,
      criticalStockCount: critical.length,
      activeLocationCount: stock.locations.filter((location) => location.active !== false).length
    },
    critical: critical.sort((a, b) => a.remainingDaysSort - b.remainingDaysSort).slice(0, 12),
    depleting: rows.filter((row) => Number.isFinite(row.remainingDays)).sort((a, b) => a.remainingDays - b.remainingDays).slice(0, 12),
    upcomingShipments: pendingShipments.slice(0, 12).map((shipment) => ({ id: String(shipment.id || ""), createdAt: shipment.createdAt || shipment.updatedAt || null, itemCount: Array.isArray(shipment.items) ? shipment.items.length : 0, personName: String(shipment.personName || shipment.userName || "Personel") })),
    orderSuggestions: rows.filter((row) => row.suggestedBaseQuantity > 0).sort((a, b) => b.suggestedBaseQuantity - a.suggestedBaseQuantity).slice(0, 12),
    countDifferences,
    countDifferenceItems,
    transferNeeds: transferNeeds.slice(0, 12),
    mostConsumed: rows.filter((row) => row.consumption.totalConsumption > 0).sort((a, b) => b.consumption.totalConsumption - a.consumption.totalConsumption).slice(0, 8),
    mostWasted: rows.filter((row) => row.consumption.totalWaste > 0).sort((a, b) => b.consumption.totalWaste - a.consumption.totalWaste).slice(0, 8),
    revisions: revisionsOf(data)
  };
}

function createAnalyticsIndex(data, stock, procurement) {
  const shipments = canonicalShipments(data);
  const productById = new Map(stock.products.map((item) => [String(item.id), item]));
  const supplierById = new Map(procurement.suppliers.map((item) => [String(item.id), item]));
  const locationById = new Map(stock.locations.map((item) => [String(item.id), item]));
  const balancesByProductId = groupByProductId(stock.balances);
  const movementsByProductId = groupByProductId(stock.movements);
  const reversedMovementIds = new Set(stock.movements.filter((item) => item.reversedMovementId).map((item) => String(item.reversedMovementId)));
  const purchaseLinesByProductId = new Map();

  for (const shipment of shipments) {
    if (!isApprovedShipment(shipment)) continue;
    const date = shipment.approvedAt || shipment.stockAppliedAt || shipment.updatedAt || shipment.createdAt;
    const time = new Date(date || 0).getTime();
    if (!Number.isFinite(time)) continue;
    for (const line of Array.isArray(shipment.items) ? shipment.items : []) {
      const productId = String(line.stockProductId || line.productId || "");
      const product = productById.get(productId);
      if (!product) continue;
      const rows = purchaseLinesByProductId.get(productId) || [];
      const quantity = positive(line.quantity, 0);
      const unitPrice = integer(line.unitPriceKurus, 0);
      const total = integer(line.totalKurus, quantity > 0 ? Math.round(unitPrice * quantity) : 0);
      if (!(total > 0 || unitPrice > 0) || !(quantity > 0)) continue;
      const baseUnit = text(line.baseUnitSnapshot || line.baseUnit || product.baseUnit || product.unit || "adet");
      const bulkUnit = text(line.bulkUnitSnapshot || product.bulkUnit || product.caseUnit || "");
      const unitsPerBulk = positive(line.unitsPerBulkUnitSnapshot, positive(product.unitsPerBulkUnit || product.unitsPerCase, 0));
      const purchaseUnit = text(line.purchaseUnitSnapshot || line.purchaseUnit || line.unit || baseUnit);
      const inferredFactor = unitEquals(purchaseUnit, bulkUnit) && unitsPerBulk > 0 ? unitsPerBulk : 1;
      const factor = positive(line.conversionFactor, inferredFactor);
      const baseQuantity = positive(line.baseQuantity, quantity * factor);
      const baseUnitPrice = integer(line.baseUnitPriceKurus, baseQuantity > 0 ? Math.round(total / baseQuantity) : 0);
      const bulkUnitPrice = integer(line.bulkUnitPriceKurus, unitsPerBulk > 0 ? Math.round(baseUnitPrice * unitsPerBulk) : 0);
      const supplier = supplierById.get(String(shipment.supplierId || ""));
      rows.push({
        id: String(line.id || `${shipment.id}:${rows.length}`), shipmentId: String(shipment.id || ""), productId, date,
        supplierId: String(shipment.supplierId || ""), supplierName: String(supplier && supplier.name || shipment.supplierName || "Tedarikçi belirtilmedi"),
        quantity, purchaseUnit, baseUnit, bulkUnit, unitsPerBulkUnit: unitsPerBulk, conversionFactor: factor,
        baseQuantity, unitPriceKurus: unitPrice, baseUnitPriceKurus: baseUnitPrice,
        bulkUnitPriceKurus: bulkUnitPrice, totalKurus: total,
        legacyEstimated: !(line.baseUnitSnapshot && line.purchaseUnitSnapshot && Number(line.baseQuantity) > 0)
      });
      purchaseLinesByProductId.set(productId, rows);
    }
  }
  for (const rows of purchaseLinesByProductId.values()) rows.sort((left, right) => new Date(left.date) - new Date(right.date));
  return { shipments, productById, supplierById, locationById, balancesByProductId, movementsByProductId, reversedMovementIds, purchaseLinesByProductId };
}

function groupByProductId(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const productId = String(row && row.productId || "");
    const group = grouped.get(productId) || [];
    group.push(row);
    grouped.set(productId, group);
  }
  return grouped;
}

function purchaseLines(data, procurement, product, rangeKey, analyticsIndex) {
  const index = analyticsIndex || createAnalyticsIndex(data, normalizeStockState(data && data.stockState), procurement);
  const start = rangeStart(rangeKey);
  return (index.purchaseLinesByProductId.get(String(product.id)) || []).filter((row) => !start || new Date(row.date).getTime() >= start);
}

function consumptionModel(stock, product, rangeKey, analyticsIndex) {
  const start = rangeStart(rangeKey || "30d");
  const reversed = analyticsIndex ? analyticsIndex.reversedMovementIds : new Set(stock.movements.filter((item) => item.reversedMovementId).map((item) => String(item.reversedMovementId)));
  const sourceRows = analyticsIndex ? analyticsIndex.movementsByProductId.get(String(product.id)) || [] : stock.movements;
  const rows = sourceRows.filter((movement) => {
    const time = new Date(movement.createdAt || 0).getTime();
    return String(movement.productId) === String(product.id) && (!start || time >= start)
      && movement.type !== "reversal" && !movement.reversedMovementId && !reversed.has(String(movement.id));
  });
  const consumptionRows = rows.filter((item) => item.type === "manual_out");
  const wasteRows = rows.filter((item) => item.type === "waste");
  const totalConsumption = consumptionRows.reduce((sum, item) => sum + Math.abs(Number(item.baseQuantityDelta || item.sourceQuantity || 0)), 0);
  const totalWaste = wasteRows.reduce((sum, item) => sum + Math.abs(Number(item.baseQuantityDelta || item.sourceQuantity || 0)), 0);
  const firstTime = consumptionRows.length ? Math.min(...consumptionRows.map((item) => new Date(item.createdAt || 0).getTime()).filter(Number.isFinite)) : 0;
  const requestedDays = RANGE_DAYS[rangeKey] || 30;
  const activeDays = firstTime > 0 ? Math.max(1, Math.min(requestedDays || 3650, Math.ceil((Date.now() - firstTime) / DAY_MS) + 1)) : 0;
  const dailyAverage = activeDays ? totalConsumption / activeDays : 0;
  return { range: rangeKey, activeDays, totalConsumption: round(totalConsumption), totalWaste: round(totalWaste), dailyAverage: round(dailyAverage), monthlyAverage: round(dailyAverage * 30) };
}

function coverageModel(product, balance, usage) {
  const currentStock = Math.max(0, Number(balance.quantity || 0));
  const safetyStock = Math.max(0, Number(balance.criticalThreshold || product.criticalThreshold || 0));
  const futureNeed = usage.dailyAverage * 30;
  const suggestedBaseQuantity = Math.max(0, Math.ceil(futureNeed + safetyStock - currentStock));
  const unitsPerBulk = positive(product.unitsPerBulkUnit || product.unitsPerCase, 0);
  const suggestedBulkQuantity = unitsPerBulk > 0 ? Math.ceil(suggestedBaseQuantity / unitsPerBulk) : null;
  const remainingDays = usage.dailyAverage > 0 ? round(currentStock / usage.dailyAverage, 1) : null;
  const depletionDate = remainingDays === null ? null : new Date(Date.now() + remainingDays * DAY_MS).toISOString();
  const status = currentStock <= 0 ? "empty" : balance.hasCriticalLocation || safetyStock > 0 && currentStock <= safetyStock ? "critical" : "sufficient";
  return {
    currentStock: round(currentStock), baseUnit: text(product.baseUnit || product.unit || "adet"),
    bulkUnit: text(product.bulkUnit || product.caseUnit || ""), unitsPerBulkUnit: unitsPerBulk,
    safetyStock: round(safetyStock), futureNeed: round(futureNeed), remainingDays,
    remainingDaysSort: remainingDays === null ? Number.MAX_SAFE_INTEGER : remainingDays,
    depletionDate, suggestedBaseQuantity,
    suggestedBulkQuantity,
    status,
    recommendation: suggestedBaseQuantity > 0 ? { type: "purchase", baseQuantity: suggestedBaseQuantity, bulkQuantity: suggestedBulkQuantity } : null
  };
}

function productBalance(stock, productId, analyticsIndex) {
  const rows = analyticsIndex ? analyticsIndex.balancesByProductId.get(String(productId)) || [] : stock.balances.filter((item) => String(item.productId) === String(productId));
  return {
    quantity: rows.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0),
    criticalThreshold: rows.reduce((sum, item) => sum + Math.max(0, Number(item.criticalThreshold || 0)), 0),
    orderThreshold: rows.reduce((sum, item) => sum + Math.max(0, Number(item.orderThreshold || 0)), 0),
    targetLevel: rows.reduce((sum, item) => sum + Math.max(0, Number(item.targetLevel || 0)), 0),
    hasCriticalLocation: rows.some((item) => {
      const threshold = Math.max(0, Number(item.criticalThreshold || 0));
      return threshold > 0 && Math.max(0, Number(item.quantity || 0)) <= threshold;
    })
  };
}

function locationRecommendation(stock, product, usage, coverage, analyticsIndex) {
  const locations = analyticsIndex ? analyticsIndex.locationById : new Map(stock.locations.map((item) => [String(item.id), item]));
  const rows = analyticsIndex ? analyticsIndex.balancesByProductId.get(String(product.id)) || [] : stock.balances.filter((item) => String(item.productId) === String(product.id));
  const cafe = rows.find((item) => locations.get(String(item.locationId))?.type === "cafe");
  const central = rows.find((item) => locations.get(String(item.locationId))?.type === "central");
  if (cafe) {
    const cafeQuantity = Math.max(0, Number(cafe.quantity || 0));
    const critical = Math.max(0, Number(cafe.criticalThreshold || product.criticalThreshold || 0));
    const target = Math.max(critical, Number(cafe.targetLevel || product.targetLevel || coverage.futureNeed || 0));
    const needed = Math.max(0, Math.ceil(target - cafeQuantity));
    const centralQuantity = Math.max(0, Number(central && central.quantity || 0));
    if (needed > 0 && cafeQuantity <= critical && centralQuantity > 0) {
      return { type: "transfer", baseQuantity: Math.min(needed, centralQuantity), fromLocationId: central.locationId, toLocationId: cafe.locationId };
    }
  }
  return coverage.suggestedBaseQuantity > 0
    ? { type: "purchase", baseQuantity: coverage.suggestedBaseQuantity, bulkQuantity: coverage.suggestedBulkQuantity }
    : null;
}

function compareSuppliers(purchases) {
  const groups = new Map();
  for (const row of purchases) {
    const key = row.supplierId || row.supplierName;
    const group = groups.get(key) || { supplierId: row.supplierId, supplierName: row.supplierName, purchases: [], totalBaseQuantity: 0 };
    group.purchases.push(row); group.totalBaseQuantity += row.baseQuantity; groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const ordered = group.purchases.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const last = ordered[ordered.length - 1];
    return { supplierId: group.supplierId, supplierName: group.supplierName, lastBaseUnitPriceKurus: last.baseUnitPriceKurus, lastBulkUnitPriceKurus: last.bulkUnitPriceKurus, averageBaseUnitPriceKurus: weightedAverageBasePrice(ordered), lastPurchaseAt: last.date, purchaseCount: ordered.length, totalBaseQuantity: round(group.totalBaseQuantity) };
  }).sort((a, b) => a.averageBaseUnitPriceKurus - b.averageBaseUnitPriceKurus);
}

function weightedAverageBasePrice(rows) {
  const valid = rows.filter((item) => Number(item.totalKurus) > 0 && Number(item.baseQuantity) > 0);
  const totalQuantity = valid.reduce((sum, item) => sum + Number(item.baseQuantity), 0);
  if (!(totalQuantity > 0)) return 0;
  return Math.round(valid.reduce((sum, item) => sum + Number(item.totalKurus), 0) / totalQuantity);
}

function canonicalShipments(data) {
  const source = [...(Array.isArray(data && data.workforceShipments) ? data.workforceShipments : [])];
  const byId = new Map(source.filter(Boolean).map((item) => [String(item.id || ""), item]));
  return [...byId.values()];
}

function isApprovedShipment(item) {
  const status = searchable(item && item.status);
  return Boolean(item && !["reddedildi", "rejected", "taslak", "draft", "onay bekliyor", "onay_bekliyor", "pending"].includes(status)
    && (item.stockAppliedAt || item.approvedAt || ["onaylandi", "approved", "completed", "accepted"].includes(status)));
}
function isPendingShipment(item) { return ["onay bekliyor", "onay_bekliyor", "pending", "submitted"].includes(searchable(item && item.status)); }

function publicProduct(product) {
  return { id: String(product.id || ""), name: String(product.name || product.productName || "Stok ürünü"), productCode: String(product.productCode || ""), category: String(product.category || "Kategori yok"), categoryId: String(product.categoryId || ""), active: product.active !== false, baseUnit: String(product.baseUnit || product.unit || "adet"), bulkUnit: String(product.bulkUnit || product.caseUnit || ""), unitsPerBulkUnit: positive(product.unitsPerBulkUnit || product.unitsPerCase, 0), imageUrl: String(product.imageUrl || "") };
}
function rangeStart(key) { const days = RANGE_DAYS[key] || 0; return days ? Date.now() - days * DAY_MS : 0; }
function revisionsOf(data) { return { inventory: revisionOf(data, "inventory"), catalog: revisionOf(data, "catalog"), shipment: revisionOf(data, "shipment"), procurement: Math.max(0, Number(data && data.procurement && data.procurement.revision || 0)) }; }
function revisionOf(data, key) { return Math.max(0, Number(data && data.revisions && (data.revisions[key] ?? (key === "inventory" ? data.revisions.stock : 0)) || 0)); }
function searchable(value) { return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9çğıöşü]+/gi, " ").trim(); }
function rank(name, needle) { if (!needle) return 0; return searchable(name).startsWith(needle) ? 0 : 1; }
function unitEquals(left, right) { return Boolean(left && right && searchable(left) === searchable(right)); }
function text(value) { return String(value || "").trim(); }
function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function integer(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : Math.max(0, Math.round(Number(fallback || 0))); }
function round(value, digits = 3) { const factor = 10 ** digits; return Math.round(Number(value || 0) * factor) / factor; }
function clampInteger(value, min, max, fallback) { const number = Math.trunc(Number(value)); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function error(message, status, code) { return Object.assign(new Error(message), { status, code }); }

module.exports = { productAnalytics, searchProducts, stockPlanning };
