import { api, ApiError, login, logout, requestId, uploadDocument } from "./api.js";
import { CAPABILITIES, escapeHtml, has, icon, integerKurus, invalidate, state, trDate, updateRevision, value } from "./state.js";
import { renderDashboard } from "./dashboard.js";
import { renderProductLinks, renderSuppliers } from "./suppliers.js";
import { renderShipments, shipmentDetail, shipmentFormBody, shipmentLine } from "./receipts.js";
import { documentFormBody, renderDocuments } from "./documents.js";
import { ledgerEntryFormBody, paymentFormBody, renderLedger, renderSettingsAudit, renderUsers, userAccessFormBody } from "./accounting.js";

const app = document.getElementById("faturaApp");
const shell = document.getElementById("shell");
const authView = document.getElementById("authView");
const nav = document.getElementById("faturaNav");
const content = document.getElementById("contentView");
const entityDialog = document.getElementById("entityDialog");
const detailDialog = document.getElementById("detailDialog");
const entityForm = document.getElementById("entityForm");
const profileMenu = document.getElementById("profileMenu");
const notificationDrawer = document.getElementById("notificationDrawer");
const notificationScrim = document.getElementById("notificationScrim");
const viewDefinitions = [
  { id: "dashboard", label: "Genel Bakış", description: "Tedarik ve cari süreçlerin güncel özeti.", capability: CAPABILITIES.read },
  { id: "shipments", label: "Mal Kabul", description: "Personel sevkiyatları, stok onayı ve muhasebe durumları.", any: [CAPABILITIES.read,CAPABILITIES.receiptCreate,CAPABILITIES.receiptApprove,CAPABILITIES.accountingRead] },
  { id: "suppliers", label: "Tedarikçiler", description: "Tedarikçi kartları, vadeler ve hesap bakiyeleri.", any: [CAPABILITIES.supplierRead,CAPABILITIES.supplierManage] },
  { id: "links", label: "Ürün Eşleşmeleri", description: "Tedarikçi ürünlerini canonical stok kataloğuna bağlayın.", capability: CAPABILITIES.links },
  { id: "documents", label: "Belgeler", description: "Yetki kontrollü özel fatura ve sevkiyat kanıtları.", capability: CAPABILITIES.documentsRead },
  { id: "ledger", label: "Cari Hesap", description: "Append-only borç, ödeme ve ters kayıt defteri.", capability: CAPABILITIES.accountingRead },
  { id: "users", label: "Kullanıcı ve Yetkiler", description: "Mevcut personel hesaplarına Tahmisçi Fatura yetkileri verin.", capability: CAPABILITIES.users },
  { id: "settings", label: "Ayarlar ve Audit", description: "Birim sözlüğü, mali belge kuralları ve işlem geçmişi.", any: [CAPABILITIES.users,CAPABILITIES.accountingRead] }
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
const EVENT_SCOPES = {
  shipment: ["shipments", "dashboard"],
  supplier: ["suppliers", "dashboard"],
  supplierProductLink: ["links", "dashboard"],
  document: ["documents", "shipments", "dashboard"],
  ledgerEntry: ["ledger", "suppliers", "dashboard"],
  payment: ["ledger", "suppliers", "dashboard"],
  personel: ["users", "context"],
  procurementSettings: ["settings", "dashboard"]
};

document.addEventListener("DOMContentLoaded", bootstrap);
document.addEventListener("click", handleClick);
document.addEventListener("pointerdown", (event) => {
  if (!profileMenu.hidden && !profileMenu.contains(event.target) && !event.target.closest("#profileMenuButton")) closeProfileMenu();
});
document.addEventListener("input", handleFilterInput);
document.addEventListener("change", handleChange);
entityForm.addEventListener("submit", submitEntityForm);
entityDialog.addEventListener("cancel", (event) => { if (document.getElementById("dialogSubmit").disabled) event.preventDefault(); });
entityDialog.addEventListener("close", cleanupEntityDialog);
detailDialog.addEventListener("close", cleanupDetailDialog);
document.getElementById("adminLoginForm").addEventListener("submit", (event) => submitLogin(event, "admin"));
document.getElementById("personelLoginForm").addEventListener("submit", (event) => submitLogin(event, "personel"));
window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);
window.addEventListener("beforeinstallprompt", captureInstallPrompt);
window.addEventListener("appinstalled", clearInstallPrompt);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && app.classList.contains("is-mobile-open")) closeMobileSidebar();
  if (event.key === "Escape" && !notificationDrawer.hidden) closeNotifications();
  if (event.key === "Escape" && !profileMenu.hidden) closeProfileMenu();
});

