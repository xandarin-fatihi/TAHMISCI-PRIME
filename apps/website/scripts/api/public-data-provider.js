(function () {
  "use strict";

  const API_URL = "/api/public/bootstrap";
  const EVENTS_URL = "/api/public/events";
  const DEFAULT_NAVIGATION = [
    { id: "home", label: { tr: "Ana Sayfa", en: "Home" }, url: "#top", icon: "fas fa-house", visible: true, order: 0 },
    { id: "menu", label: { tr: "Menü", en: "Menu" }, url: "#menu", icon: "fas fa-utensils", visible: true, order: 1 },
    { id: "about", label: { tr: "Hakkımızda", en: "About" }, url: "#about", icon: "fas fa-mug-hot", visible: true, order: 2 },
    { id: "contact", label: { tr: "İletişim", en: "Contact" }, url: "#contact", icon: "fas fa-phone", visible: true, order: 3 },
    { id: "mudavim", label: { tr: "Müdavim", en: "Müdavim" }, url: "/mudavim/", icon: "fas fa-id-card", visible: true, order: 4 }
  ];
  const BRAND_DEFAULTS = {
    desktopLogo: "/assets/brand/logo-primary.png",
    mobileLogo: "/assets/brand/logo-primary.png",
    loaderLogo: "/assets/brand/logo-large.png",
    footerLogo: "/assets/brand/logo-light-green.png",
    favicon: "/assets/brand/favicon.png",
    logoAlt: { tr: "Tahmisçi Coffee & Roastery", en: "Tahmisçi Coffee & Roastery" }
  };
  const state = {
    bootstrap: null,
    eventSource: null,
    reconnectTimer: null,
    reconnectDelay: 3000,
    stopped: false
  };

  const provider = {
    ready: null,
    load,
    retry: load,
    getBootstrap: () => state.bootstrap,
    getCategories: () => mapCatalog(state.bootstrap).categories,
    getProducts: () => mapCatalog(state.bootstrap).products,
    apply: applyBootstrap,
    applyHeader,
    connectEvents
  };

  window.TahmisciPublicData = provider;
  window.TAHMISCI_CUSTOMER_ACCOUNTS_ENABLED = false;
  applyFeatureFlags({});
  applyBranding({});
  applyWatermark({});
  applyMotion({});
  applyHeader({ header: { visible: true, contactVisible: true, navigation: DEFAULT_NAVIGATION } }, "fallback");
  provider.ready = load();

  async function load() {
    hideError();
    try {
      const response = await fetch(API_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok || !payload.siteState || !payload.menu) throw new Error("Eksik bootstrap verisi");
      applyBootstrap(payload, "initial");
      connectEvents();
      return payload;
    } catch (error) {
      showError();
      document.dispatchEvent(new CustomEvent("publicBootstrapError", { detail: { error } }));
      return null;
    }
  }

  function applyBootstrap(payload, reason) {
    if (!payload || !payload.siteState || !payload.menu) return;
    state.bootstrap = payload;
    const mapped = mapCatalog(payload);
    window.MenuCategories = mapped.categories;
    window.MenuProducts = mapped.products;
    window.TahmisciCatalog = { categories: mapped.categories, products: mapped.products, source: "public-bootstrap" };
    applyFeatureFlags(payload.siteState);
    applyBranding(payload.siteState);
    applyWatermark(payload.siteState);
    applyMotion(payload.siteState);
    applyHeader(payload.siteState, reason);
    applyHero(payload.siteState, mapped.products);
    applySiteContent(payload.siteState, payload.menu);
    hideError();
    const eventName = reason === "initial" ? "publicBootstrapLoaded" : "publicBootstrapUpdated";
    window.dispatchEvent(new CustomEvent(eventName, { detail: { payload, reason } }));
    document.dispatchEvent(new CustomEvent("menuProductsLoaded", { detail: { products: mapped.products } }));
  }

  function applyFeatureFlags(siteState) {
    const enabled = siteState?.features?.customerAccountsEnabled === true;
    window.TAHMISCI_CUSTOMER_ACCOUNTS_ENABLED = enabled;
    document.documentElement.dataset.customerAccounts = enabled ? "enabled" : "disabled";
    if (enabled) return;
    [
      "#authButtons",
      "#authLinks",
      "#userLinks",
      "#userMenu",
      "#mobileAuth",
      "#mobileUserWelcome",
      "#mobileCartBtn",
      ".mobile-nav-auth",
      ".mobile-nav-account-content",
      "#loginModal",
      "#registerModal",
      "#legalDocModal"
    ].forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.hidden = true;
        element.setAttribute("aria-hidden", "true");
      });
    });
  }

  function applyBranding(siteState) {
    const brand = { ...BRAND_DEFAULTS, ...(siteState?.branding || {}) };
    const language = currentLanguage();
    const alt = localized(brand.logoAlt, language) || "Tahmisçi";
    setLogo(".header-logo .logo-link", safeAssetUrl(brand.desktopLogo, BRAND_DEFAULTS.desktopLogo), alt);
    setLogo(".mobile-nav-logo", safeAssetUrl(brand.mobileLogo, BRAND_DEFAULTS.mobileLogo), alt);
    setLogo(".footer-logo-link, .footer-brand-link", safeAssetUrl(brand.footerLogo, BRAND_DEFAULTS.footerLogo), alt, true);
    const loadingLogo = document.querySelector("#loading-screen .loading-logo");
    if (loadingLogo) {
      loadingLogo.src = safeAssetUrl(brand.loaderLogo, BRAND_DEFAULTS.loaderLogo);
      loadingLogo.alt = alt;
    }
    const faviconUrl = safeAssetUrl(brand.favicon, BRAND_DEFAULTS.favicon);
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((link) => {
      link.href = faviconUrl;
    });
  }

  function applyWatermark(siteState) {
    const watermark = siteState?.watermark || {};
    const enabled = watermark.enabled !== false;
    const logo = safeAssetUrl(watermark.logo, BRAND_DEFAULTS.loaderLogo);
    const opacity = clamp(Number(watermark.opacity ?? 0.12), 0, 0.2);
    const size = clamp(Number(watermark.size ?? 58), 24, 120);
    const x = clamp(Number(watermark.x ?? 50), 0, 100);
    const y = clamp(Number(watermark.y ?? 50), 0, 100);
    document.body?.classList.toggle("has-brand-watermark", enabled);
    document.documentElement.style.setProperty("--tahmisci-watermark-logo", `url("${logo.replace(/"/g, "%22")}")`);
    document.documentElement.style.setProperty("--tahmisci-watermark-opacity", String(opacity));
    document.documentElement.style.setProperty("--tahmisci-watermark-size", `${size}vw`);
    document.documentElement.style.setProperty("--tahmisci-watermark-x", `${x}%`);
    document.documentElement.style.setProperty("--tahmisci-watermark-y", `${y}%`);
  }

  function applyMotion(siteState) {
    const preset = String(siteState?.motion?.preset || "balanced").toLowerCase();
    document.documentElement.dataset.motion = ["off", "simple", "balanced", "cinematic"].includes(preset) ? preset : "balanced";
  }

  function setLogo(selector, src, alt, keepText) {
    document.querySelectorAll(selector).forEach((link) => {
      if (!link) return;
      link.href = link.getAttribute("href") || "#top";
      const wrapper = link.querySelector(".logo-image-wrapper") || document.createElement("div");
      wrapper.className = "logo-image-wrapper";
      let image = wrapper.querySelector("img");
      if (!image) {
        image = document.createElement("img");
        image.className = "logo-image";
        wrapper.replaceChildren(image);
      }
      image.src = src;
      image.alt = alt;
      image.decoding = "async";
      image.loading = "eager";
      image.onerror = () => {
        image.remove();
        wrapper.textContent = "Tahmisçi";
        wrapper.classList.add("logo-text-fallback");
      };
      if (!keepText) link.replaceChildren(wrapper);
      else if (!link.querySelector(".logo-image-wrapper")) link.prepend(wrapper);
      link.classList.add("logo-ready");
    });
  }

  function connectEvents() {
    if (new URLSearchParams(window.location.search).has("preview")) return;
    if (!window.EventSource || state.eventSource || state.stopped) return;
    clearTimeout(state.reconnectTimer);
    const source = new EventSource(EVENTS_URL);
    state.eventSource = source;
    source.addEventListener("bootstrap", (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        state.reconnectDelay = 3000;
        applyBootstrap(payload, payload.reason || "event");
      } catch (error) {
        console.error("Canlı site verisi okunamadı:", error);
      }
    });
    source.onerror = () => {
      source.close();
      if (state.eventSource === source) state.eventSource = null;
      if (state.stopped) return;
      state.reconnectTimer = window.setTimeout(connectEvents, state.reconnectDelay);
      state.reconnectDelay = Math.min(state.reconnectDelay * 1.8, 30000);
    };
  }

  function mapCatalog(payload) {
    const menuSettings = payload?.siteState?.menuSection || {};
    const hiddenCategories = new Set(menuSettings.hiddenCategoryIds || []);
    const rawCategories = (payload?.menu?.categories || []).filter((category) => !hiddenCategories.has(String(category.id)));
    const categoryIds = new Map(rawCategories.map((category, index) => [String(category.id), index + 1]));
    let productIndex = 0;
    const products = [];
    const categories = [{ id: "all", name: text("Tümü", "All"), iconKey: "all", icon: "fas fa-layer-group", image: "", subcategories: [] }];
    rawCategories.forEach((category) => {
      const numericId = categoryIds.get(String(category.id));
      categories.push({
        id: numericId,
        sourceId: String(category.id),
        name: category.name,
        iconKey: category.iconKey || "",
        icon: category.icon || "fas fa-mug-hot",
        image: category.image || "",
        productCount: category.productCount || (category.products || []).length,
        subcategories: []
      });
      (category.products || []).filter((product) => !(menuSettings.soldOutMode === "hide" && product.stock === "sold-out")).forEach((product) => {
        productIndex += 1;
        products.push({
          id: productIndex,
          sourceId: String(product.id),
          category: numericId,
          parentCategory: numericId,
          categoryName: category.name,
          parentCategoryName: category.name,
          name: product.name,
          description: product.description || "",
          content: menuSettings.showContent === false ? "" : product.content || "",
          image: product.image || "",
          image_source: product.imageSource || product.image_source || (product.image ? "product" : ""),
          priceMode: product.priceMode,
          prices: product.prices || {},
          variants: product.variants || [],
          basePrice: Number(product.basePrice || 0),
          price: Number(product.basePrice || 0),
          priceLabel: product.priceLabel || "",
          products_branches_calories: menuSettings.showCalories === false ? "" : product.caloriesText || product.calories || "",
          products_branches_calories_unit: menuSettings.showCalories === false ? "" : product.caloriesUnit || "",
          calories: menuSettings.showCalories === false ? "" : product.calories || "",
          caloriesText: menuSettings.showCalories === false ? "" : product.caloriesText || product.calories || "",
          caloriesValue: menuSettings.showCalories === false ? null : product.caloriesValue ?? null,
          caloriesUnit: menuSettings.showCalories === false ? "" : product.caloriesUnit || "",
          allergens: menuSettings.showAllergens === false ? "" : product.allergens || "",
          ingredients: menuSettings.showContent === false ? "" : product.ingredients || product.content || "",
          nutrition: [
            menuSettings.showContent === false ? null : { name: "İçerik", value: product.ingredients || product.content || "" },
            menuSettings.showAllergens === false ? null : { name: "Alerjen", value: product.allergens || "" }
          ].filter((item) => item && item.value),
          popular: Boolean(product.popular),
          badge: product.popular ? "popular" : "",
          stock: product.stock || "active",
          kind: product.kind || "",
          temperature: product.temperature || "",
          order: Number(product.order || 0)
        });
      });
    });
    return { categories, products };
  }

  function applyHero(siteState, products) {
    if (!window.APP_CONFIG) return;
    const hero = siteState.hero || {};
    const language = currentLanguage();
    const slides = (hero.slides || [])
      .filter((slide) => slide && slide.visible !== false)
      .sort((first, second) => Number(first.order || 0) - Number(second.order || 0))
      .map((slide) => ({
        id: slide.id,
        brand: localized(hero.brand, language),
        title: localized(slide.title, language),
        description: localized(slide.description, language),
        buttonText: localized(slide.buttonText, language),
        buttonUrl: slide.buttonUrl || "#menu",
        buttonIcon: slide.buttonIcon || "fas fa-mug-hot",
        secondaryButtonText: localized(hero.secondaryButtonText, language),
        secondaryButtonUrl: hero.secondaryButtonUrl || "#about",
        backgroundImage: slide.backgroundImage || hero.media?.detail || ""
      }));
    window.APP_CONFIG.hero = {
      ...(window.APP_CONFIG.hero || {}),
      slides,
      mediaType: hero.mediaType === "image" ? "image" : "video",
      media: { ...(hero.media || {}) },
      autoplay: hero.autoplay !== false,
      autoplayInterval: Number(hero.autoplayInterval || 6000),
      transitionSpeed: 600
    };
    window.APP_CONFIG.demo = window.APP_CONFIG.demo || {};
    window.APP_CONFIG.demo.products = window.APP_CONFIG.demo.products || {};
    const featured = siteState.featuredProducts || {};
    const selectedIds = new Set(featured.productIds || []);
    const selected = featured.source === "manual" && selectedIds.size
      ? products.filter((product) => selectedIds.has(product.sourceId))
      : products.filter((product) => product.popular);
    window.APP_CONFIG.demo.products.items = selected.slice(0, 12);
  }

  function applySiteContent(site, menu) {
    const language = currentLanguage();
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = localized(value, language);
    };
    const setVisible = (selector, visible) => {
      const element = document.querySelector(selector);
      if (element) element.hidden = visible === false;
    };

    setVisible("#header", site.header?.visible);
    document.querySelectorAll('#mobileContactBtn').forEach((element) => {
      element.hidden = site.header?.contactVisible === false;
    });
    setVisible(".hero-section", site.hero?.visible);
    setVisible('[data-section="popular-products"]', site.featuredProducts?.visible);
    setVisible("#menu", site.menuSection?.visible);
    setVisible("#about", site.about?.visible);
    setVisible("#qr-menu", site.qrMenu?.visible);
    setVisible("#contact", site.contact?.visible);
    setVisible(".footer", site.footer?.visible);

    setText('[data-section="popular-products"] .section-title', site.featuredProducts?.title);
    setText("#menu .menu-eyebrow", site.menuSection?.eyebrow);
    setText("#menuTitle", site.menuSection?.title);
    const menuDescription = localized(site.menuSection?.description, language);
    const menuDescriptionElement = document.querySelector("#menu .menu-catalog-heading p");
    if (menuDescriptionElement) menuDescriptionElement.textContent = menuDescription || menuSummary(menu);
    const search = document.querySelector("#menu .search-control");
    const sort = document.querySelector("#menu .sort-control");
    if (search) search.hidden = site.menuSection?.showSearch === false;
    if (sort) sort.hidden = site.menuSection?.showSorting === false;

    setText("#about .section-title", site.about?.title);
    setText("#about .about-description", site.about?.description);
    const aboutImage = document.querySelector("#about .about-company-image img");
    if (aboutImage && site.about?.image) {
      aboutImage.src = site.about.image;
      aboutImage.alt = localized(site.about.imageAlt, language);
    }
    document.querySelectorAll("#about .about-feature").forEach((element, index) => {
      const feature = site.about?.features?.[index];
      if (!feature) return;
      const icon = element.querySelector("i");
      const label = element.querySelector("span");
      let detail = element.querySelector("small");
      if (icon) icon.className = feature.icon || "fas fa-circle";
      if (label) label.textContent = localized(feature.title, language);
      const detailText = localized(feature.text, language);
      if (detailText && !detail) {
        detail = document.createElement("small");
        element.appendChild(detail);
      }
      if (detail) {
        detail.textContent = detailText;
        detail.hidden = !detailText;
      }
    });
    const aboutButton = document.querySelector("#about .btn");
    if (aboutButton) {
      aboutButton.href = site.about?.buttonUrl || "#menu";
      const label = aboutButton.querySelector("span") || aboutButton;
      label.textContent = localized(site.about?.buttonText, language);
    }

    setText("#qr-menu h2", site.qrMenu?.title);
    setText("#qr-menu .qr-menu-text p", site.qrMenu?.description);
    const qrLink = document.querySelector("#qr-menu .qr-code-link");
    const qrTarget = absolute(site.qrMenu?.targetUrl || "/qr-menu/");
    if (qrLink) qrLink.href = qrTarget;
    const qrImage = document.querySelector("#qr-menu .qr-code img");
    if (qrImage) qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrTarget)}`;
    setText("#qr-menu .btn", site.qrMenu?.buttonText);

    applyContact(site.contact || {}, language);
    applyFooter(site, language);
    applySeo(site.seo || {}, language);
    applySectionOrder(site.sectionOrder || []);
  }

  function applyHeader(siteState, reason) {
    const site = siteState && typeof siteState === "object" ? siteState : {};
    const header = site.header && typeof site.header === "object" ? site.header : {};
    const navigation = normalizeNavigation(header.navigation, currentLanguage());
    const headerElement = document.getElementById("header");
    if (headerElement) headerElement.hidden = header.visible === false;

    const desktopList = document.querySelector(".header-nav > .nav-links");
    const mobileList = document.querySelector(".mobile-nav-content > .mobile-nav-links");
    if (desktopList) desktopList.replaceChildren(...navigation.map((item) => renderDesktopNavItem(item)));
    if (mobileList) mobileList.replaceChildren(...navigation.map((item) => renderMobileNavItem(item)));

    document.querySelectorAll('#mobileContactBtn').forEach((element) => {
      element.hidden = header.contactVisible === false;
    });
    updateActiveHeaderLink();
    window.HeaderData = {
      siteState: site,
      header: { visible: header.visible !== false, contactVisible: header.contactVisible !== false, navigation }
    };
    if (reason !== "fallback") {
      document.dispatchEvent(new CustomEvent("headerDataLoaded", { detail: window.HeaderData }));
    }
  }

  function normalizeNavigation(value, language) {
    const source = Array.isArray(value) && value.length ? value : DEFAULT_NAVIGATION;
    const includesMudavim = source.some((item) => String(item?.id || "").toLowerCase() === "mudavim");
    const normalizedSource = includesMudavim
      ? source
      : [...source, DEFAULT_NAVIGATION.find((item) => item.id === "mudavim")];
    return normalizedSource
      .filter((item) => item && typeof item === "object" && item.visible !== false)
      .map((item, index) => {
        const fallback = DEFAULT_NAVIGATION[index] || {};
        return {
          id: String(item.id || fallback.id || `nav-${index + 1}`),
          text: localized(item.label || item.text || fallback.label, language),
          url: safeNavigationUrl(item.url || fallback.url || "#top"),
          icon: safeIconClass(item.icon || fallback.icon || ""),
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
        };
      })
      .filter((item) => item.text && item.url)
      .sort((first, second) => first.order - second.order);
  }

  function renderDesktopNavItem(item) {
    const li = document.createElement("li");
    li.className = "nav-item";
    li.dataset.navId = item.id;
    const link = document.createElement("a");
    link.className = "nav-link";
    link.href = item.url;
    link.dataset.navId = item.id;
    if (item.icon) {
      const icon = document.createElement("i");
      icon.className = `nav-link-icon ${item.icon}`;
      icon.setAttribute("aria-hidden", "true");
      link.appendChild(icon);
    }
    const textNode = document.createElement("span");
    textNode.className = "nav-link-text";
    textNode.textContent = item.text;
    link.appendChild(textNode);
    link.addEventListener("click", handleNavigationClick);
    li.appendChild(link);
    return li;
  }

  function renderMobileNavItem(item) {
    const li = document.createElement("li");
    li.className = "mobile-nav-item";
    li.dataset.navId = item.id;
    const link = document.createElement("a");
    link.className = "mobile-nav-link";
    link.href = item.url;
    link.dataset.navId = item.id;
    if (item.icon) {
      const icon = document.createElement("i");
      icon.className = `mobile-nav-link-icon ${item.icon}`;
      icon.setAttribute("aria-hidden", "true");
      link.appendChild(icon);
    }
    const textNode = document.createElement("span");
    textNode.className = "mobile-nav-text";
    textNode.textContent = item.text;
    link.appendChild(textNode);
    link.addEventListener("click", (event) => {
      handleNavigationClick(event);
      closeMobileNavigation();
    });
    li.appendChild(link);
    return li;
  }

  function handleNavigationClick(event) {
    const link = event.currentTarget;
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("#")) return;
    const targetId = href === "#" ? "top" : href.slice(1);
    const target = targetId === "top" ? document.getElementById("top") || document.body : document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    const headerHeight = Math.ceil(document.getElementById("header")?.getBoundingClientRect().height || 76);
    const top = targetId === "top" ? 0 : Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerHeight - 12);
    history.pushState(null, "", href);
    window.scrollTo({ top, behavior: "smooth" });
    window.setTimeout(updateActiveHeaderLink, 80);
  }

  function closeMobileNavigation() {
    document.getElementById("mobileMenuBtn")?.classList.remove("active");
    document.getElementById("mobileNav")?.classList.remove("active");
    document.querySelector(".mobile-nav-backdrop")?.classList.remove("active");
    document.body.classList.remove("menu-open");
  }

  function updateActiveHeaderLink() {
    const links = document.querySelectorAll(".header-nav .nav-link[href^='#'], .mobile-nav-content .mobile-nav-link[href^='#']");
    const ids = Array.from(links).map((link) => (link.hash || link.getAttribute("href") || "").replace("#", "") || "top");
    const uniqueIds = [...new Set(ids)];
    const headerHeight = Math.ceil(document.getElementById("header")?.getBoundingClientRect().height || 76);
    const probe = headerHeight + 24;
    let activeId = "top";
    uniqueIds.forEach((id) => {
      const element = id === "top" ? document.body : document.getElementById(id);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (id === "top" && window.scrollY < Math.max(120, window.innerHeight * 0.35)) activeId = "top";
      if (id !== "top" && rect.top <= probe && rect.bottom > probe) activeId = id;
    });
    links.forEach((link) => {
      const id = (link.hash || link.getAttribute("href") || "").replace("#", "") || "top";
      link.classList.toggle("active", id === activeId);
    });
  }

  function safeNavigationUrl(value) {
    const textValue = String(value || "").trim();
    if (!textValue) return "#top";
    if (textValue.startsWith("#")) return textValue;
    try {
      const url = new URL(textValue, window.location.origin);
      if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
        return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
      }
    } catch (_error) {}
    return "#top";
  }

  function safeIconClass(value) {
    return String(value || "").split(/\s+/).filter((part) => /^[a-z0-9_-]+$/i.test(part)).join(" ");
  }

  function applyContact(contact, language) {
    const section = document.querySelector("#contact");
    if (!section) return;
    const cards = section.querySelectorAll(".tahmisci-contact-card");
    const title = section.querySelector(".section-title");
    if (title) title.textContent = contact.businessName || "Tahmisçi Coffee & Roastery";
    if (cards[0]) cards[0].querySelector("p").textContent = localized(contact.address, language);
    if (cards[1]) {
      cards[1].href = `tel:${phoneHref(contact.phone)}`;
      cards[1].querySelector("p").textContent = contact.phone || "";
    }
    if (cards[2]) {
      cards[2].href = contact.instagram || "#";
      cards[2].querySelector("p").textContent = socialHandle(contact.instagram, "@tahmiscicoffee");
    }
    if (cards[3]) {
      cards[3].href = contact.tiktok || "#";
      cards[3].querySelector("p").textContent = socialHandle(contact.tiktok, "@tahmiscicoffee");
    }
    const mapButton = section.querySelector(".tahmisci-map-btn");
    if (mapButton) mapButton.href = contact.mapsUrl || "#";
    const frame = section.querySelector("iframe");
    if (frame && contact.mapEmbedUrl) frame.src = contact.mapEmbedUrl;
    let details = section.querySelector(".contact-managed-details");
    if (!details) {
      details = document.createElement("div");
      details.className = "contact-managed-details";
      section.querySelector(".container")?.appendChild(details);
    }
    details.innerHTML = [
      localized(contact.hours, language) && `<span>${escapeHtml(localized(contact.hours, language))}</span>`,
      contact.email && `<a href="mailto:${escapeAttribute(contact.email)}">${escapeHtml(contact.email)}</a>`,
      contact.whatsapp && `<a href="https://wa.me/${escapeAttribute(phoneHref(contact.whatsapp))}">WhatsApp</a>`
    ].filter(Boolean).join("");
  }

  function applyFooter(site, language) {
    const footer = document.querySelector(".footer");
    if (!footer) return;
    const contact = site.contact || {};
    const footerState = site.footer || {};
    const description = footer.querySelector(".footer-description");
    if (description) description.textContent = localized(footerState.description, language);
    const links = footer.querySelector(".footer-links");
    const quickLinks = Array.isArray(footerState.quickLinks) && footerState.quickLinks.length
      ? footerState.quickLinks
      : normalizeNavigation(site.header?.navigation, language).map((item) => ({ label: item.text, url: item.url }));
    if (links) links.innerHTML = quickLinks.map((item) => `<li><a href="${escapeAttribute(item.url || "#")}">${escapeHtml(localized(item.label, language))}</a></li>`).join("");
    const social = footer.querySelector(".social-links");
    if (social) {
      const items = [
        contact.instagram && { url: contact.instagram, icon: "fab fa-instagram", label: "Instagram" },
        contact.tiktok && { url: contact.tiktok, icon: "fab fa-tiktok", label: "TikTok" },
        ...(contact.socialLinks || [])
      ].filter(Boolean);
      social.innerHTML = items.map((item) => `<a class="social-link" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttribute(item.label || "Sosyal medya")}"><i class="${escapeAttribute(item.icon || "fas fa-link")}"></i></a>`).join("");
    }
    const contactSection = footer.querySelector(".footer-section:last-of-type");
    if (contactSection) {
      const title = contactSection.querySelector(".footer-title");
      contactSection.innerHTML = "";
      if (title) contactSection.appendChild(title);
      contactSection.insertAdjacentHTML("beforeend", `<p>${escapeHtml(localized(contact.address, language))}</p>${contact.phone ? `<a href="tel:${escapeAttribute(phoneHref(contact.phone))}">${escapeHtml(contact.phone)}</a>` : ""}`);
    }
    const copyright = footer.querySelector(".footer-bottom-copyright");
    if (copyright) copyright.textContent = localized(footerState.copyright, language).replace("{year}", String(new Date().getFullYear()));
    const bottomLinks = footer.querySelector(".footer-bottom-links");
    if (bottomLinks) bottomLinks.innerHTML = (footerState.bottomLinks || []).map((item) => `<a href="${escapeAttribute(item.url || "#")}">${escapeHtml(localized(item.label, language))}</a>`).join("");
  }

  function applySeo(seo, language) {
    const title = localized(seo.title, language);
    if (title) document.title = title;
    setMeta("name", "description", localized(seo.description, language));
    setMeta("name", "keywords", seo.keywords || "");
    setMeta("property", "og:title", localized(seo.ogTitle, language));
    setMeta("property", "og:description", localized(seo.ogDescription, language));
    setMeta("property", "og:image", seo.ogImage || "");
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    if (seo.canonicalUrl) canonical.href = seo.canonicalUrl;
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon && seo.favicon) favicon.href = seo.favicon;
  }

  function applySectionOrder(order) {
    const main = document.querySelector("main");
    if (!main || !Array.isArray(order)) return;
    const selectors = {
      hero: ".hero-section",
      featuredProducts: '[data-section="popular-products"]',
      menuSection: "#menu",
      about: "#about",
      qrMenu: "#qr-menu",
      contact: "#contact"
    };
    order.forEach((key) => {
      const element = main.querySelector(selectors[key]);
      if (element) main.appendChild(element);
    });
  }

  function showError() {
    let box = document.getElementById("publicDataError");
    if (!box) {
      box = document.createElement("div");
      box.id = "publicDataError";
      box.className = "public-data-error";
      box.innerHTML = `<p>${escapeHtml(text("Menü şu anda yüklenemiyor.", "The menu is currently unavailable."))}</p><button type="button">${escapeHtml(text("Tekrar Dene", "Try Again"))}</button>`;
      box.querySelector("button").addEventListener("click", () => {
        provider.ready = load();
        provider.ready.catch(() => {});
      });
      (document.querySelector("#menu .menu-catalog-heading") || document.body).appendChild(box);
    }
    box.hidden = false;
    const loading = document.getElementById("loadingState");
    if (loading) loading.style.display = "none";
  }

  function hideError() {
    const box = document.getElementById("publicDataError");
    if (box) box.hidden = true;
  }

  function menuSummary(menu) {
    const categories = Number(menu?.categoryCount || 0);
    const products = Number(menu?.productCount || 0);
    return currentLanguage() === "en" ? `${categories} categories and ${products} products` : `${categories} kategori ve ${products} ürün`;
  }

  function localized(value, language) {
    if (value && typeof value === "object" && !Array.isArray(value)) return String(value[language] || value.tr || value.en || "");
    return String(value || "");
  }

  function currentLanguage() {
    return window.I18N?.getPreferredLanguage?.() || localStorage.getItem("site_language") || "tr";
  }

  function text(tr, en) {
    return currentLanguage() === "en" ? en : tr;
  }

  function absolute(value) {
    try { return new URL(String(value || ""), window.location.origin).toString(); } catch (_error) { return window.location.origin; }
  }

  function safeAssetUrl(value, fallback) {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    if (raw.startsWith("/assets/") || raw.startsWith("/media/")) return raw;
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin === window.location.origin && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/media/"))) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch (_error) {}
    return fallback;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function phoneHref(value) {
    const digits = String(value || "").replace(/[^+\d]/g, "");
    return digits.startsWith("+") ? digits : `+90${digits.replace(/^0/, "")}`;
  }

  function calorieValue(value) {
    const match = String(value || "").match(/[\d.,]+/);
    return match ? match[0].replace(",", ".") : "";
  }

  function calorieUnit(value) {
    const unit = String(value || "").replace(/[\d.,\s]/g, "").trim();
    return unit || "kcal";
  }

  function socialHandle(value, fallback) {
    try {
      const path = new URL(value).pathname.split("/").filter(Boolean).pop();
      return path ? `@${path}` : fallback;
    } catch (_error) { return fallback; }
  }

  function setMeta(attribute, key, content) {
    const element = document.querySelector(`meta[${attribute}="${key}"]`);
    if (element && content) element.setAttribute("content", content);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  window.addEventListener("languageChanged", () => {
    if (state.bootstrap) applyBootstrap(state.bootstrap, "language");
    else applyHeader({ header: { visible: true, contactVisible: true, navigation: DEFAULT_NAVIGATION } }, "fallback");
  });
  window.addEventListener("scroll", updateActiveHeaderLink, { passive: true });
  window.addEventListener("hashchange", updateActiveHeaderLink);

  window.addEventListener("beforeunload", () => {
    state.stopped = true;
    clearTimeout(state.reconnectTimer);
    state.eventSource?.close();
  }, { once: true });
})();
