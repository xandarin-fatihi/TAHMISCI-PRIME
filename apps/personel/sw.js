/* Tahmisçi Personel PWA — scope: /personel/ */
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "personel",
  version: "2026.08.22.2",
  scopePath: "/personel/",
  offlineUrl: "/personel/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/personel/icon-192.png"
  ],
  precache: [
    "/personel/personel.css",
    "/personel/personel-compact.css",
    "/personel/notifications.css",
    "/personel/personel.js",
    "/personel/workforce.js",
    "/personel/notifications.js",
    "/shared/styles/panel-foundation.css",
    "/shared/styles/account-security.css",
    "/shared/scripts/save-coordinator.js",
    "/shared/scripts/live-preview-receiver.js",
    "/shared/scripts/account-security.js",
    "/shared/scripts/pwa-client.js",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/brand/logo-primary.png"
  ],
  staticPrefixes: ["/personel/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/", "/yonetici/", "/panel/"],
  excludedNavigationPrefixes: [],
  excludedClientPrefixes: []
});
importScripts("/shared/scripts/pwa-sw-runtime.js");

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_error) {
      payload = { body: event.data ? event.data.text() : "" };
    }
    const source = payload.notification && typeof payload.notification === "object" ? payload.notification : payload;
    const title = String(source.title || "Tahmisçi Personel").slice(0, 120);
    const deepLink = safePersonelDeepLink(source.deepLink);
    await self.registration.showNotification(title, {
      body: String(source.body || "Yeni bir bildiriminiz var.").slice(0, 240),
      icon: "/assets/app-icons/personel/icon-192.png",
      badge: "/assets/app-icons/personel/favicon-48.png",
      tag: source.id ? `tahmisci-personel-${String(source.id).slice(0, 100)}` : undefined,
      renotify: false,
      data: { deepLink }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safePersonelDeepLink(event.notification.data && event.notification.data.deepLink);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const targetPrefix = target.startsWith("/fatura") ? "/fatura" : "/personel";
    const existing = windows.find((client) => {
      try { return new URL(client.url).pathname.startsWith(targetPrefix); } catch (_error) { return false; }
    });
    if (existing) {
      if ("navigate" in existing) await existing.navigate(target).catch(() => null);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});

function safePersonelDeepLink(value) {
  try {
    const url = new URL(String(value || "/personel/"), self.location.origin);
    const allowed = url.pathname === "/personel" || url.pathname.startsWith("/personel/") || url.pathname === "/fatura" || url.pathname.startsWith("/fatura/");
    if (url.origin !== self.location.origin || !allowed) return "/personel/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return "/personel/";
  }
}
