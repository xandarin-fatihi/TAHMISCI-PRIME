"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");
const {
  FATURA_CAPABILITIES,
  FATURA_ROLES,
  normalizeProcurement,
  normalizeStockState
} = require("./store/migrations");
const { normalizeProductCode } = require("./store/product-code-registry");

const IDEMPOTENCY_LIMIT = 1000;
const AUDIT_LIMIT = 5000;
const DOCUMENT_TYPES = new Set(["fatura", "irsaliye", "fiş", "makbuz", "diğer"]);
const LEDGER_TYPES = new Set(["invoice", "payment", "credit_note", "reversal", "opening_balance", "adjustment"]);
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIVILEGED_SHIPMENT_CAPABILITIES = ["receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "supplier.manage"];

function createProcurementService(options = {}) {
  const store = options.store;
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("Procurement servisi için kalıcı store gereklidir.");
  }
  const notificationService = options.notificationService || null;
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
    const stockState = normalizeStockState(data.stockState);
    const canReadProducts = ["procurement.read", "receipt.create", "supplierProduct.manage"]
      .some((capability) => hasCapability(actor, capability));
    return {
      ok: true,
      revision: procurement.revision,
      actor: publicActor(actor),
      procurement: {
        version: procurement.version,
        revision: procurement.revision,
        settings: procurement.settings
      },
      stockProducts: (canReadProducts ? stockState.products : [])
        .filter(isActiveStockProduct)
        .map(publicStockProduct)
    };
  }

  async function dashboard(actor) {
    requireCapability(actor, "procurement.read");
    const { data, procurement } = await readSnapshot();
    const shipments = visibleShipments(data.workforceShipments, actor);
    const today = dateKey(now());
    const monthPrefix = today.slice(0, 7);
    const dueSoonDays = procurement.settings.dueSoonDays || 7;
    const dueSoonLimit = addDays(today, dueSoonDays);
    const balances = supplierBalances(procurement.ledgerEntries);
    const invoiceEntries = procurement.ledgerEntries.filter((entry) => entry.type === "invoice" && !isReversed(entry, procurement.ledgerEntries));
    const payments = procurement.ledgerEntries.filter((entry) => entry.type === "payment" && !isReversed(entry, procurement.ledgerEntries));
    const financialVisible = hasCapability(actor, "accounting.read");
    return {
      ok: true,
      revision: procurement.revision,
      dashboard: {
        financialVisible,
        supplierDebtKurus: financialVisible ? [...balances.values()].reduce((sum, balance) => addKurus(sum, Math.max(0, -balance)), 0) : 0,
        monthPurchasesKurus: financialVisible ? invoiceEntries
          .filter((entry) => String(entry.createdAt || "").startsWith(monthPrefix))
          .reduce((sum, entry) => addKurus(sum, Math.abs(entry.amountKurus)), 0) : 0,
        monthPaymentsKurus: financialVisible ? payments
          .filter((entry) => String(entry.createdAt || "").startsWith(monthPrefix))
          .reduce((sum, entry) => addKurus(sum, Math.max(0, entry.amountKurus)), 0) : 0,
        pendingShipments: shipments.filter((shipment) => shipment.status === "onay_bekliyor").length,
        unaccountedShipments: shipments.filter((shipment) => !["taslak", "reddedildi"].includes(shipment.status)
          && shipment.accountingStatus !== "posted").length,
        missingDocuments: shipments.filter((shipment) => !(shipment.evidenceDocumentIds || []).length).length,
        dueSoon: financialVisible ? invoiceEntries.filter((entry) => entry.dueDate && entry.dueDate >= today && entry.dueDate <= dueSoonLimit).length : 0,
        overdue: financialVisible ? invoiceEntries.filter((entry) => entry.dueDate && entry.dueDate < today).length : 0,
        recentPriceChanges: procurement.supplierProductLinks
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
          }))
      }
    };
  }

  async function listSuppliers(actor, filters = {}) {
    requireAnyCapability(actor, ["supplier.read", "receipt.create", "supplier.manage"]);
    const { procurement } = await readSnapshot();
    const balances = hasCapability(actor, "accounting.read") ? supplierBalances(procurement.ledgerEntries) : null;
    const search = normalizeLookup(filters.search);
    const activeFilter = parseActiveFilter(filters.active);
    const suppliers = procurement.suppliers
      .filter((supplier) => activeFilter === null || supplier.active === activeFilter)
      .filter((supplier) => !search || normalizeLookup(`${supplier.code} ${supplier.name} ${supplier.taxNumber}`).includes(search))
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
      const supplier = {
        id: createId("supplier"),
        ...values,
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

  async function listShipments(actor, filters = {}) {
    requireAnyCapability(actor, ["procurement.read", "receipt.create", "receipt.approve", "accounting.read"]);
    const { data, procurement } = await readSnapshot();
    const supplierIndex = new Map(procurement.suppliers.map((supplier) => [supplier.id, supplier]));
    let shipments = visibleShipments(data.workforceShipments, actor);
    if (filters.supplierId) shipments = shipments.filter((shipment) => shipment.supplierId === String(filters.supplierId));
    if (filters.status) shipments = shipments.filter((shipment) => shipment.status === String(filters.status));
    if (filters.accountingStatus) shipments = shipments.filter((shipment) => shipment.accountingStatus === String(filters.accountingStatus));
    return {
      ok: true,
      revision: procurement.revision,
      workforceRevision: workforceRevision(data),
      shipments: shipments.map((shipment) => publicShipment(shipment, supplierIndex.get(shipment.supplierId), actor))
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    };
  }

  async function getShipment(actor, shipmentId) {
    requireAnyCapability(actor, ["procurement.read", "receipt.create", "receipt.approve", "accounting.read"]);
    const { data, procurement } = await readSnapshot();
    const shipment = findVisibleShipment(data, actor, shipmentId);
    const supplier = procurement.suppliers.find((item) => item.id === shipment.supplierId);
    const documents = procurement.documents
      .filter((document) => (shipment.evidenceDocumentIds || []).includes(document.id))
      .map(safeDocumentMetadata);
    const entries = withRunningBalances(procurement.ledgerEntries.filter((entry) => entry.shipmentId === shipment.id));
    return {
      ok: true,
      revision: procurement.revision,
      workforceRevision: workforceRevision(data),
      shipment: publicShipment(shipment, supplier, actor),
      documents,
      ledgerEntries: entries
    };
  }

  async function createShipment(actor, input, mutation) {
    requireCapability(actor, "receipt.create");
    return mutate("shipment.create", actor, mutation, (data, procurement, helpers) => {
      const supplierId = text(input && input.supplierId, 180);
      const supplier = supplierId ? findSupplier(procurement, supplierId, { active: true }) : null;
      const items = validateShipmentItems(data.stockState, input && input.items, createId);
      const evidenceDocumentIds = validateDocumentIds(procurement, input && input.evidenceDocumentIds, actor);
      const timestamp = isoNow(now);
      const shipment = {
        id: createId("shipment"),
        userId: actor.id,
        userName: actor.name,
        supplierId: supplier ? supplier.id : "",
        branchId: actor.branchId || procurement.settings.defaultBranchId || "main",
        items,
        note: text(input && input.note, 1000),
        status: "taslak",
        operationalStatus: "taslak",
        evidenceDocumentIds,
        evidenceStatus: evidenceDocumentIds.length ? "available" : "missing",
        documentType: normalizeDocumentType(input && input.documentType, ""),
        documentNumber: text(input && input.documentNumber, 120),
        documentDate: validateOptionalDate(input && input.documentDate, "Belge tarihi"),
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
      touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, { shipment: publicShipment(shipment, supplier, actor) });
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
      if (Object.prototype.hasOwnProperty.call(input || {}, "supplierId")) {
        supplier = input.supplierId ? findSupplier(procurement, input.supplierId, { active: true }) : null;
        shipment.supplierId = supplier ? supplier.id : "";
      }
      if (draft && Object.prototype.hasOwnProperty.call(input || {}, "items")) shipment.items = validateShipmentItems(data.stockState, input.items, createId);
      if (Object.prototype.hasOwnProperty.call(input || {}, "evidenceDocumentIds")) {
        shipment.evidenceDocumentIds = validateDocumentIds(procurement, input.evidenceDocumentIds, actor);
        linkDocumentsToShipment(procurement, shipment.evidenceDocumentIds, shipment);
      }
      if (Object.prototype.hasOwnProperty.call(input || {}, "note")) shipment.note = text(input.note, 1000);
      if (Object.prototype.hasOwnProperty.call(input || {}, "documentType")) shipment.documentType = normalizeDocumentType(input.documentType, "");
      if (Object.prototype.hasOwnProperty.call(input || {}, "documentNumber")) shipment.documentNumber = text(input.documentNumber, 120);
      if (Object.prototype.hasOwnProperty.call(input || {}, "documentDate")) shipment.documentDate = validateOptionalDate(input.documentDate, "Belge tarihi");
      shipment.evidenceStatus = (shipment.evidenceDocumentIds || []).length ? "available" : "missing";
      shipment.updatedAt = isoNow(now);
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      touchWorkforceRevision(data);
      return helpers.result("shipment", shipment.id, { shipment: publicShipment(shipment, supplier, actor) });
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
      touchWorkforceRevision(data);
      helpers.notifyManager(data, {
        category: "shipment",
        eventType: "shipment_submitted",
        title: "Yeni mal kabul onay bekliyor",
        body: `${shipment.userName || "Personel"} tarafından ${(shipment.items || []).length} satırlık mal kabul gönderildi.`,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: "/fatura/",
        dedupeKey: `procurement-shipment-submitted:${shipment.id}`
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
          deepLink: "/fatura/",
          dedupeKey: `procurement-document-missing:${shipment.id}`
        });
      }
      return helpers.result("shipment", shipment.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor)
      });
    });
  }

  async function rejectShipment(actor, shipmentId, input, mutation) {
    requireCapability(actor, "receipt.reject");
    return mutate("shipment.reject", actor, mutation, (data, procurement, helpers) => {
      const shipment = findById(data.workforceShipments, shipmentId, "Sevkiyat");
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
      touchWorkforceRevision(data);
      helpers.notifyPerson(data, shipment.userId, {
        category: "shipment",
        eventType: "shipment_rejected",
        title: "Mal kabul reddedildi",
        body: reason,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: "/fatura/",
        dedupeKey: `procurement-shipment-rejected:${shipment.id}:${shipment.userId}`
      });
      return helpers.result("shipment", shipment.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor)
      });
    });
  }

  async function accountShipment(actor, shipmentId, input, mutation) {
    requireCapability(actor, "accounting.post");
    return mutate("shipment.account", actor, mutation, (data, procurement, helpers) => {
      const shipment = findById(data.workforceShipments, shipmentId, "Sevkiyat");
      if (["taslak", "reddedildi"].includes(shipment.status)) {
        throw fail("Taslak veya reddedilmiş sevkiyat muhasebeleştirilemez.", 409, "SHIPMENT_STATE_CONFLICT");
      }
      const supplier = findSupplier(procurement, shipment.supplierId);
      if (procurement.ledgerEntries.some((entry) => entry.shipmentId === shipment.id && entry.type === "invoice")) {
        throw fail("Bu sevkiyat daha önce muhasebeleştirilmiş.", 409, "SHIPMENT_ALREADY_ACCOUNTED");
      }
      const document = resolveAccountingDocument(procurement, shipment, input);
      const amountKurus = positiveKurus(input && input.amountKurus !== undefined
        ? input.amountKurus
        : shipmentTotalKurus(shipment), "Muhasebe tutarı");
      const timestamp = isoNow(now);
      const dueDate = validateOptionalDate(input && input.dueDate, "Vade tarihi")
        || addDays((document && document.documentDate) || shipment.documentDate || timestamp.slice(0, 10), supplier.paymentTermDays || 0);
      const entry = {
        id: createId("ledger"),
        supplierId: supplier.id,
        shipmentId: shipment.id,
        documentId: document ? document.id : "",
        type: "invoice",
        amountKurus: -amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, supplier.id), -amountKurus),
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
      shipment.updatedAt = timestamp;
      shipment.revision = positiveRevision(shipment.revision) + 1;
      shipment.expectedRevision = shipment.revision;
      touchWorkforceRevision(data);
      helpers.notifyPerson(data, shipment.userId, {
        category: "shipment",
        eventType: "accounting_posted",
        title: "Mal kabul muhasebeleştirildi",
        body: `${supplier.name} için cari kayıt oluşturuldu.`,
        severity: "success",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: "/fatura/",
        dedupeKey: `procurement-accounting-posted:${shipment.id}`
      });
      return helpers.result("ledgerEntry", entry.id, {
        shipment: publicShipment(shipment, supplier, actor),
        ledgerEntry: entry
      });
    });
  }

  async function reverseShipmentAccounting(actor, shipmentId, input, mutation) {
    requireCapability(actor, "accounting.reverse");
    return mutate("shipment.account.reverse", actor, mutation, (data, procurement, helpers) => {
      const shipment = findById(data.workforceShipments, shipmentId, "Sevkiyat");
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
        shipmentId: shipment.id,
        documentId: original.documentId,
        type: "reversal",
        amountKurus: -original.amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, original.supplierId), -original.amountKurus),
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
      touchWorkforceRevision(data);
      helpers.notifyPerson(data, shipment.userId, {
        category: "shipment",
        eventType: "accounting_reversed",
        title: "Muhasebe kaydı ters çevrildi",
        body: reason,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: "/fatura/",
        dedupeKey: `procurement-accounting-reversed:${shipment.id}:${reversal.id}`
      });
      return helpers.result("ledgerEntry", reversal.id, {
        shipment: publicShipment(shipment, procurement.suppliers.find((item) => item.id === shipment.supplierId), actor),
        ledgerEntry: reversal
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
      const timestamp = isoNow(now);
      const duplicate = storedFile.sha256 && procurement.documents.find((document) => document.sha256 === storedFile.sha256
        && document.physicalName === storedFile.physicalName
        && !document.archivedAt);
      const document = {
        id: createId("document"),
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
      if (shipments.length) touchWorkforceRevision(data);
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
      }, { duplicatePhysicalDocumentId: duplicate && duplicate.id || "" });
    });
  }

  async function listDocuments(actor, filters = {}) {
    requireCapability(actor, "documents.read");
    const { data, procurement } = await readSnapshot();
    const visibleIds = new Set(visibleShipments(data.workforceShipments, actor).map((shipment) => shipment.id));
    const broad = canViewAllShipments(actor);
    const documents = procurement.documents
      .filter((document) => broad || document.createdBy === actor.id || (document.shipmentIds || []).some((id) => visibleIds.has(id)))
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
      if (document.archivedAt) throw fail("Belge zaten arşivlenmiş.", 409, "DOCUMENT_ALREADY_ARCHIVED");
      document.archivedAt = isoNow(now);
      document.archivedBy = actor.id;
      document.archiveReason = text(input && (input.reason || input.note), 500);
      for (const shipment of data.workforceShipments || []) {
        if (!(shipment.evidenceDocumentIds || []).includes(document.id)) continue;
        const liveEvidence = (shipment.evidenceDocumentIds || []).some((id) => {
          const linked = procurement.documents.find((item) => item.id === id);
          return linked && !linked.archivedAt;
        });
        shipment.evidenceStatus = liveEvidence ? "available" : "archived";
      }
      return helpers.result("document", document.id, { document: safeDocumentMetadata(document) });
    });
  }

  async function listLedger(actor, filters = {}) {
    requireCapability(actor, "accounting.read");
    const { procurement } = await readSnapshot();
    let entries = procurement.ledgerEntries;
    if (filters.supplierId) entries = entries.filter((entry) => entry.supplierId === String(filters.supplierId));
    if (filters.type && LEDGER_TYPES.has(String(filters.type))) entries = entries.filter((entry) => entry.type === String(filters.type));
    const running = withRunningBalances(entries);
    return {
      ok: true,
      revision: procurement.revision,
      entries: running,
      balanceKurus: running.length ? running[running.length - 1].runningBalanceKurus : 0
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
        shipmentId: "",
        documentId,
        type,
        amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, supplier.id), amountKurus),
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
        shipmentId: "",
        documentId: original.documentId,
        type: "reversal",
        amountKurus: -original.amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, original.supplierId), -original.amountKurus),
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
      if (documentId) findById(procurement.documents, documentId, "Belge");
      const timestamp = isoNow(now);
      const payment = {
        id: createId("payment"),
        supplierId: supplier.id,
        documentId,
        amountKurus,
        paymentDate: validateOptionalDate(input && input.paymentDate, "Ödeme tarihi") || timestamp.slice(0, 10),
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
        shipmentId: "",
        documentId,
        type: "payment",
        amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, supplier.id), amountKurus),
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
      if (payment.status === "reversed") throw fail("Ödeme daha önce ters çevrilmiş.", 409, "PAYMENT_ALREADY_REVERSED");
      const original = findById(procurement.ledgerEntries, payment.ledgerEntryId, "Ödeme cari kaydı");
      const reason = text(input && (input.reason || input.note), 1000);
      if (!reason) throw fail("Ters ödeme nedeni zorunludur.", 400, "REVERSAL_REASON_REQUIRED");
      const timestamp = isoNow(now);
      const reversal = {
        id: createId("ledger"),
        supplierId: payment.supplierId,
        shipmentId: "",
        documentId: payment.documentId,
        type: "reversal",
        amountKurus: -original.amountKurus,
        balanceAfterKurus: addKurus(balanceForSupplier(procurement.ledgerEntries, payment.supplierId), -original.amountKurus),
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
        reversalReason: reason
      });
      return helpers.result("payment", payment.id, { payment, ledgerEntry: reversal });
    });
  }

  async function listAudit(actor, filters = {}) {
    requireAnyCapability(actor, ["procurement.users.manage", "accounting.read"]);
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
      users: (data.recipeUsers || []).map(publicProcurementUser)
    };
  }

  async function updateUserAccess(actor, userId, input, mutation) {
    requireCapability(actor, "procurement.users.manage");
    return mutate("user-access.update", actor, mutation, (data, procurement, helpers) => {
      const user = findById(data.recipeUsers, userId, "Personel");
      const role = String(input && input.faturaRole || "");
      if (!FATURA_ROLES.has(role)) throw fail("Fatura rolü geçersiz.", 400, "INVALID_FATURA_ROLE");
      const capabilities = uniqueStrings(input && input.faturaCapabilities, 100);
      if (capabilities.some((capability) => !FATURA_CAPABILITIES.has(capability))) {
        throw fail("Bilinmeyen fatura yetkisi gönderildi.", 400, "INVALID_CAPABILITY");
      }
      user.faturaRole = role;
      user.faturaCapabilities = capabilities;
      user.updatedAt = isoNow(now);
      return helpers.result("personel", user.id, { user: publicProcurementUser(user) });
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
    if (kind === "ledger") requireCapability(actor, "accounting.read");
    else requireCapability(actor, "procurement.read");
    const { data, procurement } = await readSnapshot();
    const supplierIndex = new Map(procurement.suppliers.map((supplier) => [supplier.id, supplier]));
    let headers;
    let rows;
    if (kind === "suppliers") {
      const balances = supplierBalances(procurement.ledgerEntries);
      headers = ["Kod", "Tedarikçi", "Vergi No", "Telefon", "E-posta", "Vade (gün)", "Durum", "Bakiye (kuruş)"];
      rows = procurement.suppliers.map((supplier) => [supplier.code, supplier.name, supplier.taxNumber, supplier.phone, supplier.email,
        supplier.paymentTermDays, supplier.active ? "Aktif" : "Pasif", balances.get(supplier.id) || 0]);
    } else if (kind === "shipments") {
      headers = ["Sevkiyat", "Tedarikçi", "Personel", "Durum", "Stok", "Muhasebe", "Belge", "Oluşturma"];
      rows = visibleShipments(data.workforceShipments, actor).map((shipment) => [shipment.id,
        supplierIndex.get(shipment.supplierId) && supplierIndex.get(shipment.supplierId).name || "", shipment.userName,
        shipment.status, shipment.stockAppliedAt ? "Uygulandı" : "Bekliyor", shipment.accountingStatus,
        shipment.evidenceStatus, shipment.createdAt]);
    } else {
      headers = ["Tarih", "Tedarikçi", "Tür", "Tutar (kuruş)", "Koşan bakiye (kuruş)", "Vade", "Kaynak", "Not"];
      rows = withRunningBalances(procurement.ledgerEntries).map((entry) => [entry.createdAt,
        supplierIndex.get(entry.supplierId) && supplierIndex.get(entry.supplierId).name || entry.supplierId,
        entry.type, entry.amountKurus, entry.runningBalanceKurus, entry.dueDate, entry.sourceId, entry.note]);
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
      revision: nonNegativeInteger(event && event.revision, "Revision"),
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
      response = { ok: true, requestId, revision, ...(outcome.payload || {}) };
      procurement.auditEvents.push({
        id: createId("procurement-audit"),
        action: operation,
        entityType: outcome.entityType || "procurement",
        entityId: outcome.resourceId || "",
        actorType: actor.type,
        actorId: actor.id,
        actorName: actor.name,
        revision,
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
        createdAt: isoNow(now)
      };
      return data;
    });
    if (!replayed) {
      publishNotifications(notificationService, pendingNotifications);
      eventBus.emit("change", event);
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
    archiveDocument,
    context,
    createPayment,
    createLedgerEntry,
    createProductLink,
    createShipment,
    createSupplier,
    dashboard,
    deactivateSupplier,
    exportData,
    findIdempotentResponse,
    getDocument,
    getShipment,
    listAudit,
    listDocuments,
    listLedger,
    listProductLinks,
    listShipments,
    listSuppliers,
    listUsers,
    publishExternalEvent,
    recordDocument,
    rejectShipment,
    reversePayment,
    reverseLedgerEntry,
    reverseShipmentAccounting,
    submitShipment,
    subscribe,
    updateProductLink,
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

function hasCapability(actor, capability) {
  return Boolean(actor && (actor.type === "admin" || actor.capabilities && actor.capabilities.includes(capability)));
}

function publicActor(actor) {
  return {
    type: actor.type,
    id: actor.id,
    name: actor.name,
    role: actor.role,
    branchId: actor.branchId || "main",
    capabilities: actor.type === "admin" ? [...FATURA_CAPABILITIES] : [...new Set(actor.capabilities || [])]
  };
}

function publicProcurementUser(user) {
  return {
    id: String(user.id || ""),
    username: String(user.username || ""),
    name: String(user.name || user.username || ""),
    active: user.active !== false,
    branchId: String(user.branchId || "main"),
    faturaRole: String(user.faturaRole || "operasyon"),
    faturaCapabilities: [...new Set(Array.isArray(user.faturaCapabilities) ? user.faturaCapabilities : [])]
  };
}

function visibleShipments(shipments, actor) {
  const source = Array.isArray(shipments) ? shipments : [];
  return canViewAllShipments(actor) ? source : source.filter((shipment) => String(shipment.userId || "") === String(actor.id));
}

function canViewAllShipments(actor) {
  return Boolean(actor && (actor.type === "admin" || PRIVILEGED_SHIPMENT_CAPABILITIES.some((capability) => hasCapability(actor, capability))));
}

function canEditShipment(actor, shipment) {
  return Boolean(actor && shipment && (actor.type === "admin" || String(shipment.userId || "") === String(actor.id)));
}

function findVisibleShipment(data, actor, shipmentId) {
  const shipment = findById(data.workforceShipments, shipmentId, "Sevkiyat");
  if (!canViewAllShipments(actor) && String(shipment.userId || "") !== String(actor.id)) {
    throw fail("Sevkiyat bulunamadı.", 404, "SHIPMENT_NOT_FOUND");
  }
  return shipment;
}

function publicShipment(shipment, supplier, actor) {
  return {
    ...shipment,
    supplier: supplier ? { id: supplier.id, code: supplier.code, name: supplier.name, active: supplier.active } : null,
    canEdit: shipment.status === "taslak" && canEditShipment(actor, shipment),
    canApprove: shipment.status === "onay_bekliyor" && !shipment.stockAppliedAt && hasCapability(actor, "receipt.approve"),
    canReject: shipment.status === "onay_bekliyor" && !shipment.stockAppliedAt && hasCapability(actor, "receipt.reject"),
    canAccount: !["taslak", "reddedildi"].includes(shipment.status) && shipment.accountingStatus !== "posted"
      && hasCapability(actor, "accounting.post")
  };
}

function publicSupplier(supplier, balanceKurus) {
  const visibleBalance = Number.isSafeInteger(balanceKurus) ? balanceKurus : null;
  return {
    ...supplier,
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

function publicStockProduct(product) {
  return {
    id: String(product.id || ""),
    productCode: normalizeProductCode(product.productCode),
    name: String(product.name || ""),
    categoryId: String(product.categoryId || ""),
    category: String(product.category || ""),
    unit: String(product.unit || ""),
    stockQuantity: Number(product.stockQuantity || 0),
    active: isActiveStockProduct(product)
  };
}

function safeDocumentMetadata(document) {
  const source = document && typeof document === "object" ? document : {};
  const id = String(source.id || "");
  return {
    id,
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
    thumbnailAvailable: Boolean(source.thumbnailPhysicalName || source.physicalName),
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
  assign("taxNumber", text(source.taxNumber, 32));
  assign("phone", text(source.phone, 40));
  assign("email", text(source.email, 254).toLowerCase());
  assign("address", text(source.address, 1000));
  assign("paymentTermDays", clampInteger(source.paymentTermDays, 0, 0, 3650));
  if (!options.partial || Object.prototype.hasOwnProperty.call(source, "active")) result.active = source.active !== false;
  if ((!options.partial || Object.prototype.hasOwnProperty.call(source, "code")) && !result.code) throw fail("Tedarikçi kodu zorunludur.", 400, "SUPPLIER_CODE_REQUIRED");
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

function validateShipmentItems(stockStateInput, requestedItems, createId) {
  if (!Array.isArray(requestedItems) || !requestedItems.length) throw fail("En az bir sevkiyat satırı zorunludur.", 400, "SHIPMENT_ITEMS_REQUIRED");
  if (requestedItems.length > 200) throw fail("Bir sevkiyatta en fazla 200 satır olabilir.", 400, "SHIPMENT_ITEMS_LIMIT");
  const index = indexStockProducts(stockStateInput);
  const seen = new Set();
  return requestedItems.map((requested) => {
    const product = index.byCode.get(normalizeProductCode(requested && (requested.stockProductCode || requested.productCode)))
      || index.byId.get(String(requested && (requested.stockProductId || requested.productId) || ""));
    if (!product || !isActiveStockProduct(product)) throw fail("Seçilen stok ürünü aktif katalogda bulunamadı.", 409, "STOCK_PRODUCT_NOT_FOUND");
    const identity = stockIdentity(product);
    if (seen.has(identity)) throw fail("Aynı stok ürünü sevkiyata birden fazla kez eklenemez.", 400, "DUPLICATE_SHIPMENT_PRODUCT");
    seen.add(identity);
    const quantity = positiveDecimal(requested.quantity, "Miktar");
    const unitPriceKurus = nonNegativeInteger(requested.unitPriceKurus || 0, "Birim fiyat");
    const taxKurus = nonNegativeInteger(requested.taxKurus || 0, "Vergi");
    const calculatedTotal = multiplyKurus(unitPriceKurus, requested.quantity) + taxKurus;
    const totalKurus = requested.totalKurus === undefined
      ? calculatedTotal
      : nonNegativeInteger(requested.totalKurus, "Satır toplamı");
    return {
      id: text(requested.id, 180) || createId("shipment-item"),
      productId: String(product.id),
      stockProductId: String(product.id),
      productCode: normalizeProductCode(product.productCode),
      stockProductCode: normalizeProductCode(product.productCode),
      name: String(product.name || ""),
      categoryId: String(product.categoryId || ""),
      category: String(product.category || ""),
      quantity,
      unit: text(requested.unit || product.unit, 40),
      baseQuantity: Number(requested.baseQuantity || quantity),
      baseUnit: String(product.unit || requested.unit || ""),
      conversionFactor: positiveDecimal(requested.conversionFactor === undefined ? 1 : requested.conversionFactor, "Dönüşüm katsayısı"),
      purchaseUnit: text(requested.purchaseUnit || requested.unit || product.unit, 40),
      unitPriceKurus,
      taxKurus,
      totalKurus,
      supplierProductCode: text(requested.supplierProductCode, 100),
      evidenceDocumentIds: uniqueStrings(requested.evidenceDocumentIds, 180)
    };
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
  }
}

function assertDocumentVisibility(data, document, actor) {
  if (canViewAllShipments(actor) || document.createdBy === actor.id) return;
  const visibleIds = new Set(visibleShipments(data.workforceShipments, actor).map((shipment) => shipment.id));
  if ((document.shipmentIds || []).some((id) => visibleIds.has(id))) return;
  throw fail("Belge bulunamadı.", 404, "DOCUMENT_NOT_FOUND");
}

function findSupplier(procurement, supplierId, options = {}) {
  const supplier = findById(procurement.suppliers, supplierId, "Tedarikçi");
  if (options.active && supplier.active === false) throw fail("Pasif tedarikçi yeni işlemde kullanılamaz.", 409, "SUPPLIER_INACTIVE");
  return supplier;
}

function findStockProduct(stockStateInput, input) {
  const index = indexStockProducts(stockStateInput);
  const product = index.byCode.get(normalizeProductCode(input && (input.stockProductCode || input.productCode)))
    || index.byId.get(String(input && (input.stockProductId || input.productId) || ""));
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
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || String(left.id).localeCompare(String(right.id)))
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
