(function initialisePersonelNotifications() {
  "use strict";

  const API_ROOT = "/api/notifications";
  const PAGE_SIZE = 30;
  const FALLBACK_POLL_MS = 15000;
  const MAX_RECONNECT_MS = 30000;
  const BOOLEAN_PREFERENCES = [
    "inAppEnabled", "emailEnabled", "taskNotifications", "shipmentNotifications",
    "shiftNotifications", "trainingNotifications", "taskReminder24h", "taskReminder2h",
    "overdueReminder", "shiftReminder12h", "shiftReminder2h", "quietHoursEnabled"
  ];
  const DEFAULT_PREFERENCES = Object.freeze({
    inAppEnabled: true,
    pushEnabled: false,
    emailEnabled: false,
    emailAddress: "",
    taskNotifications: true,
    shipmentNotifications: true,
    shiftNotifications: true,
    trainingNotifications: true,
    taskReminder24h: true,
    taskReminder2h: true,
    overdueReminder: true,
    shiftReminder12h: true,
    shiftReminder2h: true,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    timezone: "Europe/Istanbul"
  });
  const CATEGORY_SECTIONS = Object.freeze({
    task: "tasks",
    shipment: "shipment",
    shift: "shift",
    training: "recipe",
    stock: "stock",
    system: "profile"
  });
  const INITIAL_DEEP_LINK = window.location.href;

  const state = {
    active: false,
    preview: false,
    sessionEndNotified: false,
    drawerOpen: false,
    notifications: [],
    unreadCount: 0,
    category: "all",
    unreadOnly: false,
    nextCursor: "",
    preferences: { ...DEFAULT_PREFERENCES },
    capabilities: {},
    loading: false,
    pending: new Set(),
    eventSource: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    pollTimer: null,
    previousFocus: null,
    lastLoadedAt: 0,
    initialDeepLinkConsumed: false,
    preferencesLoaded: false
  };
  const elements = {};

  document.addEventListener("DOMContentLoaded", initialise);

  function initialise() {
    [
      "personelNotificationTrigger", "personelNotificationBadge", "personelNotificationDrawer",
      "personelNotificationBackdrop", "personelNotificationClose", "personelNotificationUnreadText",
      "personelNotificationReadAll", "personelNotificationUnreadOnly", "personelNotificationFilters",
      "personelNotificationMessage", "personelNotificationList", "personelNotificationLoadMore",
      "personelNotificationPreferencesForm", "personelNotificationPreferencesState",
      "personelNotificationEmail", "personelPushStatus", "personelPushToggle", "recipeFrame"
    ].forEach((id) => { elements[id] = document.getElementById(id); });

    bindEvents();
    updateUnreadUi();
    renderNotificationList();
    renderPushState();
  }

  function bindEvents() {
    document.addEventListener("personel:session-started", handleSessionStarted);
    document.addEventListener("personel:session-ended", handleSessionEnded);
    document.addEventListener("personel:section-change", handleSectionChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", stopRealtime);
    window.addEventListener("beforeunload", stopRealtime);

    elements.personelNotificationTrigger?.addEventListener("click", openDrawer);
    elements.personelNotificationClose?.addEventListener("click", closeDrawer);
    elements.personelNotificationBackdrop?.addEventListener("click", closeDrawer);
    elements.personelNotificationUnreadOnly?.addEventListener("change", () => {
      state.unreadOnly = Boolean(elements.personelNotificationUnreadOnly.checked);
      void loadNotifications();
    });
    elements.personelNotificationFilters?.addEventListener("click", handleFilterClick);
    elements.personelNotificationList?.addEventListener("click", handleListClick);
    elements.personelNotificationReadAll?.addEventListener("click", markAllRead);
    elements.personelNotificationLoadMore?.addEventListener("click", () => loadNotifications({ append: true }));
    elements.personelNotificationPreferencesForm?.addEventListener("submit", savePreferences);
    elements.personelPushToggle?.addEventListener("click", togglePushSubscription);
    document.addEventListener("keydown", handleDocumentKeydown);
  }

  function handleSessionStarted(event) {
    const detail = event && event.detail || {};
    resetSessionState();
    state.active = true;
    state.preview = Boolean(detail.preview);
    if (state.preview) {
      if (elements.personelNotificationTrigger) elements.personelNotificationTrigger.hidden = true;
      return;
    }
    if (elements.personelNotificationTrigger) elements.personelNotificationTrigger.hidden = false;
    void refreshUnreadCount();
    connectEvents();
  }

  function handleSessionEnded() {
    resetSessionState();
    closeDrawer();
    if (elements.personelNotificationTrigger) elements.personelNotificationTrigger.hidden = true;
    renderNotificationList();
    fillPreferencesForm();
  }

  function handleInitialDeepLink() {
    if (!state.active || state.preview || state.initialDeepLinkConsumed) return;
    state.initialDeepLinkConsumed = true;
    let url;
    try { url = new URL(INITIAL_DEEP_LINK); } catch (_error) { return; }
    const section = url.searchParams.get("section");
    if (!section) return;
    window.setTimeout(() => navigateToNotification({
      category: "system",
      deepLink: INITIAL_DEEP_LINK,
      entityId: url.searchParams.get("taskId") || url.searchParams.get("shipmentId") || url.searchParams.get("assignmentId") || ""
    }), 0);
  }

  function resetSessionState() {
    stopRealtime();
    state.active = false;
    state.preview = false;
    state.sessionEndNotified = false;
    state.notifications = [];
    state.unreadCount = 0;
    state.nextCursor = "";
    state.preferences = { ...DEFAULT_PREFERENCES };
    state.capabilities = {};
    state.loading = false;
    state.pending.clear();
    state.lastLoadedAt = 0;
    state.initialDeepLinkConsumed = false;
    state.preferencesLoaded = false;
    updateUnreadUi();
  }

  function handleSectionChange(event) {
    handleInitialDeepLink();
    if (event && event.detail && event.detail.section === "profile" && !state.preferencesLoaded) void loadPreferences();
  }

  async function openDrawer() {
    if (!state.active || state.preview || !elements.personelNotificationDrawer) return;
    state.drawerOpen = true;
    state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.personelNotificationDrawer.hidden = false;
    if (elements.personelNotificationBackdrop) elements.personelNotificationBackdrop.hidden = false;
    elements.personelNotificationTrigger?.setAttribute("aria-expanded", "true");
    elements.personelNotificationTrigger?.setAttribute("aria-label", "Bildirimleri kapat");
    document.body.classList.add("is-personel-notification-open");
    window.requestAnimationFrame(() => elements.personelNotificationClose?.focus({ preventScroll: true }));
    const pending = [];
    if (!state.lastLoadedAt || Date.now() - state.lastLoadedAt > 10000) pending.push(loadNotifications());
    if (!state.preferencesLoaded) pending.push(loadPreferences());
    if (pending.length) await Promise.allSettled(pending);
  }

  function closeDrawer() {
    if (!state.drawerOpen && elements.personelNotificationDrawer?.hidden) return;
    state.drawerOpen = false;
    if (elements.personelNotificationDrawer) elements.personelNotificationDrawer.hidden = true;
    if (elements.personelNotificationBackdrop) elements.personelNotificationBackdrop.hidden = true;
    elements.personelNotificationTrigger?.setAttribute("aria-expanded", "false");
    elements.personelNotificationTrigger?.setAttribute("aria-label", "Bildirimleri aç");
    document.body.classList.remove("is-personel-notification-open");
    if (state.previousFocus && document.contains(state.previousFocus)) state.previousFocus.focus({ preventScroll: true });
    state.previousFocus = null;
  }

  function handleDocumentKeydown(event) {
    if (!state.drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab" || !elements.personelNotificationDrawer) return;
    const controls = Array.from(elements.personelNotificationDrawer.querySelectorAll("button:not(:disabled), input:not(:disabled), [href]"))
      .filter((node) => !node.hidden && node.offsetParent !== null);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleFilterClick(event) {
    const button = event.target.closest("[data-notification-category]");
    if (!button) return;
    state.category = button.dataset.notificationCategory || "all";
    elements.personelNotificationFilters.querySelectorAll("[data-notification-category]").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", active ? "true" : "false");
    });
    void loadNotifications();
  }

  async function loadNotifications(options = {}) {
    if (!state.active || state.preview || state.loading) return;
    const append = Boolean(options.append && state.nextCursor);
    state.loading = true;
    setListBusy(true, append);
    showMessage("");
    try {
      const parameters = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (state.category !== "all") parameters.set("category", state.category);
      if (state.unreadOnly) parameters.set("unread", "true");
      if (append) parameters.set("cursor", state.nextCursor);
      const result = await request(`${API_ROOT}?${parameters.toString()}`);
      const incoming = notificationArray(result).map(normalizeNotification).filter((item) => item.id);
      state.notifications = append ? mergeUnique(state.notifications, incoming) : incoming;
      state.nextCursor = String(result.nextCursor || result.cursor && result.cursor.next || "");
      applyUnreadCount(result);
      state.lastLoadedAt = Date.now();
      renderNotificationList();
    } catch (error) {
      showMessage(error.message || "Bildirimler alınamadı.", true);
      if (!state.notifications.length) renderNotificationList("error");
    } finally {
      state.loading = false;
      setListBusy(false);
    }
  }

  async function refreshUnreadCount() {
    if (!state.active || state.preview) return;
    try {
      const result = await request(`${API_ROOT}/unread-count`);
      applyUnreadCount(result);
    } catch (_error) {
      // SSE veya bir sonraki başarılı liste isteği sayacı tekrar eşitler.
    }
  }

  function notificationArray(result) {
    if (Array.isArray(result && result.notifications)) return result.notifications;
    if (Array.isArray(result && result.items)) return result.items;
    if (Array.isArray(result && result.data)) return result.data;
    return [];
  }

  function normalizeNotification(value) {
    const source = value && typeof value === "object" ? value : {};
    const severity = ["info", "success", "warning", "critical"].includes(source.severity) ? source.severity : "info";
    const category = normalizeCategory(source.category);
    return {
      id: String(source.id || ""),
      category,
      severity,
      title: String(source.title || "Bildirim"),
      body: String(source.body || ""),
      createdAt: String(source.createdAt || ""),
      readAt: source.readAt ? String(source.readAt) : "",
      archivedAt: source.archivedAt ? String(source.archivedAt) : "",
      entityType: String(source.entityType || ""),
      entityId: String(source.entityId || ""),
      deepLink: String(source.deepLink || ""),
      metadata: source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata : {}
    };
  }

  function normalizeCategory(value) {
    const text = String(value || "system").toLocaleLowerCase("tr-TR");
    if (/task|görev|todo|assignment/.test(text)) return "task";
    if (/shipment|sevkiyat/.test(text)) return "shipment";
    if (/shift|vardiya|izin/.test(text)) return "shift";
    if (/training|eğitim|recipe|reçete|exam|sınav/.test(text)) return "training";
    if (/stock|stok|inventory/.test(text)) return "stock";
    return "system";
  }

  function mergeUnique(current, incoming) {
    const map = new Map(current.map((item) => [item.id, item]));
    incoming.forEach((item) => map.set(item.id, item));
    return Array.from(map.values());
  }

  function applyUnreadCount(result) {
    const value = Number(result && (result.unreadCount ?? result.count));
    if (Number.isSafeInteger(value) && value >= 0) state.unreadCount = value;
    else state.unreadCount = state.notifications.filter((item) => !item.readAt && !item.archivedAt).length;
    updateUnreadUi();
  }

  function updateUnreadUi() {
    const count = Math.max(0, Number(state.unreadCount || 0));
    if (elements.personelNotificationBadge) {
      elements.personelNotificationBadge.textContent = count > 99 ? "99+" : String(count);
      elements.personelNotificationBadge.hidden = count === 0;
    }
    if (elements.personelNotificationUnreadText) elements.personelNotificationUnreadText.textContent = String(count);
    if (elements.personelNotificationTrigger) {
      elements.personelNotificationTrigger.setAttribute("aria-label", state.drawerOpen
        ? "Bildirimleri kapat"
        : count ? `Bildirimleri aç, ${count} okunmamış bildirim` : "Bildirimleri aç");
    }
    if (elements.personelNotificationReadAll) elements.personelNotificationReadAll.disabled = count === 0 || state.pending.has("read-all");
    document.title = count ? `(${count > 99 ? "99+" : count}) Tahmisçi Personel` : "Tahmisçi Personel";
  }

  function setListBusy(busy, appending) {
    if (elements.personelNotificationList) elements.personelNotificationList.setAttribute("aria-busy", busy ? "true" : "false");
    if (elements.personelNotificationLoadMore) elements.personelNotificationLoadMore.disabled = busy;
    if (busy && !appending && !state.notifications.length && elements.personelNotificationList) {
      elements.personelNotificationList.replaceChildren(createStateNode("loading"));
    }
  }

  function renderNotificationList(forceState) {
    const root = elements.personelNotificationList;
    if (!root) return;
    root.replaceChildren();
    if (forceState === "error") root.append(createStateNode("error"));
    else if (!state.notifications.length) root.append(createStateNode("empty"));
    else state.notifications.forEach((notification) => root.append(createNotificationCard(notification)));
    if (elements.personelNotificationLoadMore) elements.personelNotificationLoadMore.hidden = !state.nextCursor;
  }

  function createStateNode(kind) {
    const node = document.createElement("div");
    node.className = kind === "loading" ? "personel-notification-loading" : "personel-notification-empty";
    node.innerHTML = icon(kind === "error" ? "warning" : kind === "loading" ? "clock" : "bell");
    const title = document.createElement("strong");
    const text = document.createElement("span");
    if (kind === "loading") {
      title.textContent = "Bildirimler yükleniyor";
      text.textContent = "Güncel kayıtlar sunucudan alınıyor.";
    } else if (kind === "error") {
      title.textContent = "Bildirimler alınamadı";
      text.textContent = "Bağlantınızı kontrol edip yeniden deneyin.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ui-button ui-button--secondary ui-button--sm";
      retry.textContent = "Yeniden Dene";
      retry.addEventListener("click", () => loadNotifications());
      node.append(title, text, retry);
      return node;
    } else {
      title.textContent = state.unreadOnly ? "Okunmamış bildirim yok" : "Henüz bildirim yok";
      text.textContent = "Yeni görev, sevkiyat ve vardiya gelişmeleri burada görünecek.";
    }
    node.append(title, text);
    return node;
  }

  function createNotificationCard(notification) {
    const card = document.createElement("article");
    card.className = `personel-notification-card is-${notification.severity}${notification.readAt ? "" : " is-unread"}`;
    card.dataset.notificationId = notification.id;

    const iconNode = document.createElement("span");
    iconNode.className = "personel-notification-card__icon";
    iconNode.setAttribute("aria-hidden", "true");
    iconNode.innerHTML = icon(categoryIcon(notification.category));

    const copy = document.createElement("div");
    copy.className = "personel-notification-card__copy";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "personel-notification-card__open";
    open.dataset.notificationAction = "open";
    open.textContent = notification.title;
    const body = document.createElement("p");
    body.textContent = notification.body;
    const time = document.createElement("time");
    time.dateTime = notification.createdAt;
    time.textContent = relativeTime(notification.createdAt);
    time.title = absoluteTime(notification.createdAt);
    copy.append(open, body, time);

    const actions = document.createElement("div");
    actions.className = "personel-notification-card__actions";
    actions.append(
      actionButton(notification.readAt ? "unread" : "read", notification.readAt ? "Okunmadı işaretle" : "Okundu işaretle"),
      actionButton("archive", "Arşivle")
    );
    card.append(iconNode, copy, actions);
    return card;
  }

  function actionButton(action, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.notificationAction = action;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = icon(action === "archive" ? "archive" : action === "read" ? "check" : "dot");
    return button;
  }

  function handleListClick(event) {
    const action = event.target.closest("[data-notification-action]");
    const card = event.target.closest("[data-notification-id]");
    if (!action || !card) return;
    const notification = state.notifications.find((item) => item.id === card.dataset.notificationId);
    if (!notification) return;
    if (action.dataset.notificationAction === "open") void openNotification(notification, action);
    if (action.dataset.notificationAction === "read") void setNotificationRead(notification, true, action);
    if (action.dataset.notificationAction === "unread") void setNotificationRead(notification, false, action);
    if (action.dataset.notificationAction === "archive") void archiveNotification(notification, action);
  }

  async function openNotification(notification, button) {
    if (!notification.readAt) {
      const succeeded = await setNotificationRead(notification, true, button, { quiet: true });
      if (!succeeded) return;
    }
    closeDrawer();
    navigateToNotification(notification);
  }

  async function setNotificationRead(notification, read, button, options = {}) {
    const key = `${read ? "read" : "unread"}:${notification.id}`;
    if (state.pending.has(key)) return false;
    state.pending.add(key);
    setButtonBusy(button, true);
    try {
      const result = await request(`${API_ROOT}/${encodeURIComponent(notification.id)}/${read ? "read" : "unread"}`, { method: "PATCH" });
      const updated = result.notification ? normalizeNotification(result.notification) : { ...notification, readAt: read ? new Date().toISOString() : "" };
      state.notifications = state.notifications.map((item) => item.id === notification.id ? updated : item);
      if (read && state.unreadOnly) state.notifications = state.notifications.filter((item) => item.id !== notification.id);
      applyUnreadCount(result);
      renderNotificationList();
      return true;
    } catch (error) {
      if (!options.quiet) showMessage(error.message || "Bildirim durumu kaydedilemedi.", true);
      else showMessage(error.message || "Bildirim açılamadı.", true);
      return false;
    } finally {
      state.pending.delete(key);
      setButtonBusy(button, false);
    }
  }

  async function archiveNotification(notification, button) {
    const key = `archive:${notification.id}`;
    if (state.pending.has(key)) return;
    state.pending.add(key);
    setButtonBusy(button, true);
    try {
      const result = await request(`${API_ROOT}/${encodeURIComponent(notification.id)}/archive`, { method: "PATCH" });
      state.notifications = state.notifications.filter((item) => item.id !== notification.id);
      applyUnreadCount(result);
      renderNotificationList();
      showMessage("Bildirim arşivlendi.");
    } catch (error) {
      showMessage(error.message || "Bildirim arşivlenemedi.", true);
    } finally {
      state.pending.delete(key);
      setButtonBusy(button, false);
    }
  }

  async function markAllRead() {
    if (state.pending.has("read-all") || state.unreadCount === 0) return;
    state.pending.add("read-all");
    updateUnreadUi();
    setButtonBusy(elements.personelNotificationReadAll, true, "Kaydediliyor…");
    try {
      const result = await request(`${API_ROOT}/read-all`, { method: "POST" });
      const now = String(result.readAt || new Date().toISOString());
      state.notifications = state.notifications.map((item) => ({ ...item, readAt: item.readAt || now }));
      if (state.unreadOnly) state.notifications = [];
      state.unreadCount = Number.isSafeInteger(Number(result.unreadCount)) ? Number(result.unreadCount) : 0;
      updateUnreadUi();
      renderNotificationList();
      showMessage("Tüm bildirimler okundu olarak işaretlendi.");
    } catch (error) {
      showMessage(error.message || "Bildirimler güncellenemedi.", true);
    } finally {
      state.pending.delete("read-all");
      setButtonBusy(elements.personelNotificationReadAll, false);
      updateUnreadUi();
    }
  }

  function setButtonBusy(button, busy, text) {
    if (!button) return;
    if (!button.dataset.notificationOriginal) button.dataset.notificationOriginal = button.innerHTML;
    button.disabled = busy;
    if (busy) {
      button.setAttribute("aria-busy", "true");
      if (text) button.textContent = text;
    } else {
      button.removeAttribute("aria-busy");
      button.innerHTML = button.dataset.notificationOriginal;
    }
  }

  function showMessage(message, error) {
    if (!elements.personelNotificationMessage) return;
    elements.personelNotificationMessage.textContent = message || "";
    elements.personelNotificationMessage.classList.toggle("is-error", Boolean(message && error));
  }

  async function loadPreferences() {
    if (!state.active || state.preview) return;
    setPreferencesMessage("Tercihler yükleniyor…");
    try {
      const result = await request(`${API_ROOT}/preferences`);
      state.preferences = { ...DEFAULT_PREFERENCES, ...(result.preferences || result.data || {}) };
      state.capabilities = result.capabilities && typeof result.capabilities === "object" ? { ...result.capabilities } : {};
      if (result.vapidPublicKey && !state.capabilities.vapidPublicKey) state.capabilities.vapidPublicKey = result.vapidPublicKey;
      state.preferencesLoaded = true;
      fillPreferencesForm();
      await renderPushState();
      setPreferencesMessage("");
    } catch (error) {
      setPreferencesMessage(error.message || "Bildirim tercihleri alınamadı.", true);
      renderPushState();
    }
  }

  function fillPreferencesForm() {
    const form = elements.personelNotificationPreferencesForm;
    if (!form) return;
    BOOLEAN_PREFERENCES.forEach((name) => {
      if (form.elements[name]) form.elements[name].checked = Boolean(state.preferences[name]);
    });
    if (form.elements.emailAddress) form.elements.emailAddress.value = state.preferences.emailAddress || "";
    if (form.elements.quietHoursStart) form.elements.quietHoursStart.value = state.preferences.quietHoursStart || "22:00";
    if (form.elements.quietHoursEnd) form.elements.quietHoursEnd.value = state.preferences.quietHoursEnd || "07:00";
    toggleQuietHourInputs();
    if (form.elements.quietHoursEnabled && !form.elements.quietHoursEnabled.dataset.bound) {
      form.elements.quietHoursEnabled.dataset.bound = "true";
      form.elements.quietHoursEnabled.addEventListener("change", toggleQuietHourInputs);
    }
  }

  function toggleQuietHourInputs() {
    const form = elements.personelNotificationPreferencesForm;
    if (!form) return;
    const enabled = Boolean(form.elements.quietHoursEnabled?.checked);
    [form.elements.quietHoursStart, form.elements.quietHoursEnd].forEach((input) => {
      if (input) input.disabled = !enabled;
    });
  }

  function readPreferencesForm() {
    const form = elements.personelNotificationPreferencesForm;
    const next = { ...state.preferences, timezone: "Europe/Istanbul" };
    BOOLEAN_PREFERENCES.forEach((name) => { next[name] = Boolean(form?.elements[name]?.checked); });
    next.emailAddress = String(form?.elements.emailAddress?.value || "").trim().toLocaleLowerCase("tr-TR");
    next.quietHoursStart = String(form?.elements.quietHoursStart?.value || "22:00");
    next.quietHoursEnd = String(form?.elements.quietHoursEnd?.value || "07:00");
    next.pushEnabled = Boolean(state.preferences.pushEnabled);
    return next;
  }

  async function savePreferences(event) {
    event.preventDefault();
    if (!state.active || state.preview || state.pending.has("preferences")) return;
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const payload = readPreferencesForm();
    if (payload.emailEnabled && !isValidEmail(payload.emailAddress)) {
      setPreferencesMessage("E-posta bildirimleri için geçerli bir adres girin.", true);
      elements.personelNotificationEmail?.focus();
      return;
    }
    state.pending.add("preferences");
    setButtonBusy(button, true, "Kaydediliyor…");
    setPreferencesMessage("");
    try {
      const result = await request(`${API_ROOT}/preferences`, { method: "PUT", body: payload });
      state.preferences = { ...DEFAULT_PREFERENCES, ...(result.preferences || payload) };
      state.capabilities = result.capabilities && typeof result.capabilities === "object" ? result.capabilities : state.capabilities;
      fillPreferencesForm();
      await renderPushState();
      setPreferencesMessage("Bildirim tercihleri kaydedildi.");
      document.dispatchEvent(new CustomEvent("tahmisci:pwa-form-clean", { detail: { form } }));
    } catch (error) {
      setPreferencesMessage(error.message || "Bildirim tercihleri kaydedilemedi.", true);
    } finally {
      state.pending.delete("preferences");
      setButtonBusy(button, false);
    }
  }

  function setPreferencesMessage(message, error) {
    if (!elements.personelNotificationPreferencesState) return;
    elements.personelNotificationPreferencesState.textContent = message || "";
    elements.personelNotificationPreferencesState.classList.toggle("is-error", Boolean(message && error));
  }

  async function renderPushState() {
    const supported = supportsPush();
    const key = vapidPublicKey();
    let subscription = null;
    if (supported) subscription = await currentSubscription().catch(() => null);
    if (!elements.personelPushToggle || !elements.personelPushStatus) return;

    if (!supported) {
      elements.personelPushStatus.textContent = "Bu tarayıcı PWA bildirimlerini desteklemiyor. Uygulama içi bildirimler açık kalır.";
      elements.personelPushToggle.textContent = "Desteklenmiyor";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      elements.personelPushStatus.textContent = "Bildirim izni tarayıcı ayarlarından engellenmiş.";
      elements.personelPushToggle.textContent = "Tarayıcıdan engellendi";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (!key) {
      elements.personelPushStatus.textContent = "Web Push sunucuda yapılandırılmamış. Uygulama içi bildirimler çalışmaya devam eder.";
      elements.personelPushToggle.textContent = "Yapılandırılmamış";
      elements.personelPushToggle.disabled = true;
      return;
    }
    elements.personelPushToggle.disabled = state.pending.has("push");
    if (subscription) {
      elements.personelPushStatus.textContent = "Bu cihaz bildirim almaya hazır.";
      elements.personelPushToggle.textContent = "Tarayıcı bildirimlerini kapat";
      elements.personelPushToggle.dataset.pushAction = "disable";
    } else {
      elements.personelPushStatus.textContent = Notification.permission === "granted"
        ? "İzin verildi; bu cihaz henüz abone değil."
        : "İzin yalnızca düğmeye bastığınızda istenir.";
      elements.personelPushToggle.textContent = "Bildirimleri etkinleştir";
      elements.personelPushToggle.dataset.pushAction = "enable";
    }
  }

  async function togglePushSubscription() {
    if (!state.active || state.preview || state.pending.has("push") || !supportsPush()) return;
    state.pending.add("push");
    elements.personelPushToggle.disabled = true;
    try {
      const subscription = await currentSubscription();
      if (subscription || elements.personelPushToggle.dataset.pushAction === "disable") await disablePush(subscription);
      else await enablePush();
      await renderPushState();
    } catch (error) {
      setPreferencesMessage(error.message || "Tarayıcı bildirimi ayarlanamadı.", true);
    } finally {
      state.pending.delete("push");
      await renderPushState();
    }
  }

  async function enablePush() {
    const key = vapidPublicKey();
    if (!key) throw new Error("Web Push sunucuda yapılandırılmamış.");
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      await renderPushState();
      throw new Error("Bildirim izni verilmedi. İsterseniz tarayıcı site ayarlarından değiştirebilirsiniz.");
    }
    const registration = await ensurePersonelServiceWorker();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(key)
      });
    }
    await request(`${API_ROOT}/push-subscriptions`, {
      method: "POST",
      body: { subscription: subscription.toJSON() }
    });
    state.preferences.pushEnabled = true;
    await persistPushPreference(true);
    setPreferencesMessage("Tarayıcı bildirimleri bu cihaz için etkinleştirildi.");
  }

  async function disablePush(existingSubscription) {
    const subscription = existingSubscription || await currentSubscription().catch(() => null);
    if (subscription) {
      await request(`${API_ROOT}/push-subscriptions`, {
        method: "DELETE",
        body: { endpoint: subscription.endpoint }
      });
      await subscription.unsubscribe().catch(() => false);
    }
    state.preferences.pushEnabled = false;
    await persistPushPreference(false);
    setPreferencesMessage("Tarayıcı bildirimleri bu cihaz için kapatıldı.");
  }

  async function persistPushPreference(enabled) {
    const payload = { ...readPreferencesForm(), pushEnabled: Boolean(enabled) };
    const result = await request(`${API_ROOT}/preferences`, { method: "PUT", body: payload });
    state.preferences = { ...DEFAULT_PREFERENCES, ...(result.preferences || payload) };
    fillPreferencesForm();
  }

  async function beforeLogout() {
    stopRealtime();
    if (!state.active || !supportsPush()) return;
    const subscription = await currentSubscription().catch(() => null);
    if (!subscription) return;
    await request(`${API_ROOT}/push-subscriptions`, {
      method: "DELETE",
      body: { endpoint: subscription.endpoint }
    }).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
  }

  function supportsPush() {
    return Boolean(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }

  function vapidPublicKey() {
    return String(state.capabilities.vapidPublicKey || state.capabilities.publicKey || state.capabilities.vapidKey || "").trim();
  }

  async function ensurePersonelServiceWorker() {
    const existing = await navigator.serviceWorker.getRegistration("/personel/");
    if (existing) return existing;
    return navigator.serviceWorker.register("/personel/sw.js", { scope: "/personel/", updateViaCache: "none" });
  }

  async function currentSubscription() {
    if (!supportsPush()) return null;
    const registration = await navigator.serviceWorker.getRegistration("/personel/");
    return registration ? registration.pushManager.getSubscription() : null;
  }

  function decodeBase64Url(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  function connectEvents() {
    if (!state.active || state.preview || !window.EventSource || navigator.onLine === false || state.eventSource) {
      if (!window.EventSource) startPolling();
      return;
    }
    const source = new EventSource(`${API_ROOT}/events`, { withCredentials: true });
    state.eventSource = source;
    source.addEventListener("open", () => {
      state.reconnectAttempt = 0;
      stopPolling();
    });
    source.addEventListener("notification", handleNotificationEvent);
    source.addEventListener("unread-count", handleUnreadEvent);
    source.addEventListener("message", handleNotificationEvent);
    source.addEventListener("error", () => {
      if (state.eventSource === source) {
        source.close();
        state.eventSource = null;
      }
      if (!state.active) return;
      startPolling();
      scheduleReconnect();
    });
  }

  function handleNotificationEvent(event) {
    let payload;
    try { payload = JSON.parse(event.data || "{}"); } catch (_error) { return; }
    const source = payload.notification || payload.data || (payload.id ? payload : null);
    if (!source) {
      applyUnreadCount(payload);
      return;
    }
    const notification = normalizeNotification(source);
    if (!notification.id || notification.archivedAt) return;
    if (matchesCurrentFilter(notification)) {
      state.notifications = mergeUnique([notification], state.notifications.filter((item) => item.id !== notification.id));
      renderNotificationList();
    }
    if (Number.isSafeInteger(Number(payload.unreadCount))) applyUnreadCount(payload);
    else {
      state.unreadCount += notification.readAt ? 0 : 1;
      updateUnreadUi();
    }
  }

  function handleUnreadEvent(event) {
    try { applyUnreadCount(JSON.parse(event.data || "{}")); } catch (_error) {}
  }

  function matchesCurrentFilter(notification) {
    if (state.category !== "all" && notification.category !== state.category) return false;
    return !state.unreadOnly || !notification.readAt;
  }

  function scheduleReconnect() {
    if (state.reconnectTimer || !state.active || navigator.onLine === false) return;
    const delay = Math.min(MAX_RECONNECT_MS, 1000 * (2 ** Math.min(state.reconnectAttempt, 5)));
    state.reconnectAttempt += 1;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      connectEvents();
    }, delay);
  }

  function startPolling() {
    if (state.pollTimer || !state.active || state.preview) return;
    state.pollTimer = window.setInterval(() => {
      void refreshUnreadCount();
      if (state.drawerOpen) void loadNotifications();
    }, FALLBACK_POLL_MS);
  }

  function stopPolling() {
    if (!state.pollTimer) return;
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function stopRealtime() {
    if (state.eventSource) state.eventSource.close();
    state.eventSource = null;
    if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    stopPolling();
  }

  function handleOnline() {
    if (!state.active) return;
    void refreshUnreadCount();
    connectEvents();
  }

  function navigateToNotification(notification) {
    const destination = resolveDestination(notification);
    const button = document.querySelector(`.personel-nav [data-section="${destination.section}"]`);
    if (!button) {
      document.querySelector('.personel-nav [data-section="recipe"]')?.click();
      return;
    }
    button.click();
    if (destination.section === "tasks" && destination.entityId) {
      waitForElement(`[data-task-toggle="${cssEscape(destination.entityId)}"]`, (target) => {
        if (target.getAttribute("aria-expanded") !== "true") target.click();
        target.closest(".wf-task-card")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      });
    } else if (destination.section === "shipment") {
      waitForElement(".wf-history-card, .wf-history-list, .wf-shipment-side", (target) => target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }));
    } else if (destination.section === "shift" && destination.weekStart) {
      waitForElement(".wf-week-controls", () => alignShiftWeek(destination.weekStart));
    } else if (destination.section === "recipe" && destination.entityId) {
      window.setTimeout(() => {
        elements.recipeFrame?.contentWindow?.postMessage({
          type: "tahmisci:open-recipe-assignment",
          entityId: destination.entityId
        }, window.location.origin);
      }, 500);
    }
  }

  function resolveDestination(notification) {
    const fallback = { section: CATEGORY_SECTIONS[notification.category] || "recipe", entityId: notification.entityId || "", weekStart: "" };
    if (!notification.deepLink) return fallback;
    try {
      const url = new URL(notification.deepLink, window.location.origin);
      if (url.origin !== window.location.origin || !(url.pathname === "/personel" || url.pathname.startsWith("/personel/"))) return fallback;
      const section = normalizePersonelNotificationSection(url.searchParams.get("section"))
        || normalizePersonelNotificationSection(url.hash && decodeURIComponent(url.hash.slice(1)))
        || sectionFromPath(url.pathname)
        || fallback.section;
      if (!Object.values(CATEGORY_SECTIONS).includes(section)) return fallback;
      return {
        section,
        entityId: url.searchParams.get("taskId") || url.searchParams.get("entityId") || url.searchParams.get("assignmentId") || fallback.entityId,
        weekStart: validDateKey(url.searchParams.get("weekStart"))
      };
    } catch (_error) {
      return fallback;
    }
  }

  function sectionFromPath(pathname) {
    if (/yapilacaklar|tasks/i.test(pathname)) return "tasks";
    if (/sevkiyat|shipment/i.test(pathname)) return "shipment";
    if (/shift|vardiya/i.test(pathname)) return "shift";
    if (/stok|stock/i.test(pathname)) return "stock";
    if (/recete|recipe|egitim|training/i.test(pathname)) return "recipe";
    return "";
  }

  function normalizePersonelNotificationSection(value) {
    const text = String(value || "").trim().toLocaleLowerCase("tr-TR");
    const aliases = {
      task: "tasks", tasks: "tasks", gorev: "tasks", görev: "tasks", yapilacaklar: "tasks", yapılacaklar: "tasks",
      shipment: "shipment", shipments: "shipment", sevkiyat: "shipment",
      shift: "shift", shifts: "shift", vardiya: "shift",
      recipe: "recipe", recete: "recipe", reçete: "recipe", training: "recipe", egitim: "recipe", eğitim: "recipe",
      stock: "stock", stok: "stock",
      profile: "profile", profil: "profile"
    };
    return aliases[text] || "";
  }

  function alignShiftWeek(weekStart) {
    const target = startOfWeekDate(new Date(`${weekStart}T12:00:00`));
    const current = startOfWeekDate(new Date());
    if (!Number.isFinite(target.getTime()) || !Number.isFinite(current.getTime())) return;
    const weekDifference = Math.round((target.getTime() - current.getTime()) / 604800000);
    document.querySelector('.wf-week-controls [data-week="today"]')?.click();
    const direction = weekDifference < 0 ? "-1" : "1";
    for (let index = 0; index < Math.min(104, Math.abs(weekDifference)); index += 1) {
      document.querySelector(`.wf-week-controls [data-week="${direction}"]`)?.click();
    }
    document.querySelector(".wf-shift-head")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function waitForElement(selector, callback) {
    const existing = document.querySelector(selector);
    if (existing) {
      callback(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const target = document.querySelector(selector);
      if (!target) return;
      observer.disconnect();
      callback(target);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    const init = { method, credentials: "include", headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İstek tamamlanamadı.");
      error.status = response.status;
      if ((response.status === 401 || response.status === 403) && state.active && !state.sessionEndNotified) {
        state.sessionEndNotified = true;
        stopRealtime();
        document.dispatchEvent(new CustomEvent("personel:session-ended", {
          detail: { source: "personel-notifications", status: response.status, message: error.message }
        }));
      }
      throw error;
    }
    return result;
  }

  function categoryIcon(category) {
    if (category === "task") return "checklist";
    if (category === "shipment") return "truck";
    if (category === "shift") return "calendar";
    if (category === "training") return "book";
    if (category === "stock") return "box";
    return "bell";
  }

  function icon(name) {
    const paths = {
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
      checklist: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M14 9h2M8 15l1.5 1.5L12 14M14 15h2"/>',
      truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18"/>',
      book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4z"/>',
      box: '<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>',
      archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      dot: '<circle cx="12" cy="12" r="4"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      warning: '<path d="M12 3 2.5 20h19zM12 9v4M12 17h.01"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.bell}</svg>`;
  }

  function relativeTime(value) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "Zaman bilgisi yok";
    const difference = time - Date.now();
    const absolute = Math.abs(difference);
    const formatter = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });
    if (absolute < 60000) return "şimdi";
    if (absolute < 3600000) return formatter.format(Math.round(difference / 60000), "minute");
    if (absolute < 86400000) return formatter.format(Math.round(difference / 3600000), "hour");
    if (absolute < 604800000) return formatter.format(Math.round(difference / 86400000), "day");
    return absoluteTime(value);
  }

  function absoluteTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Zaman bilgisi yok";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(date);
  }

  function validDateKey(value) {
    const text = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function startOfWeekDate(value) {
    const date = new Date(value);
    const day = date.getDay() || 7;
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")) && String(value).length <= 254;
  }

  function cssEscape(value) {
    return window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(String(value))
      : String(value).replace(/["\\]/g, "\\$&");
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  window.TahmisciPersonelNotifications = Object.freeze({
    beforeLogout,
    refresh: () => Promise.allSettled([loadNotifications(), loadPreferences()]),
    open: openDrawer,
    close: closeDrawer
  });
})();
