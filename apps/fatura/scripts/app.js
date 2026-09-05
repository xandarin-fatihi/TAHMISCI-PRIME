import { api, ApiError, downloadExport, login, logout, requestId, uploadDocument, uploadStockWorkbook } from "./api.js";
import { CAPABILITIES, comboField, escapeHtml, has, hasSection, icon, integerKurus, invalidate, state, trDate, updateRevision, value } from "./state.js";
import { renderDashboard } from "./dashboard.js?v=20260902-final-ui";
import { renderProductLinks, renderSuppliers } from "./suppliers.js?v=20260903-supplier-create-fix-v1";
import { renderShipments, shipmentDetail, shipmentFormBody, shipmentLine } from "./receipts.js";
import { documentFormBody, printShipmentArchive, renderDocuments, shipmentArchiveDetail } from "./documents.js?v=20260904-stock-lifecycle-upload-v1";
import { ledgerEntryFormBody, paymentFormBody, renderLedger, renderTrash, renderUsers, userAccessFormBody } from "./accounting.js?v=20260904-stock-lifecycle-upload-v1";
import { applyStockIntent, connectStockEvents, disconnectStockEvents, handleStockGatewayEvent, invalidateStockState, loadStockView, renderStockView, resetStockState } from "./stock.js?v=20260904-stock-lifecycle-upload-v1";
import { bindProductAnalysisInteractions, handleProductAnalysisGatewayEvent, loadProductAnalysis, renderProductAnalysis, resetProductAnalysisState } from "./product-analysis.js?v=20260902-final-ui";
import { confirmAction, requestText } from "./ui-dialogs.js";

const app = document.getElementById("faturaApp");
const shell = document.getElementById("shell");
const authView = document.getElementById("authView");
const nav = document.getElementById("faturaNav");
const content = document.getElementById("contentView");
const entityDialog = document.getElementById("entityDialog");
const detailDialog = document.getElementById("detailDialog");
const entityForm = document.getElementById("entityForm");
let supplierStockBulk = null;
const profileMenu = document.getElementById("profileMenu");
const notificationDrawer = document.getElementById("notificationDrawer");
const notificationScrim = document.getElementById("notificationScrim");
const viewDefinitions = [
  { id: "dashboard", label: "Genel Bakış", description: "Tedarik ve cari süreçlerin güncel özeti.", capability: CAPABILITIES.read },
  { id: "stock", label: "Stok", description: "Depoları ve gerçek stok bakiyelerini yönetin.", capability: CAPABILITIES.inventoryRead },
  { id: "stockExcel", accessSection: "stock", minimumLevel: "full", label: "Stok Excel", description: "Excel stok şablonundaki ürün, birim, eşik ve stok miktarlarını toplu olarak aktarın.", capability: CAPABILITIES.inventoryManage },
  { id: "productAnalysis", label: "Ürün Analizi", description: "Ürün bazlı temel birim alış fiyatlarını inceleyin.", all: [CAPABILITIES.inventoryRead, CAPABILITIES.read] },
  { id: "suppliers", label: "Tedarikçiler", description: "Tedarikçi ürünlerini ve sevkiyatlarını yönetin.", any: [CAPABILITIES.supplierRead,CAPABILITIES.supplierManage] },
  { id: "documents", label: "Sevkiyat Arşivi", description: "Tamamlanan tedarikçi sevkiyatlarını ve belgelerini görüntüleyin.", capability: CAPABILITIES.documentsRead },
  { id: "ledger", label: "Cari Hesap", description: "Append-only borç, ödeme ve ters kayıt defteri.", capability: CAPABILITIES.accountingRead },
  { id: "trash", label: "Çöp Kutusu", description: "Kaldırılan sevkiyat ve ters kayıt denetim geçmişi.", capability: CAPABILITIES.read },
  { id: "users", label: "Kullanıcı ve Yetkiler", description: "Mevcut personel hesaplarına Tahmisçi Fatura yetkileri verin.", capability: CAPABILITIES.users }
];
let visibleViews = [];
let filterTimer = null;
let eventRefreshTimer = null;
let notificationTimer = null;
let toastTimer = null;
let currentObjectUrl = "";
let deferredInstallPrompt = null;
const loadVersions = new Map();
const pendingEventScopes = new Set();
const handledGatewayEventIds = new Set();
const gatewayTopicRevisions = new Map();
const EVENT_SCOPES = {
  inventory: ["stock", "stockExcel", "dashboard", "trash"],
  catalog: ["stock", "stockExcel", "dashboard", "trash"],
  shipment: ["shipments", "documents", "productAnalysis", "stock", "dashboard"],
  supplier: ["suppliers", "dashboard"],
  supplierProductLink: ["suppliers", "productAnalysis", "dashboard"],
  supplierIndependentProduct: ["suppliers", "stock", "productAnalysis", "dashboard"],
  document: ["documents", "dashboard"],
  ledgerEntry: ["ledger", "trash", "suppliers", "dashboard"],
  payment: ["ledger", "trash", "suppliers", "dashboard"],
  personel: ["users", "context"],
  procurementSettings: ["dashboard"]
};

document.addEventListener("DOMContentLoaded", bootstrap);
document.addEventListener("click", handleClick);
document.addEventListener("pointerdown", (event) => {
  if (!profileMenu.hidden && !profileMenu.contains(event.target) && !event.target.closest("#profileMenuButton")) closeProfileMenu();
  if (!event.target.closest("[data-supplier-product-combobox]")) closeSupplierProductCombobox();
});
document.addEventListener("input", handleFilterInput);
document.addEventListener("change", handleChange);
document.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-supplier-product-search]")) openSupplierProductCombobox(event.target);
});
document.addEventListener("submit", handleAppSubmit);
entityForm.addEventListener("submit", submitEntityForm);
entityDialog.addEventListener("cancel", (event) => { if (entityForm.dataset.mode === "supplier-stock-bulk-add" ? supplierStockBulk?.busy : document.getElementById("dialogSubmit").disabled) event.preventDefault(); });
entityDialog.addEventListener("close", cleanupEntityDialog);
detailDialog.addEventListener("close", cleanupDetailDialog);
document.getElementById("adminLoginForm").addEventListener("submit", (event) => submitLogin(event, "admin"));
document.getElementById("personelLoginForm").addEventListener("submit", (event) => submitLogin(event, "personel"));
window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);
window.addEventListener("beforeinstallprompt", captureInstallPrompt);
window.addEventListener("appinstalled", clearInstallPrompt);
window.addEventListener("popstate", handleAppPopstate);
document.addEventListener("keydown", (event) => {
  if (handleSupplierProductKeydown(event)) return;
  if (event.key === "Escape" && app.classList.contains("is-mobile-open")) closeMobileSidebar();
  if (event.key === "Escape" && !notificationDrawer.hidden) closeNotifications();
  if (event.key === "Escape" && !profileMenu.hidden) closeProfileMenu();
});
document.addEventListener("tahmisci:fatura:navigate", async (event) => {
  const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
  const requestedView = detail.view === "shipments" ? "documents" : detail.view;
  if (!requestedView || !visibleViews.some((view) => view.id === requestedView)) return;
  if (requestedView === "productAnalysis" && detail.productId) state.productAnalysis.selectedProductId = String(detail.productId);
  await setView(requestedView);
  if (requestedView === "documents" && detail.entityId) openShipment(detail.entityId);
});

async function bootstrap() {
  updateNetworkState();
  restoreSidebarPreference();
  try {
    await resolveContext();
    showShell();
    await loadNotifications(true).catch(() => null);
    registerFaturaPwaNotificationIntro();
    if (!visibleViews.length) return showAccessDenied();
    await activateInitialView();
    connectEvents();
  } catch (error) {
    if (error instanceof ApiError && [401,403].includes(error.status)) return showAuth(error.status === 403 ? error.message : "");
    showAuth(error.message || "Tahmisçi Fatura başlatılamadı.");
  }
}

async function resolveContext() {
  const payload = await api("/context", { dedupe: false });
  state.context = payload;
  state.settings = payload.procurement && payload.procurement.settings || {};
  state.sectionAccess = payload.access && payload.access.sectionAccess && typeof payload.access.sectionAccess === "object"
    ? { ...payload.access.sectionAccess }
    : Object.create(null);
  updateRevision(payload);
  return payload;
}

function showAuth(message = "") {
  stopEvents();
  disconnectStockEvents();
  resetStockState();
  resetProductAnalysisState();
  shell.hidden = true;
  authView.hidden = false;
  app.dataset.status = "auth";
  document.getElementById("authMessage").textContent = message;
}

function showShell() {
  authView.hidden = true;
  shell.hidden = false;
  app.dataset.status = "ready";
  const actor = state.context.actor;
  document.getElementById("actorName").textContent = actor.name || "Tahmisçi";
  document.getElementById("actorRole").textContent = actor.type === "admin" ? "Yönetici" : roleLabel(actor.role);
  document.getElementById("actorAvatar").textContent = String(actor.name || "T").trim().charAt(0).toLocaleUpperCase("tr-TR") || "T";
  document.getElementById("profileName").textContent = actor.name || "Tahmisçi";
  document.getElementById("profileRole").textContent = actor.type === "admin" ? "Yönetici" : roleLabel(actor.role);
  visibleViews = viewDefinitions.filter(canSeeView);
  document.getElementById("profileAccess").textContent = capabilitySummary(actor);
  if (!visibleViews.some((view) => view.id === state.activeView)) state.activeView = visibleViews[0] && visibleViews[0].id || "";
  renderNav();
}

function showAccessDenied() {
  document.getElementById("pageTitle").textContent = "Erişim yetkisi gerekli";
  document.getElementById("pageDescription").textContent = "Bu hesap için Tahmisçi Fatura bölümü açılmamış.";
  content.innerHTML = '<div class="access-state"><div><h2>Tahmisçi Fatura erişiminiz bulunmuyor</h2><p>Yönetici hesabınız için gerekli Fatura bölümünü ve işlem yetkilerini açtığında menünüz otomatik olarak güncellenecektir.</p><button class="ui-button ui-button--secondary" id="accessRefreshButton" type="button">Yetkileri yeniden kontrol et</button></div></div>';
  connectEvents();
}

function capabilitySummary(actor) {
  if (actor.type === "admin") return "Tüm Fatura bölümlerine tam erişim";
  if (!visibleViews.length) return "Fatura erişimi kapalı";
  return `${visibleViews.length} bölüm: ${visibleViews.map((item) => item.label).join(", ")}`;
}

function canSeeView(view) {
  const actor = state.context && state.context.actor;
  const accessSection = view.accessSection || view.id;
  if (actor && actor.type !== "admin" && state.context.access && state.context.access.sectionAccess
    && !hasSection(accessSection, view.minimumLevel || "view")) return false;
  const sections = state.context && state.context.access && state.context.access.sections;
  if (Array.isArray(sections) && !sections.includes(accessSection)) return false;
  if (Array.isArray(view.all) && !view.all.every(has)) return false;
  if (view.capability) return has(view.capability);
  return !(view.any || []).length || (view.any || []).some(has);
}

function renderNav() {
  nav.innerHTML = visibleViews.map((view) => `<button class="nav-button ${view.id === state.activeView ? "is-active" : ""}" type="button" data-view="${view.id}" aria-current="${view.id === state.activeView ? "page" : "false"}">${icon(view.id)}<span>${escapeHtml(view.label)}</span></button>`).join("");
}

async function activateInitialView() {
  const preference = safeSessionStorageGet("tahmisci:fatura:view");
  const intent = consumeOpenIntent();
  const requestedRaw = intent && intent.view || preference;
  const requested = requestedRaw === "shipments" ? "documents" : requestedRaw;
  if (intent && intent.view === "shipments") intent.view = "documents";
  if (requested && visibleViews.some((view) => view.id === requested)) state.activeView = requested;
  if (intent && intent.view === "productAnalysis" && intent.productId) state.productAnalysis.selectedProductId = String(intent.productId);
  await setView(state.activeView);
  if (intent && intent.view === "stock") await applyStockIntent(intent);
  if (intent && intent.entityType === "shipment" && intent.entityId) await openShipment(intent.entityId);
  if (intent && intent.entityType === "supplier" && intent.entityId) await openSupplier(intent.entityId);
  if (intent && intent.entityType === "document" && intent.entityId && has(CAPABILITIES.documentsRead)) await openDocument(intent.entityId);
  cleanFaturaUrl();
}

async function setView(viewId, options = {}) {
  const view = visibleViews.find((item) => item.id === viewId);
  if (!view) return;
  if (state.activeView === "stock" && viewId !== "stock") disconnectStockEvents();
  state.activeView = viewId;
  const pageHeading = document.querySelector(".page-heading");
  if (pageHeading) pageHeading.hidden = false;
  resetContextHeading(view);
  syncSupplierSidebar(viewId);
  if (options.fromPopstate !== true) cleanFaturaUrl();
  safeSessionStorageSet("tahmisci:fatura:view", viewId);
  renderNav();
  document.getElementById("pageTitle").textContent = view.label;
  document.getElementById("pageDescription").textContent = view.description;
  content.innerHTML = viewId === "stock" ? renderStockView()
    : viewId === "stockExcel" ? renderStockExcelView()
      : loadingSkeleton(`Güncel ${view.label} verileri alınıyor`);
  closeMobileSidebar();
  try {
    await loadView(viewId, options.force === true);
    renderActiveView();
    if (viewId === "stock") connectStockEvents();
  } catch (error) {
    handleViewError(error);
  }
}

function syncSupplierSidebar(viewId) {
  if (matchMedia("(max-width:820px)").matches) return;
  if (viewId === "suppliers") {
    if (!app.classList.contains("is-collapsed")) {
      app.dataset.supplierAutoCollapsed = "1";
      app.classList.add("is-collapsed");
    }
    return;
  }
  if (app.dataset.supplierAutoCollapsed === "1") {
    app.classList.remove("is-collapsed");
    delete app.dataset.supplierAutoCollapsed;
  }
}

function resetContextHeading(view = visibleViews.find((item) => item.id === state.activeView)) {
  const back = document.getElementById("contextBackButton");
  if (back) {
    back.hidden = true;
    delete back.dataset.contextBack;
  }
  document.getElementById("pageKicker").textContent = "TAHMİSÇİ FATURA";
  document.getElementById("pageTitle").textContent = view && view.label || "Tahmisçi Fatura";
  document.getElementById("pageDescription").textContent = view && view.description || "";
}

function syncSupplierContextHeading() {
  const supplierId = String(state.supplierWorkspace && state.supplierWorkspace.supplierId || "");
  if (!supplierId) return resetContextHeading();
  const supplier = state.suppliers.find((item) => String(item.id) === supplierId);
  const back = document.getElementById("contextBackButton");
  if (back) {
    back.hidden = false;
    back.dataset.contextBack = "supplier";
    back.setAttribute("aria-label", "Tedarikçilere dön");
  }
  document.getElementById("pageKicker").textContent = "TEDARİKÇİ";
  document.getElementById("pageTitle").textContent = supplier && supplier.name || "Tedarikçi";
  document.getElementById("pageDescription").textContent = "Ürün kalemleri ve sevkiyat işlemleri.";
}

async function loadView(view, force = false) {
  const loader = {
    dashboard: () => Promise.all([
      loadDashboard(force),
      hasSection("suppliers") ? loadSuppliers(force) : Promise.resolve().then(() => { state.suppliers = []; }),
      (hasSection("shipments") || hasSection("documents") || hasSection("suppliers")) ? loadShipments(force) : Promise.resolve().then(() => { state.shipments = []; }),
      hasSection("stock") || hasSection("productAnalysis") ? loadStockReferences(force) : null
    ]),
    suppliers: async () => {
      await Promise.all([loadSuppliers(force), loadStockReferences(force)]);
      if (state.supplierWorkspace.supplierId) await loadSupplierWorkspaceData(state.supplierWorkspace.supplierId, force);
    },
    documents: () => Promise.all([
      loadSuppliers(force),
      loadShipments(force),
      loadDocuments(force)
    ]),
    ledger: () => Promise.all([loadSuppliers(force), loadLedger(force)]),
    trash: () => loadTrash(force),
    users: () => loadUsers(force),
    stock: () => loadStockView({ force }),
    stockExcel: () => loadStockReferences(force),
    productAnalysis: () => loadProductAnalysis({ force, productId: state.productAnalysis.selectedProductId })
  }[view];
  if (loader) await loader();
}

async function cachedLoad(key, fetcher, assign, force, revisionDomain = "procurement") {
  if (!force && state.loaded.has(key)) return state.loaded.get(key);
  const version = (loadVersions.get(key) || 0) + 1;
  loadVersions.set(key, version);
  const promise = Promise.resolve().then(fetcher).then((payload) => {
    if (loadVersions.get(key) !== version) return payload;
    updateRevision(payload, revisionDomain);
    assign(payload);
    return payload;
  }).catch((error) => { if (loadVersions.get(key) === version) state.loaded.delete(key); throw error; });
  state.loaded.set(key, promise);
  return promise;
}
const loadDashboard = (force) => cachedLoad("dashboard", () => api("/dashboard"), (p) => { state.dashboard = p.dashboard || {}; }, force);
const loadSuppliers = (force) => cachedLoad("suppliers", () => api("/suppliers?active=all"), (p) => { state.suppliers = p.suppliers || []; }, force);
const loadStockReferences = (force) => cachedLoad("stock-references", () => api("/stock/references"), (p) => {
  state.context = state.context || {};
  state.context.stockProducts = Array.isArray(p.stockProducts) ? p.stockProducts : [];
  state.context.stockLocations = Array.isArray(p.stockLocations) ? p.stockLocations : [];
  state.context.unitDefinitions = p.unitDefinitions && typeof p.unitDefinitions === "object" ? p.unitDefinitions : { base: [], bulk: [] };
  renderSupplierStockBulkDialogState();
}, force, "catalog");
const loadProductLinks = (force) => cachedLoad("links", () => api("/product-links?active=all"), (p) => { state.productLinks = p.productLinks || []; }, force);
const loadShipments = (force) => cachedLoad("shipments", () => api("/shipments"), (p) => { state.shipments = p.shipments || []; }, force);
const loadDocuments = (force) => cachedLoad("documents", () => api("/documents"), (p) => { state.documents = p.documents || []; }, force);
const loadLedger = (force) => cachedLoad("ledger", () => api("/ledger"), (p) => { state.ledgerEntries = p.entries || []; state.payments = p.payments || []; }, force);
const loadTrash = (force) => cachedLoad("trash", () => api("/trash"), (p) => { state.trash = p.records || []; }, force);
const loadUsers = (force) => cachedLoad("users", () => api("/users"), (p) => { state.users = p.users || []; state.accessTemplates = p.accessTemplates || []; state.sectionDefinitions = p.sections || []; }, force);

