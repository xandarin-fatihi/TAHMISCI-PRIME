(function initialiseTahmisciPwaClient() {
  "use strict";

  // Ortak istemci yanlışlıkla ikinci kez yüklense bile worker kaydı ve yaşam
  // döngüsü dinleyicileri yalnızca bir kez bağlanır.
  if (window.__TAHMISCI_PWA_CLIENT_INITIALIZED__ === true) return;
  Object.defineProperty(window, "__TAHMISCI_PWA_CLIENT_INITIALIZED__", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const root = document.documentElement;
  const appId = String(root.dataset.pwaApp || "").trim();
  const workerUrl = String(root.dataset.pwaWorker || "").trim();
  const workerScope = String(root.dataset.pwaScope || "").trim();
  const isBackOffice = appId === "personel" || appId === "yonetici" || appId === "fatura";
  const supportsNotificationIntro = isBackOffice || appId === "mudavim";
  const updateCheckKey = `tahmisci:pwa-update-check:${appId}`;
  const notificationIntroKey = `tahmisci:pwa-notification-intro:${appId}:v1`;
  const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
  const isLocalhostDevelopment = isLocalHostname(location.hostname);
  const dirtyForms = new WeakSet();
  let registrationPromise = null;
  let watchedRegistration = null;
  let controllerChangeBound = false;
  let waitingWorker = null;
  let controllerChangeHandled = false;
  let updateRequested = false;
  let previouslyFocused = null;
  let updateNotice = null;
  let offlineNotice = null;
  let installNotice = null;
  let notificationIntroNotice = null;
  let notificationPromptConfig = null;
  let notificationPromptCheckPending = false;
  let deferredInstallPrompt = null;

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  document.addEventListener("personel:session-started", scheduleNotificationIntro);
  document.addEventListener("tahmisci:admin-session-started", scheduleNotificationIntro);
  document.addEventListener("mudavim:session-started", scheduleNotificationIntro);
  document.addEventListener("personel:session-ended", dismissNotificationIntro);
  document.addEventListener("tahmisci:admin-session-ended", dismissNotificationIntro);
  document.addEventListener("mudavim:session-ended", dismissNotificationIntro);
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

  document.addEventListener("DOMContentLoaded", () => {
    bindConnectivityState();
    bindDirtyFormTracking();
    if (deferredInstallPrompt) showInstallReady();
    void registerServiceWorker();
  });

  window.TahmisciPWA = Object.freeze({
    checkForUpdate: () => ensureServiceWorkerRegistration().then((registration) => registration && registration.update()),
    ensureServiceWorker: ensureServiceWorkerRegistration,
    getRegistration: () => ensureServiceWorkerRegistration(),
    canInstall: () => Boolean(deferredInstallPrompt && !isStandalone()),
    promptInstall: requestInstall,
    registerNotificationPrompt(config) {
      if (!supportsNotificationIntro || !config || typeof config.onEnable !== "function") return false;
      notificationPromptConfig = config;
      scheduleNotificationIntro();
      return true;
    },
    showNotificationPrompt: scheduleNotificationIntro,
    updateBadge: updateAppBadge,
    hasUnsavedChanges,
    markFormClean(form) {
      if (form instanceof HTMLFormElement) dirtyForms.delete(form);
    }
  });

  function handleServiceWorkerMessage(event) {
    const data = event && event.data;
    if (!data || data.type !== "TAHMISCI_PUSH_VIBRATE") return;
    const responsePort = event.ports && event.ports[0];
    let handled = false;
    if (document.visibilityState === "visible" && typeof navigator.vibrate === "function") {
      const pattern = normalizeClientVibration(data.pattern);
      if (pattern.length) {
        try { handled = navigator.vibrate(pattern) !== false; } catch (_error) {}
      }
    }
    try { responsePort?.postMessage({ handled }); } catch (_error) {}
  }

  function normalizeClientVibration(value) {
    if (!Array.isArray(value) || !value.length || value.length > 12) return [];
    const pattern = [];
    let total = 0;
    for (const item of value) {
      const duration = Number(item);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 2000) return [];
      const rounded = Math.round(duration);
      total += rounded;
      if (total > 8000) return [];
      pattern.push(rounded);
    }
    return pattern;
  }

  async function updateAppBadge(value) {
    const count = Math.max(0, Math.trunc(Number(value || 0)));
    try {
      if (count > 0 && typeof navigator.setAppBadge === "function") await navigator.setAppBadge(count);
      else if (count === 0 && typeof navigator.clearAppBadge === "function") await navigator.clearAppBadge();
    } catch (_error) {
      // App Badge API desteklenmeyen/izin verilmeyen tarayıcılarda sessizce atlanır.
    }
  }

  function handleBeforeInstallPrompt(event) {
    event.preventDefault();
    if (isStandalone()) return;
    deferredInstallPrompt = event;
    if (document.body) showInstallReady();
  }

  function showInstallReady() {
    if (!deferredInstallPrompt || installNotice || isStandalone()) return;
    installNotice = createNotice({
      kind: "install",
      title: "Uygulama olarak yükleyin",
      message: "Tahmisçi'yi ana ekranınızdan hızlı ve güvenli biçimde açabilirsiniz.",
      actionLabel: "Uygulamayı Yükle",
      onAction: requestInstall,
      dismissible: true
    });
  }

  function requestInstall(button) {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent || isStandalone()) return Promise.resolve(false);
    if (button) {
      button.disabled = true;
      button.textContent = "Yükleme açılıyor…";
    }

    // prompt() doğrudan tıklama çağrı zincirinde çalışır; izin diyaloğu otomatik başlatılmaz.
    const promptResult = promptEvent.prompt();
    return Promise.resolve(promptResult)
      .then(() => promptEvent.userChoice)
      .then((choice) => {
        const accepted = Boolean(choice && choice.outcome === "accepted");
        deferredInstallPrompt = null;
        if (installNotice) installNotice.remove();
        installNotice = null;
        return accepted;
      })
      .catch(() => {
        if (button) {
          button.disabled = false;
          button.textContent = "Uygulamayı Yükle";
        }
        return false;
      });
  }

  function handleAppInstalled() {
    deferredInstallPrompt = null;
    if (installNotice) installNotice.remove();
    installNotice = null;
  }

  function scheduleNotificationIntro() {
    if (notificationPromptCheckPending) return;
    notificationPromptCheckPending = true;
    window.setTimeout(() => {
      notificationPromptCheckPending = false;
      void showNotificationIntroIfEligible();
    }, 250);
  }

  async function showNotificationIntroIfEligible() {
    if (!document.body || notificationIntroNotice || !notificationPromptConfig || !supportsNotificationIntro || !isStandalone()) return;
    if (!("Notification" in window) || window.Notification.permission !== "default") return;
    try {
      if (window.localStorage.getItem(notificationIntroKey)) return;
    } catch (_error) {}
    if (typeof notificationPromptConfig.canShow === "function"
      && !(await Promise.resolve(notificationPromptConfig.canShow()).catch(() => false))) return;

    notificationIntroNotice = createNotice({
      kind: "push-intro",
      title: "Telefon bildirimleri",
      message: appId === "mudavim"
        ? "Tahmisçi Müdavim duyurularını ve hesap bildirimlerini telefonundan al."
        : "Görev, sevkiyat ve vardiya bildirimlerini telefonundan al.",
      actionLabel: "Bildirimleri Aç",
      onAction: enableNotificationsFromIntro,
      secondaryActionLabel: "Şimdi Değil",
      onSecondaryAction: postponeNotificationIntro,
      dismissible: false
    });
    focusNoticeAction(notificationIntroNotice);
  }

  async function enableNotificationsFromIntro(button) {
    if (!notificationPromptConfig || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Açılıyor…";
    try {
      const enabled = await notificationPromptConfig.onEnable();
      if (enabled === false) throw new Error("Bildirim izni etkinleştirilemedi.");
      rememberNotificationIntroChoice("enabled");
      dismissNotificationIntro();
    } catch (error) {
      if ("Notification" in window && window.Notification.permission === "denied") {
        rememberNotificationIntroChoice("denied");
        dismissNotificationIntro();
        return;
      }
      button.disabled = false;
      button.textContent = original;
      const message = notificationIntroNotice && notificationIntroNotice.querySelector(".pwa-notice__copy span");
      if (message) message.textContent = error && error.message || "Bildirim izni etkinleştirilemedi. Ayarlardan yeniden deneyebilirsiniz.";
    }
  }

  function postponeNotificationIntro() {
    rememberNotificationIntroChoice("later");
    dismissNotificationIntro();
  }

  function rememberNotificationIntroChoice(value) {
    try { window.localStorage.setItem(notificationIntroKey, String(value || "seen")); } catch (_error) {}
  }

  function dismissNotificationIntro() {
    if (notificationIntroNotice) notificationIntroNotice.remove();
    notificationIntroNotice = null;
  }

  function isStandalone() {
    return Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
  }

  async function registerServiceWorker() {
    if (!appId || !workerUrl || !workerScope || !("serviceWorker" in navigator) || !isSafeRegistrationOrigin()) return;
    try {
      await ensureServiceWorkerRegistration();
    } catch (error) {
      console.warn("PWA çevrimdışı desteği başlatılamadı; web uygulaması normal çalışmaya devam ediyor.", error);
    }
  }

  function ensureServiceWorkerRegistration() {
    if (!appId || !workerUrl || !workerScope || !("serviceWorker" in navigator) || !isSafeRegistrationOrigin()) {
      return Promise.resolve(null);
    }
    if (registrationPromise) return registrationPromise;

    registrationPromise = navigator.serviceWorker.getRegistration(workerScope)
      .then((existing) => existing || navigator.serviceWorker.register(workerUrl, {
        scope: workerScope,
        updateViaCache: "none"
      }))
      .then((registration) => {
        if (!registration) return null;
        bindRegistrationLifecycle(registration);
        return registration;
      })
      .catch((error) => {
        registrationPromise = null;
        throw error;
      });
    return registrationPromise;
  }

  function bindRegistrationLifecycle(registration) {
    if (watchedRegistration !== registration) {
      watchedRegistration = registration;
      watchRegistration(registration);
      scheduleAutomaticUpdateCheck(registration);
    }
    if (!controllerChangeBound) {
      controllerChangeBound = true;
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    }
  }

  function scheduleAutomaticUpdateCheck(registration) {
    if (isLocalhostDevelopment) {
      registration.update().catch(() => {});
      return;
    }
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

  function watchRegistration(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateReady(registration.waiting);

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

  function handleControllerChange() {
    if (controllerChangeHandled || !updateRequested) return;
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
          : appId === "mudavim"
            ? "Bağlantı gerekli. Hesap işlemleri çevrimdışıyken yapılamaz."
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

    if (options.secondaryActionLabel && typeof options.onSecondaryAction === "function") {
      const secondary = document.createElement("button");
      secondary.type = "button";
      secondary.className = "pwa-notice__secondary";
      secondary.textContent = options.secondaryActionLabel;
      secondary.addEventListener("click", () => options.onSecondaryAction(secondary));
      notice.append(secondary);
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
    if (notice === installNotice) installNotice = null;
    if (notice === notificationIntroNotice) notificationIntroNotice = null;
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
    return isLocalHostname(location.hostname);
  }

  function isLocalHostname(value) {
    const hostname = String(value || "").toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  }
})();
