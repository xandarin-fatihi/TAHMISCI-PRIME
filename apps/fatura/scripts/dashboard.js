import { escapeHtml, hasSection, state, statusBadge, trDate, trMoney } from "./state.js";

export function renderDashboard() {
  const dashboard = state.dashboard || {};
  const shipments = state.shipments || [];
  const suppliers = state.suppliers || [];
  const recent = shipments.slice(0, 6);
  const debtSuppliers = suppliers.filter((supplier) => Number(supplier.debtKurus || 0) > 0).sort((a, b) => b.debtKurus - a.debtKurus).slice(0, 6);
  const metrics = [];
  if (hasSection("ledger")) {
    metrics.push(metric("Toplam tedarikçi borcu", dashboard.financialVisible ? trMoney(dashboard.supplierDebtKurus) : "Yetki gerekli", "Cari hareketlerden hesaplanır", ""));
    metrics.push(metric("Bu ay alınan ürün", dashboard.financialVisible ? trMoney(dashboard.monthPurchasesKurus) : "—", "Muhasebeleştirilmiş belgeler", ""));
    metrics.push(metric("Bu ay yapılan ödeme", dashboard.financialVisible ? trMoney(dashboard.monthPaymentsKurus) : "—", "Cari ödemeler", ""));
    metrics.push(metric("Yaklaşan vade", dashboard.dueSoon || 0, "Tanımlı takip aralığı", dashboard.dueSoon ? "is-warning" : ""));
    metrics.push(metric("Geciken ödeme", dashboard.overdue || 0, "Öncelikli takip", dashboard.overdue ? "is-danger" : ""));
  }
  if (hasSection("shipments")) {
    metrics.push(metric("Onay bekleyen mal kabul", dashboard.pendingShipments || 0, "Stok henüz etkilenmedi", dashboard.pendingShipments ? "is-warning" : ""));
    if (hasSection("ledger")) metrics.push(metric("Muhasebe bekleyen", dashboard.unaccountedShipments || 0, "Stok onayından bağımsız", dashboard.unaccountedShipments ? "is-warning" : ""));
    if (hasSection("documents")) metrics.push(metric("Eksik belge", dashboard.missingDocuments || 0, "Sevkiyat gönderimine engel değil", dashboard.missingDocuments ? "is-warning" : ""));
  }
  const panels = [];
  if (hasSection("shipments")) panels.push(`<article class="panel-card"><div class="panel-head"><div><h2>Son mal kabuller</h2><p>Stok ve muhasebe durumları birlikte, etkileri ayrı gösterilir.</p></div><button class="row-button" data-view-target="shipments">Tümünü aç</button></div><div class="list">${recent.length ? recent.map(shipmentRow).join("") : emptyInline("Henüz mal kabul kaydı yok.")}</div></article>`);
  if (hasSection("ledger") && hasSection("suppliers")) panels.push(`<article class="panel-card"><div class="panel-head"><div><h2>Tedarikçi borçları</h2><p>Append-only cari defter özeti</p></div><button class="row-button" data-view-target="ledger">Cariyi aç</button></div><div class="list">${debtSuppliers.length ? debtSuppliers.map((supplier) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(supplier.name)}</strong><span>${escapeHtml(supplier.code || "Kodsuz")}</span></div><span class="list-value">${trMoney(supplier.debtKurus)}</span></div>`).join("") : emptyInline("Açık tedarikçi borcu yok.")}</div></article>`);
  if (hasSection("links")) panels.push(`<article class="panel-card"><div class="panel-head"><div><h2>Son fiyat değişimleri</h2><p>Tedarikçi ürün eşleşmelerindeki farklar</p></div></div><div class="list">${(dashboard.recentPriceChanges || []).length ? dashboard.recentPriceChanges.map((item) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(item.stockProductCode || "Ürün")}</strong><span>${trDate(item.updatedAt, true)}</span></div><span class="list-value">${trMoney(item.currentPriceKurus)}</span></div>`).join("") : emptyInline("Fiyat değişimi bulunmuyor.")}</div></article>`);
  return `
    ${metrics.length ? `<div class="metric-grid">${metrics.join("")}</div>` : ""}
    ${panels.length ? `<div class="content-grid">${panels.join("")}</div>` : '<div class="empty-state"><div><h2>Genel Bakış hazır</h2><p>Erişebildiğiniz bölümlerde veri oluştuğunda özetler burada gösterilir.</p></div></div>'}`;
}

function metric(label, value, foot, className) {
  return `<article class="metric-card ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(foot)}</small></article>`;
}
function shipmentRow(shipment) {
  return `<button class="list-row" type="button" data-open-shipment="${escapeHtml(shipment.id)}" style="width:100%;border:0;background:transparent;text-align:left;cursor:pointer"><div class="list-main"><strong>${escapeHtml(shipment.supplier && shipment.supplier.name || shipment.userName || "Sevkiyat")}</strong><span>${escapeHtml(shipment.userName || "Personel")} · ${trDate(shipment.createdAt, true)}</span></div>${statusBadge(shipment.status)} ${statusBadge(shipment.accountingStatus)}</button>`;
}
function emptyInline(message) { return `<div class="list-row"><div class="list-main"><span>${escapeHtml(message)}</span></div></div>`; }