async function bootstrap() {
  updateNetworkState();
  restoreSidebarPreference();
  try {
    await resolveContext();
    showShell();
    await loadNotifications(true).catch(() => null);
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
  updateRevision(payload);
  return payload;
}

function showAuth(message = "") {
  stopEvents();
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
  const sections = state.context && state.context.access && state.context.access.sections;
  if (Array.isArray(sections)) return sections.includes(view.id);
  if (view.capability) return has(view.capability);
  return (view.any || []).some(has);
}

function renderNav() {
  nav.innerHTML = visibleViews.map((view) => `<button class="nav-button ${view.id === state.activeView ? "is-active" : ""}" type="button" data-view="${view.id}" aria-current="${view.id === state.activeView ? "page" : "false"}">${icon(view.id)}<span>${escapeHtml(view.label)}</span></button>`).join("");
}

async function activateInitialView() {
  const preference = safeLocalStorageGet("tahmisci:fatura:view");
  const intent = consumeOpenIntent();
  const requested = intent && intent.view || preference;
  if (requested && visibleViews.some((view) => view.id === requested)) state.activeView = requested;
  await setView(state.activeView);
  if (intent && intent.entityType === "shipment" && intent.entityId) await openShipment(intent.entityId);
  if (intent && intent.entityType === "document" && intent.entityId && has(CAPABILITIES.documentsRead)) await openDocument(intent.entityId);
}

async function setView(viewId, options = {}) {
  const view = visibleViews.find((item) => item.id === viewId);
  if (!view) return;
  state.activeView = viewId;
  safeLocalStorageSet("tahmisci:fatura:view", viewId);
  renderNav();
  document.getElementById("pageTitle").textContent = view.label;
  document.getElementById("pageDescription").textContent = view.description;
  content.innerHTML = loadingSkeleton(`Güncel ${view.label} verileri alınıyor`);
  closeMobileSidebar();
  try {
    await loadView(viewId, options.force === true);
    renderActiveView();
  } catch (error) {
    handleViewError(error);
  }
}

async function loadView(view, force = false) {
  const loader = {
    dashboard: () => Promise.all([loadDashboard(force), loadSuppliers(force), loadShipments(force)]),
    shipments: () => Promise.all([loadSuppliers(force), loadShipments(force)]),
    suppliers: () => loadSuppliers(force),
    links: () => Promise.all([loadSuppliers(force), loadProductLinks(force)]),
    documents: () => Promise.all([loadSuppliers(force), loadShipments(force), loadDocuments(force)]),
    ledger: () => Promise.all([loadSuppliers(force), loadLedger(force)]),
    users: () => loadUsers(force),
    settings: () => Promise.all([loadSettings(force), has(CAPABILITIES.accountingRead) || has(CAPABILITIES.users) ? loadAudit(force) : null])
  }[view];
  if (loader) await loader();
}

async function cachedLoad(key, fetcher, assign, force) {
  if (!force && state.loaded.has(key)) return state.loaded.get(key);
  const version = (loadVersions.get(key) || 0) + 1;
  loadVersions.set(key, version);
  const promise = Promise.resolve().then(fetcher).then((payload) => {
    if (loadVersions.get(key) !== version) return payload;
    updateRevision(payload);
    assign(payload);
    return payload;
  }).catch((error) => { if (loadVersions.get(key) === version) state.loaded.delete(key); throw error; });
  state.loaded.set(key, promise);
  return promise;
}
const loadDashboard = (force) => cachedLoad("dashboard", () => api("/dashboard"), (p) => { state.dashboard = p.dashboard || {}; }, force);
const loadSuppliers = (force) => cachedLoad("suppliers", () => api("/suppliers?active=all"), (p) => { state.suppliers = p.suppliers || []; }, force);
const loadProductLinks = (force) => cachedLoad("links", () => api("/product-links?active=all"), (p) => { state.productLinks = p.productLinks || []; }, force);
const loadShipments = (force) => cachedLoad("shipments", () => api("/shipments"), (p) => { state.shipments = p.shipments || []; }, force);
const loadDocuments = (force) => cachedLoad("documents", () => api("/documents"), (p) => { state.documents = p.documents || []; }, force);
const loadLedger = (force) => cachedLoad("ledger", () => api("/ledger"), (p) => { state.ledgerEntries = p.entries || []; }, force);
const loadUsers = (force) => cachedLoad("users", () => api("/users"), (p) => { state.users = p.users || []; state.accessTemplates = p.accessTemplates || []; state.sectionDefinitions = p.sections || []; }, force);
const loadSettings = (force) => cachedLoad("settings", () => api("/settings"), (p) => { state.settings = p.settings || {}; }, force);
const loadAudit = (force) => cachedLoad("audit", () => api("/audit?limit=100"), (p) => { state.auditEvents = p.auditEvents || []; }, force);

function loadingSkeleton(label) {
  return `<div class="loading-skeleton" aria-label="${escapeHtml(label)}"><span></span><span></span><span></span><span></span></div>`;
}

function renderActiveView() {
  const renderer = { dashboard: renderDashboard, shipments: renderShipments, suppliers: renderSuppliers, links: renderProductLinks, documents: renderDocuments, ledger: renderLedger, users: renderUsers, settings: renderSettingsAudit }[state.activeView];
  content.innerHTML = renderer ? renderer() : '<div class="empty-state"><p>Bu bölüm kullanılamıyor.</p></div>';
}

function notificationApiRoot() {
  return state.context && state.context.actor && state.context.actor.type === "admin" ? "/api/admin/notifications" : "/api/notifications";
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
  const badge = document.getElementById("notificationCount");
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
  document.getElementById("notificationSummary").textContent = count ? `${count} okunmamış bildirim` : "Okunmamış bildirim yok";
  document.getElementById("markAllNotificationsRead").disabled = count === 0;
  if (notificationDrawer.hidden) return;
  const list = document.getElementById("notificationList");
  list.innerHTML = state.notifications.length ? state.notifications.map((item) => `<button class="notification-item ${item.readAt ? "" : "is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}"><i class="notification-item-dot" aria-hidden="true"></i><span><strong>${escapeHtml(item.title || "Bildirim")}</strong><span>${escapeHtml(item.body || "")}</span><time datetime="${escapeHtml(item.createdAt || "")}">${trDate(item.createdAt, true)}</time></span></button>`).join("") : '<div class="notification-empty"><div><strong>Yeni bildirim yok</strong><p>Sevkiyat, belge, ödeme ve yetki bildirimleri burada kalıcı olarak görünür.</p></div></div>';
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
  if (entityType === "shipment" && visibleViews.some((item) => item.id === "shipments")) { await setView("shipments"); if (entityId) await openShipment(entityId); return; }
  if (entityType === "document" && visibleViews.some((item) => item.id === "documents")) { await setView("documents"); if (entityId) await openDocument(entityId); return; }
  if (entityType === "supplier" && visibleViews.some((item) => item.id === "suppliers")) { await setView("suppliers"); if (entityId) await openSupplier(entityId); return; }
  if (["ledgerEntry", "payment"].includes(entityType) && visibleViews.some((item) => item.id === "ledger")) { await setView("ledger"); return; }
  const target = String(notification.deepLink || "");
  if (target) {
    const url = new URL(target, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith("/fatura/")) return activateIntentFromUrl(url);
  }
  toast("Bu bildirimin bağlı olduğu bölüm için erişiminiz bulunmuyor.", true);
}

async function handleClick(event) {
  const button = event.target.closest("button,a");
  if (!button) return;
  if (button.dataset.authTab) return selectAuthTab(button.dataset.authTab);
  if (button.id === "sidebarToggle") return toggleSidebar();
  if (button.id === "mobileMenu") return openMobileSidebar();
  if (button.id === "sidebarScrim") return closeMobileSidebar();
  if (button.id === "refreshButton") return state.activeView ? setView(state.activeView, { force: true }) : refreshAccessContext(button);
  if (button.id === "accessRefreshButton") return refreshAccessContext();
  if (button.id === "profileMenuButton") return toggleProfileMenu();
  if (button.id === "notificationButton" || button.dataset.profileAction === "notifications") return openNotifications();
  if (button.id === "notificationScrim" || button.classList.contains("notification-close")) return closeNotifications();
  if (button.id === "markAllNotificationsRead") return markAllNotificationsRead(button);
  if (button.dataset.notificationId) return openNotification(button.dataset.notificationId);
  if (button.dataset.profileAction === "install") return installApp(button);
  if (button.id === "logoutButton" || button.dataset.profileAction === "logout") return performLogout(button);
  if (button.dataset.view || button.dataset.viewTarget) return setView(button.dataset.view || button.dataset.viewTarget);
  if (button.classList.contains("dialog-close")) return closeEntityDialog();
  if (button.classList.contains("detail-close")) return closeDetailDialog();
  if (button.dataset.openSupplier) return openSupplier(button.dataset.openSupplier);
  if (button.dataset.openShipment) return openShipment(button.dataset.openShipment);
  if (button.dataset.openDocument) return openDocument(button.dataset.openDocument);
  if (button.dataset.editLink) return openLinkForm(button.dataset.editLink);
  if (button.dataset.editUser) return openUserAccess(button.dataset.editUser);
  if (button.dataset.reverseLedger) return reverseLedger(button, button.dataset.reverseLedger);
  if (button.dataset.detailAction) return handleDetailAction(button, button.dataset.detailAction);
  if (button.dataset.action) return handleAction(button, button.dataset.action);
}

function handleFilterInput(event) {
  const map = { "supplier-search": "suppliers", "link-search": "links", "shipment-search": "shipments", "document-search": "documents" };
  const key = map[event.target.id];
  if (!key) return;
  state.filters[key] = event.target.value;
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(renderActiveView, 120);
}

function handleChange(event) {
  if (event.target.id === "access-template") return applyAccessTemplate(event.target);
  if (event.target.name === "faturaAccess") return toggleAccessControls(event.target.checked);
  if (event.target.name === "capabilities") { const template = document.getElementById("access-template"); if (template) template.value = "ozel"; }
  if (event.target.id === "shipment-status") { state.filters.shipmentStatus = event.target.value; return renderActiveView(); }
  if (event.target.id === "ledger-supplier") { state.filters.ledgerSupplier = event.target.value; return renderActiveView(); }
  if (event.target.matches('.shipment-line select[name="stockProductId"]')) {
    const option = event.target.selectedOptions[0];
    const unit = event.target.closest(".shipment-line").querySelector('input[name="unit"]');
    if (unit && option) unit.value = option.dataset.unit || "";
  }
}

function applyAccessTemplate(select) {
  const option = select.selectedOptions[0];
  if (!option) return;
  const capabilities = new Set(String(option.dataset.capabilities || "").split(",").filter(Boolean));
  const role = document.getElementById("fatura-role");
  const access = entityForm.elements.faturaAccess;
  if (access) access.checked = true;
  if (role && option.dataset.role) role.value = option.dataset.role;
  entityForm.querySelectorAll('input[name="capabilities"]').forEach((input) => {
    input.disabled = option.value !== "ozel";
    if (option.value !== "ozel") input.checked = capabilities.has(input.value);
  });
}

function toggleAccessControls(enabled) {
  const template = document.getElementById("access-template");
  entityForm.querySelectorAll('input[name="capabilities"]').forEach((input) => { input.disabled = !enabled || Boolean(template && template.value !== "ozel"); });
  if (enabled && !entityForm.querySelector('input[name="capabilities"]:checked')) {
    if (template) { template.value = "mal_kabul"; applyAccessTemplate(template); }
  }
}

function handleAction(button, action) {
  if (action === "new-supplier") return openSupplierForm();
  if (action === "new-link") return openLinkForm();
  if (action === "new-shipment") return openShipmentForm();
  if (action === "upload-document") return openDocumentForm();
  if (action === "new-payment") return openPaymentForm();
  if (action === "new-ledger-entry") return openLedgerEntryForm();
  if (action === "add-shipment-line") {
    const lines = document.getElementById("shipmentLines");
    lines.insertAdjacentHTML("beforeend", shipmentLine(state.context.stockProducts || [], lines.children.length));
  }
  if (action === "remove-shipment-line") {
    const lines = document.getElementById("shipmentLines");
    if (lines.children.length > 1) button.closest(".shipment-line").remove();
  }
}

function openEntityDialog(config) {
  entityForm.dataset.mode = config.mode;
  entityForm.dataset.entityId = config.entityId || "";
  document.getElementById("dialogKicker").textContent = config.kicker || "YENİ KAYIT";
  document.getElementById("dialogTitle").textContent = config.title;
  document.getElementById("dialogDescription").textContent = config.description || "";
  document.getElementById("dialogBody").innerHTML = config.body;
  document.getElementById("dialogSubmit").textContent = config.submitLabel || "Kaydet";
  document.getElementById("dialogMessage").textContent = "";
  entityDialog.showModal(); document.body.classList.add("dialog-open");
}
function closeEntityDialog() { if (entityDialog.open) entityDialog.close(); cleanupEntityDialog(); }
function closeDetailDialog() { if (detailDialog.open) detailDialog.close(); cleanupDetailDialog(); }
function cleanupEntityDialog() { entityForm.reset(); delete entityForm.dataset.mode; delete entityForm.dataset.entityId; syncDialogOpenState(); }
function cleanupDetailDialog() { state.detail = null; if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = ""; } syncDialogOpenState(); }
function syncDialogOpenState() { document.body.classList.toggle("dialog-open", entityDialog.open || detailDialog.open); }

