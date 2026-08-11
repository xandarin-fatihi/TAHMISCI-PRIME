"use strict";

const SITE_SCHEMA_VERSION = 3;

const DEFAULT_HEADER_NAVIGATION = Object.freeze([
  {
    id: "home",
    label: { tr: "Ana Sayfa", en: "Home" },
    url: "#top",
    icon: "fas fa-house",
    visible: true,
    order: 0
  },
  {
    id: "menu",
    label: { tr: "Menü", en: "Menu" },
    url: "#menu",
    icon: "fas fa-utensils",
    visible: true,
    order: 1
  },
  {
    id: "about",
    label: { tr: "Hakkımızda", en: "About" },
    url: "#about",
    icon: "fas fa-mug-hot",
    visible: true,
    order: 2
  },
  {
    id: "contact",
    label: { tr: "İletişim", en: "Contact" },
    url: "#contact",
    icon: "fas fa-phone",
    visible: true,
    order: 3
  },
  {
    id: "mudavim",
    label: { tr: "Müdavim", en: "Müdavim" },
    url: "/mudavim/",
    icon: "fas fa-id-card",
    visible: true,
    order: 4
  }
]);

const DEFAULT_SITE_STATE = Object.freeze({
  schemaVersion: SITE_SCHEMA_VERSION,
  global: {
    siteName: "Tahmisçi Coffee & Roastery",
    defaultLanguage: "tr",
    supportedLanguages: ["tr", "en"]
  },
  features: {
    customerAccountsEnabled: false,
    orderingEnabled: false
  },
  branding: {
    desktopLogo: "/assets/brand/logo-primary.png",
    mobileLogo: "/assets/brand/logo-primary.png",
    loaderLogo: "/assets/brand/logo-large.png",
    footerLogo: "/assets/brand/logo-light-green.png",
    favicon: "/assets/brand/favicon.png",
    logoAlt: { tr: "Tahmisçi Coffee & Roastery", en: "Tahmisçi Coffee & Roastery" }
  },
  watermark: {
    enabled: true,
    logo: "/assets/brand/logo-large.png",
    opacity: 0.12,
    size: 58,
    x: 50,
    y: 50
  },
  motion: {
    preset: "balanced"
  },
  header: {
    visible: true,
    contactVisible: true,
    navigation: clone(DEFAULT_HEADER_NAVIGATION)
  },
  hero: {
    visible: true,
    mediaType: "video",
    brand: { tr: "Tahmisçi Coffee & Roastery", en: "Tahmisçi Coffee & Roastery" },
    sliderEnabled: false,
    autoplay: true,
    autoplayInterval: 6000,
    secondaryButtonText: { tr: "Hakkımızda", en: "About Us" },
    secondaryButtonUrl: "#about",
    overlay: 0.58,
    slides: [{
      id: "hero-main",
      visible: true,
      order: 0,
      title: { tr: "Kahvenin iyi hali", en: "Coffee at its best" },
      description: {
        tr: "Özenle hazırlanan kahveler ve günün her anına eşlik eden lezzetler.",
        en: "Carefully prepared coffees and flavors for every moment of the day."
      },
      buttonText: { tr: "Menüyü Keşfet", en: "Explore the Menu" },
      buttonUrl: "#menu",
      backgroundImage: "/assets/images/hero/tahmisci-barista-detail.jpg"
    }],
    media: {
      primary: "/assets/images/hero/tahmisci-barista-main.jpg",
      detail: "/assets/images/hero/tahmisci-barista-detail.jpg",
      mobile: "/assets/images/hero/tahmisci-barista-detail.jpg",
      coldDrinksFront: "/assets/images/hero/tahmisci-cold-drinks-front.jpg",
      coldDrinksTop: "/assets/images/hero/tahmisci-cold-drinks-top.jpg",
      reelPrimary: "/assets/videos/hero/tahmisci-reel-primary.mp4",
      reelSecondary: "/assets/videos/hero/tahmisci-reel-secondary.mp4",
      mobileVideo: "/assets/videos/hero/tahmisci-reel-secondary.mp4",
      reelPoster: "/assets/images/hero/tahmisci-cold-drinks-front.jpg"
    }
  },
  featuredProducts: {
    visible: true,
    title: { tr: "Öne Çıkan Lezzetler", en: "Featured Flavors" },
    description: { tr: "", en: "" },
    source: "popular",
    productIds: []
  },
  menuSection: {
    visible: true,
    eyebrow: { tr: "TAHMİSÇİ MENÜ", en: "TAHMİSÇİ MENU" },
    title: { tr: "Kahveden tatlıya, tüm lezzetler", en: "Every flavor, from coffee to dessert" },
    description: { tr: "", en: "" },
    showSearch: true,
    showSorting: true,
    showCalories: true,
    showAllergens: true,
    showContent: true,
    soldOutMode: "label",
    hiddenCategoryIds: []
  },
  about: {
    visible: true,
    title: { tr: "Tahmisçi", en: "Tahmisçi" },
    description: {
      tr: "Tahmisçi geleneği, Torbalı'da kahvenin kokusunu ve emeğini bugüne taşıyan bir marka deneyimidir. Zeytin odununda kavrulan kahve hafızasından ilham alıyor; espresso kültürü, soğuk içecekler, tatlılar ve özenli hazırlıkla günün her anına eşlik eden sade bir kahve molası sunuyoruz.",
      en: "Tahmisçi carries the craft and aroma of coffee into a contemporary Torbalı experience, inspired by a tradition of roasting over olive wood."
    },
    image: "/assets/images/about/tahmisci-hakkimizda.webp",
    imageAlt: { tr: "Tahmisçi kahve sunumu", en: "Tahmisçi coffee presentation" },
    features: [
      { icon: "fa-solid fa-award", title: { tr: "Özenli Hazırlık", en: "Careful Preparation" }, text: { tr: "", en: "" } },
      { icon: "fa-solid fa-truck-fast", title: { tr: "Hızlı Servis", en: "Fast Service" }, text: { tr: "", en: "" } },
      { icon: "fa-solid fa-heart", title: { tr: "Kahve Tutkusu", en: "Coffee Passion" }, text: { tr: "", en: "" } }
    ],
    buttonText: { tr: "Menüyü Keşfet", en: "Explore the Menu" },
    buttonUrl: "#menu"
  },
  qrMenu: {
    visible: true,
    title: { tr: "QR Menü ile Hızlı Erişim", en: "Quick Access with QR Menu" },
    description: {
      tr: "QR kodu okutarak Tahmisçi menüsüne mobil cihazınızdan hızlıca ulaşın.",
      en: "Scan the QR code to open the Tahmisçi menu on your mobile device."
    },
    targetUrl: "/qr-menu/",
    buttonText: { tr: "Menüye Git", en: "Open Menu" }
  },
  contact: {
    visible: true,
    businessName: "Tahmisçi Coffee & Roastery",
    address: { tr: "Ertuğrul Mahallesi, Sadık İleri Bulvarı No: 42/B, 35860 Torbalı/İzmir", en: "Ertuğrul District, Sadık İleri Boulevard No: 42/B, Torbalı/İzmir" },
    phone: "0552 295 46 34",
    whatsapp: "",
    email: "",
    hours: { tr: "", en: "" },
    instagram: "https://www.instagram.com/tahmiscicoffee",
    tiktok: "https://www.tiktok.com/@tahmiscicoffee",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Ertu%C4%9Frul%20Mahallesi%20Sad%C4%B1k%20%C4%B0leri%20Bulvar%C4%B1%20No%3A%2042B%2035860%20Torbal%C4%B1%20%C4%B0zmir%20Tahmis%C3%A7i%20Coffee%20%26%20Roastery",
    mapEmbedUrl: "https://www.google.com/maps?q=Ertu%C4%9Frul%20Mahallesi%20Sad%C4%B1k%20%C4%B0leri%20Bulvar%C4%B1%20No%3A%2042B%20Torbal%C4%B1%20%C4%B0zmir&output=embed",
    socialLinks: []
  },
  footer: {
    visible: true,
    description: {
      tr: "Tahmisçi Coffee & Roastery; kahve, tatlı ve günün her anına eşlik eden lezzetleri Torbalı'da buluşturur.",
      en: "Tahmisçi Coffee & Roastery brings together coffee, desserts and all-day flavors in Torbalı."
    },
    quickLinks: [
      { label: { tr: "Ana Sayfa", en: "Home" }, url: "#top" },
      { label: { tr: "Menü", en: "Menu" }, url: "#menu" },
      { label: { tr: "Hakkımızda", en: "About" }, url: "#about" },
      { label: { tr: "İletişim", en: "Contact" }, url: "#contact" }
    ],
    copyright: { tr: "© {year} Tahmisçi. Tüm hakları saklıdır.", en: "© {year} Tahmisçi. All rights reserved." },
    bottomLinks: []
  },
  seo: {
    title: { tr: "Tahmisçi Coffee & Roastery", en: "Tahmisçi Coffee & Roastery" },
    description: {
      tr: "Tahmisçi Coffee & Roastery dijital menü ve marka deneyimi.",
      en: "Tahmisçi Coffee & Roastery digital menu and brand experience."
    },
    keywords: "Tahmisçi, kahve, coffee, roastery, Torbalı",
    ogTitle: { tr: "Tahmisçi Coffee & Roastery", en: "Tahmisçi Coffee & Roastery" },
    ogDescription: { tr: "Kahvenin iyi hali.", en: "Coffee at its best." },
    ogImage: "/assets/images/hero/tahmisci-barista-main.jpg",
    favicon: "/assets/brand/favicon.png",
    canonicalUrl: "https://tahmiscicoffee.com/"
  },
  mudavim: {
    announcements: [
      {
        id: "mudavim-hos-geldin",
        title: "Tahmisçi Müdavim’e Hoş Geldin",
        slug: "mudavim-hos-geldin",
        order: 0,
        isPublished: true,
        blocks: [
          {
            id: "mudavim-hos-geldin-metin",
            type: "text",
            content: "Ziyaretlerini, üyelik dereceni ve Tahmisçi’den güncel duyuruları Müdavim Paneli üzerinden takip edebilirsin.",
            order: 0
          }
        ],
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z"
      }
    ]
  },
  sectionOrder: ["hero", "featuredProducts", "menuSection", "about", "qrMenu", "contact"],
  updatedAt: null
});

