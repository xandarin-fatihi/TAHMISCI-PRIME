"use strict";

const crypto = require("crypto");

const PRODUCT_CODE_REGISTRY_SCHEMA_VERSION = 1;
const PRODUCT_CODE_SCOPES = new Set(["menu", "recipe", "stock"]);
const PRODUCT_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+){2,}$/;

function normalizeProductCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 120);
}

function isValidProductCode(value, options = {}) {
  const raw = String(value ?? "").normalize("NFKC").trim();
  if (!raw || raw.length > 120 || /\s|[\u0000-\u001f\u007f]/u.test(raw)) return false;
  const code = normalizeProductCode(raw);
  if (!PRODUCT_CODE_PATTERN.test(code)) return false;
  return options.stock === true ? code.startsWith("STK-") : !code.startsWith("STK-");
}

function normalizeProductCodeList(value) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(value) ? value : []) {
    const code = normalizeProductCode(item);
    const key = codeKey("alias", code);
    if (!code || seen.has(key)) continue;
    seen.add(key);
    result.push(code);
    if (result.length >= 100) break;
  }
  return result;
}

function normalizeNameHistory(value) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(value) ? value : []) {
    const name = String(item || "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 240);
    const key = identityNameKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= 100) break;
  }
  return result;
}

function normalizeProductCodeRegistry(value, data) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const byEntity = new Map();
  const conflicts = normalizeConflicts(source.conflicts);

  for (const raw of Array.isArray(source.entries) ? source.entries : []) {
    const entry = normalizeRegistryEntry(raw);
    if (!entry) continue;
    const key = entityKey(entry.scope, entry.entityId);
    const existing = byEntity.get(key);
    if (!existing) {
      byEntity.set(key, { ...entry, _fromRegistry: true, _seen: false });
    } else {
      existing.aliases = mergeCodes(existing.aliases, [entry.productCode], entry.aliases);
      existing.nameHistory = mergeNames(existing.nameHistory, [entry.canonicalName], entry.nameHistory);
    }
  }

  for (const record of collectProductCodeRecords(data)) {
    const code = normalizeProductCode(record.productCode);
    if (!code) continue;
    const key = entityKey(record.scope, record.entityId);
    const existing = byEntity.get(key);
    if (!existing) {
      byEntity.set(key, {
        scope: record.scope,
        entityId: record.entityId,
        productCode: code,
        normalizedCode: code,
        aliases: normalizeProductCodeList(record.productCodeAliases),
        canonicalName: record.name,
        normalizedName: identityNameKey(record.name),
        category: record.category,
        normalizedCategory: identityNameKey(record.category),
        nameHistory: normalizeNameHistory(record.nameHistory),
        sourceTypes: uniqueStrings([record.sourceType]),
        sourceWorkbooks: uniqueStrings([record.sourceWorkbook || record.scope]),
        sourceWorkbook: record.sourceWorkbook || record.scope,
        sourcePresent: record.sourcePresent !== false,
        archived: record.sourcePresent === false,
        description: record.description,
        firstSeenAt: record.createdAt || record.lastImportedAt || null,
        lastSeenAt: record.updatedAt || record.lastImportedAt || null,
        createdAt: record.createdAt || record.lastImportedAt || null,
        updatedAt: record.updatedAt || record.lastImportedAt || null,
        lastImportOperationId: record.lastImportOperationId || "",
        active: record.active !== false,
        _fromRegistry: false,
        _seen: true
      });
      continue;
    }

    existing._seen = true;
    existing.active = record.active !== false;
    existing.sourcePresent = record.sourcePresent !== false;
    existing.archived = record.sourcePresent === false;
    if (existing.productCode !== code) {
      existing.aliases = mergeCodes(existing.aliases, [existing.productCode]);
      existing.productCode = code;
      existing.normalizedCode = code;
    }
    existing.aliases = mergeCodes(existing.aliases, record.productCodeAliases).filter((alias) => alias !== code);
    if (existing.canonicalName && identityNameKey(existing.canonicalName) !== identityNameKey(record.name)) {
      existing.nameHistory = mergeNames(existing.nameHistory, [existing.canonicalName]);
    }
    existing.canonicalName = record.name || existing.canonicalName;
    existing.normalizedName = identityNameKey(existing.canonicalName);
    existing.category = record.category || existing.category || "";
    existing.normalizedCategory = identityNameKey(existing.category);
    existing.nameHistory = mergeNames(existing.nameHistory, record.nameHistory).filter((name) => identityNameKey(name) !== identityNameKey(existing.canonicalName));
    existing.sourceTypes = uniqueStrings([...(existing.sourceTypes || []), record.sourceType]);
    existing.sourceWorkbooks = uniqueStrings([...(existing.sourceWorkbooks || []), record.sourceWorkbook || record.scope]);
    existing.sourceWorkbook = record.sourceWorkbook || existing.sourceWorkbook || record.scope;
    existing.description = record.description || existing.description || "";
    existing.lastSeenAt = record.updatedAt || record.lastImportedAt || existing.lastSeenAt || null;
    existing.firstSeenAt = existing.firstSeenAt || record.createdAt || record.lastImportedAt || null;
    existing.createdAt = existing.createdAt || record.createdAt || record.lastImportedAt || null;
    existing.updatedAt = record.updatedAt || record.lastImportedAt || existing.updatedAt || null;
    existing.lastImportOperationId = record.lastImportOperationId || existing.lastImportOperationId || "";
  }

  const candidates = [...byEntity.values()].sort(compareEntries);
  const entries = [];
  const canonicalClaims = new Map();
  for (const entry of candidates) {
    if (!isValidProductCode(entry.productCode, { stock: entry.scope === "stock" })) {
      conflicts.push(makeConflict("invalid_product_code", entry.scope, entry.productCode, entry.entityId, entry.entityId));
    }
    const key = codeKey(entry.scope, entry.productCode);
    const claimed = canonicalClaims.get(key);
    if (claimed && claimed.entityId !== entry.entityId) {
      conflicts.push(makeConflict("duplicate_product_code", entry.scope, entry.productCode, claimed.entityId, entry.entityId));
      continue;
    }
    canonicalClaims.set(key, entry);
    entries.push(entry);
  }

  const allClaims = new Map(canonicalClaims);
  for (const entry of entries) {
    const accepted = [];
    for (const alias of entry.aliases) {
      const key = codeKey(entry.scope, alias);
      const claimed = allClaims.get(key);
      if (claimed && claimed.entityId !== entry.entityId) {
        conflicts.push(makeConflict("duplicate_product_code_alias", entry.scope, alias, claimed.entityId, entry.entityId));
        continue;
      }
      allClaims.set(key, entry);
      accepted.push(alias);
    }
    entry.aliases = accepted;
  }

  return {
    schemaVersion: PRODUCT_CODE_REGISTRY_SCHEMA_VERSION,
    entries: entries.map(publicEntry),
    conflicts: dedupeConflicts(conflicts).slice(-500)
  };
}

