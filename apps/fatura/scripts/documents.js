import { api } from "./api.js";
import { escapeHtml, state, trDate, trMoney } from "./state.js";

export function renderDocuments() {
  const query = normalize(state.filters.documents);
  const shipments = [...(state.shipments || [])]
    .filter((shipment) => shipment.status !== "taslak")
    .filter((shipment) => !query || normalize(`${shipment.supplier?.name} ${shipment.documentNumber} ${(shipment.items || []).map((item) => item.name).join(" ")}`).includes(query))
    .sort((left, right) => String(right.shipmentDate || right.documentDate || right.createdAt || "").localeCompare(String(left.shipmentDate || left.documentDate || left.createdAt || "")));
  return `<div class="section-toolbar"><div class="filters"><input class="toolbar-control" id="document-search" type="search" value="${escapeHtml(state.filters.documents || "")}" placeholder="Tedarikçi ara"></div></div><p class="result-meta">${shipments.length} sevkiyat kaydı.</p>${shipments.length ? `<div class="shipment-archive-grid">${shipments.map(archiveCard).join("")}</div>` : empty("Sevkiyat arşivi boş", "Tamamlanan tedarikçi sevkiyatları burada görünecek.")}`;
}

export function documentFormBody(defaultShipmentId = "") {
  return `<div class="form-grid"><label class="span-2">Belge görseli<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required></label><label>Belge türü<select name="documentType" required><option value="fatura">Fatura</option><option value="irsaliye">İrsaliye</option><option value="fiş">Fiş</option><option value="makbuz">Makbuz</option><option value="diğer">Diğer</option></select></label><label>Tedarikçi<select name="supplierId"><option value="">Seçilmedi</option>${state.suppliers.filter((item) => item.active !== false).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Belge no<input name="documentNumber" maxlength="120"></label><label>Belge tarihi<input name="documentDate" type="date"></label><label class="span-2">Sevkiyat<select name="shipmentId"><option value="">Bağımsız belge</option>${state.shipments.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === defaultShipmentId ? "selected" : ""}>${escapeHtml(item.supplier?.name || item.id)} · ${trDate(item.createdAt)}</option>`).join("")}</select></label></div>`;
}

function archiveCard(shipment) {
  const total = (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0);
  const unmatchedCount = Number(shipment.stockUnmatchedItemCount || (shipment.items || []).filter((item) => item.stockMatchStatus === "unmatched").length || 0);
  const unitMismatchCount = Number(shipment.stockUnitMismatchItemCount || (shipment.items || []).filter((item) => item.stockMatchStatus === "unit_mismatch").length || 0);
  const stock = shipment.stockAppliedAt ? (unmatchedCount ? "Eşleşenler stoğa işlendi" : "Stoğa işlendi") : unitMismatchCount ? "Birim eşleşmedi" : unmatchedCount ? "Stokla eşleşmedi" : shipment.status === "reddedildi" ? "Stok etkisi yok" : "Stoğa eklenmedi";
  return `<article class="shipment-archive-card"><header><div><p class="eyebrow">SEVKİYAT</p><h3>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")} — ${trDate(shipment.shipmentDate || shipment.documentDate || shipment.createdAt)}</h3></div><span>${escapeHtml(stock)}</span></header><div class="shipment-archive-facts"><div><span>Tarih</span><strong>${trDate(shipment.shipmentDate || shipment.documentDate || shipment.createdAt)}</strong></div><div><span>Ürün</span><strong>${(shipment.items || []).length} kalem</strong></div><div><span>Toplam</span><strong>${trMoney(total)}</strong></div></div><footer><button class="row-button" type="button" data-open-shipment="${escapeHtml(shipment.id)}">Görüntüle</button></footer></article>`;
}

