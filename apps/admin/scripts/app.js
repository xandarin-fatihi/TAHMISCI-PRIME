(function () {
  "use strict";
  // Developer: Uzeyir | System Key: xandar | Admin panel runtime marker

  const STORAGE_KEY = "tahmisci.menu.state.v1";
  const SITE_STORAGE_KEY = "tahmisci.site.state.v1";
  const FEEDBACK_STORAGE_KEY = "tahmisci.feedback.items.v1";
  const STOCK_STORAGE_KEY = "tahmisci.stock.state.v1";
  const RECIPE_STORAGE_KEY = "tahmisci.recipe.state.v1";
  const LEGACY_RECIPE_STORAGE_KEY = "tahmisRecipeMenuData";
  const BACKEND_URL_KEY = "tahmisci.backend.url";
  const LAST_ACTIVE_SECTION_KEY = "tahmisci.admin.lastActiveSection";
  const PANEL_THEME_KEY = "tahmisci.panel.theme";
  const PANEL_LAYOUT_KEY = "tahmisci.panel.layout";
  const PANEL_SETTINGS_KEY = "tahmisci.admin.settings.v1";
  const PANEL_SETTINGS_DEFAULT_KEY = "tahmisci.admin.settings.default.v1";
  const SIDEBAR_STATE_KEY = "tahmisci.admin.sidebar.collapsed.v1";
  const SIDEBAR_BREAKPOINT = window.matchMedia("(max-width: 1180px)");
  const ADMIN_DRAWER_BREAKPOINT = window.matchMedia("(max-width: 900px)");
  const ADMIN_NOTIFICATION_API = "/api/admin/notifications";
  const ADMIN_NOTIFICATION_POLL_MS = 30000;
  const CHANNEL_NAME = "tahmisci-menu-updates";
  const RECIPE_CHANNEL_NAME = "tahmisci-recipe-updates";
  const SITE_CHANNEL_NAME = "tahmisci-site-updates";
  const MEDIA_DB_NAME = "tahmisci.media.v1";
  const MEDIA_STORE_NAME = "files";
  const MEDIA_REF_PREFIX = "media:";
  const SESSION_REQUIRED_MESSAGE = "Oturum geçersiz. Lütfen tekrar giriş yapın.";
  const MENU_DESIGN_SCHEMA = window.TahmisciMenuDesignSchema;
  if (!MENU_DESIGN_SCHEMA || typeof MENU_DESIGN_SCHEMA.normalizeMenuState !== "function") {
    throw new Error("Ortak menü tasarım şeması yüklenemedi. Yönetici paneli güvenli biçimde başlatılamadı.");
  }
  const SITE_DESIGN_VERSION = "site-20260523a";
  const BRAND_TITLE_FONT = '"Magnolia Script", "Dancing Script", cursive';
  const BRAND_BODY_FONT = '"Tahmisci Poppins", Poppins, Arial, sans-serif';
  const LIGHT_LOGO = "/assets/brand/logo-primary.png";
  const DEFAULT_PRODUCT_IMAGE = "/assets/images/products/product-1.jpg";
  const SECTION_TITLES = {
    overview: "Genel Bakış",
    menu: "Menü düzenleme",
    banner: "Banner Düzenleme",
    category: "Kategori Düzenleme",
    product: "Ürün düzenleme",
    bulkPrice: "Toplu Fiyat Güncelleme",
    dataCenter: "Excel Veri Merkezi",
    stock: "Stok Düzenleme",
    menuOutput: "Menü çıktısı",
    recipe: "Reçete Düzenleme",
    site: "Site",
    staffAccess: "Personel",
    mudavim: "Müdavim",
    feedback: "Dilek & Şikayet",
    settings: "Ayarlar"
  };
  const PANEL_MODULES = Object.freeze({
    menuOutput: false,
    site: false,
    mudavim: false
  });
  const DISABLED_PANEL_SECTIONS = new Set(
    Object.entries(PANEL_MODULES).filter(([, enabled]) => !enabled).map(([section]) => section)
  );
  const SECTION_DESCRIPTIONS = {
    site: "Web sitenizde görünen tüm içerikleri yönetin. Değişikliklerinizi kaydedip yayınlayarak anında yayına alın.",
    dataCenter: "Menü, fiyat, reçete ve stok çalışma kitaplarını analiz edin; onaylanan taslağı atomik olarak kalıcı veriye uygulayın.",
    stock: "Stok ürünlerini, seviyelerini, tedarikçileri ve sipariş eşiklerini yönetin.",
    staffAccess: "Personel hesaplarını yönetin, eğitim/görev programları atayın ve kayıtları takip edin.",
    mudavim: "Sadakat sistemi yönetimi ve müşteri etkileşimi"
  };
  const DEFAULT_PANEL_CONFIG = {
    behavior: {
      keepLastSection: true,
      sidebarDefaultOpen: true,
      confirmOnExit: true,
      defaultSection: "overview"
    },
    backup: {
      lastBackupAt: ""
    }
  };
  const PREMIUM_SITE_PALETTE = {
    backgroundColor: "#010302",
    backgroundSoftColor: "#031108",
    accentColor: "#E4F2C9",
    accentColorDeep: "#062817",
    accentColorTwo: "#9FCF7B",
    brownColor: "#D8C49C",
    textColor: "#FAFFF5",
    mutedColor: "#C9D8BF",
    surfaceColor: "#07170F",
    lineColor: "rgba(228,242,201,0.22)",
    shadowColor: "0 22px 52px rgba(0, 0, 0, 0.34)"
  };
  const SITE_ICON_OPTIONS = [
    ["instagram", "Instagram", "IG"],
    ["tiktok", "TikTok", "TT"],
    ["whatsapp", "WhatsApp", "WA"],
    ["mail", "E-posta", "@"],
    ["phone", "Telefon", "TEL"],
    ["map", "Konum", "PIN"],
    ["web", "Web", "WEB"]
  ];
  const CATEGORY_ICON_REGISTRY = window.TahmisciCategoryIcons || {
    inferIconKey: () => "default",
    getIconClass: () => "fas fa-tags",
    options: () => [
      { key: "cold", label: "Soğuklar", mark: "❄" },
      { key: "hot", label: "Sıcaklar", mark: "♨" },
      { key: "dessert", label: "Tatlı & Sandwich", mark: "✦" }
    ]
  };
  const DEFAULT_HEADER_NAVIGATION = [
    { id: "home", label: { tr: "Ana Sayfa", en: "Home" }, url: "#top", icon: "fas fa-house", visible: true, order: 0 },
    { id: "menu", label: { tr: "Menü", en: "Menu" }, url: "#menu", icon: "fas fa-utensils", visible: true, order: 1 },
    { id: "about", label: { tr: "Hakkımızda", en: "About" }, url: "#about", icon: "fas fa-mug-hot", visible: true, order: 2 },
    { id: "contact", label: { tr: "İletişim", en: "Contact" }, url: "#contact", icon: "fas fa-phone", visible: true, order: 3 }
  ];
  const MUDAVIM_CUSTOMERS = [];
  const memoryStore = {};
  const FONT_OPTIONS = [
    ["Tahmisci Magnolia", BRAND_TITLE_FONT],
    ["Tahmisci Poppins", BRAND_BODY_FONT],
    ["Montserrat", '"Montserrat", Arial, sans-serif'],
    ["Poppins", '"Poppins", Arial, sans-serif'],
    ["Roboto", '"Roboto", Arial, sans-serif'],
    ["Open Sans", '"Open Sans", Arial, sans-serif'],
    ["Lato", '"Lato", Arial, sans-serif'],
    ["Raleway", '"Raleway", Arial, sans-serif'],
    ["Playfair Display", '"Playfair Display", Georgia, serif'],
    ["Playfair Display SC", '"Playfair Display SC", Georgia, serif'],
    ["Vidaloka", '"Vidaloka", Georgia, serif'],
    ["Merriweather", '"Merriweather", Georgia, serif'],
    ["Oswald", '"Oswald", Arial, sans-serif'],
    ["Bebas Neue", '"Bebas Neue", Arial, sans-serif'],
    ["Pacifico", '"Pacifico", cursive'],
    ["Dancing Script", '"Dancing Script", cursive'],
    ["Great Vibes", '"Great Vibes", cursive'],
    ["Cinzel", '"Cinzel", Georgia, serif'],
    ["Cormorant Garamond", '"Cormorant Garamond", Georgia, serif'],
    ["Libre Baskerville", '"Libre Baskerville", Georgia, serif'],
    ["Nunito", '"Nunito", Arial, sans-serif'],
    ["Quicksand", '"Quicksand", Arial, sans-serif'],
    ["Source Sans 3", '"Source Sans 3", Arial, sans-serif'],
    ["Inter", '"Inter", Arial, sans-serif'],
    ["Rubik", '"Rubik", Arial, sans-serif'],
    ["Work Sans", '"Work Sans", Arial, sans-serif'],
    ["Josefin Sans", '"Josefin Sans", Arial, sans-serif'],
    ["Caveat", '"Caveat", cursive'],
    ["Lobster", '"Lobster", cursive'],
    ["Abril Fatface", '"Abril Fatface", Georgia, serif'],
    ["DM Sans", '"DM Sans", Arial, sans-serif'],
    ["Manrope", '"Manrope", Arial, sans-serif']
  ];


  const MENU_OUTPUT_ICON_OPTIONS = [
    ["", "İkon yok", ""],
    ["coffee", "Kahve bardağı", "☕"],
    ["bean", "Kahve çekirdeği", "◖"],
    ["leaf", "Yaprak", "❧"],
    ["ice", "Buz", "❄"],
    ["milk", "Süt", "▣"],
    ["syrup", "Şurup", "◎"],
    ["espresso", "Espresso", "▥"],
    ["cold", "Cold drink", "◌"],
    ["hot", "Hot drink", "♨"],
    ["dessert", "Tatlı", "✦"],
    ["shot", "Ekstra shot", "+"],
    ["herbal", "Bitkisel süt", "◇"],
    ["tea", "Çay", "◍"],
    ["lemon", "Limon", "●"],
    ["fruit", "Meyve", "●"],
    ["frozen", "Kar tanesi", "❆"],
    ["star", "Yıldız", "★"],
    ["flame", "Ateş", "▲"],
    ["drop", "Damla", "♦"],
    ["mug", "Kupa", "▢"],
    ["shaker", "Shaker", "⌁"],
    ["blender", "Blender", "◫"],
    ["milkshake", "Milkshake", "◉"],
    ["matcha", "Matcha", "✳"],
    ["filter", "Filtre kahve", "∿"],
    ["brew", "Demleme", "◎"],
    ["campaign", "Kampanya", "%"],
    ["special", "Özel ürün", "◆"],
    ["line", "Dekoratif çizgi", "━"],
    ["spark", "Parıltı", "✶"],
    ["waves", "Dalga", "≋"],
    ["figure", "Tahmisçi figür", "♙"]
  ];

  const MENU_OUTPUT_FRAME_OPTIONS = [
    ["none", "Çerçeve yok"],
    ["thin", "Düz ince çizgi"],
    ["leaf", "Yaprak desenli"],
    ["bean", "Kahve çekirdeği desenli"],
    ["corner", "Köşe süslemeli"],
    ["shadow", "Sade gölge"]
  ];

  const DEFAULT_MENU_OUTPUT = {
    templateName: "Tahmisçi TV Menü",
    currentTemplateId: "",
    defaultTemplateId: "",
    canvaLink: "https://canva.link/srve7kbdqy27mfc",
    gridEnabled: true,
    safeAreaEnabled: true,
    settings: {
      bgColor: "#fffff0",
      boxColor: "#2c1609",
      textColor: "#e9f6ff",
      titleFont: BRAND_BODY_FONT,
      bodyFont: BRAND_BODY_FONT,
      priceFont: BRAND_BODY_FONT,
      productSize: 28,
      rowGap: 34,
      dateText: ""
    },
    sections: [],
    templates: []
  };
  const MENU_OUTPUT_WIDTH = 1080;
  const MENU_OUTPUT_HEIGHT = 1920;
  const MENU_OUTPUT_MIN_ZOOM = 0.15;
  const MENU_OUTPUT_MAX_ZOOM = 1.5;
  const MENU_OUTPUT_SNAP = 8;
  const MENU_OUTPUT_SAFE_X = 54;
  const MENU_OUTPUT_SAFE_Y = 96;
  const DEFAULT_SETTINGS = MENU_DESIGN_SCHEMA.cloneValue(MENU_DESIGN_SCHEMA.DEFAULT_SETTINGS);

  const DEFAULT_SITE_SETTINGS = {
    designVersion: SITE_DESIGN_VERSION,
    heroKicker: "Dört kuşak kahve zanaati",
    heroTitle: "TAHMİSÇİ Coffee & Roastery",
    heroSubtitle: "Torbalı'nın köklü kahve hafızasını yeni nesil demleme teknikleri, ferah bir roastery atmosferi ve canlı dijital menü deneyimiyle buluşturuyoruz.",
    storyTitle: "1926'dan bugüne kavrulan bir aile hikayesi",
    storyText: "Hüseyin Tünaydın'ın zeytin odununda kavurduğu kahveyle başlayan Tahmisçi geleneği, bugün espresso kültürü, dünya kahveleri, tatlılar ve özel reçetelerle Torbalı'da yeniden hayat buluyor.",
    storyPointOneTitle: "1926",
    storyPointOneText: "Kahve zanaatının ailede başladığı yıl",
    storyPointTwoTitle: "4. kuşak",
    storyPointTwoText: "Gelenekten modern roastery kültürüne",
    storyPointThreeTitle: "130 kişi",
    storyPointThreeText: "İki katlı ferah buluşma alanı",
    menuTitle: "Canlı Menü",
    menuIntro: "Bu alan PDF değildir; dijital menü panelindeki kategori, ürün, fiyat, içerik, alerjen ve enerji bilgileriyle aynı veriyi kullanır.",
    visitTitle: "Sadık İleri Bulvarı'nda kahve molası",
    visitText: "260 m² büyüklüğündeki iki katlı mekanımızda kahve, tatlı ve roastery deneyimini rahat bir atmosferde sunuyoruz.",
    contactTitle: "Günün kahvesi, duyurular ve hızlı iletişim",
    address: "Sadık İleri Bulvarı No: 42/B, Torbalı / İzmir",
    hours: "Çalışma saatlerini panelden güncelleyin",
    phone: "",
    email: "",
    whatsapp: "",
    instagram: "https://www.instagram.com/tahmiscicoffee?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==",
    tiktok: "https://www.tiktok.com/@tahmiscicoffee",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Sad%C4%B1k%20%C4%B0leri%20Bulvar%C4%B1%20No%3A%2042%2FB%20Torbal%C4%B1%20%C4%B0zmir",
    heroImageUrl: "/assets/brand/logo-primary.png",
    backgroundColor: PREMIUM_SITE_PALETTE.backgroundColor,
    backgroundSoftColor: PREMIUM_SITE_PALETTE.backgroundSoftColor,
    accentColor: PREMIUM_SITE_PALETTE.accentColor,
    accentColorDeep: PREMIUM_SITE_PALETTE.accentColorDeep,
    accentColorTwo: PREMIUM_SITE_PALETTE.accentColorTwo,
    brownColor: PREMIUM_SITE_PALETTE.brownColor,
    textColor: PREMIUM_SITE_PALETTE.textColor,
    mutedColor: PREMIUM_SITE_PALETTE.mutedColor,
    surfaceColor: PREMIUM_SITE_PALETTE.surfaceColor,
    lineColor: PREMIUM_SITE_PALETTE.lineColor,
    shadowColor: PREMIUM_SITE_PALETTE.shadowColor,
    socialLinks: [],
    titleFont: BRAND_TITLE_FONT,
    bodyFont: BRAND_BODY_FONT,
    titleSize: 68,
    bodySize: 16
  };

  const PREVIOUS_SITE_DESIGN = {
    backgroundColor: "#F4EBDC",
    accentColor: "#173F2A",
    accentColorTwo: "#8B5E3C",
    textColor: "#1D241A",
    mutedColor: "#6E6254",
    surfaceColor: "#FFF9EF",
    titleFont: '"Cormorant Garamond", Georgia, serif',
    bodyFont: '"Manrope", Inter, Arial, sans-serif',
    heroImageUrl: "/assets/brand/logo-green-compact.png"
  };
  const GREEN_SITE_DESIGN = {
    backgroundColor: "#F3FAEF",
    accentColor: "#2F6A45",
    accentColorTwo: "#7AA56A",
    textColor: "#203A29",
    mutedColor: "#5B715E",
    surfaceColor: "#FBFFF7",
    heroImageUrl: LIGHT_LOGO
  };

  const state = {
    data: null,
    recipes: null,
    recipeCatalog: [],
    recipeLinkReview: [],
    site: null,
    siteRevisions: [],
    activeSection: "overview",
    selectedCategoryId: "",
    selectedProductId: "",
    allowEmptyProductSelection: false,
    selectedRecipeCategory: "",
    selectedRecipeProduct: "",
    selectedRecipePreviewSize: "",
    feedbackFilter: "all",
    channel: null,
    recipeChannel: null,
    siteChannel: null,
    menuEventSource: null,
    recipeEventSource: null,
    siteEventSource: null,
    feedbackEventSource: null,
    stockEventSource: null,
    notificationEventSource: null,
    notificationPollTimer: null,
    notificationReconnectTimer: null,
    notificationReconnectAttempt: 0,
    bound: false,
    mediaDbPromise: null,
    dirtyMenu: false,
    dirtyRecipes: false,
    dirtySite: false,
    dirtyStock: false,
    saving: false,
    publishRevision: 0,
    saveStatus: "clean",
    pendingPublishVerification: null,
    renderTimer: null,
    stock: null,
    stockUpdatedAt: "",
    stockQuery: "",
    stockCategory: "all",
    stockOnlyOrderNeeded: false,
    stockEditorCategoryId: "",
    stockEditorProductId: "",
    selectedStockProductId: "",
    stockAction: null,
    stockActionSubmitting: false,
    recipeAccess: {
      users: [],
      assignments: [],
      activity: [],
      revision: 0
    },
    selectedStaffUserId: "",
    staffUserFilter: "active",
    staffActivityTab: "login",
    staffMessage: "",
    mudavimSearch: "",
    mudavimLevelFilter: "all",
    mudavimRewardFilter: "all",
    selectedMudavimAnnouncementId: "",
    selectedMudavimCustomerId: "mud-1001",
    selectedMenuOutputSectionId: "",
    menuOutputZoom: 0,
    menuOutputControlTab: "sections",
    menuOutputGuides: { x: null, y: null },
    menuOutputFullscreen: false,
    menuOutputNoticeTimer: null,
    panelConfig: cloneData(DEFAULT_PANEL_CONFIG),
    adminDefaults: { menuDesign: null, systemSettings: null },
    defaultModalScope: "menu",
    defaultModalMode: "restore",
    defaultModalTrigger: null,
    defaultOperationBusy: false,
    dataImportCenter: {
      files: { menu: null, pricing: null, recipe: null, stock: null },
      analysis: null,
      history: [],
      historyLoaded: false,
      busy: "",
      message: "",
      messageType: "",
      lastResult: null,
      issueScope: "all",
      issueCode: "all",
      archiveOnly: false,
      analysisEpoch: 0
    },
    notificationCenter: {
      items: [],
      unreadCount: 0,
      nextCursor: "",
      filter: "all",
      category: "all",
      preferences: null,
      capabilities: {},
      loading: false,
      preferencesLoading: false,
      mutationKeys: new Set(),
      open: false,
      lastFocus: null
    }
  };

  const els = {};
  let staffDeleteUserId = "";
  let staffDeleteTrigger = null;
  let staffDeleteBusy = false;
  const SaveCoordinator = window.TahmisciSaveCoordinator;
  const saveCoordinator = SaveCoordinator ? new SaveCoordinator({
    onStatus(status) {
      state.saveStatus = state.pendingPublishVerification && (status === "error" || status === "conflict")
        ? "unverified"
        : status;
    }
  }) : null;

  window.TahmisciAdminBridge = {
    snapshot() {
      return {
        menuState: state.data,
        recipeState: state.recipes,
        stockState: state.stock,
        pricing: state.data && state.data.pricing || null,
        activeSection: state.activeSection
      };
    },
    activeSection() {
      return state.activeSection;
    },
    selectedProduct() {
      return selectedProductStrict();
    },
    hasPendingChanges,
    hasPendingMenuChanges() {
      return state.dirtyMenu;
    },
    isScopeDirty(section) {
      if (section === "recipe") return state.dirtyRecipes;
      if (section === "stock") return state.dirtyStock;
      if (["menu", "banner", "category", "product", "bulkPrice", "settings"].includes(section)) return state.dirtyMenu || state.dirtySite;
      return false;
    },
    applyPreviewSnapshot(previewSnapshot, section) {
      if (!previewSnapshot || typeof previewSnapshot !== "object") return false;
      if (section === "recipe" && previewSnapshot.recipeState && typeof previewSnapshot.recipeState === "object") {
        state.recipes = normalizeRecipeData(cloneData(previewSnapshot.recipeState));
        state.dirtyRecipes = true;
        ensureRecipeSelection();
      } else if (section === "stock" && previewSnapshot.stockState && typeof previewSnapshot.stockState === "object") {
        state.stock = normalizeStockStateForAdmin(cloneData(previewSnapshot.stockState));
        state.dirtyStock = true;
      } else if (previewSnapshot.menuState && typeof previewSnapshot.menuState === "object") {
        state.data = normalizeState(cloneData(previewSnapshot.menuState));
        state.dirtyMenu = true;
        ensureSelection();
      } else {
        return false;
      }
      state.saveStatus = "dirty";
      renderAll();
      updateSaveControls("Kaydedilmemiş değişiklik");
      return true;
    },
    markMenuDirty(message) {
      markDirty("menu", message || "Fiyat değişikliği kaydedilmedi");
    },
    backendRequest,
    replaceMenuState(menuState) {
      if (!menuState || typeof menuState !== "object") return;
      state.data = normalizeState(menuState);
      state.dirtyMenu = false;
      safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
      ensureSelection();
      renderAll();
      updateSaveControls("Fiyatlar backend üzerinde güncellendi");
    },
    setPricing(pricing) {
      if (!state.data || !pricing || typeof pricing !== "object") return;
      state.data.pricing = cloneData(pricing);
    },
    setPublishRevision(revision) {
      const value = Number(revision);
      if (Number.isSafeInteger(value) && value >= 0) state.publishRevision = value;
    },
    render() {
      renderAll();
    }
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    state.panelConfig = loadPanelConfig();
    populateFontSelects();
    applyPanelTheme();
    applyPanelLayout();
    bindLogin();

    if (await verifyBackendSession()) {
      showPanel();
    } else {
      if (els.loginScreen) {
        els.loginScreen.hidden = false;
        els.loginScreen.style.display = "grid";
      }
      if (els.panelShell) {
        els.panelShell.hidden = true;
        els.panelShell.style.display = "none";
      }
    }
  }

  function cacheElements() {
    const ids = [
      "loginScreen", "loginForm", "passwordInput", "loginError", "panelShell", "miniStats",
      "sidebarPanel", "sidebarToggle", "adminSidebarOverlay", "adminProfileButton", "adminProfileMenu", "settingsToggle", "settingsMenu", "workspaceTitle",
      "adminNotificationTrigger", "adminNotificationBadge", "adminNotificationOverlay", "adminNotificationDrawer", "adminNotificationClose",
      "adminNotificationTitle", "adminNotificationSummary", "adminNotificationCategory", "adminNotificationReadAll", "adminNotificationMessage",
      "adminNotificationList", "adminNotificationLoadMore", "adminNotificationSettings", "adminNotificationPreferences",
      "adminNotificationPush", "adminNotificationTest", "adminNotificationSavePreferences", "adminNotificationHealth",
      "overviewGrid", "contentGrid", "categoryList", "productList", "saveState", "saveChangesButton", "panelThemeToggle", "addCategoryButton",
      "stockCard", "stockSummaryGrid", "stockCategoryFilter", "stockCategoryChips", "stockSearch", "stockOnlyOrderNeeded", "stockProductList", "stockMovementList", "stockOrderSuggestions",
      "stockEditorCategorySelect", "stockEditorProductSelect", "stockAddCategoryButton", "stockAddProductButton", "stockAddSupplierButton",
      "stockEditorIncreaseButton", "stockEditorDecreaseButton",
      "stockDeleteProductButton", "stockDeleteCategoryButton", "stockEditorProductName", "stockEditorCategoryName", "stockEditorQuantity",
      "stockEditorThreshold", "stockEditorCriticalThreshold", "stockEditorUnit", "stockEditorSupplier", "stockEditorStatus", "stockEditorActive", "stockEditorNote",
      "stockSuggestionCount", "stockSaveButton", "stockActionModal", "stockActionForm", "stockActionKicker", "stockActionTitle",
      "stockActionProduct", "stockActionQuantity", "stockActionReason", "stockActionNote", "stockActionMessage",
      "menuOutputCard", "menuOutputTemplateName", "menuOutputCanvaLink", "menuOutputOpenCanva", "menuOutputSaveTemplate",
      "menuOutputUpdateTemplate", "menuOutputDuplicateTemplate", "menuOutputDeleteTemplate", "menuOutputSetDefaultTemplate",
      "menuOutputTemplateList", "menuOutputReset", "menuOutputExportPng", "menuOutputExportJpg", "menuOutputExportPdf",
      "menuOutputBgColor", "menuOutputBoxColor", "menuOutputTextColor", "menuOutputTitleFont", "menuOutputBodyFont",
      "menuOutputPriceFont", "menuOutputProductSize", "menuOutputRowGap", "menuOutputDate", "menuOutputSectionTitle",
      "menuOutputSectionType", "menuOutputSectionMode", "menuOutputSectionCategory", "menuOutputAddSection",
      "menuOutputSectionList", "menuOutputLayerList", "menuOutputControlTabs", "menuOutputQualityPanel",
      "menuOutputPreview", "menuOutputStatus", "menuOutputPreviewStage", "menuOutputCanvasShell",
      "menuOutputZoomOut", "menuOutputZoomIn", "menuOutputZoomValue", "menuOutputFitPreview", "menuOutputZoomActual",
      "menuOutputGridToggle", "menuOutputSafeAreaToggle", "menuOutputFullscreen",
      "addProductButton", "resetButton", "saveDefaultButton", "defaultChoiceModal", "mobilePanelToggle", "bgColor", "darkBgColor", "accentColor",
      "textColor", "buttonTextColor", "productCardColor", "socialIconColor", "socialIconSize",
      "socialIconSizeValue", "menuBgType", "menuGradientStart",
      "menuGradientEnd", "menuGradientAngle", "menuBgUrl", "menuOverlay", "menuBgFile",
      "clearMenuBg", "menuUpdateDate", "titleFont", "categoryFont", "productFont",
      "menuTitleSize", "categoryTitleSize", "productTitleSize", "productDescSize",
      "productIngredientsSize", "productPriceSize",
      "popularBoxType", "popularBoxColor", "popularGradientStart", "popularGradientEnd",
      "popularGradientAngle", "popularImageUrl", "popularOverlay", "popularImageFile",
      "clearPopularImage", "suggestBoxType", "suggestBoxColor", "suggestGradientStart",
      "suggestGradientEnd", "suggestGradientAngle", "suggestImageUrl", "suggestOverlay",
      "suggestImageFile", "clearSuggestImage", "bannerMode", "bannerTitle", "bannerSubtitle",
      "menuSummaryTheme", "menuSummaryThemeText", "menuSummaryDark", "menuSummaryAccent",
      "menuSummaryAccentText", "menuSummaryText", "menuSummaryCard", "menuSummaryStatus",
      "menuOverlayValue", "popularOverlayValue", "suggestOverlayValue",
      "bannerVideoUrl", "bannerVideoFile", "clearBannerVideo", "bannerVideoList",
      "bannerImageFile", "clearBannerImages", "bannerImageList", "bannerImages", "bannerProductCategory",
      "bannerProductSearch", "bannerProductList", "categoryEditorTitle", "deleteCategoryButton", "categoryName",
      "categoryActive", "categoryIconKey", "categoryStyleType", "categoryColor", "categoryGradientStart", "categoryGradientEnd",
      "categoryGradientAngle", "categoryImageUrl", "categoryOverlay", "categoryImageFile",
      "clearCategoryImage", "categoryImagePreview", "bulkProductImageUrl", "applyBulkProductImage",
      "bulkProductImageFile", "clearBulkProductImage", "bulkProductStyleType", "bulkProductColor",
      "bulkProductGradientStart", "bulkProductGradientEnd", "bulkProductGradientAngle",
      "applyBulkProductStyle", "productEditorCard", "productCategoryTabs", "productQuickList", "productDetailsAccordion",
      "productEditorTitle", "deleteProductButton", "productName",
      "productCategory", "productDesc", "priceMode", "standardPrice", "standardPriceField",
      "sizePriceFields", "priceK", "priceO", "priceB", "singleDoublePriceFields", "priceSingle", "priceDouble", "productStock",
      "productKind", "productTemperature", "productPopular", "productActive", "productStyleType", "productColor",
      "productGradientStart", "productGradientEnd", "productGradientAngle", "productImageUrl",
      "productImageOverlay", "productImageFile", "clearProductImage", "productImagePreview", "productCalories",
      "productAllergens", "productIngredients", "productContentMode", "productRecipeId", "productRecipeSize",
      "productRecipeLinkStatus", "recipeCategorySelect", "recipeProductSelect",
      "addRecipeCategoryButton", "addRecipeProductButton", "addRecipeSizeButton", "deleteRecipeCategoryButton",
      "deleteRecipeProductButton", "recipeCategoryName", "recipeProductName", "recipeSizeList",
      "staffOverviewGrid", "staffRefreshButton", "staffUserName", "staffUsername", "staffPassword", "staffUserActive",
      "staffUserSaveButton", "staffUserResetButton", "staffUserMessage", "staffUserList", "staffUserCount", "staffUserFilter",
      "staffDeleteModal", "staffDeleteName", "staffDeleteUsername", "staffDeleteError", "staffDeleteConsent", "staffDeleteCloseButton", "staffDeleteCancelButton", "staffDeleteConfirmButton",
      "staffAssignmentUser", "staffAssignmentKind", "staffScopeType", "staffAssignmentCategory",
      "staffAssignmentProduct", "staffAssignmentSize", "staffQuestionCount", "staffPassingScore",
      "staffDifficulty", "staffProductPicker", "staffAdminNote", "staffAssignmentCreateButton", "staffAssignmentMessage",
      "staffAssignmentSummary", "staffAssignmentList", "staffAssignmentCount", "staffAssignmentDetail",
      "staffActivityTabs", "staffActivityList", "staffActivityCount",
      "mudavimStats", "mudavimSearch", "mudavimLevelFilter", "mudavimRewardFilter", "mudavimCustomerList",
      "mudavimCustomerDetail", "mudavimRewardRules", "mudavimCampaigns", "mudavimSettings",
      "mudavimAnnouncementList", "mudavimAnnouncementEditor", "mudavimAnnouncementPreview", "addMudavimAnnouncementButton", "addMudavimAnnouncementInlineButton", "publishMudavimAnnouncementsButton",
      "feedbackInsights", "feedbackTabs", "feedbackList", "feedbackMudavimSummary", "refreshFeedbackButton", "clearFeedbackButton",
      "jsonOutput", "copyJsonButton",
      "settingsLastSectionToggle", "settingsSidebarDefaultOpen",
      "settingsConfirmOnExit", "settingsDefaultSection", "siteCafeName", "siteShortDescription",
      "sitePhoneInfo", "siteWhatsappInfo", "siteAddressInfo", "siteHoursInfo", "siteInstagramInfo", "siteEmailInfo",
      "siteLogoFile", "siteLogoPreview", "siteLogoClear", "siteFaviconFile", "siteFaviconPreview", "siteFaviconClear",
      "settingsChangePassword", "settingsLogoutNow", "settingsLastBackup",
      "saveAdminMenuDefaultButton", "restoreMenuDefaultButton", "menuDefaultMeta",
      "settingsResetDeviceButton", "settingsSaveSystemDefaultButton", "settingsRestoreSystemDefaultButton", "systemDefaultMeta",
      "defaultChoiceClose", "defaultChoiceKicker", "defaultChoiceTitle", "defaultChoiceDescription",
      "factoryDefaultLabel", "factoryDefaultDescription", "adminDefaultChoice", "adminDefaultDescription", "adminDefaultChoiceMeta",
      "exportMenuData", "exportRecipeData", "exportCustomerData", "createBackup",
      "dataImportCenter", "dataImportRevision", "dataImportFileCount", "dataImportMenuFile", "dataImportPricingFile",
      "dataImportRecipeFile", "dataImportStockFile", "dataImportMenuFileName", "dataImportPricingFileName",
      "dataImportRecipeFileName", "dataImportStockFileName", "dataImportMessage", "dataImportReset", "dataImportAnalyze",
      "dataImportApply", "dataImportAnalysis", "dataImportAnalysisMeta", "dataImportReadiness", "dataImportStats",
      "dataImportDomains",
      "dataImportWorkbookSummary", "dataImportCrossLinkSummary", "dataImportApplyBlocker", "dataImportArchiveOnly",
      "dataImportChangeCount", "dataImportChanges", "dataImportIssueScope", "dataImportIssueCode",
      "dataImportIssueCount", "dataImportIssues", "dataImportHistoryList",
      "dataImportRefreshHistory",
      "siteHeroKicker", "siteHeroTitle", "siteHeroSubtitle", "siteHeroImageUrl",
      "siteStoryTitle", "siteStoryText", "siteStoryPointOneTitle", "siteStoryPointOneText",
      "siteStoryPointTwoTitle", "siteStoryPointTwoText", "siteStoryPointThreeTitle", "siteStoryPointThreeText",
      "siteMenuTitle", "siteMenuIntro", "siteVisitTitle", "siteVisitText", "siteContactTitle",
      "siteAddress", "siteHours", "sitePhone", "siteEmail", "siteWhatsapp", "siteMapsUrl",
      "siteInstagram", "siteTiktok", "siteSocialLabel", "siteSocialUrl", "siteSocialIcon",
      "addSiteSocialLink", "siteSocialLinksList", "applyPremiumSiteTheme",
      "siteBackgroundColor", "siteSurfaceColor", "siteAccentColor",
      "siteAccentColorTwo", "siteTextColor", "siteMutedColor", "siteTitleFont", "siteBodyFont",
      "siteTitleSize", "siteBodySize", "siteSectionOrder", "siteRevisionRefresh", "siteRevisionList", "siteStatusCards",
      "siteNavigationRows", "siteAddNavButton"
    ];
    ids.forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function populateFontSelects() {
    ["titleFont", "categoryFont", "productFont", "siteTitleFont", "siteBodyFont", "menuOutputTitleFont", "menuOutputBodyFont", "menuOutputPriceFont"].forEach((id) => {
      const select = els[id];
      if (!select) return;
      select.innerHTML = FONT_OPTIONS.map(([label, value]) => (
        `<option value="${escapeAttribute(value)}">${escapeHTML(label)}</option>`
      )).join("");
    });
    if (els.siteSocialIcon) {
      els.siteSocialIcon.innerHTML = SITE_ICON_OPTIONS.map(([value, label, mark]) => (
        `<option value="${escapeAttribute(value)}">${escapeHTML(mark)} - ${escapeHTML(label)}</option>`
      )).join("");
    }
  }

  function applyPanelTheme(theme) {
    const nextTheme = theme || safeLocalGet(PANEL_THEME_KEY) || "dark";
    document.body.dataset.panelTheme = nextTheme;
    if (els.panelThemeToggle) {
      els.panelThemeToggle.textContent = nextTheme === "dark" ? "Aydınlık Tema" : "Koyu Tema";
    }
  }

  function togglePanelTheme() {
    const nextTheme = document.body.dataset.panelTheme === "dark" ? "light" : "dark";
    safeLocalSet(PANEL_THEME_KEY, nextTheme);
    applyPanelTheme(nextTheme);
  }

  function applyPanelLayout(layout) {
    const nextLayout = layout || safeLocalGet(PANEL_LAYOUT_KEY) || "desktop";
    const mobile = nextLayout === "mobile";
    document.body.dataset.panelLayout = mobile ? "mobile" : "desktop";
    if (els.panelShell) els.panelShell.classList.toggle("is-mobile-panel", mobile);
    if (els.mobilePanelToggle) {
      els.mobilePanelToggle.textContent = mobile ? "Masaüstü Panele Dön" : "Mobil Paneli Kullan";
    }
  }

  function togglePanelLayout() {
    const nextLayout = document.body.dataset.panelLayout === "mobile" ? "desktop" : "mobile";
    safeLocalSet(PANEL_LAYOUT_KEY, nextLayout);
    applyPanelLayout(nextLayout);
    if (nextLayout === "mobile") setSidebarCollapsed(true);
  }

  function bindLogin() {
    els.loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = els.passwordInput.value.trim();
      const backendLogin = await loginBackend(password);
      if (backendLogin.ok) {
        els.loginError.hidden = true;
        showPanel();
      } else {
        els.loginError.textContent = backendLogin.message || (backendBaseUrl()
          ? "Şifre hatalı veya oturum açılamadı."
          : "Backend adresi tanımlı değil. Panel için backend bağlantısı gerekli.");
        els.loginError.hidden = false;
        els.passwordInput.select();
      }
    });
  }

  async function showPanel() {
    try {
      els.loginScreen.hidden = true;
      els.loginScreen.style.display = "none";
      els.panelShell.hidden = false;
      els.panelShell.style.display = "grid";
      setSidebarCollapsed(defaultSidebarCollapsed());
      state.data = loadData();
      state.recipes = loadRecipeData();
      state.site = loadSiteData();
      state.stock = loadStockData();
      ensureSelection();
      ensureRecipeSelection();
      setActiveSection(resolveInitialActiveSection(), { collapseSidebar: false, render: false });
      try {
        if ("BroadcastChannel" in window && !state.channel) state.channel = new BroadcastChannel(CHANNEL_NAME);
        if ("BroadcastChannel" in window && !state.recipeChannel) state.recipeChannel = new BroadcastChannel(RECIPE_CHANNEL_NAME);
        if ("BroadcastChannel" in window && !state.siteChannel) state.siteChannel = new BroadcastChannel(SITE_CHANNEL_NAME);
      } catch (error) {
        state.channel = null;
        state.recipeChannel = null;
        state.siteChannel = null;
      }
      bindPanelEvents();
      renderAll();
      await hydrateFromBackend();
      await hydrateRecipeAccessFromBackend();
      await hydrateStockFromBackend();
      await initializeAdminNotifications();
      setupBackendEvents();
    } catch (error) {
      console.error("Panel açılırken hata oluştu:", error);
      els.loginScreen.hidden = true;
      els.loginScreen.style.display = "none";
      els.panelShell.hidden = false;
      els.panelShell.style.display = "grid";
      els.panelShell.innerHTML = `
        <section class="panel-card" style="margin:24px">
          <h1>Panel açıldı ancak veri yüklenirken hata oluştu</h1>
          <p class="muted">Tarayıcı eski kayıtları bozmuş olabilir. Aşağıdaki butonla panel verisini sıfırlayıp yeniden açabilirsiniz.</p>
          <button class="primary-action" type="button" id="panicResetButton">Panel Verisini Sıfırla</button>
        </section>
      `;
      const reset = document.getElementById("panicResetButton");
      if (reset) {
        reset.addEventListener("click", () => {
          safeLocalRemove(STORAGE_KEY);
          window.location.reload();
        });
      }
    }
  }

  function bindPanelEvents() {
    if (state.bound) return;
    state.bound = true;

    els.sidebarToggle.addEventListener("click", toggleSidebar);
    if (els.adminSidebarOverlay) {
      els.adminSidebarOverlay.addEventListener("click", () => setSidebarCollapsed(true, { persist: false, restoreFocus: true }));
    }
    if (els.adminProfileButton) els.adminProfileButton.addEventListener("click", toggleAdminProfileMenu);
    if (els.adminProfileMenu) els.adminProfileMenu.addEventListener("click", handleAdminProfileAction);
    bindAdminNotificationEvents();
    document.addEventListener("click", closeAdminProfileMenuFromOutside);
    document.addEventListener("keydown", handleAdminShellKeydown);
    if (typeof SIDEBAR_BREAKPOINT.addEventListener === "function") {
      SIDEBAR_BREAKPOINT.addEventListener("change", syncSidebarForViewport);
    } else if (typeof SIDEBAR_BREAKPOINT.addListener === "function") {
      SIDEBAR_BREAKPOINT.addListener(syncSidebarForViewport);
    }
    if (typeof ADMIN_DRAWER_BREAKPOINT.addEventListener === "function") {
      ADMIN_DRAWER_BREAKPOINT.addEventListener("change", syncAdminDrawerForViewport);
    } else if (typeof ADMIN_DRAWER_BREAKPOINT.addListener === "function") {
      ADMIN_DRAWER_BREAKPOINT.addListener(syncAdminDrawerForViewport);
    }
    if (els.settingsToggle && els.settingsMenu) {
      els.settingsToggle.addEventListener("click", toggleSettingsMenu);
      document.addEventListener("click", handleDocumentClick);
    }
    window.addEventListener("hashchange", handleSectionHashChange);
    document.querySelector(".panel-nav").addEventListener("click", handlePanelNavClick);
    if (els.overviewGrid) els.overviewGrid.addEventListener("click", handleOverviewAction);
    bindDataImportCenterEvents();
    els.addCategoryButton.addEventListener("click", addCategory);
    els.addProductButton.addEventListener("click", addProduct);
    if (els.resetButton) els.resetButton.addEventListener("click", (event) => openDefaultChoiceModal(state.activeSection === "settings" ? "system" : "menu", event.currentTarget));
    if (els.saveDefaultButton) els.saveDefaultButton.addEventListener("click", saveAdminMenuDefault);
    if (els.saveAdminMenuDefaultButton) els.saveAdminMenuDefaultButton.addEventListener("click", saveAdminMenuDefault);
    if (els.restoreMenuDefaultButton) els.restoreMenuDefaultButton.addEventListener("click", (event) => openDefaultChoiceModal("menu", event.currentTarget));
    if (els.settingsResetDeviceButton) els.settingsResetDeviceButton.addEventListener("click", (event) => openDefaultConfirmationModal("device", event.currentTarget));
    if (els.settingsSaveSystemDefaultButton) els.settingsSaveSystemDefaultButton.addEventListener("click", saveAdminSystemDefault);
    if (els.settingsRestoreSystemDefaultButton) els.settingsRestoreSystemDefaultButton.addEventListener("click", (event) => openDefaultChoiceModal("system", event.currentTarget));
    bindPanelSettingsEvents();
    if (els.defaultChoiceModal) els.defaultChoiceModal.addEventListener("click", handleDefaultChoice);
    if (els.defaultChoiceClose) els.defaultChoiceClose.addEventListener("click", closeDefaultChoiceModal);
    els.categoryList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-category-id]");
      if (!row) return;
      state.selectedCategoryId = row.dataset.categoryId;
      const category = selectedCategory();
      state.selectedProductId = category && category.products[0] ? category.products[0].id : "";
      state.allowEmptyProductSelection = false;
      setActiveSection("category", { collapseSidebar: true, render: false });
      renderAll();
    });
    els.productList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-product-id]");
      if (!row) return;
      state.selectedProductId = row.dataset.productId;
      state.allowEmptyProductSelection = false;
      setActiveSection("product", { collapseSidebar: true, render: false });
      renderAll();
    });
    els.productCategoryTabs.addEventListener("click", handleProductCategoryTabs);
    els.productQuickList.addEventListener("click", handleProductQuickList);
    els.productCategoryTabs.addEventListener("change", handleProductCategoryTabs);
    els.productQuickList.addEventListener("change", handleProductQuickList);
    if (els.productEditorCard) els.productEditorCard.addEventListener("click", handleProductEditorCardClick);
    bindStockEvents();
    if (PANEL_MODULES.menuOutput) bindMenuOutputEvents();
    els.deleteCategoryButton.addEventListener("click", deleteSelectedCategory);
    els.deleteProductButton.addEventListener("click", deleteSelectedProduct);
    els.copyJsonButton.addEventListener("click", copyJson);
    if (els.saveChangesButton) {
      els.saveChangesButton.addEventListener("click", handleSaveButtonClick);
    }
    if (els.panelThemeToggle) els.panelThemeToggle.addEventListener("click", togglePanelTheme);
    if (els.mobilePanelToggle) els.mobilePanelToggle.addEventListener("click", togglePanelLayout);
    els.feedbackTabs.addEventListener("click", handleFeedbackTabs);
    els.refreshFeedbackButton.addEventListener("click", refreshFeedbackInbox);
    if (els.clearFeedbackButton) els.clearFeedbackButton.addEventListener("click", clearFeedbackItems);
    if (PANEL_MODULES.mudavim) {
      if (els.mudavimSearch) {
        els.mudavimSearch.addEventListener("input", () => {
          state.mudavimSearch = els.mudavimSearch.value.trim();
          renderMudavimPanel();
        });
      }
      if (els.mudavimLevelFilter) {
        els.mudavimLevelFilter.addEventListener("change", () => {
          state.mudavimLevelFilter = els.mudavimLevelFilter.value || "all";
          renderMudavimPanel();
        });
      }
      if (els.mudavimRewardFilter) {
        els.mudavimRewardFilter.addEventListener("change", () => {
          state.mudavimRewardFilter = els.mudavimRewardFilter.value || "all";
          renderMudavimPanel();
        });
      }
      if (els.mudavimCustomerList) {
        els.mudavimCustomerList.addEventListener("click", (event) => {
          const row = event.target.closest("[data-mudavim-customer-id]");
          if (!row) return;
          state.selectedMudavimCustomerId = row.dataset.mudavimCustomerId;
          renderMudavimPanel();
        });
      }
      if (els.mudavimCustomerDetail) els.mudavimCustomerDetail.addEventListener("click", handleMudavimDetailAction);
      if (els.addMudavimAnnouncementButton) els.addMudavimAnnouncementButton.addEventListener("click", addMudavimAnnouncement);
      if (els.addMudavimAnnouncementInlineButton) els.addMudavimAnnouncementInlineButton.addEventListener("click", addMudavimAnnouncement);
      if (els.publishMudavimAnnouncementsButton) {
        els.publishMudavimAnnouncementsButton.addEventListener("click", (event) => {
          event.stopPropagation();
          savePendingChanges().catch(() => {});
        });
      }
      if (els.mudavimAnnouncementList) els.mudavimAnnouncementList.addEventListener("click", handleMudavimAnnouncementListClick);
      if (els.mudavimAnnouncementEditor) {
        els.mudavimAnnouncementEditor.addEventListener("input", handleMudavimAnnouncementEditorInput);
        els.mudavimAnnouncementEditor.addEventListener("change", handleMudavimAnnouncementEditorChange);
        els.mudavimAnnouncementEditor.addEventListener("click", handleMudavimAnnouncementEditorClick);
      }
    }
    window.addEventListener("storage", (event) => {
      if (event.key === FEEDBACK_STORAGE_KEY) renderFeedbackInbox();
    });
    els.recipeCategorySelect.addEventListener("change", () => {
      state.selectedRecipeCategory = els.recipeCategorySelect.value;
      const products = recipeProductNames(state.selectedRecipeCategory);
      state.selectedRecipeProduct = products[0] || "";
      state.selectedRecipePreviewSize = "";
      renderRecipeEditor();
      renderPreview();
    });
    els.recipeProductSelect.addEventListener("change", () => {
      state.selectedRecipeProduct = els.recipeProductSelect.value;
      state.selectedRecipePreviewSize = "";
      renderRecipeEditor();
      renderPreview();
    });
    els.recipeCategoryName.addEventListener("change", renameSelectedRecipeCategory);
    els.recipeProductName.addEventListener("change", renameSelectedRecipeProduct);
    els.addRecipeCategoryButton.addEventListener("click", addRecipeCategory);
    els.addRecipeProductButton.addEventListener("click", addRecipeProduct);
    els.addRecipeSizeButton.addEventListener("click", addRecipeSize);
    els.deleteRecipeCategoryButton.addEventListener("click", deleteSelectedRecipeCategory);
    els.deleteRecipeProductButton.addEventListener("click", deleteSelectedRecipeProduct);
    els.recipeSizeList.addEventListener("input", handleRecipeSizeInput);
    els.recipeSizeList.addEventListener("change", handleRecipeSizeChange);
    els.recipeSizeList.addEventListener("click", handleRecipeSizeClick);
    if (els.staffRefreshButton) els.staffRefreshButton.addEventListener("click", hydrateRecipeAccessFromBackend);
    if (els.staffUserSaveButton) els.staffUserSaveButton.addEventListener("click", saveStaffUser);
    if (els.staffUserResetButton) els.staffUserResetButton.addEventListener("click", resetStaffUserForm);
    if (els.staffUserList) els.staffUserList.addEventListener("click", handleStaffUserListClick);
    if (els.staffUserFilter) els.staffUserFilter.addEventListener("click", handleStaffUserFilterClick);
    if (els.staffDeleteModal) els.staffDeleteModal.addEventListener("click", handleStaffDeleteModalClick);
    if (els.staffDeleteConsent) els.staffDeleteConsent.addEventListener("change", syncStaffDeleteConsent);
    if (els.staffDeleteConfirmButton) els.staffDeleteConfirmButton.addEventListener("click", confirmPermanentStaffDelete);
    if (els.staffAssignmentCategory) els.staffAssignmentCategory.addEventListener("change", () => {
      renderStaffAssignmentOptions();
    });
    if (els.staffAssignmentProduct) els.staffAssignmentProduct.addEventListener("change", () => {
      renderStaffAssignmentSizeOptions();
    });
    if (els.staffAssignmentKind) els.staffAssignmentKind.addEventListener("change", updateStaffAssignmentControls);
    if (els.staffScopeType) els.staffScopeType.addEventListener("change", updateStaffAssignmentControls);
    if (els.staffProductPicker) els.staffProductPicker.addEventListener("change", () => {
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = "";
      syncStaffProductPickerChips();
    });
    if (els.staffAssignmentCreateButton) els.staffAssignmentCreateButton.addEventListener("click", createStaffAssignment);
    if (els.staffAssignmentList) els.staffAssignmentList.addEventListener("click", handleStaffAssignmentListClick);
    if (els.staffActivityTabs) els.staffActivityTabs.addEventListener("click", handleStaffActivityTabClick);

    [
      "bgColor", "darkBgColor", "accentColor", "textColor", "buttonTextColor",
      "productCardColor", "socialIconColor", "socialIconSize", "menuBgType", "menuGradientStart", "menuGradientEnd",
      "menuGradientAngle", "menuBgUrl", "menuOverlay", "menuUpdateDate",
      "titleFont", "categoryFont", "productFont", "menuTitleSize", "categoryTitleSize",
      "productTitleSize", "productDescSize", "productIngredientsSize", "productPriceSize",
      "popularBoxType", "popularBoxColor",
      "popularGradientStart", "popularGradientEnd", "popularGradientAngle",
      "popularImageUrl", "popularOverlay", "suggestBoxType", "suggestBoxColor",
      "suggestGradientStart", "suggestGradientEnd", "suggestGradientAngle",
      "suggestImageUrl", "suggestOverlay", "bannerMode", "bannerTitle", "bannerSubtitle",
      "bannerVideoUrl", "bannerImages"
    ].forEach((id) => {
      if (!els[id]) return;
      els[id].addEventListener("input", updateSettingsFromForm);
      els[id].addEventListener("change", updateSettingsFromForm);
    });

    if (els.bannerProductList) {
      els.bannerProductList.addEventListener("change", updateSettingsFromForm);
    }
    if (els.bannerProductCategory) {
      els.bannerProductCategory.addEventListener("change", () => {
        const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
        renderBannerProductList(banner.productIds);
      });
    }
    if (els.bannerProductSearch) {
      els.bannerProductSearch.addEventListener("input", () => {
        const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
        renderBannerProductList(banner.productIds);
      });
    }

    if (PANEL_MODULES.site) {
      [
        "siteHeroKicker", "siteHeroTitle", "siteHeroSubtitle", "siteHeroImageUrl",
      "siteStoryTitle", "siteStoryText", "siteStoryPointOneTitle", "siteStoryPointOneText",
      "siteStoryPointTwoTitle", "siteStoryPointTwoText", "siteStoryPointThreeTitle", "siteStoryPointThreeText",
      "siteMenuTitle", "siteMenuIntro", "siteVisitTitle", "siteVisitText", "siteContactTitle",
      "siteAddress", "siteHours", "sitePhone", "siteEmail", "siteWhatsapp", "siteMapsUrl",
      "siteInstagram", "siteTiktok", "siteBackgroundColor", "siteSurfaceColor", "siteAccentColor",
      "siteAccentColorTwo", "siteTextColor", "siteMutedColor", "siteTitleFont", "siteBodyFont",
      "siteTitleSize", "siteBodySize"
      ].forEach((id) => {
        if (!els[id]) return;
        els[id].addEventListener("input", updateSiteSettingsFromForm);
        els[id].addEventListener("change", updateSiteSettingsFromForm);
      });

      if (els.addSiteSocialLink) els.addSiteSocialLink.addEventListener("click", addSiteSocialLink);
      if (els.siteSocialLinksList) els.siteSocialLinksList.addEventListener("click", removeSiteSocialLink);
      if (els.applyPremiumSiteTheme) els.applyPremiumSiteTheme.addEventListener("click", applyPremiumSiteTheme);

      document.querySelectorAll("[data-site-path]").forEach((input) => {
        input.addEventListener("input", handleSiteEditorInput);
        input.addEventListener("change", handleSiteEditorInput);
      });
      if (els.siteNavigationRows) {
        els.siteNavigationRows.addEventListener("input", handleSiteEditorInput);
        els.siteNavigationRows.addEventListener("change", handleSiteEditorInput);
        els.siteNavigationRows.addEventListener("click", handleSiteNavigationAction);
      }
      if (els.siteAddNavButton) els.siteAddNavButton.addEventListener("click", addSiteNavigationItem);
      document.querySelectorAll("[data-site-upload-target]").forEach((input) => {
        input.addEventListener("change", handleSiteMediaUpload);
      });
      if (els.siteSectionOrder) els.siteSectionOrder.addEventListener("change", handleSiteSectionOrder);
      if (els.siteRevisionRefresh) els.siteRevisionRefresh.addEventListener("click", loadSiteRevisions);
      if (els.siteRevisionList) els.siteRevisionList.addEventListener("click", handleSiteRevisionRestore);
    }
    window.addEventListener("beforeunload", (event) => {
      if (!hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    });

    [
      "categoryName", "categoryActive", "categoryIconKey", "categoryStyleType", "categoryColor", "categoryGradientStart",
      "categoryGradientEnd", "categoryGradientAngle", "categoryImageUrl", "categoryOverlay"
    ].forEach((id) => {
      els[id].addEventListener("input", updateCategoryFromForm);
      els[id].addEventListener("change", updateCategoryFromForm);
    });

    [
      "productName", "productCategory", "productDesc",
      "productStock", "productKind", "productTemperature", "productPopular", "productActive",
      "productStyleType", "productColor", "productGradientStart", "productGradientEnd", "productGradientAngle",
      "productImageUrl", "productImageOverlay", "productCalories", "productAllergens",
      "productIngredients", "productContentMode", "productRecipeId", "productRecipeSize"
    ].forEach((id) => {
      els[id].addEventListener("input", updateProductFromForm);
      els[id].addEventListener("change", updateProductFromForm);
    });

    els.menuBgFile.addEventListener("change", (event) => readImage(event.target, (dataUrl) => {
      state.data.settings.menuBackground.image = dataUrl;
      state.data.settings.menuBackground.imageUrl = "";
      els.menuBgUrl.value = "";
      saveAndRender();
    }));
    els.clearMenuBg.addEventListener("click", () => {
      state.data.settings.menuBackground.image = "";
      state.data.settings.menuBackground.imageUrl = "";
      state.data.settings.menuBackgroundImage = "";
      saveAndRender();
    });
    els.popularImageFile.addEventListener("change", (event) => readImage(event.target, (dataUrl) => {
      state.data.settings.bottomActions.popular.image = dataUrl;
      state.data.settings.bottomActions.popular.imageUrl = "";
      state.data.settings.bottomActions.popular.type = "image";
      els.popularImageUrl.value = "";
      saveAndRender();
    }));
    els.clearPopularImage.addEventListener("click", () => {
      state.data.settings.bottomActions.popular.image = "";
      state.data.settings.bottomActions.popular.imageUrl = "";
      saveAndRender();
    });
    els.suggestImageFile.addEventListener("change", (event) => readImage(event.target, (dataUrl) => {
      state.data.settings.bottomActions.suggest.image = dataUrl;
      state.data.settings.bottomActions.suggest.imageUrl = "";
      state.data.settings.bottomActions.suggest.type = "image";
      els.suggestImageUrl.value = "";
      saveAndRender();
    }));
    els.clearSuggestImage.addEventListener("click", () => {
      state.data.settings.bottomActions.suggest.image = "";
      state.data.settings.bottomActions.suggest.imageUrl = "";
      saveAndRender();
    });
    if (els.bannerVideoFile) els.bannerVideoFile.addEventListener("change", handleBannerVideoUpload);
    if (els.bannerImageFile) els.bannerImageFile.addEventListener("change", handleBannerImageUpload);
    if (els.bannerVideoList) {
      els.bannerVideoList.addEventListener("click", handleBannerMediaClick);
      els.bannerVideoList.addEventListener("change", handleBannerMediaOrderChange);
    }
    if (els.bannerImageList) {
      els.bannerImageList.addEventListener("click", handleBannerMediaClick);
      els.bannerImageList.addEventListener("change", handleBannerMediaOrderChange);
    }
    if (els.clearBannerVideo) {
      els.clearBannerVideo.addEventListener("click", () => {
        state.data.settings.banner = normalizeBanner(state.data.settings.banner);
        state.data.settings.banner.videos.forEach(deleteStoredMediaItem);
        state.data.settings.banner.videos = [];
        state.data.settings.banner.video = "";
        state.data.settings.banner.videoUrl = "";
        if (state.data.settings.banner.mode === "video") state.data.settings.banner.mode = "random";
        saveAndRender();
      });
    }
    if (els.clearBannerImages) {
      els.clearBannerImages.addEventListener("click", () => {
        state.data.settings.banner = normalizeBanner(state.data.settings.banner);
        state.data.settings.banner.images.forEach(deleteStoredMediaItem);
        state.data.settings.banner.images = [];
        if (state.data.settings.banner.mode === "images") state.data.settings.banner.mode = "random";
        saveAndRender();
      });
    }
    els.categoryImageFile.addEventListener("change", (event) => readImage(event.target, (dataUrl) => {
      const category = selectedCategory();
      if (!category) return;
      category.style.image = dataUrl;
      category.style.imageUrl = "";
      category.style.type = "image";
      category.image = dataUrl;
      saveAndRender();
    }));
    els.clearCategoryImage.addEventListener("click", () => {
      const category = selectedCategory();
      if (!category) return;
      category.style.image = "";
      category.style.imageUrl = "";
      category.image = "";
      saveAndRender();
    });
    els.applyBulkProductImage.addEventListener("click", applyBulkProductImageUrl);
    els.bulkProductImageFile.addEventListener("change", (event) => readImage(event.target, (dataUrl) => {
      applyBulkProductImage(dataUrl, true);
    }));
    els.clearBulkProductImage.addEventListener("click", clearBulkProductImages);
    els.applyBulkProductStyle.addEventListener("click", applyBulkProductStyle);
    els.productImageFile.addEventListener("change", (event) => readImage(event.target, (dataUrl) => {
      const product = selectedProduct();
      if (!product) return;
      product.image = dataUrl;
      product.imageUrl = "";
      saveAndRender();
    }));
    els.clearProductImage.addEventListener("click", () => {
      const product = selectedProduct();
      if (!product) return;
      product.image = "";
      product.imageUrl = "";
      saveAndRender();
    });
  }

  function bindPanelSettingsEvents() {
    [
      els.settingsLastSectionToggle,
      els.settingsSidebarDefaultOpen,
      els.settingsConfirmOnExit,
      els.settingsDefaultSection
    ].forEach((control) => {
      if (!control) return;
      control.addEventListener("change", handlePanelSettingsChange);
      control.addEventListener("input", handlePanelSettingsChange);
    });

    [
      els.siteCafeName,
      els.siteShortDescription,
      els.sitePhoneInfo,
      els.siteWhatsappInfo,
      els.siteAddressInfo,
      els.siteHoursInfo,
      els.siteInstagramInfo,
      els.siteEmailInfo
    ].forEach((control) => {
      if (!control) return;
      control.addEventListener("input", handleSiteInfoSettingsChange);
      control.addEventListener("change", handleSiteInfoSettingsChange);
    });

    if (els.siteLogoFile) els.siteLogoFile.addEventListener("change", (event) => handleSettingsMediaInput(event, "logo"));
    if (els.siteFaviconFile) els.siteFaviconFile.addEventListener("change", (event) => handleSettingsMediaInput(event, "favicon"));
    if (els.siteLogoClear) els.siteLogoClear.addEventListener("click", () => clearSettingsMedia("logo"));
    if (els.siteFaviconClear) els.siteFaviconClear.addEventListener("click", () => clearSettingsMedia("favicon"));
    if (els.settingsChangePassword) els.settingsChangePassword.addEventListener("click", () => window.open("/password-reset/", "_blank", "noopener"));
    if (els.settingsLogoutNow) els.settingsLogoutNow.addEventListener("click", logoutAdminSession);
    if (els.exportMenuData) els.exportMenuData.addEventListener("click", () => exportAdminDataset("menu"));
    if (els.exportRecipeData) els.exportRecipeData.addEventListener("click", () => exportAdminDataset("recipes"));
    if (els.exportCustomerData) els.exportCustomerData.addEventListener("click", () => exportAdminDataset("customers"));
    if (els.createBackup) els.createBackup.addEventListener("click", createAdminBackup);
  }

  function handlePanelSettingsChange(event) {
    writePanelConfigFromForm();
    savePanelConfig();
    if (event && event.currentTarget === els.settingsSidebarDefaultOpen) {
      safeLocalRemove(SIDEBAR_STATE_KEY);
      setSidebarCollapsed(defaultSidebarCollapsed());
    }
    applyPanelRuntimeSettings();
  }

  function handleSiteInfoSettingsChange() {
    writeSiteInfoFromSettings({ dirty: true });
  }

  function defaultSidebarCollapsed() {
    if (isAdminMobileSidebar()) return true;
    const saved = safeLocalGet(SIDEBAR_STATE_KEY);
    if (saved === "1" || saved === "0") return saved === "1";
    if (SIDEBAR_BREAKPOINT.matches) return true;
    return state.panelConfig && state.panelConfig.behavior.sidebarDefaultOpen === false;
  }

  function shouldConfirmLogout() {
    const config = state.panelConfig || DEFAULT_PANEL_CONFIG;
    return config.behavior.confirmOnExit !== false;
  }

  function toggleAdminProfileMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!els.adminProfileMenu || !els.adminProfileButton) return;
    const willOpen = els.adminProfileMenu.hidden;
    els.adminProfileMenu.hidden = !willOpen;
    els.adminProfileButton.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) {
      const firstAction = els.adminProfileMenu.querySelector("[role='menuitem']:not(:disabled)");
      if (firstAction) window.setTimeout(() => firstAction.focus(), 0);
    }
  }

  function closeAdminProfileMenu() {
    if (els.adminProfileMenu) els.adminProfileMenu.hidden = true;
    if (els.adminProfileButton) els.adminProfileButton.setAttribute("aria-expanded", "false");
  }

  function closeAdminProfileMenuFromOutside(event) {
    if (!els.adminProfileMenu || els.adminProfileMenu.hidden) return;
    if (event.target.closest("#adminProfileMenu") || event.target.closest("#adminProfileButton")) return;
    closeAdminProfileMenu();
  }

  function handleAdminShellKeydown(event) {
    if (els.staffDeleteModal && !els.staffDeleteModal.hidden) {
      if (event.key === "Tab") trapStaffDeleteFocus(event);
      if (event.key === "Escape") {
        event.preventDefault();
        if (!staffDeleteBusy) closeStaffDeleteDialog();
      }
      return;
    }
    if (els.defaultChoiceModal && !els.defaultChoiceModal.hidden) {
      if (event.key === "Tab") trapDefaultChoiceFocus(event);
      if (event.key === "Escape") {
        event.preventDefault();
        if (!state.defaultOperationBusy) closeDefaultChoiceModal();
      }
      return;
    }
    if (event.key === "Tab" && trapAdminDrawerFocus(event)) return;
    if (event.key !== "Escape") return;
    if (els.adminProfileMenu && !els.adminProfileMenu.hidden) {
      closeAdminProfileMenu();
      if (els.adminProfileButton) els.adminProfileButton.focus();
      return;
    }
    if (isAdminMobileSidebar() && !isSidebarCollapsed()) {
      setSidebarCollapsed(true, { persist: false, restoreFocus: true });
    }
  }

  function handleAdminProfileAction(event) {
    const action = event.target.closest("[data-admin-profile-action]");
    if (!action) return;
    closeAdminProfileMenu();
    if (action.dataset.adminProfileAction === "settings") {
      setActiveSection("settings", { collapseSidebar: true });
      return;
    }
    if (action.dataset.adminProfileAction === "logout") logoutAdminSession();
  }

  function toggleSidebar() {
    const collapsed = !isSidebarCollapsed();
    setSidebarCollapsed(collapsed, { persist: !isAdminMobileSidebar(), focusDrawer: !collapsed });
  }

  function isSidebarCollapsed() {
    return Boolean(els.panelShell && els.panelShell.classList.contains("is-sidebar-collapsed"));
  }

  function isAdminMobileSidebar() {
    return Boolean(ADMIN_DRAWER_BREAKPOINT.matches);
  }

  function setSidebarCollapsed(collapsed, options = {}) {
    if (!els.panelShell) return;
    const wasCollapsed = isSidebarCollapsed();
    const nextCollapsed = Boolean(collapsed);
    els.panelShell.classList.toggle("is-sidebar-collapsed", nextCollapsed);
    if (options.persist !== false && !isAdminMobileSidebar()) {
      safeLocalSet(SIDEBAR_STATE_KEY, nextCollapsed ? "1" : "0");
    }
    syncAdminSidebarUi();
    if (isAdminMobileSidebar() && !nextCollapsed && (options.focusDrawer || wasCollapsed)) {
      window.setTimeout(focusFirstAdminSidebarControl, 0);
    } else if (isAdminMobileSidebar() && nextCollapsed && options.restoreFocus && els.sidebarToggle) {
      window.setTimeout(() => els.sidebarToggle.focus(), 0);
    }
  }

  function syncAdminSidebarUi() {
    const collapsed = isSidebarCollapsed();
    const mobile = isAdminMobileSidebar();
    const panelVisible = Boolean(els.panelShell && !els.panelShell.hidden && els.panelShell.style.display !== "none");
    const drawerOpen = panelVisible && mobile && !collapsed;
    if (els.sidebarToggle) {
      els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      const label = collapsed ? "Kenar çubuğunu aç" : "Kenar çubuğunu kapat";
      els.sidebarToggle.setAttribute("aria-label", label);
      els.sidebarToggle.setAttribute("title", label);
    }
    if (els.sidebarPanel) {
      els.sidebarPanel.setAttribute("aria-hidden", "false");
      els.sidebarPanel.inert = false;
      const hiddenRegions = els.sidebarPanel.querySelectorAll(".sidebar-scroll-region, .admin-profile-wrap");
      hiddenRegions.forEach((region) => {
        region.inert = Boolean(mobile && collapsed);
        region.setAttribute("aria-hidden", mobile && collapsed ? "true" : "false");
      });
    }
    if (els.adminSidebarOverlay) {
      els.adminSidebarOverlay.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
      els.adminSidebarOverlay.tabIndex = -1;
    }
    const workspace = els.panelShell && els.panelShell.querySelector(":scope > .workspace");
    if (workspace) workspace.inert = drawerOpen;
    document.body.classList.toggle("is-admin-drawer-open", drawerOpen);
  }

  function focusFirstAdminSidebarControl() {
    if (!els.sidebarPanel || !isAdminMobileSidebar() || isSidebarCollapsed()) return;
    const target = els.sidebarPanel.querySelector(".panel-nav a, .sidebar-profile");
    if (target) target.focus();
  }

  function trapAdminDrawerFocus(event) {
    if (!isAdminMobileSidebar() || isSidebarCollapsed() || !els.sidebarPanel) return false;
    const controls = Array.from(els.sidebarPanel.querySelectorAll("a[href], button:not(:disabled)"))
      .filter((control) => control.getClientRects().length && control.getAttribute("aria-hidden") !== "true");
    if (!controls.length) return false;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.sidebarPanel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    if (!els.sidebarPanel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function syncSidebarForViewport() {
    setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
  }

  function syncAdminDrawerForViewport(event) {
    if (event && event.matches) {
      setSidebarCollapsed(true, { persist: false });
      return;
    }
    setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
  }

  function toggleSettingsMenu(event) {
    if (!els.settingsMenu || !els.settingsToggle) return;
    event.stopPropagation();
    const hidden = els.settingsMenu.hidden;
    els.settingsMenu.hidden = !hidden;
    els.settingsToggle.setAttribute("aria-expanded", String(hidden));
  }

  function closeSettingsMenu() {
    if (!els.settingsMenu || !els.settingsToggle) return;
    els.settingsMenu.hidden = true;
    els.settingsToggle.setAttribute("aria-expanded", "false");
  }

  function handleDocumentClick(event) {
    if (event.target.closest(".settings-popover")) return;
    closeSettingsMenu();
  }

  function handlePanelNavClick(event) {
    const link = event.target.closest("[data-panel-section]");
    if (!link) return;
    event.preventDefault();
    setActiveSection(link.dataset.panelSection, { collapseSidebar: true });
  }

  function handleOverviewAction(event) {
    const target = event.target.closest("[data-overview-section]");
    if (!target) return;
    event.preventDefault();
    setActiveSection(target.dataset.overviewSection, {
      collapseSidebar: window.matchMedia("(max-width: 1180px)").matches
    });
  }

  function handleSectionHashChange() {
    const section = resolveHashSection();
    if (!section || section === state.activeSection) return;
    setActiveSection(section, { collapseSidebar: false });
  }

  function resolveInitialActiveSection() {
    const config = state.panelConfig || DEFAULT_PANEL_CONFIG;
    const stored = config.behavior && config.behavior.keepLastSection !== false
      ? normalizePanelSection(safeLocalGet(LAST_ACTIVE_SECTION_KEY))
      : "";
    return resolveHashSection() || stored || normalizePanelSection(config.behavior && config.behavior.defaultSection) || "overview";
  }

  function resolveHashSection() {
    const hash = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
    if (!hash) return "";
    const normalizedHash = normalizePanelSection(hash);
    if (normalizedHash) return normalizedHash;
    const directLink = Array.from(document.querySelectorAll("[data-panel-section]"))
      .find((link) => link.getAttribute("href") === `#${hash}`);
    if (directLink) return normalizePanelSection(directLink.dataset.panelSection);
    const target = document.getElementById(hash);
    if (!target) return "";
    return normalizePanelSection(target.dataset.sectionPanel || target.closest("[data-section-panel]")?.dataset.sectionPanel);
  }

  function normalizePanelSection(section) {
    if (!SECTION_TITLES[section]) return "";
    if (DISABLED_PANEL_SECTIONS.has(section)) return "";
    return section;
  }

  function setActiveSection(section, options) {
    state.activeSection = normalizePanelSection(section) || "overview";
    if (!options || options.persist !== false) {
      if (state.panelConfig && state.panelConfig.behavior.keepLastSection !== false) safeLocalSet(LAST_ACTIVE_SECTION_KEY, state.activeSection);
      else safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
    }
    if ((!options || options.collapseSidebar !== false) && isAdminMobileSidebar()) {
      setSidebarCollapsed(true, { persist: false });
    }
    if (!options || options.render !== false) renderAll();
    if (state.activeSection === "dataCenter" && !state.dataImportCenter.historyLoaded && !state.dataImportCenter.busy) {
      loadDataImportHistory().catch(() => {});
    }
  }

  function loadData() {
    return normalizeState({
      settings: DEFAULT_SETTINGS,
      categories: []
    });
  }

  function loadRecipeData() {
    return normalizeRecipeData({});
  }

  function loadSiteData() {
    const stored = readStoredJSON(SITE_STORAGE_KEY);
    return normalizeSiteSettings(stored || DEFAULT_SITE_SETTINGS);
  }

  function readStoredJSON(key) {
    const stored = safeLocalGet(key);
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch (error) {
      return null;
    }
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function loadPanelConfig() {
    return normalizePanelConfig(readStoredJSON(PANEL_SETTINGS_KEY));
  }

  function normalizePanelConfig(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const behavior = source.behavior && typeof source.behavior === "object" ? source.behavior : {};
    const backup = source.backup && typeof source.backup === "object" ? source.backup : {};
    const section = normalizePanelSection(behavior.defaultSection) || DEFAULT_PANEL_CONFIG.behavior.defaultSection;
    return {
      behavior: {
        keepLastSection: behavior.keepLastSection !== false,
        sidebarDefaultOpen: behavior.sidebarDefaultOpen !== false,
        confirmOnExit: behavior.confirmOnExit !== false,
        defaultSection: section
      },
      backup: {
        lastBackupAt: String(backup.lastBackupAt || "")
      }
    };
  }

  function savePanelConfig() {
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    safeLocalSet(PANEL_SETTINGS_KEY, JSON.stringify(state.panelConfig));
    if (!hasPendingChanges()) updateSaveControls("Yalnızca bu cihazda kayıtlı");
  }

  function renderPanelSettings() {
    if (!els.settingsLastSectionToggle) return;
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    populatePanelSettingsSelects();
    const behavior = state.panelConfig.behavior;

    els.settingsLastSectionToggle.checked = behavior.keepLastSection;
    els.settingsSidebarDefaultOpen.checked = behavior.sidebarDefaultOpen;
    els.settingsConfirmOnExit.checked = behavior.confirmOnExit;
    els.settingsDefaultSection.value = normalizePanelSection(behavior.defaultSection) || "overview";
    if (els.settingsLastBackup) els.settingsLastBackup.textContent = state.panelConfig.backup.lastBackupAt ? formatDateTime(state.panelConfig.backup.lastBackupAt) : "Henüz yedek yok";

    const siteInfo = readSiteInfoFromState();
    if (els.siteCafeName) els.siteCafeName.value = siteInfo.cafeName;
    if (els.siteShortDescription) els.siteShortDescription.value = siteInfo.shortDescription;
    if (els.sitePhoneInfo) els.sitePhoneInfo.value = siteInfo.phone;
    if (els.siteWhatsappInfo) els.siteWhatsappInfo.value = siteInfo.whatsapp;
    if (els.siteAddressInfo) els.siteAddressInfo.value = siteInfo.address;
    if (els.siteHoursInfo) els.siteHoursInfo.value = siteInfo.hours;
    if (els.siteInstagramInfo) els.siteInstagramInfo.value = siteInfo.instagram;
    if (els.siteEmailInfo) els.siteEmailInfo.value = siteInfo.email;
    renderSettingsMediaPreview(els.siteLogoPreview, siteInfo.logo, "Logo yok");
    renderSettingsMediaPreview(els.siteFaviconPreview, siteInfo.favicon, "Favicon yok");
  }

  function populatePanelSettingsSelects() {
    if (els.settingsDefaultSection && !els.settingsDefaultSection.options.length) {
      els.settingsDefaultSection.innerHTML = Object.keys(SECTION_TITLES)
        .filter((key) => !DISABLED_PANEL_SECTIONS.has(key))
        .map((key) => `<option value="${escapeAttribute(key)}">${escapeHTML(SECTION_TITLES[key])}</option>`)
        .join("");
    }
  }

  function writePanelConfigFromForm() {
    if (!els.settingsLastSectionToggle) return;
    state.panelConfig = normalizePanelConfig({
      behavior: {
        keepLastSection: els.settingsLastSectionToggle.checked,
        sidebarDefaultOpen: els.settingsSidebarDefaultOpen.checked,
        confirmOnExit: els.settingsConfirmOnExit.checked,
        defaultSection: els.settingsDefaultSection.value || "overview"
      },
      backup: state.panelConfig && state.panelConfig.backup
    });
  }

  function readSiteInfoFromState() {
    const site = normalizeSiteSettings(state.site || DEFAULT_SITE_SETTINGS);
    const global = site.global && typeof site.global === "object" ? site.global : {};
    const contact = site.contact && typeof site.contact === "object" ? site.contact : {};
    const seo = site.seo && typeof site.seo === "object" ? site.seo : {};
    return {
      cafeName: String(global.cafeName || global.businessName || site.cafeName || site.businessName || "Tahmisçi Coffee & Roastery"),
      shortDescription: String(global.shortDescription || site.shortDescription || site.heroSubtitle || DEFAULT_SITE_SETTINGS.heroSubtitle),
      phone: String(contact.phone || site.phone || ""),
      whatsapp: String(contact.whatsapp || site.whatsapp || ""),
      address: String(contact.address || site.address || ""),
      hours: String(contact.hours || site.hours || ""),
      instagram: String(contact.instagram || site.instagram || ""),
      email: String(contact.email || site.email || ""),
      logo: String(global.logo || site.logo || site.heroImageUrl || ""),
      favicon: String(seo.favicon || site.favicon || "")
    };
  }

  function readSiteInfoFromForm() {
    return {
      cafeName: els.siteCafeName ? els.siteCafeName.value.trim() : "",
      shortDescription: els.siteShortDescription ? els.siteShortDescription.value.trim() : "",
      phone: els.sitePhoneInfo ? els.sitePhoneInfo.value.trim() : "",
      whatsapp: els.siteWhatsappInfo ? els.siteWhatsappInfo.value.trim() : "",
      address: els.siteAddressInfo ? els.siteAddressInfo.value.trim() : "",
      hours: els.siteHoursInfo ? els.siteHoursInfo.value.trim() : "",
      instagram: els.siteInstagramInfo ? els.siteInstagramInfo.value.trim() : "",
      email: els.siteEmailInfo ? els.siteEmailInfo.value.trim() : "",
      logo: readSiteInfoFromState().logo,
      favicon: readSiteInfoFromState().favicon
    };
  }

  function writeSiteInfoFromSettings(options) {
    if (!els.siteCafeName) return;
    applySiteInfoToState(readSiteInfoFromForm(), options);
  }

  function applySiteInfoToState(info, options) {
    const current = normalizeSiteSettings(state.site || DEFAULT_SITE_SETTINGS);
    const next = Object.assign({}, current, {
      cafeName: info.cafeName || current.cafeName || "",
      businessName: info.cafeName || current.businessName || "",
      shortDescription: info.shortDescription || "",
      phone: info.phone || "",
      whatsapp: info.whatsapp || "",
      address: info.address || "",
      hours: info.hours || "",
      instagram: info.instagram || "",
      email: info.email || ""
    });
    if (info.logo !== undefined) {
      next.logo = info.logo || "";
      if (info.logo) next.heroImageUrl = info.logo;
    }
    if (info.favicon !== undefined) next.favicon = info.favicon || "";
    if (Number(next.schemaVersion || 0) >= 2) {
      next.global = Object.assign({}, next.global || {}, {
        cafeName: info.cafeName || "",
        businessName: info.cafeName || "",
        shortDescription: info.shortDescription || "",
        logo: info.logo || next.global && next.global.logo || ""
      });
      next.contact = Object.assign({}, next.contact || {}, {
        businessName: info.cafeName || "",
        phone: info.phone || "",
        whatsapp: info.whatsapp || "",
        address: info.address || "",
        hours: info.hours || "",
        instagram: info.instagram || "",
        email: info.email || ""
      });
      next.seo = Object.assign({}, next.seo || {}, {
        favicon: info.favicon || next.seo && next.seo.favicon || ""
      });
    }
    state.site = normalizeSiteSettings(next);
    if (options && options.dirty === false) {
      safeLocalSet(SITE_STORAGE_KEY, JSON.stringify(state.site));
    } else {
      saveSiteSettings();
    }
    renderSettingsMediaPreview(els.siteLogoPreview, info.logo, "Logo yok");
    renderSettingsMediaPreview(els.siteFaviconPreview, info.favicon, "Favicon yok");
  }

  function renderSettingsMediaPreview(target, src, emptyText) {
    if (!target) return;
    const url = String(src || "");
    target.innerHTML = url
      ? `<img src="${escapeAttribute(url)}" alt="">`
      : `<span>${escapeHTML(emptyText)}</span>`;
  }

  function applyPanelRuntimeSettings() {
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    if (!state.panelConfig.behavior.keepLastSection) safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
  }

  function handleSettingsMediaInput(event, kind) {
    const input = event.currentTarget;
    const file = input && input.files && input.files[0];
    if (!file || !file.type.startsWith("image/")) {
      if (input) input.value = "";
      return;
    }
    readImage(input, (dataUrl) => {
      const info = readSiteInfoFromState();
      info[kind] = dataUrl;
      applySiteInfoToState(info, { dirty: true });
      updateSaveControls(kind === "logo" ? "Logo kaydedilmedi" : "Favicon kaydedilmedi");
    });
  }

  function clearSettingsMedia(kind) {
    const info = readSiteInfoFromState();
    info[kind] = "";
    applySiteInfoToState(info, { dirty: true });
  }

  function exportAdminDataset(kind) {
    const source = {
      menu: () => state.data || loadData(),
      recipes: () => ({ recipeState: state.recipes || loadRecipeData(), recipeCatalog: state.recipeCatalog || [] }),
      customers: () => ({
        mudavimCustomers: MUDAVIM_CUSTOMERS,
        feedbackItems: readStoredJSON(FEEDBACK_STORAGE_KEY) || []
      })
    }[kind];
    if (!source) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      type: kind,
      data: source()
    };
    downloadJSONFile(payload, `tahmisci-${kind}-${isoDateForFile()}.json`);
  }

  function createAdminBackup() {
    const createdAt = new Date().toISOString();
    const payload = {
      createdAt,
      menuState: state.data || loadData(),
      recipeState: state.recipes || loadRecipeData(),
      recipeCatalog: state.recipeCatalog || [],
      siteState: state.site || loadSiteData(),
      panelSettings: normalizePanelConfig(state.panelConfig),
      feedbackItems: readStoredJSON(FEEDBACK_STORAGE_KEY) || [],
      mudavimCustomers: MUDAVIM_CUSTOMERS
    };
    downloadJSONFile(payload, `tahmisci-backup-${isoDateForFile()}.json`);
    state.panelConfig.backup.lastBackupAt = createdAt;
    safeLocalSet(PANEL_SETTINGS_KEY, JSON.stringify(normalizePanelConfig(state.panelConfig)));
    if (els.settingsLastBackup) els.settingsLastBackup.textContent = formatDateTime(createdAt);
    updateSaveControls("Yedek indirildi");
    window.setTimeout(() => updateSaveControls(), 1200);
  }

  function downloadJSONFile(payload, filename) {
    const text = JSON.stringify(payload, null, 2);
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
    downloadDataUrl(dataUrl, filename);
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
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.fetch) throw new Error("Backend adresi tanımlı değil.");

    const method = String(options && options.method || "GET").toUpperCase();
    const rawBody = options && Object.prototype.hasOwnProperty.call(options, "rawBody") ? options.rawBody : null;
    const headers = Object.assign(rawBody ? {} : { "Content-Type": "application/json" }, options && options.headers);

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      body: rawBody || (options && options.body ? JSON.stringify(options.body) : undefined)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      if ((response.status === 401 || response.status === 403) && !(options && options.skipAuthFailure)) {
        handleSessionEnded(result.message || SESSION_REQUIRED_MESSAGE);
      }
      const error = new Error(result.message || "Backend isteği başarısız.");
      error.status = response.status;
      error.code = result.code || "";
      error.payload = result;
      throw error;
    }

    return result;
  }

  async function logoutAdminSession() {
    if (shouldConfirmLogout() && !window.confirm("Oturumu kapatmak istiyor musunuz?")) return;
    await detachAdminPushSubscription().catch(() => null);
    try {
      await backendRequest("/api/admin/logout", {
        method: "POST",
        skipAuthFailure: true
      });
    } catch (_error) {}
    handleSessionEnded("Oturum kapatildi.");
  }

  function handleSessionEnded(message) {
    closeBackendEvents();
    closeAdminNotificationDrawer({ restoreFocus: false });
    state.saving = false;
    if (els.panelShell) {
      els.panelShell.hidden = true;
      els.panelShell.style.display = "none";
    }
    closeAdminProfileMenu();
    closeStockActionModal();
    closeDefaultChoiceModal();
    setSidebarCollapsed(true, { persist: false });
    if (els.loginScreen) {
      els.loginScreen.hidden = false;
      els.loginScreen.style.display = "grid";
    }
    if (els.loginError) {
      els.loginError.textContent = message || SESSION_REQUIRED_MESSAGE;
      els.loginError.hidden = false;
    }
    if (els.passwordInput) {
      els.passwordInput.value = "";
      window.setTimeout(() => els.passwordInput.focus(), 60);
    }
    updateSaveControls(message || SESSION_REQUIRED_MESSAGE);
  }

  function closeBackendEvents() {
    ["menuEventSource", "recipeEventSource", "siteEventSource", "feedbackEventSource", "stockEventSource", "notificationEventSource"].forEach((key) => {
      if (!state[key]) return;
      try {
        state[key].close();
      } catch (_error) {}
      state[key] = null;
    });
    if (state.notificationPollTimer) {
      window.clearInterval(state.notificationPollTimer);
      state.notificationPollTimer = null;
    }
    if (state.notificationReconnectTimer) {
      window.clearTimeout(state.notificationReconnectTimer);
      state.notificationReconnectTimer = null;
    }
    state.notificationReconnectAttempt = 0;
  }

  async function loginBackend(password) {
    if (!backendBaseUrl()) return { ok: false };
    try {
      const result = await backendRequest("/api/admin/login", {
        method: "POST",
        skipToken: true,
        body: { password }
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "" };
    }
  }

  async function verifyBackendSession() {
    if (!backendBaseUrl()) return false;

    try {
      await backendRequest("/api/admin/me", { skipAuthFailure: true });
      return true;
    } catch (error) {
      return false;
    }
  }

  async function hydrateFromBackend() {
    if (!backendBaseUrl()) return;

    const [menuResult, recipeResult, publishResult, defaultsResult] = await Promise.allSettled([
      backendRequest("/api/menu", { skipToken: true }),
      backendRequest("/api/recipes"),
      backendRequest("/api/admin/publish-state"),
      backendRequest("/api/admin/defaults")
      // PASIF_SITE_MODULU_BASLANGIC
      // PASIF MODUL backendRequest("/api/site", { skipToken: true })
      // PASIF_SITE_MODULU_BITIS
    ]);

    let changed = false;

    if (publishResult.status === "fulfilled") {
      state.publishRevision = Number(publishResult.value.revision || 0);
    }

    if (defaultsResult.status === "fulfilled") {
      const defaults = defaultsResult.value.adminDefaults || {};
      state.adminDefaults = {
        menuDesign: defaults.menuDesign ? cloneData(defaults.menuDesign) : null,
        systemSettings: defaults.systemSettings ? cloneData(defaults.systemSettings) : null
      };
      syncAdminDefaultUi();
    }

    if (menuResult.status === "fulfilled") {
      syncPublishRevision(menuResult.value);
      const menuState = menuResult.value.menuState;
      if (hasMenuContent(menuState)) {
        if (!state.dirtyMenu && !state.saving && !state.pendingPublishVerification) {
          state.data = normalizeState(menuState);
          if (menuResult.value.pricing && typeof menuResult.value.pricing === "object") {
            state.data.pricing = cloneData(menuResult.value.pricing);
          }
          safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
          changed = true;
        }
      } else if (hasMenuContent(state.data)) {
        markDirty("menu", "Backend bos, Kaydet ile yayinlayin");
      }
    }

    if (recipeResult.status === "fulfilled") {
      const recipeState = recipeResult.value.recipeState;
      if (hasRecipeContent(recipeState)) {
        state.recipes = normalizeRecipeData(recipeState);
        state.recipeCatalog = normalizeRecipeCatalog(recipeResult.value.recipeCatalog);
        state.recipeLinkReview = Array.isArray(recipeResult.value.recipeLinkReview) ? recipeResult.value.recipeLinkReview : [];
        saveRecipesLocalOnly();
        changed = true;
      } else if (hasRecipeContent(state.recipes)) {
        markDirty("recipes", "Backend bos, Kaydet ile yayinlayin");
      }
    }

    // PASIF_SITE_MODULU_BASLANGIC
    // PASIF MODUL: Site state yükleme akışı geçici olarak devre dışıdır.
    // PASIF_SITE_MODULU_BITIS

    if (changed) {
      ensureSelection();
      ensureRecipeSelection();
      renderAll();
      updateSaveControls("Backend bagli");
      window.clearTimeout(hydrateFromBackend.timer);
      hydrateFromBackend.timer = window.setTimeout(() => {
        updateSaveControls();
      }, 1200);
    }
  }

  async function hydrateRecipeAccessFromBackend() {
    if (!backendBaseUrl()) return;
    try {
      const result = await backendRequest("/api/admin/recipe-access");
      state.recipeAccess = normalizeRecipeAccess(result);
      renderStaffAccess();
      updateSaveControls("Kullanıcı yetkileri güncel");
      window.clearTimeout(hydrateRecipeAccessFromBackend.timer);
      hydrateRecipeAccessFromBackend.timer = window.setTimeout(updateSaveControls, 1200);
    } catch (error) {
      state.staffMessage = error.message || "Kullanıcı yetkileri alınamadı";
      renderStaffAccess();
    }
  }

  function normalizeRecipeAccess(result) {
    return {
      users: Array.isArray(result && result.users) ? result.users : [],
      assignments: Array.isArray(result && result.assignments) ? result.assignments : [],
      activity: Array.isArray(result && result.activity) ? result.activity : [],
      revision: Math.max(0, Number(result && result.revision || 0))
    };
  }

  function setupBackendEvents() {
    const baseUrl = backendBaseUrl();
    setupAdminNotificationRealtime();
    if (!baseUrl || !window.EventSource) return;

    if (!state.menuEventSource) {
      state.menuEventSource = new EventSource(`${baseUrl}/api/menu/events`);
      state.menuEventSource.addEventListener("menu", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!hasMenuContent(payload.menuState)) return;
          if (state.dirtyMenu || state.saving || state.pendingPublishVerification) return;
          state.data = normalizeState(payload.menuState);
          safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
          ensureSelection();
          renderAll();
        } catch (error) {}
      });
    }

    if (!state.recipeEventSource) {
      state.recipeEventSource = new EventSource(`${baseUrl}/api/recipes/events`);
      state.recipeEventSource.addEventListener("recipes", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!hasRecipeContent(payload.recipeState)) return;
          state.recipes = normalizeRecipeData(payload.recipeState);
          state.recipeCatalog = normalizeRecipeCatalog(payload.recipeCatalog);
          saveRecipesLocalOnly();
          ensureRecipeSelection();
          renderAll();
        } catch (error) {}
      });
    }

    // PASIF_SITE_MODULU_BASLANGIC
    // PASIF MODUL: Site SSE bağlantısı geçici olarak devre dışıdır.
    // PASIF_SITE_MODULU_BITIS

    if (!state.stockEventSource) {
      state.stockEventSource = new EventSource(`${baseUrl}/api/stock/events`);
      state.stockEventSource.addEventListener("stock", (event) => {
        try {
          const payload = JSON.parse(event.data || "{}");
          if (!payload.stockState || state.dirtyStock) return;
          state.stock = normalizeStockStateForAdmin(payload.stockState);
          state.stockUpdatedAt = payload.updatedAt || state.stockUpdatedAt;
          safeLocalSet(STOCK_STORAGE_KEY, JSON.stringify(state.stock));
          renderStockPanel();
        } catch (_error) {}
      });
    }

    // Geri bildirimler paneldeki Yenile düğmesiyle alınır. Ayrı bir uzun ömürlü
    // bağlantı açmamak, HTTP/1.1 altında kayıt istekleri için bağlantı bırakır.
  }

  function bindAdminNotificationEvents() {
    if (!els.adminNotificationTrigger || !els.adminNotificationDrawer) return;
    els.adminNotificationTrigger.addEventListener("click", openAdminNotificationDrawer);
    if (els.adminNotificationClose) els.adminNotificationClose.addEventListener("click", () => closeAdminNotificationDrawer());
    if (els.adminNotificationOverlay) els.adminNotificationOverlay.addEventListener("click", () => closeAdminNotificationDrawer());
    if (els.adminNotificationList) els.adminNotificationList.addEventListener("click", handleAdminNotificationListClick);
    if (els.adminNotificationLoadMore) els.adminNotificationLoadMore.addEventListener("click", () => loadAdminNotifications({ append: true }));
    if (els.adminNotificationReadAll) els.adminNotificationReadAll.addEventListener("click", markAllAdminNotificationsRead);
    if (els.adminNotificationCategory) {
      els.adminNotificationCategory.addEventListener("change", () => {
        state.notificationCenter.category = els.adminNotificationCategory.value || "all";
        loadAdminNotifications().catch(() => {});
      });
    }
    document.querySelectorAll("[data-notification-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.notificationCenter.filter = button.dataset.notificationFilter === "unread" ? "unread" : "all";
        syncAdminNotificationFilters();
        loadAdminNotifications().catch(() => {});
      });
    });
    if (els.adminNotificationSettings) {
      els.adminNotificationSettings.addEventListener("toggle", () => {
        if (!els.adminNotificationSettings.open) return;
        loadAdminNotificationPreferences().catch(() => {});
        loadAdminNotificationDeliveryHealth().catch(() => {});
      });
    }
    if (els.adminNotificationPreferences) els.adminNotificationPreferences.addEventListener("submit", saveAdminNotificationPreferences);
    if (els.adminNotificationPreferences) {
      const quietHours = els.adminNotificationPreferences.elements.namedItem("quietHoursEnabled");
      if (quietHours) quietHours.addEventListener("change", syncAdminNotificationQuietHours);
    }
    if (els.adminNotificationPush) els.adminNotificationPush.addEventListener("click", toggleAdminPushSubscription);
    if (els.adminNotificationTest) els.adminNotificationTest.addEventListener("click", sendAdminTestNotification);
    const previewTrigger = document.querySelector("[data-global-preview-trigger]");
    if (previewTrigger) previewTrigger.addEventListener("click", () => {
      if (state.notificationCenter.open) closeAdminNotificationDrawer({ restoreFocus: false });
    });
    document.addEventListener("keydown", handleAdminNotificationKeydown);
  }

  async function initializeAdminNotifications() {
    syncAdminNotificationFilters();
    renderAdminNotifications();
    await Promise.allSettled([
      loadAdminNotificationUnreadCount(),
      loadAdminNotificationPreferences()
    ]);
  }

  function openAdminNotificationDrawer() {
    const center = state.notificationCenter;
    if (center.open || !els.adminNotificationDrawer) return;
    center.open = true;
    center.lastFocus = document.activeElement;
    closeAdminProfileMenu();
    const previewClose = document.querySelector("[data-global-preview-drawer].is-open [data-global-preview-close]");
    if (previewClose) previewClose.click();
    els.adminNotificationDrawer.inert = false;
    els.adminNotificationDrawer.setAttribute("aria-hidden", "false");
    els.adminNotificationDrawer.classList.add("is-open");
    if (els.adminNotificationOverlay) els.adminNotificationOverlay.hidden = false;
    els.adminNotificationTrigger.setAttribute("aria-expanded", "true");
    els.adminNotificationTrigger.setAttribute("aria-label", "Bildirim merkezini kapat");
    document.body.classList.add("is-notification-drawer-open");
    window.setTimeout(() => els.adminNotificationTitle && els.adminNotificationTitle.focus(), 30);
    loadAdminNotifications().catch(() => {});
  }

  function closeAdminNotificationDrawer(options = {}) {
    const center = state.notificationCenter;
    if (!els.adminNotificationDrawer) return;
    center.open = false;
    els.adminNotificationDrawer.classList.remove("is-open");
    els.adminNotificationDrawer.setAttribute("aria-hidden", "true");
    els.adminNotificationDrawer.inert = true;
    if (els.adminNotificationOverlay) els.adminNotificationOverlay.hidden = true;
    if (els.adminNotificationTrigger) {
      els.adminNotificationTrigger.setAttribute("aria-expanded", "false");
      els.adminNotificationTrigger.setAttribute("aria-label", "Bildirim merkezini aç");
    }
    document.body.classList.remove("is-notification-drawer-open");
    if (options.restoreFocus !== false && center.lastFocus && typeof center.lastFocus.focus === "function") {
      center.lastFocus.focus();
    }
    center.lastFocus = null;
  }

  function handleAdminNotificationKeydown(event) {
    if (!state.notificationCenter.open || !els.adminNotificationDrawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeAdminNotificationDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(els.adminNotificationDrawer.querySelectorAll(
      "button:not([disabled]), select:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])"
    )).filter((node) => !node.hidden && node.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadAdminNotificationUnreadCount() {
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/unread-count`);
      setAdminNotificationUnreadCount(result.unreadCount ?? result.count ?? 0);
      return result;
    } catch (error) {
      if (![401, 403].includes(Number(error.status))) setAdminNotificationMessage(error.message || "Bildirim sayısı alınamadı.", "error");
      throw error;
    }
  }

  async function loadAdminNotifications(options = {}) {
    const center = state.notificationCenter;
    if (center.loading) return;
    const append = options.append === true;
    center.loading = true;
    if (els.adminNotificationList) els.adminNotificationList.setAttribute("aria-busy", "true");
    if (!append) setAdminNotificationMessage("Bildirimler yükleniyor.");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (center.filter === "unread") query.set("unread", "true");
      if (center.category !== "all") query.set("category", center.category);
      if (append && center.nextCursor) query.set("cursor", center.nextCursor);
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}?${query.toString()}`);
      const incoming = Array.isArray(result.notifications) ? result.notifications : [];
      const merged = append ? center.items.concat(incoming) : incoming;
      center.items = uniqueAdminNotifications(merged);
      center.nextCursor = String(result.nextCursor || "");
      setAdminNotificationUnreadCount(result.unreadCount ?? center.unreadCount);
      setAdminNotificationMessage(center.items.length ? "" : "Bu filtrede bildirim bulunmuyor.");
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirimler alınamadı.", "error");
      if (!append) center.items = [];
    } finally {
      center.loading = false;
      if (els.adminNotificationList) els.adminNotificationList.setAttribute("aria-busy", "false");
      renderAdminNotifications();
    }
  }

  function uniqueAdminNotifications(items) {
    const seen = new Set();
    return items.filter((item) => {
      const id = String(item && (item.id || item.notificationId) || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function renderAdminNotifications() {
    if (!els.adminNotificationList) return;
    const center = state.notificationCenter;
    if (center.loading && !center.items.length) {
      els.adminNotificationList.innerHTML = `<div class="admin-notification-empty"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"></path><path d="M10 21h4"></path></svg><br>Bildirimler yükleniyor...</div></div>`;
      return;
    }
    if (!center.items.length) {
      const label = center.filter === "unread" ? "Okunmamış bildiriminiz yok." : "Henüz bildiriminiz yok.";
      els.adminNotificationList.innerHTML = `<div class="admin-notification-empty"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"></path><path d="M9 17a3 3 0 0 0 6 0"></path></svg><br>${escapeHTML(label)}</div></div>`;
    } else {
      els.adminNotificationList.innerHTML = center.items.map(renderAdminNotificationCard).join("");
    }
    if (els.adminNotificationLoadMore) els.adminNotificationLoadMore.hidden = !center.nextCursor;
    if (els.adminNotificationReadAll) els.adminNotificationReadAll.disabled = center.unreadCount < 1 || center.loading;
  }

  function renderAdminNotificationCard(notification) {
    const id = String(notification.id || notification.notificationId || "");
    const category = normalizeAdminNotificationCategory(notification.category || notification.type || notification.kind);
    const severity = normalizeAdminNotificationSeverity(notification.severity);
    const read = adminNotificationIsRead(notification);
    const title = notification.title || notification.subject || adminNotificationCategoryLabel(category);
    const body = notification.body || notification.message || notification.description || "Bildirim ayrıntısını açın.";
    const createdAt = notification.createdAt || notification.timestamp || notification.sentAt;
    const readAction = read ? "unread" : "read";
    const readLabel = read ? "Okunmamış yap" : "Okundu yap";
    return `
      <article class="admin-notification-card is-${escapeAttribute(severity)} ${read ? "" : "is-unread"}" data-notification-id="${escapeAttribute(id)}" data-severity="${escapeAttribute(severity)}">
        <span class="admin-notification-kind" data-kind="${escapeAttribute(category)}" aria-hidden="true">${adminNotificationIcon(category)}</span>
        <div class="admin-notification-copy">
          <button type="button" data-notification-open="${escapeAttribute(id)}">
            <strong>${escapeHTML(title)}</strong>
            <p>${escapeHTML(body)}</p>
          </button>
          <div class="admin-notification-meta"><span>${escapeHTML(adminNotificationCategoryLabel(category))}</span><span class="admin-notification-severity" data-severity="${escapeAttribute(severity)}">${escapeHTML(adminNotificationSeverityLabel(severity))}</span><time datetime="${escapeAttribute(createdAt || "")}">${escapeHTML(formatDateTime(createdAt) || "Az önce")}</time></div>
        </div>
        <div class="admin-notification-actions">
          <button type="button" data-notification-action="${readAction}" data-notification-id="${escapeAttribute(id)}" aria-label="${readLabel}" title="${readLabel}">${read ? adminNotificationIcon("unread") : adminNotificationIcon("read")}</button>
          <button type="button" data-notification-action="archive" data-notification-id="${escapeAttribute(id)}" aria-label="Arşivle" title="Arşivle">${adminNotificationIcon("archive")}</button>
        </div>
      </article>`;
  }

  function adminNotificationIcon(kind) {
    const icons = {
      task: `<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="m8 9 1.5 1.5L12 8M8 15h8"></path></svg>`,
      shipment: `<svg viewBox="0 0 24 24"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"></path><circle cx="7" cy="19" r="2"></circle><circle cx="18" cy="19" r="2"></circle></svg>`,
      shift: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18M12 13v4l3 1"></path></svg>`,
      training: `<svg viewBox="0 0 24 24"><path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z"></path><path d="M20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4z"></path></svg>`,
      stock: `<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"></path></svg>`,
      system: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>`,
      read: `<svg viewBox="0 0 24 24"><path d="M4 12.5 9 17l11-11"></path></svg>`,
      unread: `<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM4 7l8 6 8-6"></path></svg>`,
      archive: `<svg viewBox="0 0 24 24"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"></path></svg>`
    };
    return icons[kind] || icons.system;
  }

  function normalizeAdminNotificationCategory(value) {
    const text = String(value || "system").toLocaleLowerCase("tr-TR");
    if (/task|görev|todo|assignment|reminder.*task/.test(text)) return "task";
    if (/shipment|sevkiyat/.test(text)) return "shipment";
    if (/shift|vardiya|izin/.test(text)) return "shift";
    if (/training|eğitim|recipe|reçete|exam|sınav/.test(text)) return "training";
    if (/stock|stok|inventory/.test(text)) return "stock";
    return "system";
  }

  function adminNotificationCategoryLabel(category) {
    return { task: "Yapılacaklar", shipment: "Sevkiyat", shift: "Vardiya", training: "Eğitim", stock: "Stok", system: "Sistem" }[category] || "Sistem";
  }

  function normalizeAdminNotificationSeverity(value) {
    return ["info", "success", "warning", "critical"].includes(value) ? value : "info";
  }

  function adminNotificationSeverityLabel(severity) {
    return { info: "Bilgi", success: "Başarılı", warning: "Uyarı", critical: "Kritik" }[severity] || "Bilgi";
  }

  function adminNotificationIsRead(notification) {
    return Boolean(notification.read === true || notification.readAt || String(notification.status || "").toLowerCase() === "read");
  }

  function setAdminNotificationUnreadCount(value) {
    const count = Math.max(0, Number(value || 0));
    state.notificationCenter.unreadCount = count;
    if (els.adminNotificationBadge) {
      els.adminNotificationBadge.hidden = count < 1;
      els.adminNotificationBadge.textContent = count > 99 ? "99+" : String(count);
      els.adminNotificationBadge.setAttribute("aria-label", `${count} okunmamış bildirim`);
    }
    if (els.adminNotificationSummary) {
      els.adminNotificationSummary.textContent = count ? `${count} okunmamış bildiriminiz var.` : "Tüm bildirimleriniz güncel.";
    }
    if (els.adminNotificationReadAll) els.adminNotificationReadAll.disabled = count < 1;
  }

  function setAdminNotificationMessage(message, tone = "") {
    if (!els.adminNotificationMessage) return;
    els.adminNotificationMessage.textContent = message || "";
    if (tone) els.adminNotificationMessage.dataset.tone = tone;
    else delete els.adminNotificationMessage.dataset.tone;
  }

  function syncAdminNotificationFilters() {
    document.querySelectorAll("[data-notification-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.notificationFilter === state.notificationCenter.filter));
    });
    if (els.adminNotificationCategory) els.adminNotificationCategory.value = state.notificationCenter.category;
  }

  async function handleAdminNotificationListClick(event) {
    const actionButton = event.target.closest("[data-notification-action]");
    if (actionButton) {
      await mutateAdminNotification(actionButton.dataset.notificationId, actionButton.dataset.notificationAction, actionButton);
      return;
    }
    const openButton = event.target.closest("[data-notification-open]");
    if (!openButton) return;
    const notification = state.notificationCenter.items.find((item) => String(item.id || item.notificationId) === openButton.dataset.notificationOpen);
    if (!notification) return;
    if (!adminNotificationIsRead(notification)) {
      const updated = await mutateAdminNotification(openButton.dataset.notificationOpen, "read", openButton, { refresh: false });
      if (!updated) return;
    }
    followAdminNotificationDeepLink(notification);
  }

  async function mutateAdminNotification(id, action, button, options = {}) {
    const center = state.notificationCenter;
    const key = `${id}:${action}`;
    if (!id || center.mutationKeys.has(key)) return false;
    center.mutationKeys.add(key);
    if (button) button.disabled = true;
    setAdminNotificationMessage("İşlem uygulanıyor.");
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/${encodeURIComponent(id)}/${action}`, { method: "PATCH", body: {} });
      if (result.notification) {
        center.items = center.items.map((item) => String(item.id || item.notificationId) === String(id) ? result.notification : item);
      }
      if (action === "archive") center.items = center.items.filter((item) => String(item.id || item.notificationId) !== String(id));
      setAdminNotificationUnreadCount(result.unreadCount ?? center.unreadCount);
      setAdminNotificationMessage(action === "archive" ? "Bildirim arşivlendi." : "Bildirim durumu güncellendi.", "success");
      if (options.refresh !== false) await loadAdminNotifications();
      else renderAdminNotifications();
      return true;
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim güncellenemedi.", "error");
      return false;
    } finally {
      center.mutationKeys.delete(key);
      if (button && button.isConnected) button.disabled = false;
    }
  }

  async function markAllAdminNotificationsRead() {
    const button = els.adminNotificationReadAll;
    if (!button || button.disabled) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Güncelleniyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/read-all`, { method: "POST", body: {} });
      setAdminNotificationUnreadCount(result.unreadCount ?? 0);
      setAdminNotificationMessage("Tüm bildirimler okundu olarak işaretlendi.", "success");
      await loadAdminNotifications();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirimler güncellenemedi.", "error");
    } finally {
      button.textContent = previous;
      button.disabled = state.notificationCenter.unreadCount < 1;
    }
  }

  function followAdminNotificationDeepLink(notification) {
    const details = notification.data || notification.metadata || notification.context || {};
    const category = normalizeAdminNotificationCategory(notification.category || notification.type || notification.kind);
    const rawLink = String(notification.deepLink || notification.actionUrl || notification.url || details.deepLink || details.url || "").trim();
    let section = normalizeAdminNotificationSection(notification.section || details.section || "");
    let workforceTarget = String(details.workforce || "").toLowerCase();
    let entityId = String(notification.entityId || details.entityId || "").trim();
    if (rawLink) {
      try {
        const target = new URL(rawLink, window.location.href);
        if (target.origin === window.location.origin && (target.pathname === "/yonetici" || target.pathname.startsWith("/yonetici/"))) {
          section = normalizeAdminNotificationSection(target.searchParams.get("section")) || section;
          workforceTarget = String(target.searchParams.get("workforce") || workforceTarget).toLowerCase();
          entityId = String(target.searchParams.get("entityId") || entityId).trim();
          const hashSection = target.hash ? normalizeAdminNotificationSection(decodeURIComponent(target.hash.slice(1))) : "";
          section = hashSection || section;
          if (target.hash) window.history.replaceState(null, "", target.hash);
        } else {
          section = "overview";
          workforceTarget = "";
          entityId = "";
        }
      } catch (_error) {
        section = "overview";
        workforceTarget = "";
        entityId = "";
      }
    }
    if (!section && ["task", "shipment", "shift", "training"].includes(category)) section = "staffAccess";
    if (!section && category === "stock") section = "stock";
    if (!section) section = "overview";
    closeAdminNotificationDrawer();
    setActiveSection(section, { collapseSidebar: true });
    if (section === "staffAccess") {
      window.setTimeout(() => {
        const targetKind = workforceTarget || ({ task: "tasks", shipment: "shipments", shift: "shifts", training: "training" }[category] || "");
        if (targetKind === "tasks") {
          const accordion = document.getElementById("workforceTasksAccordion");
          if (accordion) accordion.open = true;
        } else if (targetKind === "training") {
          const assignmentButton = document.getElementById("staffAssignmentCreateButton");
          const accordion = assignmentButton && assignmentButton.closest("details");
          if (accordion) accordion.open = true;
        } else if (targetKind === "shipments" || targetKind === "shifts") {
          const accordion = document.getElementById("workforceOperationsAccordion");
          if (accordion) accordion.open = true;
          const tab = document.querySelector(`[data-workforce-tab="${targetKind === "shifts" ? "shifts" : "shipments"}"]`);
          if (tab) tab.click();
        }
        if (entityId) {
          window.setTimeout(() => {
            const escapedId = window.CSS && typeof window.CSS.escape === "function" ? window.CSS.escape(entityId) : entityId.replace(/["\\]/g, "\\$&");
            const entity = document.querySelector(`[data-task-detail="${escapedId}"], [data-shipment="${escapedId}"], [data-request-id="${escapedId}"]`);
            if (entity) {
              entity.click();
              entity.focus({ preventScroll: true });
              entity.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            }
          }, 80);
        }
      }, 40);
    }
    document.dispatchEvent(new CustomEvent("tahmisci:admin-notification-open", {
      detail: { notification: cloneData(notification), category, section }
    }));
  }

  function normalizeAdminNotificationSection(value) {
    const direct = normalizePanelSection(String(value || ""));
    if (direct) return direct;
    const alias = String(value || "").trim().toLocaleLowerCase("tr-TR");
    if (["personel", "personnel", "staff", "staffaccess", "staffaccesscard", "tasks", "shipments", "shifts", "training", "egitim", "eğitim"].includes(alias)) return "staffAccess";
    if (["stok", "stock", "inventory"].includes(alias)) return "stock";
    if (["genel-bakis", "genelbakis", "dashboard", "home"].includes(alias)) return "overview";
    return "";
  }

  async function loadAdminNotificationPreferences() {
    const center = state.notificationCenter;
    if (center.preferencesLoading) return;
    center.preferencesLoading = true;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/preferences`);
      center.preferences = result.preferences && typeof result.preferences === "object" ? result.preferences : {};
      center.capabilities = result.capabilities && typeof result.capabilities === "object" ? result.capabilities : {};
      renderAdminNotificationPreferences();
      await syncAdminPushSubscriptionState();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim ayarları alınamadı.", "error");
    } finally {
      center.preferencesLoading = false;
    }
  }

  function renderAdminNotificationPreferences() {
    const form = els.adminNotificationPreferences;
    if (!form) return;
    const preferences = state.notificationCenter.preferences || {};
    const channels = preferences.channels || {};
    const categories = preferences.categories || preferences.categoryPreferences || {};
    setNotificationPreferenceInput(form, "inAppEnabled", preferences.inAppEnabled ?? channels.inApp ?? channels.in_app ?? true);
    setNotificationPreferenceInput(form, "emailEnabled", preferences.emailEnabled ?? channels.email ?? false);
    setNotificationPreferenceInput(form, "pushEnabled", preferences.pushEnabled ?? channels.push ?? false);
    const email = form.elements.namedItem("emailAddress");
    if (email) email.value = String(preferences.emailAddress || "");
    const categoryFields = {
      taskNotifications: "task",
      shipmentNotifications: "shipment",
      shiftNotifications: "shift",
      trainingNotifications: "training",
      stockNotifications: "stock"
    };
    Object.entries(categoryFields).forEach(([field, category]) => {
      setNotificationPreferenceInput(form, field, preferences[field] ?? categories[category] ?? true);
    });
    ["taskReminder24h", "taskReminder2h", "overdueReminder", "shiftReminder12h", "shiftReminder2h"].forEach((field) => {
      setNotificationPreferenceInput(form, field, preferences[field] ?? preferences.reminderNotifications ?? true);
    });
    setNotificationPreferenceInput(form, "quietHoursEnabled", preferences.quietHoursEnabled === true);
    const quietStart = form.elements.namedItem("quietHoursStart");
    const quietEnd = form.elements.namedItem("quietHoursEnd");
    if (quietStart) quietStart.value = String(preferences.quietHoursStart || "22:00");
    if (quietEnd) quietEnd.value = String(preferences.quietHoursEnd || "08:00");
    syncAdminNotificationQuietHours();
    const pushSupported = state.notificationCenter.capabilities.pushSupported !== false
      && window.isSecureContext
      && "serviceWorker" in navigator
      && "PushManager" in window
      && "Notification" in window;
    if (els.adminNotificationPush) {
      els.adminNotificationPush.disabled = !pushSupported;
      if (!pushSupported) els.adminNotificationPush.textContent = "Anlık bildirim desteklenmiyor";
    }
  }

  function setNotificationPreferenceInput(form, name, checked) {
    const input = form.elements.namedItem(name);
    if (input) input.checked = Boolean(checked);
  }

  function syncAdminNotificationQuietHours() {
    const form = els.adminNotificationPreferences;
    if (!form) return;
    const enabled = Boolean(form.elements.namedItem("quietHoursEnabled")?.checked);
    ["quietHoursStart", "quietHoursEnd"].forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input) input.disabled = !enabled;
    });
  }

  function collectAdminNotificationPreferences() {
    const form = els.adminNotificationPreferences;
    const current = state.notificationCenter.preferences || {};
    const checked = (name) => Boolean(form && form.elements.namedItem(name) && form.elements.namedItem(name).checked);
    const value = (name, fallback = "") => String(form && form.elements.namedItem(name)?.value || fallback);
    const categoryFields = {
      task: "taskNotifications",
      shipment: "shipmentNotifications",
      shift: "shiftNotifications",
      training: "trainingNotifications",
      stock: "stockNotifications"
    };
    const categories = Object.assign({}, current.categories || current.categoryPreferences || {}, { system: true });
    Object.entries(categoryFields).forEach(([category, field]) => { categories[category] = checked(field); });
    const channels = Object.assign({}, current.channels || {}, {
      inApp: checked("inAppEnabled"),
      email: checked("emailEnabled"),
      push: checked("pushEnabled")
    });
    const reminderFields = ["taskReminder24h", "taskReminder2h", "overdueReminder", "shiftReminder12h", "shiftReminder2h"];
    const reminders = Object.fromEntries(reminderFields.map((field) => [field, checked(field)]));
    return Object.assign({}, current, {
      inAppEnabled: channels.inApp,
      emailEnabled: channels.email,
      pushEnabled: channels.push,
      emailAddress: value("emailAddress").trim().toLowerCase(),
      channels,
      categories,
      taskNotifications: categories.task,
      shipmentNotifications: categories.shipment,
      shiftNotifications: categories.shift,
      trainingNotifications: categories.training,
      stockNotifications: categories.stock,
      systemNotifications: true,
      ...reminders,
      reminderNotifications: reminderFields.some((field) => reminders[field]),
      quietHoursEnabled: checked("quietHoursEnabled"),
      quietHoursStart: value("quietHoursStart", "22:00"),
      quietHoursEnd: value("quietHoursEnd", "08:00"),
      timezone: "Europe/Istanbul"
    });
  }

  async function saveAdminNotificationPreferences(event) {
    if (event) event.preventDefault();
    const button = els.adminNotificationSavePreferences;
    if (!button || button.disabled) return false;
    const payload = collectAdminNotificationPreferences();
    if (payload.emailEnabled && !isValidAdminNotificationEmail(payload.emailAddress)) {
      setAdminNotificationMessage("E-posta bildirimleri için geçerli bir yönetici adresi girin.", "error");
      els.adminNotificationPreferences.elements.namedItem("emailAddress")?.focus();
      return false;
    }
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Kaydediliyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/preferences`, {
        method: "PUT",
        body: payload
      });
      state.notificationCenter.preferences = result.preferences || payload;
      state.notificationCenter.capabilities = result.capabilities || state.notificationCenter.capabilities;
      renderAdminNotificationPreferences();
      setAdminNotificationMessage("Bildirim ayarları kaydedildi.", "success");
      return true;
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim ayarları kaydedilemedi.", "error");
      return false;
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function isValidAdminNotificationEmail(value) {
    const text = String(value || "");
    return text.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  }

  async function syncAdminPushSubscriptionState() {
    if (!supportsAdminPush() || !els.adminNotificationPush) return;
    try {
      const subscription = await currentAdminPushSubscription();
      state.notificationCenter.pushSubscribed = Boolean(subscription);
      els.adminNotificationPush.textContent = subscription ? "Anlık bildirimi kapat" : "Anlık bildirimi etkinleştir";
    } catch (_error) {}
  }

  async function toggleAdminPushSubscription() {
    const button = els.adminNotificationPush;
    if (!button || button.disabled) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "İşleniyor...";
    let createdSubscription = null;
    try {
      if (!supportsAdminPush()) {
        throw new Error("Bu tarayıcı anlık bildirimi desteklemiyor.");
      }
      const registration = await ensureAdminServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      const pushInput = els.adminNotificationPreferences && els.adminNotificationPreferences.elements.namedItem("pushEnabled");
      if (subscription) {
        await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
          method: "DELETE",
          body: { endpoint: subscription.endpoint }
        });
        await subscription.unsubscribe();
        subscription = null;
        if (pushInput) pushInput.checked = false;
      } else {
        let permission = window.Notification.permission;
        if (permission === "default") permission = await window.Notification.requestPermission();
        if (permission !== "granted") throw new Error("Anlık bildirim izni verilmedi.");
        const vapidPublicKey = String(state.notificationCenter.capabilities.vapidPublicKey || "").trim();
        if (!vapidPublicKey) throw new Error("Anlık bildirim sunucu anahtarı tanımlı değil.");
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });
        createdSubscription = subscription;
        await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
          method: "POST",
          body: { subscription: subscription.toJSON() }
        });
        if (pushInput) pushInput.checked = true;
      }
      const saved = await saveAdminNotificationPreferences();
      if (!saved) throw new Error("Anlık bildirim tercihi kaydedilemedi.");
      state.notificationCenter.pushSubscribed = Boolean(subscription);
      setAdminNotificationMessage(subscription ? "Anlık bildirim etkinleştirildi." : "Anlık bildirim kapatıldı.", "success");
    } catch (error) {
      if (createdSubscription) {
        await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
          method: "DELETE",
          body: { endpoint: createdSubscription.endpoint },
          skipAuthFailure: true
        }).catch(() => null);
        await createdSubscription.unsubscribe().catch(() => false);
        const pushInput = els.adminNotificationPreferences && els.adminNotificationPreferences.elements.namedItem("pushEnabled");
        if (pushInput) pushInput.checked = false;
        state.notificationCenter.pushSubscribed = false;
      }
      setAdminNotificationMessage(error.message || "Anlık bildirim ayarı değiştirilemedi.", "error");
    } finally {
      button.disabled = false;
      button.textContent = state.notificationCenter.pushSubscribed ? "Anlık bildirimi kapat" : previous.includes("kapat") ? "Anlık bildirimi etkinleştir" : previous;
    }
  }

  function supportsAdminPush() {
    return Boolean(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }

  async function ensureAdminServiceWorker() {
    const existing = await navigator.serviceWorker.getRegistration("/yonetici/");
    if (existing) return existing;
    return navigator.serviceWorker.register("/yonetici/sw.js", { scope: "/yonetici/", updateViaCache: "none" });
  }

  async function currentAdminPushSubscription() {
    if (!supportsAdminPush()) return null;
    const registration = await navigator.serviceWorker.getRegistration("/yonetici/");
    return registration ? registration.pushManager.getSubscription() : null;
  }

  async function detachAdminPushSubscription() {
    const subscription = await currentAdminPushSubscription().catch(() => null);
    if (!subscription) return;
    await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
      skipAuthFailure: true
    }).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
    state.notificationCenter.pushSubscribed = false;
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function sendAdminTestNotification() {
    const button = els.adminNotificationTest;
    if (!button || button.disabled) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Gönderiliyor...";
    try {
      await backendRequest(`${ADMIN_NOTIFICATION_API}/test`, { method: "POST", body: { channels: ["in_app"] } });
      setAdminNotificationMessage("Test bildirimi kuyruğa alındı.", "success");
      await loadAdminNotifications();
      await loadAdminNotificationDeliveryHealth();
    } catch (error) {
      if (Number(error.status) === 404) button.hidden = true;
      setAdminNotificationMessage(error.message || "Test bildirimi gönderilemedi.", "error");
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function loadAdminNotificationDeliveryHealth() {
    if (!els.adminNotificationHealth) return;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/delivery-health`);
      const health = result.health || {};
      const channels = health.channels || {};
      const email = health.email || channels.email || {};
      const push = health.push || channels.push || {};
      const metric = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      const display = (value) => value === null ? "—" : String(value);
      const pendingEmail = metric(health.pendingEmail ?? email.pending);
      const sent = metric(health.sent ?? health.delivered, 0);
      const failed = metric(health.failed, 0);
      const pendingPush = metric(health.pendingPush ?? push.pending);
      const invalidPush = metric(health.invalidPushSubscriptions ?? health.invalidPush ?? push.invalid, 0);
      const lastRun = health.lastProcessedAt || health.lastWorkerRunAt || health.lastRunAt || "";
      els.adminNotificationHealth.innerHTML = `
        <span><strong>${display(pendingEmail)}</strong><small>Bekleyen e-posta</small></span>
        <span><strong>${display(sent)}</strong><small>Gönderilen</small></span>
        <span><strong>${display(failed)}</strong><small>Başarısız</small></span>
        <span><strong>${display(pendingPush)}</strong><small>Bekleyen push</small></span>
        <span><strong>${display(invalidPush)}</strong><small>Geçersiz abonelik</small></span>
        <span class="is-wide"><strong>${escapeHTML(formatDateTime(lastRun) || "Henüz çalışmadı")}</strong><small>Son worker çalışması</small></span>`;
    } catch (error) {
      els.adminNotificationHealth.textContent = error.message || "Teslimat sağlığı alınamadı.";
    }
  }

  function setupAdminNotificationRealtime() {
    const baseUrl = backendBaseUrl();
    if (!baseUrl) return;
    if (!window.EventSource) {
      startAdminNotificationPolling();
      return;
    }
    if (state.notificationEventSource) return;
    try {
      const source = new EventSource(`${baseUrl}${ADMIN_NOTIFICATION_API}/events`, { withCredentials: true });
      state.notificationEventSource = source;
      source.addEventListener("open", () => {
        state.notificationReconnectAttempt = 0;
        if (state.notificationReconnectTimer) window.clearTimeout(state.notificationReconnectTimer);
        state.notificationReconnectTimer = null;
        stopAdminNotificationPolling();
      });
      source.addEventListener("notification", handleAdminNotificationEvent);
      source.addEventListener("message", handleAdminNotificationEvent);
      source.addEventListener("error", () => {
        try { source.close(); } catch (_error) {}
        if (state.notificationEventSource === source) state.notificationEventSource = null;
        startAdminNotificationPolling();
        scheduleAdminNotificationReconnect();
      });
    } catch (_error) {
      startAdminNotificationPolling();
      scheduleAdminNotificationReconnect();
    }
  }

  function scheduleAdminNotificationReconnect() {
    if (state.notificationReconnectTimer || !els.panelShell || els.panelShell.hidden || !window.EventSource) return;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(state.notificationReconnectAttempt, 5)));
    state.notificationReconnectAttempt += 1;
    state.notificationReconnectTimer = window.setTimeout(() => {
      state.notificationReconnectTimer = null;
      setupAdminNotificationRealtime();
    }, delay);
  }

  function handleAdminNotificationEvent(event) {
    try {
      const payload = JSON.parse(event.data || "{}");
      if (payload.unreadCount !== undefined) setAdminNotificationUnreadCount(payload.unreadCount);
      if (state.notificationCenter.open) loadAdminNotifications().catch(() => {});
    } catch (_error) {}
  }

  function startAdminNotificationPolling() {
    if (state.notificationPollTimer) return;
    state.notificationPollTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadAdminNotificationUnreadCount().catch(() => {});
      if (state.notificationCenter.open) loadAdminNotifications().catch(() => {});
    }, ADMIN_NOTIFICATION_POLL_MS);
  }

  function stopAdminNotificationPolling() {
    if (!state.notificationPollTimer) return;
    window.clearInterval(state.notificationPollTimer);
    state.notificationPollTimer = null;
  }

  function hasMenuContent(menuState) {
    return Boolean(menuState && Array.isArray(menuState.categories) && menuState.categories.length);
  }

  function hasRecipeContent(recipeState) {
    if (!recipeState || typeof recipeState !== "object" || Array.isArray(recipeState)) return false;
    return Object.keys(recipeState).some((category) => {
      const products = recipeState[category];
      return products && typeof products === "object" && Object.keys(products).length;
    });
  }

  function hasSiteContent(siteState) {
    return Boolean(siteState && typeof siteState === "object" && !Array.isArray(siteState) && Object.keys(siteState).length);
  }

  function hasPendingChanges() {
    return state.dirtyMenu || state.dirtyRecipes || state.dirtySite || state.dirtyStock;
  }

  function markDirty(scope, message) {
    if (scope === "menu") state.dirtyMenu = true;
    if (scope === "recipes") state.dirtyRecipes = true;
    if (scope === "site") state.dirtySite = true;
    if (scope === "stock") state.dirtyStock = true;
    state.saveStatus = "dirty";
    updateSaveControls(message || "Kaydedilmemiş değişiklik");
  }

  function updateSaveControls(message) {
    const pending = hasPendingChanges();
    const awaitingVerification = Boolean(state.pendingPublishVerification);
    const status = state.saving
      ? awaitingVerification ? "verifying" : "saving"
      : awaitingVerification ? "unverified" : pending ? "dirty" : state.saveStatus;
    const statusText = {
      clean: "Değişiklik yok",
      dirty: "Kaydedilmemiş değişiklik",
      saving: "Kaydediliyor",
      verifying: "Yayın doğrulanıyor",
      published: "Yayınlandı",
      unverified: "Yayın doğrulanamadı",
      error: "Kayıt hatası",
      conflict: "Veri çakışması"
    }[status] || "Değişiklik yok";
    if (els.saveChangesButton) {
      const disabled = state.saving || (!pending && !awaitingVerification);
      els.saveChangesButton.classList.toggle("is-disabled", disabled);
      els.saveChangesButton.disabled = disabled;
      els.saveChangesButton.setAttribute("aria-disabled", String(disabled));
      els.saveChangesButton.toggleAttribute("aria-busy", state.saving);
      els.saveChangesButton.textContent = state.saving
        ? awaitingVerification ? "Doğrulanıyor..." : "Kaydediliyor..."
        : awaitingVerification ? "Yayını Doğrula" : "Kaydet ve Yayınla";
    }
    if (els.saveState) {
      els.saveState.textContent = message || statusText;
      els.saveState.dataset.saveStatus = status;
    }

    if (els.menuSummaryStatus) {
      els.menuSummaryStatus.textContent = state.saving
        ? awaitingVerification ? "Doğrulanıyor" : "Kaydediliyor"
        : awaitingVerification ? "Doğrulanamadı" : pending ? "Taslak" : "Hazır";
      const summaryStatus = els.menuSummaryStatus.closest(".menu-summary-status");
      if (summaryStatus) summaryStatus.classList.toggle("is-pending", pending || awaitingVerification || state.saving);
    }
  }

  function queueRenderAll() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => {
      state.renderTimer = null;
      renderAll();
    }, 80);
  }

  function handleSaveButtonClick(event) {
    event.preventDefault();
    savePendingChanges().catch(() => {});
  }

  function captureCurrentEditorState() {
    if (!state.data || !state.site || !state.recipes) return;
    if (state.activeSection === "menu" || state.activeSection === "banner") {
      updateSettingsFromForm();
      return;
    }
    if (state.activeSection === "category") {
      updateCategoryFromForm();
      return;
    }
    if (state.activeSection === "product") {
      updateProductFromForm();
      return;
    }
    if (state.activeSection === "site") {
      handleSiteSectionOrder();
      return;
    }
    if (state.activeSection === "settings") {
      writePanelConfigFromForm();
      writeSiteInfoFromSettings({ dirty: true });
    }
  }

  window.__tahmisciRefreshStaffLedger = hydrateRecipeAccessFromBackend;

  function savePendingChanges() {
    captureCurrentEditorState();
    if (state.pendingPublishVerification) return retryPendingPublishVerification();
    if (!hasPendingChanges()) {
      state.saveStatus = "clean";
      updateSaveControls("Değişiklik yok");
      window.setTimeout(() => updateSaveControls(), 1200);
      return Promise.resolve({ ok: true, unchanged: true, revision: state.publishRevision });
    }

    const operation = async () => {
      const snapshot = createPublishSnapshot();
      if (!backendBaseUrl()) throw new Error("Backend adresi tanımlı değil; değişiklikler yayınlanmadı.");
      state.saving = true;
      state.saveStatus = "saving";
      updateSaveControls();
      try {
        const requestId = createRequestId("publish");
        const result = await backendRequest("/api/admin/publish", {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: { requestId, expectedRevision: state.publishRevision, changes: snapshot.changes }
        });
        const acceptedRevision = Number(result && (result.revision ?? result.publishRevision));
        if (Number.isSafeInteger(acceptedRevision) && acceptedRevision >= 0) state.publishRevision = acceptedRevision;
        const pendingVerification = createPendingPublishVerification(snapshot, result, requestId);
        if (snapshot.changes.menuState) state.pendingPublishVerification = pendingVerification;
        clearPublishedScopes(snapshot);
        if (!snapshot.changes.menuState) {
          completePublishedVerification(pendingVerification, null);
          return Object.assign({}, result, { verified: true, verificationRequired: false });
        }
        updateSaveControls("Yayın sunucudan doğrulanıyor");
        return await verifyPendingPublishReadback();
      } catch (error) {
        if (error && error.publishAccepted) {
          console.warn("Yayın kabul edildi ancak doğrulanamadı:", error);
          state.saveStatus = "unverified";
          updateSaveControls(error.message || "Yayın doğrulanamadı. Değişiklikleriniz korunuyor.");
          alert(error.message || "Yayın sunucu tarafından kabul edildi ancak doğrulanamadı. Değişiklikleriniz korunuyor.");
        } else {
          console.error("Kaydetme başarısız:", error);
          state.saveStatus = Number(error && error.status) === 409 ? "conflict" : "error";
          updateSaveControls();
          alert(error.message || "Kayıt tamamlanamadı. Değişiklikleriniz korunuyor.");
        }
        throw error;
      } finally {
        state.saving = false;
        updateSaveControls();
      }
    };

    return saveCoordinator
      ? saveCoordinator.run("admin-publish", operation, {
        button: els.saveChangesButton,
        busyText: "Kaydediliyor...",
        onSettled: updateSaveControls
      })
      : operation();
  }

  function createPendingPublishVerification(snapshot, publishResult, requestId) {
    const expectedMenuState = snapshot.changes.menuState ? cloneData(snapshot.changes.menuState) : null;
    return {
      snapshot,
      publishResult: cloneData(publishResult || {}),
      requestId,
      acceptedAt: new Date().toISOString(),
      expectedDesignFingerprint: expectedMenuState ? MENU_DESIGN_SCHEMA.designFingerprint(expectedMenuState) : "",
      lastError: ""
    };
  }

  async function verifyPendingPublishReadback() {
    const pending = state.pendingPublishVerification;
    if (!pending) return { ok: true, unchanged: true, revision: state.publishRevision };

    try {
      const readback = await backendRequest("/api/menu", { skipToken: true });
      syncPublishRevision(readback);
      const canonicalMenuState = readback && readback.menuState;
      const validMenuState = Boolean(canonicalMenuState
        && typeof canonicalMenuState === "object"
        && !Array.isArray(canonicalMenuState)
        && Array.isArray(canonicalMenuState.categories));
      const actualFingerprint = validMenuState
        ? MENU_DESIGN_SCHEMA.designFingerprint(canonicalMenuState)
        : "";
      if (!actualFingerprint || actualFingerprint !== pending.expectedDesignFingerprint) {
        throw createPublishVerificationError("Yayın sunucu tarafından kabul edildi ancak tasarım readback verisiyle eşleşmedi. Yeniden doğrulayabilirsiniz.");
      }

      completePublishedVerification(pending, readback);
      return Object.assign({}, pending.publishResult, {
        verified: true,
        publishRevision: state.publishRevision
      });
    } catch (error) {
      const verificationError = error && error.publishAccepted
        ? error
        : createPublishVerificationError("Yayın sunucu tarafından kabul edildi ancak readback isteği tamamlanamadı. Değişiklikleriniz korunuyor.", error);
      pending.lastError = verificationError.message;
      state.pendingPublishVerification = pending;
      state.saveStatus = "unverified";
      updateSaveControls(verificationError.message);
      throw verificationError;
    }
  }

  function retryPendingPublishVerification() {
    if (!state.pendingPublishVerification) {
      return Promise.resolve({ ok: true, unchanged: true, revision: state.publishRevision });
    }

    const operation = async () => {
      state.saving = true;
      state.saveStatus = "unverified";
      updateSaveControls("Yayın yeniden doğrulanıyor");
      try {
        return await verifyPendingPublishReadback();
      } catch (error) {
        console.warn("Yayın readback doğrulaması başarısız:", error);
        alert(error.message || "Yayın henüz doğrulanamadı. Değişiklikleriniz korunuyor.");
        throw error;
      } finally {
        state.saving = false;
        updateSaveControls();
      }
    };

    return saveCoordinator
      ? saveCoordinator.run("admin-publish", operation, {
        button: els.saveChangesButton,
        busyText: "Doğrulanıyor...",
        onSettled: updateSaveControls
      })
      : operation();
  }

  function createPublishVerificationError(message, cause) {
    const error = new Error(message);
    error.code = "PUBLISH_VERIFICATION_FAILED";
    error.publishAccepted = true;
    if (cause) error.originalError = cause;
    return error;
  }

  function completePublishedVerification(pending, readback) {
    const snapshot = pending.snapshot;
    clearPublishedScopes(snapshot);
    persistPublishedSnapshot(snapshot, readback);
    state.pendingPublishVerification = null;
    state.saveStatus = hasPendingChanges() ? "dirty" : "published";
    if (window.TahmisciLivePreview && typeof window.TahmisciLivePreview.markPublished === "function") {
      window.TahmisciLivePreview.markPublished(snapshot.previewSnapshot);
    }
    if (state.channel) state.channel.postMessage({ type: "menu-updated", time: Date.now() });
    if (state.recipeChannel) state.recipeChannel.postMessage({ type: "recipes-updated", time: Date.now() });
    if (state.siteChannel) state.siteChannel.postMessage({ type: "site-updated", time: Date.now() });
    updateSaveControls("Yayın sunucudan doğrulandı");
  }

  function createPublishSnapshot() {
    const changes = {};
    const fingerprints = {};
    if (state.dirtyMenu) changes.menuState = cloneData(state.data);
    if (state.dirtyRecipes) {
      changes.recipeState = cloneData(state.recipes);
      changes.recipeCatalog = cloneData(state.recipeCatalog);
    }
    if (state.dirtySite) changes.siteState = cloneData(state.site);
    if (state.dirtyStock) changes.stockState = normalizeStockStateForAdmin(cloneData(state.stock));
    Object.keys(changes).forEach((key) => { fingerprints[key] = JSON.stringify(changes[key]); });
    return {
      changes,
      fingerprints,
      previewSnapshot: {
        menuState: cloneData(state.data),
        recipeState: cloneData(state.recipes),
        stockState: cloneData(state.stock),
        pricing: cloneData(state.data && state.data.pricing || null)
      }
    };
  }

  function persistPublishedSnapshot(snapshot, readback) {
    if (snapshot.changes.menuState && snapshot.fingerprints.menuState === JSON.stringify(state.data)) {
      const canonicalMenuState = readback && readback.menuState
        ? readback.menuState
        : snapshot.changes.menuState;
      state.data = normalizeState(canonicalMenuState);
      if (readback && readback.pricing && typeof readback.pricing === "object") {
        state.data.pricing = cloneData(readback.pricing);
      }
      safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
    }
    if (snapshot.changes.recipeState
      && snapshot.fingerprints.recipeState === JSON.stringify(state.recipes)
      && snapshot.fingerprints.recipeCatalog === JSON.stringify(state.recipeCatalog)) {
      safeLocalSet(RECIPE_STORAGE_KEY, JSON.stringify(snapshot.changes.recipeState));
      safeLocalSet(LEGACY_RECIPE_STORAGE_KEY, JSON.stringify(snapshot.changes.recipeState));
    }
    if (snapshot.changes.siteState && snapshot.fingerprints.siteState === JSON.stringify(state.site)) {
      safeLocalSet(SITE_STORAGE_KEY, JSON.stringify(snapshot.changes.siteState));
    }
    if (snapshot.changes.stockState
      && snapshot.fingerprints.stockState === JSON.stringify(normalizeStockStateForAdmin(state.stock))) {
      safeLocalSet(STOCK_STORAGE_KEY, JSON.stringify(snapshot.changes.stockState));
    }
  }

  function clearPublishedScopes(snapshot) {
    if (snapshot.fingerprints.menuState === JSON.stringify(state.data)) state.dirtyMenu = false;
    if (snapshot.fingerprints.recipeState === JSON.stringify(state.recipes)
      && snapshot.fingerprints.recipeCatalog === JSON.stringify(state.recipeCatalog)) state.dirtyRecipes = false;
    if (snapshot.fingerprints.siteState === JSON.stringify(state.site)) state.dirtySite = false;
    if (snapshot.fingerprints.stockState === JSON.stringify(normalizeStockStateForAdmin(state.stock))) state.dirtyStock = false;
  }

  function createRequestId(prefix) {
    const id = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${id}`;
  }

  function syncPublishRevision(result) {
    const revision = Number(result && result.publishRevision);
    if (Number.isSafeInteger(revision) && revision >= 0) state.publishRevision = revision;
  }

  function saveRecipesLocalOnly() {
    const json = JSON.stringify(state.recipes);
    safeLocalSet(RECIPE_STORAGE_KEY, json);
    safeLocalSet(LEGACY_RECIPE_STORAGE_KEY, json);
  }

  async function saveMenuToBackend() {
    const result = await backendRequest("/api/menu", {
      method: "PUT",
      body: { menuState: state.data }
    });
    syncPublishRevision(result);
  }

  async function saveRecipesToBackend() {
    const result = await backendRequest("/api/recipes", {
      method: "PUT",
      body: { recipeState: state.recipes, recipeCatalog: state.recipeCatalog }
    });
    syncPublishRevision(result);
    state.recipeCatalog = normalizeRecipeCatalog(result.recipeCatalog);
    state.recipeLinkReview = Array.isArray(result.recipeLinkReview) ? result.recipeLinkReview : state.recipeLinkReview;
  }

  async function saveSiteToBackend() {
    // PASIF_SITE_MODULU_BASLANGIC
    if (DISABLED_PANEL_SECTIONS.has("site")) return;
    // PASIF_SITE_MODULU_BITIS
    const result = await backendRequest("/api/site", {
      method: "PUT",
      body: { siteState: state.site }
    });
    if (result.siteState) state.site = normalizeSiteSettings(result.siteState);
    await loadSiteRevisions();
  }

  function normalizeRecipeData(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const normalized = {};
    Object.keys(source).forEach((categoryName) => {
      const products = source[categoryName];
      if (!products || typeof products !== "object") return;
      normalized[categoryName] = {};
      Object.keys(products).forEach((productName) => {
        const sizes = products[productName];
        if (!sizes || typeof sizes !== "object") return;
        normalized[categoryName][productName] = {};
        Object.keys(sizes).forEach((sizeName) => {
          normalized[categoryName][productName][sizeName] = normalizeRecipeItem(sizes[sizeName]);
        });
      });
    });
    return normalized;
  }

  function normalizeRecipeCatalog(raw) {
    return Array.isArray(raw) ? raw.map((item) => ({
      ...item,
      id: String(item && item.id || ""),
      category: String(item && item.category || ""),
      product: String(item && item.product || ""),
      createdAt: String(item && item.createdAt || ""),
      updatedAt: String(item && item.updatedAt || "")
    })).filter((item) => item.id && item.category && item.product) : [];
  }

  function normalizeRecipeItem(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return {
        ...value,
        content: String(value.content ?? value.recipe ?? value.ingredients ?? ""),
        preparation: String(value.preparation ?? value.method ?? value.steps ?? value.description ?? ""),
        note: String(value.note ?? value.productNote ?? ""),
        active: value.active !== false && String(value.active || "").toLowerCase() !== "false",
        order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0
      };
    }

    return {
      content: String(value ?? ""),
      preparation: "",
      note: "",
      active: true,
      order: 0
    };
  }

  function recipeContent(value) {
    return normalizeRecipeItem(value).content;
  }

  function recipePreparation(value) {
    return normalizeRecipeItem(value).preparation;
  }

  function normalizeState(raw) {
    const source = MENU_DESIGN_SCHEMA.normalizeMenuState(raw);
    const settings = MENU_DESIGN_SCHEMA.normalizeSettings(source.settings);
    settings.menuBackground = normalizeBackground(settings.menuBackground, settings);
    settings.fonts = normalizeFonts(settings.fonts);
    settings.typography = normalizeTypography(settings.typography);
    settings.bottomActions = normalizeBottomActions(settings.bottomActions);
    settings.banner = normalizeBanner(settings.banner);
    settings.menuOutput = normalizeMenuOutput(settings.menuOutput);

    const categories = Array.isArray(source.categories)
      ? source.categories.map((category, index) => normalizeCategory(category, index)).filter(Boolean)
      : [];

    return Object.assign({}, source, {
      settings,
      categories,
      pricing: source.pricing && typeof source.pricing === "object" ? cloneData(source.pricing) : null
    });
  }

  function normalizeCategory(category, index) {
    if (!category) return null;
    const source = MENU_DESIGN_SCHEMA.normalizeCategoryDesign(category, index);
    const id = source.id || makeId("cat", source.name || `Kategori ${index + 1}`);
    const style = normalizeStyle(source.style, {
      color: typeof source.color === "string" ? source.color : "",
      image: typeof source.image === "string" ? source.image : "",
      imageUrl: "",
      gradientStart: typeof source.color === "string" && source.color ? source.color : DEFAULT_SETTINGS.categoryCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 135,
      overlay: 0.12
    });

    return Object.assign({}, source, {
      id,
      name: source.name || "Kategori",
      active: source.active !== false,
      iconKey: normalizeCategoryIconKey(source.iconKey || source.icon, source.name),
      icon: CATEGORY_ICON_REGISTRY.getIconClass(normalizeCategoryIconKey(source.iconKey || source.icon, source.name)),
      color: typeof source.color === "string" ? source.color : style.color,
      image: typeof source.image === "string" ? source.image : (style.imageUrl || style.image || ""),
      style,
      products: Array.isArray(source.products)
        ? source.products.map((product, productIndex) => normalizeProduct(product, id, productIndex)).filter(Boolean)
        : []
    });
  }

  function normalizeCategoryIconKey(value, categoryName) {
    const key = String(value || "").trim();
    const allowed = CATEGORY_ICON_REGISTRY.options().some((item) => item.key === key);
    return allowed ? key : CATEGORY_ICON_REGISTRY.inferIconKey(categoryName);
  }

  function normalizeProduct(product, categoryId, index) {
    if (!product) return null;
    const source = MENU_DESIGN_SCHEMA.normalizeProductDesign(product, index);
    const prices = normalizePrices(source.prices || pricesFromLegacyProduct(source));
    const priceMode = normalizePriceMode(source, prices);
    const normalizedPrices = normalizePricesForMode(prices, priceMode);
    const style = normalizeStyle(source.style, {
      color: typeof source.cardColor === "string" ? source.cardColor : "",
      image: typeof source.image === "string" ? source.image : "",
      imageUrl: typeof source.imageUrl === "string" ? source.imageUrl : "",
      gradientStart: typeof source.cardColor === "string" && source.cardColor ? source.cardColor : DEFAULT_SETTINGS.productCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 145,
      overlay: Number.isFinite(Number(source.imageOverlay)) ? Number(source.imageOverlay) : 0
    });

    return Object.assign({}, source, {
      id: source.id || makeId(`${categoryId}-urun`, source.name || `Ürün ${index + 1}`),
      name: source.name || "Ürün",
      desc: source.desc || "",
      active: source.active !== false,
      stock: source.stock || (source.soldOut ? "sold-out" : "active"),
      image: typeof source.image === "string" ? source.image : String(source.img || ""),
      imageUrl: typeof source.imageUrl === "string" ? source.imageUrl : "",
      imageOverlay: Number.isFinite(Number(source.imageOverlay)) ? Number(source.imageOverlay) : style.overlay,
      cardColor: typeof source.cardColor === "string" ? source.cardColor : style.color,
      style,
      priceMode,
      prices: normalizedPrices,
      variants: normalizeVariants(source.variants, normalizedPrices, priceMode),
      pricing: source.pricing && typeof source.pricing === "object" ? cloneData(source.pricing) : null,
      popular: Boolean(source.popular),
      kind: source.kind || inferKind("", "", source.name || ""),
      temperature: source.temperature || inferTemperature("", "", source.name || ""),
      contentMode: ["recipe", "manual", "hidden", "not-required"].includes(source.contentMode) ? source.contentMode : "manual",
      recipeId: String(source.recipeId || ""),
      recipeSize: String(source.recipeSize || ""),
      manualContent: String(source.manualContent || source.details && source.details.ingredients || source.ingredients || ""),
      recipeLinkStatus: String(source.recipeLinkStatus || (source.recipeId ? "linked" : "unmatched")),
      order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
      details: Object.assign({}, source.details && typeof source.details === "object" ? source.details : {}, {
        calories: source.details && source.details.calories || source.calories || "",
        allergens: source.details && source.details.allergens || source.allergens || "",
        ingredients: source.details && source.details.ingredients || source.ingredients || ""
      })
    });
  }

  function normalizeBackground(bg, settings) {
    return MENU_DESIGN_SCHEMA.normalizeBackground(bg, settings || DEFAULT_SETTINGS);
  }

  function normalizeFonts(fonts) {
    return MENU_DESIGN_SCHEMA.normalizeFonts(fonts);
  }

  function normalizeTypography(typography) {
    return MENU_DESIGN_SCHEMA.normalizeTypography(typography);
  }

  function normalizeSiteSettings(siteSettings) {
    const source = siteSettings && typeof siteSettings === "object" ? siteSettings : {};
    if (Number(source.schemaVersion || 0) >= 2) return normalizeModernSiteSettings(cloneData(source));
    return migrateSiteSettings(Object.assign({}, DEFAULT_SITE_SETTINGS, source, {
      socialLinks: normalizeSocialLinks(source.socialLinks || DEFAULT_SITE_SETTINGS.socialLinks),
      titleSize: clamp(Number(source.titleSize || DEFAULT_SITE_SETTINGS.titleSize), 34, 92),
      bodySize: clamp(Number(source.bodySize || DEFAULT_SITE_SETTINGS.bodySize), 13, 22)
    }));
  }

  function normalizeModernSiteSettings(site) {
    const next = site && typeof site === "object" ? site : {};
    next.header = next.header && typeof next.header === "object" && !Array.isArray(next.header) ? next.header : {};
    if (next.header.visible === undefined) next.header.visible = true;
    if (next.header.contactVisible === undefined) next.header.contactVisible = true;
    next.header.navigation = normalizeHeaderNavigation(next.header.navigation);
    next.footer = next.footer && typeof next.footer === "object" && !Array.isArray(next.footer) ? next.footer : {};
    next.footer.quickLinks = Array.isArray(next.footer.quickLinks) ? next.footer.quickLinks : [];
    next.mudavim = next.mudavim && typeof next.mudavim === "object" && !Array.isArray(next.mudavim) ? next.mudavim : {};
    next.mudavim.announcements = normalizeMudavimAnnouncements(next.mudavim.announcements);
    return next;
  }

  function normalizeMudavimAnnouncements(value) {
    return (Array.isArray(value) ? value : []).map((item, itemIndex) => {
      const id = String(item && item.id || `announcement-${itemIndex + 1}`);
      const status = String(item && item.status || (item && item.isPublished === true ? "published" : "draft"));
      return {
        id,
        title: String(item && item.title || "Yeni Duyuru"),
        summary: String(item && item.summary || ""),
        slug: String(item && item.slug || slugifyMudavimAnnouncement(item && item.title || id)),
        order: Number.isFinite(Number(item && item.order)) ? Number(item.order) : itemIndex,
        status,
        publishedAt: String(item && item.publishedAt || ""),
        isPublished: status === "published" || item && item.isPublished === true,
        blocks: (Array.isArray(item && item.blocks) ? item.blocks : []).map((block, blockIndex) => {
          const allowedTypes = ["text", "image", "image-text", "text-image"];
          const type = allowedTypes.includes(block && block.type) ? block.type : (block && block.type === "image" ? "image" : "text");
          const hasText = type !== "image";
          const hasImage = type !== "text";
          const body = String(block && (block.body ?? block.content) || "");
          return {
            id: String(block && block.id || `${id}-block-${blockIndex + 1}`),
            type,
            badge: hasText ? String(block && block.badge || "") : "",
            date: hasText ? String(block && block.date || "") : "",
            heading: hasText ? String(block && block.heading || "") : "",
            body: hasText ? body : "",
            content: type === "text" ? body : "",
            imageUrl: hasImage ? String(block && block.imageUrl || "") : "",
            alt: hasImage ? String(block && block.alt || "") : "",
            order: Number.isFinite(Number(block && block.order)) ? Number(block.order) : blockIndex
          };
        }).sort((first, second) => first.order - second.order),
        createdAt: String(item && item.createdAt || ""),
        updatedAt: String(item && item.updatedAt || "")
      };
    }).sort((first, second) => first.order - second.order);
  }

  function slugifyMudavimAnnouncement(value) {
    return String(value || "duyuru")
      .toLocaleLowerCase("tr-TR")
      .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
      .replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "duyuru";
  }

  function normalizeHeaderNavigation(value) {
    const source = Array.isArray(value) && value.length ? value : DEFAULT_HEADER_NAVIGATION;
    return source.map((item, index) => {
      const fallback = DEFAULT_HEADER_NAVIGATION[index] || {};
      const label = normalizeLocalizedLabel(item && (item.label || item.text) || fallback.label);
      return {
        id: String(item && item.id || fallback.id || `nav-${index + 1}`),
        label,
        url: String(item && item.url || fallback.url || "#top"),
        icon: String(item && item.icon || fallback.icon || ""),
        visible: item && Object.prototype.hasOwnProperty.call(item, "visible") ? item.visible !== false : true,
        order: Number.isFinite(Number(item && item.order)) ? Number(item.order) : index
      };
    });
  }

  function normalizeLocalizedLabel(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { tr: String(value.tr || value.en || ""), en: String(value.en || value.tr || "") };
    }
    const text = String(value || "");
    return { tr: text, en: text };
  }

  function migrateSiteSettings(site) {
    if (site.designVersion === SITE_DESIGN_VERSION) return site;
    const legacy = {
      backgroundColor: "#F7FAF4",
      accentColor: "#365A2B",
      accentColorTwo: "#B87545",
      textColor: "#182315",
      mutedColor: "#63705D",
      surfaceColor: "#FFFFFF",
      titleFont: '"Playfair Display", Georgia, serif',
      titleSize: 62
    };
    const next = Object.assign({}, site);
    [
      "backgroundColor",
      "accentColor",
      "accentColorTwo",
      "textColor",
      "mutedColor",
      "surfaceColor"
    ].forEach((key) => {
      if (sameColor(next[key], legacy[key]) || sameColor(next[key], PREVIOUS_SITE_DESIGN[key]) || sameColor(next[key], GREEN_SITE_DESIGN[key])) {
        next[key] = DEFAULT_SITE_SETTINGS[key];
      }
    });
    [
      "backgroundSoftColor",
      "accentColorDeep",
      "brownColor",
      "lineColor",
      "shadowColor"
    ].forEach((key) => {
      if (!next[key]) next[key] = DEFAULT_SITE_SETTINGS[key];
    });
    if (String(next.titleFont || "").trim() === legacy.titleFont || String(next.titleFont || "").trim() === PREVIOUS_SITE_DESIGN.titleFont) {
      next.titleFont = DEFAULT_SITE_SETTINGS.titleFont;
    }
    if (String(next.bodyFont || "").trim() === PREVIOUS_SITE_DESIGN.bodyFont) {
      next.bodyFont = DEFAULT_SITE_SETTINGS.bodyFont;
    }
    if (String(next.heroImageUrl || "").trim() === PREVIOUS_SITE_DESIGN.heroImageUrl || String(next.heroImageUrl || "").trim() === GREEN_SITE_DESIGN.heroImageUrl) {
      next.heroImageUrl = DEFAULT_SITE_SETTINGS.heroImageUrl;
    }
    if (Number(next.titleSize) === legacy.titleSize) {
      next.titleSize = DEFAULT_SITE_SETTINGS.titleSize;
    }
    next.heroTitle = String(next.heroTitle || "").replace(/Tahmi[şs]çi/gi, "TAHMİSÇİ");
    next.storyText = String(next.storyText || "").replace(/Tahmi[şs]çi/gi, "TAHMİSÇİ");
    next.designVersion = SITE_DESIGN_VERSION;
    next.socialLinks = normalizeSocialLinks(next.socialLinks || []);
    return next;
  }

  function normalizeSocialLinks(links) {
    return Array.isArray(links)
      ? links.map((link) => ({
        label: String(link && link.label || "").trim(),
        url: String(link && link.url || "").trim(),
        icon: SITE_ICON_OPTIONS.some(([value]) => value === (link && link.icon)) ? link.icon : "web"
      })).filter((link) => link.label && link.url)
      : [];
  }

  function sameColor(value, expected) {
    return String(value || "").trim().toUpperCase() === expected;
  }

  function normalizeBottomActions(actions) {
    return MENU_DESIGN_SCHEMA.normalizeBottomActions(actions);
  }

  function normalizeBanner(banner) {
    return MENU_DESIGN_SCHEMA.normalizeBanner(banner);
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
    return {
      id: String(source.id || mediaIdFromRef(src) || "").trim(),
      src,
      name: String(source.name || defaultMediaName(src, index, kind)).trim(),
      type: String(source.type || "").trim(),
      size: Number(source.size || 0),
      kind: source.kind || kind
    };
  }

  function normalizeStyle(style, defaults) {
    return MENU_DESIGN_SCHEMA.normalizeStyle(style, defaults);
  }

  function ensureSelection() {
    if (!state.data.categories.length) {
      state.data.categories.push(makeCategory("Yeni Kategori"));
    }
    if (!state.selectedCategoryId || !state.data.categories.some((category) => category.id === state.selectedCategoryId)) {
      state.selectedCategoryId = state.data.categories[0].id;
    }
    const category = selectedCategory();
    if (category && (!state.selectedProductId || !category.products.some((product) => product.id === state.selectedProductId))) {
      if (state.activeSection === "product" && state.allowEmptyProductSelection) {
        state.selectedProductId = "";
        return;
      }
      state.selectedProductId = category.products[0] ? category.products[0].id : "";
    }
  }

  function ensureRecipeSelection() {
    if (!state.recipes || typeof state.recipes !== "object") {
      state.recipes = {};
    }
    const categories = recipeCategoryNames();
    if (!categories.length) {
      state.recipes["Yeni Reçete"] = {
        "14 oz Örnek İçecek": {
          "14 oz": {
            content: "Double shot espresso + soğuk süt + buz",
            preparation: "",
            note: ""
          }
        }
      };
    }

    if (!state.selectedRecipeCategory || !state.recipes[state.selectedRecipeCategory]) {
      state.selectedRecipeCategory = recipeCategoryNames()[0] || "";
    }

    const products = recipeProductNames(state.selectedRecipeCategory);
    if (!state.selectedRecipeProduct || !products.includes(state.selectedRecipeProduct)) {
      state.selectedRecipeProduct = products[0] || "";
    }
  }

  function renderAll() {
    ensureSelection();
    ensureRecipeSelection();
    renderStats();
    renderBulkPriceTools();
    renderStockPanel();
    renderLists();
    renderForms();
    renderRecipeEditor();
    renderStaffAccess();
    // PASIF_MUDAVIM_MODULU_BASLANGIC
    // PASIF MODUL renderMudavimPanel();
    // PASIF_MUDAVIM_MODULU_BITIS
    if (PANEL_MODULES.menuOutput) renderMenuOutput();
    renderDataImportCenter();
    renderPanelSettings();
    renderSections();
    renderFeedbackInbox();
    renderJson();
    if (window.TahmisciPricing && typeof window.TahmisciPricing.syncFromAdmin === "function") {
      window.TahmisciPricing.syncFromAdmin();
    }
    if (window.TahmisciLivePreview && typeof window.TahmisciLivePreview.notifyDraft === "function") {
      window.TahmisciLivePreview.notifyDraft();
    }
  }

  function renderSections() {
    const activeSection = normalizePanelSection(state.activeSection) || "overview";
    state.activeSection = activeSection;

    document.querySelectorAll("[data-section-panel]").forEach((section) => {
      section.hidden = section.dataset.sectionPanel !== activeSection;
    });

    if (els.contentGrid) els.contentGrid.hidden = ["overview", "bulkPrice", "dataCenter", "stock"].includes(activeSection);
    if (els.panelShell) els.panelShell.dataset.activeSection = activeSection;
    if (els.contentGrid) els.contentGrid.classList.add("is-wide");
    if (els.workspaceTitle) els.workspaceTitle.textContent = SECTION_TITLES[activeSection];
    const topbarDescription = document.querySelector(".topbar-description");
    if (topbarDescription) topbarDescription.textContent = SECTION_DESCRIPTIONS[activeSection] || "Dijital menünüzün görünümünü özelleştirin ve yayınlayın.";
    document.querySelectorAll("[data-panel-section]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.panelSection === activeSection);
    });

    if (window.TahmisciLivePreview && typeof window.TahmisciLivePreview.updateSection === "function") {
      const previewSection = activeSection === "staffAccess" && typeof window.__tahmisciWorkforcePreviewSection === "function"
        ? window.__tahmisciWorkforcePreviewSection()
        : activeSection;
      window.TahmisciLivePreview.updateSection(previewSection);
    }
  }

  function renderStats() {
    const categories = state.data.categories;
    const products = flatProducts();
    const activeProducts = products.filter(({ product, category }) => product.active && product.stock === "active" && category.active).length;
    const soldOut = products.filter(({ product }) => product.stock === "sold-out" || product.active === false).length;
    const popular = products.filter(({ product }) => product.popular).length;
    const recipeStats = countRecipes();
    const menuIsOpen = activeProducts > 0;
    const summaryCards = [
      { label: "Toplam Kategori", value: categories.length, icon: "categories" },
      { label: "Toplam Ürün", value: products.length, icon: "products" },
      { label: "Aktif Ürün", value: activeProducts, icon: "active" },
      { label: "Reçete Ürünü", value: recipeStats.products, icon: "recipe" },
      { label: "Canlı Menü", value: menuIsOpen ? "Açık" : "Kapalı", icon: "live", status: menuIsOpen },
      { label: "Gizli / Tükendi", value: soldOut, icon: "hidden", secondary: true },
      { label: "Popüler", value: popular, icon: "popular", secondary: true }
    ];
    const distribution = overviewCategoryDistribution(categories, products.length);
    const conicGradient = distribution.length
      ? `conic-gradient(${distribution.map((item) => `${item.color} ${item.start.toFixed(2)}% ${item.end.toFixed(2)}%`).join(", ")})`
      : "conic-gradient(#e7d8ca 0 100%)";
    const updateDate = state.data.settings.menuUpdateDate || state.site.updatedAt || new Date().toISOString();
    const updates = [
      { icon: "menu", title: "Menü verisi güncel", meta: `${formatOverviewNumber(products.length)} ürün · ${formatOverviewTime(updateDate)}` },
      { icon: "categories", title: "Kategoriler hazır", meta: `${formatOverviewNumber(categories.length)} aktif yapı` },
      { icon: "recipe", title: "Reçeteler eşitlendi", meta: `${formatOverviewNumber(recipeStats.products)} reçete ürünü` },
      { icon: "active", title: "Müdavim özeti hazır", meta: `${formatOverviewNumber(MUDAVIM_CUSTOMERS.length)} kayıt` }
    ];
    const trend = overviewVisitTrend();
    const totalMudavimVisits = MUDAVIM_CUSTOMERS.reduce((sum, customer) => sum + Number(customer.totalVisits || 0), 0);

    els.overviewGrid.innerHTML = `
      <div class="overview-dashboard">
        <div class="overview-summary-grid" aria-label="Menü özeti">
          ${summaryCards.map((card) => `
            <article class="overview-summary-card${card.secondary ? " is-secondary" : ""}">
              <span class="overview-icon">${overviewIcon(card.icon)}</span>
              <div>
                <span>${escapeHTML(card.label)}</span>
                <strong>${typeof card.value === "number" ? formatOverviewNumber(card.value) : escapeHTML(card.value)}</strong>
              </div>
              ${Object.hasOwn(card, "status") ? `<i class="overview-status-dot${card.status ? " is-open" : ""}" aria-label="${card.status ? "Menü yayında" : "Menü kapalı"}"></i>` : ""}
            </article>
          `).join("")}
        </div>

        <div class="overview-main-grid">
          <article class="overview-panel overview-distribution-panel">
            <header><h3>Kategorilere Göre Ürün Dağılımı</h3></header>
            <div class="overview-distribution-content">
              <div class="overview-donut" style="background:${conicGradient}" role="img" aria-label="Toplam ${formatOverviewNumber(products.length)} ürünün kategori dağılımı">
                <div><strong>${formatOverviewNumber(products.length)}</strong><span>Toplam</span></div>
              </div>
              <ul class="overview-legend">
                ${distribution.map((item) => `
                  <li><i style="--legend-color:${item.color}"></i><span>${escapeHTML(item.label)}</span><strong>${Math.round(item.percent)}%</strong></li>
                `).join("") || `<li><span>Henüz ürün yok</span><strong>0%</strong></li>`}
              </ul>
            </div>
          </article>

          <article class="overview-panel overview-updates-panel">
            <header><h3>Son Güncellemeler</h3></header>
            <div class="overview-update-list">
              ${updates.map((item) => `
                <div class="overview-update-row">
                  <span class="overview-icon is-small">${overviewIcon(item.icon)}</span>
                  <div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.meta)}</small></div>
                </div>
              `).join("")}
            </div>
            <button class="overview-list-action" type="button" data-overview-section="menu">Menüyü Yönet</button>
          </article>

          <article class="overview-panel overview-shortcuts-panel">
            <header><h3>Kısa Yollar</h3></header>
            <div class="overview-shortcut-list">
              <button type="button" data-overview-section="menu"><span>${overviewIcon("menu")}</span><strong>Menü Düzenle</strong><i>›</i></button>
              <button type="button" data-overview-section="product"><span>${overviewIcon("products")}</span><strong>Ürün Ekle</strong><i>›</i></button>
              <button type="button" data-overview-section="banner"><span>${overviewIcon("banner")}</span><strong>Banner Ekle</strong><i>›</i></button>
              <button type="button" data-overview-section="recipe"><span>${overviewIcon("recipe")}</span><strong>Reçete Yönetimi</strong><i>›</i></button>
              <!-- PASIF_SITE_MODULU_BASLANGIC: Site Önizleme bağlantısı geçici olarak pasif. PASIF_SITE_MODULU_BITIS -->
            </div>
          </article>
        </div>

        <div class="overview-bottom-grid">
          <article class="overview-panel overview-trend-panel">
            <header><div><h3>Ziyaretçi Trendi</h3><small>Müdavim ziyaret kayıtlarının son 7 günü</small></div><strong>${formatOverviewNumber(trend.total)} ziyaret</strong></header>
            <div class="overview-chart-wrap">
              <svg class="overview-trend-chart" viewBox="0 0 700 190" role="img" aria-label="Son yedi günlük ziyaretçi trendi">
                <defs><linearGradient id="overviewTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b7773d" stop-opacity=".35"/><stop offset="1" stop-color="#b7773d" stop-opacity=".02"/></linearGradient></defs>
                <path class="overview-chart-grid" d="M28 45H672M28 95H672M28 145H672"/>
                <polygon class="overview-chart-area" points="${trend.area}"/>
                <polyline class="overview-chart-line" points="${trend.points}"/>
                ${trend.coordinates.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4"/>`).join("")}
                ${trend.labels.map((label, index) => `<text x="${trend.coordinates[index].x}" y="177" text-anchor="middle">${escapeHTML(label)}</text>`).join("")}
              </svg>
            </div>
          </article>

          <!-- PASIF_MUDAVIM_MODULU_BASLANGIC
          <article class="overview-panel overview-members-panel">
            <header><h3>Müdavim Özeti</h3><button type="button" data-overview-section="mudavim">Tümünü Gör</button></header>
            <div class="overview-member-metrics">
              <div><span>Toplam Müdavim</span><strong>${formatOverviewNumber(MUDAVIM_CUSTOMERS.length)}</strong><small>Kayıtlı üye</small></div>
              <div><span>Son 7 Gün</span><strong>${formatOverviewNumber(trend.total)}</strong><small>Ziyaret kaydı</small></div>
              <div><span>Toplam Ziyaret</span><strong>${formatOverviewNumber(totalMudavimVisits)}</strong><small>Tüm zamanlar</small></div>
            </div>
          </article>
          PASIF_MUDAVIM_MODULU_BITIS -->
        </div>
      </div>
    `;
    if (els.miniStats) {
      const miniStats = [
        ["Kategori", categories.length],
        ["Ürün", products.length],
        ["Aktif", activeProducts],
        ["Gizli/Tükendi", soldOut]
      ];
      els.miniStats.innerHTML = miniStats.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${formatOverviewNumber(value)}</strong></article>`).join("");
    }
  }

  function overviewIcon(name) {
    const paths = {
      categories: `<path d="M3.5 7.5h17v12h-17z"/><path d="M3.5 7.5 6 4.5h5l2 3"/>`,
      products: `<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>`,
      active: `<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>`,
      recipe: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>`,
      live: `<path d="M6 8h10a4 4 0 0 1 0 8H6zM8 5v3M13 4v4M7 19h10"/>`,
      hidden: `<path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.8 5.2A10.7 10.7 0 0 1 21 12a12 12 0 0 1-3.2 4.2M6.2 7.1A12 12 0 0 0 3 12a10.8 10.8 0 0 0 6.2 5.8"/>`,
      popular: `<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9z"/>`,
      menu: `<path d="M7 6h14M7 12h14M7 18h14"/><circle cx="3.5" cy="6" r=".7"/><circle cx="3.5" cy="12" r=".7"/><circle cx="3.5" cy="18" r=".7"/>`,
      banner: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m6 16 4-4 3 3 2-2 3 3"/>`
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.active}</svg>`;
  }

  function overviewCategoryDistribution(categories, totalProducts) {
    const colors = ["#4a2c1d", "#75462d", "#a96f45", "#c99b78", "#dec4ad"];
    const sorted = categories.map((category) => ({
      label: category.name,
      count: Array.isArray(category.products) ? category.products.length : 0
    })).sort((a, b) => b.count - a.count);
    const visible = sorted.slice(0, 4);
    const otherCount = sorted.slice(4).reduce((sum, item) => sum + item.count, 0);
    if (otherCount) visible.push({ label: "Diğer", count: otherCount });
    let cursor = 0;
    return visible.filter((item) => item.count > 0).map((item, index) => {
      const percent = totalProducts ? (item.count / totalProducts) * 100 : 0;
      const start = cursor;
      cursor += percent;
      return { ...item, percent, start, end: cursor, color: colors[index % colors.length] };
    });
  }

  function overviewVisitTrend() {
    const visits = MUDAVIM_CUSTOMERS.flatMap((customer) => Array.isArray(customer.visits) ? customer.visits : []);
    const timestamps = visits.map((visit) => Date.parse(`${visit.date}T12:00:00`)).filter(Number.isFinite);
    const latest = timestamps.length ? new Date(Math.max(...timestamps)) : new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(latest);
      date.setDate(latest.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return {
        key,
        label: new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" }).format(date),
        value: visits.filter((visit) => visit.date === key).length
      };
    });
    const maxValue = Math.max(1, ...days.map((day) => day.value));
    const coordinates = days.map((day, index) => ({
      x: Number((28 + index * (644 / 6)).toFixed(2)),
      y: Number((145 - (day.value / maxValue) * 100).toFixed(2))
    }));
    const points = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
    return {
      points,
      area: `28,145 ${points} 672,145`,
      coordinates,
      labels: days.map((day) => day.label),
      total: days.reduce((sum, day) => sum + day.value, 0)
    };
  }

  function formatOverviewNumber(value) {
    return new Intl.NumberFormat("tr-TR").format(Number(value) || 0);
  }

  function formatOverviewTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Şimdi";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function renderBulkPriceTools() {
    if (window.TahmisciPricing && typeof window.TahmisciPricing.renderBulk === "function") {
      window.TahmisciPricing.renderBulk();
    }
  }

  function bindStockEvents() {
    if (els.stockEditorCategorySelect) els.stockEditorCategorySelect.addEventListener("change", () => {
      state.stockEditorCategoryId = els.stockEditorCategorySelect.value;
      state.stockEditorProductId = "";
      renderStockEditor();
    });
    if (els.stockEditorProductSelect) els.stockEditorProductSelect.addEventListener("change", () => {
      state.stockEditorProductId = els.stockEditorProductSelect.value;
      renderStockEditor();
    });
    if (els.stockAddCategoryButton) els.stockAddCategoryButton.addEventListener("click", addStockCategory);
    if (els.stockAddProductButton) els.stockAddProductButton.addEventListener("click", addStockProduct);
    if (els.stockAddSupplierButton) els.stockAddSupplierButton.addEventListener("click", addStockSupplier);
    if (els.stockEditorIncreaseButton) els.stockEditorIncreaseButton.addEventListener("click", () => {
      const product = selectedStockEditorProduct();
      if (product) openStockActionModal(product.id, "stock_in");
    });
    if (els.stockEditorDecreaseButton) els.stockEditorDecreaseButton.addEventListener("click", () => {
      const product = selectedStockEditorProduct();
      if (product) openStockActionModal(product.id, "stock_out");
    });
    if (els.stockDeleteProductButton) els.stockDeleteProductButton.addEventListener("click", deleteStockEditorProduct);
    if (els.stockDeleteCategoryButton) els.stockDeleteCategoryButton.addEventListener("click", deleteStockEditorCategory);
    ["stockEditorProductName", "stockEditorCategoryName", "stockEditorQuantity", "stockEditorThreshold",
      "stockEditorCriticalThreshold", "stockEditorUnit", "stockEditorSupplier", "stockEditorActive", "stockEditorNote"]
      .forEach((id) => {
        if (!els[id]) return;
        els[id].addEventListener("change", updateStockEditorFromFields);
      });
    if (els.stockSaveButton) els.stockSaveButton.addEventListener("click", () => saveStockToBackend());
    if (els.stockSearch) els.stockSearch.addEventListener("input", () => {
      state.stockQuery = els.stockSearch.value.trim();
      renderStockPanel();
    });
    if (els.stockCategoryFilter) els.stockCategoryFilter.addEventListener("change", () => {
      state.stockCategory = els.stockCategoryFilter.value || "all";
      renderStockPanel();
    });
    if (els.stockOnlyOrderNeeded) els.stockOnlyOrderNeeded.addEventListener("change", () => {
      state.stockOnlyOrderNeeded = els.stockOnlyOrderNeeded.checked;
      renderStockPanel();
    });
    if (els.stockCategoryChips) els.stockCategoryChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stock-category]");
      if (!button) return;
      state.stockCategory = button.dataset.stockCategory || "all";
      renderStockPanel();
    });
    if (els.stockProductList) els.stockProductList.addEventListener("click", handleStockProductClick);
    if (els.stockOrderSuggestions) els.stockOrderSuggestions.addEventListener("click", handleStockSuggestionClick);
    if (els.stockActionForm) els.stockActionForm.addEventListener("submit", submitStockAction);
    if (els.stockActionModal) {
      els.stockActionModal.addEventListener("click", (event) => {
        if (event.target === els.stockActionModal || event.target.closest("[data-stock-close]")) closeStockActionModal();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.stockActionModal && !els.stockActionModal.hidden) closeStockActionModal();
    });
  }

  function loadStockData() {
    return normalizeStockStateForAdmin(null);
  }

  async function hydrateStockFromBackend() {
    if (!backendBaseUrl()) return;
    try {
      const result = await backendRequest("/api/stock");
      state.stock = normalizeStockStateForAdmin(result.stockState);
      state.stockUpdatedAt = result.updatedAt || state.stock.updatedAt || "";
      safeLocalSet(STOCK_STORAGE_KEY, JSON.stringify(state.stock));
      renderStockPanel();
      updateSaveControls("Stok güncel");
      window.clearTimeout(hydrateStockFromBackend.timer);
      hydrateStockFromBackend.timer = window.setTimeout(updateSaveControls, 1200);
    } catch (error) {
      console.warn("Stok verisi alınamadı:", error);
      renderStockPanel();
    }
  }

  async function saveStockToBackend(options) {
    const silent = Boolean(options && options.silent);
    state.stock = normalizeStockStateForAdmin(state.stock);
    if (!backendBaseUrl()) {
      throw new Error("Stok değişikliklerini kaydetmek için backend bağlantısı gerekli.");
    }
    const result = await backendRequest("/api/admin/stock", {
      method: "PUT",
      body: { stockState: state.stock }
    });
    syncPublishRevision(result);
    state.stock = normalizeStockStateForAdmin(result.stockState);
    state.stockUpdatedAt = result.updatedAt || state.stockUpdatedAt;
    state.dirtyStock = false;
    safeLocalSet(STOCK_STORAGE_KEY, JSON.stringify(state.stock));
    renderStockPanel();
    if (!silent) {
      updateSaveControls("Stok kaydedildi");
      window.setTimeout(updateSaveControls, 1200);
    }
  }

  function renderStockPanel() {
    if (!els.stockProductList) return;
    state.stock = normalizeStockStateForAdmin(state.stock);
    renderStockEditor();
    renderStockSummary();
    renderStockCategoryFilter();
    renderStockProducts();
    renderStockMovements();
    renderStockOrderSuggestions();
  }

  function selectedStockEditorCategory() {
    return state.stock && Array.isArray(state.stock.categories)
      ? state.stock.categories.find((category) => category.id === state.stockEditorCategoryId) || null
      : null;
  }

  function selectedStockEditorProduct() {
    return state.stock && Array.isArray(state.stock.products)
      ? state.stock.products.find((product) => product.id === state.stockEditorProductId) || null
      : null;
  }

  function renderStockEditor() {
    if (!els.stockEditorCategorySelect || !els.stockEditorProductSelect) return;
    const categories = stockCategories();
    if (!categories.some((category) => category.id === state.stockEditorCategoryId)) {
      state.stockEditorCategoryId = categories[0] ? categories[0].id : "";
    }
    const products = stockProducts().filter((product) => product.categoryId === state.stockEditorCategoryId);
    if (!products.some((product) => product.id === state.stockEditorProductId)) {
      state.stockEditorProductId = products[0] ? products[0].id : "";
    }
    els.stockEditorCategorySelect.innerHTML = categories.length
      ? categories.map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>`).join("")
      : `<option value="">Kategori yok</option>`;
    els.stockEditorCategorySelect.value = state.stockEditorCategoryId;
    els.stockEditorProductSelect.innerHTML = products.length
      ? products.map((product) => `<option value="${escapeAttribute(product.id)}">${escapeHTML(product.name)}</option>`).join("")
      : `<option value="">Bu kategoride ürün yok</option>`;
    els.stockEditorProductSelect.value = state.stockEditorProductId;

    const category = selectedStockEditorCategory();
    const product = selectedStockEditorProduct();
    els.stockEditorCategoryName.value = category ? category.name : "";
    els.stockEditorProductName.value = product ? product.name : "";
    els.stockEditorQuantity.value = product ? stockDisplayValue(product, "stockQuantity") : "";
    els.stockEditorThreshold.value = product ? stockDisplayValue(product, "orderThreshold") : "";
    els.stockEditorCriticalThreshold.value = product ? formatStockNumber(product.criticalThreshold || 0) : "";
    els.stockEditorUnit.value = product ? product.unit || "" : "";
    els.stockEditorSupplier.value = product ? product.supplier || "" : "";
    els.stockEditorNote.value = product ? product.note || "" : "";
    els.stockEditorActive.checked = Boolean(product && product.active !== false);

    const productFields = [els.stockEditorProductName, els.stockEditorQuantity, els.stockEditorThreshold,
      els.stockEditorCriticalThreshold, els.stockEditorUnit, els.stockEditorSupplier, els.stockEditorActive, els.stockEditorNote];
    productFields.forEach((field) => { if (field) field.disabled = !product; });
    if (els.stockEditorCategoryName) els.stockEditorCategoryName.disabled = !category;
    if (els.stockAddProductButton) els.stockAddProductButton.disabled = !category;
    if (els.stockAddSupplierButton) els.stockAddSupplierButton.disabled = !product;
    if (els.stockEditorIncreaseButton) els.stockEditorIncreaseButton.disabled = !product;
    if (els.stockEditorDecreaseButton) els.stockEditorDecreaseButton.disabled = !product;
    if (els.stockDeleteProductButton) els.stockDeleteProductButton.disabled = !product;
    if (els.stockDeleteCategoryButton) els.stockDeleteCategoryButton.disabled = !category;
    if (els.stockEditorStatus) {
      const status = product ? stockProductStatus(product) : { key: "check", label: "Ürün seçilmedi" };
      els.stockEditorStatus.className = `stock-badge is-${status.key}`;
      els.stockEditorStatus.textContent = status.label;
    }
  }

  function addStockCategory() {
    const name = String(window.prompt("Yeni stok kategorisinin adı", "Yeni Kategori") || "").trim();
    if (!name) return;
    const duplicate = stockCategories().find((category) => normalizeText(category.name) === normalizeText(name));
    if (duplicate) {
      state.stockEditorCategoryId = duplicate.id;
      state.stockEditorProductId = "";
      renderStockEditor();
      return;
    }
    const category = { id: `${makeId("stock-category", name)}-${Date.now()}`, name, order: state.stock.categories.length, active: true };
    state.stock.categories.push(category);
    state.stockEditorCategoryId = category.id;
    state.stockEditorProductId = "";
    markDirty("stock", "Yeni stok kategorisi eklendi");
    renderStockPanel();
  }

  function addStockProduct() {
    const category = selectedStockEditorCategory();
    if (!category) return;
    const name = String(window.prompt("Yeni stok ürününün adı", "Yeni Stok Ürünü") || "").trim();
    if (!name) return;
    const product = {
      id: `${makeId("stock-product", name)}-${Date.now()}`,
      categoryId: category.id,
      name,
      supplier: "",
      unit: "adet",
      stockQuantity: 0,
      stockQuantityText: "0",
      orderThreshold: 0,
      orderThresholdText: "0",
      criticalThreshold: 0,
      imageUrl: "",
      note: "",
      active: true,
      order: state.stock.products.length,
      updatedAt: new Date().toISOString()
    };
    state.stock.products.push(product);
    state.stockEditorProductId = product.id;
    markDirty("stock", "Yeni stok ürünü eklendi");
    renderStockPanel();
  }

  function addStockSupplier() {
    const product = selectedStockEditorProduct();
    if (!product) return;
    const supplier = String(window.prompt("Tedarikçi adı", product.supplier || "") || "").trim();
    if (!supplier) return;
    product.supplier = supplier;
    product.updatedAt = new Date().toISOString();
    markDirty("stock", "Tedarikçi güncellendi");
    renderStockPanel();
  }

  function deleteStockEditorProduct() {
    const product = selectedStockEditorProduct();
    if (!product || !window.confirm(`"${product.name}" stok ürününü silmek istiyor musunuz?`)) return;
    state.stock.products = state.stock.products.filter((item) => item.id !== product.id);
    state.stockEditorProductId = "";
    markDirty("stock", "Stok ürünü silindi");
    renderStockPanel();
  }

  function deleteStockEditorCategory() {
    const category = selectedStockEditorCategory();
    if (!category) return;
    const count = stockProducts().filter((product) => product.categoryId === category.id).length;
    const message = count
      ? `"${category.name}" kategorisi ve içindeki ${count} stok ürünü silinecek. Devam edilsin mi?`
      : `"${category.name}" kategorisini silmek istiyor musunuz?`;
    if (!window.confirm(message)) return;
    state.stock.categories = state.stock.categories.filter((item) => item.id !== category.id);
    state.stock.products = state.stock.products.filter((item) => item.categoryId !== category.id);
    state.stockEditorCategoryId = "";
    state.stockEditorProductId = "";
    markDirty("stock", "Stok kategorisi silindi");
    renderStockPanel();
  }

  function updateStockEditorFromFields() {
    const category = selectedStockEditorCategory();
    const product = selectedStockEditorProduct();
    if (category && els.stockEditorCategoryName) category.name = els.stockEditorCategoryName.value.trim() || category.name;
    if (product) {
      product.name = els.stockEditorProductName.value.trim() || product.name;
      product.stockQuantityText = els.stockEditorQuantity.value.trim();
      product.orderThresholdText = els.stockEditorThreshold.value.trim();
      const quantity = stockNumberOrNull(product.stockQuantityText);
      const threshold = stockNumberOrNull(product.orderThresholdText);
      if (quantity !== null) product.stockQuantity = quantity;
      if (threshold !== null) product.orderThreshold = threshold;
      product.criticalThreshold = stockNumber(els.stockEditorCriticalThreshold.value);
      product.unit = els.stockEditorUnit.value.trim() || "adet";
      product.supplier = els.stockEditorSupplier.value.trim();
      product.note = els.stockEditorNote.value.trim();
      product.active = els.stockEditorActive.checked;
      product.updatedAt = new Date().toISOString();
    }
    markDirty("stock", "Stok düzenlemesi kaydedilmeyi bekliyor");
    renderStockPanel();
  }

  function renderStockSummary() {
    if (!els.stockSummaryGrid) return;
    const products = stockProducts();
    const outOfStock = products.filter((product) => stockProductStatus(product).key === "out").length;
    const criticalStock = products.filter((product) => {
      const quantity = stockNumber(product.stockQuantity);
      const threshold = stockNumber(product.orderThreshold);
      return quantity > 0 && threshold > 0 && quantity <= threshold;
    }).length;
    const approachingThreshold = products.filter((product) => {
      const quantity = stockNumber(product.stockQuantity);
      const threshold = stockNumber(product.orderThreshold);
      return threshold > 0 && quantity > threshold && quantity <= threshold * 1.25;
    }).length;
    const cards = [
      ["Toplam Ürün", products.length, "Tüm kategoriler"],
      ["Kritik Stok", criticalStock, "Acil aksiyon gerekli"],
      ["Sipariş Eşiğine Yaklaşan", approachingThreshold, "Yakın takipte"],
      ["Tükendi", outOfStock, "Stok bulunmuyor"]
    ];
    els.stockSummaryGrid.innerHTML = cards.map(([label, value, text]) => `
      <article class="stock-summary-card">
        <span class="stock-summary-icon" aria-hidden="true"></span>
        <div><p>${escapeHTML(label)}</p><strong>${escapeHTML(value)}</strong><small>${escapeHTML(text)}</small></div>
      </article>
    `).join("");
  }

  function renderStockCategoryFilter() {
    if (!els.stockCategoryFilter) return;
    const current = state.stockCategory || els.stockCategoryFilter.value || "all";
    els.stockCategoryFilter.innerHTML = [
      `<option value="all">Tüm kategoriler</option>`,
      ...stockCategories().map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>`)
    ].join("");
    els.stockCategoryFilter.value = current === "all" || stockCategories().some((category) => category.id === current) ? current : "all";
    state.stockCategory = els.stockCategoryFilter.value;
    if (els.stockCategoryChips) {
      const items = [{ id: "all", name: "Tümü" }, ...stockCategories()];
      els.stockCategoryChips.innerHTML = items.map((category) => `
        <button type="button" data-stock-category="${escapeAttribute(category.id)}" class="${state.stockCategory === category.id ? "is-active" : ""}">
          ${escapeHTML(category.name)}
        </button>
      `).join("");
    }
    if (els.stockOnlyOrderNeeded) els.stockOnlyOrderNeeded.checked = Boolean(state.stockOnlyOrderNeeded);
  }

  function renderStockProducts() {
    const categories = stockCategoryMap();
    const products = filteredStockProducts();
    if (!products.length) {
      els.stockProductList.innerHTML = `<div class="stock-empty">Stok ürünü bulunamadı. Yeni katalog aktarımı için Excel Veri Merkezi'ni kullanın.</div>`;
      return;
    }
    els.stockProductList.innerHTML = `
      <div class="stock-table" role="table" aria-label="Stok ürünleri">
        <div class="stock-row stock-row-head" role="row">
          <span>Ürün Adı</span><span>Kategori</span><span>Ürün Adedi</span><span>Sipariş Eşiği</span><span>Durum</span><span>İşlemler</span>
        </div>
        ${products.map((product) => {
          const category = categories.get(product.categoryId);
          const status = stockProductStatus(product);
          const selected = state.selectedStockProductId === product.id;
          const productMovements = stockMovements().filter((movement) => movement.productId === product.id).slice(0, 5);
          return `
            <div class="stock-row${selected ? " is-selected" : ""}" role="row" data-stock-product-id="${escapeAttribute(product.id)}">
              <strong>${escapeHTML(product.name)}</strong>
              <span>${escapeHTML(category ? category.name : "Genel")}</span>
              <span><input class="stock-inline-input" data-stock-field="stockQuantityText" value="${escapeAttribute(stockDisplayValue(product, "stockQuantity"))}" aria-label="${escapeAttribute(product.name)} ürün adedi"></span>
              <span><input class="stock-inline-input" data-stock-field="orderThresholdText" value="${escapeAttribute(stockDisplayValue(product, "orderThreshold"))}" aria-label="${escapeAttribute(product.name)} sipariş eşiği"></span>
              <span><em class="stock-badge is-${status.key}">${escapeHTML(status.label)}</em></span>
              <span class="stock-row-actions">
                <button type="button" class="stock-edit-action ui-button ui-button--secondary ui-button--icon" data-stock-action="save-inline" aria-label="${escapeAttribute(product.name)} stok değerlerini kaydet">✎</button>
                <details class="stock-actions-menu">
                  <summary aria-label="${escapeAttribute(product.name)} diğer işlemler">•••</summary>
                  <div>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" data-stock-action="stock_in">Stok Ekle</button>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" data-stock-action="stock_out">Eksilt</button>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" data-stock-action="waste">Sarf</button>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" data-stock-action="detail">Detay</button>
                    <button type="button" class="is-danger ui-button ui-button--danger ui-button--sm" data-stock-action="delete">Sil</button>
                  </div>
                </details>
              </span>
            </div>
            ${selected ? `<div class="stock-detail-row">${renderStockProductDetail(product, productMovements)}</div>` : ""}
          `;
        }).join("")}
      </div>
    `;
  }

  function renderStockProductDetail(product, movements) {
    return `
      <div class="stock-detail-card">
        <div><strong>${escapeHTML(product.name)}</strong><p>${escapeHTML(product.note || "Not eklenmedi.")}</p></div>
        <div class="stock-detail-movements">
          ${movements.length ? movements.map((movement) => `
            <span>${escapeHTML(stockMovementTypeText(movement.type))} · ${escapeHTML(formatStockNumber(movement.quantity))} ${escapeHTML(movement.unit || product.unit || "adet")} · ${escapeHTML(formatStockDate(movement.createdAt))}</span>
          `).join("") : `<span>Henüz hareket yok.</span>`}
        </div>
      </div>
    `;
  }

  function renderStockMovements() {
    if (!els.stockMovementList) return;
    const movements = stockMovements().slice(0, 40);
    els.stockMovementList.innerHTML = movements.length
      ? movements.map((movement) => `
        <article class="stock-movement-item">
          <strong>${escapeHTML(movement.productName || "Stok ürünü")}</strong>
          <span>${escapeHTML(stockMovementTypeText(movement.type))} · ${escapeHTML(formatStockNumber(movement.quantity))} ${escapeHTML(movement.unit || "")}</span>
          <time>${escapeHTML(formatStockDate(movement.createdAt))}</time>
        </article>
      `).join("")
      : `<div class="stock-empty">Henüz stok hareketi yok.</div>`;
  }

  function renderStockOrderSuggestions() {
    if (!els.stockOrderSuggestions) return;
    const suggestions = stockOrderSuggestions();
    if (els.stockSuggestionCount) els.stockSuggestionCount.textContent = String(suggestions.length);
    els.stockOrderSuggestions.innerHTML = suggestions.length
      ? suggestions.map((product) => {
        const status = stockProductStatus(product);
        const suggested = Math.max(0, stockNumber(product.orderThreshold) - stockNumber(product.stockQuantity));
        return `
          <button class="stock-suggestion" type="button" data-stock-suggestion="${escapeAttribute(product.id)}">
            <strong>${escapeHTML(product.name)}</strong>
            <span>Önerilen: ${escapeHTML(formatStockNumber(suggested))} ${escapeHTML(product.unit || "adet")}</span>
            <em class="stock-badge is-${status.key}">${escapeHTML(status.label)}</em>
          </button>
        `;
      }).join("")
      : `<div class="stock-empty">Sipariş önerisi yok.</div>`;
  }

  async function handleStockProductClick(event) {
    const actionButton = event.target.closest("[data-stock-action]");
    const row = event.target.closest("[data-stock-product-id]");
    if (!actionButton || !row) return;
    const productId = row.dataset.stockProductId;
    const action = actionButton.dataset.stockAction;
    const product = state.stock.products.find((item) => item.id === productId);
    if (!product) return;
    if (action === "save-inline") {
      const quantityText = String(row.querySelector('[data-stock-field="stockQuantityText"]')?.value || "").trim();
      const thresholdText = String(row.querySelector('[data-stock-field="orderThresholdText"]')?.value || "").trim();
      product.stockQuantityText = quantityText;
      product.orderThresholdText = thresholdText;
      const quantity = stockNumberOrNull(quantityText);
      const threshold = stockNumberOrNull(thresholdText);
      if (quantity !== null) product.stockQuantity = quantity;
      if (threshold !== null) product.orderThreshold = threshold;
      product.updatedAt = new Date().toISOString();
      state.dirtyStock = true;
      try {
        await saveStockToBackend();
      } catch (error) {
        updateSaveControls(error.message || "Stok ürünü kaydedilemedi");
      }
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`"${product.name}" stok kaydını silmek istediğinize emin misiniz?`)) return;
      state.stock.products = state.stock.products.filter((item) => item.id !== productId);
      state.dirtyStock = true;
      try {
        await saveStockToBackend();
      } catch (error) {
        updateSaveControls(error.message || "Stok ürünü silinemedi");
      }
      return;
    }
    if (action === "detail") {
      state.selectedStockProductId = state.selectedStockProductId === productId ? "" : productId;
      renderStockPanel();
      return;
    }
    openStockActionModal(productId, action);
  }

  function handleStockSuggestionClick(event) {
    const item = event.target.closest("[data-stock-suggestion]");
    if (!item) return;
    state.selectedStockProductId = item.dataset.stockSuggestion;
    renderStockPanel();
    const row = els.stockProductList && els.stockProductList.querySelector(`[data-stock-product-id="${CSS.escape(state.selectedStockProductId)}"]`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openStockActionModal(productId, action) {
    const product = stockProducts().find((item) => item.id === productId);
    if (!product || !els.stockActionModal) return;
    state.stockAction = { productId, productCode: String(product.productCode || ""), type: action };
    const label = stockMovementTypeText(action);
    if (els.stockActionKicker) els.stockActionKicker.textContent = label;
    if (els.stockActionTitle) els.stockActionTitle.textContent = label;
    if (els.stockActionProduct) els.stockActionProduct.textContent = `${product.name} · Mevcut stok: ${formatStockNumber(product.stockQuantity)} ${product.unit || "adet"}`;
    if (els.stockActionQuantity) els.stockActionQuantity.value = "";
    if (els.stockActionReason) els.stockActionReason.value = label;
    if (els.stockActionNote) els.stockActionNote.value = "";
    if (els.stockActionMessage) els.stockActionMessage.textContent = "";
    els.stockActionModal.hidden = false;
    syncAdminModalLock();
    window.setTimeout(() => els.stockActionQuantity && els.stockActionQuantity.focus(), 40);
  }

  function closeStockActionModal() {
    state.stockAction = null;
    if (els.stockActionModal) els.stockActionModal.hidden = true;
    syncAdminModalLock();
  }

  function syncAdminModalLock() {
    const modalOpen = [els.stockActionModal, els.defaultChoiceModal]
      .some((modal) => modal && !modal.hidden);
    document.documentElement.classList.toggle("is-panel-modal-open", modalOpen);
  }

  async function submitStockAction(event) {
    event.preventDefault();
    if (!state.stockAction || state.stockActionSubmitting) return;
    const movement = {
      productId: state.stockAction.productId,
      productCode: state.stockAction.productCode || "",
      stockProductCode: state.stockAction.productCode || "",
      type: state.stockAction.type,
      quantity: Number(els.stockActionQuantity && els.stockActionQuantity.value || 0),
      reason: els.stockActionReason ? els.stockActionReason.value.trim() : "",
      note: els.stockActionNote ? els.stockActionNote.value.trim() : ""
    };
    const operationKey = `stock-movement:${movement.productId}:${movement.type}`;
    const submitButton = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    if (els.stockActionMessage) els.stockActionMessage.textContent = "";
    try {
      if (!Number.isFinite(movement.quantity) || movement.quantity <= 0) throw new Error("Geçerli bir miktar girin.");
      state.stockActionSubmitting = true;
      const executeMovement = async () => {
        if (backendBaseUrl()) {
          const result = await backendRequest("/api/stock/movements", { method: "POST", body: { movement } });
          syncPublishRevision(result);
          state.stock = normalizeStockStateForAdmin(result.stockState);
          state.stockUpdatedAt = result.updatedAt || "";
          return result;
        }
        const result = applyLocalStockMovement(state.stock, movement);
        state.stock = result.stock;
        state.dirtyStock = true;
        return result;
      };
      const coordinator = window.TahmisciOperations;
      if (coordinator && typeof coordinator.run === "function") {
        await coordinator.run(operationKey, executeMovement, {
          button: submitButton,
          busyText: "Kaydediliyor…",
          classification: window.TahmisciOperationClasses && window.TahmisciOperationClasses.IMMEDIATE || "immediate-operation"
        });
      } else {
        await executeMovement();
      }
      safeLocalSet(STOCK_STORAGE_KEY, JSON.stringify(state.stock));
      closeStockActionModal();
      renderStockPanel();
      updateSaveControls("Stok hareketi kaydedildi");
    } catch (error) {
      if (els.stockActionMessage) els.stockActionMessage.textContent = error.message || "Stok işlemi kaydedilemedi.";
    } finally {
      state.stockActionSubmitting = false;
    }
  }

  function applyLocalStockMovement(stock, movement) {
    const next = normalizeStockStateForAdmin(stock);
    const product = next.products.find((item) => item.id === movement.productId);
    if (!product) throw new Error("Stok ürünü bulunamadı.");
    const current = stockNumber(product.stockQuantity);
    const quantity = stockNumber(movement.quantity);
    const nextQuantity = movement.type === "stock_in" ? current + quantity : current - quantity;
    if (nextQuantity < 0) throw new Error("Stok miktarı eksiye düşemez.");
    product.stockQuantity = roundStockQuantity(nextQuantity);
    const createdAt = new Date().toISOString();
    const record = {
      id: `local-${Date.now()}`,
      productId: product.id,
      stockProductId: product.id,
      productCode: String(product.productCode || movement.productCode || ""),
      stockProductCode: String(product.productCode || movement.stockProductCode || movement.productCode || ""),
      productName: product.name,
      categoryId: product.categoryId,
      type: movement.type,
      quantity,
      unit: product.unit || "adet",
      reason: movement.reason || stockMovementTypeText(movement.type),
      note: movement.note || "",
      actor: { type: "admin", name: "Yönetici" },
      createdAt
    };
    next.movements = [record, ...next.movements].slice(0, 1000);
    next.updatedAt = createdAt;
    return { stock: next, movement: record };
  }

  function normalizeStockStateForAdmin(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const categories = Array.isArray(source.categories) ? source.categories.map((category, index) => ({
      ...category,
      id: String(category.id || makeId("stock-category", category.name || index)),
      name: String(category.name || "Genel"),
      order: Number.isFinite(Number(category.order)) ? Number(category.order) : index,
      active: category.active !== false
    })) : defaultStockCategories();
    const validCategoryId = new Set(categories.map((category) => category.id));
    const fallbackCategoryId = categories[0] ? categories[0].id : "stock-category-general";
    const products = Array.isArray(source.products) ? source.products.map((product, index) => ({
      ...product,
      id: String(product.id || makeId("stock-product", `${product.name || index}`)),
      categoryId: validCategoryId.has(product.categoryId) ? product.categoryId : fallbackCategoryId,
      name: String(product.name || "Stok ürünü"),
      supplier: String(product.supplier || product.brand || ""),
      unit: String(product.unit || "adet"),
      stockQuantity: roundStockQuantity(product.stockQuantity),
      stockQuantityText: String(product.stockQuantityText ?? product.stockQuantity ?? ""),
      orderThreshold: roundStockQuantity(product.orderThreshold),
      orderThresholdText: String(product.orderThresholdText ?? product.orderThreshold ?? ""),
      criticalThreshold: roundStockQuantity(product.criticalThreshold),
      imageUrl: String(product.imageUrl || ""),
      note: String(product.note || ""),
      active: product.active !== false,
      order: Number.isFinite(Number(product.order)) ? Number(product.order) : index,
      updatedAt: String(product.updatedAt || source.updatedAt || "")
    })) : defaultStockProducts();
    return {
      schemaVersion: Number(source.schemaVersion || 1),
      categories,
      products,
      movements: Array.isArray(source.movements) ? source.movements.map(normalizeStockMovementForAdmin).filter(Boolean) : [],
      updatedAt: String(source.updatedAt || "")
    };
  }

  function normalizeStockMovementForAdmin(movement) {
    if (!movement || typeof movement !== "object") return null;
    return {
      ...movement,
      id: String(movement.id || `movement-${Date.now()}`),
      productId: String(movement.productId || ""),
      productName: String(movement.productName || ""),
      categoryId: String(movement.categoryId || ""),
      type: String(movement.type || ""),
      quantity: roundStockQuantity(movement.quantity),
      unit: String(movement.unit || ""),
      reason: String(movement.reason || ""),
      note: String(movement.note || ""),
      actor: movement.actor && typeof movement.actor === "object" ? movement.actor : {},
      createdAt: String(movement.createdAt || "")
    };
  }

  function defaultStockCategories() {
    return [];
  }

  function defaultStockProducts() {
    return [];
  }

  function stockCategories() {
    return normalizeStockStateForAdmin(state.stock).categories.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockProducts() {
    return normalizeStockStateForAdmin(state.stock).products.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockMovements() {
    return normalizeStockStateForAdmin(state.stock).movements.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function stockCategoryMap() {
    return new Map(stockCategories().map((category) => [category.id, category]));
  }

  function filteredStockProducts() {
    const categoryId = state.stockCategory || "all";
    const query = normalizeText(state.stockQuery || "");
    return stockProducts().filter((product) => {
      if (categoryId !== "all" && product.categoryId !== categoryId) return false;
      if (state.stockOnlyOrderNeeded && !["order", "out"].includes(stockProductStatus(product).key)) return false;
      if (!query) return true;
      return normalizeText(`${product.name} ${product.supplier} ${product.unit}`).includes(query);
    });
  }

  function stockOrderSuggestions() {
    return stockProducts().filter((product) => ["order", "out"].includes(stockProductStatus(product).key));
  }

  function stockProductStatus(product) {
    const current = stockNumberOrNull(stockDisplayValue(product, "stockQuantity"));
    const order = stockNumberOrNull(stockDisplayValue(product, "orderThreshold"));
    if (current === null || order === null) return { key: "check", label: "Kontrol Gerekli" };
    if (current === 0) return { key: "out", label: "Tükendi" };
    if (current <= order) return { key: "order", label: "Sipariş Ver" };
    return { key: "ok", label: "Yeterli" };
  }

  function stockDisplayValue(product, field) {
    const textField = field === "stockQuantity" ? "stockQuantityText" : "orderThresholdText";
    const text = String((product && product[textField]) ?? "").trim();
    if (text) return text;
    const value = product && product[field];
    return Number.isFinite(Number(value)) ? formatStockNumber(value) : "";
  }

  function stockNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const numberValue = Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  function stockNumberOrNull(value) {
    const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : null;
  }

  function roundStockQuantity(value) {
    return Math.round(stockNumber(value) * 1000) / 1000;
  }

  function formatStockNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(stockNumber(value));
  }

  function formatStockDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Tarih yok";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function stockMovementTypeText(type) {
    return {
      stock_in: "Stok Ekle",
      stock_out: "Eksilt",
      waste: "Sarf"
    }[type] || "Stok işlemi";
  }

  function renderMudavimPanel() {
    if (!els.mudavimCustomerList) return;
    renderMudavimStats();
    renderMudavimCustomerList();
    renderMudavimCustomerDetail();
    renderMudavimRewardRules();
    renderMudavimCampaigns();
    renderMudavimSettings();
    renderMudavimAnnouncements();
  }

  function filteredMudavimCustomers() {
    const query = normalizeText(state.mudavimSearch || "");
    const level = state.mudavimLevelFilter || "all";
    const reward = state.mudavimRewardFilter || "all";
    return MUDAVIM_CUSTOMERS.filter((customer) => {
      const searchText = normalizeText(`${customer.name} ${customer.contact} ${customer.code} ${customer.level}`);
      const matchesQuery = !query || searchText.includes(query);
      const matchesLevel = level === "all" || customer.level === level;
      const matchesReward = reward === "all" || customer.rewardStatus === reward;
      return matchesQuery && matchesLevel && matchesReward;
    });
  }

  function renderMudavimStats() {
    if (!els.mudavimStats) return;
    const total = MUDAVIM_CUSTOMERS.length;
    const active = MUDAVIM_CUSTOMERS.filter((customer) => customer.rewardStatus !== "new").length;
    const monthVisits = MUDAVIM_CUSTOMERS.reduce((sum, customer) => sum + (customer.visits || []).filter((visit) => String(visit.date || "").startsWith("2026-07")).length, 0);
    const rewards = MUDAVIM_CUSTOMERS.reduce((sum, customer) => sum + Number(customer.rewardsEarned || 0), 0);
    const stats = [
      ["Toplam müdavim", total],
      ["Aktif müşteri", active],
      ["Bu ay ziyaret", monthVisits],
      ["Dağıtılan ödül", rewards]
    ];
    els.mudavimStats.innerHTML = stats.map(([label, value]) => (
      `<article class="mudavim-stat-card"><i aria-hidden="true"></i><span>${escapeHTML(label)}</span><strong>${escapeHTML(String(value))}</strong></article>`
    )).join("");
  }

  function renderMudavimCustomerList() {
    if (!els.mudavimCustomerList) return;
    const customers = filteredMudavimCustomers();
    if (!customers.some((customer) => customer.id === state.selectedMudavimCustomerId)) {
      state.selectedMudavimCustomerId = customers[0]?.id || MUDAVIM_CUSTOMERS[0]?.id || "";
    }
    if (!customers.length) {
      els.mudavimCustomerList.innerHTML = `<div class="mudavim-empty">Henüz müdavim kaydı yok.</div>`;
      return;
    }
    els.mudavimCustomerList.innerHTML = customers.map((customer) => (
      `<button class="mudavim-customer-row${customer.id === state.selectedMudavimCustomerId ? " is-active" : ""}" type="button" data-mudavim-customer-id="${escapeAttribute(customer.id)}">
        <span>
          <strong>${escapeHTML(customer.name)}</strong>
          <small>${escapeHTML(customer.contact)}</small>
        </span>
        <em>${escapeHTML(customer.level)}</em>
        <span class="mudavim-row-meta">
          <b>${escapeHTML(formatMudavimRewardStatus(customer.rewardStatus))}</b>
          <small>${escapeHTML(formatMudavimDate(customer.lastVisit))}</small>
        </span>
      </button>`
    )).join("");
  }

  function renderMudavimCustomerDetail() {
    if (!els.mudavimCustomerDetail) return;
    const customer = MUDAVIM_CUSTOMERS.find((item) => item.id === state.selectedMudavimCustomerId) || MUDAVIM_CUSTOMERS[0];
    if (!customer) {
      els.mudavimCustomerDetail.innerHTML = `<div class="mudavim-empty">Müşteri seçimi bekleniyor.</div>`;
      return;
    }
    const remain = Math.max(0, 10 - Number(customer.cycleVisits || 0));
    const progress = Math.min(100, Number(customer.cycleVisits || 0) * 10);
    els.mudavimCustomerDetail.innerHTML = `
      <div class="mudavim-detail-head">
        <div>
          <p class="eyebrow">Müşteri detayı</p>
          <h4>${escapeHTML(customer.name)}</h4>
          <span>${escapeHTML(customer.contact)}</span>
        </div>
        <strong>${escapeHTML(customer.code)}</strong>
      </div>
      <div class="mudavim-detail-grid">
        <span><b>${escapeHTML(customer.level)}</b> Seviye</span>
        <span><b>${escapeHTML(String(customer.totalVisits))}</b> Toplam ziyaret</span>
        <span><b>${escapeHTML(String(customer.rewardsEarned))}</b> Ödül</span>
      </div>
      <div class="mudavim-admin-qr" aria-label="QR placeholder">
        ${Array.from({ length: 25 }, (_, index) => `<i class="${index % 4 === 0 ? "is-soft" : ""}"></i>`).join("")}
      </div>
      <div class="mudavim-progress-line">
        <div><strong>${escapeHTML(String(customer.cycleVisits))} / 10 ziyaret</strong><span>${remain === 0 ? "Ödülün hazır" : `${remain} ziyaret kaldı`}</span></div>
        <div class="mudavim-progress-track"><span style="width:${progress}%"></span></div>
      </div>
      <div class="mudavim-detail-actions" aria-label="Müdavim işlem butonları">
        <button class="primary-action" type="button" data-mudavim-action="add-visit">Ziyaret ekle</button>
        <button class="line-action" type="button" data-mudavim-action="use-reward">Ödülü kullandır</button>
      </div>
      <section>
        <h5>Aktif ödüller</h5>
        <div class="mudavim-chip-list">
          ${(customer.activeRewards || []).length ? customer.activeRewards.map((reward) => `<span>${escapeHTML(reward)}</span>`).join("") : "<span>Aktif ödül yok</span>"}
        </div>
      </section>
      <section>
        <h5>Ziyaret geçmişi</h5>
        <div class="mudavim-visit-list">
          ${(customer.visits || []).map((visit) => `
            <article>
              <time>${escapeHTML(formatMudavimDate(visit.date))}</time>
              <strong>${escapeHTML(visit.type)}</strong>
              <span>${escapeHTML(visit.change)}</span>
              <small>${escapeHTML(visit.note)}</small>
            </article>
          `).join("")}
        </div>
      </section>
      <section>
        <h5>Yönetici notu</h5>
        <p class="mudavim-note">${escapeHTML(customer.note)}</p>
      </section>
    `;
  }

  function handleMudavimDetailAction(event) {
    const button = event.target.closest("[data-mudavim-action]");
    if (!button) return;
    const customer = MUDAVIM_CUSTOMERS.find((item) => item.id === state.selectedMudavimCustomerId);
    if (!customer) return;
    const today = mudavimToday();
    if (button.dataset.mudavimAction === "add-visit") {
      customer.totalVisits = Number(customer.totalVisits || 0) + 1;
      customer.cycleVisits = Math.min(10, Number(customer.cycleVisits || 0) + 1);
      customer.lastVisit = today;
      customer.rewardStatus = customer.cycleVisits >= 10 ? "ready" : "active";
      customer.activeRewards = customer.cycleVisits >= 10 ? ["Tatlı hakkı"] : [];
      customer.note = customer.cycleVisits >= 10 ? "Ödül hazır. Kasada tatlı hakkı kullandırılabilir." : `${10 - customer.cycleVisits} ziyaret kaldı.`;
      customer.visits = [
        { date: today, type: "Ziyaret", change: "+1 ziyaret", note: "Admin UI mock işlemi" },
        ...(customer.visits || [])
      ].slice(0, 6);
    }
    if (button.dataset.mudavimAction === "use-reward" && (customer.cycleVisits >= 10 || (customer.activeRewards || []).length)) {
      customer.rewardsEarned = Number(customer.rewardsEarned || 0) + 1;
      customer.cycleVisits = 0;
      customer.rewardStatus = "used";
      customer.activeRewards = [];
      customer.lastVisit = today;
      customer.note = "Ödül kullandırıldı. Yeni ziyaret döngüsü başladı.";
      customer.visits = [
        { date: today, type: "Ödül kullanımı", change: "Tatlı hakkı kullanıldı", note: "Admin UI mock işlemi" },
        ...(customer.visits || [])
      ].slice(0, 6);
    }
    renderMudavimPanel();
  }

  function renderMudavimRewardRules() {
    if (!els.mudavimRewardRules) return;
    els.mudavimRewardRules.innerHTML = `
      <article class="mudavim-rule-card">
        <strong>10 içecek sonrası ödül</strong>
        <span>11. alışverişte yanında tatlı hakkı.</span>
        <em>Aktif</em>
      </article>
      <article class="mudavim-rule-card">
        <strong>Kullanım limiti</strong>
        <span>Ödül, kazanımdan sonra 30 gün içinde kullanılabilir.</span>
        <em>UI taslak</em>
      </article>
    `;
  }

  function renderMudavimCampaigns() {
    if (!els.mudavimCampaigns) return;
    const campaigns = [
      ["Doğum günü hediyesi", "Doğum günü ayında tek seferlik tatlı sürprizi.", "Planlandı"],
      ["X ziyaret sonrası ödül", "Belirlenen ziyaret eşiğinde özel kahve teklifi.", "Taslak"],
      ["Dönemsel kampanya", "Hafta içi sabah ziyaretlerini artıran kampanya.", "Pasif"]
    ];
    els.mudavimCampaigns.innerHTML = campaigns.map(([title, text, stateText]) => (
      `<article class="mudavim-campaign-card"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(text)}</span><em>${escapeHTML(stateText)}</em></article>`
    )).join("");
  }

  function renderMudavimSettings() {
    if (!els.mudavimSettings) return;
    els.mudavimSettings.innerHTML = `
      <label class="toggle-row"><input type="checkbox" checked disabled><span>QR kasada okutulsun</span></label>
      <label class="toggle-row"><input type="checkbox" checked disabled><span>10 içecekte 1 tatlı hakkı gösterilsin</span></label>
      <label><span>Müşteri ekranı metni</span><input type="text" value="Kasada kodunu okut" disabled></label>
      <label><span>Seviye kuralı</span><input type="text" value="Bronz / Gümüş / Altın" disabled></label>
    `;
  }

  function mudavimAnnouncements() {
    if (!state.site || typeof state.site !== "object") state.site = normalizeSiteSettings({ schemaVersion: 3 });
    if (!state.site.mudavim || typeof state.site.mudavim !== "object") state.site.mudavim = {};
    state.site.mudavim.announcements = normalizeMudavimAnnouncements(state.site.mudavim.announcements);
    return state.site.mudavim.announcements;
  }

  function selectedMudavimAnnouncement() {
    const announcements = mudavimAnnouncements();
    if (!announcements.some((item) => item.id === state.selectedMudavimAnnouncementId)) {
      state.selectedMudavimAnnouncementId = announcements[0]?.id || "";
    }
    return announcements.find((item) => item.id === state.selectedMudavimAnnouncementId) || null;
  }

  function renderMudavimAnnouncements() {
    if (!els.mudavimAnnouncementList || !els.mudavimAnnouncementEditor) return;
    const announcements = mudavimAnnouncements();
    const selected = selectedMudavimAnnouncement();
    els.mudavimAnnouncementList.innerHTML = announcements.length ? announcements.map((item) => `
      <button class="mudavim-announcement-row${item.id === state.selectedMudavimAnnouncementId ? " is-active" : ""}" type="button" data-mudavim-announcement-id="${escapeAttribute(item.id)}">
        <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.summary || `${item.blocks.length} blok`)}</small></span>
        <span class="mudavim-announcement-row__meta">
          <em class="${item.isPublished ? "is-published" : ""}">${item.isPublished ? "Yayınlandı" : "Taslak"}</em>
          <time>${escapeHTML(formatMudavimAnnouncementListDate(item.publishedAt || item.updatedAt || item.createdAt))}</time>
        </span>
      </button>
    `).join("") : `<div class="mudavim-empty">Henüz duyuru yok. “Yeni Duyuru” ile başlayın.</div>`;

    if (!selected) {
      els.mudavimAnnouncementEditor.innerHTML = `<div class="mudavim-empty">Düzenlemek için bir duyuru seçin.</div>`;
      renderMudavimAnnouncementPreview();
      return;
    }

    els.mudavimAnnouncementEditor.innerHTML = `
      <div class="mudavim-announcement-editor__head">
        <div><p class="eyebrow">Duyuru Editörü</p><h4>${escapeHTML(selected.title)}</h4></div>
        <button class="danger-action" type="button" data-mudavim-announcement-action="delete-announcement">Duyuruyu Sil</button>
      </div>
      <div class="mudavim-editor-shell">
        <div class="mudavim-editor-main">
          <div class="mudavim-announcement-fields">
            <label class="is-wide"><span>Başlık</span><input type="text" value="${escapeAttribute(selected.title)}" data-mudavim-announcement-field="title" maxlength="100"><small>${String(selected.title || "").length} / 100</small></label>
            <label class="is-wide"><span>Kısa özet</span><textarea rows="2" data-mudavim-announcement-field="summary" maxlength="160">${escapeHTML(selected.summary || "")}</textarea><small>${String(selected.summary || "").length} / 160</small></label>
          </div>
          <div class="mudavim-block-toolbar">
            <div><p class="eyebrow">İçerik Blokları</p><h5>Blog editörü</h5><span>Blokları yukarı/aşağı taşıyın, kopyalayın veya silin.</span></div>
            <div>
              <button class="line-action" type="button" data-mudavim-announcement-action="add-text"><i class="fas fa-align-left" aria-hidden="true"></i> Metin bloğu</button>
              <button class="line-action" type="button" data-mudavim-announcement-action="add-image"><i class="far fa-image" aria-hidden="true"></i> Görsel bloğu</button>
              <button class="line-action" type="button" data-mudavim-announcement-action="add-text-image"><i class="fas fa-table-columns" aria-hidden="true"></i> Metin + Görsel</button>
            </div>
          </div>
          <div class="mudavim-block-list">
            ${selected.blocks.length ? selected.blocks.map((block, index) => renderMudavimAnnouncementBlock(block, index, selected.blocks.length)).join("") : `<div class="mudavim-empty">Bu duyuruda henüz içerik bloğu yok.</div>`}
          </div>
        </div>
        <aside class="mudavim-publish-settings">
          <div class="mudavim-manager-kicker"><strong>Yayınlama Ayarları</strong><span>Durum ve zamanlama</span></div>
          <label><span>Durum</span><select data-mudavim-announcement-field="status"><option value="draft" ${!selected.isPublished ? "selected" : ""}>Taslak</option><option value="published" ${selected.isPublished ? "selected" : ""}>Yayınlandı</option></select></label>
          <label><span>Yayınlanma tarihi</span><input type="datetime-local" value="${escapeAttribute(datetimeLocalValue(selected.publishedAt))}" data-mudavim-announcement-field="publishedAt"></label>
          <p class="control-note">Son güncelleme: ${escapeHTML(formatMudavimAnnouncementListDate(selected.updatedAt || selected.createdAt))}</p>
          <p class="mudavim-publish-hint">Duyuru yayına alındığında müdavim kullanıcı ekranında gösterilir.</p>
        </aside>
      </div>
      <p class="control-note">Değişiklikler “Değişiklikleri Kaydet” düğmesine basıldığında canlıya alınır.</p>
    `;
    applyMudavimPreviewImageOrientation(els.mudavimAnnouncementEditor);
    renderMudavimAnnouncementPreview();
  }

  function renderMudavimAnnouncementBlock(block, index, total) {
    const hasText = block.type !== "image";
    const hasImage = block.type !== "text";
    const typeOptions = [
      ["text", "Metin Bloğu"],
      ["image", "Görsel Bloğu"],
      ["image-text", "Görsel + Metin"],
      ["text-image", "Metin + Görsel Bloğu"]
    ];
    const textFields = hasText ? `
      <div class="mudavim-block-text-fields">
        <div class="mudavim-text-tools" aria-label="Metin biçim araçları">
          <button type="button" data-mudavim-format="bold"><strong>B</strong></button>
          <button type="button" data-mudavim-format="italic"><em>I</em></button>
          <button type="button" data-mudavim-format="underline"><u>U</u></button>
          <button type="button" data-mudavim-format="bullet">•</button>
          <button type="button" data-mudavim-format="link"><i class="fas fa-link" aria-hidden="true"></i></button>
        </div>
        <label><span>Başlık</span><input type="text" value="${escapeAttribute(block.heading)}" data-mudavim-block-field="heading" maxlength="180" placeholder="Duyuru başlığı"></label>
        <label><span>Kısa açıklama</span><textarea rows="4" data-mudavim-block-field="body" maxlength="10000" placeholder="Duyuru metnini yazın">${escapeHTML(block.body)}</textarea></label>
        <div class="form-grid two">
          <label><span>Etiket / kategori</span><input type="text" value="${escapeAttribute(block.badge)}" data-mudavim-block-field="badge" maxlength="40" placeholder="YENİ, ETKİNLİK, SEZONAL"></label>
          <label><span>Tarih</span><input type="date" value="${escapeAttribute(block.date)}" data-mudavim-block-field="date"></label>
        </div>
      </div>
    ` : "";
    const imageFields = hasImage ? `
      <div class="mudavim-block-image-fields">
        ${block.imageUrl ? `<img src="${escapeAttribute(block.imageUrl)}" alt="" data-mudavim-preview-image>` : `<div class="mudavim-block-image-empty">Görsel seçilmedi</div>`}
        <label><span>Görsel URL</span><input type="text" value="${escapeAttribute(block.imageUrl)}" data-mudavim-block-field="imageUrl"></label>
        <label><span>Alternatif metin</span><input type="text" value="${escapeAttribute(block.alt)}" data-mudavim-block-field="alt" maxlength="240"></label>
        <label class="file-button"><span>Görsel Yükle / Değiştir</span><input type="file" accept="image/jpeg,image/png,image/webp" data-mudavim-block-image></label>
      </div>
    ` : "";
    return `
      <article class="mudavim-block-card is-${escapeAttribute(block.type)}" data-mudavim-block-id="${escapeAttribute(block.id)}">
        <div class="mudavim-block-card__head">
          <div class="mudavim-block-title">
            <span class="mudavim-block-order">${index + 1}</span>
            <label class="mudavim-block-type"><span>Blok tipi</span><select data-mudavim-block-field="type">${typeOptions.map(([value, label]) => `<option value="${value}" ${block.type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          </div>
          <div class="mudavim-block-actions">
            <button type="button" aria-label="Yukarı taşı" data-mudavim-announcement-action="move-block-up" ${index === 0 ? "disabled" : ""}><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
            <button type="button" aria-label="Aşağı taşı" data-mudavim-announcement-action="move-block-down" ${index === total - 1 ? "disabled" : ""}><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
            <button type="button" aria-label="Bloğu kopyala" data-mudavim-announcement-action="copy-block"><i class="far fa-copy" aria-hidden="true"></i></button>
            <button type="button" aria-label="Bloğu sil" data-mudavim-announcement-action="delete-block"><i class="fas fa-trash" aria-hidden="true"></i></button>
          </div>
        </div>
        ${hasText && hasImage ? `
          <label class="mudavim-block-placement">
            <span>Yerleşim</span>
            <select data-mudavim-block-field="type">
              <option value="image-text" ${block.type === "image-text" ? "selected" : ""}>Görsel solda</option>
              <option value="text-image" ${block.type === "text-image" ? "selected" : ""}>Görsel sağda</option>
            </select>
          </label>
        ` : ""}
        <div class="mudavim-block-editor-grid${hasText && hasImage ? " is-combined" : ""}">${imageFields}${textFields}</div>
      </article>
    `;
  }

  function renderMudavimAnnouncementPreview() {
    if (!els.mudavimAnnouncementPreview) return;
    const announcement = selectedMudavimAnnouncement();
    if (!announcement) {
      els.mudavimAnnouncementPreview.innerHTML = `<div class="mudavim-empty">Canlı önizleme için bir duyuru seçin.</div>`;
      return;
    }
    els.mudavimAnnouncementPreview.innerHTML = `
      <div class="mudavim-preview-frame">
        <div class="mudavim-preview-head"><span></span><h5>Duyurular</h5><i class="fas fa-xmark" aria-hidden="true"></i></div>
        <article class="mudavim-preview-announcement">
          <header><span>Duyuru</span><h4>${escapeHTML(announcement.title)}</h4></header>
          <div class="mudavim-preview-blocks">
            ${announcement.blocks.length ? announcement.blocks.map(renderMudavimAnnouncementPreviewBlock).join("") : `<div class="mudavim-empty">Henüz blok eklenmedi.</div>`}
          </div>
        </article>
      </div>
    `;
    applyMudavimPreviewImageOrientation(els.mudavimAnnouncementPreview);
  }

  function renderMudavimAnnouncementPreviewBlock(block) {
    const hasText = block.type !== "image";
    const hasImage = block.type !== "text";
    const meta = hasText && (block.badge || block.date) ? `<div class="mudavim-preview-meta">${block.badge ? `<span>${escapeHTML(block.badge)}</span>` : ""}${block.date ? `<time>${escapeHTML(formatMudavimAnnouncementDate(block.date))}</time>` : ""}</div>` : "";
    const copy = hasText ? `<div class="mudavim-preview-copy">${meta}${block.heading ? `<h5>${escapeHTML(block.heading)}</h5>` : ""}${block.body ? `<p>${escapeHTML(block.body).replace(/\n/g, "<br>")}</p>` : ""}</div>` : "";
    const media = hasImage ? `<figure class="mudavim-preview-media">${block.imageUrl ? `<img src="${escapeAttribute(block.imageUrl)}" alt="${escapeAttribute(block.alt || block.heading || "Duyuru görseli")}" data-mudavim-preview-image>` : `<span>Görsel bekleniyor</span>`}</figure>` : "";
    return `<section class="mudavim-preview-block is-${escapeAttribute(block.type)}">${media}${copy}</section>`;
  }

  function formatMudavimAnnouncementDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  }

  function formatMudavimAnnouncementListDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).slice(0, 16) : date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
  }

  function datetimeLocalValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function applyMudavimPreviewImageOrientation(root) {
    root.querySelectorAll("img[data-mudavim-preview-image]").forEach((image) => {
      const apply = () => {
        const frame = image.closest("figure, .mudavim-block-image-fields");
        if (!frame) return;
        frame.classList.toggle("is-portrait", image.naturalHeight > image.naturalWidth);
        frame.classList.toggle("is-landscape", image.naturalHeight <= image.naturalWidth);
      };
      if (image.complete) apply();
      else image.addEventListener("load", apply, { once: true });
    });
  }

  function addMudavimAnnouncement() {
    const announcements = mudavimAnnouncements();
    const now = new Date().toISOString();
    const id = `announcement-${Date.now().toString(36)}`;
    announcements.push({
      id,
      title: "Yeni Duyuru",
      summary: "",
      slug: `${slugifyMudavimAnnouncement("Yeni Duyuru")}-${announcements.length + 1}`,
      order: announcements.length,
      status: "draft",
      publishedAt: "",
      isPublished: false,
      blocks: [{
        id: `${id}-block-1`,
        type: "text",
        badge: "",
        date: "",
        heading: "",
        body: "",
        content: "",
        imageUrl: "",
        alt: "",
        order: 0
      }],
      createdAt: now,
      updatedAt: now
    });
    state.selectedMudavimAnnouncementId = id;
    saveSiteSettings();
    renderMudavimAnnouncements();
  }

  function handleMudavimAnnouncementListClick(event) {
    const row = event.target.closest("[data-mudavim-announcement-id]");
    if (!row) return;
    state.selectedMudavimAnnouncementId = row.dataset.mudavimAnnouncementId;
    renderMudavimAnnouncements();
  }

  function handleMudavimAnnouncementEditorInput(event) {
    const announcement = selectedMudavimAnnouncement();
    if (!announcement) return;
    const announcementField = event.target.dataset.mudavimAnnouncementField;
    if (announcementField) {
      if (announcementField === "status") {
        announcement.status = event.target.value === "published" ? "published" : "draft";
        announcement.isPublished = announcement.status === "published";
      } else {
        announcement[announcementField] = event.target.type === "checkbox"
          ? event.target.checked
          : event.target.type === "number" ? Number(event.target.value || 0) : event.target.value;
      }
      announcement.updatedAt = new Date().toISOString();
      saveSiteSettings();
      renderMudavimAnnouncementPreview();
      return;
    }
    const blockField = event.target.dataset.mudavimBlockField;
    const blockId = event.target.closest("[data-mudavim-block-id]")?.dataset.mudavimBlockId;
    const block = announcement.blocks.find((item) => item.id === blockId);
    if (!blockField || !block) return;
    block[blockField] = event.target.value;
    if (blockField === "body" && block.type === "text") block.content = block.body;
    announcement.updatedAt = new Date().toISOString();
    saveSiteSettings();
    renderMudavimAnnouncementPreview();
  }

  async function handleMudavimAnnouncementEditorChange(event) {
    const input = event.target.closest("[data-mudavim-block-image]");
    if (!input) {
      if (event.target.matches("[data-mudavim-block-field='type']")) {
        handleMudavimAnnouncementEditorInput(event);
        renderMudavimAnnouncements();
        return;
      }
      if (event.target.matches("[data-mudavim-announcement-field='title'], [data-mudavim-announcement-field='summary'], [data-mudavim-announcement-field='status'], [data-mudavim-announcement-field='publishedAt']")) {
        renderMudavimAnnouncements();
      }
      return;
    }
    const file = input.files && input.files[0];
    const announcement = selectedMudavimAnnouncement();
    const blockId = input.closest("[data-mudavim-block-id]")?.dataset.mudavimBlockId;
    const block = announcement?.blocks.find((item) => item.id === blockId);
    if (!file || !announcement || !block) return;
    input.disabled = true;
    try {
      const media = await storeMediaFile(file, "image");
      block.imageUrl = media.src;
      block.alt = block.alt || announcement.title;
      announcement.updatedAt = new Date().toISOString();
      saveSiteSettings();
      renderMudavimAnnouncements();
      updateSaveControls("Duyuru görseli yüklendi, yayın bekliyor");
    } catch (error) {
      alert(`Duyuru görseli yüklenemedi. ${error.message || "Dosyayı kontrol edin."}`);
      input.disabled = false;
    }
  }

  function handleMudavimAnnouncementEditorClick(event) {
    const formatButton = event.target.closest("[data-mudavim-format]");
    if (formatButton) {
      applyMudavimTextFormat(formatButton);
      return;
    }
    const button = event.target.closest("[data-mudavim-announcement-action]");
    if (!button) return;
    const action = button.dataset.mudavimAnnouncementAction;
    const announcements = mudavimAnnouncements();
    const announcement = selectedMudavimAnnouncement();
    if (!announcement) return;
    if (action === "delete-announcement") {
      if (!confirm("Bu duyuruyu silmek istiyor musunuz?")) return;
      state.site.mudavim.announcements = announcements.filter((item) => item.id !== announcement.id)
        .map((item, index) => ({ ...item, order: index }));
      state.selectedMudavimAnnouncementId = state.site.mudavim.announcements[0]?.id || "";
      saveSiteSettings();
      renderMudavimAnnouncements();
      return;
    }
    if (["add-text", "add-image", "add-image-text", "add-text-image"].includes(action)) {
      const type = action.replace(/^add-/, "");
      announcement.blocks.push({
        id: `${announcement.id}-block-${Date.now().toString(36)}`,
        type,
        badge: "",
        date: "",
        heading: "",
        body: "",
        content: "",
        imageUrl: "",
        alt: "",
        order: announcement.blocks.length
      });
    }
    const blockId = button.closest("[data-mudavim-block-id]")?.dataset.mudavimBlockId;
    const blockIndex = announcement.blocks.findIndex((item) => item.id === blockId);
    if (action === "delete-block" && blockIndex >= 0) announcement.blocks.splice(blockIndex, 1);
    if (action === "copy-block" && blockIndex >= 0) {
      const copy = cloneData(announcement.blocks[blockIndex]);
      copy.id = `${announcement.id}-block-${Date.now().toString(36)}`;
      copy.order = blockIndex + 1;
      announcement.blocks.splice(blockIndex + 1, 0, copy);
    }
    if (action === "move-block-up" && blockIndex > 0) {
      [announcement.blocks[blockIndex - 1], announcement.blocks[blockIndex]] = [announcement.blocks[blockIndex], announcement.blocks[blockIndex - 1]];
    }
    if (action === "move-block-down" && blockIndex >= 0 && blockIndex < announcement.blocks.length - 1) {
      [announcement.blocks[blockIndex + 1], announcement.blocks[blockIndex]] = [announcement.blocks[blockIndex], announcement.blocks[blockIndex + 1]];
    }
    announcement.blocks.forEach((block, index) => { block.order = index; });
    announcement.updatedAt = new Date().toISOString();
    saveSiteSettings();
    renderMudavimAnnouncements();
  }

  function applyMudavimTextFormat(button) {
    const announcement = selectedMudavimAnnouncement();
    const card = button.closest("[data-mudavim-block-id]");
    const textarea = card ? card.querySelector("textarea[data-mudavim-block-field='body']") : null;
    const block = announcement && card ? announcement.blocks.find((item) => item.id === card.dataset.mudavimBlockId) : null;
    if (!announcement || !block || !textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || start;
    const value = textarea.value || "";
    const selected = value.slice(start, end) || "metin";
    const type = button.dataset.mudavimFormat;
    let replacement = selected;
    if (type === "bold") replacement = `**${selected}**`;
    if (type === "italic") replacement = `_${selected}_`;
    if (type === "underline") replacement = `<u>${selected}</u>`;
    if (type === "bullet") replacement = selected.split("\n").map((line) => `• ${line.replace(/^•\\s*/, "")}`).join("\n");
    if (type === "link") {
      const url = prompt("Bağlantı adresi", "https://");
      if (!url) return;
      replacement = `[${selected}](${url})`;
    }
    textarea.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    textarea.focus();
    textarea.setSelectionRange(start, start + replacement.length);
    block.body = textarea.value;
    if (block.type === "text") block.content = block.body;
    announcement.updatedAt = new Date().toISOString();
    saveSiteSettings();
    renderMudavimAnnouncementPreview();
  }

  function formatMudavimRewardStatus(status) {
    const labels = {
      ready: "Ödül hazır",
      active: "Aktif",
      used: "Ödül kullanıldı",
      new: "Yeni kayıt"
    };
    return labels[status] || "Aktif";
  }

  function mudavimToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatMudavimDate(value) {
    if (!value) return "-";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
  }

  function renderFeedbackInbox() {
    if (!els.feedbackList) return;
    const items = loadFeedbackItems();
    renderFeedbackInsights(items);
    renderFeedbackMudavimSummary(items);
    const filter = state.feedbackFilter || "all";
    const favoriteCounts = favoriteRanking(items);
    const filtered = filter === "all"
      ? items
      : items.filter((item) => filter === "favori"
        ? normalizeFeedbackType(item.type) === "favori" || Boolean(item.favorite)
        : normalizeFeedbackType(item.type) === filter);
    if (filter === "favori") {
      filtered.sort((a, b) => {
        const aKey = favoriteKey(a.favorite);
        const bKey = favoriteKey(b.favorite);
        return (favoriteCounts.get(bKey) || 0) - (favoriteCounts.get(aKey) || 0)
          || new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
    }

    if (els.feedbackTabs) {
      els.feedbackTabs.querySelectorAll("[data-feedback-filter]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.feedbackFilter === filter);
      });
    }

    if (!filtered.length) {
      els.feedbackList.innerHTML = `
        <div class="feedback-empty-state">
          <strong>Kayıt yok</strong>
          <p>Müşteri mesajları, puanlamalar ve favori içecek tercihleri burada listelenecek.</p>
        </div>
      `;
      return;
    }

    const rankingHtml = filter === "favori" ? renderFavoriteRanking(favoriteCounts) : "";
    els.feedbackList.innerHTML = rankingHtml + `
      <div class="feedback-table" role="table" aria-label="Dilek ve şikayet kayıtları">
        <div class="feedback-table-row feedback-table-head" role="row">
          <span role="columnheader">Tarih</span>
          <span role="columnheader">Müşteri</span>
          <span role="columnheader">Kategori</span>
          <span role="columnheader">Puan / Detay</span>
          <span role="columnheader">Mesaj</span>
          <span role="columnheader">Favori içecek</span>
          <span role="columnheader">İşlem</span>
        </div>
        ${filtered.map((item) => {
      const type = normalizeFeedbackType(item.type);
      const count = favoriteCounts.get(favoriteKey(item.favorite)) || 0;
      const favorite = String(item.favorite || "").trim();
      const text = String(item.text || "").trim();
      const emptyText = type === "puanlama" ? "Sadece puanlama gönderildi." : "Metin girilmedi.";
      return `
          <div class="feedback-table-row" role="row">
            <span class="feedback-date" role="cell">${escapeHTML(formatFeedbackDate(item.createdAt) || "-")}</span>
            <span class="feedback-customer" role="cell">
              <strong>${escapeHTML(feedbackCustomerName(item))}</strong>
              <small>${escapeHTML(feedbackCustomerDetail(item))}</small>
            </span>
            <span role="cell"><em class="feedback-type-badge is-${escapeAttribute(type)}">${escapeHTML(feedbackTypeLabel(type))}</em></span>
            <span class="feedback-rating-cell" role="cell">${escapeHTML(feedbackStars(item.rating))}${type === "favori" && count ? `<small>${count} tercih</small>` : ""}</span>
            <span class="feedback-message-cell" role="cell">${escapeHTML(text || emptyText)}</span>
            <span class="feedback-favorite-cell" role="cell">${favorite ? `<strong>${escapeHTML(favorite)}</strong><small>Favori içecek</small>` : "<small>—</small>"}</span>
            <span class="feedback-actions-cell" role="cell">
              <button class="feedback-mini-action" type="button" aria-label="Kaydı görüntüle">Göz at</button>
            </span>
          </div>
        `;
        }).join("")}
      </div>
      `;
  }

  async function refreshFeedbackInbox() {
    if (!backendBaseUrl()) {
      renderFeedbackInbox();
      return;
    }

    try {
      const result = await backendRequest("/api/feedback");
      if (Array.isArray(result.feedbackItems)) {
        safeLocalSet(FEEDBACK_STORAGE_KEY, JSON.stringify(result.feedbackItems));
      }
      renderFeedbackInbox();
      if (els.saveState) els.saveState.textContent = "Geri bildirim yenilendi";
    } catch (error) {
      console.warn("Geri bildirim backend'den alınamadı.", error);
      renderFeedbackInbox();
      if (els.saveState) els.saveState.textContent = "Yerel geri bildirim";
    }
    window.setTimeout(() => updateSaveControls(), 1200);
  }

  function favoriteRanking(items) {
    const counts = new Map();
    items.forEach((item) => {
      const key = favoriteKey(item.favorite);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function renderFavoriteRanking(counts) {
    const ranked = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
      .slice(0, 8);
    if (!ranked.length) return "";
    return `
      <div class="favorite-ranking">
        ${ranked.map(([name, count], index) => `
          <article>
            <span>${index + 1}</span>
            <strong>${escapeHTML(displayFavoriteName(name))}</strong>
            <small>${count} tercih</small>
          </article>
        `).join("")}
      </div>
    `;
  }

  function favoriteKey(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
  }

  function displayFavoriteName(value) {
    return String(value || "").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("tr-TR"));
  }

  function renderFeedbackInsights(items) {
    if (!els.feedbackInsights) return;
    const total = items.length;
    const ratingItems = items.filter((item) => Number(item.rating || 0) > 0);
    const ratingTotal = ratingItems.reduce((sum, item) => sum + Number(item.rating || 0), 0);
    const average = ratingItems.length ? (ratingTotal / ratingItems.length).toFixed(1) : "0.0";
    const complaints = items.filter((item) => normalizeFeedbackType(item.type) === "sikayet").length;
    const suggestions = items.filter((item) => normalizeFeedbackType(item.type) === "oneri").length;
    const requests = items.filter((item) => normalizeFeedbackType(item.type) === "istek").length;
    const favorites = items.filter((item) => normalizeFeedbackType(item.type) === "favori" || String(item.favorite || "").trim()).length;
    const ratings = items.filter((item) => normalizeFeedbackType(item.type) === "puanlama").length;

    const insights = [
      ["Toplam kayıt", total],
      ["Yıldızlayan kişi", ratingItems.length],
      ["Ortalama puan", `${average}/5`],
      ["Puanlama", ratings],
      ["Şikayet", complaints],
      ["Öneri", suggestions],
      ["Dilek/İstek", requests],
      ["Favori içecek", favorites]
    ];

    els.feedbackInsights.innerHTML = insights.map(([label, value]) => (
      `<article class="feedback-insight"><span>${escapeHTML(label)}</span><strong>${escapeHTML(String(value))}</strong></article>`
    )).join("");
  }

  function renderFeedbackMudavimSummary(items) {
    if (!els.feedbackMudavimSummary) return;
    const mudavimItems = items.filter(isMudavimFeedback);
    const rated = mudavimItems.filter((item) => Number(item.rating || 0) > 0);
    const average = rated.length
      ? (rated.reduce((sum, item) => sum + Number(item.rating || 0), 0) / rated.length).toFixed(1)
      : "0.0";
    const latest = mudavimItems[0];
    els.feedbackMudavimSummary.innerHTML = `
      <div class="feedback-mudavim-head">
        <span aria-hidden="true">TM</span>
        <div>
          <p class="eyebrow">Müdavim Yorumları</p>
          <h3>Müdavim özeti</h3>
        </div>
      </div>
      <div class="feedback-mudavim-stats">
        <article><span>Toplam yorum</span><strong>${escapeHTML(String(mudavimItems.length))}</strong></article>
        <article><span>Ortalama puan</span><strong>${escapeHTML(`${average}/5`)}</strong></article>
      </div>
      <div class="feedback-mudavim-latest">
        <span>Son yorum</span>
        <p>${latest ? escapeHTML(String(latest.text || latest.favorite || "Sadece puanlama gönderildi.")).slice(0, 180) : "Henüz Müdavim yorumu yok."}</p>
        <small>${latest ? escapeHTML(formatFeedbackDate(latest.createdAt) || "-") : "Müdavim kanalı bekleniyor"}</small>
      </div>
      <div class="feedback-mudavim-channel">
        <span>Müdavim kanal durumu</span>
        <strong>${mudavimItems.length ? "Aktif" : "Beklemede"}</strong>
        <small>${mudavimItems.length ? "Müdavim geri bildirimleri izleniyor." : "İlk Müdavim yorumu geldiğinde burada öne çıkar."}</small>
      </div>
    `;
  }

  function feedbackCustomerName(item) {
    const value = item.customerName || item.memberName || item.profileName || item.displayName || item.name || item.customer || "";
    return String(value || "").trim() || (isMudavimFeedback(item) ? "Müdavim" : "Anonim misafir");
  }

  function feedbackCustomerDetail(item) {
    const value = item.phoneMasked || item.maskedPhone || item.phone || item.customerPhone || item.memberId || item.customerId || item.id || "";
    return value ? String(value).trim() : "Kanal: QR Menü";
  }

  function isMudavimFeedback(item) {
    const value = `${item.source || ""} ${item.channel || ""} ${item.customerType || ""} ${item.origin || ""}`.toLocaleLowerCase("tr-TR");
    return Boolean(item.mudavim || item.memberId || item.memberName || item.profileName || value.includes("mudavim"));
  }

  function handleFeedbackTabs(event) {
    const button = event.target.closest("[data-feedback-filter]");
    if (!button) return;
    state.feedbackFilter = button.dataset.feedbackFilter || "all";
    renderFeedbackInbox();
  }

  function clearFeedbackItems() {
    if (!confirm("Dilek, istek, şikayet ve favori kayıtları sıfırlansın mı? Puanlamalar korunacak.")) return;
    const preservedRatings = loadFeedbackItems()
      .filter((item) => Number(item.rating || 0) > 0)
      .map((item) => ({
        id: `rating-${item.id || Date.now()}`,
        createdAt: item.createdAt || new Date().toISOString(),
        type: "puanlama",
        text: "Puanlama kaydı",
        favorite: "",
        rating: clamp(Number(item.rating || 0), 1, 5)
      }));
    if (preservedRatings.length) safeLocalSet(FEEDBACK_STORAGE_KEY, JSON.stringify(preservedRatings));
    else safeLocalRemove(FEEDBACK_STORAGE_KEY);
    syncFeedbackItemsToBackend(preservedRatings);
    renderFeedbackInbox();
    if (els.saveState) els.saveState.textContent = "Kayıtlar sıfırlandı, puanlamalar korundu";
    window.setTimeout(() => {
      if (els.saveState) els.saveState.textContent = "Hazır";
    }, 1200);
  }

  async function syncFeedbackItemsToBackend(items) {
    if (!backendBaseUrl()) return;
    try {
      await backendRequest("/api/feedback", {
        method: "PUT",
        body: { feedbackItems: items }
      });
    } catch (error) {
      console.warn("Geri bildirim backend temizleme kaydedilemedi.", error);
    }
  }

  function renderStaffAccess() {
    if (!els.staffUserList) return;
    const access = state.recipeAccess || { users: [], assignments: [], activity: [] };
    renderStaffOverview(access);
    renderStaffUsers(access.users || []);
    renderStaffAssignmentOptions();
    renderStaffAssignments(access.assignments || []);
    renderStaffActivity(access.activity || []);
    if (els.staffUserMessage) els.staffUserMessage.textContent = state.staffMessage || "";
  }

  function renderStaffOverview(access) {
    if (!els.staffOverviewGrid) return;
    if (window.__tahmisciWorkforceOverview) {
      els.staffOverviewGrid.innerHTML = window.__tahmisciWorkforceOverview;
      return;
    }
    const users = Array.isArray(access && access.users) ? access.users : [];
    const assignments = Array.isArray(access && access.assignments) ? access.assignments : [];
    const activeCount = users.filter((user) => user.active !== false).length;
    const passiveCount = Math.max(0, users.length - activeCount);
    els.staffOverviewGrid.innerHTML = [
      ["Toplam Personel", users.length, "Tüm personel sayısı"],
      ["Aktif Personel", activeCount, "Aktif çalışan personel"],
      ["Pasif Personel", passiveCount, "Pasif durumda personel"],
      ["Atanmış Programlar", assignments.length, "Toplam atanan program"]
    ].map(([label, value, note]) => `
      <article>
        <span aria-hidden="true"></span>
        <div>
          <p>${escapeHTML(label)}</p>
          <strong>${escapeHTML(value)}</strong>
          <small>${escapeHTML(note)}</small>
        </div>
      </article>
    `).join("");
  }

  function renderStaffUsers(users) {
    const list = Array.isArray(users) ? users : [];
    const filter = state.staffUserFilter || "active";
    const visible = list.filter((user) => {
      if (filter === "active") return user.active !== false;
      if (filter === "inactive") return user.active === false;
      return true;
    });
    if (els.staffUserCount) {
      const activeCount = list.filter((user) => user.active !== false).length;
      const passiveCount = list.length - activeCount;
      els.staffUserCount.textContent = `${activeCount} aktif / ${passiveCount} pasif`;
    }
    if (els.staffUserFilter) {
      Array.from(els.staffUserFilter.querySelectorAll("[data-staff-user-filter]")).forEach((button) => {
        button.classList.toggle("is-active", button.dataset.staffUserFilter === filter);
      });
    }
    if (!visible.length) {
      els.staffUserList.innerHTML = `<div class="staff-empty">Bu filtrede personel yok.</div>`;
      return;
    }

    els.staffUserList.innerHTML = `
      <div class="staff-user-table">
        <div class="staff-user-row staff-user-head">
          <span>Ad Soyad</span>
          <span>Kullanıcı Adı</span>
          <span>Durum</span>
          <span>Oluşturulma Tarihi</span>
          <span></span>
        </div>
        ${visible.map((user) => `
          <article class="staff-user-row${user.id === state.selectedStaffUserId ? " is-active" : ""}">
            <button class="staff-user-main" type="button" data-staff-user="${escapeAttribute(user.id)}">
              <strong>${escapeHTML(user.name || user.username)}</strong>
            </button>
            <span>@${escapeHTML(user.username)}</span>
            <em class="${user.active === false ? "is-passive" : "is-active"}">${user.active === false ? "Pasif" : "Aktif"}</em>
            <time>${escapeHTML(formatStaffDate(user.createdAt))}</time>
            <span class="staff-row-actions">
              <button class="${user.active === false ? "line-action ui-button--secondary" : "danger-mini ui-button--danger"} ui-button ui-button--sm" type="button" data-toggle-staff-user="${escapeAttribute(user.id)}" data-next-active="${user.active === false ? "true" : "false"}" data-operation-class="immediate-operation">
                ${user.active === false ? "Aktifleştir" : "Pasifleştir"}
              </button>
              <button class="danger-mini ui-button ui-button--danger ui-button--sm" type="button" data-permanent-delete-user="${escapeAttribute(user.id)}">Kalıcı Sil</button>
            </span>
          </article>
        `).join("")}
      </div>
    `;
  }

  function handleStaffUserListClick(event) {
    const permanentDeleteButton = event.target.closest("[data-permanent-delete-user]");
    if (permanentDeleteButton) {
      openStaffDeleteDialog(permanentDeleteButton.dataset.permanentDeleteUser, permanentDeleteButton);
      return;
    }

    const toggleButton = event.target.closest("[data-toggle-staff-user]");
    if (toggleButton) {
      void toggleStaffUserAccess(toggleButton.dataset.toggleStaffUser, toggleButton.dataset.nextActive === "true", toggleButton);
      return;
    }

    const button = event.target.closest("[data-staff-user]");
    if (!button) return;
    const user = (state.recipeAccess.users || []).find((item) => item.id === button.dataset.staffUser);
    if (!user) return;
    state.selectedStaffUserId = user.id;
    if (els.staffUserName) els.staffUserName.value = user.name || "";
    if (els.staffUsername) els.staffUsername.value = user.username || "";
    if (els.staffPassword) els.staffPassword.value = "";
    if (els.staffUserActive) els.staffUserActive.checked = user.active !== false;
    state.staffMessage = "Personel düzenleniyor";
    renderStaffAccess();
  }

  function handleStaffUserFilterClick(event) {
    const button = event.target.closest("[data-staff-user-filter]");
    if (!button) return;
    state.staffUserFilter = button.dataset.staffUserFilter || "active";
    renderStaffAccess();
  }

  function runStaffImmediateOperation(key, button, operation, options = {}) {
    const coordinator = window.TahmisciOperations;
    if (!coordinator || typeof coordinator.run !== "function") return Promise.resolve().then(operation);
    return coordinator.run(key, operation, {
      button,
      busyText: options.busyText || "İşleniyor…",
      classification: window.TahmisciOperationClasses && window.TahmisciOperationClasses.IMMEDIATE || "immediate-operation"
    });
  }

  function applyStaffAccessResponse(result) {
    if (Array.isArray(result && result.users)) state.recipeAccess.users = result.users;
    if (Array.isArray(result && result.assignments)) state.recipeAccess.assignments = result.assignments;
    if (Array.isArray(result && result.activity)) state.recipeAccess.activity = result.activity;
    const revision = Number(result && result.revision);
    if (Number.isSafeInteger(revision) && revision >= 0) state.recipeAccess.revision = revision;
  }

  function staffMutationOptions(prefix, body = {}) {
    const requestId = createRequestId(prefix);
    return {
      headers: {
        "Idempotency-Key": requestId,
        "X-Request-ID": requestId
      },
      body: { ...body, requestId }
    };
  }

  async function toggleStaffUserAccess(id, nextActive, button) {
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!user) return;

    if (!nextActive && !confirm("Bu kullanıcının reçete erişim yetkisi kaldırılacak. Geçmiş görev ve aktivite kayıtları korunacak. Devam edilsin mi?")) {
      return;
    }

    try {
      const mutation = staffMutationOptions(nextActive ? "personnel-reactivate" : "personnel-deactivate", nextActive ? {
        name: user.name || user.username,
        username: user.username,
        password: "",
        active: true
      } : {});
      const result = await runStaffImmediateOperation(`staff-access:${id}`, button, () => (
        nextActive
          ? backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}`, {
            method: "PUT",
            ...mutation
          })
          : backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}`, { method: "DELETE", ...mutation })
      ), { busyText: nextActive ? "Aktifleştiriliyor…" : "Pasifleştiriliyor…" });

      applyStaffAccessResponse(result);
      state.staffMessage = nextActive ? "Personel tekrar aktif edildi" : "Personel pasif hale getirildi";
      if (!nextActive && state.selectedStaffUserId === id && els.staffUserActive) els.staffUserActive.checked = false;
      renderStaffAccess();
    } catch (error) {
      state.staffMessage = error.message || "Personel durumu güncellenemedi";
      renderStaffAccess();
    }
  }

  function openStaffDeleteDialog(id, trigger) {
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!user || !els.staffDeleteModal) return;
    staffDeleteUserId = id;
    staffDeleteTrigger = trigger || document.activeElement;
    if (els.staffDeleteName) els.staffDeleteName.textContent = user.name || user.username || "Personel";
    if (els.staffDeleteUsername) els.staffDeleteUsername.textContent = `@${user.username || "personel"}`;
    if (els.staffDeleteError) {
      els.staffDeleteError.hidden = true;
      els.staffDeleteError.textContent = "";
    }
    if (els.staffDeleteConsent) els.staffDeleteConsent.checked = false;
    setStaffDeleteBusy(false);
    syncStaffDeleteConsent();
    els.staffDeleteModal.hidden = false;
    els.staffDeleteModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-staff-delete-open");
    window.setTimeout(() => els.staffDeleteCancelButton && els.staffDeleteCancelButton.focus(), 0);
  }

  function closeStaffDeleteDialog(options = {}) {
    if (!els.staffDeleteModal || els.staffDeleteModal.hidden) return;
    if (staffDeleteBusy && options.force !== true) return;
    const restoreTarget = staffDeleteTrigger;
    setStaffDeleteBusy(false);
    if (els.staffDeleteConsent) els.staffDeleteConsent.checked = false;
    els.staffDeleteModal.hidden = true;
    els.staffDeleteModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-staff-delete-open");
    staffDeleteUserId = "";
    staffDeleteTrigger = null;
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected && !restoreTarget.disabled) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }

  function handleStaffDeleteModalClick(event) {
    if (staffDeleteBusy) return;
    if (event.target === els.staffDeleteModal || event.target.closest("[data-staff-delete-close]")) {
      closeStaffDeleteDialog();
    }
  }

  function setStaffDeleteBusy(isBusy, options = {}) {
    staffDeleteBusy = Boolean(isBusy);
    if (els.staffDeleteModal) {
      els.staffDeleteModal.classList.toggle("is-busy", staffDeleteBusy);
      if (staffDeleteBusy) els.staffDeleteModal.setAttribute("aria-busy", "true");
      else els.staffDeleteModal.removeAttribute("aria-busy");
    }
    if (els.staffDeleteCloseButton) els.staffDeleteCloseButton.disabled = staffDeleteBusy;
    if (els.staffDeleteCancelButton) els.staffDeleteCancelButton.disabled = staffDeleteBusy;
    if (els.staffDeleteConsent) els.staffDeleteConsent.disabled = staffDeleteBusy;
    if (options.includeConfirm !== false) syncStaffDeleteConsent();
  }

  function syncStaffDeleteConsent() {
    if (!els.staffDeleteConfirmButton) return;
    const consented = Boolean(els.staffDeleteConsent && els.staffDeleteConsent.checked);
    els.staffDeleteConfirmButton.disabled = staffDeleteBusy || !consented;
  }

  function trapStaffDeleteFocus(event) {
    if (!els.staffDeleteModal || els.staffDeleteModal.hidden || event.key !== "Tab") return false;
    const controls = Array.from(els.staffDeleteModal.querySelectorAll("button:not(:disabled), [href], input:not(:disabled)"))
      .filter((control) => control.getClientRects().length);
    if (!controls.length) return false;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.staffDeleteModal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (document.activeElement === last || !els.staffDeleteModal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  async function confirmPermanentStaffDelete() {
    const id = staffDeleteUserId;
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!id || !user || !els.staffDeleteConfirmButton || staffDeleteBusy) return;
    if (!els.staffDeleteConsent || !els.staffDeleteConsent.checked) {
      if (els.staffDeleteError) {
        els.staffDeleteError.textContent = "Devam etmek için kalıcı silme onayını işaretleyin.";
        els.staffDeleteError.hidden = false;
      }
      return;
    }
    if (els.staffDeleteError) {
      els.staffDeleteError.hidden = true;
      els.staffDeleteError.textContent = "";
    }

    try {
      const mutation = staffMutationOptions("personnel-permanent-delete");
      setStaffDeleteBusy(true);
      const result = await runStaffImmediateOperation(
        `staff-permanent-delete:${id}`,
        els.staffDeleteConfirmButton,
        () => backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}/permanent`, { method: "DELETE", ...mutation }),
        { busyText: "Siliniyor…" }
      );
      applyStaffAccessResponse(result);
      if (state.selectedStaffUserId === id) {
        state.selectedStaffUserId = "";
        if (els.staffUserName) els.staffUserName.value = "";
        if (els.staffUsername) els.staffUsername.value = "";
        if (els.staffPassword) els.staffPassword.value = "";
        if (els.staffUserActive) els.staffUserActive.checked = true;
      }
      state.staffMessage = "Kullanıcı kalıcı silindi; eski kayıtlar korundu";
      setStaffDeleteBusy(false);
      closeStaffDeleteDialog({ force: true, restoreFocus: false });
      renderStaffAccess();
      if (els.staffUserFilter) window.setTimeout(() => els.staffUserFilter.querySelector("[data-staff-user-filter].is-active")?.focus(), 0);
    } catch (error) {
      setStaffDeleteBusy(false);
      if (els.staffDeleteError) {
        els.staffDeleteError.textContent = error.message || "Kullanıcı kalıcı silinemedi";
        els.staffDeleteError.hidden = false;
      }
    }
  }

  function resetStaffUserForm() {
    state.selectedStaffUserId = "";
    state.staffMessage = "";
    if (els.staffUserName) els.staffUserName.value = "";
    if (els.staffUsername) els.staffUsername.value = "";
    if (els.staffPassword) els.staffPassword.value = "";
    if (els.staffUserActive) els.staffUserActive.checked = true;
    renderStaffAccess();
  }

  async function saveStaffUser() {
    const selectedId = state.selectedStaffUserId;
    const payload = {
      name: (els.staffUserName && els.staffUserName.value || "").trim(),
      username: (els.staffUsername && els.staffUsername.value || "").trim(),
      password: (els.staffPassword && els.staffPassword.value || "").trim(),
      active: !els.staffUserActive || els.staffUserActive.checked
    };

    try {
      const mutation = staffMutationOptions(selectedId ? "personnel-update" : "personnel-create", payload);
      const result = await runStaffImmediateOperation(
        `staff-save:${selectedId || payload.username}`,
        els.staffUserSaveButton,
        () => backendRequest(selectedId ? `/api/admin/recipe-users/${encodeURIComponent(selectedId)}` : "/api/admin/recipe-users", {
          method: selectedId ? "PUT" : "POST",
          ...mutation
        }),
        { busyText: selectedId ? "Güncelleniyor…" : "Oluşturuluyor…" }
      );
      applyStaffAccessResponse(result);
      state.selectedStaffUserId = result.user && result.user.id || selectedId || "";
      state.staffMessage = selectedId ? "Personel güncellendi" : "Personel oluşturuldu";
      if (els.staffPassword) els.staffPassword.value = "";
      renderStaffAccess();
    } catch (error) {
      state.staffMessage = error.message || "Personel kaydedilemedi";
      renderStaffAccess();
    }
  }

  function renderStaffAssignmentOptions() {
    if (!els.staffAssignmentUser || !els.staffAssignmentCategory) return;
    const users = (state.recipeAccess.users || []).filter((user) => user.active !== false);
    els.staffAssignmentUser.innerHTML = users.length
      ? users.map((user) => `<option value="${escapeAttribute(user.id)}">${escapeHTML(user.name || user.username)}</option>`).join("")
      : `<option value="">Aktif kullanıcı yok</option>`;

    const categories = recipeCategoryNames();
    const currentCategory = categories.includes(els.staffAssignmentCategory.value)
      ? els.staffAssignmentCategory.value
      : categories[0] || "";
    els.staffAssignmentCategory.innerHTML = categories.length
      ? categories.map((category) => `<option value="${escapeAttribute(category)}">${escapeHTML(category)}</option>`).join("")
      : `<option value="">Reçete yok</option>`;
    els.staffAssignmentCategory.value = currentCategory;
    renderStaffAssignmentProductOptions();
    updateStaffAssignmentControls();
  }

  function renderStaffAssignmentProductOptions() {
    if (!els.staffAssignmentProduct) return;
    const category = els.staffAssignmentCategory ? els.staffAssignmentCategory.value : "";
    const products = recipeProductNames(category);
    const currentProduct = products.includes(els.staffAssignmentProduct.value)
      ? els.staffAssignmentProduct.value
      : products[0] || "";
    els.staffAssignmentProduct.innerHTML = products.length
      ? products.map((product) => `<option value="${escapeAttribute(product)}">${escapeHTML(product)}</option>`).join("")
      : `<option value="">Ürün yok</option>`;
    els.staffAssignmentProduct.value = currentProduct;
    renderStaffAssignmentSizeOptions();
    renderStaffProductPicker();
  }

  function renderStaffAssignmentSizeOptions() {
    if (!els.staffAssignmentSize) return;
    const category = els.staffAssignmentCategory ? els.staffAssignmentCategory.value : "";
    const product = els.staffAssignmentProduct ? els.staffAssignmentProduct.value : "";
    const sizes = Object.keys((state.recipes && state.recipes[category] && state.recipes[category][product]) || {});
    const currentSize = sizes.includes(els.staffAssignmentSize.value) ? els.staffAssignmentSize.value : sizes[0] || "";
    els.staffAssignmentSize.innerHTML = sizes.length
      ? sizes.map((size) => `<option value="${escapeAttribute(size)}">${escapeHTML(size)}</option>`).join("")
      : `<option value="">Ölçü yok</option>`;
    els.staffAssignmentSize.value = currentSize;
    renderStaffProductPicker();
  }

  function updateStaffAssignmentControls() {
    const kind = staffAssignmentKindValue();
    const scope = staffScopeTypeValue();
    const needsQuestions = ["quick_quiz", "exam", "retraining"].includes(kind);
    const usesCategory = scope === "category" || scope === "products";
    const usesProducts = scope === "products";

    if (els.staffAssignmentCategory) els.staffAssignmentCategory.disabled = !usesCategory;
    if (els.staffAssignmentProduct) els.staffAssignmentProduct.disabled = !usesProducts;
    if (els.staffAssignmentSize) els.staffAssignmentSize.disabled = !usesProducts;
    if (els.staffQuestionCount) els.staffQuestionCount.disabled = !needsQuestions;
    if (els.staffPassingScore) els.staffPassingScore.disabled = !needsQuestions;
    if (els.staffDifficulty) els.staffDifficulty.disabled = !needsQuestions;
    renderStaffProductPicker();
  }

  function renderStaffProductPicker() {
    if (!els.staffProductPicker) return;
    const scope = staffScopeTypeValue();
    if (scope !== "products") {
      els.staffProductPicker.innerHTML = `<span class="staff-picker-note">${escapeHTML(staffScopeTypeLabel(scope))} kapsamı seçili.</span>`;
      return;
    }

    const category = els.staffAssignmentCategory ? els.staffAssignmentCategory.value : "";
    const items = flattenRecipeAssignmentItems(category);
    if (!items.length) {
      els.staffProductPicker.innerHTML = `<span class="staff-picker-note">Seçilebilir reçete yok.</span>`;
      return;
    }

    const currentProduct = els.staffAssignmentProduct ? els.staffAssignmentProduct.value : "";
    const currentSize = els.staffAssignmentSize ? els.staffAssignmentSize.value : "";
    const selectedLabels = items
      .filter((item) => item.product === currentProduct && (!currentSize || item.size === currentSize))
      .map((item) => [item.product, item.size].filter(Boolean).join(" / "));
    els.staffProductPicker.innerHTML = `
      <details class="staff-multiselect">
        <summary class="staff-multiselect-control">
          <span class="staff-multiselect-chips">
            ${staffProductPickerChipMarkup(selectedLabels)}
          </span>
          <span class="staff-multiselect-arrow" aria-hidden="true"></span>
        </summary>
        <div class="staff-multiselect-menu">
          ${items.map((item) => {
      const checked = item.product === currentProduct && (!currentSize || item.size === currentSize);
      return `
        <label class="staff-multiselect-option">
          <input type="checkbox" value="${escapeAttribute(recipeItemKey(item))}"${checked ? " checked" : ""}>
          <span>${escapeHTML([item.product, item.size].filter(Boolean).join(" / "))}</span>
        </label>
      `;
    }).join("")}
        </div>
      </details>
    `;
  }

  function syncStaffProductPickerChips() {
    if (!els.staffProductPicker) return;
    const chipBox = els.staffProductPicker.querySelector(".staff-multiselect-chips");
    if (!chipBox) return;
    const labels = Array.from(els.staffProductPicker.querySelectorAll(".staff-multiselect-option input[type='checkbox']:checked"))
      .map((input) => {
        const label = input.closest(".staff-multiselect-option");
        return label ? label.textContent.trim() : "";
      })
      .filter(Boolean);
    chipBox.innerHTML = staffProductPickerChipMarkup(labels);
  }

  function staffProductPickerChipMarkup(labels) {
    const visible = labels.slice(0, 2);
    const overflow = Math.max(0, labels.length - visible.length);
    if (!visible.length) return `<em>Ürün seçin</em>`;
    return [
      ...visible.map((label) => `<span>${escapeHTML(label)}</span>`),
      overflow ? `<span>+${overflow}</span>` : ""
    ].join("");
  }

  function flattenRecipeAssignmentItems(categoryFilter) {
    const items = [];
    Object.keys(state.recipes || {}).forEach((category) => {
      if (categoryFilter && category !== categoryFilter) return;
      const products = state.recipes[category] || {};
      Object.keys(products).forEach((product) => {
        const sizes = products[product] || {};
        Object.keys(sizes).forEach((size) => {
          items.push({ category, product, size });
        });
      });
    });
    return items;
  }

  function selectedStaffProducts() {
    const checked = els.staffProductPicker
      ? Array.from(els.staffProductPicker.querySelectorAll("input[type='checkbox']:checked"))
      : [];
    const byKey = new Map(flattenRecipeAssignmentItems("").map((item) => [recipeItemKey(item), item]));
    const selected = checked.map((input) => byKey.get(input.value)).filter(Boolean);
    if (selected.length) return selected;

    const category = els.staffAssignmentCategory && els.staffAssignmentCategory.value || "";
    const product = els.staffAssignmentProduct && els.staffAssignmentProduct.value || "";
    const size = els.staffAssignmentSize && els.staffAssignmentSize.value || "";
    return category && product && size ? [{ category, product, size }] : [];
  }

  function recipeItemKey(item) {
    return [item.category, item.product, item.size].map((part) => String(part || "")).join("|||");
  }

  function staffAssignmentKindValue() {
    const value = els.staffAssignmentKind && els.staffAssignmentKind.value || "quick_quiz";
    return ["quick_quiz", "training", "homework", "exam", "retraining"].includes(value) ? value : "quick_quiz";
  }

  function staffScopeTypeValue() {
    const value = els.staffScopeType && els.staffScopeType.value || "products";
    return ["all", "category", "products", "failed_items"].includes(value) ? value : "products";
  }

  async function createStaffAssignment() {
    const kind = staffAssignmentKindValue();
    const scopeType = staffScopeTypeValue();
    const selectedProducts = scopeType === "products" ? selectedStaffProducts() : [];
    const payload = {
      userId: els.staffAssignmentUser && els.staffAssignmentUser.value || "",
      assignmentKind: kind,
      scopeType,
      category: els.staffAssignmentCategory && els.staffAssignmentCategory.value || "",
      product: els.staffAssignmentProduct && els.staffAssignmentProduct.value || "",
      size: els.staffAssignmentSize && els.staffAssignmentSize.value || "",
      selectedProducts,
      questionCount: els.staffQuestionCount && els.staffQuestionCount.value || (kind === "quick_quiz" ? 3 : 8),
      passingScore: els.staffPassingScore && els.staffPassingScore.value || 70,
      difficulty: els.staffDifficulty && els.staffDifficulty.value || "normal",
      adminNote: els.staffAdminNote && els.staffAdminNote.value || ""
    };

    try {
      const result = await backendRequest("/api/admin/recipe-assignments", {
        method: "POST",
        body: payload
      });
      if (Array.isArray(result.assignments)) state.recipeAccess.assignments = result.assignments;
      if (Array.isArray(result.activity)) state.recipeAccess.activity = result.activity;
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = "Program atandı";
      if (els.staffAdminNote) els.staffAdminNote.value = "";
      renderStaffAccess();
    } catch (error) {
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = error.message || "Program atanamadı";
    }
  }

  function renderStaffAssignments(assignments) {
    const list = Array.isArray(assignments) ? assignments : [];
    if (els.staffAssignmentCount) els.staffAssignmentCount.textContent = `${list.length} kayıt`;
    if (!els.staffAssignmentList) return;
    if (els.staffAssignmentSummary) {
      const total = list.length;
      const pending = list.filter((item) => staffAssignmentStatus(item) === "pending").length;
      const completed = list.filter((item) => staffAssignmentStatus(item) === "completed").length;
      const retry = list.filter((item) => ["retry_required", "failed"].includes(staffAssignmentStatus(item))).length;
      els.staffAssignmentSummary.innerHTML = [
        ["Toplam kayıt", total],
        ["Bekleyen", pending],
        ["Tamamlanan", completed],
        ["Tekrar gerekli", retry]
      ].map(([label, value]) => `<article><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></article>`).join("");
    }
    if (!list.length) {
      els.staffAssignmentList.innerHTML = `<div class="staff-empty">Henüz eğitim, ödev veya sınav yok.</div>`;
      if (els.staffAssignmentDetail) els.staffAssignmentDetail.hidden = true;
      return;
    }

    els.staffAssignmentList.innerHTML = `
      <div class="staff-ledger staff-assignment-ledger">
        <div class="staff-ledger-head">
          <span>Tarih</span>
          <span>Personel</span>
          <span>Tip</span>
          <span>Başlık</span>
          <span>Kapsam</span>
          <span>Durum</span>
          <span>İlerleme</span>
          <span>Skor</span>
          <span>İşlem</span>
        </div>
        ${list.map((assignment) => {
      const score = staffAssignmentScore(assignment);
      const userName = assignment.name || assignment.username || "Silinmiş Kullanıcı";
      return `
        <article class="staff-assignment-row">
          <span>${escapeHTML(formatStaffDate(assignment.createdAt))}</span>
          <strong>${escapeHTML(userName)}</strong>
          <span>${escapeHTML(staffAssignmentKindLabel(assignment.assignmentKind || assignment.assignmentType))}</span>
          <span>${escapeHTML(assignment.title || [assignment.category, assignment.product, assignment.size].filter(Boolean).join(" / ") || "Program")}</span>
          <span>${escapeHTML(staffScopeSummary(assignment))}</span>
          <em class="${escapeAttribute(staffAssignmentStatus(assignment))}">${escapeHTML(staffAssignmentStatusLabel(assignment.status))}</em>
          <span>${escapeHTML(staffAssignmentProgress(assignment))}</span>
          <span>${escapeHTML(score)}</span>
          <span class="staff-row-actions">
            <button class="line-action ui-button ui-button--secondary ui-button--sm" type="button" data-assignment-detail="${escapeAttribute(assignment.id)}">Detay</button>
            <button class="danger-mini ui-button ui-button--danger ui-button--sm" type="button" data-delete-assignment="${escapeAttribute(assignment.id)}">Sil</button>
          </span>
        </article>
      `;
    }).join("")}
      </div>
    `;
  }

  async function handleStaffAssignmentListClick(event) {
    const detailButton = event.target.closest("[data-assignment-detail]");
    if (detailButton) {
      renderStaffAssignmentDetail(detailButton.dataset.assignmentDetail);
      return;
    }

    const button = event.target.closest("[data-delete-assignment]");
    if (!button) return;
    if (!confirm("Bu ödev silinsin mi?")) return;
    try {
      const result = await backendRequest(`/api/admin/recipe-assignments/${encodeURIComponent(button.dataset.deleteAssignment)}`, {
        method: "DELETE"
      });
      if (Array.isArray(result.assignments)) state.recipeAccess.assignments = result.assignments;
      if (els.staffAssignmentDetail) els.staffAssignmentDetail.hidden = true;
      renderStaffAccess();
    } catch (error) {
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = error.message || "Ödev silinemedi";
    }
  }

  function renderStaffAssignmentDetail(id) {
    const assignment = (state.recipeAccess.assignments || []).find((item) => item.id === id);
    if (!assignment || !els.staffAssignmentDetail) return;
    const questions = Array.isArray(assignment.questions) ? assignment.questions : [];
    const answers = Array.isArray(assignment.answers) ? assignment.answers : [];
    const recipeItems = Array.isArray(assignment.recipeItems) ? assignment.recipeItems : [];
    const failedItems = Array.isArray(assignment.failedItems) ? assignment.failedItems : [];
    els.staffAssignmentDetail.hidden = false;
    els.staffAssignmentDetail.innerHTML = `
      <div class="staff-box-head">
        <h4>Program Detayı</h4>
        <button class="line-action" type="button" data-close-assignment-detail>Kapat</button>
      </div>
      <div class="staff-detail-grid">
        <span>Personel</span><strong>${escapeHTML(assignment.name || assignment.username || "Silinmiş Kullanıcı")}</strong>
        <span>Başlık</span><strong>${escapeHTML(assignment.title || "-")}</strong>
        <span>Tip</span><strong>${escapeHTML(staffAssignmentKindLabel(assignment.assignmentKind || assignment.assignmentType))}</strong>
        <span>Kapsam</span><strong>${escapeHTML(staffScopeSummary(assignment))}</strong>
        <span>Durum</span><strong>${escapeHTML(staffAssignmentStatusLabel(assignment.status))}</strong>
        <span>İlerleme</span><strong>${escapeHTML(staffAssignmentProgress(assignment))}</strong>
        <span>Skor</span><strong>${escapeHTML(staffAssignmentScore(assignment))}</strong>
        <span>Tamamlanma</span><strong>${escapeHTML(formatStaffDate(assignment.completedAt))}</strong>
        <span>Yönetici notu</span><strong>${escapeHTML(assignment.adminNote || "-")}</strong>
      </div>
      ${recipeItems.length ? `
        <div class="staff-question-list">
          <article>
            <strong>Kapsamdaki reçeteler</strong>
            <span>${escapeHTML(recipeItems.map((item) => [item.category, item.product, item.size].filter(Boolean).join(" / ")).join(" | "))}</span>
          </article>
        </div>
      ` : ""}
      ${failedItems.length ? `
        <div class="staff-question-list">
          <article>
            <strong>Yanlış yapılan ürünler</strong>
            <span>${escapeHTML(failedItems.map((item) => [item.category, item.product, item.size].filter(Boolean).join(" / ")).join(" | "))}</span>
          </article>
        </div>
      ` : ""}
      <div class="staff-question-list">
        ${questions.map((question, index) => {
      const givenIndex = Number(answers[index]);
      const correctIndex = Number(question.correctIndex);
      const options = Array.isArray(question.options) ? question.options : [];
      return `
          <article>
            <strong>${escapeHTML(index + 1)}. ${escapeHTML(question.text || "Soru")}</strong>
            <span>Verilen cevap: ${escapeHTML(options[givenIndex] || "-")}</span>
            <span>Dogru cevap: ${escapeHTML(options[correctIndex] || "-")}</span>
          </article>
        `;
    }).join("")}
      </div>
    `;
    const closeButton = els.staffAssignmentDetail.querySelector("[data-close-assignment-detail]");
    if (closeButton) closeButton.addEventListener("click", () => {
      els.staffAssignmentDetail.hidden = true;
    });
  }

  function renderStaffActivity(activity) {
    const tab = state.staffActivityTab || "login";
    const list = (Array.isArray(activity) ? activity : [])
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const filtered = list.filter((item) => staffActivityMatchesTab(item, tab)).slice(0, 50);
    if (els.staffActivityCount) els.staffActivityCount.textContent = `${list.length} kayıt`;
    if (!els.staffActivityList) return;
    if (els.staffActivityTabs) {
      Array.from(els.staffActivityTabs.querySelectorAll("[data-staff-activity-tab]")).forEach((button) => {
        button.classList.toggle("is-active", button.dataset.staffActivityTab === tab);
      });
    }
    if (!filtered.length) {
      els.staffActivityList.innerHTML = `<div class="staff-empty">Bu sekmede aktivite yok.</div>`;
      return;
    }

    els.staffActivityList.innerHTML = `
      <div class="staff-ledger staff-activity-ledger">
        <div class="staff-ledger-head">
          <span>Personel</span>
          <span>Hareket</span>
          <span>Detay</span>
          <span>Tarih</span>
        </div>
        ${filtered.map((item) => `
          <article class="staff-activity-row">
            <strong>${escapeHTML(item.name || item.username || "Bilinmeyen kullanıcı")}</strong>
            <span>${escapeHTML(staffActivityLabel(item.type))}</span>
            <span>${escapeHTML(staffActivityDetail(item))}</span>
            <time>${escapeHTML(formatStaffDate(item.createdAt))}</time>
          </article>
        `).join("")}
      </div>
    `;
  }

  function handleStaffActivityTabClick(event) {
    const button = event.target.closest("[data-staff-activity-tab]");
    if (!button) return;
    state.staffActivityTab = button.dataset.staffActivityTab || "login";
    renderStaffActivity((state.recipeAccess && state.recipeAccess.activity) || []);
  }

  function staffActivityLabel(type) {
    const value = String(type || "");
    if (value === "login") return "Giriş yaptı";
    if (value === "login_failed") return "Hatalı giriş";
    if (value === "view_recipe") return "Reçete açtı";
    if (value === "view_preparation") return "Hazırlanışa baktı";
    if (value === "assignment_created") return "Ödev atandı";
    if (value === "assignment_started") return "Ödev başladı";
    if (value === "training_started") return "Eğitim başladı";
    if (value === "training_assigned") return "Eğitim atandı";
    if (value === "training_completed") return "Eğitim tamamlandı";
    if (value === "homework_assigned") return "Ödev atandı";
    if (value === "homework_started") return "Ödev başladı";
    if (value === "homework_completed") return "Ödev tamamlandı";
    if (value === "exam_assigned") return "Sınav atandı";
    if (value === "exam_started") return "Sınav başladı";
    if (value === "exam_completed") return "Sınav tamamlandı";
    if (value === "exam_failed") return "Sınav başarısız";
    if (value === "retry_training_suggested") return "Tekrar eğitimi önerildi";
    if (value === "assignment_completed") return "Ödev tamamlandı";
    if (value === "assignment_retry_required") return "Tekrar gerekli";
    if (value === "recipe_user_deactivated") return "Yetki kaldırıldı";
    if (value === "recipe_user_reactivated") return "Yetki tekrar verildi";
    if (value === "recipe_user_permanently_deleted") return "Kalıcı silindi";
    if (value === "task_assigned") return "Görev atandı";
    if (value === "task_progress") return "Görev ilerledi";
    if (value === "task_completed") return "Görev tamamlandı";
    if (value === "task_status_changed") return "Görev durumu değişti";
    if (value === "shipment_reported") return "Sevkiyat bildirildi";
    if (value === "shipment_approved") return "Sevkiyat onaylandı";
    if (value === "shipment_rejected") return "Sevkiyat reddedildi";
    if (value === "shift_requested") return "Vardiya talebi gönderildi";
    if (value === "shift_request_cancelled") return "Vardiya talebi iptal edildi";
    if (value === "shift_request_approved") return "Vardiya talebi onaylandı";
    if (value === "shift_request_rejected") return "Vardiya talebi reddedildi";
    if (value === "shifts_drafted") return "Shift taslağı kaydedildi";
    if (value === "shifts_auto_drafted") return "Otomatik shift taslağı oluşturuldu";
    if (value === "shifts_draft_applied") return "Shift taslağı uygulandı";
    if (value === "shifts_published") return "Shiftler yayınlandı";
    if (value === "shift_settings_updated") return "Shift saatleri güncellendi";
    return value || "Aktivite";
  }

  function staffActivityMatchesTab(item, tab) {
    const value = String(item && item.type || "");
    if (tab === "login") return value === "login" || value === "login_failed";
    if (tab === "recipe") return value === "view_recipe" || value === "view_preparation";
    if (tab === "training") {
      return ["training_assigned", "training_started", "training_completed", "retry_training_suggested"].includes(value);
    }
    if (tab === "homework") {
      return ["homework_assigned", "homework_started", "homework_completed"].includes(value);
    }
    if (tab === "exam") {
      return ["exam_assigned", "exam_started", "exam_completed", "exam_failed", "assignment_created", "assignment_started", "assignment_completed", "assignment_retry_required"].includes(value);
    }
    if (tab === "operations") {
      return [
        "task_assigned", "task_progress", "task_completed", "task_status_changed",
        "shipment_reported", "shipment_approved", "shipment_rejected",
        "shift_requested", "shift_request_cancelled", "shift_request_approved", "shift_request_rejected",
        "shifts_drafted", "shifts_auto_drafted", "shifts_draft_applied", "shifts_published",
        "shift_settings_updated"
      ].includes(value);
    }
    return ["recipe_user_deactivated", "recipe_user_reactivated", "recipe_user_permanently_deleted", "login_failed"].includes(value);
  }

  function staffActivityDetail(item) {
    const parts = [item.category, item.product, item.size, item.panel].filter(Boolean);
    if (item.assignmentTitle) parts.unshift(item.assignmentTitle);
    if (item.status) parts.push(staffAssignmentStatusLabel(item.status));
    if (Number(item.total || 0)) parts.push(staffAssignmentScore(item));
    return parts.join(" / ") || "-";
  }

  function staffAssignmentStatus(assignment) {
    const value = String(assignment && assignment.status || "pending");
    return ["pending", "in_progress", "completed", "failed", "retry_required"].includes(value) ? value : "pending";
  }

  function staffAssignmentStatusLabel(status) {
    const value = String(status || "pending");
    return {
      pending: "Bekliyor",
      in_progress: "Devam ediyor",
      completed: "Tamamlandı",
      failed: "Tekrar gerekli",
      retry_required: "Tekrar gerekli"
    }[value] || "Bekliyor";
  }

  function staffAssignmentKindLabel(type) {
    return {
      quick_quiz: "Hizli Quiz",
      quiz: "Hizli Quiz",
      training: "Eğitim Paketi",
      homework: "Çalışma Ödevi",
      exam: "Hakimiyet Sınavı",
      training_quiz: "Eğitim + Test (Eski)",
      retraining: "Tekrar Eğitimi"
    }[String(type || "quick_quiz")] || "Hizli Quiz";
  }

  function staffScopeTypeLabel(type) {
    return {
      all: "Tüm reçeteler",
      category: "Kategori",
      products: "Ürünler",
      failed_items: "Yanlış yapılanlar"
    }[String(type || "products")] || "Ürünler";
  }

  function staffScopeSummary(assignment) {
    const scope = String(assignment && assignment.scopeType || "products");
    const items = Array.isArray(assignment && assignment.recipeItems) ? assignment.recipeItems : [];
    if (scope === "all") return "Tüm reçeteler";
    if (scope === "category") return assignment.category || "Kategori";
    if (scope === "failed_items") return items.length ? `${items.length} yanlış ürün` : "Yanlış yapılanlar";
    if (items.length > 1) return `${items.length} reçete`;
    if (items.length === 1) return [items[0].product, items[0].size].filter(Boolean).join(" / ");
    return [assignment && assignment.category, assignment && assignment.product, assignment && assignment.size].filter(Boolean).join(" / ") || "Ürünler";
  }

  function staffAssignmentProgress(assignment) {
    const totalItems = Array.isArray(assignment && assignment.recipeItems) ? assignment.recipeItems.length : 0;
    const completedItems = Array.isArray(assignment && assignment.completedItems) ? assignment.completedItems.length : 0;
    if (totalItems) return `${completedItems}/${totalItems}`;
    const percent = Number(assignment && assignment.percent);
    if (Number.isFinite(percent) && percent > 0) return `%${Math.round(percent)}`;
    return staffAssignmentStatusLabel(staffAssignmentStatus(assignment));
  }

  function staffAssignmentScore(assignment) {
    const total = Number(assignment && assignment.total || 0) || 0;
    const score = Number(assignment && assignment.score || 0) || 0;
    if (!total) return "-";
    const status = staffAssignmentStatus(assignment);
    if (status === "pending") return "Bekliyor";
    if (status === "in_progress") return "Devam ediyor";
    return `${score}/${total}`;
  }

  function formatStaffDate(value) {
    if (!value) return "-";
    try {
      return new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return String(value);
    }
  }

  function loadFeedbackItems() {
    const stored = safeLocalGet(FEEDBACK_STORAGE_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed)
        ? parsed.map(normalizeFeedbackItem).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        : [];
    } catch (error) {
      console.warn("Geri bildirim kaydı okunamadı.", error);
      return [];
    }
  }

  function normalizeFeedbackItem(item) {
    const next = Object.assign({}, item);
    if (
      normalizeFeedbackType(next.type) === "istek"
      && Number(next.rating || 0) > 0
      && !String(next.favorite || "").trim()
      && String(next.text || "").trim().toLocaleLowerCase("tr-TR") === "puanlama kaydı"
    ) {
      next.type = "puanlama";
    }
    return next;
  }

  function normalizeFeedbackType(type) {
    if (type === "puanlama" || type === "puan" || type === "rating") return "puanlama";
    if (type === "sikayet" || type === "şikayet") return "sikayet";
    if (type === "oneri" || type === "öneri") return "oneri";
    if (type === "favori" || type === "favorite") return "favori";
    return "istek";
  }

  function feedbackTypeLabel(type) {
    return {
      istek: "İstek",
      puanlama: "Puanlama",
      sikayet: "Şikayet",
      oneri: "Öneri",
      favori: "Favori içecek"
    }[type] || "İstek";
  }

  function feedbackStars(value) {
    const rating = Math.round(clamp(Number(value || 0), 0, 5));
    return rating ? `${"★".repeat(rating)}${"\u2606".repeat(5 - rating)} ${rating}/5` : "Puan yok";
  }

  function formatFeedbackDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function renderLists() {
    els.categoryList.innerHTML = state.data.categories.map((category) => `
      <button class="nav-row${category.id === state.selectedCategoryId ? " is-active" : ""}" type="button" data-category-id="${escapeAttribute(category.id)}">
        <strong>${category.active ? "" : "Gizli · "}${escapeHTML(category.name)}</strong>
        <small>${category.products.length} ürün</small>
      </button>
    `).join("");

    const category = selectedCategory();
    els.productList.innerHTML = category && category.products.length
      ? category.products.map((product) => `
        <button class="nav-row${product.id === state.selectedProductId ? " is-active" : ""}" type="button" data-product-id="${escapeAttribute(product.id)}">
          <strong>${product.popular ? "★ " : ""}${product.stock === "sold-out" || !product.active ? "Gizli · " : ""}${escapeHTML(product.name)}</strong>
          <small>${escapeHTML(priceSummary(product))}</small>
        </button>
      `).join("")
      : `<div class="nav-row"><strong>Ürün yok</strong><small>+ Ürün ile ekleyin</small></div>`;
  }

  function renderForms() {
    const settings = state.data.settings;
    els.bgColor.value = toColor(settings.bgColor, DEFAULT_SETTINGS.bgColor);
    els.darkBgColor.value = toColor(settings.darkBgColor, DEFAULT_SETTINGS.darkBgColor);
    els.accentColor.value = toColor(settings.accentColor, DEFAULT_SETTINGS.accentColor);
    els.textColor.value = toColor(settings.textColor, DEFAULT_SETTINGS.textColor);
    els.buttonTextColor.value = toColor(settings.buttonTextColor, DEFAULT_SETTINGS.buttonTextColor);
    els.productCardColor.value = toColor(settings.productCardColor, DEFAULT_SETTINGS.productCardColor);
    if (els.socialIconColor) els.socialIconColor.value = toColor(settings.socialIconColor, DEFAULT_SETTINGS.socialIconColor);
    if (els.socialIconSize) els.socialIconSize.value = clamp(Number(settings.socialIconSize || DEFAULT_SETTINGS.socialIconSize), 18, 64);
    if (els.socialIconSizeValue && els.socialIconSize) els.socialIconSizeValue.textContent = `${els.socialIconSize.value}px`;
    const socialPreview = document.querySelector(".social-preview");
    if (socialPreview && els.socialIconColor && els.socialIconSize) {
      socialPreview.style.setProperty("--social-preview-color", els.socialIconColor.value);
      socialPreview.style.setProperty("--social-preview-size", `${els.socialIconSize.value}px`);
    }
    els.menuBgType.value = settings.menuBackground.type;
    els.menuGradientStart.value = toColor(settings.menuBackground.gradientStart, DEFAULT_SETTINGS.bgColor);
    els.menuGradientEnd.value = toColor(settings.menuBackground.gradientEnd, "#E5E7EB");
    els.menuGradientAngle.value = settings.menuBackground.gradientAngle;
    els.menuBgUrl.value = settings.menuBackground.imageUrl || "";
    els.menuOverlay.value = settings.menuBackground.overlay;
    els.menuUpdateDate.value = settings.menuUpdateDate || "";
    setFontSelectValue(els.titleFont, settings.fonts.title);
    setFontSelectValue(els.categoryFont, settings.fonts.category);
    setFontSelectValue(els.productFont, settings.fonts.product);
    const typography = normalizeTypography(settings.typography);
    els.menuTitleSize.value = typography.menuTitle;
    els.categoryTitleSize.value = typography.categoryTitle;
    els.productTitleSize.value = typography.productTitle;
    els.productDescSize.value = typography.productDesc;
    els.productIngredientsSize.value = typography.productIngredients;
    els.productPriceSize.value = typography.productPrice;
    renderActionStyleForm("popular", settings.bottomActions.popular);
    renderActionStyleForm("suggest", settings.bottomActions.suggest);
    renderMenuUiSummary(settings);
    renderBannerSettingsForm(settings.banner);

    const category = selectedCategory();
    if (category) {
      els.categoryEditorTitle.textContent = `${category.name} kategorisi`;
      els.categoryName.value = category.name;
      els.categoryActive.checked = category.active;
      renderCategoryIconOptions(category);
      els.categoryStyleType.value = category.style.type || "gradient";
      els.categoryColor.value = toColor(category.style.color || settings.categoryCardColor, DEFAULT_SETTINGS.categoryCardColor);
      els.categoryGradientStart.value = toColor(category.style.gradientStart, DEFAULT_SETTINGS.categoryCardColor);
      els.categoryGradientEnd.value = toColor(category.style.gradientEnd, "#E5E7EB");
      els.categoryGradientAngle.value = category.style.gradientAngle;
      els.categoryImageUrl.value = category.style.imageUrl || "";
      els.categoryOverlay.value = category.style.overlay;
      els.bulkProductStyleType.value = "solid";
      els.bulkProductColor.value = toColor(settings.productCardColor, DEFAULT_SETTINGS.productCardColor);
      els.bulkProductGradientStart.value = toColor(settings.productCardColor, DEFAULT_SETTINGS.productCardColor);
      els.bulkProductGradientEnd.value = "#E5E7EB";
      els.bulkProductGradientAngle.value = 145;
      renderImagePreview(els.categoryImagePreview, category.style.imageUrl || category.style.image, "Kategori görseli yok");
    }

    els.productCategory.innerHTML = state.data.categories.map((item) => `
      <option value="${escapeAttribute(item.id)}">${escapeHTML(item.name)}</option>
    `).join("");
    renderProductNavigation();
    if (PANEL_MODULES.site) {
      renderSiteSettingsForm();
      renderSiteEditorForm();
    }

    const product = selectedProductStrict();
    els.deleteProductButton.disabled = !product;
    if (els.productDetailsAccordion) {
      els.productDetailsAccordion.hidden = !product;
      if (product) els.productDetailsAccordion.open = true;
    }
    if (!product) {
      els.productEditorTitle.textContent = "Ürün Detayları";
      clearProductForm();
      return;
    }

    els.productEditorTitle.textContent = "Ürün Detayları";
    els.productName.value = product.name;
    els.productCategory.value = category ? category.id : "";
    els.productDesc.value = product.desc;
    els.priceMode.value = product.priceMode || "standard";
    els.standardPrice.value = product.prices.standard;
    els.priceK.value = product.prices.k;
    els.priceO.value = product.prices.o;
    els.priceB.value = product.prices.b;
    els.priceSingle.value = product.prices.single;
    els.priceDouble.value = product.prices.double;
    renderPriceModeFields();
    els.productStock.value = product.stock;
    els.productKind.value = product.kind;
    els.productTemperature.value = product.temperature;
    els.productPopular.checked = product.popular;
    els.productActive.checked = product.active;
    els.productStyleType.value = product.style.type === "solid" ? "solid" : "gradient";
    els.productColor.value = toColor(product.style.color || settings.productCardColor, DEFAULT_SETTINGS.productCardColor);
    els.productGradientStart.value = toColor(product.style.gradientStart, DEFAULT_SETTINGS.productCardColor);
    els.productGradientEnd.value = toColor(product.style.gradientEnd, "#E5E7EB");
    els.productGradientAngle.value = product.style.gradientAngle;
    els.productImageUrl.value = product.imageUrl || "";
    els.productImageOverlay.value = product.imageOverlay;
    renderImagePreview(els.productImagePreview, product.imageUrl || product.image, "Ürün görseli yok");
    els.productCalories.value = product.details.calories;
    els.productAllergens.value = product.details.allergens;
    els.productIngredients.value = product.manualContent || product.details.ingredients;
    renderProductRecipeLink(product);
  }

  function renderProductRecipeLink(product) {
    if (!els.productContentMode || !els.productRecipeId || !els.productRecipeSize) return;
    els.productContentMode.value = product.contentMode || "manual";
    const catalog = normalizeRecipeCatalog(state.recipeCatalog);
    els.productRecipeId.innerHTML = `<option value="">Bağlantı yok</option>${catalog.map((item) => `
      <option value="${escapeAttribute(item.id)}">${escapeHTML(item.category)} / ${escapeHTML(item.product)}</option>
    `).join("")}`;
    els.productRecipeId.value = catalog.some((item) => item.id === product.recipeId) ? product.recipeId : "";
    const linked = catalog.find((item) => item.id === els.productRecipeId.value);
    const sizes = linked && state.recipes[linked.category] && state.recipes[linked.category][linked.product]
      ? Object.keys(state.recipes[linked.category][linked.product]) : [];
    els.productRecipeSize.innerHTML = `<option value="">Otomatik (Standart → 16 oz → ilk)</option>${sizes.map((size) => `
      <option value="${escapeAttribute(size)}">${escapeHTML(size)}</option>
    `).join("")}`;
    els.productRecipeSize.value = sizes.includes(product.recipeSize) ? product.recipeSize : "";
    const status = linked ? `Bağlı: ${linked.category} / ${linked.product}` : "Eşleştirme gerekli veya manuel içerik kullanılmalı.";
    if (els.productRecipeLinkStatus) els.productRecipeLinkStatus.textContent = status;
  }

  function renderSiteSettingsForm() {
    const site = normalizeSiteSettings(state.site || DEFAULT_SITE_SETTINGS);
    setInputValue("siteHeroKicker", site.heroKicker);
    setInputValue("siteHeroTitle", site.heroTitle);
    setInputValue("siteHeroSubtitle", site.heroSubtitle);
    setInputValue("siteHeroImageUrl", site.heroImageUrl);
    setInputValue("siteStoryTitle", site.storyTitle);
    setInputValue("siteStoryText", site.storyText);
    setInputValue("siteStoryPointOneTitle", site.storyPointOneTitle);
    setInputValue("siteStoryPointOneText", site.storyPointOneText);
    setInputValue("siteStoryPointTwoTitle", site.storyPointTwoTitle);
    setInputValue("siteStoryPointTwoText", site.storyPointTwoText);
    setInputValue("siteStoryPointThreeTitle", site.storyPointThreeTitle);
    setInputValue("siteStoryPointThreeText", site.storyPointThreeText);
    setInputValue("siteMenuTitle", site.menuTitle);
    setInputValue("siteMenuIntro", site.menuIntro);
    setInputValue("siteVisitTitle", site.visitTitle);
    setInputValue("siteVisitText", site.visitText);
    setInputValue("siteContactTitle", site.contactTitle);
    setInputValue("siteAddress", site.address);
    setInputValue("siteHours", site.hours);
    setInputValue("sitePhone", site.phone);
    setInputValue("siteEmail", site.email);
    setInputValue("siteWhatsapp", site.whatsapp);
    setInputValue("siteMapsUrl", site.mapsUrl);
    setInputValue("siteInstagram", site.instagram);
    setInputValue("siteTiktok", site.tiktok);
    setInputValue("siteBackgroundColor", toColor(site.backgroundColor, DEFAULT_SITE_SETTINGS.backgroundColor));
    setInputValue("siteSurfaceColor", toColor(site.surfaceColor, DEFAULT_SITE_SETTINGS.surfaceColor));
    setInputValue("siteAccentColor", toColor(site.accentColor, DEFAULT_SITE_SETTINGS.accentColor));
    setInputValue("siteAccentColorTwo", toColor(site.accentColorTwo, DEFAULT_SITE_SETTINGS.accentColorTwo));
    setInputValue("siteTextColor", toColor(site.textColor, DEFAULT_SITE_SETTINGS.textColor));
    setInputValue("siteMutedColor", toColor(site.mutedColor, DEFAULT_SITE_SETTINGS.mutedColor));
    setFontSelectValue(els.siteTitleFont, site.titleFont);
    setFontSelectValue(els.siteBodyFont, site.bodyFont);
    setInputValue("siteTitleSize", site.titleSize);
    setInputValue("siteBodySize", site.bodySize);
    renderSiteSocialLinksList(site.socialLinks || []);
  }

  function renderSiteEditorForm() {
    if (!state.site || Number(state.site.schemaVersion || 0) < 2) return;
    document.querySelectorAll("[data-site-path]").forEach((input) => {
      const value = getValueAtPath(state.site, input.dataset.sitePath);
      if (input.dataset.siteType === "boolean") input.checked = value !== false;
      else if (input.dataset.siteType === "array") input.value = Array.isArray(value) ? value.join(", ") : "";
      else input.value = value == null ? "" : String(value);
    });
    if (els.siteSectionOrder) els.siteSectionOrder.value = Array.isArray(state.site.sectionOrder) ? state.site.sectionOrder.join(", ") : "";
    renderSiteStatusCards();
    renderSiteNavigationRows();
  }

  function renderSiteStatusCards() {
    if (!els.siteStatusCards) return;
    const site = normalizeSiteSettings(state.site || {});
    const nav = site.header && Array.isArray(site.header.navigation) ? site.header.navigation : [];
    const score = (checks) => {
      const passed = checks.filter(Boolean).length;
      return Math.round((passed / Math.max(1, checks.length)) * 100);
    };
    const cards = [
      { icon: "▤", label: "Header", value: score([site.header && site.header.visible !== false, nav.length, nav.some((item) => item.visible !== false)]), state: "Tamamlandı" },
      { icon: "◈", label: "Hero", value: score([site.hero && site.hero.visible !== false, getValueAtPath(site, "hero.slides.0.title.tr"), getValueAtPath(site, "hero.slides.0.backgroundImage") || getValueAtPath(site, "hero.media.primary")]), state: "Tamamlandı" },
      { icon: "☰", label: "Menü", value: score([site.menuSection && site.menuSection.visible !== false, getValueAtPath(site, "menuSection.title.tr"), getValueAtPath(site, "menuSection.description.tr")]), state: "Tamamlandı" },
      { icon: "ⓘ", label: "Hakkımızda", value: score([site.about && site.about.visible !== false, getValueAtPath(site, "about.title.tr"), getValueAtPath(site, "about.description.tr")]), state: "İyi" },
      { icon: "✉", label: "İletişim", value: score([site.contact && site.contact.visible !== false, getValueAtPath(site, "contact.phone"), getValueAtPath(site, "contact.address.tr") || getValueAtPath(site, "contact.address")]), state: "Tamamlandı" },
      { icon: "◫", label: "Footer / SEO", value: score([site.footer && site.footer.visible !== false, getValueAtPath(site, "seo.title.tr"), getValueAtPath(site, "seo.description.tr")]), state: "İyi" }
    ];
    els.siteStatusCards.innerHTML = cards.map((card) => {
      const ok = card.value >= 95;
      return `
        <article class="site-status-card">
          <span class="site-status-icon">${escapeHTML(card.icon)}</span>
          <div>
            <strong>${escapeHTML(card.label)}</strong>
            <em>${card.value}%</em>
          </div>
          <i style="--site-progress:${card.value}%"></i>
          <small class="${ok ? "is-complete" : ""}">${ok ? "✓" : "↗"} ${escapeHTML(card.state)}</small>
        </article>
      `;
    }).join("");
  }

  function renderSiteNavigationRows() {
    if (!els.siteNavigationRows || !state.site || Number(state.site.schemaVersion || 0) < 2) return;
    const navigation = normalizeHeaderNavigation(state.site.header && state.site.header.navigation);
    state.site.header.navigation = navigation;
    els.siteNavigationRows.innerHTML = `
      <div class="site-nav-table-head" aria-hidden="true">
        <span></span><span>TR Etiket</span><span>EN Etiket</span><span>URL / Hash</span><span>İkon</span><span>Sıra</span><span>Görünür</span><span>İşlem</span>
      </div>
      ${navigation.map((item, index) => `
        <div class="site-nav-row">
          <span class="site-nav-drag" aria-hidden="true">⋮⋮</span>
          <label><span>TR Etiket</span><input data-site-path="header.navigation.${index}.label.tr" type="text" value="${escapeAttribute(item.label && item.label.tr || "")}"></label>
          <label><span>EN Etiket</span><input data-site-path="header.navigation.${index}.label.en" type="text" value="${escapeAttribute(item.label && item.label.en || "")}"></label>
          <label><span>URL / Hash</span><input data-site-path="header.navigation.${index}.url" type="text" value="${escapeAttribute(item.url || "")}"></label>
          <label><span>İkon</span><input data-site-path="header.navigation.${index}.icon" type="text" value="${escapeAttribute(item.icon || "")}"></label>
          <label><span>Sıra</span><input data-site-path="header.navigation.${index}.order" data-site-type="number" type="number" min="0" value="${escapeAttribute(item.order)}"></label>
          <label class="site-nav-switch"><input data-site-path="header.navigation.${index}.visible" data-site-type="boolean" type="checkbox"${item.visible !== false ? " checked" : ""}><span></span></label>
          <button class="line-action site-nav-remove" type="button" data-site-nav-remove="${index}" aria-label="Menü satırını kaldır">•••</button>
        </div>
      `).join("")}
    `;
  }

  function getValueAtPath(source, pathValue) {
    return String(pathValue || "").split(".").filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], source);
  }

  function setValueAtPath(target, pathValue, value) {
    const keys = String(pathValue || "").split(".").filter(Boolean);
    if (!keys.length) return;
    let cursor = target;
    keys.slice(0, -1).forEach((key, index) => {
      const nextKey = keys[index + 1];
      if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = /^\d+$/.test(nextKey) ? [] : {};
      cursor = cursor[key];
    });
    cursor[keys[keys.length - 1]] = value;
  }

  function handleSiteEditorInput(event) {
    const input = event.target && event.target.closest ? event.target.closest("[data-site-path]") : event.currentTarget;
    if (!input || !state.site || Number(state.site.schemaVersion || 0) < 2) return;
    let value = input.value;
    if (input.dataset.siteType === "boolean") value = input.checked;
    if (input.dataset.siteType === "number") value = Number(input.value || 0);
    if (input.dataset.siteType === "array") value = String(input.value || "").split(",").map((item) => item.trim()).filter(Boolean);
    setValueAtPath(state.site, input.dataset.sitePath, value);
    saveSiteSettings();
    if (String(input.dataset.sitePath || "").startsWith("header.navigation.")) renderSiteStatusCards();
  }

  function addSiteNavigationItem() {
    if (!state.site || Number(state.site.schemaVersion || 0) < 2) return;
    state.site.header.navigation = normalizeHeaderNavigation(state.site.header && state.site.header.navigation);
    state.site.header.navigation.push({
      id: `nav-${Date.now()}`,
      label: { tr: "Yeni Menü", en: "New Link" },
      url: "#",
      icon: "fas fa-link",
      visible: true,
      order: state.site.header.navigation.length
    });
    saveSiteSettings();
    renderSiteNavigationRows();
    renderSiteStatusCards();
  }

  function handleSiteNavigationAction(event) {
    const remove = event.target.closest("[data-site-nav-remove]");
    if (!remove || !state.site || Number(state.site.schemaVersion || 0) < 2) return;
    const index = Number(remove.dataset.siteNavRemove);
    state.site.header.navigation = normalizeHeaderNavigation(state.site.header && state.site.header.navigation)
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => Object.assign({}, item, { order: itemIndex }));
    saveSiteSettings();
    renderSiteNavigationRows();
    renderSiteStatusCards();
  }

  function handleSiteSectionOrder() {
    if (!state.site || Number(state.site.schemaVersion || 0) < 2) return;
    state.site.sectionOrder = String(els.siteSectionOrder.value || "").split(",").map((item) => item.trim()).filter(Boolean);
    saveSiteSettings();
  }

  async function handleSiteMediaUpload(event) {
    const input = event.currentTarget;
    const file = input && input.files && input.files[0];
    if (!file || !state.site) return;
    input.disabled = true;
    try {
      const media = await storeMediaFile(file, file.type.startsWith("video/") ? "video" : "image");
      setValueAtPath(state.site, input.dataset.siteUploadTarget, media.src);
      saveSiteSettings();
      renderSiteEditorForm();
      updateSaveControls("Medya yüklendi, yayın bekliyor");
    } catch (error) {
      alert(`Medya yüklenemedi. ${error.message || "Dosyayı kontrol edin."}`);
    } finally {
      input.value = "";
      input.disabled = false;
    }
  }

  async function loadSiteRevisions() {
    if (!backendBaseUrl() || !els.siteRevisionList) return;
    els.siteRevisionList.textContent = "Yükleniyor...";
    try {
      const result = await backendRequest("/api/admin/site/revisions");
      state.siteRevisions = Array.isArray(result.revisions) ? result.revisions : [];
      renderSiteRevisions();
    } catch (error) {
      els.siteRevisionList.textContent = error.message || "Revizyonlar alınamadı.";
    }
  }

  function renderSiteRevisions() {
    if (!els.siteRevisionList) return;
    els.siteRevisionList.innerHTML = state.siteRevisions.length ? state.siteRevisions.map((revision) => `
      <article class="icon-link-item">
        <div><strong>${escapeHTML(new Date(revision.createdAt).toLocaleString("tr-TR"))}</strong><small>${escapeHTML(revision.id)}</small></div>
        <button class="line-action" type="button" data-site-revision-id="${escapeAttribute(revision.id)}">Geri Yükle</button>
      </article>
    `).join("") : "Henüz geri alınabilir yayın yok.";
  }

  async function handleSiteRevisionRestore(event) {
    const button = event.target.closest("[data-site-revision-id]");
    if (!button || !confirm("Bu site yayınını geri yüklemek istiyor musunuz?")) return;
    try {
      const result = await backendRequest(`/api/admin/site/revisions/${encodeURIComponent(button.dataset.siteRevisionId)}/restore`, { method: "POST" });
      state.site = normalizeSiteSettings(result.siteState);
      state.dirtySite = false;
      renderSiteEditorForm();
      await loadSiteRevisions();
      updateSaveControls("Revizyon geri yüklendi");
    } catch (error) {
      alert(`Revizyon geri yüklenemedi. ${error.message || ""}`);
    }
  }

  function renderSiteSocialLinksList(links) {
    if (!els.siteSocialLinksList) return;
    const normalized = normalizeSocialLinks(links);
    els.siteSocialLinksList.innerHTML = normalized.length
      ? normalized.map((link, index) => {
        const icon = SITE_ICON_OPTIONS.find(([value]) => value === link.icon) || SITE_ICON_OPTIONS[SITE_ICON_OPTIONS.length - 1];
        return `
          <article class="icon-link-item">
            <span>${escapeHTML(icon[2])}</span>
            <strong>${escapeHTML(link.label)}</strong>
            <small>${escapeHTML(link.url)}</small>
            <button class="danger-mini" type="button" data-remove-site-social="${index}">Sil</button>
          </article>
        `;
      }).join("")
      : `<div class="empty-mini">Ek ikonlu bağlantı yok.</div>`;
  }

  function addSiteSocialLink() {
    if (!els.siteSocialLabel || !els.siteSocialUrl || !els.siteSocialIcon) return;
    const label = els.siteSocialLabel.value.trim();
    const url = els.siteSocialUrl.value.trim();
    if (!label || !url) return;
    const site = normalizeSiteSettings(state.site || DEFAULT_SITE_SETTINGS);
    site.socialLinks = normalizeSocialLinks(site.socialLinks || []);
    site.socialLinks.push({
      label,
      url,
      icon: els.siteSocialIcon.value || "web"
    });
    state.site = normalizeSiteSettings(site);
    els.siteSocialLabel.value = "";
    els.siteSocialUrl.value = "";
    saveSiteSettings();
    renderSiteSettingsForm();
  }

  function removeSiteSocialLink(event) {
    const button = event.target.closest("[data-remove-site-social]");
    if (!button) return;
    const index = Number(button.dataset.removeSiteSocial);
    const site = normalizeSiteSettings(state.site || DEFAULT_SITE_SETTINGS);
    site.socialLinks = normalizeSocialLinks(site.socialLinks || []).filter((_, itemIndex) => itemIndex !== index);
    state.site = normalizeSiteSettings(site);
    saveSiteSettings();
    renderSiteSettingsForm();
  }

  function applyPremiumSiteTheme() {
    const site = normalizeSiteSettings(state.site || DEFAULT_SITE_SETTINGS);
    state.site = normalizeSiteSettings(Object.assign({}, site, PREMIUM_SITE_PALETTE, {
      heroImageUrl: "/assets/brand/logo-primary.png"
    }));
    saveSiteSettings();
    renderSiteSettingsForm();
  }

  function setInputValue(id, value) {
    if (!els[id]) return;
    els[id].value = value || "";
  }

  function clearProductForm() {
    [
      "productName", "productDesc", "standardPrice", "priceK", "priceO", "priceB", "priceSingle", "priceDouble", "productImageUrl",
      "productCalories", "productAllergens", "productIngredients"
    ].forEach((id) => {
      els[id].value = "";
    });
    els.priceMode.value = "standard";
    els.productStock.value = "active";
    els.productKind.value = "drink";
    els.productTemperature.value = "none";
    els.productPopular.checked = false;
    els.productActive.checked = true;
    if (els.productContentMode) els.productContentMode.value = "manual";
    if (els.productRecipeId) els.productRecipeId.innerHTML = `<option value="">Bağlantı yok</option>`;
    if (els.productRecipeSize) els.productRecipeSize.innerHTML = `<option value="">Otomatik</option>`;
    if (els.productRecipeLinkStatus) els.productRecipeLinkStatus.textContent = "Reçete bağlantısı seçilmedi.";
    renderPriceModeFields();
    renderImagePreview(els.productImagePreview, "", "Ürün görseli yok");
  }

  function renderProductNavigation() {
    if (!els.productCategoryTabs || !els.productQuickList) return;
    const category = selectedCategory();
    const product = selectedProductStrict();
    els.productCategoryTabs.innerHTML = `
      <label class="product-select-field">
        <span>Kategori seç</span>
        <select data-product-category-select>
          <option value="">Kategori seç</option>
          ${state.data.categories.map((item) => `
            <option value="${escapeAttribute(item.id)}"${category && item.id === category.id ? " selected" : ""}>${escapeHTML(item.name)}</option>
          `).join("")}
        </select>
      </label>
    `;

    els.productQuickList.innerHTML = `
      <label class="product-select-field">
        <span>Ürün seç</span>
        <select data-product-select${!category ? " disabled" : ""}>
          <option value="">Ürün seç</option>
          ${(category && category.products.length ? category.products : []).map((item) => `
            <option value="${escapeAttribute(item.id)}"${product && item.id === product.id ? " selected" : ""}>${escapeHTML(item.name)}</option>
          `).join("")}
        </select>
      </label>
      <p class="product-selection-status">${product ? `Seçili ürün: ${escapeHTML(product.name)} (${escapeHTML(category.name)})` : "Ürün seçilince detay alanı açılır."}</p>
    `;
  }

  function renderCategoryIconOptions(category) {
    if (!els.categoryIconKey) return;
    const current = normalizeCategoryIconKey(category.iconKey || category.icon, category.name);
    els.categoryIconKey.innerHTML = CATEGORY_ICON_REGISTRY.options().map((item) => (
      `<option value="${escapeAttribute(item.key)}">${escapeHTML(`${item.mark || ""} ${item.label}`.trim())}</option>`
    )).join("");
    els.categoryIconKey.value = current;
  }

  function handleProductCategoryTabs(event) {
    const select = event.target.closest("[data-product-category-select]");
    const button = event.target.closest("[data-product-category-tab]");
    if (!button && !select) return;
    state.selectedCategoryId = select ? select.value : button.dataset.productCategoryTab;
    const category = selectedCategory();
    state.allowEmptyProductSelection = Boolean(select);
    state.selectedProductId = select ? "" : (category && category.products[0] ? category.products[0].id : "");
    setActiveSection("product", { collapseSidebar: false, render: false });
    renderAll();
  }

  function handleProductQuickList(event) {
    const select = event.target.closest("[data-product-select]");
    const button = event.target.closest("[data-product-chip]");
    if (!button && !select) return;
    state.selectedProductId = select ? select.value : button.dataset.productChip;
    if (!state.selectedProductId && button) state.selectedProductId = button.dataset.productChip;
    state.allowEmptyProductSelection = !state.selectedProductId;
    setActiveSection("product", { collapseSidebar: false, render: false });
    renderAll();
  }

  function handleProductEditorCardClick(event) {
    const addButton = event.target.closest("[data-product-add-inline]");
    if (!addButton) return;
    event.preventDefault();
    event.stopPropagation();
    addProduct();
  }

  function bindMenuOutputEvents() {
    // Menü Çıktısı modülü geçici olarak pasif. İleride tekrar aktif edilebilir.
    // Export/indirme fonksiyonları silinmedi; modül normal panel akışından açılmadığı için kullanılmaz durumdadır.
    [
      "menuOutputBgColor", "menuOutputBoxColor", "menuOutputTextColor",
      "menuOutputTitleFont", "menuOutputBodyFont", "menuOutputPriceFont",
      "menuOutputProductSize", "menuOutputRowGap", "menuOutputDate",
      "menuOutputTemplateName", "menuOutputCanvaLink"
    ].forEach((id) => {
      if (!els[id]) return;
      els[id].addEventListener("input", updateMenuOutputFromControls);
      els[id].addEventListener("change", updateMenuOutputFromControls);
    });
    if (els.menuOutputAddSection) els.menuOutputAddSection.addEventListener("click", addMenuOutputSection);
    if (els.menuOutputSectionList) {
      els.menuOutputSectionList.addEventListener("input", handleMenuOutputSectionInput);
      els.menuOutputSectionList.addEventListener("change", handleMenuOutputSectionInput);
      els.menuOutputSectionList.addEventListener("click", handleMenuOutputSectionClick);
    }
    if (els.menuOutputLayerList) els.menuOutputLayerList.addEventListener("click", handleMenuOutputLayerClick);
    if (els.menuOutputControlTabs) els.menuOutputControlTabs.addEventListener("click", handleMenuOutputControlTabClick);
    if (els.menuOutputPreview) els.menuOutputPreview.addEventListener("pointerdown", startMenuOutputSectionPointer);
    if (els.menuOutputTemplateList) els.menuOutputTemplateList.addEventListener("click", handleMenuOutputTemplateClick);
    if (els.menuOutputSaveTemplate) els.menuOutputSaveTemplate.addEventListener("click", saveMenuOutputTemplate);
    if (els.menuOutputUpdateTemplate) els.menuOutputUpdateTemplate.addEventListener("click", updateMenuOutputTemplate);
    if (els.menuOutputDuplicateTemplate) els.menuOutputDuplicateTemplate.addEventListener("click", duplicateMenuOutputTemplate);
    if (els.menuOutputDeleteTemplate) els.menuOutputDeleteTemplate.addEventListener("click", deleteMenuOutputTemplate);
    if (els.menuOutputSetDefaultTemplate) els.menuOutputSetDefaultTemplate.addEventListener("click", setDefaultMenuOutputTemplate);
    if (els.menuOutputOpenCanva) els.menuOutputOpenCanva.addEventListener("click", openMenuOutputCanva);
    if (els.menuOutputReset) els.menuOutputReset.addEventListener("click", resetMenuOutputDesign);
    if (els.menuOutputExportPng) els.menuOutputExportPng.addEventListener("click", () => exportMenuOutputImage("png"));
    if (els.menuOutputExportJpg) els.menuOutputExportJpg.addEventListener("click", () => exportMenuOutputImage("jpg"));
    if (els.menuOutputExportPdf) els.menuOutputExportPdf.addEventListener("click", exportMenuOutputPdf);
    if (els.menuOutputZoomOut) els.menuOutputZoomOut.addEventListener("click", () => setMenuOutputZoom(menuOutputPreviewScale() - 0.1));
    if (els.menuOutputZoomIn) els.menuOutputZoomIn.addEventListener("click", () => setMenuOutputZoom(menuOutputPreviewScale() + 0.1));
    if (els.menuOutputFitPreview) els.menuOutputFitPreview.addEventListener("click", fitMenuOutputPreview);
    if (els.menuOutputZoomActual) els.menuOutputZoomActual.addEventListener("click", () => setMenuOutputZoom(1));
    if (els.menuOutputGridToggle) els.menuOutputGridToggle.addEventListener("click", toggleMenuOutputGrid);
    if (els.menuOutputSafeAreaToggle) els.menuOutputSafeAreaToggle.addEventListener("click", toggleMenuOutputSafeArea);
    if (els.menuOutputFullscreen) els.menuOutputFullscreen.addEventListener("click", toggleMenuOutputFullscreen);
    window.addEventListener("resize", applyMenuOutputZoom);
    document.addEventListener("fullscreenchange", syncMenuOutputFullscreenState);
  }

  function menuOutputPreviewScale() {
    if (state.menuOutputZoom > 0) return state.menuOutputZoom;
    if (!els.menuOutputPreviewStage) return 0.3;
    const width = Math.max(1, els.menuOutputPreviewStage.clientWidth - 34);
    const height = Math.max(1, els.menuOutputPreviewStage.clientHeight - 34);
    return clamp(Math.min(width / MENU_OUTPUT_WIDTH, height / MENU_OUTPUT_HEIGHT), MENU_OUTPUT_MIN_ZOOM, MENU_OUTPUT_MAX_ZOOM);
  }

  function setMenuOutputZoom(value) {
    state.menuOutputZoom = clamp(Number(value) || 1, MENU_OUTPUT_MIN_ZOOM, MENU_OUTPUT_MAX_ZOOM);
    applyMenuOutputZoom();
  }

  function fitMenuOutputPreview() {
    state.menuOutputZoom = 0;
    applyMenuOutputZoom();
  }

  function handleMenuOutputControlTabClick(event) {
    const button = event.target.closest("[data-menu-output-tab]");
    if (!button) return;
    setMenuOutputControlTab(button.dataset.menuOutputTab);
  }

  function setMenuOutputControlTab(tab) {
    const allowed = ["sections", "style", "layers", "templates", "output"];
    state.menuOutputControlTab = allowed.includes(tab) ? tab : "sections";
    document.querySelectorAll("[data-menu-output-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.menuOutputTab === state.menuOutputControlTab);
    });
    document.querySelectorAll("[data-menu-output-control-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.menuOutputControlPanel === state.menuOutputControlTab);
    });
  }

  function toggleMenuOutputGrid() {
    const menuOutput = ensureMenuOutputState();
    menuOutput.gridEnabled = !menuOutput.gridEnabled;
    saveMenuOutputState(true);
  }

  function toggleMenuOutputSafeArea() {
    const menuOutput = ensureMenuOutputState();
    menuOutput.safeAreaEnabled = !menuOutput.safeAreaEnabled;
    saveMenuOutputState(true);
  }

  function applyMenuOutputZoom() {
    if (!els.menuOutputPreview || !els.menuOutputCanvasShell) return;
    const scale = menuOutputPreviewScale();
    els.menuOutputPreview.style.setProperty("--menu-output-preview-scale", scale.toFixed(4));
    els.menuOutputCanvasShell.style.width = `${Math.round(MENU_OUTPUT_WIDTH * scale)}px`;
    els.menuOutputCanvasShell.style.height = `${Math.round(MENU_OUTPUT_HEIGHT * scale)}px`;
    if (els.menuOutputZoomValue) {
      els.menuOutputZoomValue.textContent = state.menuOutputZoom > 0 ? `%${Math.round(scale * 100)}` : `Sığdır · %${Math.round(scale * 100)}`;
    }
  }

  async function toggleMenuOutputFullscreen() {
    const target = els.menuOutputPreviewStage;
    if (!target) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (!target.requestFullscreen) throw new Error("Fullscreen API desteklenmiyor");
      await target.requestFullscreen();
    } catch (_error) {
      showMenuOutputNotice("Tam ekran modu tarayıcı tarafından engellendi.");
    }
  }

  function syncMenuOutputFullscreenState() {
    state.menuOutputFullscreen = document.fullscreenElement === els.menuOutputPreviewStage;
    if (els.menuOutputFullscreen) {
      els.menuOutputFullscreen.textContent = state.menuOutputFullscreen ? "Tam ekrandan çık" : "Tam ekran";
    }
    applyMenuOutputZoom();
  }

  function showMenuOutputNotice(message) {
    if (!els.menuOutputStatus) return;
    window.clearTimeout(state.menuOutputNoticeTimer);
    els.menuOutputStatus.classList.add("is-warning");
    els.menuOutputStatus.textContent = message;
    state.menuOutputNoticeTimer = window.setTimeout(() => {
      els.menuOutputStatus.classList.remove("is-warning");
      renderMenuOutputPreview(ensureMenuOutputState());
    }, 3600);
  }

  function ensureMenuOutputState() {
    if (!state.data) return normalizeMenuOutput(null);
    if (!state.data.settings) state.data.settings = {};
    state.data.settings.menuOutput = normalizeMenuOutput(state.data.settings.menuOutput);
    return state.data.settings.menuOutput;
  }

  function normalizeMenuOutput(value) {
    const source = value && typeof value === "object" ? value : {};
    const settings = Object.assign({}, DEFAULT_MENU_OUTPUT.settings, source.settings || {});
    settings.productSize = clamp(Number(settings.productSize || DEFAULT_MENU_OUTPUT.settings.productSize), 12, 72);
    settings.rowGap = clamp(Number(settings.rowGap || DEFAULT_MENU_OUTPUT.settings.rowGap), 10, 90);
    return {
      templateName: source.templateName || DEFAULT_MENU_OUTPUT.templateName,
      currentTemplateId: source.currentTemplateId || "",
      defaultTemplateId: source.defaultTemplateId || "",
      canvaLink: source.canvaLink || DEFAULT_MENU_OUTPUT.canvaLink,
      gridEnabled: source.gridEnabled !== false,
      safeAreaEnabled: source.safeAreaEnabled !== false,
      settings,
      sections: Array.isArray(source.sections) ? source.sections.map(normalizeMenuOutputSection).filter(Boolean) : [],
      templates: Array.isArray(source.templates) ? source.templates.map(normalizeMenuOutputTemplate).filter(Boolean) : []
    };
  }

  function normalizeMenuOutputSection(section, index) {
    if (!section || typeof section !== "object") return null;
    const type = ["main", "bottom", "right", "small"].includes(section.type) ? section.type : "main";
    const base = menuOutputDefaultLayout(type, index || 0);
    const normalized = Object.assign({
      id: section.id || makeId("menu-output", `alan-${index || 0}`),
      title: section.title || "SPECIAL",
      type,
      mode: ["category", "manual", "all"].includes(section.mode) ? section.mode : "category",
      categoryId: section.categoryId || "",
      productIds: Array.isArray(section.productIds) ? section.productIds : [],
      bgColor: "",
      titleColor: "",
      textColor: "",
      font: "",
      fontSize: 0,
      rowGap: 0,
      showPrices: true,
      showDescription: false,
      icon: "",
      iconOpacity: 0.85,
      bgIcon: "",
      bgIconOpacity: 0.12,
      frame: "shadow",
      offsetX: 0,
      offsetY: 0,
      x: base.x + Number(section.offsetX || 0),
      y: base.y + Number(section.offsetY || 0),
      width: base.w,
      height: base.h,
      zIndex: (index || 0) + 10,
      hidden: false,
      locked: false,
      overflow: false,
      overflowCount: 0
    }, section);
    normalized.x = Number.isFinite(Number(normalized.x)) ? Number(normalized.x) : base.x;
    normalized.y = Number.isFinite(Number(normalized.y)) ? Number(normalized.y) : base.y;
    normalized.width = Number(normalized.width) > 0 ? Number(normalized.width) : base.w;
    normalized.height = Number(normalized.height) > 0 ? Number(normalized.height) : base.h;
    normalized.zIndex = Number.isFinite(Number(normalized.zIndex)) ? Number(normalized.zIndex) : (index || 0) + 10;
    normalized.hidden = normalized.hidden === true;
    normalized.locked = normalized.locked === true;
    normalized.overflow = normalized.overflow === true;
    normalized.overflowCount = Math.max(0, Number(normalized.overflowCount || 0));
    return normalized;
  }

  function normalizeMenuOutputTemplate(template) {
    if (!template || typeof template !== "object") return null;
    const snapshot = template.snapshot && typeof template.snapshot === "object" ? template.snapshot : {};
    return {
      id: template.id || makeId("menu-output-template", template.name || "şablon"),
      name: template.name || "Menü şablonu",
      snapshot: normalizeMenuOutput(snapshot),
      createdAt: template.createdAt || new Date().toISOString(),
      updatedAt: template.updatedAt || template.createdAt || new Date().toISOString()
    };
  }

  function saveMenuOutputState(render) {
    ensureMenuOutputState();
    safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
    markDirty("menu");
    if (render !== false) renderMenuOutput();
  }

  function updateMenuOutputFromControls() {
    const menuOutput = ensureMenuOutputState();
    menuOutput.templateName = els.menuOutputTemplateName ? els.menuOutputTemplateName.value.trim() || menuOutput.templateName : menuOutput.templateName;
    menuOutput.canvaLink = els.menuOutputCanvaLink ? els.menuOutputCanvaLink.value.trim() : menuOutput.canvaLink;
    menuOutput.settings = Object.assign({}, menuOutput.settings, {
      bgColor: els.menuOutputBgColor ? els.menuOutputBgColor.value : menuOutput.settings.bgColor,
      boxColor: els.menuOutputBoxColor ? els.menuOutputBoxColor.value : menuOutput.settings.boxColor,
      textColor: els.menuOutputTextColor ? els.menuOutputTextColor.value : menuOutput.settings.textColor,
      titleFont: els.menuOutputTitleFont ? els.menuOutputTitleFont.value : menuOutput.settings.titleFont,
      bodyFont: els.menuOutputBodyFont ? els.menuOutputBodyFont.value : menuOutput.settings.bodyFont,
      priceFont: els.menuOutputPriceFont ? els.menuOutputPriceFont.value : menuOutput.settings.priceFont,
      productSize: els.menuOutputProductSize ? Number(els.menuOutputProductSize.value || 28) : menuOutput.settings.productSize,
      rowGap: els.menuOutputRowGap ? Number(els.menuOutputRowGap.value || 34) : menuOutput.settings.rowGap,
      dateText: els.menuOutputDate ? els.menuOutputDate.value.trim() : menuOutput.settings.dateText
    });
    saveMenuOutputState(true);
  }

  function createMenuOutputSection(type, index) {
    const firstCategory = state.data && state.data.categories && state.data.categories[0] ? state.data.categories[0].id : "";
    return normalizeMenuOutputSection({
      id: makeId("menu-output", Date.now()),
      title: els.menuOutputSectionTitle ? els.menuOutputSectionTitle.value.trim() || "SPECIAL" : "SPECIAL",
      type: type || (els.menuOutputSectionType ? els.menuOutputSectionType.value : "main"),
      mode: els.menuOutputSectionMode ? els.menuOutputSectionMode.value : "category",
      categoryId: els.menuOutputSectionCategory ? els.menuOutputSectionCategory.value || firstCategory : firstCategory,
      icon: "",
      bgIcon: ""
    }, index || 0);
  }

  function addMenuOutputSection() {
    const menuOutput = ensureMenuOutputState();
    const section = createMenuOutputSection(null, menuOutput.sections.length);
    menuOutput.sections.push(section);
    state.selectedMenuOutputSectionId = section.id;
    saveMenuOutputState(true);
  }

  function renderMenuOutput() {
    if (!els.menuOutputCard) return;
    const menuOutput = ensureMenuOutputState();
    renderMenuOutputControls(menuOutput);
    renderMenuOutputSections(menuOutput);
    renderMenuOutputLayers(menuOutput);
    renderMenuOutputTemplates(menuOutput);
    renderMenuOutputQualityPanel(menuOutput);
    renderMenuOutputPreview(menuOutput);
    setMenuOutputControlTab(state.menuOutputControlTab);
  }

  function renderMenuOutputControls(menuOutput) {
    if (els.menuOutputTemplateName) els.menuOutputTemplateName.value = menuOutput.templateName || "";
    if (els.menuOutputCanvaLink) els.menuOutputCanvaLink.value = menuOutput.canvaLink || "";
    if (els.menuOutputBgColor) els.menuOutputBgColor.value = menuOutput.settings.bgColor || DEFAULT_MENU_OUTPUT.settings.bgColor;
    if (els.menuOutputBoxColor) els.menuOutputBoxColor.value = menuOutput.settings.boxColor || DEFAULT_MENU_OUTPUT.settings.boxColor;
    if (els.menuOutputTextColor) els.menuOutputTextColor.value = menuOutput.settings.textColor || DEFAULT_MENU_OUTPUT.settings.textColor;
    setFontSelectValue(els.menuOutputTitleFont, menuOutput.settings.titleFont || BRAND_BODY_FONT);
    setFontSelectValue(els.menuOutputBodyFont, menuOutput.settings.bodyFont || BRAND_BODY_FONT);
    setFontSelectValue(els.menuOutputPriceFont, menuOutput.settings.priceFont || BRAND_BODY_FONT);
    if (els.menuOutputProductSize) els.menuOutputProductSize.value = menuOutput.settings.productSize || 28;
    if (els.menuOutputRowGap) els.menuOutputRowGap.value = menuOutput.settings.rowGap || 34;
    if (els.menuOutputDate) els.menuOutputDate.value = menuOutput.settings.dateText || "";
    if (els.menuOutputGridToggle) {
      els.menuOutputGridToggle.textContent = menuOutput.gridEnabled ? "Grid açık" : "Grid kapalı";
      els.menuOutputGridToggle.classList.toggle("is-active", menuOutput.gridEnabled);
    }
    if (els.menuOutputSafeAreaToggle) {
      els.menuOutputSafeAreaToggle.textContent = menuOutput.safeAreaEnabled ? "Güvenli alan" : "Güvenli alan kapalı";
      els.menuOutputSafeAreaToggle.classList.toggle("is-active", menuOutput.safeAreaEnabled);
    }
    renderMenuOutputCategorySelect();
  }

  function renderMenuOutputCategorySelect() {
    if (!els.menuOutputSectionCategory || !state.data) return;
    const options = state.data.categories.map((category) => `
      <option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>
    `).join("");
    els.menuOutputSectionCategory.innerHTML = options;
  }

  function renderMenuOutputSections(menuOutput) {
    if (!els.menuOutputSectionList) return;
    if (!menuOutput.sections.length) {
      els.menuOutputSectionList.innerHTML = `<div class="empty-mini">Henüz alan yok. Alan Ekle ile başlayın.</div>`;
      return;
    }
    const categories = menuOutputCategoryOptions();
    const products = menuOutputProducts();
    els.menuOutputSectionList.innerHTML = menuOutput.sections.map((section, index) => {
      const selected = section.id === state.selectedMenuOutputSectionId;
      const diagnostics = menuOutputSectionDiagnostics(section, menuOutput);
      const statusBadges = [
        section.hidden ? `<span class="menu-output-badge">Gizli</span>` : "",
        section.locked ? `<span class="menu-output-badge">Kilitli</span>` : "",
        diagnostics.hasMissingData ? `<span class="menu-output-badge is-warning">Eksik veri</span>` : "",
        diagnostics.overflowCount > 0 ? `<span class="menu-output-badge is-warning">${diagnostics.overflowCount} ürün taşıyor</span>` : ""
      ].filter(Boolean).join("");
      return `
        <article class="menu-output-section-item${selected ? " is-active" : ""}${section.hidden ? " is-hidden" : ""}${section.locked ? " is-locked" : ""}" data-menu-output-section="${escapeAttribute(section.id)}">
          <div class="section-item-head">
            <div class="menu-output-section-title">
              <strong>${escapeHTML(section.title || `Alan ${index + 1}`)}</strong>
              <span>${statusBadges}</span>
            </div>
            <div>
              <button class="line-action" type="button" data-menu-output-action="duplicate">Kopyala</button>
              <button class="line-action" type="button" data-menu-output-action="visibility">${section.hidden ? "Göster" : "Gizle"}</button>
              <button class="line-action" type="button" data-menu-output-action="lock">${section.locked ? "Kilidi aç" : "Kilitle"}</button>
              <button class="line-action" type="button" data-menu-output-action="forward"${section.locked ? " disabled" : ""}>Öne</button>
              <button class="line-action" type="button" data-menu-output-action="backward"${section.locked ? " disabled" : ""}>Arkaya</button>
              <button class="danger-mini" type="button" data-menu-output-delete${section.locked ? " disabled" : ""}>Sil</button>
            </div>
          </div>
          ${diagnostics.messages.length ? `<div class="menu-output-section-warnings">${diagnostics.messages.map((message) => `<span>${escapeHTML(message)}</span>`).join("")}</div>` : ""}
          <fieldset class="menu-output-section-fields"${section.locked ? " disabled" : ""}>
          <div class="form-grid three">
            <label><span>Başlık</span><input data-menu-output-field="title" value="${escapeAttribute(section.title)}"></label>
            <label><span>Alan tipi</span><select data-menu-output-field="type">${menuOutputOptions([["main","Ana büyük liste"],["bottom","Alt yatay kategori"],["right","Sağ küçük kategori"],["small","Extra/küçük kart"]], section.type)}</select></label>
            <label><span>Ürün seçimi</span><select data-menu-output-field="mode">${menuOutputOptions([["category","Tüm kategori"],["manual","Manuel"],["all","Tüm menü"]], section.mode)}</select></label>
            <label><span>Kategori</span><select data-menu-output-field="categoryId">${menuOutputOptions(categories, section.categoryId)}</select></label>
            <label><span>Kutu rengi</span><input type="color" data-menu-output-field="bgColor" value="${escapeAttribute(section.bgColor || menuOutput.settings.boxColor)}"></label>
            <label><span>Başlık rengi</span><input type="color" data-menu-output-field="titleColor" value="${escapeAttribute(section.titleColor || menuOutput.settings.textColor)}"></label>
            <label><span>Yazı rengi</span><input type="color" data-menu-output-field="textColor" value="${escapeAttribute(section.textColor || menuOutput.settings.textColor)}"></label>
            <label><span>Font</span><select data-menu-output-field="font">${menuOutputOptions(FONT_OPTIONS.map(([label, value]) => [value, label]), section.font || menuOutput.settings.bodyFont)}</select></label>
            <label><span>Punto</span><input type="number" min="12" max="64" data-menu-output-field="fontSize" value="${escapeAttribute(section.fontSize || menuOutput.settings.productSize)}"></label>
            <label><span>Satır aralığı</span><input type="number" min="10" max="90" data-menu-output-field="rowGap" value="${escapeAttribute(section.rowGap || menuOutput.settings.rowGap)}"></label>
            <label><span>İkon</span><select data-menu-output-field="icon">${menuOutputOptions(MENU_OUTPUT_ICON_OPTIONS.map(([value, label, mark]) => [value, `${mark ? `${mark} ` : ""}${label}`]), section.icon || "")}</select></label>
            <label><span>Arka plan ikonu</span><select data-menu-output-field="bgIcon">${menuOutputOptions(MENU_OUTPUT_ICON_OPTIONS.map(([value, label, mark]) => [value, `${mark ? `${mark} ` : ""}${label}`]), section.bgIcon || "")}</select></label>
            <label><span>İkon opacity</span><input type="number" min="0" max="1" step="0.05" data-menu-output-field="iconOpacity" value="${escapeAttribute(section.iconOpacity ?? 0.85)}"></label>
            <label><span>Arka ikon opacity</span><input type="number" min="0" max="0.7" step="0.05" data-menu-output-field="bgIconOpacity" value="${escapeAttribute(section.bgIconOpacity ?? 0.12)}"></label>
            <label><span>Çerçeve/dekor</span><select data-menu-output-field="frame">${menuOutputOptions(MENU_OUTPUT_FRAME_OPTIONS, section.frame || "shadow")}</select></label>
            <label><span>X</span><input type="number" step="8" data-menu-output-field="x" value="${escapeAttribute(Math.round(section.x))}"></label>
            <label><span>Y</span><input type="number" step="8" data-menu-output-field="y" value="${escapeAttribute(Math.round(section.y))}"></label>
            <label><span>Genişlik</span><input type="number" min="180" max="1080" step="8" data-menu-output-field="width" value="${escapeAttribute(Math.round(section.width))}"></label>
            <label><span>Yükseklik</span><input type="number" min="140" max="1920" step="8" data-menu-output-field="height" value="${escapeAttribute(Math.round(section.height))}"></label>
            <label><span>Katman</span><input type="number" min="0" max="999" step="1" data-menu-output-field="zIndex" value="${escapeAttribute(Math.round(section.zIndex))}"></label>
          </div>
          <div class="form-grid two">
            <label class="toggle-row"><input type="checkbox" data-menu-output-field="showPrices" ${section.showPrices !== false ? "checked" : ""}><span>Fiyat kolonları</span></label>
            <label class="toggle-row"><input type="checkbox" data-menu-output-field="showDescription" ${section.showDescription ? "checked" : ""}><span>Açıklama / içerik</span></label>
          </div>
          <div class="menu-output-product-picker" ${section.mode === "manual" ? "" : "hidden"}>
            ${products.map(({ category, product }) => `
              <label class="toggle-row">
                <input type="checkbox" data-menu-output-product="${escapeAttribute(product.id)}" ${section.productIds.includes(product.id) ? "checked" : ""}>
                <span>${escapeHTML(category.name)} / ${escapeHTML(product.name)}</span>
              </label>
            `).join("")}
          </div>
          </fieldset>
        </article>
      `;
    }).join("");
  }

  function handleMenuOutputSectionInput(event) {
    const container = event.target.closest("[data-menu-output-section]");
    if (!container) return;
    const menuOutput = ensureMenuOutputState();
    const section = menuOutput.sections.find((item) => item.id === container.dataset.menuOutputSection);
    if (!section || section.locked) return;
    state.selectedMenuOutputSectionId = section.id;
    const productInput = event.target.closest("[data-menu-output-product]");
    if (productInput) {
      const id = productInput.dataset.menuOutputProduct;
      section.productIds = productInput.checked
        ? Array.from(new Set([...(section.productIds || []), id]))
        : (section.productIds || []).filter((item) => item !== id);
      saveMenuOutputState(true);
      return;
    }
    const control = event.target.closest("[data-menu-output-field]");
    if (!control) return;
    const field = control.dataset.menuOutputField;
    if (["showPrices", "showDescription"].includes(field)) section[field] = control.checked;
    else if (["fontSize", "rowGap", "iconOpacity", "bgIconOpacity", "x", "y", "width", "height", "zIndex"].includes(field)) section[field] = Number(control.value || 0);
    else section[field] = control.value;
    if (["x", "y", "width", "height"].includes(field)) constrainMenuOutputSection(section);
    if (field === "mode") renderMenuOutputSections(menuOutput);
    saveMenuOutputState(true);
  }

  function handleMenuOutputSectionClick(event) {
    const container = event.target.closest("[data-menu-output-section]");
    if (container) state.selectedMenuOutputSectionId = container.dataset.menuOutputSection;
    const menuOutput = ensureMenuOutputState();
    const section = container ? menuOutput.sections.find((item) => item.id === container.dataset.menuOutputSection) : null;
    if (!section) return;
    const action = event.target.closest("[data-menu-output-action]");
    if (action) {
      if (action.dataset.menuOutputAction === "duplicate") {
        duplicateMenuOutputSection(menuOutput, section);
      } else if (action.dataset.menuOutputAction === "visibility") {
        section.hidden = !section.hidden;
      } else if (action.dataset.menuOutputAction === "lock") {
        section.locked = !section.locked;
      } else if (action.dataset.menuOutputAction === "forward" || action.dataset.menuOutputAction === "backward") {
        if (section.locked) return;
        moveMenuOutputSectionLayer(menuOutput, section, action.dataset.menuOutputAction);
      }
      saveMenuOutputState(true);
      return;
    }
    if (event.target.closest("[data-menu-output-delete]")) {
      if (section.locked) return;
      if (!confirm("Bu menü çıktı alanı silinsin mi?")) return;
      deleteMenuOutputSection(menuOutput, section);
      saveMenuOutputState(true);
      return;
    }
    if (!event.target.closest("input,select,button,label")) selectMenuOutputSection(section.id);
  }

  function duplicateMenuOutputSection(menuOutput, section) {
    const nextZ = Math.max(0, ...menuOutput.sections.map((item) => Number(item.zIndex || 0))) + 1;
    const copy = normalizeMenuOutputSection(Object.assign({}, cloneData(section), {
      id: makeId("menu-output", Date.now()),
      title: `${section.title || "Alan"} Kopya`,
      x: Number(section.x || 0) + 16,
      y: Number(section.y || 0) + 16,
      zIndex: nextZ,
      hidden: false,
      locked: false
    }), menuOutput.sections.length);
    constrainMenuOutputSection(copy);
    const index = menuOutput.sections.findIndex((item) => item.id === section.id);
    menuOutput.sections.splice(index + 1, 0, copy);
    state.selectedMenuOutputSectionId = copy.id;
    return copy;
  }

  function deleteMenuOutputSection(menuOutput, section) {
    menuOutput.sections = menuOutput.sections.filter((item) => item.id !== section.id);
    state.selectedMenuOutputSectionId = menuOutput.sections[0] ? menuOutput.sections[0].id : "";
  }

  function moveMenuOutputSectionLayer(menuOutput, section, direction) {
    const ordered = [...menuOutput.sections].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
    const index = ordered.findIndex((item) => item.id === section.id);
    const targetIndex = direction === "forward" ? index + 1 : index - 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const target = ordered[targetIndex];
    const currentZ = Number(section.zIndex || 0);
    section.zIndex = Number(target.zIndex || 0);
    target.zIndex = currentZ;
  }

  function selectMenuOutputSection(id) {
    const menuOutput = ensureMenuOutputState();
    if (!menuOutput.sections.some((section) => section.id === id)) return;
    state.selectedMenuOutputSectionId = id;
    renderMenuOutputSections(menuOutput);
    renderMenuOutputLayers(menuOutput);
    renderMenuOutputPreview(menuOutput);
  }

  function renderMenuOutputLayers(menuOutput) {
    if (!els.menuOutputLayerList) return;
    const sorted = [...menuOutput.sections].sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0));
    els.menuOutputLayerList.innerHTML = sorted.length ? sorted.map((section) => `
      <article class="menu-output-layer${section.id === state.selectedMenuOutputSectionId ? " is-active" : ""}${section.hidden ? " is-hidden" : ""}" data-menu-output-layer="${escapeAttribute(section.id)}">
        <button class="menu-output-layer-select" type="button" data-layer-action="select">
          <strong>${escapeHTML(section.title || "Adsız alan")}</strong>
          <small>z${escapeHTML(section.zIndex)} · ${escapeHTML(Math.round(section.width))}×${escapeHTML(Math.round(section.height))}</small>
        </button>
        <div class="menu-output-layer-actions">
          <button type="button" data-layer-action="visibility" title="${section.hidden ? "Göster" : "Gizle"}">${section.hidden ? "Göster" : "Gizle"}</button>
          <button type="button" data-layer-action="lock" title="${section.locked ? "Kilidi aç" : "Kilitle"}">${section.locked ? "Aç" : "Kilitle"}</button>
          <button type="button" data-layer-action="duplicate">Kopyala</button>
          <button type="button" data-layer-action="forward">Öne</button>
          <button type="button" data-layer-action="backward">Arkaya</button>
          <button class="is-danger" type="button" data-layer-action="delete"${section.locked ? " disabled" : ""}>Sil</button>
        </div>
      </article>
    `).join("") : `<div class="empty-mini">Henüz katman yok.</div>`;
  }

  function handleMenuOutputLayerClick(event) {
    const row = event.target.closest("[data-menu-output-layer]");
    const button = event.target.closest("[data-layer-action]");
    if (!row || !button) return;
    const menuOutput = ensureMenuOutputState();
    const section = menuOutput.sections.find((item) => item.id === row.dataset.menuOutputLayer);
    if (!section) return;
    const action = button.dataset.layerAction;
    state.selectedMenuOutputSectionId = section.id;
    if (action === "select") {
      selectMenuOutputSection(section.id);
      return;
    }
    if (action === "visibility") section.hidden = !section.hidden;
    else if (action === "lock") section.locked = !section.locked;
    else if (action === "duplicate") duplicateMenuOutputSection(menuOutput, section);
    else if (action === "forward" || action === "backward") {
      if (section.locked) return;
      moveMenuOutputSectionLayer(menuOutput, section, action);
    } else if (action === "delete") {
      if (section.locked || !confirm("Bu menü çıktı alanı silinsin mi?")) return;
      deleteMenuOutputSection(menuOutput, section);
    }
    saveMenuOutputState(true);
  }

  function renderMenuOutputTemplates(menuOutput) {
    if (!els.menuOutputTemplateList) return;
    els.menuOutputTemplateList.innerHTML = menuOutput.templates.length ? menuOutput.templates.map((template) => {
      const diagnostics = menuOutputDesignDiagnostics(template.snapshot);
      return `
        <article class="menu-output-template${template.id === menuOutput.currentTemplateId ? " is-active" : ""}" data-menu-output-template="${escapeAttribute(template.id)}">
          <button class="menu-output-template-preview" type="button" data-menu-output-template-action="open" aria-label="${escapeAttribute(template.name)} şablonunu aç">
            <img src="${menuOutputTemplateThumbnail(template)}" alt="${escapeAttribute(template.name)} önizlemesi">
          </button>
          <div class="menu-output-template-meta">
            <strong>${escapeHTML(template.name)}</strong>
            <small>${escapeHTML(formatDateTime(template.updatedAt))}</small>
            <span>
              ${template.id === menuOutput.defaultTemplateId ? `<em class="menu-output-badge">Varsayılan</em>` : ""}
              ${diagnostics.hasMissingData ? `<em class="menu-output-badge is-warning">Eksik veri</em>` : ""}
              ${diagnostics.overflowCount ? `<em class="menu-output-badge is-warning">${diagnostics.overflowCount} taşan</em>` : ""}
            </span>
          </div>
          <div class="menu-output-template-actions">
            <button class="line-action" type="button" data-menu-output-template-action="open">Aç</button>
            <button class="line-action" type="button" data-menu-output-template-action="duplicate">Kopyala</button>
            <button class="danger-mini" type="button" data-menu-output-template-action="delete">Sil</button>
          </div>
        </article>
      `;
    }).join("") : `<div class="empty-mini">Kayıtlı şablon yok.</div>`;
  }

  function handleMenuOutputTemplateClick(event) {
    const card = event.target.closest("[data-menu-output-template]");
    if (!card) return;
    const id = card.dataset.menuOutputTemplate;
    const action = event.target.closest("[data-menu-output-template-action]");
    const type = action ? action.dataset.menuOutputTemplateAction : "open";
    if (type === "duplicate") duplicateMenuOutputTemplate(id);
    else if (type === "delete") deleteMenuOutputTemplate(id);
    else loadMenuOutputTemplate(id);
  }

  function menuOutputTemplateThumbnail(template) {
    const svg = menuOutputSvg(template && template.snapshot);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function menuOutputDesignDiagnostics(value) {
    const snapshot = normalizeMenuOutput(value);
    return snapshot.sections.reduce((summary, section) => {
      const diagnostics = menuOutputSectionDiagnostics(section, snapshot);
      summary.hasMissingData = summary.hasMissingData || diagnostics.hasMissingData;
      summary.overflowCount += diagnostics.overflowCount;
      return summary;
    }, { hasMissingData: false, overflowCount: 0 });
  }

  function menuOutputSnapshot(currentMenuOutput) {
    const menuOutput = currentMenuOutput || ensureMenuOutputState();
    return normalizeMenuOutput({
      templateName: menuOutput.templateName,
      canvaLink: menuOutput.canvaLink,
      gridEnabled: menuOutput.gridEnabled,
      safeAreaEnabled: menuOutput.safeAreaEnabled,
      settings: cloneData(menuOutput.settings),
      sections: cloneData(menuOutput.sections),
      templates: []
    });
  }

  function saveMenuOutputTemplate() {
    const menuOutput = ensureMenuOutputState();
    const name = els.menuOutputTemplateName ? els.menuOutputTemplateName.value.trim() : "";
    const now = new Date().toISOString();
    const template = {
      id: makeId("menu-output-template", name || now),
      name: name || menuOutput.templateName || "Menü şablonu",
      snapshot: menuOutputSnapshot(menuOutput),
      createdAt: now,
      updatedAt: now
    };
    menuOutput.templates.unshift(template);
    menuOutput.currentTemplateId = template.id;
    if (!menuOutput.defaultTemplateId) menuOutput.defaultTemplateId = template.id;
    saveMenuOutputState(true);
  }

  function updateMenuOutputTemplate() {
    const menuOutput = ensureMenuOutputState();
    const template = menuOutput.templates.find((item) => item.id === menuOutput.currentTemplateId);
    if (!template) {
      saveMenuOutputTemplate();
      return;
    }
    template.name = els.menuOutputTemplateName ? els.menuOutputTemplateName.value.trim() || template.name : template.name;
    template.snapshot = menuOutputSnapshot(menuOutput);
    template.updatedAt = new Date().toISOString();
    saveMenuOutputState(true);
  }

  function duplicateMenuOutputTemplate(templateId) {
    const menuOutput = ensureMenuOutputState();
    const source = menuOutput.templates.find((item) => item.id === (templateId || menuOutput.currentTemplateId));
    if (!source) {
      saveMenuOutputTemplate();
      return;
    }
    const now = new Date().toISOString();
    const copy = {
      id: makeId("menu-output-template", `${source.name}-copy`),
      name: `${source.name} Kopya`,
      snapshot: normalizeMenuOutput(cloneData(source.snapshot)),
      createdAt: now,
      updatedAt: now
    };
    menuOutput.templates.unshift(copy);
    menuOutput.currentTemplateId = copy.id;
    saveMenuOutputState(true);
  }

  function deleteMenuOutputTemplate(templateId) {
    const menuOutput = ensureMenuOutputState();
    const targetId = templateId || menuOutput.currentTemplateId;
    if (!targetId) return;
    if (!confirm("Seçili Menü Çıktısı şablonu silinsin mi?")) return;
    const deletingCurrent = menuOutput.currentTemplateId === targetId;
    menuOutput.templates = menuOutput.templates.filter((item) => item.id !== targetId);
    if (menuOutput.defaultTemplateId === targetId) {
      menuOutput.defaultTemplateId = menuOutput.templates[0] ? menuOutput.templates[0].id : "";
    }
    if (deletingCurrent) {
      menuOutput.currentTemplateId = menuOutput.templates[0] ? menuOutput.templates[0].id : "";
      if (menuOutput.currentTemplateId) {
        loadMenuOutputTemplate(menuOutput.currentTemplateId);
        return;
      }
    }
    saveMenuOutputState(true);
  }

  function setDefaultMenuOutputTemplate() {
    const menuOutput = ensureMenuOutputState();
    if (!menuOutput.currentTemplateId) return;
    menuOutput.defaultTemplateId = menuOutput.currentTemplateId;
    saveMenuOutputState(true);
  }

  function loadMenuOutputTemplate(id) {
    const menuOutput = ensureMenuOutputState();
    const template = menuOutput.templates.find((item) => item.id === id);
    if (!template) return;
    const snapshot = normalizeMenuOutput(template.snapshot);
    const templates = menuOutput.templates;
    const defaultTemplateId = menuOutput.defaultTemplateId;
    state.data.settings.menuOutput = normalizeMenuOutput(Object.assign({}, snapshot, {
      currentTemplateId: template.id,
      defaultTemplateId,
      templates
    }));
    state.selectedMenuOutputSectionId = state.data.settings.menuOutput.sections[0] ? state.data.settings.menuOutput.sections[0].id : "";
    saveMenuOutputState(true);
  }

  function openMenuOutputCanva() {
    const link = ensureMenuOutputState().canvaLink || "";
    if (!link) {
      alert("Canva referans linki yok.");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }

  function resetMenuOutputDesign() {
    if (!confirm("Menü Çıktısı tasarımı varsayılan değerlere alınsın mı? Şablon kütüphanesi korunur.")) return;
    const current = ensureMenuOutputState();
    state.data.settings.menuOutput = normalizeMenuOutput(Object.assign({}, DEFAULT_MENU_OUTPUT, {
      templates: current.templates,
      defaultTemplateId: current.defaultTemplateId
    }));
    state.selectedMenuOutputSectionId = "";
    saveMenuOutputState(true);
  }

  function renderMenuOutputPreview(menuOutput) {
    if (!els.menuOutputPreview) return;
    const settings = menuOutput.settings;
    els.menuOutputPreview.style.setProperty("--menu-output-bg", settings.bgColor);
    els.menuOutputPreview.style.setProperty("--menu-output-box", settings.boxColor);
    els.menuOutputPreview.style.setProperty("--menu-output-text", settings.textColor);
    els.menuOutputPreview.style.setProperty("--menu-output-title-font", settings.titleFont);
    els.menuOutputPreview.style.setProperty("--menu-output-body-font", settings.bodyFont);
    els.menuOutputPreview.style.setProperty("--menu-output-price-font", settings.priceFont);

    const visibleSections = menuOutputSortedVisibleSections(menuOutput);
    els.menuOutputPreview.classList.toggle("is-grid-enabled", menuOutput.gridEnabled);
    const sections = visibleSections.length
      ? visibleSections.map(({ section, index }) => renderMenuOutputPreviewSection(section, index, menuOutput)).join("")
      : `<div class="menu-output-empty">Alan ekleyin ve canlı menüden ürün seçin.</div>`;
    const dateText = settings.dateText || `Fiyat değişikliği tarihi: ${formatMenuOutputDate(new Date())}`;
    els.menuOutputPreview.innerHTML = `
      <div class="menu-output-preview-bg"></div>
      ${menuOutput.safeAreaEnabled ? `<div class="menu-output-safe-area" aria-hidden="true"></div>` : ""}
      ${sections}
      ${Number.isFinite(state.menuOutputGuides.x) ? `<div class="menu-output-guide is-vertical" style="left:${state.menuOutputGuides.x}px"></div>` : ""}
      ${Number.isFinite(state.menuOutputGuides.y) ? `<div class="menu-output-guide is-horizontal" style="top:${state.menuOutputGuides.y}px"></div>` : ""}
      <div class="menu-output-date-pill">${escapeHTML(dateText)}</div>
    `;
    if (els.menuOutputStatus) {
      const warnings = menuOutput.sections.reduce((total, section) => {
        const diagnostics = menuOutputSectionDiagnostics(section, menuOutput);
        return total + diagnostics.messages.length;
      }, 0);
      els.menuOutputStatus.textContent = `${visibleSections.length} görünür alan • ${menuOutputProducts().length} canlı ürün${warnings ? ` • ${warnings} uyarı` : ""}`;
    }
    window.requestAnimationFrame(applyMenuOutputZoom);
  }

  function renderMenuOutputPreviewSection(section, index, menuOutput) {
    const layout = computeMenuOutputLayouts(section, index);
    const diagnostics = menuOutputSectionDiagnostics(section, menuOutput);
    const products = menuOutputProductsForSection(section).slice(0, diagnostics.capacity);
    const settings = menuOutput.settings;
    const bgColor = section.bgColor || settings.boxColor;
    const textColor = section.textColor || settings.textColor;
    const fontSize = Number(section.fontSize || settings.productSize || 28);
    const rowGap = Number(section.rowGap || settings.rowGap || 34);
    const frame = ` frame-${escapeAttribute(section.frame || "shadow")}`;
    const selected = section.id === state.selectedMenuOutputSectionId;
    const canvasWarning = diagnostics.overflowCount
      ? `Bu alanda ${diagnostics.overflowCount} ürün taşıyor`
      : diagnostics.messages[0] || "";
    const handles = selected && !section.locked ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
      .map((handle) => `<span class="menu-output-resize-handle is-${handle}" data-menu-output-resize="${handle}" aria-hidden="true"></span>`).join("") : "";
    return `
      <section class="menu-output-board-section type-${escapeAttribute(section.type)}${frame}${selected ? " is-selected" : ""}${section.locked ? " is-locked" : ""}" data-menu-output-canvas-section="${escapeAttribute(section.id)}" style="left:${layout.x}px;top:${layout.y}px;width:${layout.w}px;height:${layout.h}px;z-index:${escapeAttribute(section.zIndex)};background:${escapeAttribute(bgColor)};color:${escapeAttribute(textColor)};font-family:${escapeAttribute(section.font || settings.bodyFont)};--row-gap:${rowGap}px;--font-size:${fontSize}px;">
        ${section.type === "main" ? `<div class="menu-output-vertical" style="font-family:${escapeAttribute(settings.titleFont)}">${escapeHTML(section.title || "SPECIAL")}</div>` : `<h5 style="font-family:${escapeAttribute(settings.titleFont)};color:${escapeAttribute(section.titleColor || textColor)}">${escapeHTML(section.title)}</h5>`}
        ${section.bgIcon ? `<div class="menu-output-bg-icon" style="opacity:${clamp(Number(section.bgIconOpacity || 0.12), 0, 0.7)}">${escapeHTML(menuOutputIcon(section.bgIcon))}</div>` : ""}
        ${section.icon ? `<div class="menu-output-price-icons" style="opacity:${clamp(Number(section.iconOpacity || 0.85), 0, 1)}">${[0,1,2].map(() => `<span>${escapeHTML(menuOutputIcon(section.icon))}</span>`).join("")}</div>` : ""}
        <div class="menu-output-product-rows">
          ${products.map(({ category, product }) => renderMenuOutputProduct(category, product, section, menuOutput)).join("")}
        </div>
        ${canvasWarning ? `<div class="menu-output-canvas-warning">${escapeHTML(canvasWarning)}</div>` : ""}
        ${handles}
      </section>
    `;
  }

  function renderMenuOutputProduct(category, product, section, menuOutput) {
    const prices = menuOutputProductPrices(product);
    const detail = product.details && product.details.ingredients || product.desc || "";
    return `
      <article class="menu-output-product-row">
        <div>
          <strong>${escapeHTML(product.name)}</strong>
          ${section.showDescription && detail ? `<small>${escapeHTML(detail)}</small>` : ""}
        </div>
        ${section.showPrices !== false ? `<div class="menu-output-price-cols" style="font-family:${escapeAttribute(menuOutput.settings.priceFont)}">${prices.map((price) => `<span>${escapeHTML(price)}</span>`).join("")}</div>` : ""}
      </article>
    `;
  }

  function menuOutputDefaultLayout(type, index) {
    return {
      main: { x: 210, y: 150, w: 760, h: 1100 },
      bottom: { x: 80, y: 1320, w: 590, h: 360 },
      right: { x: 700, y: 1320, w: 300, h: 360 },
      small: { x: 120 + (index % 2) * 440, y: 1280 + Math.floor(index / 2) * 300, w: 400, h: 280 }
    }[type] || { x: 210, y: 150, w: 760, h: 1100 };
  }

  function computeMenuOutputLayouts(section, index) {
    const base = menuOutputDefaultLayout(section.type, index || 0);
    return {
      x: Number.isFinite(Number(section.x)) ? Number(section.x) : base.x + Number(section.offsetX || 0),
      y: Number.isFinite(Number(section.y)) ? Number(section.y) : base.y + Number(section.offsetY || 0),
      w: Number(section.width) > 0 ? Number(section.width) : base.w,
      h: Number(section.height) > 0 ? Number(section.height) : base.h
    };
  }

  function constrainMenuOutputSection(section) {
    section.width = clamp(Number(section.width || 180), 180, MENU_OUTPUT_WIDTH);
    section.height = clamp(Number(section.height || 140), 140, MENU_OUTPUT_HEIGHT);
    section.x = clamp(Number(section.x || 0), 0, MENU_OUTPUT_WIDTH - section.width);
    section.y = clamp(Number(section.y || 0), 0, MENU_OUTPUT_HEIGHT - section.height);
  }

  function menuOutputSortedVisibleSections(menuOutput) {
    return menuOutput.sections
      .filter((section) => !section.hidden)
      .map((section, index) => ({ section, index }))
      .sort((a, b) => Number(a.section.zIndex || 0) - Number(b.section.zIndex || 0));
  }

  function menuOutputProductsForSection(section) {
    const products = menuOutputProducts().filter(({ category, product }) => category.active !== false && product.active !== false && product.stock !== "sold-out");
    if (section.mode === "all") return products;
    if (section.mode === "manual") {
      const ids = new Set(section.productIds || []);
      return products.filter(({ product }) => ids.has(product.id));
    }
    return products.filter(({ category }) => category.id === section.categoryId);
  }

  function menuOutputSectionCapacity(section, menuOutput) {
    const fallback = section.type === "main" ? 16 : 8;
    const settings = menuOutput && menuOutput.settings ? menuOutput.settings : DEFAULT_MENU_OUTPUT.settings;
    const layout = computeMenuOutputLayouts(section, 0);
    const fontSize = clamp(Number(section.fontSize || settings.productSize || 28), 12, 72);
    const compactScale = section.type === "main" ? 1 : 0.72;
    const renderedFontSize = fontSize * compactScale;
    const priceSize = section.showPrices === false ? 0 : renderedFontSize;
    const rowGap = clamp(Number(section.rowGap || settings.rowGap || 34), 10, 90);
    const productLineHeight = renderedFontSize * 1.05;
    const priceLineHeight = priceSize * 1.05;
    const descriptionHeight = section.showDescription
      ? renderedFontSize * 0.56 * 1.2 + 5
      : 0;
    const effectiveGap = section.type === "main" ? rowGap : rowGap * 0.58;
    const rowHeight = Math.max(effectiveGap, productLineHeight + descriptionHeight, priceLineHeight);
    const titleSpace = section.type === "main" ? 118 : 92;
    const bottomSpace = section.type === "main" ? 34 : 24;
    const availableHeight = Number(layout.h) - titleSpace - bottomSpace;
    if (!Number.isFinite(rowHeight) || rowHeight <= 0 || !Number.isFinite(availableHeight) || availableHeight <= 0) {
      return fallback;
    }
    return Math.max(1, Math.floor(availableHeight / rowHeight));
  }

  function menuOutputSectionDiagnostics(section, menuOutput) {
    const allProducts = menuOutputProducts();
    const productIds = new Set(allProducts.map(({ product }) => product.id));
    const categoryIds = new Set((state.data && state.data.categories || []).map((category) => category.id));
    const products = menuOutputProductsForSection(section);
    const capacity = menuOutputSectionCapacity(section, menuOutput);
    const missingCategory = section.mode === "category" && (!section.categoryId || !categoryIds.has(section.categoryId));
    const missingProducts = section.mode === "manual"
      ? (section.productIds || []).filter((id) => !productIds.has(id)).length
      : 0;
    const emptyManualSelection = section.mode === "manual" && !(section.productIds || []).length;
    const missingPriceCount = products.filter(({ product }) => menuOutputProductHasMissingPrice(product)).length;
    const overflowCount = Math.max(0, products.length - capacity);
    const messages = [];
    if (missingCategory) messages.push("Eksik veri: seçili kategori bulunamadı");
    if (missingProducts) messages.push(`Eksik veri: ${missingProducts} ürün bulunamadı`);
    if (emptyManualSelection) messages.push("Eksik veri: manuel ürün seçilmedi");
    if (missingPriceCount) messages.push(`Eksik veri: ${missingPriceCount} üründe fiyat eksik`);
    if (overflowCount) messages.push(`Bu alanda ürün taşması var: ${overflowCount} ürün sığmıyor`);
    return {
      capacity,
      overflowCount,
      missingPriceCount,
      missingCategory,
      missingProducts,
      emptyManualSelection,
      hasMissingData: missingCategory || missingProducts > 0 || emptyManualSelection || missingPriceCount > 0,
      messages
    };
  }

  function menuOutputExportDiagnostics(menuOutput) {
    const visibleSections = menuOutput.sections.filter((section) => !section.hidden);
    const summary = visibleSections.reduce((result, section) => {
      const diagnostics = menuOutputSectionDiagnostics(section, menuOutput);
      result.missingCategories += diagnostics.missingCategory ? 1 : 0;
      result.missingProducts += diagnostics.missingProducts;
      result.emptySelections += diagnostics.emptyManualSelection ? 1 : 0;
      result.missingPrices += diagnostics.missingPriceCount;
      result.overflow += diagnostics.overflowCount;
      const fontSize = Number(section.fontSize || menuOutput.settings.productSize || 28);
      result.smallFonts += fontSize < 16 ? 1 : 0;
      const bgColor = section.bgColor || menuOutput.settings.boxColor;
      const textColor = section.textColor || menuOutput.settings.textColor;
      const titleColor = section.titleColor || textColor;
      result.readabilityRisks += Math.min(menuOutputContrastRatio(bgColor, textColor), menuOutputContrastRatio(bgColor, titleColor)) < 3 ? 1 : 0;
      return result;
    }, {
      missingCategories: 0,
      missingProducts: 0,
      emptySelections: 0,
      missingPrices: 0,
      overflow: 0,
      smallFonts: 0,
      readabilityRisks: 0
    });
    const messages = [];
    if (!visibleSections.length) messages.push("Görünür menü alanı yok.");
    if (summary.missingCategories) messages.push(`${summary.missingCategories} alanda kategori eksik.`);
    if (summary.missingProducts) messages.push(`${summary.missingProducts} seçili ürün bulunamadı.`);
    if (summary.emptySelections) messages.push(`${summary.emptySelections} manuel alanda ürün seçilmedi.`);
    if (summary.missingPrices) messages.push(`${summary.missingPrices} üründe fiyat eksik.`);
    if (summary.overflow) messages.push(`${summary.overflow} ürün alanlara sığmayabilir.`);
    if (summary.smallFonts) messages.push(`${summary.smallFonts} alanda punto 16 px altında.`);
    if (summary.readabilityRisks) messages.push(`${summary.readabilityRisks} alanda düşük renk kontrastı var.`);
    return { summary, messages };
  }

  function renderMenuOutputQualityPanel(menuOutput) {
    if (!els.menuOutputQualityPanel) return;
    const diagnostics = menuOutputExportDiagnostics(menuOutput);
    els.menuOutputQualityPanel.classList.toggle("is-warning", diagnostics.messages.length > 0);
    els.menuOutputQualityPanel.innerHTML = `
      <strong>Kontrol edildi: ${diagnostics.messages.length} uyarı var</strong>
      ${diagnostics.messages.length
        ? `<ul>${diagnostics.messages.map((message) => `<li>${escapeHTML(message)}</li>`).join("")}</ul>`
        : `<span>Çıktı için kritik veri sorunu görünmüyor.</span>`}
    `;
  }

  function notifyMenuOutputExportWarnings() {
    const menuOutput = ensureMenuOutputState();
    const diagnostics = menuOutputExportDiagnostics(menuOutput);
    renderMenuOutputQualityPanel(menuOutput);
    if (!diagnostics.messages.length) return;
    showMenuOutputNotice(`Export öncesi ${diagnostics.messages.length} uyarı bulundu.`);
    setMenuOutputControlTab("output");
  }

  function menuOutputContrastRatio(first, second) {
    const firstLum = menuOutputColorLuminance(first);
    const secondLum = menuOutputColorLuminance(second);
    if (firstLum === null || secondLum === null) return 21;
    const lighter = Math.max(firstLum, secondLum);
    const darker = Math.min(firstLum, secondLum);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function menuOutputColorLuminance(value) {
    const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return null;
    const channels = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function menuOutputProductHasMissingPrice(product) {
    if (!product || !product.prices) return true;
    if (product.priceMode === "standard") return cleanPrice(product.prices.standard) === "";
    if (product.priceMode === "singleDouble") {
      return cleanPrice(product.prices.single) === "" || cleanPrice(product.prices.double) === "";
    }
    return [product.prices.k, product.prices.o, product.prices.b].some((price) => cleanPrice(price) === "");
  }

  function menuOutputProducts() {
    return state.data && Array.isArray(state.data.categories) ? flatProducts() : [];
  }

  function menuOutputCategoryOptions() {
    return state.data && Array.isArray(state.data.categories)
      ? state.data.categories.map((category) => [category.id, category.name])
      : [];
  }

  function menuOutputProductPrices(product) {
    if (!product || !product.prices) return ["", "", ""];
    if (product.priceMode === "singleDouble") {
      return [formatPrice(product.prices.single), formatPrice(product.prices.double), ""].filter(Boolean);
    }
    if (product.priceMode === "standard") {
      const price = formatPrice(product.prices.standard);
      return price ? [price] : [];
    }
    return [formatPrice(product.prices.k), formatPrice(product.prices.o), formatPrice(product.prices.b)].filter(Boolean);
  }

  function menuOutputIcon(value) {
    const icon = MENU_OUTPUT_ICON_OPTIONS.find((item) => item[0] === value);
    return icon ? icon[2] : "";
  }

  function menuOutputOptions(options, selectedValue) {
    return options.map(([value, label]) => `
      <option value="${escapeAttribute(value)}"${String(value) === String(selectedValue) ? " selected" : ""}>${escapeHTML(label)}</option>
    `).join("");
  }

  async function exportMenuOutputImage(format) {
    notifyMenuOutputExportWarnings();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const svg = menuOutputSvg();
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = MENU_OUTPUT_WIDTH;
    canvas.height = MENU_OUTPUT_HEIGHT;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = ensureMenuOutputState().settings.bgColor || "#fffff0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const type = format === "jpg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(type, 0.95);
    downloadDataUrl(dataUrl, menuOutputExportFileName(format === "jpg" ? "jpg" : "png"));
  }

  async function exportMenuOutputPdf() {
    notifyMenuOutputExportWarnings();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const svg = menuOutputSvg();
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = MENU_OUTPUT_WIDTH;
    canvas.height = MENU_OUTPUT_HEIGHT;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = ensureMenuOutputState().settings.bgColor || "#fffff0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL("image/png");
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      downloadDataUrl(dataUrl, menuOutputExportFileName("png"));
      return;
    }
    win.document.write(`<html><head><title>${escapeHTML(menuOutputExportFileName("pdf"))}</title><style>@page{size:9in 16in;margin:0}body{margin:0;background:#fff}img{width:100vw;height:100vh;object-fit:contain;display:block}</style></head><body><img src="${dataUrl}" onload="setTimeout(()=>print(),250)"></body></html>`);
    win.document.close();
  }

  function menuOutputSvg(value) {
    const menuOutput = value && typeof value === "object" ? normalizeMenuOutput(value) : ensureMenuOutputState();
    const settings = menuOutput.settings;
    const sections = menuOutputSortedVisibleSections(menuOutput)
      .map(({ section, index }) => menuOutputSectionSvg(section, index, menuOutput))
      .join("");
    const dateText = settings.dateText || `Fiyat değişikliği tarihi: ${formatMenuOutputDate(new Date())}`;
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${MENU_OUTPUT_WIDTH}" height="${MENU_OUTPUT_HEIGHT}" viewBox="0 0 ${MENU_OUTPUT_WIDTH} ${MENU_OUTPUT_HEIGHT}">
        <rect width="1080" height="1920" fill="${escapeAttribute(settings.bgColor || "#fffff0")}"/>
        ${sections}
        <rect x="225" y="1736" width="630" height="58" rx="29" fill="${escapeAttribute(settings.boxColor || "#2c1609")}"/>
        <text x="540" y="1765" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttribute(settings.textColor || "#e9f6ff")}" font-size="33" font-weight="700" font-family="${escapeAttribute(settings.bodyFont)}">${escapeHTML(dateText)}</text>
      </svg>
    `;
  }

  function startMenuOutputSectionPointer(event) {
    if (event.button !== 0) return;
    const element = event.target.closest("[data-menu-output-canvas-section]");
    if (!element) return;
    const menuOutput = ensureMenuOutputState();
    const section = menuOutput.sections.find((item) => item.id === element.dataset.menuOutputCanvasSection);
    if (!section) return;
    state.selectedMenuOutputSectionId = section.id;
    if (section.locked) {
      selectMenuOutputSection(section.id);
      return;
    }
    event.preventDefault();
    const handle = event.target.dataset.menuOutputResize || "move";
    const scale = menuOutputPreviewScale();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = computeMenuOutputLayouts(section, menuOutput.sections.indexOf(section));
    element.classList.add("is-dragging");

    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / scale;
      const dy = (moveEvent.clientY - startY) / scale;
      if (handle === "move") moveMenuOutputSection(section, start, dx, dy, menuOutput);
      else resizeMenuOutputSection(section, start, handle, dx, dy, menuOutput.gridEnabled);
      renderMenuOutputPreview(menuOutput);
      updateMenuOutputGeometryInputs(section);
    };
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      state.menuOutputGuides = { x: null, y: null };
      saveMenuOutputState(true);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  function moveMenuOutputSection(section, start, dx, dy, menuOutput) {
    let x = start.x + dx;
    let y = start.y + dy;
    if (menuOutput.gridEnabled) {
      x = snapMenuOutputValue(x);
      y = snapMenuOutputValue(y);
    }
    const aligned = alignMenuOutputSection(section, x, y, start.w, start.h, menuOutput);
    section.x = aligned.x;
    section.y = aligned.y;
    section.width = start.w;
    section.height = start.h;
    state.menuOutputGuides = { x: aligned.guideX, y: aligned.guideY };
    constrainMenuOutputSection(section);
  }

  function resizeMenuOutputSection(section, start, handle, dx, dy, snapEnabled) {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    if (handle.includes("e")) right += dx;
    if (handle.includes("s")) bottom += dy;
    if (handle.includes("w")) left += dx;
    if (handle.includes("n")) top += dy;
    if (snapEnabled) {
      if (handle.includes("e")) right = snapMenuOutputValue(right);
      if (handle.includes("s")) bottom = snapMenuOutputValue(bottom);
      if (handle.includes("w")) left = snapMenuOutputValue(left);
      if (handle.includes("n")) top = snapMenuOutputValue(top);
    }
    if (right - left < 180) {
      if (handle.includes("w")) left = right - 180;
      else right = left + 180;
    }
    if (bottom - top < 140) {
      if (handle.includes("n")) top = bottom - 140;
      else bottom = top + 140;
    }
    section.x = left;
    section.y = top;
    section.width = right - left;
    section.height = bottom - top;
    state.menuOutputGuides = { x: null, y: null };
    constrainMenuOutputSection(section);
  }

  function snapMenuOutputValue(value) {
    return Math.round(Number(value || 0) / MENU_OUTPUT_SNAP) * MENU_OUTPUT_SNAP;
  }

  function alignMenuOutputSection(section, x, y, width, height, menuOutput) {
    const xTargets = [0, MENU_OUTPUT_WIDTH / 2, MENU_OUTPUT_WIDTH];
    const yTargets = [0, MENU_OUTPUT_HEIGHT / 2, MENU_OUTPUT_HEIGHT];
    if (menuOutput.safeAreaEnabled) {
      xTargets.push(MENU_OUTPUT_SAFE_X, MENU_OUTPUT_WIDTH - MENU_OUTPUT_SAFE_X);
      yTargets.push(MENU_OUTPUT_SAFE_Y, MENU_OUTPUT_HEIGHT - MENU_OUTPUT_SAFE_Y);
    }
    menuOutput.sections.filter((item) => item.id !== section.id && !item.hidden).forEach((item, index) => {
      const layout = computeMenuOutputLayouts(item, index);
      xTargets.push(layout.x, layout.x + layout.w / 2, layout.x + layout.w);
      yTargets.push(layout.y, layout.y + layout.h / 2, layout.y + layout.h);
    });
    const alignedX = alignMenuOutputAxis(x, width, xTargets);
    const alignedY = alignMenuOutputAxis(y, height, yTargets);
    return { x: alignedX.value, y: alignedY.value, guideX: alignedX.guide, guideY: alignedY.guide };
  }

  function alignMenuOutputAxis(start, size, targets) {
    let best = { distance: 9, value: start, guide: null };
    [0, size / 2, size].forEach((offset) => {
      targets.forEach((target) => {
        const distance = Math.abs(start + offset - target);
        if (distance <= 8 && distance < best.distance) {
          best = { distance, value: target - offset, guide: target };
        }
      });
    });
    return best;
  }

  function updateMenuOutputGeometryInputs(section) {
    if (!els.menuOutputSectionList) return;
    const container = Array.from(els.menuOutputSectionList.querySelectorAll("[data-menu-output-section]"))
      .find((item) => item.dataset.menuOutputSection === section.id);
    if (!container) return;
    ["x", "y", "width", "height", "zIndex"].forEach((field) => {
      const input = container.querySelector(`[data-menu-output-field="${field}"]`);
      if (input) input.value = Math.round(Number(section[field] || 0));
    });
  }

  function menuOutputSectionSvg(section, index, menuOutput) {
    const layout = computeMenuOutputLayouts(section, index);
    const settings = menuOutput.settings;
    const bg = section.bgColor || settings.boxColor || "#2c1609";
    const color = section.textColor || settings.textColor || "#e9f6ff";
    const titleColor = section.titleColor || color;
    const products = menuOutputProductsForSection(section).slice(0, menuOutputSectionCapacity(section, menuOutput));
    const fontSize = Number(section.fontSize || settings.productSize || 28);
    const rowGap = Number(section.rowGap || settings.rowGap || 34);
    const productStartY = section.type === "main" ? layout.y + 118 : layout.y + 92;
    const title = section.title || "SPECIAL";
    const titleFont = settings.titleFont;
    const productFont = section.font || settings.bodyFont;
    const priceFont = settings.priceFont;
    const compactScale = section.type === "main" ? 1 : 0.72;
    const renderedFontSize = fontSize * compactScale;
    const descriptionSize = renderedFontSize * 0.56;
    const effectiveGap = section.type === "main" ? rowGap : rowGap * 0.58;
    const rowStep = Math.max(effectiveGap, renderedFontSize * 1.05 + (section.showDescription ? descriptionSize * 1.2 + 5 : 0));
    const rows = products.map(({ product }, rowIndex) => {
      const y = productStartY + rowIndex * rowStep;
      const prices = section.showPrices !== false ? menuOutputProductPrices(product) : [];
      const priceText = prices.map((price, priceIndex) => `<text x="${layout.x + layout.w - 70 - (prices.length - 1 - priceIndex) * 120}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttribute(color)}" font-size="${renderedFontSize}" font-weight="800" font-family="${escapeAttribute(priceFont)}">${escapeHTML(price)}</text>`).join("");
      const desc = section.showDescription && (product.details && product.details.ingredients || product.desc) ? `<text x="${layout.x + 38}" y="${y + renderedFontSize * 0.8}" fill="${escapeAttribute(color)}" opacity="0.78" font-size="${descriptionSize}" font-family="${escapeAttribute(productFont)}">${escapeHTML((product.details && product.details.ingredients || product.desc).slice(0, 42))}</text>` : "";
      return `<text x="${layout.x + 38}" y="${y}" dominant-baseline="middle" fill="${escapeAttribute(color)}" font-size="${renderedFontSize}" font-weight="800" font-family="${escapeAttribute(productFont)}">${escapeHTML(product.name.slice(0, 28))}</text>${desc}${priceText}`;
    }).join("");
    const vertical = section.type === "main"
      ? `<rect x="${layout.x - 165}" y="${layout.y - 150}" width="150" height="520" rx="0" fill="${escapeAttribute(bg)}"/><text x="${layout.x - 90}" y="${layout.y - 70}" text-anchor="middle" fill="${escapeAttribute(titleColor)}" font-size="54" font-weight="900" font-family="${escapeAttribute(titleFont)}">${svgVerticalText(title, layout.x - 90)}</text>`
      : `<text x="${layout.x + layout.w / 2}" y="${layout.y + 54}" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttribute(titleColor)}" font-size="54" font-weight="900" font-family="${escapeAttribute(titleFont)}">${escapeHTML(title)}</text>`;
    const icons = section.icon ? [0, 1, 2].map((_, iconIndex) => `<text x="${layout.x + layout.w - 260 + iconIndex * 120}" y="${layout.y + 72}" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttribute(color)}" opacity="${clamp(Number(section.iconOpacity || 0.85), 0, 1)}" font-size="30" font-family="${escapeAttribute(productFont)}">${escapeHTML(menuOutputIcon(section.icon))}</text>`).join("") : "";
    const bgIcon = section.bgIcon ? `<text x="${layout.x + layout.w / 2}" y="${layout.y + layout.h / 2}" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttribute(color)}" opacity="${clamp(Number(section.bgIconOpacity || 0.12), 0, 0.7)}" font-size="260" font-family="${escapeAttribute(productFont)}">${escapeHTML(menuOutputIcon(section.bgIcon))}</text>` : "";
    return `<g><rect x="${layout.x}" y="${layout.y}" width="${layout.w}" height="${layout.h}" rx="34" fill="${escapeAttribute(bg)}"/><rect x="${layout.x}" y="${layout.y}" width="${layout.w}" height="${layout.h}" rx="34" fill="none" stroke="${escapeAttribute(color)}" opacity="${section.frame === "thin" ? 0.6 : 0.08}" stroke-width="${section.frame === "thin" ? 3 : 1}"/>${vertical}${bgIcon}${icons}${rows}</g>`;
  }

  function svgVerticalText(value, x) {
    const position = Number.isFinite(Number(x)) ? Number(x) : 120;
    return String(value || "").split("").map((char, index) => `<tspan x="${position}" dy="${index === 0 ? 0 : 58}">${escapeHTML(char)}</tspan>`).join("");
  }

  function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function formatMenuOutputDate(date) {
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function isoDateForFile() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function menuOutputExportFileName(extension) {
    const menuOutput = ensureMenuOutputState();
    const name = slugFilePart(menuOutput.templateName || "menu");
    return `tahmisci-${name}-${MENU_OUTPUT_WIDTH}x${MENU_OUTPUT_HEIGHT}-${isoDateForFile()}.${extension}`;
  }

  function slugFilePart(value) {
    return String(value || "menu")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "menu";
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  const DATA_IMPORT_SCOPES = Object.freeze([
    { key: "menu", input: "dataImportMenuFile", name: "dataImportMenuFileName", label: "Menü" },
    { key: "pricing", input: "dataImportPricingFile", name: "dataImportPricingFileName", label: "Fiyat" },
    { key: "recipe", input: "dataImportRecipeFile", name: "dataImportRecipeFileName", label: "Reçete" },
    { key: "stock", input: "dataImportStockFile", name: "dataImportStockFileName", label: "Stok" }
  ]);

  const DATA_IMPORT_DOMAINS = Object.freeze([
    { key: "catalog", label: "Menü + Fiyat", scopes: ["menu", "pricing"] },
    { key: "recipes", label: "Reçete", scopes: ["recipe"] },
    { key: "stock", label: "Stok", scopes: ["stock"] }
  ]);

  function bindDataImportCenterEvents() {
    if (!els.dataImportCenter) return;
    DATA_IMPORT_SCOPES.forEach((scope) => {
      const input = els[scope.input];
      if (!input) return;
      input.addEventListener("change", () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        if (file && !/\.xlsx$/i.test(file.name)) {
          input.value = "";
          invalidateDataImportAnalysis();
          setDataImportMessage("Yalnızca .xlsx çalışma kitapları kabul edilir.", "error");
          state.dataImportCenter.files[scope.key] = null;
        } else {
          state.dataImportCenter.files[scope.key] = file;
          invalidateDataImportAnalysis();
        }
        renderDataImportCenter();
      });
    });
    els.dataImportCenter.addEventListener("click", (event) => {
      const clearButton = event.target.closest("[data-data-import-clear]");
      if (!clearButton || state.dataImportCenter.busy) return;
      clearDataImportFile(clearButton.dataset.dataImportClear);
    });
    if (els.dataImportAnalyze) els.dataImportAnalyze.addEventListener("click", analyzeDataImportFiles);
    if (els.dataImportApply) els.dataImportApply.addEventListener("click", applyDataImportAnalysis);
    if (els.dataImportReset) els.dataImportReset.addEventListener("click", resetDataImportCenter);
    if (els.dataImportRefreshHistory) els.dataImportRefreshHistory.addEventListener("click", () => loadDataImportHistory(true));
    if (els.dataImportHistoryList) els.dataImportHistoryList.addEventListener("click", handleDataImportHistoryAction);
    if (els.dataImportArchiveOnly) els.dataImportArchiveOnly.addEventListener("change", () => {
      state.dataImportCenter.archiveOnly = els.dataImportArchiveOnly.checked;
      renderDataImportAnalysis();
    });
    if (els.dataImportIssueScope) els.dataImportIssueScope.addEventListener("change", () => {
      state.dataImportCenter.issueScope = els.dataImportIssueScope.value || "all";
      renderDataImportAnalysis();
    });
    if (els.dataImportIssueCode) els.dataImportIssueCode.addEventListener("change", () => {
      state.dataImportCenter.issueCode = els.dataImportIssueCode.value || "all";
      renderDataImportAnalysis();
    });
  }

  function invalidateDataImportAnalysis() {
    const center = state.dataImportCenter;
    center.analysisEpoch += 1;
    center.analysis = null;
    center.lastResult = null;
    center.issueScope = "all";
    center.issueCode = "all";
    center.archiveOnly = false;
    center.message = "";
    center.messageType = "";
  }

  function clearDataImportFile(scopeKey) {
    const scope = DATA_IMPORT_SCOPES.find((item) => item.key === scopeKey);
    if (!scope) return;
    state.dataImportCenter.files[scope.key] = null;
    if (els[scope.input]) els[scope.input].value = "";
    invalidateDataImportAnalysis();
    renderDataImportCenter();
  }

  function resetDataImportCenter() {
    if (state.dataImportCenter.busy) return;
    DATA_IMPORT_SCOPES.forEach((scope) => {
      state.dataImportCenter.files[scope.key] = null;
      if (els[scope.input]) els[scope.input].value = "";
    });
    invalidateDataImportAnalysis();
    renderDataImportCenter();
  }

  function setDataImportMessage(message, type) {
    state.dataImportCenter.message = String(message || "");
    state.dataImportCenter.messageType = type || "info";
    renderDataImportCenter();
  }

  function setDataImportBusy(kind) {
    state.dataImportCenter.busy = kind || "";
    renderDataImportCenter();
  }

  async function analyzeDataImportFiles() {
    const center = state.dataImportCenter;
    if (center.busy) return;
    const selected = DATA_IMPORT_SCOPES.filter((scope) => center.files[scope.key]);
    if (!selected.length) {
      setDataImportMessage("Analiz için en az bir Excel dosyası seçin.", "error");
      return;
    }

    center.analysisEpoch += 1;
    const analysisEpoch = center.analysisEpoch;
    const selectedSignature = dataImportFileSelectionSignature(center.files);
    center.analysis = null;
    center.lastResult = null;
    center.issueScope = "all";
    center.issueCode = "all";
    center.archiveOnly = false;
    setDataImportBusy("analyze");
    center.message = "Dosyalar güvenli analiz için hazırlanıyor…";
    center.messageType = "info";
    renderDataImportCenter();
    try {
      const files = {};
      const encoded = await Promise.all(selected.map(async (scope) => ({
        key: scope.key,
        filename: center.files[scope.key].name,
        contentBase64: await fileToBase64(center.files[scope.key])
      })));
      encoded.forEach((item) => {
        files[item.key] = { filename: item.filename, contentBase64: item.contentBase64 };
      });
      const requestId = createRequestId("data-import-analysis");
      const result = await backendRequest("/api/admin/data-imports/analyze", {
        method: "POST",
        headers: { "X-Request-ID": requestId },
        body: { requestId, files }
      });
      if (analysisEpoch !== center.analysisEpoch || selectedSignature !== dataImportFileSelectionSignature(center.files)) {
        return;
      }
      center.analysis = normalizeDataImportAnalysis(result);
      center.lastResult = null;
      const hasErrors = Number(center.analysis.report && center.analysis.report.errorCount || 0) > 0
        || center.analysis.issues.some((issue) => dataImportIssueSeverity(issue) === "error");
      const hasChanges = dataImportAnalysisHasChanges(center.analysis);
      const applicableDomains = dataImportApplicableDomains(center.analysis);
      const blockedDomains = dataImportBlockedDomains(center.analysis);
      center.message = applicableDomains.length
        ? `Analiz tamamlandı. Uygulanmaya hazır: ${dataImportDomainListLabel(applicableDomains)}.${blockedDomains.length ? ` Engelli: ${dataImportDomainListLabel(blockedDomains)}.` : ""}`
        : hasErrors
          ? "Analiz tamamlandı; kritik kayıtlar giderilmeden uygulama yapılamaz."
          : hasChanges
            ? "Analiz tamamlandı; yalnız uyarı içeren kayıtları inceleyin."
            : "Analiz tamamlandı. Kalıcı veride uygulanacak yeni bir değişiklik bulunmadı.";
      center.messageType = applicableDomains.length ? (blockedDomains.length ? "warning" : "success") : (!hasChanges ? "success" : (hasErrors ? "error" : "warning"));
    } catch (error) {
      center.analysis = null;
      center.message = error.message || "Excel dosyaları analiz edilemedi.";
      center.messageType = "error";
    } finally {
      center.busy = "";
      renderDataImportCenter();
    }
  }

  async function applyDataImportAnalysis() {
    const center = state.dataImportCenter;
    const analysis = center.analysis;
    if (center.busy || !analysis || analysis.applied) return;
    if (!dataImportAnalysisHasChanges(analysis)) {
      setDataImportMessage("Analiz tamamlandı. Kalıcı veride uygulanacak değişiklik bulunmadığı için yeni bir işlem oluşturulmadı.", "success");
      return;
    }
    const applicableDomains = dataImportApplicableDomains(analysis);
    if (!applicableDomains.length) return;
    if (hasPendingChanges()) {
      setDataImportMessage("Kalıcı veri aktarımından önce mevcut taslak değişikliklerini Kaydet ve Yayınla ile tamamlayın.", "error");
      return;
    }
    const blockedDomains = dataImportBlockedDomains(analysis);
    const report = analysis.report || {};
    const archived = Number(report.archived || 0);
    const requiresArchiveConfirmation = report.requiresArchiveConfirmation === true;
    const domainConfirmation = `Uygulanacak: ${dataImportDomainListLabel(applicableDomains)}.\nEngelli: ${blockedDomains.length ? dataImportDomainListLabel(blockedDomains) : "Yok"}.`;
    const confirmationMessage = requiresArchiveConfirmation
      ? `${domainConfirmation}\n\nBu aktarım ${archived} kaydı arşivleyecek ve ilgili canlı veri revizyonlarını güncelleyecek. Önizlemeyi kontrol ettiniz mi; atomik uygulamaya devam edilsin mi?`
      : `${domainConfirmation}\n\nÖnizlenen Excel değişiklikleri kalıcı store'a atomik olarak uygulansın mı?`;
    if (!window.confirm(confirmationMessage)) return;
    const requestId = createRequestId("data-import-apply");
    setDataImportBusy("apply");
    center.message = "Onaylanan analiz backend üzerinde atomik olarak uygulanıyor…";
    center.messageType = "info";
    renderDataImportCenter();
    try {
      const result = await backendRequest("/api/admin/data-imports/apply", {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Request-ID": requestId },
        body: {
          analysisId: analysis.analysisId,
          expectedRevision: analysis.expectedRevision,
          domains: applicableDomains,
          confirmArchiveImpact: requiresArchiveConfirmation,
          requestId
        }
      });
      center.lastResult = result;
      center.analysis = Object.assign({}, analysis, { canApply: false, applied: true, appliedDomains: applicableDomains });
      center.message = `${dataImportDomainListLabel(applicableDomains)} kalıcı veriye uygulandı${blockedDomains.length ? `; ${dataImportDomainListLabel(blockedDomains)} uygulanmadı` : ""}${result.operationId ? ` · İşlem ${result.operationId}` : ""}.`;
      center.messageType = "success";
      await Promise.all([hydrateFromBackend(), hydrateStockFromBackend()]);
      await loadDataImportHistory(true);
    } catch (error) {
      const staleAnalysis = error.status === 409 && /revizyon|analizden sonra|yeniden analiz/i.test(String(error.message || ""));
      if (staleAnalysis) {
        center.analysis = Object.assign({}, analysis, {
          canApply: false,
          domains: Object.fromEntries(Object.entries(analysis.domains || {}).map(([key, domain]) => [key, Object.assign({}, domain, { canApply: false })])),
          blockedReasons: ["Veri revizyonu analizden sonra değişti. Dosyaları yeniden analiz edin."]
        });
      }
      center.message = staleAnalysis
        ? "Veri revizyonu analizden sonra değişti. Dosyaları yeniden analiz edin."
        : (error.message || "Excel aktarımı uygulanamadı.");
      center.messageType = "error";
    } finally {
      center.busy = "";
      renderDataImportCenter();
    }
  }

  async function loadDataImportHistory(force) {
    const center = state.dataImportCenter;
    if (!els.dataImportHistoryList || (center.busy && !force)) return;
    if (center.historyLoaded && !force) {
      renderDataImportCenter();
      return;
    }
    const previousBusy = center.busy;
    if (!previousBusy) setDataImportBusy("history");
    try {
      const result = await backendRequest("/api/admin/data-imports/history?limit=50");
      center.history = Array.isArray(result.history)
        ? result.history
        : (Array.isArray(result.items) ? result.items : (Array.isArray(result.operations) ? result.operations : []));
      center.historyRevision = result.revision ?? result.currentRevision ?? center.historyRevision;
      center.historyLoaded = true;
    } catch (error) {
      center.message = error.message || "Aktarım geçmişi yüklenemedi.";
      center.messageType = "error";
    } finally {
      if (!previousBusy) center.busy = "";
      renderDataImportCenter();
    }
  }

  async function handleDataImportHistoryAction(event) {
    const button = event.target.closest("[data-data-import-undo]");
    const center = state.dataImportCenter;
    if (!button || center.busy || button.disabled) return;
    const operationId = button.dataset.dataImportUndo;
    const operation = center.history.find((item) => String(dataImportOperationId(item)) === String(operationId));
    if (!operation || !window.confirm("Bu Excel aktarımı güvenli bir geri alma işlemiyle geri alınsın mı?")) return;
    const requestId = createRequestId("data-import-undo");
    setDataImportBusy("undo");
    try {
      const expectedRevision = operation.expectedRevision
        ?? operation.currentRevision
        ?? center.historyRevision
        ?? operation.revision;
      const result = await backendRequest(`/api/admin/data-imports/${encodeURIComponent(operationId)}/undo`, {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Request-ID": requestId },
        body: { expectedRevision, requestId }
      });
      center.lastResult = result;
      center.analysis = null;
      center.message = "Excel aktarımı backend tarafından güvenli biçimde geri alındı.";
      center.messageType = "success";
      await Promise.all([hydrateFromBackend(), hydrateStockFromBackend()]);
      await loadDataImportHistory(true);
    } catch (error) {
      center.message = error.status === 409
        ? "Geri alma, sonradan yapılan değişiklikleri korumak için durduruldu. Geçmişi yenileyin."
        : (error.message || "Excel aktarımı geri alınamadı.");
      center.messageType = "error";
    } finally {
      center.busy = "";
      renderDataImportCenter();
    }
  }

  function normalizeDataImportAnalysis(result) {
    const source = result && result.analysis && typeof result.analysis === "object" ? result.analysis : (result || {});
    const report = source.report || result.report || source.summary || result.summary || {};
    const changes = Array.isArray(source.changes) ? source.changes : (Array.isArray(result.changes) ? result.changes : []);
    const issues = normalizeDataImportIssues(source, result);
    const legacyCanApplyValue = source.canApply ?? result.canApply;
    const domains = normalizeDataImportDomains(source, result, report, changes, issues, legacyCanApplyValue);
    return {
      analysisId: source.analysisId || result.analysisId || source.id || "",
      expectedRevision: source.expectedRevision ?? result.expectedRevision ?? source.baseRevision ?? result.baseRevision,
      report,
      changes,
      issues,
      domains,
      canApply: DATA_IMPORT_DOMAINS.some((domain) => domains[domain.key] && domains[domain.key].selected && domains[domain.key].canApply && domains[domain.key].changeCount > 0),
      workbookReports: source.workbookReports || source.fileReports || report.workbooks || report.byWorkbook || report.files || {},
      crossLinks: source.crossLinks || source.crossLinkSummary || report.crossLinks || report.links || {},
      blockedReasons: normalizeDataImportBlockedReasons(source, result, report),
      createdAt: source.createdAt || result.createdAt || new Date().toISOString(),
      applied: false
    };
  }

  function normalizeDataImportDomains(source, result, report, changes, issues, legacyCanApplyValue) {
    const raw = [
      source.domains, result.domains, source.domainReadiness, result.domainReadiness,
      source.domainResults, result.domainResults, report.domains, report.domainReadiness
    ].find((item) => item && typeof item === "object") || null;
    return DATA_IMPORT_DOMAINS.reduce((domains, definition) => {
      const aliases = definition.key === "catalog" ? ["catalog", "menupricing", "menu"]
        : definition.key === "recipes" ? ["recipes", "recipe"] : ["stock", "inventory"];
      let value = null;
      if (Array.isArray(raw)) value = raw.find((item) => aliases.includes(dataImportDomainKey(item && (item.key || item.domain || item.name))));
      else if (raw) {
        const rawKey = Object.keys(raw).find((key) => aliases.includes(dataImportDomainKey(key)));
        value = rawKey ? raw[rawKey] : null;
      }
      const domainIssues = issues.filter((issue) => dataImportDomainForRecord(issue) === definition.key);
      const errorCount = dataImportDomainMetric(value, ["errorCount", "errors", "blockingErrorCount"], domainIssues.filter((issue) => dataImportIssueSeverity(issue) === "error").length);
      const warningCount = dataImportDomainMetric(value, ["warningCount", "warnings"], domainIssues.filter((issue) => dataImportIssueSeverity(issue) !== "error").length);
      const inferredChangeCount = changes.filter((change) => dataImportDomainForRecord(change) === definition.key).length;
      const changeCount = dataImportDomainMetric(value, ["changeCount", "changedCount", "changes", "totalChanges"], inferredChangeCount);
      const fileSelected = definition.scopes.some((scope) => Boolean(state.dataImportCenter.files[scope]));
      const selected = value && Object.prototype.hasOwnProperty.call(value, "selected")
        ? value.selected === true
        : (fileSelected || Boolean(value));
      const blockingIssuesValue = value && (value.blockingIssues || value.blockedReasons || value.blockingReasons || value.errors);
      const blockingIssues = (Array.isArray(blockingIssuesValue) ? blockingIssuesValue : (blockingIssuesValue ? [blockingIssuesValue] : []))
        .map((item) => typeof item === "string" ? item : (item.message || item.reason || item.code || ""))
        .filter(Boolean);
      if (!blockingIssues.length) domainIssues.filter((issue) => dataImportIssueSeverity(issue) === "error").forEach((issue) => {
        blockingIssues.push(issue.message || issue.reason || dataImportIssueCode(issue));
      });
      const explicitCanApply = value && (value.canApply ?? value.ready ?? value.isReady);
      const canApply = selected && (explicitCanApply !== undefined
        ? explicitCanApply === true
        : (legacyCanApplyValue !== undefined ? legacyCanApplyValue === true : errorCount === 0));
      domains[definition.key] = { selected, changeCount, warningCount, errorCount, canApply, blockingIssues };
      return domains;
    }, {});
  }

  function dataImportDomainMetric(source, keys, fallback) {
    if (source && typeof source === "object") {
      for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) return value.length;
        if (Number.isFinite(Number(value))) return Number(value);
      }
    }
    return Number(fallback || 0);
  }

  function normalizeDataImportBlockedReasons(source, result, report) {
    const candidates = [
      source.blockedReasons, source.blockReasons, source.applyBlockedReasons,
      result.blockedReasons, result.blockReasons, result.applyBlockedReasons,
      report.blockedReasons, report.blockReasons, report.applyBlockedReasons
    ];
    const reasons = candidates.find(Array.isArray) || [];
    const single = source.blockedReason || source.blockReason || result.blockedReason || result.blockReason || report.blockedReason || report.blockReason;
    return reasons.concat(single ? [single] : []).map((item) => typeof item === "string" ? item : (item.message || item.reason || item.code || "")).filter(Boolean);
  }

  function normalizeDataImportIssues(source, result) {
    const direct = Array.isArray(source.issues) ? source.issues : (Array.isArray(result.issues) ? result.issues : []);
    const report = source.report || result.report || {};
    const errors = Array.isArray(report.errors) ? report.errors.map((item) => Object.assign({ severity: "error" }, item)) : [];
    const warnings = Array.isArray(report.warnings) ? report.warnings.map((item) => Object.assign({ severity: "warning" }, item)) : [];
    return direct.concat(errors, warnings);
  }

  function renderDataImportCenter() {
    if (!els.dataImportCenter) return;
    const center = state.dataImportCenter;
    if (els.dataImportRevision && !center.analysis) {
      els.dataImportRevision.textContent = center.historyRevision !== null && center.historyRevision !== undefined
        ? `Güncel revizyon ${formatDataImportValue(center.historyRevision)}`
        : "Revizyon bekleniyor";
    }
    const selectedCount = DATA_IMPORT_SCOPES.filter((scope) => center.files[scope.key]).length;
    DATA_IMPORT_SCOPES.forEach((scope) => {
      const file = center.files[scope.key];
      const card = els.dataImportCenter.querySelector(`[data-import-file-card="${scope.key}"]`);
      if (card) card.classList.toggle("has-file", Boolean(file));
      if (els[scope.name]) els[scope.name].textContent = file ? `${file.name} · ${formatDataImportFileSize(file.size)}` : "Henüz dosya seçilmedi.";
      if (els[scope.input]) els[scope.input].disabled = Boolean(center.busy);
      const clear = els.dataImportCenter.querySelector(`[data-data-import-clear="${scope.key}"]`);
      if (clear) {
        clear.hidden = !file;
        clear.disabled = Boolean(center.busy);
      }
    });
    if (els.dataImportFileCount) els.dataImportFileCount.textContent = `${selectedCount} / 4 dosya`;
    if (els.dataImportAnalyze) {
      els.dataImportAnalyze.disabled = Boolean(center.busy) || selectedCount === 0;
      els.dataImportAnalyze.textContent = center.busy === "analyze" ? "Analiz Ediliyor…" : "Backend’de Analiz Et";
    }
    if (els.dataImportApply) {
      els.dataImportApply.disabled = Boolean(center.busy) || !center.analysis || !dataImportAnalysisHasChanges(center.analysis) || dataImportApplicableDomains(center.analysis).length === 0 || center.analysis.applied;
      els.dataImportApply.textContent = center.busy === "apply" ? "Uygulanıyor…" : "Onayla ve Atomik Uygula";
    }
    if (els.dataImportReset) els.dataImportReset.disabled = Boolean(center.busy) || (selectedCount === 0 && !center.analysis && !center.lastResult);
    if (els.dataImportRefreshHistory) {
      els.dataImportRefreshHistory.disabled = Boolean(center.busy);
      els.dataImportRefreshHistory.textContent = center.busy === "history" ? "Yükleniyor…" : "Geçmişi Yenile";
    }
    if (els.dataImportMessage) {
      els.dataImportMessage.hidden = !center.message;
      els.dataImportMessage.textContent = center.message;
      els.dataImportMessage.className = `data-import-message is-${center.messageType || "info"}`;
    }
    [els.dataImportArchiveOnly, els.dataImportIssueScope, els.dataImportIssueCode].forEach((control) => {
      if (control) control.disabled = Boolean(center.busy) || !center.analysis;
    });
    renderDataImportSteps();
    renderDataImportAnalysis();
    renderDataImportHistory();
  }

  function renderDataImportSteps() {
    const center = state.dataImportCenter;
    const steps = Array.from(els.dataImportCenter.querySelectorAll("[data-data-import-step]"));
    steps.forEach((step) => step.classList.remove("is-active", "is-complete"));
    if (center.lastResult) {
      steps.forEach((step) => step.classList.add("is-complete"));
      return;
    }
    const active = center.busy === "apply" ? "apply" : (center.analysis ? "preview" : (center.busy === "analyze" ? "analysis" : "files"));
    const order = ["files", "analysis", "preview", "apply"];
    steps.forEach((step) => {
      const index = order.indexOf(step.dataset.dataImportStep);
      const activeIndex = order.indexOf(active);
      step.classList.toggle("is-complete", index < activeIndex);
      step.classList.toggle("is-active", index === activeIndex);
    });
  }

  function renderDataImportAnalysis() {
    const center = state.dataImportCenter;
    const analysis = center.analysis;
    if (!els.dataImportAnalysis) return;
    els.dataImportAnalysis.hidden = !analysis;
    if (!analysis) return;
    if (els.dataImportRevision) els.dataImportRevision.textContent = analysis.expectedRevision !== undefined
      ? `Analiz revizyonu ${formatDataImportValue(analysis.expectedRevision)}`
      : "Analiz revizyonu backend tarafından saklanıyor";
    if (els.dataImportAnalysisMeta) els.dataImportAnalysisMeta.textContent = `${formatDateTime(analysis.createdAt) || "Şimdi"} · Analiz ${analysis.analysisId || "kimliği backend'de"}`;
    if (els.dataImportReadiness) {
      const hasChanges = dataImportAnalysisHasChanges(analysis);
      const ready = dataImportApplicableDomains(analysis);
      const blocked = dataImportBlockedDomains(analysis);
      els.dataImportReadiness.textContent = analysis.applied
        ? "Uygulandı"
        : (blocked.length && !ready.length
          ? "Uygulama engelli"
          : (!hasChanges ? "Değişiklik yok" : (ready.length ? (blocked.length ? "Kısmen hazır" : "Uygulamaya hazır") : "Uygulama engelli")));
      els.dataImportReadiness.className = `ui-badge ${analysis.applied || (ready.length && !blocked.length) ? "is-success" : (hasChanges ? "is-warning" : "")}`.trim();
    }
    if (els.dataImportStats) {
      els.dataImportStats.innerHTML = dataImportSummaryEntries(analysis.report).map((item) => `
        <article><span>${escapeHTML(item.label)}</span><strong>${escapeHTML(String(item.value))}</strong></article>
      `).join("");
    }

    renderDataImportDomains(analysis);
    renderDataImportWorkbookSummary(analysis);
    renderDataImportCrossLinkSummary(analysis);
    renderDataImportApplyBlocker(analysis);

    const allChanges = analysis.changes || [];
    const productCodeLookup = dataImportProductCodeLookup(allChanges);
    if (els.dataImportArchiveOnly) els.dataImportArchiveOnly.checked = Boolean(center.archiveOnly);
    const changes = center.archiveOnly ? allChanges.filter(isDataImportArchiveChange) : allChanges;
    if (els.dataImportChangeCount) {
      els.dataImportChangeCount.textContent = center.archiveOnly
        ? `${changes.length} / ${allChanges.length} kayıt`
        : `${allChanges.length} kayıt`;
    }
    if (els.dataImportChanges) {
      els.dataImportChanges.innerHTML = changes.length ? changes.slice(0, 400).map((change) => `
        <tr class="${isDataImportArchiveChange(change) ? "is-archive" : ""}">
          <td>${escapeHTML(dataImportScopeLabel(change.scope || change.workbook || change.sourceWorkbook))}</td>
          <td><strong>${escapeHTML(change.category || change.sheet || change.sourceSheet || "-")}</strong><small>${escapeHTML(change.product || change.name || change.item || "-")}</small></td>
          <td><code class="data-import-product-code">${escapeHTML(dataImportProductCode(change) || productCodeLookup.get(dataImportChangeIdentity(change)) || "-")}</code></td>
          <td>${escapeHTML(change.field || change.path || "-")}</td>
          <td>${escapeHTML(formatDataImportValue(change.oldValue ?? change.before))}</td>
          <td>${escapeHTML(formatDataImportValue(change.newValue ?? change.after))}</td>
          <td><span class="data-import-action-tag">${escapeHTML(change.operation || change.action || change.changeType || change.type || "Değişiklik")}</span><small>${escapeHTML(change.activeEffect || change.statusSource || change.statusOwner || "Durum korunur")}</small></td>
        </tr>
      `).join("") : `<tr><td colspan="7"><div class="empty-mini">${center.archiveOnly ? "Arşivlenecek kayıt bulunmadı." : "Değişiklik bulunmadı."}</div></td></tr>`;
    }

    const allIssues = analysis.issues || [];
    renderDataImportIssueFilterOptions(allIssues);
    const issues = allIssues.filter((issue) => {
      const scope = dataImportIssueScopeKey(issue);
      const code = dataImportIssueCode(issue);
      return (center.issueScope === "all" || center.issueScope === scope)
        && (center.issueCode === "all" || center.issueCode === code);
    });
    if (els.dataImportIssueCount) {
      const filtered = center.issueScope !== "all" || center.issueCode !== "all";
      els.dataImportIssueCount.textContent = filtered ? `${issues.length} / ${allIssues.length} kayıt` : `${allIssues.length} kayıt`;
    }
    if (els.dataImportIssues) {
      els.dataImportIssues.innerHTML = issues.length ? issues.slice(0, 300).map((issue) => `
        <article class="is-${escapeAttribute(dataImportIssueSeverity(issue))}">
          <div><strong>${escapeHTML(dataImportIssueScopeLabel(issue))}</strong><span>${escapeHTML(dataImportIssueCode(issue))}</span></div>
          <p class="data-import-issue-reason"><strong>Neden:</strong> ${escapeHTML(issue.message || issue.reason || "İnceleme gereken kayıt")}</p>
          <dl class="data-import-issue-detail">
            <div><dt>Dosya</dt><dd>${escapeHTML(issue.filename || issue.fileName || issue.file || issue.sourceFile || issue.workbook || issue.sourceWorkbook || "-")}</dd></div>
            <div><dt>Sayfa</dt><dd>${escapeHTML(issue.sheet || issue.sheetName || issue.sourceSheet || "-")}</dd></div>
            <div><dt>Satır</dt><dd>${escapeHTML(formatDataImportValue(issue.rowNumber || issue.row || issue.sourceRow))}</dd></div>
            <div><dt>Ürün</dt><dd>${escapeHTML(issue.product || issue.productName || issue.name || issue.item || "-")}</dd></div>
            <div><dt>Ürün Kodu</dt><dd><code class="data-import-product-code">${escapeHTML(dataImportProductCode(issue, true) || "-")}</code></dd></div>
          </dl>
        </article>
      `).join("") : `<div class="empty-mini">${allIssues.length ? "Seçili filtrelerle eşleşen kayıt yok." : "Uyarı veya hata bulunmadı."}</div>`;
    }
  }

  function renderDataImportDomains(analysis) {
    if (!els.dataImportDomains) return;
    els.dataImportDomains.innerHTML = DATA_IMPORT_DOMAINS.map((definition) => {
      const domain = analysis.domains && analysis.domains[definition.key] || {};
      const hasChanges = Number(domain.changeCount || 0) > 0;
      let statusKey = "not-selected";
      let statusLabel = "Seçilmedi";
      if (analysis.applied && (analysis.appliedDomains || []).includes(definition.key)) {
        statusKey = "ready";
        statusLabel = "Uygulandı";
      } else if (domain.selected) {
        if (!hasChanges && Number(domain.errorCount || 0) === 0) {
          statusKey = "unchanged";
          statusLabel = "Değişiklik yok";
        } else if (domain.canApply && hasChanges) {
          statusKey = "ready";
          statusLabel = "Uygulamaya hazır";
        } else {
          statusKey = "blocked";
          statusLabel = "Engelli";
        }
      }
      const blocking = Array.isArray(domain.blockingIssues) ? domain.blockingIssues.filter(Boolean) : [];
      return `<article class="data-import-domain-card is-${statusKey}">
        <header><strong>${escapeHTML(definition.label)}</strong><span>${escapeHTML(statusLabel)}</span></header>
        <dl><div><dt>Değişiklik</dt><dd>${Number(domain.changeCount || 0)}</dd></div><div><dt>Uyarı</dt><dd>${Number(domain.warningCount || 0)}</dd></div><div><dt>Hata</dt><dd>${Number(domain.errorCount || 0)}</dd></div></dl>
        ${blocking.length ? `<ul>${blocking.slice(0, 3).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>` : ""}
      </article>`;
    }).join("");
  }

  function renderDataImportWorkbookSummary(analysis) {
    if (!els.dataImportWorkbookSummary) return;
    const reports = analysis.workbookReports;
    const cards = DATA_IMPORT_SCOPES.map((scope) => {
      const source = Array.isArray(reports)
        ? reports.find((item) => dataImportScopeKey(item.scope || item.workbook || item.key) === scope.key)
        : (reports && (reports[scope.key] || reports[scope.label])) || {};
      const changes = analysis.changes.filter((item) => dataImportScopeKey(item.scope || item.workbook || item.sourceWorkbook) === scope.key).length;
      const issues = analysis.issues.filter((item) => dataImportScopeKey(item.scope || item.workbook || item.sourceWorkbook) === scope.key);
      const rows = firstImportMetric(source, ["readRows", "rowCount", "totalRows", "rowsRead"]);
      const errors = issues.filter((item) => dataImportIssueSeverity(item) === "error").length;
      const warnings = issues.length - errors;
      const file = state.dataImportCenter.files[scope.key];
      const included = Boolean(file || Object.keys(source || {}).length || changes || issues.length);
      if (!included) return "";
      return `<article>
        <header><strong>${escapeHTML(scope.label)}</strong><span>${escapeHTML(file ? file.name : "Backend raporu")}</span></header>
        <dl><div><dt>Satır</dt><dd>${rows}</dd></div><div><dt>Değişiklik</dt><dd>${changes}</dd></div><div><dt>Uyarı</dt><dd>${warnings}</dd></div><div><dt>Hata</dt><dd>${errors}</dd></div></dl>
      </article>`;
    }).filter(Boolean);
    els.dataImportWorkbookSummary.innerHTML = cards.length ? cards.join("") : `<div class="empty-mini">Dosya bazlı rapor bulunmadı.</div>`;
  }

  function renderDataImportCrossLinkSummary(analysis) {
    if (!els.dataImportCrossLinkSummary) return;
    const source = analysis.crossLinks && typeof analysis.crossLinks === "object" ? analysis.crossLinks : {};
    if (Array.isArray(source) && source.length) {
      els.dataImportCrossLinkSummary.innerHTML = source.map((item) => `<article><span>${escapeHTML(item.label || item.name || item.code || "Bağlantı")}</span><strong>${escapeHTML(formatDataImportValue(item.value ?? item.count ?? item.status))}</strong></article>`).join("");
      return;
    }
    const report = analysis.report || {};
    const definitions = [
      ["Kodla eşleşen", ["linkedByProductCode", "productCodeMatches", "codeMatches"]],
      ["Bağlı reçete", ["linkedRecipes", "linkedRecipeCount"]],
      ["Bağlı stok", ["linkedStockProducts", "linkedStockCount"]],
      ["Karşılıksız fiyat", ["orphanPrices", "unmatchedPrices", "unmatchedPricing"]],
      ["Bağlantısız reçete", ["unlinkedRecipes", "unlinkedRecipeCount"]],
      ["Kod çakışması", ["productCodeConflicts", "codeConflicts", "duplicateProductCodes"]]
    ];
    const entries = definitions.map(([label, keys]) => ({ label, value: firstImportMetric(source, keys) || firstImportMetric(report, keys) }));
    els.dataImportCrossLinkSummary.innerHTML = entries.map((item) => `<article class="${item.value ? "has-value" : ""}"><span>${escapeHTML(item.label)}</span><strong>${item.value}</strong></article>`).join("");
  }

  function renderDataImportApplyBlocker(analysis) {
    if (!els.dataImportApplyBlocker) return;
    const applicableDomains = dataImportApplicableDomains(analysis);
    const blockedDomains = dataImportBlockedDomains(analysis);
    if (analysis.applied || (!dataImportAnalysisHasChanges(analysis) && !blockedDomains.length) || (!blockedDomains.length && applicableDomains.length)) {
      els.dataImportApplyBlocker.hidden = true;
      els.dataImportApplyBlocker.innerHTML = "";
      return;
    }
    const reasons = blockedDomains.flatMap((domainKey) => {
      const domain = analysis.domains && analysis.domains[domainKey] || {};
      return (domain.blockingIssues || []).map((reason) => `${dataImportDomainLabel(domainKey)}: ${reason}`);
    }).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
    if (!reasons.length && !applicableDomains.length) {
      const errorIssues = analysis.issues.filter((issue) => dataImportIssueSeverity(issue) === "error");
      reasons.push(...[...analysis.blockedReasons, ...errorIssues.map((issue) => issue.message || issue.reason || dataImportIssueCode(issue))]
        .filter(Boolean).filter((item, index, list) => list.indexOf(item) === index));
    }
    if (!reasons.length && blockedDomains.length) reasons.push("Seçili veri alanı backend doğrulaması nedeniyle engelli.");
    if (!reasons.length && !analysis.changes.length) reasons.push("Kalıcı veride uygulanacak yeni bir değişiklik bulunmuyor.");
    if (!reasons.length) reasons.push("Backend bu analizi atomik uygulama için uygun bulmadı.");
    els.dataImportApplyBlocker.hidden = false;
    els.dataImportApplyBlocker.classList.toggle("is-partial", applicableDomains.length > 0);
    els.dataImportApplyBlocker.innerHTML = `<strong>${applicableDomains.length ? `${dataImportDomainListLabel(applicableDomains)} uygulanabilir; ${dataImportDomainListLabel(blockedDomains)} engelli` : "Uygulama engelli"}</strong><ul>${reasons.slice(0, 8).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>`;
  }

  function renderDataImportIssueFilterOptions(issues) {
    const center = state.dataImportCenter;
    const scopes = [...new Set(issues.map(dataImportIssueScopeKey).filter(Boolean))].sort();
    const codes = [...new Set(issues.map(dataImportIssueCode).filter(Boolean))].sort();
    if (!scopes.includes(center.issueScope)) center.issueScope = "all";
    if (!codes.includes(center.issueCode)) center.issueCode = "all";
    if (els.dataImportIssueScope) {
      els.dataImportIssueScope.innerHTML = `<option value="all">Tümü</option>${scopes.map((scope) => `<option value="${escapeAttribute(scope)}">${escapeHTML(dataImportDomainKey(scope) === scope ? dataImportDomainLabel(scope) : dataImportScopeLabel(scope))}</option>`).join("")}`;
      els.dataImportIssueScope.value = center.issueScope;
    }
    if (els.dataImportIssueCode) {
      els.dataImportIssueCode.innerHTML = `<option value="all">Tümü</option>${codes.map((code) => `<option value="${escapeAttribute(code)}">${escapeHTML(code)}</option>`).join("")}`;
      els.dataImportIssueCode.value = center.issueCode;
    }
  }

  function dataImportProductCode(record, issueRecord) {
    if (!record || typeof record !== "object") return "";
    return String(record.productCode || record.product_code || record.externalProductCode || record.sourceProductCode || record.itemCode || record.sku || (!issueRecord ? record.code : "") || "").trim();
  }

  function dataImportProductCodeLookup(changes) {
    const lookup = new Map();
    changes.forEach((change) => {
      const direct = dataImportProductCode(change);
      const field = String(change && (change.field || change.path) || "").toLowerCase().replace(/[^a-z]/g, "");
      const fromField = field.includes("productcode") || field.includes("externalid")
        ? String(change.newValue ?? change.after ?? "").trim()
        : "";
      const code = direct || fromField;
      if (code) lookup.set(dataImportChangeIdentity(change), code);
    });
    return lookup;
  }

  function dataImportChangeIdentity(record) {
    return [
      dataImportScopeKey(record && (record.scope || record.workbook || record.sourceWorkbook)),
      String(record && (record.category || record.sheet || record.sourceSheet) || "").trim().toLocaleLowerCase("tr-TR"),
      String(record && (record.product || record.name || record.item) || "").trim().toLocaleLowerCase("tr-TR")
    ].join("|");
  }

  function dataImportIssueCode(issue) {
    return String(issue && (issue.issueCode || issue.code || issue.type || dataImportIssueSeverity(issue)) || "warning").trim().toLowerCase();
  }

  function dataImportIssueScopeKey(issue) {
    const value = issue && (issue.domain || issue.domainKey || issue.scope || issue.workbook || issue.sourceWorkbook);
    const domain = dataImportDomainKey(value);
    return DATA_IMPORT_DOMAINS.some((item) => item.key === domain) ? domain : dataImportScopeKey(value);
  }

  function dataImportIssueScopeLabel(issue) {
    const key = dataImportIssueScopeKey(issue);
    return DATA_IMPORT_DOMAINS.some((item) => item.key === key) ? dataImportDomainLabel(key) : dataImportScopeLabel(key);
  }

  function dataImportScopeKey(value) {
    const key = String(value || "").trim().toLowerCase();
    if (key === "price") return "pricing";
    if (key === "recipes") return "recipe";
    return key;
  }

  function dataImportDomainKey(value) {
    const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (["catalog", "menupricing", "menuprice", "menu", "pricing", "price"].includes(key)) return "catalog";
    if (["recipes", "recipe", "recete", "receteler"].includes(key)) return "recipes";
    if (["stock", "inventory", "stok"].includes(key)) return "stock";
    return key;
  }

  function dataImportDomainForRecord(record) {
    return dataImportDomainKey(record && (record.domain || record.domainKey || record.scope || record.workbook || record.sourceWorkbook));
  }

  function dataImportDomainLabel(value) {
    const key = dataImportDomainKey(value);
    const definition = DATA_IMPORT_DOMAINS.find((item) => item.key === key);
    return definition ? definition.label : String(value || "Veri alanı");
  }

  function dataImportDomainListLabel(values) {
    return values.map(dataImportDomainLabel).join(", ");
  }

  function dataImportApplicableDomains(analysis) {
    if (!analysis || !analysis.domains) return [];
    return DATA_IMPORT_DOMAINS.filter(({ key }) => {
      const domain = analysis.domains[key];
      return domain && domain.selected && domain.canApply === true && Number(domain.changeCount || 0) > 0;
    }).map(({ key }) => key);
  }

  function dataImportBlockedDomains(analysis) {
    if (!analysis || !analysis.domains) return [];
    return DATA_IMPORT_DOMAINS.filter(({ key }) => {
      const domain = analysis.domains[key];
      return domain && domain.selected && domain.canApply !== true && (Number(domain.changeCount || 0) > 0 || Number(domain.errorCount || 0) > 0 || (domain.blockingIssues || []).length > 0);
    }).map(({ key }) => key);
  }

  function isDataImportArchiveChange(change) {
    const operation = String(change && (change.operation || change.action || change.changeType || change.type) || "").toLowerCase();
    const effect = String(change && (change.activeEffect || change.statusSource || "") || "").toLowerCase();
    return operation.includes("archive") || operation.includes("remove") || effect.includes("deactivate")
      || (String(change && (change.field || change.path) || "").toLowerCase().includes("sourcepresent")
        && (change.newValue === false || change.after === false));
  }


  function renderDataImportHistory() {
    if (!els.dataImportHistoryList) return;
    const center = state.dataImportCenter;
    if (!center.historyLoaded && center.busy === "history") {
      els.dataImportHistoryList.innerHTML = `<div class="empty-mini">Aktarım geçmişi backend'den yükleniyor…</div>`;
      return;
    }
    if (!center.history.length) {
      els.dataImportHistoryList.innerHTML = `<div class="empty-mini">Henüz tamamlanmış Excel aktarımı yok.</div>`;
      return;
    }
    els.dataImportHistoryList.innerHTML = center.history.map((operation) => {
      const id = dataImportOperationId(operation);
      const scopes = dataImportHistoryScopes(operation);
      const historyState = dataImportHistoryState(operation);
      const canUndo = operation.canUndo === true && historyState.key === "applied" && !operation.undoneAt && !operation.undone;
      return `
        <article class="data-import-history-row ${historyState.key === "undone" ? "is-closed" : ""}">
          <div class="data-import-history-row__identity">
            <span>${escapeHTML(String(id || "İşlem"))}</span>
            <div><strong>${escapeHTML(scopes.length ? scopes.map(dataImportScopeLabel).join(" · ") : "Excel veri aktarımı")}</strong><small>${escapeHTML(formatDateTime(operation.createdAt || operation.analyzedAt || operation.appliedAt || operation.failedAt || operation.rolledBackAt || operation.timestamp) || "Tarih belirtilmedi")}</small></div>
          </div>
          <div class="data-import-history-row__summary">
            <span>Revizyon ${escapeHTML(formatDataImportValue(operation.revision ?? operation.resultRevision ?? operation.revisionAfter ?? operation.expectedRevision ?? "-"))}</span>
            <small>${escapeHTML(dataImportHistorySummary(operation))}</small>
          </div>
          <span class="data-import-history-status is-${historyState.key}">${escapeHTML(historyState.label)}</span>
          <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-data-import-undo="${escapeAttribute(String(id || ""))}" ${canUndo && id ? "" : "disabled"}>Geri Al</button>
        </article>
      `;
    }).join("");
  }

  function dataImportAnalysisHasChanges(analysis) {
    if (!analysis || typeof analysis !== "object") return false;
    if (Array.isArray(analysis.changes) && analysis.changes.length > 0) return true;
    if (analysis.domains && DATA_IMPORT_DOMAINS.some(({ key }) => Number(analysis.domains[key] && analysis.domains[key].changeCount || 0) > 0)) return true;
    const report = analysis.report && typeof analysis.report === "object" ? analysis.report : {};
    const count = report.changeCount ?? report.changedCount ?? report.totalChanges ?? analysis.changeCount;
    return Number.isFinite(Number(count)) && Number(count) > 0;
  }

  function dataImportHistoryScopes(operation) {
    const direct = operation && (operation.changedScopes || operation.scopes || operation.importScope);
    if (Array.isArray(direct)) return direct.filter(Boolean);
    if (direct) return [direct];
    if (Array.isArray(operation && operation.files)) {
      return operation.files.map((file) => file && (file.workbook || file.scope || file.key)).filter(Boolean);
    }
    return Object.keys(operation && operation.files && typeof operation.files === "object" ? operation.files : {});
  }

  function dataImportHistoryState(operation) {
    const status = String(operation && (operation.status || operation.resultStatus) || "").toLocaleLowerCase("tr-TR");
    const validationStatus = String(operation && operation.validationStatus || "").toLocaleLowerCase("tr-TR");
    const failureState = `${status} ${validationStatus}`;
    const kind = String(operation && (operation.kind || operation.type) || "").toLocaleLowerCase("tr-TR");
    const validationFailed = failureState.includes("failed_readback")
      || failureState.includes("readback_failed")
      || failureState.includes("validation_failed")
      || failureState.includes("doğrulama_başarısız")
      || failureState.includes("dogrulama_basarisiz")
      || validationStatus === "failed"
      || validationStatus === "mismatch"
      || (validationStatus.includes("failed") && (operation.rollbackApplied || operation.rolledBackAt || operation.rollbackReason))
      || (status.includes("failed") && (operation.rollbackApplied || operation.rolledBackAt || operation.rollbackReason));
    if (validationFailed) {
      const rolledBack = Boolean(operation.rollbackApplied || operation.rolledBackAt || operation.undoneAt || operation.rollbackReason);
      return { key: "failed", label: rolledBack ? "Doğrulama başarısız — sistem geri aldı" : "Doğrulama başarısız" };
    }
    if (kind === "undo" || status === "undone" || status === "user_undone") {
      return { key: "undone", label: "Kullanıcı tarafından geri alındı" };
    }
    if (kind === "apply" && (operation.undoneAt || operation.undone)) {
      return { key: "undone", label: "Geri alındı" };
    }
    const unchanged = status === "unchanged" || status === "no_changes" || status === "no-change" || status === "no_change" || operation.unchanged === true;
    if (unchanged) return { key: "unchanged", label: "Değişiklik yok" };
    if (kind === "analysis" || kind === "analyze" || status === "analyzed" || status === "analysed") {
      const report = operation.report && typeof operation.report === "object" ? operation.report : {};
      const count = Number(operation.changeCount ?? report.changeCount ?? report.changedCount ?? 0);
      return count === 0
        ? { key: "unchanged", label: "Değişiklik yok" }
        : { key: "analyzed", label: "Analiz edildi" };
    }
    if (kind === "apply" || status === "applied" || status === "success" || status === "completed") {
      return { key: "applied", label: "Uygulandı" };
    }
    if (status.includes("failed")) return { key: "failed", label: "Doğrulama başarısız" };
    return { key: "analyzed", label: "Analiz edildi" };
  }

  function dataImportSummaryEntries(reportValue) {
    const report = reportValue && typeof reportValue === "object" ? reportValue : {};
    const definitions = [
      ["Okunan sayfa", ["readSheets", "sheetCount", "sheetsRead"]],
      ["Okunan satır", ["readRows", "rowCount", "totalRows", "rowsRead"]],
      ["Yeni kategori", ["newCategories", "createdCategories"]],
      ["Yeni ürün", ["newProducts", "createdProducts", "createdRecords"]],
      ["Güncellenecek", ["updatedProducts", "updatedRecords", "updatedCount"]],
      ["Değişiklik yok", ["unchanged", "unchangedCount"]],
      ["Arşivlenecek", ["archived", "archiveCount", "removedProducts"]],
      ["Yeniden bulunan", ["restored", "rediscovered", "reactivated"]],
      ["Manuel pasif", ["manualInactive", "manualInactivePreserved", "keptManualInactive"]],
      ["Geçersiz satır", ["invalidRows", "errorCount"]],
      ["Belirsiz eşleşme", ["ambiguousMatches", "ambiguousCount"]],
      ["Fiyatsız ürün", ["missingPrices", "missingPriceCount"]],
      ["Karşılıksız fiyat", ["orphanPrices", "unmatchedPrices", "unmatchedPricing"]],
      ["Bağlantısız reçete", ["unlinkedRecipes", "unlinkedRecipeCount"]],
      ["Stok inceleme", ["stockReviewRows", "manualStockReview", "manualReviewCount"]]
    ];
    const values = definitions.map(([label, keys]) => ({ label, value: firstImportMetric(report, keys) }));
    return values.filter((item, index) => item.value !== 0 || index < 6);
  }

  function firstImportMetric(report, keys) {
    for (const key of keys) {
      const value = report[key] ?? (report.summary && report.summary[key]) ?? (report.counts && report.counts[key]);
      if (Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }

  function dataImportOperationId(operation) {
    return operation && (operation.operationId || operation.id || operation.requestId || "");
  }

  function dataImportScopeLabel(value) {
    const key = String(value || "").toLowerCase();
    if (key === "menu") return "Menü";
    if (key === "pricing" || key === "price") return "Fiyat";
    if (key === "recipe" || key === "recipes") return "Reçete";
    if (key === "stock") return "Stok";
    return value ? String(value) : "Genel";
  }

  function dataImportIssueSeverity(issue) {
    const value = String(issue && (issue.severity || issue.level || issue.type) || "warning").toLowerCase();
    return ["critical", "fatal", "error"].includes(value) ? "error" : "warning";
  }

  function dataImportHistorySummary(operation) {
    const report = operation.report || operation.summary || {};
    const changed = Number(report.changedCount ?? report.updatedCount ?? operation.changedCount ?? 0);
    const created = Number(report.createdCount ?? report.newProducts ?? operation.createdCount ?? 0);
    const archived = Number(report.archivedCount ?? operation.archivedCount ?? 0);
    return `${created || 0} yeni · ${changed || 0} güncel · ${archived || 0} arşiv`;
  }

  function formatDataImportValue(value) {
    if (value === null) return "boş";
    if (value === undefined || value === "") return "-";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (_error) { return String(value); }
    }
    return String(value);
  }

  function formatDataImportFileSize(size) {
    const bytes = Number(size || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function dataImportFileSelectionSignature(files) {
    return DATA_IMPORT_SCOPES.map((scope) => {
      const file = files && files[scope.key];
      return file ? `${scope.key}:${file.name}:${file.size}:${file.lastModified || 0}` : `${scope.key}:-`;
    }).join("|");
  }

  async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return window.btoa(binary);
  }

  function renderRecipeEditor() {
    ensureRecipeSelection();
    const categories = recipeCategoryNames();
    const products = recipeProductNames(state.selectedRecipeCategory);
    const sizes = selectedRecipeSizes();
    const sizeEntries = Object.entries(sizes);
    if (!state.selectedRecipePreviewSize || !Object.prototype.hasOwnProperty.call(sizes, state.selectedRecipePreviewSize)) {
      state.selectedRecipePreviewSize = sizeEntries[0] ? sizeEntries[0][0] : "";
    }

    els.recipeCategorySelect.innerHTML = categories.map((category) => `
      <option value="${escapeAttribute(category)}">${escapeHTML(category)}</option>
    `).join("");
    els.recipeCategorySelect.value = state.selectedRecipeCategory;

    els.recipeProductSelect.innerHTML = products.map((product) => `
      <option value="${escapeAttribute(product)}">${escapeHTML(product)}</option>
    `).join("");
    els.recipeProductSelect.value = state.selectedRecipeProduct;

    els.recipeCategoryName.value = state.selectedRecipeCategory || "";
    els.recipeProductName.value = state.selectedRecipeProduct || "";
    els.deleteRecipeCategoryButton.disabled = !state.selectedRecipeCategory || categories.length <= 1;
    els.deleteRecipeProductButton.disabled = !state.selectedRecipeProduct;
    els.addRecipeProductButton.disabled = !state.selectedRecipeCategory;
    els.addRecipeSizeButton.disabled = !state.selectedRecipeProduct;

    if (!state.selectedRecipeProduct) {
      els.recipeSizeList.innerHTML = `<div class="recipe-empty">Bu kategoride henüz ürün yok. + Ürün ile başlayın.</div>`;
      return;
    }

    els.recipeSizeList.innerHTML = sizeEntries.length
      ? sizeEntries.map(([size, recipe]) => {
        const item = normalizeRecipeItem(recipe);
        return `
        <article class="recipe-size-row">
          <div class="recipe-size-head">
            <label>
              <span>Ölçü</span>
              <input class="recipe-size-name" type="text" value="${escapeAttribute(size)}" data-recipe-size-name="${escapeAttribute(size)}">
            </label>
            <button class="danger-action" type="button" data-delete-recipe-size="${escapeAttribute(size)}">Ölçüyü Sil</button>
          </div>
          <label>
            <span>İçerik</span>
            <textarea class="recipe-textarea" rows="3" data-recipe-body="${escapeAttribute(size)}" data-recipe-field="content">${escapeHTML(item.content)}</textarea>
          </label>
          <label>
            <span>Hazırlanışı</span>
            <textarea class="recipe-textarea" rows="5" data-recipe-body="${escapeAttribute(size)}" data-recipe-field="preparation">${escapeHTML(item.preparation)}</textarea>
          </label>
          <label>
            <span>Ürün Notu</span>
            <textarea class="recipe-textarea" rows="2" data-recipe-body="${escapeAttribute(size)}" data-recipe-field="note">${escapeHTML(item.note)}</textarea>
          </label>
          <div class="form-grid two recipe-size-meta">
            <label class="toggle-row">
              <input type="checkbox" data-recipe-body="${escapeAttribute(size)}" data-recipe-field="active" ${item.active !== false ? "checked" : ""}>
              <span>Aktif</span>
            </label>
            <label>
              <span>Sıralama</span>
              <input type="number" step="1" data-recipe-body="${escapeAttribute(size)}" data-recipe-field="order" value="${escapeAttribute(item.order || 0)}">
            </label>
          </div>
        </article>
      `;
      }).join("")
      : `<div class="recipe-empty">Bu üründe ölçü yok. + Ölçü ile 14 oz gibi yeni bir reçete ekleyin.</div>`;
  }

  function handleRecipeSizeInput(event) {
    const control = event.target.closest("[data-recipe-body]");
    if (!control || control.dataset.recipeSizeName) return;
    const sizes = selectedRecipeSizes();
    const size = control.dataset.recipeBody;
    if (!Object.prototype.hasOwnProperty.call(sizes, size)) return;
    const item = normalizeRecipeItem(sizes[size]);
    const field = control.dataset.recipeField || "content";
    if (field === "active") {
      item.active = control.checked;
    } else if (field === "order") {
      item.order = Number(control.value || 0) || 0;
    } else if (["content", "preparation", "note"].includes(field)) {
      item[field] = control.value;
    } else {
      return;
    }
    sizes[size] = item;
    saveRecipes({ render: false });
    renderPreview();
  }

  function handleRecipeSizeChange(event) {
    const input = event.target.closest("[data-recipe-size-name]");
    if (!input) return;
    const oldName = input.dataset.recipeSizeName;
    const nextName = input.value.trim() || oldName;
    const sizes = selectedRecipeSizes();
    if (nextName !== oldName && Object.prototype.hasOwnProperty.call(sizes, nextName)) {
      alert("Bu ölçü adı zaten var.");
      input.value = oldName;
      return;
    }
    if (nextName !== oldName) {
      sizes[nextName] = sizes[oldName] || "";
      delete sizes[oldName];
      if (state.selectedRecipePreviewSize === oldName) state.selectedRecipePreviewSize = nextName;
    }
    saveRecipes({ render: true });
  }

  function handleRecipeSizeClick(event) {
    const button = event.target.closest("[data-delete-recipe-size]");
    if (!button) return;
    const size = button.dataset.deleteRecipeSize;
    const sizes = selectedRecipeSizes();
    if (!Object.prototype.hasOwnProperty.call(sizes, size)) return;
    if (!confirm(`${state.selectedRecipeProduct} / ${size} reçetesi silinsin mi?`)) return;
    delete sizes[size];
    if (state.selectedRecipePreviewSize === size) state.selectedRecipePreviewSize = "";
    saveRecipes({ render: true });
  }

  function addRecipeCategory() {
    const name = uniqueName("Yeni Reçete", recipeCategoryNames());
    state.recipes[name] = {
      "14 oz Örnek İçecek": {
        "14 oz": {
          content: "Double shot espresso + soğuk süt + buz",
          preparation: "",
          note: ""
        }
      }
    };
    state.selectedRecipeCategory = name;
    state.selectedRecipeProduct = "14 oz Örnek İçecek";
    addRecipeCatalogEntry(name, state.selectedRecipeProduct);
    state.selectedRecipePreviewSize = "14 oz";
    saveRecipes({ render: true });
  }

  function addRecipeProduct() {
    if (!state.selectedRecipeCategory) return;
    const products = recipeProductNames(state.selectedRecipeCategory);
    const name = uniqueName("Yeni Ürün", products);
    state.recipes[state.selectedRecipeCategory][name] = {
      "14 oz": {
        content: "Reçete içeriğini buraya yazın",
        preparation: "",
        note: ""
      }
    };
    state.selectedRecipeProduct = name;
    state.selectedRecipePreviewSize = "14 oz";
    saveRecipes({ render: true });
  }

  function addRecipeSize() {
    const sizes = selectedRecipeSizes();
    if (!sizes) return;
    const name = uniqueName("14 oz", Object.keys(sizes));
    sizes[name] = {
      content: "Reçete içeriğini buraya yazın",
      preparation: "",
      note: ""
    };
    addRecipeCatalogEntry(state.selectedRecipeCategory, name);
    state.selectedRecipePreviewSize = name;
    saveRecipes({ render: true });
  }

  function deleteSelectedRecipeCategory() {
    if (!state.selectedRecipeCategory || recipeCategoryNames().length <= 1) return;
    const ids = state.recipeCatalog.filter((item) => item.category === state.selectedRecipeCategory).map((item) => item.id);
    const linkedCount = linkedMenuProductsForRecipeIds(ids).length;
    if (!confirm(`${state.selectedRecipeCategory} kategorisi ve içindeki reçeteler silinsin mi?${linkedCount ? ` ${linkedCount} menü ürünü manuel/boş içerik fallback'ine geçecek.` : ""}`)) return;
    state.recipeCatalog = state.recipeCatalog.filter((item) => item.category !== state.selectedRecipeCategory);
    delete state.recipes[state.selectedRecipeCategory];
    state.selectedRecipeCategory = "";
    state.selectedRecipeProduct = "";
    state.selectedRecipePreviewSize = "";
    ensureRecipeSelection();
    saveRecipes({ render: true });
  }

  function deleteSelectedRecipeProduct() {
    if (!state.selectedRecipeCategory || !state.selectedRecipeProduct) return;
    const catalogItem = state.recipeCatalog.find((item) => item.category === state.selectedRecipeCategory && item.product === state.selectedRecipeProduct);
    const linkedCount = linkedMenuProductsForRecipeIds(catalogItem ? [catalogItem.id] : []).length;
    if (!confirm(`${state.selectedRecipeProduct} ürünü ve ölçüleri silinsin mi?${linkedCount ? ` ${linkedCount} bağlı menü ürünü manuel/boş içerik fallback'ine geçecek.` : ""}`)) return;
    if (catalogItem) state.recipeCatalog = state.recipeCatalog.filter((item) => item.id !== catalogItem.id);
    delete state.recipes[state.selectedRecipeCategory][state.selectedRecipeProduct];
    state.selectedRecipeProduct = "";
    state.selectedRecipePreviewSize = "";
    ensureRecipeSelection();
    saveRecipes({ render: true });
  }

  function renameSelectedRecipeCategory() {
    const oldName = state.selectedRecipeCategory;
    const nextName = els.recipeCategoryName.value.trim() || oldName;
    if (!oldName || nextName === oldName) {
      els.recipeCategoryName.value = oldName || "";
      return;
    }
    if (state.recipes[nextName]) {
      alert("Bu kategori adı zaten var.");
      els.recipeCategoryName.value = oldName;
      return;
    }
    state.recipes[nextName] = state.recipes[oldName];
    delete state.recipes[oldName];
    state.recipeCatalog.forEach((item) => {
      if (item.category === oldName) item.category = nextName;
    });
    state.selectedRecipeCategory = nextName;
    saveRecipes({ render: true });
  }

  function renameSelectedRecipeProduct() {
    const category = state.recipes[state.selectedRecipeCategory];
    const oldName = state.selectedRecipeProduct;
    const nextName = els.recipeProductName.value.trim() || oldName;
    if (!category || !oldName || nextName === oldName) {
      els.recipeProductName.value = oldName || "";
      return;
    }
    if (category[nextName]) {
      alert("Bu ürün adı zaten var.");
      els.recipeProductName.value = oldName;
      return;
    }
    category[nextName] = category[oldName];
    delete category[oldName];
    const catalogItem = state.recipeCatalog.find((item) => item.category === state.selectedRecipeCategory && item.product === oldName);
    if (catalogItem) catalogItem.product = nextName;
    state.selectedRecipeProduct = nextName;
    saveRecipes({ render: true });
  }

  function recipeCategoryNames() {
    return Object.keys(state.recipes || {});
  }

  function recipeProductNames(categoryName) {
    return Object.keys((state.recipes && state.recipes[categoryName]) || {});
  }

  function selectedRecipeSizes() {
    return state.recipes
      && state.recipes[state.selectedRecipeCategory]
      && state.recipes[state.selectedRecipeCategory][state.selectedRecipeProduct]
      || {};
  }

  function countRecipes() {
    const counts = { categories: 0, products: 0, sizes: 0 };
    recipeCategoryNames().forEach((category) => {
      counts.categories += 1;
      recipeProductNames(category).forEach((product) => {
        counts.products += 1;
        counts.sizes += Object.keys(state.recipes[category][product] || {}).length;
      });
    });
    return counts;
  }

  function uniqueName(base, existingNames) {
    const names = new Set(existingNames);
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  function saveRecipes(options) {
    const render = !options || options.render !== false;
    const json = JSON.stringify(state.recipes);
    safeLocalSet(RECIPE_STORAGE_KEY, json);
    safeLocalSet(LEGACY_RECIPE_STORAGE_KEY, json);
    if (state.recipeChannel) {
      state.recipeChannel.postMessage({ type: "recipes-updated", time: Date.now() });
    }
    markDirty("recipes");
    if (render) queueRenderAll();
  }

  function saveSiteSettings() {
    safeLocalSet(SITE_STORAGE_KEY, JSON.stringify(state.site));
    if (state.siteChannel) state.siteChannel.postMessage({ type: "site-updated", time: Date.now() });
    markDirty("site");
  }

  function renderPriceModeFields() {
    const mode = els.priceMode ? els.priceMode.value : "standard";
    if (els.standardPriceField) els.standardPriceField.hidden = mode !== "standard";
    if (els.sizePriceFields) els.sizePriceFields.hidden = mode !== "sizes";
    if (els.singleDoublePriceFields) els.singleDoublePriceFields.hidden = mode !== "singleDouble";
  }

  function renderImagePreview(target, src, emptyText) {
    if (!target) return;
    target.innerHTML = src
      ? `<img src="${escapeAttribute(src)}" alt=""><span>Önizleme hazır</span>`
      : `<span>${escapeHTML(emptyText)}</span>`;
  }

  function setFontSelectValue(select, value) {
    if (!select) return;
    if (!Array.from(select.options).some((option) => option.value === value)) {
      select.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(value)}">${escapeHTML(value)}</option>`);
    }
    select.value = value;
  }

  function renderActionStyleForm(prefix, style) {
    const normalized = normalizeStyle(style || DEFAULT_SETTINGS.bottomActions[prefix]);
    const capitalized = prefix === "popular" ? "popular" : "suggest";
    els[`${capitalized}BoxType`].value = normalized.type || "solid";
    els[`${capitalized}BoxColor`].value = toColor(normalized.color, DEFAULT_SETTINGS.bottomActions[prefix].color);
    els[`${capitalized}GradientStart`].value = toColor(normalized.gradientStart, DEFAULT_SETTINGS.bottomActions[prefix].gradientStart);
    els[`${capitalized}GradientEnd`].value = toColor(normalized.gradientEnd, DEFAULT_SETTINGS.bottomActions[prefix].gradientEnd);
    els[`${capitalized}GradientAngle`].value = normalized.gradientAngle;
    els[`${capitalized}ImageUrl`].value = normalized.imageUrl || "";
    els[`${capitalized}Overlay`].value = normalized.overlay;
  }

  function renderMenuUiSummary(settings) {
    if (!settings) return;
    const swatches = [
      [els.menuSummaryTheme, settings.bgColor],
      [els.menuSummaryDark, settings.darkBgColor],
      [els.menuSummaryAccent, settings.accentColor],
      [els.menuSummaryText, settings.textColor],
      [els.menuSummaryCard, settings.productCardColor]
    ];
    swatches.forEach(([element, value]) => {
      if (element) element.style.backgroundColor = toColor(value, "#F4EBDC");
    });
    if (els.menuSummaryThemeText) {
      const labels = { solid: "Düz renk", gradient: "Gradient", image: "Görsel" };
      els.menuSummaryThemeText.textContent = labels[settings.menuBackground.type] || "Aydınlık";
    }
    if (els.menuSummaryAccentText) {
      els.menuSummaryAccentText.textContent = toColor(settings.accentColor, DEFAULT_SETTINGS.accentColor).toUpperCase();
    }
    if (els.menuOverlayValue) els.menuOverlayValue.textContent = `${Math.round(Number(settings.menuBackground.overlay || 0) * 100)}%`;
    const popular = normalizeStyle(settings.bottomActions.popular);
    const suggest = normalizeStyle(settings.bottomActions.suggest);
    if (els.popularOverlayValue) els.popularOverlayValue.textContent = `${Math.round(Number(popular.overlay || 0) * 100)}%`;
    if (els.suggestOverlayValue) els.suggestOverlayValue.textContent = `${Math.round(Number(suggest.overlay || 0) * 100)}%`;
  }

  function readActionStyleForm(prefix, previous) {
    const key = prefix === "popular" ? "popular" : "suggest";
    return normalizeStyle({
      type: els[`${key}BoxType`].value,
      color: els[`${key}BoxColor`].value,
      image: previous && previous.image || "",
      imageUrl: els[`${key}ImageUrl`].value.trim(),
      gradientStart: els[`${key}GradientStart`].value,
      gradientEnd: els[`${key}GradientEnd`].value,
      gradientAngle: Number(els[`${key}GradientAngle`].value || 145),
      overlay: Number(els[`${key}Overlay`].value || 0)
    });
  }

  function renderBannerSettingsForm(bannerSettings) {
    const banner = normalizeBanner(bannerSettings);
    if (els.bannerMode) els.bannerMode.value = banner.mode;
    if (els.bannerTitle) els.bannerTitle.value = banner.title;
    if (els.bannerSubtitle) els.bannerSubtitle.value = banner.subtitle;
    if (els.bannerVideoUrl) els.bannerVideoUrl.value = banner.videoUrl;
    if (els.bannerImages) els.bannerImages.value = banner.images.map((item) => item.src).join("\n");
    renderBannerMediaList("videos", banner.videos);
    renderBannerMediaList("images", banner.images);
    renderBannerCategorySelect();
    renderBannerProductList(banner.productIds);
  }

  function renderBannerMediaList(kind, items) {
    const target = kind === "videos" ? els.bannerVideoList : els.bannerImageList;
    if (!target) return;
    const title = kind === "videos" ? "video" : "görsel";
    target.innerHTML = items.length
      ? items.map((item, index) => `
        <article class="banner-media-row" data-banner-media-kind="${escapeAttribute(kind)}" data-banner-media-index="${index}">
          <label>
            <span>Sıra</span>
            <input type="number" min="1" max="${items.length}" value="${index + 1}" data-banner-media-order>
          </label>
          <div class="banner-media-name">
            <strong>${escapeHTML(item.name || `${title} ${index + 1}`)}</strong>
            <small>${escapeHTML(formatFileSize(item.size))}</small>
          </div>
          <button class="danger-action" type="button" data-banner-media-delete>Sil</button>
        </article>
      `).join("")
      : `<div class="empty-mini">Henüz yüklenen ${title} yok.</div>`;
  }

  function renderBannerCategorySelect() {
    if (!els.bannerProductCategory) return;
    const categories = state.data.categories.filter((category) => category.active !== false);
    const current = els.bannerProductCategory.value;
    els.bannerProductCategory.innerHTML = categories.length
      ? categories.map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>`).join("")
      : `<option value="">Kategori yok</option>`;
    if (categories.some((category) => category.id === current)) {
      els.bannerProductCategory.value = current;
    } else if (state.selectedCategoryId && categories.some((category) => category.id === state.selectedCategoryId)) {
      els.bannerProductCategory.value = state.selectedCategoryId;
    } else if (categories[0]) {
      els.bannerProductCategory.value = categories[0].id;
    }
  }

  function renderBannerProductList(selectedIds) {
    if (!els.bannerProductList) return;
    const selected = new Set(selectedIds || []);
    const categoryId = els.bannerProductCategory && els.bannerProductCategory.value || "";
    const query = normalizeText(els.bannerProductSearch && els.bannerProductSearch.value || "");
    const category = state.data.categories.find((item) => item.id === categoryId) || state.data.categories.find((item) => item.active !== false);
    const products = category
      ? category.products
        .filter((product) => product.active !== false)
        .filter((product) => !query || normalizeText(`${product.name} ${product.desc}`).includes(query))
      : [];
    els.bannerProductList.innerHTML = products.length
      ? products.map((product) => `
        <label class="banner-product-option">
          <input type="checkbox" value="${escapeAttribute(product.id)}" ${selected.has(product.id) ? "checked" : ""}>
          <span>${escapeHTML(product.name)}</span>
          <small>${escapeHTML(category ? category.name : "")}</small>
        </label>
      `).join("")
      : `<div class="empty-mini">Bu kategoride ürün bulunamadı.</div>`;
  }

  function readBannerForm(previous) {
    const previousIds = new Set(previous && previous.productIds || []);
    const visibleInputs = els.bannerProductList ? Array.from(els.bannerProductList.querySelectorAll("input[type='checkbox']")) : [];
    const visibleIds = new Set(visibleInputs.map((input) => input.value));
    visibleIds.forEach((id) => previousIds.delete(id));
    visibleInputs.filter((input) => input.checked).forEach((input) => previousIds.add(input.value));
    return normalizeBanner({
      mode: els.bannerMode ? els.bannerMode.value : previous && previous.mode,
      title: els.bannerTitle ? els.bannerTitle.value.trim() : previous && previous.title,
      subtitle: els.bannerSubtitle ? els.bannerSubtitle.value.trim() : previous && previous.subtitle,
      video: previous && previous.video || "",
      videoUrl: els.bannerVideoUrl ? els.bannerVideoUrl.value.trim() : "",
      videos: previous && previous.videos || [],
      images: els.bannerImages && els.bannerImages.value.trim() ? els.bannerImages.value : previous && previous.images,
      productIds: Array.from(previousIds)
    });
  }

  async function handleBannerVideoUpload(event) {
    await appendBannerFiles(event.target, "videos", "video");
  }

  async function handleBannerImageUpload(event) {
    await appendBannerFiles(event.target, "images", "image");
  }

  async function appendBannerFiles(input, listName, kind) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const banner = normalizeBanner(state.data.settings.banner);
    try {
      const mediaItems = [];
      for (const file of files) {
        mediaItems.push(await storeMediaFile(file, kind));
      }
      banner[listName].push(...mediaItems);
      banner.video = "";
      banner.videoUrl = "";
      banner.mode = kind === "video" ? "video" : "images";
      state.data.settings.banner = banner;
      saveAndRender();
    } catch (error) {
      console.error("Banner medyası yüklenemedi:", error);
      alert(`Medya backend'e yüklenemedi. ${error.message || "Dosya türünü, boyutunu ve oturumu kontrol edin."}`);
    } finally {
      input.value = "";
    }
  }

  function handleBannerMediaClick(event) {
    const button = event.target.closest("[data-banner-media-delete]");
    if (!button) return;
    const row = button.closest("[data-banner-media-kind]");
    if (!row) return;
    const kind = row.dataset.bannerMediaKind;
    const index = Number(row.dataset.bannerMediaIndex || -1);
    const banner = normalizeBanner(state.data.settings.banner);
    const list = kind === "videos" ? banner.videos : banner.images;
    const removed = list.splice(index, 1)[0];
    deleteStoredMediaItem(removed);
    if (kind === "videos") {
      banner.video = "";
      banner.videoUrl = "";
      if (!banner.videos.length && banner.mode === "video") banner.mode = "random";
    }
    if (kind === "images" && !banner.images.length && banner.mode === "images") banner.mode = "random";
    state.data.settings.banner = banner;
    saveAndRender();
  }

  function handleBannerMediaOrderChange(event) {
    const input = event.target.closest("[data-banner-media-order]");
    if (!input) return;
    const row = input.closest("[data-banner-media-kind]");
    if (!row) return;
    const kind = row.dataset.bannerMediaKind;
    const from = Number(row.dataset.bannerMediaIndex || -1);
    const banner = normalizeBanner(state.data.settings.banner);
    const list = kind === "videos" ? banner.videos : banner.images;
    if (from < 0 || from >= list.length) return;
    const to = clamp(Number(input.value || 1), 1, list.length) - 1;
    if (from === to) {
      renderBannerSettingsForm(banner);
      return;
    }
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    state.data.settings.banner = banner;
    saveAndRender();
  }

  function readTypographyForm() {
    return normalizeTypography({
      menuTitle: els.menuTitleSize.value,
      categoryTitle: els.categoryTitleSize.value,
      productTitle: els.productTitleSize.value,
      productDesc: els.productDescSize.value,
      productIngredients: els.productIngredientsSize.value,
      productPrice: els.productPriceSize.value
    });
  }

  function renderPreview() {
    if (!window.TahmisciLivePreview) return;
    if (typeof window.TahmisciLivePreview.updateSection === "function") {
      window.TahmisciLivePreview.updateSection(state.activeSection);
    }
    if (typeof window.TahmisciLivePreview.notifyDraft === "function") {
      window.TahmisciLivePreview.notifyDraft();
    }
  }

  function renderJson() {
    if (els.jsonOutput) {
      els.jsonOutput.value = JSON.stringify(state.data, null, 2);
    }
  }

  function updateSettingsFromForm() {
    const settings = state.data.settings;
    settings.bgColor = els.bgColor.value;
    settings.darkBgColor = els.darkBgColor.value;
    settings.accentColor = els.accentColor.value;
    settings.textColor = els.textColor.value;
    settings.buttonTextColor = els.buttonTextColor.value;
    settings.productCardColor = els.productCardColor.value;
    if (els.socialIconColor) settings.socialIconColor = els.socialIconColor.value;
    if (els.socialIconSize) settings.socialIconSize = clamp(Number(els.socialIconSize.value || DEFAULT_SETTINGS.socialIconSize), 18, 64);
    settings.menuBackground.type = els.menuBgType.value;
    settings.menuBackground.gradientStart = els.menuGradientStart.value;
    settings.menuBackground.gradientEnd = els.menuGradientEnd.value;
    settings.menuBackground.gradientAngle = Number(els.menuGradientAngle.value || 160);
    settings.menuBackground.imageUrl = els.menuBgUrl.value.trim();
    settings.menuBackground.overlay = Number(els.menuOverlay.value || 0);
    settings.menuBackgroundImage = settings.menuBackground.imageUrl || settings.menuBackground.image || "";
    settings.menuUpdateDate = els.menuUpdateDate.value || "";
    settings.fonts = {
      title: els.titleFont.value || DEFAULT_SETTINGS.fonts.title,
      category: els.categoryFont.value || DEFAULT_SETTINGS.fonts.category,
      product: els.productFont.value || DEFAULT_SETTINGS.fonts.product
    };
    settings.typography = readTypographyForm();
    settings.bottomActions.popular = readActionStyleForm("popular", settings.bottomActions.popular);
    settings.bottomActions.suggest = readActionStyleForm("suggest", settings.bottomActions.suggest);
    settings.banner = readBannerForm(settings.banner);
    saveAndRender();
  }

  function updateSiteSettingsFromForm() {
    state.site = normalizeSiteSettings({
      heroKicker: els.siteHeroKicker.value.trim(),
      heroTitle: els.siteHeroTitle.value.trim(),
      heroSubtitle: els.siteHeroSubtitle.value.trim(),
      heroImageUrl: els.siteHeroImageUrl.value.trim(),
      storyTitle: els.siteStoryTitle.value.trim(),
      storyText: els.siteStoryText.value.trim(),
      storyPointOneTitle: els.siteStoryPointOneTitle.value.trim(),
      storyPointOneText: els.siteStoryPointOneText.value.trim(),
      storyPointTwoTitle: els.siteStoryPointTwoTitle.value.trim(),
      storyPointTwoText: els.siteStoryPointTwoText.value.trim(),
      storyPointThreeTitle: els.siteStoryPointThreeTitle.value.trim(),
      storyPointThreeText: els.siteStoryPointThreeText.value.trim(),
      menuTitle: els.siteMenuTitle.value.trim(),
      menuIntro: els.siteMenuIntro.value.trim(),
      visitTitle: els.siteVisitTitle.value.trim(),
      visitText: els.siteVisitText.value.trim(),
      contactTitle: els.siteContactTitle.value.trim(),
      address: els.siteAddress.value.trim(),
      hours: els.siteHours.value.trim(),
      phone: els.sitePhone.value.trim(),
      email: els.siteEmail.value.trim(),
      whatsapp: els.siteWhatsapp.value.trim(),
      mapsUrl: els.siteMapsUrl.value.trim(),
      instagram: els.siteInstagram.value.trim(),
      tiktok: els.siteTiktok.value.trim(),
      socialLinks: normalizeSocialLinks(state.site && state.site.socialLinks || []),
      backgroundColor: els.siteBackgroundColor.value,
      surfaceColor: els.siteSurfaceColor.value,
      accentColor: els.siteAccentColor.value,
      accentColorTwo: els.siteAccentColorTwo.value,
      textColor: els.siteTextColor.value,
      mutedColor: els.siteMutedColor.value,
      titleFont: els.siteTitleFont.value || DEFAULT_SITE_SETTINGS.titleFont,
      bodyFont: els.siteBodyFont.value || DEFAULT_SITE_SETTINGS.bodyFont,
      titleSize: Number(els.siteTitleSize.value || DEFAULT_SITE_SETTINGS.titleSize),
      bodySize: Number(els.siteBodySize.value || DEFAULT_SITE_SETTINGS.bodySize)
    });
    saveSiteSettings();
  }

  function updateCategoryFromForm() {
    const category = selectedCategory();
    if (!category) return;
    category.name = els.categoryName.value.trim() || "Kategori";
    category.active = els.categoryActive.checked;
    category.iconKey = normalizeCategoryIconKey(els.categoryIconKey && els.categoryIconKey.value, category.name);
    category.icon = CATEGORY_ICON_REGISTRY.getIconClass(category.iconKey);
    category.style.type = els.categoryStyleType.value;
    category.style.color = els.categoryColor.value;
    category.color = category.style.color;
    category.style.gradientStart = els.categoryGradientStart.value;
    category.style.gradientEnd = els.categoryGradientEnd.value;
    category.style.gradientAngle = Number(els.categoryGradientAngle.value || 145);
    category.style.imageUrl = els.categoryImageUrl.value.trim();
    category.style.overlay = Number(els.categoryOverlay.value || 0);
    category.image = category.style.imageUrl || category.style.image || "";
    saveAndRender();
  }

  function updateProductFromForm() {
    const product = selectedProduct();
    if (!product) return;

    const currentCategory = selectedCategory();
    if (currentCategory && els.productCategory.value && els.productCategory.value !== currentCategory.id) {
      moveProductToCategory(product.id, currentCategory.id, els.productCategory.value);
      return;
    }

    product.name = els.productName.value.trim() || "Ürün";
    product.desc = els.productDesc.value.trim();
    product.active = els.productActive.checked;
    product.stock = els.productStock.value;
    product.kind = els.productKind.value;
    product.temperature = els.productTemperature.value;
    product.popular = els.productPopular.checked;
    const flexiblePricingHandled = Boolean(window.TahmisciPricing
      && typeof window.TahmisciPricing.writeProductFromForm === "function"
      && window.TahmisciPricing.writeProductFromForm(product));
    if (!flexiblePricingHandled) {
      product.priceMode = ["sizes", "singleDouble"].includes(els.priceMode.value) ? els.priceMode.value : "standard";
      product.prices = normalizePricesForMode(normalizePrices({
        standard: els.standardPrice.value,
        k: els.priceK.value,
        o: els.priceO.value,
        b: els.priceB.value,
        single: els.priceSingle.value,
        double: els.priceDouble.value
      }), product.priceMode);
      product.variants = normalizeVariants(null, product.prices, product.priceMode);
    }
    product.style.type = els.productStyleType.value;
    product.style.color = els.productColor.value;
    product.cardColor = product.style.color;
    product.style.gradientStart = els.productGradientStart.value;
    product.style.gradientEnd = els.productGradientEnd.value;
    product.style.gradientAngle = Number(els.productGradientAngle.value || 145);
    product.imageUrl = els.productImageUrl.value.trim();
    product.imageOverlay = Number(els.productImageOverlay.value || 0);
    product.details.calories = els.productCalories.value.trim();
    product.details.allergens = els.productAllergens.value.trim();
    product.manualContent = els.productIngredients.value.trim();
    product.details.ingredients = product.manualContent;
    product.contentMode = ["recipe", "manual", "hidden", "not-required"].includes(els.productContentMode.value) ? els.productContentMode.value : "manual";
    product.recipeId = els.productRecipeId.value || "";
    product.recipeSize = els.productRecipeSize.value || "";
    product.recipeLinkStatus = product.recipeId ? "linked" : "unmatched";
    saveAndRender();
  }

  function addRecipeCatalogEntry(category, product) {
    const existing = state.recipeCatalog.find((item) => item.category === category && item.product === product);
    if (existing) return existing;
    const now = new Date().toISOString();
    const item = {
      id: window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      category,
      product,
      createdAt: now,
      updatedAt: now
    };
    state.recipeCatalog.push(item);
    return item;
  }

  function linkedMenuProductsForRecipeIds(ids) {
    const wanted = new Set(ids || []);
    return flatProducts().filter(({ product }) => wanted.has(product.recipeId));
  }

  function applyBulkProductImageUrl() {
    const url = els.bulkProductImageUrl.value.trim();
    if (!url) return;
    applyBulkProductImage(url, false);
  }

  function applyBulkProductImage(src, isEmbedded) {
    const category = selectedCategory();
    if (!category) return;
    category.products.forEach((product) => {
      if (isEmbedded) {
        product.image = src;
        product.imageUrl = "";
      } else {
        product.imageUrl = src;
        product.image = "";
      }
    });
    saveAndRender();
  }

  function clearBulkProductImages() {
    const category = selectedCategory();
    if (!category) return;
    category.products.forEach((product) => {
      product.image = "";
      product.imageUrl = "";
    });
    els.bulkProductImageUrl.value = "";
    saveAndRender();
  }

  function applyBulkProductStyle() {
    const category = selectedCategory();
    if (!category) return;
    const stylePatch = {
      type: els.bulkProductStyleType.value,
      color: els.bulkProductColor.value,
      gradientStart: els.bulkProductGradientStart.value,
      gradientEnd: els.bulkProductGradientEnd.value,
      gradientAngle: Number(els.bulkProductGradientAngle.value || 145)
    };
    category.products.forEach((product) => {
      product.style = normalizeStyle(Object.assign({}, product.style, stylePatch));
      product.cardColor = product.style.color;
    });
    saveAndRender();
  }

  function addCategory() {
    const category = makeCategory(`Yeni Kategori ${state.data.categories.length + 1}`);
    state.data.categories.push(category);
    state.selectedCategoryId = category.id;
    state.selectedProductId = "";
    saveAndRender();
  }

  function addProduct() {
    const category = selectedCategory();
    if (!category) return;
    const product = makeProduct(`Yeni Ürün ${category.products.length + 1}`, category.id);
    category.products.push(product);
    state.selectedProductId = product.id;
    state.allowEmptyProductSelection = false;
    saveAndRender();
  }

  function deleteSelectedCategory() {
    const category = selectedCategory();
    if (!category) return;
    if (!confirm(`${category.name} kategorisi ve içindeki ürünler silinsin mi?`)) return;
    state.data.categories = state.data.categories.filter((item) => item.id !== category.id);
    ensureSelection();
    saveAndRender();
  }

  function deleteSelectedProduct() {
    const category = selectedCategory();
    const product = selectedProduct();
    if (!category || !product) return;
    if (!confirm(`${product.name} ürünü silinsin mi?`)) return;
    category.products = category.products.filter((item) => item.id !== product.id);
    state.selectedProductId = category.products[0] ? category.products[0].id : "";
    state.allowEmptyProductSelection = !state.selectedProductId;
    saveAndRender();
  }

  function moveProductToCategory(productId, fromCategoryId, toCategoryId) {
    const from = state.data.categories.find((category) => category.id === fromCategoryId);
    const to = state.data.categories.find((category) => category.id === toCategoryId);
    if (!from || !to) return;
    const index = from.products.findIndex((product) => product.id === productId);
    if (index < 0) return;
    const [product] = from.products.splice(index, 1);
    to.products.push(product);
    state.selectedCategoryId = to.id;
    state.selectedProductId = product.id;
    state.allowEmptyProductSelection = false;
    saveAndRender();
  }

  function saveAdminMenuDefault(event) {
    captureCurrentEditorState();
    openDefaultConfirmationModal("save-menu", event && event.currentTarget);
  }

  function saveAdminSystemDefault(event) {
    writeSiteInfoFromSettings({ dirty: false });
    openDefaultConfirmationModal("save-system", event && event.currentTarget);
  }

  function openDefaultChoiceModal(scope, trigger) {
    state.defaultModalScope = scope === "system" ? "system" : "menu";
    state.defaultModalMode = "restore";
    state.defaultModalTrigger = trigger || document.activeElement;
    configureDefaultChoiceModal();
    showDefaultChoiceModal();
  }

  function openDefaultConfirmationModal(mode, trigger) {
    state.defaultModalScope = mode === "save-system" ? "system" : mode === "device" ? "device" : "menu";
    state.defaultModalMode = mode;
    state.defaultModalTrigger = trigger || document.activeElement;
    configureDefaultChoiceModal();
    showDefaultChoiceModal();
  }

  function configureDefaultChoiceModal() {
    const mode = state.defaultModalMode;
    const scope = state.defaultModalScope;
    const isRestore = mode === "restore";
    const record = scope === "system" ? state.adminDefaults.systemSettings : state.adminDefaults.menuDesign;
    if (els.adminDefaultChoice) {
      els.adminDefaultChoice.hidden = !isRestore;
      els.adminDefaultChoice.disabled = isRestore && !record;
      els.adminDefaultChoice.setAttribute("aria-disabled", String(isRestore && !record));
    }
    if (isRestore && scope === "menu") {
      setDefaultModalCopy({
        kicker: "Sistem Genelinde Tasarım",
        title: "Menü tasarımı varsayılanına dön",
        description: "Seçilen varsayılan önce taslağa uygulanır. QR menü yalnızca Kaydet ve Yayınla sonrasında değişir.",
        factoryLabel: "İlk Tasarım Varsayılanı",
        factoryDescription: "Uygulamanın bej-kahverengi açık tema ve koyu kahverengi karanlık tema tasarımına döner.",
        adminDescription: "Yönetici tarafından sistem varsayılanı olarak kaydedilen son tasarımı yükler."
      });
    } else if (isRestore && scope === "system") {
      setDefaultModalCopy({
        kicker: "Sistem Genelindeki Bilgiler",
        title: "Sistem ayarları varsayılanına dön",
        description: "Seçilen bilgiler taslağa uygulanır ve normal Kaydet ve Yayınla akışından önce public alana çıkmaz.",
        factoryLabel: "İlk Sistem Varsayılanı",
        factoryDescription: "Kodla gelen güvenli işletme ve site bilgilerini taslağa yükler.",
        adminDescription: "Yöneticinin sistem varsayılanı olarak kaydettiği son güvenli site bilgilerini yükler."
      });
    } else if (mode === "device") {
      setDefaultModalCopy({
        kicker: "Yalnızca Bu Cihaz",
        title: "Bu cihazın ayarları sıfırlansın mı?",
        description: "Son açık sekme, sidebar ve çıkış onayı gibi yalnızca bu tarayıcıdaki panel davranışları sıfırlanır.",
        factoryLabel: "Bu Cihazın Ayarlarını Sıfırla",
        factoryDescription: "Sistem, menü, site, stok, reçete veya personel verilerine dokunmaz."
      });
    } else {
      const system = mode === "save-system";
      setDefaultModalCopy({
        kicker: system ? "Sistem Genelindeki Bilgiler" : "Sistem Genelinde Tasarım",
        title: "Yönetici varsayılanı olarak kaydedilsin mi?",
        description: system
          ? "Mevcut güvenli site bilgileri backend'de bütün yetkili cihazlar için kalıcı varsayılan olur."
          : "Mevcut taslağın yalnızca görsel tasarım alanları backend'de kalıcı varsayılan olur; ürün ve kategori içeriği kaydedilmez.",
        factoryLabel: "Yönetici Varsayılanını Kaydet",
        factoryDescription: "Revision kontrolü ve canonical readback doğrulamasıyla kaydedilir."
      });
    }
    if (els.adminDefaultChoiceMeta) {
      els.adminDefaultChoiceMeta.textContent = record && record.savedAt
        ? `Son kayıt: ${formatAdminDefaultDate(record.savedAt)}`
        : "Henüz Yönetici varsayılanı kaydedilmedi.";
    }
  }

  function setDefaultModalCopy(copy) {
    if (els.defaultChoiceKicker) els.defaultChoiceKicker.textContent = copy.kicker || "Varsayılan";
    if (els.defaultChoiceTitle) els.defaultChoiceTitle.textContent = copy.title || "Varsayılana dön";
    if (els.defaultChoiceDescription) {
      els.defaultChoiceDescription.textContent = copy.description || "";
      els.defaultChoiceDescription.classList.remove("is-error");
      els.defaultChoiceDescription.removeAttribute("role");
    }
    if (els.factoryDefaultLabel) els.factoryDefaultLabel.textContent = copy.factoryLabel || "Uygula";
    if (els.factoryDefaultDescription) els.factoryDefaultDescription.textContent = copy.factoryDescription || "";
    if (els.adminDefaultDescription && copy.adminDescription) els.adminDefaultDescription.textContent = copy.adminDescription;
  }

  function showDefaultChoiceModal() {
    if (!els.defaultChoiceModal) return;
    els.defaultChoiceModal.hidden = false;
    syncAdminModalLock();
    const first = els.defaultChoiceModal.querySelector("button:not([hidden]):not(:disabled)");
    window.setTimeout(() => first && first.focus(), 30);
  }

  function closeDefaultChoiceModal() {
    if (state.defaultOperationBusy) return;
    if (els.defaultChoiceModal) els.defaultChoiceModal.hidden = true;
    syncAdminModalLock();
    const trigger = state.defaultModalTrigger;
    state.defaultModalTrigger = null;
    if (trigger && typeof trigger.focus === "function") window.setTimeout(() => trigger.focus(), 20);
  }

  async function handleDefaultChoice(event) {
    const button = event.target.closest("[data-default-choice]");
    if (!button) {
      if (event.target === els.defaultChoiceModal && !state.defaultOperationBusy) closeDefaultChoiceModal();
      return;
    }
    const choice = button.dataset.defaultChoice;
    if (choice === "cancel") {
      closeDefaultChoiceModal();
      return;
    }
    if (button.disabled || state.defaultOperationBusy) return;
    if (state.defaultModalMode === "save-menu") return performSaveAdminMenuDefault();
    if (state.defaultModalMode === "save-system") return performSaveAdminSystemDefault();
    if (state.defaultModalMode === "device") {
      resetDevicePanelSettings();
      closeDefaultChoiceModal();
      return;
    }
    const applied = state.defaultModalScope === "menu" ? applyMenuDefault(choice) : applySystemDefault(choice);
    if (applied) closeDefaultChoiceModal();
  }

  async function performSaveAdminMenuDefault() {
    const revision = Number(state.adminDefaults.menuDesign && state.adminDefaults.menuDesign.revision || 0);
    const requestId = createRequestId("menu-default");
    const design = MENU_DESIGN_SCHEMA.createDesignSnapshot(state.data);
    setDefaultModalBusy(true, "Yönetici varsayılanı kaydediliyor...");
    try {
      const result = await backendRequest("/api/admin/defaults/menu-design", {
        method: "PUT",
        headers: { "Idempotency-Key": requestId },
        body: { requestId, revision, design }
      });
      const readback = await backendRequest("/api/admin/defaults/menu-design");
      if (!readback.menuDesign || MENU_DESIGN_SCHEMA.designSnapshotFingerprint(readback.menuDesign) !== MENU_DESIGN_SCHEMA.designSnapshotFingerprint(design)) {
        throw new Error("Yönetici varsayılanı kaydedildi ancak kalıcı okuma doğrulanamadı.");
      }
      state.adminDefaults.menuDesign = cloneData(readback.menuDesign || result.menuDesign);
      syncAdminDefaultUi();
      updateSaveControls(`Yönetici varsayılanı kaydedildi · ${formatAdminDefaultDate(state.adminDefaults.menuDesign.savedAt)}`);
      setDefaultModalBusy(false);
      closeDefaultChoiceModal();
    } catch (error) {
      setDefaultModalBusy(false);
      showDefaultModalError(error.message || "Yönetici varsayılanı kaydedilemedi.");
    }
  }

  async function performSaveAdminSystemDefault() {
    const revision = Number(state.adminDefaults.systemSettings && state.adminDefaults.systemSettings.revision || 0);
    const requestId = createRequestId("system-default");
    const settings = readSiteInfoFromState();
    setDefaultModalBusy(true, "Sistem varsayılanı kaydediliyor...");
    try {
      const result = await backendRequest("/api/admin/defaults/system-settings", {
        method: "PUT",
        headers: { "Idempotency-Key": requestId },
        body: { requestId, revision, settings }
      });
      const readback = await backendRequest("/api/admin/defaults/system-settings");
      if (!readback.systemSettings || JSON.stringify(readback.systemSettings.settings) !== JSON.stringify(settings)) {
        throw new Error("Sistem varsayılanı canonical readback ile eşleşmedi.");
      }
      state.adminDefaults.systemSettings = cloneData(readback.systemSettings || result.systemSettings);
      syncAdminDefaultUi();
      updateSaveControls(`Sistem varsayılanı kaydedildi · ${formatAdminDefaultDate(state.adminDefaults.systemSettings.savedAt)}`);
      setDefaultModalBusy(false);
      closeDefaultChoiceModal();
    } catch (error) {
      setDefaultModalBusy(false);
      showDefaultModalError(error.message || "Sistem varsayılanı kaydedilemedi.");
    }
  }

  function applyMenuDefault(choice) {
    const snapshot = choice === "admin"
      ? state.adminDefaults.menuDesign
      : MENU_DESIGN_SCHEMA.createFactoryDesignSnapshot(state.data);
    if (!snapshot) {
      showDefaultModalError("Henüz Yönetici varsayılanı kaydedilmedi.");
      return false;
    }
    state.data = normalizeState(MENU_DESIGN_SCHEMA.applyDesignSnapshot(state.data, snapshot));
    ensureSelection();
    saveAndRender();
    updateSaveControls(choice === "admin" ? "Yönetici varsayılanı taslağa uygulandı" : "İlk tasarım varsayılanı taslağa uygulandı");
    return true;
  }

  function applySystemDefault(choice) {
    const info = choice === "admin"
      ? state.adminDefaults.systemSettings && state.adminDefaults.systemSettings.settings
      : factorySystemSettings();
    if (!info) {
      showDefaultModalError("Henüz Yönetici varsayılanı kaydedilmedi.");
      return false;
    }
    applySiteInfoToState(cloneData(info), { dirty: true });
    renderPanelSettings();
    updateSaveControls(choice === "admin" ? "Admin sistem varsayılanı taslağa uygulandı" : "İlk sistem varsayılanı taslağa uygulandı");
    return true;
  }

  function factorySystemSettings() {
    const current = state.site;
    state.site = normalizeSiteSettings(DEFAULT_SITE_SETTINGS);
    const info = readSiteInfoFromState();
    state.site = current;
    return info;
  }

  function resetDevicePanelSettings() {
    state.panelConfig = normalizePanelConfig(DEFAULT_PANEL_CONFIG);
    safeLocalRemove(PANEL_SETTINGS_KEY);
    safeLocalRemove(PANEL_SETTINGS_DEFAULT_KEY);
    safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
    safeLocalRemove(SIDEBAR_STATE_KEY);
    renderPanelSettings();
    applyPanelRuntimeSettings();
    setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
    updateSaveControls("Bu cihazın panel ayarları sıfırlandı");
    window.setTimeout(() => updateSaveControls(), 1400);
  }

  function setDefaultModalBusy(busy, message) {
    state.defaultOperationBusy = busy;
    if (!els.defaultChoiceModal) return;
    els.defaultChoiceModal.querySelectorAll("button").forEach((button) => { button.disabled = busy || (button === els.adminDefaultChoice && !defaultRecordForScope()); });
    if (els.defaultChoiceClose) els.defaultChoiceClose.disabled = busy;
    if (message && els.defaultChoiceDescription) els.defaultChoiceDescription.textContent = message;
  }

  function showDefaultModalError(message) {
    if (!els.defaultChoiceDescription) return;
    els.defaultChoiceDescription.textContent = message;
    els.defaultChoiceDescription.classList.add("is-error");
    els.defaultChoiceDescription.setAttribute("role", "alert");
  }

  function defaultRecordForScope() {
    return state.defaultModalScope === "system" ? state.adminDefaults.systemSettings : state.adminDefaults.menuDesign;
  }

  function trapDefaultChoiceFocus(event) {
    const focusable = Array.from(els.defaultChoiceModal.querySelectorAll("button:not([hidden]):not(:disabled)"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function syncAdminDefaultUi() {
    const menu = state.adminDefaults.menuDesign;
    const system = state.adminDefaults.systemSettings;
    if (els.menuDefaultMeta) els.menuDefaultMeta.textContent = menu && menu.savedAt
      ? `Son kayıt: ${formatAdminDefaultDate(menu.savedAt)} · revizyon ${menu.revision}`
      : "Henüz Yönetici varsayılanı kaydedilmedi.";
    if (els.systemDefaultMeta) els.systemDefaultMeta.textContent = system && system.savedAt
      ? `Son kayıt: ${formatAdminDefaultDate(system.savedAt)} · revizyon ${system.revision}. Değişiklikler yayınlanmadan public alana çıkmaz.`
      : "Henüz Yönetici varsayılanı kaydedilmedi. Değişiklikler yayınlanmadan herkese açık alana çıkmaz.";
  }

  function formatAdminDefaultDate(value) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(date)
      : "bilinmiyor";
  }

  function saveAndRender() {
    safeLocalSet(STORAGE_KEY, JSON.stringify(state.data));
    if (state.channel) state.channel.postMessage({ type: "menu-updated", time: Date.now() });
    markDirty("menu");
    queueRenderAll();
  }

  function copyJson() {
    const text = JSON.stringify(state.data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        els.saveState.textContent = "JSON kopyalandı";
      });
    } else {
      els.jsonOutput.select();
      document.execCommand("copy");
      els.saveState.textContent = "JSON kopyalandı";
    }
  }

  function makeCategory(name) {
    return {
      id: makeId("cat", `${name}-${Date.now()}`),
      name,
      active: true,
      color: "",
      iconKey: normalizeCategoryIconKey("", name),
      icon: CATEGORY_ICON_REGISTRY.getIconClass(normalizeCategoryIconKey("", name)),
      image: "",
      style: normalizeStyle({
        color: DEFAULT_SETTINGS.categoryCardColor,
        gradientStart: DEFAULT_SETTINGS.categoryCardColor,
        gradientEnd: "#E5E7EB",
        gradientAngle: 135,
        overlay: 0.12
      }),
      products: []
    };
  }

  function makeProduct(name, categoryId) {
    return normalizeProduct({
      id: makeId(categoryId, `${name}-${Date.now()}`),
      name,
      prices: { standard: "", k: "", o: "", b: "", single: "", double: "" },
      active: true,
      stock: "active",
      kind: "drink",
      temperature: "none"
    }, categoryId, 0);
  }

  function selectedCategory() {
    return state.data.categories.find((category) => category.id === state.selectedCategoryId) || state.data.categories[0] || null;
  }

  function selectedProduct() {
    const category = selectedCategory();
    if (!category) return null;
    return category.products.find((product) => product.id === state.selectedProductId) || category.products[0] || null;
  }

  function selectedProductStrict() {
    const category = selectedCategory();
    if (!category || !state.selectedProductId) return null;
    return category.products.find((product) => product.id === state.selectedProductId) || null;
  }

  function flatProducts() {
    return state.data.categories.flatMap((category) => category.products.map((product) => ({ category, product })));
  }

  function isVisibleProduct(product) {
    return product.active !== false && product.stock !== "sold-out";
  }

  function readImage(input, callback) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      callback(reader.result);
      input.value = "";
    };
    reader.readAsDataURL(file);
  }

  function mediaRef(id) {
    return `${MEDIA_REF_PREFIX}${id}`;
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

  function formatFileSize(size) {
    const bytes = Number(size || 0);
    if (!bytes) return "Boyut bilgisi yok";
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }

  function openMediaDb() {
    if (!window.indexedDB) return Promise.reject(new Error("Tarayıcı medya depolamayı desteklemiyor."));
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

  async function storeMediaFile(file, kind) {
    if (backendBaseUrl() && window.fetch) {
      return uploadMediaFile(file, kind);
    }

    const db = await openMediaDb();
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      kind,
      name: file.name || (kind === "video" ? "Video" : "Görsel"),
      type: file.type || "",
      size: file.size || 0,
      blob: file,
      createdAt: new Date().toISOString()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(MEDIA_STORE_NAME).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Medya kaydedilemedi."));
    });
    return {
      id,
      src: mediaRef(id),
      name: record.name,
      type: record.type,
      size: record.size,
      kind
    };
  }

  async function uploadMediaFile(file, kind) {
    const result = await backendRequest("/api/media", {
      method: "POST",
      rawBody: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || ""),
        "X-Media-Kind": kind
      }
    });
    const media = result && result.media;
    const src = media && (media.src || media.url);
    if (!src) throw new Error("Backend medya adresi döndürmedi.");
    return {
      id: String(media.id || ""),
      src,
      name: media.name || file.name || (kind === "video" ? "Video" : "Görsel"),
      type: media.type || file.type || "",
      size: media.size || file.size || 0,
      kind
    };
  }

  function deleteStoredMediaItem(item) {
    const id = item && (item.id || mediaIdFromRef(item.src));
    if (!id) return;
    openMediaDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(MEDIA_STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Medya silinemedi."));
    })).catch((error) => console.warn("Medya silinemedi.", error));
  }

  function buildMenuBackground(settings) {
    const bg = settings.menuBackground || DEFAULT_SETTINGS.menuBackground;
    if (bg.type === "image" && (bg.imageUrl || bg.image || settings.menuBackgroundImage)) {
      const image = cssUrl(bg.imageUrl || bg.image || settings.menuBackgroundImage);
      if (!image) return settings.bgColor;
      return `linear-gradient(rgba(0,0,0,${bg.overlay}),rgba(0,0,0,${bg.overlay})), url("${image}") center / cover, ${settings.bgColor}`;
    }
    if (bg.type === "gradient") {
      return `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientStart}, ${bg.gradientEnd})`;
    }
    return settings.bgColor;
  }

  function buildBoxStyle(style, fallbackColor) {
    const image = cssUrl(style.imageUrl || style.image || "");
    const type = style.type || (image ? "image" : "gradient");
    const background = type === "image" && image
      ? `linear-gradient(rgba(0,0,0,${style.overlay}),rgba(0,0,0,${style.overlay})), url("${image}") center / cover, ${style.color || fallbackColor}`
      : type === "gradient"
        ? `linear-gradient(${style.gradientAngle}deg, ${style.gradientStart || style.color || fallbackColor}, ${style.gradientEnd || style.color || fallbackColor})`
        : `${style.color || fallbackColor}`;
    return `background:${background};--preview-overlay:${style.overlay}`;
  }

  function pricesFromLegacyProduct(product) {
    const prices = { standard: "", k: "", o: "", b: "", single: "", double: "" };
    const variants = Array.isArray(product && product.variants) ? product.variants : [];
    if (variants.length) {
      variants.forEach((variant) => {
        const label = normalizeText(variant.name || variant.label || "");
        const price = variant.price ?? "";
        if (price === "" || price === null || price === undefined) return;
        if (label.includes("KUCUK") || label === "K") prices.k = price;
        else if (label.includes("ORTA") || label === "O") prices.o = price;
        else if (label.includes("BUYUK") || label === "B") prices.b = price;
        else if (label.includes("SINGLE")) prices.single = price;
        else if (label.includes("DOUBLE")) prices.double = price;
        else if (label.includes("TEK") || label.includes("FINCAN") || label.includes("PORSIYON") || label.includes("ADET")) prices.standard = price;
        else if (variants.length === 1) prices.standard = price;
        else if (!prices.o) prices.o = price;
      });
    } else if (product && (product.price || product.price === 0)) {
      prices.standard = product.price;
    }
    return normalizePrices(prices);
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

  function priceSummary(product) {
    if (!product || product.priceMode === "standard") {
      return formatPrice(product && product.prices && product.prices.standard);
    }
    if (product.priceMode === "singleDouble") {
      return `Single ${formatPrice(product.prices.single)} | Double ${formatPrice(product.prices.double)}`;
    }
    return `K ${formatPrice(product.prices.k)} | O ${formatPrice(product.prices.o)} | B ${formatPrice(product.prices.b)}`;
  }

  function firstFilledPrice() {
    return Array.from(arguments).find(hasPrice) ?? "";
  }

  function hasPrice(value) {
    return value !== "" && value !== null && value !== undefined;
  }

  function cleanPrice(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    const cleaned = String(value).replace(/[^\d.,]/g, "").replace(",", ".").trim();
    if (!cleaned) return "";
    const numberValue = Number(cleaned);
    return Number.isFinite(numberValue) ? numberValue : "";
  }

  function formatPrice(value) {
    if (value === "" || value === null || value === undefined) return "-";
    const clean = cleanPrice(value);
    if (clean === "") return "-";
    return `${new Intl.NumberFormat("tr-TR").format(clean)}\u20BA`;
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

  function makeId(prefix, value) {
    const slug = normalizeText(`${prefix}-${value}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || Math.random().toString(36).slice(2, 8);
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

  function toColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
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

  function safeLocalGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return memoryStore[key] || "";
    }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      memoryStore[key] = value;
      return true;
    } catch (error) {
      memoryStore[key] = value;
      console.warn("Yerel kayıt yapılamadı.", error);
      return false;
    }
  }

  function safeLocalRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      delete memoryStore[key];
      return;
    }
    delete memoryStore[key];
  }

})();












