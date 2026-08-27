(function () {
  "use strict";

  const PREVIEW_TOKEN = readPreviewToken();
  const PREVIEW_SECTION = readPreviewSection();
  const SIDEBAR_KEY = "tahmisci.personel.sidebarCollapsed.v1";
  const LAST_SECTION_KEY = "tahmisci.personel.lastSection.v1";
  const MOBILE_SIDEBAR_QUERY = "(max-width: 880px)";
  const WORKFORCE_SECTIONS = new Set(["tasks", "shipment", "shift"]);
  const lazyResources = new Map();

  const sectionMeta = {
    recipe: {
      kicker: "Personel",
      title: "Reçete",
      description: "Reçete arayüzünü kullanın."
    },
    stock: {
      kicker: "Personel",
      title: "Stok",
      description: "Ürünlerin güncel stok durumunu görüntüleyin."
    },
    profile: {
      kicker: "Personel",
      title: "Profil",
      description: "Kendi personel profilinizi düzenleyin."
    },
    tasks: {
      kicker: "Tahmisçi Coffee",
      title: "Yapılacaklar",
      description: "Size atanan görevleri ve günlük ilerlemenizi takip edin."
    },
    shipment: {
      kicker: "Tahmisçi Coffee",
      title: "Sevkiyat",
      description: "Gelen stok ürünlerini yönetici onayına bildirin."
    },
    shift: {
      kicker: "Tahmisçi Coffee",
      title: "Shift",
      description: "Yayınlanan vardiyalarınızı görüntüleyin ve talep gönderin."
    }
  };

  const state = {
    user: null,
    section: "recipe",
    stock: emptyStockState(),
    stockEventSource: null,
    stockLoaded: false,
    stockLoadPromise: null,
    stockRevision: 0,
    stockSearchTimer: null,
    stockRefreshTimer: null,
    stockRefreshPending: false,
    previewRecipeDraft: null,
    query: "",
    category: "all",
    detailProductId: null,
    detailTrigger: null,
    stockAction: null,
    stockActionTrigger: null,
    stockActionSubmitting: false,
    stockHistoryLoadPromise: null,
    stockHistoryLoadProductId: "",
    stockReversePendingId: "",
    pendingProfileAvatar: "",
    mobileSidebar: false,
    sessionActive: false,
    sessionPreview: false,
    notificationUnreadCount: 0,
    notificationUnreadLoaded: false,
    notificationUnreadLoadedAt: 0,
    notificationBadgePromise: null,
    logoutPending: false
  };

  const els = {};

  window.TahmisciPersonelShell = Object.freeze({
    getContext: personelShellContext,
    ensureWorkforce: ensureWorkforceModule,
    ensureNotifications: ensureNotificationsModule,
    ensureAccountSecurity: ensureAccountSecurityModule
  });

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    [
      "personelApp", "personelLogin", "personelDashboard", "personelLoginForm", "personelUsername", "personelPassword",
      "loginMessage", "personelSidebarToggle", "personelSidebar", "personelSidebarOverlay", "sectionKicker", "sectionTitle",
      "sectionDescription", "sectionRecipe", "sectionStock", "sectionProfile", "sectionTasks", "sectionShipment", "sectionShift", "sidebarUser", "profilePopover",
      "profileMenuAvatar", "profileMenuName", "profileMenuRole", "profileMenuMessage",
      "recipeFrame", "stockMessage", "stockSearchInput", "stockCategoryPills", "stockGrid",
      "profileForm", "profileName", "profilePhone", "profileAvatarUrl", "profilePhotoInput", "profileBio",
      "profileMessage", "profileAvatar", "personelNotificationTrigger", "personelNotificationBadge", "personelNotificationUnreadText",
      "personelNotificationPreferencesState", "personelAccountSecurityMessage",
      "stockDetailModal", "stockDetailClose", "stockDetailCategory", "stockDetailTitle", "stockDetailStatus",
      "stockDetailQuantity", "stockDetailActions", "stockDetailMessage",
      "stockActionModal", "stockActionForm", "stockActionClose", "stockActionKicker", "stockActionTitle", "stockActionProduct",
      "stockActionLocation", "stockActionCurrent", "stockActionConversion", "stockActionQuantity", "stockActionUnit", "stockQuickAmounts",
      "stockActionConverted", "stockActionAfter", "stockActionNote", "stockActionMessage", "stockActionCancel", "stockActionSubmit"
    ].forEach((id) => { els[id] = document.getElementById(id); });

    setView("booting");
    bindEvents();
    await boot();
  }

  function bindEvents() {
    document.addEventListener("tahmisci:preview-draft", handlePreviewDraftMessage);
    document.addEventListener("personel:session-ended", handlePersonelSessionEnded);
    if (els.personelLoginForm) els.personelLoginForm.addEventListener("submit", login);
    if (els.personelSidebarToggle) els.personelSidebarToggle.addEventListener("click", () => {
      const collapsed = !isSidebarCollapsed();
      setSidebarCollapsed(collapsed, { focusDrawer: !collapsed });
    });
    if (els.personelSidebarOverlay) els.personelSidebarOverlay.addEventListener("click", () => {
      setSidebarCollapsed(true, { persist: false, restoreFocus: true });
    });

    if (els.sidebarUser) els.sidebarUser.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleProfilePopover();
    });

    if (els.personelNotificationTrigger) els.personelNotificationTrigger.addEventListener("click", async (event) => {
      if (window.TahmisciPersonelNotifications) return;
      event.preventDefault();
      els.personelNotificationTrigger.setAttribute("aria-busy", "true");
      try {
        await ensureNotificationsModule();
        if (state.sessionActive) await window.TahmisciPersonelNotifications?.open?.();
      } catch (_error) {
        els.personelNotificationTrigger.setAttribute("title", "Bildirimler yüklenemedi. Yeniden deneyin.");
      } finally {
        els.personelNotificationTrigger.removeAttribute("aria-busy");
      }
    });

    if (els.profilePopover) els.profilePopover.addEventListener("click", (event) => {
      const action = event.target.closest("[data-profile-action]");
      if (!action) return;
      if (action.dataset.profileAction === "photo") {
        closeProfilePopover();
        setSection("profile", { updateHash: false });
        setTimeout(() => els.profilePhotoInput && els.profilePhotoInput.click(), 80);
      }
      if (action.dataset.profileAction === "edit") {
        closeProfilePopover();
        setSection("profile", { updateHash: false });
      }
      if (action.dataset.profileAction === "notifications") {
        closeProfilePopover();
        setSection("profile", { updateHash: false });
        void Promise.all([ensureNotificationsModule(), ensureAccountSecurityModule()]).then(() => {
          document.getElementById("personelNotificationPreferencesForm")?.scrollIntoView({ block: "start" });
        }).catch(() => setProfileMenuMessage("Bildirim ayarları yüklenemedi."));
      }
      if (action.dataset.profileAction === "logout") {
        closeProfilePopover();
        logout();
      }
    });
    if (els.profilePopover) els.profilePopover.addEventListener("keydown", handleProfileMenuKeydown);

    document.querySelectorAll(".personel-nav [data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        setSection(button.dataset.section, { updateHash: false });
        if (isMobileSidebar()) setSidebarCollapsed(true, { persist: false, restoreFocus: true });
      });
    });

    if (els.stockSearchInput) els.stockSearchInput.addEventListener("input", () => {
      window.clearTimeout(state.stockSearchTimer);
      state.stockSearchTimer = window.setTimeout(() => {
        state.query = els.stockSearchInput.value.trim();
        renderStock();
      }, 200);
    });

    if (els.stockCategoryPills) els.stockCategoryPills.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category || "all";
      renderStock();
    });

    if (els.stockGrid) els.stockGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-stock-product-id]");
      if (card) openStockDetail(card.dataset.stockProductId);
    });

    if (els.stockGrid) els.stockGrid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("button")) return;
      const card = event.target.closest("[data-stock-product-id]");
      if (!card) return;
      event.preventDefault();
      openStockDetail(card.dataset.stockProductId);
    });

    if (els.stockDetailClose) {
      els.stockDetailClose.addEventListener("pointerdown", (event) => event.stopPropagation());
      els.stockDetailClose.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeStockDetail();
      });
    }
    if (els.stockDetailModal) els.stockDetailModal.addEventListener("click", (event) => {
      if (event.target === els.stockDetailModal) closeStockDetail();
    });
    if (els.stockDetailActions) els.stockDetailActions.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stock-detail-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.stockDetailAction;
      openStockAction(action, button);
    });
    if (els.stockActionClose) {
      els.stockActionClose.addEventListener("pointerdown", (event) => event.stopPropagation());
      els.stockActionClose.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeStockAction();
      });
    }
    if (els.stockActionCancel) els.stockActionCancel.addEventListener("click", closeStockAction);
    if (els.stockActionModal) els.stockActionModal.addEventListener("click", (event) => {
      if (event.target === els.stockActionModal && !state.stockActionSubmitting) closeStockAction();
    });
    if (els.stockActionForm) els.stockActionForm.addEventListener("submit", submitStockAction);
    if (els.stockActionQuantity) els.stockActionQuantity.addEventListener("input", renderStockActionPreview);
    if (els.stockActionUnit) els.stockActionUnit.addEventListener("change", renderStockActionPreview);
    if (els.stockQuickAmounts) els.stockQuickAmounts.addEventListener("click", (event) => {
      const button = event.target.closest("[data-quick-quantity]");
      if (!button || state.stockActionSubmitting) return;
      if (els.stockActionQuantity) els.stockActionQuantity.value = button.dataset.quickQuantity || "1";
      if (els.stockActionUnit && button.dataset.quickUnit) els.stockActionUnit.value = button.dataset.quickUnit;
      renderStockActionPreview();
      els.stockActionQuantity && els.stockActionQuantity.focus();
    });

    if (els.profileForm) els.profileForm.addEventListener("submit", saveProfile);
    if (els.profilePhotoInput) els.profilePhotoInput.addEventListener("change", previewProfilePhoto);
    if (els.recipeFrame) els.recipeFrame.addEventListener("load", () => {
      compactRecipeFrame();
      forwardRecipePreviewDraft();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && trapStockModalFocus(event)) return;
      if (event.key === "Tab" && trapPersonelDrawerFocus(event)) return;
      if (event.key === "Escape") {
        if (state.stockAction) {
          if (!state.stockActionSubmitting) closeStockAction();
          return;
        }
        if (els.stockDetailModal && !els.stockDetailModal.hidden) {
          closeStockDetail();
          return;
        }
        closeStockDetail();
        closeProfilePopover({ restoreFocus: true });
        if (isMobileSidebar() && !isSidebarCollapsed()) {
          setSidebarCollapsed(true, { persist: false, restoreFocus: true });
        }
      }
    });

    document.addEventListener("click", (event) => {
      if (!els.profilePopover || els.profilePopover.hidden) return;
      if (event.target.closest("#profilePopover") || event.target.closest("#sidebarUser")) return;
      closeProfilePopover();
    });

    document.addEventListener("click", (event) => {
      if (!isMobileSidebar() || isSidebarCollapsed()) return;
      if (event.target.closest("#personelSidebar") || event.target.closest("#personelSidebarToggle")) return;
      setSidebarCollapsed(true, { persist: false, restoreFocus: true });
    });

    window.addEventListener("resize", syncSidebarBreakpoint);
  }

  function handlePreviewDraftMessage(event) {
    const payload = event.detail;
    if (!payload || payload.type !== "tahmisci:preview-draft" || payload.schemaVersion !== 1) return;
    if (payload.scope === "stock" && payload.data && typeof payload.data === "object") {
      const stockDraft = payload.data.stockState && typeof payload.data.stockState === "object"
        ? payload.data.stockState
        : payload.data;
      state.stock = normalizeStock(stockDraft);
      renderStock();
    }
    if (payload.scope === "recipe" && payload.data && typeof payload.data === "object") {
      state.previewRecipeDraft = payload.data.recipeState && typeof payload.data.recipeState === "object"
        ? payload.data.recipeState
        : payload.data;
      forwardRecipePreviewDraft();
    }
  }

  function forwardRecipePreviewDraft() {
    if (!state.previewRecipeDraft || !els.recipeFrame || !els.recipeFrame.contentWindow) return;
    if (els.recipeFrame.getAttribute("src") === "about:blank") return;
    els.recipeFrame.contentWindow.postMessage({
      type: "tahmisci:preview-draft",
      schemaVersion: 1,
      scope: "recipes",
      data: state.previewRecipeDraft,
      source: "personel",
      draft: true
    }, window.location.origin);
  }

  async function boot() {
    try {
      const session = await api("/api/recipe/me");
      activatePersonelSession(session);
      showDashboard();
      if (!PREVIEW_TOKEN) history.replaceState(null, "", "/personel/");
      setSection(PREVIEW_SECTION || readLastSection(), { updateHash: false, persist: false });
    } catch (_error) {
      showLogin();
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginMessage("");
    const username = els.personelUsername ? els.personelUsername.value.trim() : "";
    const password = els.personelPassword ? els.personelPassword.value : "";
    if (!password) {
      setLoginMessage("Şifre gerekli.");
      return;
    }

    try {
      await api("/api/recipe/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      const session = await api("/api/recipe/me");
      activatePersonelSession(session);
      showDashboard();
      history.replaceState(null, "", "/personel/");
      setSection("recipe", { updateHash: false });
    } catch (error) {
      setLoginMessage(error.message || "Giriş yapılamadı.");
    }
  }

  async function logout() {
    if (state.logoutPending) return;
    state.logoutPending = true;
    setProfileMenuMessage("");
    const logoutButton = els.profilePopover && els.profilePopover.querySelector('[data-profile-action="logout"]');
    const originalLabel = logoutButton ? logoutButton.textContent : "";
    if (logoutButton) {
      logoutButton.disabled = true;
      logoutButton.setAttribute("aria-busy", "true");
      logoutButton.textContent = "Çıkış yapılıyor…";
    }
    try {
      if (window.TahmisciPersonelNotifications && typeof window.TahmisciPersonelNotifications.beforeLogout === "function") {
        await window.TahmisciPersonelNotifications.beforeLogout().catch(() => null);
      }
      const response = await fetch("/api/recipe/logout", { method: "POST", credentials: "include" });
      if (!response.ok && response.status !== 401) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Çıkış işlemi tamamlanamadı.");
      }
      localStorage.removeItem(LAST_SECTION_KEY);
      if (state.sessionActive) {
        document.dispatchEvent(new CustomEvent("personel:session-ended", {
          detail: { source: "personel-shell", reason: "logout", message: "" }
        }));
        return;
      }
      resetPersonelSession();
      showLogin();
    } catch (error) {
      setProfileMenuMessage(error && error.message || "Çıkış işlemi tamamlanamadı.");
      if (els.profilePopover) els.profilePopover.hidden = false;
      if (els.sidebarUser) els.sidebarUser.setAttribute("aria-expanded", "true");
    } finally {
      state.logoutPending = false;
      if (logoutButton && logoutButton.isConnected) {
        logoutButton.disabled = false;
        logoutButton.removeAttribute("aria-busy");
        logoutButton.textContent = originalLabel || "Çıkış yap";
      }
    }
  }

  function activatePersonelSession(session) {
    const user = session && (session.user || session.recipeUser) || null;
    const userId = String(session && session.userId || user && user.id || "").trim();
    if (!user || !userId || user.active === false) {
      const error = new Error("Aktif personel hesabı bulunamadı. Lütfen personel girişi yapın.");
      error.status = 403;
      throw error;
    }
    state.user = mergeProfile({ ...user, id: userId });
    state.sessionActive = true;
    state.sessionPreview = session.role === "preview";
    document.dispatchEvent(new CustomEvent("personel:session-started", {
      detail: { userId, preview: state.sessionPreview }
    }));
    if (!state.sessionPreview) void loadNotificationUnreadBadge();
  }

  function handlePersonelSessionEnded(event) {
    const detail = event && event.detail || {};
    const message = detail.reason === "logout"
      ? ""
      : detail.message || "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.";
    resetPersonelSession();
    closeProfilePopover();
    if (history.replaceState) history.replaceState(null, "", "/personel/");
    showLogin();
    setLoginMessage(message);
  }

  function resetPersonelSession() {
    state.sessionActive = false;
    state.sessionPreview = false;
    state.user = null;
    state.stock = emptyStockState();
    state.stockLoaded = false;
    state.stockLoadPromise = null;
    window.clearTimeout(state.stockSearchTimer);
    window.clearTimeout(state.stockRefreshTimer);
    state.stockSearchTimer = null;
    state.stockRefreshTimer = null;
    state.stockRefreshPending = false;
    state.stockRevision = 0;
    state.notificationUnreadCount = 0;
    state.notificationUnreadLoaded = false;
    state.notificationUnreadLoadedAt = 0;
    state.notificationBadgePromise = null;
    renderNotificationUnreadBadge(0);
  }

  function showLogin() {
    closeStockEvents();
    unloadRecipeFrame();
    setView("login");
    if (els.personelPassword) els.personelPassword.value = "";
  }

  function showDashboard() {
    setView("dashboard");
    applySidebarPreference();
    renderUser();
    fillProfileForm();
  }

  function setView(view) {
    const isLogin = view === "login";
    const isDashboard = view === "dashboard";
    toggleRoot(els.personelLogin, isLogin);
    toggleRoot(els.personelDashboard, isDashboard);
    if (els.personelApp) els.personelApp.dataset.view = view;
    document.body.classList.toggle("is-personel-authenticated", isDashboard);
    if (!isDashboard) document.body.classList.remove("is-personel-drawer-open");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function toggleRoot(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.classList.toggle("is-hidden", !visible);
    element.style.display = visible ? "" : "none";
  }

  function applySidebarPreference() {
    state.mobileSidebar = isMobileSidebar();
    const collapsed = state.mobileSidebar || localStorage.getItem(SIDEBAR_KEY) === "1";
    setSidebarCollapsed(collapsed, { persist: false });
  }

  function isSidebarCollapsed() {
    return Boolean(els.personelDashboard && els.personelDashboard.classList.contains("is-sidebar-collapsed"));
  }

  function setSidebarCollapsed(collapsed, options) {
    if (!els.personelDashboard) return;
    const wasCollapsed = isSidebarCollapsed();
    els.personelDashboard.classList.toggle("is-sidebar-collapsed", Boolean(collapsed));
    if ((!options || options.persist !== false) && !isMobileSidebar()) {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    }
    syncSidebarUi();
    closeProfilePopover();
    if (isMobileSidebar() && !collapsed && ((options && options.focusDrawer) || wasCollapsed)) {
      window.setTimeout(focusFirstPersonelSidebarControl, 0);
    } else if (isMobileSidebar() && collapsed && options && options.restoreFocus && els.personelSidebarToggle) {
      window.setTimeout(() => els.personelSidebarToggle.focus(), 0);
    }
  }

  function syncSidebarUi() {
    const collapsed = isSidebarCollapsed();
    const mobile = isMobileSidebar();
    const drawerOpen = Boolean(document.body.classList.contains("is-personel-authenticated") && mobile && !collapsed);
    if (els.personelSidebarToggle) {
      const label = collapsed ? "Kenar çubuğunu aç" : "Kenar çubuğunu kapat";
      els.personelSidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      els.personelSidebarToggle.setAttribute("aria-label", label);
      els.personelSidebarToggle.setAttribute("title", label);
    }
    if (els.personelSidebar) {
      els.personelSidebar.setAttribute("aria-hidden", "false");
      els.personelSidebar.inert = false;
      els.personelSidebar.querySelectorAll(":scope > .personel-nav, :scope > .personel-profile-wrap").forEach((region) => {
        region.inert = Boolean(mobile && collapsed);
        region.setAttribute("aria-hidden", mobile && collapsed ? "true" : "false");
      });
    }
    if (els.personelSidebarOverlay) {
      els.personelSidebarOverlay.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
      els.personelSidebarOverlay.tabIndex = -1;
    }
    const workspace = document.querySelector(".personel-dashboard > .personel-workspace");
    if (workspace) workspace.inert = drawerOpen;
    document.body.classList.toggle("is-personel-drawer-open", drawerOpen);
  }

  function focusFirstPersonelSidebarControl() {
    if (!els.personelSidebar || !isMobileSidebar() || isSidebarCollapsed()) return;
    const target = els.personelSidebar.querySelector(".personel-nav button, .sidebar-user");
    if (target) target.focus();
  }

  function trapPersonelDrawerFocus(event) {
    if (!isMobileSidebar() || isSidebarCollapsed() || !els.personelSidebar) return false;
    const controls = Array.from(els.personelSidebar.querySelectorAll("button:not(:disabled), a[href]"))
      .filter((control) => !control.hidden && control.getAttribute("aria-hidden") !== "true");
    if (!controls.length) return false;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.personelSidebar.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    if (!els.personelSidebar.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function syncSidebarBreakpoint() {
    const mobile = isMobileSidebar();
    if (mobile === state.mobileSidebar) {
      syncSidebarUi();
      return;
    }
    state.mobileSidebar = mobile;
    if (mobile) setSidebarCollapsed(true, { persist: false });
    else setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1", { persist: false });
  }

  function isMobileSidebar() {
    return Boolean(window.matchMedia && window.matchMedia(MOBILE_SIDEBAR_QUERY).matches);
  }

  function toggleProfilePopover() {
    if (!els.profilePopover || !els.sidebarUser) return;
    const willOpen = els.profilePopover.hidden;
    els.profilePopover.hidden = !willOpen;
    els.sidebarUser.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) {
      const firstAction = els.profilePopover.querySelector("button:not(:disabled)");
      if (firstAction) window.setTimeout(() => firstAction.focus(), 0);
    }
  }

  function closeProfilePopover(options = {}) {
    if (els.profilePopover) els.profilePopover.hidden = true;
    if (els.sidebarUser) els.sidebarUser.setAttribute("aria-expanded", "false");
    if (options.restoreFocus && els.sidebarUser) els.sidebarUser.focus();
  }

  function handleProfileMenuKeydown(event) {
    if (!els.profilePopover || els.profilePopover.hidden) return;
    const actions = Array.from(els.profilePopover.querySelectorAll('[role="menuitem"]:not(:disabled)'));
    if (!actions.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeProfilePopover({ restoreFocus: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, actions.indexOf(document.activeElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? actions.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % actions.length
          : (current - 1 + actions.length) % actions.length;
    actions[nextIndex].focus();
  }

  function setProfileMenuMessage(message) {
    if (!els.profileMenuMessage) return;
    els.profileMenuMessage.textContent = String(message || "");
    els.profileMenuMessage.hidden = !message;
  }

  function setSection(section, options) {
    const next = sectionMeta[section] ? section : "recipe";
    if (next !== "stock" && els.stockDetailModal && !els.stockDetailModal.hidden) {
      closeStockDetail({ restoreFocus: false });
    }
    state.section = next;
    if (!options || options.persist !== false) {
      localStorage.setItem(LAST_SECTION_KEY, next);
    }
    if (els.personelDashboard) els.personelDashboard.dataset.activeSection = next;
    Object.entries({
      recipe: els.sectionRecipe,
      stock: els.sectionStock,
      profile: els.sectionProfile,
      tasks: els.sectionTasks,
      shipment: els.sectionShipment,
      shift: els.sectionShift
    }).forEach(([key, panel]) => {
      if (panel) panel.hidden = key !== next;
    });

    document.querySelectorAll(".personel-nav [data-section]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.section === next);
    });

    const meta = sectionMeta[next];
    if (els.sectionKicker) els.sectionKicker.textContent = meta.kicker;
    if (els.sectionTitle) els.sectionTitle.textContent = meta.title;
    if (els.sectionDescription) els.sectionDescription.textContent = meta.description;

    if (options && options.collapseSidebar && els.personelDashboard) {
      setSidebarCollapsed(true);
    }
    if (options && options.updateHash) history.replaceState(null, "", "/personel/");
    if (next === "stock") {
      loadStock().catch(() => {});
      setupStockEvents();
    } else {
      closeStockEvents();
    }
    if (next === "recipe") {
      loadRecipeFrame();
      compactRecipeFrame();
    }
    if (WORKFORCE_SECTIONS.has(next)) {
      void ensureWorkforceModule().catch(() => {
        const panel = document.querySelector(`[data-section-panel="${next}"]`);
        if (panel) panel.dataset.moduleState = "error";
      });
    }
    if (next === "profile") void ensureAccountSecurityModule().catch(() => {});
    document.dispatchEvent(new CustomEvent("personel:section-change", { detail: { section: next } }));
  }

  function readLastSection() {
    const saved = localStorage.getItem(LAST_SECTION_KEY);
    return saved && sectionMeta[saved] ? saved : "recipe";
  }

  function compactRecipeFrame() {
    if (!els.recipeFrame) return;
    els.recipeFrame.style.height = "100%";
  }

  function loadRecipeFrame() {
    if (!els.recipeFrame) {
      if (!els.sectionRecipe || !state.sessionActive) return;
      const frame = document.createElement("iframe");
      frame.id = "recipeFrame";
      frame.title = "Tahmisçi Reçete";
      frame.loading = "eager";
      frame.setAttribute("src", "about:blank");
      frame.dataset.src = els.sectionRecipe.dataset.recipeSrc || "/personel/recete-embed/";
      frame.addEventListener("load", () => {
        compactRecipeFrame();
        forwardRecipePreviewDraft();
      });
      els.sectionRecipe.append(frame);
      els.recipeFrame = frame;
    }
    const source = els.recipeFrame.dataset.src || els.sectionRecipe?.dataset.recipeSrc || "/personel/recete-embed/";
    const target = appendPreviewToken(source);
    if (els.recipeFrame.getAttribute("src") !== target) {
      els.recipeFrame.setAttribute("src", target);
    }
  }

  function unloadRecipeFrame() {
    if (!els.recipeFrame) return;
    els.recipeFrame.setAttribute("src", "about:blank");
    els.recipeFrame.remove();
    els.recipeFrame = null;
  }

  async function loadStock(options = {}) {
    if (!options.force && state.stockLoaded) return state.stock;
    if (state.stockLoadPromise) return state.stockLoadPromise;
    state.stockLoadPromise = api("/api/workforce/stock")
      .then((result) => {
        state.stock = normalizeStock(result);
        state.stockRevision = responseRevision(result, state.stockRevision);
        state.stockLoaded = true;
        if (state.section === "stock") renderStock();
        return state.stock;
      })
      .catch((error) => {
        showStockMessage(error.message || "Stok verisi alınamadı.", true);
        throw error;
      })
      .finally(() => {
        state.stockLoadPromise = null;
        if (state.stockRefreshPending && state.section === "stock") {
          state.stockRefreshPending = false;
          scheduleStockRefresh();
        }
      });
    return state.stockLoadPromise;
  }

  function setupStockEvents() {
    if (PREVIEW_TOKEN || state.stockEventSource || !window.EventSource) return;
    const source = new EventSource("/api/stock/events");
    const handleStockEvent = (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        const revision = responseRevision(payload, state.stockRevision);
        if (revision <= state.stockRevision && !payload.requiresRefetch) return;
        state.stockRevision = Math.max(state.stockRevision, revision);
        state.stockLoaded = false;
        if (state.section === "stock") scheduleStockRefresh();
      } catch (_error) {}
    };
    source.addEventListener("ready", handleStockEvent);
    source.addEventListener("stock", handleStockEvent);
    source.addEventListener("message", handleStockEvent);
    state.stockEventSource = source;
  }

  function scheduleStockRefresh() {
    if (state.stockLoadPromise) {
      state.stockRefreshPending = true;
      return;
    }
    window.clearTimeout(state.stockRefreshTimer);
    state.stockRefreshTimer = window.setTimeout(() => {
      state.stockRefreshTimer = null;
      loadStock({ force: true }).catch(() => {});
    }, 120);
  }

  function responseRevision(value, fallback = 0) {
    const source = value && typeof value === "object" ? value : {};
    const revisions = source.revisions && typeof source.revisions === "object" ? source.revisions : {};
    const revision = Number(source.revision ?? source.stockRevision ?? revisions.stock);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : Math.max(0, Number(fallback || 0));
  }

  function closeStockEvents() {
    if (!state.stockEventSource) return;
    state.stockEventSource.close();
    state.stockEventSource = null;
    window.clearTimeout(state.stockRefreshTimer);
    state.stockRefreshTimer = null;
    state.stockRefreshPending = false;
  }

  function renderStock() {
    renderCategories();
    renderProducts();
  }

  function renderCategories() {
    if (!els.stockCategoryPills) return;
    const categories = stockCategories();
    els.stockCategoryPills.innerHTML = [
      `<button class="${state.category === "all" ? "is-active" : ""}" type="button" data-category="all"><span>Tümü</span><b>${stockProducts().length}</b></button>`,
      ...categories.map((category) => `
        <button class="${state.category === category.id ? "is-active" : ""}" type="button" data-category="${escapeAttribute(category.id)}"><span>${escapeHTML(category.name)}</span><b>${stockProducts().filter((product) => product.categoryId === category.id).length}</b></button>
      `)
    ].join("");
  }

  function renderProducts() {
    if (!els.stockGrid) return;
    const categories = new Map(stockCategories().map((category) => [category.id, category]));
    const products = filteredProducts();
    els.stockGrid.innerHTML = products.length ? products.map((product) => {
      const category = categories.get(product.categoryId);
      const quantity = stockDisplay(product);
      const status = stockStatus(product);
      return `
        <article class="stock-card" data-stock-product-id="${escapeAttribute(product.id)}" role="button" tabindex="0" aria-label="${escapeAttribute(product.name)} detayını aç">
          <div class="stock-card-head">
            <div><p>${escapeHTML((category && category.name) || product.category || "Stok")}</p><h2>${escapeHTML(product.name)}</h2></div>
            <em class="badge ${escapeAttribute(status.key)}">${escapeHTML(status.label)}</em>
          </div>
          <div class="stock-card-quantity">
            <small>Genel mevcut stok</small>
            <strong class="stock-card-quantity__combined">${escapeHTML(currentStockLabel(product))}</strong>
          </div>
          <div class="stock-card-open"><span>Ürün detayını görüntüle</span><b aria-hidden="true">›</b></div>
        </article>
      `;
    }).join("") : `<div class="stock-empty">${stockProducts().length ? "Aradığınız stok ürünü bulunamadı." : "Gösterilecek aktif stok ürünü bulunmuyor."}</div>`;
  }

  function openStockDetail(productId) {
    const product = stockProducts().find((item) => item.id === productId);
    if (!product || !els.stockDetailModal) return;
    const category = stockCategories().find((item) => item.id === product.categoryId);
    const status = stockStatus(product);
    if (els.stockDetailModal.hidden) {
      state.detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    state.detailProductId = productId;
    if (els.stockDetailCategory) els.stockDetailCategory.textContent = (category && category.name) || "Stok";
    if (els.stockDetailTitle) els.stockDetailTitle.textContent = product.name || "Ürün detayı";
    if (els.stockDetailStatus) {
      els.stockDetailStatus.className = `badge ${status.key}`;
      els.stockDetailStatus.textContent = status.label;
    }
    if (els.stockDetailQuantity) els.stockDetailQuantity.textContent = currentStockLabel(product);
    if (els.stockDetailMessage) {
      els.stockDetailMessage.textContent = "";
      els.stockDetailMessage.hidden = true;
    }
    updateStockDetailActionAvailability();
    els.stockDetailModal.hidden = false;
    syncPanelModalLock();
    window.setTimeout(() => els.stockDetailClose && els.stockDetailClose.focus(), 0);
  }

  function closeStockDetail(options = {}) {
    if (state.stockActionSubmitting && options.force !== true) return;
    if (state.stockAction) closeStockAction({ restoreFocus: false, force: true });
    const restoreTarget = state.detailTrigger;
    state.detailProductId = null;
    state.detailTrigger = null;
    if (els.stockDetailModal) els.stockDetailModal.hidden = true;
    syncPanelModalLock();
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }

  function syncPanelModalLock() {
    const hasOpenModal = Boolean(
      els.stockDetailModal && !els.stockDetailModal.hidden
      || els.stockActionModal && !els.stockActionModal.hidden
    );
    document.documentElement.classList.toggle("is-panel-modal-open", hasOpenModal);
    document.body.classList.toggle("is-panel-modal-open", hasOpenModal);
  }

  function updateStockDetailActionAvailability() {
    if (!els.stockDetailActions) return;
    const canMutate = canUsePersonnelStockActions();
    els.stockDetailActions.querySelectorAll('[data-stock-detail-action="waste"], [data-stock-detail-action="manual_out"]').forEach((button) => {
      button.hidden = !canMutate;
      button.disabled = !canMutate;
    });
  }

  function canUsePersonnelStockActions() {
    if (PREVIEW_TOKEN || !state.sessionActive) return false;
    const location = state.stock.location;
    if (!location || location.active === false) return false;
    return String(location.type || "cafe") === "cafe";
  }

  async function toggleStockHistory(button) {
    if (!els.stockDetailHistory) return;
    const open = els.stockDetailHistory.hidden;
    els.stockDetailHistory.hidden = !open;
    if (button) button.setAttribute("aria-expanded", String(open));
    if (open) {
      const heading = document.getElementById("stockDetailHistoryTitle");
      heading && heading.focus && heading.focus();
      await loadStockDetailHistory().catch(() => {});
    }
  }

  async function loadStockDetailHistory(options = {}) {
    const productId = String(state.detailProductId || "");
    if (!productId || !els.stockDetailHistoryList) return [];
    if (state.stockHistoryLoadPromise && state.stockHistoryLoadProductId === productId && options.force !== true) return state.stockHistoryLoadPromise;
    if (!stockMovements().some((movement) => String(movement.productId || movement.stockProductId || "") === productId) || options.force === true) {
      els.stockDetailHistoryList.innerHTML = '<p class="stock-history-empty">Hareketler yükleniyor…</p>';
    }
    const locationId = String(state.stock.location && state.stock.location.id || "");
    const query = new URLSearchParams({ productId, limit: "30" });
    if (locationId) query.set("locationId", locationId);
    const loadPromise = api(`/api/workforce/stock/movements?${query.toString()}`)
      .then((result) => {
        const merged = new Map(stockMovements().map((movement) => [String(movement.id || ""), movement]));
        (Array.isArray(result.movements) ? result.movements : []).forEach((movement) => {
          if (movement && movement.id) merged.set(String(movement.id), movement);
        });
        state.stock.movements = Array.from(merged.values());
        state.stockRevision = responseRevision(result, state.stockRevision);
        const product = stockProducts().find((item) => String(item.id) === productId);
        if (product && String(state.detailProductId || "") === productId) renderStockDetailHistory(product);
        return result.movements || [];
      })
      .catch((error) => {
        if (String(state.detailProductId || "") === productId) {
          els.stockDetailHistoryList.innerHTML = `<p class="stock-history-empty is-error">${escapeHTML(error.message || "Hareket geçmişi alınamadı.")}</p>`;
        }
        throw error;
      })
      .finally(() => {
        if (state.stockHistoryLoadPromise === loadPromise) {
          state.stockHistoryLoadPromise = null;
          state.stockHistoryLoadProductId = "";
        }
      });
    state.stockHistoryLoadProductId = productId;
    state.stockHistoryLoadPromise = loadPromise;
    return loadPromise;
  }

  function renderStockDetailHistory(product) {
    if (!els.stockDetailHistoryList || !product) return;
    const locationId = String(state.stock.location && state.stock.location.id || "");
    const movements = stockMovements().filter((movement) => {
      const productId = String(movement.productId || movement.stockProductId || "");
      const movementLocationId = String(movement.locationId || movement.fromLocationId || movement.toLocationId || "");
      return productId === String(product.id) && (!locationId || !movementLocationId || movementLocationId === locationId);
    }).slice(0, 8);
    if (els.stockDetailHistoryCount) els.stockDetailHistoryCount.textContent = `${movements.length} kayıt`;
    els.stockDetailHistoryList.innerHTML = movements.length ? movements.map((movement) => `
      <article class="stock-history-item">
        <span class="stock-history-item__icon" aria-hidden="true">${movementDirectionIcon(movement)}</span>
        <div>
          <strong>${escapeHTML(stockMovementLabel(movement.type))}</strong>
          <small>${escapeHTML(formatDateTimeShort(movement.createdAt))} · ${escapeHTML(safeText(movement.actor || movement.actorName || movement.personName, "Personel"))}</small>
        </div>
        <div class="stock-history-item__actions">
          <b>${escapeHTML(formatMovementQuantity(movement))}</b>
          ${canReversePersonnelMovement(movement) ? `<button type="button" data-stock-reverse-movement="${escapeAttribute(movement.id)}">Geri al</button>` : ""}
        </div>
      </article>
    `).join("") : '<p class="stock-history-empty">Bu ürün için henüz hareket kaydı bulunmuyor.</p>';
  }

  function canReversePersonnelMovement(movement) {
    if (!canUsePersonnelStockActions() || !movement || !movement.id) return false;
    if (movement.type === "reversal" || movement.reversedMovementId || movement.reversedAt || movement.status === "reversed") return false;
    if (!["waste", "manual_out", "stock_out"].includes(String(movement.type || ""))) return false;
    const actorId = String(movement.personnelId || movement.actorId || "");
    return Boolean(actorId && actorId === String(state.user && state.user.id || ""));
  }

  async function reversePersonnelStockMovement(movementId, button) {
    const id = String(movementId || "");
    if (!id || state.stockReversePendingId) return;
    const movement = stockMovements().find((item) => String(item.id) === id);
    if (!canReversePersonnelMovement(movement)) return;
    if (!window.confirm("Bu işlem silinmeden güvenli bir ters stok hareketi oluşturulacak. Devam edilsin mi?")) return;
    const requestId = newStockRequestId("personel-stock-reversal");
    state.stockReversePendingId = id;
    const oldText = button && button.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Geri alınıyor…";
    }
    try {
      const result = await api(`/api/workforce/stock/movements/${encodeURIComponent(id)}/reverse`, {
        method: "POST",
        headers: stockMutationHeaders(requestId),
        body: JSON.stringify({ requestId, expectedRevision: state.stockRevision, note: "Personel arayüzünden ters kayıt" })
      });
      state.stockRevision = responseRevision(result, state.stockRevision + (result.idempotent ? 0 : 1));
      state.stockLoaded = false;
      await loadStock({ force: true });
      await loadStockDetailHistory({ force: true });
      const refreshed = stockProducts().find((item) => String(item.id) === String(state.detailProductId));
      if (refreshed) openStockDetail(refreshed.id);
      showStockDetailMessage("Ters kayıt oluşturuldu; geçmiş hareket silinmedi.", false);
    } catch (error) {
      showStockDetailMessage(error.message || "Ters kayıt oluşturulamadı.", true);
      throw error;
    } finally {
      state.stockReversePendingId = "";
      if (button && button.isConnected) {
        button.disabled = false;
        button.textContent = oldText || "Geri al";
      }
    }
  }

  function showStockDetailMessage(message, isError = false) {
    if (!els.stockDetailMessage) return;
    els.stockDetailMessage.textContent = String(message || "");
    els.stockDetailMessage.hidden = !message;
    els.stockDetailMessage.classList.toggle("is-success", Boolean(message) && !isError);
  }

  function movementDirectionIcon(movement) {
    return ["manual_in", "stock_in", "receipt_in", "shipment_in", "inbound_shipment", "transfer_in"].includes(String(movement && movement.type || "")) ? "+" : "−";
  }

  function stockMovementLabel(type) {
    const labels = {
      waste: "Sarf",
      consumption: "Sarf",
      manual_out: "Eksiltme",
      adjustment_out: "Eksiltme",
      stock_out: "Stok çıkışı",
      manual_in: "Stok ekleme",
      stock_in: "Stok ekleme",
      receipt_in: "Stok ekleme",
      transfer_in: "Transfer girişi",
      transfer_out: "Transfer çıkışı",
      reversal: "Ters hareket"
    };
    return labels[String(type || "")] || "Stok hareketi";
  }

  function formatMovementQuantity(movement) {
    const quantity = numberValue(movement && (movement.inputQuantity ?? movement.sourceQuantity ?? movement.quantity));
    const unit = safeText(movement && (movement.inputUnit || movement.sourceUnit || movement.baseUnit || movement.unit), "adet");
    return `${movementDirectionIcon(movement)}${formatNumber(quantity)} ${unit}`;
  }

  function openStockAction(type, trigger) {
    const product = stockProducts().find((item) => String(item.id) === String(state.detailProductId));
    if (!product || !els.stockActionModal || !canUsePersonnelStockActions()) return;
    const isWaste = type === "waste";
    const requestId = newStockRequestId(isWaste ? "personel-stock-waste" : "personel-stock-out");
    state.stockActionTrigger = trigger || document.activeElement;
    state.stockActionSubmitting = false;
    state.stockAction = { type: isWaste ? "waste" : "manual_out", productId: product.id, requestId };
    const title = isWaste ? "Sarf İşle" : "Eksilt";
    const submitLabel = isWaste ? "Sarf İşlemini Uygula" : "Eksiltmeyi Uygula";
    const supportedUnits = stockSupportedUnits(product);
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const preferredUnit = isWaste ? baseUnit : (productUnitsPerBulk(product) > 0 ? bulkUnit : baseUnit);
    const defaultUnit = supportedUnits.includes(preferredUnit) ? preferredUnit : supportedUnits[0] || baseUnit;
    if (els.stockActionKicker) els.stockActionKicker.textContent = isWaste ? "Normal kullanım / tüketim" : "Kontrollü stok düzeltmesi";
    if (els.stockActionTitle) els.stockActionTitle.textContent = title;
    if (els.stockActionProduct) els.stockActionProduct.textContent = product.name || "Stok ürünü";
    if (els.stockActionLocation) els.stockActionLocation.textContent = safeText(state.stock.location && state.stock.location.name, "Kafe Deposu");
    if (els.stockActionCurrent) els.stockActionCurrent.textContent = currentStockLabel(product);
    if (els.stockActionConversion) {
      const factor = productUnitsPerBulk(product);
      els.stockActionConversion.textContent = factor > 0
        ? `1 ${productBulkUnit(product)} = ${formatNumber(factor)} ${productBaseUnit(product)}`
        : `Temel birim: ${productBaseUnit(product)}`;
    }
    if (els.stockActionQuantity) {
      els.stockActionQuantity.value = "1";
      els.stockActionQuantity.step = productAllowsDecimal(product) ? "0.001" : "1";
      els.stockActionQuantity.min = productAllowsDecimal(product) ? "0.001" : "1";
      els.stockActionQuantity.disabled = false;
    }
    if (els.stockActionUnit) {
      els.stockActionUnit.innerHTML = supportedUnits.map((unit) => `<option value="${escapeAttribute(unit)}">${escapeHTML(unit)}</option>`).join("");
      els.stockActionUnit.value = defaultUnit;
      els.stockActionUnit.disabled = false;
    }
    if (els.stockActionNote) {
      els.stockActionNote.value = "";
      els.stockActionNote.disabled = false;
    }
    if (els.stockActionSubmit) {
      els.stockActionSubmit.textContent = submitLabel;
      els.stockActionSubmit.dataset.defaultLabel = submitLabel;
      els.stockActionSubmit.disabled = false;
    }
    if (els.stockActionCancel) els.stockActionCancel.disabled = false;
    if (els.stockActionClose) els.stockActionClose.disabled = false;
    if (els.stockActionMessage) {
      els.stockActionMessage.textContent = "";
      els.stockActionMessage.hidden = true;
    }
    renderStockQuickAmounts(product);
    renderStockActionPreview();
    els.stockActionModal.hidden = false;
    syncPanelModalLock();
    window.setTimeout(() => els.stockActionQuantity && els.stockActionQuantity.focus(), 0);
  }

  function closeStockAction(options = {}) {
    if (state.stockActionSubmitting && options.force !== true) return;
    const restoreTarget = state.stockActionTrigger;
    state.stockAction = null;
    state.stockActionTrigger = null;
    state.stockActionSubmitting = false;
    if (els.stockActionForm) els.stockActionForm.reset();
    if (els.stockActionModal) els.stockActionModal.hidden = true;
    if (els.stockActionMessage) {
      els.stockActionMessage.textContent = "";
      els.stockActionMessage.hidden = true;
    }
    syncPanelModalLock();
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }

  function renderStockQuickAmounts(product) {
    if (!els.stockQuickAmounts) return;
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const values = [
      { quantity: 1, unit: baseUnit, label: `1 ${baseUnit}` },
      { quantity: 5, unit: baseUnit, label: `5 ${baseUnit}` }
    ];
    if (productUnitsPerBulk(product) > 0) values.splice(1, 0, { quantity: 1, unit: bulkUnit, label: `1 ${bulkUnit}` });
    els.stockQuickAmounts.innerHTML = values.map((item) => `<button type="button" data-quick-quantity="${item.quantity}" data-quick-unit="${escapeAttribute(item.unit)}">${escapeHTML(item.label)}</button>`).join("");
  }

  function renderStockActionPreview() {
    const product = stockProducts().find((item) => String(item.id) === String(state.stockAction && state.stockAction.productId));
    if (!product || !els.stockActionQuantity || !els.stockActionUnit) return;
    const quantity = Number(els.stockActionQuantity.value || 0);
    const unit = els.stockActionUnit.value || productBaseUnit(product);
    const converted = stockQuantityToBase(product, quantity, unit);
    const current = numberValue(product.stockQuantity);
    const validInput = productAllowsDecimal(product) || Number.isInteger(quantity);
    const valid = validInput && Number.isFinite(converted) && converted > 0 && (productAllowsDecimal(product) || Number.isInteger(converted));
    const after = valid ? current - converted : NaN;
    if (els.stockActionConverted) {
      els.stockActionConverted.textContent = valid
        ? `${formatNumber(converted)} ${productBaseUnit(product)} stoktan düşülecek`
        : "Geçerli miktar ve birim seçin";
    }
    if (els.stockActionAfter) {
      els.stockActionAfter.textContent = valid && after >= 0
        ? currentStockLabel({ ...product, stockQuantity: after, quantityDisplay: "" })
        : valid ? "Yetersiz stok" : "—";
      els.stockActionAfter.classList.toggle("is-error", valid && after < 0);
    }
    if (els.stockActionSubmit) els.stockActionSubmit.disabled = state.stockActionSubmitting || !valid || after < 0;
  }

  async function submitStockAction(event) {
    event.preventDefault();
    if (!state.stockAction || state.stockActionSubmitting) return;
    const product = stockProducts().find((item) => String(item.id) === String(state.stockAction.productId));
    if (!product || !canUsePersonnelStockActions()) return;
    const quantity = Number(els.stockActionQuantity && els.stockActionQuantity.value || 0);
    const unit = String(els.stockActionUnit && els.stockActionUnit.value || "");
    const converted = stockQuantityToBase(product, quantity, unit);
    if (!Number.isFinite(converted) || converted <= 0) {
      setStockActionMessage("Geçerli bir miktar ve birim seçin.");
      return;
    }
    if (!productAllowsDecimal(product) && !Number.isInteger(quantity)) {
      setStockActionMessage(`${product.name} için kesirli miktar kullanılamaz.`);
      return;
    }
    if (!productAllowsDecimal(product) && !Number.isInteger(converted)) {
      setStockActionMessage(`${product.name} için kesirli ${productBaseUnit(product)} miktarı kullanılamaz.`);
      return;
    }
    if (converted > numberValue(product.stockQuantity)) {
      setStockActionMessage("Seçili depoda bu işlem için yeterli stok yok.");
      return;
    }
    const action = { ...state.stockAction };
    setStockActionPending(true);
    try {
      const movement = {
        productId: product.id,
        stockProductId: product.id,
        productCode: String(product.productCode || ""),
        stockProductCode: String(product.productCode || ""),
        locationId: String(state.stock.location && state.stock.location.id || ""),
        type: action.type,
        quantity,
        unit,
        reason: action.type === "waste" ? "Personel sarf" : "Personel stok eksiltme",
        note: String(els.stockActionNote && els.stockActionNote.value || "").trim(),
        expectedRevision: state.stockRevision,
        expectedBalanceRevision: Math.max(0, Number(product.balanceRevision || 0)),
        requestId: action.requestId,
        idempotencyKey: action.requestId
      };
      const result = await api("/api/stock/movements", {
        method: "POST",
        headers: stockMutationHeaders(action.requestId),
        body: JSON.stringify({ movement, expectedRevision: state.stockRevision })
      });
      if (result && result.stockState) {
        state.stock = normalizeStock(result.stockState);
        state.stockRevision = responseRevision(result, state.stockRevision + (result.idempotent ? 0 : 1));
      }
      closeStockAction({ restoreFocus: false, force: true });
      state.stockLoaded = false;
      await loadStock({ force: true });
      const refreshed = stockProducts().find((item) => String(item.id) === String(product.id));
      if (refreshed && els.stockDetailModal && !els.stockDetailModal.hidden) openStockDetail(refreshed.id);
      showStockMessage(action.type === "waste" ? "Sarf hareketi kaydedildi." : "Stok eksiltme hareketi kaydedildi.");
    } catch (error) {
      setStockActionMessage(error.message || "Stok işlemi kaydedilemedi.");
      setStockActionPending(false);
    }
  }

  function setStockActionPending(pending) {
    state.stockActionSubmitting = pending;
    [els.stockActionQuantity, els.stockActionUnit, els.stockActionNote, els.stockActionCancel, els.stockActionClose].forEach((element) => {
      if (element) element.disabled = pending;
    });
    if (els.stockQuickAmounts) els.stockQuickAmounts.querySelectorAll("button").forEach((button) => { button.disabled = pending; });
    if (els.stockActionSubmit) {
      els.stockActionSubmit.disabled = pending;
      els.stockActionSubmit.textContent = pending ? "Kaydediliyor…" : els.stockActionSubmit.dataset.defaultLabel || "İşlemi Uygula";
    }
    if (!pending) renderStockActionPreview();
  }

  function setStockActionMessage(message) {
    if (!els.stockActionMessage) return;
    els.stockActionMessage.textContent = String(message || "");
    els.stockActionMessage.hidden = !message;
  }

  function trapStockModalFocus(event) {
    const modal = els.stockActionModal && !els.stockActionModal.hidden
      ? els.stockActionModal
      : els.stockDetailModal && !els.stockDetailModal.hidden ? els.stockDetailModal : null;
    if (!modal) return false;
    const focusable = Array.from(modal.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  async function saveProfile(event) {
    event.preventDefault();
    const selectedFile = els.profilePhotoInput && els.profilePhotoInput.files && els.profilePhotoInput.files[0];
    let avatarUrl = els.profileAvatarUrl ? els.profileAvatarUrl.value.trim() : "";
    try {
      if (selectedFile) {
        const upload = await uploadProfilePhoto(selectedFile);
        avatarUrl = upload && upload.avatarUrl || avatarUrl;
        if (els.profileAvatarUrl) els.profileAvatarUrl.value = avatarUrl;
      }
      const profile = {
        name: els.profileName ? els.profileName.value.trim() : "",
        phone: els.profilePhone ? els.profilePhone.value.trim() : "",
        avatarUrl,
        bio: els.profileBio ? els.profileBio.value.trim() : ""
      };
      const result = await api("/api/recipe/profile", {
        method: "PUT",
        body: JSON.stringify(profile)
      });
      state.user = mergeProfile(result.user || profile);
      setProfileMessage("Profil kaydedildi.");
      state.pendingProfileAvatar = "";
      if (els.profilePhotoInput) els.profilePhotoInput.value = "";
      renderUser();
      fillProfileForm();
    } catch (error) {
      state.pendingProfileAvatar = "";
      renderUser();
      fillProfileForm();
      setProfileMessage(error.message || "Profil kaydedilemedi. Lütfen tekrar deneyin.");
    }
  }

  async function previewProfilePhoto() {
    const file = els.profilePhotoInput && els.profilePhotoInput.files && els.profilePhotoInput.files[0];
    if (!file) return;
    const error = validateProfilePhoto(file);
    if (error) {
      if (els.profilePhotoInput) els.profilePhotoInput.value = "";
      setProfileMessage(error);
      return;
    }
    let previewUrl = "";
    try {
      previewUrl = await fileToProfileDataUrl(file);
    } catch (_error) {
      setProfileMessage("Profil fotoğrafı okunamadı.");
      return;
    }
    state.pendingProfileAvatar = previewUrl;
    renderAvatar(state.user && (state.user.name || state.user.username) || "Personel", previewUrl);
    if (els.sidebarUser) {
      const name = state.user && (state.user.name || state.user.username) || "Personel";
      const role = state.user && (state.user.role || state.user.title) || "Personel";
      els.sidebarUser.innerHTML = `
        <span class="sidebar-user-avatar">${avatarContent(name, previewUrl)}</span>
        <span class="sidebar-user-text"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(role)}</small></span>
      `;
      els.sidebarUser.setAttribute("aria-label", `${name} profil menüsü`);
    }
    if (els.profileMenuAvatar) els.profileMenuAvatar.innerHTML = avatarContent(state.user && (state.user.name || state.user.username) || "Personel", previewUrl);
    setProfileMessage("Fotoğraf seçildi. Kaydetmek için Profili Kaydet'e basın.");
  }

  function fileToProfileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Profil fotoğrafı okunamadı."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Profil fotoğrafı işlenemedi."));
        image.onload = () => {
          const imageWidth = image.naturalWidth || image.width;
          const imageHeight = image.naturalHeight || image.height;
          const sourceSize = Math.min(imageWidth, imageHeight);
          const canvas = document.createElement("canvas");
          canvas.width = 512;
          canvas.height = 512;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Profil fotoğrafı işlenemedi."));
            return;
          }
          context.fillStyle = "#fffaf2";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(
            image,
            Math.max(0, (imageWidth - sourceSize) / 2),
            Math.max(0, (imageHeight - sourceSize) / 2),
            sourceSize,
            sourceSize,
            0,
            0,
            canvas.width,
            canvas.height
          );
          resolve(canvas.toDataURL("image/jpeg", 0.84));
        };
        image.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadProfilePhoto(file) {
    const error = validateProfilePhoto(file);
    if (error) throw new Error(error);
    return api("/api/recipe/profile/avatar", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
  }

  function validateProfilePhoto(file) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) return "JPG, PNG veya WEBP profil fotoğrafı seçin.";
    if (file.size > 10 * 1024 * 1024) return "Profil fotoğrafı en fazla 10 MB olabilir.";
    return "";
  }

  function mergeProfile(user) {
    return Object.assign({ name: "Personel", username: "personel" }, user || {});
  }

  function renderUser() {
    const user = state.user || {};
    const name = user.name || user.username || "Personel";
    const role = user.role || user.title || "Personel";
    if (els.sidebarUser) {
      els.sidebarUser.innerHTML = `
        <span class="sidebar-user-avatar">${avatarContent(name, user.avatarUrl)}</span>
        <span class="sidebar-user-text"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(role)}</small></span>
      `;
      els.sidebarUser.setAttribute("aria-label", `${name} profil menüsü`);
    }
    if (els.profileMenuAvatar) els.profileMenuAvatar.innerHTML = avatarContent(name, user.avatarUrl);
    if (els.profileMenuName) els.profileMenuName.textContent = name;
    if (els.profileMenuRole) els.profileMenuRole.textContent = role;
    setProfileMenuMessage("");
    renderAvatar(name, user.avatarUrl);
  }

  function fillProfileForm() {
    const user = state.user || {};
    if (els.profileName) els.profileName.value = user.name || "";
    if (els.profilePhone) els.profilePhone.value = user.phone || "";
    if (els.profileAvatarUrl) els.profileAvatarUrl.value = user.avatarUrl || "";
    if (els.profileBio) els.profileBio.value = user.bio || "";
    renderAvatar(user.name || user.username || "Personel", user.avatarUrl);
  }

  function renderAvatar(name, avatarUrl) {
    if (!els.profileAvatar) return;
    els.profileAvatar.innerHTML = avatarContent(name, avatarUrl);
  }

  function avatarContent(name, avatarUrl) {
    if (avatarUrl) return `<img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(name)}">`;
    return escapeHTML(String(name || "P").trim().slice(0, 1).toUpperCase() || "P");
  }

  function setLoginMessage(message) {
    if (els.loginMessage) els.loginMessage.textContent = message;
  }

  function setProfileMessage(message) {
    if (!els.profileMessage) return;
    els.profileMessage.textContent = message;
    setTimeout(() => { if (els.profileMessage) els.profileMessage.textContent = ""; }, 2200);
  }

  function showStockMessage(message, persist) {
    if (!els.stockMessage) return;
    els.stockMessage.textContent = message;
    els.stockMessage.hidden = false;
    if (!persist) setTimeout(() => { if (els.stockMessage) els.stockMessage.hidden = true; }, 1800);
  }

  function personelShellContext() {
    return Object.freeze({
      active: state.sessionActive,
      preview: state.sessionPreview,
      userId: String(state.user && state.user.id || ""),
      section: state.section
    });
  }

  function loadLazyStyle(key, href) {
    const resourceKey = `style:${key}`;
    if (lazyResources.has(resourceKey)) return lazyResources.get(resourceKey);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`link[data-personel-lazy-style="${key}"]`);
      if (existing && existing.sheet) return resolve(existing);
      const link = existing || document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.personelLazyStyle = key;
      link.addEventListener("load", () => resolve(link), { once: true });
      link.addEventListener("error", () => reject(new Error("Bölüm stili yüklenemedi.")), { once: true });
      if (!existing) document.head.append(link);
    }).catch((error) => {
      lazyResources.delete(resourceKey);
      throw error;
    });
    lazyResources.set(resourceKey, promise);
    return promise;
  }

  function loadLazyScript(key, source) {
    const resourceKey = `script:${key}`;
    if (lazyResources.has(resourceKey)) return lazyResources.get(resourceKey);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-personel-lazy-script="${key}"]`);
      if (existing && existing.dataset.loaded === "true") return resolve(existing);
      const script = existing || document.createElement("script");
      script.src = source;
      script.defer = true;
      script.dataset.personelLazyScript = key;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve(script);
      }, { once: true });
      script.addEventListener("error", () => reject(new Error("Bölüm modülü yüklenemedi.")), { once: true });
      if (!existing) document.head.append(script);
    }).catch((error) => {
      lazyResources.delete(resourceKey);
      throw error;
    });
    lazyResources.set(resourceKey, promise);
    return promise;
  }

  async function ensureWorkforceModule() {
    if (window.__tahmisciPersonelWorkforceMounted) return true;
    await loadLazyScript("workforce", "/personel/workforce.js?v=20260827-performance");
    if (state.sessionActive) {
      document.dispatchEvent(new CustomEvent("personel:session-started", {
        detail: { userId: state.user && state.user.id, preview: state.sessionPreview, replay: true }
      }));
      document.dispatchEvent(new CustomEvent("personel:section-change", {
        detail: { section: state.section, replay: true }
      }));
    }
    return true;
  }

  async function ensureNotificationsModule() {
    if (window.TahmisciPersonelNotifications) return window.TahmisciPersonelNotifications;
    await Promise.all([
      loadLazyStyle("notifications", "/personel/notifications.css?v=20260827-performance"),
      loadLazyScript("notifications", "/personel/notifications.js?v=20260827-performance")
    ]);
    if (state.sessionActive) {
      document.dispatchEvent(new CustomEvent("personel:session-started", {
        detail: { userId: state.user && state.user.id, preview: state.sessionPreview, replay: true }
      }));
    }
    return window.TahmisciPersonelNotifications;
  }

  async function ensureAccountSecurityModule() {
    if (window.TahmisciAccountSecurity) return window.TahmisciAccountSecurity;
    await Promise.all([
      loadLazyStyle("account-security", "/shared/styles/account-security.css?v=20260827-performance"),
      loadLazyScript("account-security", "/shared/scripts/account-security.js?v=20260827-performance")
    ]);
    if (state.sessionActive) {
      document.dispatchEvent(new CustomEvent("personel:session-started", {
        detail: { userId: state.user && state.user.id, preview: state.sessionPreview, replay: true }
      }));
    }
    return window.TahmisciAccountSecurity;
  }

  function renderNotificationUnreadBadge(value) {
    const count = Math.max(0, Number(value || 0));
    if (els.personelNotificationBadge) {
      els.personelNotificationBadge.textContent = count > 99 ? "99+" : String(count);
      els.personelNotificationBadge.hidden = count < 1;
      els.personelNotificationBadge.setAttribute("aria-label", `${count} okunmamış bildirim`);
    }
    if (els.personelNotificationUnreadText) {
      els.personelNotificationUnreadText.textContent = count ? `${count} okunmamış` : "Yeni bildirim yok";
    }
  }

  function loadNotificationUnreadBadge(options = {}) {
    if (state.sessionPreview || !state.sessionActive) return Promise.resolve(0);
    if (!options.force && state.notificationUnreadLoaded && Date.now() - state.notificationUnreadLoadedAt < 30000) {
      return Promise.resolve(state.notificationUnreadCount);
    }
    if (state.notificationBadgePromise) return state.notificationBadgePromise;
    const promise = api("/api/notifications/unread-count")
      .then((result) => {
        state.notificationUnreadCount = Math.max(0, Number(result.unreadCount ?? result.count ?? 0));
        state.notificationUnreadLoaded = true;
        state.notificationUnreadLoadedAt = Date.now();
        renderNotificationUnreadBadge(state.notificationUnreadCount);
        return state.notificationUnreadCount;
      })
      .catch(() => state.notificationUnreadCount)
      .finally(() => {
        if (state.notificationBadgePromise === promise) state.notificationBadgePromise = null;
      });
    state.notificationBadgePromise = promise;
    return promise;
  }

  async function api(path, options) {
    const method = String(options && options.method || "GET").toUpperCase();
    if (PREVIEW_TOKEN && method !== "GET") throw new Error("Önizleme modu salt okunurdur.");
    const headers = Object.assign({ "Content-Type": "application/json" }, options && options.headers || {});
    const target = PREVIEW_TOKEN && isPreviewReadPath(path) ? appendPreviewToken(path) : path;
    const response = await fetch(target, Object.assign({}, options || {}, {
      credentials: "include",
      headers
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İstek başarısız.");
      error.status = response.status;
      if ((response.status === 401 || response.status === 403) && state.sessionActive) {
        document.dispatchEvent(new CustomEvent("personel:session-ended", {
          detail: { source: "personel-shell", status: response.status, message: error.message }
        }));
      }
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

  function readPreviewSection() {
    try {
      const section = new URLSearchParams(window.location.search).get("section") || "";
      return ["recipe", "stock", "tasks", "shipment", "shift"].includes(section) ? section : "";
    } catch (_error) {
      return "";
    }
  }

  function appendPreviewToken(path) {
    if (!PREVIEW_TOKEN) return path;
    const url = new URL(path, window.location.origin);
    url.searchParams.set("previewToken", PREVIEW_TOKEN);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function isPreviewReadPath(path) {
    return ["/api/recipe/me", "/api/stock", "/api/workforce/me", "/api/workforce/stock"].some((prefix) => String(path || "").startsWith(prefix));
  }

  function emptyStockState() {
    return {
      location: null,
      locations: [],
      balances: [],
      categories: [],
      products: [],
      movements: [],
      transfers: [],
      summary: {},
      revision: 0,
      updatedAt: null
    };
  }

  function normalizeStock(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const legacyState = source.stockState && typeof source.stockState === "object" ? source.stockState : {};
    const balances = Array.isArray(source.balances) ? source.balances : Array.isArray(legacyState.balances) ? legacyState.balances : [];
    const publicBalances = balances.map((balance) => {
      if (!balance || typeof balance !== "object") return balance;
      const { generalQuantity: _generalQuantity, otherLocationQuantity: _otherLocationQuantity, suggestedTransfer: _suggestedTransfer, ...publicBalance } = balance;
      return publicBalance;
    });
    const productSource = Array.isArray(source.products)
      ? source.products
      : balances.map((balance) => balance && balance.product).filter(Boolean).length
        ? balances.map((balance) => balance && balance.product).filter(Boolean)
        : Array.isArray(legacyState.products) ? legacyState.products : [];
    const balanceMap = new Map(balances.map((balance) => [String(balance && balance.productId || balance && balance.product && balance.product.id || ""), balance || {}]));
    const seenProducts = new Set();
    const products = productSource.reduce((result, product) => {
      const id = String(product && product.id || "");
      if (!id || seenProducts.has(id)) return result;
      seenProducts.add(id);
      const balance = balanceMap.get(id) || {};
      const recommendation = balance.recommendation && typeof balance.recommendation === "object"
        ? balance.recommendation
        : product.recommendation && typeof product.recommendation === "object" ? product.recommendation : null;
      result.push({
        ...product,
        stockQuantity: numberValue(balance.quantity ?? product.stockQuantity),
        criticalThreshold: numberValue(balance.criticalThreshold ?? product.criticalThreshold),
        orderThreshold: numberValue(balance.orderThreshold ?? product.orderThreshold),
        targetLevel: numberValue(balance.targetLevel ?? product.targetLevel),
        totalQuantity: numberValue(balance.totalQuantity ?? product.totalQuantity ?? product.stockQuantity),
        quantityDisplay: quantityDisplayText(balance.quantityDisplay || product.quantityDisplay),
        recommendation,
        transferAvailable: recommendation && recommendation.type === "transfer"
          || numberValue(balance.suggestedTransfer ?? product.suggestedTransfer) > 0,
        balanceRevision: Math.max(0, Number(balance.revision || 0)),
        locationStatus: String(balance.status || product.locationStatus || ""),
        balanceUpdatedAt: balance.updatedAt || product.updatedAt || null
      });
      return result;
    }, []);
    const categorySource = Array.isArray(source.categories)
      ? source.categories
      : Array.isArray(legacyState.categories) ? legacyState.categories : [];
    const categories = categorySource.length ? categorySource : Array.from(products.reduce((map, product) => {
      const id = String(product.categoryId || product.category || "stock-category-general");
      if (!map.has(id)) map.set(id, { id, name: String(product.category || "Genel"), active: true, order: map.size });
      return map;
    }, new Map()).values());
    return {
      location: source.location && typeof source.location === "object" ? source.location : null,
      locations: Array.isArray(source.locations)
        ? source.locations.filter((location) => !source.location || String(location && location.id) === String(source.location.id))
        : [],
      balances: publicBalances,
      categories,
      products,
      movements: Array.isArray(source.movements) ? source.movements : Array.isArray(legacyState.movements) ? legacyState.movements : [],
      transfers: Array.isArray(source.transfers) ? source.transfers : Array.isArray(source.requests) ? source.requests : [],
      summary: source.summary && typeof source.summary === "object" ? source.summary : {},
      revision: responseRevision(source, 0),
      updatedAt: source.updatedAt || source.summary && source.summary.lastUpdatedAt || null
    };
  }

  function filteredProducts() {
    const query = normalizeText(state.query);
    const categories = new Map(stockCategories().map((category) => [String(category.id), category.name]));
    return stockProducts().filter((product) => {
      if (state.category !== "all" && product.categoryId !== state.category) return false;
      if (!query) return true;
      return normalizeText(`${product.name} ${product.productCode || ""} ${product.barcode || ""} ${product.supplier || ""} ${categories.get(String(product.categoryId)) || product.category || ""}`).includes(query);
    }).sort((left, right) => {
      if (!query) return Number(left.order || 0) - Number(right.order || 0);
      const leftStarts = stockSearchFields(left, categories).some((field) => field.startsWith(query)) ? 0 : 1;
      const rightStarts = stockSearchFields(right, categories).some((field) => field.startsWith(query)) ? 0 : 1;
      return leftStarts - rightStarts
        || normalizeText(left.name).localeCompare(normalizeText(right.name), "tr");
    });
  }

  function stockSearchFields(product, categories) {
    return [
      product && product.name,
      product && product.productCode,
      product && product.barcode,
      product && product.supplier,
      categories && categories.get(String(product && product.categoryId)) || product && product.category
    ].map(normalizeText).filter(Boolean);
  }

  function stockCategories() {
    return state.stock.categories.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockProducts() {
    return state.stock.products
      .filter((product) => product.active !== false)
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockMovements() {
    return state.stock.movements.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function stockTransfers() {
    return (Array.isArray(state.stock.transfers) ? state.stock.transfers : [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function pendingTransferCount() {
    return stockTransfers().filter((transfer) => String(transfer.status || "pending") === "pending").length;
  }

  function stockStatus(product) {
    const source = normalizeText(product && product.locationStatus);
    if (source.includes("tukendi")) return { key: "empty", label: "Tükendi" };
    if (source.includes("kritik")) return { key: "critical", label: "Kritik" };
    const current = numberValue(product.stockQuantity);
    const critical = numberValue(product.criticalThreshold);
    if (current <= 0) return { key: "empty", label: "Tükendi" };
    if (critical > 0 && current <= critical) return { key: "critical", label: "Kritik" };
    return { key: "ok", label: "Yeterli" };
  }

  function stockRecommendation(product) {
    const recommendation = product && product.recommendation;
    if (recommendation && recommendation.type === "transfer" || product && product.transferAvailable) {
      return { key: "available", label: "Transfer uygun" };
    }
    if (recommendation && recommendation.type === "purchase") {
      return { key: "purchase", label: "Satın alma gerekli" };
    }
    return { key: "unavailable", label: "Transfer gerekmiyor" };
  }

  function numberValue(value) {
    if (value && typeof value === "object") {
      const nested = value.quantity ?? value.value ?? value.amount ?? value.baseQuantity ?? value.total;
      if (nested !== undefined && nested !== value) return numberValue(nested);
    }
    const parsed = Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function safeText(value, fallback = "") {
    if (value && typeof value === "object") {
      const nested = value.label ?? value.name ?? value.unit ?? value.code ?? value.display ?? value.value;
      return nested === undefined || nested === null ? fallback : String(nested).trim() || fallback;
    }
    return value === undefined || value === null ? fallback : String(value).trim() || fallback;
  }

  function quantityDisplayText(value) {
    return safeText(value && typeof value === "object" ? value.display ?? value.label ?? "" : value, "");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(numberValue(value));
  }

  function currentStockLabel(product) {
    const provided = quantityDisplayText(product && product.quantityDisplay);
    if (provided) return provided;
    const baseQuantity = numberValue(product && product.stockQuantity);
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const unitsPerBulk = productUnitsPerBulk(product);
    if (unitsPerBulk > 0 && baseQuantity >= unitsPerBulk) {
      const bulk = Math.floor(baseQuantity / unitsPerBulk);
      const remainder = Number((baseQuantity - (bulk * unitsPerBulk)).toFixed(4));
      return remainder > 0
        ? `${formatNumber(bulk)} ${bulkUnit} + ${formatNumber(remainder)} ${baseUnit}`
        : `${formatNumber(bulk)} ${bulkUnit}`;
    }
    return `${formatNumber(baseQuantity)} ${baseUnit}`;
  }

  function stockDisplay(product) {
    const baseQuantity = numberValue(product && product.stockQuantity);
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const factor = productUnitsPerBulk(product);
    if (factor > 0 && baseQuantity >= factor && Math.abs(baseQuantity % factor) < 0.000001) {
      return { value: baseQuantity / factor, unit: bulkUnit };
    }
    return { value: baseQuantity, unit: baseUnit };
  }

  function transferStatus(value) {
    const status = String(value || "pending");
    if (status === "approved") return { key: "approved", label: "Onaylandı" };
    if (status === "rejected") return { key: "rejected", label: "Reddedildi" };
    if (status === "cancelled") return { key: "cancelled", label: "İptal edildi" };
    return { key: "pending", label: "Onay bekliyor" };
  }

  function urgencyLabel(value) {
    if (value === "urgent") return "Acil";
    if (value === "high") return "Yüksek";
    return "Normal";
  }

  function formatStockUpdatedAt(value) {
    if (!value) return "Henüz yok";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Henüz yok";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDateTimeShort(value) {
    if (!value) return "Tarih yok";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Tarih yok";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function stockLocationIcon() {
    return `<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/></svg>`;
  }

  function stockSupportedUnits(product) {
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const units = [baseUnit];
    if (bulkUnit && productUnitsPerBulk(product) > 0) units.push(bulkUnit);
    return Array.from(new Set(units));
  }

  function productAllowsDecimal(product) {
    if (typeof (product && product.allowDecimal) === "boolean") return product.allowDecimal;
    return ["kg", "gr", "litre", "ml"].includes(productBaseUnit(product));
  }

  function productBaseUnit(product) {
    return safeText(product && (product.baseUnit || product.unit), "adet").toLocaleLowerCase("tr-TR");
  }

  function productBulkUnit(product) {
    return safeText(product && (product.bulkUnit || product.caseUnit), "koli").toLocaleLowerCase("tr-TR");
  }

  function productUnitsPerBulk(product) {
    return numberValue(product && (product.unitsPerBulkUnit ?? product.unitsPerCase ?? product.packageSize ?? product.packSize ?? product.piecesPerBox ?? product.koliIci));
  }

  function stockQuantityToBase(product, quantity, unit) {
    const normalizedUnit = String(unit || productBaseUnit(product)).trim().toLocaleLowerCase("tr-TR");
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) return NaN;
    if (normalizedUnit === productBaseUnit(product)) return amount;
    if (normalizedUnit === productBulkUnit(product)) {
      const factor = productUnitsPerBulk(product);
      return factor > 0 ? amount * factor : NaN;
    }
    if (productBaseUnit(product) === "gr" && normalizedUnit === "kg") return amount * 1000;
    if (productBaseUnit(product) === "kg" && normalizedUnit === "gr") return amount / 1000;
    if (productBaseUnit(product) === "ml" && ["litre", "lt", "l"].includes(normalizedUnit)) return amount * 1000;
    if (["litre", "lt", "l"].includes(productBaseUnit(product)) && normalizedUnit === "ml") return amount / 1000;
    return NaN;
  }

  function newStockRequestId(prefix) {
    const value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function stockMutationHeaders(requestId) {
    return { "Idempotency-Key": requestId, "X-Request-ID": requestId };
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
