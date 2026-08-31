/* Tahmisçi Müdavim PWA — scope: /mudavim/ */
importScripts("/shared/scripts/pwa-release.js");
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "mudavim",
  version: self.TAHMISCI_PWA_RELEASE.id,
  scopePath: "/mudavim/",
  offlineUrl: "/mudavim/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css?v=20260831-mudavim-update",
    "/assets/app-icons/mudavim/icon-192.png"
  ],
  precache: [
    "/mudavim/mudavim.css?v=20260831-panel-access",
    "/mudavim/mudavim.js?v=20260831-panel-access",
    "/shared/styles/account-security.css?v=20260829-mudavim",
    "/shared/scripts/account-security.js?v=20260829-mudavim",
    "/shared/scripts/pwa-client.js?v=20260831-panel-access",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/app-icons/mudavim/icon-512.png"
  ],
  staticPrefixes: ["/mudavim/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/yonetici/", "/personel/", "/fatura/"],
  excludedNavigationPrefixes: [],
  excludedClientPrefixes: [],
  fallbackRoot: "/mudavim/",
  allowedRoots: ["/mudavim/"],
  icon: "/assets/app-icons/mudavim/icon-192.png",
  badge: "/assets/app-icons/mudavim/icon-192.png",
  notificationTitle: "Tahmisçi Müdavim"
});
importScripts("/shared/scripts/pwa-sw-runtime.js");