function migrateSiteState(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const next = deepMerge(clone(DEFAULT_SITE_STATE), source);

  migrateLegacyText(next, source, "heroTitle", ["hero", "slides", 0, "title"]);
  migrateLegacyText(next, source, "heroSubtitle", ["hero", "slides", 0, "description"]);
  migrateLegacyText(next, source, "storyTitle", ["about", "title"]);
  migrateLegacyText(next, source, "storyText", ["about", "description"]);
  migrateLegacyText(next, source, "menuTitle", ["menuSection", "title"]);
  migrateLegacyText(next, source, "menuIntro", ["menuSection", "description"]);
  migrateLegacyValue(next, source, "heroImageUrl", ["hero", "media", "primary"]);

  // Older Windows-local seeds were once written through a non-UTF-8 code path.
  // Repair only strings that are demonstrably degraded copies of our defaults;
  // custom CMS content and legitimate question marks remain untouched.
  repairCorruptedDefaultStrings(next, DEFAULT_SITE_STATE);

  const contactMap = ["address", "phone", "email", "whatsapp", "instagram", "tiktok", "mapsUrl", "hours"];
  contactMap.forEach((key) => migrateLegacyValue(next, source, key, ["contact", key]));

  next.schemaVersion = SITE_SCHEMA_VERSION;
  next.features = normalizeFeatures(next.features);
  next.branding = normalizeBranding(next.branding);
  next.watermark = normalizeWatermark(next.watermark);
  next.motion = normalizeMotion(next.motion);
  next.hero.slides = Array.isArray(next.hero.slides) ? next.hero.slides : clone(DEFAULT_SITE_STATE.hero.slides);
  next.header.navigation = normalizeHeaderNavigation(next.header.navigation);
  next.about.features = Array.isArray(next.about.features) ? next.about.features.slice(0, 3) : clone(DEFAULT_SITE_STATE.about.features);
  next.contact.socialLinks = Array.isArray(next.contact.socialLinks) ? next.contact.socialLinks : [];
  next.footer.quickLinks = Array.isArray(next.footer.quickLinks) ? next.footer.quickLinks : clone(DEFAULT_SITE_STATE.footer.quickLinks);
  next.footer.bottomLinks = Array.isArray(next.footer.bottomLinks) ? next.footer.bottomLinks : [];
  next.mudavim = normalizeMudavim(next.mudavim);
  next.sectionOrder = normalizeSectionOrder(next.sectionOrder);
  return next;
}