function registryCodeForEntity(registry, scope, entityId) {
  const match = (Array.isArray(registry?.entries) ? registry.entries : [])
    .find((entry) => entry.scope === scope && String(entry.entityId) === String(entityId));
  return match ? normalizeProductCode(match.productCode) : "";
}

function validateMenuProductCodes(menuState) {
  const records = [];
  for (const category of menuState && menuState.categories || []) {
    for (const product of category && category.products || []) {
      records.push({
        entityId: String(product && product.id || ""),
        label: `${String(category && category.name || "Kategori")} / ${String(product && product.name || "Ürün")}`,
        rawCode: product && product.productCode
      });
    }
  }
  return validateScopedProductCodes("menü", records, { stock: false });
}

function validateRecipeProductCodes(recipeState) {
  const records = [];
  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, item] of Object.entries(sizes || {})) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        records.push({
          entityId: `${identityNameKey(category)}\u0000${identityNameKey(product)}`,
          label: `${category} / ${product} / ${size}`,
          rawCode: item.productCode
        });
      }
    }
  }
  return validateScopedProductCodes("reçete", records, { stock: false });
}

function validateStockProductCodes(stockState) {
  const records = (Array.isArray(stockState && stockState.products) ? stockState.products : []).map((product) => ({
    entityId: String(product && product.id || ""),
    label: String(product && (product.productName || product.name) || "Stok ürünü"),
    rawCode: product && product.productCode
  }));
  return validateScopedProductCodes("stok", records, { stock: true });
}

