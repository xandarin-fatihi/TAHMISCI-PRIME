import { CAPABILITIES, comboField, escapeHtml, has, state, statusBadge, trDate, trMoney } from "./state.js";

export function renderShipments() {
  const query = String(state.filters.shipments || "").toLocaleLowerCase("tr-TR");
  const status = String(state.filters.shipmentStatus || "");
  const rows = state.shipments.filter((shipment) => {
    if (status && shipment.status !== status) return false;
    const haystack = `${shipment.id} ${shipment.userName} ${shipment.supplier && shipment.supplier.name} ${(shipment.items || []).map((item) => item.name).join(" ")}`.toLocaleLowerCase("tr-TR");
    return !query || haystack.includes(query);
  });
  return `<div class="section-toolbar"><div class="filters"><input class="toolbar-control" id="shipment-search" type="search" value="${escapeHtml(state.filters.shipments || "")}" placeholder="Sevkiyat, tedarikçi veya ürün ara"><select class="toolbar-control" id="shipment-status"><option value="">Tüm durumlar</option>${["taslak","onay_bekliyor","onaylandı","reddedildi"].map((item) => `<option value="${item}" ${status === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select></div><div class="toolbar-actions">${has(CAPABILITIES.receiptCreate) ? '<button class="ui-button ui-button--primary" data-action="new-shipment">Yeni mal kabul</button>' : ""}</div></div>
    <p class="result-meta">${rows.length} mal kabul kaydı. Stok onayı ve muhasebe ayrı işlemlerdir.</p>
    ${rows.length ? `<article class="panel-card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Tarih</th><th>Tedarikçi</th><th>Gönderen</th><th>Ürün</th><th>Stok</th><th>Muhasebe</th><th>Belge</th><th class="right">Tutar</th><th></th></tr></thead><tbody>${rows.map(shipmentRow).join("")}</tbody></table></div></article>` : empty("Mal kabul kaydı bulunamadı", "Filtreyi temizleyin veya yetkiniz varsa yeni kayıt oluşturun.")}`;
}

export function shipmentDetail(shipment, documents = [], ledgerEntries = []) {
  const items = shipment.items || [];
  const total = items.reduce((sum, item) => sum + Number(item.totalKurus || 0), 0);
  const locations = state.context && state.context.stockLocations || [];
  const destinationSelect = shipment.canApprove ? `<label class="detail-stock-location">Hedef depo<select id="shipmentDestinationLocation">${locations.map((location) => `<option value="${escapeHtml(location.id)}" ${String(location.id) === String(shipment.destinationLocationId || "") ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}</select></label>` : "";
  return `<div class="detail-actions">
      ${destinationSelect}
      ${shipment.canApprove ? '<button class="ui-button ui-button--primary" data-detail-action="approve-stock">Stoğu onayla</button>' : ""}
      ${shipment.canReject ? '<button class="ui-button ui-button--danger" data-detail-action="reject-shipment">Reddet</button>' : ""}
      ${shipment.canAccount ? '<button class="ui-button ui-button--secondary" data-detail-action="account-shipment">Muhasebeleştir</button>' : ""}
      ${has(CAPABILITIES.documentsUpload) ? '<button class="ui-button ui-button--secondary" data-detail-action="upload-shipment-document">Belge ekle</button>' : ""}
      ${shipment.canEdit && shipment.status === "taslak" && has(CAPABILITIES.receiptSubmit) ? '<button class="ui-button ui-button--primary" data-detail-action="submit-shipment">Yönetici onayına gönder</button>' : ""}
      ${shipment.canDelete ? '<button class="ui-button ui-button--danger" data-detail-action="delete-shipment">Sil</button>' : ""}
    </div>
    <div class="detail-grid"><div class="detail-box"><span>Operasyon durumu</span><strong>${statusBadge(shipment.status)}</strong></div><div class="detail-box"><span>Stok etkisi</span><strong>${shipment.stockAppliedAt ? `Uygulandı · ${trDate(shipment.stockAppliedAt, true)}` : "Henüz stok değişmedi"}</strong></div><div class="detail-box"><span>Hedef depo</span><strong>${escapeHtml(shipment.destinationLocationName || locations.find((item) => String(item.id) === String(shipment.destinationLocationId))?.name || "Onayda seçilecek")}</strong></div><div class="detail-box"><span>Muhasebe</span><strong>${statusBadge(shipment.accountingStatus)}</strong></div><div class="detail-box"><span>Tedarikçi</span><strong>${escapeHtml(shipment.supplier && shipment.supplier.name || "Belirtilmedi")}</strong></div><div class="detail-box"><span>Gönderen</span><strong>${escapeHtml(shipment.userName || "Personel")}</strong></div><div class="detail-box"><span>Toplam</span><strong>${trMoney(total)}</strong></div></div>
    <article class="panel-card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Ürün</th><th>Miktar</th><th class="right">Birim fiyat</th><th class="right">Vergi</th><th class="right">Toplam</th></tr></thead><tbody>${items.map((item) => `<tr><td data-label="Ürün">${escapeHtml(item.name || item.stockProductCode)}</td><td data-label="Miktar">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td><td data-label="Birim fiyat" class="right">${trMoney(item.unitPriceKurus)}</td><td data-label="Vergi" class="right">${trMoney(item.taxKurus)}</td><td data-label="Toplam" class="right">${trMoney(item.totalKurus)}</td></tr>`).join("")}</tbody></table></div></article>
    <div class="content-grid" style="margin-top:14px"><article class="panel-card"><div class="panel-head"><div><h2>Belgeler</h2><p>Belge kanıtı stok veya cariyi otomatik etkilemez.</p></div></div><div class="list">${documents.length ? documents.map((doc) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(doc.documentNumber || doc.originalName)}</strong><span>${escapeHtml(doc.documentType)} · ${trDate(doc.documentDate || doc.createdAt)}</span></div><button class="row-button" data-open-document="${escapeHtml(doc.id)}">Aç</button></div>`).join("") : '<div class="list-row"><div class="list-main"><span>Belge eklenmemiş.</span></div></div>'}</div></article><article class="panel-card"><div class="panel-head"><div><h2>Cari kayıtları</h2><p>Append-only hareket geçmişi</p></div></div><div class="list">${ledgerEntries.length ? ledgerEntries.map((entry) => `<div class="list-row"><div class="list-main"><strong>${ledgerType(entry.type)}</strong><span>${trDate(entry.createdAt, true)}</span></div><span class="list-value">${trMoney(entry.amountKurus)}</span></div>`).join("") : '<div class="list-row"><div class="list-main"><span>Muhasebe kaydı yok.</span></div></div>'}</div></article></div>`;
}

export function shipmentFormBody() {
  const suppliers = state.suppliers.filter((item) => item.active !== false);
  const products = state.context && state.context.stockProducts || [];
  const locations = state.context && state.context.stockLocations || [];
  return `<div class="form-section"><h3>Sevkiyat bilgileri</h3><div class="form-grid">${comboField({ name: "supplierId", label: "Tedarikçi", items: suppliers.map((item) => ({ id: item.id, label: `${item.name}${item.code ? ` · ${item.code}` : ""}` })), placeholder: "İlk harften itibaren tedarikçi ara" })}<label>Hedef depo<select name="destinationLocationId" required>${locations.map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`).join("")}</select></label><label>Belge türü<select name="documentType"><option value="">Belge yok</option><option value="irsaliye">İrsaliye</option><option value="fatura">Fatura</option><option value="fiş">Fiş</option><option value="makbuz">Makbuz</option><option value="diğer">Diğer</option></select></label><label>Belge no<input name="documentNumber" maxlength="120"></label><label>Belge tarihi<input name="documentDate" type="date"></label><label class="span-2">Not<textarea name="note" maxlength="1000"></textarea></label></div></div>
    <div class="form-section"><div class="section-toolbar"><h3>Ürün satırları</h3><button class="ui-button ui-button--secondary ui-button--sm" data-action="add-shipment-line" type="button">Satır ekle</button></div><div class="shipment-lines" id="shipmentLines">${shipmentLine(products, 0)}</div></div>
    <label class="check-field" style="margin-top:12px"><input type="checkbox" name="submitNow" value="1" checked><span>Kaydettikten sonra yönetici onayına gönder</span></label>`;
}

export function shipmentLine(products, index) {
  return `<div class="shipment-line" data-line-index="${index}">${comboField({ name: "stockProductId", label: "Stok ürünü", items: products.map((item) => ({ id: item.id, label: `${item.name} · ${item.productCode || "Kodsuz"}` })), placeholder: "İlk harften itibaren ürün ara", required: true })}<label>Miktar<input name="quantity" type="number" min="0.001" step="0.001" required></label><label>Birim<select name="unit" required><option value="">Önce ürün seçin</option></select></label><label>Birim fiyat (₺)<input name="unitPrice" type="number" min="0" step="0.01" value="0"></label><button class="remove-line" type="button" data-action="remove-shipment-line" aria-label="Satırı kaldır">×</button></div>`;
}

function shipmentRow(shipment) {
  const count = (shipment.items || []).length;
  const total = (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || 0), 0);
  return `<tr><td data-label="Tarih">${trDate(shipment.createdAt, true)}</td><td data-label="Tedarikçi"><strong>${escapeHtml(shipment.supplier && shipment.supplier.name || "Belirtilmedi")}</strong></td><td data-label="Gönderen">${escapeHtml(shipment.userName || "—")}</td><td data-label="Ürün">${count} kalem</td><td data-label="Stok">${shipment.stockAppliedAt ? statusBadge("onaylandı") : statusBadge(shipment.status)}</td><td data-label="Muhasebe">${statusBadge(shipment.accountingStatus)}</td><td data-label="Belge">${statusBadge(shipment.evidenceStatus)}</td><td data-label="Tutar" class="right">${trMoney(total)}</td><td class="actions"><button class="row-button" data-open-shipment="${escapeHtml(shipment.id)}">İncele</button></td></tr>`;
}
function statusLabel(value){return ({taslak:"Taslak",onay_bekliyor:"Onay bekliyor",onaylandı:"Onaylandı",reddedildi:"Reddedildi"})[value]||value}
function ledgerType(value){return ({invoice:"Fatura / borç",payment:"Ödeme",credit_note:"Alacak dekontu",reversal:"Ters kayıt",opening_balance:"Açılış",adjustment:"Düzeltme"})[value]||value}
function empty(title, copy) { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></div>`; }
