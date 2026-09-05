import { escapeHtml, hasSection, state, statusBadge, trDate, trMoney } from "./state.js";

export function renderDashboard() {
  const dashboard = state.dashboard || {};
  const shipments = [...(state.shipments || [])]
    .filter((item) => item.status !== "taslak")
    .sort((left, right) => String(right.shipmentDate || right.documentDate || right.createdAt || "").localeCompare(String(left.shipmentDate || left.documentDate || left.createdAt || "")))
    .slice(0, 10);
  const actor = state.context && state.context.actor;
  const metrics = ((actor && actor.type === "admin") || hasSection("ledger")) ? [
    metric("Güncel Borç", dashboard.debtKurus, "debt", "debt"),
    metric("Yapılan Ödemeler", dashboard.paymentKurus, "payments", "payment"),
    metric("Kalan Ödemeler", dashboard.remainingKurus, "remaining", "remaining")
  ] : [];
  return `${metrics.length ? `<div class="metric-grid metric-grid--three">${metrics.join("")}</div>` : ""}
    <article class="panel-card dashboard-shipments"><div class="panel-head"><div><p class="eyebrow">SON YAPILAN SEVKİYATLAR</p><h2>Son Yapılan Sevkiyatlar</h2><p>Tedarikçi sevkiyatları en yeni kayıttan başlayarak listelenir.</p></div><button class="row-button" data-view-target="documents">Arşivi aç</button></div><div class="list">${shipments.length ? shipments.map(shipmentRow).join("") : emptyInline("Henüz tamamlanmış sevkiyat bulunmuyor.")}</div></article>`;
}

function metric(label, value, mode, color) {
  return `<button class="metric-card metric-card--button" type="button" data-action="dashboard-ledger" data-ledger-mode="${mode}" ${state.dashboard?.financialVisible ? "" : "disabled"}><span>${escapeHtml(label)}</span><strong class="finance-${color}">${state.dashboard?.financialVisible ? trMoney(value) : "Yetki gerekli"}</strong><small>Cari detaylarını görüntüle</small></button>`;
}

function shipmentRow(shipment) {
  const total = (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0);
  const stockState = shipment.stockAppliedAt ? "Stoğa işlendi" : shipment.status === "reddedildi" ? "Reddedildi" : "Stok bekliyor";
  return `<button class="list-row dashboard-list-row" type="button" data-open-shipment="${escapeHtml(shipment.id)}"><div class="list-main"><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")}</strong><span>${trDate(shipment.shipmentDate || shipment.documentDate || shipment.createdAt, true)} · ${(shipment.items || []).length} ürün · ${trMoney(total)}</span></div><span class="shipment-stock-state">${escapeHtml(stockState)}</span>${statusBadge(shipment.status)}</button>`;
}

function emptyInline(message) { return `<div class="list-row"><div class="list-main"><span>${escapeHtml(message)}</span></div></div>`; }
