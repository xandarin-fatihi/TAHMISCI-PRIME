"use strict";

const crypto = require("crypto");
const { chooseRecipeSize, normalizeRecipeItem } = require("./store/migrations");
const {
  normalizePricingCatalog,
  normalizeProductPricing,
  pricingOptionsForProduct,
  withLegacyPricing
} = require("./pricing");
const { migrateSiteState } = require("./site-state");
const { isSafeMediaResource } = require("./validators");
const categoryIcons = require("../../../shared/scripts/category-icons");
const menuDesignSchema = require("../../../shared/scripts/menu-design-schema");

const BRAND_PLACEHOLDER_IMAGE = "/assets/brand/logo-large.png";
const DEFAULT_CATEGORY_IMAGES = Object.freeze({
  cold: "/assets/images/hero/tahmisci-cold-drinks-front.jpg",
  hot: "/assets/images/hero/tahmisci-barista-detail.jpg",
  turkishCoffee: "/assets/images/hero/tahmisci-barista-main.jpg",
  dessert: "/assets/images/products/product-10.jpg",
  beverage: "/assets/images/hero/tahmisci-cold-drinks-top.jpg",
  counter: "/assets/images/products/product-8.jpg",
  packaged: "/assets/images/products/product-5.jpg",
  coffee: "/assets/images/hero/tahmisci-barista-main.jpg",
  food: "/assets/images/products/product-10.jpg",
  default: BRAND_PLACEHOLDER_IMAGE
});

function buildPublicBootstrap(storeData) {
  const data = storeData && typeof storeData === "object" ? storeData : {};
  // Normalization returns a defensive clone; public reads never mutate the canonical store.
  const menuState = menuDesignSchema.normalizeMenuState(data.menuState);
  const recipeCatalog = Array.isArray(data.recipeCatalog) ? data.recipeCatalog : [];
  const catalogById = new Map(recipeCatalog.map((record) => [record.id, record]));
  const menuSettings = menuState.settings;
  const siteState = migrateSiteState(data.siteState);
  siteState.mudavim = publicMudavim(siteState.mudavim);
  const hiddenCategoryIds = new Set(siteState.menuSection?.hiddenCategoryIds || []);
  const pricing = normalizePricingCatalog(data.pricing);

  const categories = (menuState.categories || [])
    .filter((category) => category && category.active !== false && !hiddenCategoryIds.has(category.id))
    .sort(byOrder)
    .map((category) => {
      const iconKey = categoryIconKey(category);
      const categoryImage = categoryDefaultImage(category, iconKey);
      const products = (category.products || [])
        .filter((product) => product && product.active !== false)
        .filter((product) => siteState.menuSection?.soldOutMode !== "hide" || !isSoldOut(product))
        .sort(byOrder)
        .map((product) => publicProduct(product, category, data.recipeState || {}, catalogById, categoryImage, pricing));
      return {
        id: String(category.id),
        name: String(category.name || ""),
        order: numberOr(category.order, 0),
        iconKey,
        icon: categoryIcons.getIconClass(iconKey),
        iconMark: categoryIcons.getIcon(iconKey).mark,
        image: categoryImage,
        color: safeCssValue(category.color),
        style: publicStyle(category.style),
        productCount: products.length,
        products
      };
    });

  const products = categories.flatMap((category) => category.products);
  const timestamps = [
    data.menuUpdatedAt,
    data.pricingUpdatedAt,
    data.recipeUpdatedAt,
    data.siteUpdatedAt,
    data.publishUpdatedAt
  ].filter(Boolean).sort();
  const updatedAt = timestamps[timestamps.length - 1] || null;
  const revisions = publicRevisions(data.revisions);
  const versionSource = JSON.stringify({
    updatedAt,
    revisions,
    siteState,
    pricing,
    categories
  });

  return {
    schemaVersion: 2,
    version: crypto.createHash("sha256").update(versionSource).digest("hex").slice(0, 16),
    revision: revisions.publish,
    publishRevision: revisions.publish,
    pricingRevision: revisions.pricing,
    catalogRevision: revisions.catalog,
    revisions,
    updatedAt,
    siteState,
    pricing,
    menu: {
      settings: publicMenuSettings(menuSettings),
      pricing,
      categoryCount: categories.length,
      productCount: products.length,
      categories,
      products
    }
  };
}

