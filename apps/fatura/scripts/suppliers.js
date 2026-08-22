import { CAPABILITIES, escapeHtml, has, state, statusBadge, trMoney } from "./state.js";

export function renderSuppliers() {
  const query = String(state.filters.suppliers || "").toLocaleLowerCase("tr-TR");
  const suppliers = state.suppliers.filter((supplier) => !query || `${supplier.name} ${supplier.code} ${supplier.taxNumber}`.toLocaleLowerCase("tr-TR").includes(query));
  return `${toolbar("Tedarikçi, kod veya vergi no ara", "supplier-search", state.filters.suppliers, has(CAPABILITIES.supplierManage) ? '<button class="ui-button ui-button--primary" data-action="new-supplier">Tedarikçi ekle</button>' : "")}
    <p class="result-meta">${suppliers.length} tedarikçi gösteriliyor.</p>
    ${suppliers.length ? `<div class="card-grid">${suppliers.map(supplierCard).join("")}</div>` : empty("Henüz tedarikçi yok", "Yetkiniz varsa ilk tedarikçi kartını oluşturabilirsiniz.")}`;
}

export function renderProductLinks() {
  const query = String(state.filters.links || "").toLocaleLowerCase("tr-TR");
  const links = state.productLinks.filter((link) => !query || `${link.stockProductName} ${link.stockProductCode} ${link.supplierProductName} ${link.supplierProductCode}`.toLocaleLowerCase("tr-TR").includes(query));
  return `${toolbar("Stok ürünü veya tedarikçi kodu ara", "link-search", state.filters.links, has(CAPABILITIES.links) ? '<button class="ui-button ui-button--primary" data-action="new-link">Ürün eşleştir</button>' : "")}
    <p class="result-meta">${links.length} ürün–tedarikçi eşleşmesi.</p>
    ${links.length ? `<article class="panel-card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Stok ürünü</th><th>Tedarikçi</th><th>Tedarikçi kodu</th><th>Birim</th><th>Dönüşüm</th><th class="right">Varsayılan alış</th><th class="right">Son alış</th><th>Durum</th><th></th></tr></thead><tbody>${links.map(linkRow).join("")}</tbody></table></div></article>` : empty("Eşleşme bulunamadı", "Mevcut stockState.products kataloğundaki ürünleri tedarikçilere bağlayın.")}`;
}

function supplierCard(supplier) {
  return `<article class="entity-card"><div class="entity-footer" style="margin-top:0"><h3>${escapeHtml(supplier.name)}</h3>${statusBadge(supplier.active === false ? "passive" : "active")}</div><p>${escapeHtml(supplier.code || "Kodsuz")} · ${escapeHtml(supplier.taxNumber || "Vergi no yok")}</p><div class="entity-meta"><div><span>Vade</span><strong>${Number(supplier.paymentTermDays || 0)} gün</strong></div><div><span>Cari borç</span><strong>${supplier.debtKurus === null ? "Yetki gerekli" : trMoney(supplier.debtKurus)}</strong></div><div><span>Telefon</span><strong>${escapeHtml(supplier.phone || "—")}</strong></div><div><span>E-posta</span><strong>${escapeHtml(supplier.email || "—")}</strong></div></div><div class="entity-footer"><span></span><button class="row-button" data-open-supplier="${escapeHtml(supplier.id)}">Detay</button></div></article>`;
}

function linkRow(link) {
  const supplier = state.suppliers.find((item) => item.id === link.supplierId);
  return `<tr><td data-label="Stok ürünü"><strong>${escapeHtml(link.stockProductName || "Katalogda yok")}</strong><br><span class="result-meta">${escapeHtml(link.stockProductCode)}</span></td><td data-label="Tedarikçi">${escapeHtml(supplier && supplier.name || link.supplierId)}</td><td data-label="Tedarikçi kodu">${escapeHtml(link.supplierProductCode || "—")}</td><td data-label="Birim">${escapeHtml(link.purchaseUnit || link.stockProductUnit || "—")}</td><td data-label="Dönüşüm">${escapeHtml(link.conversionFactor || 1)}</td><td data-label="Varsayılan alış" class="right">${trMoney(link.defaultPurchasePriceKurus)}</td><td data-label="Son alış" class="right">${trMoney(link.lastPurchasePriceKurus)}</td><td data-label="Durum">${statusBadge(link.active === false ? "passive" : "active")}</td><td class="actions">${has(CAPABILITIES.links) ? `<button class="row-button" data-edit-link="${escapeHtml(link.id)}">Düzenle</button>` : ""}</td></tr>`;
}

function toolbar(placeholder, inputId, current, action) { return `<div class="section-toolbar"><div class="filters"><input class="toolbar-control" id="${inputId}" type="search" value="${escapeHtml(current || "")}" placeholder="${escapeHtml(placeholder)}"></div><div class="toolbar-actions">${action}</div></div>`; }
function empty(title, copy) { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></div>`; }
