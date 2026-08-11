"use strict";
// Developer: Uzeyir | System Key: xandar | API validation marker

const { validatePricingCatalog, validateProductPricing } = require("./pricing");

const MAX_STATE_BYTES = 7_500_000;
const MAX_SITE_STATE_BYTES = 750_000;
const MAX_STRING_LENGTH = 500_000;
const RESOURCE_KEY_PATTERN = /(url|href|src|image|video|maps|instagram|tiktok|whatsapp)$/i;
const DESIGN_STYLE_TYPES = new Set(["solid", "gradient", "image"]);
const BANNER_MODES = new Set(["random", "products", "images", "video"]);
const DESIGN_COLOR_KEYS = [
  "bgColor", "darkBgColor", "accentColor", "textColor", "buttonTextColor",
  "cardColor", "productCardColor", "categoryCardColor", "socialIconColor"
];
const TYPOGRAPHY_LIMITS = Object.freeze({
  menuTitle: [18, 54],
  categoryTitle: [14, 34],
  productTitle: [10, 28],
  productDesc: [8, 22],
  productIngredients: [8, 22],
  productPrice: [8, 22]
});

function validatePassword(password) {
  if (password.length < 10) return "Sifre en az 10 karakter olmali.";
  if (password.length > 72) return "Sifre en fazla 72 karakter olmali.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "Sifre en az bir harf ve bir rakam icermeli.";
  }
  return "";
}

