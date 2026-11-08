(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TahmisciMenuDesignSchema = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DESIGN_SCHEMA_VERSION = 2;
  const DEFAULT_PRESET_ID = "tahmisci-beige-brown";
  const BRAND_BODY_FONT = '"Tahmisci Poppins", Poppins, Arial, sans-serif';
  const LEGACY_PRESET_IDS = Object.freeze({
    "tahmisci-20260522a": "tahmisci-legacy-green",
    "tahmisci-20260722-beige-brown": DEFAULT_PRESET_ID
  });
  const STYLE_TYPES = new Set(["solid", "gradient", "image"]);

  const CATEGORY_ARTWORK = deepFreeze({
    SOGUKLAR: { image: "/assets/menu-category-art/iced-latte.webp", tint: "#B3DAE4" },
    SICAKLAR: { image: "/assets/menu-category-art/hot-coffee.webp", tint: "#E8B887" },
    "TURK KAHVELERI": { image: "/assets/menu-category-art/turkish-coffee.webp", tint: "#AFD1BD" },
    "TATLI & SANDWICH": { image: "/assets/menu-category-art/dessert-sandwich.webp", tint: "#F1BDC2" },
    MESRUBAT: { image: "/assets/menu-category-art/sparkling-drink.webp", tint: "#D1DEA3" },
    "KASA ONU": { image: "/assets/menu-category-art/checkout-treats.webp", tint: "#DFB296" },
    "PAKETLI URUN": { image: "/assets/menu-category-art/packaged-coffee.webp", tint: "#CABF9D" },
    DONDURMA: { image: "/assets/menu-category-art/ice-cream.webp", tint: "#E8C3DE" }
  });

  function categoryArtworkForName(name) {
    const key = String(name || "").trim().toLocaleUpperCase("tr-TR").normalize("NFD")
      .replace(/\p{M}/gu, "").replace(/\s+/g, " ");
    return Object.hasOwn(CATEGORY_ARTWORK, key) ? CATEGORY_ARTWORK[key] : null;
  }

  function categoryArtworkForImage(image) {
    return Object.values(CATEGORY_ARTWORK).find((artwork) => artwork.image === image);
  }

  function categoryImageLayout(style) {
    if (style?.imageLayout === "right" || style?.imageLayout === "cover") return style.imageLayout;
    const image = style?.imageUrl || style?.image;
    return !image || categoryArtworkForImage(image) ? "right" : "cover";
  }

  const SEASONAL_CONCEPTS = deepFreeze([
    {
      id: "santa-post", name: "Noel Baba’nın Postası", night: false,
      background: "#F9E8CB", surface: "#FFF4E0", accent: "#8A1829", text: "#17372E",
      button: "#87182A", buttonText: "#FFF6E5", category: "#FFF1D8"
    },
    {
      id: "reindeer-woods", name: "Ren Geyiği Ormanı", night: true,
      background: "#0D3328", surface: "#0F493A", accent: "#F1CA7F", text: "#FFF2D2",
      button: "#0F402F", buttonText: "#FFF2D2", category: "#FFF0D4"
    },
    {
      id: "festive-lights", name: "Işıl Işıl Noel", night: true,
      background: "#32132D", surface: "#720F2A", accent: "#FFD38B", text: "#FFF4DF",
      button: "#841E34", buttonText: "#FFF4E3", category: "#FFF0DB"
    },
    {
      id: "snow-village", name: "Karlı Noel Köyü", night: false,
      background: "#C7DFEC", surface: "#EDF6FC", accent: "#335B7B", text: "#14334A",
      button: "#294F72", buttonText: "#F1F9FF", category: "#DCEFFE", categoryBorder: "#5A8FB8"
    },
    {
      id: "gingerbread", name: "Tarçınlı Noel", night: false,
      background: "#F4DAB6", surface: "#FFF0D9", accent: "#8E4726", text: "#4E261A",
      button: "#78391D", buttonText: "#FFF4DF", category: "#F9D7AC", categoryBorder: "#AD6B40"
    },
    {
      id: "pumpkin-lanterns", collection: "halloween", name: "Balkabağı Fenerleri", night: false,
      background: "#F6DDB8", surface: "#F7E6C5", accent: "#9A481D", text: "#392315",
      button: "#873B18", buttonText: "#FFF0D9", category: "#FFE1B8", categoryBorder: "#B76B39"
    },
    {
      id: "ghost-coffeehouse", collection: "halloween", name: "Hayalet Kahvehane", night: true,
      background: "#17203C", surface: "#232745", accent: "#DFC7A0", text: "#F7E9D2",
      button: "#283559", buttonText: "#FCEDD0", category: "#DDE6FD", categoryBorder: "#819ACD"
    },
    {
      id: "witch-espresso", collection: "halloween", name: "Cadının Espressosu", night: true,
      background: "#381728", surface: "#54243D", accent: "#E9B873", text: "#FFEBCC",
      button: "#59263F", buttonText: "#FFF2DB", category: "#ECD2F5", categoryBorder: "#A97CC4"
    },
    {
      id: "tahmisci-imza", collection: "daily", name: "Tahmisçi İmza",
      palettes: {
        light: { background: "#F6EDDF", surface: "#FFFAF1", accent: "#315646", text: "#23392E", button: "#315646", buttonText: "#FFF9ED", category: "#E2EBDB", categoryBorder: "#688975", product: "#FFF9EE" },
        dark: { background: "#162922", surface: "#233C31", accent: "#E2C693", text: "#FFF1D8", button: "#E2C693", buttonText: "#23392E", category: "#29493B", categoryBorder: "#9CB08E", product: "#233C31" }
      }
    },
    {
      id: "matcha-cilek", collection: "daily", name: "Matcha & Çilek",
      palettes: {
        light: { background: "#F2F3E1", surface: "#FFF2F0", accent: "#42673C", text: "#303F2D", button: "#7E354B", buttonText: "#FFF5F0", category: "#DEE7C4", categoryBorder: "#7F965F", product: "#FFF4EF" },
        dark: { background: "#242D22", surface: "#36432F", accent: "#E0A5AF", text: "#FFF1E8", button: "#E0A5AF", buttonText: "#442330", category: "#3B4E34", categoryBorder: "#A2B977", product: "#382C34" }
      }
    },
    {
      id: "kavrum-bari", collection: "daily", name: "Kavrum Barı",
      palettes: {
        light: { background: "#EFE4D7", surface: "#FAF4ED", accent: "#805135", text: "#392A26", button: "#603B2C", buttonText: "#FFF8ED", category: "#E7D3BF", categoryBorder: "#AF815E", product: "#FBF0E4" },
        dark: { background: "#211C1A", surface: "#342824", accent: "#DFAD81", text: "#FAEADF", button: "#DFAD81", buttonText: "#35231F", category: "#46342B", categoryBorder: "#C18E68", product: "#3A2B25" }
      }
    },
    {
      id: "saygiyla-anma", collection: "occasion", name: "10 Kasım · Saygıyla Anma", night: true,
      backgroundArt: "/assets/menu-themes/occasion/saygiyla-anma.webp",
      palettes: {
        light: { background: "#EEEDEA", surface: "#F9F7F1", accent: "#5C4A48", text: "#302D2B", button: "#48413F", buttonText: "#FFF9F1", category: "#E2DEDA", categoryBorder: "#8C7775", product: "#F8F4EF" },
        dark: { background: "#201D1E", surface: "#343135", accent: "#E1C7B6", text: "#FFF1E5", button: "#513037", buttonText: "#FFF1E5", category: "#403538", categoryBorder: "#9F8382", product: "#373236" }
      }
    },
    {
      id: "defter-kahve", collection: "occasion", name: "24 Kasım · Defter & Kahve",
      backgroundArt: "/assets/menu-themes/occasion/defter-kahve.webp",
      palettes: {
        light: { background: "#F3EAD8", surface: "#FBF5E6", accent: "#61416B", text: "#352D3B", button: "#61416B", buttonText: "#FFF5E5", category: "#EEE1E9", categoryBorder: "#9976A0", product: "#FCF3E7" },
        dark: { background: "#262135", surface: "#363047", accent: "#E7C6B0", text: "#F9EDE4", button: "#E7C6B0", buttonText: "#38293E", category: "#43354E", categoryBorder: "#A790B2", product: "#392D41" }
      }
    },
    {
      id: "bakir-cezve", collection: "occasion", name: "5 Aralık · Bakır Cezve",
      backgroundArt: "/assets/menu-themes/occasion/bakir-cezve.webp",
      palettes: {
        light: { background: "#F7E9D4", surface: "#FFF5E4", accent: "#245774", text: "#263640", button: "#854C33", buttonText: "#FFF4DF", category: "#DBE7EB", categoryBorder: "#55839C", product: "#FFF3DD" },
        dark: { background: "#251D1B", surface: "#392923", accent: "#F1BE90", text: "#FFF0D9", button: "#F1BE90", buttonText: "#38261E", category: "#47342A", categoryBorder: "#B98560", product: "#392B29" }
      }
    },
    {
      id: "gece-yarisi", collection: "occasion", name: "31 Aralık · Gece Yarısı", night: true,
      backgroundArt: "/assets/menu-themes/occasion/gece-yarisi.webp",
      palettes: {
        light: { background: "#EEF1F7", surface: "#FFF9ED", accent: "#294365", text: "#23324D", button: "#2F496C", buttonText: "#FFF5DA", category: "#E0E8F4", categoryBorder: "#8797AD", product: "#FFF7E8" },
        dark: { background: "#151D32", surface: "#252F4B", accent: "#F5D598", text: "#FFF3DA", button: "#F5D598", buttonText: "#222943", category: "#303A58", categoryBorder: "#BCA981", product: "#273451" }
      }
    },
    {
      id: "kahve-atlasi", collection: "coffee", name: "Kahve Atlası", night: false,
      backgroundArt: "/assets/menu-themes/coffee/kahve-atlasi.webp",
      palettes: {
        light: { background: "#F1E4CE", surface: "#FFF3DC", accent: "#7E5031", text: "#3A281C", button: "#724B34", buttonText: "#FFF3DF", category: "#E7D4B5", categoryBorder: "#7E5031", product: "#FFF3DC" }
      }
    },
    {
      id: "cekirdek-bahcesi", collection: "coffee", name: "Çekirdek Bahçesi", night: false,
      backgroundArt: "/assets/menu-themes/coffee/cekirdek-bahcesi.webp",
      palettes: {
        light: { background: "#E9E9D6", surface: "#F3F2E2", accent: "#456340", text: "#283924", button: "#4E6843", buttonText: "#FAF5E6", category: "#DCE6CD", categoryBorder: "#456340", product: "#F3F2E2" }
      }
    },
    {
      id: "bakir-kavrum", collection: "coffee", name: "Bakır Kavrum", night: true,
      backgroundArt: "/assets/menu-themes/coffee/bakir-kavrum.webp",
      palettes: {
        dark: { background: "#231913", surface: "#38271D", accent: "#E0A873", text: "#FBE8CD", button: "#E0AC79", buttonText: "#2D2018", category: "#3C291D", categoryBorder: "#E0A873", product: "#38271D" }
      }
    },
    {
      id: "espresso-gecesi", collection: "coffee", name: "Espresso Gecesi", night: true,
      backgroundArt: "/assets/menu-themes/coffee/espresso-gecesi.webp",
      palettes: {
        dark: { background: "#231B27", surface: "#33243A", accent: "#E9A99E", text: "#F9EBDD", button: "#E9B2A4", buttonText: "#362731", category: "#402B43", categoryBorder: "#E9A99E", product: "#33243A" }
      }
    },
    {
      id: "yagmur-molasi", collection: "coffee", name: "Yağmur Molası", night: true,
      backgroundArt: "/assets/menu-themes/coffee/yagmur-molasi.webp",
      palettes: {
        dark: { background: "#182B34", surface: "#253D46", accent: "#AAC9CA", text: "#EEF1DF", button: "#B3CBCA", buttonText: "#233942", category: "#304550", categoryBorder: "#AAC9CA", product: "#253D46" }
      }
    },
    {
      id: "cam-demleme", collection: "coffee", name: "Cam Demleme", night: false,
      backgroundArt: "/assets/menu-themes/coffee/cam-demleme.webp",
      palettes: {
        light: { background: "#E8ECE8", surface: "#F4F7F1", accent: "#3F6470", text: "#25383B", button: "#40646B", buttonText: "#F5F7EF", category: "#D8E5E0", categoryBorder: "#3F6470", product: "#F4F7F1" }
      }
    },
    {
      id: "sirli-seramik", collection: "coffee", name: "Sırlı Seramik", night: false,
      backgroundArt: "/assets/menu-themes/coffee/sirli-seramik.webp",
      palettes: {
        light: { background: "#F0EDE1", surface: "#F9F4E6", accent: "#3D5682", text: "#26384F", button: "#3D5682", buttonText: "#FDF3E1", category: "#DCE2ED", categoryBorder: "#3D5682", product: "#F9F4E6" }
      }
    },
    {
      id: "kahve-ekspresi", collection: "coffee", name: "Kahve Ekspresi", night: true,
      backgroundArt: "/assets/menu-themes/coffee/kahve-ekspresi.webp",
      palettes: {
        dark: { background: "#2B2020", surface: "#413030", accent: "#E4C38C", text: "#F6EDDE", button: "#DFC18B", buttonText: "#392820", category: "#463636", categoryBorder: "#E4C38C", product: "#413030" }
      }
    },
    {
      id: "buzlu-kahve", collection: "coffee", name: "Buzlu Kahve", night: false,
      backgroundArt: "/assets/menu-themes/coffee/buzlu-kahve.webp",
      palettes: {
        light: { background: "#E7EDE5", surface: "#F3F7ED", accent: "#407069", text: "#263C34", button: "#426B62", buttonText: "#F4F7E9", category: "#D7E8E0", categoryBorder: "#407069", product: "#F3F7ED" }
      }
    },
    {
      id: "tahmis-hani", collection: "coffee", name: "Tahmis Hanı", night: true,
      backgroundArt: "/assets/menu-themes/coffee/tahmis-hani.webp",
      palettes: {
        dark: { background: "#25291F", surface: "#363D2F", accent: "#E2C18D", text: "#FAEBD2", button: "#DDB784", buttonText: "#332D22", category: "#414733", categoryBorder: "#E2C18D", product: "#363D2F" }
      }
    },
    {
      id: "buyucunun-kutuphanesi", collection: "fantasy", name: "Harry Potter", night: true,
      backgroundArt: "/assets/menu-themes/fantasy/buyucunun-kutuphanesi.webp",
      palettes: {
        dark: { background: "#201C32", surface: "#2E2843", accent: "#E4B772", text: "#F9EBD8", button: "#E4BC80", buttonText: "#291C32", category: "#39304C", categoryBorder: "#E4B772", product: "#2E2843" }
      }
    },
    {
      id: "orta-dunya-yolu", collection: "fantasy", name: "Yüzüklerin Efendisi", night: false,
      backgroundArt: "/assets/menu-themes/fantasy/orta-dunya-yolu.webp",
      palettes: {
        light: { background: "#EBE4CF", surface: "#F7F0DC", accent: "#486345", text: "#29392A", button: "#405B43", buttonText: "#FFF2D5", category: "#E2E4CE", categoryBorder: "#486345", product: "#F7F0DC" }
      }
    },
    {
      id: "dr-doom-taht", collection: "fantasy", name: "Dr. Doom · Zümrüt Taht", night: true,
      backgroundArt: "/assets/menu-themes/fantasy/dr-doom-taht.webp",
      palettes: {
        dark: { background: "#101D17", surface: "#1D2F25", accent: "#A9C3A5", text: "#E6EFE3", button: "#AAC3A7", buttonText: "#16261C", category: "#23372C", categoryBorder: "#9F8B5B", product: "#1D2F25" }
      }
    }
  ]);

  function getSeasonalConcept(id) {
    return SEASONAL_CONCEPTS.find((concept) => concept.id === id);
  }

  function getReadyTheme(id) {
    const concept = getSeasonalConcept(id);
    return concept?.collection === "daily" ? undefined : concept;
  }
  const BANNER_MODES = new Set(["random", "products", "images", "video"]);
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const DEFAULT_SETTINGS = deepFreeze({
    designSchemaVersion: DESIGN_SCHEMA_VERSION,
    appliedPresetId: DEFAULT_PRESET_ID,
    bgColor: "#F7EFE4",
    darkBgColor: "#140905",
    darkAccentColor: "#EFE1D0",
    darkTextColor: "#F8E9D2",
    accentColor: "#4A2414",
    textColor: "#2A130A",
    buttonTextColor: "#FFF9F0",
    buttonColor: "#4A2414",
    darkButtonColor: "#EFE1D0",
    darkButtonTextColor: "#140905",
    useThemeButtons: false,
    darkUseThemeButtons: false,
    themeMode: "custom",
    readyTheme: "",
    readyThemePlayback: "fixed",
    readyThemePool: [],
    seasonalConcept: "",
    darkSeasonalConcept: "",
    cardColor: "rgba(255,249,240,0.9)",
    productCardColor: "#FFF9F0",
    categoryCardColor: "#EFE1D0",
    socialIconColor: "#4A2414",
    socialIconSize: 30,
    menuBackgroundImage: "",
    menuBackground: {
      type: "gradient",
      image: "",
      imageUrl: "",
      gradientStart: "#F7EFE4",
      gradientEnd: "#EFE1D0",
      gradientAngle: 160,
      overlay: 0.15
    },
    darkMenuBackground: { type: "solid", gradientStart: "#140905", gradientEnd: "#2A160D", gradientAngle: 160, overlay: 0.15 },
    fonts: {
      title: BRAND_BODY_FONT,
      category: BRAND_BODY_FONT,
      product: BRAND_BODY_FONT
    },
    typography: {
      menuTitle: 36,
      categoryTitle: 24,
      productTitle: 13,
      productDesc: 10,
      productIngredients: 10,
      productPrice: 10
    },
    bottomActions: {
      popular: {
        type: "gradient",
        color: "#4A2414",
        image: "",
        imageUrl: "",
        gradientStart: "#3A1B0F",
        gradientEnd: "#5A2D1A",
        gradientAngle: 145,
        overlay: 0.12
      },
      suggest: {
        type: "gradient",
        color: "#4A2414",
        image: "",
        imageUrl: "",
        gradientStart: "#3A1B0F",
        gradientEnd: "#5A2D1A",
        gradientAngle: 145,
        overlay: 0.12
      }
    },
    banner: {
      mode: "random",
      title: "TAHMİSÇİ",
      subtitle: "Öne çıkan lezzetler",
      video: "",
      videoUrl: "",
      videos: [],
      images: [],
      productIds: []
    },
    menuUpdateDate: ""
  });

  function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;
    const result = {};
    Object.keys(value).forEach((key) => {
      if (!BLOCKED_KEYS.has(key)) result[key] = cloneValue(value[key]);
    });
    return result;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function stringValue(value, fallback, options) {
    const allowEmpty = Boolean(options && options.allowEmpty);
    const maxLength = Number(options && options.maxLength || 5000);
    if (typeof value !== "string") return String(fallback == null ? "" : fallback);
    const text = value.trim().length || allowEmpty ? value : String(fallback == null ? "" : fallback);
    return text.length <= maxLength ? text : String(fallback == null ? "" : fallback);
  }

  function finiteNumber(value, fallback, min, max) {
    if (value === "" || value === null || value === undefined || typeof value === "boolean") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizedPresetId(source) {
    const explicit = stringValue(source.appliedPresetId, "", { allowEmpty: true, maxLength: 120 }).trim();
    if (explicit) return explicit;
    const legacy = stringValue(source.designPresetVersion, "", { allowEmpty: true, maxLength: 120 }).trim();
    return LEGACY_PRESET_IDS[legacy] || DEFAULT_PRESET_ID;
  }

  function normalizeFonts(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.title = stringValue(source.title, DEFAULT_SETTINGS.fonts.title, { maxLength: 240 });
    source.category = stringValue(source.category, DEFAULT_SETTINGS.fonts.category, { maxLength: 240 });
    source.product = stringValue(source.product, DEFAULT_SETTINGS.fonts.product, { maxLength: 240 });
    return source;
  }

  function normalizeTypography(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.menuTitle = finiteNumber(source.menuTitle, DEFAULT_SETTINGS.typography.menuTitle, 18, 54);
    source.categoryTitle = finiteNumber(source.categoryTitle, DEFAULT_SETTINGS.typography.categoryTitle, 14, 34);
    source.productTitle = finiteNumber(source.productTitle, DEFAULT_SETTINGS.typography.productTitle, 10, 28);
    source.productDesc = finiteNumber(source.productDesc, DEFAULT_SETTINGS.typography.productDesc, 8, 22);
    source.productIngredients = finiteNumber(source.productIngredients, DEFAULT_SETTINGS.typography.productIngredients, 8, 22);
    source.productPrice = finiteNumber(source.productPrice, DEFAULT_SETTINGS.typography.productPrice, 8, 22);
    return source;
  }

  function normalizeStyle(value, defaults) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const fallback = isRecord(defaults) ? defaults : {};
    const image = stringValue(source.image, fallback.image || "", { allowEmpty: true });
    const imageUrl = stringValue(source.imageUrl, fallback.imageUrl || "", { allowEmpty: true });
    const fallbackType = STYLE_TYPES.has(fallback.type)
      ? fallback.type
      : (image || imageUrl ? "image" : "gradient");
    source.type = STYLE_TYPES.has(source.type) ? source.type : (image || imageUrl ? "image" : fallbackType);
    source.color = stringValue(source.color, fallback.color || "", { allowEmpty: true, maxLength: 128 });
    source.image = image;
    source.imageUrl = imageUrl;
    source.gradientStart = stringValue(
      source.gradientStart,
      fallback.gradientStart || source.color || DEFAULT_SETTINGS.productCardColor,
      { maxLength: 128 }
    );
    source.gradientEnd = stringValue(source.gradientEnd, fallback.gradientEnd || "#E5E7EB", { maxLength: 128 });
    source.gradientAngle = finiteNumber(source.gradientAngle, finiteNumber(fallback.gradientAngle, 145, -360, 360), -360, 360);
    source.overlay = finiteNumber(source.overlay, finiteNumber(fallback.overlay, 0, 0, 0.85), 0, 0.85);
    return source;
  }

  function normalizeBackground(value, settings) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const fallbackSettings = isRecord(settings) ? settings : DEFAULT_SETTINGS;
    const imageFallback = stringValue(fallbackSettings.menuBackgroundImage, "", { allowEmpty: true });
    return normalizeStyle(source, {
      type: imageFallback ? "image" : DEFAULT_SETTINGS.menuBackground.type,
      image: imageFallback,
      imageUrl: "",
      gradientStart: fallbackSettings.bgColor || DEFAULT_SETTINGS.bgColor,
      gradientEnd: fallbackSettings.darkBgColor || DEFAULT_SETTINGS.menuBackground.gradientEnd,
      gradientAngle: DEFAULT_SETTINGS.menuBackground.gradientAngle,
      overlay: DEFAULT_SETTINGS.menuBackground.overlay
    });
  }

  function normalizeBottomActions(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.popular = normalizeStyle(source.popular, DEFAULT_SETTINGS.bottomActions.popular);
    source.suggest = normalizeStyle(source.suggest, DEFAULT_SETTINGS.bottomActions.suggest);
    return source;
  }

  function normalizeMediaItem(value, index, kind) {
    if (typeof value === "string") {
      const src = value.trim();
      return src ? { id: "", src, name: `${kind === "video" ? "Video" : "Görsel"} ${index + 1}`, type: "", size: 0, kind } : null;
    }
    if (!isRecord(value)) return null;
    const source = cloneValue(value);
    const src = stringValue(source.src || source.url || source.data, "", { allowEmpty: true }).trim();
    if (!src) return null;
    source.id = stringValue(source.id, "", { allowEmpty: true, maxLength: 200 }).trim();
    source.src = src;
    source.name = stringValue(source.name, `${kind === "video" ? "Video" : "Görsel"} ${index + 1}`, { maxLength: 300 });
    source.type = stringValue(source.type, "", { allowEmpty: true, maxLength: 160 });
    source.size = finiteNumber(source.size, 0, 0, Number.MAX_SAFE_INTEGER);
    source.kind = stringValue(source.kind, kind, { maxLength: 40 });
    delete source.url;
    delete source.data;
    return source;
  }

  function normalizeMediaList(value, kind) {
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : [];
    return list.map((item, index) => normalizeMediaItem(item, index, kind)).filter(Boolean);
  }

  function normalizeBanner(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.mode = BANNER_MODES.has(source.mode) ? source.mode : DEFAULT_SETTINGS.banner.mode;
    source.title = typeof source.title === "string" ? stringValue(source.title, "", { allowEmpty: true, maxLength: 500 }) : DEFAULT_SETTINGS.banner.title;
    source.subtitle = typeof source.subtitle === "string" ? stringValue(source.subtitle, "", { allowEmpty: true, maxLength: 1000 }) : DEFAULT_SETTINGS.banner.subtitle;
    source.video = stringValue(source.video, "", { allowEmpty: true });
    source.videoUrl = stringValue(source.videoUrl, "", { allowEmpty: true });
    const legacyVideo = source.videoUrl || source.video;
    source.videos = Array.isArray(source.videos)
      ? normalizeMediaList(source.videos, "video")
      : legacyVideo ? normalizeMediaList([legacyVideo], "video") : [];
    source.images = normalizeMediaList(source.images, "image");
    source.productIds = Array.isArray(source.productIds)
      ? source.productIds.map((item) => String(item == null ? "" : item).trim()).filter(Boolean)
      : [];
    return source;
  }

  function normalizeSettings(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const appliedPresetId = normalizedPresetId(source);
    delete source.designPresetVersion;
    source.designSchemaVersion = DESIGN_SCHEMA_VERSION;
    source.appliedPresetId = appliedPresetId;
    [
      "bgColor", "darkBgColor", "darkAccentColor", "darkTextColor", "accentColor", "textColor", "buttonTextColor", "buttonColor", "darkButtonColor", "darkButtonTextColor",
      "cardColor", "productCardColor", "categoryCardColor", "socialIconColor"
    ].forEach((key) => {
      source[key] = stringValue(source[key], DEFAULT_SETTINGS[key], { maxLength: 128 });
    });
    source.socialIconSize = finiteNumber(source.socialIconSize, DEFAULT_SETTINGS.socialIconSize, 12, 72);
    source.menuBackgroundImage = stringValue(source.menuBackgroundImage, "", { allowEmpty: true });
    source.fonts = normalizeFonts(source.fonts);
    source.typography = normalizeTypography(source.typography);
    source.menuBackground = normalizeBackground(source.menuBackground, source);
    const legacyDarkBackground = source.menuBackground.type === "image" ? source.menuBackground : null;
    source.darkMenuBackground = normalizeStyle(source.darkMenuBackground ?? legacyDarkBackground, DEFAULT_SETTINGS.darkMenuBackground);
    source.useThemeButtons = source.useThemeButtons === true;
    source.darkUseThemeButtons = source.darkUseThemeButtons === true;
    const hasThemeMode = source.themeMode === "ready" || source.themeMode === "custom";
    const legacyReady = hasThemeMode ? [] : [source.darkSeasonalConcept, source.seasonalConcept];
    const readyIds = [...new Set([source.readyTheme, source.readyAlternateTheme, ...legacyReady]
      .filter((id) => getReadyTheme(id)))];
    source.readyTheme = readyIds[0] || "";
    const pool = Array.isArray(source.readyThemePool) ? source.readyThemePool : readyIds;
    source.readyThemePool = [...new Set(pool.filter((id) => getReadyTheme(id)))];
    const playback = source.readyThemePlayback;
    source.readyThemePlayback = playback === "fixed" || playback === "shuffle"
      ? playback : (source.readyThemePool.length > 1 ? "shuffle" : "fixed");
    delete source.readyAlternateTheme;
    source.themeMode = hasThemeMode ? source.themeMode : (readyIds.length || source.readyThemePool.length ? "ready" : "custom");
    source.seasonalConcept = getSeasonalConcept(source.seasonalConcept)?.collection === "daily" ? source.seasonalConcept : "";
    source.darkSeasonalConcept = getSeasonalConcept(source.darkSeasonalConcept)?.collection === "daily" ? source.darkSeasonalConcept : "";
    source.bottomActions = normalizeBottomActions(source.bottomActions);
    source.banner = normalizeBanner(source.banner);
    source.menuUpdateDate = stringValue(source.menuUpdateDate, "", { allowEmpty: true, maxLength: 160 });
    return source;
  }

  function normalizeCategoryDesign(value, index) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const legacyColor = stringValue(source.color, "", { allowEmpty: true, maxLength: 128 });
    const legacyImage = stringValue(source.image || source.imageUrl, "", { allowEmpty: true });
    const explicitStyle = isRecord(source.style) ? source.style : {};
    const categoryDefaults = {
      type: legacyImage ? "image" : (legacyColor ? "solid" : "gradient"),
      color: legacyColor,
      image: legacyImage,
      imageUrl: "",
      gradientStart: legacyColor || DEFAULT_SETTINGS.categoryCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 135,
      overlay: 0.12
    };
    source.style = normalizeStyle(explicitStyle, categoryDefaults);
    source.color = hasOwn(source, "color") && typeof source.color === "string" ? source.color : source.style.color;
    source.image = hasOwn(source, "image") && typeof source.image === "string"
      ? source.image
      : (source.style.imageUrl || source.style.image || "");
    source.products = Array.isArray(source.products)
      ? source.products.map((product, productIndex) => normalizeProductDesign(product, productIndex))
      : [];
    if (!hasOwn(source, "order")) source.order = index;
    return source;
  }

  function normalizeProductDesign(value, index) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const legacyColor = stringValue(source.cardColor, "", { allowEmpty: true, maxLength: 128 });
    const legacyImage = stringValue(source.imageUrl || source.image, "", { allowEmpty: true });
    const explicitStyle = isRecord(source.style) ? source.style : {};
    source.style = normalizeStyle(explicitStyle, {
      type: legacyImage ? "image" : (legacyColor ? "solid" : "gradient"),
      color: legacyColor,
      image: legacyImage,
      imageUrl: "",
      gradientStart: legacyColor || DEFAULT_SETTINGS.productCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 145,
      overlay: finiteNumber(source.imageOverlay, 0, 0, 0.85)
    });
    source.cardColor = hasOwn(source, "cardColor") && typeof source.cardColor === "string" ? source.cardColor : source.style.color;
    source.imageOverlay = finiteNumber(source.imageOverlay, source.style.overlay, 0, 0.85);
    source.imageAspect = ["landscape", "square", "source"].includes(source.imageAspect) ? source.imageAspect : "landscape";
    source.imageFit = source.imageFit === "cover" ? "cover" : "contain";
    if (!hasOwn(source, "order")) source.order = index;
    return source;
  }

  function normalizeMenuState(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.settings = normalizeSettings(source.settings);
    source.categories = Array.isArray(source.categories)
      ? source.categories.map((category, index) => normalizeCategoryDesign(category, index))
      : [];
    return source;
  }

  function projectStyle(value, defaults) {
    const style = normalizeStyle(value, defaults);
    return {
      type: style.type,
      color: style.color,
      image: style.image,
      imageUrl: style.imageUrl,
      gradientStart: style.gradientStart,
      gradientEnd: style.gradientEnd,
      gradientAngle: style.gradientAngle,
      overlay: style.overlay,
      ...(style.imageLayout === "right" || style.imageLayout === "cover" ? { imageLayout: style.imageLayout } : {})
    };
  }

  function projectSettings(value) {
    const settings = normalizeSettings(value);
    return {
      designSchemaVersion: settings.designSchemaVersion,
      appliedPresetId: settings.appliedPresetId,
      bgColor: settings.bgColor,
      darkBgColor: settings.darkBgColor,
      darkAccentColor: settings.darkAccentColor,
      darkTextColor: settings.darkTextColor,
      accentColor: settings.accentColor,
      textColor: settings.textColor,
      buttonTextColor: settings.buttonTextColor,
      buttonColor: settings.buttonColor,
      darkButtonColor: settings.darkButtonColor,
      darkButtonTextColor: settings.darkButtonTextColor,
      useThemeButtons: settings.useThemeButtons,
      darkUseThemeButtons: settings.darkUseThemeButtons,
      themeMode: settings.themeMode,
      readyTheme: settings.readyTheme,
      readyThemePlayback: settings.readyThemePlayback,
      readyThemePool: settings.readyThemePool,
      seasonalConcept: settings.seasonalConcept,
      darkSeasonalConcept: settings.darkSeasonalConcept,
      cardColor: settings.cardColor,
      productCardColor: settings.productCardColor,
      categoryCardColor: settings.categoryCardColor,
      socialIconColor: settings.socialIconColor,
      socialIconSize: settings.socialIconSize,
      menuBackgroundImage: settings.menuBackgroundImage,
      menuBackground: projectStyle(settings.menuBackground, DEFAULT_SETTINGS.menuBackground),
      darkMenuBackground: projectStyle(settings.darkMenuBackground, DEFAULT_SETTINGS.darkMenuBackground),
      fonts: {
        title: settings.fonts.title,
        category: settings.fonts.category,
        product: settings.fonts.product
      },
      typography: {
        menuTitle: settings.typography.menuTitle,
        categoryTitle: settings.typography.categoryTitle,
        productTitle: settings.typography.productTitle,
        productDesc: settings.typography.productDesc,
        productIngredients: settings.typography.productIngredients,
        productPrice: settings.typography.productPrice
      },
      bottomActions: {
        popular: projectStyle(settings.bottomActions.popular, DEFAULT_SETTINGS.bottomActions.popular),
        suggest: projectStyle(settings.bottomActions.suggest, DEFAULT_SETTINGS.bottomActions.suggest)
      },
      banner: {
        mode: settings.banner.mode,
        title: settings.banner.title,
        subtitle: settings.banner.subtitle,
        video: settings.banner.video,
        videoUrl: settings.banner.videoUrl,
        videos: cloneValue(settings.banner.videos),
        images: cloneValue(settings.banner.images),
        productIds: settings.banner.productIds.slice()
      },
      menuUpdateDate: settings.menuUpdateDate
    };
  }

  function designProjection(value) {
    const menu = normalizeMenuState(value);
    return {
      settings: projectSettings(menu.settings),
      categories: menu.categories.map((category) => ({
        id: String(category.id || ""),
        color: typeof category.color === "string" ? category.color : "",
        image: typeof category.image === "string" ? category.image : "",
        style: projectStyle(category.style, {
          gradientStart: menu.settings.categoryCardColor,
          gradientEnd: "#E5E7EB",
          gradientAngle: 135,
          overlay: 0.12
        }),
        products: category.products.map((product) => ({
          id: String(product.id || ""),
          cardColor: typeof product.cardColor === "string" ? product.cardColor : "",
          image: typeof product.image === "string" ? product.image : "",
          imageUrl: typeof product.imageUrl === "string" ? product.imageUrl : "",
          imageOverlay: finiteNumber(product.imageOverlay, product.style.overlay, 0, 0.85),
          imageAspect: product.imageAspect,
          imageFit: product.imageFit,
          style: projectStyle(product.style, {
            gradientStart: menu.settings.productCardColor,
            gradientEnd: "#E5E7EB",
            gradientAngle: 145,
            overlay: 0
          })
        }))
      }))
    };
  }

  function normalizeDesignSnapshot(value) {
    const source = isRecord(value) ? value : {};
    const settings = projectSettings(source.settings);
    const categoryIds = new Set();
    const productIds = new Set();
    const categoryDesign = (Array.isArray(source.categoryDesign) ? source.categoryDesign : [])
      .map((item) => {
        if (!isRecord(item)) return null;
        const id = safeDesignId(item.id);
        if (!id || categoryIds.has(id)) return null;
        categoryIds.add(id);
        return {
          id,
          color: stringValue(item.color, settings.categoryCardColor, { allowEmpty: true, maxLength: 128 }),
          style: projectStyle(item.style, {
            type: "gradient",
            color: settings.categoryCardColor,
            gradientStart: settings.categoryCardColor,
            gradientEnd: "#E5E7EB",
            gradientAngle: 135,
            overlay: 0.12
          })
        };
      })
      .filter(Boolean);
    const productDesign = (Array.isArray(source.productDesign) ? source.productDesign : [])
      .map((item) => {
        if (!isRecord(item)) return null;
        const id = safeDesignId(item.id);
        const categoryId = safeDesignId(item.categoryId);
        const identity = `${categoryId}:${id}`;
        if (!id || productIds.has(identity)) return null;
        productIds.add(identity);
        return {
          id,
          categoryId,
          cardColor: stringValue(item.cardColor, settings.productCardColor, { allowEmpty: true, maxLength: 128 }),
          imageOverlay: finiteNumber(item.imageOverlay, 0, 0, 0.85),
          imageAspect: ["landscape", "square", "source"].includes(item.imageAspect) ? item.imageAspect : "landscape",
          imageFit: item.imageFit === "cover" ? "cover" : "contain",
          style: projectStyle(item.style, {
            type: "gradient",
            color: settings.productCardColor,
            gradientStart: settings.productCardColor,
            gradientEnd: "#E5E7EB",
            gradientAngle: 145,
            overlay: 0
          })
        };
      })
      .filter(Boolean);
    return {
      schemaVersion: DESIGN_SCHEMA_VERSION,
      settings,
      categoryDesign,
      productDesign
    };
  }

  function createDesignSnapshot(value) {
    const menu = normalizeMenuState(value);
    return normalizeDesignSnapshot({
      schemaVersion: DESIGN_SCHEMA_VERSION,
      settings: menu.settings,
      categoryDesign: menu.categories.map((category) => ({
        id: category.id,
        color: category.color,
        style: category.style
      })),
      productDesign: menu.categories.flatMap((category) => category.products.map((product) => ({
        id: product.id,
        categoryId: category.id,
        cardColor: product.cardColor,
        imageOverlay: product.imageOverlay,
        imageAspect: product.imageAspect,
        imageFit: product.imageFit,
        style: product.style
      })))
    });
  }

  function createFactoryDesignSnapshot(value) {
    const menu = normalizeMenuState(value);
    return normalizeDesignSnapshot({
      schemaVersion: DESIGN_SCHEMA_VERSION,
      settings: DEFAULT_SETTINGS,
      categoryDesign: menu.categories.map((category) => ({
        id: category.id,
        color: DEFAULT_SETTINGS.categoryCardColor,
        style: {
          type: "gradient",
          color: DEFAULT_SETTINGS.categoryCardColor,
          image: "",
          imageUrl: "",
          gradientStart: DEFAULT_SETTINGS.categoryCardColor,
          gradientEnd: "#E5E7EB",
          gradientAngle: 135,
          overlay: 0.12
        }
      })),
      productDesign: menu.categories.flatMap((category) => category.products.map((product) => ({
        id: product.id,
        categoryId: category.id,
        cardColor: DEFAULT_SETTINGS.productCardColor,
        imageOverlay: 0,
        style: {
          type: "gradient",
          color: DEFAULT_SETTINGS.productCardColor,
          image: "",
          imageUrl: "",
          gradientStart: DEFAULT_SETTINGS.productCardColor,
          gradientEnd: "#E5E7EB",
          gradientAngle: 145,
          overlay: 0
        }
      })))
    });
  }

  function applyDesignSnapshot(value, snapshot) {
    const menu = normalizeMenuState(value);
    const design = normalizeDesignSnapshot(snapshot);
    const categoryById = new Map(design.categoryDesign.map((item) => [item.id, item]));
    const productByIdentity = new Map(design.productDesign.map((item) => [`${item.categoryId}:${item.id}`, item]));
    const productById = new Map(design.productDesign.map((item) => [item.id, item]));
    menu.settings = cloneValue(design.settings);
    menu.categories = menu.categories.map((category) => {
      const categoryPatch = categoryById.get(String(category.id || ""));
      if (categoryPatch) {
        category.color = categoryPatch.color;
        category.style = cloneValue(categoryPatch.style);
      }
      category.products = category.products.map((product) => {
        const productPatch = productByIdentity.get(`${String(category.id || "")}:${String(product.id || "")}`)
          || productById.get(String(product.id || ""));
        if (!productPatch) return product;
        product.cardColor = productPatch.cardColor;
        product.imageOverlay = productPatch.imageOverlay;
        product.imageAspect = productPatch.imageAspect;
        product.imageFit = productPatch.imageFit;
        product.style = cloneValue(productPatch.style);
        return product;
      });
      return category;
    });
    return menu;
  }

  function safeDesignId(value) {
    const id = stringValue(value, "", { allowEmpty: true, maxLength: 160 }).trim();
    return !id || BLOCKED_KEYS.has(id) ? "" : id;
  }

  function designSnapshotFingerprint(value) {
    return JSON.stringify(stableValue(normalizeDesignSnapshot(value)));
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isRecord(value)) return value;
    const result = {};
    Object.keys(value).sort().forEach((key) => { result[key] = stableValue(value[key]); });
    return result;
  }

  function designFingerprint(value) {
    return JSON.stringify(stableValue(designProjection(value)));
  }

  function designMatches(first, second) {
    return designFingerprint(first) === designFingerprint(second);
  }

  return Object.freeze({
    DESIGN_SCHEMA_VERSION,
    DEFAULT_PRESET_ID,
    DEFAULT_SETTINGS,
    SEASONAL_CONCEPTS,
    getSeasonalConcept,
    getReadyTheme,
    categoryArtworkForName,
    categoryArtworkForImage,
    categoryImageLayout,
    normalizeSettings,
    normalizeFonts,
    normalizeTypography,
    normalizeBackground,
    normalizeBottomActions,
    normalizeBanner,
    normalizeStyle,
    normalizeCategoryDesign,
    normalizeProductDesign,
    normalizeMenuState,
    projectSettings,
    projectStyle,
    designProjection,
    designFingerprint,
    designMatches,
    normalizeDesignSnapshot,
    createDesignSnapshot,
    createFactoryDesignSnapshot,
    applyDesignSnapshot,
    designSnapshotFingerprint,
    cloneValue
  });
});