function normalizeFeatures(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    customerAccountsEnabled: source.customerAccountsEnabled === true,
    orderingEnabled: source.orderingEnabled === true
  };
}

function normalizeBranding(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = DEFAULT_SITE_STATE.branding;
  return {
    desktopLogo: safeAssetPath(source.desktopLogo, fallback.desktopLogo),
    mobileLogo: safeAssetPath(source.mobileLogo, fallback.mobileLogo),
    loaderLogo: safeAssetPath(source.loaderLogo, fallback.loaderLogo),
    footerLogo: safeAssetPath(source.footerLogo, fallback.footerLogo),
    favicon: safeAssetPath(source.favicon, fallback.favicon),
    logoAlt: normalizeLocalizedText(source.logoAlt || fallback.logoAlt)
  };
}

function normalizeWatermark(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = DEFAULT_SITE_STATE.watermark;
  return {
    enabled: source.enabled !== false,
    logo: safeAssetPath(source.logo, fallback.logo),
    opacity: clampNumber(source.opacity, fallback.opacity, 0, 0.2),
    size: clampNumber(source.size, fallback.size, 20, 140),
    x: clampNumber(source.x, fallback.x, 0, 100),
    y: clampNumber(source.y, fallback.y, 0, 100)
  };
}

function normalizeMotion(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const preset = String(source.preset || DEFAULT_SITE_STATE.motion.preset);
  return { preset: ["off", "subtle", "balanced", "cinematic"].includes(preset) ? preset : "balanced" };
}

