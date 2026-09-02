"use strict";

const SECTION_LEVEL_RANK = Object.freeze({ off: 0, view: 1, operate: 2, full: 3 });
const FATURA_ROLES = new Set(["operasyon", "mal_kabul", "muhasebe", "satın_alma", "yönetici", "özel"]);
const FATURA_CAPABILITIES = new Set([
  "procurement.read", "supplier.read", "supplier.manage", "supplierProduct.manage",
  "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject",
  "accounting.read", "accounting.post", "accounting.reverse", "payment.create", "payment.reverse",
  "documents.read", "documents.upload", "documents.archive", "procurement.users.manage",
  "inventory.read", "inventory.manage", "inventory.movement.create", "inventory.movement.reverse",
  "inventory.transfer.create", "inventory.transfer.approve", "inventory.count.manage",
  "inventory.location.manage", "inventory.catalog.manage"
]);

const FATURA_SECTION_DEFINITIONS = Object.freeze([
  section("dashboard", "Genel Bakış", "Tedarik ve operasyon özeti", ["off", "view"], {
    view: ["procurement.read"]
  }),
  section("stock", "Stok", "Depoları, stok bakiyelerini, transferleri, sayımları ve stok planlamasını yönetin.", ["off", "view", "operate", "full"], {
    view: ["inventory.read"],
    operate: ["inventory.read", "inventory.movement.create", "inventory.transfer.create", "inventory.count.manage"],
    full: ["inventory.read", "inventory.manage", "inventory.movement.create", "inventory.movement.reverse", "inventory.transfer.create", "inventory.transfer.approve", "inventory.count.manage", "inventory.location.manage", "inventory.catalog.manage"]
  }, { operate: ["inventory.movement.create", "inventory.transfer.create", "inventory.count.manage"], full: ["inventory.manage", "inventory.movement.reverse", "inventory.transfer.approve", "inventory.location.manage", "inventory.catalog.manage"] }),
  section("productAnalysis", "Ürün Analizi", "Ürün fiyat, alım ve tüketim analizi", ["off", "view"], {
    view: ["inventory.read", "procurement.read"]
  }),
  section("shipments", "Sevkiyat / Mal Kabul", "Sevkiyat, mal kabul, stok onayı ve muhasebe süreçlerini yönetin.", ["off", "view", "operate", "full"], {
    view: ["procurement.read"],
    operate: ["procurement.read", "receipt.create", "receipt.submit"],
    full: ["procurement.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject"]
  }, { operate: ["receipt.create", "receipt.submit"], full: ["receipt.approve", "receipt.reject"] }, false, true),
  section("suppliers", "Tedarikçiler", "Tedarikçi kayıtları ve bilgileri", ["off", "view", "operate", "full"], {
    view: ["supplier.read"],
    operate: ["supplier.read", "procurement.read", "supplierProduct.manage"],
    full: ["supplier.read", "supplier.manage", "procurement.read", "supplierProduct.manage", "receipt.create", "receipt.submit", "documents.read", "documents.upload"]
  }, { operate: ["supplierProduct.manage"], full: ["supplier.manage", "receipt.create", "receipt.submit", "documents.upload"] }),
  section("links", "Ürün Eşleşmeleri", "Tedarikçi ve stok ürünü eşlemeleri", ["off", "view", "full"], {
    view: ["procurement.read"], full: ["procurement.read", "supplierProduct.manage"]
  }, { full: ["supplierProduct.manage"] }, false, true),
  section("documents", "Sevkiyat Arşivi", "Sevkiyat kayıtları, belgeler ve mal kabul işlemleri", ["off", "view", "operate", "full"], {
    view: ["documents.read", "procurement.read"],
    operate: ["documents.read", "documents.upload", "procurement.read", "receipt.create", "receipt.submit"],
    full: ["documents.read", "documents.upload", "documents.archive", "procurement.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject"]
  }, { operate: ["documents.upload", "receipt.create", "receipt.submit"], full: ["documents.archive", "receipt.approve", "receipt.reject"] }),
  section("ledger", "Cari Hesap", "Borç, ödeme ve cari hareketler", ["off", "view", "operate", "full"], {
    view: ["accounting.read", "documents.read"],
    operate: ["accounting.read", "accounting.post", "payment.create", "documents.read", "documents.upload"],
    full: ["accounting.read", "accounting.post", "accounting.reverse", "payment.create", "payment.reverse", "documents.read", "documents.upload"]
  }, { operate: ["accounting.post", "payment.create"], full: ["accounting.reverse", "payment.reverse"] }),
  section("trash", "Çöp Kutusu", "Kaldırılan sevkiyatlar ve ters kayıt denetim geçmişi", ["off", "view"], {
    view: ["procurement.read"]
  }),
  section("users", "Kullanıcı ve Yetkiler", "Fatura kullanıcı erişim yönetimi", ["off", "full"], {
    full: ["procurement.users.manage"]
  }, { full: ["procurement.users.manage"] }, true),
  section("settings", "Ayarlar ve Audit", "Fatura ayarları ve işlem geçmişi", ["off", "full"], {
    full: ["procurement.users.manage"]
  }, { full: ["procurement.users.manage"] }, true, true)
]);

