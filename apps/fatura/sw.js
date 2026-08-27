/* Tahmisçi Fatura PWA — yalnız statik kabuk; API ve özel belgeler asla cache edilmez. */
"use strict";
const CACHE = "tahmisci-fatura-shell-v4-stock-restore";
const SHELL = [
  "/fatura/", "/fatura/offline.html", "/fatura/styles/fatura.css", "/fatura/styles/stock.css?v=20260827-stock-restore",
  "/fatura/scripts/app.js?v=20260827-stock-restore", "/fatura/scripts/api.js", "/fatura/scripts/state.js",
  "/fatura/scripts/dashboard.js", "/fatura/scripts/suppliers.js",
  "/fatura/scripts/receipts.js", "/fatura/scripts/documents.js",
  "/fatura/scripts/accounting.js", "/fatura/scripts/stock.js?v=20260827-stock-restore", "/shared/styles/panel-foundation.css",
  "/assets/brand/logo-compact.png", "/assets/app-icons/fatura/icon-192.png"
];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("tahmisci-fatura-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/documents/") || request.headers.get("accept") === "text/event-stream") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/fatura/offline.html")));
    return;
  }
  if (!(url.pathname.startsWith("/fatura/") || url.pathname.startsWith("/shared/") || url.pathname.startsWith("/assets/"))) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (!response.ok || response.type !== "basic") return response;
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  })));
});