function normalizeMudavim(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const announcements = Array.isArray(source.announcements)
    ? source.announcements
    : clone(DEFAULT_SITE_STATE.mudavim.announcements);
  return {
    ...source,
    announcements: announcements
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item, itemIndex) => normalizeAnnouncement(item, itemIndex))
      .sort((first, second) => first.order - second.order)
  };
}

function normalizeAnnouncement(item, itemIndex) {
  const id = safeIdentifier(item.id, `announcement-${itemIndex + 1}`);
  const title = String(item.title || "Duyuru").trim();
  const slug = safeIdentifier(item.slug, id);
  const blocks = (Array.isArray(item.blocks) ? item.blocks : [])
    .filter((block) => block && typeof block === "object" && !Array.isArray(block))
    .map((block, blockIndex) => {
      const allowedTypes = ["text", "image", "image-text", "text-image"];
      const type = allowedTypes.includes(block.type) ? block.type : (block.type === "image" ? "image" : "text");
      const hasText = type !== "image";
      const hasImage = type !== "text";
      const body = String(block.body ?? block.content ?? "");
      return {
        ...block,
        id: safeIdentifier(block.id, `${id}-block-${blockIndex + 1}`),
        type,
        badge: hasText ? String(block.badge || "") : "",
        date: hasText ? String(block.date || "") : "",
        heading: hasText ? String(block.heading || "") : "",
        body: hasText ? body : "",
        content: type === "text" ? body : "",
        imageUrl: hasImage ? safeAssetPath(block.imageUrl, "") : "",
        alt: hasImage ? String(block.alt || block.heading || title) : "",
        order: Number.isFinite(Number(block.order)) ? Number(block.order) : blockIndex
      };
    })
    .sort((first, second) => first.order - second.order);
  return {
    ...item,
    id,
    title,
    slug,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : itemIndex,
    isPublished: item.isPublished === true,
    blocks,
    createdAt: String(item.createdAt || ""),
    updatedAt: String(item.updatedAt || "")
  };
}

function safeIdentifier(value, fallback) {
  const text = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return text || fallback;
}

