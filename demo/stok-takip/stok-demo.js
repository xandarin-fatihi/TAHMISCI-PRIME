/* Tahmisci Stok Takip / Sipariş Demo Runtime */
(function () {
  "use strict";

  const SOURCE = window.TAHMISCI_STOCK_DEMO_DATA || { categories: [], products: [], movements: [] };
  const CATEGORY_ICONS = {
    "Sütler": "🥛",
    "Şuruplar": "🍶",
    "Soslar": "🧴",
    "Kahve": "☕",
    "Temizlik": "🧽",
    "Sarf Malzeme": "📦",
    "Diğer": "◻"
  };

  const state = {
    view: "admin",
    activeCategory: "all",
    query: "",
    selectedProductId: "",
    modal: null,
    orderSelection: new Set(),
    orderSelectionTouched: false,
    products: clone(SOURCE.products || []),
    movements: clone(SOURCE.movements || []),
    notificationSettings: clone(SOURCE.notificationSettings || {})
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    bindEvents();
    render();
  }

  function bindElements() {
    els.body = document.body;
    els.summaryGrid = document.getElementById("summaryGrid");
    els.search = document.getElementById("stockSearch");
    els.categoryFilter = document.getElementById("categoryFilter");
    els.productGrid = document.getElementById("productGrid");
    els.emptyState = document.getElementById("emptyState");
    els.visibleCount = document.getElementById("visibleCount");
    els.viewTitle = document.getElementById("viewTitle");
    els.viewSubtitle = document.getElementById("viewSubtitle");
    els.suggestionCount = document.getElementById("suggestionCount");
    els.orderSuggestions = document.getElementById("orderSuggestions");
    els.notificationSettings = document.getElementById("notificationSettings");
    els.movementList = document.getElementById("movementList");
    els.stockModal = document.getElementById("stockModal");
    els.stockForm = document.getElementById("stockForm");
    els.modalTitle = document.getElementById("modalTitle");
    els.modalProduct = document.getElementById("modalProduct");
    els.modalQuantity = document.getElementById("modalQuantity");
    els.modalReason = document.getElementById("modalReason");
    els.modalNote = document.getElementById("modalNote");
    els.reasonField = document.getElementById("reasonField");
    els.formError = document.getElementById("formError");
    els.modalSubmit = document.getElementById("modalSubmit");
    els.orderModal = document.getElementById("orderModal");
    els.orderSummaryList = document.getElementById("orderSummaryList");
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view || "admin";
        state.selectedProductId = "";
        document.querySelectorAll("[data-view]").forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
        render();
      });
    });

    els.search.addEventListener("input", () => {
      state.query = els.search.value.trim();
      renderProducts();
    });

    els.categoryFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-category]");
      if (!chip) return;
      state.activeCategory = chip.dataset.category || "all";
      render();
    });

    els.productGrid.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      const card = event.target.closest("[data-product-id]");
      if (!card) return;
      const productId = card.dataset.productId;
      const product = getProduct(productId);
      if (!product) return;

      if (actionButton) {
        event.stopPropagation();
        const action = actionButton.dataset.action;
        if (action === "stock-in") openStockModal(product, "stock_in");
        if (action === "stock-out") openStockModal(product, "stock_out");
        if (action === "waste") openStockModal(product, "waste");
        if (action === "toggle-detail") toggleDetail(productId);
        return;
      }

      toggleDetail(productId);
    });

    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "close-modal") closeStockModal();
      if (action === "open-order-summary") openOrderSummary();
      if (action === "close-order-modal") closeOrderModal();
    });

    els.stockForm.addEventListener("submit", handleStockSubmit);

    els.orderSuggestions.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-order-select]");
      if (!checkbox) return;
      state.orderSelectionTouched = true;
      if (checkbox.checked) state.orderSelection.add(checkbox.value);
      else state.orderSelection.delete(checkbox.value);
      renderOrderSuggestions();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeStockModal();
      closeOrderModal();
    });
  }

  function render() {
    els.body.classList.toggle("staff-mode", state.view === "staff");
    els.viewTitle.textContent = state.view === "staff" ? "Personel Stok Ekranı" : "Admin Stok Paneli";
    els.viewSubtitle.textContent = state.view === "staff"
      ? "Raftan alınan ürünleri hızlıca stoktan düşebilir ve sarf olarak işleyebilirsiniz."
      : "Kartlardan stok girişi, çıkışı, sarf ve detay işlemleri yapılabilir.";
    renderSummary();
    renderCategories();
    renderProducts();
    renderOrderSuggestions();
    renderNotifications();
    renderMovements();
  }

  function renderSummary() {
    const totals = getSummary();
    const cards = [
      ["Toplam ürün", totals.total, "Demo katalog"],
      ["Sipariş eşiğine yaklaşan", totals.near, "Takip edilmeli"],
      ["Kritik stok", totals.critical, "Öncelikli"],
      ["Bugün yapılan hareket", totals.todayMovements, "Mock kayıt"],
      ["Bekleyen sipariş önerisi", totals.suggestions, "Seçilebilir"]
    ];
    els.summaryGrid.innerHTML = cards.map(([label, value, note]) => `
      <article class="summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
        <em>${escapeHtml(note)}</em>
      </article>
    `).join("");
  }

  function renderCategories() {
    const categories = SOURCE.categories || [];
    els.categoryFilter.innerHTML = categories.map((category) => {
      const isActive = category.id === state.activeCategory;
      return `<button class="chip ${isActive ? "is-active" : ""}" type="button" data-category="${escapeAttr(category.id)}">${escapeHtml(category.name)}</button>`;
    }).join("");
  }

  function renderProducts() {
    const products = getVisibleProducts();
    els.visibleCount.textContent = `${products.length} ürün`;
    els.emptyState.hidden = products.length > 0;
    els.productGrid.innerHTML = products.map(renderProductCard).join("");
    els.productGrid.querySelectorAll("img[data-fallback-for]").forEach((image) => {
      image.addEventListener("error", () => {
        const product = getProduct(image.dataset.fallbackFor);
        const imageBox = image.closest(".stock-image");
        if (imageBox && product) imageBox.innerHTML = renderFallbackIcon(product);
      }, { once: true });
    });
  }

  function renderProductCard(product) {
    const status = getStockStatus(product);
    const isSelected = state.selectedProductId === product.id;
    const detail = isSelected ? renderDetail(product) : "";
    return `
      <article class="product-card ${isSelected ? "is-selected" : ""}" data-product-id="${escapeAttr(product.id)}">
        <div class="stock-image">${renderProductImage(product)}</div>
        <div class="card-head">
          <div>
            <h3>${escapeHtml(product.productName)}</h3>
            <p class="meta">${escapeHtml(product.category)} · ${escapeHtml(product.brand || "Marka yok")}</p>
          </div>
          <span class="status-badge ${status.className}">${escapeHtml(status.label)}</span>
        </div>
        <div class="stock-value">
          <strong>${escapeHtml(String(product.stockQuantity))}</strong>
          <span>${escapeHtml(product.unit)}</span>
        </div>
        <div class="threshold-grid">
          <div class="mini-stat"><span>Sipariş eşiği</span><strong>${escapeHtml(String(product.orderThreshold))} ${escapeHtml(product.unit)}</strong></div>
          <div class="mini-stat"><span>Kritik eşik</span><strong>${escapeHtml(String(product.criticalThreshold))} ${escapeHtml(product.unit)}</strong></div>
        </div>
        <div class="card-actions">
          <button class="icon-btn is-primary admin-only" type="button" data-action="stock-in">+ Arttır</button>
          <button class="icon-btn" type="button" data-action="stock-out">− Eksilt</button>
          <button class="icon-btn is-danger" type="button" data-action="waste">Sarf</button>
        </div>
        <button class="soft-btn" type="button" data-action="toggle-detail">${isSelected ? "Detayı Kapat" : "Detay / Son Hareketler"}</button>
        ${detail}
      </article>
    `;
  }

  function renderProductImage(product) {
    if (product.imageUrl) {
      return `<img src="${escapeAttr(product.imageUrl)}" alt="${escapeAttr(product.productName)}" data-fallback-for="${escapeAttr(product.id)}">`;
    }
    return renderFallbackIcon(product);
  }

  function renderFallbackIcon(product) {
    const icon = CATEGORY_ICONS[product.category] || CATEGORY_ICONS.Diğer;
    return `<div class="fallback-icon" aria-hidden="true"><span>${icon}</span><small>${escapeHtml(product.category)}</small></div>`;
  }

  function renderDetail(product) {
    const movements = getProductMovements(product.id).slice(0, 4);
    const rows = [
      ["Mevcut adet", `${product.stockQuantity} ${product.unit}`],
      ["Son güncelleme", formatDate(product.lastUpdatedAt)],
      ["Not", product.note || "Not yok"]
    ];
    return `
      <section class="detail-panel">
        ${rows.map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
        <div class="detail-movements">
          <h4>Son hareketler</h4>
          ${movements.length ? movements.map(renderMovementItem).join("") : '<p class="meta">Bu ürün için hareket yok.</p>'}
        </div>
      </section>
    `;
  }

  function renderOrderSuggestions() {
    const suggestions = getOrderSuggestions();
    const suggestionIds = new Set(suggestions.map((product) => product.id));
    state.orderSelection.forEach((productId) => {
      if (!suggestionIds.has(productId)) state.orderSelection.delete(productId);
    });
    if (!state.orderSelectionTouched) suggestions.forEach((product) => state.orderSelection.add(product.id));
    els.suggestionCount.textContent = String(suggestions.length);
    if (!suggestions.length) {
      els.orderSuggestions.innerHTML = `<div class="empty-state"><strong>Sipariş önerisi yok.</strong><span>Tüm ürünler eşik üstünde.</span></div>`;
      return;
    }
    els.orderSuggestions.innerHTML = suggestions.map((product) => {
      const suggested = getSuggestedOrderQuantity(product);
      const checked = state.orderSelection.has(product.id) ? "checked" : "";
      return `
        <div class="order-item">
          <label>
            <input type="checkbox" value="${escapeAttr(product.id)}" data-order-select ${checked}>
            <span>
              <strong>${escapeHtml(product.productName)}</strong>
              <span>${product.stockQuantity} ${escapeHtml(product.unit)} / eşik ${product.orderThreshold} · öneri ${suggested} ${escapeHtml(product.unit)}</span>
            </span>
          </label>
        </div>
      `;
    }).join("");
  }

  function renderNotifications() {
    const settings = state.notificationSettings;
    const rows = [
      ["Panel içi bildirim", settings.inPanel ? "Açık" : "Kapalı"],
      ["E-posta", settings.email ? settings.emailRecipient : "Kapalı"],
      ["SMS / WhatsApp", "Yakında"],
      ["Telefon", settings.phoneRecipient || "Tanımlı değil"]
    ];
    els.notificationSettings.innerHTML = rows.map(([label, value]) => `
      <div class="notification-row">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");
  }

  function renderMovements() {
    els.movementList.innerHTML = state.movements.slice(0, 6).map(renderMovementItem).join("");
  }

  function renderMovementItem(movement) {
    return `
      <div class="movement-item">
        <span>
          <strong>${escapeHtml(movement.productName)}</strong>
          <span>${escapeHtml(formatMovementText(movement))}</span>
        </span>
        <em class="movement-type">${escapeHtml(getMovementLabel(movement.type))}</em>
      </div>
    `;
  }

  function openStockModal(product, type) {
    state.modal = { productId: product.id, type };
    els.modalTitle.textContent = type === "stock_in" ? "Stok Girişi" : type === "waste" ? "Sarf İşlemi" : "Stok Çıkışı";
    els.modalProduct.textContent = `${product.productName} · mevcut ${product.stockQuantity} ${product.unit}`;
    els.reasonField.hidden = type !== "waste";
    els.modalQuantity.value = "";
    els.modalReason.value = "";
    els.modalNote.value = "";
    els.formError.textContent = "";
    els.modalSubmit.textContent = type === "stock_in" ? "Stoğa Ekle" : type === "waste" ? "Sarfı Onayla" : "Stoktan Düş";
    els.stockModal.hidden = false;
    window.setTimeout(() => els.modalQuantity.focus(), 0);
  }

  function closeStockModal() {
    els.stockModal.hidden = true;
    state.modal = null;
  }

  function handleStockSubmit(event) {
    event.preventDefault();
    if (!state.modal) return;

    const product = getProduct(state.modal.productId);
    const quantity = Number(els.modalQuantity.value);
    const reason = els.modalReason.value.trim();
    const note = els.modalNote.value.trim();

    if (!product) return;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      els.formError.textContent = "Miktar boş, sıfır veya negatif olamaz.";
      return;
    }
    if ((state.modal.type === "stock_out" || state.modal.type === "waste") && quantity > product.stockQuantity) {
      els.formError.textContent = "Mevcut stoktan fazla eksiltme yapılamaz.";
      return;
    }
    if (state.modal.type === "waste" && !reason) {
      els.formError.textContent = "Sarf sebebi zorunludur.";
      return;
    }

    if (state.modal.type === "stock_in") product.stockQuantity += quantity;
    else product.stockQuantity -= quantity;
    product.lastUpdatedAt = new Date().toISOString();

    addMovement({
      product,
      type: state.modal.type,
      quantity,
      reason: state.modal.type === "stock_in" ? "stok girişi" : state.modal.type === "waste" ? reason : "stok çıkışı",
      note,
      actor: state.view === "staff" ? "personel" : "admin"
    });

    closeStockModal();
    render();
  }

  function openOrderSummary() {
    const selected = getOrderSuggestions().filter((product) => state.orderSelection.has(product.id));
    els.orderSummaryList.innerHTML = selected.length
      ? selected.map((product) => `
        <div class="order-summary-row">
          <strong>${escapeHtml(product.productName)}</strong>
          <span>Mevcut ${product.stockQuantity} ${escapeHtml(product.unit)} · önerilen sipariş ${getSuggestedOrderQuantity(product)} ${escapeHtml(product.unit)}</span>
        </div>
      `).join("")
      : `<div class="empty-state"><strong>Seçili ürün yok.</strong><span>Sipariş önerilerinden ürün seçin.</span></div>`;
    els.orderModal.hidden = false;
  }

  function closeOrderModal() {
    els.orderModal.hidden = true;
  }

  function toggleDetail(productId) {
    state.selectedProductId = state.selectedProductId === productId ? "" : productId;
    renderProducts();
  }

  function addMovement({ product, type, quantity, reason, note, actor }) {
    state.movements.unshift({
      id: `mov-${Date.now()}`,
      productId: product.id,
      productName: product.productName,
      type,
      quantity,
      unit: product.unit,
      reason,
      note,
      actor,
      createdAt: new Date().toISOString()
    });
  }

  function getVisibleProducts() {
    const categoryName = getCategoryName(state.activeCategory);
    const query = normalize(state.query);
    return state.products.filter((product) => {
      const matchesCategory = state.activeCategory === "all" || product.category === categoryName;
      const matchesQuery = !query || normalize(`${product.productName} ${product.category} ${product.brand}`).includes(query);
      return product.status !== "passive" && matchesCategory && matchesQuery;
    });
  }

  function getOrderSuggestions() {
    return state.products.filter((product) => product.status !== "passive" && product.stockQuantity <= product.orderThreshold);
  }

  function getSuggestedOrderQuantity(product) {
    return Math.max(product.orderThreshold * 2 - product.stockQuantity, product.orderThreshold - product.stockQuantity + 1, 1);
  }

  function getSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const statuses = state.products.map(getStockStatus);
    return {
      total: state.products.length,
      near: statuses.filter((status) => status.key === "warn").length,
      critical: statuses.filter((status) => status.key === "critical").length,
      todayMovements: state.movements.filter((movement) => String(movement.createdAt).slice(0, 10) === today).length,
      suggestions: getOrderSuggestions().length
    };
  }

  function getStockStatus(product) {
    if (product.stockQuantity <= product.criticalThreshold) {
      return { key: "critical", label: "Kritik", className: "status-critical" };
    }
    if (product.stockQuantity <= product.orderThreshold) {
      return { key: "warn", label: "Siparişe yaklaşıyor", className: "status-warn" };
    }
    return { key: "ok", label: "Yeterli", className: "status-ok" };
  }

  function getProduct(productId) {
    return state.products.find((product) => product.id === productId);
  }

  function getProductMovements(productId) {
    return state.movements.filter((movement) => movement.productId === productId);
  }

  function getCategoryName(categoryId) {
    return (SOURCE.categories || []).find((category) => category.id === categoryId)?.name || "Tümü";
  }

  function formatMovementText(movement) {
    const sign = movement.type === "stock_in" ? "+" : movement.type === "order_suggestion" ? "" : "-";
    const actor = movement.actor ? ` · ${movement.actor}` : "";
    const note = movement.reason ? ` · ${movement.reason}` : "";
    return `${sign}${movement.quantity} ${movement.unit}${note}${actor}`;
  }

  function getMovementLabel(type) {
    const labels = {
      stock_in: "Giriş",
      stock_out: "Çıkış",
      waste: "Sarf",
      order_suggestion: "Öneri"
    };
    return labels[type] || type;
  }

  function formatDate(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
})();
