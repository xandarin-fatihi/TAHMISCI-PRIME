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
  const localNetworkFirstExtensions = /\.(?:css|js|mjs)$/i;
  const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const sensitivePathPattern = /(?:^|\/)(?:api|auth|login|logout|session|sessions)(?:\/|$)/i;
  const isLocalhostDevelopment = isLocalHostname(globalScope.location.hostname);

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
    event.respondWith(isLocalhostDevelopment && localNetworkFirstExtensions.test(url.pathname)
      ? networkFirstStatic(event, request, url)
      : cacheFirstStatic(event, request, url));
  });

  globalScope.addEventListener("push", (event) => {
    event.waitUntil(showPushNotification(event));
  });

  globalScope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(openNotificationTarget(event.notification && event.notification.data));
  });

  async function precacheOfflineShell() {
    const offlineCache = await caches.open(offlineCacheName);
    const staticCache = await caches.open(staticCacheName);
    const offlineResources = [config.offlineUrl];
    const staticResources = uniqueCacheResources((config.precache || []).concat(config.offlineAssets || []));

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

  async function networkFirstStatic(event, request, url) {
    if (!(await belongsToConfiguredApp(event))) return fetch(request);

    const cache = await caches.open(staticCacheName);
    const key = canonicalCacheKey(url);
    try {
      const response = await fetch(new Request(request, { cache: "no-store" }));
      if (isSafeCacheResponse(response)) await cache.put(key, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw error;
    }
  }

  function isSensitiveRequest(request, url) {
    if (sensitivePathPattern.test(url.pathname)) return true;
    if ((config.neverCachePrefixes || []).some((prefix) => url.pathname.startsWith(prefix))) return true;
    if (request.headers.has("authorization") || request.headers.has("cookie")) return true;
    if (String(request.headers.get("accept") || "").toLowerCase().includes("text/event-stream")) return true;
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
    return new Request(`${url.origin}${url.pathname}${url.search}`, { method: "GET", credentials: "same-origin" });
  }

  function isLocalHostname(value) {
    const hostname = String(value || "").toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function uniqueCacheResources(values) {
    const resources = new Map();
    for (const value of unique(values)) {
      try {
        const url = new URL(value, globalScope.location.origin);
        const key = `${url.origin}${url.pathname}${url.search}`;
        resources.set(key, value);
      } catch (_error) {}
    }
    return Array.from(resources.values());
  }

  async function showPushNotification(event) {
    const payload = readPushPayload(event);
    const source = payload.notification && typeof payload.notification === "object" ? payload.notification : payload;
    const sourceData = source.data && typeof source.data === "object" ? source.data : {};
    const deepLink = safeDeepLink(source.deepLink || sourceData.deepLink);
    const unreadCount = Math.max(0, Math.trunc(Number(source.unreadCount ?? sourceData.unreadCount ?? 0)));
    await globalScope.registration.showNotification(String(source.title || config.notificationTitle || "Tahmisçi").slice(0, 120), {
      body: String(source.body || "Yeni bir bildiriminiz var.").slice(0, 240),
      icon: config.icon || `/assets/app-icons/${config.appId}/icon-192.png`,
      badge: config.badge || `/assets/app-icons/${config.appId}/favicon-48.png`,
      tag: source.id ? `tahmisci-${config.appId}-${String(source.id).slice(0, 100)}` : undefined,
      renotify: source.renotify === true,
      vibrate: normalizeVibration(source.vibrate || sourceData.vibrate),
      requireInteraction: source.requireInteraction === true,
      data: { ...sourceData, deepLink, appTarget: config.appId }
    });
    if (unreadCount && typeof globalScope.registration.setAppBadge === "function") {
      await globalScope.registration.setAppBadge(unreadCount).catch(() => {});
    }
  }

  function readPushPayload(event) {
    if (!event || !event.data) return {};
    try { return event.data.json() || {}; } catch (_error) {
      try { return { body: event.data.text() }; } catch (_textError) { return {}; }
    }
  }

  function normalizeVibration(value) {
    if (!Array.isArray(value)) return [120, 60, 120];
    return value.slice(0, 12).map((item) => Math.max(0, Math.min(2000, Number(item) || 0)));
  }

  function safeDeepLink(value) {
    const fallback = String(config.fallbackRoot || config.scopePath || "/");
    const allowedRoots = unique((config.allowedRoots || [fallback]).map((root) => String(root || "")).filter(Boolean));
    try {
      const url = new URL(String(value || fallback), globalScope.location.origin);
      if (url.origin !== globalScope.location.origin || !allowedRoots.some((root) => pathBelongsToRoot(url.pathname, root))) return fallback;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_error) {
      return fallback;
    }
  }

  function pathBelongsToRoot(pathname, root) {
    const normalized = root === "/" ? "/" : `/${String(root).replace(/^\/+|\/+$/g, "")}/`;
    if (normalized === "/") return pathname === "/" || pathname === "/index.html" || pathname.startsWith("/qr-menu/");
    const bare = normalized.slice(0, -1);
    return pathname === bare || pathname.startsWith(normalized);
  }

  async function openNotificationTarget(data) {
    const target = safeDeepLink(data && data.deepLink);
    const targetPath = new URL(target, globalScope.location.origin).pathname;
    const windows = await globalScope.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      try { return pathBelongsToRoot(new URL(client.url).pathname, targetPath.split("/").slice(0, 2).join("/") || "/"); } catch (_error) { return false; }
    });
    if (existing) {
      if ("navigate" in existing) await existing.navigate(target).catch(() => null);
      await existing.focus();
    } else {
      await globalScope.clients.openWindow(target);
    }
    if (typeof globalScope.registration.clearAppBadge === "function") {
      await globalScope.registration.clearAppBadge().catch(() => {});
    }
  }
})(self);
