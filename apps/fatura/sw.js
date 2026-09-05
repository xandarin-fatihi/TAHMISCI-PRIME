/* Tahmisçi Fatura PWA — scope: /fatura/ */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "fatura",
  version: `${self.TAHMISCI_PWA_RELEASE.id}-fatura-stock-lifecycle-upload-v1`,
  scopePath: "/fatura/",
  offlineUrl: "/fatura/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/fatura/icon-192.png"
  ],
  precache: [
    "/fatura/styles/fatura.css?v=20260904-stock-lifecycle-upload-v1",
    "/fatura/styles/stock.css?v=20260904-stock-lifecycle-upload-v1",
    "/fatura/styles/product-analysis.css?v=20260829-product-analysis",
    "/fatura/scripts/app.js?v=20260904-stock-lifecycle-upload-v1",
    "/fatura/scripts/api.js",
    "/fatura/scripts/state.js",
    "/fatura/scripts/dashboard.js?v=20260902-final-ui",
    "/fatura/scripts/suppliers.js?v=20260903-supplier-create-fix-v1",
    "/fatura/scripts/receipts.js",
    "/fatura/scripts/documents.js?v=20260904-stock-lifecycle-upload-v1",
    "/fatura/scripts/accounting.js?v=20260904-stock-lifecycle-upload-v1",
    "/fatura/scripts/ui-dialogs.js",
    "/fatura/scripts/stock.js?v=20260904-stock-lifecycle-upload-v1",
    "/fatura/scripts/product-analysis.js?v=20260902-final-ui",
    "/shared/styles/panel-foundation.css",
    "/shared/scripts/pwa-client.js?v=20260831-panel-access",
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
