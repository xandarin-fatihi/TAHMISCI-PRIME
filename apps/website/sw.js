self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

const SITE_SCOPE_PATH = "/site/";

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (new URL(self.registration.scope).pathname !== SITE_SCOPE_PATH) {
      await self.registration.unregister();
      return;
    }
    await self.clients.claim();
  })());
});


