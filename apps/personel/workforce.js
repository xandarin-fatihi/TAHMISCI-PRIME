(() => {
  "use strict";

  const PREVIEW_TOKEN = readPreviewToken();
  const UNITS = ["koli", "paket", "adet", "kg", "gr", "litre", "ml", "şişe"];
  const state = {
    section: "",
    data: emptyData(),
    cart: [],
    shipmentCategory: "all",
    shipmentQuery: "",
    taskPriority: "all",
    taskStatus: "active",
    openTaskId: "",
    weekStart: startOfWeek(new Date()),
    shipmentNote: "",
    shipmentRequestId: "",
    shiftRequestId: "",
    shiftRequestDraft: {
      date: "",
      type: "leave",
      startTime: "",
      endTime: "",
      description: ""
    },
    revision: 0,
    busy: false,
    loaded: false,
    loadedScopes: new Set(),
    staleScopes: new Set(),
    loadPromises: new Map(),
    pollingTimer: null,
    gatewayBound: false,
    clientId: createRequestId("personel-workforce-events"),
    sessionEnded: true,
    sessionEndNotified: false
  };

  function operationSkipped(reason) {
    const factory = window.TahmisciOperationResults && window.TahmisciOperationResults.skipped;
    return typeof factory === "function"
      ? factory(reason)
      : { operationOutcome: "skipped", reason: String(reason || "") };
  }

  function runImmediateOperation(key, button, operation) {
    const coordinator = window.TahmisciOperations;
    const promise = !coordinator || typeof coordinator.run !== "function"
      ? Promise.resolve().then(operation)
      : coordinator.run(`personel-workforce:${key}`, operation, {
        button,
        classification: window.TahmisciOperationClasses && window.TahmisciOperationClasses.IMMEDIATE || "immediate-operation"
      });
    return promise.catch(() => undefined);
  }

  function mount() {
    if (window.__tahmisciPersonelWorkforceMounted) return;
    window.__tahmisciPersonelWorkforceMounted = true;
    document.addEventListener("personel:section-change", (event) => {
      const section = event.detail && event.detail.section;
      if (["tasks", "shipment", "shift"].includes(section)) {
        connectWorkforceEvents();
        openSection(section);
      } else {
        pauseWorkforceEvents();
      }
    });
    document.addEventListener("personel:session-started", handleSessionStarted);
    document.addEventListener("personel:session-ended", handleSessionEnded);
    document.addEventListener("personel:stock-updated", handleStockUpdated);
    document.addEventListener("personel:gateway-status", handleGatewayStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  function handleSessionStarted() {
    state.sessionEnded = false;
    state.sessionEndNotified = false;
    state.loaded = false;
    state.loadedScopes.clear();
    state.staleScopes.clear();
    state.loadPromises.clear();
  }

  function handleSessionEnded() {
    state.sessionEnded = true;
    state.sessionEndNotified = true;
    state.loaded = false;
    state.loadedScopes.clear();
    state.staleScopes.clear();
    state.loadPromises.clear();
    stopWorkforceEvents();
  }

  function startFallbackPolling() {
    if (state.pollingTimer || state.sessionEnded || document.hidden) return;
    state.pollingTimer = window.setInterval(pollWorkforce, 120000);
  }

  function stopPolling() {
    if (!state.pollingTimer) return;
    window.clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }

  function connectWorkforceEvents() {
    if (state.sessionEnded || PREVIEW_TOKEN || document.hidden || !window.EventSource) {
      if (!window.EventSource) startFallbackPolling();
      return;
    }
    stopPolling();
    if (state.gatewayBound) return;
    state.gatewayBound = true;
    document.addEventListener("personel:gateway-event", handleWorkforceGatewayEvent);
  }

  function handleWorkforceGatewayEvent(event) {
    if (state.sessionEnded) return;
    const payload = event && event.detail || {};
    if (payload.topic !== "workforce" && payload.topic !== "shipment") return;
    const incomingRevision = responseRevision(payload, state.revision);
    if (incomingRevision && incomingRevision <= state.revision) return;
    state.revision = Math.max(state.revision, incomingRevision);
    state.loadedScopes.forEach((scope) => state.staleScopes.add(scope));
    const activeScope = scopeForSection(state.section);
    if (["tasks", "shipment", "shift"].includes(state.section) && !state.busy && !isEditingWorkforce()) {
      state.staleScopes.add(activeScope);
      openSection(state.section, { silent: true }).catch(() => {});
    }
  }

  function stopWorkforceEvents() {
    pauseWorkforceEvents();
  }

  function pauseWorkforceEvents() {
    stopPolling();
    state.loadedScopes.forEach((scope) => state.staleScopes.add(scope));
  }

  async function pollWorkforce() {
    if (state.sessionEnded) return;
    const editing = document.activeElement && document.activeElement.closest(".workforce-section");
    if (!document.hidden && !editing && ["tasks", "shipment", "shift"].includes(state.section) && !state.busy) {
      try {
        const status = await api("/api/workforce/me?scope=revision");
        const incomingRevision = responseRevision(status, state.revision);
        if (incomingRevision > state.revision) {
          state.revision = incomingRevision;
          state.staleScopes.add(scopeForSection(state.section));
          await openSection(state.section, { silent: true });
        }
      } catch (_error) {}
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopPolling();
      return;
    }
    connectWorkforceEvents();
    if (!window.EventSource) startFallbackPolling();
    if (!state.sessionEnded && state.staleScopes.has(scopeForSection(state.section)) && !state.busy) openSection(state.section, { silent: true });
  }

  function handleGatewayStatus(event) {
    if (state.sessionEnded) return;
    if (event && event.detail && event.detail.connected) stopPolling();
    else if (["tasks", "shipment", "shift"].includes(state.section)) startFallbackPolling();
  }

  function handleStockUpdated(event) {
    const stockState = event && event.detail && event.detail.stockState;
    if (!stockState || state.sessionEnded) return;
    state.data.stockState = normalizeStockState(stockState);
    pruneUnavailableCartLines();
    if (state.section === "shipment" && !isEditingWorkforce()) renderShipment();
  }

  function isEditingWorkforce() {
    return Boolean(document.activeElement && document.activeElement.closest && document.activeElement.closest(".workforce-section"));
  }

  function notifySessionEnded(error) {
    if (state.sessionEndNotified) return;
    state.sessionEnded = true;
    state.sessionEndNotified = true;
    state.loaded = false;
    stopWorkforceEvents();
    document.dispatchEvent(new CustomEvent("personel:session-ended", {
      detail: {
        source: "workforce",
        status: Number(error && error.status || 0),
        message: error && error.message || "Oturumunuz sona erdi. Lütfen yeniden giriş yapın."
      }
    }));
  }

  async function openSection(section, options = {}) {
    if (state.sessionEnded) return;
    state.section = section;
    const scope = scopeForSection(section);
    const alreadyLoaded = state.loadedScopes.has(scope) && !state.staleScopes.has(scope);
    if (alreadyLoaded) {
      render(section);
      return;
    }
    if (state.loaded) render(section);
    else if (!options.silent) renderLoading(section);
    try {
      await loadWorkforceData(section);
      if (state.section !== section) return;
      render(section);
    } catch (error) {
      if (!state.loaded) renderError(section, error.message);
      else showMessage(section, error.message, "error");
    }
  }

  function scopeForSection(section) {
    return section === "shipment" ? "shipments" : section === "shift" ? "shift" : "tasks";
  }

  function requestScopesForSection(section) {
    return section === "shipment" ? "shipments,stock" : scopeForSection(section);
  }

  async function loadWorkforceData(section = state.section, options = {}) {
    if (state.sessionEnded) return Promise.reject(Object.assign(new Error("Personel oturumu gerekli."), { status: 401 }));
    const scope = scopeForSection(section);
    if (!options.force && state.loadedScopes.has(scope) && !state.staleScopes.has(scope)) return state.data;
    if (state.loadPromises.has(scope)) return state.loadPromises.get(scope);
    const query = new URLSearchParams({ scope: requestScopesForSection(section) });
    const promise = api(`/api/workforce/me?${query.toString()}`)
      .then((result) => {
        mergeWorkforceData(result);
        state.revision = responseRevision(result, state.revision);
        pruneUnavailableCartLines();
        state.loaded = true;
        state.loadedScopes.add(scope);
        state.staleScopes.delete(scope);
        return state.data;
      })
      .finally(() => {
        state.loadPromises.delete(scope);
      });
    state.loadPromises.set(scope, promise);
    return promise;
  }

  function emptyData() {
    return {
      tasks: [],
      shipments: [],
      shiftRequests: [],
      shiftPlans: [],
      shiftSettings: {
        morning: { startTime: "08:00", endTime: "16:00" },
        evening: { startTime: "16:00", endTime: "00:00" }
      },
      stockState: { products: [], categories: [] },
      revision: 0
    };
  }

  function normalizeData(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      tasks: Array.isArray(source.tasks) ? source.tasks : [],
      shipments: Array.isArray(source.shipments) ? source.shipments : [],
      shiftRequests: Array.isArray(source.shiftRequests) ? source.shiftRequests : [],
      shiftPlans: Array.isArray(source.shiftPlans) ? source.shiftPlans : [],
      shiftSettings: source.shiftSettings && typeof source.shiftSettings === "object"
        ? source.shiftSettings
        : emptyData().shiftSettings,
      stockState: normalizeStockState(source.stockState),
      revision: responseRevision(source, state.revision)
    };
  }

  function mergeWorkforceData(value) {
    const source = value && typeof value === "object" ? value : {};
    if (Array.isArray(source.tasks)) state.data.tasks = source.tasks;
    if (Array.isArray(source.shipments)) state.data.shipments = source.shipments;
    if (Array.isArray(source.shiftRequests)) state.data.shiftRequests = source.shiftRequests;
    if (Array.isArray(source.shiftPlans)) state.data.shiftPlans = source.shiftPlans;
    if (source.shiftSettings && typeof source.shiftSettings === "object") state.data.shiftSettings = source.shiftSettings;
    if (source.stockState && typeof source.stockState === "object") state.data.stockState = normalizeStockState(source.stockState);
    state.data.revision = responseRevision(source, state.data.revision);
  }

  function normalizeStockState(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      products: Array.isArray(source.products) ? source.products : [],
      categories: Array.isArray(source.categories) ? source.categories : []
    };
  }

  function render(section) {
    if (section === "tasks") renderTasks();
    if (section === "shipment") renderShipment();
    if (section === "shift") renderShift();
  }

  function panel(section) {
    return document.getElementById(`section${section.charAt(0).toUpperCase()}${section.slice(1)}`);
  }

  function renderLoading(section) {
    const root = panel(section);
    if (!root) return;
    root.innerHTML = `<div class="wf-loading">${icon("loader")}<span>Veriler yükleniyor…</span></div>`;
  }

  function renderError(section, message) {
    const root = panel(section);
    if (!root) return;
    root.innerHTML = `
      <div class="wf-state wf-state-error">
        ${icon("alert")}
        <h2>Veriler yüklenemedi</h2>
        <p>${escapeHTML(message || "Lütfen yeniden deneyin.")}</p>
        <button class="wf-button wf-button-primary ui-button ui-button--primary" type="button" data-retry>Yeniden Dene</button>
      </div>`;
    root.querySelector("[data-retry]").addEventListener("click", () => openSection(section));
  }

  function renderTasks() {
    const root = panel("tasks");
    if (!root) return;
    const tasks = state.data.tasks.slice().sort((a, b) => dueSort(a) - dueSort(b));
    const today = localDateKey(new Date());
    const completed = tasks.filter((task) => isCompletedStatus(assignment(task).status)).length;
    const todayCount = tasks.filter((task) => task.dueDate && String(task.dueDate).slice(0, 10) === today && isTaskActive(task)).length;
    const approaching = tasks.filter((task) => {
      const days = dueDays(task.dueDate);
      return isTaskActive(task) && days >= 0 && days <= 2;
    }).length;
    const visible = tasks.filter((task) => {
      if (state.taskStatus === "active" && !isTaskActive(task)) return false;
      if (state.taskStatus === "today" && !(isTaskActive(task) && String(task.dueDate || "").slice(0, 10) === today)) return false;
      if (state.taskStatus === "priority" && !(isTaskActive(task) && ["high", "urgent", "yüksek", "acil"].includes(String(task.priority || "").toLocaleLowerCase("tr-TR")))) return false;
      if (state.taskStatus === "completed" && !isCompletedStatus(assignment(task).status)) return false;
      if (state.taskStatus === "cancelled" && !isCancelledTask(task)) return false;
      return state.taskPriority === "all" || priorityMeta(task.priority).key === state.taskPriority;
    });
    const todaysPlan = tasks.filter((task) => {
      const due = String(task.dueDate || "").slice(0, 10);
      return due === today && isTaskActive(task);
    });
    const managerNotes = tasks
      .map((task) => ({ task, note: task.managerNote || task.adminNote || assignment(task).managerNote || "" }))
      .filter((entry) => entry.note);

    root.innerHTML = `
      <div class="workforce-stats">
        ${statCard("clipboard", "Bugün", todayCount, "görev")}
        ${statCard("check", "Tamamlanan", completed, "görev")}
        ${statCard("clock", "Teslim tarihi yaklaşan", approaching, "görev")}
      </div>
      <div class="wf-task-shell">
        <section class="wf-task-main">
          <div class="wf-section-heading">
            <h2>Görevlerim</h2>
            <div class="wf-filters">
              <label><span class="sr-only">Öncelik</span>
                <select id="wfTaskPriority">
                  <option value="all">Tüm öncelikler</option>
                  <option value="urgent">Acil</option>
                  <option value="high">Yüksek öncelik</option>
                  <option value="normal">Normal öncelik</option>
                  <option value="low">Düşük öncelik</option>
                </select>
              </label>
              <label><span class="sr-only">Durum</span>
                <select id="wfTaskStatus">
                  <option value="active">Aktif görevler</option>
                  <option value="today">Bugünkü görevler</option>
                  <option value="priority">Öncelikli görevler</option>
                  <option value="completed">Tamamlananlar</option>
                  <option value="cancelled">İptal edilenler</option>
                  <option value="all">Tüm görevler</option>
                </select>
              </label>
            </div>
          </div>
          <div class="wf-task-list">
            ${visible.length ? visible.map(taskCard).join("") : emptyState("clipboard", "Bu filtreye uygun görev bulunmuyor.", "Yeni bir görev atandığında burada görünecek.")}
          </div>
        </section>
        <aside class="wf-task-aside">
          <article class="wf-side-card">
            <div class="wf-card-title">${icon("calendar")}<h2>Bugünün Planı</h2></div>
            ${todaysPlan.length ? `<div class="wf-timeline">${todaysPlan.map((task, index) => `
              <div><span>${String(index + 1).padStart(2, "0")}</span><i></i><p>${escapeHTML(task.title)}</p></div>`).join("")}</div>` : `<p class="wf-muted">Bugün teslim edilecek aktif göreviniz yok.</p>`}
          </article>
          <article class="wf-side-card">
            <div class="wf-card-title">${icon("note")}<h2>Yönetici Notu</h2></div>
            ${managerNotes.length ? `<div class="wf-manager-notes">${managerNotes.slice(0, 4).map(({ task, note }) => `<p><b>${escapeHTML(task.title || "Görev")}</b><span>${escapeHTML(note)}</span></p>`).join("")}</div>` : `<p class="wf-muted">Yönetici notu paylaşılmadı. Görev açıklamalarını ve maddelerini takip edebilirsiniz.</p>`}
          </article>
        </aside>
      </div>`;

    const prioritySelect = root.querySelector("#wfTaskPriority");
    const statusSelect = root.querySelector("#wfTaskStatus");
    prioritySelect.value = state.taskPriority;
    statusSelect.value = state.taskStatus;
    prioritySelect.addEventListener("change", () => {
      state.taskPriority = prioritySelect.value;
      renderTasks();
    });
    statusSelect.addEventListener("change", () => {
      state.taskStatus = statusSelect.value;
      renderTasks();
    });
    root.querySelectorAll("[data-task-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        state.openTaskId = state.openTaskId === button.dataset.taskToggle ? "" : button.dataset.taskToggle;
        renderTasks();
      });
    });
    root.querySelectorAll("[data-task-item]").forEach((input) => {
      input.addEventListener("change", () => updateTaskItem(input));
    });
  }

  function taskCard(task) {
    const a = assignment(task);
    const percent = Number.isFinite(Number(a.percent)) ? Number(a.percent) : calculatePercent(task, a);
    const isOpen = state.openTaskId === task.id;
    const due = dueMeta(task.dueDate, a.status);
    const priority = priorityMeta(task.priority);
    const complete = isCompletedStatus(a.status);
    const cancelled = isCancelledTask(task);
    return `
      <article class="wf-task-card ${complete ? "is-complete" : ""} ${cancelled ? "is-cancelled" : ""}">
        <button class="wf-task-summary" type="button" data-task-toggle="${escapeAttribute(task.id)}" aria-expanded="${isOpen}">
          <span class="wf-task-check">${complete ? icon("check") : icon("clipboard")}</span>
          <span class="wf-task-copy">
            <span class="wf-priority wf-priority-${priority.key}"><i></i>${priority.label}</span>
            <strong>${escapeHTML(task.title || "İsimsiz görev")}</strong>
            <small>${escapeHTML(task.description || "Açıklama eklenmedi.")}</small>
          </span>
          <span class="wf-task-meta">
            <span class="wf-due ${due.className}">${icon("calendar")}<span><small>Teslim tarihi</small><b>${escapeHTML(due.label)}</b></span></span>
            <span class="wf-progress"><i><b style="width:${clamp(percent, 0, 100)}%"></b></i><em>%${clamp(percent, 0, 100)}</em></span>
          </span>
          <span class="wf-chevron">${icon("chevron")}</span>
        </button>
        <div class="wf-task-detail" ${isOpen ? "" : "hidden"}>
          <div class="wf-task-items">
            ${(task.items || []).map((item) => {
              const checked = (a.completedItemIds || []).includes(item.id);
              return `<label class="${checked ? "is-checked" : ""}">
                <input type="checkbox" data-task-item data-task-id="${escapeAttribute(task.id)}" data-item-id="${escapeAttribute(item.id)}" ${checked ? "checked" : ""} ${cancelled ? "disabled" : ""}>
                <span>${icon("check")}</span><b>${escapeHTML(item.text || item.title || "")}</b>
              </label>`;
            }).join("") || `<p class="wf-muted">Görev maddesi bulunmuyor.</p>`}
          </div>
          ${(task.managerNote || task.adminNote || a.managerNote) ? `<p class="wf-admin-note">Yönetici notu: ${escapeHTML(task.managerNote || task.adminNote || a.managerNote)}</p>` : ""}
          <p class="wf-task-status">${statusLabel(a.status)} · ${clamp(percent, 0, 100)}% tamamlandı</p>
        </div>
      </article>`;
  }

  async function updateTaskItem(input) {
    const completed = input.checked;
    input.checked = !completed;
    input.disabled = true;
    clearMessage("tasks");
    try {
      const request = mutationRequest({ completed });
      const result = await api(`/api/workforce/tasks/${encodeURIComponent(input.dataset.taskId)}/items/${encodeURIComponent(input.dataset.itemId)}`, {
        method: "PATCH",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      await refreshWorkforceData();
      renderTasks();
      showMessage("tasks", "Görev ilerlemeniz kaydedildi.", "success");
    } catch (error) {
      input.disabled = false;
      showMutationError("tasks", error);
    }
  }

  function renderShipment() {
    const root = panel("shipment");
    if (!root) return;
    const products = state.data.stockState.products.filter(isAvailableStockProduct).sort(orderSort);
    const availableCategoryIds = new Set(products.map((product) => String(product.categoryId)));
    const categories = state.data.stockState.categories
      .filter((category) => category.active !== false && category.sourcePresent !== false && availableCategoryIds.has(String(category.id)))
      .sort(orderSort);
    const categoryMap = new Map(categories.map((category) => [String(category.id), category.name]));

    root.innerHTML = `
      <div class="wf-shipment-layout">
        <section class="wf-catalog-card">
          <label class="wf-search">${icon("search")}<input id="wfShipmentSearch" type="search" placeholder="Stokta ürün ara…" autocomplete="off"></label>
          <div class="wf-chips" id="wfShipmentCategories">
            <button class="${state.shipmentCategory === "all" ? "is-active" : ""}" type="button" data-category="all">Tümü</button>
            ${categories.map((category) => `<button class="${state.shipmentCategory === String(category.id) ? "is-active" : ""}" type="button" data-category="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</button>`).join("")}
          </div>
          <div class="wf-products" id="wfShipmentProducts"></div>
        </section>
        <aside class="wf-shipment-side">
          <article class="wf-cart-card">
            <div class="wf-card-title">${icon("cart")}<h2>Sevkiyat Sepeti</h2><span>${state.cart.length}</span></div>
            <div class="wf-cart-list" id="wfShipmentCart"></div>
            <p class="wf-cart-summary" id="wfShipmentSummary" aria-live="polite"></p>
            <div class="wf-cart-footer">
              <label class="wf-field">
                <span>Sevkiyat notu <small>(isteğe bağlı)</small></span>
                <textarea id="wfShipmentNote" maxlength="250" rows="2" placeholder="Yöneticiye kısa bir not ekleyin…"></textarea>
              </label>
              <div class="wf-info">${icon("info")}<span>Stok, yönetici onaylamadan güncellenmez.</span></div>
              <button class="wf-button wf-button-primary wf-button-block ui-button ui-button--primary ui-button--block" id="wfShipmentSend" type="button" data-operation-class="immediate-operation">${icon("send")}Yöneticiye Bildir</button>
            </div>
          </article>
          <article class="wf-history-card">
            <div class="wf-card-title">${icon("box")}<h2>Son Bildirimler</h2></div>
            <div class="wf-history-list">
              ${state.data.shipments.length ? state.data.shipments.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 7).map(shipmentHistory).join("") : emptyState("box", "Henüz sevkiyat bildirimi yok.", "Gönderdiğiniz bildirimler burada görünecek.")}
            </div>
          </article>
        </aside>
      </div>`;

    const search = root.querySelector("#wfShipmentSearch");
    const shipmentNote = root.querySelector("#wfShipmentNote");
    search.value = state.shipmentQuery;
    shipmentNote.value = state.shipmentNote;
    shipmentNote.addEventListener("input", () => { state.shipmentNote = shipmentNote.value; });
    const drawProducts = () => {
      const query = normalizeText(state.shipmentQuery);
      const visible = products.filter((product) => {
        const categoryName = categoryMap.get(String(product.categoryId)) || product.category || "";
        const categoryMatches = state.shipmentCategory === "all" || String(product.categoryId) === state.shipmentCategory;
        return categoryMatches && (!query || normalizeText(`${product.name} ${categoryName}`).includes(query));
      });
      root.querySelector("#wfShipmentProducts").innerHTML = visible.length
        ? visible.map((product) => productCard(product, categoryMap.get(String(product.categoryId)) || product.category || "Stok")).join("")
        : emptyState("search", "Ürün bulunamadı.", "Arama veya kategori filtrenizi değiştirin.");
      root.querySelectorAll("[data-add-product]").forEach((button) => {
        button.addEventListener("click", () => addToCart(products.find((product) => String(product.id) === button.dataset.addProduct)));
      });
    };
    search.addEventListener("input", () => {
      state.shipmentQuery = search.value.trim();
      drawProducts();
    });
    root.querySelector("#wfShipmentCategories").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.shipmentNote = shipmentNote.value;
      state.shipmentCategory = button.dataset.category;
      renderShipment();
    });
    root.querySelector("#wfShipmentSend").addEventListener("click", submitShipment);
    drawProducts();
    drawCart();
  }

  function productCard(product, categoryName) {
    const imageUrl = product.imageUrl || product.image || product.photoUrl || "";
    return `
      <article class="wf-product-card">
        <div class="wf-product-image">${imageUrl ? `<img src="${escapeAttribute(imageUrl)}" alt="">` : icon("box")}</div>
        <div class="wf-product-copy">
          <small>${escapeHTML(categoryName)}</small>
          <h3>${escapeHTML(product.name)}</h3>
          <p>Mevcut stok: <b>${formatNumber(product.stockQuantity)} ${escapeHTML(product.unit || "adet")}</b></p>
          ${caseInfo(product) ? `<em>${escapeHTML(caseInfo(product))}</em>` : ""}
        </div>
        <button class="wf-button wf-button-primary ui-button ui-button--primary" type="button" data-add-product="${escapeAttribute(product.id)}">${icon("plus")}Ekle</button>
      </article>`;
  }

  function addToCart(product) {
    if (!product) return;
    const productCode = String(product.productCode || "").trim().toUpperCase();
    const existing = state.cart.find((line) => (
      productCode && String(line.productCode || "").toUpperCase() === productCode
    ) || String(line.productId) === String(product.id));
    if (existing) {
      existing.quantity = roundNumber(Number(existing.quantity || 0) + 1);
    } else {
      state.cart.push({
        productId: product.id,
        productCode,
        stockProductCode: productCode,
        name: product.name,
        categoryId: product.categoryId,
        category: product.category || (state.data.stockState.categories || []).find((category) => String(category.id) === String(product.categoryId))?.name || "Stok",
        quantity: 1,
        unit: supportedUnits(product)[0],
        baseUnit: normalizeUnit(product.unit || "adet"),
        caseText: caseInfo(product)
      });
    }
    drawCart();
    showMessage("shipment", existing ? "Ürün mevcut sepet satırına eklendi." : "Ürün sepete eklendi.", "success");
  }

  function drawCart() {
    const root = panel("shipment");
    const cartRoot = root && root.querySelector("#wfShipmentCart");
    if (!cartRoot) return;
    cartRoot.innerHTML = state.cart.length ? state.cart.map((line) => {
      const product = findAvailableStockProduct(line);
      const units = supportedUnits(product || { unit: line.baseUnit });
      if (!units.includes(line.unit)) line.unit = units[0];
      const conversion = lineConversion(line, product);
      return `
        <div class="wf-cart-line">
          <div class="wf-cart-product">
            <span>${icon("box")}</span>
            <div><b>${escapeHTML(line.name)}</b><small>${escapeHTML(line.category || "Stok")} · Temel birim: ${escapeHTML(line.baseUnit)}</small></div>
            <button type="button" data-remove-line="${escapeAttribute(line.productId)}" aria-label="${escapeAttribute(line.name)} ürününü sepetten kaldır">${icon("close")}</button>
          </div>
          <div class="wf-cart-controls">
            <label><span>Miktar</span><input data-line-quantity="${escapeAttribute(line.productId)}" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeAttribute(line.quantity)}"></label>
            <label><span>Birim</span><select data-line-unit="${escapeAttribute(line.productId)}">${units.map((unit) => `<option value="${unit}" ${line.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label>
          </div>
          ${line.unit === "koli" && line.caseText ? `<p class="wf-case-info">${icon("info")}${escapeHTML(line.caseText)}</p>` : ""}
          <p class="wf-line-conversion">${icon("check")}${escapeHTML(conversion)}</p>
        </div>`;
    }).join("") : emptyState("cart", "Sepetiniz boş.", "Soldaki stok ürünlerinden ekleyebilirsiniz.");

    cartRoot.querySelectorAll("[data-line-quantity]").forEach((input) => {
      input.addEventListener("change", () => {
        const line = state.cart.find((item) => String(item.productId) === input.dataset.lineQuantity);
        const value = Number(input.value);
        if (!line || !Number.isFinite(value) || value <= 0) {
          input.value = line ? line.quantity : 1;
          showMessage("shipment", "Miktar sıfırdan büyük olmalıdır.", "error");
          return;
        }
        line.quantity = roundNumber(value);
        drawCart();
      });
    });
    cartRoot.querySelectorAll("[data-line-unit]").forEach((select) => {
      select.addEventListener("change", () => {
        const line = state.cart.find((item) => String(item.productId) === select.dataset.lineUnit);
        if (line) line.unit = select.value;
        drawCart();
      });
    });
    cartRoot.querySelectorAll("[data-remove-line]").forEach((button) => {
      button.addEventListener("click", () => {
        state.cart = state.cart.filter((line) => String(line.productId) !== button.dataset.removeLine);
        drawCart();
      });
    });
    const count = root.querySelector(".wf-cart-card .wf-card-title > span");
    if (count) count.textContent = String(state.cart.length);
    const summary = root.querySelector("#wfShipmentSummary");
    if (summary) {
      const total = state.cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      summary.textContent = state.cart.length
        ? `${state.cart.length} farklı ürün · Girilen toplam miktar ${formatNumber(total)}`
        : "Sepete henüz ürün eklenmedi.";
    }
  }

  function submitShipment() {
    const button = panel("shipment")?.querySelector("#wfShipmentSend");
    return runImmediateOperation("shipment-notify", button, executeShipmentSubmit);
  }

  async function executeShipmentSubmit() {
    if (state.busy) return operationSkipped("busy");
    const invalid = state.cart.find((line) => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0);
    const unavailable = state.cart.find((line) => !findAvailableStockProduct(line));
    const invalidConversion = state.cart.find((line) => {
      try {
        convertLineToBase(line, findAvailableStockProduct(line));
        return false;
      } catch (_error) {
        return true;
      }
    });
    if (!state.cart.length) {
      showMessage("shipment", "Bildirim göndermek için sepete ürün ekleyin.", "error");
      return operationSkipped("validation");
    }
    if (invalid) {
      showMessage("shipment", "Tüm ürünler için geçerli bir miktar girin.", "error");
      return operationSkipped("validation");
    }
    if (unavailable) {
      showMessage("shipment", `${unavailable.name || "Seçilen ürün"} artık sevkiyat için kullanılamıyor. Sepeti kontrol edin.`, "error");
      return operationSkipped("validation");
    }
    if (invalidConversion) {
      showMessage("shipment", `${invalidConversion.name || "Seçilen ürün"} için miktar ve birim dönüşümünü kontrol edin.`, "error");
      return operationSkipped("validation");
    }
    const root = panel("shipment");
    const button = root.querySelector("#wfShipmentSend");
    state.shipmentNote = root.querySelector("#wfShipmentNote").value.trim();
    if (!state.shipmentRequestId) state.shipmentRequestId = createRequestId("shipment");
    const request = mutationRequest({
      items: state.cart.map((line) => ({
        productId: line.productId,
        productCode: line.productCode || "",
        stockProductCode: line.stockProductCode || line.productCode || "",
        quantity: Number(line.quantity),
        unit: line.unit
      })),
      note: state.shipmentNote
    }, state.shipmentRequestId);
    setBusy(button, true, "Gönderiliyor…");
    try {
      const result = await api("/api/workforce/shipments", {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      upsertShipment(result && result.shipment);
      state.cart = [];
      state.shipmentNote = "";
      state.shipmentRequestId = "";
      state.busy = false;
      renderShipment();
      showMessage("shipment", "Sevkiyat bildiriminiz yönetici onayına gönderildi.", "success");
      refreshShipmentInBackground();
      return result;
    } catch (error) {
      showMutationError("shipment", error);
      setBusy(button, false, "");
      throw error;
    }
  }

  function upsertShipment(shipment) {
    if (!shipment || !shipment.id) return;
    const shipmentId = String(shipment.id);
    state.data.shipments = [
      shipment,
      ...(state.data.shipments || []).filter((item) => String(item && item.id || "") !== shipmentId)
    ];
    state.data.revision = Math.max(Number(state.data.revision || 0), Number(state.revision || 0));
    state.loaded = true;
    state.loadedScopes.add("shipments");
    state.staleScopes.delete("shipments");
  }

  function refreshShipmentInBackground() {
    state.staleScopes.add("shipments");
    window.setTimeout(() => {
      if (state.sessionEnded) return;
      void loadWorkforceData("shipment", { force: true }).catch(() => null);
    }, 250);
  }

  function shipmentHistory(shipment) {
    const status = statusMeta(shipment.status);
    const total = (shipment.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return `
      <div class="wf-history-row">
        <span>${icon("box")}</span>
        <div><b>${formatDateTime(shipment.createdAt)}</b><small>${(shipment.items || []).length} ürün · Toplam ${formatNumber(total)} birim</small>${shipment.adminNote || shipment.rejectionReason ? `<small class="wf-admin-note">Yönetici notu: ${escapeHTML(shipment.adminNote || shipment.rejectionReason)}</small>` : ""}</div>
        <em class="${status.className}">${status.label}</em>
      </div>`;
  }

  function renderShift() {
    const root = panel("shift");
    if (!root) return;
    const weekStartKey = localDateKey(state.weekStart);
    const days = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
    const plans = state.data.shiftPlans.filter((plan) => {
      const planWeek = plan.weekStart ? String(plan.weekStart).slice(0, 10) : localDateKey(startOfWeek(new Date(`${plan.date}T12:00:00`)));
      return planWeek === weekStartKey;
    });

    root.innerHTML = `
      <div class="wf-shift-head">
        <div class="wf-week-summary">
          <strong>${formatWeekRange(state.weekStart)}</strong>
          <span>Yayınlanmış haftalık vardiya planı</span>
        </div>
        <div class="wf-week-controls">
          <button type="button" data-week="-1" aria-label="Önceki hafta">${icon("arrow-left")}</button>
          <button type="button" data-week="today">${icon("calendar")}<span>Bu hafta</span></button>
          <button type="button" data-week="1" aria-label="Sonraki hafta">${icon("arrow-right")}</button>
        </div>
      </div>
      <div class="wf-days">
        ${days.map((day) => shiftDayCard(day, plans.find((plan) => String(plan.date).slice(0, 10) === localDateKey(day)))).join("")}
      </div>
      <div class="wf-shift-layout">
        <form class="wf-request-card" id="wfShiftForm">
          <div class="wf-card-title">${icon("calendar")}<h2>Vardiya / İzin Talebi</h2></div>
          <label class="wf-field"><span>Tarih</span><input name="date" type="date" min="${localDateKey(new Date())}" required></label>
          <fieldset class="wf-request-types">
            <legend>Talep türü</legend>
            ${requestTypeChoice("leave", "umbrella", "İzin isteği", true)}
            ${requestTypeChoice("morning", "sun", "Sabah tercihi")}
            ${requestTypeChoice("evening", "moon", "Akşam tercihi")}
            ${requestTypeChoice("custom", "clock", "Belirli saatler")}
          </fieldset>
          <div class="wf-custom-times" id="wfCustomTimes" hidden>
            <label class="wf-field"><span>Başlangıç saati</span><input name="startTime" type="time"></label>
            <i>—</i>
            <label class="wf-field"><span>Bitiş saati</span><input name="endTime" type="time"></label>
          </div>
          <label class="wf-field"><span>Açıklama <small>(isteğe bağlı)</small></span><textarea name="description" maxlength="250" rows="4" placeholder="Açıklamanızı buraya yazabilirsiniz…"></textarea><small class="wf-counter"><b>0</b>/250</small></label>
          <button class="wf-button wf-button-primary wf-request-submit ui-button ui-button--primary" type="submit" data-operation-class="immediate-operation">${icon("send")}Talebi Gönder</button>
        </form>
        <aside class="wf-requests-card">
          <div class="wf-card-title">${icon("document")}<h2>Gönderdiğim Talepler</h2></div>
          <div class="wf-request-list">
            ${state.data.shiftRequests.length ? state.data.shiftRequests.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).map(requestCard).join("") : emptyState("document", "Henüz talebiniz yok.", "Yeni talepleriniz burada görünecek.")}
          </div>
          <div class="wf-info wf-info-plain">${icon("info")}<span>Onaylanan tercihler plan hazırlanırken yönetici tarafından dikkate alınır; yayınlanan vardiyayı doğrudan değiştirmez.</span></div>
        </aside>
      </div>`;

    root.querySelectorAll("[data-week]").forEach((button) => {
      button.addEventListener("click", () => {
        state.weekStart = button.dataset.week === "today" ? startOfWeek(new Date()) : addDays(state.weekStart, Number(button.dataset.week) * 7);
        renderShift();
      });
    });

    const form = root.querySelector("#wfShiftForm");
    const customTimes = root.querySelector("#wfCustomTimes");
    const description = form.elements.description;
    const draft = state.shiftRequestDraft;
    form.elements.date.value = draft.date || "";
    const draftType = form.querySelector(`[name="type"][value="${CSS.escape(draft.type || "leave")}"]`);
    if (draftType) draftType.checked = true;
    form.elements.startTime.value = draft.startTime || "";
    form.elements.endTime.value = draft.endTime || "";
    description.value = draft.description || "";
    const setCustomVisibility = () => {
      const custom = form.elements.type.value === "custom";
      customTimes.hidden = !custom;
      form.elements.startTime.required = custom;
      form.elements.endTime.required = custom;
    };
    const captureDraft = () => {
      state.shiftRequestDraft = {
        date: form.elements.date.value,
        type: form.elements.type.value,
        startTime: form.elements.startTime.value,
        endTime: form.elements.endTime.value,
        description: description.value
      };
    };
    form.querySelectorAll("input, textarea").forEach((input) => input.addEventListener("input", captureDraft));
    form.querySelectorAll("[name=type]").forEach((input) => input.addEventListener("change", () => {
      setCustomVisibility();
      captureDraft();
    }));
    description.addEventListener("input", () => {
      form.querySelector(".wf-counter b").textContent = String(description.value.length);
    });
    form.querySelector(".wf-counter b").textContent = String(description.value.length);
    setCustomVisibility();
    form.addEventListener("submit", submitShiftRequest);
    root.querySelectorAll("[data-cancel-request]").forEach((button) => {
      button.addEventListener("click", () => cancelShiftRequest(button));
    });
  }

  function shiftDayCard(day, plan) {
    const current = localDateKey(day) === localDateKey(new Date());
    const meta = shiftMeta(plan && plan.type);
    return `
      <article class="wf-day-card ${current ? "is-today" : ""} ${plan ? `is-${meta.key}` : "is-empty"}">
        ${current ? `<em>Bugün</em>` : ""}
        <b>${capitalize(new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(day))}</b>
        <small>${new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(day)}</small>
        <span>${icon(meta.icon)}</span>
        ${plan ? `<strong>${plan.startTime && plan.endTime ? `${escapeHTML(plan.startTime)} – ${escapeHTML(plan.endTime)}` : meta.label}</strong><p>${meta.label}</p>` : `<strong>Plan yok</strong><p>Yayınlanmadı</p>`}
      </article>`;
  }

  function requestTypeChoice(value, iconName, label, checked) {
    return `<label><input type="radio" name="type" value="${value}" ${checked ? "checked" : ""}><span>${icon(iconName)}${label}</span></label>`;
  }

  function requestTimeLabel(request) {
    if (request.type === "leave") return "Tüm gün";
    if (request.startTime && request.endTime) return `${request.startTime} – ${request.endTime}`;
    const template = state.data.shiftSettings && state.data.shiftSettings[request.type];
    return template && template.startTime && template.endTime
      ? `${template.startTime} – ${template.endTime}`
      : "Saat tercihi";
  }

  function requestCard(request) {
    const status = statusMeta(request.status);
    const meta = shiftMeta(request.type);
    return `
      <article class="wf-request-row">
        <span class="wf-request-icon is-${meta.key}">${icon(meta.icon)}</span>
        <div>
          <h3>${meta.requestLabel}</h3>
          <p>${formatDate(request.date)} · ${escapeHTML(requestTimeLabel(request))}</p>
          ${request.description ? `<small>${escapeHTML(request.description)}</small>` : ""}
          ${request.adminNote ? `<small class="wf-admin-note">Yönetici notu: ${escapeHTML(request.adminNote)}</small>` : ""}
          <small>Gönderim: ${formatDateTime(request.createdAt)}${request.decidedAt ? ` · Karar: ${formatDateTime(request.decidedAt)}` : ""}</small>
        </div>
        <div class="wf-request-actions">
          <em class="${status.className}">${status.label}</em>
          ${request.status === "onay_bekliyor" ? `<button class="ui-button ui-button--danger ui-button--sm" type="button" data-cancel-request="${escapeAttribute(request.id)}" data-operation-class="immediate-operation">İptal et</button>` : ""}
        </div>
      </article>`;
  }

  function submitShiftRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    return runImmediateOperation("shift-request", form.querySelector("[type='submit']"), () => executeShiftRequestSubmit(event));
  }

  async function executeShiftRequestSubmit(event) {
    event.preventDefault();
    if (state.busy) return operationSkipped("busy");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    if (!payload.date || payload.date < localDateKey(new Date())) {
      showMessage("shift", "Geçmiş tarih için vardiya veya izin talebi oluşturulamaz.", "error");
      return operationSkipped("validation");
    }
    if (payload.type === "custom" && (!payload.startTime || !payload.endTime || payload.startTime >= payload.endTime)) {
      showMessage("shift", "Belirli saatler için geçerli bir başlangıç ve bitiş saati girin.", "error");
      return operationSkipped("validation");
    }
    if (payload.type !== "custom") {
      payload.startTime = "";
      payload.endTime = "";
    }
    payload.description = String(payload.description || "").trim().slice(0, 250);
    const button = form.querySelector("[type=submit]");
    if (!state.shiftRequestId) state.shiftRequestId = createRequestId("shift-request");
    const request = mutationRequest(payload, state.shiftRequestId);
    setBusy(button, true, "Gönderiliyor…");
    try {
      const result = await api("/api/workforce/shift-requests", {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      state.shiftRequestId = "";
      state.shiftRequestDraft = { date: "", type: "leave", startTime: "", endTime: "", description: "" };
      await refreshWorkforceData();
      state.busy = false;
      renderShift();
      showMessage("shift", "Talebiniz yönetici onayına gönderildi.", "success");
    } catch (error) {
      showMutationError("shift", error);
      setBusy(button, false, "");
      throw error;
    }
  }

  function cancelShiftRequest(button) {
    return runImmediateOperation(`shift-request-cancel:${button.dataset.cancelRequest}`, button, () => executeShiftRequestCancel(button));
  }

  async function executeShiftRequestCancel(button) {
    if (state.busy) return operationSkipped("busy");
    setBusy(button, true, "İptal ediliyor…");
    try {
      const request = mutationRequest({});
      const result = await api(`/api/workforce/shift-requests/${encodeURIComponent(button.dataset.cancelRequest)}`, {
        method: "DELETE",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      await refreshWorkforceData();
      state.busy = false;
      renderShift();
      showMessage("shift", "Talebiniz iptal edildi.", "success");
    } catch (error) {
      showMutationError("shift", error);
      setBusy(button, false, "");
      throw error;
    }
  }

  function statCard(iconName, label, value, suffix) {
    return `<article><span class="wf-stat-icon">${icon(iconName)}</span><div><p>${label}</p><b>${value}</b><small>${suffix}</small></div></article>`;
  }

  function emptyState(iconName, title, description) {
    return `<div class="workforce-empty">${icon(iconName)}<b>${title}</b><span>${description}</span></div>`;
  }

  function showMessage(section, message, type) {
    const root = panel(section);
    if (!root || !message) return;
    clearMessage(section);
    const node = document.createElement("div");
    node.className = `wf-toast is-${type || "info"}`;
    node.setAttribute("role", type === "error" ? "alert" : "status");
    node.innerHTML = `${icon(type === "error" ? "alert" : "check")}<span>${escapeHTML(message)}</span><button type="button" aria-label="Kapat">${icon("close")}</button>`;
    node.querySelector("button").addEventListener("click", () => node.remove());
    root.prepend(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function clearMessage(section) {
    panel(section)?.querySelectorAll(".wf-toast").forEach((node) => node.remove());
  }

  function setBusy(button, busy, label) {
    state.busy = busy;
    if (!button) return;
    if (!button.dataset.originalContent) button.dataset.originalContent = button.innerHTML;
    button.disabled = busy;
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
    button.innerHTML = busy ? `${icon("loader")}${escapeHTML(label)}` : button.dataset.originalContent;
    if (!busy) state.busy = false;
  }

  function createRequestId(prefix) {
    const value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function mutationRequest(body = {}, fixedRequestId = "") {
    const requestId = fixedRequestId || createRequestId("workforce");
    return {
      requestId,
      headers: {
        "Idempotency-Key": requestId,
        "X-Request-ID": requestId
      },
      body: {
        ...body,
        requestId,
        expectedRevision: Math.max(0, Number(state.revision || 0))
      }
    };
  }

  function responseRevision(result, fallback = 0) {
    const revision = Number(result && (result.revision ?? result.workforceRevision ?? (result.data && result.data.revision)));
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : Math.max(0, Number(fallback || 0));
  }

  async function refreshWorkforceData() {
    const scope = scopeForSection(state.section);
    state.staleScopes.add(scope);
    return loadWorkforceData(state.section, { force: true });
  }

  function showMutationError(section, error) {
    if (Number(error && error.status) === 409) {
      showMessage(section, `${error.message || "Çakışma oluştu."} Güncel veriler yeniden alındı; işlemi tekrar deneyin.`, "error");
      void refreshWorkforceData().then(() => {
        if (state.section === section && !isEditingWorkforce()) render(section);
      }).catch(() => null);
      return;
    }
    showMessage(section, error && error.message || "İşlem gerçekleştirilemedi.", "error");
  }

  function isCompletedStatus(status) {
    return ["completed", "tamamlandi", "tamamlandı"].includes(String(status || "").toLocaleLowerCase("tr-TR"));
  }

  function isCancelledTask(task) {
    const taskStatus = String(task && (task.workflowStatus || task.status) || "").toLocaleLowerCase("tr-TR");
    const assignmentStatus = String(assignment(task).status || "").toLocaleLowerCase("tr-TR");
    return ["cancelled", "iptal_edildi", "iptal edildi"].includes(taskStatus)
      || ["cancelled", "iptal_edildi", "iptal edildi"].includes(assignmentStatus);
  }

  function isTaskActive(task) {
    return !isCancelledTask(task) && !isCompletedStatus(assignment(task).status);
  }

  function isAvailableStockProduct(product) {
    return Boolean(product && product.active !== false && product.sourcePresent !== false && product.archived !== true);
  }

  function findAvailableStockProduct(line) {
    const code = String(line && (line.stockProductCode || line.productCode) || "").trim().toLocaleUpperCase("tr-TR");
    return (state.data.stockState.products || []).find((product) => isAvailableStockProduct(product) && (
      (code && String(product.productCode || "").trim().toLocaleUpperCase("tr-TR") === code)
      || String(product.id) === String(line && line.productId)
    ));
  }

  function pruneUnavailableCartLines() {
    state.cart = state.cart.filter((line) => Boolean(findAvailableStockProduct(line)));
  }

  function assignment(task) {
    return Array.isArray(task.assignments) && task.assignments[0] ? task.assignments[0] : { status: "pending", completedItemIds: [], percent: 0 };
  }

  function calculatePercent(task, a) {
    return task.items && task.items.length ? Math.round(((a.completedItemIds || []).length / task.items.length) * 100) : 0;
  }

  function priorityMeta(priority) {
    if (priority === "urgent") return { key: "urgent", label: "Acil" };
    if (priority === "high") return { key: "high", label: "Yüksek öncelik" };
    if (priority === "low") return { key: "low", label: "Düşük öncelik" };
    return { key: "normal", label: "Normal öncelik" };
  }

  function statusMeta(status) {
    if (status === "onaylandı" || status === "completed" || status === "published") return { label: "Onaylandı", className: "wf-status is-approved" };
    if (status === "reddedildi") return { label: "Reddedildi", className: "wf-status is-rejected" };
    if (status === "iptal_edildi") return { label: "İptal Edildi", className: "wf-status is-cancelled" };
    return { label: "Onay Bekliyor", className: "wf-status is-pending" };
  }

  function statusLabel(status) {
    if (status === "completed") return "Tamamlandı";
    if (status === "in_progress") return "Devam ediyor";
    if (status === "cancelled" || status === "iptal_edildi") return "İptal edildi";
    return "Bekliyor";
  }

  function shiftMeta(type) {
    if (type === "morning") return { key: "morning", label: "Sabah vardiyası", requestLabel: "Sabah tercihi", icon: "sun" };
    if (type === "evening") return { key: "evening", label: "Akşam vardiyası", requestLabel: "Akşam tercihi", icon: "moon" };
    if (type === "leave") return { key: "leave", label: "İzinli", requestLabel: "İzin isteği", icon: "umbrella" };
    if (type === "custom") return { key: "custom", label: "Belirli saatler", requestLabel: "Belirli saatler", icon: "clock" };
    return { key: "empty", label: "Plan yok", requestLabel: "Vardiya talebi", icon: "calendar" };
  }

  function dueMeta(value, status) {
    if (!value) return { label: "Belirtilmedi", className: "" };
    if (status === "completed") return { label: formatDate(value), className: "is-complete" };
    const days = dueDays(value);
    if (days < 0) return { label: "Süresi geçti", className: "is-overdue" };
    if (days === 0) return { label: "Bugün", className: "is-soon" };
    if (days === 1) return { label: "Yarın", className: "is-soon" };
    return { label: formatDate(value), className: "" };
  }

  function dueDays(value) {
    if (!value) return Infinity;
    const target = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    const today = new Date(`${localDateKey(new Date())}T12:00:00`);
    return Math.round((target - today) / 86400000);
  }

  function dueSort(task) {
    return task.dueDate ? Date.parse(task.dueDate) || Infinity : Infinity;
  }

  function caseInfo(product) {
    if (product.caseText) return product.caseText;
    const amount = product.unitsPerCase
      || product.caseSize
      || product.packageSize
      || product.packSize
      || product.piecesPerCase
      || product.piecesPerBox
      || product.unitsPerBox
      || product.packagePerCase
      || product.koliIci;
    if (!Number(amount)) return "";
    return `Koli içi ${formatNumber(amount)} ${product.caseUnit || product.unit || "adet"}`;
  }

  function normalizeUnit(value) {
    const unit = String(value || "").trim().toLocaleLowerCase("tr-TR");
    return {
      l: "litre",
      lt: "litre",
      liter: "litre",
      kilogram: "kg",
      gram: "gr",
      tane: "adet",
      kutu: "paket",
      sise: "şişe"
    }[unit] || (UNITS.includes(unit) ? unit : "adet");
  }

  function packageCount(product) {
    if (!product) return 0;
    const metadata = product.packageInfo;
    const raw = product.unitsPerCase
      ?? product.caseSize
      ?? product.packageSize
      ?? product.packSize
      ?? product.piecesPerCase
      ?? product.piecesPerBox
      ?? product.unitsPerBox
      ?? product.packagePerCase
      ?? product.koliIci
      ?? (metadata && typeof metadata === "object" ? metadata.unitsPerCase || metadata.quantity : metadata);
    const match = typeof raw === "number" ? raw : String(raw || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
    const number = Number(Array.isArray(match) ? match[0] : match);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function supportedUnits(product) {
    const base = normalizeUnit(product && product.unit || "adet");
    if (["kg", "gr"].includes(base)) return [base, base === "kg" ? "gr" : "kg"];
    if (["litre", "ml"].includes(base)) return [base, base === "litre" ? "ml" : "litre"];
    const count = packageCount(product);
    if (["paket", "adet", "şişe"].includes(base) && count) return [base, "koli"];
    if (base === "koli" && count) {
      const caseUnit = normalizeUnit(product && product.caseUnit || "adet");
      return caseUnit === "koli" ? [base] : [base, caseUnit];
    }
    return [base];
  }

  function convertLineToBase(line, product) {
    const quantity = Number(line && line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Geçerli miktar gerekli.");
    const requested = normalizeUnit(line && line.unit);
    const base = normalizeUnit(product && product.unit || line && line.baseUnit);
    if (requested === base) return { quantity: roundNumber(quantity), unit: base };
    const mass = { kg: 1000, gr: 1 };
    const volume = { litre: 1000, ml: 1 };
    if (mass[requested] && mass[base]) return { quantity: roundNumber(quantity * mass[requested] / mass[base]), unit: base };
    if (volume[requested] && volume[base]) return { quantity: roundNumber(quantity * volume[requested] / volume[base]), unit: base };
    const count = packageCount(product);
    if (requested === "koli" && count && ["paket", "adet", "şişe"].includes(base)) {
      return { quantity: roundNumber(quantity * count), unit: base };
    }
    if (base === "koli" && count && ["paket", "adet", "şişe"].includes(requested)) {
      return { quantity: roundNumber(quantity / count), unit: base };
    }
    throw new Error(`“${requested}” birimi “${base}” temel birimine dönüştürülemiyor.`);
  }

  function lineConversion(line, product) {
    try {
      const converted = convertLineToBase(line, product);
      return `${formatNumber(line.quantity)} ${line.unit} = ${formatNumber(converted.quantity)} ${converted.unit}`;
    } catch (error) {
      return error.message;
    }
  }

  function startOfWeek(value) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function addDays(value, amount) {
    const date = new Date(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function localDateKey(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    if (!value) return "Tarih belirtilmedi";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
  }

  function formatDateTime(value) {
    if (!value) return "Tarih belirtilmedi";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function formatWeekRange(start) {
    const end = addDays(start, 6);
    const startText = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: start.getMonth() === end.getMonth() ? undefined : "long" }).format(start);
    const endText = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(end);
    return `${startText} – ${endText}`;
  }

  function orderSort(a, b) {
    return Number(a.order || 0) - Number(b.order || 0);
  }

  function roundNumber(value) {
    return Math.round(value * 100) / 100;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function normalizeText(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (PREVIEW_TOKEN && method !== "GET") throw new Error("Önizleme modu salt okunurdur.");
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    const target = PREVIEW_TOKEN && String(path || "").startsWith("/api/workforce/me")
      ? appendPreviewToken(path)
      : path;
    const response = await fetch(target, Object.assign({}, options, { credentials: "include", headers }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İşlem gerçekleştirilemedi.");
      error.status = response.status;
      if (response.status === 401 || response.status === 403) notifySessionEnded(error);
      throw error;
    }
    return result;
  }

  function readPreviewToken() {
    try {
      return new URLSearchParams(window.location.search).get("previewToken") || "";
    } catch (_error) {
      return "";
    }
  }

  function appendPreviewToken(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("previewToken", PREVIEW_TOKEN);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
  }

  function icon(name) {
    const paths = {
      alert: `<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>`,
      "arrow-left": `<path d="m15 18-6-6 6-6"/>`,
      "arrow-right": `<path d="m9 18 6-6-6-6"/>`,
      box: `<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/>`,
      calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18"/>`,
      cart: `<path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.7L20 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>`,
      check: `<path d="m5 12 4 4L19 6"/>`,
      chevron: `<path d="m9 6 6 6-6 6"/>`,
      clipboard: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 10h6M9 14h6"/>`,
      clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
      close: `<path d="m6 6 12 12M18 6 6 18"/>`,
      document: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>`,
      info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>`,
      loader: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/>`,
      moon: `<path d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5Z"/>`,
      note: `<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>`,
      plus: `<path d="M12 5v14M5 12h14"/>`,
      search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>`,
      send: `<path d="m3 11 18-8-8 18-2-8zM11 13l10-10"/>`,
      sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
      umbrella: `<path d="M4 12a8 8 0 0 1 16 0c-2-1.5-4-1.5-6 0-2-1.5-4-1.5-6 0-1.4-1-2.7-1.3-4 0Z"/><path d="M12 12v6a2 2 0 0 0 4 0"/>`
    };
    return `<svg class="wf-icon wf-icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }
})();