async function loadSupplierWorkspaceData(supplierId, force = false) {
  const id = String(supplierId || "");
  if (!id) return;
  const workspace = state.supplierWorkspace;
  workspace.loading = true;
  if (state.activeView === "suppliers") renderActiveView();
  try {
    const [linkedPayload, independentPayload] = await Promise.all([
      (hasSection("suppliers") || hasSection("links")) ? api(`/product-links?supplierId=${encodeURIComponent(id)}&active=all`, { dedupe: !force }) : Promise.resolve({ productLinks: [] }),
      api(`/suppliers/${encodeURIComponent(id)}/independent-products?active=all`, { dedupe: !force })
    ]);
    if (workspace.supplierId !== id) return;
    updateRevision(linkedPayload);
    updateRevision(independentPayload);
    workspace.productLinks = linkedPayload.productLinks || [];
    workspace.independentProducts = independentPayload.independentProducts || [];
  } finally {
    if (workspace.supplierId === id) {
      workspace.loading = false;
      renderSupplierStockBulkDialogState();
    }
  }
}

function loadingSkeleton(label) {
  return `<div class="loading-skeleton" aria-label="${escapeHtml(label)}"><span></span><span></span><span></span><span></span></div>`;
}

function renderActiveView() {
  const pageHeading = document.querySelector(".page-heading");
  if (pageHeading) pageHeading.hidden = false;
  if (state.activeView === "suppliers") syncSupplierContextHeading();
  if (state.activeView === "stock") return;
  if (state.activeView === "stockExcel") {
    content.innerHTML = renderStockExcelView();
    return;
  }
  if (state.activeView === "productAnalysis") {
    content.innerHTML = renderProductAnalysis();
    bindProductAnalysisInteractions();
    return;
  }
  const renderer = { dashboard: renderDashboard, suppliers: renderSuppliers, documents: renderDocuments, ledger: renderLedger, trash: renderTrash, users: renderUsers }[state.activeView];
  content.innerHTML = renderer ? renderer() : '<div class="empty-state"><p>Bu bölüm kullanılamıyor.</p></div>';
}