function validateScopedProductCodes(scopeLabel, records, options) {
  const claims = new Map();
  for (const record of records) {
    const raw = record.rawCode;
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" && typeof raw !== "number") {
      return `${record.label}: Ürün Kodu metin olmalı.`;
    }
    const source = String(raw).normalize("NFKC").trim();
    const code = normalizeProductCode(source);
    if (!isValidProductCode(source, options)) {
      return options && options.stock
        ? `${record.label}: Stok Ürün Kodu STK- ile başlamalı; yalnızca ASCII büyük harf, rakam ve tire içeren en az üç bölümden oluşmalı.`
        : `${record.label}: Ürün Kodu yalnızca ASCII büyük harf, rakam ve tire içeren en az üç bölümden oluşmalı.`;
    }
    const previous = claims.get(code);
    if (previous && previous.entityId !== record.entityId) {
      return `${scopeLabel} kapsamında “${code}” Ürün Kodu birden fazla kayda bağlanamaz (${previous.label}; ${record.label}).`;
    }
    if (!previous) claims.set(code, record);
  }
  return "";
}

function collectProductCodeRecords(data) {
  const records = [];
  for (const category of data?.menuState?.categories || []) {
    for (const product of category.products || []) {
      records.push(recordFromItem("menu", product.id, category.name, product.name, product));
    }
  }

  const recipeIds = new Map((data?.recipeCatalog || []).map((item) => [
    `${identityNameKey(item.category)}\u0000${identityNameKey(item.product)}`,
    String(item.id || "")
  ]));
  for (const [category, products] of Object.entries(data?.recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      const entityId = recipeIds.get(`${identityNameKey(category)}\u0000${identityNameKey(product)}`) || stableRecipeEntityId(category, product);
      for (const item of Object.values(sizes || {})) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        records.push(recordFromItem("recipe", entityId, category, product, item));
      }
    }
  }

  const stockCategories = new Map((data?.stockState?.categories || []).map((category) => [String(category.id), String(category.name || "")]));
  for (const product of data?.stockState?.products || []) {
    records.push(recordFromItem("stock", product.id, stockCategories.get(String(product.categoryId)) || product.category || "", product.productName || product.name, product));
  }
  return records.filter((record) => record.entityId && record.productCode);
}

function recordFromItem(scope, entityId, category, name, item) {
  return {
    scope,
    entityId: String(entityId || "").trim().slice(0, 200),
    category: String(category || "").trim().slice(0, 240),
    name: String(name || "").trim().slice(0, 240),
    productCode: normalizeProductCode(item && item.productCode),
    productCodeAliases: normalizeProductCodeList(item && item.productCodeAliases),
    nameHistory: normalizeNameHistory(item && item.nameHistory),
    active: item && item.active !== false,
    sourcePresent: item && item.sourcePresent !== false,
    sourceType: String(item && item.sourceType || "legacy"),
    sourceWorkbook: String(item && item.sourceWorkbook || scope),
    description: String(item && (item.description || item.note || item.manualContent) || "").trim().slice(0, 1000),
    createdAt: item && item.createdAt || null,
    updatedAt: item && item.updatedAt || null,
    lastImportedAt: item && item.lastImportedAt || null,
    lastImportOperationId: String(item && item.lastImportOperationId || "")
  };
}

function normalizeRegistryEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const scope = PRODUCT_CODE_SCOPES.has(raw.scope) ? raw.scope : "";
  const entityId = String(raw.entityId || "").trim().slice(0, 200);
  const productCode = normalizeProductCode(raw.productCode || raw.code);
  if (!scope || !entityId || !productCode) return null;
  return {
    ...raw,
    scope,
    entityId,
    productCode,
    normalizedCode: productCode,
    aliases: normalizeProductCodeList(raw.aliases || raw.productCodeAliases),
    canonicalName: String(raw.canonicalName || raw.name || "").normalize("NFC").trim().slice(0, 240),
    normalizedName: identityNameKey(raw.canonicalName || raw.name || raw.normalizedName),
    category: String(raw.category || "").normalize("NFC").trim().slice(0, 240),
    normalizedCategory: identityNameKey(raw.category || raw.normalizedCategory),
    nameHistory: normalizeNameHistory(raw.nameHistory),
    sourceTypes: uniqueStrings(raw.sourceTypes || [raw.sourceType]),
    sourceWorkbooks: uniqueStrings(raw.sourceWorkbooks || [raw.sourceWorkbook || scope]),
    sourceWorkbook: PRODUCT_CODE_SCOPES.has(raw.sourceWorkbook) ? raw.sourceWorkbook : scope,
    sourcePresent: raw.sourcePresent !== false,
    archived: raw.archived === true || raw.sourcePresent === false,
    description: String(raw.description || "").trim().slice(0, 1000),
    firstSeenAt: raw.firstSeenAt || null,
    lastSeenAt: raw.lastSeenAt || null,
    createdAt: raw.createdAt || raw.firstSeenAt || null,
    updatedAt: raw.updatedAt || raw.lastSeenAt || null,
    lastImportOperationId: String(raw.lastImportOperationId || ""),
    active: raw.active !== false
  };
}

function normalizeConflicts(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const scope = PRODUCT_CODE_SCOPES.has(item.scope) ? item.scope : "";
    const productCode = normalizeProductCode(item.productCode);
    if (!scope || !productCode) return null;
    return {
      type: String(item.type || "duplicate_product_code"),
      scope,
      productCode,
      canonicalEntityId: String(item.canonicalEntityId || ""),
      conflictingEntityId: String(item.conflictingEntityId || "")
    };
  }).filter(Boolean);
}

function publicEntry(entry) {
  const { _fromRegistry, _seen, ...result } = entry;
  void _fromRegistry;
  void _seen;
  return result;
}

function compareEntries(first, second) {
  if (first.scope !== second.scope) return first.scope.localeCompare(second.scope);
  if (first._fromRegistry !== second._fromRegistry) return first._fromRegistry ? -1 : 1;
  return `${first.productCode}\u0000${first.entityId}`.localeCompare(`${second.productCode}\u0000${second.entityId}`, "tr");
}

function makeConflict(type, scope, productCode, canonicalEntityId, conflictingEntityId) {
  return { type, scope, productCode, canonicalEntityId, conflictingEntityId };
}

function dedupeConflicts(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}\u0000${item.scope}\u0000${item.productCode}\u0000${item.canonicalEntityId}\u0000${item.conflictingEntityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeCodes(...groups) {
  return normalizeProductCodeList(groups.flat());
}

function mergeNames(...groups) {
  return normalizeNameHistory(groups.flat());
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 100);
}

function codeKey(scope, code) {
  return `${scope}\u0000${normalizeProductCode(code)}`;
}

function entityKey(scope, entityId) {
  return `${scope}\u0000${String(entityId)}`;
}

function identityNameKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");
}

function stableRecipeEntityId(category, product) {
  return `recipe-${crypto.createHash("sha256").update(`${category}\u0000${product}`, "utf8").digest("hex").slice(0, 20)}`;
}

module.exports = {
  PRODUCT_CODE_PATTERN,
  PRODUCT_CODE_REGISTRY_SCHEMA_VERSION,
  collectProductCodeRecords,
  isValidProductCode,
  normalizeNameHistory,
  normalizeProductCode,
  normalizeProductCodeList,
  normalizeProductCodeRegistry,
  registryCodeForEntity,
  validateMenuProductCodes,
  validateRecipeProductCodes,
  validateStockProductCodes
};
