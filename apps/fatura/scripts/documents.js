import { api } from "./api.js";
import { escapeHtml, state, trDate, trMoney } from "./state.js";

export function renderDocuments() {
  const supplierId = String(state.filters.documentsSupplier || "");
  const selectedDate = String(state.filters.documentsDate || "");
  const shipments = [...(state.shipments || [])]
    .filter((shipment) => shipment.status !== "taslak")
    .filter((shipment) => !supplierId || shipmentSupplierId(shipment) === supplierId)
    .filter((shipment) => !selectedDate || shipmentDateKey(shipment) === selectedDate)
    .sort((left, right) => shipmentTimestamp(right) - shipmentTimestamp(left));
  const supplierOptions = (state.suppliers || [])
    .filter((supplier) => supplier.active !== false)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "tr"))
    .map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${String(supplier.id) === supplierId ? "selected" : ""}>${escapeHtml(supplier.name)}</option>`)
    .join("");
  return `<div class="section-toolbar shipment-archive-toolbar"><div class="filters shipment-archive-filters"><label><span>Tedarikçi</span><select class="toolbar-control" id="archive-supplier-filter"><option value="">Tedarikçi ara</option>${supplierOptions}</select></label><label><span>Tarih</span><input class="toolbar-control" id="archive-date-filter" type="date" value="${escapeHtml(selectedDate)}"></label></div></div><p class="result-meta">${shipments.length} sevkiyat kaydı · en yeni kayıt üstte.</p>${shipments.length ? `<div class="shipment-archive-list">${shipments.map(archiveRow).join("")}</div>` : empty("Sevkiyat arşivi boş", "Seçilen filtrelerle eşleşen sevkiyat bulunmuyor.")}`;
}

export function documentFormBody(defaultShipmentId = "") {
  return `<div class="form-grid"><label class="span-2">Belge görseli<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required></label><label>Belge türü<select name="documentType" required><option value="fatura">Fatura</option><option value="irsaliye">İrsaliye</option><option value="fiş">Fiş</option><option value="makbuz">Makbuz</option><option value="diğer">Diğer</option></select></label><label>Tedarikçi<select name="supplierId"><option value="">Seçilmedi</option>${state.suppliers.filter((item) => item.active !== false).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Belge no<input name="documentNumber" maxlength="120"></label><label>Belge tarihi<input name="documentDate" type="date"></label><label class="span-2">Sevkiyat<select name="shipmentId"><option value="">Bağımsız belge</option>${state.shipments.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === defaultShipmentId ? "selected" : ""}>${escapeHtml(item.supplier?.name || item.id)} · ${trDate(item.createdAt)}</option>`).join("")}</select></label></div>`;
}

function archiveRow(shipment) {
  const date = shipmentDate(shipment);
  return `<article class="shipment-archive-row"><div class="shipment-archive-row__main"><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")} - ${escapeHtml(numericDate(date))}</strong><span>${(shipment.items || []).length} ürün kalemi · ${trMoney(shipmentTotal(shipment))} · ${escapeHtml(stockStateText(shipment))}</span></div><div class="shipment-archive-row__actions"><button class="row-button" type="button" data-open-shipment="${escapeHtml(shipment.id)}">Görüntüle</button>${shipment.canRemove ? `<button class="row-button danger" type="button" data-remove-shipment="${escapeHtml(shipment.id)}">Kaldır</button>` : ""}</div></article>`;
}

