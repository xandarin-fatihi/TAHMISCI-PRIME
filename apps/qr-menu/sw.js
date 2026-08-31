/* Tahmisçi Dijital Menü PWA — scope: / */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "menu",
  version: self.TAHMISCI_PWA_RELEASE.id,
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
    "/shared/scripts/pwa-client.js?v=20260831-panel-access",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/brand/logo-primary.png"
  ],
  staticPrefixes: ["/qr-menu/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/yonetici/", "/panel/", "/personel/", "/fatura/", "/site/", "/mudavim/"],
  excludedNavigationPrefixes: ["/yonetici/", "/panel/", "/personel/", "/fatura/", "/site/", "/mudavim/", "/api/", "/recipe/"],
  excludedClientPrefixes: ["/yonetici/", "/panel/", "/personel/", "/fatura/", "/site/", "/mudavim/", "/recipe/"]
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
