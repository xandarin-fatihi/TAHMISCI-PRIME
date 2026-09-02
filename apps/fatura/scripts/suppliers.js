import { CAPABILITIES, escapeHtml, has, state, statusBadge } from "./state.js";

export function renderSuppliers() {
  const workspace = state.supplierWorkspace || {};
  if (workspace.supplierId) return renderSupplierWorkspace(workspace.supplierId);
  const query = normalize(state.filters.suppliers);
  const suppliers = state.suppliers.filter((supplier) => !query || normalize(`${supplier.name} ${supplier.contactName} ${supplier.phone}`).includes(query));
  return `${toolbar(has(CAPABILITIES.supplierManage) ? '<button class="ui-button ui-button--primary" data-action="new-supplier">Tedarikçi Ekle</button>' : "")}
    <p class="result-meta">${suppliers.length} tedarikçi gösteriliyor.</p>
    ${suppliers.length ? `<div class="card-grid supplier-card-grid">${suppliers.map(supplierCard).join("")}</div>` : empty("Henüz tedarikçi yok", "İlk tedarikçi kaydını oluşturabilirsiniz.")}`;
}

export function renderSupplierWorkspace(supplierId) {
  const supplier = state.suppliers.find((item) => String(item.id) === String(supplierId));
  const workspace = state.supplierWorkspace || {};
  if (!supplier) return empty("Tedarikçi bulunamadı", "Tedarikçi listesine dönün.");
  if (workspace.loading) return '<div class="supplier-workspace"><div class="loading-skeleton" aria-label="Tedarikçi ürünleri yükleniyor"><span></span><span></span><span></span></div></div>';
  const products = canonicalProducts(workspace);
  return `<section class="supplier-workspace" aria-label="${escapeHtml(supplier.name)} tedarikçi çalışma alanı">
    <header class="supplier-workspace__header supplier-workspace__header--actions"><div class="supplier-workspace__actions">${has(CAPABILITIES.supplierManage) || has(CAPABILITIES.links) ? '<button class="ui-button ui-button--primary" type="button" data-action="supplier-add-product">Ürün Ekle</button>' : ""}${has(CAPABILITIES.receiptCreate) ? '<button class="ui-button ui-button--secondary" type="button" data-action="supplier-create-shipment">Sevkiyat Oluştur</button>' : ""}<details class="supplier-secondary-menu"><summary aria-label="Tedarikçi işlemleri">•••</summary><div>${has(CAPABILITIES.supplierManage) ? '<button type="button" data-supplier-workspace-action="edit">Tedarikçiyi düzenle</button><button type="button" data-supplier-workspace-action="deactivate">Pasife al</button>' : ""}${has(CAPABILITIES.accountingRead) ? '<button type="button" data-supplier-workspace-action="ledger">Cari hesabı aç</button>' : ""}</div></details></div></header>
    <section class="supplier-products"><header><div><h3>Ürün Kalemleri</h3><p>${products.filter((item) => item.active !== false).length} aktif ürün</p></div></header>
      ${products.length ? `<div class="supplier-product-list">${products.map(supplierProductRow).join("")}</div>` : empty("Ürün kaydı bulunmuyor", "Bu tedarikçinin toplu ve temel birim bilgisini içeren ilk ürününü ekleyin.")}
    </section>
  </section>`;
}

function canonicalProducts(workspace) {
  const independent = (workspace.independentProducts || []).filter((item) => item.active !== false).map((item) => ({ ...item, productType: "canonical" }));
  const names = new Set(independent.map((item) => normalize(item.name)));
  const legacy = (workspace.productLinks || []).filter((item) => item.active !== false && !names.has(normalize(item.supplierProductName || item.stockProductName))).map((item) => ({ ...item, id: item.id, name: item.supplierProductName || item.stockProductName, bulkUnit: item.purchaseUnit, baseUnit: item.stockProductUnit || "adet", productType: "legacy" }));
  return [...independent, ...legacy].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "tr"));
}

export function renderProductLinks() { return empty("Ürün kayıtları taşındı", "Ürün eşleşmelerini ilgili tedarikçinin içinden yönetin."); }

function supplierCard(supplier) {
  return `<article class="entity-card supplier-card"><div class="entity-footer entity-card__head"><h3>${escapeHtml(supplier.name)}</h3>${statusBadge(supplier.active === false ? "passive" : "active")}</div><div class="supplier-card__facts"><div><span>Tedarikçi</span><strong>${escapeHtml(supplier.contactName || "—")}</strong></div><div><span>Telefon</span><strong>${escapeHtml(supplier.phone || "—")}</strong></div></div><div class="entity-footer"><span></span><button class="row-button" data-open-supplier="${escapeHtml(supplier.id)}">Tedarikçiyi Aç →</button></div></article>`;
}

function supplierProductRow(item) {
  const editable = item.productType === "canonical" && (has(CAPABILITIES.supplierManage) || has(CAPABILITIES.links));
  const bulk = item.bulkUnit || item.purchaseUnit || "—";
  const base = item.baseUnit || item.stockProductUnit || "—";
  return `<article class="supplier-product-row ${item.active === false ? "is-passive" : ""}"><div class="supplier-product-row__identity"><span>Ürün adı</span><strong>${escapeHtml(item.name || "Ürün")}</strong></div><div class="supplier-product-row__metric"><span>Toplu birim</span><strong>${escapeHtml(bulk)}</strong></div><div class="supplier-product-row__metric"><span>Temel birim</span><strong>${escapeHtml(base)}</strong></div><div class="supplier-product-row__metric supplier-product-row__conversion"><span>Dönüşüm</span><strong>1 ${escapeHtml(bulk)} = ${Number(item.conversionFactor || 1)} ${escapeHtml(base)}</strong></div><div class="supplier-product-row__actions">${editable ? `<button class="row-button" type="button" data-edit-independent-product="${escapeHtml(item.id)}">Düzenle</button>${item.active !== false ? `<button class="row-button is-danger" type="button" data-deactivate-independent-product="${escapeHtml(item.id)}">Sil</button>` : ""}` : ""}</div></article>`;
}

function toolbar(action) { return `<div class="section-toolbar"><div class="filters"><input class="toolbar-control" id="supplier-search" type="search" value="${escapeHtml(state.filters.suppliers || "")}" placeholder="Tedarikçi ara"></div><div class="toolbar-actions">${action}</div></div>`; }
function empty(title, copy) { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></div>`; }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