function safeAssetPath(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/^https?:\/\//i.test(text) || text.startsWith("/") || text.startsWith("media:")) return text;
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeHeaderNavigation(value) {
  const source = Array.isArray(value) && value.length ? value : clone(DEFAULT_HEADER_NAVIGATION);
  const includesMudavim = source.some((item) => String(item?.id || "").toLowerCase() === "mudavim");
  const normalizedSource = includesMudavim
    ? source
    : [...source, clone(DEFAULT_HEADER_NAVIGATION.find((item) => item.id === "mudavim"))];
  return normalizedSource
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => {
      const fallback = DEFAULT_HEADER_NAVIGATION[index] || {};
      return {
        id: String(item.id || fallback.id || `nav-${index + 1}`),
        label: normalizeLocalizedText(item.label || item.text || fallback.label),
        url: String(item.url || fallback.url || "#top"),
        icon: String(item.icon || fallback.icon || ""),
        visible: item.visible !== false,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
      };
    });
}

function normalizeLocalizedText(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { tr: String(value.tr || value.en || ""), en: String(value.en || value.tr || "") };
  }
  const text = String(value || "");
  return { tr: text, en: text };
}

function localize(value, language = "tr") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value[language] || value.tr || value.en || "");
  }
  return String(value || "");
}

function normalizeSectionOrder(value) {
  const allowed = ["hero", "featuredProducts", "menuSection", "about", "qrMenu", "contact"];
  const provided = Array.isArray(value) ? value.filter((item) => allowed.includes(item)) : [];
  return [...new Set([...provided, ...allowed])];
}

function migrateLegacyText(target, source, legacyKey, path) {
  if (!source[legacyKey]) return;
  if (getAtPath(source, path) === undefined) setAtPath(target, path, { tr: String(source[legacyKey]), en: "" });
}

function migrateLegacyValue(target, source, legacyKey, path) {
  if (source[legacyKey] === undefined || source[legacyKey] === null || source[legacyKey] === "") return;
  if (getAtPath(source, path) === undefined) setAtPath(target, path, source[legacyKey]);
}

function getAtPath(object, path) {
  return path.reduce((value, key) => value && value[key], object);
}

function setAtPath(object, path, value) {
  let target = object;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!target[key] || typeof target[key] !== "object") target[key] = typeof path[index + 1] === "number" ? [] : {};
    target = target[key];
  }
  target[path[path.length - 1]] = value;
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = clone(value);
    } else if (value && typeof value === "object") {
      target[key] = deepMerge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function repairCorruptedDefaultStrings(value, fallback) {
  if (!value || !fallback || typeof value !== "object" || typeof fallback !== "object") return value;

  for (const [key, expected] of Object.entries(fallback)) {
    const current = value[key];
    if (typeof current === "string" && typeof expected === "string") {
      if (isDegradedDefaultString(current, expected)) value[key] = expected;
      continue;
    }
    if (Array.isArray(current) && Array.isArray(expected)) {
      current.forEach((item, index) => repairCorruptedDefaultStrings(item, expected[index]));
      continue;
    }
    repairCorruptedDefaultStrings(current, expected);
  }
  return value;
}

function isDegradedDefaultString(value, expected) {
  if (!value || value === expected || !/[?\u0000-\u007f]/.test(value)) return false;
  const alternatives = {
    "ç": "[çc?]", "Ç": "[ÇC?]",
    "ğ": "[ğg?]", "Ğ": "[ĞG?]",
    "ı": "[ıi?]", "İ": "[İIi?]",
    "ö": "[öo?]", "Ö": "[ÖO?]",
    "ş": "[şs?]", "Ş": "[ŞS?]",
    "ü": "[üu?]", "Ü": "[ÜU?]",
    "©": "(?:©|\\?)",
    "’": "(?:’|')"
  };
  const pattern = Array.from(expected, (character) => alternatives[character] || escapeRegExp(character)).join("");
  return new RegExp(`^${pattern}$`).test(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_SITE_STATE,
  DEFAULT_HEADER_NAVIGATION,
  SITE_SCHEMA_VERSION,
  migrateSiteState,
  localize
};
