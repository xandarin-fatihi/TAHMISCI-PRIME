/* Tahmisçi Fatura PWA — scope: /fatura/ */
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "fatura",
  version: "2026.08.29.1",
  scopePath: "/fatura/",
  offlineUrl: "/fatura/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/fatura/icon-192.png"
  ],
  precache: [
    "/fatura/styles/fatura.css",
    "/fatura/styles/stock.css?v=20260829-stock-analytics",
    "/fatura/styles/product-analysis.css?v=20260829-product-analysis",
    "/fatura/scripts/app.js?v=20260829-stock-analytics",
    "/fatura/scripts/api.js",
    "/fatura/scripts/state.js",
    "/fatura/scripts/dashboard.js",
    "/fatura/scripts/suppliers.js",
    "/fatura/scripts/receipts.js",
    "/fatura/scripts/documents.js",
    "/fatura/scripts/accounting.js",
    "/fatura/scripts/stock.js?v=20260829-stock-analytics",
    "/fatura/scripts/product-analysis.js?v=20260829-product-analysis",
    "/shared/styles/panel-foundation.css",
    "/shared/scripts/pwa-client.js",
    "/assets/brand/logo-compact.png"
  ],
  staticPrefixes: ["/fatura/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/documents/", "/yonetici/", "/personel/"],
  excludedNavigationPrefixes: [],
  excludedClientPrefixes: [],
  fallbackRoot: "/fatura/",
  allowedRoots: ["/fatura/"],
  icon: "/assets/app-icons/fatura/icon-192.png",
  badge: "/assets/app-icons/fatura/favicon-48.png",
  notificationTitle: "Tahmisçi Fatura"
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
