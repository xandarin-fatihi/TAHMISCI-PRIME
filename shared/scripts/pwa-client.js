(function initialiseTahmisciPwaClient() {
  "use strict";

  const root = document.documentElement;
  const appId = String(root.dataset.pwaApp || "").trim();
  const workerUrl = String(root.dataset.pwaWorker || "").trim();
  const workerScope = String(root.dataset.pwaScope || "").trim();
  const isBackOffice = appId === "personel" || appId === "yonetici";
  const updateCheckKey = `tahmisci:pwa-update-check:${appId}`;
  const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
  const dirtyForms = new WeakSet();
  let waitingWorker = null;
  let controllerChangeHandled = false;
  let updateRequested = false;
  let previouslyFocused = null;
  let updateNotice = null;
  let offlineNotice = null;

  document.addEventListener("DOMContentLoaded", () => {
    bindConnectivityState();
    bindDirtyFormTracking();
    void registerServiceWorker();
  });

  window.TahmisciPWA = Object.freeze({
    checkForUpdate: () => navigator.serviceWorker && navigator.serviceWorker.getRegistration(workerScope).then((registration) => registration && registration.update()),
    hasUnsavedChanges,
    markFormClean(form) {
      if (form instanceof HTMLFormElement) dirtyForms.delete(form);
    }
  });

  async function registerServiceWorker() {
    if (!appId || !workerUrl || !workerScope || !("serviceWorker" in navigator) || !isSafeRegistrationOrigin()) return;
    const hadController = Boolean(navigator.serviceWorker.controller);

    try {
      const registration = await navigator.serviceWorker.register(workerUrl, {
        scope: workerScope,
        updateViaCache: "none"
      });

      watchRegistration(registration, hadController);
      navigator.serviceWorker.addEventListener("controllerchange", () => handleControllerChange(hadController));
      scheduleAutomaticUpdateCheck(registration);
    } catch (error) {
      console.warn("PWA çevrimdışı desteği başlatılamadı; web uygulaması normal çalışmaya devam ediyor.", error);
    }
  }

  function scheduleAutomaticUpdateCheck(registration) {
    let lastCheckedAt = 0;
    try { lastCheckedAt = Number(window.localStorage.getItem(updateCheckKey) || 0); } catch (_error) {}
    if (Date.now() - lastCheckedAt < updateCheckIntervalMs) return;
    const check = () => {
      try { window.localStorage.setItem(updateCheckKey, String(Date.now())); } catch (_error) {}
      registration.update().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(check, { timeout: 15000 });
    } else {
      window.setTimeout(check, 15000);
    }
  }

  function watchRegistration(registration, hadController) {
    if (registration.waiting && hadController) showUpdateReady(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateReady(registration.waiting || installing);
        }
      });
    });
  }

  function showUpdateReady(worker) {
    waitingWorker = worker;
    if (updateNotice) updateNotice.remove();
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateNotice = createNotice({
      kind: "update",
      title: "Yeni sürüm hazır.",
      message: "Güncelleme sizin onayınızla uygulanacak.",
      actionLabel: "Şimdi Güncelle",
      onAction: requestUpdate,
      dismissible: true
    });
    focusNoticeAction(updateNotice);
  }

  function requestUpdate(button) {
    if (!waitingWorker) return;
    if (hasUnsavedChanges()) {
      const approved = window.confirm("Kaydedilmemiş değişiklikleriniz var. Güncelleme sayfayı yenileyecek. Yine de devam edilsin mi?");
      if (!approved) return;
    }

    updateRequested = true;
    button.disabled = true;
    button.textContent = "Güncelleniyor…";
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  function handleControllerChange(hadController) {
    if (controllerChangeHandled || (!hadController && !updateRequested)) return;
    controllerChangeHandled = true;

    if (!updateRequested && hasUnsavedChanges()) {
      if (updateNotice) updateNotice.remove();
      updateNotice = createNotice({
        kind: "update",
        title: "Yeni sürüm uygulandı.",
        message: "Kaydedilmemiş değişiklikleriniz korundu. Hazır olduğunuzda sayfayı yenileyin.",
        actionLabel: "Sayfayı Yenile",
        onAction(button) {
          if (hasUnsavedChanges() && !window.confirm("Kaydedilmemiş değişiklikler kaybolabilir. Sayfa yenilensin mi?")) return;
          button.disabled = true;
          window.location.reload();
        },
        dismissible: true
      });
      focusNoticeAction(updateNotice);
      return;
    }

    window.location.reload();
  }

  function bindConnectivityState() {
    const update = () => setOnlineState(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  function setOnlineState(isOnline) {
    document.body.classList.toggle("is-pwa-offline", !isOnline);
    document.body.dataset.connectivity = isOnline ? "online" : "offline";

    if (isOnline) {
      if (offlineNotice) offlineNotice.remove();
      offlineNotice = null;
    } else if (!offlineNotice) {
      offlineNotice = createNotice({
        kind: "offline",
        title: "Bağlantı yok",
        message: isBackOffice
          ? "Bağlantı yok, veriler güncellenemiyor. Yazma işlemleri tamamlanmış sayılmaz."
          : "Menü bilgileri çevrimdışıyken güncel olmayabilir.",
        dismissible: false
      });
    }

    window.dispatchEvent(new CustomEvent("tahmisci:connectivity-change", { detail: { online: isOnline } }));
  }

  function bindDirtyFormTracking() {
    const mark = (event) => {
      if (!event.isTrusted) return;
      const form = event.target && event.target.closest ? event.target.closest("form") : null;
      if (form) dirtyForms.add(form);
    };
    document.addEventListener("input", mark, true);
    document.addEventListener("change", mark, true);
    document.addEventListener("reset", (event) => {
      if (event.target instanceof HTMLFormElement) dirtyForms.delete(event.target);
    }, true);
    document.addEventListener("tahmisci:pwa-form-clean", (event) => {
      if (event.detail && event.detail.form instanceof HTMLFormElement) dirtyForms.delete(event.detail.form);
    });
  }

  function hasUnsavedChanges() {
    try {
      if (window.TahmisciAdminBridge && typeof window.TahmisciAdminBridge.hasPendingChanges === "function") {
        return Boolean(window.TahmisciAdminBridge.hasPendingChanges());
      }
    } catch (_error) {
      return true;
    }

    if (document.querySelector('[data-save-status="dirty"], [data-pwa-dirty="true"], .save-state[data-save-status="dirty"]')) return true;
    return Array.from(document.forms).some((form) => dirtyForms.has(form));
  }

  function createNotice(options) {
    const notice = document.createElement("section");
    notice.className = `pwa-notice pwa-notice--${options.kind}`;
    notice.dataset.pwaNotice = options.kind;
    notice.setAttribute("role", options.kind === "update" ? "region" : "status");
    notice.setAttribute("aria-live", options.kind === "update" ? "polite" : "assertive");
    notice.setAttribute("aria-label", options.title);

    const copy = document.createElement("div");
    copy.className = "pwa-notice__copy";
    const title = document.createElement("strong");
    title.textContent = options.title;
    const message = document.createElement("span");
    message.textContent = options.message;
    copy.append(title, message);
    notice.append(copy);

    if (options.actionLabel && typeof options.onAction === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "pwa-notice__action";
      action.textContent = options.actionLabel;
      action.addEventListener("click", () => options.onAction(action));
      notice.append(action);
    }

    if (options.dismissible) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "pwa-notice__close";
      close.setAttribute("aria-label", "Bildirimi kapat");
      close.title = "Bildirimi kapat";
      close.textContent = "×";
      close.addEventListener("click", () => dismissNotice(notice));
      notice.append(close);
      notice.addEventListener("keydown", (event) => {
        if (event.key === "Escape") dismissNotice(notice);
      });
    }

    document.body.append(notice);
    return notice;
  }

  function dismissNotice(notice) {
    notice.remove();
    if (notice === updateNotice) updateNotice = null;
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  }

  function focusNoticeAction(notice) {
    const target = notice && notice.querySelector(".pwa-notice__action, .pwa-notice__close");
    if (!target) return;
    window.requestAnimationFrame(() => {
      if (document.contains(target)) target.focus({ preventScroll: true });
    });
  }

  function isSafeRegistrationOrigin() {
    if (window.isSecureContext || location.protocol === "https:") return true;
    const hostname = location.hostname.toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";
  }
})();
