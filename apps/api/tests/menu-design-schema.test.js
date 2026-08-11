"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const designSchema = require("../../../shared/scripts/menu-design-schema");

function legacyMenu(version) {
  const settings = {
    bgColor: "#71e52e",
    accentColor: "#659a78",
    fonts: { title: "Özel Font" },
    typography: { menuTitle: 41 },
    menuBackground: {
      type: "gradient",
      gradientStart: "#101010",
      gradientEnd: "#202020",
      gradientAngle: 0,
      overlay: 0
    },
    bottomActions: {
      popular: { type: "solid", color: "#303030", overlay: 0 },
      suggest: { type: "gradient", gradientStart: "#404040", gradientEnd: "#505050", gradientAngle: 0 }
    },
    banner: {
      mode: "video",
      title: "",
      subtitle: "Özel alt başlık",
      video: "/media/banner-main",
      videoUrl: "/media/banner-main",
      videos: [{ id: "video-1", src: "/media/banner-main", name: "Ana video", kind: "video" }],
      images: [{ id: "image-1", src: "/media/banner-image", name: "Ana görsel", kind: "image" }],
      productIds: ["product-1"]
    }
  };
  if (version !== undefined) settings.designPresetVersion = version;
  return {
    futureSafeField: { retained: true },
    settings,
    pricing: { schemaVersion: 1, customPricingField: "koru" },
    categories: [{
      id: "category-1",
      name: "Özel kategori",
      color: "#606060",
      image: "/media/category-image",
      customCategoryField: "koru",
      style: {
        type: "gradient",
        color: "#606060",
        image: "/media/category-image",
        imageUrl: "",
        gradientStart: "#616161",
        gradientEnd: "#626262",
        gradientAngle: 0,
        overlay: 0
      },
      products: [{
        id: "product-1",
        name: "Özel ürün",
        cardColor: "#707070",
        image: "/media/product-image",
        imageUrl: "",
        imageOverlay: 0,
        customProductField: "koru",
        style: {
          type: "image",
          color: "#707070",
          image: "/media/product-card",
          imageUrl: "",
          gradientStart: "#717171",
          gradientEnd: "#727272",
          gradientAngle: 0,
          overlay: 0
        }
      }]
    }]
  };
}

test("ortak tasarım şeması eski preset etiketlerini kullanıcı değerlerini sıfırlamadan taşır", () => {
  for (const version of ["tahmisci-20260522a", "tahmisci-20260722-beige-brown", undefined]) {
    const input = legacyMenu(version);
    const normalized = designSchema.normalizeMenuState(input);

    assert.equal(normalized.settings.designSchemaVersion, designSchema.DESIGN_SCHEMA_VERSION);
    assert.ok(normalized.settings.appliedPresetId);
    assert.equal("designPresetVersion" in normalized.settings, false);
    assert.equal(normalized.settings.bgColor, "#71e52e");
    assert.equal(normalized.settings.accentColor, "#659a78");
    assert.equal(normalized.settings.fonts.title, "Özel Font");
    assert.equal(normalized.settings.typography.menuTitle, 41);
    assert.equal(normalized.settings.menuBackground.gradientAngle, 0);
    assert.equal(normalized.settings.menuBackground.overlay, 0);
    assert.equal(normalized.settings.banner.title, "");
    assert.deepEqual(normalized.settings.banner.productIds, ["product-1"]);
    assert.equal(normalized.categories[0].style.gradientStart, "#616161");
    assert.equal(normalized.categories[0].style.overlay, 0);
    assert.equal(normalized.categories[0].products[0].style.image, "/media/product-card");
    assert.equal(normalized.categories[0].products[0].style.overlay, 0);
    assert.equal(normalized.futureSafeField.retained, true);
    assert.equal(normalized.categories[0].customCategoryField, "koru");
    assert.equal(normalized.categories[0].products[0].customProductField, "koru");
    assert.equal(normalized.pricing.customPricingField, "koru");
  }
});

