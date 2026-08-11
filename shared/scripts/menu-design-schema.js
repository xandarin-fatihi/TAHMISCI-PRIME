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
  const BANNER_MODES = new Set(["random", "products", "images", "video"]);
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const DEFAULT_SETTINGS = deepFreeze({
    designSchemaVersion: DESIGN_SCHEMA_VERSION,
    appliedPresetId: DEFAULT_PRESET_ID,
    bgColor: "#F7EFE4",
    darkBgColor: "#140905",
    accentColor: "#4A2414",
    textColor: "#2A130A",
    buttonTextColor: "#FFF9F0",
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
      "bgColor", "darkBgColor", "accentColor", "textColor", "buttonTextColor",
      "cardColor", "productCardColor", "categoryCardColor", "socialIconColor"
    ].forEach((key) => {
      source[key] = stringValue(source[key], DEFAULT_SETTINGS[key], { maxLength: 128 });
    });
    source.socialIconSize = finiteNumber(source.socialIconSize, DEFAULT_SETTINGS.socialIconSize, 12, 72);
    source.menuBackgroundImage = stringValue(source.menuBackgroundImage, "", { allowEmpty: true });
    source.fonts = normalizeFonts(source.fonts);
    source.typography = normalizeTypography(source.typography);
    source.menuBackground = normalizeBackground(source.menuBackground, source);
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
      overlay: style.overlay
    };
  }

  function projectSettings(value) {
    const settings = normalizeSettings(value);
    return {
      designSchemaVersion: settings.designSchemaVersion,
      appliedPresetId: settings.appliedPresetId,
      bgColor: settings.bgColor,
      darkBgColor: settings.darkBgColor,
      accentColor: settings.accentColor,
      textColor: settings.textColor,
      buttonTextColor: settings.buttonTextColor,
      cardColor: settings.cardColor,
      productCardColor: settings.productCardColor,
      categoryCardColor: settings.categoryCardColor,
      socialIconColor: settings.socialIconColor,
      socialIconSize: settings.socialIconSize,
      menuBackgroundImage: settings.menuBackgroundImage,
      menuBackground: projectStyle(settings.menuBackground, DEFAULT_SETTINGS.menuBackground),
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
