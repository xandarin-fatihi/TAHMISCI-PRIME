/* Tahmisçi Personel PWA — scope: /personel/ */
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "personel",
  version: "2026.08.29.1",
  scopePath: "/personel/",
  offlineUrl: "/personel/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/personel/icon-192.png"
  ],
  precache: [
    "/personel/personel.css",
    "/personel/personel-compact.css?v=20260829-notification-shell",
    "/personel/personel.js",
    "/shared/styles/panel-foundation.css",
    "/shared/scripts/save-coordinator.js",
    "/shared/scripts/live-preview-receiver.js",
    "/shared/scripts/pwa-client.js",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/brand/logo-primary.png"
  ],
  staticPrefixes: ["/personel/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/yonetici/", "/panel/"],
  excludedNavigationPrefixes: [],
  excludedClientPrefixes: [],
  fallbackRoot: "/personel/",
  allowedRoots: ["/personel/"],
  icon: "/assets/app-icons/personel/icon-192.png",
  badge: "/assets/app-icons/personel/favicon-48.png",
  notificationTitle: "Tahmisçi Personel"
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
