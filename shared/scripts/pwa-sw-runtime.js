(function initialiseTahmisciServiceWorker(globalScope) {
  "use strict";

  const config = globalScope.TAHMISCI_PWA_CONFIG;
  if (!config || !config.appId || !config.version || !config.offlineUrl) {
    throw new Error("Tahmisçi PWA service worker yapılandırması eksik.");
  }

  const cachePrefix = `tahmisci-${config.appId}-`;
  const staticCacheName = `${cachePrefix}static-${config.version}`;
  const offlineCacheName = `${cachePrefix}offline-${config.version}`;
  const currentCaches = new Set([staticCacheName, offlineCacheName]);
  const staticExtensions = /\.(?:css|js|mjs|woff2?|ttf|otf|png|jpe?g|webp|gif|svg|ico)$/i;
  const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const sensitivePathPattern = /(?:^|\/)(?:api|auth|login|logout|session|sessions)(?:\/|$)/i;

  globalScope.addEventListener("install", (event) => {
    event.waitUntil(precacheOfflineShell());
  });

  globalScope.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => (
        name.startsWith(cachePrefix) && !currentCaches.has(name)
          ? caches.delete(name)
          : Promise.resolve(false)
      )));
      await globalScope.clients.claim();
    })());
  });

  globalScope.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "SKIP_WAITING") {
      globalScope.skipWaiting();
      return;
    }
    if (data.type === "GET_VERSION" && event.ports && event.ports[0]) {
      event.ports[0].postMessage({ appId: config.appId, version: config.version });
    }
  });

  globalScope.addEventListener("fetch", (event) => {
    const request = event.request;
    if (!request || request.method !== "GET" || mutationMethods.has(request.method)) return;

    const url = new URL(request.url);
    if (url.origin !== globalScope.location.origin || isSensitiveRequest(request, url)) return;

    if (request.mode === "navigate") {
      if (!ownsNavigation(url.pathname)) return;
      event.respondWith(networkFirstNavigation(request));
      return;
    }

    if (!isStaticAsset(request, url)) return;
    event.respondWith(cacheFirstStatic(event, request, url));
  });

  async function precacheOfflineShell() {
    const offlineCache = await caches.open(offlineCacheName);
    const staticCache = await caches.open(staticCacheName);
    const offlineResources = [config.offlineUrl];
    const staticResources = unique((config.precache || []).concat(config.offlineAssets || []));

    await Promise.all(offlineResources.map((path) => cacheKnownResource(offlineCache, path, true)));
    await Promise.all(staticResources.map((path) => cacheKnownResource(staticCache, path, false)));
  }

  async function cacheKnownResource(cache, path, allowHtml) {
    try {
      const request = new Request(path, { cache: "reload", credentials: "same-origin" });
      const response = await fetch(request);
      if (!response.ok) return false;
      if (!isSafeCacheResponse(response, { allowHtml })) return false;
      await cache.put(canonicalCacheKey(new URL(request.url)), response.clone());
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function networkFirstNavigation(request) {
    try {
      return await fetch(request);
    } catch (_error) {
      const offlineCache = await caches.open(offlineCacheName);
      return (await offlineCache.match(canonicalCacheKey(new URL(config.offlineUrl, globalScope.location.origin))))
        || new Response("Bağlantı yok, içerik şu anda yüklenemiyor.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
        });
    }
  }

  async function cacheFirstStatic(event, request, url) {
    if (!(await belongsToConfiguredApp(event))) return fetch(request);

    const cache = await caches.open(staticCacheName);
    const key = canonicalCacheKey(url);
    const cached = await cache.match(key);
    if (cached) return cached;

    const response = await fetch(request);
    if (isSafeCacheResponse(response)) {
      await cache.put(key, response.clone());
    }
    return response;
  }

  function isSensitiveRequest(request, url) {
    if (sensitivePathPattern.test(url.pathname)) return true;
    if ((config.neverCachePrefixes || []).some((prefix) => url.pathname.startsWith(prefix))) return true;
    if (request.headers.has("authorization") || request.headers.has("cookie")) return true;
    return request.destination === "document" && request.mode !== "navigate";
  }

  function isStaticAsset(request, url) {
    if (!staticExtensions.test(url.pathname)) return false;
    if ((config.staticPrefixes || []).length
      && !(config.staticPrefixes || []).some((prefix) => url.pathname.startsWith(prefix))) return false;
    return ["style", "script", "font", "image", "manifest", ""].includes(request.destination);
  }

  function isSafeCacheResponse(response, options = {}) {
    if (!response || !response.ok || !["basic", "default"].includes(response.type)) return false;
    const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (/(?:no-store|private)/.test(cacheControl)) return false;
    if (response.headers.has("set-cookie") || response.headers.get("vary") === "*") return false;
    if (/text\/event-stream|application\/json/.test(contentType)) return false;
    if (!options.allowHtml && /text\/html/.test(contentType)) return false;
    return true;
  }

  function ownsNavigation(pathname) {
    if ((config.excludedNavigationPrefixes || []).some((prefix) => pathname.startsWith(prefix))) return false;
    if (config.scopePath === "/") return pathname === "/" || pathname === "/index.html" || pathname.startsWith("/qr-menu/");
    return pathname === config.scopePath.slice(0, -1) || pathname.startsWith(config.scopePath);
  }

  async function belongsToConfiguredApp(event) {
    if (!event.clientId || !(config.excludedClientPrefixes || []).length) return true;
    try {
      const client = await globalScope.clients.get(event.clientId);
      if (!client || !client.url) return true;
      const pathname = new URL(client.url).pathname;
      return !(config.excludedClientPrefixes || []).some((prefix) => pathname.startsWith(prefix));
    } catch (_error) {
      return false;
    }
  }

  function canonicalCacheKey(url) {
    return new Request(`${url.origin}${url.pathname}`, { method: "GET", credentials: "same-origin" });
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }
})(self);
