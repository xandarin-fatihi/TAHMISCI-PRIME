(function initialiseWebsiteLazyFeatures() {
  "use strict";

  const loads = new Map();
  let scriptQueue = Promise.resolve();
  const menuScripts = [
    "scripts/menu/menu-catalog.js?v=20260827-performance",
    "scripts/menu/menu-filter.js?v=20260827-performance",
    "scripts/menu/menu-categories.js?v=20260827-performance",
    "scripts/menu/menu-search.js?v=20260827-performance"
  ];

  function loadScript(source, options = {}) {
    if (loads.has(source)) return loads.get(source);
    const promise = scriptQueue.then(() => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.async = true;
      script.dataset.websiteLazyModule = source.split("/").pop().split("?")[0];
      let restoreDomReady = null;
      if (options.lateDomReady && document.readyState !== "loading") {
        const original = document.addEventListener;
        document.addEventListener = function addLateReadyListener(type, listener, listenerOptions) {
          if (type === "DOMContentLoaded" && typeof listener === "function") {
            queueMicrotask(() => listener.call(document, new Event("DOMContentLoaded")));
            return;
          }
          return original.call(document, type, listener, listenerOptions);
        };
        restoreDomReady = () => { document.addEventListener = original; };
      }
      script.addEventListener("load", () => {
        if (restoreDomReady) restoreDomReady();
        resolve(script);
      }, { once: true });
      script.addEventListener("error", () => {
        if (restoreDomReady) restoreDomReady();
        reject(new Error(`${source} yüklenemedi.`));
      }, { once: true });
      document.body.append(script);
    })).catch((error) => {
      loads.delete(source);
      throw error;
    });
    scriptQueue = promise.catch(() => undefined);
    loads.set(source, promise);
    return promise;
  }

  function loadSequential(sources, options) {
    return sources.reduce((promise, source) => promise.then(() => loadScript(source, options)), Promise.resolve());
  }

  function loadFeatured() {
    return loadScript("scripts/sections/featured-products.js?v=20260827-performance", { lateDomReady: true });
  }

  function loadMenu() {
    return loadSequential(menuScripts, { lateDomReady: true });
  }

  function loadProductTools() {
    return loadSequential([
      "scripts/components/product-gallery.js?v=20260827-performance",
      "scripts/components/product-details-modal.js?v=20260827-performance"
    ], { lateDomReady: true });
  }

  function observeOnce(target, callback, margin) {
    if (!target) return;
    if (!("IntersectionObserver" in window)) {
      window.setTimeout(() => void callback(), 0);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void callback();
    }, { rootMargin: margin || "600px 0px" });
    observer.observe(target);
  }

  function boot() {
    const menu = document.getElementById("menu");
    const featured = document.querySelector('[data-section="popular-products"]');
    const footer = document.querySelector("footer.footer");
    observeOnce(featured, loadFeatured, "500px 0px");
    observeOnce(menu, loadMenu, "700px 0px");
    observeOnce(footer, () => loadScript("scripts/sections/footer.js?v=20260827-performance", { lateDomReady: true }), "500px 0px");

    document.addEventListener("click", (event) => {
      const menuLink = event.target.closest('a[href="#menu"], [data-nav-id="menu"]');
      if (menuLink) void loadMenu();
    }, true);
    document.addEventListener("focusin", (event) => {
      if (event.target.closest("#menu")) void loadMenu();
    });
    document.addEventListener("pointerover", (event) => {
      if (event.target.closest(".product-card")) void loadProductTools();
    }, { passive: true, capture: true });
    document.addEventListener("click", async (event) => {
      const card = event.target.closest(".product-card[data-product-id]");
      if (!card || typeof window.openProductModal === "function") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        await loadProductTools();
        window.openProductModal?.(card.dataset.productId);
      } catch (_error) {}
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