test("ortak tasarım normalizasyonu idempotent ve fingerprint kararlıdır", () => {
  const input = legacyMenu("tahmisci-20260522a");
  const first = designSchema.normalizeMenuState(input);
  const second = designSchema.normalizeMenuState(first);

  assert.deepEqual(second, first);
  assert.equal(designSchema.designFingerprint(second), designSchema.designFingerprint(first));
  assert.equal(designSchema.designMatches(input, second), true);
  assert.notStrictEqual(first, input);
  assert.equal(input.settings.designPresetVersion, "tahmisci-20260522a", "salt-okunur migrasyon girdiyi değiştirmemeli");
});

test("preview draft normalizasyonu renk, banner, kategori ve ürün tasarımını korur", () => {
  const draft = legacyMenu("tahmisci-20260722-beige-brown");
  draft.settings.socialIconSize = 42;
  draft.settings.typography.productPrice = 19;
  draft.categories[0].style.type = "image";
  draft.categories[0].style.imageUrl = "/media/category-card";

  const normalized = designSchema.normalizeMenuState(draft);
  const projection = designSchema.designProjection(normalized);

  assert.equal(projection.settings.socialIconSize, 42);
  assert.equal(projection.settings.typography.productPrice, 19);
  assert.equal(projection.settings.banner.videos[0].src, "/media/banner-main");
  assert.equal(projection.settings.banner.images[0].src, "/media/banner-image");
  assert.equal(projection.categories[0].style.type, "image");
  assert.equal(projection.categories[0].style.imageUrl, "/media/category-card");
  assert.equal(projection.categories[0].products[0].style.gradientStart, "#717171");
});

test("fabrika tasarımı yalnızca tasarım alanlarını değiştirir ve işletme verisini korur", () => {
  const input = legacyMenu("tahmisci-20260722-beige-brown");
  const product = input.categories[0].products[0];
  product.price = 187;
  product.description = "Korunacak açıklama";
  product.ingredients = "Korunacak içerik";
  product.active = false;
  product.order = 9;
  input.categories[0].active = false;
  input.categories[0].order = 4;

  const factory = designSchema.createFactoryDesignSnapshot(input);
  const applied = designSchema.applyDesignSnapshot(input, factory);

  assert.equal(applied.settings.bgColor, designSchema.DEFAULT_SETTINGS.bgColor);
  assert.equal(applied.settings.darkBgColor, designSchema.DEFAULT_SETTINGS.darkBgColor);
  assert.equal(applied.settings.appliedPresetId, designSchema.DEFAULT_PRESET_ID);
  assert.equal(applied.categories.length, input.categories.length);
  assert.equal(applied.categories[0].id, input.categories[0].id);
  assert.equal(applied.categories[0].name, input.categories[0].name);
  assert.equal(applied.categories[0].active, false);
  assert.equal(applied.categories[0].order, 4);
  assert.equal(applied.categories[0].image, "/media/category-image");
  assert.equal(applied.categories[0].products.length, input.categories[0].products.length);
  assert.equal(applied.categories[0].products[0].id, product.id);
  assert.equal(applied.categories[0].products[0].name, product.name);
  assert.equal(applied.categories[0].products[0].price, 187);
  assert.equal(applied.categories[0].products[0].description, "Korunacak açıklama");
  assert.equal(applied.categories[0].products[0].ingredients, "Korunacak içerik");
  assert.equal(applied.categories[0].products[0].active, false);
  assert.equal(applied.categories[0].products[0].order, 9);
  assert.equal(applied.categories[0].products[0].image, "/media/product-image");
  assert.equal(applied.categories[0].products[0].cardColor, designSchema.DEFAULT_SETTINGS.productCardColor);
});

test("admin tasarım snapshot'ı içerik ve gizli alanları kopyalamaz", () => {
  const input = legacyMenu();
  input.categories[0].products[0].price = 199;
  input.categories[0].products[0].passwordHash = "gizli";
  const snapshot = designSchema.createDesignSnapshot(input);
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.schemaVersion, designSchema.DESIGN_SCHEMA_VERSION);
  assert.equal(snapshot.categoryDesign[0].id, "category-1");
  assert.equal(snapshot.productDesign[0].id, "product-1");
  assert.equal(serialized.includes("Özel kategori"), false);
  assert.equal(serialized.includes("Özel ürün"), false);
  assert.equal(serialized.includes("199"), false);
  assert.equal(serialized.includes("passwordHash"), false);
  assert.equal(serialized.includes("/media/product-image"), false);
});
