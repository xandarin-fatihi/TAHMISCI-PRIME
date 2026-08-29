import { api } from "./api.js";
import { escapeHtml, state, trDate, trMoney, updateRevision } from "./state.js";

let searchTimer = null;
let eventTimer = null;
let loadSequence = 0;

export async function loadProductAnalysis({ force = false, productId = "" } = {}) {
  const model = state.productAnalysis;
  const requestedProductId = String(productId || model.selectedProductId || "");
  if (force) {
    model.productsStale = true;
    model.detailStale = true;
  }
  if (!model.products.length || model.productsStale) {
    const result = await api("/analytics/products?query=&limit=500");
    model.products = Array.isArray(result.products) ? result.products : [];
    model.productsStale = false;
    if (Number.isFinite(Number(result.catalogRevision))) state.revisions.catalog = Math.max(state.revisions.catalog || 0, Number(result.catalogRevision));
  }
  if (requestedProductId && (!model.detail || String(model.detail.product?.id) !== requestedProductId || model.detailStale)) {
    await loadProductDetail(requestedProductId, model.range);
  } else if (!requestedProductId) {
    model.selectedProductId = "";
    model.detail = null;
  }
  model.loaded = true;
  return model;
}

async function loadProductDetail(productId, range = "30d") {
  const sequence = ++loadSequence;
  state.productAnalysis.loading = true;
  try {
    const result = await api(`/analytics/products/${encodeURIComponent(productId)}?range=${encodeURIComponent(range)}`, { dedupe: false });
    if (sequence !== loadSequence) return;
    updateRevision(result);
    state.productAnalysis.selectedProductId = String(productId);
    state.productAnalysis.detail = result;
    state.productAnalysis.detailStale = false;
  } finally {
    if (sequence === loadSequence) state.productAnalysis.loading = false;
  }
}

export function renderProductAnalysis() {
  const model = state.productAnalysis;
  const matches = filteredProducts(model.query);
  const detail = model.detail;
  return `<section class="product-analysis" aria-label="Ürün analizi">
    <div class="product-analysis-search-shell">
      <label class="product-analysis-search"><span class="sr-only">Ürün ara</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="productAnalysisSearch" type="search" value="${escapeHtml(model.query)}" placeholder="Ürün ara…" autocomplete="off" aria-controls="productAnalysisResults" aria-expanded="${model.resultsOpen}"><span class="product-analysis-live"><i aria-hidden="true"></i>Canlı</span></label>
      <div class="product-analysis-results" id="productAnalysisResults" ${model.resultsOpen ? "" : "hidden"}>${renderSearchResults(matches)}</div>
    </div>
    ${detail ? renderDetail(detail) : renderEmpty()}
  </section>`;
}

export function bindProductAnalysisInteractions() {
  const root = document.querySelector(".product-analysis");
  if (!root || root.dataset.bound === "true") return;
  root.dataset.bound = "true";
  const input = root.querySelector("#productAnalysisSearch");
  input?.addEventListener("focus", () => { state.productAnalysis.resultsOpen = true; updateResults(root); });
  input?.addEventListener("input", () => {
    state.productAnalysis.query = input.value;
    state.productAnalysis.resultsOpen = true;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => updateResults(root), 90);
  });
  input?.addEventListener("keydown", handleSearchKeydown);
  root.addEventListener("click", async (event) => {
    const result = event.target.closest("[data-product-analysis-select]");
    if (result) {
      await selectProduct(result.dataset.productAnalysisSelect);
      return;
    }
    const clear = event.target.closest("[data-product-analysis-clear]");
    if (clear) {
      state.productAnalysis.selectedProductId = "";
      state.productAnalysis.detail = null;
      state.productAnalysis.query = "";
      replaceProductUrl("");
      rerender();
    }
  });
  root.addEventListener("change", async (event) => {
    if (event.target.id !== "productAnalysisRange") return;
    state.productAnalysis.range = event.target.value;
    state.productAnalysis.detailStale = true;
    await loadProductDetail(state.productAnalysis.selectedProductId, state.productAnalysis.range);
    rerender();
  });
}

function handleSearchKeydown(event) {
  const root = event.currentTarget.closest(".product-analysis");
  const results = [...root.querySelectorAll("[data-product-analysis-select]")];
  if (event.key === "Escape") {
    state.productAnalysis.resultsOpen = false;
    updateResults(root);
    return;
  }
  if (event.key === "Enter" && results.length) {
    event.preventDefault();
    selectProduct(results[0].dataset.productAnalysisSelect).catch(() => {});
  }
}