function renderStockExcelView() {
  const locations = (state.context && state.context.stockLocations || []).filter((location) => location.active !== false);
  const result = state.stockExcel.result;
  const groups = stockExcelDetailGroups();
  const attentionCount = groups.attentionProducts.length;
  const processedCount = Number(result && result.processedProducts || groups.updatedProducts.length + groups.createdProducts.length);
  const fileName = String(state.stockExcel.fileName || "");
  const summary = result ? `<section class="stock-excel-result" aria-live="polite"><header><div><span>İçe aktarım tamamlandı</span><strong>${processedCount} ürün işlendi</strong></div><span class="badge ${attentionCount ? "is-warning" : "is-success"}">${attentionCount ? `${attentionCount} ürün dikkat gerektiriyor` : "Kontrol gerektirmiyor"}</span></header><div class="stock-excel-result__metrics">${stockExcelMetric("updatedProducts", "Güncellenen ürün", groups.updatedProducts.length)}${stockExcelMetric("createdProducts", "Yeni ürün", groups.createdProducts.length)}${stockExcelMetric("createdCategories", "Yeni kategori", groups.createdCategories.length)}${stockExcelMetric("balanceChanges", "Bakiyesi değişen", groups.balanceChanges.length)}${stockExcelMetric("attentionProducts", "Dikkat gerektiren", attentionCount)}</div></section>` : "";
  return `<section class="stock-excel-view"><article class="stock-excel-card"><header><span class="stock-excel-card__icon">${icon("stockExcel")}</span><div><p class="eyebrow">CANONICAL STOK AKTARIMI</p><h2>Stok Excel</h2><p>Excel stok şablonundaki ürün, birim, eşik ve stok miktarlarını toplu olarak aktarın.</p></div></header><form id="stockExcelImportForm" class="stock-excel-form" enctype="multipart/form-data" novalidate><label><span>Hedef Depo</span><select name="targetLocationId" required><option value="">Depo seçin</option>${locations.map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`).join("")}</select></label><label class="stock-excel-field"><span>Excel Dosyası</span><span class="stock-excel-file${fileName ? " is-selected" : ""}" id="stockExcelFilePicker"><input id="stockExcelFile" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-describedby="stockExcelFileMeta"><span class="stock-excel-file__icon">${icon("stockExcel")}</span><span class="stock-excel-file__copy"><strong id="stockExcelFileName">${escapeHtml(fileName || "Excel dosyası seç")}</strong><small id="stockExcelFileMeta">${fileName ? ".xlsx dosyası" : "Yalnız .xlsx · en fazla 20 MB"}</small></span><span class="stock-excel-file__action" id="stockExcelFileAction">${fileName ? "Değiştir" : "Seç"}</span></span></label><p class="stock-excel-message" id="stockExcelMessage" role="alert"></p><button class="ui-button ui-button--primary" id="stockExcelSubmit" type="submit" ${locations.length ? "" : "disabled"}>Stok Bilgilerini İçe Aktar</button></form>${locations.length ? "" : '<p class="stock-excel-empty">İçe aktarım için aktif bir depo bulunamadı.</p>'}</article>${summary}</section>`;
}

const STOCK_EXCEL_DETAIL_META = {
  updatedProducts: { kicker: "GÜNCELLENEN ÜRÜNLER", title: "Güncellenen ürünler", description: "Canonical kayıtla eşleşen ürünlerin birim ve eşik değişiklikleri." },
  createdProducts: { kicker: "YENİ ÜRÜNLER", title: "Oluşturulan ürünler", description: "İçe aktarım sırasında oluşturulan yeni canonical ürünler." },
  createdCategories: { kicker: "YENİ KATEGORİLER", title: "Oluşturulan kategoriler", description: "İçe aktarım sırasında oluşturulan kategoriler ve yeni ürün sayıları." },
  balanceChanges: { kicker: "BAKİYE DEĞİŞİMLERİ", title: "Bakiyesi değişen ürünler", description: "Hedef depoda oluşan gerçek adjustment hareketleri." },
  attentionProducts: { kicker: "DİKKAT GEREKTİREN ÜRÜNLER", title: "Ürün ayarları kontrolü", description: "İçe aktarılan ancak birim veya yaşam döngüsü bilgisi kontrol edilmesi gereken ürünler." }
};

function stockExcelDetailGroups() {
  const source = state.stockExcel.details && typeof state.stockExcel.details === "object" ? state.stockExcel.details : {};
  return {
    updatedProducts: Array.isArray(source.updatedProducts) ? source.updatedProducts : [],
    createdProducts: Array.isArray(source.createdProducts) ? source.createdProducts : [],
    createdCategories: Array.isArray(source.createdCategories) ? source.createdCategories : [],
    balanceChanges: Array.isArray(source.balanceChanges) ? source.balanceChanges : [],
    attentionProducts: Array.isArray(source.attentionProducts) ? source.attentionProducts : []
  };
}

function stockExcelMetric(group, label, count) {
  const disabled = count === 0;
  return `<button type="button" data-stock-excel-detail="${group}" aria-haspopup="dialog" ${disabled ? "disabled" : ""}><span>${escapeHtml(label)}</span><strong>${count}</strong><small>${disabled ? "Kayıt yok" : "Detayları görüntüle →"}</small></button>`;
}

function stockExcelDetailCell(label, content, className = "") {
  return `<td data-label="${escapeHtml(label)}"${className ? ` class="${className}"` : ""}>${content}</td>`;
}

function stockExcelUnitDisplay(value) {
  if (!value || typeof value !== "object") return "—";
  return escapeHtml(value.display || (value.bulkUnit && value.unitsPerBulkUnit ? `1 ${value.bulkUnit} = ${value.unitsPerBulkUnit} ${value.baseUnit}` : value.baseUnit || "—"));
}

function stockExcelDetailTable(group, items) {
  let headings = [];
  const rows = items.map((item) => {
    if (group === "updatedProducts") {
      headings = ["Kategori", "Ürün", "Önceki birim", "Yeni birim", "Değişen alanlar"];
      const changedFields = new Set((Array.isArray(item.changes) ? item.changes : []).map((change) => change.field));
      const previousThresholds = item.previousThresholds || {};
      const nextThresholds = item.newThresholds || {};
      const thresholdRows = [
        ["criticalThreshold", "Kritik eşik"],
        ["orderThreshold", "Sipariş eşiği"],
        ["targetLevel", "Hedef stok"]
      ].map(([field, label]) => `<span class="stock-excel-change${changedFields.has(field) ? " is-changed" : ""}"><b>${label}:</b> ${escapeHtml(previousThresholds[field] ?? 0)}${changedFields.has(field) ? ` → ${escapeHtml(nextThresholds[field] ?? 0)}` : ""}</span>`).join("");
      const unitChange = changedFields.has("unitStructure")
        ? `<span class="stock-excel-change is-changed"><b>Birim yapısı:</b> ${stockExcelUnitDisplay(item.previousUnitStructure)} → ${stockExcelUnitDisplay(item.newUnitStructure)}</span>`
        : "";
      const changes = `${unitChange}${thresholdRows}`;
      return `<tr>${stockExcelDetailCell("Kategori", escapeHtml(item.category || "—"))}${stockExcelDetailCell("Ürün", `<strong>${escapeHtml(item.productName || "—")}</strong><small>${escapeHtml(item.productCode || "")}</small>`)}${stockExcelDetailCell("Önceki birim", stockExcelUnitDisplay(item.previousUnitStructure))}${stockExcelDetailCell("Yeni birim", stockExcelUnitDisplay(item.newUnitStructure))}${stockExcelDetailCell("Değişen alanlar", changes, "stock-excel-detail-table__changes")}</tr>`;
    }
    if (group === "createdProducts") {
      headings = ["Kategori", "Ürün", "Ürün kodu", "Toplu birim", "Temel birim", "Çarpan"];
      return `<tr>${stockExcelDetailCell("Kategori", escapeHtml(item.category || "—"))}${stockExcelDetailCell("Ürün", `<strong>${escapeHtml(item.productName || "—")}</strong>`)}${stockExcelDetailCell("Ürün kodu", escapeHtml(item.productCode || "—"))}${stockExcelDetailCell("Toplu birim", escapeHtml(item.bulkUnit || "—"))}${stockExcelDetailCell("Temel birim", escapeHtml(item.baseUnit || "—"))}${stockExcelDetailCell("Çarpan", item.unitsPerBulkUnit > 0 ? escapeHtml(item.unitsPerBulkUnit) : "—")}</tr>`;
    }
    if (group === "createdCategories") {
      headings = ["Kategori", "Oluşturulan ürün"];
      return `<tr>${stockExcelDetailCell("Kategori", `<strong>${escapeHtml(item.category || "—")}</strong>`)}${stockExcelDetailCell("Oluşturulan ürün", `${Number(item.createdProductCount || 0)} ürün oluşturuldu`)}</tr>`;
    }
    if (group === "balanceChanges") {
      headings = ["Kategori / Ürün", "Hedef depo", "Önceki stok", "Excel hedef stok", "Adjustment"];
      return `<tr>${stockExcelDetailCell("Kategori / Ürün", `<span>${escapeHtml(item.category || "—")}</span><strong>${escapeHtml(item.productName || "—")}</strong>`)}${stockExcelDetailCell("Hedef depo", escapeHtml(item.targetLocation || "—"))}${stockExcelDetailCell("Önceki stok", escapeHtml(item.previousDisplay || `${item.previousQuantity || 0} ${item.baseUnit || ""}`))}${stockExcelDetailCell("Excel hedef stok", escapeHtml(item.targetDisplay || `${item.targetQuantity || 0} ${item.baseUnit || ""}`))}${stockExcelDetailCell("Adjustment", `<strong class="${Number(item.adjustment || 0) < 0 ? "is-negative" : "is-positive"}">${escapeHtml(item.adjustmentDisplay || item.adjustment || 0)}</strong>`)}</tr>`;
    }
    headings = ["Kategori", "Ürün", "Kontrol edilmesi gereken", "İşlem"];
    const reasons = Array.isArray(item.reasons) && item.reasons.length ? item.reasons.join(" · ") : item.reason || "Ürün ayarları kontrol edilmeli.";
    const action = item.productId ? `<button type="button" class="row-button" data-stock-excel-product-settings="${escapeHtml(item.productId)}" data-location-id="${escapeHtml(item.locationId || "")}">Ürün Ayarlarını Aç</button>` : "—";
    return `<tr>${stockExcelDetailCell("Kategori", escapeHtml(item.category || "—"))}${stockExcelDetailCell("Ürün", `<strong>${escapeHtml(item.productName || item.product || "—")}</strong><small>${escapeHtml(item.productCode || "")}</small>`)}${stockExcelDetailCell("Kontrol edilmesi gereken", escapeHtml(reasons), "stock-excel-detail-table__reason")}${stockExcelDetailCell("İşlem", action)}</tr>`;
  }).join("");
  return `<div class="stock-excel-detail-list"><table class="stock-excel-detail-table"><thead><tr>${headings.map((heading) => `<th scope="col">${escapeHtml(heading)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function openStockExcelDetail(group) {
  const items = stockExcelDetailGroups()[group] || [];
  const meta = STOCK_EXCEL_DETAIL_META[group];
  if (!meta || !items.length) return;
  state.detail = { type: "stock-excel-import", group };
  document.getElementById("detailKicker").textContent = meta.kicker;
  document.getElementById("detailTitle").textContent = meta.title;
  document.getElementById("detailDescription").textContent = `${items.length} kayıt · ${meta.description}`;
  document.getElementById("detailBody").innerHTML = stockExcelDetailTable(group, items);
  if (!detailDialog.open) detailDialog.showModal();
  document.body.classList.add("dialog-open");
}

function handleAppSubmit(event) {
  if (event.target && event.target.id === "stockExcelImportForm") {
    event.preventDefault();
    importStockExcel(event.target);
  }
}

async function importStockExcel(form) {
  const button = form.querySelector("#stockExcelSubmit");
  const message = form.querySelector("#stockExcelMessage");
  const file = form.elements.file && form.elements.file.files && form.elements.file.files[0];
  const targetLocationId = String(form.elements.targetLocationId && form.elements.targetLocationId.value || "").trim();
  if (!targetLocationId) { message.textContent = "Hedef depo seçin."; return; }
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name || "")) { message.textContent = "Geçerli bir .xlsx stok dosyası seçin."; return; }
  if (file.size > 20 * 1024 * 1024) { message.textContent = "Excel dosyası en fazla 20 MB olabilir."; return; }
  if (state.stockExcel.busy) return;
  state.stockExcel.busy = true;
  message.textContent = "";
  setBusy(button, true, "İçe aktarılıyor…");
  try {
    const payload = await uploadStockWorkbook(file, targetLocationId, {
      inventory: state.revisions.inventory,
      catalog: state.revisions.catalog
    });
    updateRevision(payload, "inventory");
    state.stockExcel.result = payload.summary || {};
    state.stockExcel.errors = payload.errors || [];
    state.stockExcel.details = {
      updatedProducts: Array.isArray(payload.updatedProducts) ? payload.updatedProducts : [],
      createdProducts: Array.isArray(payload.createdProducts) ? payload.createdProducts : [],
      createdCategories: Array.isArray(payload.createdCategories) ? payload.createdCategories : [],
      balanceChanges: Array.isArray(payload.balanceChanges) ? payload.balanceChanges : [],
      attentionProducts: Array.isArray(payload.attentionProducts) ? payload.attentionProducts : []
    };
    state.stockExcel.fileName = "";
    state.stock.stale = true;
    state.stock.loaded = false;
    state.stock.catalogLoaded = false;
    invalidate(["stock-references"]);
    await loadStockReferences(true);
    renderActiveView();
    toast(`Stok Excel tamamlandı: ${Number(payload.summary && payload.summary.changedBalances || 0)} bakiye güncellendi.`, false);
  } catch (error) {
    message.textContent = error.message || "Stok Excel içe aktarımı tamamlanamadı.";
  } finally {
    state.stockExcel.busy = false;
    if (button && button.isConnected) setBusy(button, false);
  }
}

function notificationApiRoot() {
  return state.context && state.context.actor && state.context.actor.type === "admin" ? "/api/admin/notifications" : "/api/notifications";
}

function registerFaturaPwaNotificationIntro() {
  if (!window.TahmisciPWA?.registerNotificationPrompt || !("Notification" in window) || !("PushManager" in window)) return;
  window.TahmisciPWA.registerNotificationPrompt({
    canShow: () => Boolean(state.context && state.context.actor),
    onEnable: enableFaturaPush
  });
}

async function enableFaturaPush() {
  const preferencesResult = await api(`${notificationApiRoot()}/preferences`, { dedupe: false });
  const publicKey = String(preferencesResult.capabilities && preferencesResult.capabilities.vapidPublicKey || "").trim();
  if (!publicKey) throw new Error("Anlık bildirim sunucu anahtarı tanımlı değil.");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Anlık bildirim izni verilmedi.");
  const registration = await window.TahmisciPWA.ensureServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(publicKey) });
  }
  const deviceId = faturaNotificationDeviceId();
  const headers = { "X-Tahmisci-Device-Id": deviceId, "X-Tahmisci-App-Id": "fatura", "X-Tahmisci-App-Target": "fatura" };
  await api(`${notificationApiRoot()}/push-subscriptions`, {
    method: "POST",
    headers,
    body: { subscription: subscription.toJSON(), deviceId, deviceName: faturaNotificationDeviceName(), appId: "fatura", appTarget: "fatura" }
  });
  await api(`${notificationApiRoot()}/preferences`, {
    method: "PATCH",
    body: { pushEnabled: true, channels: { push: true } }
  });
  return true;
}

function faturaNotificationDeviceId() {
  const key = "tahmisci:fatura:notification-device-id";
  let value = "";
  try { value = localStorage.getItem(key) || ""; } catch (_error) {}
  if (!value) {
    value = requestId("fatura-device");
    try { localStorage.setItem(key, value); } catch (_error) {}
  }
  return value;
}

function faturaNotificationDeviceName() {
  const platform = String(navigator.userAgentData?.platform || navigator.platform || "Tarayıcı").slice(0, 60);
  return `${platform} · ${window.matchMedia("(display-mode: standalone)").matches ? "Fatura PWA" : "Fatura Web"}`;
}

function decodeBase64Url(valueText) {
  const padding = "=".repeat((4 - valueText.length % 4) % 4);
  const raw = atob((valueText + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function loadNotifications(force = false) {
  const payload = await cachedLoad("notifications", () => api(`${notificationApiRoot()}?limit=40`, { dedupe: !force }), (result) => {
    state.notifications = Array.isArray(result.notifications) ? result.notifications : [];
    state.unreadCount = Math.max(0, Number(result.unreadCount || 0));
  }, force);
  renderNotificationState();
  return payload;
}

function renderNotificationState() {
  const count = Math.max(0, Number(state.unreadCount || 0));
  void window.TahmisciPWA?.updateBadge?.(count);
  const badge = document.getElementById("notificationCount");
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
  document.getElementById("notificationSummary").textContent = count ? `${count} okunmamış bildirim` : "Okunmamış bildirim yok";
  document.getElementById("markAllNotificationsRead").disabled = count === 0;
  if (notificationDrawer.hidden) return;
  const list = document.getElementById("notificationList");
  list.innerHTML = state.notifications.length ? state.notifications.map((item) => `<article class="notification-item ${item.readAt ? "" : "is-unread"}" data-notification-card="${escapeHtml(item.id)}"><i class="notification-item-dot" aria-hidden="true"></i><button class="notification-item-open" type="button" data-notification-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title || "Bildirim")}</strong><span>${escapeHtml(item.body || "")}</span><time datetime="${escapeHtml(item.createdAt || "")}">${trDate(item.createdAt, true)}</time></button><span class="notification-item-actions"><button type="button" data-notification-action="${item.readAt ? "unread" : "read"}" data-notification-id="${escapeHtml(item.id)}">${item.readAt ? "Okunmadı" : "Okundu"}</button><button type="button" data-notification-action="delete" data-notification-id="${escapeHtml(item.id)}">Sil</button></span></article>`).join("") : '<div class="notification-empty"><div><strong>Yeni bildirim yok</strong><p>Sevkiyat, belge, ödeme ve yetki bildirimleri burada kalıcı olarak görünür.</p></div></div>';
}

async function openNotifications() {
  closeProfileMenu();
  notificationDrawer.hidden = false;
  notificationScrim.hidden = false;
  notificationDrawer.setAttribute("aria-hidden", "false");
  document.getElementById("notificationButton").setAttribute("aria-expanded", "true");
  document.body.classList.add("notification-open");
  document.getElementById("notificationList").innerHTML = '<div class="loading-skeleton loading-skeleton--compact" aria-label="Bildirimler yükleniyor"><span></span><span></span><span></span></div>';
  try { await loadNotifications(true); }
  catch (error) { document.getElementById("notificationList").innerHTML = `<div class="notification-empty"><div><strong>Bildirimler alınamadı</strong><p>${escapeHtml(error.message || "Lütfen yeniden deneyin.")}</p><button class="ui-button ui-button--secondary" data-profile-action="notifications" type="button">Yeniden dene</button></div></div>`; }
}

function closeNotifications() {
  notificationDrawer.hidden = true;
  notificationScrim.hidden = true;
  notificationDrawer.setAttribute("aria-hidden", "true");
  document.getElementById("notificationButton").setAttribute("aria-expanded", "false");
  document.body.classList.remove("notification-open");
}

async function markAllNotificationsRead(button) {
  if (button.disabled || state.unreadCount === 0) return;
  setBusy(button, true, "İşleniyor…");
  try {
    const payload = await api(`${notificationApiRoot()}/read-all`, { method: "POST", body: {} });
    state.unreadCount = Math.max(0, Number(payload.unreadCount || 0));
    state.notifications = state.notifications.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }));
    state.loaded.delete("notifications");
    renderNotificationState();
  } catch (error) { toast(error.message || "Bildirimler güncellenemedi.", true); }
  finally { setBusy(button, false); button.disabled = state.unreadCount === 0; }
}

async function openNotification(notificationId) {
  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification) return;
  if (!notification.readAt) {
    try {
      const payload = await api(`${notificationApiRoot()}/${encodeURIComponent(notification.id)}/read`, { method: "PATCH", body: {} });
      notification.readAt = payload.notification && payload.notification.readAt || new Date().toISOString();
      state.unreadCount = Math.max(0, Number(payload.unreadCount || 0));
      state.loaded.delete("notifications");
      renderNotificationState();
    } catch (error) { toast(error.message || "Bildirim okundu olarak işaretlenemedi.", true); }
  }
  closeNotifications();
  const entityType = String(notification.entityType || "");
  const entityId = String(notification.entityId || "");
  if (notification.eventType === "procurement_access_updated" || entityType === "procurement_access") {
    await refreshAccessContext(null, { firstVisible: true });
    return;
  }
  const target = String(notification.deepLink || "");
  if (target) {
    const url = new URL(target, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith("/fatura/") && url.searchParams.get("view") === "stock") {
      return activateIntentFromUrl(url);
    }
  }
  if (entityType === "shipment" && visibleViews.some((item) => item.id === "documents")) { await setView("documents"); if (entityId) await openShipment(entityId); return; }
  if (entityType === "document" && visibleViews.some((item) => item.id === "documents")) { await setView("documents"); if (entityId) await openDocument(entityId); return; }
  if (entityType === "supplier" && visibleViews.some((item) => item.id === "suppliers")) { await setView("suppliers"); if (entityId) await openSupplier(entityId); return; }
  if (["ledgerEntry", "payment"].includes(entityType) && visibleViews.some((item) => item.id === "ledger")) { await setView("ledger"); return; }
  if (target) {
    const url = new URL(target, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith("/fatura/")) return activateIntentFromUrl(url);
  }
  toast("Bu bildirimin bağlı olduğu bölüm için erişiminiz bulunmuyor.", true);
}

async function mutateNotification(button) {
  const id = String(button.dataset.notificationId || "");
  const action = String(button.dataset.notificationAction || "");
  if (!id || !["read", "unread", "delete"].includes(action)) return;
  if (action === "delete" && button.dataset.confirmDelete !== "true") {
    button.dataset.confirmDelete = "true";
    toast("Bildirimi silmek için Sil düğmesine tekrar basın.");
    setTimeout(() => { if (button.isConnected) delete button.dataset.confirmDelete; }, 4000);
    return;
  }
  delete button.dataset.confirmDelete;
  button.disabled = true;
  try {
    const payload = await api(`${notificationApiRoot()}/${encodeURIComponent(id)}${action === "delete" ? "" : `/${action}`}`, {
      method: action === "delete" ? "DELETE" : "PATCH",
      body: action === "delete" ? undefined : {}
    });
    if (action === "delete") state.notifications = state.notifications.filter((item) => item.id !== id);
    else state.notifications = state.notifications.map((item) => item.id === id ? { ...item, ...(payload.notification || {}), readAt: action === "read" ? (payload.notification?.readAt || new Date().toISOString()) : null } : item);
    state.unreadCount = Math.max(0, Number(payload.unreadCount || 0));
    state.loaded.delete("notifications");
    renderNotificationState();
  } catch (error) { toast(error.message || "Bildirim güncellenemedi.", true); }
  finally { if (button.isConnected) button.disabled = false; }
}

async function handleClick(event) {
  const button = event.target.closest("button,a");
  if (!button) return;
  if (button.dataset.authTab) return selectAuthTab(button.dataset.authTab);
  if (button.id === "sidebarToggle") return toggleSidebar();
  if (button.id === "mobileMenu") return openMobileSidebar();
  if (button.id === "sidebarScrim") return closeMobileSidebar();
  if (button.id === "refreshButton") return state.activeView ? setView(state.activeView, { force: true }) : refreshAccessContext(button);
  if (button.id === "contextBackButton") {
    if (button.dataset.contextBack === "supplier") return closeSupplierWorkspace();
    if (button.dataset.contextBack === "stock") return document.getElementById("stockWarehouseBackButton")?.click();
    return;
  }
  if (button.id === "accessRefreshButton") return refreshAccessContext();
  if (button.id === "profileMenuButton") return toggleProfileMenu();
  if (button.id === "notificationButton" || button.dataset.profileAction === "notifications") return openNotifications();
  if (button.id === "notificationScrim" || button.classList.contains("notification-close")) return closeNotifications();
  if (button.id === "markAllNotificationsRead") return markAllNotificationsRead(button);
  if (button.dataset.notificationAction) return mutateNotification(button);
  if (button.dataset.notificationId) return openNotification(button.dataset.notificationId);
  if (button.dataset.profileAction === "install") return installApp(button);
  if (button.id === "logoutButton" || button.dataset.profileAction === "logout") return performLogout(button);
  if (button.dataset.dashboardView) return navigateFromDashboard(button.dataset.dashboardView, button.dataset.dashboardFilter || "");
  if (button.dataset.stockExcelProductSettings) {
    const intent = { productId: button.dataset.stockExcelProductSettings, locationId: button.dataset.locationId || "", openSettings: true };
    closeDetailDialog();
    await setView("stock");
    return applyStockIntent(intent);
  }
  if (button.dataset.stockExcelDetail) return openStockExcelDetail(button.dataset.stockExcelDetail);
  if (button.dataset.view || button.dataset.viewTarget) return setView(button.dataset.view || button.dataset.viewTarget);
  if (button.hasAttribute("data-supplier-product-new")) return selectNewSupplierStockProduct();
  if (button.dataset.supplierStockProductId) return selectSupplierStockProduct(button.dataset.supplierStockProductId);
  if (button.hasAttribute("data-supplier-product-clear")) return clearSupplierStockProductSelection();
  if (button.dataset.cancelAction === "decline-stock") return declineSupplierShipmentStock(button);
  if (button.classList.contains("dialog-close")) return closeEntityDialog();
  if (button.classList.contains("detail-close")) return closeDetailDialog();
  if (button.dataset.openSupplier) return openSupplier(button.dataset.openSupplier);
  if (button.hasAttribute("data-supplier-back")) return closeSupplierWorkspace();
  if (button.dataset.supplierWorkspaceAction) return handleSupplierWorkspaceAction(button, button.dataset.supplierWorkspaceAction);
  if (button.dataset.editIndependentProduct) return openIndependentProductForm(button.dataset.editIndependentProduct);
  if (button.dataset.deactivateIndependentProduct) return deleteIndependentProduct(button, button.dataset.deactivateIndependentProduct);
  if (button.dataset.openShipment) return openShipment(button.dataset.openShipment);
  if (button.dataset.printShipment) return printShipmentArchive(button.dataset.printShipment);
  if (button.dataset.openDocument) return openDocument(button.dataset.openDocument);
  if (button.dataset.removeShipment) return removeShipment(button, button.dataset.removeShipment);
  if (button.dataset.removePayment) return removePayment(button, button.dataset.removePayment);
  if (button.dataset.restoreTrash) return restoreTrashRecord(button, button.dataset.trashType, button.dataset.restoreTrash);
  if (button.dataset.purgeTrash) return purgeTrashRecord(button, button.dataset.trashType, button.dataset.purgeTrash);
  if (button.dataset.editLink) return openLinkForm(button.dataset.editLink);
  if (button.dataset.editUser) return openUserAccess(button.dataset.editUser);
  if (button.dataset.reverseLedger) return reverseLedger(button, button.dataset.reverseLedger);
  if (button.dataset.detailAction) return handleDetailAction(button, button.dataset.detailAction);
  if (button.dataset.action) return handleAction(button, button.dataset.action);
}

function handleFilterInput(event) {
  if (event.target.id === "supplier-stock-bulk-search" && supplierStockBulk) {
    if (supplierStockBulk.busy) return;
    supplierStockBulk.query = event.target.value;
    return renderSupplierStockBulkDialogState();
  }
  if (event.target.matches("[data-supplier-product-search]")) {
    syncSupplierProductSearch(event.target);
    return;
  }
  if (event.target.matches("[data-combo-input]")) {
    syncCombobox(event.target);
    if (event.target.dataset.comboInput === "stockProductId") updateShipmentLineUnit(event.target);
  }
  const map = { "supplier-search": "suppliers", "document-search": "documents" };
  const key = map[event.target.id];
  if (["bulkUnit", "baseUnit", "conversionFactor"].includes(event.target.name)) updateSupplierConversionPreview();
  if (!key) return;
  state.filters[key] = event.target.value;
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(renderActiveView, 120);
}

function handleChange(event) {
  if (supplierStockBulk && entityForm.dataset.mode === "supplier-stock-bulk-add") {
    if (supplierStockBulk.busy) return;
    if (event.target.id === "supplier-stock-bulk-category") {
      supplierStockBulk.category = event.target.value;
      return renderSupplierStockBulkDialogState();
    }
    if (event.target.matches("[data-supplier-bulk-product], [data-supplier-bulk-all]")) {
      const selectable = getSupplierBulkStockProducts().filter((item) => item.status === "selectable");
      const ids = event.target.hasAttribute("data-supplier-bulk-all")
        ? selectable.map((item) => item.id)
        : selectable.filter((item) => item.id === event.target.dataset.supplierBulkProduct).map((item) => item.id);
      for (const id of ids) {
        if (event.target.checked) supplierStockBulk.selected.add(id);
        else supplierStockBulk.selected.delete(id);
      }
      supplierStockBulk.pending = null;
      return renderSupplierStockBulkDialogState();
    }
  }
  if (event.target.id === "stockExcelFile") {
    const file = event.target.files && event.target.files[0];
    state.stockExcel.fileName = file instanceof File ? file.name : "";
    const picker = document.getElementById("stockExcelFilePicker");
    const title = document.getElementById("stockExcelFileName");
    const meta = document.getElementById("stockExcelFileMeta");
    const action = document.getElementById("stockExcelFileAction");
    if (picker) picker.classList.toggle("is-selected", Boolean(state.stockExcel.fileName));
    if (title) title.textContent = state.stockExcel.fileName || "Excel dosyası seç";
    if (meta) meta.textContent = state.stockExcel.fileName ? ".xlsx dosyası" : "Yalnız .xlsx · en fazla 20 MB";
    if (action) action.textContent = state.stockExcel.fileName ? "Değiştir" : "Seç";
    return;
  }
  if (event.target.matches("[data-combo-input]")) {
    syncCombobox(event.target);
    if (event.target.dataset.comboInput === "stockProductId") updateShipmentLineUnit(event.target);
  }
  if (event.target.id === "access-template") return applyAccessTemplate(event.target);
  if (event.target.name === "faturaAccess") return toggleAccessControls(event.target.checked);
  if (event.target.matches("[data-section-toggle]")) {
    if (event.target.checked) {
      const card = event.target.closest("[data-section-card]");
      const defaultLevel = card && (card.querySelector('input[type="radio"][value="view"]') || card.querySelector('input[type="radio"]'));
      if (defaultLevel) defaultLevel.checked = true;
    }
    markAccessAsCustom();
    return updatePermissionSectionCard(event.target.closest("[data-section-card]"));
  }
  if (String(event.target.name || "").startsWith("sectionLevel:")) return markAccessAsCustom();
  if (event.target.id === "fatura-role") return markAccessAsCustom(false);
  if (event.target.matches("[data-supplier-line-enabled]")) {
    const row = event.target.closest("[data-supplier-shipment-line]");
    row?.querySelectorAll("[data-supplier-line-quantity],[data-supplier-line-total]").forEach((input) => {
      input.disabled = !event.target.checked;
      input.required = event.target.checked;
      if (!event.target.checked) input.value = "";
    });
    return;
  }
  if (["shipmentFile", "shipmentCameraFile"].includes(event.target.name)) {
    const otherName = event.target.name === "shipmentFile" ? "shipmentCameraFile" : "shipmentFile";
    if (event.target.files?.length && entityForm.elements[otherName]) entityForm.elements[otherName].value = "";
    return updateSupplierShipmentSubmitState();
  }
  if (event.target.id === "archive-supplier-filter") { state.filters.documentsSupplier = event.target.value; return renderActiveView(); }
  if (event.target.id === "archive-date-filter") { state.filters.documentsDate = event.target.value; return renderActiveView(); }
  if (["bulkUnit", "baseUnit", "conversionFactor"].includes(event.target.name)) return updateSupplierConversionPreview();
  if (event.target.id === "shipment-status") { state.filters.shipmentStatus = event.target.value; return renderActiveView(); }
  if (event.target.id === "shipment-evidence") { state.filters.shipmentEvidence = event.target.value; return renderActiveView(); }
  if (event.target.id === "ledger-supplier") { state.filters.ledgerSupplier = event.target.value; return renderActiveView(); }
  if (event.target.id === "ledger-date") { state.filters.ledgerDate = event.target.value; return renderActiveView(); }
}

function supplierStockProducts(query = "") {
  const normalizedQuery = normalizeComboText(query);
  return (state.context && Array.isArray(state.context.stockProducts) ? state.context.stockProducts : [])
    .filter((product) => {
      if (!normalizedQuery) return true;
      return normalizeComboText(`${product.name || ""} ${product.category || ""} ${product.productCode || ""}`).includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftName = normalizeComboText(left.name);
      const rightName = normalizeComboText(right.name);
      const leftRank = normalizedQuery && leftName.startsWith(normalizedQuery) ? 0 : 1;
      const rightRank = normalizedQuery && rightName.startsWith(normalizedQuery) ? 0 : 1;
      return leftRank - rightRank || String(left.name || "").localeCompare(String(right.name || ""), "tr");
    });
}

function supplierStockProductRows(query = "") {
  const products = supplierStockProducts(query);
  if (!products.length) return '<p class="supplier-product-combobox__empty">Eşleşen stok ürünü bulunamadı.</p>';
  return products.map((product) => `<button type="button" role="option" data-supplier-stock-product-id="${escapeHtml(product.id)}"><strong>${escapeHtml(product.name || "Stok ürünü")}</strong><small>${escapeHtml(product.category || "Kategorisiz")} · ${escapeHtml(product.baseUnit || product.unit || "adet")}</small></button>`).join("");
}

function supplierStockProductCombobox(item = null) {
  const selected = item && item.stockProductId
    ? (state.context.stockProducts || []).find((product) => String(product.id) === String(item.stockProductId))
    : null;
  const initialMode = selected ? "existing" : item ? "legacy" : "";
  const inputValue = selected && selected.name || item && item.name || "";
  const canCreate = has(CAPABILITIES.inventoryCatalogManage);
  return `<div class="supplier-product-combobox span-2" data-supplier-product-combobox><label for="supplierStockProductSearch">Ürün Adı</label><input type="hidden" name="stockProductId" value="${escapeHtml(selected && selected.id || item && item.stockProductId || "")}"><input type="hidden" name="stockProductMode" value="${escapeHtml(initialMode)}"><div class="supplier-product-combobox__control"><input id="supplierStockProductSearch" name="name" type="search" value="${escapeHtml(inputValue)}" maxlength="180" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="supplierStockProductOptions" data-supplier-product-search required><button type="button" data-supplier-product-clear aria-label="Ürün seçimini temizle" ${selected ? "" : "hidden"}>×</button></div><div class="supplier-product-combobox__options" id="supplierStockProductOptions" role="listbox" hidden><button class="supplier-product-combobox__new" type="button" role="option" data-supplier-product-new ${canCreate ? "" : "disabled"}><strong>+ Yeni ürün</strong><small>${canCreate ? "Kategorisizler altında canonical stok ürünü oluştur" : "Yeni stok ürünü oluşturma yetkiniz yok"}</small></button><div class="supplier-product-combobox__results" data-supplier-product-results>${supplierStockProductRows("")}</div></div><p class="supplier-product-combobox__selection" data-supplier-product-selection ${selected ? "" : "hidden"}>${selected ? `<span><strong>${escapeHtml(selected.name)}</strong><small>${escapeHtml(selected.category || "Kategorisiz")} · ${escapeHtml(selected.baseUnit || selected.unit || "adet")}</small></span><em>Stok ürünüyle eşleşti</em>` : ""}</p></div>`;
}

function openSupplierProductCombobox(input = entityForm.querySelector("[data-supplier-product-search]")) {
  const root = input && input.closest("[data-supplier-product-combobox]");
  const options = root && root.querySelector(".supplier-product-combobox__options");
  if (!input || !options) return;
  const results = options.querySelector("[data-supplier-product-results]");
  if (results) results.innerHTML = supplierStockProductRows(input.value);
  options.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function closeSupplierProductCombobox() {
  const input = entityForm.querySelector("[data-supplier-product-search]");
  const options = entityForm.querySelector(".supplier-product-combobox__options");
  if (options) options.hidden = true;
  if (input) input.setAttribute("aria-expanded", "false");
}

function setSupplierProductSelection(product = null, mode = "") {
  const root = entityForm.querySelector("[data-supplier-product-combobox]");
  if (!root) return;
  const input = root.querySelector("[data-supplier-product-search]");
  const idField = root.querySelector('input[name="stockProductId"]');
  const modeField = root.querySelector('input[name="stockProductMode"]');
  const clear = root.querySelector("[data-supplier-product-clear]");
  const selection = root.querySelector("[data-supplier-product-selection]");
  const baseSelect = entityForm.elements.baseUnit;
  if (idField) idField.value = product ? String(product.id) : "";
  if (modeField) modeField.value = mode;
  if (product && input) input.value = String(product.name || "");
  if (clear) clear.hidden = !product && mode !== "new";
  if (baseSelect) {
    if (product) baseSelect.value = String(product.baseUnit || product.unit || "adet");
    baseSelect.disabled = Boolean(product);
    baseSelect.closest("label")?.classList.toggle("is-canonical-locked", Boolean(product));
  }
  if (selection) {
    selection.hidden = !product && mode !== "new";
    selection.classList.toggle("is-new", mode === "new");
    selection.innerHTML = product
      ? `<span><strong>${escapeHtml(product.name || "Stok ürünü")}</strong><small>${escapeHtml(product.category || "Kategorisiz")} · ${escapeHtml(product.baseUnit || product.unit || "adet")}</small></span><em>Stok ürünüyle eşleşti</em>`
      : mode === "new" ? '<span><strong>Yeni stok ürünü</strong><small>Kategorisizler altında oluşturulacak</small></span><em>Yeni kayıt</em>' : "";
  }
  closeSupplierProductCombobox();
  updateSupplierConversionPreview();
}

function selectSupplierStockProduct(productId) {
  const product = (state.context.stockProducts || []).find((item) => String(item.id) === String(productId));
  if (!product) return;
  setSupplierProductSelection(product, "existing");
}

function selectNewSupplierStockProduct() {
  const input = entityForm.querySelector("[data-supplier-product-search]");
  setSupplierProductSelection(null, "new");
  if (input) { input.focus(); input.select(); }
}

function clearSupplierStockProductSelection() {
  const input = entityForm.querySelector("[data-supplier-product-search]");
  if (input) input.value = "";
  setSupplierProductSelection(null, "");
  if (input) { input.focus(); openSupplierProductCombobox(input); }
}

function syncSupplierProductSearch(input) {
  const root = input.closest("[data-supplier-product-combobox]");
  const mode = root && root.querySelector('input[name="stockProductMode"]');
  const idField = root && root.querySelector('input[name="stockProductId"]');
  if (mode && mode.value === "existing") setSupplierProductSelection(null, "");
  else if (idField) idField.value = "";
  openSupplierProductCombobox(input);
}

function handleSupplierProductKeydown(event) {
  const root = event.target.closest && event.target.closest("[data-supplier-product-combobox]");
  if (!root) return false;
  const input = root.querySelector("[data-supplier-product-search]");
  const options = root.querySelector(".supplier-product-combobox__options");
  if (event.key === "Escape") {
    event.preventDefault();
    closeSupplierProductCombobox();
    input?.focus();
    return true;
  }
  const choices = [...root.querySelectorAll('.supplier-product-combobox__options button:not(:disabled)')];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openSupplierProductCombobox(input);
    const current = choices.indexOf(document.activeElement);
    const next = event.key === "ArrowDown"
      ? choices[(current + 1 + choices.length) % choices.length]
      : choices[(current - 1 + choices.length) % choices.length];
    next?.focus();
    return true;
  }
  if (event.key === "Enter" && event.target === input && options && !options.hidden) {
    const productChoice = root.querySelector('[data-supplier-stock-product-id]:not(:disabled)');
    const choice = productChoice || root.querySelector('[data-supplier-product-new]:not(:disabled)');
    if (choice) { event.preventDefault(); choice.click(); return true; }
  }
  return false;
}

function updateSupplierConversionPreview() {
  const output = document.getElementById("supplierConversionPreview");
  if (!output) return;
  output.textContent = conversionText(entityForm.elements.bulkUnit?.value, entityForm.elements.baseUnit?.value, entityForm.elements.conversionFactor?.value);
}

async function navigateFromDashboard(view, filter) {
  if (view === "shipments") {
    state.filters.shipmentStatus = filter === "pending" ? "onay_bekliyor" : "";
    state.filters.shipmentEvidence = filter === "missing-documents" ? "missing" : filter === "unaccounted" ? "unaccounted" : "";
    view = "documents";
  }
  if (view === "ledger" && /^\d{4}-\d{2}-\d{2}$/.test(filter)) state.filters.ledgerDate = filter;
  await setView(view);
}

function normalizeComboText(valueText) {
  return String(valueText || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function syncCombobox(input) {
  const name = input.dataset.comboInput;
  const label = input.closest("label");
  const hidden = label && label.querySelector(`input[type="hidden"][name="${CSS.escape(name)}"]`);
  const list = input.list;
  if (!hidden || !list) return;
  const query = normalizeComboText(input.value);
  const options = Array.from(list.options);
  const exact = options.find((option) => normalizeComboText(option.value) === query);
  hidden.value = exact ? exact.dataset.id || "" : "";
  input.setCustomValidity(input.required && !exact ? "Listeden geçerli bir kayıt seçin." : "");
  options.sort((first, second) => {
    const firstText = normalizeComboText(first.value);
    const secondText = normalizeComboText(second.value);
    const firstRank = query && firstText.startsWith(query) ? 0 : 1;
    const secondRank = query && secondText.startsWith(query) ? 0 : 1;
    return firstRank - secondRank || first.value.localeCompare(second.value, "tr");
  }).forEach((option) => list.append(option));
}

function updateShipmentLineUnit(input) {
  const line = input.closest(".shipment-line");
  const id = line && line.querySelector('input[type="hidden"][name="stockProductId"]')?.value;
  const product = (state.context && state.context.stockProducts || []).find((item) => String(item.id) === String(id));
  const unit = line && line.querySelector('[name="unit"]');
  if (!unit) return;
  const allowed = product && Array.isArray(product.allowedUnits) && product.allowedUnits.length
    ? product.allowedUnits
    : product ? [product.baseUnit || product.unit, product.bulkUnit].filter(Boolean) : [];
  const preferred = product && (product.defaultMovementUnit || product.baseUnit || product.unit) || "";
  unit.innerHTML = allowed.length
    ? allowed.map((valueText) => `<option value="${escapeHtml(valueText)}">${escapeHtml(valueText)}</option>`).join("")
    : '<option value="">Önce ürün seçin</option>';
  unit.value = allowed.includes(preferred) ? preferred : allowed[0] || "";
}

function applyAccessTemplate(select) {
  const template = state.accessTemplates.find((item) => item.key === select.value);
  if (!template) return;
  const role = document.getElementById("fatura-role");
  const access = entityForm.elements.faturaAccess;
  if (access) access.checked = true;
  if (role && template.role) role.value = template.role;
  const custom = template.key === "ozel";
  if (role) role.disabled = !custom;
  const controls = entityForm.querySelector("[data-access-controls]");
  if (controls) controls.dataset.templateMode = custom ? "custom" : "template";
  if (!custom) applySectionAccessToForm(template.sectionAccess || {});
  updateAllPermissionSectionCards();
}

function toggleAccessControls(enabled) {
  const template = document.getElementById("access-template");
  if (enabled && !entityForm.querySelector("[data-section-toggle]:checked")) {
    if (template) {
      template.value = state.accessTemplates.some((item) => item.key === "mal_kabul") ? "mal_kabul" : state.accessTemplates[0]?.key || "ozel";
      applyAccessTemplate(template);
      return;
    }
  }
  updateAllPermissionSectionCards();
}

function applySectionAccessToForm(sectionAccess) {
  entityForm.querySelectorAll("[data-section-card]").forEach((card) => {
    const id = card.dataset.sectionCard;
    const level = String(sectionAccess && sectionAccess[id] || "off");
    const toggle = card.querySelector("[data-section-toggle]");
    if (toggle) toggle.checked = level !== "off";
    const radio = card.querySelector(`input[type="radio"][value="${CSS.escape(level)}"]`);
    if (radio) radio.checked = true;
  });
}

function markAccessAsCustom(resetRole = true) {
  const template = document.getElementById("access-template");
  if (template) template.value = "ozel";
  const controls = entityForm.querySelector("[data-access-controls]");
  if (controls) controls.dataset.templateMode = "custom";
  const role = document.getElementById("fatura-role");
  if (role) {
    role.disabled = false;
    if (resetRole) role.value = "özel";
  }
  updateAllPermissionSectionCards();
}

function updateAllPermissionSectionCards() {
  entityForm.querySelectorAll("[data-section-card]").forEach(updatePermissionSectionCard);
}

function updatePermissionSectionCard(card) {
  if (!card) return;
  const enabled = Boolean(entityForm.elements.faturaAccess && entityForm.elements.faturaAccess.checked);
  const toggle = card.querySelector("[data-section-toggle]");
  const open = Boolean(toggle && toggle.checked);
  card.classList.toggle("is-open", open);
  if (toggle) toggle.disabled = !enabled;
  const label = card.querySelector(".permission-section-switch span");
  if (label) label.textContent = open ? "Görünür" : "Kapalı";
  const fieldset = card.querySelector("[data-section-levels]");
  if (!fieldset) return;
  fieldset.hidden = !open;
  fieldset.disabled = !enabled || !open;
  fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => { radio.disabled = !enabled || !open; });
  if (open && !fieldset.querySelector("input:checked")) {
    const first = fieldset.querySelector("input[value=view], input");
    if (first) first.checked = true;
  }
}

function handleAction(button, action) {
  if (action === "new-supplier") return openSupplierForm();
  if (action === "new-link") return openLinkForm();
  if (action === "new-shipment") return openShipmentForm();
  if (action === "upload-document") return openDocumentForm();
  if (action === "new-payment") return openPaymentForm();
  if (action === "export-ledger") return exportLedger(button);
  if (action === "open-payment-history") { state.filters.paymentHistoryOpen = true; return renderActiveView(); }
  if (action === "close-payment-history") { state.filters.paymentHistoryOpen = false; return renderActiveView(); }
  if (action === "new-ledger-entry") return openLedgerEntryForm();
  if (action === "supplier-add-product") return openIndependentProductForm();
  if (action === "supplier-add-stock-products") return openSupplierStockBulkAddForm();
  if (action === "supplier-create-shipment") return openSupplierShipmentForm();
  if (action === "add-shipment-line") {
    const lines = document.getElementById("shipmentLines");
    lines.insertAdjacentHTML("beforeend", shipmentLine(state.context.stockProducts || [], lines.children.length));
  }
  if (action === "remove-shipment-line") {
    const lines = document.getElementById("shipmentLines");
    if (lines.children.length > 1) button.closest(".shipment-line").remove();
  }
}

function normalizedDialogHeading(value) {
  return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9çğıöşü]+/gi, " ").trim();
}

function openEntityDialog(config) {
  if (config.mode !== "supplier-stock-bulk-add") supplierStockBulk = null;
  entityForm.dataset.mode = config.mode;
  entityForm.dataset.entityId = config.entityId || "";
  const kicker = config.kicker || "YENİ KAYIT";
  const kickerElement = document.getElementById("dialogKicker");
  const repeatedKicker = normalizedDialogHeading(kicker) === normalizedDialogHeading(config.title);
  kickerElement.textContent = repeatedKicker ? "" : kicker;
  kickerElement.hidden = repeatedKicker;
  document.getElementById("dialogTitle").textContent = config.title;
  document.getElementById("dialogDescription").textContent = config.description || "";
  document.getElementById("dialogBody").innerHTML = config.body;
  const submitButton = document.getElementById("dialogSubmit");
  submitButton.disabled = config.submitDisabled === true;
  submitButton.removeAttribute("aria-busy");
  submitButton.textContent = config.submitLabel || "Kaydet";
  const cancelButton = entityDialog.querySelector("footer .dialog-close");
  if (cancelButton) {
    cancelButton.textContent = config.cancelLabel || "Vazgeç";
    cancelButton.hidden = config.mode === "user-access" || config.hideCancel === true;
    if (config.cancelAction) cancelButton.dataset.cancelAction = config.cancelAction;
    else delete cancelButton.dataset.cancelAction;
  }
  document.getElementById("dialogMessage").textContent = "";
  entityDialog.classList.toggle("fatura-dialog--receipt", ["shipment-create", "supplier-shipment-create"].includes(config.mode));
  entityDialog.classList.toggle("fatura-dialog--supplier-stock-bulk", config.mode === "supplier-stock-bulk-add");
  entityDialog.showModal(); document.body.classList.add("dialog-open");
}
function closeEntityDialog() { if (supplierStockBulk?.busy) return; if (entityDialog.open) entityDialog.close(); cleanupEntityDialog(); }
function closeDetailDialog() { if (detailDialog.open) detailDialog.close(); cleanupDetailDialog(); }
function cleanupEntityDialog() { supplierStockBulk = null; entityForm.reset(); delete entityForm.dataset.mode; delete entityForm.dataset.entityId; const cancelButton = entityDialog.querySelector("footer .dialog-close"); if (cancelButton) { cancelButton.textContent = "Vazgeç"; delete cancelButton.dataset.cancelAction; } entityDialog.classList.remove("fatura-dialog--receipt", "fatura-dialog--supplier-stock-bulk"); syncDialogOpenState(); }
function cleanupDetailDialog() { state.detail = null; if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = ""; } syncDialogOpenState(); }
function syncDialogOpenState() { document.body.classList.toggle("dialog-open", entityDialog.open || detailDialog.open); }

function openSupplierStockBulkAddForm() {
  if (!has(CAPABILITIES.supplierManage) && !has(CAPABILITIES.links)) return;
  const workspace = state.supplierWorkspace;
  const supplier = state.suppliers.find((item) => String(item.id) === String(workspace.supplierId) && item.active !== false);
  if (!supplier || workspace.loading) return;
  supplierStockBulk = { supplierId: String(supplier.id), selected: new Set(), query: "", category: "", busy: false, pending: null };
  const categories = [...new Set(getSupplierBulkStockProducts().map((item) => item.category).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "tr"));
  openEntityDialog({
    mode: "supplier-stock-bulk-add", entityId: supplier.id,
    kicker: "STOKTAN TOPLU EKLE", title: `${supplier.name} · Stoktan Ürün Seç`,
    description: "Stoktaki mevcut ürünleri seçerek bu tedarikçiye toplu ürün kalemi ekleyin.",
    submitLabel: "Seçilenleri Ekle", submitDisabled: true,
    body: `<div class="supplier-stock-bulk">
      <div class="supplier-stock-bulk__toolbar">
        <label class="supplier-stock-bulk__search"><span class="sr-only">Stok ürünü ara</span><input class="toolbar-control" id="supplier-stock-bulk-search" type="search" placeholder="Stok ürünü ara…" autocomplete="off"></label>
        <label class="supplier-stock-bulk__categories"><span class="sr-only">Kategori</span><select class="toolbar-control" id="supplier-stock-bulk-category"><option value="">Tüm kategoriler</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select></label>
      </div>
      <div class="supplier-stock-bulk__selection"><label><input type="checkbox" data-supplier-bulk-all><span>Tümünü Seç</span></label><small>Tek işlemde en fazla 200 ürün</small></div>
      <p class="supplier-stock-bulk__summary" id="supplier-stock-bulk-summary" aria-live="polite"></p>
      <div class="supplier-stock-bulk__list" id="supplier-stock-bulk-list" role="group" aria-label="Stok ürünleri" tabindex="0"></div>
    </div>`
  });
  renderSupplierStockBulkDialogState();
  document.getElementById("supplier-stock-bulk-search")?.focus();
}

function getSupplierBulkStockProducts(filtered = true) {
  if (!supplierStockBulk) return [];
  const workspace = state.supplierWorkspace;
  const linked = new Set([...(workspace.independentProducts || []), ...(workspace.productLinks || [])]
    .filter((item) => String(item.supplierId) === supplierStockBulk.supplierId && item.active !== false && !item.archivedAt && !item.removedAt)
    .map((item) => String(item.stockProductId || "")));
  const seen = new Set();
  const query = normalizeComboText(supplierStockBulk.query);
  return (state.context?.stockProducts || []).filter((product) => {
    const id = String(product.id || "");
    if (!id || seen.has(id) || product.active === false || product.sourcePresent === false || product.trashed === true
      || product.archivedAt || product.removedAt || product.deletedAt || product.purgedAt) return false;
    seen.add(id);
    return true;
  }).map((product) => {
    const id = String(product.id);
    const baseUnit = String(product.baseUnit || product.unit || "").trim();
    const bulkUnit = String(product.bulkUnit || product.caseUnit || "").trim();
    const factor = Number(product.unitsPerBulkUnit || product.unitsPerCase || 0);
    return {
      id, name: String(product.name || product.productName || "Stok ürünü"),
      productCode: String(product.productCode || ""), category: String(product.category || "").trim(),
      baseUnit, bulkUnit, factor,
      status: linked.has(id) ? "linked" : baseUnit && bulkUnit && Number.isFinite(factor) && factor > 0 ? "selectable" : "incomplete"
    };
  }).filter((item) => !filtered || ((!supplierStockBulk.category || item.category === supplierStockBulk.category)
    && (!query || normalizeComboText(`${item.name} ${item.productCode} ${item.category}`).includes(query))))
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

function renderSupplierStockBulkRows(products) {
  return products.length ? products.map((item) => {
    const selected = supplierStockBulk.selected.has(item.id);
    const status = { selectable: "Seçilebilir", linked: "Zaten ekli", incomplete: "Birim bilgisi eksik" }[item.status];
    const conversion = item.baseUnit && item.bulkUnit && Number.isFinite(item.factor) && item.factor > 0
      ? `1 ${item.bulkUnit} = ${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(item.factor)} ${item.baseUnit}` : "—";
    return `<label class="supplier-stock-bulk__row${selected ? " is-selected" : ""}${item.status === "selectable" ? "" : " is-disabled"}">
      <span class="supplier-stock-bulk__check"><input type="checkbox" data-supplier-bulk-product="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} seç"${selected ? " checked" : ""}${item.status !== "selectable" || supplierStockBulk.busy ? " disabled" : ""}></span>
      <span class="supplier-stock-bulk__identity"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.category || "Kategorisiz", item.productCode].filter(Boolean).join(" · "))}</small>${item.status === "incomplete" ? "<small>Önce stok ürününün birim yapısını tamamlayın.</small>" : ""}</span>
      <span class="supplier-stock-bulk__units"><small>Toplu birim</small><strong>${escapeHtml(item.bulkUnit || "—")}</strong></span>
      <span class="supplier-stock-bulk__units"><small>Temel birim</small><strong>${escapeHtml(item.baseUnit || "—")}</strong></span>
      <span class="supplier-stock-bulk__units supplier-stock-bulk__conversion"><small>Dönüşüm</small><strong>${escapeHtml(conversion)}</strong></span>
      <span class="supplier-stock-bulk__status">${status}</span>
    </label>`;
  }).join("") : '<p class="supplier-stock-bulk__empty">Filtreye uygun stok ürünü bulunamadı.</p>';
}

function updateSupplierStockBulkSubmitState() {
  if (!supplierStockBulk || entityForm.dataset.mode !== "supplier-stock-bulk-add") return;
  const count = supplierStockBulk.selected.size;
  const submit = document.getElementById("dialogSubmit");
  submit.disabled = supplierStockBulk.busy || count === 0 || count > 200;
  submit.textContent = supplierStockBulk.busy ? "Ekleniyor…" : `Seçilenleri Ekle${count ? ` (${count})` : ""}`;
  submit.setAttribute("aria-busy", String(supplierStockBulk.busy));
}

function renderSupplierStockBulkDialogState() {
  if (!supplierStockBulk || entityForm.dataset.mode !== "supplier-stock-bulk-add") return;
  if (String(state.supplierWorkspace.supplierId) !== supplierStockBulk.supplierId) {
    supplierStockBulk = null;
    return closeEntityDialog();
  }
  const allProducts = getSupplierBulkStockProducts(false);
  const selectableIds = new Set(allProducts.filter((item) => item.status === "selectable").map((item) => item.id));
  for (const id of supplierStockBulk.selected) if (!selectableIds.has(id)) supplierStockBulk.selected.delete(id);
  const products = getSupplierBulkStockProducts();
  const list = document.getElementById("supplier-stock-bulk-list");
  const scrollTop = list.scrollTop;
  const focusedId = document.activeElement?.dataset.supplierBulkProduct;
  list.innerHTML = renderSupplierStockBulkRows(products);
  list.scrollTop = scrollTop;
  if (focusedId) list.querySelector(`[data-supplier-bulk-product="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  const selectable = products.filter((item) => item.status === "selectable");
  const selectedVisible = selectable.filter((item) => supplierStockBulk.selected.has(item.id)).length;
  const selectAll = entityForm.querySelector("[data-supplier-bulk-all]");
  selectAll.checked = selectable.length > 0 && selectedVisible === selectable.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < selectable.length;
  selectAll.disabled = supplierStockBulk.busy || selectable.length === 0;
  document.getElementById("supplier-stock-bulk-search").disabled = supplierStockBulk.busy;
  document.getElementById("supplier-stock-bulk-category").disabled = supplierStockBulk.busy;
  document.getElementById("supplier-stock-bulk-summary").textContent = `${products.length} ${supplierStockBulk.query || supplierStockBulk.category ? "sonuç" : "stok ürünü"} · ${supplierStockBulk.selected.size} seçili · ${products.filter((item) => item.status === "linked").length} zaten ekli`;
  document.getElementById("dialogMessage").textContent = supplierStockBulk.selected.size > 200 ? "Bir işlemde en fazla 200 ürün ekleyebilirsiniz. Seçiminizi azaltın." : "";
  updateSupplierStockBulkSubmitState();
}

