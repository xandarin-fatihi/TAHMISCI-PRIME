/* Tahmisçi Dijital Menü PWA — scope: / */
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "menu",
  version: "2026.08.21.1",
  scopePath: "/",
  offlineUrl: "/qr-menu/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/menu/icon-192.png"
  ],
  precache: [
    "/qr-menu/styles/qr-menu.css",
    "/qr-menu/scripts/app.js",
    "/shared/scripts/menu-design-schema.js",
    "/shared/scripts/live-preview-receiver.js",
    "/shared/scripts/pwa-client.js",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/brand/logo-primary.png"
  ],
  staticPrefixes: ["/qr-menu/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/yonetici/", "/panel/", "/personel/"],
  excludedNavigationPrefixes: ["/yonetici/", "/panel/", "/personel/", "/api/", "/recipe/"],
  excludedClientPrefixes: ["/yonetici/", "/panel/", "/personel/", "/recipe/"]
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
