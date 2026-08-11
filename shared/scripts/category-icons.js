(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TahmisciCategoryIcons = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ICONS = Object.freeze({
    all: { label: "Tümü", className: "fas fa-layer-group", mark: "▦" },
    cold: { label: "Soğuklar", className: "fas fa-snowflake", mark: "❄" },
    hot: { label: "Sıcaklar", className: "fas fa-mug-hot", mark: "♨" },
    turkishCoffee: { label: "Türk Kahveleri", className: "fas fa-mortar-pestle", mark: "☕" },
    dessert: { label: "Tatlı & Sandwich", className: "fas fa-cookie-bite", mark: "✦" },
    beverage: { label: "Meşrubat", className: "fas fa-bottle-water", mark: "◍" },
    counter: { label: "Kasa Önü", className: "fas fa-basket-shopping", mark: "▤" },
    packaged: { label: "Paketli Ürün", className: "fas fa-bag-shopping", mark: "▣" },
    coffee: { label: "Kahve", className: "fas fa-mug-saucer", mark: "☕" },
    food: { label: "Yiyecek", className: "fas fa-utensils", mark: "◐" },
    default: { label: "Kategori", className: "fas fa-tags", mark: "•" }
  });

  function normalizeText(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function inferIconKey(name) {
    const text = normalizeText(name);
    if (!text) return "default";
    if (text.includes("tum")) return "all";
    if (text.includes("soguk")) return "cold";
    if (text.includes("sicak")) return "hot";
    if (text.includes("turk kahve")) return "turkishCoffee";
    if (text.includes("tatli") || text.includes("sandwich") || text.includes("cheesecake")) return "dessert";
    if (text.includes("mesrubat")) return "beverage";
    if (text.includes("kasa")) return "counter";
    if (text.includes("paket")) return "packaged";
    if (text.includes("kahve")) return "coffee";
    return "default";
  }

  function getIcon(key) {
    const normalized = String(key || "").trim();
    return ICONS[normalized] || ICONS[inferIconKey(normalized)] || ICONS.default;
  }

  function getIconClass(key) {
    return getIcon(key).className;
  }

  function options() {
    return Object.entries(ICONS)
      .filter(([key]) => key !== "default")
      .map(([key, value]) => ({ key, ...value }));
  }

  return Object.freeze({
    ICONS,
    inferIconKey,
    getIcon,
    getIconClass,
    options
  });
});
