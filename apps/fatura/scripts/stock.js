import { api as faturaApi, requestId as createRequestId } from "./api.js";
import { CAPABILITIES, has, hasSection, state as faturaState, updateRevision as syncRevision } from "./state.js";
import { requestText } from "./ui-dialogs.js";

"use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const locationNameKey = (value) => String(value || "").trim().toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const LOCATION_STORAGE_KEY = "tahmisci.admin.stock.location.v1";

  // Fatura kabuğu, stok görünümü ve olay akışı aynı revision kontrollü state'i paylaşır.
  const state = faturaState.stock;
  let stockKeydownHandler = null;

  function requestId(prefix) {
    return createRequestId(prefix);
  }

  function can(capability) {
    return has(capability);
  }

  function domainRevision(domain = "inventory") {
    return domain === "catalog"
      ? Math.max(0, Number(state.catalogRevision || faturaState.revisions.catalog || 0))
      : Math.max(0, Number(state.inventoryRevision || faturaState.revisions.inventory || 0));
  }

  async function api(path, options = {}) {
    const next = { ...options };
    if (typeof next.body === "string") {
      try { next.body = JSON.parse(next.body); } catch (_error) { /* binary/raw payload yok */ }
    }
    if (next.headers) {
      const headers = new Headers(next.headers);
      next.requestId = next.requestId || headers.get("X-Request-ID") || headers.get("Idempotency-Key") || undefined;
      next.headers = headers;
    }
    if (!new Set(["GET", "HEAD"]).has(String(next.method || "GET").toUpperCase())) {
      next.expectedRevision = next.expectedRevision ?? domainRevision(next.revisionDomain || "inventory");
    }
    delete next.revisionDomain;
    return faturaApi(String(path || ""), next);
  }

  function mutation(method, body, prefix, revisionDomains = "inventory") {
    const id = requestId(prefix);
    const domains = Array.isArray(revisionDomains) ? revisionDomains : [revisionDomains];
    const primaryDomain = domains.includes("inventory") ? "inventory" : "catalog";
    const expectedRevision = domainRevision(primaryDomain);
    const expectedInventoryRevision = domains.includes("inventory") ? domainRevision("inventory") : undefined;
    const expectedCatalogRevision = domains.includes("catalog") ? domainRevision("catalog") : undefined;
    return {
      method,
      requestId: id,
      revisionDomain: primaryDomain,
      expectedRevision,
      expectedInventoryRevision,
      expectedCatalogRevision,
      body: {
        ...body,
        requestId: id,
        expectedRevision,
        ...(expectedInventoryRevision === undefined ? {} : { expectedInventoryRevision }),
        ...(expectedCatalogRevision === undefined ? {} : { expectedCatalogRevision })
      }
    };
  }

  function setMessage(message, kind = "success") {
    const node = $("#stockLocationMessage");
    if (!node) return;
    node.hidden = !message;
    node.textContent = String(message || "");
    node.dataset.kind = kind;
  }

  function applyCapabilityVisibility() {
    const rules = [
      ["#stockLocationNewProductButton", CAPABILITIES.inventoryCatalogManage],
      ["#stockUnitSettingsButton", CAPABILITIES.inventoryCatalogManage],
      ["#stockManagementAccordion", CAPABILITIES.inventoryCatalogManage],
      ["#stockLocationOverviewAddButton", CAPABILITIES.inventoryLocationManage],
      ["#stockLocationManagementButton", CAPABILITIES.inventoryLocationManage],
      ["#stockCountStartButton", CAPABILITIES.inventoryCountManage],
      ["#stockQuickInButton", CAPABILITIES.inventoryMovementCreate],
      ["#stockQuickOutButton", CAPABILITIES.inventoryMovementCreate],
      ["#stockQuickTransferButton", CAPABILITIES.inventoryTransferCreate],
      ["#stockQuickShipmentButton", CAPABILITIES.receiptCreate]
    ];
    for (const [selector, capability] of rules) {
      const node = $(selector);
      if (node) node.hidden = !can(capability) || selector === "#stockQuickShipmentButton" && !hasSection("shipments");
    }
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

  function formatMoney(value) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number(value || 0) / 100);
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

  function unitKey(value) {
    return textValue(value, "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/\s+/g, " ");
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
    const values = Array.from(new Set([baseUnit, ...(bulkUnit && factor > 0 ? [bulkUnit] : [])]));
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
    return faturaState.activeView;
  }

  function updateRevision(result, domain = "inventory") {
    const revision = Number(result && result.revision);
    if (Number.isInteger(revision) && revision >= 0) {
      if (domain === "catalog") state.catalogRevision = Math.max(state.catalogRevision || 0, revision);
      else state.inventoryRevision = Math.max(state.inventoryRevision || 0, revision);
    }
    const inventoryRevision = Number(result && result.inventoryRevision);
    const catalogRevision = Number(result && result.catalogRevision);
    if (Number.isInteger(inventoryRevision) && inventoryRevision >= 0) state.inventoryRevision = Math.max(state.inventoryRevision || 0, inventoryRevision);
    if (Number.isInteger(catalogRevision) && catalogRevision >= 0) state.catalogRevision = Math.max(state.catalogRevision || 0, catalogRevision);
    state.revision = state.inventoryRevision;
    syncRevision(result, domain);
    if (result && result.updatedAt) state.updatedAt = result.updatedAt;
  }

  async function loadLocations(options = {}) {
    if (state.locations.length && !options.force) return { locations: state.locations, personnel: state.personnel, revision: state.inventoryRevision };
    const result = await api("/api/procurement/v1/stock/locations");
    state.locations = Array.isArray(result.locations) ? result.locations : [];
    state.personnel = Array.isArray(result.personnel) ? result.personnel : [];
    if (result.unitDefinitions) state.unitDefinitions = normalizeUnitDefinitions(result.unitDefinitions);
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
    const result = await api(`/api/procurement/v1/stock/inventory?locationId=${encodeURIComponent(locationId)}`, { signal });
    if (String(locationId) !== String(state.selectedLocationId)) return result;
    state.balances = Array.isArray(result.balances) ? result.balances : [];
    state.summary = result.summary && typeof result.summary === "object" ? result.summary : {};
    if (result.unitDefinitions) state.unitDefinitions = normalizeUnitDefinitions(result.unitDefinitions);
    updateRevision(result);
    return result;
  }

  function normalizeUnitDefinitions(value) {
    const source = value && typeof value === "object" ? value : {};
    const clean = (items) => Array.from(new Set((Array.isArray(items) ? items : [])
      .map((item) => textValue(item).trim().toLocaleLowerCase("tr-TR")).filter(Boolean)));
    return { base: clean(source.base || source.baseUnits), bulk: clean(source.bulk || source.bulkUnits), updatedAt: source.updatedAt || null, updatedBy: String(source.updatedBy || "") };
  }

  function unitCatalogOptions(kind, selectedValue = "", includeNone = false) {
    const selected = textValue(selectedValue).toLocaleLowerCase("tr-TR");
    const catalog = Array.isArray(state.unitDefinitions[kind]) ? state.unitDefinitions[kind].slice() : [];
    if (selected && !catalog.includes(selected)) catalog.push(selected);
    const items = catalog.map((unit) => ({ value: unit, label: unit }));
    if (includeNone) items.unshift({ value: "", label: "Toplu birim yok" });
    return items;
  }

  async function loadTransfers(signal) {
    const result = await api("/api/procurement/v1/stock/transfers", { signal });
    state.transfers = Array.isArray(result.transfers) ? result.transfers : [];
    state.transferLocations = Array.isArray(result.locations) ? result.locations : [];
    updateRevision(result);
    return result;
  }

  async function loadMovements() {
    const query = new URLSearchParams({ limit: "40" });
    if (state.selectedLocationId && state.selectedLocationId !== "total") query.set("locationId", state.selectedLocationId);
    const type = $("#stockMovementTypeFilter")?.value || "all";
    const productId = $("#stockMovementProductFilter")?.value || "all";
    if (type !== "all") query.set("type", type);
    if (productId !== "all") query.set("productId", productId);
    const result = await api(`/api/procurement/v1/stock/movements?${query.toString()}`);
    state.movements = Array.isArray(result.movements) ? result.movements : [];
    updateRevision(result);
    return result;
  }

  async function loadCounts() {
    const query = new URLSearchParams();
    if (state.selectedLocationId && state.selectedLocationId !== "total") query.set("locationId", state.selectedLocationId);
    const result = await api(`/api/procurement/v1/stock/counts?${query.toString()}`);
    state.counts = Array.isArray(result.counts) ? result.counts : [];
    state.activeCount = state.counts.find((count) => count.status === "active") || null;
    updateRevision(result);
    return result;
  }

  async function loadPlanning(signal) {
    if (state.planning && !state.planningStale) return state.planning;
    if (state.planningLoadPromise) return state.planningLoadPromise;
    state.planningError = "";
    const promise = api("/api/procurement/v1/analytics/stock-plan?range=30d", { signal })
      .then((result) => {
        state.planning = result;
        state.planningStale = false;
        state.planningError = "";
        syncRevision(result, "inventory");
        return result;
      })
      .catch((error) => {
        if (!error || error.name !== "AbortError") {
          state.planningError = String(error && error.message || "Planlama verisi alınamadı.");
          state.planningStale = true;
        }
        throw error;
      })
      .finally(() => {
        if (state.planningLoadPromise === promise) state.planningLoadPromise = null;
      });
    state.planningLoadPromise = promise;
    return promise;
  }

  async function refreshPlanning(options = {}) {
    if (options.force) state.planningStale = true;
    try {
      await loadPlanning(options.signal);
      if (options.signal && options.signal.aborted) return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
    renderCommandKpis();
    renderPlanning();
    renderCriticalAlerts();
    renderAccordionState();
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
      if (options.force) state.planningStale = true;
      await loadLocations({ force: options.reloadLocations === true || options.force === true });
      const requestedLocationId = String(state.selectedLocationId || "total");
      // İlk görünüm yalnız envanter ve bekleyen transfer projection'ını bekler.
      // Ağır hareket/sayım geçmişi aşağıdaki ikincil alanlar görünür olduğunda
      // yüklenir; ham/boş ekran süresi ve duplicate GET zinciri azalır.
      await Promise.all([loadInventory(requestedLocationId, controller.signal), loadTransfers(controller.signal)]);
      if (controller.signal.aborted || sequence !== state.loadSequence || requestedLocationId !== String(state.selectedLocationId || "total")) return;
      state.loaded = true;
      state.stale = false;
      renderAll();
      setMessage("");
      if (state.activeAccordion === "planning") void refreshPlanning({ signal: controller.signal });
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
    const warehouses = $("#stockWarehouseCards");
    const content = `<div class="stock-location-empty"><strong>Depo verileri yüklenemedi</strong><span>${esc(error.message)}</span><button class="ui-button ui-button--secondary ui-button--sm" type="button" data-stock-retry>Yeniden Dene</button></div>`;
    if (inventory && !state.loaded) inventory.innerHTML = content;
    if (warehouses && !state.loaded) warehouses.innerHTML = content;
  }

  function renderLocations() {
    const host = $("#stockLocationSelector");
    if (!host) return;
    const options = state.locations.filter((item) => item.active !== false || String(item.id) === String(state.selectedLocationId));
    host.innerHTML = options.map((location) => `
      <button type="button" role="tab" aria-selected="${String(location.id) === String(state.selectedLocationId)}"
        class="stock-location-tab${String(location.id) === String(state.selectedLocationId) ? " is-active" : ""}"
        data-stock-location-select="${esc(location.id)}">
        <span>${esc(location.name)}</span><small>${esc(location.code || (location.type === "central" ? "GENEL" : "KAFE"))}</small>
      </button>`).join("");
    const title = $("#stockActiveLocationTitle");
    const freshness = $("#stockLocationFreshness");
    if (title) title.textContent = state.viewMode === "overview" ? "Stok Genel Bakışı" : locationName(state.selectedLocationId);
    if (freshness) freshness.textContent = `Güncel · Son güncelleme ${state.updatedAt ? formatDate(state.updatedAt) : "bekleniyor"}`;
  }

  function renderSummary() {
    const host = $("#stockLocationSummary");
    if (!host) return;
    const activeLocations = state.locations.filter((location) => location.active !== false);
    const overview = state.viewMode === "overview";
    const derivedCritical = overview
      ? activeLocations.reduce((sum, location) => sum + Number(location.inventorySummary?.criticalProducts || 0), 0)
      : state.balances.filter((balance) => balanceStatus(balance) === "critical").length;
    const sufficient = overview
      ? activeLocations.reduce((sum, location) => sum + Number(location.inventorySummary?.sufficientProducts || 0), 0)
      : state.balances.filter((balance) => balanceStatus(balance) === "sufficient").length;
    const openSuggestions = overview
      ? activeLocations.reduce((sum, location) => sum + Number(location.inventorySummary?.openSuggestions || 0), 0)
      : state.balances.filter((balance) => {
        const type = String(balance && balance.recommendation && balance.recommendation.type || "");
        return type === "transfer" || type === "purchase";
      }).length;
    const cards = [
      ["Toplam Ürün", overview ? Math.max(0, ...activeLocations.map((location) => Number(location.inventorySummary?.totalProducts || 0))) : state.summary.productCount ?? state.summary.totalProducts ?? state.balances.length],
      ["Kritik Ürün", state.summary.criticalCount ?? derivedCritical],
      ["Yeterli Ürün", sufficient],
      ["Bekleyen Transfer", state.transfers.length],
      ["Açık Öneri", state.summary.openSuggestionCount ?? openSuggestions]
    ];
    host.innerHTML = cards.map(([label, value]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join("");
  }

  function renderCommandKpis() {
    const host = $("#stockKpiGrid");
    if (!host) return;
    const planning = state.planning || {};
    const planningUnavailable = Boolean(state.planningError);
    const kpis = planning.kpis || {};
    const activeLocations = state.locations.filter((item) => item.active !== false);
    const pendingTransferCount = state.transfers.filter((item) => ["onay_bekliyor", "pending", "submitted"].includes(String(item.status))).length;
    const derivedStockItems = Math.max(0, ...activeLocations.map((item) => Number(item.inventorySummary?.totalProducts || 0)), Number(state.summary.productCount || state.balances.length || 0));
    const derivedCritical = activeLocations.reduce((sum, item) => sum + Number(item.inventorySummary?.criticalProducts || 0), 0);
    const derivedSuggestions = activeLocations.reduce((sum, item) => sum + Number(item.inventorySummary?.openSuggestions || 0), 0);
    const cards = [
      planning.financialVisible
        ? ["Toplam Stok Değeri", planningUnavailable ? "—" : formatMoney(kpis.totalStockValueKurus), planningUnavailable ? "Veri yok" : "Bu depolardaki son alış değeri", "value"]
        : ["Aktif Depolar", formatNumber(kpis.activeLocationCount ?? activeLocations.length), "Yetkili olduğunuz operasyon alanları", "location"],
      ["Stok Kalemleri", formatNumber(kpis.stockItemCount ?? derivedStockItems), "Canonical ürün kataloğu", "product"],
      ["Kritik Stoklar", formatNumber(kpis.criticalStockCount ?? derivedCritical), "Depo eşiklerine göre", "critical"],
      ["Bekleyen Transfer", formatNumber(pendingTransferCount), "Depolar arası onay akışı", "transfer"],
      ["Açık Öneri", formatNumber(kpis.openSuggestionCount ?? derivedSuggestions), "Transfer ve sipariş önerileri", "purchase"]
    ];
    const symbols = {
      value: '<path d="M4 8h16v10H4zM7 5h10v3M8 13h8M12 10v6"/>',
      location: '<path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
      shipment: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
      product: '<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>',
      purchase: '<path d="M5 20V9M12 20V4M19 20v-7M3 20h18"/>',
      transfer: '<path d="M4 8h14m0 0-3-3m3 3-3 3M20 16H6m0 0 3 3m-3-3 3-3"/>',
      critical: '<path d="M12 3 2.8 20h18.4zM12 9v5M12 17h.01"/>'
    };
    host.innerHTML = cards.map(([label, value, note, kind]) => `<article class="stock-command-kpi is-${kind}"><span class="stock-command-kpi__icon"><svg viewBox="0 0 24 24" aria-hidden="true">${symbols[kind]}</svg></span><span><small>${esc(label)}</small><strong>${esc(value)}</strong><em>${esc(note)}</em></span></article>`).join("");
  }

  function planningRows(items, value) {
    if (!items.length) return '<p class="stock-planning-empty">Bu başlıkta güncel kayıt bulunmuyor.</p>';
    return `<div class="stock-planning-list">${items.map((item) => {
      const content = `<span><strong>${esc(item.product?.name || "Stok ürünü")}</strong><small>${esc(item.product?.category || "Kategori yok")}</small></span><em>${esc(value(item))}</em><b aria-hidden="true">→</b>`;
      return can(CAPABILITIES.read)
        ? `<button type="button" data-stock-analysis-product="${esc(item.product?.id || "")}">${content}</button>`
        : `<div class="stock-planning-list__row">${content}</div>`;
    }).join("")}</div>`;
  }

  function planningInfoRows(items, content) {
    if (!items.length) return '<p class="stock-planning-empty">Bu başlıkta güncel kayıt bulunmuyor.</p>';
    return `<div class="stock-planning-list">${items.map((item) => `<div class="stock-planning-list__row">${content(item)}</div>`).join("")}</div>`;
  }

  function renderPlanning() {
    const host = $("#stockPlanningWorkspace");
    const planning = state.planning || {};
    if (!host) return;
    const badge = $("#stockPlanningBadge");
    if (state.planningError) {
      host.innerHTML = `<div class="stock-planning-error" role="status"><strong>Planlama verisi alınamadı.</strong><button class="ui-button ui-button--secondary ui-button--sm" type="button" data-stock-planning-retry>Yeniden dene</button></div>`;
      if (badge) badge.textContent = "Veri yok";
      return;
    }
    if (!state.planning && state.planningStale) {
      host.innerHTML = '<div class="stock-location-loading">Planlama verileri hazırlanıyor…</div>';
      if (badge) badge.textContent = "—";
      return;
    }
    const baseValue = (item) => item.remainingDays === null ? "Yeterli veri yok" : `${formatNumber(item.remainingDays)} gün`;
    host.innerHTML = `<div class="stock-planning-grid">
      <section><header><strong>Kritik Stoklar</strong><span>${(planning.critical || []).length}</span></header>${planningRows(planning.critical || [], (item) => `${formatNumber(item.currentStock)} ${item.baseUnit}`)}</section>
      <section><header><strong>Stoku Bitecek Ürünler</strong><span>30 gün</span></header>${planningRows(planning.depleting || [], baseValue)}</section>
      <section><header><strong>Yaklaşan Sevkiyatlar</strong><span>${(planning.upcomingShipments || []).length}</span></header>${planningInfoRows(planning.upcomingShipments || [], (item) => `<span><strong>${esc(item.personName || "Personel sevkiyatı")}</strong><small>${esc(formatDate(item.createdAt))}</small></span><em>${formatNumber(item.itemCount)} ürün</em><b aria-hidden="true">·</b>`)}</section>
      <section><header><strong>Sipariş Önerileri</strong><span>Salt okunur</span></header>${planningRows(planning.orderSuggestions || [], (item) => item.suggestedBulkQuantity !== null && item.bulkUnit ? `${formatNumber(item.suggestedBulkQuantity)} ${item.bulkUnit}` : `${formatNumber(item.suggestedBaseQuantity)} ${item.baseUnit}`)}</section>
      <section><header><strong>Sayım Farkları</strong><span>${formatNumber(planning.countDifferences || 0)}</span></header>${planningInfoRows(planning.countDifferenceItems || [], (item) => `<span><strong>${esc(item.product?.name || "Stok ürünü")}</strong><small>${esc(item.locationName || "Depo")}</small></span><em>${item.difference > 0 ? "+" : ""}${formatNumber(item.difference)} ${esc(item.product?.baseUnit || "adet")}</em><b aria-hidden="true">·</b>`)}</section>
      <section><header><strong>Transfer İhtiyaçları</strong><span>${(planning.transferNeeds || []).length}</span></header>${planningRows(planning.transferNeeds || [], (item) => `${formatNumber(item.recommendation?.baseQuantity || 0)} ${item.baseUnit}`)}</section>
      <section><header><strong>En Fazla Tüketilenler</strong><span>30 gün</span></header>${planningRows(planning.mostConsumed || [], (item) => `${formatNumber(item.consumption.totalConsumption)} ${item.baseUnit}`)}</section>
      <section><header><strong>En Fazla Fire Verilenler</strong><span>30 gün</span></header>${planningRows(planning.mostWasted || [], (item) => `${formatNumber(item.consumption.totalWaste)} ${item.baseUnit}`)}</section>
    </div>`;
    if (badge) badge.textContent = `${formatNumber(planning.kpis?.criticalStockCount || 0)} Kritik`;
  }

  function renderCriticalAlerts() {
    const host = $("#stockCriticalAlerts");
    if (!host) return;
    const planning = state.planning || {};
    const planningUnavailable = Boolean(state.planningError);
    const primaryPending = faturaState.shipments.filter((item) => ["onay_bekliyor", "pending"].includes(String(item.status))).length;
    const primaryCritical = Number(state.summary.criticalCount ?? state.balances.filter((balance) => balanceStatus(balance) === "critical").length);
    const entries = [
      [planningUnavailable ? primaryPending : Number(planning.kpis?.pendingShipmentCount ?? primaryPending), "sevkiyat onay bekliyor", "shipments", "warning"],
      [planningUnavailable ? primaryCritical : Number(planning.kpis?.criticalStockCount ?? primaryCritical), "ürün kritik stok seviyesinde", "planning", "danger"],
      [planningUnavailable ? 0 : Number(planning.countDifferences || 0), "sayım farkı tamamlanmayı bekliyor", "planning", "warning"],
      [planningUnavailable ? 0 : Number((planning.transferNeeds || []).length), "ürün için transfer ihtiyacı var", "planning", "info"]
    ].filter(([count]) => count > 0);
    host.innerHTML = entries.length ? entries.map(([count, label, target, kind]) => `<button type="button" class="is-${kind}" data-stock-alert-target="${target}"><span aria-hidden="true">!</span><strong>${formatNumber(count)} ${esc(label)}</strong><b aria-hidden="true">›</b></button>`).join("") : '<div class="stock-alert-empty"><span aria-hidden="true">✓</span><strong>Kritik bekleyen işlem yok</strong></div>';
  }

  function renderAccordionState() {
    const sections = $$("[data-stock-main-accordion]");
    sections.forEach((section) => { section.open = section.dataset.stockMainAccordion === state.activeAccordion; });
    const productCount = $("#stockManagementCount");
    const planningUnavailable = Boolean(state.planningError);
    if (productCount) productCount.textContent = `${formatNumber(planningUnavailable ? state.summary.productCount ?? state.balances.length : state.planning?.kpis?.stockItemCount ?? state.summary.productCount ?? state.balances.length)} Ürün`;
    const pending = planningUnavailable
      ? faturaState.shipments.filter((item) => ["onay_bekliyor", "pending"].includes(String(item.status))).length
      : Number(state.planning?.kpis?.pendingShipmentCount || 0);
    const shipmentBadge = $("#stockShipmentPendingBadge");
    if (shipmentBadge) shipmentBadge.textContent = `${formatNumber(pending)} Bekleyen`;
  }

  function renderWarehouseCards() {
    const host = $("#stockWarehouseCards");
    if (!host) return;
    const orderedLocations = state.locations.slice().sort((left, right) => Number(left.active === false) - Number(right.active === false));
    const cards = orderedLocations;
    host.innerHTML = cards.length ? cards.map((location, index) => {
      const summary = location.inventorySummary || {};
      const type = location.type === "cafe" ? "KAFE" : location.type === "central" ? "GENEL" : "DİĞER";
      const assigned = Array.isArray(location.assignedPersonnelIds) ? location.assignedPersonnelIds.length : Number(summary.assignedPersonnelCount || 0);
      return `<article class="stock-warehouse-card" data-location-status="${location.active === false ? "passive" : "active"}">
        <div class="stock-warehouse-card__index">${String(index + 1).padStart(2, "0")}</div>
        <div class="stock-warehouse-card__identity"><span>${esc(type)}</span><h5>${esc(location.name)}</h5><div class="stock-warehouse-card__meta"><b>${esc(location.code || "Kod yok")}</b><i class="is-${location.active === false ? "passive" : "active"}">${location.active === false ? "Pasif" : "Aktif"}</i></div><p>${esc(location.description || (location.active === false ? "Geçmiş kayıtlar salt okunur görüntülenebilir." : "Depo bakiyeleri ve hareketleri"))}</p></div>
        ${can(CAPABILITIES.inventoryLocationManage) ? `<button class="stock-warehouse-card__edit" type="button" data-stock-warehouse-edit="${esc(location.id)}" aria-label="${esc(location.name)} deposunu düzenle">Düzenle</button>` : ""}
        <dl><div><dt>Ürün</dt><dd>${esc(summary.totalProducts || 0)}</dd></div><div><dt>Kritik</dt><dd>${esc(summary.criticalProducts || 0)}</dd></div><div><dt>Personel</dt><dd>${esc(assigned)}</dd></div><div><dt>Son hareket</dt><dd>${esc(summary.lastMovementAt ? formatDate(summary.lastMovementAt) : "Henüz yok")}</dd></div></dl>
        <button class="ui-button ui-button--primary ui-button--block" type="button" data-stock-warehouse-open="${esc(location.id)}">Depoyu Aç <span aria-hidden="true">→</span></button>
      </article>`;
    }).join("") : `<div class="stock-location-empty"><strong>Aktif depo bulunmuyor</strong><span>Depo ekleyerek stok yönetimine başlayın.</span></div>`;
  }

  function renderViewMode() {
    const overview = $("#stockOverviewWorkspace");
    const inventory = $("#stockLocationInventoryView");
    if (overview) overview.hidden = state.viewMode !== "overview";
    if (inventory) inventory.hidden = state.viewMode !== "inventory";
    const quickButton = $("#stockQuickActionsButton");
    if (quickButton) quickButton.hidden = state.viewMode !== "overview";
    const backButton = $("#stockWarehouseBackButton");
    if (backButton) backButton.hidden = state.viewMode !== "inventory";
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
    const criticalCount = state.balances.filter((balance) => ["critical", "empty"].includes(balanceStatus(balance))).length;
    if (meta) meta.textContent = `${locationName(state.selectedLocationId)} · ${state.balances.length} ürün · ${criticalCount} kritik`;
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
        <div class="stock-location-product__quantity"><strong>${esc(quantityDisplay(balance))}</strong></div>
        <p class="stock-location-product__conversion">${factor > 0 ? `1 ${esc(bulkUnit)} = ${esc(formatNumber(factor))} ${esc(unitOf(balance))}` : `Temel birim: ${esc(unitOf(balance))}`}</p>
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
    const selectedLocation = state.locations.find((location) => String(location.id) === String(state.selectedLocationId));
    const totalReadOnly = state.selectedLocationId === "total" || selectedLocation?.active === false;
    const canMoveStock = can(CAPABILITIES.inventoryMovementCreate);
    const canTransfer = can(CAPABILITIES.inventoryTransferCreate);
    const canManageInventory = can(CAPABILITIES.inventoryManage);
    const canManageCatalog = can(CAPABILITIES.inventoryCatalogManage);
    const cafeQuantity = balance.cafeQuantity ?? (selectedLocation && selectedLocation.type === "cafe" ? balance.quantity : 0);
    $("#stockProductDrawerTitle").textContent = productName(balance);
    $("#stockProductDrawerSubtitle").textContent = `${product.productCode || "Kod yok"} · ${product.category || "Kategori yok"}`;
    $("#stockProductDrawerMessage").textContent = state.selectedLocationId === "total"
      ? "Tüm Depolar görünümü salt okunurdur. İşlem için aktif bir depo seçin."
      : selectedLocation?.active === false ? "Pasif depo geçmişi salt okunurdur; yeni stok, transfer ve sayım işlemi yapılamaz." : "";
    const body = $("#stockProductDrawerBody");
    const recentMovements = state.movements.filter((movement) => String(movement.productId) === String(product.id)).slice(0, 4);
    const currentBaseUnit = unitOf(balance);
    const currentBulkUnit = textValue(product.bulkUnit || product.caseUnit, "").toLocaleLowerCase("tr-TR");
    const currentFactor = Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
    body.innerHTML = `<section class="stock-drawer-selected"><span>${esc(locationName(state.selectedLocationId))}</span><strong>${esc(quantityDisplay(balance))}</strong><small>Seçili depo bakiyesi</small></section><section class="stock-drawer-overview">
      <article><span>Kafe Deposu</span><strong>${esc(quantityDisplay(balance, cafeQuantity))}</strong><small>Operasyon bakiyesi</small></article>
      <article><span>Genel Depo</span><strong>${esc(quantityDisplay(balance, balance.generalQuantity ?? 0))}</strong><small>Merkez bakiyesi</small></article>
      <article><span>Tüm Depolar</span><strong>${esc(quantityDisplay(balance, balance.totalQuantity ?? balance.quantity ?? 0))}</strong><small>Toplam bakiye</small></article>
    </section>
    <dl class="stock-drawer-details"><div><dt>Kategori</dt><dd>${esc(product.category || "Kategori yok")}</dd></div><div><dt>Ürün kodu</dt><dd>${esc(product.productCode || product.code || "Kod yok")}</dd></div><div><dt>Durum</dt><dd>${esc(statusLabel(balanceStatus(balance)))}</dd></div><div><dt>Tedarikçi</dt><dd>${esc(product.supplier || "Belirtilmedi")}</dd></div><div><dt>Kritik eşik</dt><dd>${esc(formatNumber(balance.criticalThreshold))} ${esc(unitOf(balance))}</dd></div><div><dt>Sipariş eşiği</dt><dd>${esc(formatNumber(balance.orderThreshold))} ${esc(unitOf(balance))}</dd></div><div><dt>Hedef stok</dt><dd>${esc(formatNumber(balance.targetLevel))} ${esc(unitOf(balance))}</dd></div></dl>
    <section class="stock-drawer-unit-config" aria-label="Birim yapısı">
      <div><span>Temel birim</span><strong>${esc(currentBaseUnit)}</strong></div>
      <div><span>Toplu birim</span><strong>${esc(currentBulkUnit || "Yok")}</strong></div>
      <div><span>Dönüşüm</span><strong>${currentBulkUnit && currentFactor > 0 ? `1 ${esc(currentBulkUnit)} = ${esc(formatNumber(currentFactor))} ${esc(currentBaseUnit)}` : "Toplu birim seçilmedi"}</strong></div>
    </section>
    <section class="stock-drawer-recent"><header><strong>Son hareketler</strong><span>${recentMovements.length} kayıt</span></header>${recentMovements.length ? recentMovements.map((movement) => `<div><span>${esc(statusLabel(movement.type))}</span><strong>${esc(formatNumber(movement.inputQuantity ?? movement.sourceQuantity ?? movement.quantity))} ${esc(movement.inputUnit || movement.sourceUnit || movement.baseUnit || unitOf(balance))}</strong><small>${esc(formatDate(movement.createdAt))}</small></div>`).join("") : `<p>Bu ürün için hareket kaydı henüz yüklenmedi.</p>`}</section>
    <div class="stock-drawer-actions" aria-label="${esc(productName(balance))} stok işlemleri">
      ${totalReadOnly || !canMoveStock ? "" : `<button class="ui-button ui-button--primary" type="button" data-stock-drawer-action="manual_in">Stok Ekle</button><button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="waste">Sarf İşle</button><button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="manual_out">Eksilt</button>`}
      ${totalReadOnly || !canTransfer ? "" : `<button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="transfer">Transfer Oluştur</button>`}
      ${totalReadOnly || !(canManageInventory || canManageCatalog) ? "" : `<button class="ui-button ui-button--secondary" type="button" data-stock-drawer-action="settings">Ürün ve Depo Ayarları</button>`}
      <button class="ui-button ui-button--ghost" type="button" data-stock-drawer-action="history">Hareket Geçmişi</button>
      ${can(CAPABILITIES.read) ? '<button class="ui-button ui-button--ghost" type="button" data-stock-drawer-action="analysis">Ürün Analizine Git</button>' : ""}
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
    if (bulk) choices.push({ quantity: 1, unit: bulk.value }, { quantity: 5, unit: bulk.value });
    host.innerHTML = choices.map((choice) => `<button type="button" data-stock-movement-quick="${choice.quantity}" data-stock-movement-unit="${esc(choice.unit)}">${choice.quantity} ${esc(choice.unit)}</button>`).join("");
  }

  function openMovementDock(productIdValue, type, options = {}) {
    if (!can(CAPABILITIES.inventoryMovementCreate)) return setMessage("Bu stok hareketi için yetkiniz yok.", "error");
    if (state.selectedLocationId === "total") {
      setMessage("Stok hareketi için gerçek bir depo seçin.", "error");
      return;
    }
    if (state.locations.find((location) => String(location.id) === String(state.selectedLocationId))?.active === false) {
      setMessage("Pasif depoda yeni stok hareketi oluşturulamaz.", "error");
      return;
    }
    const balance = state.balances.find((item) => productId(item) === String(productIdValue));
    const dialog = $("#stockMovementDialog");
    if (!balance || !dialog) return;
    const productSelect = $("#stockLocationMovementProduct");
    productSelect.value = productId(balance);
    productSelect.hidden = options.allowProductChange !== true;
    const movementType = ["manual_in", "manual_out", "waste"].includes(type) ? type : "waste";
    $("#stockLocationMovementType").value = movementType;
    $("#stockLocationMovementQuantity").value = "1";
    $("#stockLocationMovementQuantity").step = productOf(balance).allowDecimal ? "0.001" : "1";
    $("#stockLocationMovementProductName").textContent = productName(balance);
    $("#stockLocationMovementModeLabel").textContent = movementType === "manual_in" ? "Stok Ekle" : movementType === "manual_out" ? "Eksilt" : "Sarf İşle";
    if ($("#stockLocationMovementReason")) $("#stockLocationMovementReason").value = movementType === "waste" ? "Sarf" : movementType === "manual_out" ? "Eksiltme" : "Kullanım";
    $("#stockMovementDialogMessage").textContent = "";
    updateProductUnits();
    const baseUnit = unitOf(balance);
    const product = productOf(balance);
    const bulkUnit = textValue(product.bulkUnit || product.caseUnit, "").toLocaleLowerCase("tr-TR");
    const factor = Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
    const preferredUnit = movementType === "manual_out" && bulkUnit && factor > 0 ? bulkUnit : baseUnit;
    if ($("#stockLocationMovementUnit") && Array.from($("#stockLocationMovementUnit").options).some((option) => option.value === preferredUnit)) {
      $("#stockLocationMovementUnit").value = preferredUnit;
    }
    updateMovementPreview();
    renderMovementQuickAmounts(balance);
    if (!dialog.open) dialog.showModal();
    $("#stockLocationMovementQuantity")?.focus();
  }

  async function openQuickAction(action) {
    if (action === "shipment") {
      document.dispatchEvent(new CustomEvent("tahmisci:fatura:navigate", { detail: { view: "shipments", action: "new-shipment" } }));
      return;
    }
    if (state.selectedLocationId === "total" || state.viewMode === "overview") {
      const preferred = state.locations.find((location) => location.active !== false && (location.type === "cafe" || location.isDefault))
        || state.locations.find((location) => location.active !== false);
      if (!preferred) return setMessage("İşlem yapılabilecek aktif depo bulunamadı.", "error");
      await enterWarehouse(preferred.id);
    }
    const balance = state.balances[0];
    if (!balance) return setMessage("İşlem yapılabilecek stok ürünü bulunamadı.", "error");
    if (action === "transfer") openTransferDialog(productId(balance));
    else openMovementDock(productId(balance), action, { allowProductChange: true });
  }

  function closeMovementDock() {
    const dialog = $("#stockMovementDialog");
    if (dialog && dialog.open) dialog.close();
  }

  function openTransferDialog(productIdValue = state.selectedProductId) {
    if (!can(CAPABILITIES.inventoryTransferCreate)) return setMessage("Transfer oluşturma yetkiniz yok.", "error");
    if (state.selectedLocationId === "total") {
      setMessage("Transfer için gerçek bir depo seçin.", "error");
      return;
    }
    if (state.locations.find((location) => String(location.id) === String(state.selectedLocationId))?.active === false) {
      setMessage("Pasif depo transfer kaynağı veya hedefi olamaz.", "error");
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

  function updateThresholdConversionPreview() {
    const baseUnit = textValue($("#stockThresholdBaseUnit")?.value, "adet");
    const bulkUnit = textValue($("#stockThresholdBulkUnit")?.value, "");
    const factor = Number($("#stockThresholdFactor")?.value || 0);
    const preview = $("#stockThresholdConversionPreview");
    const factorInput = $("#stockThresholdFactor");
    if (factorInput) factorInput.disabled = state.selectedLocationId === "total" || !can(CAPABILITIES.inventoryCatalogManage) || !bulkUnit;
    const defaultSelect = $("#stockThresholdDefaultUnit");
    if (defaultSelect) {
      const previous = textValue(defaultSelect.value, state.thresholdInitial && state.thresholdInitial.defaultMovementUnit || baseUnit);
      const options = [{ value: baseUnit, label: baseUnit }];
      if (bulkUnit && factor > 0) options.push({ value: bulkUnit, label: bulkUnit });
      setSelectOptions(defaultSelect, options, options.some((item) => unitKey(item.value) === unitKey(previous)) ? previous : baseUnit);
    }
    if (!preview) return;
    preview.textContent = bulkUnit && factor > 0
      ? `1 ${bulkUnit} = ${formatNumber(factor)} ${baseUnit}`
      : "Toplu birim seçilmedi.";
  }

  function openThresholdDialog(productIdValue = state.selectedProductId, draft = null) {
    const canManageInventory = can(CAPABILITIES.inventoryManage);
    const canManageCatalog = can(CAPABILITIES.inventoryCatalogManage);
    if (!canManageInventory && !canManageCatalog) return setMessage("Ürün veya depo ayarlarını yönetme yetkiniz yok.", "error");
    const balance = selectedProductBalance(productIdValue);
    if (!balance || state.selectedLocationId === "total") {
      setMessage("Eşik ayarları için gerçek bir depo seçin.", "error");
      return;
    }
    if (state.locations.find((location) => String(location.id) === String(state.selectedLocationId))?.active === false) {
      setMessage("Pasif depoda yeni eşik veya birim işlemi yapılamaz.", "error");
      return;
    }
    const product = productOf(balance);
    state.selectedProductId = productId(balance);
    $("#stockThresholdDialogTitle").textContent = productName(balance);
    $("#stockThresholdDialogMeta").textContent = `${locationName(state.selectedLocationId)} · ${product.productCode || "Kod yok"}`;
    const currentBaseUnit = textValue(product.baseUnit || product.unit, "adet");
    const currentBulkUnit = textValue(product.bulkUnit || product.caseUnit, "");
    const currentFactor = Number(product.unitsPerBulkUnit ?? product.unitsPerCase ?? 0);
    const currentDefaultMovementUnit = textValue(product.defaultMovementUnit, currentBaseUnit);
    state.thresholdInitial = {
      productId: productId(balance),
      locationId: String(state.selectedLocationId),
      baseUnit: currentBaseUnit,
      bulkUnit: currentBulkUnit,
      factor: Number.isFinite(currentFactor) ? currentFactor : 0,
      allowDecimal: Boolean(product.allowDecimal),
      defaultMovementUnit: currentDefaultMovementUnit
    };
    $("#stockThresholdCritical").value = String(draft && draft.criticalThreshold !== undefined ? draft.criticalThreshold : balance.criticalThreshold ?? 0);
    $("#stockThresholdOrder").value = String(draft && draft.orderThreshold !== undefined ? draft.orderThreshold : balance.orderThreshold ?? 0);
    $("#stockThresholdTarget").value = String(draft && draft.targetLevel !== undefined ? draft.targetLevel : balance.targetLevel ?? 0);
    const baseUnit = textValue(draft && draft.baseUnit, currentBaseUnit);
    const bulkUnit = textValue(draft && draft.bulkUnit, currentBulkUnit);
    const factor = draft && draft.factor !== undefined ? Number(draft.factor || 0) : currentFactor;
    setSelectOptions($("#stockThresholdBaseUnit"), unitCatalogOptions("base", baseUnit), baseUnit);
    setSelectOptions($("#stockThresholdBulkUnit"), unitCatalogOptions("bulk", bulkUnit, true), bulkUnit);
    if ($("#stockThresholdBaseUnit")) $("#stockThresholdBaseUnit").disabled = !can(CAPABILITIES.inventoryCatalogManage);
    if ($("#stockThresholdBulkUnit")) $("#stockThresholdBulkUnit").disabled = !can(CAPABILITIES.inventoryCatalogManage);
    $("#stockThresholdFactor").value = String(factor || "");
    if ($("#stockThresholdAllowDecimal")) {
      $("#stockThresholdAllowDecimal").checked = Boolean(product.allowDecimal);
      $("#stockThresholdAllowDecimal").disabled = !can(CAPABILITIES.inventoryCatalogManage);
    }
    updateThresholdConversionPreview();
    if ($("#stockThresholdDefaultUnit")) {
      const allowed = [baseUnit, ...(bulkUnit && factor > 0 ? [bulkUnit] : [])];
      $("#stockThresholdDefaultUnit").value = allowed.includes(currentDefaultMovementUnit) ? currentDefaultMovementUnit : baseUnit;
      $("#stockThresholdDefaultUnit").disabled = !can(CAPABILITIES.inventoryCatalogManage);
    }
    if ($("#stockThresholdSchemaStatus")) {
      const version = Math.max(0, Number(product.unitSchemaVersion || 0));
      const source = product.unitSchemaSource === "manual" ? "Yönetici" : product.unitSchemaSource === "excel" ? "Excel" : "Eski kayıt";
      $("#stockThresholdSchemaStatus").textContent = `Şema: v${version || 1} · Kaynak: ${source}${product.unitSchemaLocked ? " · Manuel korumalı" : ""}`;
    }
    if ($("#stockUnitSchemaSubmit")) $("#stockUnitSchemaSubmit").hidden = !can(CAPABILITIES.inventoryCatalogManage);
    ["#stockThresholdCritical", "#stockThresholdOrder", "#stockThresholdTarget"].forEach((selector) => {
      const input = $(selector);
      if (input) input.disabled = !canManageInventory;
    });
    if ($("#stockThresholdSubmit")) $("#stockThresholdSubmit").hidden = !canManageInventory;
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
      return `<article class="stock-transfer-request" data-stock-transfer-card="${esc(transfer.id)}">
        <div><strong>${esc(product.name || product.productName || transfer.productName || "Stok ürünü")}</strong><span>${esc(transfer.requestedByName || transfer.personnelName || "Personel")} · ${esc(formatDate(transfer.createdAt))}</span></div>
        <p>${esc(locationName(transfer.fromLocationId))} → ${esc(locationName(transfer.toLocationId))}</p>
        <b>${esc(formatNumber(transfer.quantity))} ${esc(transfer.baseUnit || transfer.unit || "adet")}</b>
        <span class="stock-location-status is-${esc(transfer.status)}">${esc(statusLabel(transfer.status))}</span>
        ${pending && can(CAPABILITIES.inventoryTransferApprove) ? `<label><span>Yönetici notu</span><input type="text" maxlength="250" data-transfer-note="${esc(transfer.id)}" placeholder="Ret için neden zorunlu"></label>
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
        ${reversible && can(CAPABILITIES.inventoryMovementReverse) ? `<button class="ui-button ui-button--ghost ui-button--sm" type="button" data-reverse-movement="${esc(movement.id)}">Ters Kayıt</button>` : !reversible ? `<span class="stock-location-status">Ters kayıtlı</span>` : ""}
      </article>`;
    }).join("") : `<div class="stock-location-empty"><strong>Hareket kaydı yok</strong><span>Seçili filtrelere ait işlem bulunamadı.</span></div>`;
  }

  function renderLocationManagement() {
    const host = $("#stockLocationManagementList");
    if (!host) return;
    if (!can(CAPABILITIES.inventoryLocationManage)) { host.innerHTML = ""; return; }
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
        <div class="stock-location-management__actions">${assignmentControl}<button class="ui-button ui-button--secondary ui-button--sm" type="button" data-location-edit="${esc(location.id)}">Düzenle</button><button class="ui-button ui-button--ghost ui-button--sm" type="button" data-location-toggle="${esc(location.id)}" data-next-active="${location.active === false}">${location.active === false ? "Aktifleştir" : "Pasifleştir"}</button></div>
      </article>`;
    }).join("");
  }

  function setUnitSettingsMessage(message, isError = false) {
    const node = $("#stockUnitSettingsMessage");
    if (!node) return;
    node.textContent = String(message || "");
    node.dataset.kind = isError ? "error" : "success";
  }

  function renderUnitSettings() {
    if (!can(CAPABILITIES.inventoryCatalogManage)) return;
    const renderList = (kind, hostSelector) => {
      const host = $(hostSelector);
      if (!host) return;
      const units = Array.isArray(state.unitDefinitions[kind]) ? state.unitDefinitions[kind] : [];
      host.innerHTML = units.length ? units.map((unit) => `<div class="stock-unit-row">
        <input type="text" maxlength="30" value="${esc(unit)}" data-stock-unit-name="${esc(kind)}" data-stock-unit-original="${esc(unit)}" aria-label="${esc(unit)} birim adını düzenle">
        <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-stock-unit-rename="${esc(kind)}" data-stock-unit-original="${esc(unit)}">Kaydet</button>
        <button class="ui-button ui-button--danger ui-button--sm" type="button" data-stock-unit-remove="${esc(kind)}" data-stock-unit-original="${esc(unit)}" aria-label="${esc(unit)} birimini sil">Sil</button>
      </div>`).join("") : `<p>Henüz birim tanımlanmadı.</p>`;
    };
    renderList("base", "#stockBaseUnitList");
    renderList("bulk", "#stockBulkUnitList");
  }

  async function mutateUnitCatalog(action, kind, payload, button) {
    if (!can(CAPABILITIES.inventoryCatalogManage)) throw new Error("Birim kataloğunu yönetme yetkiniz yok.");
    return runOperation(`unit-catalog:${action}:${kind}`, button, async () => {
      setUnitSettingsMessage("");
      try {
        const result = await api("/api/procurement/v1/stock/unit-definitions", mutation("POST", { action, kind, ...payload }, `fatura-stock-unit-${action}`, "catalog"));
        state.unitDefinitions = normalizeUnitDefinitions(result.unitDefinitions);
        updateRevision(result, "catalog");
        renderUnitSettings();
        document.dispatchEvent(new CustomEvent("tahmisci:stock-unit-definitions-updated", { detail: { unitDefinitions: state.unitDefinitions, revision: state.catalogRevision, action, kind, payload } }));
        if (action === "rename") {
          state.stale = true;
          await loadAll({ force: true, reloadLocations: true });
        }
        setUnitSettingsMessage(action === "add" ? "Birimler eklendi." : action === "rename" ? "Birim adı güncellendi." : "Birim silindi.");
        return result;
      } catch (error) {
        setUnitSettingsMessage(error.message, true);
        throw error;
      }
    });
  }

  function openUnitSettingsDialog() {
    if (!can(CAPABILITIES.inventoryCatalogManage)) return setMessage("Birim kataloğunu yönetme yetkiniz yok.", "error");
    renderUnitSettings();
    setUnitSettingsMessage("");
    const dialog = $("#stockUnitSettingsDialog");
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector("[data-stock-unit-input]")?.focus();
  }

  function setCatalogMessage(message, isError = false) {
    const node = $("#stockCatalogMessage");
    if (!node) return;
    node.textContent = String(message || "");
    node.dataset.kind = isError ? "error" : "success";
  }

  function selectedCatalogCategory() {
    return state.catalogStock && Array.isArray(state.catalogStock.categories)
      ? state.catalogStock.categories.find((item) => String(item.id) === String(state.catalogCategoryId)) || null
      : null;
  }

  function selectedCatalogProduct() {
    return state.catalogStock && Array.isArray(state.catalogStock.products)
      ? state.catalogStock.products.find((item) => String(item.id) === String(state.catalogProductId)) || null
      : null;
  }

  async function loadCatalog(force = false) {
    if (!can(CAPABILITIES.inventoryCatalogManage)) return;
    if (state.catalogLoading || state.catalogLoaded && !force) return;
    state.catalogLoading = true;
    setCatalogMessage("Stok kataloğu yükleniyor…");
    try {
      const result = await api("/api/procurement/v1/stock/catalog");
      state.catalogStock = result.stockState && typeof result.stockState === "object" ? result.stockState : { categories: [], products: [] };
      state.catalogLoaded = true;
      updateRevision(result, "catalog");
      renderCatalogEditor();
      setCatalogMessage("");
    } catch (error) {
      setCatalogMessage(error.message || "Stok kataloğu yüklenemedi.", true);
      throw error;
    } finally {
      state.catalogLoading = false;
    }
  }

  function catalogUnitOptions(kind, selected = "", includeNone = false) {
    return unitCatalogOptions(kind, selected, includeNone).map((item) => `<option value="${esc(item.value)}" ${String(item.value) === String(selected || "") ? "selected" : ""}>${esc(item.label)}</option>`).join("");
  }

  function renderCatalogEditor() {
    if (!state.catalogLoaded || !state.catalogStock) return;
    const categories = Array.isArray(state.catalogStock.categories) ? state.catalogStock.categories : [];
    if (!categories.some((item) => String(item.id) === String(state.catalogCategoryId))) state.catalogCategoryId = String(categories[0] && categories[0].id || "");
    const products = (Array.isArray(state.catalogStock.products) ? state.catalogStock.products : []).filter((item) => String(item.categoryId) === String(state.catalogCategoryId));
    if (!products.some((item) => String(item.id) === String(state.catalogProductId))) state.catalogProductId = String(products[0] && products[0].id || "");
    const category = selectedCatalogCategory();
    const product = selectedCatalogProduct();
    const categorySelect = $("#stockCatalogCategorySelect");
    const productSelect = $("#stockCatalogProductSelect");
    if (categorySelect) {
      categorySelect.innerHTML = categories.length ? categories.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}${item.active === false ? " · Pasif" : ""}</option>`).join("") : '<option value="">Kategori yok</option>';
      categorySelect.value = state.catalogCategoryId;
    }
    if (productSelect) {
      productSelect.innerHTML = products.length ? products.map((item) => `<option value="${esc(item.id)}">${esc(item.name || item.productName)}${item.active === false ? " · Pasif" : ""}</option>`).join("") : '<option value="">Bu kategoride ürün yok</option>';
      productSelect.value = state.catalogProductId;
    }
    const setValue = (selector, value) => { const node = $(selector); if (node) node.value = String(value ?? ""); };
    setValue("#stockCatalogCategoryName", category && category.name);
    setValue("#stockCatalogProductName", product && (product.name || product.productName));
    setValue("#stockCatalogProductCode", product && product.productCode);
    setValue("#stockCatalogSupplier", product && product.supplier);
    setValue("#stockCatalogUnitFactor", product && (product.unitsPerBulkUnit ?? product.unitsPerCase));
    setValue("#stockCatalogNote", product && product.note);
    const baseUnit = textValue(product && (product.baseUnit || product.unit), "adet");
    const bulkUnit = textValue(product && (product.bulkUnit || product.caseUnit), "");
    const baseSelect = $("#stockCatalogBaseUnit");
    const bulkSelect = $("#stockCatalogBulkUnit");
    if (baseSelect) baseSelect.innerHTML = catalogUnitOptions("base", baseUnit);
    if (bulkSelect) bulkSelect.innerHTML = catalogUnitOptions("bulk", bulkUnit, true);
    if (baseSelect) baseSelect.value = baseUnit;
    if (bulkSelect) bulkSelect.value = bulkUnit;
    if ($("#stockCatalogProductActive")) $("#stockCatalogProductActive").checked = Boolean(product && product.active !== false);
    $$(`#stockCatalogForm input, #stockCatalogForm select, #stockCatalogForm textarea, #stockCatalogSave, #stockCatalogToggleProduct`).forEach((node) => { node.disabled = !product || state.catalogBusy; });
    [baseSelect, bulkSelect, $("#stockCatalogUnitFactor")].forEach((node) => {
      if (node) {
        node.disabled = true;
        node.title = "Birim yapısını ürün detayındaki kontrollü birim ayarlarından değiştirin.";
      }
    });
    if ($("#stockCatalogCategoryName")) $("#stockCatalogCategoryName").disabled = !category || state.catalogBusy;
    if ($("#stockCatalogToggleCategory")) {
      $("#stockCatalogToggleCategory").disabled = !category || state.catalogBusy;
      $("#stockCatalogToggleCategory").textContent = category && category.active === false ? "Kategoriyi Aktifleştir" : "Kategoriyi Pasifleştir";
    }
    if ($("#stockCatalogToggleProduct")) $("#stockCatalogToggleProduct").textContent = product && product.active === false ? "Ürünü Aktifleştir" : "Ürünü Pasifleştir";
  }

  function catalogFormPayload() {
    const category = selectedCatalogCategory();
    const product = selectedCatalogProduct();
    if (!category || !product) throw new Error("Kaydedilecek kategori ve ürünü seçin.");
    const categoryName = String($("#stockCatalogCategoryName")?.value || "").trim();
    const productNameValue = String($("#stockCatalogProductName")?.value || "").trim();
    if (!categoryName || !productNameValue) throw new Error("Kategori ve ürün adı boş bırakılamaz.");
    return {
      category,
      categoryPatch: { name: categoryName },
      product,
      productPatch: {
        name: productNameValue,
        productName: productNameValue,
        categoryId: category.id,
        productCode: String($("#stockCatalogProductCode")?.value || "").trim().toLocaleUpperCase("tr-TR"),
        supplier: String($("#stockCatalogSupplier")?.value || "").trim(),
        note: String($("#stockCatalogNote")?.value || "").trim(),
        active: Boolean($("#stockCatalogProductActive")?.checked),
        statusSource: "manual"
      }
    };
  }

  async function runCatalogMutation(operation, message) {
    if (!can(CAPABILITIES.inventoryCatalogManage)) throw new Error("Stok kataloğunu yönetme yetkiniz yok.");
    if (state.catalogBusy || !state.catalogStock) return;
    state.catalogBusy = true;
    renderCatalogEditor();
    setCatalogMessage("Katalog backend’e kaydediliyor…");
    try {
      const result = await operation();
      updateRevision(result, "catalog");
      state.catalogLoaded = false;
      await loadCatalog(true);
      state.stale = true;
      await loadAll({ force: true, reloadLocations: true });
      renderCatalogEditor();
      setCatalogMessage(message || "Stok kataloğu kaydedildi.");
    } catch (error) {
      setCatalogMessage(error.message || "Stok kataloğu kaydedilemedi.", true);
      throw error;
    } finally {
      state.catalogBusy = false;
      renderCatalogEditor();
    }
  }

  async function addCatalogCategory() {
    await loadCatalog();
    const name = await requestText({ title: "Yeni stok kategorisi", label: "Kategori adı", confirmLabel: "Kategoriyi ekle", maxLength: 120 });
    if (!name) return;
    await runCatalogMutation(async () => {
      const result = await api("/api/procurement/v1/stock/catalog/categories", mutation("POST", { name, active: true }, "fatura-stock-category-create", "catalog"));
      state.catalogCategoryId = String(result.category && result.category.id || result.entityId || "");
      state.catalogProductId = "";
      return result;
    }, `“${name}” kategorisi oluşturuldu.`);
  }

  async function addCatalogProduct() {
    await loadCatalog();
    const category = selectedCatalogCategory();
    if (!category) throw new Error("Önce bir stok kategorisi oluşturun.");
    const name = await requestText({ title: "Yeni stok ürünü", description: `“${category.name}” kategorisine eklenecek ürün.`, label: "Ürün adı", confirmLabel: "Ürünü ekle", maxLength: 160 });
    if (!name) return;
    const baseUnit = state.unitDefinitions.base[0] || "adet";
    await runCatalogMutation(async () => {
      const result = await api("/api/procurement/v1/stock/catalog/products", mutation("POST", {
        categoryId: category.id, name, productName: name, active: true, baseUnit, unit: baseUnit,
        bulkUnit: "", caseUnit: "", unitsPerBulkUnit: 0, unitsPerCase: 0
      }, "fatura-stock-product-create", "catalog"));
      state.catalogProductId = String(result.product && result.product.id || result.entityId || "");
      return result;
    }, `“${name}” ürünü oluşturuldu.`);
  }

  async function toggleCatalogEntity(kind) {
    await loadCatalog();
    const entity = kind === "category" ? selectedCatalogCategory() : selectedCatalogProduct();
    if (!entity) return;
    const active = entity.active === false;
    const endpoint = kind === "category"
      ? `/api/procurement/v1/stock/catalog/categories/${encodeURIComponent(entity.id)}`
      : `/api/procurement/v1/stock/catalog/products/${encodeURIComponent(entity.id)}`;
    await runCatalogMutation(
      () => api(endpoint, mutation("PATCH", { active, statusSource: "manual" }, `fatura-stock-${kind}-toggle`, "catalog")),
      `${kind === "category" ? "Kategori" : "Ürün"} ${active ? "aktifleştirildi" : "pasifleştirildi"}.`
    );
  }

  async function openCatalogEditor(action = "") {
    if (!can(CAPABILITIES.inventoryCatalogManage)) return setMessage("Stok kataloğunu yönetme yetkiniz yok.", "error");
    const panel = $("#stockManagementAccordion");
    if (panel) panel.open = true;
    await loadCatalog();
    if (action === "new-product") await addCatalogProduct();
    panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function renderAll() {
    applyCapabilityVisibility();
    renderCommandKpis();
    renderLocations();
    renderSummary();
    renderWarehouseCards();
    renderViewMode();
    renderCategories();
    renderInventory();
    renderFormOptions();
    renderTransfers();
    renderMovements();
    renderLocationManagement();
    renderUnitSettings();
    renderPlanning();
    renderCriticalAlerts();
    renderAccordionState();
    renderCatalogEditor();
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
      if (!error || error.stockMessageHandled !== true) setMessage(error.message, "error");
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
    if (id === "stockUnitMigrationDialog") state.pendingUnitMigration = null;
  }

  async function submitTransfer(form) {
    if (!can(CAPABILITIES.inventoryTransferCreate)) throw new Error("Transfer oluşturma yetkiniz yok.");
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
      const approveNow = can(CAPABILITIES.inventoryTransferApprove);
      const result = await api("/api/procurement/v1/stock/transfers", mutation("POST", {
        productId: productId(balance), fromLocationId, toLocationId, quantity,
        unit: transferUnit, note: $("#stockTransferNote")?.value.trim() || "", directApply: approveNow, approveNow
      }, "admin-stock-transfer"));
      form.reset();
      $("#stockTransferDialog")?.close();
      closeProductDrawer({ restoreFocus: false });
      await reloadAfterMutation(result, approveNow ? "Depolar arası transfer tamamlandı." : "Transfer talebi onaya gönderildi.");
    });
  }

  async function submitMovement(form) {
    if (!can(CAPABILITIES.inventoryMovementCreate)) throw new Error("Stok hareketi oluşturma yetkiniz yok.");
    const button = $("#stockLocationMovementSubmit");
    return runOperation("stock-movement", button, async () => {
      if (!state.selectedLocationId || state.selectedLocationId === "total") throw new Error("Önce gerçek bir depo seçin.");
      const balance = selectedBalance("#stockLocationMovementProduct");
      const quantity = Number($("#stockLocationMovementQuantity")?.value || 0);
      if (!balance || !(quantity > 0)) throw new Error("Ürün ve geçerli miktar seçin.");
      const reason = $("#stockLocationMovementReason")?.value || "Kullanım";
      const note = $("#stockLocationMovementNote")?.value.trim() || "";
      if (reason === "Diğer" && !note) throw new Error("Diğer nedeni için kısa bir açıklama yazın.");
      const result = await api("/api/procurement/v1/stock/movements", mutation("POST", {
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
    if (!can(CAPABILITIES.inventoryTransferApprove)) throw new Error("Transfer kararı verme yetkiniz yok.");
    const note = $(`[data-transfer-note="${CSS.escape(id)}"]`)?.value.trim() || "";
    if (decision === "reject" && !note) {
      setMessage("Transfer talebini reddetmek için neden yazın.", "error");
      return;
    }
    return runOperation(`transfer-${decision}:${id}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/transfers/${encodeURIComponent(id)}/${decision}`, mutation("POST", {
        note, reason: decision === "reject" ? note : ""
      }, `admin-transfer-${decision}`));
      await reloadAfterMutation(result, decision === "approve" ? "Transfer talebi onaylandı ve bakiyeler güncellendi." : "Transfer talebi reddedildi.");
    });
  }

  async function reverseMovement(id, button) {
    if (!can(CAPABILITIES.inventoryMovementReverse)) throw new Error("Hareketi geri alma yetkiniz yok.");
    if (!await requestConfirmation("Ters kayıt oluştur", "Bu stok hareketi silinmeden, denetimli bir ters hareketle geri alınacaktır.", "Ters Kayıt Oluştur")) return;
    return runOperation(`reverse:${id}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/movements/${encodeURIComponent(id)}/reverse`, mutation("POST", {
        note: "Yönetici arayüzünden ters kayıt"
      }, "admin-stock-reversal"));
      await reloadAfterMutation(result, "Ters kayıt oluşturuldu; geçmiş kayıt silinmedi.");
    });
  }

  async function createLocation(form) {
    if (!can(CAPABILITIES.inventoryLocationManage)) throw new Error("Depo yönetimi yetkiniz yok.");
    const button = $("button[type=submit]", form);
    return runOperation("location-create", button, async () => {
      const name = $("#stockLocationName")?.value.trim() || "";
      const code = $("#stockLocationCode")?.value.trim().toUpperCase() || "";
      if (!name || !code) throw new Error("Depo adı ve kodu zorunludur.");
      const result = await api("/api/procurement/v1/stock/locations", mutation("POST", {
        name, code, type: $("#stockLocationType")?.value || "other",
        description: $("#stockLocationDescription")?.value.trim() || "",
        active: true, isDefault: Boolean($("#stockLocationDefault")?.checked)
      }, "admin-stock-location"));
      form.reset();
      await reloadAfterMutation(result, "Yeni depo oluşturuldu.");
    });
  }

  async function toggleLocation(id, active, button) {
    if (!can(CAPABILITIES.inventoryLocationManage)) throw new Error("Depo yönetimi yetkiniz yok.");
    if (!active && !await requestConfirmation("Depoyu pasifleştir", "Bu depo yeni stok ve transfer işlemlerine kapatılacaktır. Geçmiş kayıtlar korunacaktır.", "Pasifleştir")) return;
    return runOperation(`location-toggle:${id}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/locations/${encodeURIComponent(id)}`, mutation("PATCH", { active }, "fatura-stock-location-toggle"));
      await reloadAfterMutation(result, active ? "Depo aktifleştirildi." : "Depo pasifleştirildi.");
    });
  }

  async function editLocation(id, button) {
    if (!can(CAPABILITIES.inventoryLocationManage)) throw new Error("Depo yönetimi yetkiniz yok.");
    const location = state.locations.find((item) => String(item.id) === String(id));
    if (!location) return;
    $("#stockLocationEditId").value = String(id);
    $("#stockLocationEditName").value = location.name || "";
    $("#stockLocationEditStatus").value = location.active === false ? "passive" : "active";
    $("#stockLocationEditMessage").textContent = "";
    const dialog = $("#stockLocationEditDialog");
    if (dialog && !dialog.open) dialog.showModal();
    $("#stockLocationEditName")?.focus();
  }

  async function saveLocationEdit(form) {
    if (!can(CAPABILITIES.inventoryLocationManage)) throw new Error("Depo yönetimi yetkiniz yok.");
    const id = $("#stockLocationEditId")?.value || "";
    const name = $("#stockLocationEditName")?.value.trim() || "";
    const active = $("#stockLocationEditStatus")?.value !== "passive";
    if (!id || !name) throw new Error("Depo adı zorunludur.");
    if (name.length > 120) throw new Error("Depo adı en fazla 120 karakter olabilir.");
    const current = state.locations.find((location) => String(location.id) === String(id));
    if (active && state.locations.some((location) => String(location.id) !== String(id)
      && location.active !== false && locationNameKey(location.name) === locationNameKey(name))) {
      throw new Error("Bu depo adı aktif başka bir depoda kullanılıyor.");
    }
    if (current && current.active !== false && !active
      && !await requestConfirmation("Depoyu pasifleştir", "Bu depo yeni stok ve transfer işlemlerine kapatılacaktır. Geçmiş kayıtlar korunacaktır.", "Pasifleştir")) return;
    const button = $("#stockLocationEditSubmit");
    return runOperation(`location-edit:${id}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/locations/${encodeURIComponent(id)}`, mutation("PATCH", { name, active }, "fatura-stock-location-edit"));
      $("#stockLocationEditDialog")?.close();
      await reloadAfterMutation(result, "Depo bilgileri güncellendi.");
    });
  }

  async function saveLocationPersonnel(id, button) {
    if (!can(CAPABILITIES.inventoryLocationManage)) throw new Error("Depo yönetimi yetkiniz yok.");
    const select = $(`[data-location-personnel="${CSS.escape(String(id))}"]`);
    if (!select) return;
    const assignedPersonnelIds = Array.from(select.selectedOptions || []).map((option) => option.value).filter(Boolean);
    return runOperation(`location-personnel:${id}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/locations/${encodeURIComponent(id)}`, mutation("PATCH", { assignedPersonnelIds }, "fatura-stock-location-personnel"));
      await reloadAfterMutation(result, "Personel depo ataması kaydedildi.");
    });
  }

  async function editThresholds(productIdValue) {
    openThresholdDialog(productIdValue);
  }

  function readUnitSchemaForm() {
    const baseUnit = textValue($("#stockThresholdBaseUnit")?.value, "adet").toLocaleLowerCase("tr-TR");
    const bulkUnit = textValue($("#stockThresholdBulkUnit")?.value, "").toLocaleLowerCase("tr-TR");
    const unitsPerBulkUnit = bulkUnit ? Number($("#stockThresholdFactor")?.value || 0) : 0;
    const defaultMovementUnit = textValue($("#stockThresholdDefaultUnit")?.value, baseUnit).toLocaleLowerCase("tr-TR");
    const allowDecimal = Boolean($("#stockThresholdAllowDecimal")?.checked);
    if (!baseUnit || !Number.isFinite(unitsPerBulkUnit) || unitsPerBulkUnit < 0 || (bulkUnit && unitsPerBulkUnit <= 0)) {
      throw new Error("Birim dönüşümü geçersiz.");
    }
    if (![baseUnit, ...(bulkUnit && unitsPerBulkUnit > 0 ? [bulkUnit] : [])].includes(defaultMovementUnit)) {
      throw new Error("Varsayılan işlem birimi temel veya toplu birim olmalıdır.");
    }
    return { targetBaseUnit: baseUnit, targetBulkUnit: bulkUnit, unitsPerBulkUnit, defaultMovementUnit, allowDecimal };
  }

  function renderUnitMigrationPreview(plan) {
    const host = $("#stockUnitMigrationPreview");
    if (!host || !plan) return;
    host.innerHTML = `<div class="stock-unit-migration-preview__summary">
      <article><span>Eski birim yapısı</span><strong>${esc(plan.currentSchema.baseUnit)}${plan.currentSchema.bulkUnit ? ` · 1 ${esc(plan.currentSchema.bulkUnit)} = ${esc(formatNumber(plan.currentSchema.unitsPerBulkUnit))} ${esc(plan.currentSchema.baseUnit)}` : ""}</strong></article>
      <article><span>Yeni birim yapısı</span><strong>${esc(plan.targetSchema.baseUnit)}${plan.targetSchema.bulkUnit ? ` · 1 ${esc(plan.targetSchema.bulkUnit)} = ${esc(formatNumber(plan.targetSchema.unitsPerBulkUnit))} ${esc(plan.targetSchema.baseUnit)}` : ""}</strong></article>
      <article><span>Mevcut stok</span><strong>${esc(plan.currentDisplay)}</strong></article>
      <article><span>Dönüşüm sonrası</span><strong>${esc(plan.nextDisplay)} · oran ${esc(formatNumber(plan.factor))}</strong></article>
    </div><div class="stock-unit-migration-preview__locations">${(plan.locations || []).map((item) => `<article><span>${esc(item.locationName)}<small>${esc(item.current.display)} → ${esc(item.next.display)}</small></span><strong>Kritik ${esc(formatNumber(item.current.criticalThreshold))} → ${esc(formatNumber(item.next.criticalThreshold))}<br>Sipariş ${esc(formatNumber(item.current.orderThreshold))} → ${esc(formatNumber(item.next.orderThreshold))}<br>Hedef ${esc(formatNumber(item.current.targetLevel))} → ${esc(formatNumber(item.next.targetLevel))}</strong></article>`).join("")}</div>`;
  }

  async function submitUnitSchema(button) {
    if (!can(CAPABILITIES.inventoryCatalogManage)) throw new Error("Birim yapılandırması için stok kataloğu yönetim yetkisi gereklidir.");
    const balance = selectedProductBalance();
    if (!balance) throw new Error("Ürün bulunamadı.");
    const productKey = productId(balance);
    const schema = readUnitSchemaForm();
    const initial = state.thresholdInitial || {};
    const baseChanged = unitKey(schema.targetBaseUnit) !== unitKey(initial.baseUnit);
    if (baseChanged) {
      return runOperation(`unit-preview:${productKey}`, button, async () => {
        const result = await api(`/api/procurement/v1/stock/products/${encodeURIComponent(productKey)}/unit-migration`, {
          method: "POST",
          body: { ...schema, confirm: false }
        });
        state.pendingUnitMigration = { productId: productKey, schema, plan: result.plan };
        renderUnitMigrationPreview(result.plan);
        $("#stockUnitMigrationMessage").textContent = "Bu işlem mevcut stok ve eşikleri yeni temel birime dönüştürecektir.";
        const dialog = $("#stockUnitMigrationDialog");
        if (dialog && !dialog.open) dialog.showModal();
      });
    }
    const payload = {
      baseUnit: schema.targetBaseUnit,
      bulkUnit: schema.targetBulkUnit,
      unitsPerBulkUnit: schema.unitsPerBulkUnit,
      defaultMovementUnit: schema.defaultMovementUnit,
      allowDecimal: schema.allowDecimal
    };
    return runOperation(`unit-schema:${productKey}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/catalog/products/${encodeURIComponent(productKey)}`,
        mutation("PATCH", payload, "fatura-stock-unit-schema", "catalog"));
      $("#stockThresholdDialog")?.close();
      state.thresholdInitial = null;
      closeProductDrawer({ restoreFocus: false });
      await reloadAfterMutation(result, "Birim yapısı güncellendi.");
    });
  }

  async function confirmUnitMigration(button) {
    const pending = state.pendingUnitMigration;
    if (!pending) throw new Error("Onaylanacak birim dönüşümü bulunamadı.");
    return runOperation(`unit-migration:${pending.productId}`, button, async () => {
      const result = await api(`/api/procurement/v1/stock/products/${encodeURIComponent(pending.productId)}/unit-migration`,
        mutation("POST", { ...pending.schema, confirm: true }, "fatura-stock-unit-migration", ["inventory", "catalog"]));
      state.pendingUnitMigration = null;
      $("#stockUnitMigrationDialog")?.close();
      $("#stockThresholdDialog")?.close();
      state.thresholdInitial = null;
      closeProductDrawer({ restoreFocus: false });
      await reloadAfterMutation(result, "Stok ve eşikler yeni temel birime güvenle dönüştürüldü.");
    });
  }

  async function submitThresholds(form) {
    if (!can(CAPABILITIES.inventoryManage)) throw new Error("Depo eşiklerini yönetme yetkiniz yok.");
    const balance = selectedProductBalance();
    if (!balance || state.selectedLocationId === "total") throw new Error("Önce gerçek bir depo ve ürün seçin.");
    const critical = Number($("#stockThresholdCritical")?.value);
    const order = Number($("#stockThresholdOrder")?.value);
    const target = Number($("#stockThresholdTarget")?.value);
    if ([critical, order, target].some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Eşik değerleri sıfır veya daha büyük olmalıdır.");
    if (critical > order) throw new Error("Kritik eşik sipariş eşiğinden büyük olamaz.");
    const productKey = productId(balance);
    const payload = {
      locationId: state.selectedLocationId,
      criticalThreshold: critical,
      orderThreshold: order,
      targetLevel: target
    };
    const retryDraft = {
      criticalThreshold: critical,
      orderThreshold: order,
      targetLevel: target
    };
    return runOperation(`thresholds:${productKey}`, $("#stockThresholdSubmit"), async () => {
      try {
        const result = await api(`/api/procurement/v1/stock/inventory/${encodeURIComponent(productKey)}`,
          mutation("PATCH", payload, "fatura-stock-thresholds", "inventory"));
        $("#stockThresholdDialog")?.close();
        state.thresholdInitial = null;
        closeProductDrawer({ restoreFocus: false });
        await reloadAfterMutation(result, "Seçili depo eşikleri güncellendi.");
      } catch (error) {
        const revisionConflict = error && error.status === 409 && /başka bir işlemle güncellendi/i.test(error.message || "");
        if (revisionConflict) {
          state.stale = true;
          await loadAll({ force: true, reloadLocations: true });
          openThresholdDialog(productKey, retryDraft);
          const message = "Stok verisi başka bir işlemle güncellendi. Güncel veriler yükleniyor; tekrar deneyin.";
          $("#stockThresholdDialogMessage").textContent = message;
          error.message = message;
          error.stockMessageHandled = true;
        }
        throw error;
      }
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
    if (!can(CAPABILITIES.inventoryCountManage)) throw new Error("Sayım yönetimi yetkiniz yok.");
    if (!state.activeCount) throw new Error("Aktif sayım bulunamadı.");
    const items = countInputItems();
    if (!items.length) throw new Error("En az bir fiziksel sayım sonucu girin.");
    const result = await api(`/api/procurement/v1/stock/counts/${encodeURIComponent(state.activeCount.id)}`, mutation("PATCH", { items }, "fatura-stock-count-save"));
    updateRevision(result);
    state.activeCount = result.count;
    state.counts = [result.count, ...state.counts.filter((count) => count.id !== result.count.id)];
    renderCountDialog();
    return result;
  }

  async function openOrStartCount(button) {
    if (!can(CAPABILITIES.inventoryCountManage)) throw new Error("Sayım yönetimi yetkiniz yok.");
    if (!state.selectedLocationId || state.selectedLocationId === "total") throw new Error("Sayım için gerçek bir depo seçin.");
    if (state.locations.find((location) => String(location.id) === String(state.selectedLocationId))?.active === false) throw new Error("Pasif depoda yeni sayım başlatılamaz.");
    return runOperation("stock-count-start", button, async () => {
      const existing = state.counts.find((count) => count.status === "active" && count.locationId === state.selectedLocationId);
      if (existing) state.activeCount = existing;
      else {
        const result = await api("/api/procurement/v1/stock/counts", mutation("POST", { locationId: state.selectedLocationId }, "fatura-stock-count-start"));
        updateRevision(result);
        state.activeCount = result.count;
        state.counts.unshift(result.count);
      }
      renderCountDialog();
      $("#stockCountDialog")?.showModal();
    });
  }

  async function saveCount(button) {
    if (!can(CAPABILITIES.inventoryCountManage)) throw new Error("Sayım yönetimi yetkiniz yok.");
    return runOperation("stock-count-save", button, async () => {
      await persistCountInputs();
      $("#stockCountMessage").textContent = "Sayım taslağı kaydedildi; stok henüz değişmedi.";
    });
  }

  async function approveCount(button) {
    if (!can(CAPABILITIES.inventoryCountManage)) throw new Error("Sayım yönetimi yetkiniz yok.");
    return runOperation("stock-count-approve", button, async () => {
      await persistCountInputs();
      const result = await api(`/api/procurement/v1/stock/counts/${encodeURIComponent(state.activeCount.id)}/approve`, mutation("POST", {}, "fatura-stock-count-approve"));
      $("#stockCountDialog")?.close();
      state.activeCount = null;
      await reloadAfterMutation(result, "Sayım onaylandı; farklar atomik stok hareketleriyle uygulandı.");
    });
  }

  async function cancelCount(button) {
    if (!can(CAPABILITIES.inventoryCountManage)) throw new Error("Sayım yönetimi yetkiniz yok.");
    if (!state.activeCount || !await requestConfirmation("Sayımı iptal et", "Taslak sayım kapatılacak; stok bakiyesi değişmeyecektir.", "Sayımı İptal Et")) return;
    return runOperation("stock-count-cancel", button, async () => {
      const result = await api(`/api/procurement/v1/stock/counts/${encodeURIComponent(state.activeCount.id)}/cancel`, mutation("POST", {}, "fatura-stock-count-cancel"));
      $("#stockCountDialog")?.close();
      state.activeCount = null;
      await reloadAfterMutation(result, "Sayım iptal edildi; stok bakiyesi değişmedi.");
    });
  }

  function publishLocationContext() {
    const detail = { locations: state.locations.slice(), selectedLocationId: state.selectedLocationId, revision: state.inventoryRevision };
    document.dispatchEvent(new CustomEvent("tahmisci:stock-locations-ready", { detail }));
  }

  function openQuickDrawer(trigger) {
    const layer = $("#stockQuickDrawerLayer");
    const drawer = $("#stockQuickDrawer");
    if (!layer || !drawer) return;
    state.quickDrawerReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    layer.hidden = false;
    $("#stockQuickActionsButton")?.setAttribute("aria-expanded", "true");
    document.body.classList.add("dialog-open");
    requestAnimationFrame(() => drawer.focus());
  }

  function closeQuickDrawer(options = {}) {
    const layer = $("#stockQuickDrawerLayer");
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    $("#stockQuickActionsButton")?.setAttribute("aria-expanded", "false");
    if (!document.querySelector("dialog[open]") && $("#stockProductDrawerLayer")?.hidden !== false) document.body.classList.remove("dialog-open");
    if (options.restoreFocus !== false && state.quickDrawerReturnFocus instanceof HTMLElement) state.quickDrawerReturnFocus.focus();
    state.quickDrawerReturnFocus = null;
  }

  function stockWorkspaceUrl(locationId = "") {
    const url = new URL("/fatura/", location.origin);
    url.searchParams.set("view", "stock");
    if (locationId) url.searchParams.set("locationId", locationId);
    return `${url.pathname}${url.search}`;
  }

  function enterWarehouse(locationId, options = {}) {
    const resolved = state.locations.find((item) => String(item.id) === String(locationId));
    if (!resolved) return;
    state.selectedLocationId = String(resolved.id);
    state.viewMode = "inventory";
    state.secondaryLoaded = false;
    state.stale = true;
    try { localStorage.setItem(LOCATION_STORAGE_KEY, state.selectedLocationId); } catch (_error) {}
    const stockOverviewBack = options.replaceHistory
      ? Boolean(history.state && history.state.stockOverviewBack)
      : options.skipHistory === true ? Boolean(history.state && history.state.stockOverviewBack) : true;
    const historyState = { ...(history.state || {}), faturaView: "stock", stockWorkspace: true, stockOverviewBack, locationId: state.selectedLocationId };
    if (options.replaceHistory) history.replaceState(historyState, "", stockWorkspaceUrl(state.selectedLocationId));
    else if (options.skipHistory !== true) history.pushState(historyState, "", stockWorkspaceUrl(state.selectedLocationId));
    return loadAll({ force: true });
  }

  function leaveWarehouse(options = {}) {
    closeProductDrawer({ restoreFocus: false });
    state.viewMode = "overview";
    renderAll();
    if (options.fromPopstate) return;
    if (history.state && history.state.stockWorkspace && history.state.stockOverviewBack) history.back();
    else {
      const nextState = { ...(history.state || {}), faturaView: "stock", stockWorkspace: false, stockOverviewBack: false };
      delete nextState.locationId;
      history.replaceState(nextState, "", stockWorkspaceUrl());
    }
  }

  function trapQuickDrawerFocus(event) {
    if (event.key !== "Tab") return;
    const drawer = $("#stockQuickDrawer");
    if (!drawer) return;
    const items = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', drawer)
      .filter((item) => !item.hidden && item.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function bindEvents() {
    const workspace = $("#stockLocationWorkspace");
    if (!workspace) return;
    applyCapabilityVisibility();
    if (state.bound && state.boundWorkspace === workspace) return;
    state.bound = true;
    state.boundWorkspace = workspace;
    workspace.addEventListener("click", (event) => {
      const quickDrawerOpen = event.target.closest("#stockQuickActionsButton");
      if (quickDrawerOpen) { openQuickDrawer(quickDrawerOpen); return; }
      if (event.target.closest("[data-stock-quick-close]")) { closeQuickDrawer(); return; }
      const quickAction = event.target.closest("[data-stock-quick]");
      if (quickAction) {
        closeQuickDrawer({ restoreFocus: false });
        openQuickAction(quickAction.dataset.stockQuick).catch((error) => setMessage(error.message, "error"));
        return;
      }
      const alert = event.target.closest("[data-stock-alert-target]");
      if (alert) {
        const target = alert.dataset.stockAlertTarget;
        if (target === "shipments") {
          closeQuickDrawer({ restoreFocus: false });
          document.dispatchEvent(new CustomEvent("tahmisci:fatura:navigate", { detail: { view: "shipments" } }));
          return;
        }
        closeQuickDrawer({ restoreFocus: false });
        state.activeAccordion = "planning";
        renderAccordionState();
        $("#stockPlanningAccordion")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const analysis = event.target.closest("[data-stock-analysis-product]");
      if (analysis) {
        document.dispatchEvent(new CustomEvent("tahmisci:fatura:navigate", { detail: { view: "productAnalysis", productId: analysis.dataset.stockAnalysisProduct } }));
        return;
      }
      const retry = event.target.closest("[data-stock-retry]");
      if (retry) { loadAll({ force: true, reloadLocations: true }).catch(() => {}); return; }
      const planningRetry = event.target.closest("[data-stock-planning-retry]");
      if (planningRetry) { refreshPlanning({ force: true }).catch(() => {}); return; }
      const warehouseOpen = event.target.closest("[data-stock-warehouse-open]");
      if (warehouseOpen) {
        enterWarehouse(warehouseOpen.dataset.stockWarehouseOpen).catch(() => {});
        return;
      }
      const warehouseEdit = event.target.closest("[data-stock-warehouse-edit]");
      if (warehouseEdit) {
        editLocation(warehouseEdit.dataset.stockWarehouseEdit, warehouseEdit).catch(() => {});
        return;
      }
      const locationButton = event.target.closest("[data-stock-location-select]");
      if (locationButton) {
        closeProductDrawer({ restoreFocus: false });
        enterWarehouse(locationButton.dataset.stockLocationSelect, { replaceHistory: true }).catch(() => {});
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
        else if (action === "analysis") {
          document.dispatchEvent(new CustomEvent("tahmisci:fatura:navigate", { detail: { view: "productAnalysis", productId: state.selectedProductId } }));
        }
        return;
      }
      const unitRename = event.target.closest("[data-stock-unit-rename]");
      if (unitRename) {
        const row = unitRename.closest(".stock-unit-row");
        const input = row && $("[data-stock-unit-name]", row);
        mutateUnitCatalog("rename", unitRename.dataset.stockUnitRename, { from: unitRename.dataset.stockUnitOriginal, to: input && input.value }, unitRename).catch(() => {});
        return;
      }
      const unitRemove = event.target.closest("[data-stock-unit-remove]");
      if (unitRemove) {
        const unit = unitRemove.dataset.stockUnitOriginal;
        requestConfirmation("Birimi sil", `“${unit}” kullanılmıyorsa katalogdan kaldırılacak. Devam edilsin mi?`, "Birimi Sil").then((confirmed) => {
          if (confirmed) mutateUnitCatalog("remove", unitRemove.dataset.stockUnitRemove, { from: unit }, unitRemove).catch(() => {});
        });
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
    $("#stockLocationMovementProduct")?.addEventListener("change", () => {
      updateProductUnits();
      const balance = selectedBalance("#stockLocationMovementProduct");
      if (balance) $("#stockLocationMovementProductName").textContent = productName(balance);
      updateMovementPreview();
    });
    $("#stockLocationMovementUnit")?.addEventListener("change", updateMovementPreview);
    $("#stockLocationMovementReason")?.addEventListener("change", (event) => {
      const note = $("#stockLocationMovementNote");
      if (note) note.required = event.currentTarget.value === "Diğer";
    });
    $("#stockLocationMovementQuantity")?.addEventListener("input", updateMovementPreview);
    $("#stockLocationMovementClose")?.addEventListener("click", closeMovementDock);
    $("#stockThresholdBaseUnit")?.addEventListener("change", updateThresholdConversionPreview);
    $("#stockThresholdBulkUnit")?.addEventListener("change", updateThresholdConversionPreview);
    $("#stockThresholdFactor")?.addEventListener("input", updateThresholdConversionPreview);
    $("#stockMovementTypeFilter")?.addEventListener("change", () => loadMovements().then(renderMovements).catch((error) => setMessage(error.message, "error")));
    $("#stockMovementProductFilter")?.addEventListener("change", () => loadMovements().then(renderMovements).catch((error) => setMessage(error.message, "error")));
    $("#stockLocationRefreshButton")?.addEventListener("click", (event) => runOperation("refresh", event.currentTarget, () => loadAll({ force: true })).catch(() => {}));
    $("#stockWarehouseBackButton")?.addEventListener("click", () => leaveWarehouse());
    $("#stockLocationOverviewAddButton")?.addEventListener("click", () => { const dialog = $("#stockLocationManagementDialog"); if (dialog && !dialog.open) dialog.showModal(); });
    $("#stockLocationNewProductButton")?.addEventListener("click", () => {
      openCatalogEditor("new-product").catch((error) => setCatalogMessage(error.message, true));
    });
    $("#stockManagementAccordion")?.addEventListener("toggle", (event) => {
      if (event.currentTarget.open) loadCatalog().catch(() => {});
    });
    $$("[data-stock-main-accordion]").forEach((section) => section.addEventListener("toggle", () => {
      if (!section.open) return;
      state.activeAccordion = section.dataset.stockMainAccordion;
      $$("[data-stock-main-accordion]").forEach((other) => { if (other !== section) other.open = false; });
      if (state.activeAccordion === "planning" && state.planningStale) {
        refreshPlanning().catch(() => {});
      }
    }));
    $("#stockCatalogCategorySelect")?.addEventListener("change", (event) => {
      state.catalogCategoryId = event.currentTarget.value;
      state.catalogProductId = "";
      renderCatalogEditor();
    });
    $("#stockCatalogProductSelect")?.addEventListener("change", (event) => {
      state.catalogProductId = event.currentTarget.value;
      renderCatalogEditor();
    });
    $("#stockCatalogAddCategory")?.addEventListener("click", () => addCatalogCategory().catch((error) => setCatalogMessage(error.message, true)));
    $("#stockCatalogAddProduct")?.addEventListener("click", () => addCatalogProduct().catch((error) => setCatalogMessage(error.message, true)));
    $("#stockCatalogToggleCategory")?.addEventListener("click", () => toggleCatalogEntity("category").catch((error) => setCatalogMessage(error.message, true)));
    $("#stockCatalogToggleProduct")?.addEventListener("click", () => toggleCatalogEntity("product").catch((error) => setCatalogMessage(error.message, true)));
    $("#stockCatalogForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const payload = catalogFormPayload();
        runCatalogMutation(async () => {
          const categoryChanged = String(payload.category.name || "") !== String(payload.categoryPatch.name || "");
          if (categoryChanged) {
            const categoryResult = await api(`/api/procurement/v1/stock/catalog/categories/${encodeURIComponent(payload.category.id)}`,
              mutation("PATCH", payload.categoryPatch, "fatura-stock-category-update", "catalog"));
            updateRevision(categoryResult, "catalog");
          }
          return api(`/api/procurement/v1/stock/catalog/products/${encodeURIComponent(payload.product.id)}`,
            mutation("PATCH", payload.productPatch, "fatura-stock-product-update", "catalog"));
        }, "Stok ürün bilgileri kaydedildi.").catch(() => {});
      } catch (error) { setCatalogMessage(error.message, true); }
    });
    $("#stockTransferRequestsButton")?.addEventListener("click", () => {
      const dialog = $("#stockTransferRequestsDialog");
      if (dialog && !dialog.open) dialog.showModal();
    });
    $("#stockMovementHistoryButton")?.addEventListener("click", () => loadMovements().then(() => {
      closeQuickDrawer({ restoreFocus: false });
      renderMovements();
      const dialog = $("#stockHistoryDialog");
      if (dialog && !dialog.open) dialog.showModal();
    }).catch((error) => setMessage(error.message, "error")));
    $("#stockLocationManagementButton")?.addEventListener("click", () => {
      const dialog = $("#stockLocationManagementDialog");
      if (dialog && !dialog.open) dialog.showModal();
    });
    $("#stockUnitSettingsButton")?.addEventListener("click", openUnitSettingsDialog);
    $("#stockUnitSettingsDialog")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
    $$('[data-stock-unit-add]').forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("[data-stock-unit-input]", form);
      const values = String(input && input.value || "");
      mutateUnitCatalog("add", form.dataset.stockUnitAdd, { values }, form.querySelector("button[type=submit]")).then(() => { if (input) input.value = ""; }).catch(() => {});
    }));
    $("#stockCountStartButton")?.addEventListener("click", async (event) => {
      try {
        closeQuickDrawer({ restoreFocus: false });
        await loadCounts();
        await openOrStartCount(event.currentTarget);
      } catch (error) {
        setMessage(error.message, "error");
      }
    });
    $("#stockCountSaveButton")?.addEventListener("click", (event) => saveCount(event.currentTarget).catch((error) => { $("#stockCountMessage").textContent = error.message; }));
    $("#stockCountApproveButton")?.addEventListener("click", (event) => approveCount(event.currentTarget).catch((error) => { $("#stockCountMessage").textContent = error.message; }));
    $("#stockCountCancelButton")?.addEventListener("click", (event) => cancelCount(event.currentTarget).catch((error) => { $("#stockCountMessage").textContent = error.message; }));
    $("#stockTransferForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitTransfer(event.currentTarget).catch((error) => { $("#stockTransferDialogMessage").textContent = error.message; }); });
    $("#stockLocationMovementForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitMovement(event.currentTarget).catch((error) => { $("#stockMovementDialogMessage").textContent = error.message; }); });
    $("#stockThresholdForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitThresholds(event.currentTarget).catch((error) => { $("#stockThresholdDialogMessage").textContent = error.message; }); });
    $("#stockUnitSchemaSubmit")?.addEventListener("click", (event) => { submitUnitSchema(event.currentTarget).catch((error) => { $("#stockThresholdDialogMessage").textContent = error.message; }); });
    $("#stockUnitMigrationForm")?.addEventListener("submit", (event) => { event.preventDefault(); confirmUnitMigration($("#stockUnitMigrationConfirm")).catch((error) => { $("#stockUnitMigrationMessage").textContent = error.message; }); });
    $("#stockLocationEditForm")?.addEventListener("submit", (event) => { event.preventDefault(); saveLocationEdit(event.currentTarget).catch((error) => { $("#stockLocationEditMessage").textContent = error.message; }); });
    $("#stockLocationCreateForm")?.addEventListener("submit", (event) => { event.preventDefault(); createLocation(event.currentTarget).catch(() => {}); });
    $$('[data-stock-dialog-close]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.stockDialogClose)));
    if (stockKeydownHandler) document.removeEventListener("keydown", stockKeydownHandler);
    stockKeydownHandler = (event) => {
      if (!$("#stockQuickDrawerLayer")?.hidden) {
        if (event.key === "Escape") { closeQuickDrawer(); return; }
        trapQuickDrawerFocus(event);
      }
      if (event.key === "Escape" && !$("#stockProductDrawerLayer")?.hidden && !document.querySelector("dialog[open]")) closeProductDrawer();
    };
    document.addEventListener("keydown", stockKeydownHandler);
    if (state.popstateHandler) window.removeEventListener("popstate", state.popstateHandler);
    state.popstateHandler = () => {
      if (activeSection() !== "stock") return;
      const url = new URL(location.href);
      const locationId = url.searchParams.get("locationId") || "";
      if (locationId && state.locations.some((item) => String(item.id) === locationId)) enterWarehouse(locationId, { skipHistory: true }).catch(() => {});
      else leaveWarehouse({ fromPopstate: true });
    };
    window.addEventListener("popstate", state.popstateHandler);
  }

let stockEventTimer = null;

export function renderStockView() {
  const template = document.getElementById("stockViewTemplate");
  return template ? template.innerHTML : '<div class="empty-state"><p>Stok görünümü yüklenemedi.</p></div>';
}

export async function loadStockView({ force = false } = {}) {
  if (!$("#stockLocationWorkspace")) {
    const host = document.getElementById("contentView");
    if (host) host.innerHTML = renderStockView();
    state.bound = false;
    state.boundWorkspace = null;
  }
  bindEvents();
  if (state.loaded && !state.stale && !force) {
    renderAll();
    return state;
  }
  await loadAll({ force, reloadLocations: force });
  return state;
}

export async function applyStockIntent(intent = {}) {
  if (activeSection() !== "stock") return false;
  const locationId = String(intent.locationId || "");
  if (locationId && state.locations.some((item) => String(item.id) === locationId)) {
    await enterWarehouse(locationId, { replaceHistory: true });
  }
  const productIdValue = String(intent.productId || intent.stockProductId || "");
  if (productIdValue) {
    state.viewMode = "inventory";
    renderAll();
    const card = $(`[data-stock-product-card="${CSS.escape(productIdValue)}"]`);
    openProductDrawer(productIdValue, card || null);
  }
  const transferId = String(intent.transferId || "");
  if (transferId) {
    renderTransfers();
    const dialog = $("#stockTransferRequestsDialog");
    if (dialog && !dialog.open) dialog.showModal();
    const transfer = $(`[data-stock-transfer-card="${CSS.escape(transferId)}"]`);
    if (transfer) {
      transfer.classList.add("is-deep-linked");
      transfer.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    } else setMessage("Bağlantıdaki transfer mevcut filtrede bulunamadı.", "error");
  }
  if (String(intent.workforce || "") === "shipments") {
    document.dispatchEvent(new CustomEvent("tahmisci:fatura:navigate", { detail: { view: "shipments", entityId: intent.entityId || "" } }));
  }
  return true;
}

export function handleStockClick() { return false; }
export function handleStockChange() { return false; }
export function handleStockSubmit() { return false; }

export function connectStockEvents() {
  // Canlı bağlantının tek sahibi Fatura kabuğundaki /api/events gateway'idir.
}

export function handleStockGatewayEvent(event = {}) {
  const topic = String(event.topic || "");
  if (!new Set(["inventory", "catalog"]).has(topic)) return false;
  const revision = Math.max(0, Number(event.revision || 0));
  if (topic === "catalog") {
    state.catalogRevision = Math.max(state.catalogRevision || 0, revision);
    state.catalogLoaded = false;
  } else {
    state.inventoryRevision = Math.max(state.inventoryRevision || 0, revision);
    state.revision = state.inventoryRevision;
  }
  state.stale = true;
  state.planningStale = true;
  clearTimeout(stockEventTimer);
  stockEventTimer = setTimeout(() => {
    if (activeSection() === "stock") loadAll({ force: true, reloadLocations: true }).catch(() => {});
  }, 180);
  return true;
}

export function disconnectStockEvents() {
  clearTimeout(stockEventTimer);
  stockEventTimer = null;
  if (state.inventoryController) state.inventoryController.abort();
  state.inventoryController = null;
  state.loadSequence += 1;
  state.loadPromise = null;
  if (stockKeydownHandler) document.removeEventListener("keydown", stockKeydownHandler);
  stockKeydownHandler = null;
  if (state.popstateHandler) window.removeEventListener("popstate", state.popstateHandler);
  state.popstateHandler = null;
  closeQuickDrawer({ restoreFocus: false });
  state.bound = false;
  state.boundWorkspace = null;
}

export function invalidateStockState() {
  state.stale = true;
  state.planningStale = true;
}

export function resetStockState() {
  disconnectStockEvents();
  state.revision = 0;
  state.inventoryRevision = 0;
  state.catalogRevision = 0;
  state.locations = [];
  state.personnel = [];
  state.unitDefinitions = { base: [], bulk: [] };
  state.balances = [];
  state.transfers = [];
  state.transferLocations = [];
  state.movements = [];
  state.counts = [];
  state.activeCount = null;
  state.thresholdInitial = null;
  state.pendingUnitMigration = null;
  state.loaded = false;
  state.stale = true;
  state.bound = false;
  state.boundWorkspace = null;
  state.catalogStock = null;
  state.catalogLoaded = false;
  state.catalogLoading = false;
  state.catalogCategoryId = "";
  state.catalogProductId = "";
  state.catalogBusy = false;
  state.planning = null;
  state.planningStale = true;
  state.planningError = "";
  state.planningLoadPromise = null;
  state.activeAccordion = "";
  state.quickDrawerReturnFocus = null;
  state.popstateHandler = null;
}
