"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");
const ExcelJS = require("exceljs");
const {
  normalizeProcurement,
  normalizeStockState
} = require("./store/migrations");
const {
  FATURA_CAPABILITIES,
  FATURA_ROLES,
  deriveCapabilitiesFromSectionAccess,
  effectiveSectionAccess,
  hasSectionAccess,
  normalizeSectionAccess,
  publicSectionDefinitions: canonicalPublicSectionDefinitions,
  templateSectionAccess,
  visibleFaturaSections
} = require("./procurement-access");
const { normalizeProductCode } = require("./store/product-code-registry");
const stockService = require("./stock-service");

const IDEMPOTENCY_LIMIT = 1000;
const AUDIT_LIMIT = 5000;
const DOCUMENT_TYPES = new Set(["fatura", "irsaliye", "fiş", "makbuz", "diğer"]);
const LEDGER_TYPES = new Set(["invoice", "payment", "credit_note", "reversal", "opening_balance", "adjustment"]);
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIVILEGED_SHIPMENT_CAPABILITIES = ["procurement.read", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "supplier.manage"];
const FATURA_ACCESS_TEMPLATES = Object.freeze({
  stok_personeli: accessTemplate("stok_personeli", "Stok Personeli", "operasyon"),
  mal_kabul: accessTemplate("mal_kabul", "Mal Kabul Personeli", "mal_kabul"),
  satin_alma: accessTemplate("satin_alma", "Satın Alma", "satın_alma"),
  muhasebe: accessTemplate("muhasebe", "Muhasebe", "muhasebe"),
  yonetici: accessTemplate("yonetici", "Fatura Yöneticisi", "yönetici", true),
  ozel: accessTemplate("ozel", "Özel Yetki", "özel")
});

function accessTemplate(key, label, role, allowManagement = false) {
  const sectionAccess = templateSectionAccess(key);
  return Object.freeze({
    key,
    label,
    role,
    sectionAccess: Object.freeze({ ...sectionAccess }),
    capabilities: Object.freeze(deriveCapabilitiesFromSectionAccess(sectionAccess, { allowManagement }))
  });
}

