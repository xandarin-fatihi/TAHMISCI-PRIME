/* Tahmisçi Fatura PWA — scope: /fatura/ */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "fatura",
  version: `${self.TAHMISCI_PWA_RELEASE.id}-fatura-20260905-finance-mobile-upload-v1`,
  scopePath: "/fatura/",
  offlineUrl: "/fatura/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/fatura/icon-192.png"
  ],
  precache: [
    "/fatura/styles/fatura.css?v=20260905-finance-mobile-upload-v1",
    "/fatura/styles/stock.css?v=20260905-finance-mobile-upload-v1",
    "/fatura/styles/product-analysis.css?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/app.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/api.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/state.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/dashboard.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/suppliers.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/receipts.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/documents.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/accounting.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/ui-dialogs.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/stock.js?v=20260905-finance-mobile-upload-v1",
    "/fatura/scripts/product-analysis.js?v=20260905-finance-mobile-upload-v1",
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
