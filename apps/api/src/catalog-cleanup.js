"use strict";

const crypto = require("crypto");
const { normalizeStockState } = require("./store/migrations");

const CATALOG_CLEANUP_VERSION = "legacy-catalog-cleanup-v1";
const CATALOG_CLEANUP_CONFIRMATION = "ESKI_KATALOGLARI_TEMIZLE";

function catalogCleanupRevision(data) {
  return Math.max(0, Math.trunc(Number(data?.revisions?.catalogMigration || 0)));
}

function completedCatalogCleanup(data) {
  return (Array.isArray(data?.catalogMigrations) ? data.catalogMigrations : [])
    .find((item) => item && item.version === CATALOG_CLEANUP_VERSION && item.status === "completed") || null;
}

function catalogCleanupFingerprint(data) {
  const stock = normalizeStockState(data && data.stockState);
  const scope = {
    menuState: data?.menuState || { settings: {}, categories: [] },
    pricing: data?.pricing || { schemaVersion: 1, types: [] },
    recipeState: data?.recipeState || {},
    recipeCatalog: data?.recipeCatalog || [],
    recipeLinkReview: data?.recipeLinkReview || [],
    stockState: stock,
    pricingImportDrafts: data?.pricingImportDrafts || [],
    dataImportMappings: data?.dataImportMappings || {},
    dataImportDrafts: data?.dataImportDrafts || [],
    dataImportIdempotency: data?.dataImportIdempotency || []
  };
  return crypto.createHash("sha256").update(stableStringify(scope), "utf8").digest("hex");
}

function buildCatalogCleanupPreview(data) {
  const stock = normalizeStockState(data && data.stockState);
  const references = referencedStockProductIds(data, stock);
  const preservedProducts = stock.products.filter((product) => references.has(String(product.id)));
  const preservedCategoryIds = new Set(preservedProducts.map((product) => String(product.categoryId || "")));
  const menuCategories = Array.isArray(data?.menuState?.categories) ? data.menuState.categories : [];
  const menuProducts = menuCategories.reduce((count, category) => count + (Array.isArray(category.products) ? category.products.length : 0), 0);
  const recipeState = data?.recipeState && typeof data.recipeState === "object" ? data.recipeState : {};
  const recipeProducts = Object.values(recipeState).reduce((count, products) => count + Object.keys(products || {}).length, 0);
  const recipeItems = Object.values(recipeState).reduce((count, products) => count + Object.values(products || {}).reduce((sum, sizes) => sum + Object.keys(sizes || {}).length, 0), 0);
  const completed = completedCatalogCleanup(data);

  return {
    version: CATALOG_CLEANUP_VERSION,
    completed: Boolean(completed),
    completedAt: completed && completed.completedAt || null,
    expectedRevision: catalogCleanupRevision(data),
    expectedFingerprint: catalogCleanupFingerprint(data),
    confirmation: CATALOG_CLEANUP_CONFIRMATION,
    summary: {
      menuCategories: menuCategories.length,
      menuProducts,
      recipeCategories: Object.keys(recipeState).length,
      recipeProducts,
      recipeItems,
      stockCategories: stock.categories.length,
      stockProducts: stock.products.length,
      stockProductsPreservedForHistory: preservedProducts.length,
      stockCategoriesPreservedForHistory: stock.categories.filter((category) => preservedCategoryIds.has(String(category.id))).length,
      stockMovementsPreserved: stock.movements.length,
      shipmentsPreserved: Array.isArray(data?.workforceShipments) ? data.workforceShipments.length : 0,
      importMappingsCleared: Object.values(data?.dataImportMappings || {}).reduce((count, entries) => count + (Array.isArray(entries) ? entries.length : 0), 0),
      importDraftsCleared: (Array.isArray(data?.dataImportDrafts) ? data.dataImportDrafts.length : 0)
        + (Array.isArray(data?.pricingImportDrafts) ? data.pricingImportDrafts.length : 0)
    }
  };
}