async function selectProduct(productId) {
  state.productAnalysis.resultsOpen = false;
  state.productAnalysis.detailStale = true;
  replaceProductUrl(productId);
  await loadProductDetail(productId, state.productAnalysis.range);
  rerender();
}

function replaceProductUrl(productId) {
  if (productId) state.productAnalysis.selectedProductId = String(productId);
  history.replaceState({}, "", "/fatura/");
}

function rerender() {
  if (state.activeView !== "productAnalysis") return;
  const host = document.getElementById("contentView");
  if (!host) return;
  host.innerHTML = renderProductAnalysis();
  bindProductAnalysisInteractions();
}

function updateResults(root) {
  const host = root.querySelector("#productAnalysisResults");
  const input = root.querySelector("#productAnalysisSearch");
  if (!host) return;
  host.hidden = !state.productAnalysis.resultsOpen;
  host.innerHTML = renderSearchResults(filteredProducts(state.productAnalysis.query));
  input?.setAttribute("aria-expanded", String(state.productAnalysis.resultsOpen));
}

function filteredProducts(query) {
  const needle = normalize(query);
  return state.productAnalysis.products.filter((product) => !needle || normalize(`${product.name} ${product.productCode} ${product.category}`).includes(needle))
    .sort((left, right) => (normalize(left.name).startsWith(needle) ? 0 : 1) - (normalize(right.name).startsWith(needle) ? 0 : 1) || left.name.localeCompare(right.name, "tr"))
    .slice(0, 30);
}

function renderSearchResults(products) {
  if (!products.length) return '<div class="product-analysis-result-empty">Eşleşen stok ürünü bulunamadı.</div>';
  return products.map((product) => `<button type="button" data-product-analysis-select="${escapeHtml(product.id)}"><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.productCode || "Kodsuz")} · ${escapeHtml(product.category || "Kategori yok")}</small></span><em>${escapeHtml(product.baseUnit || "adet")}${product.bulkUnit ? ` / ${escapeHtml(product.bulkUnit)}` : ""}</em></button>`).join("");
}

function renderEmpty() {
  return `<div class="product-analysis-empty"><div class="product-analysis-empty__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/><circle cx="18" cy="17" r="3"/><path d="m20.3 19.3 1.7 1.7"/></svg></div><h2>Analiz etmek istediğiniz ürünü arayın.</h2><p>Fiyat, alım, tüketim ve stok planlama verileri seçtiğiniz gerçek stok ürünü için hazırlanır.</p></div>`;
}