async function saveSupplierStockBulkAdd() {
  const draft = supplierStockBulk;
  if (!draft || draft.busy || draft.supplierId !== String(state.supplierWorkspace.supplierId)) throw new Error("Tedarikçi seçimi güncel değil.");
  if (!has(CAPABILITIES.supplierManage) && !has(CAPABILITIES.links)) throw new Error("Ürün yönetimi yetkiniz yok.");
  renderSupplierStockBulkDialogState();
  if (!draft.selected.size || draft.selected.size > 200) throw new Error("1 ile 200 arasında ürün seçin.");
  if (!draft.pending) draft.pending = {
    method: "POST", requestId: requestId("supplier-stock-bulk"), expectedRevision: state.revision,
    body: { items: [...draft.selected].map((stockProductId) => ({ stockProductId })) }
  };
  draft.busy = true;
  renderSupplierStockBulkDialogState();
  try {
    const payload = await api(`/suppliers/${encodeURIComponent(draft.supplierId)}/independent-products/bulk`, draft.pending);
    mutationComplete(payload, ["suppliers", "productAnalysis", "dashboard"]);
    draft.pending = null;
    draft.selected.clear();
    const parts = [`${Number(payload.createdCount || 0)} ürün eklendi`];
    if (payload.reactivatedCount) parts.push(`${Number(payload.reactivatedCount)} ürün yeniden aktifleştirildi`);
    const message = `${parts.join(", ")}.${payload.skippedCount ? ` ${Number(payload.skippedCount)} ürün zaten bağlı, kullanılamaz veya birim bilgisi eksik olduğu için atlandı.` : ""}`;
    return { supplierId: draft.supplierId, message, draft };
  } catch (error) {
    if (error.status >= 400 && error.status < 500) draft.pending = null;
    if (error.code === "PROCUREMENT_REVISION_CONFLICT") {
      if (Number.isInteger(error.payload?.actualRevision)) state.revision = Math.max(state.revision, error.payload.actualRevision);
      await loadSupplierWorkspaceData(draft.supplierId, true);
      renderActiveView();
    }
    throw error;
  } finally {
    draft.busy = false;
    if (supplierStockBulk === draft) {
      renderSupplierStockBulkDialogState();
    }
  }
}