function openSupplierForm(supplier = null) {
  openEntityDialog({ mode: supplier ? "supplier-edit" : "supplier-create", entityId: supplier && supplier.id, title: supplier ? "Tedarikçiyi düzenle" : "Tedarikçi ekle", description: "Bakiye ayrı alan değildir; cari hareketlerden hesaplanır.", submitLabel: supplier ? "Değişiklikleri kaydet" : "Tedarikçiyi kaydet", body: `<div class="form-grid"><label>Tedarikçi kodu<input name="code" value="${escapeHtml(supplier && supplier.code || "")}" maxlength="80" required></label><label>Firma adı<input name="name" value="${escapeHtml(supplier && supplier.name || "")}" maxlength="180" required></label><label>Vergi no<input name="taxNumber" value="${escapeHtml(supplier && supplier.taxNumber || "")}" maxlength="32"></label><label>Vade (gün)<input name="paymentTermDays" value="${Number(supplier && supplier.paymentTermDays || 0)}" type="number" min="0" max="3650"></label><label>Telefon<input name="phone" value="${escapeHtml(supplier && supplier.phone || "")}" maxlength="40"></label><label>E-posta<input name="email" value="${escapeHtml(supplier && supplier.email || "")}" type="email" maxlength="254"></label><label class="span-2">Adres<textarea name="address" maxlength="1000">${escapeHtml(supplier && supplier.address || "")}</textarea></label></div>` });
}
function openLinkForm(link = null) {
  if (typeof link === "string") link = state.productLinks.find((item) => item.id === link) || null;
  openEntityDialog({ mode: link ? "link-edit" : "link-create", entityId: link && link.id, title: link ? "Ürün eşleşmesini düzenle" : "Ürün eşleştir", description: "Canonical ürün kaynağı stockState.products olarak kalır.", submitLabel: "Eşleşmeyi kaydet", body: `<div class="form-grid"><label>Tedarikçi<select name="supplierId" ${link ? "disabled" : ""} required><option value="">Seçin</option>${state.suppliers.filter((item) => item.active !== false).map((item) => `<option value="${escapeHtml(item.id)}" ${link && link.supplierId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Stok ürünü<select name="stockProductId" required><option value="">Seçin</option>${(state.context.stockProducts || []).map((item) => `<option value="${escapeHtml(item.id)}" ${link && link.stockProductId === item.id ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.productCode)}</option>`).join("")}</select></label><label>Tedarikçi ürün adı<input name="supplierProductName" value="${escapeHtml(link && link.supplierProductName || "")}" maxlength="180"></label><label>Tedarikçi ürün kodu<input name="supplierProductCode" value="${escapeHtml(link && link.supplierProductCode || "")}" maxlength="100"></label><label>Satın alma birimi<input name="purchaseUnit" value="${escapeHtml(link && link.purchaseUnit || "")}" maxlength="40" required></label><label>Dönüşüm katsayısı<input name="conversionFactor" value="${Number(link && link.conversionFactor || 1)}" type="number" min="0.001" step="0.001" required></label><label>Varsayılan alış (₺)<input name="defaultPrice" value="${Number(link && link.defaultPurchasePriceKurus || 0) / 100}" type="number" min="0" step="0.01"></label><label>Son alış (₺)<input name="lastPrice" value="${Number(link && link.lastPurchasePriceKurus || 0) / 100}" type="number" min="0" step="0.01"></label><label class="check-field span-2"><input name="active" type="checkbox" ${!link || link.active !== false ? "checked" : ""}><span>Aktif eşleşme</span></label></div>` });
}
function openShipmentForm() { openEntityDialog({ mode: "shipment-create", title: "Yeni mal kabul", description: "Kayıt canonical workforceShipments koleksiyonuna yazılır.", submitLabel: "Mal kabulü kaydet", body: shipmentFormBody() }); }
function openDocumentForm(shipmentId = "") { openEntityDialog({ mode: "document-upload", entityId: shipmentId, title: "Özel belge yükle", description: "Dosya private depoda tutulur; stok ve cari otomatik etkilenmez.", submitLabel: "Belgeyi güvenli yükle", body: documentFormBody(shipmentId) }); }
function openPaymentForm() { openEntityDialog({ mode: "payment-create", title: "Tedarikçi ödemesi", description: "Ödeme stoktan bağımsız pozitif cari harekettir.", submitLabel: "Ödemeyi kaydet", body: paymentFormBody() }); }
function openLedgerEntryForm() { openEntityDialog({ mode: "ledger-create", title: "Bağımsız cari hareket", description: "Mali geçmiş düzenlenmez; gerekirse ters kayıtla dengelenir.", submitLabel: "Cari hareketi kaydet", body: ledgerEntryFormBody() }); }
function openUserAccess(userId) { const user = state.users.find((item) => item.id === userId); if (!user) return; openEntityDialog({ mode: "user-access", entityId: user.id, title: `${user.name} · yetkiler`, description: "Yeni kullanıcı veya parola oluşturulmaz; mevcut personel hesabı kullanılır.", submitLabel: "Yetkileri kaydet", body: userAccessFormBody(user) }); }

async function submitEntityForm(event) {
  event.preventDefault();
  const submit = document.getElementById("dialogSubmit");
  if (submit.disabled) return;
  setBusy(submit, true, "Kaydediliyor…");
  const data = new FormData(entityForm);
  try {
    const mode = entityForm.dataset.mode;
    if (mode === "supplier-create" || mode === "supplier-edit") await saveSupplier(mode, data);
    else if (mode === "link-create" || mode === "link-edit") await saveLink(mode, data);
    else if (mode === "shipment-create") await saveShipment(data);
    else if (mode === "document-upload") await saveDocument(data);
    else if (mode === "payment-create") await savePayment(data);
    else if (mode === "ledger-create") await saveLedgerEntry(data);
    else if (mode === "user-access") await saveUserAccess(data);
    else if (mode === "shipment-account") await saveShipmentAccounting(data);
    closeEntityDialog();
    toast("İşlem backend tarafından kaydedildi.");
    await setView(state.activeView, { force: true });
  } catch (error) {
    document.getElementById("dialogMessage").textContent = error.message || "İşlem tamamlanamadı.";
  } finally { setBusy(submit, false); }
}

async function saveSupplier(mode, data) {
  const body = { code: value(data,"code"), name: value(data,"name"), taxNumber: value(data,"taxNumber"), phone: value(data,"phone"), email: value(data,"email"), address: value(data,"address"), paymentTermDays: Number(value(data,"paymentTermDays") || 0) };
  const id = entityForm.dataset.entityId;
  const payload = await api(mode === "supplier-create" ? "/suppliers" : `/suppliers/${encodeURIComponent(id)}`, { method: mode === "supplier-create" ? "POST" : "PUT", body, expectedRevision: state.revision });
  mutationComplete(payload, ["suppliers","dashboard"]);
}
async function saveLink(mode, data) {
  const body = { supplierId: value(data,"supplierId"), stockProductId: value(data,"stockProductId"), supplierProductName: value(data,"supplierProductName"), supplierProductCode: value(data,"supplierProductCode"), purchaseUnit: value(data,"purchaseUnit"), conversionFactor: Number(value(data,"conversionFactor") || 1), defaultPurchasePriceKurus: integerKurus(value(data,"defaultPrice")), lastPurchasePriceKurus: integerKurus(value(data,"lastPrice")), active: data.get("active") === "on" };
  const id = entityForm.dataset.entityId;
  const payload = await api(mode === "link-create" ? "/product-links" : `/product-links/${encodeURIComponent(id)}`, { method: mode === "link-create" ? "POST" : "PUT", body, expectedRevision: state.revision });
  mutationComplete(payload, ["links","dashboard"]);
}
async function saveShipment(data) {
  const items = [...document.querySelectorAll("#shipmentLines .shipment-line")].map((line) => ({ stockProductId: line.querySelector('[name="stockProductId"]').value, quantity: Number(line.querySelector('[name="quantity"]').value), unit: line.querySelector('[name="unit"]').value.trim(), unitPriceKurus: integerKurus(line.querySelector('[name="unitPrice"]').value), taxKurus: 0 }));
  let payload = await api("/shipments", { method: "POST", body: { supplierId: value(data,"supplierId"), documentType: value(data,"documentType"), documentNumber: value(data,"documentNumber"), documentDate: value(data,"documentDate"), note: value(data,"note"), items }, expectedRevision: state.revision });
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
  const payload = await api("/payments", { method: "POST", body: { supplierId: value(data,"supplierId"), amountKurus: integerKurus(value(data,"amount")), paymentDate: value(data,"paymentDate"), reference: value(data,"reference"), note: value(data,"note") }, expectedRevision: state.revision });
  mutationComplete(payload, ["ledger","suppliers","dashboard"]);
}
async function saveLedgerEntry(data) {
  const amount = integerKurus(value(data,"amount"));
  const payload = await api("/ledger", { method: "POST", body: { supplierId: value(data,"supplierId"), type: value(data,"type"), amountKurus: value(data,"direction") === "debt" ? -amount : amount, dueDate: value(data,"dueDate"), sourceId: value(data,"sourceId"), note: value(data,"note") }, expectedRevision: state.revision });
  mutationComplete(payload, ["ledger","suppliers","dashboard"]);
}
async function saveUserAccess(data) {
  const accessEnabled = data.get("faturaAccess") === "on";
  const payload = await api(`/users/${encodeURIComponent(entityForm.dataset.entityId)}/access`, { method: "PUT", body: { faturaAccessEnabled: accessEnabled, faturaTemplate: value(data,"accessTemplate") || "ozel", faturaRole: value(data,"faturaRole") || "özel", faturaCapabilities: accessEnabled ? data.getAll("capabilities").map(String) : [] }, expectedRevision: state.revision });
  mutationComplete(payload, ["users"]);
}
async function saveShipmentAccounting(data) {
  const shipmentId = entityForm.dataset.entityId;
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}/account`, { method: "POST", body: { documentId: value(data,"documentId"), amountKurus: integerKurus(value(data,"amount")), dueDate: value(data,"dueDate"), note: value(data,"note") }, expectedRevision: state.revision });
  mutationComplete(payload, ["shipments","ledger","suppliers","dashboard"]);
}

async function openSupplier(id) {
  const supplier = state.suppliers.find((item) => item.id === id); if (!supplier) return;
  state.detail = { type:"supplier", id };
  document.getElementById("detailKicker").textContent = "TEDARİKÇİ DETAYI"; document.getElementById("detailTitle").textContent = supplier.name; document.getElementById("detailDescription").textContent = `${supplier.code || "Kodsuz"} · ${supplier.active === false ? "Pasif" : "Aktif"}`;
  document.getElementById("detailBody").innerHTML = `<div class="detail-actions">${has(CAPABILITIES.supplierManage) ? `<button class="ui-button ui-button--primary" data-detail-action="edit-supplier">Bilgileri düzenle</button>${supplier.active !== false ? '<button class="ui-button ui-button--danger" data-detail-action="deactivate-supplier">Pasife al</button>' : ""}` : ""}${has(CAPABILITIES.accountingRead) ? '<button class="ui-button ui-button--secondary" data-detail-action="supplier-ledger">Cariyi aç</button>' : ""}</div><div class="detail-grid"><div class="detail-box"><span>Cari borç</span><strong>${supplier.debtKurus === null ? "Yetki gerekli" : (Number(supplier.debtKurus || 0) / 100).toLocaleString("tr-TR", {style:"currency",currency:"TRY"})}</strong></div><div class="detail-box"><span>Vade</span><strong>${supplier.paymentTermDays || 0} gün</strong></div><div class="detail-box"><span>Vergi no</span><strong>${escapeHtml(supplier.taxNumber || "—")}</strong></div><div class="detail-box"><span>Telefon</span><strong>${escapeHtml(supplier.phone || "—")}</strong></div><div class="detail-box"><span>E-posta</span><strong>${escapeHtml(supplier.email || "—")}</strong></div><div class="detail-box"><span>Adres</span><strong>${escapeHtml(supplier.address || "—")}</strong></div></div>`;
  detailDialog.showModal(); document.body.classList.add("dialog-open");
}

async function openShipment(id) {
  try {
    const payload = await api(`/shipments/${encodeURIComponent(id)}`, { dedupe:false }); updateRevision(payload); state.detail = { type:"shipment", id, payload };
    document.getElementById("detailKicker").textContent = "MAL KABUL DETAYI"; document.getElementById("detailTitle").textContent = payload.shipment.supplier && payload.shipment.supplier.name || payload.shipment.userName || "Sevkiyat"; document.getElementById("detailDescription").textContent = `${payload.shipment.id} · ${payload.shipment.items.length} ürün kalemi`;
    document.getElementById("detailBody").innerHTML = shipmentDetail(payload.shipment, payload.documents, payload.ledgerEntries);
    detailDialog.showModal(); document.body.classList.add("dialog-open");
  } catch (error) { toast(error.message, true); }
}

async function openDocument(id) {
  try {
    const documentMeta = state.documents.find((item) => item.id === id);
    const blob = await api(`/documents/${encodeURIComponent(id)}/content`, { responseType:"blob", dedupe:false });
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = URL.createObjectURL(blob); state.detail = { type:"document", id, document: documentMeta };
    document.getElementById("detailKicker").textContent = "ÖZEL BELGE"; document.getElementById("detailTitle").textContent = documentMeta && (documentMeta.documentNumber || documentMeta.originalName) || "Belge"; document.getElementById("detailDescription").textContent = "İçerik yetki kontrolünden sonra yüklendi; public media yolu kullanılmadı.";
    document.getElementById("detailBody").innerHTML = `<img src="${escapeHtml(currentObjectUrl)}" alt="Belge önizlemesi" style="display:block;max-width:100%;max-height:65dvh;margin:auto;border-radius:12px">${documentMeta && !documentMeta.archivedAt && has(CAPABILITIES.documentsArchive) ? '<div class="detail-actions" style="margin-top:14px"><button class="ui-button ui-button--danger" data-detail-action="archive-document">Belgeyi arşivle</button></div>' : ""}`;
    detailDialog.showModal(); document.body.classList.add("dialog-open");
  } catch (error) { toast(error.message, true); }
}

async function handleDetailAction(button, action) {
  const detail = state.detail || {};
  if (action === "edit-supplier") { const supplier = state.suppliers.find((item) => item.id === detail.id); closeDetailDialog(); return openSupplierForm(supplier); }
  if (action === "deactivate-supplier") return deactivateSupplier(button, detail.id);
  if (action === "supplier-ledger") { state.filters.ledgerSupplier = detail.id; closeDetailDialog(); return setView("ledger"); }
  if (action === "approve-stock") return approveStock(button, detail.id);
  if (action === "reject-shipment") return rejectShipment(button, detail.id);
  if (action === "submit-shipment") return submitShipment(button, detail.id);
  if (action === "account-shipment") return openAccountingForm(detail.payload);
  if (action === "upload-shipment-document") { closeDetailDialog(); return openDocumentForm(detail.id); }
  if (action === "archive-document") return archiveDocument(button, detail.id);
}

async function deactivateSupplier(button, id) {
  const reason = window.prompt("Tedarikçiyi pasife alma nedeni:", "Artık kullanılmıyor"); if (reason === null) return;
  await runButtonMutation(button, () => api(`/suppliers/${encodeURIComponent(id)}/deactivate`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["suppliers","dashboard"], async () => { closeDetailDialog(); await setView("suppliers", {force:true}); });
}
async function approveStock(button, id) {
  if (!window.confirm("Stok yalnız bir kez artırılacak. Muhasebe kaydı oluşturulmayacak. Onaylıyor musunuz?")) return;
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/approve-stock`, { method:"POST", body:{workforceExpectedRevision:state.workforceRevision,note:"Tahmisçi Fatura stok onayı"}, expectedRevision:state.revision }), ["shipments","dashboard"], async () => { closeDetailDialog(); await setView("shipments", {force:true}); });
}
async function rejectShipment(button, id) {
  const reason = window.prompt("Red nedeni:"); if (reason === null) return;
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/reject`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["shipments","dashboard"], async () => { closeDetailDialog(); await setView("shipments", {force:true}); });
}
async function submitShipment(button, id) {
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/submit`, { method:"POST", body:{}, expectedRevision:state.revision }), ["shipments","dashboard"], async () => { closeDetailDialog(); await setView("shipments", {force:true}); });
}
function openAccountingForm(payload) {
  const shipment = payload.shipment; const total = (shipment.items || []).reduce((sum,item)=>sum+Number(item.totalKurus||0),0);
  closeDetailDialog(); openEntityDialog({ mode:"shipment-account", entityId:shipment.id, title:"Sevkiyatı muhasebeleştir", description:"Bu işlem stok miktarını değiştirmez; cari borç oluşturur.", submitLabel:"Muhasebeleştir", body:`<div class="form-grid"><label>Muhasebe belgesi<select name="documentId" required><option value="">Seçin</option>${(payload.documents||[]).filter((doc)=>["fatura","fiş","makbuz"].includes(doc.documentType)&&!doc.archivedAt).map((doc)=>`<option value="${escapeHtml(doc.id)}">${escapeHtml(doc.documentType)} · ${escapeHtml(doc.documentNumber||doc.originalName)}</option>`).join("")}</select></label><label>Tutar (₺)<input name="amount" type="number" min="0.01" step="0.01" value="${(total/100).toFixed(2)}" required></label><label>Vade<input name="dueDate" type="date"></label><label>Not<input name="note" maxlength="1000" value="Mal kabul muhasebe kaydı"></label></div>` });
}
async function archiveDocument(button, id) {
  const reason = window.prompt("Arşivleme nedeni:", "Belge artık aktif değil"); if (reason === null) return;
  await runButtonMutation(button, () => api(`/documents/${encodeURIComponent(id)}/archive`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["documents","shipments","dashboard"], async () => { closeDetailDialog(); await setView("documents", {force:true}); });
}
async function reverseLedger(button, id) {
  const reason = window.prompt("Ters kayıt nedeni:"); if (reason === null) return;
  await runButtonMutation(button, () => api(`/ledger/${encodeURIComponent(id)}/reverse`, { method:"POST", body:{reason}, expectedRevision:state.revision }), ["ledger","suppliers","dashboard"], () => setView("ledger", {force:true}));
}

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "settingsForm") return;
  event.preventDefault(); const button = event.target.querySelector('button[type="submit"]'); const data = new FormData(event.target);
  await runButtonMutation(button, () => api("/settings", { method:"PUT", body:{ dueSoonDays:Number(value(data,"dueSoonDays")), units:value(data,"units").split(",").map((item)=>item.trim()).filter(Boolean) }, expectedRevision:state.revision }), ["settings","dashboard"], () => setView("settings", {force:true}));
});

async function runButtonMutation(button, operation, scopes, after) {
  if (button.disabled) return; setBusy(button,true,"İşleniyor…");
  try { const payload = await operation(); mutationComplete(payload,scopes); toast("İşlem backend tarafından tamamlandı."); if (after) await after(payload); }
  catch (error) { toast(error.message || "İşlem tamamlanamadı.",true); }
  finally { setBusy(button,false); }
}
function mutationComplete(payload, scopes) { updateRevision(payload); invalidate(scopes); }
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
  connectNotificationEvents();
  if(actor.type!=="admin"&&!(actor.capabilities||[]).length)return;
  const source=new EventSource("/api/procurement/v1/events",{withCredentials:true});
  state.eventSource=source;
  source.addEventListener("procurement",(message)=>{
    let event={};try{event=JSON.parse(message.data||"{}");}catch(_error){}
    const scopes=EVENT_SCOPES[String(event.entityType||"")]||["dashboard"];
    scopes.forEach((scope)=>pendingEventScopes.add(scope));
    window.clearTimeout(eventRefreshTimer);
    eventRefreshTimer=window.setTimeout(flushEventScopes,180);
  });
  source.onopen=()=>{document.getElementById("liveState").classList.remove("is-offline");};
  source.onerror=()=>{document.getElementById("liveState").classList.add("is-offline");};
}
function connectNotificationEvents(){
  if(!window.EventSource||state.notificationEventSource)return;
  const source=new EventSource(`${notificationApiRoot()}/events`,{withCredentials:true});
  state.notificationEventSource=source;
  source.addEventListener("ready",handleNotificationEvent);
  source.addEventListener("notification",handleNotificationEvent);
  source.onopen=()=>{document.getElementById("liveState").classList.remove("is-offline");};
  // Sunucunun `retry: 5000` talimatı aynı bağlantıyı kontrollü biçimde yeniden kurar.
  source.onerror=()=>{document.getElementById("liveState").classList.add("is-offline");};
}
function handleNotificationEvent(message){
  let payload={};try{payload=JSON.parse(message.data||"{}");}catch(_error){return;}
  if(Number.isSafeInteger(Number(payload.unreadCount)))state.unreadCount=Math.max(0,Number(payload.unreadCount));
  const incoming=payload.notification;
  if(incoming&&incoming.id){
    const index=state.notifications.findIndex((item)=>item.id===incoming.id);
    if(index>=0)state.notifications.splice(index,1,incoming);else state.notifications.unshift(incoming);
    state.notifications=state.notifications.slice(0,40);
  }
  renderNotificationState();
  if(!payload.requiresRefetch)return;
  state.loaded.delete("notifications");
  window.clearTimeout(notificationTimer);
  notificationTimer=window.setTimeout(()=>loadNotifications(true).catch(()=>null),120);
}
async function flushEventScopes(){
  const scopes=[...pendingEventScopes];pendingEventScopes.clear();
  const refreshContext=scopes.includes("context");
  const priorView=state.activeView;
  const dataScopes=scopes.filter((scope)=>scope!=="context");
  invalidate(dataScopes);
  if(["shipments","documents","ledger","suppliers","users"].some((scope)=>scopes.includes(scope))){
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
function stopEvents(){window.clearTimeout(eventRefreshTimer);window.clearTimeout(notificationTimer);pendingEventScopes.clear();if(state.eventSource){state.eventSource.close();state.eventSource=null;}if(state.notificationEventSource){state.notificationEventSource.close();state.notificationEventSource=null;}}
function updateNetworkState(){const element=document.getElementById("liveState");if(!element)return;element.classList.toggle("is-offline",!navigator.onLine);element.lastChild.textContent=navigator.onLine?" Güncel":" Çevrimdışı";}
function handleViewError(error){if(error instanceof ApiError&&[401,403].includes(error.status)){if(error.status===401)return showAuth("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");}content.innerHTML=`<div class="error-state"><div><h2>Veriler alınamadı</h2><p>${escapeHtml(error.message||"Beklenmeyen hata")}</p><button class="ui-button ui-button--secondary" data-view-target="${escapeHtml(state.activeView)}">Yeniden dene</button></div></div>`;}
function toast(message,error=false){const element=document.getElementById("toast");element.textContent=message;element.classList.toggle("is-error",error);element.classList.add("is-visible");window.clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>element.classList.remove("is-visible"),3600);}
function roleLabel(role){return ({operasyon:"Operasyon",mal_kabul:"Mal kabul",muhasebe:"Muhasebe",satın_alma:"Satın alma",yönetici:"Yönetici",özel:"Özel yetki"})[role]||role||"Personel"}
function toggleSidebar(){if(matchMedia("(max-width:820px)").matches)return openMobileSidebar();app.classList.toggle("is-collapsed");const collapsed=app.classList.contains("is-collapsed");safeLocalStorageSet("tahmisci:fatura:sidebar",collapsed?"collapsed":"open");document.getElementById("sidebarToggle").setAttribute("aria-expanded",String(!collapsed));document.getElementById("sidebarToggle").title=collapsed?"Kenar çubuğunu aç":"Kenar çubuğunu kapat";}
function openMobileSidebar(){app.classList.add("is-mobile-open");document.getElementById("mobileMenu").setAttribute("aria-expanded","true");}
function closeMobileSidebar(){app.classList.remove("is-mobile-open");document.getElementById("mobileMenu").setAttribute("aria-expanded","false");}
function restoreSidebarPreference(){if(safeLocalStorageGet("tahmisci:fatura:sidebar")==="collapsed")app.classList.add("is-collapsed");}
function safeLocalStorageGet(key){try{return localStorage.getItem(key)||"";}catch(_error){return "";}}
function safeLocalStorageSet(key,value){try{localStorage.setItem(key,value);}catch(_error){}}
function consumeOpenIntent(){
  try{
    const raw=sessionStorage.getItem("tahmisci:fatura:intent");sessionStorage.removeItem("tahmisci:fatura:intent");
    if(raw){const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object")return parsed;}
  }catch(_error){}
  const url=new URL(location.href);const entityId=url.searchParams.get("shipmentId")||url.searchParams.get("entityId")||"";const view=url.searchParams.get("view")||url.searchParams.get("section")||"";
  if(!view&&!entityId)return null;
  return{view:view||"shipments",entityType:url.searchParams.get("entityType")||(entityId?"shipment":""),entityId};
}
async function activateIntentFromUrl(url){
  const entityId=url.searchParams.get("shipmentId")||url.searchParams.get("entityId")||"";
  const entityType=url.searchParams.get("entityType")||(entityId?"shipment":"");
  let view=url.searchParams.get("view")||url.searchParams.get("section")||"";
  if(!view)view=entityType==="document"?"documents":entityType==="supplier"?"suppliers":"shipments";
  if(!visibleViews.some((item)=>item.id===view))return toast("Bağlantının hedeflediği bölüm için erişiminiz bulunmuyor.",true);
  await setView(view);
  if(entityType==="shipment"&&entityId)await openShipment(entityId);
  else if(entityType==="document"&&entityId)await openDocument(entityId);
  else if(entityType==="supplier"&&entityId)await openSupplier(entityId);
}