function validateMenuState(menuState) {
  if (!menuState || typeof menuState !== "object" || Array.isArray(menuState)) {
    return "menuState nesnesi gerekli.";
  }

  const safetyError = validateSafeState(menuState, "menuState", MAX_STATE_BYTES, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;

  if (!Array.isArray(menuState.categories)) {
    return "menuState.categories dizi olmali.";
  }

  if (menuState.settings !== undefined && !isRecord(menuState.settings)) {
    return "menuState.settings nesne olmali.";
  }

  const settingsError = validateDesignSettings(menuState.settings);
  if (settingsError) return settingsError;

  if (menuState.pricing !== undefined) {
    const catalogError = validatePricingCatalog(menuState.pricing);
    if (catalogError) return catalogError;
  }

  for (const category of menuState.categories) {
    if (!category || typeof category !== "object") return "Her kategori nesne olmali.";
    if (!category.id || !category.name) return "Her kategoride id ve name olmali.";
    if (!Array.isArray(category.products)) return "Her kategoride products dizisi olmali.";

    const categoryDesignError = validateCategoryDesign(category);
    if (categoryDesignError) return `${category.name}: ${categoryDesignError}`;

    for (const product of category.products) {
      if (!product || typeof product !== "object") return "Her urun nesne olmali.";
      if (!product.id || !product.name) return "Her urunde id ve name olmali.";
      const productDesignError = validateProductDesign(product);
      if (productDesignError) return `${product.name}: ${productDesignError}`;
      if (product.pricing !== undefined) {
        const pricingError = validateProductPricing(product.pricing);
        if (pricingError) return `${product.name}: ${pricingError}`;
      }
      if (product.contentMode && !["recipe", "manual", "hidden", "not-required"].includes(product.contentMode)) {
        return "Urun contentMode recipe, manual, hidden veya not-required olmali.";
      }
    }
  }

  return "";
}

function validateDesignSettings(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "menuState.settings nesne olmali.";

  if (value.designSchemaVersion !== undefined && !isDesignSchemaVersion(value.designSchemaVersion)) {
    return "designSchemaVersion pozitif tam sayi veya kontrollu surum etiketi olmali.";
  }
  for (const key of ["appliedPresetId", "designPresetVersion"]) {
    if (value[key] !== undefined && !isSafeIdentifier(value[key], 120)) return `${key} gecersiz.`;
  }
  for (const key of DESIGN_COLOR_KEYS) {
    if (value[key] !== undefined && !isSafeCssValue(value[key])) return `${key} gecersiz renk degeri tasiyor.`;
  }
  if (value.socialIconSize !== undefined && !isFiniteInRange(value.socialIconSize, 12, 72)) {
    return "socialIconSize 12 ile 72 arasinda olmali.";
  }
  if (value.menuBackgroundImage !== undefined && !isSafeMediaResource(value.menuBackgroundImage)) {
    return "menuBackgroundImage guvenli bir medya adresi olmali.";
  }
  if (value.menuUpdateDate !== undefined && !isBoundedString(value.menuUpdateDate, 160)) {
    return "menuUpdateDate metin olmali ve 160 karakteri gecmemeli.";
  }

  const fontsError = validateFonts(value.fonts);
  if (fontsError) return fontsError;
  const typographyError = validateTypography(value.typography);
  if (typographyError) return typographyError;
  const backgroundError = validateDesignStyle(value.menuBackground, "menuBackground");
  if (backgroundError) return backgroundError;

  if (value.bottomActions !== undefined) {
    if (!isRecord(value.bottomActions)) return "bottomActions nesne olmali.";
    for (const key of ["popular", "suggest"]) {
      const actionError = validateDesignStyle(value.bottomActions[key], `bottomActions.${key}`);
      if (actionError) return actionError;
    }
  }

  return validateBanner(value.banner);
}

function validateFonts(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "fonts nesne olmali.";
  for (const key of ["title", "category", "product"]) {
    if (value[key] !== undefined && !isBoundedString(value[key], 240)) return `fonts.${key} 240 karakteri gecmeyen metin olmali.`;
  }
  return "";
}

function validateTypography(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "typography nesne olmali.";
  for (const [key, limits] of Object.entries(TYPOGRAPHY_LIMITS)) {
    if (value[key] !== undefined && !isFiniteInRange(value[key], limits[0], limits[1])) {
      return `typography.${key} ${limits[0]} ile ${limits[1]} arasinda olmali.`;
    }
  }
  return "";
}

function validateCategoryDesign(category) {
  if (category.color !== undefined && !isSafeCssValue(category.color, true)) return "Kategori rengi gecersiz.";
  for (const key of ["image", "imageUrl"]) {
    if (category[key] !== undefined && !isSafeMediaResource(category[key])) return `Kategori ${key} adresi guvensiz.`;
  }
  return validateDesignStyle(category.style, "Kategori style");
}

function validateProductDesign(product) {
  if (product.cardColor !== undefined && !isSafeCssValue(product.cardColor, true)) return "Urun kart rengi gecersiz.";
  for (const key of ["image", "imageUrl", "img"]) {
    if (product[key] !== undefined && !isSafeMediaResource(product[key])) return `Urun ${key} adresi guvensiz.`;
  }
  if (product.imageOverlay !== undefined && !isFiniteInRange(product.imageOverlay, 0, 0.85)) {
    return "Urun imageOverlay 0 ile 0.85 arasinda olmali.";
  }
  return validateDesignStyle(product.style, "Urun style");
}

function validateDesignStyle(value, label) {
  if (value === undefined) return "";
  if (!isRecord(value)) return `${label} nesne olmali.`;
  if (value.type !== undefined && !DESIGN_STYLE_TYPES.has(value.type)) return `${label}.type gecersiz.`;
  for (const key of ["color", "gradientStart", "gradientEnd"]) {
    if (value[key] !== undefined && !isSafeCssValue(value[key], true)) return `${label}.${key} gecersiz.`;
  }
  for (const key of ["image", "imageUrl"]) {
    if (value[key] !== undefined && !isSafeMediaResource(value[key])) return `${label}.${key} guvenli bir medya adresi olmali.`;
  }
  if (value.gradientAngle !== undefined && !isFiniteInRange(value.gradientAngle, -360, 360)) {
    return `${label}.gradientAngle -360 ile 360 arasinda olmali.`;
  }
  if (value.overlay !== undefined && !isFiniteInRange(value.overlay, 0, 0.85)) {
    return `${label}.overlay 0 ile 0.85 arasinda olmali.`;
  }
  return "";
}

function validateBanner(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "banner nesne olmali.";
  if (value.mode !== undefined && !BANNER_MODES.has(value.mode)) return "banner.mode gecersiz.";
  if (value.title !== undefined && !isBoundedString(value.title, 500)) return "banner.title 500 karakteri gecmeyen metin olmali.";
  if (value.subtitle !== undefined && !isBoundedString(value.subtitle, 1000)) return "banner.subtitle 1000 karakteri gecmeyen metin olmali.";
  for (const key of ["video", "videoUrl"]) {
    if (value[key] !== undefined && !isSafeMediaResource(value[key])) return `banner.${key} guvenli bir medya adresi olmali.`;
  }
  for (const [key, kind] of [["videos", "video"], ["images", "image"]]) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key])) return `banner.${key} dizi olmali.`;
    if (value[key].length > 100) return `banner.${key} en fazla 100 oge icerebilir.`;
    for (let index = 0; index < value[key].length; index += 1) {
      const mediaError = validateMediaItem(value[key][index], `banner.${key}[${index}]`, kind);
      if (mediaError) return mediaError;
    }
  }
  if (value.productIds !== undefined) {
    if (!Array.isArray(value.productIds)) return "banner.productIds dizi olmali.";
    if (value.productIds.length > 500) return "banner.productIds en fazla 500 oge icerebilir.";
    if (value.productIds.some((item) => !isBoundedString(item, 200) || !String(item).trim())) {
      return "banner.productIds degerleri 200 karakteri gecmeyen metin olmali.";
    }
  }
  return "";
}