const FATURA_TEMPLATE_SECTION_ACCESS = Object.freeze({
  stok_personeli: frozenAccess({ dashboard: "view", stock: "operate", productAnalysis: "view" }),
  mal_kabul: frozenAccess({ dashboard: "view", documents: "full", suppliers: "view", trash: "view" }),
  satin_alma: frozenAccess({ dashboard: "view", suppliers: "full", documents: "operate", trash: "view" }),
  muhasebe: frozenAccess({ dashboard: "view", suppliers: "view", documents: "view", ledger: "full", trash: "view" }),
  yonetici: frozenAccess(Object.fromEntries(FATURA_SECTION_DEFINITIONS.map((definition) => [definition.id, highestLevel(definition)]))),
  ozel: frozenAccess({})
});

function section(id, label, description, allowedLevels, bundles, legacySignals = {}, managementOnly = false, uiHidden = false) {
  const normalizedBundles = {};
  for (const level of allowedLevels) normalizedBundles[level] = Object.freeze([...(bundles[level] || [])]);
  const normalizedSignals = {};
  for (const level of ["view", "operate", "full"]) normalizedSignals[level] = Object.freeze([...(legacySignals[level] || [])]);
  return Object.freeze({ id, label, description, levels: Object.freeze([...allowedLevels]), bundles: Object.freeze(normalizedBundles), legacySignals: Object.freeze(normalizedSignals), managementOnly, uiHidden });
}

function frozenAccess(value) {
  return Object.freeze({ ...value });
}

function highestLevel(definition) {
  return definition.levels.slice().sort((left, right) => SECTION_LEVEL_RANK[right] - SECTION_LEVEL_RANK[left])[0] || "off";
}

function definitionFor(sectionId) {
  return FATURA_SECTION_DEFINITIONS.find((definition) => definition.id === String(sectionId || "")) || null;
}

function normalizeLevel(definition, value) {
  const level = String(value || "off");
  return definition && definition.levels.includes(level) ? level : "off";
}

function deriveSectionAccessFromCapabilities(capabilities, options = {}) {
  const set = new Set((Array.isArray(capabilities) ? capabilities : []).map(String).filter((item) => FATURA_CAPABILITIES.has(item)));
  const access = {};
  for (const definition of FATURA_SECTION_DEFINITIONS) {
    if (definition.managementOnly && options.allowManagement !== true) {
      access[definition.id] = "off";
      continue;
    }
    let level = "off";
    for (const candidate of ["full", "operate"]) {
      if (!definition.levels.includes(candidate)) continue;
      const signals = definition.legacySignals[candidate] || [];
      if (signals.some((capability) => set.has(capability))) {
        level = candidate;
        break;
      }
    }
    if (level === "off" && definition.levels.includes("view")) {
      const viewBundle = definition.bundles.view || [];
      if (viewBundle.length && viewBundle.every((capability) => set.has(capability))) level = "view";
    }
    access[definition.id] = level;
  }
  return access;
}