function createProcurementService(options = {}) {
  const store = options.store;
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("Procurement servisi için kalıcı store gereklidir.");
  }
  const notificationService = options.notificationService || null;
  const notifyWorkforceChange = typeof options.notifyWorkforceChange === "function" ? options.notifyWorkforceChange : null;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${crypto.randomUUID()}`;
  const eventBus = new EventEmitter();
  eventBus.setMaxListeners(200);

  async function readSnapshot() {
    const data = await store.read();
    return { data, procurement: normalizeProcurement(data.procurement) };
  }

  async function context(actor) {
    const { data, procurement } = await readSnapshot();
    const publicActorValue = publicActor(actor);
    return {
      ok: true,
      revision: procurement.revision,
      actor: publicActorValue,
      access: {
        enabled: publicActorValue.accessEnabled,
        sections: publicActorValue.sections,
        sectionAccess: publicActorValue.sectionAccess
      },
      procurement: {
        version: procurement.version,
        revision: procurement.revision,
        settings: procurement.settings
      },
      revisions: {
        procurement: procurement.revision,
        inventory: Math.max(0, Number(data.revisions && (data.revisions.inventory ?? data.revisions.stock) || 0)),
        catalog: Math.max(0, Number(data.revisions && data.revisions.catalog || 0)),
        shipment: Math.max(0, Number(data.revisions && data.revisions.shipment || 0)),
        notification: Math.max(0, Number(data.revisions && data.revisions.notification || 0)),
        stock: Math.max(0, Number(data.revisions && data.revisions.stock || 0)),
        workforce: Math.max(0, Number(data.revisions && data.revisions.workforce || 0))
      }
    };
  }

  async function dashboard(actor) {
    requireCapability(actor, "procurement.read");
    requireSection(actor, "dashboard", "view");
    const { data, procurement } = await readSnapshot();
    const shipmentVisible = hasSectionAccess(actor, "documents", "view")
      || hasSectionAccess(actor, "shipments", "view")
      || hasSectionAccess(actor, "suppliers", "view");
    const supplierVisible = hasSectionAccess(actor, "suppliers", "view");
    const ledgerVisible = hasSectionAccess(actor, "ledger", "view");
    const linkVisible = hasSectionAccess(actor, "suppliers", "view") || hasSectionAccess(actor, "links", "view");
    const stockVisible = hasSectionAccess(actor, "stock", "view");
    const shipments = shipmentVisible ? visibleShipments(data.workforceShipments, actor).filter((shipment) => !shipment.removedAt) : [];
    const today = dateKey(now());
    const monthPrefix = today.slice(0, 7);
    const dueSoonDays = procurement.settings.dueSoonDays || 7;
    const dueSoonLimit = addDays(today, dueSoonDays);
    const visibleLedgerEntries = actor.type === "admin"
      ? procurement.ledgerEntries
      : procurement.ledgerEntries.filter((entry) => ledgerBranchId(entry, data, procurement) === actorBranchId(actor));
    const balances = supplierBalances(visibleLedgerEntries);
    const invoiceEntries = visibleLedgerEntries.filter((entry) => entry.type === "invoice" && !isReversed(entry, visibleLedgerEntries));
    const payments = visibleLedgerEntries.filter((entry) => entry.type === "payment" && !isReversed(entry, visibleLedgerEntries));
    const financialVisible = ledgerVisible && hasCapability(actor, "accounting.read");
    return {
      ok: true,
      revision: procurement.revision,
      dashboard: {
        financialVisible,
        visibility: { stock: stockVisible, shipments: shipmentVisible, suppliers: supplierVisible, links: linkVisible, ledger: ledgerVisible },
        supplierDebtKurus: financialVisible ? [...balances.values()].reduce((sum, balance) => addKurus(sum, Math.max(0, -balance)), 0) : 0,
        monthPurchasesKurus: financialVisible ? invoiceEntries
          .filter((entry) => String(entry.transactionDate || entry.createdAt || "").startsWith(monthPrefix))
          .reduce((sum, entry) => addKurus(sum, Math.abs(entry.amountKurus)), 0) : 0,
        monthPaymentsKurus: financialVisible ? payments
          .filter((entry) => String(entry.transactionDate || entry.createdAt || "").startsWith(monthPrefix))
          .reduce((sum, entry) => addKurus(sum, Math.max(0, entry.amountKurus)), 0) : 0,
        pendingShipments: shipmentVisible ? shipments.filter((shipment) => shipment.status === "onay_bekliyor").length : 0,
        unaccountedShipments: shipmentVisible && ledgerVisible ? shipments.filter((shipment) => !["taslak", "reddedildi"].includes(shipment.status)
          && shipment.accountingStatus !== "posted").length : 0,
        missingDocuments: shipmentVisible && hasSectionAccess(actor, "documents", "view") ? shipments.filter((shipment) => !(shipment.evidenceDocumentIds || []).length).length : 0,
        dueSoon: financialVisible ? invoiceEntries.filter((entry) => entry.dueDate && entry.dueDate >= today && entry.dueDate <= dueSoonLimit).length : 0,
        overdue: financialVisible ? invoiceEntries.filter((entry) => entry.dueDate && entry.dueDate < today).length : 0,
        recentPriceChanges: linkVisible ? procurement.supplierProductLinks
          .filter((link) => link.active !== false && link.lastPurchasePriceKurus !== link.defaultPurchasePriceKurus)
          .slice(-10)
          .reverse()
          .map((link) => ({
            id: link.id,
            supplierId: link.supplierId,
            stockProductId: link.stockProductId,
            stockProductCode: link.stockProductCode,
            previousPriceKurus: link.defaultPurchasePriceKurus,
            currentPriceKurus: link.lastPurchasePriceKurus,
            updatedAt: link.updatedAt
          })) : []
      }
    };
  }

  async function listSuppliers(actor, filters = {}) {
    // Tedarikçi listesi Mal Kabul, Belgeler, Cari ve Ürün Eşleşmeleri için ortak
    // destek verisidir; section gate route katmanında ilgili açık bölümü doğrular.
    requireAnyCapability(actor, ["supplier.read", "supplier.manage", "receipt.create", "procurement.read", "documents.read", "accounting.read"]);
    const { data, procurement } = await readSnapshot();
    const visibleLedgerEntries = actor.type === "admin"
      ? procurement.ledgerEntries
      : procurement.ledgerEntries.filter((entry) => ledgerBranchId(entry, data, procurement) === actorBranchId(actor));
    const balances = hasCapability(actor, "accounting.read") ? supplierBalances(visibleLedgerEntries) : null;
    const search = normalizeLookup(filters.search);
    const activeFilter = parseActiveFilter(filters.active);
    const suppliers = procurement.suppliers
      .filter((supplier) => activeFilter === null || supplier.active === activeFilter)
      .filter((supplier) => !search || normalizeLookup(`${supplier.code} ${supplier.name} ${supplier.contactName} ${supplier.phone}`).includes(search))
      .map((supplier) => publicSupplier(supplier, balances ? balances.get(supplier.id) || 0 : null))
      .sort((left, right) => left.name.localeCompare(right.name, "tr"));
    return { ok: true, revision: procurement.revision, suppliers };
  }

  async function createSupplier(actor, input, mutation) {
    requireCapability(actor, "supplier.manage");
    return mutate("supplier.create", actor, mutation, (data, procurement, helpers) => {
      const values = validateSupplierInput(input, { partial: false });
      assertUniqueSupplier(procurement.suppliers, values);
      const timestamp = isoNow(now);
      const supplierId = createId("supplier");
      const supplier = {
        id: supplierId,
        ...values,
        code: values.code || `TED-${supplierId.replace(/[^a-z0-9]/gi, "").slice(-8).toLocaleUpperCase("tr-TR")}`,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actor.id,
        updatedBy: actor.id
      };
      procurement.suppliers.push(supplier);
      return helpers.result("supplier", supplier.id, { supplier: publicSupplier(supplier, hasCapability(actor, "accounting.read") ? 0 : null) });
    });
  }

  async function updateSupplier(actor, supplierId, input, mutation) {
    requireCapability(actor, "supplier.manage");
    return mutate("supplier.update", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, supplierId);
      const values = validateSupplierInput(input, { partial: true });
      assertUniqueSupplier(procurement.suppliers, { ...supplier, ...values }, supplier.id);
      Object.assign(supplier, values, { updatedAt: isoNow(now), updatedBy: actor.id });
      const balance = hasCapability(actor, "accounting.read") ? balanceForSupplier(procurement.ledgerEntries, supplier.id) : null;
      return helpers.result("supplier", supplier.id, { supplier: publicSupplier(supplier, balance) });
    });
  }

  async function deactivateSupplier(actor, supplierId, input, mutation) {
    requireCapability(actor, "supplier.manage");
    return mutate("supplier.deactivate", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, supplierId);
      if (supplier.active === false) throw fail("Tedarikçi zaten pasif.", 409, "SUPPLIER_ALREADY_INACTIVE");
      supplier.active = false;
      supplier.deactivatedAt = isoNow(now);
      supplier.deactivationReason = text(input && input.reason, 500);
      supplier.updatedAt = supplier.deactivatedAt;
      supplier.updatedBy = actor.id;
      for (const shipment of data.workforceShipments || []) {
        if (String(shipment.supplierId || "") === String(supplier.id) && !shipment.supplierName) {
          shipment.supplierName = supplier.name;
        }
      }
      return helpers.result("supplier", supplier.id, {
        supplier: publicSupplier(supplier, hasCapability(actor, "accounting.read")
          ? balanceForSupplier(procurement.ledgerEntries, supplier.id)
          : null)
      });
    });
  }

  async function listProductLinks(actor, filters = {}) {
    requireAnyCapability(actor, ["procurement.read", "receipt.create", "supplierProduct.manage"]);
    const { data, procurement } = await readSnapshot();
    const products = indexStockProducts(data.stockState);
    const links = procurement.supplierProductLinks
      .filter((link) => !filters.supplierId || link.supplierId === String(filters.supplierId))
      .filter((link) => parseActiveFilter(filters.active) === null || link.active === parseActiveFilter(filters.active))
      .map((link) => publicProductLink(link, products))
      .sort((left, right) => String(left.supplierProductName || left.stockProductName || "").localeCompare(String(right.supplierProductName || right.stockProductName || ""), "tr"));
    return { ok: true, revision: procurement.revision, productLinks: links };
  }

  async function createProductLink(actor, input, mutation) {
    requireCapability(actor, "supplierProduct.manage");
    return mutate("product-link.create", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, input && input.supplierId, { active: true });
      const product = findStockProduct(data.stockState, input);
      if (procurement.supplierProductLinks.some((link) => link.supplierId === supplier.id
        && stockIdentity(link) === stockIdentity(product))) {
        throw fail("Bu tedarikçi ve stok ürünü daha önce eşleştirilmiş.", 409, "PRODUCT_LINK_EXISTS");
      }
      const timestamp = isoNow(now);
      const link = {
        id: createId("supplier-product-link"),
        supplierId: supplier.id,
        stockProductId: String(product.id),
        stockProductCode: normalizeProductCode(product.productCode),
        ...validateProductLinkInput(input, { partial: false, fallbackUnit: product.unit }),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actor.id,
        updatedBy: actor.id
      };
      procurement.supplierProductLinks.push(link);
      return helpers.result("supplierProductLink", link.id, { productLink: publicProductLink(link, indexStockProducts(data.stockState)) });
    });
  }

  async function updateProductLink(actor, linkId, input, mutation) {
    requireCapability(actor, "supplierProduct.manage");
    return mutate("product-link.update", actor, mutation, (data, procurement, helpers) => {
      const link = findById(procurement.supplierProductLinks, linkId, "Ürün eşleşmesi");
      const values = validateProductLinkInput(input, { partial: true, fallbackUnit: link.purchaseUnit });
      if (input && (input.stockProductId || input.stockProductCode || input.productId || input.productCode)) {
        const product = findStockProduct(data.stockState, input);
        const identity = stockIdentity(product);
        if (procurement.supplierProductLinks.some((item) => item.id !== link.id && item.supplierId === link.supplierId
          && stockIdentity(item) === identity)) {
          throw fail("Bu tedarikçi ve stok ürünü daha önce eşleştirilmiş.", 409, "PRODUCT_LINK_EXISTS");
        }
        link.stockProductId = String(product.id);
        link.stockProductCode = normalizeProductCode(product.productCode);
      }
      Object.assign(link, values, { updatedAt: isoNow(now), updatedBy: actor.id });
      return helpers.result("supplierProductLink", link.id, { productLink: publicProductLink(link, indexStockProducts(data.stockState)) });
    });
  }

  async function listSupplierIndependentProducts(actor, supplierId, filters = {}) {
    requireAnyCapability(actor, ["supplier.read", "supplier.manage", "supplierProduct.manage"]);
    const { procurement } = await readSnapshot();
    const supplier = findSupplier(procurement, supplierId);
    const activeFilter = parseActiveFilter(filters.active);
    const items = procurement.supplierIndependentProducts
      .filter((item) => item.supplierId === supplier.id)
      .filter((item) => activeFilter === null || item.active === activeFilter)
      .map(publicIndependentProduct)
      .sort((left, right) => left.name.localeCompare(right.name, "tr"));
    return { ok: true, revision: procurement.revision, supplierId: supplier.id, independentProducts: items };
  }

  async function createSupplierIndependentProduct(actor, supplierId, input, mutation) {
    requireAnyCapability(actor, ["supplier.manage", "supplierProduct.manage"]);
    return mutate("supplier-independent-product.create", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, supplierId, { active: true });
      const values = validateIndependentProductInput(input, { partial: false });
      const timestamp = isoNow(now);
      const stockResolution = resolveIndependentProductStock(data, actor, values, input, timestamp);
      if (!stockResolution.stockProduct) {
        throw fail("Mevcut bir stok ürünü seçin veya yeni stok ürünü bilgilerini girin.", 422, "STOCK_PRODUCT_LINK_REQUIRED");
      }
      assertUniqueIndependentProduct(procurement.supplierIndependentProducts, supplier.id, values);
      const item = {
        id: createId("supplier-independent-product"), supplierId: supplier.id, ...values,
        active: true, createdAt: timestamp, updatedAt: timestamp, createdBy: actor.id, updatedBy: actor.id
      };
      procurement.supplierIndependentProducts.push(item);
      const supplierProduct = publicIndependentProduct(item);
      return helpers.result("supplierIndependentProduct", item.id, {
        independentProduct: supplierProduct,
        supplierProduct,
        stockProduct: publicStockProduct(stockResolution.stockProduct),
        stockMatchStatus: "matched",
        createdStockProduct: stockResolution.createdStockProduct,
        inventoryRevision: Math.max(0, Number(data.revisions && data.revisions.inventory || 0)),
        catalogRevision: Math.max(0, Number(data.revisions && data.revisions.catalog || 0)),
        revisions: {
          inventory: Math.max(0, Number(data.revisions && data.revisions.inventory || 0)),
          catalog: Math.max(0, Number(data.revisions && data.revisions.catalog || 0)),
          stock: Math.max(0, Number(data.revisions && data.revisions.stock || 0))
        }
      });
    });
  }

  async function updateSupplierIndependentProduct(actor, supplierId, itemId, input, mutation) {
    requireAnyCapability(actor, ["supplier.manage", "supplierProduct.manage"]);
    return mutate("supplier-independent-product.update", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, supplierId);
      const item = findById(procurement.supplierIndependentProducts, itemId, "Bağımsız tedarikçi ürünü");
      if (item.supplierId !== supplier.id) throw fail("Bağımsız ürün bu tedarikçiye ait değil.", 404, "SUPPLIER_INDEPENDENT_PRODUCT_NOT_FOUND");
      const values = validateIndependentProductInput(input, { partial: true });
      const timestamp = isoNow(now);
      const stockResolution = resolveIndependentProductStock(data, actor, values, input, timestamp, item);
      assertUniqueIndependentProduct(procurement.supplierIndependentProducts, supplier.id, { ...item, ...values }, item.id);
      Object.assign(item, values, {
        archivedAt: values.active === false ? item.archivedAt || timestamp : values.active === true ? null : item.archivedAt || null,
        removedAt: values.active === false ? item.removedAt || timestamp : values.active === true ? null : item.removedAt || null,
        updatedAt: timestamp,
        updatedBy: actor.id
      });
      const supplierProduct = publicIndependentProduct(item);
      const linkedStockProduct = stockResolution.stockProduct
        || (item.stockProductId ? findStockProduct(data.stockState, { stockProductId: item.stockProductId }) : null);
      return helpers.result("supplierIndependentProduct", item.id, {
        independentProduct: supplierProduct,
        supplierProduct,
        stockProduct: linkedStockProduct ? publicStockProduct(linkedStockProduct) : null,
        stockMatchStatus: String(item.stockMatchStatus || (item.stockProductId ? "matched" : "unmatched")),
        createdStockProduct: stockResolution.createdStockProduct,
        inventoryRevision: Math.max(0, Number(data.revisions && data.revisions.inventory || 0)),
        catalogRevision: Math.max(0, Number(data.revisions && data.revisions.catalog || 0)),
        revisions: {
          inventory: Math.max(0, Number(data.revisions && data.revisions.inventory || 0)),
          catalog: Math.max(0, Number(data.revisions && data.revisions.catalog || 0)),
          stock: Math.max(0, Number(data.revisions && data.revisions.stock || 0))
        }
      });
    });
  }

  function resolveIndependentProductStock(data, actor, values, input, timestamp, currentItem = null) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const newStockProduct = source.newStockProduct && typeof source.newStockProduct === "object" && !Array.isArray(source.newStockProduct)
      ? source.newStockProduct
      : null;
    let stockProduct = null;
    let createdStockProduct = false;
    if (values.stockProductId) {
      stockProduct = findStockProduct(data.stockState, { stockProductId: values.stockProductId });
    } else if (newStockProduct) {
      requireCapability(actor, "inventory.catalog.manage");
      const created = stockService.createCanonicalStockProduct(data.stockState, {
        name: newStockProduct.name || values.name,
        baseUnit: newStockProduct.baseUnit || values.baseUnit,
        bulkUnit: newStockProduct.bulkUnit || values.bulkUnit,
        unitsPerBulkUnit: newStockProduct.unitsPerBulkUnit ?? newStockProduct.conversionFactor ?? values.conversionFactor,
        allowDecimal: newStockProduct.allowDecimal
      }, { now: timestamp, actorId: actor.id });
      data.stockState = created.stockState;
      data.stockUpdatedAt = timestamp;
      data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions) ? data.revisions : {};
      data.revisions.catalog = Math.max(0, Number(data.revisions.catalog || 0)) + 1;
      data.revisions.inventory = Math.max(0, Number(data.revisions.inventory || 0)) + 1;
      data.revisions.stock = Math.max(
        Math.max(0, Number(data.revisions.stock || 0)) + 1,
        data.revisions.catalog,
        data.revisions.inventory
      );
      stockProduct = created.product;
      createdStockProduct = true;
    } else if (currentItem && currentItem.stockProductId) {
      stockProduct = findStockProduct(data.stockState, { stockProductId: currentItem.stockProductId });
    }
    if (stockProduct) {
      values.stockProductId = String(stockProduct.id);
      values.stockMatchStatus = "matched";
      values.baseUnit = String(stockProduct.baseUnit || stockProduct.unit || values.baseUnit || "adet");
    }
    return { stockProduct, createdStockProduct };
  }

  async function listShipments(actor, filters = {}) {
    requireAnyCapability(actor, ["procurement.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "accounting.reverse", "supplier.manage"]);
    const { data, procurement } = await readSnapshot();
    const supplierIndex = new Map(procurement.suppliers.map((supplier) => [supplier.id, supplier]));
    let shipments = visibleShipments(data.workforceShipments, actor);
    const includeRemoved = String(filters.removed || "").toLowerCase() === "true";
    shipments = shipments.filter((shipment) => includeRemoved ? Boolean(shipment.removedAt) : !shipment.removedAt);
    if (filters.supplierId) shipments = shipments.filter((shipment) => shipment.supplierId === String(filters.supplierId));
    if (filters.status) shipments = shipments.filter((shipment) => shipment.status === String(filters.status));
    if (filters.accountingStatus) shipments = shipments.filter((shipment) => shipment.accountingStatus === String(filters.accountingStatus));
    return {
      ok: true,
      revision: procurement.revision,
      workforceRevision: workforceRevision(data),
      shipments: shipments.map((shipment) => publicShipment(shipment, supplierIndex.get(shipment.supplierId), actor, procurement))
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    };
  }

  async function getShipment(actor, shipmentId) {
    requireAnyCapability(actor, ["procurement.read", "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "accounting.reverse", "supplier.manage"]);
    const { data, procurement } = await readSnapshot();
    const shipment = findVisibleShipment(data, actor, shipmentId);
    const supplier = procurement.suppliers.find((item) => item.id === shipment.supplierId);
    const documents = procurement.documents
      .filter((document) => (shipment.evidenceDocumentIds || []).includes(document.id))
      .map(safeDocumentMetadata);
    const entries = hasCapability(actor, "accounting.read")
      ? withRunningBalances(procurement.ledgerEntries.filter((entry) => entry.shipmentId === shipment.id
        && (actor.type === "admin" || ledgerBranchId(entry, data, procurement) === actorBranchId(actor))))
      : [];
    return {
      ok: true,
      revision: procurement.revision,
      workforceRevision: workforceRevision(data),
      shipment: publicShipment(shipment, supplier, actor, procurement),
      documents,
      ledgerEntries: entries
    };
  }

  async function declineShipmentStock(actor, shipmentId, input, mutation) {
    requireCapability(actor, "receipt.approve");
    return mutate("shipment.stock.decline", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (shipment.removedAt) throw fail("Kaldırılmış sevkiyat güncellenemez.", 409, "SHIPMENT_REMOVED");
      if (shipment.stockAppliedAt || shipment.stockMovementRef) throw fail("Bu sevkiyat daha önce stoğa işlendi.", 409, "STOCK_ALREADY_APPLIED");
      if (shipment.status !== "onay_bekliyor") throw fail("Bu sevkiyat daha önce işleme alınmış.", 409, "SHIPMENT_STATE_CONFLICT");
      const timestamp = isoNow(now);
      Object.assign(shipment, {
        status: "onaylandı",
        operationalStatus: "arşivlendi",
        stockDecision: "declined",
        stockStatus: "not_applied",
        stockFailureCode: "",
        stockFailureMessage: "",
        procurementFinalizedAt: shipment.procurementFinalizedAt || timestamp,
        updatedAt: timestamp,
        revision: positiveRevision(shipment.revision) + 1
      });
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement)
      }, { branchId: shipment.branchId, workforceRevision: workforceRevisionValue });
    });
  }

  async function recordShipmentStockFailure(actor, shipmentId, input, mutation) {
    requireCapability(actor, "receipt.approve");
    return mutate("shipment.stock.failure", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (shipment.removedAt || shipment.stockAppliedAt) {
        return helpers.result("shipment", shipment.id, {
          shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement)
        });
      }
      if (shipment.status !== "onay_bekliyor") throw fail("Bu sevkiyat stok hata durumuna alınamaz.", 409, "SHIPMENT_STATE_CONFLICT");
      const timestamp = isoNow(now);
      Object.assign(shipment, {
        status: "onaylandı",
        operationalStatus: "arşivlendi",
        stockDecision: "requested",
        stockStatus: "failed",
        stockFailureCode: text(input && input.code, 120),
        stockFailureMessage: text(input && input.message, 500) || "Stok aktarımı tamamlanamadı.",
        procurementFinalizedAt: shipment.procurementFinalizedAt || timestamp,
        updatedAt: timestamp,
        revision: positiveRevision(shipment.revision) + 1
      });
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement)
      }, { branchId: shipment.branchId, workforceRevision: workforceRevisionValue });
    });
  }

  async function recordShipmentAccountingFailure(actor, shipmentId, input, mutation) {
    requireAnyCapability(actor, ["receipt.approve", "accounting.post"]);
    return mutate("shipment.account.failure", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (shipment.removedAt || shipment.accountingStatus === "posted") {
        return helpers.result("shipment", shipment.id, { shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement) });
      }
      const timestamp = isoNow(now);
      shipment.accountingStatus = "failed";
      shipment.accountingFailureMessage = text(input && input.message, 500) || "Cari kayıt oluşturulamadı.";
      shipment.accountingFailureCode = text(input && input.code, 120);
      shipment.updatedAt = timestamp;
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, { shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement) }, { workforceRevision: workforceRevisionValue });
    });
  }

  async function createShipment(actor, input, mutation) {
    requireCapability(actor, "receipt.create");
    return mutate("shipment.create", actor, mutation, (data, procurement, helpers) => {
      const supplierId = text(input && input.supplierId, 180);
      const supplier = supplierId ? findSupplier(procurement, supplierId, { active: true }) : null;
      const items = validateShipmentItems(data.stockState, input && input.items, createId, { procurement, supplier, now });
      const stockState = normalizeStockState(data.stockState);
      const destinationLocation = resolveOptionalStockLocation(stockState, input && input.destinationLocationId);
      const evidenceDocumentIds = validateDocumentIds(procurement, input && input.evidenceDocumentIds, actor);
      const timestamp = isoNow(now);
      const shipment = {
        id: createId("shipment"),
        userId: actor.id,
        userName: actor.name,
        supplierId: supplier ? supplier.id : "",
        supplierName: supplier ? supplier.name : "",
        branchId: actor.branchId || procurement.settings.defaultBranchId || "main",
        destinationLocationId: destinationLocation ? destinationLocation.id : null,
        destinationLocationName: destinationLocation ? destinationLocation.name : null,
        items,
        note: text(input && input.note, 1000),
        status: "taslak",
        operationalStatus: "taslak",
        evidenceDocumentIds,
        evidenceStatus: evidenceDocumentIds.length ? "available" : "missing",
        documentType: normalizeDocumentType(input && input.documentType, ""),
        documentNumber: text(input && input.documentNumber, 120),
        documentDate: validateOptionalDate(input && input.documentDate, "Belge tarihi"),
        shipmentDate: validateOptionalDate(input && (input.shipmentDate || input.documentDate), "Sevkiyat tarihi"),
        procurementFinalizedAt: input && input.finalized === true ? timestamp : null,
        accountingStatus: "not_posted",
        accountingEntryIds: [],
        accountingPostedAt: null,
        accountingPostedBy: "",
        stockAppliedAt: null,
        stockMovementRef: null,
        stockMovementRefs: [],
        approvedBy: null,
        approvedAt: null,
        requestId: helpers.requestId,
        revision: 1,
        expectedRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      data.workforceShipments = (data.workforceShipments || []).concat(shipment);
      linkDocumentsToShipment(procurement, evidenceDocumentIds, shipment);
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, { shipment: publicShipment(shipment, supplier, actor, procurement) }, {
        branchId: shipment.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function updateShipment(actor, shipmentId, input, mutation) {
    requireAnyCapability(actor, ["receipt.create", "receipt.approve", "accounting.post"]);
    return mutate("shipment.update", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      const draft = shipment.status === "taslak";
      const canMaintainAccountingMetadata = hasCapability(actor, "receipt.approve") || hasCapability(actor, "accounting.post");
      if (draft && !canEditShipment(actor, shipment)) throw fail("Bu sevkiyatı düzenleme yetkiniz yok.", 403, "FORBIDDEN");
      if (!draft && !canMaintainAccountingMetadata) {
        throw fail("Gönderilmiş sevkiyatta yalnız yetkili kullanıcı belge ve tedarikçi bilgisini düzenleyebilir.", 403, "FORBIDDEN");
      }
      if (!draft && Object.prototype.hasOwnProperty.call(input || {}, "items")) {
        throw fail("Gönderilmiş sevkiyatın ürün satırları değiştirilemez.", 409, "SHIPMENT_ITEMS_LOCKED");
      }
      let supplier = shipment.supplierId ? findSupplier(procurement, shipment.supplierId) : null;
      if (supplier && !shipment.supplierName) shipment.supplierName = supplier.name;
      if (Object.prototype.hasOwnProperty.call(input || {}, "supplierId")) {
        supplier = input.supplierId ? findSupplier(procurement, input.supplierId, { active: true }) : null;
        shipment.supplierId = supplier ? supplier.id : "";
        shipment.supplierName = supplier ? supplier.name : "";
      }
      if (draft && Object.prototype.hasOwnProperty.call(input || {}, "items")) shipment.items = validateShipmentItems(data.stockState, input.items, createId, { procurement, supplier, now });
      if (Object.prototype.hasOwnProperty.call(input || {}, "evidenceDocumentIds")) {
        shipment.evidenceDocumentIds = validateDocumentIds(procurement, input.evidenceDocumentIds, actor);
        linkDocumentsToShipment(procurement, shipment.evidenceDocumentIds, shipment);
      }
      if (Object.prototype.hasOwnProperty.call(input || {}, "note")) shipment.note = text(input.note, 1000);
      if (Object.prototype.hasOwnProperty.call(input || {}, "documentType")) shipment.documentType = normalizeDocumentType(input.documentType, "");
      if (Object.prototype.hasOwnProperty.call(input || {}, "documentNumber")) shipment.documentNumber = text(input.documentNumber, 120);
      if (Object.prototype.hasOwnProperty.call(input || {}, "documentDate")) shipment.documentDate = validateOptionalDate(input.documentDate, "Belge tarihi");
      if (Object.prototype.hasOwnProperty.call(input || {}, "destinationLocationId")) {
        if (shipment.stockAppliedAt || shipment.stockMovementRef) {
          throw fail("Stok etkisi uygulanmış sevkiyatın hedef deposu değiştirilemez.", 409, "SHIPMENT_DESTINATION_LOCKED");
        }
        const destinationLocation = resolveOptionalStockLocation(normalizeStockState(data.stockState), input.destinationLocationId);
        shipment.destinationLocationId = destinationLocation ? destinationLocation.id : null;
        shipment.destinationLocationName = destinationLocation ? destinationLocation.name : null;
      }
      shipment.evidenceStatus = (shipment.evidenceDocumentIds || []).length ? "available" : "missing";
      shipment.updatedAt = isoNow(now);
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, { shipment: publicShipment(shipment, supplier, actor, procurement) }, {
        branchId: shipment.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function submitShipment(actor, shipmentId, input, mutation) {
    requireCapability(actor, "receipt.submit");
    return mutate("shipment.submit", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (!canEditShipment(actor, shipment)) throw fail("Bu sevkiyatı gönderme yetkiniz yok.", 403, "FORBIDDEN");
      if (shipment.status !== "taslak") throw fail("Yalnız taslak sevkiyat gönderilebilir.", 409, "SHIPMENT_NOT_DRAFT");
      if (!(shipment.items || []).length) throw fail("Sevkiyat satırı zorunludur.", 400, "SHIPMENT_ITEMS_REQUIRED");
      if (shipment.supplierId) findSupplier(procurement, shipment.supplierId, { active: true });
      const timestamp = isoNow(now);
      shipment.status = "onay_bekliyor";
      shipment.operationalStatus = "onay_bekliyor";
      shipment.submittedAt = timestamp;
      shipment.updatedAt = timestamp;
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      helpers.notifyManager(data, {
        category: "shipment",
        eventType: "shipment_submitted",
        title: "Yeni mal kabul onay bekliyor",
        body: `${shipment.userName || "Personel"} tarafından ${(shipment.items || []).length} satırlık mal kabul gönderildi.`,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: `/fatura/?view=stock&workforce=shipments&entityId=${encodeURIComponent(shipment.id)}`,
        dedupeKey: `procurement-shipment-submitted:${shipment.id}`
      });
      notifyFaturaReceiptUsers(data, helpers, shipment, {
        eventType: "shipment_submitted",
        title: "Yeni mal kabul onay bekliyor",
        body: `${shipment.userName || "Personel"} tarafından ${(shipment.items || []).length} satırlık mal kabul gönderildi.`,
        severity: "warning",
        dedupeSuffix: "submitted"
      });
      if (!(shipment.evidenceDocumentIds || []).length) {
        helpers.notifyManager(data, {
          category: "shipment",
          eventType: "document_missing",
          title: "Mal kabul belgesi eksik",
          body: `${shipment.userName || "Personel"} belge eklemeden mal kabul gönderdi. Stok onayı belge olmadan da ayrı değerlendirilebilir.`,
          severity: "warning",
          entityType: "shipment",
          entityId: shipment.id,
          deepLink: `/fatura/?view=stock&workforce=shipments&entityId=${encodeURIComponent(shipment.id)}`,
          dedupeKey: `procurement-document-missing:${shipment.id}`
        });
        notifyFaturaReceiptUsers(data, helpers, shipment, {
          eventType: "document_missing",
          title: "Mal kabul belgesi eksik",
          body: `${shipment.userName || "Personel"} belge eklemeden mal kabul gönderdi.`,
          severity: "warning",
          dedupeSuffix: "document-missing"
        });
      }
      return helpers.result("shipment", shipment.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement)
      }, {
        branchId: shipment.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function rejectShipment(actor, shipmentId, input, mutation) {
    requireCapability(actor, "receipt.reject");
    return mutate("shipment.reject", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (shipment.status !== "onay_bekliyor") throw fail("Yalnız onay bekleyen sevkiyat reddedilebilir.", 409, "SHIPMENT_STATE_CONFLICT");
      if (shipment.stockAppliedAt || shipment.stockMovementRef) throw fail("Stok etkisi uygulanmış sevkiyat reddedilemez.", 409, "STOCK_ALREADY_APPLIED");
      const reason = text(input && (input.reason || input.rejectionReason || input.note), 500);
      if (!reason) throw fail("Reddetme nedeni zorunludur.", 400, "REJECTION_REASON_REQUIRED");
      const timestamp = isoNow(now);
      Object.assign(shipment, {
        status: "reddedildi",
        operationalStatus: "reddedildi",
        rejectionReason: reason,
        rejectedAt: timestamp,
        rejectedBy: actor.id,
        updatedAt: timestamp,
        revision: positiveRevision(shipment.revision) + 1
      });
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      helpers.notifyPerson(data, shipment.userId, {
        category: "shipment",
        eventType: "shipment_rejected",
        title: "Mal kabul reddedildi",
        body: reason,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: `/personel/?section=shipment&shipmentId=${encodeURIComponent(shipment.id)}`,
        dedupeKey: `procurement-shipment-rejected:${shipment.id}:${shipment.userId}`
      });
      return helpers.result("shipment", shipment.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement)
      }, {
        branchId: shipment.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function deleteShipment(actor, shipmentId, mutation) {
    requireAnyCapability(actor, ["receipt.create", "receipt.reject"]);
    return mutate("shipment.delete", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      const canDeleteOwn = hasCapability(actor, "receipt.create") && canEditShipment(actor, shipment);
      if (!hasCapability(actor, "receipt.reject") && !canDeleteOwn) {
        throw fail("Bu mal kabul kaydını silme yetkiniz yok.", 403, "FORBIDDEN");
      }
      if (!shipmentCanBeDeleted(shipment, procurement)) {
        throw fail("Yalnız stok ve muhasebe etkisi olmayan taslak veya reddedilmiş kayıtlar silinebilir.", 409, "SHIPMENT_DELETE_CONFLICT");
      }
      const itemIds = new Set((shipment.items || []).map((item) => String(item.id || "")).filter(Boolean));
      let unlinkedDocuments = 0;
      for (const document of procurement.documents || []) {
        const shipmentIds = Array.isArray(document.shipmentIds) ? document.shipmentIds : [];
        const shipmentItemIds = Array.isArray(document.shipmentItemIds) ? document.shipmentItemIds : [];
        const nextShipmentIds = shipmentIds.filter((id) => String(id) !== String(shipment.id));
        const nextShipmentItemIds = shipmentItemIds.filter((id) => !itemIds.has(String(id)));
        if (nextShipmentIds.length !== shipmentIds.length || nextShipmentItemIds.length !== shipmentItemIds.length) {
          document.shipmentIds = nextShipmentIds;
          document.shipmentItemIds = nextShipmentItemIds;
          document.updatedAt = isoNow(now);
          unlinkedDocuments += 1;
        }
      }
      data.workforceShipments = (data.workforceShipments || []).filter((item) => String(item.id) !== String(shipment.id));
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, {
        deleted: true,
        shipmentId: shipment.id
      }, {
        branchId: shipment.branchId,
        previousStatus: shipment.status,
        unlinkedDocuments,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function removeShipment(actor, shipmentId, input, mutation) {
    requireCapability(actor, "receipt.reject");
    return mutate("shipment.remove", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (shipment.removedAt) throw fail("Sevkiyat daha önce kaldırılmış.", 409, "SHIPMENT_ALREADY_REMOVED");
      const reason = text(input && (input.reason || input.removalReason || input.note), 1000);
      if (!reason) throw fail("Kaldırma nedeni zorunludur.", 400, "REMOVAL_REASON_REQUIRED");
      const timestamp = isoNow(now);
      let stockState = normalizeStockState(data.stockState);
      const referencedIds = new Set((shipment.stockMovementRefs || []).map(String).filter(Boolean));
      for (const movement of stockState.movements || []) {
        if (String(movement.shipmentId || "") === String(shipment.id)
          || String(movement.referenceType || "") === "shipment" && String(movement.referenceId || "") === String(shipment.id)) {
          referencedIds.add(String(movement.id));
        }
      }
      const referencedOriginalMovements = [...referencedIds]
        .map((movementId) => (stockState.movements || []).find((movement) => String(movement.id) === movementId))
        .filter((movement) => movement && movement.type !== "reversal");
      if (shipment.stockAppliedAt && !referencedOriginalMovements.length) {
        throw fail("Sevkiyatın stok hareketi bulunamadığı için güvenli ters kayıt oluşturulamadı.", 409, "SHIPMENT_STOCK_TRACE_MISSING");
      }
      const stockReversalMovementIds = [];
      for (const movementId of referencedIds) {
        const original = (stockState.movements || []).find((movement) => String(movement.id) === movementId);
        if (!original || original.reversedMovementId || original.type === "reversal") continue;
        const reversed = stockService.reverseMovement(stockState, movementId, {
          requestId: `${helpers.requestId.slice(0, 130)}:stock:${stockReversalMovementIds.length}`,
          note: `Sevkiyat kaldırma: ${reason}`
        }, {
          type: actor.type === "admin" ? "admin" : "personel",
          id: actor.id,
          name: actor.name,
          branchId: actor.branchId,
          inventoryManage: true
        }, { now: timestamp });
        stockState = reversed.stockState;
        stockReversalMovementIds.push(...(reversed.movements || []).map((movement) => movement.id));
      }
      if (stockReversalMovementIds.length) {
        data.stockState = stockState;
        data.stockUpdatedAt = timestamp;
        data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
        data.revisions.inventory = Math.max(0, Number(data.revisions.inventory || 0)) + 1;
        data.revisions.stock = Math.max(Number(data.revisions.stock || 0) + 1, data.revisions.inventory);
      }
      const stockEffectReversed = referencedOriginalMovements.length > 0 && referencedOriginalMovements.every((movement) => {
        const latest = (stockState.movements || []).find((item) => String(item.id) === String(movement.id));
        return Boolean(latest && latest.reversedMovementId);
      });

      const originalLedger = procurement.ledgerEntries.find((entry) => entry.shipmentId === shipment.id && entry.type === "invoice");
      if (shipment.accountingStatus === "posted" && !originalLedger) {
        throw fail("Sevkiyatın cari hareketi bulunamadığı için güvenli ters kayıt oluşturulamadı.", 409, "SHIPMENT_LEDGER_TRACE_MISSING");
      }
      let ledgerReversal = originalLedger && procurement.ledgerEntries.find((entry) => entry.reversalOf === originalLedger.id);
      if (originalLedger && !ledgerReversal) {
        ledgerReversal = {
          id: createId("ledger"), supplierId: originalLedger.supplierId, branchId: shipmentBranchId(shipment),
          shipmentId: shipment.id, documentId: originalLedger.documentId, type: "reversal",
          amountKurus: -originalLedger.amountKurus,
          balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, originalLedger.supplierId), -originalLedger.amountKurus),
          transactionDate: timestamp.slice(0, 10), dueDate: "", note: reason,
          sourceType: "shipment_removal", sourceId: shipment.id, reversalOf: originalLedger.id,
          createdBy: actor.id, createdAt: timestamp, idempotencyKey: helpers.requestId
        };
        procurement.ledgerEntries.push(ledgerReversal);
      }
      Object.assign(shipment, {
        removedAt: timestamp,
        removedBy: actor.id,
        removedByName: actor.name,
        removalReason: reason,
        operationalStatus: "kaldırıldı",
        stockStatus: stockEffectReversed ? "reversed" : shipment.stockStatus,
        stockReversalMovementIds,
        accountingStatus: ledgerReversal ? "reversed" : shipment.accountingStatus,
        accountingReversalEntryId: ledgerReversal ? ledgerReversal.id : "",
        updatedAt: timestamp,
        revision: positiveRevision(shipment.revision) + 1
      });
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, {
        removed: true,
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement),
        stockReversalMovementIds,
        ledgerReversalEntryId: ledgerReversal ? ledgerReversal.id : "",
        inventoryRevision: Math.max(0, Number(data.revisions && data.revisions.inventory || 0)),
        stockUpdatedAt: stockReversalMovementIds.length ? timestamp : null
      }, { branchId: shipment.branchId, workforceRevision: workforceRevisionValue });
    });
  }

  async function accountShipment(actor, shipmentId, input, mutation) {
    requireCapability(actor, "accounting.post");
    return accountShipmentInternal("shipment.account", actor, shipmentId, input, mutation, { requireDocument: true });
  }

  async function accountShipmentAfterStock(actor, shipmentId, input, mutation) {
    requireAnyCapability(actor, ["receipt.approve", "accounting.post"]);
    return accountShipmentInternal("shipment.account.auto", actor, shipmentId, input, mutation, { requireStock: true });
  }

  async function accountShipmentWithoutStock(actor, shipmentId, input, mutation) {
    requireAnyCapability(actor, ["receipt.approve", "accounting.post"]);
    return accountShipmentInternal("shipment.account.without-stock", actor, shipmentId, input, mutation, { requireNoStock: true });
  }

  function accountShipmentInternal(operation, actor, shipmentId, input, mutation, options = {}) {
    return mutate(operation, actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      if (shipment.removedAt) throw fail("Kaldırılmış sevkiyat cari hesaba işlenemez.", 409, "SHIPMENT_REMOVED");
      if (["taslak", "reddedildi"].includes(shipment.status)) {
        throw fail("Taslak veya reddedilmiş sevkiyat muhasebeleştirilemez.", 409, "SHIPMENT_STATE_CONFLICT");
      }
      if (options.requireStock && !shipment.stockAppliedAt) throw fail("Stok aktarımı tamamlanmadan otomatik cari kayıt oluşturulamaz.", 409, "STOCK_NOT_APPLIED");
      if (options.requireNoStock && shipment.stockAppliedAt) throw fail("Bu sevkiyat zaten stoğa işlendi.", 409, "STOCK_ALREADY_APPLIED");
      if (options.requireNoStock && shipment.stockStatus !== "failed") {
        throw fail("Cari kararı yalnızca başarısız stok aktarımından sonra verilebilir.", 409, "STOCK_FAILURE_REQUIRED");
      }
      const supplier = findSupplier(procurement, shipment.supplierId);
      const existing = procurement.ledgerEntries.find((entry) => entry.shipmentId === shipment.id && entry.type === "invoice");
      if (existing) {
        return helpers.result("ledgerEntry", existing.id, {
          shipment: publicShipment(shipment, supplier, actor, procurement),
          ledgerEntry: existing,
          alreadyAccounted: true
        });
      }
      const document = options.requireDocument
        ? resolveAccountingDocument(procurement, shipment, input)
        : resolveShipmentEvidenceDocument(procurement, shipment, input);
      const amountKurus = positiveKurus(input && input.amountKurus !== undefined
        ? input.amountKurus
        : shipmentTotalKurus(shipment), "Muhasebe tutarı");
      const timestamp = isoNow(now);
      const transactionDate = validateOptionalDate(input && input.transactionDate, "İşlem tarihi")
        || validateOptionalDate(shipment.shipmentDate || shipment.documentDate, "Sevkiyat tarihi")
        || timestamp.slice(0, 10);
      const dueDate = validateOptionalDate(input && input.dueDate, "Vade tarihi")
        || addDays((document && document.documentDate) || transactionDate, supplier.paymentTermDays || 0);
      const entry = {
        id: createId("ledger"),
        supplierId: supplier.id,
        branchId: shipmentBranchId(shipment),
        shipmentId: shipment.id,
        documentId: document ? document.id : "",
        type: "invoice",
        amountKurus: -amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, supplier.id), -amountKurus),
        transactionDate,
        dueDate,
        note: text(input && input.note, 1000) || shipment.note || "Mal kabul muhasebe kaydı",
        sourceType: "workforce_shipment",
        sourceId: shipment.id,
        reversalOf: "",
        createdBy: actor.id,
        createdAt: timestamp,
        idempotencyKey: helpers.requestId
      };
      procurement.ledgerEntries.push(entry);
      for (const line of shipment.items || []) {
        const link = procurement.supplierProductLinks.find((item) => item.supplierId === supplier.id
          && stockIdentity(item) === stockIdentity(line));
        if (!link || !Number.isSafeInteger(line.unitPriceKurus)) continue;
        link.lastPurchasePriceKurus = line.unitPriceKurus;
        link.updatedAt = timestamp;
        link.updatedBy = actor.id;
      }
      shipment.accountingStatus = "posted";
      shipment.accountingEntryIds = [...new Set([...(shipment.accountingEntryIds || []), entry.id])];
      shipment.accountingPostedAt = timestamp;
      shipment.accountingPostedBy = actor.id;
      shipment.accountingSource = options.requireStock ? "stock_success" : options.requireNoStock ? "stock_failure_override" : "manual";
      shipment.updatedAt = timestamp;
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      helpers.notifyPerson(data, shipment.userId, {
        category: "shipment",
        eventType: "accounting_posted",
        title: "Mal kabul muhasebeleştirildi",
        body: `${supplier.name} için cari kayıt oluşturuldu.`,
        severity: "success",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: `/personel/?section=shipment&shipmentId=${encodeURIComponent(shipment.id)}`,
        dedupeKey: `procurement-accounting-posted:${shipment.id}`
      });
      return helpers.result("ledgerEntry", entry.id, {
        shipment: publicShipment(shipment, supplier, actor, procurement),
        ledgerEntry: entry
      }, {
        branchId: shipment.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function reverseShipmentAccounting(actor, shipmentId, input, mutation) {
    requireCapability(actor, "accounting.reverse");
    return mutate("shipment.account.reverse", actor, mutation, (data, procurement, helpers) => {
      const shipment = findVisibleShipment(data, actor, shipmentId);
      const original = procurement.ledgerEntries.find((entry) => entry.shipmentId === shipment.id && entry.type === "invoice");
      if (!original) throw fail("Ters çevrilecek muhasebe kaydı bulunamadı.", 409, "ACCOUNTING_ENTRY_NOT_FOUND");
      if (procurement.ledgerEntries.some((entry) => entry.reversalOf === original.id)) {
        throw fail("Muhasebe kaydı daha önce ters çevrilmiş.", 409, "ACCOUNTING_ALREADY_REVERSED");
      }
      const reason = text(input && (input.reason || input.note), 1000);
      if (!reason) throw fail("Ters kayıt nedeni zorunludur.", 400, "REVERSAL_REASON_REQUIRED");
      const timestamp = isoNow(now);
      const reversal = {
        id: createId("ledger"),
        supplierId: original.supplierId,
        branchId: shipmentBranchId(shipment),
        shipmentId: shipment.id,
        documentId: original.documentId,
        type: "reversal",
        amountKurus: -original.amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, original.supplierId), -original.amountKurus),
        transactionDate: timestamp.slice(0, 10),
        dueDate: "",
        note: reason,
        sourceType: "accounting_reversal",
        sourceId: original.id,
        reversalOf: original.id,
        createdBy: actor.id,
        createdAt: timestamp,
        idempotencyKey: helpers.requestId
      };
      procurement.ledgerEntries.push(reversal);
      shipment.accountingStatus = "reversed";
      shipment.accountingEntryIds = [...new Set([...(shipment.accountingEntryIds || []), reversal.id])];
      shipment.accountingReversedAt = timestamp;
      shipment.accountingReversedBy = actor.id;
      shipment.updatedAt = timestamp;
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      const workforceRevisionValue = touchWorkforceRevision(data);
      helpers.notifyPerson(data, shipment.userId, {
        category: "shipment",
        eventType: "accounting_reversed",
        title: "Muhasebe kaydı ters çevrildi",
        body: reason,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: `/personel/?section=shipment&shipmentId=${encodeURIComponent(shipment.id)}`,
        dedupeKey: `procurement-accounting-reversed:${shipment.id}:${reversal.id}`
      });
      return helpers.result("ledgerEntry", reversal.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor, procurement),
        ledgerEntry: reversal
      }, {
        branchId: shipment.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function recordDocument(actor, input, storedFile, mutation) {
    requireCapability(actor, "documents.upload");
    return mutate("document.upload", actor, mutation, (data, procurement, helpers) => {
      if (!storedFile || !storedFile.physicalName || !storedFile.mimeType) {
        throw fail("Belge dosyası güvenli depoya yazılamadı.", 400, "DOCUMENT_FILE_REQUIRED");
      }
      const supplierId = text(input && input.supplierId, 180);
      if (supplierId) findSupplier(procurement, supplierId, { active: true });
      const shipmentIds = uniqueStrings(input && input.shipmentIds, 180);
      const shipments = shipmentIds.map((id) => findVisibleShipment(data, actor, id));
      const shipmentBranches = new Set(shipments.map(shipmentBranchId));
      if (shipmentBranches.size > 1) throw fail("Tek belge farklı şubelere bağlanamaz.", 409, "DOCUMENT_BRANCH_MISMATCH");
      const timestamp = isoNow(now);
      const duplicate = storedFile.sha256 && procurement.documents.find((document) => document.sha256 === storedFile.sha256
        && document.physicalName === storedFile.physicalName
        && !document.archivedAt);
      const document = {
        id: createId("document"),
        branchId: shipments.length ? shipmentBranchId(shipments[0]) : actorBranchId(actor),
        supplierId: supplierId || shipments.find((shipment) => shipment.supplierId) && shipments.find((shipment) => shipment.supplierId).supplierId || "",
        shipmentIds,
        shipmentItemIds: uniqueStrings(input && input.shipmentItemIds, 180),
        documentType: normalizeDocumentType(input && input.documentType, "diğer"),
        documentNumber: text(input && input.documentNumber, 120),
        documentDate: validateOptionalDate(input && input.documentDate, "Belge tarihi"),
        originalName: text(storedFile.originalName || input && input.originalName, 255),
        mimeType: text(storedFile.mimeType, 100),
        sizeBytes: nonNegativeInteger(storedFile.sizeBytes, "Belge boyutu"),
        width: nonNegativeInteger(storedFile.width || 0, "Belge genişliği"),
        height: nonNegativeInteger(storedFile.height || 0, "Belge yüksekliği"),
        extension: text(storedFile.extension, 20),
        sha256: text(storedFile.sha256, 128),
        physicalName: duplicate ? duplicate.physicalName : text(storedFile.physicalName, 255),
        thumbnailPhysicalName: duplicate ? duplicate.thumbnailPhysicalName : text(storedFile.thumbnailPhysicalName, 255),
        thumbnailMimeType: duplicate ? duplicate.thumbnailMimeType : text(storedFile.thumbnailMimeType, 100),
        thumbnailSizeBytes: duplicate ? duplicate.thumbnailSizeBytes : nonNegativeInteger(storedFile.thumbnailSizeBytes || storedFile.sizeBytes, "Önizleme boyutu"),
        thumbnailGenerated: duplicate ? duplicate.thumbnailGenerated === true : storedFile.thumbnailGenerated === true,
        metadataStripped: storedFile.metadataStripped !== false,
        reencoded: storedFile.reencoded === true,
        physicalSharedWith: duplicate ? duplicate.id : "",
        archivedAt: null,
        archivedBy: "",
        createdAt: timestamp,
        createdBy: actor.id
      };
      procurement.documents.push(document);
      for (const shipment of shipments) {
        if (document.supplierId && shipment.supplierId && shipment.supplierId !== document.supplierId) {
          throw fail("Belge tedarikçisi sevkiyat tedarikçisiyle eşleşmiyor.", 409, "DOCUMENT_SUPPLIER_MISMATCH");
        }
        if (document.supplierId && !shipment.supplierId) shipment.supplierId = document.supplierId;
        shipment.evidenceDocumentIds = [...new Set([...(shipment.evidenceDocumentIds || []), document.id])];
        shipment.evidenceStatus = "available";
        shipment.updatedAt = timestamp;
        shipment.revision = positiveRevision(shipment.revision) + 1;
        shipment.expectedRevision = shipment.revision;
      }
      const workforceRevisionValue = shipments.length ? touchWorkforceRevision(data) : 0;
      helpers.notifyManager(data, {
        category: "shipment",
        eventType: "document_uploaded",
        title: "Yeni belge yüklendi",
        body: `${actor.name || "Personel"} bir ${document.documentType} belgesi yükledi.`,
        severity: "info",
        entityType: "document",
        entityId: document.id,
        deepLink: "/fatura/",
        dedupeKey: `procurement-document-uploaded:${document.id}`
      });
      return helpers.result("document", document.id, {
        document: safeDocumentMetadata(document),
        duplicateContent: Boolean(duplicate)
      }, {
        duplicatePhysicalDocumentId: duplicate && duplicate.id || "",
        branchId: document.branchId,
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function listDocuments(actor, filters = {}) {
    requireCapability(actor, "documents.read");
    const { data, procurement } = await readSnapshot();
    const documents = procurement.documents
      .filter((document) => actor.type === "admin" || documentBranchId(document, data) === actorBranchId(actor))
      .filter((document) => filters.archived === "true" ? Boolean(document.archivedAt) : !document.archivedAt)
      .filter((document) => !filters.supplierId || document.supplierId === String(filters.supplierId))
      .filter((document) => !filters.documentType || document.documentType === String(filters.documentType))
      .map(safeDocumentMetadata)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    return { ok: true, revision: procurement.revision, documents };
  }

  async function getDocument(actor, documentId, options = {}) {
    requireCapability(actor, "documents.read");
    const { data, procurement } = await readSnapshot();
    const document = findById(procurement.documents, documentId, "Belge");
    assertDocumentVisibility(data, document, actor);
    if (document.archivedAt && options.includeArchived !== true) throw fail("Belge arşivlenmiş.", 410, "DOCUMENT_ARCHIVED");
    return { document, revision: procurement.revision };
  }

  async function archiveDocument(actor, documentId, input, mutation) {
    requireCapability(actor, "documents.archive");
    return mutate("document.archive", actor, mutation, (data, procurement, helpers) => {
      const document = findById(procurement.documents, documentId, "Belge");
      assertDocumentVisibility(data, document, actor);
      if (document.archivedAt) throw fail("Belge zaten arşivlenmiş.", 409, "DOCUMENT_ALREADY_ARCHIVED");
      document.archivedAt = isoNow(now);
      document.archivedBy = actor.id;
      document.archiveReason = text(input && (input.reason || input.note), 500);
      let workforceChanged = false;
      for (const shipment of data.workforceShipments || []) {
        if (!(shipment.evidenceDocumentIds || []).includes(document.id)) continue;
        const liveEvidence = (shipment.evidenceDocumentIds || []).some((id) => {
          const linked = procurement.documents.find((item) => item.id === id);
          return linked && !linked.archivedAt;
        });
        shipment.evidenceStatus = liveEvidence ? "available" : "archived";
        workforceChanged = true;
      }
      const workforceRevisionValue = workforceChanged ? touchWorkforceRevision(data) : 0;
      return helpers.result("document", document.id, { document: safeDocumentMetadata(document) }, {
        branchId: documentBranchId(document, data),
        workforceRevision: workforceRevisionValue
      });
    });
  }

  async function listLedger(actor, filters = {}) {
    requireCapability(actor, "accounting.read");
    const { data, procurement } = await readSnapshot();
    let entries = procurement.ledgerEntries;
    if (actor.type !== "admin") entries = entries.filter((entry) => ledgerBranchId(entry, data, procurement) === actorBranchId(actor));
    if (filters.supplierId) entries = entries.filter((entry) => entry.supplierId === String(filters.supplierId));
    const balances = supplierBalances(entries);
    let running = withRunningBalances(entries);
    if (filters.date) running = running.filter((entry) => String(entry.transactionDate || entry.createdAt || "").slice(0, 10) === String(filters.date));
    if (filters.type && LEDGER_TYPES.has(String(filters.type))) running = running.filter((entry) => entry.type === String(filters.type));
    let payments = procurement.payments || [];
    if (actor.type !== "admin") payments = payments.filter((payment) => String(payment.branchId || "main") === actorBranchId(actor));
    if (filters.supplierId) payments = payments.filter((payment) => payment.supplierId === String(filters.supplierId));
    if (filters.date) payments = payments.filter((payment) => String(payment.paymentDate || payment.createdAt || "").slice(0, 10) === String(filters.date));
    return {
      ok: true,
      revision: procurement.revision,
      entries: running,
      payments: [...payments].sort((left, right) => String(right.paymentDate || right.createdAt || "").localeCompare(String(left.paymentDate || left.createdAt || ""))),
      balanceKurus: [...balances.values()].reduce((sum, balance) => addKurus(sum, balance), 0),
      debtKurus: [...balances.values()].reduce((sum, balance) => addKurus(sum, Math.max(0, -balance)), 0)
    };
  }

  async function createLedgerEntry(actor, input, mutation) {
    requireCapability(actor, "accounting.post");
    return mutate("ledger.create", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, input && input.supplierId);
      const type = String(input && input.type || "invoice");
      if (!["invoice", "credit_note", "opening_balance", "adjustment"].includes(type)) {
        throw fail("Manuel cari hareket türü geçersiz.", 400, "INVALID_LEDGER_TYPE");
      }
      const documentId = text(input && input.documentId, 180);
      let document = null;
      if (documentId) {
        document = findById(procurement.documents, documentId, "Belge");
        assertDocumentVisibility(data, document, actor);
        if (document.archivedAt) throw fail("Arşivlenmiş belge muhasebeleştirilemez.", 409, "DOCUMENT_ARCHIVED");
        if (document.supplierId && document.supplierId !== supplier.id) {
          throw fail("Belge ile tedarikçi eşleşmiyor.", 409, "DOCUMENT_SUPPLIER_MISMATCH");
        }
      }
      if (type === "invoice") {
        const allowed = new Set(procurement.settings.accountingDocumentTypes || ["fatura", "fiş", "makbuz"]);
        if (!document || !allowed.has(document.documentType)) {
          throw fail("Fatura hareketi için muhasebeleştirilebilir belge zorunludur.", 409, "ACCOUNTING_DOCUMENT_REQUIRED");
        }
        if (procurement.ledgerEntries.some((entry) => entry.documentId === document.id && entry.type === "invoice")) {
          throw fail("Bu belge daha önce muhasebeleştirilmiş.", 409, "DOCUMENT_ALREADY_ACCOUNTED");
        }
      }
      const rawAmount = signedSafeKurus(input && input.amountKurus, "Cari hareket tutarı");
      const amountKurus = type === "invoice"
        ? -Math.abs(rawAmount)
        : type === "credit_note"
          ? Math.abs(rawAmount)
          : rawAmount;
      const timestamp = isoNow(now);
      const entry = {
        id: createId("ledger"),
        supplierId: supplier.id,
        branchId: document ? documentBranchId(document, data) : actorBranchId(actor),
        shipmentId: "",
        documentId,
        type,
        amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, supplier.id), amountKurus),
        transactionDate: validateOptionalDate(input && input.transactionDate, "İşlem tarihi") || timestamp.slice(0, 10),
        dueDate: validateOptionalDate(input && input.dueDate, "Vade tarihi"),
        note: text(input && input.note, 1000),
        sourceType: document ? "procurement_document" : "manual_accounting",
        sourceId: document ? document.id : "",
        reversalOf: "",
        createdBy: actor.id,
        createdAt: timestamp,
        idempotencyKey: helpers.requestId
      };
      procurement.ledgerEntries.push(entry);
      return helpers.result("ledgerEntry", entry.id, { ledgerEntry: entry });
    });
  }

  async function reverseLedgerEntry(actor, entryId, input, mutation) {
    requireCapability(actor, "accounting.reverse");
    return mutate("ledger.reverse", actor, mutation, (data, procurement, helpers) => {
      const original = findById(procurement.ledgerEntries, entryId, "Cari hareket");
      assertLedgerVisibility(data, procurement, original, actor);
      if (original.type === "reversal" || original.reversalOf) throw fail("Ters kayıt yeniden ters çevrilemez.", 409, "REVERSAL_NOT_REVERSIBLE");
      if (original.shipmentId) throw fail("Sevkiyat hareketini sevkiyat ters muhasebe işlemiyle düzeltin.", 409, "USE_SHIPMENT_REVERSAL");
      if (original.sourceType === "payment") throw fail("Ödeme hareketini ödeme ters işlemiyle düzeltin.", 409, "USE_PAYMENT_REVERSAL");
      if (procurement.ledgerEntries.some((entry) => entry.reversalOf === original.id)) {
        throw fail("Cari hareket daha önce ters çevrilmiş.", 409, "LEDGER_ALREADY_REVERSED");
      }
      const reason = text(input && (input.reason || input.note), 1000);
      if (!reason) throw fail("Ters kayıt nedeni zorunludur.", 400, "REVERSAL_REASON_REQUIRED");
      const timestamp = isoNow(now);
      const reversal = {
        id: createId("ledger"),
        supplierId: original.supplierId,
        branchId: ledgerBranchId(original, data, procurement),
        shipmentId: "",
        documentId: original.documentId,
        type: "reversal",
        amountKurus: -original.amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, original.supplierId), -original.amountKurus),
        transactionDate: timestamp.slice(0, 10),
        dueDate: "",
        note: reason,
        sourceType: "ledger_reversal",
        sourceId: original.id,
        reversalOf: original.id,
        createdBy: actor.id,
        createdAt: timestamp,
        idempotencyKey: helpers.requestId
      };
      procurement.ledgerEntries.push(reversal);
      return helpers.result("ledgerEntry", reversal.id, { ledgerEntry: reversal });
    });
  }

  async function createPayment(actor, input, mutation) {
    requireCapability(actor, "payment.create");
    return mutate("payment.create", actor, mutation, (data, procurement, helpers) => {
      const supplier = findSupplier(procurement, input && input.supplierId);
      const amountKurus = positiveKurus(input && input.amountKurus, "Ödeme tutarı");
      const documentId = text(input && input.documentId, 180);
      if (!documentId) throw fail("Ödeme belgesi zorunludur.", 422, "PAYMENT_DOCUMENT_REQUIRED");
      const document = documentId ? findById(procurement.documents, documentId, "Belge") : null;
      if (document) {
        assertDocumentVisibility(data, document, actor);
        if (document.archivedAt) throw fail("Arşivlenmiş belge ödemeye bağlanamaz.", 409, "DOCUMENT_ARCHIVED");
        if (document.supplierId && document.supplierId !== supplier.id) throw fail("Belge ile ödeme tedarikçisi eşleşmiyor.", 409, "DOCUMENT_SUPPLIER_MISMATCH");
      }
      const timestamp = isoNow(now);
      const paymentDate = validateOptionalDate(input && input.paymentDate, "Ödeme tarihi");
      if (!paymentDate) throw fail("Ödeme tarihi zorunludur.", 422, "PAYMENT_DATE_REQUIRED");
      const payment = {
        id: createId("payment"),
        supplierId: supplier.id,
        branchId: document ? documentBranchId(document, data) : actorBranchId(actor),
        documentId,
        amountKurus,
        paymentDate,
        method: text(input && input.method, 80),
        reference: text(input && input.reference, 180),
        note: text(input && input.note, 1000),
        status: "recorded",
        reversalLedgerEntryId: "",
        reversedAt: null,
        reversedBy: "",
        createdAt: timestamp,
        createdBy: actor.id
      };
      const entry = {
        id: createId("ledger"),
        supplierId: supplier.id,
        branchId: payment.branchId,
        shipmentId: "",
        documentId,
        type: "payment",
        amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, supplier.id), amountKurus),
        transactionDate: payment.paymentDate,
        dueDate: "",
        note: payment.note || "Tedarikçi ödemesi",
        sourceType: "payment",
        sourceId: payment.id,
        reversalOf: "",
        createdBy: actor.id,
        createdAt: timestamp,
        idempotencyKey: helpers.requestId
      };
      payment.ledgerEntryId = entry.id;
      procurement.payments.push(payment);
      procurement.ledgerEntries.push(entry);
      helpers.notifyManager(data, {
        category: "shipment",
        eventType: "payment_recorded",
        title: "Tedarikçi ödemesi kaydedildi",
        body: `${supplier.name} için ödeme kaydedildi.`,
        severity: "success",
        entityType: "payment",
        entityId: payment.id,
        deepLink: "/fatura/",
        dedupeKey: `procurement-payment-recorded:${payment.id}`
      });
      return helpers.result("payment", payment.id, { payment, ledgerEntry: entry });
    });
  }

  async function reversePayment(actor, paymentId, input, mutation) {
    requireCapability(actor, "payment.reverse");
    return mutate("payment.reverse", actor, mutation, (data, procurement, helpers) => {
      const payment = findById(procurement.payments, paymentId, "Ödeme");
      assertPaymentVisibility(payment, actor);
      if (payment.status === "reversed") throw fail("Ödeme daha önce ters çevrilmiş.", 409, "PAYMENT_ALREADY_REVERSED");
      const original = findById(procurement.ledgerEntries, payment.ledgerEntryId, "Ödeme cari kaydı");
      const reason = text(input && (input.reason || input.note), 1000);
      if (!reason) throw fail("Ters ödeme nedeni zorunludur.", 400, "REVERSAL_REASON_REQUIRED");
      const timestamp = isoNow(now);
      const reversal = {
        id: createId("ledger"),
        supplierId: payment.supplierId,
        branchId: String(payment.branchId || "main"),
        shipmentId: "",
        documentId: payment.documentId,
        type: "reversal",
        amountKurus: -original.amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, payment.supplierId), -original.amountKurus),
        transactionDate: timestamp.slice(0, 10),
        dueDate: "",
        note: reason,
        sourceType: "payment_reversal",
        sourceId: payment.id,
        reversalOf: original.id,
        createdBy: actor.id,
        createdAt: timestamp,
        idempotencyKey: helpers.requestId
      };
      procurement.ledgerEntries.push(reversal);
      Object.assign(payment, {
        status: "reversed",
        reversalLedgerEntryId: reversal.id,
        reversedAt: timestamp,
        reversedBy: actor.id,
        reversedByName: actor.name,
        reversalReason: reason
      });
      return helpers.result("payment", payment.id, { payment, ledgerEntry: reversal });
    });
  }

  async function listTrash(actor) {
    requireAnyCapability(actor, ["procurement.read", "accounting.read", "documents.read"]);
    const { data, procurement } = await readSnapshot();
    const suppliers = new Map(procurement.suppliers.map((supplier) => [String(supplier.id), supplier]));
    const actorNames = new Map([
      ["admin", "Yönetici"],
      ...(data.recipeUsers || []).map((user) => [String(user.id || ""), String(user.name || user.username || user.id || "")])
    ]);
    const records = [];
    for (const shipment of visibleShipments(data.workforceShipments, actor).filter((item) => item.removedAt)) {
      records.push({
        id: shipment.id, type: "shipment", title: `Sevkiyat · ${String(shipment.shipmentDate || shipment.documentDate || shipment.id)}`,
        supplierId: shipment.supplierId, supplierName: suppliers.get(String(shipment.supplierId))?.name || shipment.supplierName || "Tedarikçi belirtilmedi",
        amountKurus: shipmentTotalKurus(shipment), reason: shipment.removalReason || "—", actorName: shipment.removedByName || shipment.removedBy || "—",
        removedAt: shipment.removedAt, stockReversalMovementIds: shipment.stockReversalMovementIds || [], ledgerEntryId: shipment.accountingReversalEntryId || ""
      });
    }
    for (const payment of procurement.payments || []) {
      if (payment.status !== "reversed") continue;
      if (actor.type !== "admin" && String(payment.branchId || "main") !== actorBranchId(actor)) continue;
      records.push({
        id: payment.id, type: "payment", title: "Tedarikçi ödemesi", supplierId: payment.supplierId,
        supplierName: suppliers.get(String(payment.supplierId))?.name || "Tedarikçi belirtilmedi", amountKurus: payment.amountKurus,
        reason: payment.reversalReason || "—", actorName: payment.reversedByName || payment.reversedBy || "—", removedAt: payment.reversedAt,
        ledgerEntryId: payment.reversalLedgerEntryId || ""
      });
    }
    for (const entry of procurement.ledgerEntries || []) {
      if (entry.type !== "reversal" || ["payment_reversal", "shipment_removal"].includes(entry.sourceType)) continue;
      if (actor.type !== "admin" && ledgerBranchId(entry, data, procurement) !== actorBranchId(actor)) continue;
      records.push({
        id: entry.id, type: "ledger", title: "Cari ters kayıt", supplierId: entry.supplierId,
        supplierName: suppliers.get(String(entry.supplierId))?.name || "Tedarikçi belirtilmedi", amountKurus: Math.abs(Number(entry.amountKurus || 0)),
        reason: entry.note || "—", actorName: actorNames.get(String(entry.createdBy || "")) || entry.createdBy || "—", removedAt: entry.createdAt, ledgerEntryId: entry.id
      });
    }
    return { ok: true, revision: procurement.revision, records: records.sort((left, right) => String(right.removedAt || "").localeCompare(String(left.removedAt || ""))) };
  }

  async function purgeTrashRecord(actor, recordType, recordId, mutation) {
    const type = String(recordType || "").trim().toLowerCase();
    const requiredCapability = { shipment: "receipt.reject", payment: "payment.reverse", ledger: "accounting.reverse" }[type];
    if (!requiredCapability) throw fail("Çöp Kutusu kayıt türü geçersiz.", 422, "INVALID_TRASH_RECORD_TYPE");
    requireCapability(actor, requiredCapability);
    const operation = `${type === "shipment" ? "shipment" : type}.trash.purge`;
    return mutate(operation, actor, mutation, (data, procurement, helpers) => {
      if (type === "shipment") {
        const shipment = findVisibleShipment(data, actor, recordId);
        if (!shipment.removedAt) throw fail("Yalnız Çöp Kutusu'ndaki sevkiyat kalıcı silinebilir.", 409, "SHIPMENT_NOT_IN_TRASH");
        const itemIds = new Set((shipment.items || []).map((item) => String(item.id || "")).filter(Boolean));
        let unlinkedDocuments = 0;
        for (const document of procurement.documents || []) {
          const currentShipmentIds = Array.isArray(document.shipmentIds) ? document.shipmentIds : [];
          const currentItemIds = Array.isArray(document.shipmentItemIds) ? document.shipmentItemIds : [];
          const nextShipmentIds = currentShipmentIds.filter((id) => String(id) !== String(shipment.id));
          const nextItemIds = currentItemIds.filter((id) => !itemIds.has(String(id)));
          if (nextShipmentIds.length === currentShipmentIds.length && nextItemIds.length === currentItemIds.length) continue;
          document.shipmentIds = nextShipmentIds;
          document.shipmentItemIds = nextItemIds;
          document.updatedAt = isoNow(now);
          unlinkedDocuments += 1;
        }
        const ledgerCountBefore = procurement.ledgerEntries.length;
        procurement.ledgerEntries = procurement.ledgerEntries.filter((entry) => (
          String(entry.shipmentId || "") !== String(shipment.id)
          && !(entry.sourceType === "shipment_removal" && String(entry.sourceId || "") === String(shipment.id))
        ));
        data.workforceShipments = (data.workforceShipments || []).filter((item) => String(item.id) !== String(shipment.id));
        const workforceRevisionValue = touchWorkforceRevision(data);
        return helpers.result("shipment", shipment.id, { purged: true, type, id: shipment.id }, {
          branchId: shipment.branchId,
          unlinkedDocuments,
          removedLedgerEntries: ledgerCountBefore - procurement.ledgerEntries.length,
          workforceRevision: workforceRevisionValue
        });
      }

      if (type === "payment") {
        const payment = findById(procurement.payments, recordId, "Ödeme");
        assertPaymentVisibility(payment, actor);
        if (payment.status !== "reversed") throw fail("Yalnız Çöp Kutusu'ndaki ödeme kalıcı silinebilir.", 409, "PAYMENT_NOT_IN_TRASH");
        const ledgerIds = new Set([payment.ledgerEntryId, payment.reversalLedgerEntryId].map(String).filter(Boolean));
        procurement.ledgerEntries = procurement.ledgerEntries.filter((entry) => !ledgerIds.has(String(entry.id)));
        procurement.payments = procurement.payments.filter((item) => String(item.id) !== String(payment.id));
        return helpers.result("payment", payment.id, { purged: true, type, id: payment.id }, {
          branchId: payment.branchId,
          removedLedgerEntries: ledgerIds.size
        });
      }

      const reversal = findById(procurement.ledgerEntries, recordId, "Cari ters kayıt");
      assertLedgerVisibility(data, procurement, reversal, actor);
      if (reversal.type !== "reversal" || ["payment_reversal", "shipment_removal"].includes(reversal.sourceType)) {
        throw fail("Yalnız bağımsız Çöp Kutusu ters kaydı kalıcı silinebilir.", 409, "LEDGER_ENTRY_NOT_IN_TRASH");
      }
      const ledgerIds = new Set([reversal.id, reversal.reversalOf].map(String).filter(Boolean));
      procurement.ledgerEntries = procurement.ledgerEntries.filter((entry) => !ledgerIds.has(String(entry.id)));
      return helpers.result("ledgerEntry", reversal.id, { purged: true, type, id: reversal.id }, {
        branchId: ledgerBranchId(reversal, data, procurement),
        removedLedgerEntries: ledgerIds.size
      });
    });
  }

  async function listAudit(actor, filters = {}) {
    requireCapability(actor, "procurement.users.manage");
    const { procurement } = await readSnapshot();
    let events = procurement.auditEvents;
    if (filters.entityType) events = events.filter((event) => event.entityType === String(filters.entityType));
    if (filters.entityId) events = events.filter((event) => event.entityId === String(filters.entityId));
    const limit = clampInteger(filters.limit, 100, 1, 500);
    return {
      ok: true,
      revision: procurement.revision,
      auditEvents: events.slice(-limit).reverse()
    };
  }

  async function listUsers(actor) {
    requireCapability(actor, "procurement.users.manage");
    const { data, procurement } = await readSnapshot();
    return {
      ok: true,
      revision: procurement.revision,
      users: (data.recipeUsers || []).map(publicProcurementUser),
      accessTemplates: publicAccessTemplates(),
      sections: publicSectionDefinitions()
    };
  }

  async function updateUserAccess(actor, userId, input, mutation) {
    requireCapability(actor, "procurement.users.manage");
    return mutate("user-access.update", actor, mutation, (data, procurement, helpers) => {
      const user = findById(data.recipeUsers, userId, "Personel");
      const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
      const templateKey = String(source.faturaTemplate || source.template || "ozel").trim();
      const template = FATURA_ACCESS_TEMPLATES[templateKey];
      if (!template) throw fail("Fatura yetki şablonu geçersiz.", 400, "INVALID_FATURA_TEMPLATE");
      const role = templateKey === "ozel" ? String(source.faturaRole || "özel") : template.role;
      if (!FATURA_ROLES.has(role)) throw fail("Fatura rolü geçersiz.", 400, "INVALID_FATURA_ROLE");
      if (templateKey === "ozel" && role === "yönetici") throw fail("Fatura Yöneticisi rolü yalnız hazır yönetici şablonuyla verilebilir.", 400, "INVALID_FATURA_ROLE");
      const allowManagement = templateKey === "yonetici";
      if (templateKey === "ozel" && source.faturaSectionAccess && typeof source.faturaSectionAccess === "object") {
        const definitions = canonicalPublicSectionDefinitions();
        const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
        for (const [sectionId, level] of Object.entries(source.faturaSectionAccess)) {
          const definition = definitionsById.get(sectionId);
          if (!definition || !definition.levels.includes(String(level))) {
            throw fail("Fatura bölüm yetkisi geçersiz.", 400, "INVALID_FATURA_SECTION_ACCESS", { sectionId, level });
          }
        }
      }
      const sectionAccess = templateKey === "ozel"
        ? normalizeSectionAccess(source.faturaSectionAccess && typeof source.faturaSectionAccess === "object"
            ? source.faturaSectionAccess
            : user.faturaSectionAccess, {
            capabilities: user.faturaCapabilities,
            allowManagement: false
          })
        : { ...template.sectionAccess };
      const requestedCapabilities = deriveCapabilitiesFromSectionAccess(sectionAccess, { allowManagement });
      const accessEnabled = typeof source.faturaAccessEnabled === "boolean"
        ? source.faturaAccessEnabled
        : Object.values(sectionAccess).some((level) => level !== "off");
      const capabilities = accessEnabled ? requestedCapabilities : [];
      if (capabilities.some((capability) => !FATURA_CAPABILITIES.has(capability))) {
        throw fail("Bilinmeyen fatura yetkisi gönderildi.", 400, "INVALID_CAPABILITY");
      }
      const previous = publicProcurementUser(user);
      user.faturaAccessEnabled = accessEnabled;
      user.faturaRole = role;
      user.faturaTemplate = templateKey;
      user.faturaCapabilities = capabilities;
      user.faturaSectionAccess = sectionAccess;
      user.updatedAt = isoNow(now);
      const updated = publicProcurementUser(user);
      helpers.notifyPerson(data, user.id, {
        category: "system",
        eventType: "procurement_access_updated",
        title: accessEnabled ? "Fatura erişimin güncellendi" : "Fatura erişimin kaldırıldı",
        body: accessEnabled
          ? "Fatura erişimin ve bölüm yetkilerin güncellendi."
          : "Yönetici Fatura uygulaması erişimini kapattı.",
        severity: accessEnabled ? "info" : "warning",
        entityType: "procurement_access",
        entityId: String(user.id),
        deepLink: "/fatura/",
        dedupeKey: `procurement-access:${user.id}:${helpers.requestId}`,
        metadata: { accessEnabled, template: templateKey, role, sectionAccess }
      });
      return helpers.result("personel", user.id, { user: updated }, {
        previous: {
          accessEnabled: previous.faturaAccessEnabled,
          template: previous.faturaTemplate,
          role: previous.faturaRole,
          sectionAccess: previous.faturaSectionAccess,
          capabilities: previous.faturaCapabilities.join(",")
        },
        next: {
          accessEnabled: updated.faturaAccessEnabled,
          template: updated.faturaTemplate,
          role: updated.faturaRole,
          sectionAccess: updated.faturaSectionAccess,
          capabilities: updated.faturaCapabilities.join(",")
        }
      });
    });
  }

  async function updateSettings(actor, input, mutation) {
    requireCapability(actor, "procurement.users.manage");
    return mutate("settings.update", actor, mutation, (data, procurement, helpers) => {
      const source = input && typeof input === "object" ? input : {};
      if (Object.prototype.hasOwnProperty.call(source, "dueSoonDays")) {
        const value = Number(source.dueSoonDays);
        if (!Number.isInteger(value) || value < 1 || value > 90) throw fail("Yaklaşan vade günü 1-90 arasında olmalıdır.", 400, "INVALID_DUE_SOON_DAYS");
        procurement.settings.dueSoonDays = value;
      }
      if (Object.prototype.hasOwnProperty.call(source, "units")) {
        const units = uniqueStrings(source.units, 40);
        if (!units.length || units.length > 50) throw fail("Birim sözlüğü 1-50 değer içermelidir.", 400, "INVALID_UNITS");
        procurement.settings.units = units;
      }
      if (Object.prototype.hasOwnProperty.call(source, "accountingDocumentTypes")) {
        const documentTypes = uniqueStrings(source.accountingDocumentTypes, 40);
        if (!documentTypes.length || documentTypes.some((type) => !["fatura", "fiş", "makbuz"].includes(type))) {
          throw fail("Muhasebeleştirilebilir belge türleri geçersiz.", 400, "INVALID_ACCOUNTING_DOCUMENT_TYPES");
        }
        procurement.settings.accountingDocumentTypes = documentTypes;
      }
      procurement.settings.currency = "TRY";
      procurement.settings.updatedAt = isoNow(now);
      procurement.settings.updatedBy = actor.id;
      return helpers.result("procurementSettings", "settings", { settings: procurement.settings });
    });
  }

  async function exportData(actor, filters = {}) {
    const kind = ["ledger", "suppliers", "shipments"].includes(String(filters.kind || ""))
      ? String(filters.kind)
      : "ledger";
    if (kind === "ledger") {
      requireSection(actor, "ledger", "view");
      requireCapability(actor, "accounting.read");
    } else if (kind === "suppliers") {
      requireSection(actor, "suppliers", "view");
      requireCapability(actor, "supplier.read");
    } else {
      requireSection(actor, "shipments", "view");
      requireCapability(actor, "procurement.read");
    }
    const { data, procurement } = await readSnapshot();
    const supplierIndex = new Map(procurement.suppliers.map((supplier) => [String(supplier.id), supplier]));
    const visibleLedgerEntries = actor.type === "admin"
      ? procurement.ledgerEntries
      : procurement.ledgerEntries.filter((entry) => ledgerBranchId(entry, data, procurement) === actorBranchId(actor));
    if (kind === "ledger") {
      const supplierId = text(filters.supplierId, 180);
      const selectedSupplier = supplierId ? findSupplier(procurement, supplierId) : null;
      const selectedDate = validateOptionalDate(filters.date, "Tarih");
      const scopedEntries = supplierId
        ? visibleLedgerEntries.filter((entry) => String(entry.supplierId) === supplierId)
        : visibleLedgerEntries;
      const runningEntries = withRunningBalances(scopedEntries);
      const filteredEntries = selectedDate
        ? runningEntries.filter((entry) => String(entry.transactionDate || entry.createdAt || "").slice(0, 10) === selectedDate)
        : runningEntries;
      let visiblePayments = (procurement.payments || []).filter((payment) => payment.status !== "reversed");
      if (actor.type !== "admin") visiblePayments = visiblePayments.filter((payment) => String(payment.branchId || "main") === actorBranchId(actor));
      if (supplierId) visiblePayments = visiblePayments.filter((payment) => String(payment.supplierId) === supplierId);
      if (selectedDate) visiblePayments = visiblePayments.filter((payment) => String(payment.paymentDate || payment.createdAt || "").slice(0, 10) === selectedDate);
      const balances = supplierBalances(scopedEntries);
      const currentDebtKurus = [...balances.values()].reduce((sum, balance) => addKurus(sum, Math.max(0, -balance)), 0);
      const paymentTotalKurus = visiblePayments.reduce((sum, payment) => addKurus(sum, Number(payment.amountKurus || 0)), 0);
      return createLedgerWorkbookFile({
        entries: filteredEntries,
        supplierIndex,
        supplierName: selectedSupplier ? selectedSupplier.name : "Tüm Tedarikçiler",
        selectedDate,
        currentDebtKurus,
        paymentTotalKurus,
        reportDate: now()
      });
    }
    let headers;
    let rows;
    if (kind === "suppliers") {
      const balances = supplierBalances(visibleLedgerEntries);
      headers = ["Kod", "Tedarikçi", "Vergi No", "Telefon", "E-posta", "Vade (gün)", "Durum", "Bakiye (kuruş)"];
      rows = procurement.suppliers.map((supplier) => [supplier.code, supplier.name, supplier.taxNumber, supplier.phone, supplier.email,
        supplier.paymentTermDays, supplier.active ? "Aktif" : "Pasif", balances.get(supplier.id) || 0]);
    } else if (kind === "shipments") {
      headers = ["Sevkiyat", "Tedarikçi", "Personel", "Durum", "Stok", "Muhasebe", "Belge", "Oluşturma"];
      rows = visibleShipments(data.workforceShipments, actor).filter((shipment) => !shipment.removedAt).map((shipment) => [shipment.id,
        supplierIndex.get(shipment.supplierId) && supplierIndex.get(shipment.supplierId).name || "", shipment.userName,
        shipment.status, shipment.stockAppliedAt ? "Uygulandı" : "Bekliyor", shipment.accountingStatus,
        shipment.evidenceStatus, shipment.createdAt]);
    }
    return {
      filename: `tahmisci-${kind}-${dateKey(now())}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`
    };
  }

  async function findIdempotentResponse(actor, operation, requestId) {
    const key = validateRequestId(requestId);
    const { procurement } = await readSnapshot();
    const record = findIdempotency(procurement, actor, key);
    if (!record) return null;
    if (record.operation !== operation) throw fail("Idempotency-Key daha önce farklı bir işlemde kullanıldı.", 409, "IDEMPOTENCY_CONFLICT");
    return { ...record.response, idempotent: true };
  }

  function subscribe(listener) {
    eventBus.on("change", listener);
    return () => eventBus.off("change", listener);
  }

  function publishExternalEvent(event) {
    eventBus.emit("change", {
      type: text(event && event.type, 120) || "procurement.updated",
      entityType: text(event && event.entityType, 100),
      entityId: text(event && event.entityId, 180),
      branchId: text(event && event.branchId, 80),
      revision: nonNegativeInteger(event && event.revision, "Revision"),
      shipmentRevision: Math.max(0, Math.trunc(Number(event && event.shipmentRevision || 0))),
      createdAt: event && event.createdAt || isoNow(now)
    });
  }

  async function mutate(operation, actor, mutation = {}, worker) {
    const requestId = validateRequestId(mutation.requestId);
    const expectedRevision = validateExpectedRevision(mutation.expectedRevision);
    const pendingNotifications = [];
    let response;
    let event;
    let replayed = false;
    await store.update((data, updateContext = {}) => {
      const procurement = normalizeProcurement(data.procurement);
      data.procurement = procurement;
      const prior = findIdempotency(procurement, actor, requestId);
      if (prior) {
        if (prior.operation !== operation) throw fail("Idempotency-Key daha önce farklı bir işlemde kullanıldı.", 409, "IDEMPOTENCY_CONFLICT");
        response = { ...prior.response, idempotent: true };
        replayed = true;
        return updateContext.noChange || data;
      }
      if (expectedRevision !== procurement.revision) {
        throw fail("Procurement verisi değişti. Güncel veriyi alıp tekrar deneyin.", 409, "PROCUREMENT_REVISION_CONFLICT", {
          expectedRevision,
          actualRevision: procurement.revision
        });
      }
      const helpers = mutationHelpers(data, procurement, actor, requestId, pendingNotifications);
      const outcome = worker(data, procurement, helpers) || {};
      const revision = procurement.revision + 1;
      procurement.revision = revision;
      if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) data.revisions = {};
      data.revisions.procurement = revision;
      const shipmentRevision = operation.startsWith("shipment.")
        ? (data.revisions.shipment = Math.max(0, Number(data.revisions.shipment || 0)) + 1)
        : Math.max(0, Number(data.revisions.shipment || 0));
      response = { ok: true, requestId, revision, shipmentRevision, ...(outcome.payload || {}) };
      procurement.auditEvents.push({
        id: createId("procurement-audit"),
        action: operation,
        entityType: outcome.entityType || "procurement",
        entityId: outcome.resourceId || "",
        actorType: actor.type,
        actorId: actor.id,
        actorName: actor.name,
        revision,
        shipmentRevision,
        requestId,
        metadata: sanitizeMetadata(outcome.metadata),
        createdAt: isoNow(now)
      });
      procurement.auditEvents = procurement.auditEvents.slice(-AUDIT_LIMIT);
      procurement.idempotencyRecords.push({
        id: idempotencyRecordId(actor, requestId),
        key: requestId,
        operation,
        actorId: actor.id,
        resourceId: outcome.resourceId || "",
        revision,
        response,
        createdAt: isoNow(now)
      });
      procurement.idempotencyRecords = procurement.idempotencyRecords.slice(-IDEMPOTENCY_LIMIT);
      event = {
        type: operation,
        entityType: outcome.entityType || "procurement",
        entityId: outcome.resourceId || "",
        revision,
        shipmentRevision,
        branchId: text(outcome.metadata && outcome.metadata.branchId, 80),
        workforceRevision: Math.max(0, Math.trunc(Number(outcome.metadata && outcome.metadata.workforceRevision || 0))),
        createdAt: isoNow(now)
      };
      return data;
    });
    if (!replayed) {
      publishNotifications(notificationService, pendingNotifications);
      eventBus.emit("change", event);
      if (notifyWorkforceChange && event.workforceRevision > 0) {
        notifyWorkforceChange({ revision: event.workforceRevision, scope: "workforce", action: "invalidate" });
      }
    }
    return response;
  }

  function mutationHelpers(data, procurement, actor, requestId, pendingNotifications) {
    return {
      requestId,
      result(entityType, resourceId, payload, metadata) {
        return { entityType, resourceId, payload, metadata };
      },
      notifyManager(target, input) {
        return queueNotification(notificationService, target, pendingNotifications, {
          recipientRole: "manager",
          recipientId: "manager",
          ...input
        });
      },
      notifyPerson(target, personId, input) {
        if (!personId) return null;
        return queueNotification(notificationService, target, pendingNotifications, {
          recipientRole: "personnel",
          recipientId: String(personId),
          ...input
        });
      }
    };
  }

  return {
    accountShipment,
    accountShipmentAfterStock,
    accountShipmentWithoutStock,
    archiveDocument,
    context,
    createPayment,
    createLedgerEntry,
    createProductLink,
    createSupplierIndependentProduct,
    createShipment,
    createSupplier,
    dashboard,
    deactivateSupplier,
    declineShipmentStock,
    deleteShipment,
    exportData,
    findIdempotentResponse,
    getDocument,
    getShipment,
    listAudit,
    listDocuments,
    listLedger,
    listProductLinks,
    listSupplierIndependentProducts,
    listShipments,
    listSuppliers,
    listTrash,
    listUsers,
    purgeTrashRecord,
    publishExternalEvent,
    recordDocument,
    recordShipmentAccountingFailure,
    recordShipmentStockFailure,
    rejectShipment,
    removeShipment,
    reversePayment,
    reverseLedgerEntry,
    reverseShipmentAccounting,
    submitShipment,
    subscribe,
    updateProductLink,
    updateSupplierIndependentProduct,
    updateSettings,
    updateShipment,
    updateSupplier,
    updateUserAccess
  };
}

function requireCapability(actor, capability) {
  if (hasCapability(actor, capability)) return;
  throw fail("Bu işlem için yetkiniz yok.", 403, "PROCUREMENT_CAPABILITY_REQUIRED", { capability });
}

function requireAnyCapability(actor, capabilities) {
  if (capabilities.some((capability) => hasCapability(actor, capability))) return;
  throw fail("Bu işlem için yetkiniz yok.", 403, "PROCUREMENT_CAPABILITY_REQUIRED", { capabilities });
}

function requireSection(actor, sectionId, minimumLevel = "view") {
  if (hasSectionAccess(actor, sectionId, minimumLevel)) return;
  throw fail("Bu Fatura bölümüne erişim yetkiniz yok.", 403, "PROCUREMENT_SECTION_ACCESS_REQUIRED", { sectionId, minimumLevel });
}

function hasCapability(actor, capability) {
  return Boolean(actor && (actor.type === "admin" || actor.capabilities && actor.capabilities.includes(capability)));
}

function publicActor(actor) {
  const capabilities = actor.type === "admin" ? [...FATURA_CAPABILITIES] : [...new Set(actor.capabilities || [])];
  const sectionAccess = effectiveSectionAccess({ ...actor, capabilities });
  const exposedSectionAccess = visibleSectionAccess(sectionAccess);
  return {
    type: actor.type,
    id: actor.id,
    name: actor.name,
    role: actor.role,
    branchId: actor.branchId || "main",
    accessEnabled: actor.type === "admin" || actor.accessEnabled !== false && capabilities.length > 0,
    template: actor.type === "admin" ? "yonetici" : String(actor.template || "ozel"),
    capabilities,
    sectionAccess: exposedSectionAccess,
    sections: visibleFaturaSections({ ...actor, capabilities, sectionAccess })
  };
}

function publicProcurementUser(user) {
  const capabilities = [...new Set(Array.isArray(user.faturaCapabilities) ? user.faturaCapabilities : [])];
  const template = String(user.faturaTemplate || "ozel");
  const accessEnabled = user.faturaAccessEnabled !== false && capabilities.length > 0;
  const sectionAccess = normalizeSectionAccess(user.faturaSectionAccess, {
    capabilities,
    allowManagement: template === "yonetici" || String(user.faturaRole) === "yönetici"
  });
  const exposedSectionAccess = visibleSectionAccess(sectionAccess);
  return {
    id: String(user.id || ""),
    username: String(user.username || ""),
    name: String(user.name || user.username || ""),
    active: user.active !== false,
    branchId: String(user.branchId || "main"),
    faturaAccessEnabled: accessEnabled,
    faturaRole: String(user.faturaRole || "operasyon"),
    faturaTemplate: template,
    faturaCapabilities: capabilities,
    faturaSectionAccess: exposedSectionAccess,
    faturaSections: accessEnabled
      ? visibleFaturaSections({ type: "personel", template, role: user.faturaRole, capabilities, sectionAccess, accessEnabled })
      : []
  };
}

function visibleSectionAccess(sectionAccess) {
  const visibleIds = new Set(canonicalPublicSectionDefinitions({ includeManagement: true }).map((definition) => definition.id));
  return Object.fromEntries(Object.entries(sectionAccess || {}).filter(([sectionId]) => visibleIds.has(sectionId)));
}

function visibleShipments(shipments, actor) {
  const source = Array.isArray(shipments) ? shipments : [];
  if (actor && actor.type === "admin") return source;
  const branchId = actorBranchId(actor);
  const branchShipments = source.filter((shipment) => shipmentBranchId(shipment) === branchId);
  return canViewAllShipments(actor)
    ? branchShipments
    : branchShipments.filter((shipment) => String(shipment.userId || "") === String(actor && actor.id || ""));
}

function canViewAllShipments(actor) {
  return Boolean(actor && (actor.type === "admin" || PRIVILEGED_SHIPMENT_CAPABILITIES.some((capability) => hasCapability(actor, capability))));
}

function canEditShipment(actor, shipment) {
  return Boolean(actor && shipment && (actor.type === "admin" || (shipmentBranchId(shipment) === actorBranchId(actor)
    && String(shipment.userId || "") === String(actor.id))));
}

function shipmentCanBeDeleted(shipment, procurement = null) {
  if (!shipment || !["taslak", "reddedildi", "rejected"].includes(String(shipment.status || ""))) return false;
  if (shipment.stockAppliedAt || shipment.stockMovementRef || (shipment.stockMovementRefs || []).length) return false;
  if (shipment.finalizedAt || shipment.finalized === true || shipment.isFinalized === true) return false;
  if (shipment.accountingPostedAt || (shipment.accountingEntryIds || []).length) return false;
  if (!["", "not_posted", "none"].includes(String(shipment.accountingStatus || ""))) return false;
  return !(procurement && (procurement.ledgerEntries || []).some((entry) => String(entry.shipmentId || "") === String(shipment.id || "")));
}

function findVisibleShipment(data, actor, shipmentId) {
  const shipment = findById(data.workforceShipments, shipmentId, "Sevkiyat");
  const visible = actor && actor.type === "admin"
    || shipmentBranchId(shipment) === actorBranchId(actor)
      && (canViewAllShipments(actor) || String(shipment.userId || "") === String(actor && actor.id || ""));
  if (!visible) {
    throw fail("Sevkiyat bulunamadı.", 404, "SHIPMENT_NOT_FOUND");
  }
  return shipment;
}

function actorBranchId(actor) {
  return String(actor && actor.branchId || "main");
}

function shipmentBranchId(shipment) {
  return String(shipment && shipment.branchId || "main");
}

function notifyFaturaReceiptUsers(data, helpers, shipment, input) {
  const users = Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [];
  const branchId = shipmentBranchId(shipment);
  for (const user of users) {
    if (!user || user.active === false || user.faturaAccessEnabled === false) continue;
    if (String(user.id || "") === String(shipment.userId || "")) continue;
    if (String(user.branchId || "main") !== branchId) continue;
    const capabilities = [...new Set(Array.isArray(user.faturaCapabilities) ? user.faturaCapabilities : [])];
    const recipient = {
      type: "personel",
      id: String(user.id || ""),
      branchId,
      capabilities,
      accessEnabled: user.faturaAccessEnabled !== false,
      template: String(user.faturaTemplate || "ozel"),
      role: String(user.faturaRole || "operasyon"),
      sectionAccess: user.faturaSectionAccess
    };
    const canSeeReceipt = hasSectionAccess(recipient, "shipments", "view")
      || hasSectionAccess(recipient, "documents", "view")
      || hasSectionAccess(recipient, "suppliers", "view");
    if (!recipient.id || !canSeeReceipt || !canViewAllShipments(recipient)) continue;
    helpers.notifyPerson(data, recipient.id, {
      category: "shipment",
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      severity: input.severity || "info",
      entityType: "shipment",
      entityId: String(shipment.id),
      deepLink: `/fatura/?view=documents&shipmentId=${encodeURIComponent(shipment.id)}`,
      dedupeKey: `procurement-${input.dedupeSuffix || input.eventType}:${shipment.id}:${recipient.id}`,
      metadata: {
        branchId,
        personId: String(shipment.userId || ""),
        itemCount: Array.isArray(shipment.items) ? shipment.items.length : 0
      }
    });
  }
}

function publicSectionDefinitions() {
  return canonicalPublicSectionDefinitions();
}

function publicAccessTemplates() {
  const visibleIds = new Set(canonicalPublicSectionDefinitions({ includeManagement: true }).map((definition) => definition.id));
  return Object.values(FATURA_ACCESS_TEMPLATES).map((template) => ({
    key: template.key,
    label: template.label,
    role: template.role,
    capabilities: [...template.capabilities],
    sectionAccess: Object.fromEntries(Object.entries(template.sectionAccess).filter(([sectionId]) => visibleIds.has(sectionId))),
    sections: Object.entries(template.sectionAccess).filter(([sectionId, level]) => visibleIds.has(sectionId) && level !== "off").map(([sectionId]) => sectionId)
  }));
}

function publicShipment(shipment, supplier, actor, procurement = null) {
  const canViewFinancials = Boolean(actor && (actor.type === "admin"
    || ["accounting.read", "accounting.post", "supplier.manage", "supplierProduct.manage"]
      .some((capability) => hasCapability(actor, capability))));
  return {
    ...shipment,
    items: (Array.isArray(shipment.items) ? shipment.items : []).map((item) => canViewFinancials
      ? { ...item }
      : omitFinancialShipmentFields(item)),
    supplier: supplier
      ? { id: supplier.id, code: supplier.code, name: supplier.name, active: supplier.active }
      : shipment.supplierName
        ? { id: String(shipment.supplierId || ""), code: String(shipment.supplierCode || ""), name: String(shipment.supplierName), active: false }
        : null,
    canEdit: !shipment.removedAt && shipment.status === "taslak" && canEditShipment(actor, shipment),
    canApprove: !shipment.removedAt && shipment.status === "onay_bekliyor" && !shipment.stockAppliedAt && hasCapability(actor, "receipt.approve"),
    canReject: !shipment.removedAt && shipment.status === "onay_bekliyor" && !shipment.stockAppliedAt && hasCapability(actor, "receipt.reject"),
    canRemove: !shipment.removedAt && hasCapability(actor, "receipt.reject"),
    canDelete: shipmentCanBeDeleted(shipment, procurement)
      && (hasCapability(actor, "receipt.reject") || hasCapability(actor, "receipt.create") && canEditShipment(actor, shipment)),
    canAccount: !shipment.removedAt && !["taslak", "reddedildi"].includes(shipment.status) && shipment.accountingStatus !== "posted"
      && hasCapability(actor, "accounting.post")
  };
}

function omitFinancialShipmentFields(item) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const result = { ...source };
  for (const key of ["unitPriceKurus", "lineTotalKurus", "totalKurus", "purchasePriceKurus", "priceKurus", "costKurus"]) delete result[key];
  return result;
}

function publicSupplier(supplier, balanceKurus) {
  const visibleBalance = Number.isSafeInteger(balanceKurus) ? balanceKurus : null;
  return {
    ...supplier,
    contactName: String(supplier.contactName || ""),
    balanceKurus: visibleBalance,
    debtKurus: visibleBalance === null ? null : Math.max(0, -visibleBalance)
  };
}

function publicProductLink(link, productIndex) {
  const product = productIndex.byCode.get(normalizeProductCode(link.stockProductCode)) || productIndex.byId.get(String(link.stockProductId));
  return {
    ...link,
    stockProductName: product && product.name || "",
    stockProductUnit: product && product.unit || "",
    stockProductActive: Boolean(product && isActiveStockProduct(product))
  };
}

function publicIndependentProduct(item) {
  return {
    id: String(item.id || ""),
    supplierId: String(item.supplierId || ""),
    name: String(item.name || ""),
    code: String(item.code || ""),
    bulkUnit: String(item.bulkUnit || item.purchaseUnit || ""),
    baseUnit: String(item.baseUnit || "adet"),
    purchaseUnit: String(item.bulkUnit || item.purchaseUnit || ""),
    conversionFactor: Math.max(0.001, Number(item.conversionFactor || 1)),
    stockProductId: String(item.stockProductId || ""),
    stockMatchStatus: String(item.stockMatchStatus || (item.stockProductId ? "matched" : "unmatched")),
    defaultPurchasePriceKurus: Math.max(0, Number(item.defaultPurchasePriceKurus || 0)),
    lastPurchasePriceKurus: Math.max(0, Number(item.lastPurchasePriceKurus || 0)),
    note: String(item.note || ""),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.createdAt || null
  };
}

function publicStockProduct(product) {
  return {
    id: String(product.id || ""),
    productCode: normalizeProductCode(product.productCode),
    name: String(product.name || ""),
    categoryId: String(product.categoryId || ""),
    category: String(product.category || ""),
    unit: String(product.unit || product.baseUnit || ""),
    baseUnit: String(product.baseUnit || product.unit || ""),
    bulkUnit: String(product.bulkUnit || product.caseUnit || "koli"),
    unitsPerBulkUnit: Number(product.unitsPerBulkUnit || product.unitsPerCase || 0),
    allowDecimal: product.allowDecimal === true,
    defaultMovementUnit: String(product.defaultMovementUnit || product.unit || ""),
    stockQuantity: Number(product.stockQuantity || 0),
    active: isActiveStockProduct(product)
  };
}

function publicStockLocation(location) {
  return {
    id: String(location.id || ""),
    code: String(location.code || ""),
    name: String(location.name || ""),
    type: String(location.type || "other"),
    isDefault: location.isDefault === true,
    active: location.active !== false
  };
}

function resolveOptionalStockLocation(stockState, value) {
  const id = text(value, 180);
  if (!id) return null;
  const location = (stockState.locations || []).find((item) => String(item.id) === id || String(item.code) === id.toLocaleUpperCase("tr-TR"));
  if (!location || location.active === false) throw fail("Hedef depo aktif stok lokasyonlarında bulunamadı.", 409, "STOCK_LOCATION_NOT_FOUND");
  return location;
}

function safeDocumentMetadata(document) {
  const source = document && typeof document === "object" ? document : {};
  const id = String(source.id || "");
  return {
    id,
    branchId: String(source.branchId || "main"),
    supplierId: String(source.supplierId || ""),
    shipmentIds: uniqueStrings(source.shipmentIds, 180),
    shipmentItemIds: uniqueStrings(source.shipmentItemIds, 180),
    documentType: String(source.documentType || "diğer"),
    documentNumber: String(source.documentNumber || ""),
    documentDate: String(source.documentDate || ""),
    originalName: String(source.originalName || ""),
    mimeType: String(source.mimeType || ""),
    sizeBytes: Number(source.sizeBytes || 0),
    width: Number(source.width || 0),
    height: Number(source.height || 0),
    thumbnailAvailable: String(source.mimeType || "") !== "application/pdf" && Boolean(source.thumbnailPhysicalName || source.physicalName),
    archivedAt: source.archivedAt || null,
    archivedBy: String(source.archivedBy || ""),
    archiveReason: String(source.archiveReason || ""),
    createdAt: source.createdAt || null,
    createdBy: String(source.createdBy || ""),
    contentUrl: id ? `/api/procurement/v1/documents/${encodeURIComponent(id)}/content` : "",
    thumbnailUrl: id ? `/api/procurement/v1/documents/${encodeURIComponent(id)}/content?thumbnail=1` : ""
  };
}

function validateSupplierInput(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const result = {};
  const assign = (key, value) => {
    if (!options.partial || Object.prototype.hasOwnProperty.call(source, key)) result[key] = value;
  };
  assign("code", text(source.code, 80).toLocaleUpperCase("tr-TR"));
  assign("name", text(source.name, 180));
  assign("contactName", text(source.contactName, 180));
  assign("taxNumber", text(source.taxNumber, 32));
  assign("phone", text(source.phone, 40));
  assign("email", text(source.email, 254).toLowerCase());
  assign("address", text(source.address, 1000));
  assign("paymentTermDays", clampInteger(source.paymentTermDays, 0, 0, 3650));
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "active")) result.active = source.active !== false;
  if ((!options.partial || Object.prototype.hasOwnProperty.call(source, "name")) && !result.name) throw fail("Tedarikçi adı zorunludur.", 400, "SUPPLIER_NAME_REQUIRED");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw fail("Tedarikçi e-posta adresi geçersiz.", 400, "INVALID_EMAIL");
  return result;
}

function assertUniqueSupplier(suppliers, values, ignoredId = "") {
  const code = normalizeLookup(values.code);
  const taxNumber = normalizeLookup(values.taxNumber);
  if (code && suppliers.some((supplier) => supplier.id !== ignoredId && normalizeLookup(supplier.code) === code)) {
    throw fail("Tedarikçi kodu daha önce kullanılmış.", 409, "SUPPLIER_CODE_EXISTS");
  }
  if (taxNumber && suppliers.some((supplier) => supplier.id !== ignoredId && normalizeLookup(supplier.taxNumber) === taxNumber)) {
    throw fail("Vergi numarası daha önce kullanılmış.", 409, "SUPPLIER_TAX_NUMBER_EXISTS");
  }
}

function validateProductLinkInput(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const result = {};
  const maybe = (key, value) => {
    if (!options.partial || Object.prototype.hasOwnProperty.call(source, key)) result[key] = value;
  };
  maybe("supplierProductName", text(source.supplierProductName, 180));
  maybe("supplierProductCode", text(source.supplierProductCode, 100));
  maybe("purchaseUnit", text(source.purchaseUnit || options.fallbackUnit, 40));
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "conversionFactor")) {
    const conversionFactor = Number(source.conversionFactor === undefined ? 1 : source.conversionFactor);
    if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) throw fail("Dönüşüm katsayısı sıfırdan büyük olmalıdır.", 400, "INVALID_CONVERSION_FACTOR");
    result.conversionFactor = conversionFactor;
  }
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "defaultPurchasePriceKurus")) {
    result.defaultPurchasePriceKurus = nonNegativeInteger(source.defaultPurchasePriceKurus || 0, "Varsayılan alış fiyatı");
  }
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "lastPurchasePriceKurus")) {
    result.lastPurchasePriceKurus = nonNegativeInteger(source.lastPurchasePriceKurus || 0, "Son alış fiyatı");
  }
  if (Object.prototype.hasOwnProperty.call(source, "active")) result.active = source.active !== false;
  return result;
}

function validateIndependentProductInput(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const result = {};
  const maybe = (key, value) => {
    if (!options.partial || Object.prototype.hasOwnProperty.call(source, key)) result[key] = value;
  };
  maybe("name", text(source.name, 180));
  maybe("code", text(source.code, 100).toLocaleUpperCase("tr-TR"));
  maybe("bulkUnit", text(source.bulkUnit || source.purchaseUnit, 40));
  maybe("baseUnit", text(source.baseUnit, 40) || "adet");
  maybe("purchaseUnit", text(source.bulkUnit || source.purchaseUnit, 40));
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "conversionFactor")) {
    result.conversionFactor = positiveDecimal(source.conversionFactor === undefined ? 1 : source.conversionFactor, "Toplu birim çarpanı");
  }
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "stockProductId")) {
    result.stockProductId = text(source.stockProductId, 180);
    result.stockMatchStatus = result.stockProductId ? "matched" : "unmatched";
  }
  maybe("note", text(source.note, 1000));
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "defaultPurchasePriceKurus")) {
    result.defaultPurchasePriceKurus = nonNegativeInteger(source.defaultPurchasePriceKurus || 0, "Varsayılan alış fiyatı");
  }
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "lastPurchasePriceKurus")) {
    result.lastPurchasePriceKurus = nonNegativeInteger(source.lastPurchasePriceKurus || 0, "Son alış fiyatı");
  }
  if (Object.prototype.hasOwnProperty.call(source, "active")) result.active = source.active !== false;
  if ((!options.partial || Object.prototype.hasOwnProperty.call(source, "name")) && !result.name) throw fail("Bağımsız ürün adı zorunludur.", 422, "INDEPENDENT_PRODUCT_NAME_REQUIRED");
  if ((!options.partial || Object.prototype.hasOwnProperty.call(source, "bulkUnit") || Object.prototype.hasOwnProperty.call(source, "purchaseUnit")) && !result.purchaseUnit) throw fail("Toplu birim zorunludur.", 422, "INDEPENDENT_PRODUCT_UNIT_REQUIRED");
  return result;
}

function assertUniqueIndependentProduct(items, supplierId, values, ignoredId = "") {
  const code = normalizeLookup(values.code);
  const name = normalizeLookup(values.name);
  const duplicate = (Array.isArray(items) ? items : []).find((item) => item.id !== ignoredId && item.supplierId === supplierId
    && (code ? normalizeLookup(item.code) === code : normalizeLookup(item.name) === name));
  if (duplicate) throw fail("Bu tedarikçi için aynı bağımsız ürün zaten kayıtlı.", 409, "SUPPLIER_INDEPENDENT_PRODUCT_EXISTS");
}

function validateShipmentItems(stockStateInput, requestedItems, createId, options = {}) {
  if (!Array.isArray(requestedItems) || !requestedItems.length) throw fail("En az bir sevkiyat satırı zorunludur.", 400, "SHIPMENT_ITEMS_REQUIRED");
  if (requestedItems.length > 200) throw fail("Bir sevkiyatta en fazla 200 satır olabilir.", 400, "SHIPMENT_ITEMS_LIMIT");
  const index = indexStockProducts(stockStateInput);
  const supplierProducts = new Map((options.procurement && Array.isArray(options.procurement.supplierIndependentProducts) ? options.procurement.supplierIndependentProducts : [])
    .filter((item) => !options.supplier || item.supplierId === options.supplier.id)
    .map((item) => [String(item.id), item]));
  const seen = new Set();
  return requestedItems.map((requested) => {
    const supplierProduct = supplierProducts.get(String(requested && requested.supplierProductId || ""));
    let product = supplierProduct && supplierProduct.stockProductId
      ? index.byId.get(String(supplierProduct.stockProductId))
      : null;
    if (!product) product = index.byId.get(String(requested && (requested.stockProductId || requested.productId) || ""))
      || index.byCode.get(normalizeProductCode(requested && (requested.stockProductCode || requested.productCode)));
    if (!product && supplierProduct) {
      const exactName = normalizeLookup(supplierProduct.name);
      const matches = [...index.byId.values()].filter((item) => isActiveStockProduct(item) && normalizeLookup(item.name) === exactName);
      if (matches.length === 1) product = matches[0];
    }
    if (product && !isActiveStockProduct(product)) product = null;
    const identity = product ? stockIdentity(product) : `supplier:${supplierProduct && supplierProduct.id || normalizeLookup(requested && requested.supplierProductName)}`;
    if (seen.has(identity)) throw fail("Aynı stok ürünü sevkiyata birden fazla kez eklenemez.", 400, "DUPLICATE_SHIPMENT_PRODUCT");
    seen.add(identity);
    const quantity = positiveDecimal(requested.quantityBulk ?? requested.quantity, "Miktar");
    const baseUnitSnapshot = text(supplierProduct && supplierProduct.baseUnit || requested.baseUnit || product && (product.baseUnit || product.unit) || "adet", 40) || "adet";
    const bulkUnitSnapshot = text(supplierProduct && (supplierProduct.bulkUnit || supplierProduct.purchaseUnit) || requested.bulkUnit || product && (product.bulkUnit || product.caseUnit) || "", 40);
    const unitsPerBulkUnitSnapshot = Math.max(0, Number(supplierProduct && supplierProduct.conversionFactor || requested.conversionFactor || product && (product.unitsPerBulkUnit ?? product.unitsPerCase) || 0) || 0);
    const purchaseUnitSnapshot = text(requested.purchaseUnit || requested.unit || product && product.defaultMovementUnit || baseUnitSnapshot, 40) || baseUnitSnapshot;
    const normalizedPurchaseUnit = purchaseUnitSnapshot.toLocaleLowerCase("tr-TR");
    const normalizedBulkUnit = bulkUnitSnapshot.toLocaleLowerCase("tr-TR");
    const normalizedBaseUnit = baseUnitSnapshot.toLocaleLowerCase("tr-TR");
    let conversionFactor = normalizedPurchaseUnit === normalizedBulkUnit && unitsPerBulkUnitSnapshot > 0 ? unitsPerBulkUnitSnapshot : 1;
    if (normalizedPurchaseUnit !== normalizedBulkUnit && normalizedPurchaseUnit !== normalizedBaseUnit && requested.conversionFactor !== undefined) {
      conversionFactor = positiveDecimal(requested.conversionFactor, "Dönüşüm katsayısı");
    }
    const baseQuantity = quantity * conversionFactor;
    const unitPriceKurus = nonNegativeInteger(requested.unitPriceKurus || 0, "Birim fiyat");
    const taxKurus = nonNegativeInteger(requested.taxKurus || 0, "Vergi");
    const calculatedTotal = multiplyKurus(unitPriceKurus, quantity) + taxKurus;
    const totalKurus = requested.totalKurus === undefined
      ? calculatedTotal
      : nonNegativeInteger(requested.totalKurus, "Satır toplamı");
    if (supplierProduct && totalKurus <= 0) {
      throw fail("Satır toplamı sıfırdan büyük olmalıdır.", 422, "SHIPMENT_LINE_TOTAL_REQUIRED");
    }
    const line = {
      id: text(requested.id, 180) || createId("shipment-item"),
      supplierProductId: supplierProduct ? String(supplierProduct.id) : "",
      productId: product ? String(product.id) : "",
      stockProductId: product ? String(product.id) : "",
      productCode: product ? normalizeProductCode(product.productCode) : "",
      stockProductCode: product ? normalizeProductCode(product.productCode) : "",
      name: String(supplierProduct && supplierProduct.name || requested.supplierProductName || product && product.name || ""),
      productName: String(supplierProduct && supplierProduct.name || requested.supplierProductName || product && product.name || ""),
      categoryId: product ? String(product.categoryId || "") : "",
      category: product ? String(product.category || "") : "",
      quantity,
      quantityBulk: quantity,
      unit: purchaseUnitSnapshot,
      baseQuantity,
      baseUnit: baseUnitSnapshot,
      conversionFactor,
      purchaseUnit: purchaseUnitSnapshot,
      baseUnitSnapshot,
      bulkUnitSnapshot,
      unitsPerBulkUnitSnapshot,
      purchaseUnitSnapshot,
      baseUnitPriceKurus: baseQuantity > 0 ? Math.round(totalKurus / baseQuantity) : 0,
      bulkUnitPriceKurus: unitsPerBulkUnitSnapshot > 0 ? Math.round(totalKurus / baseQuantity * unitsPerBulkUnitSnapshot) : 0,
      unitPriceKurus,
      taxKurus,
      totalKurus,
      lineTotalKurus: totalKurus,
      supplierProductCode: text(requested.supplierProductCode, 100),
      stockMatchStatus: product ? "matched" : "unmatched",
      evidenceDocumentIds: uniqueStrings(requested.evidenceDocumentIds, 180)
    };
    if (supplierProduct && product && !supplierProduct.stockProductId) {
      supplierProduct.stockProductId = String(product.id);
      supplierProduct.stockMatchStatus = "matched";
      supplierProduct.updatedAt = isoNow(options.now || Date);
    }
    return line;
  });
}

function resolveAccountingDocument(procurement, shipment, input) {
  const requestedId = text(input && input.documentId, 180);
  const ids = requestedId ? [requestedId] : shipment.evidenceDocumentIds || [];
  const allowed = new Set(procurement.settings.accountingDocumentTypes || ["fatura", "fiş", "makbuz"]);
  const document = ids.map((id) => procurement.documents.find((item) => item.id === id))
    .find((item) => item && !item.archivedAt && allowed.has(item.documentType));
  if (document) return document;
  throw fail("Muhasebeleştirme için fatura, fiş veya makbuz türünde belge gereklidir.", 409, "ACCOUNTING_DOCUMENT_REQUIRED");
}

function resolveShipmentEvidenceDocument(procurement, shipment, input) {
  const requestedId = text(input && input.documentId, 180);
  const ids = requestedId ? [requestedId] : shipment.evidenceDocumentIds || [];
  return ids.map((id) => procurement.documents.find((item) => item.id === id))
    .find((item) => item && !item.archivedAt) || null;
}

function validateDocumentIds(procurement, value, actor) {
  return uniqueStrings(value, 180).map((id) => {
    const document = findById(procurement.documents, id, "Belge");
    if (document.archivedAt) throw fail("Arşivlenmiş belge sevkiyata bağlanamaz.", 409, "DOCUMENT_ARCHIVED");
    if (actor.type !== "admin" && document.createdBy !== actor.id && !hasCapability(actor, "documents.archive")) {
      throw fail("Belgeyi sevkiyata bağlama yetkiniz yok.", 403, "FORBIDDEN");
    }
    return id;
  });
}

function linkDocumentsToShipment(procurement, documentIds, shipment) {
  for (const id of documentIds) {
    const document = procurement.documents.find((item) => item.id === id);
    if (!document) continue;
    document.shipmentIds = [...new Set([...(document.shipmentIds || []), shipment.id])];
    if (!document.supplierId && shipment.supplierId) document.supplierId = shipment.supplierId;
    if (!document.branchId) document.branchId = shipmentBranchId(shipment);
  }
}

function assertDocumentVisibility(data, document, actor) {
  if (actor && actor.type === "admin") return;
  if (documentBranchId(document, data) === actorBranchId(actor)) return;
  throw fail("Belge bulunamadı.", 404, "DOCUMENT_NOT_FOUND");
}

function documentBranchId(document, data) {
  if (document && document.branchId) return String(document.branchId);
  const shipmentIds = new Set(Array.isArray(document && document.shipmentIds) ? document.shipmentIds.map(String) : []);
  const linked = (Array.isArray(data && data.workforceShipments) ? data.workforceShipments : [])
    .find((shipment) => shipmentIds.has(String(shipment.id || "")));
  return shipmentBranchId(linked);
}

function ledgerBranchId(entry, data, procurement) {
  if (entry && entry.branchId) return String(entry.branchId);
  if (entry && entry.shipmentId) {
    const shipment = (Array.isArray(data && data.workforceShipments) ? data.workforceShipments : [])
      .find((item) => String(item.id || "") === String(entry.shipmentId));
    if (shipment) return shipmentBranchId(shipment);
  }
  if (entry && entry.documentId) {
    const document = (Array.isArray(procurement && procurement.documents) ? procurement.documents : [])
      .find((item) => String(item.id || "") === String(entry.documentId));
    if (document) return documentBranchId(document, data);
  }
  return "main";
}

function assertLedgerVisibility(data, procurement, entry, actor) {
  if (actor && actor.type === "admin") return;
  if (ledgerBranchId(entry, data, procurement) === actorBranchId(actor)) return;
  throw fail("Cari hareket bulunamadı.", 404, "LEDGER_ENTRY_NOT_FOUND");
}

function assertPaymentVisibility(payment, actor) {
  if (actor && actor.type === "admin") return;
  if (String(payment && payment.branchId || "main") === actorBranchId(actor)) return;
  throw fail("Ödeme bulunamadı.", 404, "PAYMENT_NOT_FOUND");
}

function findSupplier(procurement, supplierId, options = {}) {
  const supplier = findById(procurement.suppliers, supplierId, "Tedarikçi");
  if (options.active && supplier.active === false) throw fail("Pasif tedarikçi yeni işlemde kullanılamaz.", 409, "SUPPLIER_INACTIVE");
  return supplier;
}

function findStockProduct(stockStateInput, input) {
  const index = indexStockProducts(stockStateInput);
  const product = index.byId.get(String(input && (input.stockProductId || input.productId) || ""))
    || index.byCode.get(normalizeProductCode(input && (input.stockProductCode || input.productCode)));
  if (!product || !isActiveStockProduct(product)) throw fail("Aktif stok ürünü bulunamadı.", 409, "STOCK_PRODUCT_NOT_FOUND");
  return product;
}

function indexStockProducts(stockStateInput) {
  const products = normalizeStockState(stockStateInput).products;
  return {
    byId: new Map(products.map((product) => [String(product.id), product])),
    byCode: new Map(products.map((product) => [normalizeProductCode(product.productCode), product]).filter(([code]) => code))
  };
}

function isActiveStockProduct(product) {
  return Boolean(product && product.active !== false && product.sourcePresent !== false && !product.archivedAt);
}

function stockIdentity(value) {
  return normalizeProductCode(value && (value.stockProductCode || value.productCode)) || String(value && (value.stockProductId || value.id) || "");
}

function supplierBalances(entries) {
  const result = new Map();
  for (const entry of entries || []) result.set(entry.supplierId, addKurus(result.get(entry.supplierId) || 0, Number(entry.amountKurus || 0)));
  return result;
}

function balanceForSupplier(entries, supplierId) {
  return (entries || []).filter((entry) => entry.supplierId === supplierId)
    .reduce((sum, entry) => addKurus(sum, Number(entry.amountKurus || 0)), 0);
}

function withRunningBalances(entries) {
  const balances = new Map();
  return [...(entries || [])]
    .sort((left, right) => String(left.transactionDate || left.createdAt || "").localeCompare(String(right.transactionDate || right.createdAt || "")) || String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || String(left.id).localeCompare(String(right.id)))
    .map((entry) => {
      const balance = addKurus(balances.get(entry.supplierId) || 0, Number(entry.amountKurus || 0));
      balances.set(entry.supplierId, balance);
      return { ...entry, runningBalanceKurus: balance };
    });
}

function isReversed(entry, entries) {
  return (entries || []).some((candidate) => candidate.reversalOf === entry.id);
}

function shipmentTotalKurus(shipment) {
  return (shipment.items || []).reduce((sum, item) => addKurus(sum, nonNegativeInteger(item.totalKurus || 0, "Sevkiyat satır toplamı")), 0);
}

function addKurus(left, right) {
  const total = Number(left) + Number(right);
  if (!Number.isSafeInteger(total)) throw fail("Parasal toplam güvenli sınırı aşıyor.", 409, "AMOUNT_TOTAL_TOO_LARGE");
  return total;
}

function multiplyKurus(unitPriceKurus, quantity) {
  const raw = String(quantity).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw fail("Miktar en fazla üç ondalık basamak içerebilir.", 400, "INVALID_QUANTITY");
  const [whole, fraction = ""] = raw.split(".");
  const scaled = BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3));
  const total = (BigInt(unitPriceKurus) * scaled + 500n) / 1000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw fail("Parasal tutar güvenli sınırı aşıyor.", 400, "AMOUNT_TOO_LARGE");
  return Number(total);
}

function findById(items, id, label) {
  const normalizedId = text(id, 180);
  const item = (Array.isArray(items) ? items : []).find((candidate) => candidate && String(candidate.id) === normalizedId);
  if (!item) throw fail(`${label} bulunamadı.`, 404, `${normalizeCode(label)}_NOT_FOUND`);
  return item;
}

function normalizeDocumentType(value, fallback) {
  const type = String(value || "").trim().toLocaleLowerCase("tr-TR");
  if (!type && fallback === "") return "";
  if (!DOCUMENT_TYPES.has(type)) throw fail("Belge türü geçersiz.", 400, "INVALID_DOCUMENT_TYPE");
  return type;
}

function validateOptionalDate(value, label) {
  const date = String(value || "").trim();
  if (!date) return "";
  if (!DATE_PATTERN.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) throw fail(`${label} geçersiz.`, 400, "INVALID_DATE");
  return date;
}

function validateRequestId(value) {
  const requestId = String(value || "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) throw fail("Geçerli bir Idempotency-Key zorunludur.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  return requestId;
}

function validateExpectedRevision(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw fail("Geçerli expectedRevision zorunludur.", 400, "EXPECTED_REVISION_REQUIRED");
  return number;
}

function findIdempotency(procurement, actor, requestId) {
  return procurement.idempotencyRecords.find((record) => record.id === idempotencyRecordId(actor, requestId)) || null;
}

function idempotencyRecordId(actor, requestId) {
  return `procurement-idem-${crypto.createHash("sha256")
    .update(`${actor.type}\u0000${actor.id}\u0000${requestId}`, "utf8")
    .digest("hex")}`;
}

function touchWorkforceRevision(data) {
  if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) data.revisions = {};
  data.revisions.workforce = workforceRevision(data) + 1;
  return data.revisions.workforce;
}

function workforceRevision(data) {
  return Math.max(0, Math.trunc(Number(data && data.revisions && data.revisions.workforce || 0)));
}

function queueNotification(service, data, pending, input) {
  if (!service || typeof service.createNotificationInStore !== "function") return null;
  const notification = service.createNotificationInStore(data, input);
  if (notification) pending.push(notification);
  return notification;
}

function publishNotifications(service, pending) {
  if (!service || typeof service.publishNotificationEvent !== "function") return;
  for (const notification of pending) service.publishNotificationEvent(notification);
}

function sanitizeMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item.slice(0, 500);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
    else if (item && typeof item === "object" && !Array.isArray(item)) result[key] = sanitizeMetadata(item, depth + 1);
  }
  return result;
}

function csvCell(value) {
  const source = String(value === undefined || value === null ? "" : value);
  return `"${source.replace(/"/g, '""')}"`;
}