function validateMediaItem(value, label, kind) {
  if (typeof value === "string") return isSafeMediaResource(value) ? "" : `${label} guvensiz medya adresi tasiyor.`;
  if (!isRecord(value)) return `${label} metin veya nesne olmali.`;
  const source = value.src ?? value.url ?? value.data;
  if (typeof source !== "string" || !source.trim() || !isSafeMediaResource(source)) {
    return `${label} guvenli bir ${kind} adresi icermeli.`;
  }
  if (value.id !== undefined && !isBoundedString(value.id, 200)) return `${label}.id gecersiz.`;
  if (value.name !== undefined && !isBoundedString(value.name, 300)) return `${label}.name gecersiz.`;
  if (value.type !== undefined && !isBoundedString(value.type, 160)) return `${label}.type gecersiz.`;
  if (value.kind !== undefined && !isBoundedString(value.kind, 40)) return `${label}.kind gecersiz.`;
  if (value.size !== undefined && !isFiniteInRange(value.size, 0, Number.MAX_SAFE_INTEGER)) return `${label}.size gecersiz.`;
  return "";
}

function validateRecipeState(recipeState) {
  if (!recipeState || typeof recipeState !== "object" || Array.isArray(recipeState)) {
    return "recipeState nesnesi gerekli.";
  }

  const safetyError = validateSafeState(recipeState, "recipeState", MAX_STATE_BYTES, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;

  for (const [categoryName, products] of Object.entries(recipeState)) {
    if (!categoryName || typeof products !== "object" || Array.isArray(products) || products === null) {
      return "Her recete kategorisi urun nesnesi icermeli.";
    }

    for (const [productName, sizes] of Object.entries(products)) {
      if (!productName || typeof sizes !== "object" || Array.isArray(sizes) || sizes === null) {
        return "Her recete urunu olcu nesnesi icermeli.";
      }

      for (const [sizeName, recipe] of Object.entries(sizes)) {
        if (!sizeName) return "Her recete olcusunun adi olmali.";
        if (!isRecipeText(recipe)) return "Recete metni string veya { content, preparation } nesnesi olmali.";
      }
    }
  }

  return "";
}

function isRecipeText(recipe) {
  if (typeof recipe === "string") return true;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return false;
  const stringFields = new Set([
    "content", "preparation", "recipe", "ingredients", "method", "steps", "description", "note", "productNote",
    "id", "sourceType", "sourceWorkbook", "sourceSheet", "sourceNormalizedName", "statusSource", "lastImportOperationId",
    "importKey", "externalId", "productCode"
  ]);
  const nullableStringFields = new Set(["lastImportedAt"]);
  const booleanFields = new Set(["active", "manualActive", "sourcePresent"]);
  const numberFields = new Set(["order"]);
  return Object.entries(recipe).every(([key, value]) => (
    (stringFields.has(key) && typeof value === "string")
    || (nullableStringFields.has(key) && (value === null || typeof value === "string"))
    || (key === "aliasIds" && Array.isArray(value) && value.length <= 100 && value.every((item) => isBoundedString(item, 200)))
    || (key === "productCodeAliases" && Array.isArray(value) && value.length <= 100 && value.every((item) => isBoundedString(item, 120)))
    || (key === "nameHistory" && Array.isArray(value) && value.length <= 100 && value.every((item) => isBoundedString(item, 240)))
    || (booleanFields.has(key) && typeof value === "boolean")
    || (numberFields.has(key) && Number.isFinite(Number(value)))
  ));
}

function validateSiteState(siteState) {
  if (!siteState || typeof siteState !== "object" || Array.isArray(siteState)) {
    return "siteState nesnesi gerekli.";
  }

  const safetyError = validateSafeState(siteState, "siteState", MAX_SITE_STATE_BYTES, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;

  if (siteState.schemaVersion !== undefined && (!Number.isInteger(siteState.schemaVersion) || siteState.schemaVersion < 1)) {
    return "siteState.schemaVersion pozitif tam sayi olmali.";
  }
  if (siteState.sectionOrder !== undefined && !Array.isArray(siteState.sectionOrder)) {
    return "siteState.sectionOrder dizi olmali.";
  }
  for (const key of ["global", "features", "branding", "watermark", "motion", "header", "hero", "featuredProducts", "menuSection", "about", "qrMenu", "contact", "footer", "seo", "mudavim"]) {
    if (siteState[key] !== undefined && (!siteState[key] || typeof siteState[key] !== "object" || Array.isArray(siteState[key]))) {
      return `siteState.${key} nesne olmali.`;
    }
  }
  if (siteState.features?.customerAccountsEnabled !== undefined && typeof siteState.features.customerAccountsEnabled !== "boolean") {
    return "siteState.features.customerAccountsEnabled boolean olmali.";
  }
  if (siteState.features?.orderingEnabled !== undefined && typeof siteState.features.orderingEnabled !== "boolean") {
    return "siteState.features.orderingEnabled boolean olmali.";
  }
  if (siteState.watermark?.enabled !== undefined && typeof siteState.watermark.enabled !== "boolean") {
    return "siteState.watermark.enabled boolean olmali.";
  }
  for (const [path, value, min, max] of [
    ["watermark.opacity", siteState.watermark?.opacity, 0, 0.2],
    ["watermark.size", siteState.watermark?.size, 24, 120],
    ["watermark.x", siteState.watermark?.x, 0, 100],
    ["watermark.y", siteState.watermark?.y, 0, 100]
  ]) {
    if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max)) {
      return `siteState.${path} ${min} ile ${max} arasinda sayi olmali.`;
    }
  }
  if (siteState.motion?.preset !== undefined && !["off", "simple", "balanced", "cinematic"].includes(String(siteState.motion.preset))) {
    return "siteState.motion.preset off, simple, balanced veya cinematic olmali.";
  }

  const hero = siteState.hero || {};
  if (hero.mediaType !== undefined && !["image", "video"].includes(hero.mediaType)) {
    return "siteState.hero.mediaType image veya video olmali.";
  }
  if (hero.overlay !== undefined && (!Number.isFinite(hero.overlay) || hero.overlay < 0 || hero.overlay > 0.85)) {
    return "siteState.hero.overlay 0 ile 0.85 arasinda sayi olmali.";
  }
  if (hero.autoplayInterval !== undefined && (!Number.isInteger(hero.autoplayInterval) || hero.autoplayInterval < 2000)) {
    return "siteState.hero.autoplayInterval en az 2000 olan tam sayi olmali.";
  }
  for (const [path, value] of [
    ["header.visible", siteState.header?.visible],
    ["header.contactVisible", siteState.header?.contactVisible],
    ["hero.visible", hero.visible],
    ["hero.autoplay", hero.autoplay],
    ["hero.sliderEnabled", hero.sliderEnabled],
    ["featuredProducts.visible", siteState.featuredProducts?.visible],
    ["menuSection.visible", siteState.menuSection?.visible],
    ["about.visible", siteState.about?.visible],
    ["qrMenu.visible", siteState.qrMenu?.visible],
    ["contact.visible", siteState.contact?.visible],
    ["footer.visible", siteState.footer?.visible]
  ]) {
    if (value !== undefined && typeof value !== "boolean") return `siteState.${path} boolean olmali.`;
  }
  const navigation = siteState.header?.navigation;
  if (navigation !== undefined) {
    if (!Array.isArray(navigation)) return "siteState.header.navigation dizi olmali.";
    for (const item of navigation) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "Her header navigation kaydi nesne olmali.";
      if (item.visible !== undefined && typeof item.visible !== "boolean") return "Header navigation visible boolean olmali.";
      if (item.order !== undefined && !Number.isFinite(Number(item.order))) return "Header navigation sirasi sayi olmali.";
    }
  }
  const announcements = siteState.mudavim?.announcements;
  if (announcements !== undefined) {
    if (!Array.isArray(announcements)) return "siteState.mudavim.announcements dizi olmali.";
    if (announcements.length > 50) return "En fazla 50 Mudavim duyurusu kaydedilebilir.";
    const announcementIds = new Set();
    for (const announcement of announcements) {
      if (!announcement || typeof announcement !== "object" || Array.isArray(announcement)) return "Her Mudavim duyurusu nesne olmali.";
      if (!announcement.id || announcementIds.has(announcement.id)) return "Mudavim duyuru kimlikleri dolu ve benzersiz olmali.";
      announcementIds.add(announcement.id);
      if (announcement.isPublished !== undefined && typeof announcement.isPublished !== "boolean") return "Mudavim duyuru yayın durumu boolean olmali.";
      if (announcement.order !== undefined && !Number.isFinite(Number(announcement.order))) return "Mudavim duyuru sirasi sayi olmali.";
      if (!Array.isArray(announcement.blocks)) return "Mudavim duyuru bloklari dizi olmali.";
      if (announcement.blocks.length > 60) return "Bir Mudavim duyurusunda en fazla 60 blok olabilir.";
      const blockIds = new Set();
      for (const block of announcement.blocks) {
        if (!block || typeof block !== "object" || Array.isArray(block)) return "Her Mudavim duyuru blogu nesne olmali.";
        if (!block.id || blockIds.has(block.id)) return "Mudavim duyuru blok kimlikleri dolu ve benzersiz olmali.";
        blockIds.add(block.id);
        if (!["text", "image", "image-text", "text-image"].includes(block.type)) return "Mudavim duyuru blok tipi gecersiz.";
        if (block.order !== undefined && !Number.isFinite(Number(block.order))) return "Mudavim duyuru blok sirasi sayi olmali.";
        const hasText = block.type !== "image";
        const hasImage = block.type !== "text";
        if (hasText && block.body !== undefined && typeof block.body !== "string") return "Duyuru blogunda body metin olmali.";
        if (hasText && block.heading !== undefined && typeof block.heading !== "string") return "Duyuru blogunda heading metin olmali.";
        if (hasText && block.badge !== undefined && typeof block.badge !== "string") return "Duyuru blogunda badge metin olmali.";
        if (hasText && block.date !== undefined && typeof block.date !== "string") return "Duyuru blogunda date metin olmali.";
        if (block.type === "text" && block.body === undefined && typeof block.content !== "string") return "Metin blogunda body veya content metin olmali.";
        if (hasImage && typeof block.imageUrl !== "string") return "Gorsel blogunda imageUrl metin olmali.";
      }
    }
  }
  for (const slide of Array.isArray(hero.slides) ? hero.slides : []) {
    if (slide.order !== undefined && !Number.isFinite(slide.order)) return "Hero slayt sirasi sayi olmali.";
    if (slide.visible !== undefined && typeof slide.visible !== "boolean") return "Hero slayt aktifligi boolean olmali.";
  }

  return "";
}

