(function () {
  "use strict";

  const state = {
    user: null,
    stock: { categories: [], products: [], movements: [] },
    query: "",
    category: "all",
    action: null
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    [
      "stockUserBox", "stockStats", "stockMessage", "stockSearchInput", "stockCategoryPills", "stockGrid",
      "stockModal", "stockForm", "stockModalKicker", "stockModalTitle", "stockModalProduct",
      "stockQuantity", "stockNote", "stockFormMessage"
    ].forEach((id) => { els[id] = document.getElementById(id); });

    bindEvents();
    await loadSessionAndStock();
  }

  function bindEvents() {
    if (els.stockSearchInput) els.stockSearchInput.addEventListener("input", () => {
      state.query = els.stockSearchInput.value.trim();
      render();
    });
    if (els.stockCategoryPills) els.stockCategoryPills.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category || "all";
      render();
    });
    if (els.stockGrid) els.stockGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stock-action]");
      if (!button) return;
      openAction(button.dataset.productId, button.dataset.stockAction);
    });
    if (els.stockModal) els.stockModal.addEventListener("click", (event) => {
      if (event.target === els.stockModal || event.target.closest("[data-close]")) closeAction();
    });
    if (els.stockForm) els.stockForm.addEventListener("submit", submitAction);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAction();
    });
  }

  async function loadSessionAndStock() {
    try {
      const session = await api("/api/recipe/me");
      state.user = session.user || session.recipeUser || session;
      const stock = await api("/api/stock");
      state.stock = normalizeStock(stock.stockState);
      render();
    } catch (error) {
      showMessage("Stok ekranı için personel/reçete oturumu gerekli. Reçete ekranından giriş yapın.", true);
      if (els.stockGrid) {
        els.stockGrid.innerHTML = `
          <article class="stock-empty">
            <strong>Oturum gerekli</strong>
            <p>Stok ekranı mevcut personel oturumuyla çalışır.</p>
            <p><a class="primary" href="/personel/">Personel paneline git</a></p>
          </article>
        `;
      }
    }
  }

  async function api(path, options) {
    const response = await fetch(path, Object.assign({
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    }, options || {}));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.message || "İstek başarısız.");
    return result;
  }

  function render() {
    renderUser();
    renderStats();
    renderCategories();
    renderProducts();
  }

  function renderUser() {
    if (!els.stockUserBox) return;
    const name = state.user && (state.user.name || state.user.username) || "Personel";
    els.stockUserBox.innerHTML = `<strong>${escapeHTML(name)}</strong><span>Barista</span>`;
  }

  function renderStats() {
    if (!els.stockStats) return;
    const products = stockProducts();
    const critical = products.filter((product) => stockStatus(product).key === "critical").length;
    const todayKey = new Date().toISOString().slice(0, 10);
    const waste = stockMovements().filter((movement) => movement.type === "waste" && String(movement.createdAt || "").slice(0, 10) === todayKey)
      .reduce((sum, movement) => sum + numberValue(movement.quantity), 0);
    const near = products.filter((product) => stockStatus(product).key === "warning").length;
    const cards = [
      ["Takip Edilecek", products.length, "Stok ürünü"],
      ["Kritik Ürün", critical, "Kritik eşiğin altında"],
      ["Bugün Sarf", formatNumber(waste), "Ürün sarf edildi"],
      ["Yaklaşan", near, "Sipariş eşiğine yakın"]
    ].slice(0, 3);
    els.stockStats.innerHTML = cards.map(([label, value, text]) => `
      <article class="stock-stat">
        <span aria-hidden="true"></span>
        <div><p>${escapeHTML(label)}</p><strong>${escapeHTML(value)}</strong><small>${escapeHTML(text)}</small></div>
      </article>
    `).join("");
  }

  function renderCategories() {
    if (!els.stockCategoryPills) return;
    const categories = stockCategories();
    els.stockCategoryPills.innerHTML = [
      `<button class="${state.category === "all" ? "is-active" : ""}" type="button" data-category="all">Tümü</button>`,
      ...categories.map((category) => `
        <button class="${state.category === category.id ? "is-active" : ""}" type="button" data-category="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</button>
      `)
    ].join("");
  }

  function renderProducts() {
    if (!els.stockGrid) return;
    const categories = new Map(stockCategories().map((category) => [category.id, category]));
    const products = filteredProducts();
    els.stockGrid.innerHTML = products.length ? products.map((product) => {
      const status = stockStatus(product);
      const category = categories.get(product.categoryId);
      return `
        <article class="stock-card">
          ${product.imageUrl ? `<div class="stock-card-media"><img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name)}"></div>` : `<div class="stock-card-media" aria-hidden="true"></div>`}
          <div class="stock-card-head">
            <div><h2>${escapeHTML(product.name)}</h2><p>${escapeHTML(product.supplier || category && category.name || "Stok")}</p></div>
            <em class="badge ${status.key}">${escapeHTML(status.label)}</em>
          </div>
          <div class="stock-count"><strong>${escapeHTML(formatNumber(product.stockQuantity))}</strong><span>${escapeHTML(product.unit || "adet")}</span></div>
          <div class="stock-card-meta">
            <span>Sipariş Eşiği <b>${escapeHTML(formatNumber(product.orderThreshold))} ${escapeHTML(product.unit || "")}</b></span>
            <span>Kritik Eşik <b>${escapeHTML(formatNumber(product.criticalThreshold))} ${escapeHTML(product.unit || "")}</b></span>
          </div>
          <div class="stock-card-actions">
            <button type="button" data-stock-action="stock_out" data-product-id="${escapeAttribute(product.id)}">Eksilt</button>
            <button type="button" data-stock-action="waste" data-product-id="${escapeAttribute(product.id)}">Sarf</button>
          </div>
        </article>
      `;
    }).join("") : `<div class="stock-empty">${stockProducts().length ? "Aradığınız stok ürünü bulunamadı." : "Henüz veri aktarılmadı."}</div>`;
  }

  function openAction(productId, type) {
    const product = stockProducts().find((item) => item.id === productId);
    if (!product || !els.stockModal) return;
    state.action = { productId, productCode: String(product.productCode || ""), type };
    const label = type === "waste" ? "Sarf İşle" : "Eksilt";
    els.stockModalKicker.textContent = label;
    els.stockModalTitle.textContent = label;
    els.stockModalProduct.textContent = `${product.name} · Mevcut stok: ${formatNumber(product.stockQuantity)} ${product.unit || "adet"}`;
    els.stockQuantity.value = "";
    els.stockNote.value = "";
    els.stockFormMessage.textContent = "";
    els.stockModal.hidden = false;
    setTimeout(() => els.stockQuantity.focus(), 40);
  }

  function closeAction() {
    state.action = null;
    if (els.stockModal) els.stockModal.hidden = true;
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!state.action) return;
    const quantity = Number(els.stockQuantity.value || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      els.stockFormMessage.textContent = "Geçerli bir miktar girin.";
      return;
    }
    try {
      const result = await api("/api/stock/movements", {
        method: "POST",
        body: JSON.stringify({
          movement: {
            productId: state.action.productId,
            productCode: state.action.productCode || "",
            stockProductCode: state.action.productCode || "",
            type: state.action.type,
            quantity,
            reason: state.action.type === "waste" ? "Personel sarf" : "Personel stok eksiltme",
            note: els.stockNote.value.trim()
          }
        })
      });
      state.stock = normalizeStock(result.stockState);
      closeAction();
      showMessage("Stok hareketi kaydedildi.");
      render();
    } catch (error) {
      els.stockFormMessage.textContent = error.message || "Stok işlemi kaydedilemedi.";
    }
  }

  function normalizeStock(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      categories: Array.isArray(source.categories) ? source.categories : [],
      products: Array.isArray(source.products) ? source.products : [],
      movements: Array.isArray(source.movements) ? source.movements : []
    };
  }

  function filteredProducts() {
    const query = normalizeText(state.query);
    return stockProducts().filter((product) => {
      if (state.category !== "all" && product.categoryId !== state.category) return false;
      if (!query) return true;
      return normalizeText(`${product.name} ${product.supplier} ${product.unit}`).includes(query);
    });
  }

  function stockCategories() {
    return state.stock.categories.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockProducts() {
    return state.stock.products.filter((product) => product.active !== false).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockMovements() {
    return state.stock.movements.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function stockStatus(product) {
    const current = numberValue(product.stockQuantity);
    if (current <= numberValue(product.criticalThreshold)) return { key: "critical", label: "Kritik" };
    if (current <= numberValue(product.orderThreshold)) return { key: "warning", label: "Yaklaşıyor" };
    return { key: "ok", label: "Yeterli" };
  }

  function showMessage(message, persist) {
    if (!els.stockMessage) return;
    els.stockMessage.textContent = message;
    els.stockMessage.hidden = false;
    if (!persist) setTimeout(() => { els.stockMessage.hidden = true; }, 1800);
  }

  function numberValue(value) {
    const parsed = Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(numberValue(value));
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .toLowerCase();
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
  }
})();