export function shipmentArchiveDetail(shipment, documents = []) {
  const rows = Array.isArray(shipment.items) ? shipment.items : [];
  const total = shipmentTotal(shipment);
  const evidence = documents.find((item) => item && !item.archivedAt);
  const stockState = stockStateText(shipment);
  const destination = shipment.destinationLocationName || shipment.destinationWarehouseName || shipment.destinationLocation?.name || "Stoğa işlenmedi";
  const accountingState = accountingStateText(shipment, total);
  return `<section class="shipment-receipt-detail"><div class="shipment-receipt-toolbar"><div><small>SEVKİYAT FİŞİ</small><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")} - ${escapeHtml(numericDate(shipmentDate(shipment)))}</strong></div><button class="ui-button ui-button--primary" type="button" data-print-shipment="${escapeHtml(shipment.id)}" aria-label="Sevkiyat fişini PDF olarak indir">İndir</button></div><div class="shipment-impact-summary"><div><small>STOK</small><strong>${escapeHtml(destination)} · ${escapeHtml(stockState)}</strong></div><div><small>CARİ</small><strong>${escapeHtml(accountingState)}</strong></div><div><small>BELGE</small><strong>${evidence ? "Mevcut" : "Bulunmuyor"}</strong></div></div><div class="shipment-receipt-meta"><div><small>TEDARİKÇİ</small><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")}</strong></div><div><small>SEVKİYAT TARİHİ</small><strong>${trDate(shipmentDate(shipment))}</strong></div><div><small>HEDEF DEPO</small><strong>${escapeHtml(destination)}</strong></div><div><small>STOK DURUMU</small><strong>${escapeHtml(stockState)}</strong></div></div><div class="shipment-receipt-lines">${rows.map((item) => shipmentLine(item, stockState)).join("") || '<p>Ürün satırı bulunmuyor.</p>'}</div><footer><span>GENEL TOPLAM</span><strong>${trMoney(total)}</strong></footer><div class="detail-actions detail-actions--spaced">${evidence ? `<button class="ui-button ui-button--secondary" type="button" data-open-document="${escapeHtml(evidence.id)}">Belgeyi Görüntüle</button>` : ""}${shipment.canRemove ? '<button class="ui-button ui-button--danger" type="button" data-detail-action="remove-shipment">Kaldır</button>' : ""}</div></section>`;
}

function shipmentLine(item, stockState) {
  const quantity = Number(item.quantityBulk ?? item.quantity ?? 0);
  const total = Number(item.totalKurus || item.lineTotalKurus || 0);
  const unitPrice = Number(item.unitPriceKurus || (quantity > 0 ? Math.round(total / quantity) : 0));
  const status = item.stockMatchStatus === "unit_mismatch" ? "Birim eşleşmedi" : item.stockMatchStatus === "unmatched" ? "Stokla eşleşmedi" : stockState;
  return `<article><div class="shipment-receipt-line__product"><strong>${escapeHtml(item.name || item.productName || "Ürün")}</strong><small>${escapeHtml(status)}</small></div><div class="shipment-receipt-line__value"><small>MİKTAR</small><span>${formatNumber(quantity)} ${escapeHtml(item.bulkUnit || item.purchaseUnit || item.unit || "")}</span></div><div class="shipment-receipt-line__value"><small>FİYAT</small><span>${trMoney(unitPrice)}</span></div><div class="shipment-receipt-line__value shipment-receipt-line__total"><small>TOPLAM</small><b>${trMoney(total)}</b></div></article>`;
}