function validateRecipeCatalog(recipeCatalog, recipeState) {
  if (!Array.isArray(recipeCatalog)) return "recipeCatalog dizi olmali.";
  const ids = new Set();
  for (const record of recipeCatalog) {
    if (!record || typeof record !== "object" || !record.id || !record.category || !record.product) {
      return "Her recipeCatalog kaydinda id, category ve product olmali.";
    }
    if (ids.has(record.id)) return "recipeCatalog kimlikleri benzersiz olmali.";
    ids.add(record.id);
    if (!recipeState?.[record.category]?.[record.product]) {
      return `recipeCatalog kaydi bulunamayan receteye isaret ediyor: ${record.id}`;
    }
  }
  return validateSafeState(recipeCatalog, "recipeCatalog", 1_000_000, { allowEmbeddedMedia: false });
}

function validateSafeState(value, label, maxBytes = MAX_STATE_BYTES, options = {}) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) return `${label} cok buyuk.`;

  const stack = [{ key: label, path: label, value }];
  while (stack.length) {
    const current = stack.pop();
    const currentValue = current.value;

    if (typeof currentValue === "string") {
      if (currentValue.length > MAX_STRING_LENGTH && !isLargeDataResource(currentValue)) {
        return `${current.path} metni cok uzun.`;
      }

      if (hasUnsafeMarkup(currentValue)) {
        return `${current.path} guvensiz script icerigi tasiyor.`;
      }

      if (!options.allowEmbeddedMedia && /^data:(?:image|video)\//i.test(currentValue)) {
        return `${current.path} gomulu medya iceremez; /media yolu kullanin.`;
      }

      if (RESOURCE_KEY_PATTERN.test(current.key) && !isSafeResource(currentValue)) {
        return `${current.path} guvenli olmayan kaynak adresi iceriyor.`;
      }
      continue;
    }

    if (!currentValue || typeof currentValue !== "object") continue;

    if (Array.isArray(currentValue)) {
      currentValue.forEach((item, index) => {
        stack.push({ key: String(index), path: `${current.path}[${index}]`, value: item });
      });
      continue;
    }

    for (const [key, item] of Object.entries(currentValue)) {
      stack.push({ key, path: `${current.path}.${key}`, value: item });
    }
  }

  return "";
}