function renderDetail(data) {
  const product = data.product || {};
  const summary = data.summary;
  return `<div class="product-analysis-overview">
    <article class="product-analysis-product-card"><div class="product-analysis-product-icon">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="">` : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/></svg>'}</div><div><small>İNCELENEN ÜRÜN</small><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.productCode || "Kodsuz")} · ${escapeHtml(product.category || "Kategori yok")}</p><span class="badge ${product.active ? "is-success" : "is-muted"}">${product.active ? "Aktif" : "Pasif"}</span><em>${escapeHtml(product.baseUnit || "adet")}${product.bulkUnit ? ` · ${escapeHtml(product.bulkUnit)} (${formatNumber(product.unitsPerBulkUnit)} ${escapeHtml(product.baseUnit)})` : ""}</em></div><button type="button" data-product-analysis-clear aria-label="Ürün seçimini temizle">×</button></article>
    ${summary ? renderFinancialSummary(summary, product) : `<article class="product-analysis-operational-note"><strong>Operasyon analizi</strong><span>Maliyet metrikleri bu hesabın finansal yetkisi nedeniyle gizlendi.</span></article>`}
  </div>
  <div class="product-analysis-range"><label>Zaman aralığı<select id="productAnalysisRange"><option value="30d"${data.range === "30d" ? " selected" : ""}>Son 30 gün</option><option value="90d"${data.range === "90d" ? " selected" : ""}>Son 90 gün</option><option value="6m"${data.range === "6m" ? " selected" : ""}>Son 6 ay</option><option value="1y"${data.range === "1y" ? " selected" : ""}>Son 1 yıl</option><option value="all"${data.range === "all" ? " selected" : ""}>Tümü</option></select></label></div>
  <div class="product-analysis-accordions">
    ${analysisSection(1, "Fiyat Geçmişi", renderPriceHistory(data, product), true)}
    ${analysisSection(2, "Alım Geçmişi", renderPurchaseHistory(data.purchaseHistory || [], product))}
    ${analysisSection(3, "Tüketim Analizi", renderConsumption(data.consumption || {}, data.stockCoverage || {}, product), true)}
    ${analysisSection(4, "Tedarikçi Karşılaştırması", renderSupplierComparison(data.supplierComparison || [], product))}
  </div>`;
}

function renderFinancialSummary(summary, product) {
  const change = summary.changePercent;
  return `<section class="product-analysis-kpis">
    ${metric("Son Alış Fiyatı", trMoney(summary.lastBaseUnitPriceKurus), `/${escapeHtml(product.baseUnit || "adet")}`)}
    ${metric("Ortalama Fiyat", trMoney(summary.averageBaseUnitPriceKurus), `/${escapeHtml(product.baseUnit || "adet")}`)}
    ${metric("Değişim", change === null ? "Yeterli veri yok" : `${change > 0 ? "+" : ""}${formatNumber(change)}%`, "", change > 0 ? "is-danger" : change < 0 ? "is-success" : "")}
    ${metric("Son Tedarikçi", escapeHtml(summary.lastSupplier?.name || "Veri yok"), "")}
    ${metric("Toplam Harcama", trMoney(summary.totalSpendKurus), "")}
  </section>`;
}

function metric(label, value, suffix = "", className = "") { return `<article class="${className}"><span>${label}</span><strong>${value} <small>${suffix}</small></strong></article>`; }

function analysisSection(number, title, body, open = false) {
  return `<details class="product-analysis-accordion" ${open ? "open" : ""}><summary><b>${number}</b><strong>${title}</strong><span aria-hidden="true">⌄</span></summary><div class="product-analysis-accordion__body">${body}</div></details>`;
}

function renderPriceHistory(data, product) {
  if (!data.financialVisible) return emptyBlock("Fiyat geçmişi için finansal görüntüleme yetkisi gereklidir.");
  const rows = data.priceHistory || [];
  if (!rows.length) return emptyBlock("Seçilen aralıkta onaylanmış fiyat kaydı bulunmuyor.");
  const baseChart = chart(rows, "baseUnitPriceKurus", `${product.baseUnit || "adet"} fiyatı`);
  const bulkChart = product.bulkUnit ? chart(rows, "bulkUnitPriceKurus", `${product.bulkUnit} fiyatı`) : "";
  return `<div class="product-analysis-charts ${bulkChart ? "" : "is-single"}">${baseChart}${bulkChart}</div>`;
}

function chart(rows, key, label) {
  const values = rows.map((row) => Number(row[key] || 0) / 100).filter((value) => value >= 0);
  if (!values.length || values.every((value) => value === 0)) return emptyBlock(`${label} için fiyat kaydı yok.`);
  const width = 640, height = 190, pad = 30;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const points = values.map((value, index) => `${pad + index * ((width - pad * 2) / Math.max(1, values.length - 1))},${height - pad - (value - min) / span * (height - pad * 2)}`).join(" ");
  return `<figure class="product-analysis-chart"><figcaption>${escapeHtml(label)} (₺)</figcaption><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} fiyat grafiği"><path class="chart-grid" d="M${pad} ${pad}H${width-pad}M${pad} ${height/2}H${width-pad}M${pad} ${height-pad}H${width-pad}"/><polyline points="${points}"/><g>${values.map((value, index) => { const [x,y] = points.split(" ")[index].split(","); return `<circle cx="${x}" cy="${y}" r="4"><title>${trMoney(Math.round(value*100))} · ${trDate(rows[index].date)}</title></circle>`; }).join("")}</g></svg></figure>`;
}

