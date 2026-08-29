/* Tahmisçi Yönetici PWA — scope: /yonetici/ */
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "yonetici",
  version: "2026.08.29.1",
  scopePath: "/yonetici/",
  offlineUrl: "/yonetici/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/yonetici/icon-192.png"
  ],
  precache: [
    "/yonetici/styles/admin.css?v=20260829-nav-icons",
    "/yonetici/styles/admin-compact.css",
    "/yonetici/styles/admin-components.css",
    "/yonetici/styles/notifications.css",
    "/yonetici/scripts/app.js",
    "/shared/styles/panel-foundation.css",
    "/shared/scripts/save-coordinator.js",
    "/shared/scripts/pwa-client.js",
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