function normalizeSectionAccess(value, options = {}) {
  const explicit = value && typeof value === "object" && !Array.isArray(value);
  const fallback = explicit
    ? { ...value }
    : deriveSectionAccessFromCapabilities(options.capabilities, { allowManagement: options.allowManagement === true });
  if (explicit) {
    fallback.documents = strongerVisibleLevel(fallback.documents, fallback.shipments, definitionFor("documents"));
    fallback.suppliers = strongerVisibleLevel(fallback.suppliers, fallback.links, definitionFor("suppliers"), "operate");
    if (String(fallback.trash || "off") === "off" && ([fallback.documents, fallback.ledger].some((level) => (SECTION_LEVEL_RANK[String(level || "off")] || 0) > 0))) fallback.trash = "view";
  }
  const access = {};
  for (const definition of FATURA_SECTION_DEFINITIONS) {
    const allowManagement = options.allowManagement === true;
    access[definition.id] = definition.managementOnly && !allowManagement
      ? "off"
      : normalizeLevel(definition, fallback && fallback[definition.id]);
  }
  return access;
}

function strongerVisibleLevel(current, legacy, definition, legacyCeiling = "full") {
  const currentRank = SECTION_LEVEL_RANK[normalizeLevel(definition, current)] || 0;
  const legacyRank = Math.min(SECTION_LEVEL_RANK[String(legacy || "off")] || 0, SECTION_LEVEL_RANK[legacyCeiling] || 0);
  if (legacyRank <= currentRank) return normalizeLevel(definition, current);
  if (legacyRank >= SECTION_LEVEL_RANK.full && definition.levels.includes("full")) return "full";
  if (legacyRank >= SECTION_LEVEL_RANK.operate && definition.levels.includes("operate")) return "operate";
  return definition.levels.includes("view") ? "view" : normalizeLevel(definition, current);
}

function templateSectionAccess(templateKey) {
  const template = FATURA_TEMPLATE_SECTION_ACCESS[String(templateKey || "")];
  return normalizeSectionAccess(template || {}, { allowManagement: String(templateKey) === "yonetici" });
}

function deriveCapabilitiesFromSectionAccess(sectionAccess, options = {}) {
  const access = normalizeSectionAccess(sectionAccess, { allowManagement: options.allowManagement === true });
  const capabilities = new Set();
  for (const definition of FATURA_SECTION_DEFINITIONS) {
    if (definition.managementOnly && options.allowManagement !== true) continue;
    const level = access[definition.id];
    for (const capability of definition.bundles[level] || []) capabilities.add(capability);
  }
  return [...capabilities].filter((capability) => FATURA_CAPABILITIES.has(capability));
}

function effectiveSectionAccess(actor) {
  if (actor && actor.type === "admin") return templateSectionAccess("yonetici");
  const enabled = Boolean(actor && actor.accessEnabled !== false);
  const access = normalizeSectionAccess(actor && actor.sectionAccess, {
    capabilities: actor && actor.capabilities,
    allowManagement: actor && (actor.template === "yonetici" || actor.role === "yönetici")
  });
  if (enabled) return access;
  return Object.fromEntries(FATURA_SECTION_DEFINITIONS.map((definition) => [definition.id, "off"]));
}

function hasSectionAccess(actor, sectionId, minimumLevel = "view") {
  if (actor && actor.type === "admin") return true;
  const definition = definitionFor(sectionId);
  if (!definition) return false;
  const access = effectiveSectionAccess(actor);
  return SECTION_LEVEL_RANK[access[definition.id] || "off"] >= SECTION_LEVEL_RANK[minimumLevel || "view"];
}

function visibleFaturaSections(actor) {
  const access = effectiveSectionAccess(actor);
  return FATURA_SECTION_DEFINITIONS.filter((definition) => !definition.uiHidden && (access[definition.id] || "off") !== "off").map((definition) => definition.id);
}

function publicSectionDefinitions(options = {}) {
  return FATURA_SECTION_DEFINITIONS.filter((definition) => !definition.uiHidden && (options.includeManagement === true || !definition.managementOnly)).map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    levels: [...definition.levels],
    managementOnly: definition.managementOnly
  }));
}

module.exports = {
  FATURA_CAPABILITIES,
  FATURA_ROLES,
  FATURA_SECTION_DEFINITIONS,
  FATURA_TEMPLATE_SECTION_ACCESS,
  SECTION_LEVEL_RANK,
  deriveCapabilitiesFromSectionAccess,
  deriveSectionAccessFromCapabilities,
  effectiveSectionAccess,
  hasSectionAccess,
  highestLevel,
  normalizeSectionAccess,
  publicSectionDefinitions,
  templateSectionAccess,
  visibleFaturaSections
};