function publicMudavim(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    announcements: (Array.isArray(source.announcements) ? source.announcements : [])
      .filter((item) => item && item.isPublished === true)
      .sort(byOrder)
      .map((item) => ({
        id: String(item.id || ""),
        title: String(item.title || "Duyuru"),
        slug: String(item.slug || ""),
        order: numberOr(item.order, 0),
        blocks: (Array.isArray(item.blocks) ? item.blocks : [])
          .sort(byOrder)
          .map((block) => {
            const allowedTypes = ["text", "image", "image-text", "text-image"];
            const type = allowedTypes.includes(block?.type) ? block.type : "text";
            const hasText = type !== "image";
            const hasImage = type !== "text";
            return {
              id: String(block?.id || ""),
              type,
              badge: hasText ? String(block?.badge || "") : "",
              date: hasText ? String(block?.date || "") : "",
              heading: hasText ? String(block?.heading || "") : "",
              body: hasText ? String(block?.body ?? block?.content ?? "") : "",
              imageUrl: hasImage ? String(block?.imageUrl || "") : "",
              alt: hasImage ? String(block?.alt || block?.heading || item.title || "Duyuru görseli") : "",
              order: numberOr(block?.order, 0)
            };
          })
          .filter((block) => {
            const hasText = Boolean(block.heading.trim() || block.body.trim() || block.badge.trim() || block.date.trim());
            const hasImage = Boolean(block.imageUrl.trim());
            return block.type === "text" ? hasText : block.type === "image" ? hasImage : hasText || hasImage;
          })
      }))
  };
}

function publicProduct(product, category, recipeState, catalogById, categoryImage, pricingCatalog) {
  const content = resolvePublicContent(product, recipeState, catalogById);
  const productPricing = normalizeProductPricing(product.pricing);
  const priceOptions = pricingOptionsForProduct({ pricing: productPricing }, pricingCatalog);
  const synchronized = product && product.pricing && product.pricing.typeId
    ? withLegacyPricing({ ...product, pricing: productPricing }, pricingCatalog)
    : product;
  const variants = priceOptions.length
    ? priceOptions.map((option) => ({ id: option.id, name: option.label, label: option.label, unit: option.unit, price: option.price }))
    : normalizeVariants(synchronized);
  const prices = normalizePrices(synchronized && synchronized.prices);
  const basePrice = firstPrice(priceOptions, prices, variants);
  const image = productDefaultImage(product, categoryImage);
  return {
    id: String(product.id),
    productCode: String(product.productCode || ""),
    categoryId: String(category.id),
    categoryName: String(category.name || ""),
    name: String(product.name || ""),
    description: String(product.desc || product.description || ""),
    image: image.src,
    imageUrl: resource(product.imageUrl),
    imageSource: image.source,
    image_source: image.source,
    imageOverlay: numberOr(product.imageOverlay, 0),
    cardColor: safeCssValue(product.cardColor),
    style: publicStyle(product.style),
    pricing: productPricing,
    priceOptions,
    priceMode: String(synchronized && synchronized.priceMode || product.priceMode || "standard"),
    prices,
    variants,
    basePrice,
    priceLabel: priceLabel(priceOptions, prices, variants),
    calories: String(product.details?.calories ?? product.calories ?? ""),
    caloriesText: String(product.details?.calories ?? product.calories ?? ""),
    caloriesValue: calorieNumber(product.details?.calories ?? product.calories ?? ""),
    caloriesUnit: calorieUnit(product.details?.calories ?? product.calories ?? ""),
    allergens: String(product.details?.allergens ?? product.allergens ?? ""),
    ingredients: String(product.details?.ingredients ?? product.ingredients ?? content ?? ""),
    content,
    popular: Boolean(product.popular),
    stock: isSoldOut(product) ? "sold-out" : "active",
    kind: String(product.kind || ""),
    temperature: String(product.temperature || ""),
    order: numberOr(product.order, 0)
  };
}

