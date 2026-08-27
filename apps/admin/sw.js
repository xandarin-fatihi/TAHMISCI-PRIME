/* Tahmisçi Yönetici PWA — scope: /yonetici/ */
self.TAHMISCI_PWA_CONFIG = Object.freeze({
  appId: "yonetici",
  version: "2026.08.27.2",
  scopePath: "/yonetici/",
  offlineUrl: "/yonetici/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/assets/app-icons/yonetici/icon-192.png"
  ],
  precache: [
    "/yonetici/styles/admin.css",
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
    const title = String(source.title || "Tahmisçi Yönetici").slice(0, 120);
    const deepLink = safeAdminDeepLink(source.deepLink);
    await self.registration.showNotification(title, {
      body: String(source.body || "Yeni bir bildiriminiz var.").slice(0, 240),
      icon: "/assets/app-icons/yonetici/icon-192.png",
      badge: "/assets/app-icons/yonetici/favicon-48.png",
      tag: source.id ? `tahmisci-yonetici-${String(source.id).slice(0, 100)}` : undefined,
      renotify: false,
      data: { deepLink }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeAdminDeepLink(event.notification.data && event.notification.data.deepLink);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const targetPrefix = target.startsWith("/fatura") ? "/fatura" : "/yonetici";
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

function safeAdminDeepLink(value) {
  try {
    const url = new URL(String(value || "/yonetici/"), self.location.origin);
    const allowed = url.pathname === "/yonetici" || url.pathname.startsWith("/yonetici/") || url.pathname === "/fatura" || url.pathname.startsWith("/fatura/");
    if (url.origin !== self.location.origin || !allowed) return "/yonetici/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return "/yonetici/";
  }
}