export async function printShipmentArchive(shipmentId) {
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}`, { dedupe: false });
  const shipment = payload.shipment || {};
  const pages = renderReceiptPages(shipment);
  const evidence = (payload.documents || []).find((item) => item && !item.archivedAt);
  if (evidence) {
    try {
      const blob = await api(`/documents/${encodeURIComponent(evidence.id)}/content`, { responseType: "blob", dedupe: false });
      const evidencePage = await renderEvidencePage(blob, evidence);
      if (evidencePage) pages.push(evidencePage);
    } catch (_error) {
      // Fiş, ek belge erişilemese de indirilebilir kalır.
    }
  }
  const pdf = await canvasesToPdf(pages);
  const fileName = `${slugify(shipment.supplier?.name || "tedarikci")}-${numericDate(shipmentDate(shipment))}.pdf`;
  const url = URL.createObjectURL(pdf);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function renderReceiptPages(shipment) {
  const items = Array.isArray(shipment.items) ? shipment.items : [];
  const chunks = [];
  for (let index = 0; index < Math.max(items.length, 1); index += 12) chunks.push(items.slice(index, index + 12));
  const total = shipmentTotal(shipment);
  return chunks.map((rows, pageIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdf9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#d9c6b4";
    context.lineWidth = 3;
    roundRect(context, 54, 54, 1132, 1646, 24); context.stroke();
    context.fillStyle = "#6b351f"; context.font = "700 24px Poppins, Arial"; context.fillText("TAHMİSÇİ FATURA", 96, 120);
    context.fillStyle = "#32190e"; context.font = "700 52px Poppins, Arial"; context.fillText(pageIndex ? `Sevkiyat Fişi · ${pageIndex + 1}` : "Sevkiyat Fişi", 96, 184);
    context.textAlign = "right"; context.font = "700 24px Poppins, Arial"; context.fillText(fitText(context, shipment.supplier?.name || "Tedarikçi belirtilmedi", 430), 1142, 148); context.textAlign = "left";
    context.strokeStyle = "#6b351f"; context.lineWidth = 4; context.beginPath(); context.moveTo(96, 222); context.lineTo(1144, 222); context.stroke();
    drawMetaBox(context, 96, 260, 324, "TARİH", trDate(shipmentDate(shipment), true));
    drawMetaBox(context, 446, 260, 324, "SEVKİYAT NO", shipment.id || "—");
    drawMetaBox(context, 796, 260, 348, "HEDEF DEPO", shipment.destinationLocationName || shipment.destinationWarehouseName || "Stoğa işlenmedi");
    drawTableHeader(context, 96, 406);
    let y = 468;
    rows.forEach((item) => { drawReceiptRow(context, item, y); y += 78; });
    if (!rows.length) { context.fillStyle = "#7e695b"; context.font = "400 22px Poppins, Arial"; context.fillText("Ürün satırı bulunmuyor.", 116, y + 38); }
    if (pageIndex === chunks.length - 1) {
      const totalY = Math.max(y + 30, 1460);
      context.fillStyle = "#6b351f"; roundRect(context, 760, totalY, 384, 92, 14); context.fill();
      context.fillStyle = "#fff"; context.font = "600 18px Poppins, Arial"; context.fillText("GENEL TOPLAM", 790, totalY + 40);
      context.textAlign = "right"; context.font = "700 28px Poppins, Arial"; context.fillText(trMoney(total), 1114, totalY + 43); context.textAlign = "left";
    }
    context.fillStyle = "#9a8474"; context.font = "400 16px Poppins, Arial"; context.fillText(`Tahmisçi Fatura · ${pageIndex + 1}/${chunks.length}`, 96, 1650);
    return canvas;
  });
}

function drawMetaBox(context, x, y, width, label, value) {
  context.fillStyle = "#f7f0e7"; roundRect(context, x, y, width, 104, 12); context.fill();
  context.fillStyle = "#7e695b"; context.font = "600 15px Poppins, Arial"; context.fillText(label, x + 20, y + 33);
  context.fillStyle = "#32190e"; context.font = "700 19px Poppins, Arial"; context.fillText(fitText(context, value, width - 40), x + 20, y + 72);
}

function drawTableHeader(context, x, y) {
  context.fillStyle = "#6b351f"; roundRect(context, x, y, 1048, 54, 10); context.fill();
  context.fillStyle = "#fff"; context.font = "600 17px Poppins, Arial";
  context.fillText("ÜRÜN", x + 18, y + 34); context.fillText("MİKTAR", x + 520, y + 34); context.fillText("BİRİM FİYAT", x + 716, y + 34); context.fillText("TOPLAM", x + 912, y + 34);
}

function drawReceiptRow(context, item, y) {
  const quantity = Number(item.quantityBulk ?? item.quantity ?? 0);
  const total = Number(item.totalKurus || item.lineTotalKurus || 0);
  const unitPrice = Number(item.unitPriceKurus || (quantity > 0 ? Math.round(total / quantity) : 0));
  context.fillStyle = "#fff"; context.strokeStyle = "#e4d6c8"; context.lineWidth = 2; roundRect(context, 96, y, 1048, 66, 9); context.fill(); context.stroke();
  context.fillStyle = "#32190e"; context.font = "600 19px Poppins, Arial"; context.fillText(fitText(context, item.name || item.productName || "Ürün", 460), 114, y + 41);
  context.font = "400 18px Poppins, Arial"; context.fillText(`${formatNumber(quantity)} ${item.bulkUnit || item.purchaseUnit || item.unit || ""}`, 616, y + 41); context.fillText(trMoney(unitPrice), 812, y + 41);
  context.font = "700 18px Poppins, Arial"; context.fillText(trMoney(total), 1008, y + 41);
}

async function renderEvidencePage(blob, evidence) {
  const canvas = document.createElement("canvas"); canvas.width = 1240; canvas.height = 1754;
  const context = canvas.getContext("2d");
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch (_error) { return null; }
  context.fillStyle = "#fffdf9"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#d9c6b4"; context.lineWidth = 3; roundRect(context, 54, 54, 1132, 1646, 24); context.stroke();
  context.fillStyle = "#32190e"; context.font = "700 34px Poppins, Arial"; context.fillText(String(evidence.documentType || "Sevkiyat Belgesi"), 92, 126);
  const maxWidth = 1056, maxHeight = 1460, scale = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height), width = bitmap.width * scale, height = bitmap.height * scale;
  context.drawImage(bitmap, (canvas.width - width) / 2, 170 + (maxHeight - height) / 2, width, height); bitmap.close?.();
  return canvas;
}

async function canvasesToPdf(canvases) {
  const images = await Promise.all(canvases.map((canvas) => new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
    if (!blob) return reject(new Error("PDF çıktısı hazırlanamadı."));
    resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }, "image/jpeg", 0.92))));
  const encoder = new TextEncoder(), chunks = [], offsets = [0]; let length = 0;
  const push = (value) => { const bytes = typeof value === "string" ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length; };
  push("%PDF-1.4\n"); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const kids = images.map((_image, index) => `${3 + index * 3} 0 R`).join(" ");
  const objects = new Map([[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, `<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`]]);
  images.forEach((image, index) => {
    const pageId = 3 + index * 3, contentId = pageId + 1, imageId = pageId + 2, content = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`); objects.set(imageId, image);
  });
  const objectCount = 2 + images.length * 3;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = length; push(`${id} 0 obj\n`); const body = objects.get(id);
    if (body && body.bytes) { push(`<< /Type /XObject /Subtype /Image /Width ${body.width} /Height ${body.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${body.bytes.length} >>\nstream\n`); push(body.bytes); push("\nendstream"); }
    else push(body || "<<>>");
    push("\nendobj\n");
  }
  const xrefOffset = length; push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objectCount; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

