(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const LOCATION_STORAGE_KEY = "tahmisci.admin.stock.location.v1";

  const state = {
    locations: [],
    personnel: [],
    selectedLocationId: "",
    balances: [],
    summary: {},
    transfers: [],
    movements: [],
    counts: [],
    activeCount: null,
    secondaryLoaded: false,
    secondaryLoadPromise: null,
    secondaryLocationId: "",
    selectedCategory: "all",
    selectedProductId: "",
    drawerReturnFocus: null,
    inventoryController: null,
    loadSequence: 0,
    revision: 0,
    updatedAt: "",
    loaded: false,
    stale: true,
    loadPromise: null,
    busyKeys: new Set(),
    bound: false,
    confirmResolver: null
  };

  function requestId(prefix) {
    const suffix = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${suffix}`;
  }

  function backendUrl(path) {
    const configured = String(window.TAHMISCI_BACKEND_URL || localStorage.getItem("tahmisci.backend.url") || "").replace(/\/+$/, "");
    return /^https?:\/\//i.test(path) ? path : `${configured}${path}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(backendUrl(path), {
      credentials: "include",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || body.error || "Stok işlemi tamamlanamadı.");
      error.status = response.status;
      error.code = body.code || "";
      throw error;
    }
    return body;
  }

  function mutation(method, body, prefix) {
    const id = requestId(prefix);
    return {
      method,
      headers: { "Idempotency-Key": id, "X-Request-ID": id },
      body: JSON.stringify({ ...body, requestId: id, expectedRevision: state.revision })
    };
  }

  function setMessage(message, kind = "success") {
    const node = $("#stockLocationMessage");
    if (!node) return;
    node.hidden = !message;
    node.textContent = String(message || "");
    node.dataset.kind = kind;
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number)
      ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(number)
      : "0";
  }

  function formatDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function locationName(id) {
    if (String(id) === "total") return "Tüm Depolar";
    return (state.locations.find((item) => String(item.id) === String(id)) || {}).name || "Bilinmeyen depo";
  }

  function productOf(balance) {
    return balance && balance.product && typeof balance.product === "object" ? balance.product : balance || {};
  }

  function productName(balance) {
    const product = productOf(balance);
    return String(product.productName || product.name || balance.productName || "Stok ürünü");
  }

  function productId(balance) {
    const product = productOf(balance);
    return String(balance.productId || product.id || "");
  }

  function textValue(value, fallback = "") {
    if (value && typeof value === "object") {
      const nested = value.unit ?? value.code ?? value.name ?? value.label ?? value.value ?? value.display;
      return nested === undefined || nested === null ? fallback : String(nested).trim() || fallback;
    }
    return value === undefined || value === null ? fallback : String(value).trim() || fallback;
  }

  function unitOf(balance) {
    const product = productOf(balance);
    return textValue(product.baseUnit || product.unit || balance.unit, "adet").toLocaleLowerCase("tr-TR");
  }

  function unitsOf(balance) {
    const product = productOf(balance);
    const baseUnit = unitOf(balance);
    const bulkUnit = textValue(product.bulkUnit || product.caseUnit, "").toLocaleLowerCase("tr-TR");
    const factor = Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
    const declared = Array.isArray(product.allowedUnits)
      ? product.allowedUnits.map((unit) => textValue(unit).toLocaleLowerCase("tr-TR")).filter(Boolean)
      : [];
    const values = Array.from(new Set([baseUnit, ...declared, ...(bulkUnit && factor > 0 ? [bulkUnit] : [])]));
    return values.map((unit) => ({
      value: unit,
      label: unit === bulkUnit && factor > 0 ? `${unit} (1 = ${formatNumber(factor)} ${baseUnit})` : unit
    }));
  }

  function toBaseQuantity(balance, quantity, unit) {
    const product = productOf(balance);
    const sourceUnit = textValue(unit).toLocaleLowerCase("tr-TR");
    const baseUnit = unitOf(balance);
    const bulkUnit = textValue(product.bulkUnit || product.caseUnit).toLocaleLowerCase("tr-TR");
    let factor = sourceUnit === bulkUnit ? Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0) : 1;
    if (sourceUnit === "kg" && baseUnit === "gr") factor = 1000;
    if (sourceUnit === "gr" && baseUnit === "kg") factor = 0.001;
    if (["litre", "lt", "l"].includes(sourceUnit) && baseUnit === "ml") factor = 1000;
    if (sourceUnit === "ml" && ["litre", "lt", "l"].includes(baseUnit)) factor = 0.001;
    return Number(quantity || 0) * (factor > 0 ? factor : 1);
  }

  function quantityDisplay(balance, value = balance && balance.quantity) {
    if (balance && balance.quantityDisplay && Number(value) === Number(balance.quantity)) return balance.quantityDisplay.display || `${formatNumber(value)} ${unitOf(balance)}`;
    const product = productOf(balance);
    const bulkUnit = textValue(product.bulkUnit || product.caseUnit, "").toLocaleLowerCase("tr-TR");
    const factor = Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
    const baseUnit = unitOf(balance);
    const quantity = Math.max(0, Number(value || 0));
    if (!bulkUnit || !(factor > 0)) return `${formatNumber(quantity)} ${baseUnit}`;
    const bulk = Math.floor(quantity / factor);
    const remainder = Math.round((quantity - bulk * factor) * 1000) / 1000;
    return remainder > 0 ? `${formatNumber(bulk)} ${bulkUnit} + ${formatNumber(remainder)} ${baseUnit}` : `${formatNumber(bulk)} ${bulkUnit}`;
  }

  function balanceStatus(balance) {
    const explicit = String(balance.status || "").toLocaleLowerCase("tr-TR");
    if (["kritik", "critical"].includes(explicit)) return "critical";
    if (["tükendi", "tukendi", "empty"].includes(explicit)) return "empty";
    if (["yeterli", "sufficient"].includes(explicit)) return "sufficient";
    const quantity = Number(balance.quantity || 0);
    const critical = Number(balance.criticalThreshold || 0);
    if (quantity <= 0) return "empty";
    if (critical > 0 && quantity <= critical) return "critical";
    return "sufficient";
  }

  function statusLabel(status) {
    return {
      critical: "Kritik", transfer: "Transfer", transfer_in: "Transfer girişi", transfer_out: "Transfer çıkışı",
      order: "Sipariş gerekli", sufficient: "Yeterli", manual_in: "Stok ekleme", manual_out: "Eksilt",
      stock_in: "Stok ekleme", stock_out: "Eksilt", waste: "Sarf", consumption: "Sarf",
      adjustment_out: "Eksilt", adjustment: "Düzeltme", correction: "Düzeltme", reversal: "Ters kayıt",
      inbound_shipment: "Sevkiyat girişi", shipment_in: "Sevkiyat girişi", opening_balance: "Açılış bakiyesi",
      empty: "Tükendi", draft: "Taslak", active: "Devam ediyor", completed: "Tamamlandı",
      pending: "Onay bekliyor", onay_bekliyor: "Onay bekliyor", approved: "Onaylandı",
      onaylandı: "Onaylandı", rejected: "Reddedildi", reddedildi: "Reddedildi", cancelled: "İptal edildi"
    }[status] || String(status || "Güncel");
  }

  function activeSection() {
    return window.TahmisciAdminBridge && typeof window.TahmisciAdminBridge.activeSection === "function"
      ? window.TahmisciAdminBridge.activeSection()
      : "";
  }

  function updateRevision(result) {
    const revision = Number(result && result.revision);
    if (Number.isInteger(revision) && revision >= 0) {
      state.revision = Math.max(state.revision, revision);
    }
    if (result && result.updatedAt) state.updatedAt = result.updatedAt;
  }

  async function loadLocations(options = {}) {
    if (state.locations.length && !options.force) return { locations: state.locations, personnel: state.personnel, revision: state.revision };
    const result = await api("/api/admin/stock/locations");
    state.locations = Array.isArray(result.locations) ? result.locations : [];
    state.personnel = Array.isArray(result.personnel) ? result.personnel : [];
    updateRevision(result);
    if (!state.selectedLocationId) {
      try { state.selectedLocationId = localStorage.getItem(LOCATION_STORAGE_KEY) || ""; } catch (_error) {}
    }
    const valid = state.selectedLocationId === "total"
      || state.locations.some((location) => String(location.id) === String(state.selectedLocationId));
    if (!valid) {
      const cafe = state.locations.find((location) => location.code === "CAFE" || location.type === "cafe");
      state.selectedLocationId = String((cafe || state.locations[0] || {}).id || "total");
    }
    try { localStorage.setItem(LOCATION_STORAGE_KEY, state.selectedLocationId); } catch (_error) {}
    publishLocationContext();
    return result;
  }

  async function loadInventory(locationId = state.selectedLocationId || "total", signal) {
    const result = await api(`/api/admin/stock/inventory?locationId=${encodeURIComponent(locationId)}`, { signal });
    if (String(locationId) !== String(state.selectedLocationId)) return result;
    state.balances = Array.isArray(result.balances) ? result.balances : [];
    state.summary = result.summary && typeof result.summary === "object" ? result.summary : {};
    updateRevision(result);
    return result;
  }

  async function loadTransfers(signal) {
    const result = await api("/api/admin/stock/transfers?status=pending", { signal });
    state.transfers = Array.isArray(result.transfers) ? result.transfers : [];
    if (Array.isArray(result.locations) && result.locations.length) state.locations = result.locations;
    updateRevision(result);
    return result;
  }

  async function loadMovements() {
    const query = new URLSearchParams({ limit: "120" });
    if (state.selectedLocationId && state.selectedLocationId !== "total") query.set("locationId", state.selectedLocationId);
    const type = $("#stockMovementTypeFilter")?.value || "all";
    const productId = $("#stockMovementProductFilter")?.value || "all";
    if (type !== "all") query.set("type", type);
    if (productId !== "all") query.set("productId", productId);
    const result = await api(`/api/admin/stock/movements?${query.toString()}`);
    state.movements = Array.isArray(result.movements) ? result.movements : [];
    updateRevision(result);
    return result;
  }

  async function loadCounts() {
    const query = new URLSearchParams();
    if (state.selectedLocationId && state.selectedLocationId !== "total") query.set("locationId", state.selectedLocationId);
    const result = await api(`/api/admin/stock/counts?${query.toString()}`);
    state.counts = Array.isArray(result.counts) ? result.counts : [];
    state.activeCount = state.counts.find((count) => count.status === "active") || null;
    updateRevision(result);
    return result;
  }

  async function loadAll(options = {}) {
    if (state.loadPromise && !options.force) return state.loadPromise;
    if (options.force && state.inventoryController) state.inventoryController.abort();
    const controller = new AbortController();
    const sequence = ++state.loadSequence;
    state.inventoryController = controller;
    const workspace = $("#stockLocationWorkspace");
    if (workspace) workspace.setAttribute("aria-busy", "true");
    const currentPromise = (async () => {
      await loadLocations({ force: options.reloadLocations === true });
      const requestedLocationId = String(state.selectedLocationId || "total");
      // İlk görünüm yalnız envanter ve bekleyen transfer projection'ını bekler.
      // Ağır hareket/sayım geçmişi aşağıdaki ikincil alanlar görünür olduğunda
      // yüklenir; ham/boş ekran süresi ve duplicate GET zinciri azalır.
      await Promise.all([loadInventory(requestedLocationId, controller.signal), loadTransfers(controller.signal)]);
      if (controller.signal.aborted || sequence !== state.loadSequence || requestedLocationId !== String(state.selectedLocationId || "total")) return;
      state.loaded = true;
      state.stale = false;
      renderAll();
      scheduleSecondaryLoad(options.force === true);
      setMessage("");
    })().catch((error) => {
      if (error && error.name === "AbortError") return;
      setMessage(error.message, "error");
      renderError(error);
      throw error;
    }).finally(() => {
      if (state.loadPromise === currentPromise) state.loadPromise = null;
      if (state.inventoryController === controller) state.inventoryController = null;
      if (workspace && sequence === state.loadSequence) workspace.setAttribute("aria-busy", "false");
    });
    state.loadPromise = currentPromise;
    return currentPromise;
  }

  function scheduleSecondaryLoad(force = false) {
    const requestedLocationId = String(state.selectedLocationId || "total");
    if (state.secondaryLoadPromise || (state.secondaryLoaded && state.secondaryLocationId === requestedLocationId && !force)) return;
    const run = () => {
      if (state.secondaryLoadPromise) return state.secondaryLoadPromise;
      state.secondaryLoadPromise = Promise.all([loadMovements(), loadCounts()])
      .then(() => {
        state.secondaryLoaded = true;
        state.secondaryLocationId = requestedLocationId;
        renderMovements();
      })
      .catch((error) => setMessage(error.message, "error"))
      .finally(() => {
        state.secondaryLoadPromise = null;
        if (String(state.selectedLocationId || "total") !== requestedLocationId) scheduleSecondaryLoad(true);
      });
      return state.secondaryLoadPromise;
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 1400 });
    else window.setTimeout(run, 120);
  }

  function renderError(error) {
    const inventory = $("#stockLocationInventory");
    if (inventory && !state.loaded) inventory.innerHTML = `<div class="stock-location-empty"><strong>Depo verileri yüklenemedi</strong><span>${esc(error.message)}</span></div>`;
  }

  function renderLocations() {
    const host = $("#stockLocationSelector");
    if (!host) return;
    const options = [{ id: "total", name: "Tüm Depolar", code: "TOPLAM", active: true }, ...state.locations.filter((item) => item.active !== false)];
    host.innerHTML = options.map((location) => `
      <button type="button" role="tab" aria-selected="${String(location.id) === String(state.selectedLocationId)}"
        class="stock-location-tab${String(location.id) === String(state.selectedLocationId) ? " is-active" : ""}"
        data-stock-location-select="${esc(location.id)}">
        <span>${esc(location.name)}</span><small>${esc(location.code || (location.type === "central" ? "GENEL" : "KAFE"))}</small>
      </button>`).join("");
    const title = $("#stockActiveLocationTitle");
    const freshness = $("#stockLocationFreshness");
    if (title) title.textContent = locationName(state.selectedLocationId);
    if (freshness) freshness.textContent = `Güncel · Son güncelleme ${state.updatedAt ? formatDate(state.updatedAt) : "bekleniyor"}`;
  }

  function renderSummary() {
    const host = $("#stockLocationSummary");
    if (!host) return;
    const derivedCritical = state.balances.filter((balance) => balanceStatus(balance) === "critical").length;
    const sufficient = state.balances.filter((balance) => balanceStatus(balance) === "sufficient").length;
    const openSuggestions = state.balances.filter((balance) => {
      const type = String(balance && balance.recommendation && balance.recommendation.type || "");
      return type === "transfer" || type === "purchase";
    }).length;
    const cards = [
      ["Toplam Ürün", state.summary.productCount ?? state.summary.totalProducts ?? state.balances.length],
      ["Kritik Ürün", state.summary.criticalCount ?? derivedCritical],
      ["Yeterli Ürün", sufficient],
      ["Bekleyen Transfer", state.transfers.length],
      ["Açık Öneri", state.summary.openSuggestionCount ?? openSuggestions]
    ];
    host.innerHTML = cards.map(([label, value]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join("");
  }

  function filteredBalances() {
    const search = normalizeSearch($("#stockLocationSearch")?.value || "");
    const filter = $("#stockLocationStatusFilter")?.value || "all";
    return state.balances.filter((balance) => {
      const product = productOf(balance);
      const haystack = normalizeSearch(`${productName(balance)} ${product.productCode || ""} ${product.barcode || ""} ${product.category || ""}`);
      const categoryMatches = state.selectedCategory === "all" || String(product.category || "Kategori yok") === state.selectedCategory;
      const status = balanceStatus(balance);
      const statusMatches = filter === "all" || status === filter || (filter === "critical" && status === "empty") || (filter === "transfer" && balance.recommendation);
      return (!search || haystack.includes(search)) && categoryMatches && statusMatches;
    }).sort((first, second) => {
      if (!search) return productName(first).localeCompare(productName(second), "tr");
      const firstStarts = normalizeSearch(productName(first)).startsWith(search) ? 0 : 1;
      const secondStarts = normalizeSearch(productName(second)).startsWith(search) ? 0 : 1;
      return firstStarts - secondStarts || productName(first).localeCompare(productName(second), "tr");
    });
  }

  function normalizeSearch(value) {
    return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function renderCategories() {
    const host = $("#stockLocationCategoryFilter");
    if (!host) return;
    const categories = Array.from(new Set(state.balances.map((balance) => String(productOf(balance).category || "Kategori yok")))).sort((a, b) => a.localeCompare(b, "tr"));
    if (state.selectedCategory !== "all" && !categories.includes(state.selectedCategory)) state.selectedCategory = "all";
    host.innerHTML = ["all", ...categories].map((category) => `<button type="button" class="${state.selectedCategory === category ? "is-active" : ""}" data-stock-category="${esc(category)}" aria-pressed="${state.selectedCategory === category}">${category === "all" ? "Tümü" : esc(category)}</button>`).join("");
  }

  function renderInventory() {
    const host = $("#stockLocationInventory");
    const meta = $("#stockLocationInventoryMeta");
    if (!host) return;
    const balances = filteredBalances();
    if (meta) meta.textContent = `${locationName(state.selectedLocationId)} · ${balances.length} ürün · ${state.updatedAt ? formatDate(state.updatedAt) : "güncel"}`;
    host.innerHTML = balances.length ? balances.map((balance) => {
      const product = productOf(balance);
      const rawStatus = balanceStatus(balance);
      const status = Number(balance.quantity || 0) <= 0 ? "empty" : rawStatus === "sufficient" ? "sufficient" : "critical";
      const suggestion = balance.recommendation || (balance.suggestedTransfer ? { type: "transfer", quantity: balance.suggestedTransfer } : null);
      const display = balance.quantityDisplay || {};
      const bulkUnit = textValue(product.bulkUnit || product.caseUnit, "");
      const factor = Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
      const bulk = display.bulkQuantity ?? (factor > 0 ? Math.floor(Number(balance.quantity || 0) / factor) : 0);
      const selected = String(state.selectedProductId) === productId(balance) && !$("#stockProductDrawerLayer")?.hidden;
      return `<article class="stock-location-product is-${esc(status)}${selected ? " is-selected" : ""}" data-stock-product-card="${esc(productId(balance))}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(productName(balance))} stok detayını aç">
        <div class="stock-location-product__top"><span class="stock-location-product__category">${esc(product.category || "Kategori yok")}</span>${selected ? `<span class="stock-location-product__selected" aria-label="Seçili">✓</span>` : ""}</div>
        <div class="stock-location-product__identity"><strong>${esc(productName(balance))}</strong><span>${esc(product.productCode || product.code || "Kod yok")}</span></div>
        <span class="stock-location-status is-${esc(status)}">${esc(statusLabel(status))}</span>
        <div class="stock-location-product__quantity"><strong>${esc(factor > 0 ? formatNumber(bulk) : formatNumber(balance.quantity))}</strong><span>${esc(factor > 0 ? bulkUnit : unitOf(balance))}</span></div>
        <p class="stock-location-product__conversion">${esc(formatNumber(balance.quantity))} ${esc(unitOf(balance))}${factor > 0 ? ` · 1 ${esc(bulkUnit)} = ${esc(formatNumber(factor))} ${esc(unitOf(balance))}` : ""}</p>
        ${suggestion ? `<p class="stock-transfer-suggestion">${suggestion.type === "transfer" ? "Genel Depodan transfer önerisi" : "Satın alma önerisi"}: ${esc(formatNumber(suggestion.quantity))} ${esc(unitOf(balance))}</p>` : ""}
        <span class="stock-location-product__open">Ayrıntıları aç <b aria-hidden="true">›</b></span>
      </article>`;
    }).join("") : `<div class="stock-location-empty"><strong>Bu görünümde ürün yok</strong><span>Arama veya durum filtresini değiştirin.</span></div>`;
  }

  function selectedProductBalance(productIdValue = state.selectedProductId) {
    return state.balances.find((item) => productId(item) === String(productIdValue)) || null;
  }

  function openProductDrawer(productIdValue, trigger) {
    const balance = selectedProductBalance(productIdValue);
    const layer = $("#stockProductDrawerLayer");
    const drawer = $("#stockProductDrawer");
    if (!balance || !layer || !drawer) return;
    state.selectedProductId = productId(balance);
    state.drawerReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    const product = productOf(balance);
    const totalReadOnly = state.selectedLocationId === "total";
    const selectedLocation = state.locations.find((location) => String(location.id) === String(state.selectedLocationId));
    const cafeQuantity = balance.cafeQuantity ?? (selectedLocation && selectedLocation.type === "cafe" ? balance.quantity : 0);
    $("#stockProductDrawerTitle").textContent = productName(balance);
    $("#stockProductDrawerSubtitle").textContent = `${product.productCode || "Kod yok"} · ${product.category || "Kategori yok"}`;
    $("#stockProductDrawerMessage").textContent = totalReadOnly ? "Tüm Depolar görünümü salt okunurdur. İşlem için Kafe veya Genel Depoyu seçin." : "";
    const body = $("#stockProductDrawerBody");
    body.innerHTML = `<section class="stock-drawer-overview">
      <article><span>Kafe Deposu</span><strong>${esc(quantityDisplay(balance, cafeQuantity))}</strong><small>Operasyon bakiyesi</small></article>
      <article><span>Genel Depo</span><strong>${esc(quantityDisplay(balance, balance.generalQuantity ?? 0))}</strong><small>Merkez bakiyesi</small></article>
      <article><span>Tüm Depolar</span><strong>${esc(quantityDisplay(balance, balance.totalQuantity ?? balance.quantity ?? 0))}</strong><small>Toplam bakiye</small></article>
    </section>
    <dl class="stock-drawer-details"><div><dt>Kritik eşik</dt><dd>${esc(formatNumber(balance.criticalThreshold))} ${esc(unitOf(balance))}</dd></div><div><dt>Sipariş eşiği</dt><dd>${esc(formatNumber(balance.orderThreshold))} ${esc(unitOf(balance))}</dd></div><div><dt>Hedef stok</dt><dd>${esc(formatNumber(balance.targetLevel))} ${esc(unitOf(balance))}</dd></div><div><dt>Dönüşüm</dt><dd>${esc(unitsOf(balance).map((unit) => unit.label).join(" · "))}</dd></div></dl>
    <div class="stock-drawer-actions" aria-label="${esc(productName(balance))} stok işlemleri">
      ${totalReadOnly ? "" : `<button class="ui-button ui-button--primary" type="button" data-stock-drawer-action="manual_in">Stok Ekle</button><button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="waste">Sarf İşle</button><button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="manual_out">Eksilt</button><button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="transfer">Transfer Oluştur</button><button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="settings">Eşik ve Birim Ayarları</button>`}
      <button class="ui-button ui-button--ghost" type="button" data-stock-drawer-action="history">Hareket Geçmişi</button>
    </div>`;
    layer.hidden = false;
    document.documentElement.classList.add("is-stock-drawer-open");
    renderInventory();
    window.setTimeout(() => drawer.focus(), 0);
  }

  function closeProductDrawer(options = {}) {
    const layer = $("#stockProductDrawerLayer");
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    document.documentElement.classList.remove("is-stock-drawer-open");
    const restore = state.drawerReturnFocus;
    state.drawerReturnFocus = null;
    state.selectedProductId = "";
    renderInventory();
    if (options.restoreFocus !== false && restore && typeof restore.focus === "function") restore.focus();
  }

  function inventoryProducts() {
    const seen = new Set();
    return state.balances.filter((balance) => {
      const id = productId(balance);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function setSelectOptions(select, items, selectedValue = "") {
    if (!select) return;
    select.innerHTML = items.map((item) => `<option value="${esc(item.value)}"${String(item.value) === String(selectedValue) ? " selected" : ""}>${esc(item.label)}</option>`).join("");
  }

  function renderFormOptions() {
    const activeLocations = state.locations.filter((item) => item.active !== false);
    const realSelected = state.selectedLocationId !== "total" ? state.selectedLocationId : "";
    const products = inventoryProducts();
    setSelectOptions($("#stockTransferFrom"), activeLocations.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` })), realSelected);
    const source = $("#stockTransferFrom")?.value || realSelected;
    setSelectOptions($("#stockTransferTo"), activeLocations.filter((item) => String(item.id) !== String(source)).map((item) => ({ value: item.id, label: `${item.name} (${item.code})` })));
    setSelectOptions($("#stockTransferProduct"), products.map((balance) => ({ value: productId(balance), label: `${productName(balance)} · ${formatNumber(balance.quantity)} ${unitOf(balance)}` })));
    const selectedMovementProduct = $("#stockLocationMovementProduct")?.value || "";
    setSelectOptions($("#stockLocationMovementProduct"), products.map((balance) => ({ value: productId(balance), label: productName(balance) })), selectedMovementProduct);
    const movementFilter = $("#stockMovementProductFilter");
    const oldFilter = movementFilter?.value || "all";
    setSelectOptions(movementFilter, [{ value: "all", label: "Tüm ürünler" }, ...products.map((balance) => ({ value: productId(balance), label: productName(balance) }))], oldFilter);
    const disabled = !realSelected;
    [$("#stockLocationMovementSubmit"), $("#stockLocationMovementProduct"), $("#stockLocationMovementQuantity")].forEach((element) => { if (element) element.disabled = disabled; });
    updateProductUnits();
    updateTransferPreview();
  }

  function selectedBalance(selectId) {
    const id = $(selectId)?.value || "";
    return state.balances.find((balance) => productId(balance) === String(id)) || null;
  }

  function updateProductUnits() {
    const transferBalance = selectedBalance("#stockTransferProduct");
    const movementBalance = selectedBalance("#stockLocationMovementProduct");
    if ($("#stockTransferUnit")) setSelectOptions($("#stockTransferUnit"), transferBalance ? unitsOf(transferBalance) : []);
    const movementUnit = $("#stockLocationMovementUnit");
    if (movementUnit) setSelectOptions(movementUnit, movementBalance ? unitsOf(movementBalance) : []);
    updateMovementPreview();
  }

  function updateMovementPreview() {
    const balance = selectedBalance("#stockLocationMovementProduct");
    const preview = $("#stockLocationMovementPreview");
    const current = $("#stockLocationMovementCurrent");
    if (!preview || !balance) {
      if (preview) preview.textContent = "—";
      if (current) current.textContent = "Mevcut miktar: —";
      return;
    }
    const quantity = Number($("#stockLocationMovementQuantity")?.value || 0);
    const unit = $("#stockLocationMovementUnit")?.value || unitOf(balance);
    const delta = toBaseQuantity(balance, quantity, unit) * (["manual_out", "waste"].includes($("#stockLocationMovementType")?.value) ? -1 : 1);
    const next = Number(balance.quantity || 0) + delta;
    const conversion = $("#stockLocationMovementConversion");
    if (current) current.textContent = `Mevcut miktar: ${quantityDisplay(balance)}`;
    if (conversion) conversion.textContent = quantity > 0
      ? `${formatNumber(Math.abs(delta))} ${unitOf(balance)} ${delta < 0 ? "stoktan düşülecek" : "stoğa eklenecek"}.`
      : "Miktar seçildiğinde temel birim karşılığı gösterilir.";
    preview.textContent = quantity > 0 ? quantityDisplay(balance, Math.max(0, next)) : quantityDisplay(balance);
    preview.dataset.kind = next < 0 ? "error" : "info";
  }

  function renderMovementQuickAmounts(balance) {
    const host = $("#stockMovementQuickAmounts");
    if (!host || !balance) return;
    const units = unitsOf(balance);
    const baseUnit = unitOf(balance);
    const bulk = units.find((unit) => unit.value !== baseUnit);
    const choices = [{ quantity: 1, unit: baseUnit }, { quantity: 5, unit: baseUnit }];
    if (bulk) choices.splice(1, 0, { quantity: 1, unit: bulk.value });
    host.innerHTML = choices.map((choice) => `<button type="button" data-stock-movement-quick="${choice.quantity}" data-stock-movement-unit="${esc(choice.unit)}">${choice.quantity} ${esc(choice.unit)}</button>`).join("");
  }

  function openMovementDock(productIdValue, type) {
    if (state.selectedLocationId === "total") {
      setMessage("Stok hareketi için gerçek bir depo seçin.", "error");
      return;
    }
    const balance = state.balances.find((item) => productId(item) === String(productIdValue));
    const dialog = $("#stockMovementDialog");
    if (!balance || !dialog) return;
    $("#stockLocationMovementProduct").value = productId(balance);
    const movementType = ["manual_in", "manual_out", "waste"].includes(type) ? type : "waste";
    $("#stockLocationMovementType").value = movementType;
    $("#stockLocationMovementQuantity").value = "1";
    $("#stockLocationMovementQuantity").step = productOf(balance).allowDecimal ? "0.001" : "1";
    $("#stockLocationMovementProductName").textContent = productName(balance);
    $("#stockLocationMovementModeLabel").textContent = movementType === "manual_in" ? "Stok Ekle" : movementType === "manual_out" ? "Eksilt" : "Sarf İşle";
    if ($("#stockLocationMovementReason")) $("#stockLocationMovementReason").value = movementType === "waste" ? "Sarf" : movementType === "manual_out" ? "Eksiltme" : "Kullanım";
    $("#stockMovementDialogMessage").textContent = "";
    updateProductUnits();
    renderMovementQuickAmounts(balance);
    if (!dialog.open) dialog.showModal();
    $("#stockLocationMovementQuantity")?.focus();
  }

  function closeMovementDock() {
    const dialog = $("#stockMovementDialog");
    if (dialog && dialog.open) dialog.close();
  }

  function openTransferDialog(productIdValue = state.selectedProductId) {
    if (state.selectedLocationId === "total") {
      setMessage("Transfer için gerçek bir depo seçin.", "error");
      return;
    }
    renderFormOptions();
    if ($("#stockTransferFrom")) {
      $("#stockTransferFrom").value = state.selectedLocationId;
      $("#stockTransferFrom").disabled = true;
    }
    renderFormOptions();
    if ($("#stockTransferProduct")) $("#stockTransferProduct").value = String(productIdValue || "");
    if ($("#stockTransferQuantity")) $("#stockTransferQuantity").value = "1";
    if ($("#stockTransferDialogMessage")) $("#stockTransferDialogMessage").textContent = "";
    updateProductUnits();
    updateTransferPreview();
    const dialog = $("#stockTransferDialog");
    if (dialog && !dialog.open) dialog.showModal();
    $("#stockTransferQuantity")?.focus();
  }

  function openThresholdDialog(productIdValue = state.selectedProductId) {
    const balance = selectedProductBalance(productIdValue);
    if (!balance || state.selectedLocationId === "total") {
      setMessage("Eşik ayarları için gerçek bir depo seçin.", "error");
      return;
    }
    const product = productOf(balance);
    state.selectedProductId = productId(balance);
    $("#stockThresholdDialogTitle").textContent = productName(balance);
    $("#stockThresholdDialogMeta").textContent = `${locationName(state.selectedLocationId)} · ${product.productCode || "Kod yok"}`;
    $("#stockThresholdCritical").value = String(balance.criticalThreshold ?? 0);
    $("#stockThresholdOrder").value = String(balance.orderThreshold ?? 0);
    $("#stockThresholdTarget").value = String(balance.targetLevel ?? 0);
    $("#stockThresholdBaseUnit").value = unitOf(balance);
    $("#stockThresholdBulkUnit").value = textValue(product.bulkUnit || product.caseUnit, "");
    $("#stockThresholdFactor").value = String(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
    $("#stockThresholdDialogMessage").textContent = "";
    const dialog = $("#stockThresholdDialog");
    if (dialog && !dialog.open) dialog.showModal();
    $("#stockThresholdCritical")?.focus();
  }

  function updateTransferPreview() {
    const preview = $("#stockTransferPreview");
    if (!preview) return;
    const balance = selectedBalance("#stockTransferProduct");
    const quantity = Number($("#stockTransferQuantity")?.value || 0);
    if (!balance || !(quantity > 0)) {
      preview.textContent = "Ürün ve miktar seçildiğinde önizleme görünür.";
      return;
    }
    const unit = $("#stockTransferUnit")?.value || unitOf(balance);
    const baseQuantity = toBaseQuantity(balance, quantity, unit);
    const after = Number(balance.quantity || 0) - baseQuantity;
    preview.textContent = `${locationName($("#stockTransferFrom")?.value)}: ${formatNumber(balance.quantity)} → ${formatNumber(after)} ${unitOf(balance)} · Hedef: ${locationName($("#stockTransferTo")?.value)}`;
    preview.dataset.kind = after < 0 ? "error" : "info";
  }

  function renderTransfers() {
    const host = $("#stockTransferRequests");
    const count = $("#stockTransferPendingCount");
    if (count) count.textContent = String(state.transfers.filter((item) => ["pending", "onay_bekliyor"].includes(item.status)).length);
    if (!host) return;
    host.innerHTML = state.transfers.length ? state.transfers.map((transfer) => {
      const product = transfer.product || {};
      const pending = ["pending", "onay_bekliyor"].includes(transfer.status);
      return `<article class="stock-transfer-request">
        <div><strong>${esc(product.name || product.productName || transfer.productName || "Stok ürünü")}</strong><span>${esc(transfer.requestedByName || transfer.personnelName || "Personel")} · ${esc(formatDate(transfer.createdAt))}</span></div>
        <p>${esc(locationName(transfer.fromLocationId))} → ${esc(locationName(transfer.toLocationId))}</p>
        <b>${esc(formatNumber(transfer.quantity))} ${esc(transfer.baseUnit || transfer.unit || "adet")}</b>
        <span class="stock-location-status is-${esc(transfer.status)}">${esc(statusLabel(transfer.status))}</span>
        ${pending ? `<label><span>Yönetici notu</span><input type="text" maxlength="250" data-transfer-note="${esc(transfer.id)}" placeholder="Ret için neden zorunlu"></label>
          <div class="stock-transfer-request__actions">
            <button class="ui-button ui-button--danger ui-button--sm" type="button" data-transfer-decision="reject" data-transfer-id="${esc(transfer.id)}">Reddet</button>
            <button class="ui-button ui-button--primary ui-button--sm" type="button" data-transfer-decision="approve" data-transfer-id="${esc(transfer.id)}">Onayla ve Aktar</button>
          </div>` : ""}
      </article>`;
    }).join("") : `<div class="stock-location-empty"><strong>Bekleyen transfer talebi yok</strong><span>Personel talepleri burada görünecek.</span></div>`;
  }

  function movementText(movement) {
    const from = movement.fromLocationId ? locationName(movement.fromLocationId) : "";
    const to = movement.toLocationId ? locationName(movement.toLocationId) : "";
    if (movement.type === "transfer") return `${from} → ${to}`;
    return locationName(movement.locationId || movement.toLocationId || movement.fromLocationId);
  }

  function renderMovements() {
    const host = $("#stockLocationMovementHistory");
    if (!host) return;
    host.innerHTML = state.movements.length ? state.movements.map((movement) => {
      const reversible = movement.status !== "reversed" && !movement.reversedAt && !movement.reversedMovementId && movement.type !== "reversal";
      return `<article class="stock-location-movement">
        <div><strong>${esc(movement.productName || "Stok ürünü")}</strong><span>${esc(movementText(movement))}</span></div>
        <p>${esc(statusLabel(movement.type))} · ${esc(formatDate(movement.createdAt))}</p>
        <b>${esc(formatNumber(movement.quantity))} ${esc(movement.baseUnit || movement.unit || "adet")}</b>
        ${reversible ? `<button class="ui-button ui-button--ghost ui-button--sm" type="button" data-reverse-movement="${esc(movement.id)}">Ters Kayıt</button>` : `<span class="stock-location-status">Ters kayıtlı</span>`}
      </article>`;
    }).join("") : `<div class="stock-location-empty"><strong>Hareket kaydı yok</strong><span>Seçili filtrelere ait işlem bulunamadı.</span></div>`;
  }

  function renderLocationManagement() {
    const host = $("#stockLocationManagementList");
    if (!host) return;
    const activePersonnel = state.personnel.filter((person) => person.active !== false);
    host.innerHTML = state.locations.map((location) => {
      const assigned = new Set((location.assignedPersonnelIds || []).map(String));
      const assignmentControl = location.type === "cafe" ? `<label class="stock-location-assignment">
        <span>Atanmış personel</span>
        <select multiple size="${Math.min(5, Math.max(2, activePersonnel.length || 2))}" data-location-personnel="${esc(location.id)}" aria-label="${esc(location.name)} personel ataması">
          ${activePersonnel.map((person) => `<option value="${esc(person.id)}"${assigned.has(String(person.id)) ? " selected" : ""}>${esc(person.name)}${person.username ? ` · @${esc(person.username)}` : ""}</option>`).join("")}
        </select>
      </label>
      <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-location-personnel-save="${esc(location.id)}">Atamayı Kaydet</button>`
        : `<span class="stock-location-assignment__hint">Personel yalnızca Kafe Deposuna atanabilir.</span>`;
      return `<article>
        <div><strong>${esc(location.name)}</strong><span>${esc(location.code)} · ${esc(location.type)}${location.description ? ` · ${esc(location.description)}` : ""}</span></div>
        <span class="stock-location-status is-${location.active === false ? "inactive" : "active"}">${location.active === false ? "Pasif" : "Aktif"}</span>
        <div class="stock-location-management__actions">${assignmentControl}<button class="ui-button ui-button--secondary ui-button--sm" type="button" data-location-edit="${esc(location.id)}">Düzenle</button><button class="ui-button ui-button--ghost ui-button--sm" type="button" data-location-toggle="${esc(location.id)}" data-next-active="${location.active === false}">${location.active === false ? "Aktifleştir" : "Pasifleştir"}</button>${!["CAFE", "GENEL"].includes(location.code) ? `<button class="ui-button ui-button--danger ui-button--sm" type="button" data-location-remove="${esc(location.id)}">Pasifleştir</button>` : ""}</div>
      </article>`;
    }).join("");
  }

  function renderAll() {
    renderLocations();
    renderSummary();
    renderCategories();
    renderInventory();
    renderFormOptions();
    renderTransfers();
    renderMovements();
    renderLocationManagement();
  }

  async function reloadAfterMutation(result, message) {
    updateRevision(result);
    state.stale = true;
    await loadAll({ force: true, reloadLocations: true });
    setMessage(message);
    document.dispatchEvent(new CustomEvent("tahmisci:stock-location-updated", { detail: { revision: state.revision } }));
  }

  async function runOperation(key, button, operation) {
    if (state.busyKeys.has(key)) return;
    state.busyKeys.add(key);
    const oldText = button && button.textContent;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "İşleniyor…";
    }
    try {
      return await operation();
    } catch (error) {
      setMessage(error.message, "error");
      throw error;
    } finally {
      state.busyKeys.delete(key);
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = oldText;
      }
    }
  }

  function requestConfirmation(title, message, confirmLabel = "Onayla") {
    const dialog = $("#stockConfirmDialog");
    if (!dialog) return Promise.resolve(false);
    $("#stockConfirmTitle").textContent = title;
    $("#stockConfirmMessage").textContent = message;
    $("#stockConfirmSubmit").textContent = confirmLabel;
    dialog.returnValue = "cancel";
    if (!dialog.open) dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    });
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && dialog.open) dialog.close();
  }

  async function submitTransfer(form) {
    const button = $("#stockTransferSubmit");
    return runOperation("direct-transfer", button, async () => {
      const balance = selectedBalance("#stockTransferProduct");
      const quantity = Number($("#stockTransferQuantity")?.value || 0);
      const fromLocationId = $("#stockTransferFrom")?.value || "";
      const toLocationId = $("#stockTransferTo")?.value || "";
      if (!balance || !fromLocationId || !toLocationId || fromLocationId === toLocationId || !(quantity > 0)) {
        throw new Error("Kaynak, hedef, ürün ve geçerli miktar seçin.");
      }
      const transferUnit = $("#stockTransferUnit")?.value || unitOf(balance);
      if (toBaseQuantity(balance, quantity, transferUnit) > Number(balance.quantity || 0)) throw new Error("Kaynak depoda yeterli stok yok.");
      const result = await api("/api/admin/stock/transfers", mutation("POST", {
        productId: productId(balance), fromLocationId, toLocationId, quantity,
        unit: transferUnit, note: $("#stockTransferNote")?.value.trim() || "", directApply: true, approveNow: true
      }, "admin-stock-transfer"));
      form.reset();
      $("#stockTransferDialog")?.close();
      closeProductDrawer({ restoreFocus: false });
      await reloadAfterMutation(result, "Depolar arası transfer tamamlandı.");
    });
  }

  async function submitMovement(form) {
    const button = $("#stockLocationMovementSubmit");
    return runOperation("stock-movement", button, async () => {
      if (!state.selectedLocationId || state.selectedLocationId === "total") throw new Error("Önce gerçek bir depo seçin.");
      const balance = selectedBalance("#stockLocationMovementProduct");
      const quantity = Number($("#stockLocationMovementQuantity")?.value || 0);
      if (!balance || !(quantity > 0)) throw new Error("Ürün ve geçerli miktar seçin.");
      const reason = $("#stockLocationMovementReason")?.value || "Kullanım";
      const note = $("#stockLocationMovementNote")?.value.trim() || "";
      if (reason === "Diğer" && !note) throw new Error("Diğer nedeni için kısa bir açıklama yazın.");
      const result = await api("/api/admin/stock/movements", mutation("POST", {
        type: $("#stockLocationMovementType")?.value,
        productId: productId(balance), locationId: state.selectedLocationId, quantity,
        unit: $("#stockLocationMovementUnit")?.value || unitOf(balance),
        reason, note,
        expectedBalanceRevision: Math.max(0, Number(balance.revision || 0))
      }, "admin-stock-movement"));
      form.reset();
      closeMovementDock();
      closeProductDrawer({ restoreFocus: false });
      await reloadAfterMutation(result, "Stok hareketi seçili depoya kaydedildi.");
    });
  }

  async function decideTransfer(id, decision, button) {
    const note = $(`[data-transfer-note="${CSS.escape(id)}"]`)?.value.trim() || "";
    if (decision === "reject" && !note) {
      setMessage("Transfer talebini reddetmek için neden yazın.", "error");
      return;
    }
    return runOperation(`transfer-${decision}:${id}`, button, async () => {
      const result = await api(`/api/admin/stock/transfers/${encodeURIComponent(id)}/${decision}`, mutation("POST", {
        note, reason: decision === "reject" ? note : ""
      }, `admin-transfer-${decision}`));
      await reloadAfterMutation(result, decision === "approve" ? "Transfer talebi onaylandı ve bakiyeler güncellendi." : "Transfer talebi reddedildi.");
    });
  }

  async function reverseMovement(id, button) {
    if (!await requestConfirmation("Ters kayıt oluştur", "Bu stok hareketi silinmeden, denetimli bir ters hareketle geri alınacaktır.", "Ters Kayıt Oluştur")) return;
    return runOperation(`reverse:${id}`, button, async () => {
      const result = await api(`/api/admin/stock/movements/${encodeURIComponent(id)}/reverse`, mutation("POST", {
        note: "Yönetici arayüzünden ters kayıt"
      }, "admin-stock-reversal"));
      await reloadAfterMutation(result, "Ters kayıt oluşturuldu; geçmiş kayıt silinmedi.");
    });
  }

  async function createLocation(form) {
    const button = $("button[type=submit]", form);
    return runOperation("location-create", button, async () => {
      const name = $("#stockLocationName")?.value.trim() || "";
      const code = $("#stockLocationCode")?.value.trim().toUpperCase() || "";
      if (!name || !code) throw new Error("Depo adı ve kodu zorunludur.");
      const result = await api("/api/admin/stock/locations", mutation("POST", {
        name, code, type: $("#stockLocationType")?.value || "other",
        description: $("#stockLocationDescription")?.value.trim() || "",
        active: true, isDefault: Boolean($("#stockLocationDefault")?.checked)
      }, "admin-stock-location"));
      form.reset();
      await reloadAfterMutation(result, "Yeni depo oluşturuldu.");
    });
  }

  async function toggleLocation(id, active, button) {
    return runOperation(`location-toggle:${id}`, button, async () => {
      const result = await api(`/api/admin/stock/locations/${encodeURIComponent(id)}`, mutation("PATCH", { active }, "admin-stock-location-toggle"));
      await reloadAfterMutation(result, active ? "Depo aktifleştirildi." : "Depo pasifleştirildi.");
    });
  }

  async function editLocation(id, button) {
    const location = state.locations.find((item) => String(item.id) === String(id));
    if (!location) return;
    $("#stockLocationEditId").value = String(id);
    $("#stockLocationEditName").value = location.name || "";
    $("#stockLocationEditDescription").value = location.description || "";
    $("#stockLocationEditMessage").textContent = "";
    const dialog = $("#stockLocationEditDialog");
    if (dialog && !dialog.open) dialog.showModal();
    $("#stockLocationEditName")?.focus();
  }

  async function saveLocationEdit(form) {
    const id = $("#stockLocationEditId")?.value || "";
    const name = $("#stockLocationEditName")?.value.trim() || "";
    const description = $("#stockLocationEditDescription")?.value.trim() || "";
    if (!id || !name) throw new Error("Depo adı zorunludur.");
    const button = $("#stockLocationEditSubmit");
    return runOperation(`location-edit:${id}`, button, async () => {
      const result = await api(`/api/admin/stock/locations/${encodeURIComponent(id)}`, mutation("PATCH", { name, description }, "admin-stock-location-edit"));
      $("#stockLocationEditDialog")?.close();
      await reloadAfterMutation(result, "Depo bilgileri güncellendi.");
    });
  }

  async function removeLocation(id, button) {
    const location = state.locations.find((item) => String(item.id) === String(id));
    if (!location || !await requestConfirmation("Depoyu pasifleştir", `${location.name} yeni işlemlere kapatılacak; geçmiş hareketleri korunacaktır.`, "Pasifleştir")) return;
    return runOperation(`location-remove:${id}`, button, async () => {
      const result = await api(`/api/admin/stock/locations/${encodeURIComponent(id)}`, mutation("DELETE", {}, "admin-stock-location-remove"));
      await reloadAfterMutation(result, "Depo pasifleştirildi; geçmiş hareketler korundu.");
    });
  }

  async function saveLocationPersonnel(id, button) {
    const select = $(`[data-location-personnel="${CSS.escape(String(id))}"]`);
    if (!select) return;
    const assignedPersonnelIds = Array.from(select.selectedOptions || []).map((option) => option.value).filter(Boolean);
    return runOperation(`location-personnel:${id}`, button, async () => {
      const result = await api(`/api/admin/stock/locations/${encodeURIComponent(id)}`, mutation("PATCH", { assignedPersonnelIds }, "admin-stock-location-personnel"));
      await reloadAfterMutation(result, "Personel depo ataması kaydedildi.");
    });
  }

  async function editThresholds(productIdValue) {
    openThresholdDialog(productIdValue);
  }

  async function submitThresholds(form) {
    const balance = selectedProductBalance();
    if (!balance || state.selectedLocationId === "total") throw new Error("Önce gerçek bir depo ve ürün seçin.");
    const critical = Number($("#stockThresholdCritical")?.value);
    const order = Number($("#stockThresholdOrder")?.value);
    const target = Number($("#stockThresholdTarget")?.value);
    const baseUnit = textValue($("#stockThresholdBaseUnit")?.value, "adet").toLocaleLowerCase("tr-TR");
    const bulkUnit = textValue($("#stockThresholdBulkUnit")?.value, "").toLocaleLowerCase("tr-TR");
    const factor = Number($("#stockThresholdFactor")?.value || 0);
    if ([critical, order, target].some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Eşik değerleri sıfır veya daha büyük olmalıdır.");
    if (critical > order) throw new Error("Kritik eşik sipariş eşiğinden büyük olamaz.");
    if (!baseUnit || !Number.isFinite(factor) || factor < 0 || (bulkUnit && factor <= 0)) throw new Error("Birim dönüşümü geçersiz.");
    const product = productOf(balance);
    return runOperation(`thresholds:${productId(balance)}`, $("#stockThresholdSubmit"), async () => {
      const result = await api(`/api/admin/stock/inventory/${encodeURIComponent(productId(balance))}`, mutation("PATCH", {
        locationId: state.selectedLocationId, criticalThreshold: critical, orderThreshold: order, targetLevel: target,
        baseUnit, bulkUnit, unitsPerBulkUnit: factor, allowDecimal: Boolean(product.allowDecimal),
        defaultMovementUnit: product.defaultMovementUnit || baseUnit
      }, "admin-stock-thresholds"));
      form.reset();
      $("#stockThresholdDialog")?.close();
      closeProductDrawer({ restoreFocus: false });
      await reloadAfterMutation(result, "Depo eşikleri ve birim dönüşümü güncellendi.");
    });
  }

  function renderCountDialog() {
    const count = state.activeCount;
    const dialog = $("#stockCountDialog");
    const host = $("#stockCountItems");
    if (!dialog || !host || !count) return;
    $("#stockCountDialogTitle").textContent = `${locationName(count.locationId)} Sayımı`;
    $("#stockCountDialogMeta").textContent = `${count.items.length} ürün · Sistem bakiyesi onaydan önce değişmez.`;
    host.innerHTML = count.items.map((item) => {
      const balance = state.balances.find((candidate) => productId(candidate) === String(item.productId));
      const product = item.product || productOf(balance);
      const units = balance ? unitsOf(balance) : [{ value: product.baseUnit || product.unit || "adet", label: product.baseUnit || product.unit || "adet" }];
      return `<label class="stock-count-item"><span><strong>${esc(product.name || product.productName || "Stok ürünü")}</strong><small>Sistem: ${esc(item.systemDisplay && item.systemDisplay.display || quantityDisplay(balance, item.systemQuantity))}</small></span><input type="number" min="0" step="${product.allowDecimal ? "0.001" : "1"}" inputmode="decimal" data-count-quantity="${esc(item.productId)}" value="${item.inputQuantity ?? ""}" placeholder="Fiziksel miktar"><select data-count-unit="${esc(item.productId)}">${units.map((unit) => `<option value="${esc(unit.value)}"${String(unit.value) === String(item.inputUnit) ? " selected" : ""}>${esc(unit.label)}</option>`).join("")}</select><output>${item.difference === null || item.difference === undefined ? "Sayılmadı" : `Fark: ${formatNumber(item.difference)} ${esc(product.baseUnit || product.unit || "adet")}`}</output></label>`;
    }).join("");
  }

  function countInputItems() {
    return $$('[data-count-quantity]').filter((input) => input.value !== "").map((input) => ({
      productId: input.dataset.countQuantity,
      quantity: Number(input.value),
      unit: $(`[data-count-unit="${CSS.escape(input.dataset.countQuantity)}"]`)?.value || "adet"
    }));
  }

  async function persistCountInputs() {
    if (!state.activeCount) throw new Error("Aktif sayım bulunamadı.");
    const items = countInputItems();
    if (!items.length) throw new Error("En az bir fiziksel sayım sonucu girin.");
    const result = await api(`/api/admin/stock/counts/${encodeURIComponent(state.activeCount.id)}`, mutation("PATCH", { items }, "admin-stock-count-save"));
    updateRevision(result);
    state.activeCount = result.count;
    state.counts = [result.count, ...state.counts.filter((count) => count.id !== result.count.id)];
    renderCountDialog();
    return result;
  }

  async function openOrStartCount(button) {
    if (!state.selectedLocationId || state.selectedLocationId === "total") throw new Error("Sayım için gerçek bir depo seçin.");
    return runOperation("stock-count-start", button, async () => {
      const existing = state.counts.find((count) => count.status === "active" && count.locationId === state.selectedLocationId);
      if (existing) state.activeCount = existing;
      else {
        const result = await api("/api/admin/stock/counts", mutation("POST", { locationId: state.selectedLocationId }, "admin-stock-count-start"));
        updateRevision(result);
        state.activeCount = result.count;
        state.counts.unshift(result.count);
      }
      renderCountDialog();
      $("#stockCountDialog")?.showModal();
    });
  }

  async function saveCount(button) {
    return runOperation("stock-count-save", button, async () => {
      await persistCountInputs();
      $("#stockCountMessage").textContent = "Sayım taslağı kaydedildi; stok henüz değişmedi.";
    });
  }

  async function approveCount(button) {
    return runOperation("stock-count-approve", button, async () => {
      await persistCountInputs();
      const result = await api(`/api/admin/stock/counts/${encodeURIComponent(state.activeCount.id)}/approve`, mutation("POST", {}, "admin-stock-count-approve"));
      $("#stockCountDialog")?.close();
      state.activeCount = null;
      await reloadAfterMutation(result, "Sayım onaylandı; farklar atomik stok hareketleriyle uygulandı.");
    });
  }

  async function cancelCount(button) {
    if (!state.activeCount || !await requestConfirmation("Sayımı iptal et", "Taslak sayım kapatılacak; stok bakiyesi değişmeyecektir.", "Sayımı İptal Et")) return;
    return runOperation("stock-count-cancel", button, async () => {
      const result = await api(`/api/admin/stock/counts/${encodeURIComponent(state.activeCount.id)}/cancel`, mutation("POST", {}, "admin-stock-count-cancel"));
      $("#stockCountDialog")?.close();
      state.activeCount = null;
      await reloadAfterMutation(result, "Sayım iptal edildi; stok bakiyesi değişmedi.");
    });
  }

  function publishLocationContext() {
    const detail = { locations: state.locations.slice(), selectedLocationId: state.selectedLocationId, revision: state.revision };
    document.dispatchEvent(new CustomEvent("tahmisci:stock-locations-ready", { detail }));
  }

  function bindEvents() {
    if (state.bound) return;
    const workspace = $("#stockLocationWorkspace");
    if (!workspace) return;
    state.bound = true;
    workspace.addEventListener("click", (event) => {
      const locationButton = event.target.closest("[data-stock-location-select]");
      if (locationButton) {
        state.selectedLocationId = locationButton.dataset.stockLocationSelect;
        try { localStorage.setItem(LOCATION_STORAGE_KEY, state.selectedLocationId); } catch (_error) {}
        closeProductDrawer({ restoreFocus: false });
        state.secondaryLoaded = false;
        state.stale = true;
        loadAll({ force: true }).catch(() => {});
        return;
      }
      const category = event.target.closest("[data-stock-category]");
      if (category) {
        state.selectedCategory = category.dataset.stockCategory;
        renderCategories();
        renderInventory();
        return;
      }
      const drawerClose = event.target.closest("[data-stock-drawer-close]");
      if (drawerClose) { closeProductDrawer(); return; }
      const drawerAction = event.target.closest("[data-stock-drawer-action]");
      if (drawerAction) {
        const action = drawerAction.dataset.stockDrawerAction;
        if (action === "manual_in" || action === "manual_out" || action === "waste") openMovementDock(state.selectedProductId, action);
        else if (action === "transfer") openTransferDialog(state.selectedProductId);
        else if (action === "settings") openThresholdDialog(state.selectedProductId);
        else if (action === "history") {
          if ($("#stockMovementProductFilter")) $("#stockMovementProductFilter").value = state.selectedProductId;
          loadMovements().then(() => {
            renderMovements();
            const dialog = $("#stockHistoryDialog");
            if (dialog && !dialog.open) dialog.showModal();
          }).catch((error) => setMessage(error.message, "error"));
        }
        return;
      }
      const productCard = event.target.closest("[data-stock-product-card]");
      if (productCard) { openProductDrawer(productCard.dataset.stockProductCard, productCard); return; }
      const stepper = event.target.closest("[data-stock-quantity-step]");
      if (stepper) {
        const input = $("#stockLocationMovementQuantity");
        const next = Math.max(Number(input.min || 0.01), Number(input.value || 0) + Number(stepper.dataset.stockQuantityStep || 0));
        input.value = String(next);
        updateMovementPreview();
        return;
      }
      const quickMovement = event.target.closest("[data-stock-movement-quick]");
      if (quickMovement) {
        const input = $("#stockLocationMovementQuantity");
        const unit = $("#stockLocationMovementUnit");
        if (input) input.value = quickMovement.dataset.stockMovementQuick || "1";
        if (unit) unit.value = quickMovement.dataset.stockMovementUnit || unit.value;
        updateMovementPreview();
        input?.focus();
        return;
      }
      const decision = event.target.closest("[data-transfer-decision]");
      if (decision) {
        decideTransfer(decision.dataset.transferId, decision.dataset.transferDecision, decision).catch(() => {});
        return;
      }
      const reverse = event.target.closest("[data-reverse-movement]");
      if (reverse) {
        reverseMovement(reverse.dataset.reverseMovement, reverse).catch(() => {});
        return;
      }
      const locationToggle = event.target.closest("[data-location-toggle]");
      if (locationToggle) {
        toggleLocation(locationToggle.dataset.locationToggle, locationToggle.dataset.nextActive === "true", locationToggle).catch(() => {});
        return;
      }
      const locationEdit = event.target.closest("[data-location-edit]");
      if (locationEdit) {
        editLocation(locationEdit.dataset.locationEdit, locationEdit).catch(() => {});
        return;
      }
      const locationRemove = event.target.closest("[data-location-remove]");
      if (locationRemove) {
        removeLocation(locationRemove.dataset.locationRemove, locationRemove).catch(() => {});
        return;
      }
      const locationPersonnel = event.target.closest("[data-location-personnel-save]");
      if (locationPersonnel) {
        saveLocationPersonnel(locationPersonnel.dataset.locationPersonnelSave, locationPersonnel).catch(() => {});
        return;
      }
    });
    workspace.addEventListener("keydown", (event) => {
      const card = event.target.closest("[data-stock-product-card]");
      if (!card || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openProductDrawer(card.dataset.stockProductCard, card);
    });
    $("#stockLocationSearch")?.addEventListener("input", renderInventory);
    $("#stockLocationStatusFilter")?.addEventListener("change", renderInventory);
    $("#stockTransferTo")?.addEventListener("change", updateTransferPreview);
    $("#stockTransferProduct")?.addEventListener("change", () => { updateProductUnits(); updateTransferPreview(); });
    $("#stockTransferQuantity")?.addEventListener("input", updateTransferPreview);
    $("#stockTransferUnit")?.addEventListener("change", updateTransferPreview);
    $("#stockLocationMovementProduct")?.addEventListener("change", updateProductUnits);
    $("#stockLocationMovementUnit")?.addEventListener("change", updateMovementPreview);
    $("#stockLocationMovementReason")?.addEventListener("change", (event) => {
      const note = $("#stockLocationMovementNote");
      if (note) note.required = event.currentTarget.value === "Diğer";
    });
    $("#stockLocationMovementQuantity")?.addEventListener("input", updateMovementPreview);
    $("#stockLocationMovementClose")?.addEventListener("click", closeMovementDock);
    $("#stockMovementTypeFilter")?.addEventListener("change", () => loadMovements().then(renderMovements).catch((error) => setMessage(error.message, "error")));
    $("#stockMovementProductFilter")?.addEventListener("change", () => loadMovements().then(renderMovements).catch((error) => setMessage(error.message, "error")));
    $("#stockLocationRefreshButton")?.addEventListener("click", (event) => runOperation("refresh", event.currentTarget, () => loadAll({ force: true })).catch(() => {}));
    $("#stockLocationNewProductButton")?.addEventListener("click", () => {
      $("#stockManagementAccordion").open = true;
      document.dispatchEvent(new CustomEvent("tahmisci:stock-catalog-open", { detail: { action: "new-product" } }));
      $("#stockManagementAccordion")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#stockTransferRequestsButton")?.addEventListener("click", () => {
      const dialog = $("#stockTransferRequestsDialog");
      if (dialog && !dialog.open) dialog.showModal();
    });
    $("#stockMovementHistoryButton")?.addEventListener("click", () => loadMovements().then(() => {
      renderMovements();
      const dialog = $("#stockHistoryDialog");
      if (dialog && !dialog.open) dialog.showModal();
    }).catch((error) => setMessage(error.message, "error")));
    $("#stockLocationManagementButton")?.addEventListener("click", () => {
      const dialog = $("#stockLocationManagementDialog");
      if (dialog && !dialog.open) dialog.showModal();
    });
    $("#stockCountStartButton")?.addEventListener("click", (event) => openOrStartCount(event.currentTarget).catch((error) => setMessage(error.message, "error")));
    $("#stockCountSaveButton")?.addEventListener("click", (event) => saveCount(event.currentTarget).catch((error) => { $("#stockCountMessage").textContent = error.message; }));
    $("#stockCountApproveButton")?.addEventListener("click", (event) => approveCount(event.currentTarget).catch((error) => { $("#stockCountMessage").textContent = error.message; }));
    $("#stockCountCancelButton")?.addEventListener("click", (event) => cancelCount(event.currentTarget).catch((error) => { $("#stockCountMessage").textContent = error.message; }));
    $("#stockTransferForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitTransfer(event.currentTarget).catch((error) => { $("#stockTransferDialogMessage").textContent = error.message; }); });
    $("#stockLocationMovementForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitMovement(event.currentTarget).catch((error) => { $("#stockMovementDialogMessage").textContent = error.message; }); });
    $("#stockThresholdForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitThresholds(event.currentTarget).catch((error) => { $("#stockThresholdDialogMessage").textContent = error.message; }); });
    $("#stockLocationEditForm")?.addEventListener("submit", (event) => { event.preventDefault(); saveLocationEdit(event.currentTarget).catch((error) => { $("#stockLocationEditMessage").textContent = error.message; }); });
    $("#stockLocationCreateForm")?.addEventListener("submit", (event) => { event.preventDefault(); createLocation(event.currentTarget).catch(() => {}); });
    $$('[data-stock-dialog-close]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.stockDialogClose)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#stockProductDrawerLayer")?.hidden && !document.querySelector("dialog[open]")) closeProductDrawer();
    });
  }

  function mount() {
    bindEvents();
    if (activeSection() !== "stock") return;
    if (state.loaded && !state.stale) {
      renderAll();
      return;
    }
    loadAll({ force: true }).catch(() => {});
  }

  window.TahmisciStockLocations = Object.freeze({
    refresh: () => loadAll({ force: true }),
    locations: () => state.locations.slice(),
    selectedLocationId: () => state.selectedLocationId,
    find: (id) => state.locations.find((location) => String(location.id) === String(id)) || null,
    ensureLoaded: () => state.loaded ? Promise.resolve(state.locations.slice()) : loadLocations().then(() => state.locations.slice())
  });

  document.addEventListener("tahmisci:admin-section-change", (event) => {
    if (event.detail && event.detail.section === "stock") mount();
  });
  document.addEventListener("tahmisci:admin-session-started", () => {
    state.stale = true;
    mount();
  });
    document.addEventListener("tahmisci:admin-session-ended", () => {
    state.locations = [];
    state.personnel = [];
    state.balances = [];
    state.transfers = [];
    state.movements = [];
    state.counts = [];
    state.activeCount = null;
    state.secondaryLoaded = false;
    state.secondaryLoadPromise = null;
    state.secondaryLocationId = "";
    state.loaded = false;
    state.stale = true;
  });
  document.addEventListener("tahmisci:stock-updated", () => {
    state.stale = true;
    if (activeSection() === "stock") loadAll({ force: true }).catch(() => {});
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
