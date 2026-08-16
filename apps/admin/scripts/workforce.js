(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const icon = (name) => {
    const paths = {
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
      user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      package: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
      sparkles: '<path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3L12 3ZM5 15l-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15ZM19 14l-.6 1.4L17 16l1.4.6L19 18l.6-1.4L21 16l-1.4-.6L19 14Z"/>',
      chevronLeft: '<path d="m15 18-6-6 6-6"/>',
      chevronRight: '<path d="m9 18 6-6-6-6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>'
    };
    return `<svg class="wf-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
  };

  const state = {
    data: { users: [], tasks: [], shipments: [], shiftRequests: [], shiftPlans: [] },
    stock: { products: [] },
    tab: "shipments",
    selectedShipmentId: "",
    selectedTaskId: "",
    weekStart: mondayOf(new Date()),
    draftPlans: null,
    autoDraftProposal: null,
    selectedUsers: new Set(),
    targetType: "all",
    taskView: "all",
    shipmentView: "onay_bekliyor",
    taskItems: ["", ""],
    taskDraft: { title: "", description: "", priority: "normal", dueDate: "", dueTime: "", managerNote: "" },
    workforceRevision: 0,
    shiftRevision: 0,
    loaded: false,
    stale: true,
    loadPromise: null,
    eventSource: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    mounted: false,
    clientId: requestId("admin-workforce-events"),
    taskFormDirty: false,
    busy: false,
    templates: {
      morning: { startTime: "08:00", endTime: "16:00" },
      evening: { startTime: "16:00", endTime: "00:00" },
      custom: { startTime: "12:00", endTime: "20:00" }
    }
  };
  const refreshTokens = new Map();
  let activePreviewSection = "staffAccess";

  function requestId(prefix) {
    const suffix = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${suffix}`;
  }

  function mutationOptions(method, body, prefix) {
    const id = requestId(prefix);
    return {
      method,
      headers: { "Idempotency-Key": id, "X-Request-ID": id },
      body: JSON.stringify({ ...body, requestId: id, expectedRevision: state.workforceRevision })
    };
  }

  function acceptMutationResult(result) {
    const revision = Number(result && (result.revision ?? result.workforceRevision));
    if (Number.isInteger(revision) && revision >= 0) state.workforceRevision = revision;
    // Mutasyon sonrası sayaçlar ve stok etkisi yalnız backend'in güncel cevabından yeniden okunur.
    state.stale = true;
    return result;
  }

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
      : coordinator.run(`admin-workforce:${key}`, operation, {
        button,
        classification: window.TahmisciOperationClasses && window.TahmisciOperationClasses.IMMEDIATE || "immediate-operation"
      });
    return promise.catch(() => undefined);
  }

  async function api(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const configuredBase = String(window.TAHMISCI_BACKEND_URL || localStorage.getItem("tahmisci.backend.url") || "").replace(/\/+$/, "");
    const target = /^https?:\/\//i.test(url) ? url : `${configuredBase}${url}`;
    const response = await fetch(target, {
      credentials: "include",
      ...options,
      headers
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
      error.status = response.status;
      error.code = body.code || "";
      error.payload = body;
      throw error;
    }
    return body;
  }

  function dateValue(value) {
    if (!value) return "Tarih yok";
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "long", year: "numeric"
    }).format(parsed);
  }

  function dateTime(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(parsed);
  }

  function isoDate(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function mondayOf(value) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return isoDate(date);
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + amount);
    return isoDate(date);
  }

  function statusLabel(status) {
    return ({
      onay_bekliyor: "Onay Bekliyor", "onaylandı": "Onaylandı", reddedildi: "Reddedildi",
      iptal_edildi: "İptal Edildi",
      pending: "Bekliyor", in_progress: "Devam ediyor", completed: "Tamamlandı",
      atandi: "Atandı", devam_ediyor: "Devam Ediyor", tamamlandi: "Tamamlandı", gecikti: "Gecikti",
      active: "Aktif", archived: "Arşivde", published: "Yayınlandı", draft: "Taslak", cancelled: "İptal Edildi"
    })[status] || status || "Bekliyor";
  }

  function typeLabel(type) {
    return ({ morning: "Sabah", evening: "Akşam", leave: "İzinli", custom: "Belirli Saatler" })[type] || type || "Sabah";
  }

  function userName(id) {
    const user = (state.data.users || []).find((item) => String(item.id) === String(id));
    return user ? (user.name || user.username || "Personel") : "Personel";
  }

  function initials(name) {
    return String(name || "P").split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toLocaleUpperCase("tr-TR");
  }

  function showMessage(message, kind = "success") {
    let node = $("#workforceToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "workforceToast";
      node.className = "workforce-toast";
      node.setAttribute("role", "status");
      document.body.append(node);
    }
    node.className = `workforce-toast is-visible is-${kind}`;
    node.textContent = message;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => node.classList.remove("is-visible"), 3600);
  }

  function setBusy(busy) {
    state.busy = busy;
    const activeAction = busy && document.activeElement instanceof Element
      ? document.activeElement.closest("[data-workforce-action]")
      : null;
    $$("[data-workforce-action]").forEach((button) => {
      button.disabled = busy;
      const isActiveAction = Boolean(busy && activeAction === button);
      button.classList.toggle("is-busy", isActiveAction);
      if (isActiveAction) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
  }

  async function load(options = {}) {
    if (!options.force && state.loaded && !state.stale) return state.data;
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = loadFromBackend().finally(() => { state.loadPromise = null; });
    return state.loadPromise;
  }

  async function loadFromBackend() {
    const workforce = await api("/api/admin/workforce");
    state.data = {
      users: workforce.users || [],
      tasks: workforce.tasks || [],
      shipments: workforce.shipments || [],
      shiftRequests: workforce.shiftRequests || [],
      shiftPlans: workforce.shiftPlans || [],
      shiftPlanRevisions: workforce.shiftPlanRevisions || [],
      stats: workforce.stats || null,
      taskActivity: workforce.taskActivity || []
    };
    state.workforceRevision = Number(workforce.revision ?? workforce.workforceRevision ?? state.workforceRevision ?? 0);
    state.shiftRevision = Number(workforce.shiftRevision ?? workforce.publishRevision ?? state.shiftRevision ?? 0);
    if (workforce.shiftSettings) {
      state.templates.morning = { ...state.templates.morning, ...(workforce.shiftSettings.morning || {}) };
      state.templates.evening = { ...state.templates.evening, ...(workforce.shiftSettings.evening || {}) };
    }
    if (workforce.stockState) state.stock = workforce.stockState;
    else {
      let bridgedStock = null;
      try {
        const snapshot = window.TahmisciAdminBridge && typeof window.TahmisciAdminBridge.snapshot === "function"
          ? window.TahmisciAdminBridge.snapshot()
          : null;
        if (snapshot && snapshot.stockState && Array.isArray(snapshot.stockState.products) && snapshot.stockState.products.length) {
          bridgedStock = snapshot.stockState;
        }
      } catch (_error) {}
      if (bridgedStock) {
        state.stock = bridgedStock;
      } else {
        try {
          const stock = await api("/api/stock");
          state.stock = stock.stockState || state.stock;
        } catch (_error) {
          state.stock = { products: [] };
        }
      }
    }
    if (!state.selectedShipmentId) {
      state.selectedShipmentId = (state.data.shipments.find((item) => item.status === "onay_bekliyor") || state.data.shipments[0] || {}).id || "";
    }
    const persistedDrafts = state.data.shiftPlans.filter((plan) =>
      plan.weekStart === state.weekStart && plan.status === "draft"
    );
    state.draftPlans = persistedDrafts.length ? persistedDrafts : null;
    state.loaded = true;
    state.stale = false;
    return state.data;
  }

  function renderOverview() {
    const host = $("#staffOverviewGrid");
    if (!host) return;
    const users = state.data.users || [];
    const today = isoDate(new Date());
    const publishedToday = new Set((state.data.shiftPlans || [])
      .filter((item) => item.date === today && item.status === "published" && item.type !== "leave")
      .map((item) => item.personId));
    const pendingShiftRequests = (state.data.shiftRequests || []).filter((item) => item.status === "onay_bekliyor").length;
    const stats = state.data.stats || {};
    const cards = [
      ["users", "Toplam Personel", stats.totalPersonnel ?? users.length, "Kayıtlı personel"],
      ["user", "Aktif Personel", stats.activePersonnel ?? users.filter((item) => item.active !== false).length, "Çalışan personel"],
      ["calendar", "Bugünkü Vardiya", stats.todayShift ?? publishedToday.size, "Yayınlanmış vardiya"],
      ["clock", "Bekleyen Talep", stats.pendingShiftRequests ?? pendingShiftRequests, "Vardiya ve izin talepleri"]
    ];
    host.innerHTML = cards.map(([name, label, value, note]) => `
      <article class="workforce-stat-card">
        <span class="workforce-stat-icon">${icon(name)}</span>
        <div><p>${esc(label)}</p><strong>${esc(value)}</strong><small>${esc(note)}</small></div>
      </article>
    `).join("");
    window.__tahmisciWorkforceOverview = host.innerHTML;
  }

  function taskAssignmentPercent(task) {
    const assignments = task.assignments || [];
    if (!assignments.length) return 0;
    return Math.round(assignments.reduce((sum, item) => sum + Number(item.percent || 0), 0) / assignments.length);
  }

  function taskStatus(task) {
    if (["iptal_edildi", "cancelled", "archived"].includes(task.status)) return "iptal_edildi";
    if (["tamamlandi", "completed"].includes(task.status)) return "tamamlandi";
    const assignments = task.assignments || [];
    if (assignments.length && assignments.every((item) => ["tamamlandi", "completed"].includes(item.status) || Number(item.percent) === 100)) return "tamamlandi";
    const due = task.dueAt || (task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00` : "");
    if (due && Date.parse(due) < Date.now()) return "gecikti";
    if (assignments.some((item) => ["devam_ediyor", "in_progress"].includes(item.status) || Number(item.percent) > 0)) return "devam_ediyor";
    return "atandi";
  }

  function taskDueText(task) {
    const date = task.dueAt || task.dueDate;
    if (!date) return "Tarih yok";
    const label = dateValue(date);
    const time = task.dueTime || (/T(\d{2}:\d{2})/.exec(String(task.dueAt || "")) || [])[1];
    return time ? `${label} · ${time}` : label;
  }

  function renderTaskItems() {
    const host = $("#workforceTaskItems");
    if (!host) return;
    host.innerHTML = state.taskItems.map((value, index) => `
      <label class="workforce-task-item">
        <span>${index + 1}</span>
        <input type="text" maxlength="300" value="${esc(value)}" data-task-item="${index}" placeholder="Yapılacak maddeyi yazın">
        <button type="button" data-move-task-item="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Maddeyi yukarı taşı">${icon("chevronLeft")}</button>
        <button type="button" data-move-task-item="${index}" data-direction="1" ${index === state.taskItems.length - 1 ? "disabled" : ""} aria-label="Maddeyi aşağı taşı">${icon("chevronRight")}</button>
        <button type="button" data-remove-task-item="${index}" aria-label="Maddeyi sil">${icon("close")}</button>
      </label>
    `).join("");
  }

  function renderTargetPicker() {
    const host = $("#workforceTargetPicker");
    if (!host) return;
    const users = (state.data.users || []).filter((item) => item.active !== false);
    host.hidden = state.targetType !== "selected";
    host.innerHTML = `
      <div class="workforce-person-chips">
        ${Array.from(state.selectedUsers).map((id) => {
          const name = userName(id);
          return `<span><i>${esc(initials(name))}</i>${esc(name)}<button type="button" data-remove-user="${esc(id)}" aria-label="${esc(name)} seçimini kaldır">${icon("close")}</button></span>`;
        }).join("") || "<small>Henüz personel seçilmedi.</small>"}
      </div>
      <div class="workforce-person-options">
        ${users.map((user) => `<label><input type="checkbox" data-select-user="${esc(user.id)}" ${state.selectedUsers.has(String(user.id)) ? "checked" : ""}><span>${esc(user.name || user.username)}</span></label>`).join("") || "<p>Aktif personel bulunmuyor.</p>"}
      </div>
    `;
  }

  function renderTasks() {
    const host = $("#workforceTasksPanel");
    if (!host) return;
    const activities = state.data.taskActivity || [];
    const tasks = (state.data.tasks || []).map((task) => ({
      ...task,
      activity: activities.filter((entry) => String(entry.workforceTaskId || entry.taskId || "") === String(task.id))
    }));
    const visibleTasks = tasks.filter((task) => {
      const status = taskStatus(task);
      if (state.taskView === "all") return true;
      return status === state.taskView;
    });
    const targetCount = state.targetType === "all"
      ? (state.data.users || []).filter((item) => item.active !== false).length
      : state.selectedUsers.size;
    const filledItemCount = state.taskItems.filter((item) => item.trim()).length;
    host.innerHTML = `
      <div class="workforce-panel-heading">
        <div><p class="eyebrow">Personel Operasyonları</p><h3>Yapılacaklar</h3><p>Personel için bireysel veya toplu görev atayın.</p></div>
        <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-new-task>${icon("plus")} Yeni Görev</button>
      </div>
      <div class="workforce-task-layout">
        <form class="workforce-task-builder" id="workforceTaskForm">
          <label class="workforce-field"><span>Görev başlığı</span><input name="title" maxlength="160" required value="${esc(state.taskDraft.title)}" placeholder="Örn. Kapanış stok sayımını tamamla"></label>
          <label class="workforce-field"><span>Açıklama <small>(isteğe bağlı)</small></span><textarea name="description" maxlength="1000" rows="3" placeholder="Görevin kısa açıklaması">${esc(state.taskDraft.description)}</textarea></label>
          <fieldset class="workforce-fieldset">
            <legend>Görev maddeleri</legend>
            <div id="workforceTaskItems"></div>
            <button class="workforce-add-item" type="button" data-add-task-item>${icon("plus")} Madde ekle</button>
          </fieldset>
          <fieldset class="workforce-fieldset">
            <legend>Hedef</legend>
            <div class="workforce-segmented">
              <button class="${state.targetType === "all" ? "is-active" : ""}" type="button" data-target-type="all">Tüm personel</button>
              <button class="${state.targetType === "selected" ? "is-active" : ""}" type="button" data-target-type="selected">Seçili personeller</button>
            </div>
            <div id="workforceTargetPicker"></div>
          </fieldset>
          <div class="workforce-form-row">
            <label class="workforce-field"><span>Öncelik</span><select name="priority"><option value="low" ${state.taskDraft.priority === "low" ? "selected" : ""}>Düşük</option><option value="normal" ${state.taskDraft.priority === "normal" ? "selected" : ""}>Normal</option><option value="high" ${state.taskDraft.priority === "high" ? "selected" : ""}>Yüksek</option><option value="urgent" ${state.taskDraft.priority === "urgent" ? "selected" : ""}>Acil</option></select></label>
            <label class="workforce-field"><span>Teslim tarihi</span><input name="dueDate" type="date" value="${esc(state.taskDraft.dueDate)}"></label>
            <label class="workforce-field"><span>Teslim saati <small>(isteğe bağlı)</small></span><input name="dueTime" type="time" value="${esc(state.taskDraft.dueTime)}"></label>
          </div>
          <label class="workforce-field"><span>Yönetici notu <small>(isteğe bağlı)</small></span><textarea name="managerNote" maxlength="500" rows="2" placeholder="Personelin görev ekranında göreceği not">${esc(state.taskDraft.managerNote)}</textarea></label>
          <div class="workforce-assignment-summary" aria-live="polite"><b>Atama özeti</b><span>${targetCount} personel</span><span>${filledItemCount} madde</span><span>${esc(state.taskDraft.priority === "urgent" ? "Acil" : state.taskDraft.priority === "high" ? "Yüksek" : state.taskDraft.priority === "low" ? "Düşük" : "Normal")}</span><span>${state.taskDraft.dueDate ? esc(dateValue(state.taskDraft.dueDate)) : "Teslim tarihi yok"}</span></div>
          <button class="workforce-primary-button ui-button ui-button--primary ui-button--block" type="submit" data-workforce-action data-operation-class="immediate-operation">${icon("send")} Görevleri Ata</button>
        </form>
        <section class="workforce-active-tasks">
          <div class="workforce-list-heading"><div><p class="eyebrow">Görev Takibi</p><h3>Görevler</h3></div><span>${tasks.filter((item) => !["tamamlandi", "iptal_edildi"].includes(taskStatus(item))).length} aktif</span></div>
          <div class="workforce-task-view-tabs" role="tablist" aria-label="Görev görünümü">
            ${[["all", "Tümü"], ["atandi", "Atandı"], ["devam_ediyor", "Devam ediyor"], ["tamamlandi", "Tamamlandı"], ["gecikti", "Gecikti"], ["iptal_edildi", "İptal edildi"]].map(([value, label]) => `<button class="${state.taskView === value ? "is-active" : ""}" type="button" data-task-view="${value}">${label}</button>`).join("")}
          </div>
          <div class="workforce-task-list">
            ${visibleTasks.length ? visibleTasks.map((task) => {
              const percent = taskAssignmentPercent(task);
              const names = (task.assignments || []).map((assignment) => assignment.name || userName(assignment.userId));
              const status = taskStatus(task);
              return `<button class="workforce-task-card ${state.selectedTaskId === task.id ? "is-selected" : ""}" type="button" data-task-detail="${esc(task.id)}">
                <span class="workforce-avatar">${esc(initials(names[0] || "G"))}</span>
                <span class="workforce-task-card-main">
                  <span class="workforce-task-card-title"><strong>${esc(task.title)}</strong><em class="workforce-status is-${esc(status)}">${esc(statusLabel(status))}</em></span>
                  <small>${esc(names.slice(0, 3).join(", ") || "Personel atanmadı")}${names.length > 3 ? ` +${names.length - 3}` : ""}</small>
                  <span class="workforce-progress"><i style="width:${percent}%"></i></span>
                  <span class="workforce-task-meta"><b>%${percent} tamamlandı</b><time>${icon("calendar")}${esc(taskDueText(task))}</time></span>
                </span>
              </button>`;
            }).join("") : `<div class="workforce-empty">${icon("check")}<h4>Bu filtrede görev yok</h4><p>Görev durumu değiştiğinde kayıt ilgili filtrede görünecek.</p></div>`}
          </div>
          <div id="workforceTaskDetail"></div>
        </section>
      </div>
    `;
    renderTaskItems();
    renderTargetPicker();
    if (state.selectedTaskId) renderTaskDetail(state.selectedTaskId);
    bindTasks();
  }

  function renderTaskDetail(taskId) {
    const host = $("#workforceTaskDetail");
    const task = (state.data.tasks || []).find((item) => String(item.id) === String(taskId));
    if (!host || !task) return;
    host.innerHTML = `
      <div class="workforce-detail-card">
        <div class="workforce-detail-head">
          <div><p class="eyebrow">Görev Ayrıntısı</p><h4>${esc(task.title)}</h4></div>
          <div class="workforce-detail-actions">
            ${taskStatus(task) === "iptal_edildi" ? "" : `<button class="ui-button ui-button--danger ui-button--sm" type="button" data-task-status="iptal_edildi" data-workforce-action>Görevi İptal Et</button>`}
            <button type="button" data-close-task-detail aria-label="Detayı kapat">${icon("close")}</button>
          </div>
        </div>
        ${task.description ? `<p>${esc(task.description)}</p>` : ""}
        <div class="workforce-detail-meta"><span><b>Öncelik:</b> ${esc(task.priority || "normal")}</span><span><b>Teslim:</b> ${esc(taskDueText(task))}</span><span><b>Durum:</b> ${esc(statusLabel(taskStatus(task)))}</span></div>
        ${task.managerNote ? `<div class="workforce-manager-note"><b>Yönetici notu</b><p>${esc(task.managerNote)}</p></div>` : ""}
        <ol class="workforce-detail-items">${(task.items || []).map((item) => `<li>${esc(item.text || item)}</li>`).join("")}</ol>
        <div class="workforce-assignment-detail">
          ${(task.assignments || []).map((assignment) => {
            const percent = Number(assignment.percent || 0);
            const completed = new Set(assignment.completedItemIds || []);
            const completedLabels = (task.items || []).filter((item) => completed.has(item.id)).map((item) => item.text || item.title);
            return `<article><span class="workforce-avatar">${esc(initials(assignment.name || userName(assignment.userId)))}</span><div><strong>${esc(assignment.name || userName(assignment.userId))}</strong><small>${completed.size}/${(task.items || []).length} madde · ${esc(statusLabel(assignment.status))}</small>${completedLabels.length ? `<small class="workforce-completed-items">Tamamlanan: ${esc(completedLabels.join(", "))}</small>` : `<small class="workforce-completed-items">Henüz tamamlanan madde yok.</small>`}<small>Son aktivite: ${esc(dateTime(assignment.updatedAt || assignment.completedAt || task.updatedAt))}</small><span class="workforce-progress"><i style="width:${percent}%"></i></span></div><b>%${percent}</b></article>`;
          }).join("") || "<p>Atama kaydı bulunmuyor.</p>"}
        </div>
        ${(task.activity || task.activities || []).length ? `<div class="workforce-task-activity"><b>Aktivite geçmişi</b>${(task.activity || task.activities).slice(-8).reverse().map((entry) => `<p><span>${esc(entry.label || statusLabel(entry.type || entry.status))}</span><time>${esc(dateTime(entry.createdAt || entry.at))}</time></p>`).join("")}</div>` : ""}
      </div>
    `;
    $("[data-close-task-detail]", host)?.addEventListener("click", () => {
      state.selectedTaskId = "";
      host.innerHTML = "";
      $$(".workforce-task-card").forEach((card) => card.classList.remove("is-selected"));
    });
    $("[data-task-status]", host)?.addEventListener("click", (event) => updateTaskStatus(task.id, event.currentTarget.dataset.taskStatus));
  }

  async function updateTaskStatus(taskId, status) {
    try {
      setBusy(true);
      acceptMutationResult(await api(`/api/admin/workforce/tasks/${encodeURIComponent(taskId)}`, mutationOptions("PATCH", { status }, `task-status-${taskId}`)));
      state.selectedTaskId = "";
      state.taskView = status === "iptal_edildi" ? "iptal_edildi" : "all";
      await refresh("tasks");
      showMessage(status === "iptal_edildi" ? "Görev iptal edildi; personel atamaları salt okunur hale geldi." : "Görev durumu güncellendi.");
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function bindTasks() {
    $("#workforceTaskForm")?.addEventListener("input", (event) => {
      if (event.target.name && Object.prototype.hasOwnProperty.call(state.taskDraft, event.target.name)) {
        state.taskDraft[event.target.name] = event.target.value;
      }
      state.taskFormDirty = true;
      updateTaskAssignmentSummary();
    });
    $("#workforceTaskForm")?.addEventListener("change", (event) => {
      if (event.target.name && Object.prototype.hasOwnProperty.call(state.taskDraft, event.target.name)) {
        state.taskDraft[event.target.name] = event.target.value;
      }
      state.taskFormDirty = true;
      updateTaskAssignmentSummary();
    });
    $("#workforceTaskItems")?.addEventListener("input", (event) => {
      const input = event.target.closest("[data-task-item]");
      if (input) {
        state.taskItems[Number(input.dataset.taskItem)] = input.value;
        state.taskFormDirty = true;
        updateTaskAssignmentSummary();
      }
    });
    $("#workforceTaskItems")?.addEventListener("click", (event) => {
      const mover = event.target.closest("[data-move-task-item]");
      if (mover) {
        const from = Number(mover.dataset.moveTaskItem);
        const to = from + Number(mover.dataset.direction);
        if (to >= 0 && to < state.taskItems.length) {
          [state.taskItems[from], state.taskItems[to]] = [state.taskItems[to], state.taskItems[from]];
          state.taskFormDirty = true;
          renderTaskItems();
          updateTaskAssignmentSummary();
        }
        return;
      }
      const button = event.target.closest("[data-remove-task-item]");
      if (!button) return;
      if (state.taskItems.length === 1) state.taskItems[0] = "";
      else state.taskItems.splice(Number(button.dataset.removeTaskItem), 1);
      state.taskFormDirty = true;
      renderTaskItems();
      updateTaskAssignmentSummary();
    });
    $("[data-add-task-item]")?.addEventListener("click", () => {
      state.taskItems.push("");
      state.taskFormDirty = true;
      renderTaskItems();
      $("#workforceTaskItems input:last-of-type")?.focus();
    });
    $$("[data-target-type]").forEach((button) => button.addEventListener("click", () => {
      state.targetType = button.dataset.targetType;
      state.taskFormDirty = true;
      $$(".workforce-segmented [data-target-type]").forEach((item) => item.classList.toggle("is-active", item.dataset.targetType === state.targetType));
      renderTargetPicker();
      updateTaskAssignmentSummary();
    }));
    $("#workforceTargetPicker")?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-select-user]");
      if (!input) return;
      if (input.checked) state.selectedUsers.add(String(input.dataset.selectUser));
      else state.selectedUsers.delete(String(input.dataset.selectUser));
      renderTargetPicker();
      state.taskFormDirty = true;
      updateTaskAssignmentSummary();
    });
    $("#workforceTargetPicker")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-user]");
      if (!button) return;
      state.selectedUsers.delete(String(button.dataset.removeUser));
      renderTargetPicker();
      state.taskFormDirty = true;
      updateTaskAssignmentSummary();
    });
    $("#workforceTaskForm")?.addEventListener("submit", createTask);
    $$("[data-task-view]").forEach((button) => button.addEventListener("click", () => {
      state.taskView = button.dataset.taskView;
      state.selectedTaskId = "";
      renderTasks();
    }));
    $$("[data-task-detail]").forEach((button) => button.addEventListener("click", () => {
      state.selectedTaskId = button.dataset.taskDetail;
      $$(".workforce-task-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.taskDetail === state.selectedTaskId));
      renderTaskDetail(state.selectedTaskId);
    }));
    $("[data-new-task]")?.addEventListener("click", () => $("#workforceTaskForm input[name='title']")?.focus());
  }

  function updateTaskAssignmentSummary() {
    const host = $(".workforce-assignment-summary");
    if (!host) return;
    const targetCount = state.targetType === "all"
      ? (state.data.users || []).filter((item) => item.active !== false).length
      : state.selectedUsers.size;
    const labels = host.querySelectorAll("span");
    if (labels[0]) labels[0].textContent = `${targetCount} personel`;
    if (labels[1]) labels[1].textContent = `${state.taskItems.filter((item) => item.trim()).length} madde`;
    if (labels[2]) labels[2].textContent = state.taskDraft.priority === "urgent" ? "Acil" : state.taskDraft.priority === "high" ? "Yüksek" : state.taskDraft.priority === "low" ? "Düşük" : "Normal";
    if (labels[3]) labels[3].textContent = state.taskDraft.dueDate ? dateValue(state.taskDraft.dueDate) : "Teslim tarihi yok";
  }

  function createTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    return runImmediateOperation("task-assign", form.querySelector("[type='submit']"), () => executeCreateTask(event));
  }

  async function executeCreateTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const items = state.taskItems.map((text, index) => ({ id: `item-${index + 1}`, text: text.trim() })).filter((item) => item.text);
    if (!items.length) {
      showMessage("En az bir görev maddesi ekleyin.", "error");
      return operationSkipped("validation");
    }
    if (state.targetType === "selected" && !state.selectedUsers.size) {
      showMessage("En az bir aktif personel seçin.", "error");
      return operationSkipped("validation");
    }
    try {
      setBusy(true);
      acceptMutationResult(await api("/api/admin/workforce/tasks", mutationOptions("POST", {
          title: String(formData.get("title") || "").trim(),
          description: String(formData.get("description") || "").trim(),
          items,
          priority: formData.get("priority"),
          dueDate: formData.get("dueDate"),
          dueTime: formData.get("dueTime"),
          dueAt: formData.get("dueDate") ? `${formData.get("dueDate")}T${formData.get("dueTime") || "23:59"}:00` : null,
          managerNote: String(formData.get("managerNote") || "").trim(),
          targetType: state.targetType,
          assignedUserIds: Array.from(state.selectedUsers)
        }, "task-create")));
      state.taskItems = ["", ""];
      state.taskDraft = { title: "", description: "", priority: "normal", dueDate: "", dueTime: "", managerNote: "" };
      state.taskFormDirty = false;
      state.selectedUsers.clear();
      state.targetType = "all";
      await refresh("tasks");
      showMessage("Görevler personellere atandı.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function stockProduct(productId) {
    return (state.stock.products || []).find((item) => String(item.id) === String(productId)) || {};
  }

  function operationHost(kind) {
    return kind === "shipments"
      ? $("#workforceShipmentsPanel")
      : $("#workforceShiftsPanel");
  }

  function shipmentLineValues(line) {
    const product = stockProduct(line.productId);
    const current = Number(line.currentStock ?? line.currentQuantity ?? product.stockQuantity ?? product.quantity ?? 0);
    const conversion = Number(line.conversionFactor || 1);
    const increment = Number(line.baseQuantity ?? line.baseAmount ?? Number(line.quantity || 0) * conversion);
    const expected = Number(line.expectedStock ?? current + increment);
    return { product, current, increment, expected };
  }

  function renderShipments() {
    const host = operationHost("shipments");
    if (!host) return;
    const allShipments = [...(state.data.shipments || [])].sort((a, b) => {
      if ((a.status === "onay_bekliyor") !== (b.status === "onay_bekliyor")) return a.status === "onay_bekliyor" ? -1 : 1;
      return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
    });
    const shipments = state.shipmentView === "all"
      ? allShipments
      : allShipments.filter((shipment) => shipment.status === state.shipmentView);
    const selected = shipments.find((item) => String(item.id) === String(state.selectedShipmentId)) || shipments[0];
    if (selected) state.selectedShipmentId = selected.id;
    const pending = allShipments.filter((item) => item.status === "onay_bekliyor").length;
    const approvedToday = allShipments.filter((item) => item.status === "onaylandı" && isoDate(item.approvedAt || "") === isoDate(new Date())).length;
    host.innerHTML = `
      <div class="workforce-rule">${icon("info")}<div><strong>İş kuralı: Gönderilen tüm sevkiyatlar ONAY BEKLİYOR durumundadır.</strong><span>“Onayla ve Stoğa Ekle” işleminden önce stoklara yansımaz.</span></div></div>
      <div class="workforce-operation-stats">
        <article>${icon("clock")}<div><span>Bekleyen</span><strong>${pending}</strong><small>Onay bekleyen sevkiyat</small></div></article>
        <article>${icon("check")}<div><span>Bugün onaylanan</span><strong>${approvedToday}</strong><small>Bugün stoğa eklenen</small></div></article>
        <article>${icon("package")}<div><span>Stok etkisi</span><strong>${pending ? "Bekliyor" : "Güncel"}</strong><small>Onaylanana kadar geçerli değil</small></div></article>
      </div>
      <div class="workforce-shipment-layout">
        <section class="workforce-shipment-list">
          <div class="workforce-list-heading"><div><p class="eyebrow">Gelen Bildirimler</p><h3>Sevkiyatlar</h3></div><span>${shipments.length} kayıt</span></div>
          <div class="workforce-task-view-tabs" role="tablist" aria-label="Sevkiyat filtresi">
            ${[["onay_bekliyor", "Onay bekliyor"], ["onaylandı", "Onaylandı"], ["reddedildi", "Reddedildi"], ["all", "Tümü"]].map(([value, label]) => `<button class="${state.shipmentView === value ? "is-active" : ""}" type="button" data-shipment-view="${value}">${label}</button>`).join("")}
          </div>
          <div>
            ${shipments.length ? shipments.map((shipment) => {
              const summary = (shipment.items || []).slice(0, 2).map((item) => `${item.name}: ${item.quantity} ${item.unit}`).join(" · ");
              return `<button class="workforce-shipment-card ${String(shipment.id) === String(state.selectedShipmentId) ? "is-selected" : ""}" type="button" data-shipment="${esc(shipment.id)}">
                <span class="workforce-avatar">${esc(initials(shipment.userName))}</span>
                <span><strong>${esc(shipment.userName || "Personel")}</strong><small>${esc(dateTime(shipment.createdAt))}</small><b>${(shipment.items || []).length} ürün</b><em>${esc(summary || "Ürün bilgisi yok")}</em></span>
                <i class="workforce-status is-${esc(shipment.status)}">${esc(statusLabel(shipment.status))}</i>
              </button>`;
            }).join("") : `<div class="workforce-empty">${icon("package")}<h4>Sevkiyat bildirimi yok</h4><p>Personel bildirimleri burada görünecek.</p></div>`}
          </div>
        </section>
        <section class="workforce-shipment-detail" id="workforceShipmentDetail"></section>
      </div>
    `;
    if (selected) renderShipmentDetail(selected);
    else $("#workforceShipmentDetail").innerHTML = `<div class="workforce-empty">${icon("package")}<h4>Detay seçilmedi</h4><p>İncelemek için soldan bir sevkiyat seçin.</p></div>`;
    $$("[data-shipment]", host).forEach((button) => button.addEventListener("click", () => {
      state.selectedShipmentId = button.dataset.shipment;
      renderShipments();
    }));
    $$("[data-shipment-view]", host).forEach((button) => button.addEventListener("click", () => {
      state.shipmentView = button.dataset.shipmentView;
      state.selectedShipmentId = "";
      renderShipments();
    }));
  }

  function renderShipmentDetail(shipment) {
    const host = $("#workforceShipmentDetail");
    if (!host) return;
    const pending = shipment.status === "onay_bekliyor";
    host.innerHTML = `
      <div class="workforce-detail-head">
        <div><p class="eyebrow">Sevkiyat Detayı</p><h3>${esc(shipment.userName || "Personel")}</h3><span>${esc(dateTime(shipment.createdAt))}</span></div>
        <em class="workforce-status is-${esc(shipment.status)}">${esc(statusLabel(shipment.status))}</em>
      </div>
      <div class="workforce-shipment-table">
        <div class="workforce-shipment-table-head"><span>Ürün</span><span>Mevcut Stok</span><span>Bildirilen</span><span>Onay Sonrası</span></div>
        ${(shipment.items || []).map((line) => {
          const values = shipmentLineValues(line);
          const baseUnit = line.currentStockUnit || line.baseUnit || values.product.unit || line.unit || "";
          return `<div class="workforce-shipment-table-row">
            <span><strong>${esc(line.name || values.product.name || "Ürün")}</strong><small>${esc(line.category || values.product.category || "Kategori yok")}</small></span>
            <span>${esc(values.current)} ${esc(baseUnit)}</span>
            <span><b>+${esc(line.quantity)} ${esc(line.unit)}</b></span>
            <span><strong>${esc(values.expected)} ${esc(baseUnit)}</strong></span>
          </div>`;
        }).join("")}
      </div>
      ${pending ? `<div class="workforce-stock-warning">${icon("info")} Stok henüz güncellenmedi. Bu sevkiyat onaylanana kadar stoklara yansımaz.</div>` : ""}
      <label class="workforce-field"><span>Yönetici notu <small>(reddetmede zorunlu)</small></span><textarea id="workforceShipmentNote" maxlength="250" rows="4" ${pending ? "" : "disabled"} placeholder="Kararınıza ilişkin kısa bir not ekleyin...">${esc(shipment.adminNote || shipment.rejectionReason || "")}</textarea></label>
      ${pending ? `<div class="workforce-stock-warning">${icon("info")} Bu sevkiyat bütün kalemleriyle tek atomik işlem olarak onaylanır; kısmi onay uygulanmaz.</div>` : ""}
      ${pending ? `<div class="workforce-decision-actions">
        <button class="workforce-reject-button ui-button ui-button--danger" type="button" data-shipment-decision="reject" data-workforce-action data-operation-class="immediate-operation">Reddet</button>
        <button class="workforce-primary-button ui-button ui-button--primary" type="button" data-shipment-decision="approve" data-workforce-action data-operation-class="immediate-operation">${icon("check")} Onayla ve Stoğa Ekle</button>
      </div>` : `<div class="workforce-decision-summary">${icon("check")} Bu sevkiyat ${esc(statusLabel(shipment.status).toLocaleLowerCase("tr-TR"))}. ${shipment.approvedAt ? esc(dateTime(shipment.approvedAt)) : shipment.rejectedAt ? esc(dateTime(shipment.rejectedAt)) : ""}</div>`}
    `;
    $$("[data-shipment-decision]", host).forEach((button) => button.addEventListener("click", () => decideShipment(shipment.id, button.dataset.shipmentDecision)));
  }

  function decideShipment(id, decision) {
    const button = $(`[data-shipment-decision="${CSS.escape(decision)}"]`);
    return runImmediateOperation(`shipment-${decision}:${id}`, button, () => executeShipmentDecision(id, decision));
  }

  async function executeShipmentDecision(id, decision) {
    const note = $("#workforceShipmentNote")?.value.trim() || "";
    if (decision === "reject" && !note) {
      showMessage("Sevkiyatı reddetmek için neden yazın.", "error");
      $("#workforceShipmentNote")?.focus();
      return operationSkipped("validation");
    }
    try {
      setBusy(true);
      acceptMutationResult(await api(`/api/admin/workforce/shipments/${encodeURIComponent(id)}/${decision}`, mutationOptions("POST", {
        note,
        rejectionReason: decision === "reject" ? note : ""
      }, `shipment-${decision}-${id}`)));
      await refresh("shipments");
      showMessage(decision === "approve" ? "Sevkiyat onaylandı ve stok güncellendi." : "Sevkiyat reddedildi.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function weekDates() {
    return Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
  }

  function currentPlans() {
    const persisted = (state.data.shiftPlans || []).filter((item) => item.weekStart === state.weekStart || weekDates().includes(item.date));
    if (!Array.isArray(state.draftPlans) || !state.draftPlans.length) return persisted;
    return persisted.filter((item) => item.status !== "draft").concat(state.draftPlans);
  }

  function planFor(personId, date) {
    const matches = currentPlans().filter((item) => String(item.personId) === String(personId) && item.date === date);
    return matches.find((item) => item.status === "draft")
      || matches.find((item) => item.status === "published")
      || {
      personId, date, weekStart: state.weekStart, type: "unassigned",
      startTime: null, endTime: null,
      source: "manual", status: "draft"
    };
  }

  function renderShiftGrid() {
    const host = $("#workforceShiftGrid");
    if (!host) return;
    const dates = weekDates();
    const dayNames = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
    const users = (state.data.users || []).filter((item) => item.active !== false);
    host.innerHTML = `
      <div class="workforce-shift-grid-head"><span>Personel</span>${dates.map((date, index) => `<span><b>${dayNames[index]}</b><small>${dateValue(date).replace(/\s+\d{4}$/, "")}</small></span>`).join("")}</div>
      ${users.map((user) => `<div class="workforce-shift-grid-row">
        <span class="workforce-shift-person"><i class="workforce-avatar">${esc(initials(user.name || user.username))}</i><b>${esc(user.name || user.username)}</b></span>
        ${dates.map((date) => {
          const plan = planFor(user.id, date);
          return `<label class="workforce-shift-cell is-${esc(plan.type)}">
            <select data-shift-person="${esc(user.id)}" data-shift-date="${esc(date)}">
              <option value="morning" ${plan.type === "morning" ? "selected" : ""}>Sabah</option>
              <option value="evening" ${plan.type === "evening" ? "selected" : ""}>Akşam</option>
              <option value="leave" ${plan.type === "leave" ? "selected" : ""}>İzinli</option>
              <option value="custom" ${plan.type === "custom" ? "selected" : ""}>Özel Saat</option>
              <option value="unassigned" ${plan.type === "unassigned" ? "selected" : ""}>Boş / Atanmamış</option>
            </select>
            <small data-shift-hours>${plan.type === "leave" ? "Tüm gün" : plan.type === "unassigned" ? "Atanmadı" : `${esc(plan.startTime || "")} – ${esc(plan.endTime || "")}`}</small>
            <span class="workforce-custom-hours" ${plan.type === "custom" ? "" : "hidden"}>
              <input type="time" data-shift-start value="${esc(plan.startTime || state.templates.custom.startTime)}" aria-label="Başlangıç saati">
              <input type="time" data-shift-end value="${esc(plan.endTime || state.templates.custom.endTime)}" aria-label="Bitiş saati">
            </span>
          </label>`;
        }).join("")}
      </div>`).join("") || `<div class="workforce-empty"><h4>Aktif personel yok</h4><p>Shift planı için aktif personel gereklidir.</p></div>`}
    `;
    $$("[data-shift-person]", host).forEach((select) => select.addEventListener("change", updateShiftCell));
    $$("[data-shift-start], [data-shift-end]", host).forEach((input) => input.addEventListener("change", validateCustomHours));
  }

  function updateShiftCell(event) {
    const select = event.currentTarget;
    const cell = select.closest(".workforce-shift-cell");
    cell.className = `workforce-shift-cell is-${select.value}`;
    const custom = $(".workforce-custom-hours", cell);
    const hours = $("[data-shift-hours]", cell);
    custom.hidden = select.value !== "custom";
    if (select.value === "leave") hours.textContent = "Tüm gün";
    else if (select.value === "unassigned") hours.textContent = "Atanmadı";
    else if (select.value === "custom") {
      hours.textContent = `${$("[data-shift-start]", cell).value} – ${$("[data-shift-end]", cell).value}`;
    } else {
      const template = state.templates[select.value];
      hours.textContent = `${template.startTime} – ${template.endTime}`;
    }
  }

  function validateCustomHours(event) {
    const cell = event.currentTarget.closest(".workforce-shift-cell");
    const start = $("[data-shift-start]", cell);
    const end = $("[data-shift-end]", cell);
    const hours = $("[data-shift-hours]", cell);
    const valid = start.value && end.value && start.value < end.value;
    cell.classList.toggle("has-error", !valid);
    hours.textContent = valid ? `${start.value} – ${end.value}` : "Geçerli saat seçin";
  }

  function renderShifts() {
    const host = operationHost("shifts");
    if (!host) return;
    const requests = [...(state.data.shiftRequests || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const weekEnd = addDays(state.weekStart, 6);
    const hasDraft = Boolean(state.draftPlans) || currentPlans().some((item) => item.status === "draft");
    const isFutureWeek = state.weekStart > mondayOf(new Date());
    host.innerHTML = `
      <div class="workforce-shift-toolbar">
        <div class="workforce-week-picker">
          <button type="button" data-week-step="-7" aria-label="Önceki hafta">${icon("chevronLeft")}</button>
          <label><span>${icon("calendar")}</span><input id="workforceWeekInput" type="date" value="${esc(state.weekStart)}"><strong>${esc(dateValue(state.weekStart))} – ${esc(dateValue(weekEnd))}</strong></label>
          <button type="button" data-week-step="7" aria-label="Sonraki hafta">${icon("chevronRight")}</button>
        </div>
        <div class="workforce-shift-actions">
          <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-auto-draft data-workforce-action ${isFutureWeek ? "" : "disabled"} title="${isFutureWeek ? "Seçili gelecek hafta için temel vardiya taslağı öner" : "Otomatik taslak yalnızca gelecek haftalar için oluşturulabilir"}">${icon("sparkles")} Temel Vardiya Taslağı Öner</button>
          <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-apply-draft data-workforce-action ${hasDraft ? "" : "disabled"}>${icon("check")} Taslağı Uygula</button>
          <button class="workforce-primary-button ui-button ui-button--primary" type="button" data-publish-shifts data-workforce-action data-operation-class="immediate-operation">${icon("send")} Shiftleri Yayınla</button>
        </div>
      </div>
      <div class="workforce-shift-layout">
        <aside class="workforce-shift-templates">
          <div class="workforce-list-heading"><div><p class="eyebrow">Planlama</p><h3>Shift Şablonları</h3></div></div>
          <label class="is-morning"><span><i></i><b>Sabah</b></span><span><input type="time" data-template="morning.startTime" value="${esc(state.templates.morning.startTime)}"><span aria-hidden="true">–</span><input type="time" data-template="morning.endTime" value="${esc(state.templates.morning.endTime)}"></span></label>
          <label class="is-evening"><span><i></i><b>Akşam</b></span><span><input type="time" data-template="evening.startTime" value="${esc(state.templates.evening.startTime)}"><span aria-hidden="true">–</span><input type="time" data-template="evening.endTime" value="${esc(state.templates.evening.endTime)}"></span></label>
          <div class="is-leave"><span><i></i><b>İzinli</b></span><small>Tüm gün</small></div>
          <label class="is-custom"><span><i></i><b>Belirli Saatler</b></span><span><input type="time" data-template="custom.startTime" value="${esc(state.templates.custom.startTime)}"><span aria-hidden="true">–</span><input type="time" data-template="custom.endTime" value="${esc(state.templates.custom.endTime)}"></span></label>
          <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-save-draft data-workforce-action>Taslak Olarak Kaydet</button>
        </aside>
        <section class="workforce-shift-schedule">
          <div class="workforce-draft-note">${icon("info")} Hücrelerden vardiya tipini seçebilir, özel saatleri doğrudan düzenleyebilirsiniz.</div>
          ${state.autoDraftProposal ? `<div class="workforce-auto-proposal">
            <b>Öneri açıklaması</b>
            <p>${esc((state.autoDraftProposal.appliedRules || []).join(" · ") || "Temel sabah/akşam dönüşümü uygulandı.")}</p>
            ${(state.autoDraftProposal.limitations || []).length ? `<small>Otomatik doğrulanmayanlar: ${esc(state.autoDraftProposal.limitations.join(" · "))}</small>` : ""}
            ${(state.autoDraftProposal.conflicts || []).length ? `<em>${state.autoDraftProposal.conflicts.length} çakışma yönetici kontrolü bekliyor.</em>` : ""}
          </div>` : ""}
          <div class="workforce-shift-grid" id="workforceShiftGrid"></div>
        </section>
        <aside class="workforce-request-list">
          <div class="workforce-list-heading"><div><p class="eyebrow">Personel Talepleri</p><h3>Tercih ve İzin</h3></div><span>${requests.filter((item) => item.status === "onay_bekliyor").length} bekliyor</span></div>
          ${requests.length ? requests.map((request) => `<article class="workforce-request-card">
            <div><span class="workforce-avatar">${esc(initials(request.personName || userName(request.personId)))}</span><div><strong>${esc(request.personName || userName(request.personId))}</strong><em class="workforce-status is-${esc(request.status)}">${esc(statusLabel(request.status))}</em></div></div>
            <h4>${esc(typeLabel(request.type))}</h4>
            <p>${esc(dateValue(request.date))}${request.startTime ? ` · ${esc(request.startTime)} – ${esc(request.endTime)}` : ""}</p>
            ${request.description ? `<small>${esc(request.description)}</small>` : ""}
            ${request.status === "onay_bekliyor" ? `<textarea maxlength="250" data-request-note="${esc(request.id)}" placeholder="Yönetici notu"></textarea><div><button class="ui-button ui-button--danger ui-button--sm" type="button" data-request-id="${esc(request.id)}" data-request-decision="reject" data-workforce-action>Reddet</button><button class="ui-button ui-button--primary ui-button--sm" type="button" data-request-id="${esc(request.id)}" data-request-decision="approve" data-workforce-action>Onayla</button></div>` : `<small>${request.adminNote ? `Yönetici notu: ${esc(request.adminNote)} · ` : ""}${esc(dateTime(request.decidedAt))}</small>`}
          </article>`).join("") : `<div class="workforce-empty"><h4>Talep yok</h4><p>Personel tercihleri burada görünecek.</p></div>`}
        </aside>
      </div>
    `;
    renderShiftGrid();
    bindShifts();
  }

  function bindShifts() {
    $$("[data-week-step]").forEach((button) => button.addEventListener("click", () => {
      state.weekStart = addDays(state.weekStart, Number(button.dataset.weekStep));
      state.autoDraftProposal = null;
      const drafts = (state.data.shiftPlans || []).filter((plan) => plan.weekStart === state.weekStart && plan.status === "draft");
      state.draftPlans = drafts.length ? drafts : null;
      renderShifts();
    }));
    $("#workforceWeekInput")?.addEventListener("change", (event) => {
      state.weekStart = mondayOf(`${event.target.value}T12:00:00`);
      state.autoDraftProposal = null;
      const drafts = (state.data.shiftPlans || []).filter((plan) => plan.weekStart === state.weekStart && plan.status === "draft");
      state.draftPlans = drafts.length ? drafts : null;
      renderShifts();
    });
    $$("[data-template]").forEach((input) => input.addEventListener("change", () => {
      const [type, key] = input.dataset.template.split(".");
      state.templates[type][key] = input.value;
      if (type === "custom" && state.templates.custom.startTime >= state.templates.custom.endTime) {
        showMessage("Belirli saatler başlangıcı bitişten önce olmalıdır.", "error");
        return;
      }
      $$(`#workforceShiftGrid .is-${type} select`).forEach((select) => updateShiftCell({ currentTarget: select }));
      if (type === "morning" || type === "evening") {
        void runImmediateOperation("shift-settings", input, async () => {
          try {
            setBusy(true);
            await persistShiftSettings();
            showMessage("Vardiya şablonu güncellendi.");
          } catch (error) {
            showMessage(error.message, "error");
            throw error;
          } finally {
            setBusy(false);
          }
        });
      }
    }));
    $("[data-save-draft]")?.addEventListener("click", () => saveShifts(false));
    $("[data-publish-shifts]")?.addEventListener("click", () => saveShifts(true));
    const autoButton = $("[data-auto-draft]");
    autoButton?.addEventListener("click", () => runImmediateOperation(`shift-auto:${state.weekStart}`, autoButton, autoDraft));
    const applyButton = $("[data-apply-draft]");
    applyButton?.addEventListener("click", () => runImmediateOperation(`shift-apply:${state.weekStart}`, applyButton, applyDraft));
    $$("[data-request-id]").forEach((button) => button.addEventListener("click", () => runImmediateOperation(
      `shift-request-${button.dataset.requestDecision}:${button.dataset.requestId}`,
      button,
      () => decideRequest(button.dataset.requestId, button.dataset.requestDecision)
    )));
  }

  async function persistShiftSettings() {
    const result = acceptMutationResult(await api("/api/admin/workforce/shift-settings", mutationOptions("PUT", {
      morning: state.templates.morning,
      evening: state.templates.evening
    }, "shift-settings")));
    if (result.shiftSettings) {
      state.templates.morning = { ...state.templates.morning, ...(result.shiftSettings.morning || {}) };
      state.templates.evening = { ...state.templates.evening, ...(result.shiftSettings.evening || {}) };
    }
    return result;
  }

  async function applyDraft() {
    try {
      setBusy(true);
      const result = acceptMutationResult(await api(`/api/admin/workforce/shifts/${encodeURIComponent(state.weekStart)}/apply-draft`, mutationOptions("POST", {}, `shift-apply-${state.weekStart}`)));
      state.data.shiftPlans = (state.data.shiftPlans || []).filter((item) => item.weekStart !== state.weekStart).concat(result.plans || []);
      state.draftPlans = null;
      renderShifts();
      showMessage("Otomatik taslak düzenleme alanına uygulandı.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function collectPlans() {
    const invalid = $(".workforce-shift-cell.has-error");
    if (invalid) throw new Error("Özel saat aralığını düzeltin.");
    return $$("[data-shift-person]").map((select) => {
      const cell = select.closest(".workforce-shift-cell");
      const type = select.value;
      const template = state.templates[type] || {};
      return {
        personId: select.dataset.shiftPerson,
        date: select.dataset.shiftDate,
        type,
        startTime: ["leave", "unassigned"].includes(type) ? null : type === "custom" ? $("[data-shift-start]", cell).value : template.startTime,
        endTime: ["leave", "unassigned"].includes(type) ? null : type === "custom" ? $("[data-shift-end]", cell).value : template.endTime,
        source: "manual"
      };
    });
  }

  function saveShifts(publish) {
    const button = publish ? $("[data-publish-shifts]") : $("[data-save-draft]");
    return runImmediateOperation(publish ? `shift-publish:${state.weekStart}` : `shift-draft:${state.weekStart}`, button, () => executeSaveShifts(publish));
  }

  async function executeSaveShifts(publish) {
    try {
      const plans = collectPlans();
      setBusy(true);
      const result = acceptMutationResult(await api(`/api/admin/workforce/shifts/${encodeURIComponent(state.weekStart)}`, mutationOptions("PUT", {
        plans,
        publish,
        templates: state.templates
      }, `${publish ? "shift-publish" : "shift-draft"}-${state.weekStart}`)));
      state.data.shiftPlans = (state.data.shiftPlans || []).filter((item) => item.weekStart !== state.weekStart).concat(result.plans || []);
      await refresh("shifts");
      showMessage(publish ? "Shiftler yayınlandı ve personel paneline aktarıldı." : "Shift taslağı kaydedildi.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function autoDraft() {
    if (currentPlans().some((plan) => plan.status === "draft") && !window.confirm("Mevcut taslağın yerine yeni bir temel vardiya önerisi oluşturulsun mu?")) {
      return operationSkipped("cancelled");
    }
    try {
      setBusy(true);
      const result = acceptMutationResult(await api(`/api/admin/workforce/shifts/${encodeURIComponent(state.weekStart)}/auto-draft`, mutationOptions("POST", {
        templates: state.templates
      }, `shift-auto-${state.weekStart}`)));
      state.draftPlans = result.plans || [];
      state.autoDraftProposal = result.proposal || null;
      state.data.shiftPlans = (state.data.shiftPlans || []).filter((item) => item.weekStart !== state.weekStart || item.status !== "draft").concat(result.plans || []);
      renderShifts();
      const considered = Number(result.proposal && result.proposal.consideredRequestCount || 0);
      const conflicts = Array.isArray(result.proposal && result.proposal.conflicts) ? result.proposal.conflicts.length : 0;
      showMessage(`Temel vardiya taslağı oluşturuldu. ${considered} onaylı talep dikkate alındı${conflicts ? `, ${conflicts} çakışma işaretlendi` : ""}.`);
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function decideRequest(id, decision) {
    const note = $(`[data-request-note="${CSS.escape(id)}"]`)?.value.trim() || "";
    if (decision === "reject" && !note) {
      showMessage("Talebi reddetmek için neden yazın.", "error");
      $(`[data-request-note="${CSS.escape(id)}"]`)?.focus();
      return operationSkipped("validation");
    }
    try {
      setBusy(true);
      acceptMutationResult(await api(`/api/admin/workforce/shift-requests/${encodeURIComponent(id)}/${decision}`, mutationOptions("POST", {
        note,
        rejectionReason: decision === "reject" ? note : ""
      }, `shift-request-${decision}-${id}`)));
      await refresh("shifts");
      showMessage(decision === "approve" ? "Talep onaylandı." : "Talep reddedildi.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function refresh(section, options = {}) {
    const refreshKey = section || "all";
    const refreshToken = (refreshTokens.get(refreshKey) || 0) + 1;
    refreshTokens.set(refreshKey, refreshToken);
    try {
      await load(options);
    } catch (error) {
      if (refreshTokens.get(refreshKey) !== refreshToken) return;
      throw error;
    }
    if (refreshTokens.get(refreshKey) !== refreshToken) return;
    if (section !== "shipments") renderOverview();
    if (section === "tasks") renderTasks();
    else if (section === "shifts") {
      renderShifts();
    } else if (section === "shipments") {
      renderShipments();
    } else if (section === "staffAccess") {
      renderTasks();
      renderShifts();
    } else if (section === "stock") {
      renderShipments();
    } else {
      renderTasks();
      renderShipments();
      renderShifts();
    }
  }

  function syncLivePreview(section) {
    const previewSection = { shipments: "shipment", shifts: "shift", tasks: "tasks" }[section] || "staffAccess";
    activePreviewSection = previewSection;
    if (!window.TahmisciLivePreview || typeof window.TahmisciLivePreview.updateSection !== "function") return;
    window.TahmisciLivePreview.updateSection(previewSection);
  }

  window.__tahmisciWorkforcePreviewSection = () => activePreviewSection;

  function activeWorkforceSection(section) {
    if (section === "stock") return "shipments";
    if (section !== "staffAccess") return "";
    if ($("#workforceTasksAccordion")?.open) return "tasks";
    if ($("#workforceShiftsAccordion")?.open) return "shifts";
    return "staffAccess";
  }

  function isWorkforceOwnerSection(section) {
    return section === "staffAccess" || section === "stock";
  }

  function setupAccordions() {
    let openFound = false;
    $$(".staff-layout > .staff-accordion").forEach((details) => {
      if (details.open && openFound) details.open = false;
      else if (details.open) openFound = true;
      if (details.dataset.workforceToggleBound === "true") return;
      details.dataset.workforceToggleBound = "true";
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        $$(".staff-layout > .staff-accordion").forEach((other) => {
          if (other !== details) other.open = false;
        });
        if (details.id === "workforceTasksAccordion") {
          syncLivePreview("tasks");
          refresh("tasks").catch((error) => showMessage(error.message, "error"));
        } else if (details.id === "workforceShiftsAccordion") {
          syncLivePreview("shifts");
          refresh("shifts").catch((error) => showMessage(error.message, "error"));
        } else {
          syncLivePreview("staffAccess");
        }
        if (details.id === "staffRecordsAccordion" && typeof window.__tahmisciRefreshStaffLedger === "function") {
          window.__tahmisciRefreshStaffLedger();
        }
      });
    });

    const shipmentsAccordion = $("#workforceShipmentsAccordion");
    if (shipmentsAccordion && shipmentsAccordion.dataset.workforceToggleBound !== "true") {
      shipmentsAccordion.dataset.workforceToggleBound = "true";
      shipmentsAccordion.addEventListener("toggle", () => {
        if (!shipmentsAccordion.open) return;
        syncLivePreview("shipments");
        refresh("shipments").catch((error) => showMessage(error.message, "error"));
      });
    }
  }

  async function mount(section) {
    const activeSection = section || (window.TahmisciAdminBridge && window.TahmisciAdminBridge.activeSection());
    if (!isWorkforceOwnerSection(activeSection)) return;
    if (!$("#workforceTasksPanel") && !operationHost("shipments") && !operationHost("shifts")) return;
    if (state.mounted) {
      connectWorkforceEvents();
      return refresh(activeWorkforceSection(activeSection), { force: state.stale });
    }
    state.mounted = true;
    window.__tahmisciWorkforceMounted = true;
    setupAccordions();
    connectWorkforceEvents();
    try {
      await refresh(activeWorkforceSection(activeSection), { force: true });
    } catch (error) {
      const activeModule = activeWorkforceSection(activeSection);
      const target = activeModule === "shipments"
        ? operationHost("shipments")
        : activeModule === "shifts"
          ? operationHost("shifts")
          : $("#workforceTasksPanel");
      if (target) target.innerHTML = `<div class="workforce-empty"><h4>Veriler yüklenemedi</h4><p>${esc(error.message)}</p><button class="workforce-line-button ui-button ui-button--secondary" type="button" data-retry-workforce>Tekrar Dene</button></div>`;
      $("[data-retry-workforce]", target || document)?.addEventListener("click", () => refresh(activeModule, { force: true }).catch(() => {}), { once: true });
    }
  }

  function connectWorkforceEvents() {
    if (state.eventSource || !window.EventSource || document.hidden) return;
    const query = new URLSearchParams({ clientId: state.clientId });
    const source = new EventSource(`/api/admin/workforce/events?${query.toString()}`, { withCredentials: true });
    state.eventSource = source;
    source.addEventListener("open", () => { state.reconnectAttempt = 0; });
    const handle = (event) => {
      let payload;
      try { payload = JSON.parse(event.data || "{}"); } catch (_error) { return; }
      const revision = Number(payload.revision || 0);
      if (event.type === "ready" && !payload.requiresRefetch) {
        state.workforceRevision = Math.max(state.workforceRevision, revision);
        return;
      }
      if (revision <= state.workforceRevision && !payload.requiresRefetch) return;
      state.workforceRevision = Math.max(state.workforceRevision, revision);
      state.stale = true;
      const section = window.TahmisciAdminBridge && window.TahmisciAdminBridge.activeSection();
      if (!isWorkforceOwnerSection(section) || state.busy || document.activeElement?.closest(".workforce-panel")) return;
      refresh(activeWorkforceSection(section), { force: true }).catch(() => {});
    };
    source.addEventListener("ready", handle);
    source.addEventListener("workforce", handle);
    source.addEventListener("message", handle);
    source.addEventListener("error", () => {
      if (state.eventSource === source) state.eventSource = null;
      try { source.close(); } catch (_error) {}
      scheduleWorkforceReconnect();
    });
  }

  function scheduleWorkforceReconnect() {
    if (state.reconnectTimer || document.hidden) return;
    const delay = Math.min(30000, 5000 * (2 ** Math.min(state.reconnectAttempt, 3)));
    state.reconnectAttempt += 1;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      const section = window.TahmisciAdminBridge && window.TahmisciAdminBridge.activeSection();
      if (isWorkforceOwnerSection(section)) connectWorkforceEvents();
    }, delay);
  }

  function disconnectWorkforceEvents() {
    if (state.eventSource) {
      try { state.eventSource.close(); } catch (_error) {}
      state.eventSource = null;
    }
    if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.stale = true;
  }

  function handleAdminSectionChange(event) {
    const section = event.detail && event.detail.section;
    if (isWorkforceOwnerSection(section)) mount(section).catch(() => {});
    else disconnectWorkforceEvents();
  }

  document.addEventListener("tahmisci:admin-section-change", handleAdminSectionChange);
  const startWhenActive = () => {
    const section = window.TahmisciAdminBridge && window.TahmisciAdminBridge.activeSection();
    if (isWorkforceOwnerSection(section)) mount(section).catch(() => {});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startWhenActive, { once: true });
  else startWhenActive();
})();