function openSupplierForm(supplier = null) {
  openEntityDialog({ mode: supplier ? "supplier-edit" : "supplier-create", entityId: supplier && supplier.id, title: supplier ? "Tedarikçiyi düzenle" : "Tedarikçi Ekle", description: "Firma ve iletişim bilgilerini kaydedin.", submitLabel: "Kaydet", hideCancel: true, body: `<div class="form-grid supplier-simple-form"><label>Tedarikçi Firma Adı<input name="name" value="${escapeHtml(supplier && supplier.name || "")}" maxlength="180" required></label><label>Tedarikçinin Adı<input name="contactName" value="${escapeHtml(supplier && supplier.contactName || "")}" maxlength="180"></label><label>Tedarikçinin Tel No<input name="phone" value="${escapeHtml(supplier && supplier.phone || "")}" maxlength="40" inputmode="tel"></label></div>` });
}
function openLinkForm(link = null, options = {}) {
  if (typeof link === "string") link = state.productLinks.find((item) => item.id === link) || state.supplierWorkspace.productLinks.find((item) => item.id === link) || null;
  const supplierId = String(link && link.supplierId || options.supplierId || "");
  const supplier = state.suppliers.find((item) => String(item.id) === supplierId);
  const supplierField = options.supplierId
    ? `<label>Tedarikçi<input type="hidden" name="supplierId" value="${escapeHtml(supplierId)}"><input value="${escapeHtml(supplier && supplier.name || supplierId)}" readonly></label>`
    : comboField({ name: "supplierId", label: "Tedarikçi", selectedId: supplierId, required: true, items: state.suppliers.filter((item) => item.active !== false).map((item) => ({ id: item.id, label: `${item.name}${item.code ? ` · ${item.code}` : ""}` })) });
  const productField = comboField({ name: "stockProductId", label: "Stok ürünü", selectedId: link && link.stockProductId, required: true, items: (state.context.stockProducts || []).map((item) => ({ id: item.id, label: `${item.name} · ${item.productCode || "Kodsuz"}` })) });
  openEntityDialog({ mode: link ? "link-edit" : "link-create", entityId: link && link.id, title: link ? "Ürün eşleşmesini düzenle" : "Ürün eşleştir", description: "Canonical ürün kaynağı stockState.products olarak kalır.", submitLabel: "Eşleşmeyi kaydet", body: `<div class="form-grid">${supplierField}${productField}<label>Tedarikçi ürün adı<input name="supplierProductName" value="${escapeHtml(link && link.supplierProductName || "")}" maxlength="180"></label><label>Tedarikçi ürün kodu<input name="supplierProductCode" value="${escapeHtml(link && link.supplierProductCode || "")}" maxlength="100"></label><label>Satın alma birimi<input name="purchaseUnit" value="${escapeHtml(link && link.purchaseUnit || "")}" maxlength="40" required></label><label>Dönüşüm katsayısı<input name="conversionFactor" value="${Number(link && link.conversionFactor || 1)}" type="number" min="0.001" step="0.001" required></label><label>Varsayılan alış (₺)<input name="defaultPrice" value="${Number(link && link.defaultPurchasePriceKurus || 0) / 100}" type="number" min="0" step="0.01"></label><label>Son alış (₺)<input name="lastPrice" value="${Number(link && link.lastPurchasePriceKurus || 0) / 100}" type="number" min="0" step="0.01"></label><label class="check-field span-2"><input name="active" type="checkbox" ${!link || link.active !== false ? "checked" : ""}><span>Aktif eşleşme</span></label></div>` });
}

function openIndependentProductForm(itemId = "") {
  const supplierId = state.supplierWorkspace.supplierId;
  const item = state.supplierWorkspace.independentProducts.find((candidate) => String(candidate.id) === String(itemId)) || null;
  if (!supplierId) return;
  openEntityDialog({
    mode: item ? "independent-product-edit" : "independent-product-create",
    entityId: item && item.id,
    kicker: "ÜRÜN KAYDI OLUŞTUR",
    title: item ? "Ürün kaydını düzenle" : "Ürün Kaydı Oluştur",
    description: "Tedarikçi ürününün birim yapısını tanımlayın.",
    submitLabel: "Kaydet",
    hideCancel: true,
    body: `<input type="hidden" name="supplierId" value="${escapeHtml(supplierId)}"><div class="form-grid supplier-product-form">${supplierStockProductCombobox(item)}<label>Toplu Birim<select name="bulkUnit" required>${unitOptions("bulk", item && (item.bulkUnit || item.purchaseUnit))}</select></label><label>Temel Birim<select name="baseUnit" required ${item && item.stockProductId ? "disabled" : ""}>${unitOptions("base", item && item.baseUnit)}</select></label><label>Birim Çarpan Miktarı<input name="conversionFactor" value="${Number(item && item.conversionFactor || 1)}" type="number" min="0.001" step="0.001" required></label><output class="supplier-conversion-preview span-2" id="supplierConversionPreview">${conversionText(item && (item.bulkUnit || item.purchaseUnit), item && item.baseUnit, item && item.conversionFactor)}</output></div>`
  });
}

async function deleteIndependentProduct(button, itemId) {
  const item = state.supplierWorkspace.independentProducts.find((candidate) => String(candidate.id) === String(itemId));
  if (!item) return;
  if (!await confirmAction({
    title: "Ürün kaydını sil",
    description: "Bu ürün tedarikçinin aktif ürün listesinden silinecek. Devam edilsin mi?",
    confirmLabel: "Ürünü Sil",
    cancelLabel: "Vazgeç",
    danger: true
  })) return;
  const supplierId = state.supplierWorkspace.supplierId;
  await runButtonMutation(button, () => api(`/suppliers/${encodeURIComponent(supplierId)}/independent-products/${encodeURIComponent(itemId)}`, {
    method: "PUT", body: { active: false }, expectedRevision: state.revision
  }), ["suppliers", "productAnalysis", "dashboard"], async () => {
    await loadSupplierWorkspaceData(supplierId, true);
    renderActiveView();
  });
}

