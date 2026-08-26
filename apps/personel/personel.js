(function () {
  "use strict";

  const PREVIEW_TOKEN = readPreviewToken();
  const PREVIEW_SECTION = readPreviewSection();
  const SIDEBAR_KEY = "tahmisci.personel.sidebarCollapsed.v1";
  const LAST_SECTION_KEY = "tahmisci.personel.lastSection.v1";
  const MOBILE_SIDEBAR_QUERY = "(max-width: 880px)";

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
    pendingProfileAvatar: "",
    mobileSidebar: false,
    sessionActive: false,
    logoutPending: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    [
      "personelApp", "personelLogin", "personelDashboard", "personelLoginForm", "personelUsername", "personelPassword",
      "loginMessage", "personelSidebarToggle", "personelSidebar", "personelSidebarOverlay", "sectionKicker", "sectionTitle",
      "sectionDescription", "sectionRecipe", "sectionStock", "sectionProfile", "sectionTasks", "sectionShipment", "sectionShift", "sidebarUser", "profilePopover",
      "profileMenuAvatar", "profileMenuName", "profileMenuRole", "profileMenuMessage",
      "recipeFrame", "stockMessage", "stockSearchInput", "stockCategoryPills", "stockGrid",
      "profileForm", "profileName", "profilePhone", "profileAvatarUrl", "profilePhotoInput", "profileBio",
      "profileMessage", "profileAvatar",
      "stockDetailModal", "stockDetailCategory", "stockDetailTitle", "stockDetailStatus",
      "stockDetailQuantity", "stockDetailUnit", "stockDetailThreshold", "stockDetailCritical", "stockDetailSupplier", "stockDetailNote"
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
        window.setTimeout(() => document.getElementById("personelNotificationPreferencesForm")?.scrollIntoView({ block: "start" }), 80);
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

    if (els.stockDetailModal) els.stockDetailModal.addEventListener("click", (event) => {
      if (event.target === els.stockDetailModal || event.target.closest("[data-detail-close]")) {
        closeStockDetail();
      }
    });

    if (els.profileForm) els.profileForm.addEventListener("submit", saveProfile);
    if (els.profilePhotoInput) els.profilePhotoInput.addEventListener("change", previewProfilePhoto);
    if (els.recipeFrame) els.recipeFrame.addEventListener("load", () => {
      compactRecipeFrame();
      forwardRecipePreviewDraft();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && trapPersonelDrawerFocus(event)) return;
      if (event.key === "Escape") {
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
    document.dispatchEvent(new CustomEvent("personel:session-started", {
      detail: { userId, preview: session.role === "preview" }
    }));
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
    if (!els.recipeFrame) return;
    const source = els.recipeFrame.dataset.src || "/personel/recete-embed/";
    const target = appendPreviewToken(source);
    if (els.recipeFrame.getAttribute("src") !== target) {
      els.recipeFrame.setAttribute("src", target);
    }
  }

  function unloadRecipeFrame() {
    if (!els.recipeFrame) return;
    if (els.recipeFrame.getAttribute("src") !== "about:blank") {
      els.recipeFrame.setAttribute("src", "about:blank");
    }
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
            <small>Mevcut miktar</small>
            <strong><span>${escapeHTML(formatNumber(quantity.value))}</span><em>${escapeHTML(quantity.unit)}</em></strong>
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
    const display = stockDisplay(product);
    const thresholdUnit = productBaseUnit(product);
    state.detailProductId = productId;
    if (els.stockDetailCategory) els.stockDetailCategory.textContent = (category && category.name) || "Stok";
    if (els.stockDetailTitle) els.stockDetailTitle.textContent = product.name || "Ürün detayı";
    if (els.stockDetailStatus) {
      els.stockDetailStatus.className = `badge ${status.key}`;
      els.stockDetailStatus.textContent = status.label;
    }
    if (els.stockDetailQuantity) els.stockDetailQuantity.textContent = formatNumber(display.value);
    if (els.stockDetailUnit) els.stockDetailUnit.textContent = display.unit;
    if (els.stockDetailThreshold) els.stockDetailThreshold.textContent = `${formatNumber(product.orderThreshold)} ${thresholdUnit}`;
    if (els.stockDetailCritical) els.stockDetailCritical.textContent = `${formatNumber(product.criticalThreshold)} ${thresholdUnit}`;
    if (els.stockDetailSupplier) els.stockDetailSupplier.textContent = safeText(product.supplier, "Belirtilmedi");
    if (els.stockDetailNote) {
      const note = safeText(product.note || product.description, "");
      els.stockDetailNote.textContent = note;
      els.stockDetailNote.hidden = !note;
    }
    els.stockDetailModal.hidden = false;
    syncPanelModalLock();
  }

  function closeStockDetail() {
    state.detailProductId = null;
    if (els.stockDetailModal) els.stockDetailModal.hidden = true;
    syncPanelModalLock();
  }

  function syncPanelModalLock() {
    const hasOpenModal = Boolean(els.stockDetailModal && !els.stockDetailModal.hidden);
    document.documentElement.classList.toggle("is-panel-modal-open", hasOpenModal);
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
    const declared = Array.isArray(product && product.allowedUnits)
      ? product.allowedUnits.map((unit) => String(unit || "").trim().toLocaleLowerCase("tr-TR")).filter(Boolean)
      : [];
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const units = declared.length ? declared : [baseUnit];
    if (productUnitsPerBulk(product) > 0) units.push(bulkUnit);
    return Array.from(new Set(units));
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