function hasUnsafeMarkup(value) {
  return /<\s*\/?\s*[a-z][^>]*>|on[a-z]+\s*=|javascript:/i.test(value);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBoundedString(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength;
}

function isSafeIdentifier(value, maxLength) {
  return isBoundedString(value, maxLength) && /^[a-z0-9][a-z0-9._:-]*$/i.test(value);
}

function isDesignSchemaVersion(value) {
  if (Number.isSafeInteger(value)) return value >= 1;
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,39}$/i.test(value);
}

function isFiniteInRange(value, minimum, maximum) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function isSafeCssValue(value, allowEmpty = false) {
  if (typeof value !== "string" || value.length > 128) return false;
  const text = value.trim();
  if (!text) return allowEmpty;
  return !/[;{}<>\u0000-\u001f]/.test(text)
    && !/(?:url|expression)\s*\(|javascript:/i.test(text);
}

function isSafeResource(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/[<>"'\\]/.test(text)) return false;
  if (/^media:[a-z0-9._-]+$/i.test(text)) return true;
  if (/^data:/i.test(text)) return false;

  try {
    const url = new URL(text, "https://tahmiscicoffee.local/");
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch (_error) {
    return false;
  }
}

function isSafeMediaResource(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/[<>"'\\\u0000-\u001f]/.test(text) || /^(?:data|blob|javascript):/i.test(text)) return false;
  if (/^media:[a-z0-9._-]+$/i.test(text)) return true;

  try {
    const url = new URL(text, "https://tahmiscicoffee.local/");
    return ["http:", "https:"].includes(url.protocol);
  } catch (_error) {
    return false;
  }
}

function isLargeDataResource(value) {
  return /^data:(?:image\/(?:png|jpe?g|gif|webp)|video\/[a-z0-9.+-]+);base64,/i.test(String(value || ""));
}

module.exports = {
  validateMenuState,
  validateDesignSettings,
  validateCategoryDesign,
  validateProductDesign,
  validatePricingCatalog,
  validateProductPricing,
  validateRecipeCatalog,
  validateRecipeState,
  validateSiteState,
  validatePassword,
  validateSafeState,
  isSafeResource,
  isSafeMediaResource
};