function applyCatalogCleanup(data, context = {}) {
  const existing = completedCatalogCleanup(data);
  if (existing) return { data, marker: existing, idempotent: true, summary: existing.summary || {} };

  const now = validDate(context.now) || new Date().toISOString();
  const operationId = String(context.operationId || `catalog-cleanup-${crypto.randomUUID()}`);
  const actor = String(context.actor || "admin");
  const requestId = String(context.requestId || "");
  const beforeFingerprint = catalogCleanupFingerprint(data);
  const preview = buildCatalogCleanupPreview(data);
  const stock = normalizeStockState(data.stockState);
  const references = referencedStockProductIds(data, stock);
  const preservedProducts = stock.products
    .filter((product) => references.has(String(product.id)))
    .map((product) => ({
      ...product,
      active: false,
      sourcePresent: false,
      statusSource: "catalog_cleanup_reference_preserved",
      archivedAt: product.archivedAt || now,
      archivedReason: "Korunan sevkiyat veya stok hareketi referansı"
    }));
  const preservedCategoryIds = new Set(preservedProducts.map((product) => String(product.categoryId || "")));
  const preservedCategories = stock.categories
    .filter((category) => preservedCategoryIds.has(String(category.id)))
    .map((category) => ({
      ...category,
      active: false,
      sourcePresent: false,
      statusSource: "catalog_cleanup_reference_preserved",
      archivedAt: category.archivedAt || now,
      archivedReason: "Korunan stok ürününün kategori referansı"
    }));

  data.menuState = {
    ...(data.menuState && typeof data.menuState === "object" ? data.menuState : {}),
    categories: []
  };
  data.pricing = {
    schemaVersion: Number(data?.pricing?.schemaVersion || 1),
    types: Array.isArray(data?.pricing?.types) ? data.pricing.types : []
  };
  data.recipeState = {};
  data.recipeCatalog = [];
  data.recipeLinkReview = [];
  data.stockState = {
    ...stock,
    categories: preservedCategories,
    products: preservedProducts,
    movements: stock.movements
  };
  data.pricingImportDrafts = [];
  data.dataImportMappings = { menu: [], pricing: [], recipe: [], stock: [] };
  data.dataImportDrafts = [];
  data.dataImportIdempotency = [];

  data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
  data.revisions.catalogMigration = catalogCleanupRevision(data) + 1;
  data.revisions.dataImport = Math.max(0, Number(data.revisions.dataImport || 0)) + 1;
  data.revisions.publish = Math.max(0, Number(data.revisions.publish || 0)) + 1;
  data.revisions.pricing = Math.max(0, Number(data.revisions.pricing || 0)) + 1;
  data.menuUpdatedAt = now;
  data.pricingUpdatedAt = now;
  data.recipeUpdatedAt = now;
  data.stockUpdatedAt = now;

  const marker = {
    id: operationId,
    version: CATALOG_CLEANUP_VERSION,
    status: "completed",
    actor,
    requestId,
    startedAt: now,
    completedAt: now,
    revision: data.revisions.catalogMigration,
    beforeFingerprint,
    afterFingerprint: "",
    summary: preview.summary
  };
  data.catalogMigrations = (Array.isArray(data.catalogMigrations) ? data.catalogMigrations : []).concat(marker).slice(-20);
  marker.afterFingerprint = catalogCleanupFingerprint(data);
  return { data, marker, idempotent: false, summary: marker.summary };
}

function referencedStockProductIds(data, stockState) {
  const ids = new Set();
  const remember = (value) => {
    const id = String(value || "").trim();
    if (id) ids.add(id);
  };
  for (const shipment of Array.isArray(data?.workforceShipments) ? data.workforceShipments : []) {
    remember(shipment.stockProductId);
    remember(shipment.productId);
    for (const item of Array.isArray(shipment.items) ? shipment.items : []) {
      remember(item.stockProductId);
      remember(item.productId);
    }
  }
  for (const movement of Array.isArray(stockState?.movements) ? stockState.movements : []) {
    remember(movement.stockProductId);
    remember(movement.productId);
  }
  return ids;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validDate(value) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

module.exports = {
  CATALOG_CLEANUP_CONFIRMATION,
  CATALOG_CLEANUP_VERSION,
  applyCatalogCleanup,
  buildCatalogCleanupPreview,
  catalogCleanupFingerprint,
  catalogCleanupRevision,
  completedCatalogCleanup,
  referencedStockProductIds
};
