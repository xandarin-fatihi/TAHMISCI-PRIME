/* Tahmisçi Personel PWA — scope: /personel/ */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "personel",
  version: self.TAHMISCI_PWA_RELEASE.id,
  scopePath: "/personel/",
  offlineUrl: "/personel/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/personel/icon-192.png",
    "/assets/app-icons/personel/notification-badge-96.png"
  ],
  precache: [
    "/personel/personel.css?v=20260831-panel-access",
    "/personel/personel-compact.css?v=20260831-profile-compact",
    "/personel/personel.js?v=20260831-panel-access",
    "/shared/styles/panel-foundation.css",
    "/shared/scripts/save-coordinator.js",
    "/shared/scripts/live-preview-receiver.js",
    "/shared/scripts/pwa-client.js?v=20260831-panel-access",
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
  badge: "/assets/app-icons/personel/notification-badge-96.png",
  notificationTitle: "Tahmisçi Personel"
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