function resolvePublicContent(product, recipeState, catalogById) {
  const mode = ["recipe", "manual", "hidden", "not-required"].includes(product.contentMode)
    ? product.contentMode
    : (product.recipeId ? "recipe" : (product.manualContent || product.details?.ingredients ? "manual" : "hidden"));
  if (mode === "hidden" || mode === "not-required") return "";
  const manual = String(product.manualContent ?? product.details?.ingredients ?? product.ingredients ?? "").trim();
  if (mode === "manual") return manual;

  const record = catalogById.get(product.recipeId);
  if (!record) return manual;
  const sizes = recipeState?.[record.category]?.[record.product];
  if (!sizes || typeof sizes !== "object") return manual;
  const sizeName = chooseRecipeSize(recipeState, record, product.recipeSize);
  const recipe = normalizeRecipeItem(sizes[sizeName]);
  if (recipe && typeof recipe === "object" && recipe.active === false) return manual;
  const content = typeof recipe === "string" ? recipe : recipe?.content;
  return String(content || manual || "").trim();
}

function categoryIconKey(category) {
  const explicit = String(category.iconKey || "").trim();
  if (explicit && categoryIcons.ICONS[explicit]) return explicit;
  const legacy = String(category.icon || "").trim();
  if (legacy && categoryIcons.ICONS[legacy]) return legacy;
  return categoryIcons.inferIconKey(category.name);
}

function categoryDefaultImage(category, iconKey) {
  return resource(category.imageUrl || category.image || category.style?.imageUrl || category.style?.image)
    || DEFAULT_CATEGORY_IMAGES[iconKey]
    || DEFAULT_CATEGORY_IMAGES.default;
}

function productDefaultImage(product, categoryImage) {
  const explicit = resource(product.imageUrl || product.image || product.img);
  if (explicit) return { src: explicit, source: "product" };
  if (categoryImage) return { src: categoryImage, source: "category" };
  return { src: BRAND_PLACEHOLDER_IMAGE, source: "brand-placeholder" };
}

function publicMenuSettings(settings) {
  const projected = menuDesignSchema.projectSettings(settings);
  return {
    designSchemaVersion: projected.designSchemaVersion,
    appliedPresetId: boundedString(projected.appliedPresetId, 120),
    bgColor: safeCssValue(projected.bgColor),
    darkBgColor: safeCssValue(projected.darkBgColor),
    accentColor: safeCssValue(projected.accentColor),
    textColor: safeCssValue(projected.textColor),
    buttonTextColor: safeCssValue(projected.buttonTextColor),
    cardColor: safeCssValue(projected.cardColor),
    productCardColor: safeCssValue(projected.productCardColor),
    categoryCardColor: safeCssValue(projected.categoryCardColor),
    socialIconColor: safeCssValue(projected.socialIconColor),
    socialIconSize: numberOr(projected.socialIconSize, 30),
    menuBackgroundImage: resource(projected.menuBackgroundImage),
    menuBackground: publicStyle(projected.menuBackground),
    fonts: {
      title: boundedString(projected.fonts?.title, 240),
      category: boundedString(projected.fonts?.category, 240),
      product: boundedString(projected.fonts?.product, 240)
    },
    typography: {
      menuTitle: numberOr(projected.typography?.menuTitle, 36),
      categoryTitle: numberOr(projected.typography?.categoryTitle, 24),
      productTitle: numberOr(projected.typography?.productTitle, 13),
      productDesc: numberOr(projected.typography?.productDesc, 10),
      productIngredients: numberOr(projected.typography?.productIngredients, 10),
      productPrice: numberOr(projected.typography?.productPrice, 10)
    },
    bottomActions: {
      popular: publicStyle(projected.bottomActions?.popular),
      suggest: publicStyle(projected.bottomActions?.suggest)
    },
    banner: publicBanner(projected.banner),
    menuUpdateDate: boundedString(projected.menuUpdateDate, 160)
  };
}

function publicStyle(value) {
  const style = menuDesignSchema.projectStyle(value);
  return {
    type: ["solid", "gradient", "image"].includes(style.type) ? style.type : "gradient",
    color: safeCssValue(style.color),
    image: resource(style.image),
    imageUrl: resource(style.imageUrl),
    gradientStart: safeCssValue(style.gradientStart),
    gradientEnd: safeCssValue(style.gradientEnd),
    gradientAngle: numberOr(style.gradientAngle, 145),
    overlay: numberOr(style.overlay, 0)
  };
}

