export const CAPABILITIES = {
  read: "procurement.read", supplierRead: "supplier.read", supplierManage: "supplier.manage",
  links: "supplierProduct.manage", receiptCreate: "receipt.create", receiptSubmit: "receipt.submit",
  receiptApprove: "receipt.approve", receiptReject: "receipt.reject", accountingRead: "accounting.read",
  accountingPost: "accounting.post", accountingReverse: "accounting.reverse", paymentCreate: "payment.create",
  paymentReverse: "payment.reverse", documentsRead: "documents.read", documentsUpload: "documents.upload",
  documentsArchive: "documents.archive", users: "procurement.users.manage",
  inventoryRead: "inventory.read", inventoryManage: "inventory.manage",
  inventoryMovementCreate: "inventory.movement.create", inventoryMovementReverse: "inventory.movement.reverse",
  inventoryTransferCreate: "inventory.transfer.create", inventoryTransferApprove: "inventory.transfer.approve",
  inventoryCountManage: "inventory.count.manage", inventoryLocationManage: "inventory.location.manage",
  inventoryCatalogManage: "inventory.catalog.manage"
};

export const state = {
  context: null, revision: 0, workforceRevision: 0, activeView: "dashboard", loaded: new Map(), eventSource: null,
  suppliers: [], productLinks: [], shipments: [], documents: [], ledgerEntries: [], payments: [], trash: [], users: [], auditEvents: [],
  ledgerSummary: null, ledgerFilterKey: "", ledgerDrilldown: "",
  notifications: [], unreadCount: 0,
  dashboard: null, settings: null, accessTemplates: [], sectionDefinitions: [], sectionAccess: Object.create(null), filters: Object.create(null), detail: null,
  supplierWorkspace: { supplierId: "", productLinks: [], independentProducts: [], loading: false, returnScrollY: 0 },
  stockExcel: {
    result: null, errors: [], fileName: "", busy: false,
    details: { updatedProducts: [], createdProducts: [], createdCategories: [], balanceChanges: [], attentionProducts: [] }
  },
  revisions: { procurement: 0, workforce: 0, stock: 0, inventory: 0, shipment: 0, catalog: 0, notification: 0 },
  stock: {
    revision: 0, inventoryRevision: 0, catalogRevision: 0,
    locations: [], personnel: [], unitDefinitions: { base: [], bulk: [] }, selectedLocationId: "",
    balances: [], summary: {}, transfers: [], transferLocations: [], movements: [], counts: [], activeCount: null,
    secondaryLoaded: false, secondaryLoadPromise: null, secondaryLocationId: "", selectedCategory: "all",
    selectedProductId: "", viewMode: "overview", drawerReturnFocus: null, inventoryController: null,
    loadSequence: 0, updatedAt: "", loaded: false, stale: true, loadPromise: null, busyKeys: new Set(),
    bound: false, boundWorkspace: null, confirmResolver: null, thresholdInitial: null, pendingUnitMigration: null, catalogStock: null,
    quickDrawerReturnFocus: null, popstateHandler: null,
    catalogLoaded: false, catalogLoading: false, catalogCategoryId: "", catalogProductId: "", catalogBusy: false,
    appliedIntentKey: "", activeAccordion: "", planning: null, planningStale: true,
    planningError: "", planningLoadPromise: null
  },
  productAnalysis: {
    products: [], selectedProductId: "", detail: null, query: "", range: "30d",
    resultsOpen: false, loaded: false, loading: false, productsStale: true, detailStale: true,
    movementMode: "", movementRows: [], movementLoading: false, movementError: "", movementsStale: true
  }
};

export function has(capability) {
  const actor = state.context && state.context.actor;
  return Boolean(actor && (actor.capabilities || []).includes(capability));
}

export function sectionLevel(sectionId) {
  const actor = state.context && state.context.actor;
  if (actor && actor.type === "admin") return "full";
  return String(state.sectionAccess && state.sectionAccess[sectionId] || "off");
}

export function hasSection(sectionId, minimumLevel = "view") {
  const rank = { off: 0, view: 1, operate: 2, full: 3 };
  return (rank[sectionLevel(sectionId)] || 0) >= (rank[minimumLevel] || 1);
}

