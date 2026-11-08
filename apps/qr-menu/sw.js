/* Tahmisçi Dijital Menü PWA — scope: / */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "menu",
  version: self.TAHMISCI_PWA_RELEASE.id + "-menu-title-wrap",
  scopePath: "/",
  offlineUrl: "/qr-menu/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/menu/icon-192.png"
  ],
  precache: [
    "/qr-menu/styles/qr-menu.css?v=20261108-title-wrap",
    "/qr-menu/scripts/app.js?v=20261108-dialog-fit",
    "/shared/scripts/live-preview-receiver.js?v=20261108-preview-ack",
    "/qr-menu/assets/frost-corner.svg",
    "/assets/menu-themes/occasion/saygiyla-anma.webp",
    "/assets/menu-themes/occasion/defter-kahve.webp",
    "/assets/menu-themes/occasion/bakir-cezve.webp",
    "/assets/menu-themes/occasion/gece-yarisi.webp",
    "/shared/scripts/menu-design-schema.js?v=20261108-emerald-throne",
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