function publicBanner(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: ["random", "products", "images", "video"].includes(source.mode) ? source.mode : "random",
    title: boundedString(source.title, 500),
    subtitle: boundedString(source.subtitle, 1000),
    video: resource(source.video),
    videoUrl: resource(source.videoUrl),
    videos: publicMediaList(source.videos, "video"),
    images: publicMediaList(source.images, "image"),
    productIds: (Array.isArray(source.productIds) ? source.productIds : [])
      .map((item) => boundedString(item, 200).trim())
      .filter(Boolean)
  };
}

function publicMediaList(value, kind) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const src = resource(typeof item === "string" ? item : source.src || source.url || source.data);
    if (!src) return null;
    return {
      id: boundedString(source.id, 200),
      src,
      name: boundedString(source.name || `${kind === "video" ? "Video" : "Görsel"} ${index + 1}`, 300),
      type: boundedString(source.type, 160),
      size: Math.max(0, numberOr(source.size, 0)),
      kind
    };
  }).filter(Boolean);
}

function normalizeVariants(product) {
  if (!Array.isArray(product.variants)) return [];
  return product.variants
    .map((variant) => ({
      name: String(variant?.name || "").trim(),
      price: numberOr(variant?.price, null)
    }))
    .filter((variant) => variant.name || variant.price !== null);
}

function normalizePrices(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, item] of Object.entries(source)) {
    const number = numberOr(item, null);
    if (number !== null) result[key] = number;
  }
  return result;
}

function firstPrice(priceOptions, prices, variants) {
  const canonical = (Array.isArray(priceOptions) ? priceOptions : [])
    .map((option) => publicPriceNumber(option && option.price))
    .find((value) => value !== null);
  if (canonical !== undefined) return canonical;
  const fallback = [...Object.values(prices || {}), ...(variants || []).map((variant) => variant.price)]
    .map(publicPriceNumber)
    .find((value) => value !== null);
  return fallback === undefined ? 0 : fallback;
}

function priceLabel(priceOptions, prices, variants) {
  const canonical = (Array.isArray(priceOptions) ? priceOptions : [])
    .map((option) => publicPriceNumber(option && option.price))
    .filter((value) => value !== null);
  const values = (canonical.length
    ? canonical
    : [...Object.values(prices || {}), ...(variants || []).map((variant) => variant.price)]
      .map(publicPriceNumber)
      .filter((value) => value !== null))
    .sort((first, second) => first - second);
  if (!values.length) return "";
  const format = (value) => `₺${Number(value).toLocaleString("tr-TR")}`;
  return values[0] === values[values.length - 1] ? format(values[0]) : `${format(values[0])} - ${format(values[values.length - 1])}`;
}

function publicPriceNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function publicRevisions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    publish: nonNegativeInteger(source.publish),
    pricing: nonNegativeInteger(source.pricing),
    catalog: nonNegativeInteger(source.dataImportCatalog),
    dataImport: nonNegativeInteger(source.dataImport)
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function calorieNumber(value) {
  const match = String(value || "").match(/[\d.,]+/);
  if (!match) return null;
  const number = Number(match[0].replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function calorieUnit(value) {
  const unit = String(value || "").replace(/[\d.,~\s]/g, "").trim();
  return unit || "";
}

function resource(value) {
  const text = String(value || "").trim();
  return text && isSafeMediaResource(text) ? text : "";
}

function safeCssValue(value) {
  const text = boundedString(value, 128).trim();
  if (!text || /[;{}<>\u0000-\u001f]/.test(text) || /(?:url|expression)\s*\(|javascript:/i.test(text)) return "";
  return text;
}

function boundedString(value, maxLength) {
  const text = typeof value === "string" ? value : String(value == null ? "" : value);
  return text.length <= maxLength ? text : "";
}

function isSoldOut(product) {
  return product.stock === "sold-out" || product.soldOut === true;
}

function byOrder(first, second) {
  return numberOr(first.order, 0) - numberOr(second.order, 0);
}

function numberOr(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

module.exports = {
  buildPublicBootstrap,
  resolvePublicContent
};