async function createLedgerWorkbookFile(options) {
  const reportDate = options.reportDate instanceof Date ? options.reportDate : new Date(options.reportDate);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tahmisçi Fatura";
  workbook.created = reportDate;
  workbook.modified = reportDate;
  workbook.calcProperties.fullCalcOnLoad = true;
  const worksheet = workbook.addWorksheet("Cari Hesap", {
    properties: { defaultRowHeight: 21 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  });
  worksheet.columns = [
    { key: "date", width: 14 }, { key: "supplier", width: 25 }, { key: "type", width: 20 },
    { key: "description", width: 34 }, { key: "debt", width: 16 }, { key: "payment", width: 16 },
    { key: "balance", width: 18 }, { key: "dueDate", width: 14 }, { key: "source", width: 27 }
  ];
  const brown = "FF5B301B";
  const darkBrown = "FF32190F";
  const beige = "FFF5E9DA";
  const lightBeige = "FFFFFAF3";
  const line = "FFE1D1C1";
  const muted = "FF78695F";
  const white = "FFFFFFFF";
  const currencyFormat = '₺#,##0.00;[Red]-₺#,##0.00';

  worksheet.mergeCells("A1:I1");
  worksheet.getCell("A1").value = "TAHMİSÇİ FATURA";
  worksheet.getCell("A1").font = { name: "Aptos Display", size: 18, bold: true, color: { argb: white } };
  worksheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: brown } };
  worksheet.getRow(1).height = 30;
  worksheet.mergeCells("A2:I2");
  worksheet.getCell("A2").value = "CARİ HESAP RAPORU";
  worksheet.getCell("A2").font = { name: "Aptos", size: 12, bold: true, color: { argb: darkBrown } };
  worksheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: beige } };
  worksheet.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(2).height = 24;

  const reportInfo = [
    ["Tedarikçi", options.supplierName],
    ["Tarih", options.selectedDate ? displayDate(options.selectedDate) : "Tüm tarihler"],
    ["Rapor tarihi", formatReportDate(reportDate)]
  ];
  reportInfo.forEach(([label, value], index) => {
    const row = 4 + index;
    worksheet.mergeCells(row, 1, row, 2);
    worksheet.mergeCells(row, 3, row, 9);
    worksheet.getCell(row, 1).value = label;
    worksheet.getCell(row, 1).font = { name: "Aptos", size: 10, bold: true, color: { argb: brown } };
    worksheet.getCell(row, 3).value = value;
    worksheet.getCell(row, 3).font = { name: "Aptos", size: 10, color: { argb: darkBrown } };
  });

  const summaries = [
    [1, 3, "Güncel Borç", Number(options.currentDebtKurus || 0) / 100, currencyFormat],
    [4, 6, "Toplam Ödeme", Number(options.paymentTotalKurus || 0) / 100, currencyFormat],
    [7, 9, "Hareket Sayısı", options.entries.length, "0"]
  ];
  summaries.forEach(([from, to, label, value, format]) => {
    worksheet.mergeCells(8, from, 8, to);
    worksheet.mergeCells(9, from, 9, to);
    const labelCell = worksheet.getCell(8, from);
    const valueCell = worksheet.getCell(9, from);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { name: "Aptos", size: 9, bold: true, color: { argb: muted } };
    valueCell.font = { name: "Aptos Display", size: 14, bold: true, color: { argb: darkBrown } };
    valueCell.numFmt = format;
    for (const row of [8, 9]) {
      const cell = worksheet.getCell(row, from);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightBeige } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = summaryBorder(line, row === 8, row === 9);
    }
  });
  worksheet.getRow(8).height = 21;
  worksheet.getRow(9).height = 27;

  const tableHeaderRow = 12;
  const headers = ["Tarih", "Tedarikçi", "Tür", "Açıklama", "Borç", "Ödeme", "Koşan Bakiye", "Vade", "Kaynak / Referans"];
  const header = worksheet.getRow(tableHeaderRow);
  header.values = headers;
  header.height = 27;
  header.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brown } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = thinBorder(line);
  });
  worksheet.autoFilter = { from: { row: tableHeaderRow, column: 1 }, to: { row: tableHeaderRow, column: 9 } };
  worksheet.views = [{ state: "frozen", ySplit: tableHeaderRow, activeCell: `A${tableHeaderRow + 1}` }];

  if (!options.entries.length) {
    worksheet.mergeCells(tableHeaderRow + 1, 1, tableHeaderRow + 2, 9);
    const emptyCell = worksheet.getCell(tableHeaderRow + 1, 1);
    emptyCell.value = "Seçilen filtrelerle eşleşen cari hareket bulunmuyor.";
    emptyCell.font = { name: "Aptos", size: 11, italic: true, color: { argb: muted } };
    emptyCell.alignment = { vertical: "middle", horizontal: "center" };
    emptyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightBeige } };
  } else {
    options.entries.forEach((entry, index) => {
      const amountKurus = Number(entry.amountKurus || 0);
      const row = worksheet.addRow([
        excelDate(entry.transactionDate || entry.createdAt),
        options.supplierIndex.get(String(entry.supplierId))?.name || String(entry.supplierId || ""),
        ledgerTypeLabel(entry.type),
        entry.note || entry.sourceType || "—",
        amountKurus < 0 ? Math.abs(amountKurus) / 100 : null,
        amountKurus > 0 ? amountKurus / 100 : null,
        Math.abs(Number(entry.runningBalanceKurus || 0)) / 100,
        entry.dueDate ? excelDate(entry.dueDate) : null,
        [entry.sourceType, entry.sourceId].filter(Boolean).join(" · ") || "—"
      ]);
      row.height = 23;
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.font = { name: "Aptos", size: 10, color: { argb: darkBrown } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? lightBeige : white } };
        cell.border = thinBorder(line);
        cell.alignment = { vertical: "middle", horizontal: column >= 5 && column <= 7 ? "right" : "left", wrapText: column === 4 || column === 9 };
      });
      row.getCell(1).numFmt = "dd.mm.yyyy";
      row.getCell(8).numFmt = "dd.mm.yyyy";
      [5, 6, 7].forEach((column) => { row.getCell(column).numFmt = currencyFormat; });
    });
  }
  worksheet.pageSetup.printTitlesRow = `1:${tableHeaderRow}`;
  worksheet.pageMargins = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

  const fileDate = options.selectedDate || istanbulDateKey(reportDate);
  const fileBase = options.supplierName === "Tüm Tedarikçiler" ? "tum-tedarikciler" : filenameSlug(options.supplierName);
  return {
    filename: `${fileBase}-cari-${displayDate(fileDate)}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Buffer.from(await workbook.xlsx.writeBuffer())
  };
}

function thinBorder(color) {
  const side = { style: "thin", color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function summaryBorder(color, firstRow, lastRow) {
  const side = { style: "thin", color: { argb: color } };
  return { top: firstRow ? side : undefined, left: side, bottom: lastRow ? side : undefined, right: side };
}

function excelDate(value) {
  const date = String(value || "").slice(0, 10);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : String(value || "");
}

function displayDate(value) {
  const match = String(value || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || "");
}

function formatReportDate(value) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(value);
}

function istanbulDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric"
  }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function filenameSlug(value) {
  return normalizeLookup(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "tedarikci";
}

function ledgerTypeLabel(value) {
  return ({ invoice: "Fatura / Borç", payment: "Ödeme", credit_note: "Alacak Dekontu", reversal: "Ters Kayıt", opening_balance: "Açılış Bakiyesi", adjustment: "Düzeltme" })[value] || String(value || "—");
}

function parseActiveFilter(value) {
  if (value === true || value === "true" || value === "1" || value === "active") return true;
  if (value === false || value === "false" || value === "0" || value === "inactive") return false;
  return null;
}

function uniqueStrings(value, maxLength) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => text(item, maxLength)).filter(Boolean))];
}

function positiveDecimal(value, label) {
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) throw fail(`${label} sıfırdan büyük olmalıdır.`, 400, "INVALID_POSITIVE_NUMBER");
  return Math.round(number * 1000) / 1000;
}

function positiveKurus(value, label) {
  const amount = nonNegativeInteger(value, label);
  if (amount <= 0) throw fail(`${label} sıfırdan büyük olmalıdır.`, 400, "INVALID_AMOUNT");
  return amount;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw fail(`${label} tam sayı kuruş olmalıdır.`, 400, "INVALID_KURUS_AMOUNT");
  return number;
}

function signedSafeKurus(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number === 0) throw fail(`${label} sıfırdan farklı tam sayı kuruş olmalıdır.`, 400, "INVALID_KURUS_AMOUNT");
  return number;
}

function positiveRevision(value) {
  return Math.max(0, Math.trunc(Number(value || 0)));
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function addDays(date, days) {
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function isoNow(now) {
  const value = now();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function normalizeLookup(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCode(value) {
  return normalizeLookup(value).replace(/\s+/g, "_").toUpperCase() || "ENTITY";
}

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function fail(message, status = 400, code = "PROCUREMENT_ERROR", details) {
  return Object.assign(new Error(message), { status, code, details });
}

module.exports = {
  DOCUMENT_TYPES,
  createProcurementService,
  hasCapability,
  publicProcurementUser,
  safeDocumentMetadata
};
