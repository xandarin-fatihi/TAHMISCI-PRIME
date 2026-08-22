import { api, ApiError, login, logout, requestId, uploadDocument } from "./api.js";
import { CAPABILITIES, escapeHtml, has, icon, integerKurus, invalidate, state, updateRevision, value } from "./state.js";
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
const viewDefinitions = [
  { id: "dashboard", label: "Genel Bakış", description: "Tedarik ve cari süreçlerin güncel özeti.", capability: CAPABILITIES.read },
  { id: "shipments", label: "Mal Kabul", description: "Personel sevkiyatları, stok onayı ve muhasebe durumları.", any: [CAPABILITIES.read,CAPABILITIES.receiptCreate,CAPABILITIES.receiptApprove,CAPABILITIES.accountingRead] },
  { id: "suppliers", label: "Tedarikçiler", description: "Tedarikçi kartları, vadeler ve hesap bakiyeleri.", any: [CAPABILITIES.supplierRead,CAPABILITIES.receiptCreate,CAPABILITIES.supplierManage] },
  { id: "links", label: "Ürün Eşleşmeleri", description: "Tedarikçi ürünlerini canonical stok kataloğuna bağlayın.", any: [CAPABILITIES.read,CAPABILITIES.receiptCreate,CAPABILITIES.links] },
  { id: "documents", label: "Belgeler", description: "Yetki kontrollü özel fatura ve sevkiyat kanıtları.", capability: CAPABILITIES.documentsRead },
  { id: "ledger", label: "Cari Hesap", description: "Append-only borç, ödeme ve ters kayıt defteri.", capability: CAPABILITIES.accountingRead },
  { id: "users", label: "Kullanıcı ve Yetkiler", description: "Mevcut personel hesaplarına Fatura Merkezi yetkileri verin.", capability: CAPABILITIES.users },
  { id: "settings", label: "Ayarlar ve Audit", description: "Birim sözlüğü, mali belge kuralları ve işlem geçmişi.", any: [CAPABILITIES.users,CAPABILITIES.accountingRead] }
];
let visibleViews = [];
let refreshTimer = null;
let toastTimer = null;
let currentObjectUrl = "";

document.addEventListener("DOMContentLoaded", bootstrap);
document.addEventListener("click", handleClick);
document.addEventListener("input", handleFilterInput);
document.addEventListener("change", handleChange);
entityForm.addEventListener("submit", submitEntityForm);
document.getElementById("adminLoginForm").addEventListener("submit", (event) => submitLogin(event, "admin"));
document.getElementById("personelLoginForm").addEventListener("submit", (event) => submitLogin(event, "personel"));
window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && app.classList.contains("is-mobile-open")) closeMobileSidebar();
});