function openSupplierShipmentForm() {
  const supplierId = state.supplierWorkspace.supplierId;
  const supplier = state.suppliers.find((item) => String(item.id) === String(supplierId));
  const products = (state.supplierWorkspace.independentProducts || []).filter((item) => item.active !== false);
  const locations = (state.context.stockLocations || []).filter((item) => item.active !== false);
  if (!supplier || !products.length) return toast("Önce aktif bir tedarikçi ürünü ekleyin.", true);
  if (!locations.length) return toast("Sevkiyat için aktif bir hedef depo bulunamadı.", true);
  const defaultLocation = locations.find((item) => item.isDefault === true || item.default === true) || (locations.length === 1 ? locations[0] : null);
  openEntityDialog({
    mode: "supplier-shipment-create",
    entityId: supplierId,
    kicker: "TEDARİKÇİ SEVKİYATI",
    title: `${supplier.name} · Sevkiyat Oluştur`,
    description: "Toplu miktar ve toplam tutarı girin; temel birim fiyatı sunucu tarafından hesaplanır.",
    submitLabel: "Sevkiyatı Oluştur",
    hideCancel: true,
    submitDisabled: true,
    body: `<div class="supplier-shipment-form"><section class="supplier-shipment-products"><strong>ÜRÜNLER</strong><div class="supplier-shipment-lines" id="supplierShipmentLines">${products.map(supplierShipmentLine).join("")}</div></section><div class="supplier-shipment-meta"><label>Hedef Depo<select name="destinationLocationId" required><option value="">Depo seçin</option>${locations.map((location) => `<option value="${escapeHtml(location.id)}" ${defaultLocation && String(defaultLocation.id) === String(location.id) ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}</select></label><label>Sevkiyat Tarihi<input name="shipmentDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label></div><fieldset class="supplier-shipment-upload"><legend>Belge Ekle</legend><div class="supplier-shipment-upload__actions"><label class="ui-button ui-button--secondary">Dosya / Galeri Seç<input name="shipmentFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-describedby="supplierShipmentFileName"></label><label class="ui-button ui-button--secondary">Kamera ile Çek<input name="shipmentCameraFile" type="file" accept="image/*" capture="environment" aria-describedby="supplierShipmentFileName"></label></div><small>PDF, JPEG, PNG, WebP, HEIC veya HEIF. Belge olmadan sevkiyat oluşturulamaz.</small><span class="supplier-shipment-upload__name" id="supplierShipmentFileName">Belge seçilmedi</span></fieldset></div>`
  });
  updateSupplierShipmentSubmitState();
}

function updateSupplierShipmentSubmitState() {
  if (entityForm.dataset.mode !== "supplier-shipment-create") return;
  const file = selectedSupplierShipmentFile();
  const submit = document.getElementById("dialogSubmit");
  const fileName = document.getElementById("supplierShipmentFileName");
  if (fileName) fileName.textContent = file instanceof File && file.size > 0 ? file.name : "Belge seçilmedi";
  if (submit && !submit.hasAttribute("aria-busy")) submit.disabled = !(file instanceof File && file.size > 0);
}

function selectedSupplierShipmentFile() {
  return entityForm.elements.shipmentFile?.files?.[0] || entityForm.elements.shipmentCameraFile?.files?.[0] || null;
}

async function prepareImageForUpload(file) {
  if (!(file instanceof File) || file.size <= 2 * 1024 * 1024 || !/^image\/(?:jpeg|png|webp)$/i.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .84));
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "belge"}.jpg`, { type: "image/jpeg", lastModified: Date.now() }) : file;
  } catch (_error) {
    return file;
  }
}

function openSupplierShipmentStockDecision(shipment) {
  if (!shipment || !has(CAPABILITIES.receiptApprove)) return;
  const locations = (state.context.stockLocations || []).filter((item) => item.active !== false);
  const shipmentItems = Array.isArray(shipment.items) ? shipment.items : [];
  const matchedCount = shipmentItems.filter((item) => String(item.stockProductId || item.productId || item.stockProductCode || item.productCode || "").trim()).length;
  const unmatchedCount = shipmentItems.length - matchedCount;
  openEntityDialog({
    mode: "supplier-shipment-stock",
    entityId: shipment.id,
    kicker: "SEVKİYAT OLUŞTURULDU",
    title: "Sevkiyat stoğa eklensin mi?",
    description: unmatchedCount
      ? `${matchedCount} eşleşmiş ürün doğrudan işlenecek; ${unmatchedCount} legacy ürün “Kategorisizler” altında canonical stoğa bağlanıp aynı depoya eklenecek.`
      : "Evet derseniz seçilen hedef depoya tek seferlik stok girişi ve ardından tedarikçi cari borcu uygulanır.",
    cancelLabel: "Hayır",
    cancelAction: "decline-stock",
    submitLabel: "Evet, Stoğa Ekle",
    body: `<div class="form-grid"><label class="span-2">Hedef depo<select name="destinationLocationId" required><option value="">Depo seçin</option>${locations.map((location) => `<option value="${escapeHtml(location.id)}" ${String(location.id) === String(shipment.destinationLocationId || "") || (!shipment.destinationLocationId && locations.length === 1) ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}</select></label>${unmatchedCount ? '<p class="form-note span-2">Yeni ürünün birim yapısı tedarikçi ürünündeki temel birim, toplu birim ve çarpandan alınır.</p>' : ""}</div>`
  });
  const submit = document.getElementById("dialogSubmit");
  queueMicrotask(() => { submit.disabled = !shipmentItems.length || !locations.length; });
}

function openStockFailureAccountingDecision(shipmentId, message) {
  openEntityDialog({
    mode: "shipment-account-without-stock",
    entityId: shipmentId,
    kicker: "SEVKİYAT ARŞİVLENDİ",
    title: "Stok aktarımı tamamlanamadı",
    description: "Sevkiyat kaydı ve belgesi arşive kaydedildi. Bu sevkiyat Cari Hesaba borç olarak işlensin mi?",
    cancelLabel: "Hayır",
    submitLabel: "Cari Hesaba İşle",
    body: `<p class="application-dialog-copy">${escapeHtml(userFacingStockError(message))}</p>`
  });
}

function supplierShipmentLine(item) {
  const bulkUnit = item.bulkUnit || item.purchaseUnit || "toplu birim";
  const baseUnit = item.baseUnit || "adet";
  const factor = Number(item.conversionFactor || 1);
  return `<article class="supplier-shipment-line" data-supplier-shipment-line data-product-id="${escapeHtml(item.id)}"><label class="supplier-shipment-select"><input type="checkbox" data-supplier-line-enabled><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(conversionText(bulkUnit, baseUnit, factor))}</small></span></label><label>Miktar (${escapeHtml(bulkUnit)})<input data-supplier-line-quantity type="number" min="0.001" step="0.001" disabled></label><label>Toplam (₺)<input data-supplier-line-total type="number" min="0.01" step="0.01" disabled></label></article>`;
}

function unitOptions(kind, selected = "") {
  const configured = state.context && state.context.unitDefinitions && state.context.unitDefinitions[kind];
  const fromProducts = (state.context.stockProducts || []).flatMap((item) => kind === "bulk" ? [item.bulkUnit] : [item.baseUnit || item.unit]);
  const fallback = kind === "bulk" ? ["koli","kasa","paket","kutu","çuval","rulo"] : ["adet","şişe","litre","ml","kg","g","metre","porsiyon","bardak","çift","set"];
  const values = [...new Set([...(Array.isArray(configured) ? configured.map((item) => item.name || item.value || item) : []), ...fromProducts, ...fallback].map((item) => String(item || "").trim()).filter(Boolean))];
  return values.map((item) => `<option value="${escapeHtml(item)}" ${String(item) === String(selected) ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
}

function conversionText(bulkUnit = "koli", baseUnit = "adet", factor = 1) {
  return `1 ${bulkUnit || "toplu birim"} = ${Number(factor || 1)} ${baseUnit || "temel birim"}`;
}
function openShipmentForm() { openEntityDialog({ mode: "shipment-create", title: "Yeni mal kabul", description: "Kayıt canonical workforceShipments koleksiyonuna yazılır.", submitLabel: "Mal kabulü kaydet", body: shipmentFormBody() }); }
function openDocumentForm(shipmentId = "") { openEntityDialog({ mode: "document-upload", entityId: shipmentId, title: "Özel belge yükle", description: "Dosya private depoda tutulur; stok ve cari otomatik etkilenmez.", submitLabel: "Belgeyi güvenli yükle", body: documentFormBody(shipmentId) }); }
function openPaymentForm() { openEntityDialog({ mode: "payment-create", title: "Tedarikçi ödemesi", description: "Ödeme stoktan bağımsız pozitif cari harekettir.", submitLabel: "Ödemeyi kaydet", body: paymentFormBody() }); }
function openLedgerEntryForm() { openEntityDialog({ mode: "ledger-create", title: "Bağımsız cari hareket", description: "Mali geçmiş düzenlenmez; gerekirse ters kayıtla dengelenir.", submitLabel: "Cari hareketi kaydet", body: ledgerEntryFormBody() }); }
async function openUserAccess(userId) {
  try { await loadUsers(true); } catch (_error) {}
  const user = state.users.find((item) => item.id === userId);
  if (!user) return toast("Personel yetkileri güncellenemedi.", true);
  openEntityDialog({ mode: "user-access", entityId: user.id, title: `${user.name} · yetkiler`, description: "Yeni kullanıcı veya parola oluşturulmaz; mevcut personel hesabı kullanılır.", submitLabel: "Yetkileri kaydet", hideCancel: true, body: userAccessFormBody(user) });
  updateAllPermissionSectionCards();
}

async function submitEntityForm(event) {
  event.preventDefault();
  const submit = document.getElementById("dialogSubmit");
  if (submit.disabled) return;
  const mode = entityForm.dataset.mode;
  if (mode !== "supplier-stock-bulk-add") setBusy(submit, true, "Kaydediliyor…");
  const data = new FormData(entityForm);
  let deferredStockFailure = null;
  let completionMessage = "İşlem backend tarafından kaydedildi.";
  let completionError = false;
  try {
    let followUpShipment = null;
    if (mode === "supplier-create" || mode === "supplier-edit") await saveSupplier(mode, data);
    else if (mode === "supplier-stock-bulk-add") {
      const result = await saveSupplierStockBulkAdd();
      if (supplierStockBulk === result.draft) closeEntityDialog();
      toast(result.message);
      try {
        if (String(state.supplierWorkspace.supplierId) === result.supplierId) {
          await loadSupplierWorkspaceData(result.supplierId, true);
          renderActiveView();
        }
      } catch (error) { toast(error.message || "Tedarikçi ürünleri yenilenemedi.", true); }
      return;
    }
    else if (mode === "link-create" || mode === "link-edit") await saveLink(mode, data);
    else if (mode === "shipment-create") await saveShipment(data);
    else if (mode === "document-upload") await saveDocument(data);
    else if (mode === "payment-create") await savePayment(data);
    else if (mode === "ledger-create") await saveLedgerEntry(data);
    else if (mode === "user-access") await saveUserAccess(data);
    else if (mode === "shipment-account") await saveShipmentAccounting(data);
    else if (mode === "independent-product-create" || mode === "independent-product-edit") await saveIndependentProduct(mode, data);
    else if (mode === "supplier-shipment-create") followUpShipment = await saveSupplierShipment(data);
    else if (mode === "supplier-shipment-stock") {
      const payload = await saveSupplierShipmentStock(data);
      if (payload.accountingStatus === "failed") {
        completionMessage = payload.accountingMessage || "Stok işlendi; cari kayıt tamamlanamadı.";
        completionError = true;
      }
    }
    else if (mode === "shipment-account-without-stock") await saveShipmentWithoutStockAccounting(data);
    closeEntityDialog();
    toast(completionMessage, completionError);
    await setView(state.activeView, { force: true });
    if (followUpShipment) openSupplierShipmentStockDecision(followUpShipment);
  } catch (error) {
    const controlledStockFailure = mode === "supplier-shipment-stock"
      && (error.payload?.stockStatus === "failed" || error.payload?.shipment?.stockStatus === "failed");
    if (controlledStockFailure) {
      updateRevision(error.payload || {});
      deferredStockFailure = { shipmentId: entityForm.dataset.entityId, message: error.message };
    }
    else document.getElementById("dialogMessage").textContent = error.message || "İşlem tamamlanamadı.";
  } finally { if (mode !== "supplier-stock-bulk-add") setBusy(submit, false); updateSupplierShipmentSubmitState(); updateSupplierStockBulkSubmitState(); }
  if (deferredStockFailure) {
    closeEntityDialog();
    openStockFailureAccountingDecision(deferredStockFailure.shipmentId, deferredStockFailure.message);
  }
}

async function saveSupplier(mode, data) {
  const body = { name: value(data,"name"), contactName: value(data,"contactName"), phone: value(data,"phone") };
  const id = entityForm.dataset.entityId;
  const payload = await api(mode === "supplier-create" ? "/suppliers" : `/suppliers/${encodeURIComponent(id)}`, { method: mode === "supplier-create" ? "POST" : "PUT", body, expectedRevision: state.revision });
  mutationComplete(payload, ["suppliers","productAnalysis","dashboard"]);
}
async function saveLink(mode, data) {
  const body = { supplierId: value(data,"supplierId"), stockProductId: value(data,"stockProductId"), supplierProductName: value(data,"supplierProductName"), supplierProductCode: value(data,"supplierProductCode"), purchaseUnit: value(data,"purchaseUnit"), conversionFactor: Number(value(data,"conversionFactor") || 1), defaultPurchasePriceKurus: integerKurus(value(data,"defaultPrice")), lastPurchasePriceKurus: integerKurus(value(data,"lastPrice")), active: data.get("active") === "on" };
  const id = entityForm.dataset.entityId;
  const payload = await api(mode === "link-create" ? "/product-links" : `/product-links/${encodeURIComponent(id)}`, { method: mode === "link-create" ? "POST" : "PUT", body, expectedRevision: state.revision });
  mutationComplete(payload, ["links","suppliers","dashboard"]);
}
async function saveIndependentProduct(mode, data) {
  const supplierId = value(data, "supplierId") || state.supplierWorkspace.supplierId;
  const itemId = entityForm.dataset.entityId;
  const existing = state.supplierWorkspace.independentProducts.find((item) => String(item.id) === String(itemId));
  const productMode = String(entityForm.elements.stockProductMode?.value || "");
  const stockProductId = String(entityForm.elements.stockProductId?.value || "");
  const selectedProduct = (state.context.stockProducts || []).find((item) => String(item.id) === stockProductId);
  const name = String(entityForm.querySelector("[data-supplier-product-search]")?.value || "").trim();
  const bulkUnit = String(entityForm.elements.bulkUnit?.value || "").trim();
  const baseUnit = selectedProduct
    ? String(selectedProduct.baseUnit || selectedProduct.unit || "adet")
    : String(entityForm.elements.baseUnit?.value || "").trim();
  const conversionFactor = Number(entityForm.elements.conversionFactor?.value || 0);
  if (!name) throw new Error("Ürün adı zorunludur.");
  if (mode === "independent-product-create" && !selectedProduct && productMode !== "new") {
    throw new Error("Mevcut bir stok ürünü seçin veya + Yeni ürün seçeneğini kullanın.");
  }
  const body = {
    name: selectedProduct ? String(selectedProduct.name || name) : name,
    bulkUnit,
    baseUnit,
    purchaseUnit: bulkUnit,
    conversionFactor,
    stockProductId: selectedProduct ? String(selectedProduct.id) : existing && productMode !== "new" ? String(existing.stockProductId || "") : "",
    active: existing ? existing.active !== false : true
  };
  if (productMode === "new") {
    body.newStockProduct = { name, bulkUnit, baseUnit, unitsPerBulkUnit: conversionFactor };
  }
  const endpoint = mode === "independent-product-create"
    ? `/suppliers/${encodeURIComponent(supplierId)}/independent-products`
    : `/suppliers/${encodeURIComponent(supplierId)}/independent-products/${encodeURIComponent(itemId)}`;
  const payload = await api(endpoint, { method: mode === "independent-product-create" ? "POST" : "PUT", body, expectedRevision: state.revision });
  if (payload.stockProduct) {
    state.context.stockProducts = [...(state.context.stockProducts || []).filter((item) => String(item.id) !== String(payload.stockProduct.id)), payload.stockProduct]
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "tr"));
  }
  mutationComplete(payload, ["suppliers","productAnalysis","dashboard","stock-references","stock"]);
}

