"use strict";

const APP_ROOTS = Object.freeze({
  yonetici: "/yonetici/",
  personel: "/personel/",
  fatura: "/fatura/",
  mudavim: "/mudavim/"
});

function normalizeAppTarget(value, deepLink = "", recipientRole = "personnel") {
  const requested = String(value || "").trim().toLocaleLowerCase("tr-TR");
  if (Object.prototype.hasOwnProperty.call(APP_ROOTS, requested)) return requested;
  const path = String(deepLink || "");
  const fromPath = Object.entries(APP_ROOTS).find(([, root]) => path === root.slice(0, -1) || path.startsWith(root));
  if (fromPath) return fromPath[0];
  return String(recipientRole || "").toLocaleLowerCase("tr-TR") === "manager" ? "yonetici" : "personel";
}

function safeAppDeepLink(value, appTarget, fallback = "") {
  const target = normalizeAppTarget(appTarget);
  const root = APP_ROOTS[target];
  const safeFallback = fallback || root;
  const link = String(value || "").trim().slice(0, 500);
  if (!link.startsWith("/") || link.startsWith("//") || /[\r\n]/.test(link)) return safeFallback;
  try {
    const url = new URL(link, "https://tahmisci.invalid/");
    const bareRoot = root.slice(0, -1);
    if (url.origin !== "https://tahmisci.invalid" || (url.pathname !== bareRoot && !url.pathname.startsWith(root))) return safeFallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return safeFallback;
  }
}

module.exports = { APP_ROOTS, normalizeAppTarget, safeAppDeepLink };