function roundRect(context, x, y, width, height, radius) { context.beginPath(); context.roundRect(x, y, width, height, radius); }
function fitText(context, value, maxWidth) { const text = String(value || "—"); if (context.measureText(text).width <= maxWidth) return text; let fitted = text; while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1); return `${fitted}…`; }
function shipmentTotal(shipment) { return (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0); }
function shipmentDate(shipment) { return shipment.shipmentDate || shipment.documentDate || shipment.createdAt || ""; }
function shipmentDateKey(shipment) { const value = String(shipmentDate(shipment)); return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : toDateKey(value); }
function shipmentTimestamp(shipment) { const time = new Date(shipmentDate(shipment)).getTime(); return Number.isFinite(time) ? time : 0; }
function shipmentSupplierId(shipment) { return String(shipment.supplierId || shipment.supplier?.id || ""); }
function stockStateText(shipment) {
  const items = shipment.items || [], unmatched = Number(shipment.stockUnmatchedItemCount || items.filter((item) => item.stockMatchStatus === "unmatched").length || 0), mismatched = Number(shipment.stockUnitMismatchItemCount || items.filter((item) => item.stockMatchStatus === "unit_mismatch").length || 0);
  if (shipment.stockStatus === "reversed") return "Stok geri alındı";
  if (shipment.stockStatus === "failed") return "Stok aktarımı başarısız";
  if (shipment.stockDecision === "declined" || shipment.stockStatus === "not_applied") return "Stoğa aktarılmadı";
  if (shipment.stockAppliedAt) return unmatched || mismatched ? "Eşleşenler stoğa işlendi" : "Stoğa işlendi";
  if (mismatched) return "Birim eşleşmedi";
  if (unmatched) return "Stokla eşleşmedi";
  if (shipment.status === "reddedildi") return "Stok etkisi yok";
  return "Stoğa aktarılmadı";
}
function accountingStateText(shipment,total){if(shipment.accountingStatus==="posted")return `${trMoney(total)} borç işlendi`;if(shipment.accountingStatus==="reversed")return "Cari etkisi geri alındı";if(shipment.accountingStatus==="failed")return "Cari kayıt başarısız";return "İşlenmedi";}
function numericDate(value) { const date = /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : new Date(value); if (Number.isNaN(date.getTime())) return "tarihsiz"; return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`; }
function toDateKey(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function slugify(value) { return String(value || "tedarikci").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tedarikci"; }
function formatNumber(value) { return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value || 0)); }
function empty(title, copy) { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></div>`; }