async function saveSupplierShipment(data) {
  const supplierId = entityForm.dataset.entityId || state.supplierWorkspace.supplierId;
  const products = new Map((state.supplierWorkspace.independentProducts || []).map((item) => [String(item.id), item]));
  const selectedRows = [...document.querySelectorAll("[data-supplier-shipment-line]")].filter((row) => row.querySelector("[data-supplier-line-enabled]")?.checked);
  if (!selectedRows.length) throw new Error("En az bir ürün seçin.");
  const selectedFile = selectedSupplierShipmentFile();
  const file = await prepareImageForUpload(selectedFile);
  if (!(file instanceof File) || file.size <= 0) throw new Error("Sevkiyat oluşturmak için belge ekleyin.");
  const documentType = "irsaliye";
  const destinationLocationId = value(data, "destinationLocationId");
  if (!destinationLocationId) throw new Error("Hedef depo seçin.");
  const items = selectedRows.map((row) => {
    const product = products.get(String(row.dataset.productId));
    const quantityBulk = Number(row.querySelector("[data-supplier-line-quantity]").value);
    const lineTotalKurus = integerKurus(row.querySelector("[data-supplier-line-total]").value);
    return { supplierProductId: product.id, supplierProductName: product.name, stockProductId: product.stockProductId || "", quantity: quantityBulk, quantityBulk, unit: product.bulkUnit || product.purchaseUnit, purchaseUnit: product.bulkUnit || product.purchaseUnit, bulkUnit: product.bulkUnit || product.purchaseUnit, baseUnit: product.baseUnit, conversionFactor: Number(product.conversionFactor || 1), totalKurus: lineTotalKurus, unitPriceKurus: quantityBulk > 0 ? Math.round(lineTotalKurus / quantityBulk) : 0 };
  });
  let payload = await api("/shipments", { method: "POST", body: { supplierId, destinationLocationId, shipmentDate: value(data,"shipmentDate"), documentDate: value(data,"shipmentDate"), documentType, finalized: true, items }, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","dashboard","documents","productAnalysis"]);
  const shipmentId = payload.shipment.id;
  const documentPayload = await uploadDocument(file, { documentType, supplierId, shipmentIds: [shipmentId], documentDate: value(data,"shipmentDate") }, state.revision);
  mutationComplete(documentPayload, ["documents","shipments","dashboard"]);
  payload = await api(`/shipments/${encodeURIComponent(shipmentId)}/submit`, { method: "POST", body: {}, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","dashboard","documents","productAnalysis"]);
  return payload.shipment;
}

async function saveSupplierShipmentStock(data) {
  const shipmentId = entityForm.dataset.entityId;
  const destinationLocationId = value(data, "destinationLocationId");
  if (!shipmentId || !destinationLocationId) throw new Error("Stoğa işlemek için hedef depo seçin.");
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}/approve-stock`, { method: "POST", body: { destinationLocationId, note: "Tedarikçi sevkiyatından stok girişi" }, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","dashboard","stock","documents","productAnalysis","ledger","suppliers"]);
  return payload;
}
async function saveShipmentWithoutStockAccounting() {
  const shipmentId = entityForm.dataset.entityId;
  if (!shipmentId) throw new Error("Sevkiyat kaydı bulunamadı.");
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}/account-without-stock`, { method: "POST", body: { note: "Stok aktarımı başarısız olduktan sonra kullanıcı onayıyla cari borç" }, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","documents","dashboard","ledger","suppliers"]);
  return payload;
}
async function declineSupplierShipmentStock(button) {
  const shipmentId = entityForm.dataset.entityId;
  if (!shipmentId || button.disabled) return;
  setBusy(button, true, "Kaydediliyor…");
  try {
    const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}/decline-stock`, { method: "POST", body: {}, expectedRevision: state.revision });
    mutationComplete(payload, ["shipments","documents","dashboard"]);
    closeEntityDialog();
    toast("Sevkiyat arşivlendi; stok ve cari hareketi oluşturulmadı.");
    await setView(state.activeView, { force: true });
  } catch (error) {
    document.getElementById("dialogMessage").textContent = error.message || "Sevkiyat kararı kaydedilemedi.";
  } finally { setBusy(button, false); }
}
async function saveShipment(data) {
  const items = [...document.querySelectorAll("#shipmentLines .shipment-line")].map((line) => ({ stockProductId: line.querySelector('[name="stockProductId"]').value, quantity: Number(line.querySelector('[name="quantity"]').value), unit: line.querySelector('[name="unit"]').value.trim(), unitPriceKurus: integerKurus(line.querySelector('[name="unitPrice"]').value), taxKurus: 0 }));
  let payload = await api("/shipments", { method: "POST", body: { supplierId: value(data,"supplierId"), destinationLocationId: value(data,"destinationLocationId"), documentType: value(data,"documentType"), documentNumber: value(data,"documentNumber"), documentDate: value(data,"documentDate"), note: value(data,"note"), items }, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","dashboard"]);
  if (data.get("submitNow") === "1") {
    payload = await api(`/shipments/${encodeURIComponent(payload.shipment.id)}/submit`, { method: "POST", body: {}, expectedRevision: state.revision });
    mutationComplete(payload, ["shipments","dashboard"]);
  }
}
async function saveDocument(data) {
  const file = data.get("file");
  const payload = await uploadDocument(file, { documentType: value(data,"documentType"), supplierId: value(data,"supplierId"), shipmentIds: value(data,"shipmentId") ? [value(data,"shipmentId")] : [], documentNumber: value(data,"documentNumber"), documentDate: value(data,"documentDate") }, state.revision);
  mutationComplete(payload, ["documents","shipments","dashboard"]);
}
async function savePayment(data) {
  const supplierId = value(data,"supplierId");
  const paymentDate = value(data,"paymentDate");
  const file = data.get("paymentFile");
  if (!(file instanceof File) || file.size <= 0) throw new Error("Dekont veya fatura belgesi seçin.");
  const documentPayload = await uploadDocument(file, { documentType: "diğer", supplierId, documentDate: paymentDate }, state.revision);
  mutationComplete(documentPayload, ["documents"]);
  const payload = await api("/payments", { method: "POST", body: { supplierId, amountKurus: integerKurus(value(data,"amount")), paymentDate, documentId: documentPayload.document && documentPayload.document.id || "", note: value(data,"note") }, expectedRevision: state.revision });
  mutationComplete(payload, ["ledger","suppliers","dashboard","documents"]);
}
async function saveLedgerEntry(data) {
  const amount = integerKurus(value(data,"amount"));
  const payload = await api("/ledger", { method: "POST", body: { supplierId: value(data,"supplierId"), type: value(data,"type"), amountKurus: value(data,"direction") === "debt" ? -amount : amount, dueDate: value(data,"dueDate"), sourceId: value(data,"sourceId"), note: value(data,"note") }, expectedRevision: state.revision });
  mutationComplete(payload, ["ledger","suppliers","dashboard"]);
}
async function saveUserAccess(data) {
  const accessEnabled = data.get("faturaAccess") === "on";
  const sectionAccess = {};
  entityForm.querySelectorAll("[data-section-card]").forEach((card) => {
    const sectionId = String(card.dataset.sectionCard || "");
    const enabled = Boolean(card.querySelector("[data-section-toggle]")?.checked);
    const selectedLevel = card.querySelector('input[type="radio"]:checked')?.value || "view";
    if (sectionId) sectionAccess[sectionId] = enabled ? selectedLevel : "off";
  });
  const payload = await api(`/users/${encodeURIComponent(entityForm.dataset.entityId)}/access`, { method: "PUT", body: { faturaAccessEnabled: accessEnabled, faturaTemplate: value(data,"accessTemplate") || "ozel", faturaRole: value(data,"faturaRole") || "özel", faturaSectionAccess: sectionAccess }, expectedRevision: state.revision });
  mutationComplete(payload, ["users"]);
}
async function saveShipmentAccounting(data) {
  const shipmentId = entityForm.dataset.entityId;
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}/account`, { method: "POST", body: { documentId: value(data,"documentId"), amountKurus: integerKurus(value(data,"amount")), dueDate: value(data,"dueDate"), note: value(data,"note") }, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","ledger","suppliers","dashboard"]);
}

async function openSupplier(id, options = {}) {
  const supplier = state.suppliers.find((item) => String(item.id) === String(id)); if (!supplier) return;
  if (supplierStockBulk && supplierStockBulk.supplierId !== String(id)) { supplierStockBulk = null; closeEntityDialog(); }
  const workspace = state.supplierWorkspace;
  if (!workspace.supplierId) workspace.returnScrollY = window.scrollY;
  workspace.supplierId = String(id);
  workspace.productLinks = [];
  workspace.independentProducts = [];
  const historyState = { ...(history.state || {}), faturaView: "suppliers", supplierId: workspace.supplierId };
  if (options.fromPopstate !== true) {
    if (history.state && history.state.faturaView === "suppliers" && String(history.state.supplierId || "") === workspace.supplierId) history.replaceState(historyState, "", "/fatura/");
    else history.pushState(historyState, "", "/fatura/");
  }
  renderActiveView();
  try { await loadSupplierWorkspaceData(workspace.supplierId, true); renderActiveView(); }
  catch (error) { workspace.loading = false; renderActiveView(); toast(error.message || "Tedarikçi ürünleri alınamadı.", true); }
}

function closeSupplierWorkspace(options = {}) {
  if (supplierStockBulk) { supplierStockBulk = null; closeEntityDialog(); }
  const scrollY = state.supplierWorkspace.returnScrollY || 0;
  state.supplierWorkspace = { supplierId: "", productLinks: [], independentProducts: [], loading: false, returnScrollY: 0 };
  if (!options.fromPopstate) history.replaceState({ ...(history.state || {}), faturaView: "suppliers", supplierId: "" }, "", "/fatura/");
  renderActiveView();
  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" }));
}

async function handleAppPopstate() {
  if (!state.context) return;
  const url = new URL(location.href);
  const historyView = history.state && history.state.faturaView;
  const view = historyView || url.searchParams.get("view") || "dashboard";
  if (!visibleViews.some((item) => item.id === view)) return;
  if (view !== state.activeView) await setView(view, { fromPopstate: true });
  if (view === "stock") return;
  if (view === "suppliers") {
    const supplierId = String(history.state && history.state.supplierId || url.searchParams.get("supplierId") || "");
    if (supplierId && supplierId !== state.supplierWorkspace.supplierId) await openSupplier(supplierId, { fromPopstate: true });
    else if (!supplierId && state.supplierWorkspace.supplierId) closeSupplierWorkspace({ fromPopstate: true });
  }
}

function handleSupplierWorkspaceAction(button, action) {
  const id = state.supplierWorkspace.supplierId;
  const supplier = state.suppliers.find((item) => String(item.id) === String(id));
  if (!supplier) return;
  if (action === "edit") return openSupplierForm(supplier);
  if (action === "delete") return deactivateSupplier(button, id);
  if (action === "ledger") { state.filters.ledgerSupplier = id; return setView("ledger"); }
}

async function openShipment(id) {
  try {
    const payload = await api(`/shipments/${encodeURIComponent(id)}`, { dedupe:false }); updateRevision(payload); state.detail = { type:"shipment", id, payload };
    document.getElementById("detailKicker").textContent = "SEVKİYAT ARŞİVİ"; document.getElementById("detailTitle").textContent = payload.shipment.supplier && payload.shipment.supplier.name || payload.shipment.userName || "Sevkiyat"; document.getElementById("detailDescription").textContent = `${payload.shipment.id} · ${payload.shipment.items.length} ürün kalemi`;
    document.getElementById("detailBody").innerHTML = shipmentArchiveDetail(payload.shipment, payload.documents);
    if (!detailDialog.open) detailDialog.showModal(); document.body.classList.add("dialog-open");
  } catch (error) { toast(error.message, true); }
}

async function openDocument(id) {
  try {
    const documentMeta = state.documents.find((item) => item.id === id);
    const blob = await api(`/documents/${encodeURIComponent(id)}/content`, { responseType:"blob", dedupe:false });
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = URL.createObjectURL(blob); state.detail = { type:"document", id, document: documentMeta };
    const mimeType = String(blob.type || documentMeta && documentMeta.mimeType || "").toLowerCase();
    const isPdf = mimeType === "application/pdf";
    const fileName = documentMeta && documentMeta.originalName || (isPdf ? "belge.pdf" : "belge");
    document.getElementById("detailKicker").textContent = "ÖZEL BELGE"; document.getElementById("detailTitle").textContent = documentMeta && (documentMeta.documentNumber || documentMeta.originalName) || "Belge"; document.getElementById("detailDescription").textContent = "İçerik yetki kontrolünden sonra yüklendi; public media yolu kullanılmadı.";
    document.getElementById("detailBody").innerHTML = `${isPdf ? `<iframe class="document-preview document-preview--pdf" src="${escapeHtml(currentObjectUrl)}#toolbar=1" title="PDF belge önizlemesi" sandbox referrerpolicy="no-referrer"></iframe>` : `<img class="document-preview" src="${escapeHtml(currentObjectUrl)}" alt="Belge önizlemesi">`}<div class="detail-actions detail-actions--spaced"><a class="ui-button ui-button--secondary" href="${escapeHtml(currentObjectUrl)}" download="${escapeHtml(fileName)}">Belgeyi İndir</a>${documentMeta && !documentMeta.archivedAt && has(CAPABILITIES.documentsArchive) ? '<button class="ui-button ui-button--danger" data-detail-action="archive-document">Belgeyi arşivle</button>' : ""}</div>`;
    if (!detailDialog.open) detailDialog.showModal(); document.body.classList.add("dialog-open");
  } catch (error) { toast(error.message, true); }
}

async function handleDetailAction(button, action) {
  const detail = state.detail || {};
  if (action === "edit-supplier") { const supplier = state.suppliers.find((item) => item.id === detail.id); closeDetailDialog(); return openSupplierForm(supplier); }
  if (action === "deactivate-supplier") return deactivateSupplier(button, detail.id);
  if (action === "supplier-ledger") { state.filters.ledgerSupplier = detail.id; closeDetailDialog(); return setView("ledger"); }
  if (action === "approve-stock") return approveStock(button, detail.id);
  if (action === "reject-shipment") return rejectShipment(button, detail.id);
  if (action === "delete-shipment") return deleteShipment(button, detail.id);
  if (action === "remove-shipment") return removeShipment(button, detail.id);
  if (action === "submit-shipment") return submitShipment(button, detail.id);
  if (action === "account-shipment") return openAccountingForm(detail.payload);
  if (action === "upload-shipment-document") { closeDetailDialog(); return openDocumentForm(detail.id); }
  if (action === "archive-document") return archiveDocument(button, detail.id);
}

async function deactivateSupplier(button, id) {
  if (!await confirmAction({
    title: "Tedarikçiyi sil",
    description: "Bu tedarikçi aktif tedarikçi listesinden kaldırılacak. Geçmiş sevkiyat ve muhasebe kayıtları korunacaktır.",
    confirmLabel: "Tedarikçiyi Sil",
    danger: true
  })) return;
  await runButtonMutation(button, () => api(`/suppliers/${encodeURIComponent(id)}/deactivate`, { method:"POST", body:{reason:"Kullanıcı tarafından aktif listeden kaldırıldı"}, expectedRevision:state.revision }), ["suppliers","dashboard"], async () => { closeDetailDialog(); closeSupplierWorkspace(); await setView("suppliers", {force:true}); });
}
async function approveStock(button, id) {
  if (!await confirmAction({ title: "Stok onayı", description: "Stok yalnız bir kez artırılacak; başarılı olursa sevkiyat tutarı tedarikçi cari hesabına otomatik borç yazılacak.", confirmLabel: "Onayla ve stoğa ekle" })) return;
  const destinationLocationId = document.getElementById("shipmentDestinationLocation")?.value || state.detail?.payload?.shipment?.destinationLocationId || "";
  if (!destinationLocationId) return toast("Stok onayı için hedef depo seçin.", true);
  if (button.disabled) return;
  setBusy(button, true, "İşleniyor…");
  try {
    const payload = await api(`/shipments/${encodeURIComponent(id)}/approve-stock`, { method:"POST", body:{destinationLocationId,note:"Tahmisçi Fatura stok onayı"}, expectedRevision:state.revision });
    mutationComplete(payload, ["shipments","documents","stock","dashboard","ledger","suppliers"]);
    closeDetailDialog();
    toast(payload.accountingStatus === "failed" ? payload.accountingMessage || "Stok işlendi; cari kayıt tamamlanamadı." : "Stok ve cari hareketi tamamlandı.", payload.accountingStatus === "failed");
    await setView("documents", { force:true });
  } catch (error) {
    const controlledFailure = error.payload?.stockStatus === "failed" || error.payload?.shipment?.stockStatus === "failed";
    if (!controlledFailure) return toast(error.message || "Stok işlemi tamamlanamadı.", true);
    updateRevision(error.payload || {});
    invalidate(["shipments","documents","dashboard","stock"]);
    closeDetailDialog();
    openStockFailureAccountingDecision(id, error.message);
  } finally {
    setBusy(button, false);
  }
}
async function rejectShipment(button, id) {
  const reason = await requestText({ title: "Mal kabulünü reddet", description: "Bu kayıt reddedilecek. Gerekçeyi yazın.", label: "Red nedeni", confirmLabel: "Reddet", danger: true }); if (reason === null) return;
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/reject`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["shipments","documents","dashboard"], async () => { closeDetailDialog(); await setView("documents", {force:true}); });
}
async function deleteShipment(button, id) {
  if (!await confirmShipmentDeletion()) return;
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}`, { method:"DELETE", body:{}, expectedRevision:state.revision }), ["shipments","documents","dashboard","stock"], async () => { closeDetailDialog(); await setView("documents", {force:true}); });
}
async function removeShipment(button, id) {
  const reason = await requestText({ title: "Sevkiyatı kaldır", description: "Stok ve cari etkileri geçmiş silinmeden ters hareketlerle dengelenecek.", label: "Kaldırma nedeni", value: "", confirmLabel: "Kaldır", danger: true });
  if (reason === null) return;
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/remove`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["shipments","documents","dashboard","stock","ledger","suppliers","trash"], async () => { if (detailDialog.open) closeDetailDialog(); await setView(state.activeView === "trash" ? "trash" : "documents", {force:true}); });
}
async function removePayment(button, id) {
  const reason = await requestText({ title: "Ödemeyi kaldır", description: "Ödeme silinmez; cari hesapta ters kayıt oluşturulur.", label: "Kaldırma nedeni", value: "", confirmLabel: "Kaldır", danger: true });
  if (reason === null) return;
  await runButtonMutation(button, () => api(`/payments/${encodeURIComponent(id)}/reverse`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["ledger","suppliers","dashboard","trash"], () => setView("ledger", {force:true}));
}
async function purgeTrashRecord(button, type, id) {
  if (!await confirmAction({ title: "Kalıcı silinsin mi?", description: "Bu kayıt Çöp Kutusu'ndan kalıcı olarak silinecek ve geri alınamayacak.", confirmLabel: "Kalıcı Sil", danger: true })) return;
  const stockProduct = type === "stock-product";
  const operation = stockProduct
    ? () => api(`/stock/catalog/products/${encodeURIComponent(id)}/purge`, {
      method: "POST",
      body: { expectedCatalogRevision: state.revisions.catalog, expectedInventoryRevision: state.revisions.inventory },
      expectedCatalogRevision: state.revisions.catalog,
      expectedInventoryRevision: state.revisions.inventory
    })
    : () => api(`/trash/${encodeURIComponent(type)}/${encodeURIComponent(id)}/purge`, { method:"POST", body:{}, expectedRevision:state.revision });
  await runButtonMutation(button, operation, stockProduct ? ["trash","stock-references"] : ["trash","shipments","documents","ledger","suppliers","dashboard"], () => {
    state.trash = (state.trash || []).filter((record) => !(String(record.type) === String(type) && String(record.id) === String(id)));
    if (stockProduct) invalidateStockState();
    renderActiveView();
  });
}

async function restoreTrashRecord(button, type, id) {
  if (type !== "stock-product") return;
  await runButtonMutation(button, () => api(`/stock/catalog/products/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    body: { expectedCatalogRevision: state.revisions.catalog, expectedInventoryRevision: state.revisions.inventory },
    expectedCatalogRevision: state.revisions.catalog,
    expectedInventoryRevision: state.revisions.inventory
  }), ["trash","stock-references"], () => {
    state.trash = (state.trash || []).filter((record) => !(String(record.type) === String(type) && String(record.id) === String(id)));
    invalidateStockState();
    renderActiveView();
    toast("Stok ürünü aynı kimlikle geri alındı.");
  });
}
async function exportLedger(button) {
  if (button.disabled) return;
  setBusy(button, true, "Hazırlanıyor…");
  try {
    const file = await downloadExport("ledger", {
      supplierId: state.filters.ledgerSupplier || "",
      date: state.filters.ledgerDate || ""
    });
    const objectUrl = URL.createObjectURL(file.blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = file.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast("Excel çıktısı hazırlandı.");
  } catch (error) {
    toast(error.message || "Excel çıktısı hazırlanamadı.", true);
  } finally {
    setBusy(button, false);
  }
}
function confirmShipmentDeletion() { return confirmAction({ title: "Mal kabul kaydını sil", description: "Bu taslak kayıt kalıcı olarak silinecek.", confirmLabel: "Evet, sil", danger: true }); }
async function submitShipment(button, id) {
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/submit`, { method:"POST", body:{}, expectedRevision:state.revision }), ["shipments","documents","productAnalysis","dashboard"], async () => { closeDetailDialog(); await setView("documents", {force:true}); });
}
function openAccountingForm(payload) {
  const shipment = payload.shipment; const total = (shipment.items || []).reduce((sum,item)=>sum+Number(item.totalKurus||0),0);
  closeDetailDialog(); openEntityDialog({ mode:"shipment-account", entityId:shipment.id, title:"Sevkiyatı muhasebeleştir", description:"Bu işlem stok miktarını değiştirmez; cari borç oluşturur.", submitLabel:"Muhasebeleştir", body:`<div class="form-grid"><label>Muhasebe belgesi<select name="documentId" required><option value="">Seçin</option>${(payload.documents||[]).filter((doc)=>["fatura","fiş","makbuz"].includes(doc.documentType)&&!doc.archivedAt).map((doc)=>`<option value="${escapeHtml(doc.id)}">${escapeHtml(doc.documentType)} · ${escapeHtml(doc.documentNumber||doc.originalName)}</option>`).join("")}</select></label><label>Tutar (₺)<input name="amount" type="number" min="0.01" step="0.01" value="${(total/100).toFixed(2)}" required></label><label>Vade<input name="dueDate" type="date"></label><label>Not<input name="note" maxlength="1000" value="Mal kabul muhasebe kaydı"></label></div>` });
}
async function archiveDocument(button, id) {
  const reason = await requestText({ title: "Belgeyi arşivle", label: "Arşivleme nedeni", value: "Belge artık aktif değil", confirmLabel: "Arşivle", danger: true }); if (reason === null) return;
  await runButtonMutation(button, () => api(`/documents/${encodeURIComponent(id)}/archive`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["documents","shipments","dashboard"], async () => { closeDetailDialog(); await setView("documents", {force:true}); });
}
async function reverseLedger(button, id) {
  const reason = await requestText({ title: "Cari hareketi ters kaydet", description: "Geçmiş silinmez; dengeleyici yeni hareket oluşturulur.", label: "Ters kayıt nedeni", confirmLabel: "Ters kaydı oluştur", danger: true }); if (reason === null) return;
  await runButtonMutation(button, () => api(`/ledger/${encodeURIComponent(id)}/reverse`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["ledger","suppliers","dashboard"], () => setView("ledger", {force:true}));
}

async function runButtonMutation(button, operation, scopes, after) {
  if (button.disabled) return; setBusy(button,true,"İşleniyor…");
  try { const payload = await operation(); mutationComplete(payload,scopes); toast("İşlem backend tarafından tamamlandı."); if (after) await after(payload); }
  catch (error) { toast(error.message || "İşlem tamamlanamadı.",true); }
  finally { setBusy(button,false); }
}
function mutationComplete(payload, scopes) { updateRevision(payload); invalidate(scopes); if (scopes.includes("stock")) invalidateStockState(); }
function setBusy(button,busy,label){ if(!button)return; if(busy){button.dataset.busyContent=button.innerHTML;button.disabled=true;button.textContent=label;}else{button.disabled=false;if(button.dataset.busyContent)button.innerHTML=button.dataset.busyContent;delete button.dataset.busyContent;} }

async function submitLogin(event, scope) {
  event.preventDefault(); const form=event.currentTarget; const button=form.querySelector('button[type="submit"]'); if(button.disabled)return; setBusy(button,true,"Giriş yapılıyor…");
  try { const data=new FormData(form); await login(scope,{username:value(data,"username"),password:value(data,"password")}); await resolveContext(); showShell(); await loadNotifications(true).catch(()=>null); if(visibleViews.length) await activateInitialView(); else showAccessDenied(); connectEvents(); form.reset(); }
  catch(error){document.getElementById("authMessage").textContent=error.message||"Giriş başarısız.";} finally{setBusy(button,false);}
}
async function performLogout(button){if(button.disabled)return;setBusy(button,true,"Çıkılıyor…");try{stopEvents();await logout(state.context.actor.type);location.replace("/fatura/");}catch(error){toast(error.message,true);setBusy(button,false);connectEvents();}}
function selectAuthTab(scope){document.querySelectorAll("[data-auth-tab]").forEach((button)=>{const active=button.dataset.authTab===scope;button.classList.toggle("is-active",active);button.setAttribute("aria-selected",String(active));});document.querySelectorAll("[data-auth-form]").forEach((form)=>{form.hidden=form.dataset.authForm!==scope;});document.getElementById("authMessage").textContent="";}

function toggleProfileMenu(){const button=document.getElementById("profileMenuButton");const opening=profileMenu.hidden;if(opening)closeNotifications();profileMenu.hidden=!opening;button.setAttribute("aria-expanded",String(opening));}
function closeProfileMenu(){profileMenu.hidden=true;document.getElementById("profileMenuButton").setAttribute("aria-expanded","false");}
async function refreshAccessContext(trigger, options = {}){
  const button=trigger&&trigger.nodeType===1?trigger:document.getElementById("accessRefreshButton");setBusy(button,true,"Kontrol ediliyor…");
  try{await resolveContext();showShell();if(!visibleViews.length)return showAccessDenied();const target=options.firstVisible?visibleViews[0].id:(state.activeView||visibleViews[0].id);await setView(target,{force:true});connectEvents();}
  catch(error){if(error instanceof ApiError&&error.status===401)return showAuth("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");toast(error.message||"Yetkiler alınamadı.",true);}
  finally{setBusy(button,false);}
}
function captureInstallPrompt(event){event.preventDefault();deferredInstallPrompt=event;document.getElementById("installAppButton").hidden=false;}
function clearInstallPrompt(){deferredInstallPrompt=null;document.getElementById("installAppButton").hidden=true;toast("Tahmisçi Fatura cihazınıza yüklendi.");}
async function installApp(button){if(!deferredInstallPrompt)return;closeProfileMenu();setBusy(button,true,"Açılıyor…");try{deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;}finally{deferredInstallPrompt=null;button.hidden=true;setBusy(button,false);}}

function connectEvents(){
  stopEvents();
  const actor=state.context&&state.context.actor;
  if(!actor)return;
  if(!window.EventSource)return;
  const source=new EventSource("/api/events?appId=fatura",{withCredentials:true});
  state.eventSource=source;
  source.addEventListener("event",handleGatewayEvent);
  source.onopen=()=>{document.getElementById("liveState").classList.remove("is-offline");};
  source.onerror=()=>{document.getElementById("liveState").classList.add("is-offline");};
}
function handleGatewayEvent(message){
  let event={};try{event=JSON.parse(message.data||"{}");}catch(_error){return;}
  const eventId=String(event.eventId||message.lastEventId||"");
  if(eventId&&handledGatewayEventIds.has(eventId))return;
  if(eventId){handledGatewayEventIds.add(eventId);if(handledGatewayEventIds.size>300)handledGatewayEventIds.delete(handledGatewayEventIds.values().next().value);}
  const topic=String(event.topic||"system");
  const revision=Math.max(0,Number(event.revision||0));
  const prior=Math.max(0,Number(gatewayTopicRevisions.get(topic)||0));
  if(revision>0&&prior>0&&revision<=prior)return;
  if(revision>0)gatewayTopicRevisions.set(topic,revision);
  if(topic==="system")return;
  handleProductAnalysisGatewayEvent(event);
  if(topic==="notification"){
    state.loaded.delete("notifications");
    window.clearTimeout(notificationTimer);
    notificationTimer=window.setTimeout(()=>loadNotifications(true).catch(()=>null),120);
    return;
  }
  if(topic==="inventory"||topic==="catalog"){
    handleStockGatewayEvent(event);
    if(topic==="catalog")state.loaded.delete("stock-references");
    ["stockExcel","dashboard","trash"].forEach((scope)=>pendingEventScopes.add(scope));
    window.clearTimeout(eventRefreshTimer);
    eventRefreshTimer=window.setTimeout(flushEventScopes,180);
    return;
  }
  const scopes=topic==="shipment"||topic==="workforce"
    ? ["shipments","documents","productAnalysis","dashboard","stock"]
    : EVENT_SCOPES[String(event.entityType||"")]||["dashboard"];
  scopes.forEach((scope)=>pendingEventScopes.add(scope));
  window.clearTimeout(eventRefreshTimer);
  eventRefreshTimer=window.setTimeout(flushEventScopes,180);
}
async function flushEventScopes(){
  const scopes=[...pendingEventScopes];pendingEventScopes.clear();
  const refreshContext=scopes.includes("context");
  const priorView=state.activeView;
  const dataScopes=scopes.filter((scope)=>scope!=="context");
  invalidate(dataScopes);
  if(dataScopes.includes("stock"))invalidateStockState();
  if(["shipments","documents","ledger","suppliers","users","trash"].some((scope)=>scopes.includes(scope))){
    state.loaded.delete("notifications");
    window.clearTimeout(notificationTimer);
    notificationTimer=window.setTimeout(()=>loadNotifications(true).catch(()=>null),120);
  }
  if(refreshContext){
    try{await resolveContext();showShell();if(!visibleViews.length)return showAccessDenied();}
    catch(error){if(error instanceof ApiError&&error.status===401)return showAuth("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");}
  }
  if(!state.activeView||!visibleViews.some((view)=>view.id===state.activeView)){state.activeView=visibleViews[0]&&visibleViews[0].id||"";}
  if(state.activeView&&(priorView!==state.activeView||scopes.includes(state.activeView)))await setView(state.activeView,{force:true});
}
function stopEvents(){window.clearTimeout(eventRefreshTimer);window.clearTimeout(notificationTimer);pendingEventScopes.clear();if(state.eventSource){state.eventSource.close();state.eventSource=null;}}
function updateNetworkState(){const element=document.getElementById("liveState");if(!element)return;element.classList.toggle("is-offline",!navigator.onLine);element.lastChild.textContent=navigator.onLine?" Güncel":" Çevrimdışı";}
function handleViewError(error){if(error instanceof ApiError&&[401,403].includes(error.status)){if(error.status===401)return showAuth("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");}content.innerHTML=`<div class="error-state"><div><h2>Veriler alınamadı</h2><p>${escapeHtml(error.message||"Beklenmeyen hata")}</p><button class="ui-button ui-button--secondary" data-view-target="${escapeHtml(state.activeView)}">Yeniden dene</button></div></div>`;}
function toast(message,error=false){const element=document.getElementById("toast");element.textContent=message;element.classList.toggle("is-error",error);element.classList.add("is-visible");window.clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>element.classList.remove("is-visible"),3600);}
function userFacingStockError(message){const text=String(message||"").trim();if(!text)return "Stok aktarımı doğrulanamadı. Sevkiyat ve belge arşivde korundu.";if(/unit|birim/i.test(text))return "Ürün birimleri uyuşmadığı için stok aktarımı yapılamadı. Sevkiyat ve belge arşivde korundu.";if(/revision|409|conflict|çakış/i.test(text))return "Stok verisi bu sırada güncellendiği için aktarım tamamlanamadı. Sevkiyat ve belge arşivde korundu.";return text.replace(/\b(409|500)\b/g,"").replace(/stockProductId/gi,"stok ürünü").replace(/\s{2,}/g," ").trim();}
function roleLabel(role){return ({operasyon:"Operasyon",mal_kabul:"Mal kabul",muhasebe:"Muhasebe",satın_alma:"Satın alma",yönetici:"Yönetici",özel:"Özel yetki"})[role]||role||"Personel"}
function toggleSidebar(){if(matchMedia("(max-width:820px)").matches)return openMobileSidebar();app.classList.toggle("is-collapsed");const collapsed=app.classList.contains("is-collapsed");safeLocalStorageSet("tahmisci:fatura:sidebar",collapsed?"collapsed":"open");document.getElementById("sidebarToggle").setAttribute("aria-expanded",String(!collapsed));document.getElementById("sidebarToggle").title=collapsed?"Kenar çubuğunu aç":"Kenar çubuğunu kapat";}
function openMobileSidebar(){app.classList.add("is-mobile-open");document.getElementById("mobileMenu").setAttribute("aria-expanded","true");}
function closeMobileSidebar(){app.classList.remove("is-mobile-open");document.getElementById("mobileMenu").setAttribute("aria-expanded","false");}
function restoreSidebarPreference(){if(safeLocalStorageGet("tahmisci:fatura:sidebar")==="collapsed")app.classList.add("is-collapsed");}
function safeLocalStorageGet(key){try{return localStorage.getItem(key)||"";}catch(_error){return "";}}
function safeLocalStorageSet(key,value){try{localStorage.setItem(key,value);}catch(_error){}}
function safeSessionStorageGet(key){try{return sessionStorage.getItem(key)||"";}catch(_error){return "";}}
function safeSessionStorageSet(key,value){try{sessionStorage.setItem(key,value);}catch(_error){}}
function cleanFaturaUrl(){
  const nextState={...(history.state||{}),faturaView:state.activeView};
  if(state.activeView==="suppliers"&&state.supplierWorkspace.supplierId)nextState.supplierId=state.supplierWorkspace.supplierId;else delete nextState.supplierId;
  if(state.activeView==="stock"&&state.stock.viewMode==="inventory"&&state.stock.selectedLocationId){nextState.stockWorkspace=true;nextState.locationId=state.stock.selectedLocationId;}else{delete nextState.stockWorkspace;delete nextState.locationId;}
  if(`${location.pathname}${location.search}${location.hash}`!=="/fatura/"||history.state?.faturaView!==nextState.faturaView)history.replaceState(nextState,"","/fatura/");
}
function consumeOpenIntent(){
  const url=new URL(location.href);
  const supplierId=url.searchParams.get("supplierId")||"";
  const entityId=url.searchParams.get("shipmentId")||supplierId||url.searchParams.get("entityId")||"";
  const productId=url.searchParams.get("productId")||url.searchParams.get("stockProductId")||"";
  const view=url.searchParams.get("view")||url.searchParams.get("section")||"";
  if(view||entityId||productId||url.searchParams.get("locationId")||url.searchParams.get("transferId")){
    try{sessionStorage.removeItem("tahmisci:fatura:intent");}catch(_error){}
    const requestedView=view==="shipments"?"documents":view;
    const resolvedView=requestedView||(productId?"productAnalysis":"documents");
    const stockIntent=resolvedView==="stock";
    const intent={
      view:resolvedView,
      entityType:url.searchParams.get("entityType")||(supplierId?"supplier":stockIntent&&url.searchParams.get("workforce")==="shipments"&&entityId?"shipment":entityId&&!stockIntent?"shipment":""),
      entityId,
      locationId:url.searchParams.get("locationId")||"",
      productId,
      transferId:url.searchParams.get("transferId")||"",
      workforce:url.searchParams.get("workforce")||""
    };
    history.replaceState({...(history.state||{}),faturaView:intent.view,externalIntentConsumed:true},"","/fatura/");
    return intent;
  }
  try{
    const raw=sessionStorage.getItem("tahmisci:fatura:intent");sessionStorage.removeItem("tahmisci:fatura:intent");
    if(raw){const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object"){if(parsed.view==="shipments")parsed.view="documents";return parsed;}}
  }catch(_error){}
  return null;
}
async function activateIntentFromUrl(url){
  const supplierId=url.searchParams.get("supplierId")||"";
  const entityId=url.searchParams.get("shipmentId")||supplierId||url.searchParams.get("entityId")||"";
  const entityType=url.searchParams.get("entityType")||(supplierId?"supplier":entityId?"shipment":"");
  const productId=url.searchParams.get("productId")||url.searchParams.get("stockProductId")||"";
  let view=url.searchParams.get("view")||url.searchParams.get("section")||"";
  if(view==="shipments")view="documents";
  if(!view)view=entityType==="document"?"documents":entityType==="supplier"?"suppliers":"documents";
  if(!visibleViews.some((item)=>item.id===view)){cleanFaturaUrl();return toast("Bağlantının hedeflediği bölüm için erişiminiz bulunmuyor.",true);}
  if(view==="productAnalysis"&&productId)state.productAnalysis.selectedProductId=String(productId);
  await setView(view);
  if(view==="stock"){
    const intent={
      view,
      entityType,
      entityId,
      locationId:url.searchParams.get("locationId")||"",
      productId,
      transferId:url.searchParams.get("transferId")||"",
      workforce:url.searchParams.get("workforce")||""
    };
    await applyStockIntent(intent);
  }
  if(entityType==="shipment"&&entityId)await openShipment(entityId);
  else if(entityType==="document"&&entityId)await openDocument(entityId);
  else if(entityType==="supplier"&&entityId)await openSupplier(entityId);
  cleanFaturaUrl();
}