export function updateRevision(payload, domain = "procurement") {
  const revision = Number(payload && payload.revision);
  const workforceRevision = Number(payload && payload.workforceRevision);
  const inventoryRevision = Number(payload && payload.inventoryRevision);
  const catalogRevision = Number(payload && payload.catalogRevision);
  const supplied = payload && payload.revisions && typeof payload.revisions === "object" ? payload.revisions : {};
  for (const key of ["procurement", "workforce", "stock", "inventory", "shipment", "catalog", "notification"]) {
    const next = Number(supplied[key]);
    if (Number.isFinite(next) && next >= 0) state.revisions[key] = Math.max(state.revisions[key] || 0, next);
  }
  if (Number.isFinite(revision) && revision >= 0) {
    state.revisions[domain] = Math.max(state.revisions[domain] || 0, revision);
    if (domain === "procurement") state.revision = state.revisions.procurement;
    if (domain === "stock") state.stock.revision = state.revisions.stock;
  }
  if (Number.isFinite(workforceRevision) && workforceRevision >= 0) {
    state.revisions.workforce = Math.max(state.revisions.workforce || 0, workforceRevision);
    state.workforceRevision = state.revisions.workforce;
  }
  if (Number.isFinite(inventoryRevision) && inventoryRevision >= 0) {
    state.revisions.inventory = Math.max(state.revisions.inventory || 0, inventoryRevision);
  }
  if (Number.isFinite(catalogRevision) && catalogRevision >= 0) {
    state.revisions.catalog = Math.max(state.revisions.catalog || 0, catalogRevision);
  }
  state.revision = Math.max(state.revision || 0, state.revisions.procurement || 0);
  state.workforceRevision = Math.max(state.workforceRevision || 0, state.revisions.workforce || 0);
  state.stock.inventoryRevision = Math.max(state.stock.inventoryRevision || 0, state.revisions.inventory || 0);
  state.stock.catalogRevision = Math.max(state.stock.catalogRevision || 0, state.revisions.catalog || 0);
  state.stock.revision = state.stock.inventoryRevision;
}

export function invalidate(scopes = []) {
  for (const scope of scopes) state.loaded.delete(scope);
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

export function trMoney(kurus) {
  const amount = Number(kurus || 0) / 100;
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(amount);
}

export function financeValues(summary, className = "finance-summary") {
  if (!summary || summary.debtKurus == null) return "";
  return `<div class="${className}"><div><small>Borç</small><strong class="finance-debt">${trMoney(summary.debtKurus)}</strong></div><div><small>Yapılan Ödeme</small><strong class="finance-payment">${trMoney(summary.paymentKurus)}</strong></div><div><small>Kalan</small><strong class="finance-remaining">${trMoney(summary.remainingKurus)}</strong></div></div>`;
}

export function paymentStatusLabel(status) {
  return ({ open: "Ödeme bekliyor", partial: "Kısmi ödendi", paid: "Tam ödendi", reversed: "Terslendi", removed: "Kaldırıldı", not_posted: "Borç oluşmadı" })[status] || "Borç oluşmadı";
}

export function trDate(value, withTime = false) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("tr-TR", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

export function statusBadge(value) {
  const status = String(value || "");
  const map = {
    taslak: ["Taslak", "is-muted"], onay_bekliyor: ["Onay bekliyor", "is-warning"], onaylandı: ["Onaylandı", "is-success"],
    reddedildi: ["Reddedildi", "is-danger"], posted: ["Muhasebeleştirildi", "is-success"], not_posted: ["Muhasebe bekliyor", "is-warning"],
    reversed: ["Ters kayıt", "is-muted"], available: ["Belge var", "is-success"], missing: ["Belge eksik", "is-warning"],
    active: ["Aktif", "is-success"], passive: ["Pasif", "is-muted"]
  };
  const item = map[status] || [status || "Belirsiz", "is-muted"];
  return `<span class="badge ${item[1]}">${escapeHtml(item[0])}</span>`;
}

export function requestKey(prefix) {
  const random = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function value(formData, name) { return String(formData.get(name) || "").trim(); }
export function integerKurus(valueText) {
  const normalized = String(valueText || "0").trim().replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Geçerli ve negatif olmayan bir tutar girin.");
  return Math.round(amount * 100);
}

export function comboField({ name, label, items = [], selectedId = "", placeholder = "Arayın…", required = false, className = "" }) {
  const listId = `combo-${name}-${Math.random().toString(36).slice(2, 9)}`;
  const normalized = items.map((item) => ({ id: String(item.id || item.value || ""), label: String(item.label || item.name || item.id || "") }));
  const selected = normalized.find((item) => item.id === String(selectedId || ""));
  return `<label class="fatura-combobox ${escapeHtml(className)}">${escapeHtml(label)}<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selected && selected.id || "")}"><input type="search" list="${listId}" data-combo-input="${escapeHtml(name)}" value="${escapeHtml(selected && selected.label || "")}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" ${required ? "required" : ""} role="combobox" aria-autocomplete="list"><datalist id="${listId}">${normalized.map((item) => `<option value="${escapeHtml(item.label)}" data-id="${escapeHtml(item.id)}"></option>`).join("")}</datalist></label>`;
}

export function icon(name) {
  const paths = {
    dashboard: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    shipments: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    suppliers: '<path d="M4 20V7l8-4 8 4v13"/><path d="M8 10h2M14 10h2M8 14h2M14 14h2M10 20v-3h4v3"/>',
    links: '<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/>',
    documents: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h6"/>',
    ledger: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M16 14h2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 11a4 4 0 0 1 4 4v2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    stock: '<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/>',
    stockExcel: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8M8 8h3"/>',
    productAnalysis: '<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4M15 20h6M18 17v6M4 20h7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 10v7M14 10v7"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.dashboard}</svg>`;
}