async function bootstrap() {
  updateNetworkState();
  restoreSidebarPreference();
  try {
    await resolveContext();
    showShell();
    await activateInitialView();
    connectEvents();
  } catch (error) {
    if (error instanceof ApiError && [401,403].includes(error.status)) return showAuth(error.status === 403 ? error.message : "");
    showAuth(error.message || "Fatura Merkezi başlatılamadı.");
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
  visibleViews = viewDefinitions.filter(canSeeView);
  if (!visibleViews.some((view) => view.id === state.activeView)) state.activeView = visibleViews[0] && visibleViews[0].id || "shipments";
  renderNav();
}

function canSeeView(view) {
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
  content.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Güncel veriler alınıyor…</p></div>';
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
  const promise = Promise.resolve().then(fetcher).then((payload) => { updateRevision(payload); assign(payload); return payload; }).catch((error) => { state.loaded.delete(key); throw error; });
  state.loaded.set(key, promise);
  return promise;
}
const loadDashboard = (force) => cachedLoad("dashboard", () => api("/dashboard"), (p) => { state.dashboard = p.dashboard || {}; }, force);
const loadSuppliers = (force) => cachedLoad("suppliers", () => api("/suppliers?active=all"), (p) => { state.suppliers = p.suppliers || []; }, force);
const loadProductLinks = (force) => cachedLoad("links", () => api("/product-links?active=all"), (p) => { state.productLinks = p.productLinks || []; }, force);
const loadShipments = (force) => cachedLoad("shipments", () => api("/shipments"), (p) => { state.shipments = p.shipments || []; }, force);
const loadDocuments = (force) => cachedLoad("documents", () => api("/documents"), (p) => { state.documents = p.documents || []; }, force);
const loadLedger = (force) => cachedLoad("ledger", () => api("/ledger"), (p) => { state.ledgerEntries = p.entries || []; }, force);
const loadUsers = (force) => cachedLoad("users", () => api("/users"), (p) => { state.users = p.users || []; }, force);
const loadSettings = (force) => cachedLoad("settings", () => api("/settings"), (p) => { state.settings = p.settings || {}; }, force);
const loadAudit = (force) => cachedLoad("audit", () => api("/audit?limit=100"), (p) => { state.auditEvents = p.auditEvents || []; }, force);

function renderActiveView() {
  const renderer = { dashboard: renderDashboard, shipments: renderShipments, suppliers: renderSuppliers, links: renderProductLinks, documents: renderDocuments, ledger: renderLedger, users: renderUsers, settings: renderSettingsAudit }[state.activeView];
  content.innerHTML = renderer ? renderer() : '<div class="empty-state"><p>Bu bölüm kullanılamıyor.</p></div>';
}

async function handleClick(event) {
  const button = event.target.closest("button,a");
  if (!button) return;
  if (button.dataset.authTab) return selectAuthTab(button.dataset.authTab);
  if (button.id === "sidebarToggle") return toggleSidebar();
  if (button.id === "mobileMenu") return openMobileSidebar();
  if (button.id === "sidebarScrim") return closeMobileSidebar();
  if (button.id === "refreshButton") return setView(state.activeView, { force: true });
  if (button.id === "logoutButton") return performLogout(button);
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
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(renderActiveView, 120);
}

function handleChange(event) {
  if (event.target.id === "shipment-status") { state.filters.shipmentStatus = event.target.value; return renderActiveView(); }
  if (event.target.id === "ledger-supplier") { state.filters.ledgerSupplier = event.target.value; return renderActiveView(); }
  if (event.target.matches('.shipment-line select[name="stockProductId"]')) {
    const option = event.target.selectedOptions[0];
    const unit = event.target.closest(".shipment-line").querySelector('input[name="unit"]');
    if (unit && option) unit.value = option.dataset.unit || "";
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
function closeEntityDialog() { if (entityDialog.open) entityDialog.close(); document.body.classList.remove("dialog-open"); entityForm.reset(); delete entityForm.dataset.mode; }
function closeDetailDialog() { if (detailDialog.open) detailDialog.close(); document.body.classList.remove("dialog-open"); state.detail = null; if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = ""; } }

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
  const payload = await api(`/users/${encodeURIComponent(entityForm.dataset.entityId)}/access`, { method: "PUT", body: { faturaRole: value(data,"faturaRole"), faturaCapabilities: data.getAll("capabilities").map(String) }, expectedRevision: state.revision });
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
  await runButtonMutation(button, () => api(`/shipments/${encodeURIComponent(id)}/approve-stock`, { method:"POST", body:{workforceExpectedRevision:state.workforceRevision,note:"Fatura Merkezi stok onayı"}, expectedRevision:state.revision }), ["shipments","dashboard"], async () => { closeDetailDialog(); await setView("shipments", {force:true}); });
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
function setBusy(button,busy,label){ if(!button)return; if(busy){button.dataset.label=button.textContent;button.disabled=true;button.textContent=label;}else{button.disabled=false;if(button.dataset.label)button.textContent=button.dataset.label;delete button.dataset.label;} }

async function submitLogin(event, scope) {
  event.preventDefault(); const form=event.currentTarget; const button=form.querySelector('button[type="submit"]'); if(button.disabled)return; setBusy(button,true,"Giriş yapılıyor…");
  try { const data=new FormData(form); await login(scope,{username:value(data,"username"),password:value(data,"password")}); await resolveContext(); showShell(); await activateInitialView(); connectEvents(); form.reset(); }
  catch(error){document.getElementById("authMessage").textContent=error.message||"Giriş başarısız.";} finally{setBusy(button,false);}
}
async function performLogout(button){setBusy(button,true,"Çıkılıyor…");try{await logout(state.context.actor.type);location.replace("/fatura/");}catch(error){toast(error.message,true);setBusy(button,false);}}
function selectAuthTab(scope){document.querySelectorAll("[data-auth-tab]").forEach((button)=>{const active=button.dataset.authTab===scope;button.classList.toggle("is-active",active);button.setAttribute("aria-selected",String(active));});document.querySelectorAll("[data-auth-form]").forEach((form)=>{form.hidden=form.dataset.authForm!==scope;});document.getElementById("authMessage").textContent="";}

function connectEvents(){stopEvents();if(![CAPABILITIES.read,CAPABILITIES.receiptCreate,CAPABILITIES.documentsRead,CAPABILITIES.accountingRead].some(has))return;const source=new EventSource("/api/procurement/v1/events",{withCredentials:true});state.eventSource=source;source.addEventListener("procurement",()=>{invalidate(["dashboard","suppliers","links","shipments","documents","ledger","users","settings","audit"]);window.clearTimeout(refreshTimer);refreshTimer=window.setTimeout(()=>setView(state.activeView,{force:true}),250);});source.onopen=()=>{document.getElementById("liveState").classList.remove("is-offline");};source.onerror=()=>{document.getElementById("liveState").classList.add("is-offline");};}
function stopEvents(){if(state.eventSource){state.eventSource.close();state.eventSource=null;}}
function updateNetworkState(){const element=document.getElementById("liveState");if(!element)return;element.classList.toggle("is-offline",!navigator.onLine);element.lastChild.textContent=navigator.onLine?" Güncel":" Çevrimdışı";}
function handleViewError(error){if(error instanceof ApiError&&[401,403].includes(error.status)){if(error.status===401)return showAuth("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");}content.innerHTML=`<div class="error-state"><div><h2>Veriler alınamadı</h2><p>${escapeHtml(error.message||"Beklenmeyen hata")}</p><button class="ui-button ui-button--secondary" data-view-target="${escapeHtml(state.activeView)}">Yeniden dene</button></div></div>`;}
function toast(message,error=false){const element=document.getElementById("toast");element.textContent=message;element.classList.toggle("is-error",error);element.classList.add("is-visible");window.clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>element.classList.remove("is-visible"),3600);}
function roleLabel(role){return ({operasyon:"Operasyon",muhasebe:"Muhasebe",satın_alma:"Satın alma",yönetici:"Yönetici"})[role]||role||"Personel"}
function toggleSidebar(){if(matchMedia("(max-width:820px)").matches)return openMobileSidebar();app.classList.toggle("is-collapsed");const collapsed=app.classList.contains("is-collapsed");safeLocalStorageSet("tahmisci:fatura:sidebar",collapsed?"collapsed":"open");document.getElementById("sidebarToggle").setAttribute("aria-expanded",String(!collapsed));document.getElementById("sidebarToggle").title=collapsed?"Kenar çubuğunu aç":"Kenar çubuğunu kapat";}
function openMobileSidebar(){app.classList.add("is-mobile-open");document.getElementById("mobileMenu").setAttribute("aria-expanded","true");}
function closeMobileSidebar(){app.classList.remove("is-mobile-open");document.getElementById("mobileMenu").setAttribute("aria-expanded","false");}
function restoreSidebarPreference(){if(safeLocalStorageGet("tahmisci:fatura:sidebar")==="collapsed")app.classList.add("is-collapsed");}
function safeLocalStorageGet(key){try{return localStorage.getItem(key)||"";}catch(_error){return "";}}
function safeLocalStorageSet(key,value){try{localStorage.setItem(key,value);}catch(_error){}}
function consumeOpenIntent(){try{const raw=sessionStorage.getItem("tahmisci:fatura:intent");sessionStorage.removeItem("tahmisci:fatura:intent");if(!raw)return null;const parsed=JSON.parse(raw);return parsed&&typeof parsed==="object"?parsed:null;}catch(_error){return null;}}
