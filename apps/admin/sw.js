/* Tahmisçi Yönetici PWA — scope: /yonetici/ */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "yonetici",
  version: self.TAHMISCI_PWA_RELEASE.id,
  scopePath: "/yonetici/",
  offlineUrl: "/yonetici/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/yonetici/icon-192.png"
  ],
  precache: [
    "/yonetici/styles/admin.css?v=20260831-panel-access",
    "/yonetici/styles/admin-compact.css",
    "/yonetici/styles/admin-components.css",
    "/yonetici/styles/notifications.css",
    "/yonetici/scripts/app.js?v=20260831-panel-access",
    "/shared/styles/panel-foundation.css",
    "/shared/scripts/save-coordinator.js",
    "/shared/scripts/pwa-client.js?v=20260831-panel-access",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/brand/logo-primary.png"
  ],
  staticPrefixes: ["/yonetici/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/personel/"],
  excludedNavigationPrefixes: [],
  excludedClientPrefixes: [],
  fallbackRoot: "/yonetici/",
  allowedRoots: ["/yonetici/"],
  icon: "/assets/app-icons/yonetici/icon-192.png",
  badge: "/assets/app-icons/yonetici/favicon-48.png",
  notificationTitle: "Tahmisçi Yönetici"
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
