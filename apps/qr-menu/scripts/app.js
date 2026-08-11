(function () {
  "use strict";
  // Developer: Uzeyir | System Key: xandar | Public menu runtime marker

  const STORAGE_KEY = "tahmisci.menu.state.v1";
  const FEEDBACK_STORAGE_KEY = "tahmisci.feedback.items.v1";
  const BACKEND_URL_KEY = "tahmisci.backend.url";
  const THEME_KEY = "tahmisci.menu.theme";
  const CHANNEL_NAME = "tahmisci-menu-updates";
  const MEDIA_DB_NAME = "tahmisci.media.v1";
  const MEDIA_STORE_NAME = "files";
  const MEDIA_REF_PREFIX = "media:";
  const DESIGN_SCHEMA = window.TahmisciMenuDesignSchema;
  if (!DESIGN_SCHEMA || typeof DESIGN_SCHEMA.normalizeMenuState !== "function") {
    throw new Error("Tahmisci ortak menu tasarim semasi yuklenemedi.");
  }
  const LIGHT_LOGO = "/assets/brand/logo-primary.png";
  const DARK_LOGO = "/assets/brand/logo-primary.png";
  const PRODUCT_IMAGE_FALLBACKS = [
    "/assets/images/products/product-1.jpg",
    "/assets/images/products/product-2.jpg",
    "/assets/images/hero/hero-2.jpg",
    "/assets/images/products/product-4.jpg",
    "/assets/images/products/product-5.jpg",
    "/assets/images/products/product-1.jpg",
    "/assets/images/products/product-2.jpg",
    "/assets/brand/favicon.png",
    "/assets/brand/logo-primary.png"
  ];
  const DEFAULT_PRODUCT_IMAGE = PRODUCT_IMAGE_FALLBACKS[0];
  const THEME_LOGO_IMAGES = [
    LIGHT_LOGO,
    DARK_LOGO,
    "/assets/brand/logo-large.png",
    "/assets/brand/logo-compact.png",
    "/assets/brand/logo-primary.png"
  ].map(normalizeAssetPath);
  const SHOWCASE_FALLBACK_IMAGES = PRODUCT_IMAGE_FALLBACKS.slice(0, 6);
  const DEFAULT_PRICING_CATALOG = {
    schemaVersion: 1,
    types: [
      { id: "standard", name: "Standart", active: true, order: 0, options: [{ id: "standard", label: "Standart", unit: "", order: 0, active: true }] },
      { id: "size", name: "Boyut", active: true, order: 1, options: [
        { id: "small", label: "Küçük", unit: "", order: 0, active: true },
        { id: "medium", label: "Orta", unit: "", order: 1, active: true },
        { id: "large", label: "Büyük", unit: "", order: 2, active: true }
      ] },
      { id: "shot", name: "Shot", active: true, order: 2, options: [
        { id: "single", label: "Single", unit: "", order: 0, active: true },
        { id: "double", label: "Double", unit: "", order: 1, active: true }
      ] }
    ]
  };

  const els = {};
  const state = {
    data: null,
    activeCategory: "all",
    openCategoryId: "",
    search: "",
    channel: null,
    eventSource: null,
    showcaseIndex: 0,
    showcaseTimer: null,
    mediaDbPromise: null,
    mediaHydrating: new Set(),
    mediaUrlCache: new Map(),
    backendRequestId: 0,
    serverEventVersion: 0,
    serverAuthoritative: false,
    previewDraftApplied: false,
    eventSourceWarningShown: false,
    dataSource: "bootstrap"
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    state.data = loadMenuData();
    applyStoredTheme();
    applySettings();
    bindEvents();
    renderMenu();
    setupLiveUpdates();
    setupAdminPreviewBridge();
    await hydrateMenuFromBackend({ reason: "ilk yukleme" });
    if (isPreviewMode()) {
      openMenu();
      applyPreviewCategory();
    }
  }

  function setupAdminPreviewBridge() {
    document.addEventListener("tahmisci:preview-draft", (event) => {
      if (!isPreviewMode()) return;
      const message = event.detail;
      if (!message || message.schemaVersion !== 1 || message.source !== "menu" || message.scope !== "menu") return;
      if (!message.data || typeof message.data !== "object" || Array.isArray(message.data)) return;
      const draft = message.data;
      const pricing = message.pricing || draft.pricing;
      if (applyMenuSnapshot(Object.assign({}, draft, { pricing }), { source: "preview" })) {
        state.previewDraftApplied = true;
        openMenu();
        applyPreviewCategory();
      }
    });
  }

  function cacheElements() {
    els.body = document.body;
    els.home = document.getElementById("home-page");
    els.menu = document.getElementById("menu-page");
    els.categoryTabs = document.getElementById("categoryTabs");
    els.categoryList = document.getElementById("categoryList");
    els.showcaseStage = document.getElementById("showcaseStage");
    els.emptyState = document.getElementById("emptyState");
    els.search = document.getElementById("menuSearch");
    els.suggestions = document.getElementById("searchSuggestions");
    els.aboutModal = document.getElementById("aboutModal");
    els.actionSheet = document.getElementById("actionSheet");
    els.sheetTitle = document.getElementById("sheetTitle");
    els.sheetBody = document.getElementById("sheetBody");
    els.feedbackModal = document.getElementById("feedbackModal");
    els.feedbackText = document.getElementById("feedbackText");
    els.feedbackRating = document.getElementById("feedbackRating");
    els.favoriteDrinkInput = document.getElementById("favoriteDrinkInput");
    els.favoriteSuggestions = document.getElementById("favoriteSuggestions");
    els.favoriteSendButton = document.getElementById("favoriteSendButton");
    els.feedbackStatus = document.getElementById("feedbackStatus");
    els.popularDock = document.getElementById("popularDock");
    els.suggestDock = document.getElementById("suggestDock");
    els.menuUpdateLine = document.getElementById("menuUpdateLine");
    els.logo = document.getElementById("main-logo");
    els.menuHeaderLogo = document.getElementById("menuHeaderLogo");
    els.modeIcons = [
      document.getElementById("mode-icon"),
      document.getElementById("menu-mode-icon")
    ].filter(Boolean);
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);

    if (els.search) {
      els.search.addEventListener("input", handleSearch);
      els.search.addEventListener("focus", handleSearch);
    }

    if (els.feedbackRating) {
      els.feedbackRating.addEventListener("click", handleFeedbackRatingClick);
    }

    if (els.favoriteDrinkInput) {
      els.favoriteDrinkInput.addEventListener("input", handleFavoriteInput);
      els.favoriteDrinkInput.addEventListener("focus", handleFavoriteInput);
    }

    [els.logo, els.menuHeaderLogo].filter(Boolean).forEach((item) => {
      item.addEventListener("contextmenu", (event) => event.preventDefault());
      item.addEventListener("selectstart", (event) => event.preventDefault());
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSheet();
        toggleAbout(false);
        toggleFeedback(false);
        hideSuggestions();
        hideFavoriteSuggestions();
      }
    });
  }

  function handleDocumentClick(event) {
    const actionTarget = event.target.closest("[data-action]");

    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === "theme") toggleTheme();
      if (action === "about") toggleAbout(true);
      if (action === "close-about") toggleAbout(false);
      if (action === "open-menu") openMenu();
      if (action === "feedback-open") toggleFeedback(true);
      if (action === "feedback-close") toggleFeedback(false);
      if (action === "feedback-reset") resetFeedbackForm();
      if (action === "feedback-submit") submitFeedback();
      if (action === "favorite-send") submitFavoriteDrink();
      if (action === "popular") showPopularProducts();
      if (action === "suggest") showSuggestStart();
      if (action === "menu-top") scrollMenuTop();
      if (action === "close-sheet") closeSheet();
      if (action === "suggest-drink") showDrinkTemperatureChoices();
      if (action === "suggest-dessert") suggestProduct({ kind: "dessert" });
      if (action === "suggest-cold") suggestProduct({ kind: "drink", temperature: "cold" });
      if (action === "suggest-hot") suggestProduct({ kind: "drink", temperature: "hot" });
      return;
    }

    const favoriteSuggestion = event.target.closest("[data-favorite-suggestion]");
    if (favoriteSuggestion) {
      setFavoriteInput(favoriteSuggestion.dataset.favoriteSuggestion || "");
      return;
    }

    const tab = event.target.closest("[data-category-tab]");
    if (tab) {
      setActiveCategory(tab.dataset.categoryTab || "all", true);
      return;
    }

    const catButton = event.target.closest("[data-category-toggle]");
    if (catButton) {
      toggleCategory(catButton.dataset.categoryToggle);
      return;
    }

    const suggestion = event.target.closest("[data-suggestion-product]");
    if (suggestion) {
      const categoryId = suggestion.dataset.suggestionCategory;
      const productId = suggestion.dataset.suggestionProduct;
      hideSuggestions();
      if (els.search) els.search.value = suggestion.dataset.suggestionName || "";
      openMenu();
      jumpToProduct(categoryId, productId);
      return;
    }

    if (els.suggestions && !event.target.closest(".menu-search")) {
      hideSuggestions();
    }

    if (els.favoriteSuggestions && !event.target.closest(".favorite-field")) {
      hideFavoriteSuggestions();
    }
  }

  function setupLiveUpdates() {
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) void refreshFromAuthoritativeSource("storage");
    });

    if ("BroadcastChannel" in window) {
      state.channel = new BroadcastChannel(CHANNEL_NAME);
      state.channel.addEventListener("message", (event) => {
        if (event.data && event.data.type === "menu-updated") {
          void refreshFromAuthoritativeSource("broadcast");
        }
      });
    }

    setupBackendMenuEvents();
  }

  async function refreshFromAuthoritativeSource(reason) {
    if (isPreviewMode() && state.previewDraftApplied) return false;
    const refreshed = await hydrateMenuFromBackend({ reason });
    if (refreshed || state.serverAuthoritative) return refreshed;
    return refreshFromStorage();
  }

  function refreshFromStorage() {
    if (state.serverAuthoritative || (isPreviewMode() && state.previewDraftApplied)) return false;
    return applyMenuSnapshot(loadMenuData(), { source: "cache" });
  }

  function loadMenuData() {
    return normalizeStoredState({
      settings: DESIGN_SCHEMA.DEFAULT_SETTINGS,
      categories: []
    });
  }

  async function hydrateMenuFromBackend(options) {
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.fetch || (isPreviewMode() && state.previewDraftApplied)) return false;
    const requestId = ++state.backendRequestId;
    const serverEventVersion = state.serverEventVersion;

    try {
      const result = await backendRequest("/api/menu");
      if (requestId !== state.backendRequestId || serverEventVersion !== state.serverEventVersion) return false;
      if (isPreviewMode() && state.previewDraftApplied) return false;
      const menuState = menuStateFromPayload(result);
      if (!menuState) {
        warnMenuUpdate(`${options && options.reason || "backend"} yaniti gecersiz`, new Error("Menu state bulunamadi."));
        return false;
      }
      return applyMenuSnapshot(menuState, { source: "backend", persistCache: true });
    } catch (error) {
      if (requestId === state.backendRequestId && !(isPreviewMode() && state.previewDraftApplied)) {
        warnMenuUpdate(`${options && options.reason || "backend"} yenilemesi basarisiz`, error);
      }
      return false;
    }
  }

  function setupBackendMenuEvents() {
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.EventSource || state.eventSource) return;

    state.eventSource = new EventSource(`${baseUrl}/api/menu/events`);
    state.eventSource.addEventListener("open", () => {
      state.eventSourceWarningShown = false;
    });
    state.eventSource.addEventListener("menu", (event) => {
      try {
        const payload = JSON.parse(event.data);
        const menuState = menuStateFromPayload(payload);
        if (!menuState) {
          warnMenuUpdate("SSE menu mesaji gecersiz", new Error("Menu state bulunamadi."));
          return;
        }
        state.serverEventVersion += 1;
        state.backendRequestId += 1;
        applyMenuSnapshot(menuState, { source: "sse", persistCache: true });
      } catch (error) {
        warnMenuUpdate("SSE menu mesaji okunamadi", error);
      }
    });
    state.eventSource.addEventListener("error", () => {
      if (state.eventSourceWarningShown) return;
      state.eventSourceWarningShown = true;
      warnMenuUpdate("SSE baglantisi kesildi; tarayici yeniden deneyecek", new Error("EventSource baglanti hatasi."));
    });
  }

  function menuStateFromPayload(payload) {
    const menuState = payload && payload.menuState;
    if (!isMenuStatePayload(menuState)) return null;
    const pricing = payload.pricing || menuState.pricing;
    return pricing ? Object.assign({}, menuState, { pricing }) : menuState;
  }

  function applyMenuSnapshot(menuState, options) {
    const source = options && options.source || "unknown";
    if (!isMenuStatePayload(menuState)) return false;
    if (source !== "preview" && isPreviewMode() && state.previewDraftApplied) return false;

    state.data = normalizeStoredState(menuState);
    state.dataSource = source;
    if (source === "backend" || source === "sse") state.serverAuthoritative = true;
    if (options && options.persistCache) safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
    applySettings();
    if (state.activeCategory !== "all" && !getCategory(state.activeCategory)) {
      state.activeCategory = "all";
      state.openCategoryId = "";
    }
    renderMenu();
    return true;
  }

  function warnMenuUpdate(context, error) {
    const message = error instanceof Error ? error.message : String(error || "Bilinmeyen hata");
    console.warn(`[Tahmisci Menu] ${context}: ${message}`);
  }

  function backendBaseUrl() {
    const queryValue = (() => {
      try {
        return new URLSearchParams(window.location.search).get("backend") || "";
      } catch (error) {
        return "";
      }
    })();
    if (queryValue) safeLocalSet(BACKEND_URL_KEY, queryValue);

    const explicit = window.TAHMISCI_BACKEND_URL
      || queryValue
      || safeLocalGet(BACKEND_URL_KEY)
      || "";
    if (explicit) return String(explicit).replace(/\/+$/, "");

    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.origin;
    }

    return "";
  }

  async function backendRequest(path, options) {
    const headers = options && options.body ? { "Content-Type": "application/json" } : undefined;
    const response = await fetch(`${backendBaseUrl()}${path}`, {
      method: options && options.method || "GET",
      headers,
      credentials: "include",
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.message || "Backend istegi basarisiz.");
    return result;
  }

  function isMenuStatePayload(menuState) {
    return Boolean(menuState && typeof menuState === "object" && !Array.isArray(menuState) && Array.isArray(menuState.categories));
  }

  function normalizeStoredState(raw) {
    const canonical = DESIGN_SCHEMA.normalizeMenuState(raw);
    const settings = Object.assign({}, canonical.settings, {
      banner: normalizeBanner(canonical.settings && canonical.settings.banner)
    });
    const pricing = normalizePricingCatalog(canonical.pricing);
    const categories = canonical.categories
      .map((category, index) => normalizeCategory(category, index, pricing))
      .filter(Boolean);

    return Object.assign({}, canonical, {
      settings,
      pricing,
      categories
    });
  }

  function normalizeCategory(category, index, pricingCatalog) {
    if (!category) return null;
    const id = category.id || makeId("cat", category.name || `Kategori ${index + 1}`);
    return Object.assign({}, category, {
      id,
      name: category.name || "Kategori",
      active: category.active !== false,
      iconKey: category.iconKey || "",
      icon: category.icon || "",
      iconMark: category.iconMark || "",
      color: category.color || "",
      image: category.image || "",
      style: normalizeStyle(category.style || {
        color: category.color || "",
        image: category.image || "",
        imageUrl: "",
        gradientStart: category.color || DESIGN_SCHEMA.DEFAULT_SETTINGS.categoryCardColor,
        gradientEnd: "#E5E7EB",
        gradientAngle: 135,
        overlay: 0.12
      }),
      products: Array.isArray(category.products)
        ? category.products.map((product, productIndex) => normalizeProduct(product, id, productIndex, pricingCatalog)).filter(Boolean)
        : []
    });
  }

  function normalizeProduct(product, categoryId, index, pricingCatalog) {
    if (!product) return null;
    const prices = normalizePrices(product.prices || pricesFromLegacyProduct(product));
    const priceMode = normalizePriceMode(product, prices);
    const normalizedPrices = normalizePricesForMode(prices, priceMode);
    const pricing = normalizeCanonicalProductPricing(product.pricing, priceMode, normalizedPrices, product.variants);
    const priceOptions = pricingOptionsForProduct(pricing, pricingCatalog);
    return Object.assign({}, product, {
      id: product.id || makeId(`${categoryId}-urun`, product.name || `Ürün ${index + 1}`),
      name: product.name || "Ürün",
      desc: product.desc || "",
      active: product.active !== false,
      stock: product.stock || (product.soldOut ? "sold-out" : "active"),
      image: product.image || product.img || "",
      imageUrl: product.imageUrl || "",
      imageOverlay: Number(product.imageOverlay || 0),
      cardColor: product.cardColor || "",
      style: normalizeStyle(product.style || {
        color: product.cardColor || "",
        image: "",
        imageUrl: "",
        gradientStart: product.cardColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.productCardColor,
        gradientEnd: "#E5E7EB",
        gradientAngle: 145,
        overlay: Number(product.cardOverlay || 0)
      }),
      priceMode,
      prices: normalizedPrices,
      pricing,
      priceOptions,
      variants: priceOptions.length
        ? priceOptions.map((option) => ({ id: option.id, label: option.label, name: option.label, unit: option.unit, price: option.price }))
        : normalizeVariants(product.variants, normalizedPrices, priceMode),
      popular: Boolean(product.popular),
      kind: product.kind || inferKind("", "", product.name || ""),
      temperature: product.temperature || inferTemperature("", "", product.name || ""),
      details: Object.assign({}, product.details, {
        calories: product.details && product.details.calories || product.calories || "",
        allergens: product.details && product.details.allergens || product.allergens || "",
        ingredients: product.details && product.details.ingredients || product.ingredients || ""
      })
    });
  }

  function normalizeBackground(bg) {
    return DESIGN_SCHEMA.normalizeBackground(bg);
  }

  function normalizeFonts(fonts) {
    return DESIGN_SCHEMA.normalizeFonts(fonts);
  }

  function normalizeTypography(typography) {
    return DESIGN_SCHEMA.normalizeTypography(typography);
  }

  function normalizeBottomActions(actions) {
    return DESIGN_SCHEMA.normalizeBottomActions(actions);
  }

  function normalizeBanner(banner) {
    const source = DESIGN_SCHEMA.normalizeBanner(banner);
    const legacyVideo = String(source.videoUrl || source.video || "").trim();
    const videoItems = Array.isArray(source.videos)
      ? source.videos
      : legacyVideo
        ? [{ src: legacyVideo, name: "Yüklenen video", kind: "video" }]
        : [];
    return Object.assign({}, source, {
      mode: source.mode,
      title: source.title,
      subtitle: source.subtitle,
      video: String(source.video || "").trim(),
      videoUrl: String(source.videoUrl || "").trim(),
      videos: normalizeMediaList(videoItems, "video"),
      images: normalizeMediaList(source.images, "image"),
      productIds: Array.isArray(source.productIds)
        ? source.productIds.map((item) => String(item || "").trim()).filter(Boolean)
        : []
    });
  }

  function normalizeMediaList(value, kind) {
    const list = Array.isArray(value)
      ? value
      : String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    return list.map((item, index) => normalizeMediaItem(item, index, kind)).filter((item) => item.src);
  }

  function normalizeMediaItem(item, index, kind) {
    if (typeof item === "string") {
      const src = item.trim();
      return {
        id: mediaIdFromRef(src),
        src,
        name: defaultMediaName(src, index, kind),
        type: "",
        size: 0,
        kind
      };
    }
    const source = item && typeof item === "object" ? item : {};
    const src = String(source.src || source.url || source.data || "").trim();
    return Object.assign({}, source, {
      id: String(source.id || mediaIdFromRef(src) || "").trim(),
      src,
      name: String(source.name || defaultMediaName(src, index, kind)).trim(),
      type: String(source.type || "").trim(),
      size: Number(source.size || 0),
      kind: source.kind || kind
    });
  }

  function mediaIdFromRef(src) {
    const value = String(src || "");
    return value.startsWith(MEDIA_REF_PREFIX) ? value.slice(MEDIA_REF_PREFIX.length) : "";
  }

  function defaultMediaName(src, index, kind) {
    if (!src) return kind === "video" ? `Video ${index + 1}` : `Görsel ${index + 1}`;
    try {
      const url = new URL(src, window.location.href);
      const name = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (name) return name;
    } catch (error) {
      const parts = src.split(/[\\/]/);
      const last = parts[parts.length - 1];
      if (last && !last.startsWith("data:") && !last.startsWith(MEDIA_REF_PREFIX)) return last;
    }
    return kind === "video" ? `Video ${index + 1}` : `Görsel ${index + 1}`;
  }

  function normalizeStyle(style, defaults) {
    return DESIGN_SCHEMA.normalizeStyle(style, defaults);
  }

  function normalizePricingCatalog(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const byId = new Map();
    (Array.isArray(source.types) ? source.types : []).forEach((type, typeIndex) => {
      if (!type || typeof type !== "object") return;
      const id = normalizePricingId(type.id);
      if (!id || byId.has(id)) return;
      const options = [];
      const optionIds = new Set();
      (Array.isArray(type.options) ? type.options : []).forEach((option, optionIndex) => {
        if (!option || typeof option !== "object") return;
        const optionId = normalizePricingId(option.id);
        if (!optionId || optionIds.has(optionId)) return;
        optionIds.add(optionId);
        options.push(Object.assign({}, option, {
          id: optionId,
          label: String(option.label || option.name || optionId),
          unit: String(option.unit || ""),
          order: Number.isFinite(Number(option.order)) ? Number(option.order) : optionIndex,
          active: option.active !== false
        }));
      });
      byId.set(id, Object.assign({}, type, {
        id,
        name: String(type.name || type.label || id),
        order: Number.isFinite(Number(type.order)) ? Number(type.order) : typeIndex,
        active: type.active !== false,
        options: options.sort((a, b) => a.order - b.order)
      }));
    });
    DEFAULT_PRICING_CATALOG.types.forEach((type) => {
      if (!byId.has(type.id)) byId.set(type.id, JSON.parse(JSON.stringify(type)));
    });
    return Object.assign({}, source, {
      schemaVersion: 1,
      types: Array.from(byId.values()).sort((a, b) => a.order - b.order)
    });
  }

  function normalizeCanonicalProductPricing(value, legacyMode, legacyPrices, legacyVariants) {
    if (value && typeof value === "object" && !Array.isArray(value) && value.typeId) {
      const values = {};
      Object.entries(value.values && typeof value.values === "object" ? value.values : {}).forEach(([optionId, rawValue]) => {
        const id = normalizePricingId(optionId);
        if (!id) return;
        const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : { price: rawValue };
        values[id] = Object.assign({}, source, { price: cleanPriceOrNull(source.price), active: source.active !== false });
      });
      return Object.assign({}, value, { typeId: normalizePricingId(value.typeId) || "standard", values });
    }

    if (legacyMode === "singleDouble") {
      return { typeId: "shot", values: {
        single: { price: cleanPriceOrNull(legacyPrices.single), active: true },
        double: { price: cleanPriceOrNull(legacyPrices.double), active: true }
      } };
    }
    if (legacyMode === "sizes") {
      return { typeId: "size", values: {
        small: { price: cleanPriceOrNull(legacyPrices.k), active: true },
        medium: { price: cleanPriceOrNull(legacyPrices.o), active: true },
        large: { price: cleanPriceOrNull(legacyPrices.b), active: true }
      } };
    }
    if (Array.isArray(legacyVariants) && legacyVariants.length > 1) {
      const values = {};
      legacyVariants.forEach((variant, index) => {
        const id = normalizePricingId(variant.id || variant.label || variant.name) || `option-${index + 1}`;
        values[id] = { price: cleanPriceOrNull(variant.price), active: variant.active !== false, label: variant.label || variant.name || id };
      });
      return { typeId: "legacy-variants", values };
    }
    return { typeId: "standard", values: { standard: { price: cleanPriceOrNull(legacyPrices.standard), active: true } } };
  }

  function pricingOptionsForProduct(productPricing, pricingCatalog) {
    const catalog = normalizePricingCatalog(pricingCatalog);
    const type = catalog.types.find((item) => item.id === productPricing.typeId);
    const knownIds = new Set();
    const result = [];
    (type && type.options || []).forEach((option) => {
      knownIds.add(option.id);
      const value = productPricing.values[option.id];
      if (!value || option.active === false || value.active === false || value.price === null) return;
      result.push({ id: option.id, label: option.label, unit: option.unit || "", order: option.order, price: value.price });
    });
    Object.entries(productPricing.values || {}).forEach(([optionId, value]) => {
      if (knownIds.has(optionId) || !value || value.active === false || value.price === null) return;
      result.push({
        id: optionId,
        label: String(value.label || optionId),
        unit: String(value.unit || ""),
        order: Number.isFinite(Number(value.order)) ? Number(value.order) : result.length,
        price: value.price
      });
    });
    return result.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function normalizePricingId(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }

  function cleanPriceOrNull(value) {
    const price = cleanPrice(value);
    return price === "" ? null : price;
  }

  function normalizeVariants(variants, prices, priceMode) {
    if (priceMode === "standard") {
      return [{ label: "", price: prices.standard }];
    }
    if (priceMode === "singleDouble") {
      return [
        { label: "Single", price: prices.single },
        { label: "Double", price: prices.double }
      ];
    }
    if (Array.isArray(variants) && variants.length) {
      const normalizedVariants = variants.map((variant) => ({
        label: variant.label || variant.name || "",
        price: cleanPrice(variant.price)
      })).filter((variant) => variant.label);
      if (normalizedVariants.length) return normalizedVariants;
    }
    return [
      { label: "K", price: prices.k },
      { label: "O", price: prices.o },
      { label: "B", price: prices.b }
    ];
  }

  function pricesFromLegacyProduct(product) {
    const prices = { standard: "", k: "", o: "", b: "", single: "", double: "" };
    const variants = Array.isArray(product && product.variants) ? product.variants : [];

    if (variants.length) {
      variants.forEach((variant) => {
        const label = normalizeText(variant.name || "");
        const price = variant.price ?? "";
        if (!price && price !== 0) return;

        if (label.includes("KUCUK") || label === "K") prices.k = price;
        else if (label.includes("ORTA") || label === "O") prices.o = price;
        else if (label.includes("BUYUK") || label === "B") prices.b = price;
        else if (label.includes("SINGLE")) prices.single = price;
        else if (label.includes("DOUBLE")) prices.double = price;
        else if (label.includes("TEK") || label.includes("FINCAN") || label.includes("PORSIYON") || label.includes("ADET")) prices.standard = price;
        else if (variants.length === 1) prices.standard = price;
        else if (!prices.k) prices.k = price;
        else if (!prices.o) prices.o = price;
        else if (!prices.b) prices.b = price;
      });
    } else if (product && (product.price || product.price === 0)) {
      prices.standard = product.price;
    }

    return normalizePrices(prices);
  }

  function normalizePrices(prices) {
    return {
      standard: cleanPrice(prices && prices.standard),
      k: cleanPrice(prices && prices.k),
      o: cleanPrice(prices && prices.o),
      b: cleanPrice(prices && prices.b),
      single: cleanPrice(prices && prices.single),
      double: cleanPrice(prices && prices.double)
    };
  }

  function normalizePriceMode(product, prices) {
    if (product && product.priceMode === "sizes") return "sizes";
    if (product && product.priceMode === "singleDouble") return "singleDouble";
    if (product && product.priceMode === "standard") return "standard";
    if (hasPrice(prices.standard)) return "standard";
    if (hasPrice(prices.single) || hasPrice(prices.double)) return "singleDouble";
    if (hasPrice(prices.o) && !hasPrice(prices.k) && !hasPrice(prices.b)) return "standard";
    if (hasPrice(prices.k) || hasPrice(prices.o) || hasPrice(prices.b)) return "sizes";
    return "standard";
  }

  function normalizePricesForMode(prices, priceMode) {
    if (priceMode === "standard") {
      return {
        standard: firstFilledPrice(prices.standard, prices.o, prices.k, prices.b, prices.single, prices.double),
        k: "",
        o: "",
        b: "",
        single: "",
        double: ""
      };
    }
    if (priceMode === "singleDouble") {
      return {
        standard: "",
        k: "",
        o: "",
        b: "",
        single: prices.single,
        double: prices.double
      };
    }
    return {
      standard: "",
      k: prices.k,
      o: prices.o,
      b: prices.b,
      single: "",
      double: ""
    };
  }

  function cleanPrice(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    const cleaned = String(value).replace(/[^\d.,]/g, "").replace(",", ".").trim();
    if (!cleaned) return "";
    const numberValue = Number(cleaned);
    return Number.isFinite(numberValue) ? numberValue : "";
  }

  function firstFilledPrice() {
    return Array.from(arguments).find(hasPrice) ?? "";
  }

  function hasPrice(value) {
    return value !== "" && value !== null && value !== undefined;
  }

  function inferKind(top, sub, product) {
    const text = normalizeText(`${top} ${sub} ${product}`);
    if (/(TATLI|PASTA|WAFFLE|SAN SEBASTIAN|MAGNOLIA|CHEESECAKE|KURABIYE|DONDURMA)/.test(text)) return "dessert";
    if (/(SANDVIC|TOST|YIYECEK|KAHVALTI)/.test(text)) return "food";
    return "drink";
  }

  function inferTemperature(top, sub, product) {
    const text = normalizeText(`${top} ${sub} ${product}`);
    if (/(SOGUK|FROZEN|MILKSHAKE|ICE|BUZLU|LIMONATA|CHURCHILL|SMOOTHIE)/.test(text)) return "cold";
    if (/(SICAK|ESPRESSO|LATTE|CAPPUCCINO|AMERICANO|TURK|CAY|SAHLEP|SALEP|KAHVE)/.test(text)) return "hot";
    return "none";
  }

  function applyStoredTheme() {
    const storedTheme = safeLocalGet(THEME_KEY);
    const shouldUseDark = storedTheme !== "light";
    document.body.classList.toggle("dark-mode", shouldUseDark);
    safeLocalSet(THEME_KEY, shouldUseDark ? "dark" : "light");
    updateThemeIcons();
  }

  function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    safeLocalSet(THEME_KEY, document.body.classList.contains("dark-mode") ? "dark" : "light");
    applySettings();
    renderMenu();
    updateThemeIcons();
  }

  function updateThemeIcons() {
    const dark = document.body.classList.contains("dark-mode");
    els.modeIcons.forEach((icon) => {
      icon.dataset.theme = dark ? "light" : "dark";
      const button = icon.closest("button");
      if (button) {
        const label = dark ? "Açık temaya geç" : "Koyu temaya geç";
        button.setAttribute("aria-label", label);
        button.title = label;
      }
    });
    if (els.logo) {
      els.logo.src = dark ? DARK_LOGO : LIGHT_LOGO;
    }
    if (els.menuHeaderLogo) {
      els.menuHeaderLogo.src = dark ? DARK_LOGO : LIGHT_LOGO;
    }
  }

  function applySettings() {
    const settings = state.data.settings || DESIGN_SCHEMA.DEFAULT_SETTINGS;
    const root = document.documentElement;
    const isDark = document.body.classList.contains("dark-mode");
    const menuBackground = buildMenuBackground(settings, isDark);
    const fonts = normalizeFonts(settings.fonts);
    const typography = normalizeTypography(settings.typography);
    root.style.setProperty("--bg-color", isDark ? "#140905" : settings.bgColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.bgColor);
    root.style.setProperty("--dark-bg-color", "#140905");
    root.style.setProperty("--accent-color", isDark ? "#EFE1D0" : settings.accentColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.accentColor);
    root.style.setProperty("--text-color", isDark ? "#F8E9D2" : settings.textColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.textColor);
    root.style.setProperty("--btn-text", settings.buttonTextColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.buttonTextColor);
    root.style.setProperty("--card-bg", isDark ? "rgba(33,17,10,0.92)" : settings.cardColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.cardColor);
    root.style.setProperty("--product-card-bg", isDark ? "#21110A" : settings.productCardColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.productCardColor);
    root.style.setProperty("--category-card-bg", isDark ? "#2A160D" : settings.categoryCardColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.categoryCardColor);
    root.style.setProperty("--social-icon-color", isDark ? "#EFE1D0" : settings.socialIconColor || settings.accentColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.socialIconColor);
    root.style.setProperty("--social-icon-size", `${clamp(Number(settings.socialIconSize || DESIGN_SCHEMA.DEFAULT_SETTINGS.socialIconSize), 18, 64)}px`);
    root.style.setProperty("--menu-header-bg", buildMenuHeaderBackground(settings, isDark));
    root.style.setProperty("--title-font", fonts.title);
    root.style.setProperty("--category-font", fonts.category);
    root.style.setProperty("--product-font", fonts.product);
    root.style.setProperty("--menu-title-size", `${typography.menuTitle}px`);
    root.style.setProperty("--category-title-size", `${typography.categoryTitle}px`);
    root.style.setProperty("--product-title-size", `${typography.productTitle}px`);
    root.style.setProperty("--product-desc-size", `${typography.productDesc}px`);
    root.style.setProperty("--product-ingredients-size", `${typography.productIngredients}px`);
    root.style.setProperty("--product-price-size", `${typography.productPrice}px`);

    if (els.menu) {
      els.menu.style.background = menuBackground;
    }
    applyBoxBackground(els.popularDock, settings.bottomActions && settings.bottomActions.popular, settings.accentColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.accentColor);
    applyBoxBackground(els.suggestDock, settings.bottomActions && settings.bottomActions.suggest, settings.accentColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.accentColor);
    applyDockButtonText(els.popularDock);
    applyDockButtonText(els.suggestDock);
    renderMenuUpdateLine(settings.menuUpdateDate);
  }

  function renderMenuUpdateLine(dateValue) {
    if (!els.menuUpdateLine) return;
    if (!dateValue) {
      els.menuUpdateLine.hidden = true;
      els.menuUpdateLine.textContent = "";
      return;
    }
    els.menuUpdateLine.hidden = false;
    els.menuUpdateLine.textContent = `Menü ${formatDisplayDate(dateValue)} tarihinde güncellendi`;
  }

  function openMenu() {
    els.home.style.display = "none";
    els.menu.classList.add("is-open");
    els.menu.setAttribute("aria-hidden", "false");
    document.body.classList.add("menu-open");
    renderShowcaseStage();
    startShowcaseRotation();
    window.setTimeout(() => els.menu.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function isPreviewMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      return ["menu", "admin"].includes(params.get("preview"));
    } catch (error) {
      return false;
    }
  }

  function previewCategoryId() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("category") || params.get("previewCategory") || "";
    } catch (error) {
      return "";
    }
  }

  function applyPreviewCategory() {
    const categoryId = previewCategoryId();
    if (!categoryId || !getCategory(categoryId)) return;
    state.activeCategory = categoryId;
    state.openCategoryId = categoryId;
    renderMenu();
    window.setTimeout(() => {
      const target = document.getElementById(`category-${categoryId}`);
      if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
  }

  function scrollMenuTop() {
    closeSheet();
    state.activeCategory = "all";
    state.openCategoryId = "";
    renderMenu();
    els.menu.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleAbout(show) {
    els.aboutModal.classList.toggle("is-open", Boolean(show));
    els.aboutModal.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function renderMenu() {
    renderTabs();
    renderShowcaseStage();
    renderCategories();
  }

  function showcaseProducts() {
    const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
    const products = flattenProducts().filter(({ product }) => product.kind !== "extra");
    if (banner.mode !== "products" || !banner.productIds.length) return products;
    const selected = new Set(banner.productIds);
    const picked = products.filter(({ product }) => selected.has(product.id));
    return picked.length ? picked : products;
  }

  function productStageImage(entry, index) {
    const product = entry && entry.product || {};
    return productDisplayImage(product, entry && entry.category, index, SHOWCASE_FALLBACK_IMAGES);
  }

  function bannerVideoItems(banner) {
    const videos = Array.isArray(banner.videos) ? banner.videos.slice() : [];
    const legacy = String(banner.videoUrl || banner.video || "").trim();
    if (!videos.length && legacy) videos.push({ src: legacy, name: "Video", kind: "video" });
    return videos;
  }

  function mediaItemSource(item) {
    return typeof item === "string" ? item : String(item && item.src || "");
  }

  function isStoredMediaRef(src) {
    return String(src || "").startsWith(MEDIA_REF_PREFIX);
  }

  function openMediaDb() {
    if (!window.indexedDB) return Promise.reject(new Error("Tarayici medya depolamayi desteklemiyor."));
    if (state.mediaDbPromise) return state.mediaDbPromise;
    state.mediaDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(MEDIA_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          db.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Medya deposu acilamadi."));
    });
    return state.mediaDbPromise;
  }

  async function getStoredMediaRecord(id) {
    const db = await openMediaDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readonly");
      const request = tx.objectStore(MEDIA_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Medya okunamadi."));
    });
  }

  async function resolveMediaSource(item) {
    const src = mediaItemSource(item);
    if (!isStoredMediaRef(src)) return src;
    if (state.mediaUrlCache.has(src)) return state.mediaUrlCache.get(src);
    const record = await getStoredMediaRecord(mediaIdFromRef(src));
    if (!record || !record.blob) {
      state.mediaUrlCache.set(src, "");
      return "";
    }
    const url = URL.createObjectURL(record.blob);
    state.mediaUrlCache.set(src, url);
    return url;
  }

  function hydrateBannerMedia(banner) {
    const items = banner.mode === "video"
      ? bannerVideoItems(banner)
      : banner.mode === "images"
        ? banner.images
        : [];
    const missing = items.filter((item) => {
      const src = mediaItemSource(item);
      return isStoredMediaRef(src) && !state.mediaUrlCache.has(src);
    });
    missing.forEach((item) => {
      const src = mediaItemSource(item);
      if (state.mediaHydrating.has(src)) return;
      state.mediaHydrating.add(src);
      resolveMediaSource(item)
        .catch((error) => {
          state.mediaUrlCache.set(src, "");
          console.warn("Banner medyasi okunamadi.", error);
        })
        .finally(() => {
          state.mediaHydrating.delete(src);
          renderShowcaseStage();
        });
    });
    return missing.length > 0;
  }

  function renderShowcaseStage() {
    if (!els.showcaseStage) return;
    const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
    const waitingForMedia = hydrateBannerMedia(banner);
    if (waitingForMedia) {
      els.showcaseStage.hidden = false;
      els.showcaseStage.classList.toggle("is-video", banner.mode === "video");
      els.showcaseStage.style.removeProperty("--showcase-image");
      els.showcaseStage.innerHTML = `<div class="showcase-loading">Medya hazırlanıyor...</div>`;
      return;
    }

    const videos = bannerVideoItems(banner);
    const bannerVideoItem = videos.length ? videos[state.showcaseIndex % videos.length] : null;
    const bannerVideo = bannerVideoItem ? mediaItemSource(bannerVideoItem) : "";
    const resolvedBannerVideo = isStoredMediaRef(bannerVideo) ? state.mediaUrlCache.get(bannerVideo) || "" : bannerVideo;
    els.showcaseStage.classList.toggle("is-video", banner.mode === "video" && Boolean(resolvedBannerVideo));
    if (banner.mode === "video" && resolvedBannerVideo) {
      state.showcaseIndex %= videos.length;
      const videoSource = normalizeBannerVideoSource(resolvedBannerVideo);
      els.showcaseStage.hidden = false;
      els.showcaseStage.style.removeProperty("--showcase-image");
      els.showcaseStage.innerHTML = videoSource.type === "iframe"
        ? `<iframe class="showcase-video-embed" src="${escapeAttribute(videoSource.src)}" title="BANNER video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`
        : `<video class="showcase-video" src="${escapeAttribute(videoSource.src)}" autoplay muted loop playsinline preload="metadata"></video>`;
      return;
    }

    if (banner.mode === "images" && banner.images.length) {
      state.showcaseIndex %= banner.images.length;
      const imageItem = banner.images[state.showcaseIndex];
      const imageRef = mediaItemSource(imageItem);
      const image = isStoredMediaRef(imageRef) ? state.mediaUrlCache.get(imageRef) || DEFAULT_PRODUCT_IMAGE : imageRef;
      els.showcaseStage.hidden = false;
      els.showcaseStage.style.setProperty("--showcase-image", `url("${cssUrl(image)}")`);
      els.showcaseStage.innerHTML = `
        <div class="showcase-copy">
          <span>BANNER</span>
          <h2>${escapeHTML(banner.title)}</h2>
          ${banner.subtitle ? `<p>${escapeHTML(banner.subtitle)}</p>` : ""}
        </div>
        <div class="showcase-media">
          <img src="${escapeAttribute(image)}" alt="${escapeAttribute(banner.title)}">
        </div>
      `;
      const imageElement = els.showcaseStage.querySelector("img");
      if (imageElement) {
        imageElement.addEventListener("error", () => {
          els.showcaseStage.style.setProperty("--showcase-image", `url("${cssUrl(DEFAULT_PRODUCT_IMAGE)}")`);
          imageElement.src = DEFAULT_PRODUCT_IMAGE;
        }, { once: true });
      }
      return;
    }

    const products = showcaseProducts();
    if (!products.length) {
      els.showcaseStage.hidden = true;
      els.showcaseStage.innerHTML = "";
      els.showcaseStage.style.removeProperty("--showcase-image");
      els.showcaseStage.classList.remove("is-video");
      return;
    }

    state.showcaseIndex %= products.length;
    const entry = products[state.showcaseIndex];
    const product = entry.product;
    const priceLine = priceSummary(product);
    const image = productStageImage(entry, state.showcaseIndex);

    els.showcaseStage.hidden = false;
    els.showcaseStage.style.setProperty("--showcase-image", `url("${cssUrl(image)}")`);
    els.showcaseStage.innerHTML = `
      <div class="showcase-copy">
        <span>${escapeHTML(entry.category.name)}</span>
        <h2>${escapeHTML(product.name)}</h2>
        ${product.desc ? `<p>${escapeHTML(product.desc)}</p>` : ""}
        ${priceLine ? `<strong>${escapeHTML(priceLine)}</strong>` : ""}
      </div>
      <div class="showcase-media">
        <img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name)}">
      </div>
    `;

    const img = els.showcaseStage.querySelector("img");
    if (img) {
      img.addEventListener("error", () => {
        els.showcaseStage.style.setProperty("--showcase-image", `url("${cssUrl(DEFAULT_PRODUCT_IMAGE)}")`);
        img.src = DEFAULT_PRODUCT_IMAGE;
        img.classList.add("is-logo-fallback");
      }, { once: true });
    }
  }

  function normalizeBannerVideoSource(value) {
    const raw = String(value || "").trim();
    if (!raw) return { type: "video", src: "" };
    if (!isSafeMediaUrl(raw)) return { type: "video", src: "" };
    if (/^data:video\//i.test(raw)) return { type: "video", src: raw };

    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch (error) {
      return { type: "video", src: "" };
    }

    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
    const youtubeId = youtubeVideoId(url, host);
    if (youtubeId) {
      return {
        type: "iframe",
        src: `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(youtubeId)}&playsinline=1&controls=1&rel=0&modestbranding=1`
      };
    }

    const vimeoId = vimeoVideoId(url, host);
    if (vimeoId) {
      return {
        type: "iframe",
        src: `https://player.vimeo.com/video/${encodeURIComponent(vimeoId)}?autoplay=1&muted=1&loop=1&autopause=0&playsinline=1`
      };
    }

    if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i.test(url.pathname + url.search)) {
      return { type: "video", src: raw };
    }

    return { type: "video", src: "" };
  }

  function youtubeVideoId(url, host) {
    if (host === "youtu.be") return cleanVideoId(url.pathname.split("/").filter(Boolean)[0]);
    if (!host.endsWith("youtube.com") && !host.endsWith("youtube-nocookie.com")) return "";
    if (url.searchParams.get("v")) return cleanVideoId(url.searchParams.get("v"));
    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((part) => ["embed", "shorts", "live", "v"].includes(part));
    return marker >= 0 ? cleanVideoId(parts[marker + 1]) : "";
  }

  function vimeoVideoId(url, host) {
    if (!host.endsWith("vimeo.com")) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts.find((part) => /^\d+$/.test(part));
    return id || "";
  }

  function cleanVideoId(value) {
    const id = String(value || "").trim().split(/[?&#]/)[0];
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : "";
  }

  function startShowcaseRotation() {
    if (state.showcaseTimer) return;
    state.showcaseTimer = window.setInterval(() => {
      const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
      const count = banner.mode === "video"
        ? bannerVideoItems(banner).length
        : banner.mode === "images" && banner.images.length
          ? banner.images.length
          : showcaseProducts().length;
      if (!count || count < 2) return;
      state.showcaseIndex = (state.showcaseIndex + 1) % count;
      renderShowcaseStage();
    }, 2000);
  }

  function renderTabs() {
    const categories = visibleCategories();
    const allCount = categories.reduce((sum, category) => sum + visibleProducts(category).length, 0);
    els.categoryTabs.innerHTML = "";
    els.categoryTabs.appendChild(makeTab("Tümü", "all", allCount, "▦"));
    categories.forEach((category) => {
      els.categoryTabs.appendChild(makeTab(category.name, category.id, visibleProducts(category).length, category.iconMark || ""));
    });
  }

  function makeTab(label, id, count, iconMark) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-item${state.activeCategory === id ? " active" : ""}`;
    button.dataset.categoryTab = id;
    button.innerHTML = `${iconMark ? `<span class="tab-icon" aria-hidden="true">${escapeHTML(iconMark)}</span>` : ""}${escapeHTML(label)} <small>${count}</small>`;
    return button;
  }

  function renderCategories() {
    const categories = state.activeCategory === "all"
      ? visibleCategories()
      : visibleCategories().filter((category) => category.id === state.activeCategory);

    els.categoryList.innerHTML = "";
    els.emptyState.hidden = categories.length !== 0;

    categories.forEach((category) => {
      els.categoryList.appendChild(buildCategoryCard(category));
    });
  }

  function buildCategoryCard(category) {
    const card = document.createElement("article");
    card.className = "cat-card";
    card.id = `category-${category.id}`;
    if (state.openCategoryId === category.id || state.activeCategory === category.id) {
      card.classList.add("is-open");
    }
    const isDark = document.body.classList.contains("dark-mode");
    const categoryFallback = isDark ? "#2A160D" : state.data.settings.categoryCardColor;
    applyBoxBackground(card, themedCategoryStyle(category.style, isDark), category.color || categoryFallback);

    const button = document.createElement("button");
    button.className = "cat-button";
    button.type = "button";
    button.dataset.categoryToggle = category.id;
    button.innerHTML = `
      <div class="cat-info">
        <h3>${category.iconMark ? `<span aria-hidden="true">${escapeHTML(category.iconMark)}</span> ` : ""}${escapeHTML(category.name)}</h3>
        <span>${visibleProducts(category).length} ürün</span>
      </div>
      <div class="arrow-icon" aria-hidden="true">▼</div>
    `;

    const details = document.createElement("div");
    details.className = "product-details";
    const grid = document.createElement("div");
    grid.className = "product-grid";

    const products = visibleProducts(category);
    if (products.length) {
      products.forEach((product, index) => grid.appendChild(buildProductCard(product, category, index)));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Bu kategoride henüz ürün yok.";
      grid.appendChild(empty);
    }

    details.appendChild(grid);
    card.appendChild(button);
    card.appendChild(details);
    return card;
  }

  function buildProductCard(product, category, index) {
    const card = document.createElement("article");
    card.className = "product-item";
    card.id = `product-${product.id}`;
    const isDark = document.body.classList.contains("dark-mode");
    const productFallback = isDark ? "#21110A" : state.data.settings.productCardColor;
    applyBoxBackground(card, themedBoxStyle(product.style, isDark, "#21110A", "#2A160D"), product.cardColor || productFallback);

    const imageSrc = productDisplayImage(product, category, index);
    const isThemeLogo = isThemeLogoImage(imageSrc);
    card.innerHTML = `
      ${product.popular ? `<div class="popular-star" aria-label="Popüler ürün">★</div>` : ""}
      <div class="prod-img${isThemeLogo ? " is-theme-logo-frame" : ""}">
        <img class="${isThemeLogo ? "is-theme-logo" : ""}" src="${escapeAttribute(imageSrc)}" alt="${escapeAttribute(product.name)}" loading="lazy">
        <span class="media-overlay" style="background: rgba(0,0,0,${clamp(Number(product.imageOverlay || 0), 0, 0.85)})"></span>
      </div>
      <div class="price-container">
        <h4>${escapeHTML(product.name)}</h4>
        ${product.desc ? `<p class="product-desc">${escapeHTML(product.desc)}</p>` : ""}
        ${buildIngredientLine(product)}
        ${buildMetaLine(product)}
        <div class="price-row-inline">
          ${priceFragments(product).map((part, index) => `${index ? `<span class="price-divider">|</span>` : ""}<span>${escapeHTML(formatPricePart(part))}</span>`).join("")}
        </div>
      </div>
    `;

    const img = card.querySelector("img");
    img.addEventListener("error", () => {
      img.classList.add("image-fallback", "is-theme-logo");
      const frame = img.closest(".prod-img");
      if (frame) frame.classList.add("is-theme-logo-frame");
      img.src = DEFAULT_PRODUCT_IMAGE;
    }, { once: true });

    return card;
  }

  function productDisplayImage(product, category, index, imagePool) {
    if (product && (product.imageUrl || product.image)) return product.imageUrl || product.image;
    return productFallbackImage(product, category, index, imagePool);
  }

  function productFallbackImage(product, category, index, imagePool) {
    const pool = imagePool && imagePool.length ? imagePool : PRODUCT_IMAGE_FALLBACKS;
    const text = normalizeText(`${category && category.name || ""} ${product && product.name || ""} ${product && product.desc || ""} ${product && product.kind || ""} ${product && product.temperature || ""}`);
    if (/(FROZEN|MILKSHAKE|SMOOTHIE|LIMONATA|COOL|SOGUK|COLD|ICE|BUZLU|CHURCHILL)/.test(text)) {
      return pool[(Number(index) || 0) % Math.min(5, pool.length)] || DEFAULT_PRODUCT_IMAGE;
    }
    if (/(TATLI|DESSERT|WAFFLE|PASTA|MAGNOLIA|SAN SEBASTIAN|BROWNIE|COOKIE)/.test(text)) {
      return pool[6] || pool[5] || DEFAULT_PRODUCT_IMAGE;
    }
    if (/(KAHVE|COFFEE|ESPRESSO|LATTE|CAPPUCCINO|AMERICANO|MOCHA|TURK|SICAK|HOT|CAY|SALEP|SAHLEP)/.test(text)) {
      return pool[5] || pool[0] || DEFAULT_PRODUCT_IMAGE;
    }
    return pool[(Number(index) || 0) % pool.length] || DEFAULT_PRODUCT_IMAGE;
  }

  function isThemeLogoImage(src) {
    const value = normalizeAssetPath(src);
    return THEME_LOGO_IMAGES.includes(value);
  }

  function setActiveCategory(categoryId, openAfterClick) {
    state.activeCategory = categoryId || "all";
    state.openCategoryId = openAfterClick && categoryId !== "all" ? categoryId : "";
    renderMenu();
    window.setTimeout(() => {
      const target = categoryId === "all" ? null : document.getElementById(`category-${categoryId}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else els.menu.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }

  function toggleCategory(categoryId) {
    state.openCategoryId = state.openCategoryId === categoryId ? "" : categoryId;
    const card = document.getElementById(`category-${categoryId}`);
    if (!card) return;
    card.classList.toggle("is-open", state.openCategoryId === categoryId);
  }

  function handleSearch() {
    const value = (els.search.value || "").trim();
    state.search = value;
    if (!value) {
      hideSuggestions();
      return;
    }

    const matches = flattenProducts().filter((entry) => {
      const q = normalizeText(value);
      return normalizeText(`${entry.product.name} ${entry.product.desc} ${entry.product.details && entry.product.details.ingredients || ""} ${entry.category.name}`).includes(q);
    }).slice(0, 8);

    if (!matches.length) {
      els.suggestions.hidden = false;
      els.suggestions.innerHTML = `<div class="suggestion-item"><strong>Sonuç bulunamadı</strong><span>Başka bir ürün adı deneyin.</span></div>`;
      return;
    }

    els.suggestions.hidden = false;
    els.suggestions.innerHTML = matches.map(({ category, product }) => `
      <button class="suggestion-item" type="button"
        data-suggestion-category="${escapeAttribute(category.id)}"
        data-suggestion-product="${escapeAttribute(product.id)}"
        data-suggestion-name="${escapeAttribute(product.name)}">
        <strong>${escapeHTML(product.name)}</strong>
        <span>${escapeHTML(category.name)} · ${escapeHTML(priceSummary(product))}</span>
      </button>
    `).join("");
  }

  function hideSuggestions() {
    if (!els.suggestions) return;
    els.suggestions.hidden = true;
    els.suggestions.innerHTML = "";
  }

  function jumpToProduct(categoryId, productId) {
    state.activeCategory = categoryId;
    state.openCategoryId = categoryId;
    renderMenu();

    window.setTimeout(() => {
      const productEl = document.getElementById(`product-${productId}`);
      if (!productEl) return;
      productEl.scrollIntoView({ behavior: "smooth", block: "center" });
      productEl.classList.add("is-highlighted");
      window.setTimeout(() => productEl.classList.remove("is-highlighted"), 2400);
    }, 60);
  }

  function showPopularProducts() {
    const popular = flattenProducts().filter(({ product }) => product.popular);
    els.sheetTitle.textContent = "Popüler Ürünler";

    if (!popular.length) {
      els.sheetBody.innerHTML = `<div class="empty-state">Panelden yıldızlanan ürünler burada görünecek.</div>`;
    } else {
      const grid = document.createElement("div");
      grid.className = "popular-grid";
      popular.forEach(({ product, category }, index) => grid.appendChild(buildProductCard(product, category, index)));
      els.sheetBody.innerHTML = "";
      els.sheetBody.appendChild(grid);
    }

    openSheet();
  }

  function showSuggestStart() {
    els.sheetTitle.textContent = "Öneri";
    els.sheetBody.innerHTML = `
      <div class="choice-grid">
        <button class="choice-btn" type="button" data-action="suggest-drink">İçecek</button>
        <button class="choice-btn" type="button" data-action="suggest-dessert">Tatlı</button>
      </div>
    `;
    openSheet();
  }

  function showDrinkTemperatureChoices() {
    els.sheetTitle.textContent = "İçecek Seçimi";
    els.sheetBody.innerHTML = `
      <div class="choice-grid">
        <button class="choice-btn" type="button" data-action="suggest-cold">Soğuk</button>
        <button class="choice-btn" type="button" data-action="suggest-hot">Sıcak</button>
      </div>
    `;
  }

  function suggestProduct(filter) {
    const candidates = flattenProducts().filter(({ product }) => {
      if (filter.kind && product.kind !== filter.kind) return false;
      if (filter.temperature && product.temperature !== filter.temperature) return false;
      return true;
    });

    const fallback = flattenProducts();
    const pool = candidates.length ? candidates : fallback;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    els.sheetTitle.textContent = "Bugünkü Öneri";

    if (!picked) {
      els.sheetBody.innerHTML = `<div class="empty-state">Önerilecek ürün bulunamadı.</div>`;
      return;
    }

    const priceLine = priceSummary(picked.product);
    els.sheetBody.innerHTML = `
      <div class="recommendation-card">
        <div>
          <h3>${escapeHTML(picked.product.name)}</h3>
          <p>${escapeHTML(picked.category.name)}</p>
          <p>${escapeHTML(priceLine)}</p>
        </div>
      </div>
    `;
  }

  function openSheet() {
    els.actionSheet.classList.add("is-open");
    els.actionSheet.setAttribute("aria-hidden", "false");
  }

  function closeSheet() {
    els.actionSheet.classList.remove("is-open");
    els.actionSheet.setAttribute("aria-hidden", "true");
  }

  function toggleFeedback(show) {
    if (!els.feedbackModal) return;
    els.feedbackModal.classList.toggle("is-open", Boolean(show));
    els.feedbackModal.setAttribute("aria-hidden", show ? "false" : "true");
    if (show && els.feedbackText) {
      window.setTimeout(() => els.feedbackText.focus(), 60);
    }
    if (!show) {
      hideFavoriteSuggestions();
    }
  }

  function handleFeedbackRatingClick(event) {
    const button = event.target.closest("[data-feedback-rating]");
    if (!button || !els.feedbackRating) return;
    const rating = clamp(Number(button.dataset.feedbackRating || 0), 1, 5);
    els.feedbackRating.dataset.rating = String(rating);
    updateRatingStars(rating);
  }

  function updateRatingStars(rating) {
    if (!els.feedbackRating) return;
    els.feedbackRating.querySelectorAll("[data-feedback-rating]").forEach((item) => {
      const active = Number(item.dataset.feedbackRating || 0) <= rating;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
  }

  function selectedFeedbackRating() {
    return clamp(Number(els.feedbackRating && els.feedbackRating.dataset.rating || 0), 0, 5);
  }

  function resetFeedbackForm() {
    const selectedRating = selectedFeedbackRating();
    const defaultType = document.querySelector("input[name='feedbackType'][value='istek']");
    if (defaultType) defaultType.checked = true;
    if (els.feedbackText) els.feedbackText.value = "";
    if (els.favoriteDrinkInput) els.favoriteDrinkInput.value = "";
    if (els.feedbackRating) els.feedbackRating.dataset.rating = String(selectedRating);
    updateRatingStars(selectedRating);
    updateFavoriteSendButton();
    hideFavoriteSuggestions();
    setFeedbackStatus("Form sıfırlandı. Puanlama korunuyor.");
    if (els.feedbackText) els.feedbackText.focus();
  }

  async function submitFeedback() {
    if (!els.feedbackModal) return;
    const selectedType = document.querySelector("input[name='feedbackType']:checked");
    const text = (els.feedbackText && els.feedbackText.value || "").trim();
    const favorite = (els.favoriteDrinkInput && els.favoriteDrinkInput.value || "").trim();
    const rating = selectedFeedbackRating();
    if (!text && !favorite && !rating) {
      setFeedbackStatus("Lütfen mesajınızı, favori içeceğinizi veya puanınızı girin.");
      return;
    }
    const type = text
      ? (selectedType ? selectedType.value : "istek")
      : favorite
        ? "favori"
        : "puanlama";
    await saveFeedbackItem({
      type,
      text: text || (type === "favori" ? "Favori içecek bildirimi" : "Puanlama kaydı"),
      favorite,
      rating
    });
    if (els.feedbackText) els.feedbackText.value = "";
    setFeedbackStatus("Gönderildi, teşekkür ederiz.");
  }

  async function submitFavoriteDrink() {
    const favorite = (els.favoriteDrinkInput && els.favoriteDrinkInput.value || "").trim();
    if (!favorite) return;
    await saveFeedbackItem({
      type: "favori",
      text: "Favori içecek bildirimi",
      favorite,
      rating: selectedFeedbackRating()
    });
    els.favoriteDrinkInput.value = "";
    updateFavoriteSendButton();
    hideFavoriteSuggestions();
    setFeedbackStatus("Favori içeceğiniz kaydedildi.");
  }

  async function saveFeedbackItem(item) {
    const payload = Object.assign({
      id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString()
    }, item);

    if (backendBaseUrl() && window.fetch) {
      try {
        await backendRequest("/api/feedback", {
          method: "POST",
          body: { feedback: payload }
        });
        return;
      } catch (error) {
        console.warn("Geri bildirim backend'e gonderilemedi, yerel kayit kullaniliyor.", error);
      }
    }

    const items = readFeedbackItems();
    items.push(payload);
    safeLocalSet(FEEDBACK_STORAGE_KEY, JSON.stringify(items));
  }

  function readFeedbackItems() {
    const stored = safeLocalGet(FEEDBACK_STORAGE_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function handleFavoriteInput() {
    updateFavoriteSendButton();
    renderFavoriteSuggestions();
  }

  function updateFavoriteSendButton() {
    if (!els.favoriteSendButton || !els.favoriteDrinkInput) return;
    els.favoriteSendButton.hidden = !(els.favoriteDrinkInput.value || "").trim();
  }

  function renderFavoriteSuggestions() {
    if (!els.favoriteSuggestions || !els.favoriteDrinkInput) return;
    const query = (els.favoriteDrinkInput.value || "").trim();
    if (!query) {
      hideFavoriteSuggestions();
      return;
    }
    const normalized = normalizeText(query);
    const matches = flattenProducts()
      .filter(({ product }) => normalizeText(product.name).includes(normalized))
      .slice(0, 6);

    if (!matches.length) {
      hideFavoriteSuggestions();
      return;
    }

    els.favoriteSuggestions.hidden = false;
    els.favoriteSuggestions.innerHTML = matches.map(({ product, category }) => `
      <button class="favorite-suggestion" type="button" data-favorite-suggestion="${escapeAttribute(product.name)}">
        <strong>${escapeHTML(product.name)}</strong>
        <span>${escapeHTML(category.name)}</span>
      </button>
    `).join("");
  }

  function setFavoriteInput(value) {
    if (!els.favoriteDrinkInput) return;
    els.favoriteDrinkInput.value = value;
    updateFavoriteSendButton();
    hideFavoriteSuggestions();
    els.favoriteDrinkInput.focus();
  }

  function hideFavoriteSuggestions() {
    if (!els.favoriteSuggestions) return;
    els.favoriteSuggestions.hidden = true;
    els.favoriteSuggestions.innerHTML = "";
  }

  function setFeedbackStatus(message) {
    if (!els.feedbackStatus) return;
    els.feedbackStatus.textContent = message;
    window.clearTimeout(setFeedbackStatus.timer);
    setFeedbackStatus.timer = window.setTimeout(() => {
      if (els.feedbackStatus) els.feedbackStatus.textContent = "";
    }, 2600);
  }

  function flattenProducts() {
    return visibleCategories().flatMap((category) => {
      return visibleProducts(category).map((product) => ({ category, product }));
    });
  }

  function visibleCategories() {
    return (state.data.categories || []).filter((category) => category.active !== false);
  }

  function visibleProducts(category) {
    return (category.products || []).filter((product) => product.active !== false && product.stock !== "sold-out");
  }

  function buildMenuBackground(settings, isDark) {
    const bg = settings.menuBackground || DESIGN_SCHEMA.DEFAULT_SETTINGS.menuBackground;
    const solidColor = isDark ? settings.darkBgColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.darkBgColor : settings.bgColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.bgColor;
    if (bg.type === "image" && (bg.imageUrl || bg.image || settings.menuBackgroundImage)) {
      const image = bg.imageUrl || bg.image || settings.menuBackgroundImage;
      return `linear-gradient(rgba(0,0,0,${bg.overlay}),rgba(0,0,0,${bg.overlay})), url("${image}") center / cover, ${solidColor}`;
    }
    if (isDark) {
      return "radial-gradient(circle at 18% 12%, rgba(111,90,75,0.18), transparent 34%), radial-gradient(circle at 82% 76%, rgba(239,225,208,0.08), transparent 38%), linear-gradient(145deg, #140905 0%, #180B06 52%, #2A160D 100%)";
    }
    if (bg.type === "gradient") {
      return `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientStart}, ${bg.gradientEnd})`;
    }
    return solidColor;
  }

  function buildMenuHeaderBackground(settings, isDark) {
    const bg = settings.menuBackground || DESIGN_SCHEMA.DEFAULT_SETTINGS.menuBackground;
    if (isDark) {
      return "linear-gradient(145deg, rgba(20,9,5,0.96), rgba(33,17,10,0.92), rgba(42,22,13,0.86))";
    }
    if (bg.type === "gradient") {
      return `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientStart}, ${bg.gradientEnd})`;
    }
    return settings.bgColor || DESIGN_SCHEMA.DEFAULT_SETTINGS.bgColor;
  }

  function applyBoxBackground(element, style, fallbackColor) {
    if (!element) return;
    const image = style && (style.imageUrl || style.image);
    const type = style && style.type || (image ? "image" : "gradient");
    if (type === "image" && image) {
      element.style.background = `linear-gradient(rgba(0,0,0,${style.overlay}),rgba(0,0,0,${style.overlay})), url("${image}") center / cover, ${style.color || fallbackColor}`;
      element.style.setProperty("--card-overlay", style.overlay || 0);
      return;
    }
    if (type === "gradient" && style && (style.gradientStart || style.gradientEnd)) {
      element.style.background = `linear-gradient(${style.gradientAngle || 145}deg, ${style.gradientStart || fallbackColor}, ${style.gradientEnd || fallbackColor})`;
      element.style.setProperty("--card-overlay", style.overlay || 0);
      return;
    }
    element.style.background = style && style.color || fallbackColor;
    element.style.setProperty("--card-overlay", style && style.overlay || 0);
  }

  function themedBoxStyle(style, isDark, gradientStart, gradientEnd) {
    if (!isDark) return style;
    const image = style && (style.imageUrl || style.image);
    if (image) {
      return Object.assign({}, style, {
        overlay: Math.max(Number(style.overlay || 0), 0.18)
      });
    }
    return {
      type: "gradient",
      color: gradientStart,
      image: "",
      imageUrl: "",
      gradientStart,
      gradientEnd,
      gradientAngle: style && style.gradientAngle || 145,
      overlay: 0.08
    };
  }

  function themedCategoryStyle(style, isDark) {
    const image = style && (style.imageUrl || style.image);
    if (image) {
      return isDark
        ? Object.assign({}, style, { overlay: Math.max(Number(style.overlay || 0), 0.24) })
        : Object.assign({}, style, { overlay: Math.min(Number(style.overlay || 0), 0.08) });
    }
    return {
      type: "gradient",
      color: isDark ? "#21110A" : "#EFE1D0",
      image: "",
      imageUrl: "",
      gradientStart: isDark ? "#21110A" : "#F7EFE4",
      gradientEnd: isDark ? "#2A160D" : "#EFE1D0",
      gradientAngle: style && style.gradientAngle || 135,
      overlay: isDark ? 0.08 : 0
    };
  }

  function applyDockButtonText(element) {
    if (!element) return;
    element.style.color = "#ffffff";
    element.style.textShadow = "0 1px 5px rgba(0,0,0,0.42)";
  }

  function buildMetaLine(product) {
    const details = product.details || {};
    const parts = [formatCalories(details.calories), formatAllergens(details.allergens)].filter(Boolean);
    if (!parts.length) return "";
    return `<p class="product-meta">${parts.map((item) => `<span>${escapeHTML(item)}</span>`).join("")}</p>`;
  }

  function formatCalories(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/(kcal|kalori|cal|kj)/i.test(text)) return text;
    return `${text} kcal`;
  }

  function formatAllergens(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^alerjen\s*:/i.test(text)) return text;
    return `Alerjen: ${text}`;
  }

  function buildIngredientLine(product) {
    const ingredients = product.details && product.details.ingredients || "";
    if (!ingredients) return "";
    return `<p class="product-ingredients">${escapeHTML(ingredients)}</p>`;
  }

  function priceFragments(product) {
    if (Array.isArray(product.priceOptions) && product.priceOptions.length) {
      return product.priceOptions.map((option) => ({
        label: product.pricing && product.pricing.typeId === "standard" ? "" : (option.label || option.id || ""),
        price: option.price
      }));
    }
    if (product.priceMode === "standard") {
      return [{ label: "", price: product.prices.standard }];
    }
    if (product.priceMode === "singleDouble") {
      return [
        { label: "Single", price: product.prices.single },
        { label: "Double", price: product.prices.double }
      ];
    }
    const variants = Array.isArray(product.variants) && product.variants.length
      ? product.variants
      : [
        { label: "K", price: product.prices.k },
        { label: "O", price: product.prices.o },
        { label: "B", price: product.prices.b }
      ];
    return variants.length ? variants : [
      { label: "K", price: "" },
      { label: "O", price: "" },
      { label: "B", price: "" }
    ];
  }

  function formatPricePart(part) {
    const price = formatPrice(part.price);
    return part.label ? `${part.label} ${price}` : price;
  }

  function priceSummary(product) {
    if (!product || product.priceMode === "standard") {
      return formatPrice(product && product.prices && product.prices.standard);
    }
    return priceFragments(product).map(formatPricePart).join(" | ");
  }

  function getCategory(categoryId) {
    return (state.data.categories || []).find((category) => category.id === categoryId);
  }

  function formatPrice(value) {
    if (value === "" || value === null || value === undefined) return "-";
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return `${new Intl.NumberFormat("tr-TR").format(numeric)}₺`;
    return `${value}₺`;
  }

  function formatDisplayDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function makeId(prefix, value) {
    const slug = normalizeText(`${prefix}-${value}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || Math.random().toString(36).slice(2, 8);
  }

  function uniqueId(base, products) {
    let id = base;
    let index = 2;
    while (products.some((product) => product.id === id)) {
      id = `${base}-${index}`;
      index += 1;
    }
    return id;
  }

  function normalizeText(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .replace(/ç/g, "c")
      .replace(/Ç/g, "C")
      .replace(/ğ/g, "g")
      .replace(/Ğ/g, "G")
      .replace(/ö/g, "o")
      .replace(/Ö/g, "O")
      .replace(/ş/g, "s")
      .replace(/Ş/g, "S")
      .replace(/ü/g, "u")
      .replace(/Ü/g, "U")
      .toUpperCase();
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

  function cssUrl(value) {
    return safeMediaUrl(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, "\\\"")
      .replace(/[\r\n]/g, "");
  }

  function safeMediaUrl(value) {
    const text = String(value || "").trim();
    if (!isSafeMediaUrl(text)) return "";
    return text;
  }

  function isSafeMediaUrl(value) {
    const text = String(value || "").trim();
    if (!text || /[<>"'\\]/.test(text)) return false;
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(text)) return true;
    if (/^data:video\/[a-z0-9.+-]+;base64,/i.test(text)) return true;
    if (/^data:/i.test(text)) return false;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && !text.startsWith("//")) return true;

    try {
      const url = new URL(text.startsWith("//") ? `https:${text}` : text, window.location.href);
      return ["http:", "https:", "blob:"].includes(url.protocol);
    } catch (error) {
      return false;
    }
  }

  function normalizeAssetPath(value) {
    return String(value || "")
      .split("?")[0]
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .toLowerCase();
  }

  function safeLocalGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return "";
    }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn("Yerel kayıt yapılamadı.", error);
    }
  }
})();