function renderPurchaseHistory(rows, product) {
  if (!rows.length) return emptyBlock("Seçilen aralıkta onaylanmış alım kaydı bulunmuyor.");
  return `<div class="product-analysis-table-wrap"><table><thead><tr><th>Tarih</th><th>Tedarikçi</th><th>Toplu miktar</th><th>İçerik</th><th>Temel miktar</th><th>Temel fiyat</th><th>Toplu fiyat</th><th>Toplam</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${trDate(row.date)}</td><td>${escapeHtml(row.supplierName)}</td><td>${formatNumber(row.quantity)} ${escapeHtml(row.purchaseUnit)}</td><td>${row.unitsPerBulkUnit ? `${formatNumber(row.unitsPerBulkUnit)} ${escapeHtml(row.baseUnit)}` : "—"}</td><td>${formatNumber(row.baseQuantity)} ${escapeHtml(row.baseUnit)}</td><td>${trMoney(row.baseUnitPriceKurus)}</td><td>${row.bulkUnitPriceKurus ? trMoney(row.bulkUnitPriceKurus) : "—"}</td><td>${trMoney(row.totalKurus)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderConsumption(consumption, coverage, product) {
  const remaining = coverage.remainingDays;
  return `<div class="product-consumption-grid">
    ${metric("Günlük tüketim", `${formatNumber(consumption.dailyAverage)} ${escapeHtml(product.baseUnit || "adet")}`)}
    ${metric("Aylık tüketim", `${formatNumber(consumption.monthlyAverage)} ${escapeHtml(product.baseUnit || "adet")}`)}
    ${metric("Mevcut stok", `${formatNumber(coverage.currentStock)} ${escapeHtml(product.baseUnit || "adet")}`)}
    ${metric("Tahmini stok bitişi", coverage.depletionDate ? trDate(coverage.depletionDate) : "Yeterli veri yok")}
    ${metric("Tahmini kalan gün", remaining === null ? "Yeterli veri yok" : `${formatNumber(remaining)} gün`)}
    ${metric("Gelecek 30 gün", `${formatNumber(coverage.futureNeed)} ${escapeHtml(product.baseUnit || "adet")}`)}
    ${metric("Önerilen sipariş", coverage.suggestedBulkQuantity !== null && product.bulkUnit ? `${formatNumber(coverage.suggestedBulkQuantity)} ${escapeHtml(product.bulkUnit)}` : `${formatNumber(coverage.suggestedBaseQuantity)} ${escapeHtml(product.baseUnit || "adet")}`)}
  </div>`;
}

function renderSupplierComparison(rows, product) {
  if (!rows.length) return emptyBlock("Karşılaştırılabilir tedarikçi alımı bulunmuyor.");
  return `<div class="product-analysis-table-wrap"><table><thead><tr><th>Tedarikçi</th><th>Son ${escapeHtml(product.baseUnit || "birim")} fiyatı</th><th>Son ${escapeHtml(product.bulkUnit || "toplu birim")} fiyatı</th><th>Ortalama fiyat</th><th>Son alış</th><th>Alım hacmi</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.supplierName)}</strong></td><td>${trMoney(row.lastBaseUnitPriceKurus)}</td><td>${row.lastBulkUnitPriceKurus ? trMoney(row.lastBulkUnitPriceKurus) : "—"}</td><td>${trMoney(row.averageBaseUnitPriceKurus)}</td><td>${trDate(row.lastPurchaseAt)}</td><td>${formatNumber(row.totalBaseQuantity)} ${escapeHtml(product.baseUnit || "adet")} · ${row.purchaseCount} alım</td></tr>`).join("")}</tbody></table></div>`;
}

function emptyBlock(message) { return `<div class="product-analysis-inline-empty">${escapeHtml(message)}</div>`; }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function formatNumber(value) { return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(value || 0)); }

export function handleProductAnalysisGatewayEvent(event = {}) {
  if (!["inventory", "catalog", "shipment", "procurement"].includes(String(event.topic || ""))) return false;
  if (event.topic === "catalog") state.productAnalysis.productsStale = true;
  state.productAnalysis.detailStale = true;
  window.clearTimeout(eventTimer);
  if (state.activeView === "productAnalysis" && state.productAnalysis.selectedProductId) {
    eventTimer = window.setTimeout(async () => {
      try {
        await loadProductAnalysis({ productId: state.productAnalysis.selectedProductId });
        rerender();
      } catch (_error) {}
    }, 180);
  }
  return true;
}

export function resetProductAnalysisState() {
  window.clearTimeout(searchTimer); window.clearTimeout(eventTimer); loadSequence += 1;
  Object.assign(state.productAnalysis, {
    products: [], selectedProductId: "", detail: null, query: "", range: "30d",
    resultsOpen: false, loaded: false, loading: false, productsStale: true, detailStale: true
  });
}
