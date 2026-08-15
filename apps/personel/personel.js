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
      description: "Raf ürünlerini eksiltin, sarf işleyin ve stok durumunu takip edin."
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
    stock: { categories: [], products: [], movements: [] },
    stockEventSource: null,
    stockLoaded: false,
    stockLoadPromise: null,
    stockRevision: 0,
    previewRecipeDraft: null,
    query: "",
    category: "all",
    action: null,
    detailProductId: null,
    pendingProfileAvatar: "",
    mobileSidebar: false,
    sessionActive: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    [
      "personelApp", "personelLogin", "personelDashboard", "personelLoginForm", "personelUsername", "personelPassword",
      "loginMessage", "personelLogout", "personelSidebarToggle", "personelSidebar", "personelSidebarOverlay", "sectionKicker", "sectionTitle",
      "sectionDescription", "sectionRecipe", "sectionStock", "sectionProfile", "sectionTasks", "sectionShipment", "sectionShift", "sidebarUser", "profilePopover",
      "profileMenuAvatar", "profileMenuName",
      "recipeFrame", "stockStats", "stockMessage", "stockSearchInput", "stockCategoryPills", "stockGrid",
      "profileForm", "profileName", "profilePhone", "profileAvatarUrl", "profilePhotoInput", "profileBio",
      "profileMessage", "profileAvatar", "stockModal", "stockForm", "stockModalKicker",
      "stockModalTitle", "stockModalProduct", "stockQuantity", "stockNote", "stockFormMessage",
      "stockDetailModal", "stockDetailCategory", "stockDetailTitle", "stockDetailStatus",
      "stockDetailQuantity", "stockDetailThreshold", "stockDetailCritical", "stockDetailSupplier", "stockDetailNote"
    ].forEach((id) => { els[id] = document.getElementById(id); });

    setView("booting");
    bindEvents();
    await boot();
  }

  function bindEvents() {
    document.addEventListener("tahmisci:preview-draft", handlePreviewDraftMessage);
    document.addEventListener("personel:session-ended", handlePersonelSessionEnded);
    if (els.personelLoginForm) els.personelLoginForm.addEventListener("submit", login);
    if (els.personelLogout) els.personelLogout.addEventListener("click", logout);
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

    document.querySelectorAll(".personel-nav [data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        setSection(button.dataset.section, { updateHash: false });
        if (isMobileSidebar()) setSidebarCollapsed(true, { persist: false, restoreFocus: true });
      });
    });

    if (els.stockSearchInput) els.stockSearchInput.addEventListener("input", () => {
      state.query = els.stockSearchInput.value.trim();
      renderStock();
    });

    if (els.stockCategoryPills) els.stockCategoryPills.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category || "all";
      renderStock();
    });

    if (els.stockGrid) els.stockGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stock-action]");
      if (button) {
        openStockAction(button.dataset.productId, button.dataset.stockAction);
        return;
      }
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

    if (els.stockModal) els.stockModal.addEventListener("click", (event) => {
      if (event.target === els.stockModal || event.target.closest("[data-close]")) closeStockAction();
    });

    if (els.stockDetailModal) els.stockDetailModal.addEventListener("click", (event) => {
      if (event.target === els.stockDetailModal || event.target.closest("[data-detail-close]")) {
        closeStockDetail();
        return;
      }
      const action = event.target.closest("[data-detail-action]");
      if (!action || !state.detailProductId) return;
      const productId = state.detailProductId;
      closeStockDetail();
      openStockAction(productId, action.dataset.detailAction);
    });

    if (els.stockForm) els.stockForm.addEventListener("submit", submitStockAction);
    if (els.profileForm) els.profileForm.addEventListener("submit", saveProfile);
    if (els.profilePhotoInput) els.profilePhotoInput.addEventListener("change", previewProfilePhoto);
    if (els.recipeFrame) els.recipeFrame.addEventListener("load", () => {
      compactRecipeFrame();
      forwardRecipePreviewDraft();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && trapPersonelDrawerFocus(event)) return;
      if (event.key === "Escape") {
        closeStockAction();
        closeStockDetail();
        closeProfilePopover();
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
    if (window.TahmisciPersonelNotifications && typeof window.TahmisciPersonelNotifications.beforeLogout === "function") {
      await window.TahmisciPersonelNotifications.beforeLogout().catch(() => null);
    }
    await fetch("/api/recipe/logout", { method: "POST", credentials: "include" }).catch(() => null);
    localStorage.removeItem(LAST_SECTION_KEY);
    if (state.sessionActive) {
      document.dispatchEvent(new CustomEvent("personel:session-ended", {
        detail: { source: "personel-shell", reason: "logout", message: "" }
      }));
      return;
    }
    resetPersonelSession();
    showLogin();
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
    state.stock = { categories: [], products: [], movements: [] };
    state.stockLoaded = false;
    state.stockLoadPromise = null;
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

  function closeProfilePopover() {
    if (els.profilePopover) els.profilePopover.hidden = true;
    if (els.sidebarUser) els.sidebarUser.setAttribute("aria-expanded", "false");
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

  async function loadStock() {
    if (state.stockLoaded) return state.stock;
    if (state.stockLoadPromise) return state.stockLoadPromise;
    state.stockLoadPromise = api("/api/stock")
      .then((result) => {
        state.stock = normalizeStock(result.stockState);
        state.stockRevision = responseRevision(result, state.stockRevision);
        state.stockLoaded = true;
        if (state.section === "stock") renderStock();
        return state.stock;
      })
      .catch((error) => {
        showStockMessage(error.message || "Stok verisi alınamadı.", true);
        throw error;
      })
      .finally(() => { state.stockLoadPromise = null; });
    return state.stockLoadPromise;
  }

  function setupStockEvents() {
    if (PREVIEW_TOKEN || state.stockEventSource || !window.EventSource) return;
    const source = new EventSource("/api/stock/events");
    const handleStockEvent = (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        const revision = responseRevision(payload, state.stockRevision);
        if (payload.stockState) {
          state.stock = normalizeStock(payload.stockState);
          state.stockRevision = revision;
          state.stockLoaded = true;
          if (state.section === "stock") renderStock();
          return;
        }
        if (revision <= state.stockRevision && !payload.requiresRefetch) return;
        state.stockLoaded = false;
        if (state.section === "stock") loadStock().catch(() => {});
      } catch (_error) {}
    };
    source.addEventListener("ready", handleStockEvent);
    source.addEventListener("stock", handleStockEvent);
    source.addEventListener("message", handleStockEvent);
    state.stockEventSource = source;
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
  }

  function renderStock() {
    renderStats();
    renderCategories();
    renderProducts();
  }

  function renderStats() {
    if (!els.stockStats) return;
    const products = stockProducts();
    const critical = products.filter((product) => stockStatus(product).key === "critical").length;
    const todayKey = new Date().toISOString().slice(0, 10);
    const waste = stockMovements()
      .filter((movement) => movement.type === "waste" && String(movement.createdAt || "").slice(0, 10) === todayKey)
      .reduce((sum, movement) => sum + numberValue(movement.quantity), 0);

    const cards = [
      ["Takip Edilecek", products.length, "Stok ürünü"],
      ["Kritik Ürün", critical, "Kritik eşiğin altında"],
      ["Bugün Sarf", formatNumber(waste), "Ürün sarf edildi"]
    ];

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
      const quantity = currentStockLabel(product);
      return `
        <article class="stock-card" data-stock-product-id="${escapeAttribute(product.id)}" role="button" tabindex="0" aria-label="${escapeAttribute(product.name)} detayını aç">
          <div class="stock-card-head">
            <div><p>${escapeHTML((category && category.name) || "Stok")}</p><h2>${escapeHTML(product.name)}</h2></div>
          </div>
          <div class="stock-card-quantity">
            <small>Elde olan</small>
            <strong>${escapeHTML(quantity)}</strong>
          </div>
          <div class="stock-card-open" aria-hidden="true">
            <span>Ürün detayları</span><b>→</b>
          </div>
        </article>
      `;
    }).join("") : `<div class="stock-empty">${stockProducts().length ? "Aradığınız stok ürünü bulunamadı." : "Henüz veri aktarılmadı."}</div>`;
  }

  function openStockAction(productId, type) {
    const product = stockProducts().find((item) => item.id === productId);
    if (!product || !els.stockModal) return;
    state.action = { productId, productCode: String(product.productCode || ""), type };
    const label = type === "waste" ? "Sarf İşle" : "Eksilt";
    if (els.stockModalKicker) els.stockModalKicker.textContent = label;
    if (els.stockModalTitle) els.stockModalTitle.textContent = label;
    if (els.stockModalProduct) els.stockModalProduct.textContent = `${product.name} · Mevcut stok: ${formatNumber(product.stockQuantity)} ${product.unit || "adet"}`;
    if (els.stockQuantity) els.stockQuantity.value = "";
    if (els.stockNote) els.stockNote.value = "";
    if (els.stockFormMessage) els.stockFormMessage.textContent = "";
    els.stockModal.hidden = false;
    syncPanelModalLock();
    setTimeout(() => els.stockQuantity && els.stockQuantity.focus(), 40);
  }

  function openStockDetail(productId) {
    const product = stockProducts().find((item) => item.id === productId);
    if (!product || !els.stockDetailModal) return;
    const category = stockCategories().find((item) => item.id === product.categoryId);
    const status = stockStatus(product);
    const unit = product.unit || "adet";
    state.detailProductId = productId;
    if (els.stockDetailCategory) els.stockDetailCategory.textContent = (category && category.name) || "Stok";
    if (els.stockDetailTitle) els.stockDetailTitle.textContent = product.name || "Ürün detayı";
    if (els.stockDetailStatus) {
      els.stockDetailStatus.className = `badge ${status.key}`;
      els.stockDetailStatus.textContent = status.label;
    }
    if (els.stockDetailQuantity) els.stockDetailQuantity.textContent = currentStockLabel(product);
    if (els.stockDetailThreshold) els.stockDetailThreshold.textContent = product.orderThresholdText || `${formatNumber(product.orderThreshold)} ${unit}`;
    if (els.stockDetailCritical) els.stockDetailCritical.textContent = product.criticalThresholdText || `${formatNumber(product.criticalThreshold)} ${unit}`;
    if (els.stockDetailSupplier) els.stockDetailSupplier.textContent = product.supplier || "Belirtilmedi";
    if (els.stockDetailNote) {
      const note = String(product.note || product.description || "").trim();
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

  function closeStockAction() {
    state.action = null;
    if (els.stockModal) els.stockModal.hidden = true;
    syncPanelModalLock();
  }

  function syncPanelModalLock() {
    const hasOpenModal = [els.stockModal, els.stockDetailModal].some((modal) => modal && !modal.hidden);
    document.documentElement.classList.toggle("is-panel-modal-open", hasOpenModal);
  }

  async function submitStockAction(event) {
    event.preventDefault();
    if (!state.action) return;
    const quantity = Number(els.stockQuantity && els.stockQuantity.value || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      if (els.stockFormMessage) els.stockFormMessage.textContent = "Geçerli bir miktar girin.";
      return;
    }

    const activeAction = Object.assign({}, state.action);
    const activeProduct = stockProducts().find((item) => item.id === activeAction.productId);
    const currentQuantity = activeProduct ? numberValue(activeProduct.stockQuantity) : 0;
    if (!activeProduct) {
      if (els.stockFormMessage) els.stockFormMessage.textContent = "Stok ürünü bulunamadı.";
      return;
    }
    if (quantity > currentQuantity) {
      if (els.stockFormMessage) els.stockFormMessage.textContent = `En fazla ${currentStockLabel(activeProduct)} eksiltebilirsiniz.`;
      return;
    }

    try {
      const result = await api("/api/stock/movements", {
        method: "POST",
        body: JSON.stringify({
          movement: {
            productId: activeAction.productId,
            productCode: activeAction.productCode || activeProduct.productCode || "",
            stockProductCode: activeAction.productCode || activeProduct.productCode || "",
            type: activeAction.type,
            quantity,
            reason: activeAction.type === "waste" ? "Personel sarf" : "Personel stok eksiltme",
            note: els.stockNote ? els.stockNote.value.trim() : ""
          }
        })
      });
      if (result.stockState) {
        state.stock = normalizeStock(result.stockState);
      } else {
        activeProduct.stockQuantity = Math.max(0, currentQuantity - quantity);
        activeProduct.stockQuantityText = currentStockLabel(activeProduct);
      }
      closeStockAction();
      showStockMessage("Stok hareketi kaydedildi.");
      renderStock();
    } catch (error) {
      if (els.stockFormMessage) els.stockFormMessage.textContent = error.message || "Stok işlemi kaydedilemedi.";
    }
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
    return ["/api/recipe/me", "/api/stock", "/api/workforce/me"].some((prefix) => String(path || "").startsWith(prefix));
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
    return state.stock.products
      .filter((product) => product.active !== false)
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
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

  function numberValue(value) {
    const parsed = Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(numberValue(value));
  }

  function currentStockLabel(product) {
    return `${formatNumber(product && product.stockQuantity)} ${(product && product.unit) || "adet"}`;
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