export function shipmentArchiveDetail(shipment, documents = []) {
  const rows = Array.isArray(shipment.items) ? shipment.items : [];
  const total = rows.reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0);
  const evidence = documents.find((item) => item && !item.archivedAt);
  const unmatchedCount = Number(shipment.stockUnmatchedItemCount || rows.filter((item) => item.stockMatchStatus === "unmatched").length || 0);
  const unitMismatchCount = Number(shipment.stockUnitMismatchItemCount || rows.filter((item) => item.stockMatchStatus === "unit_mismatch").length || 0);
  const stockState = shipment.stockAppliedAt ? (unmatchedCount ? "Eşleşenler stoğa işlendi" : "Stoğa işlendi") : unitMismatchCount ? "Birim eşleşmedi" : unmatchedCount ? "Stokla eşleşmedi" : "Stoğa eklenmedi";
  return `<section class="shipment-receipt-detail"><header><div><small>TEDARİKÇİ</small><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")}</strong></div><div><small>SEVKİYAT TARİHİ</small><strong>${trDate(shipment.shipmentDate || shipment.documentDate || shipment.createdAt)}</strong></div></header><div class="shipment-receipt-lines">${rows.map((item) => `<article><div><strong>${escapeHtml(item.name || item.productName || "Ürün")}</strong><small>${escapeHtml(item.stockMatchStatus === "unit_mismatch" ? "Birim eşleşmedi" : item.stockMatchStatus === "unmatched" ? "Stokla eşleşmedi" : stockState)}</small></div><span>${Number(item.quantityBulk ?? item.quantity ?? 0)} ${escapeHtml(item.bulkUnit || item.purchaseUnit || item.unit || "")}</span><b>${trMoney(item.totalKurus || item.lineTotalKurus || 0)}</b></article>`).join("") || '<p>Ürün satırı bulunmuyor.</p>'}</div><footer><span>TOPLAM</span><strong>${trMoney(total)}</strong></footer><div class="detail-actions detail-actions--spaced">${evidence ? `<button class="ui-button ui-button--secondary" type="button" data-open-document="${escapeHtml(evidence.id)}">Belgeyi Görüntüle</button>` : ""}<button class="ui-button ui-button--primary" type="button" data-print-shipment="${escapeHtml(shipment.id)}">PDF Çıktı Al</button></div></section>`;
}

export async function printShipmentArchive(shipmentId) {
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}`, { dedupe: false });
  const shipment = payload.shipment || {};
  const documents = (payload.documents || []).filter((item) => !item.archivedAt);
  const total = (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0);
  const receipt = `<section class="print-page receipt"><header><div><small>TAHMİSÇİ FATURA</small><h1>Sevkiyat Fişi</h1></div><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")}</strong></header><dl><div><dt>Tarih</dt><dd>${trDate(shipment.shipmentDate || shipment.documentDate || shipment.createdAt, true)}</dd></div><div><dt>Sevkiyat No</dt><dd>${escapeHtml(shipment.id || "—")}</dd></div><div><dt>Hedef depo</dt><dd>${escapeHtml(shipment.destinationLocationName || "Stoğa işlenmedi")}</dd></div></dl><table><thead><tr><th>Ürün</th><th>Miktar</th><th>Temel miktar</th><th>Tutar</th></tr></thead><tbody>${(shipment.items || []).map((item) => `<tr><td>${escapeHtml(item.name || item.productName || "Ürün")}</td><td>${Number(item.quantityBulk ?? item.quantity ?? 0)} ${escapeHtml(item.bulkUnit || item.purchaseUnit || item.unit || "")}</td><td>${Number(item.baseQuantity || 0)} ${escapeHtml(item.baseUnit || item.baseUnitSnapshot || "")}</td><td>${trMoney(item.totalKurus || item.lineTotalKurus || 0)}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="3">Genel toplam</th><th>${trMoney(total)}</th></tr></tfoot></table></section>`;
  let evidenceUrl = "";
  if (documents[0]) {
    try {
      const blob = await api(`/documents/${encodeURIComponent(documents[0].id)}/content`, { responseType: "blob", dedupe: false });
      evidenceUrl = URL.createObjectURL(blob);
    } catch (_error) {
      evidenceUrl = "";
    }
  }
  const documentPage = evidenceUrl ? `<section class="print-page evidence"><h2>${escapeHtml(documents[0].documentType || "Belge")}</h2><img src="${escapeHtml(evidenceUrl)}" alt="Sevkiyat belgesi"></section>` : "";
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Yazdırma penceresi tarayıcı tarafından engellendi.");
  popup.opener = null;
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Sevkiyat ${escapeHtml(shipment.id || "")}</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;color:#32190e;font:14px Arial,sans-serif}.print-page{min-height:260mm}${documentPage ? ".receipt{page-break-after:always}" : ""}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #6b351f;padding-bottom:16px}h1{margin:4px 0;font-size:30px}dl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}dl div{padding:10px;border:1px solid #ddcdbc}dt{font-size:11px;color:#7e695b}dd{margin:5px 0 0;font-weight:700}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddcdbc;text-align:left}tfoot th{border-top:2px solid #6b351f}.evidence{display:grid;grid-template-rows:auto 1fr;gap:12px}.evidence img{width:100%;height:240mm;object-fit:contain}</style></head><body>${receipt}${documentPage}<script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);
  popup.document.close();
  if (evidenceUrl) setTimeout(() => URL.revokeObjectURL(evidenceUrl), 60000);
}

function empty(title, copy) { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></div>`; }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
