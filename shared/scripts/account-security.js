(function initialiseTahmisciAccountSecurity() {
  "use strict";

  const controllers = new Map();

  let initialised = false;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();

  function initialise() {
    if (initialised) return;
    initialised = true;
    document.querySelectorAll("[data-account-security][data-account-scope]").forEach((root) => {
      const controller = createController(root);
      if (controller) controllers.set(controller.scope, controller);
    });

    document.addEventListener("personel:session-started", () => controllers.get("personel")?.load());
    document.addEventListener("personel:session-ended", () => controllers.get("personel")?.reset());
    document.addEventListener("tahmisci:admin-session-started", () => controllers.get("admin")?.load());
    document.addEventListener("tahmisci:admin-session-ended", () => controllers.get("admin")?.reset());
    document.addEventListener("mudavim:session-started", () => controllers.get("mudavim")?.load());
    document.addEventListener("mudavim:session-ended", () => controllers.get("mudavim")?.reset());
    document.addEventListener("tahmisci:admin-section-change", (event) => {
      if (event.detail && event.detail.section === "settings") controllers.get("admin")?.load();
    });

    window.TahmisciAccountSecurity = Object.freeze({
      refresh(scope) {
        const normalized = normalizeScope(scope);
        return normalized && controllers.get(normalized) ? controllers.get(normalized).load(true) : Promise.resolve(null);
      }
    });
  }

  function createController(root) {
    const scope = normalizeScope(root.dataset.accountScope);
    if (!scope) return null;
    const explicitEmailTarget = scope === "personel" && root.dataset.accountEmailExplicitTarget === "true";
    const elements = {
      state: root.querySelector("[data-account-email-state]"),
      emailForm: root.querySelector("[data-account-email-form]"),
      email: root.querySelector("[data-account-email]"),
      verification: root.querySelector("[data-account-verification]"),
      verificationTitle: root.querySelector("[data-account-verification-title]"),
      verificationCopy: root.querySelector("[data-account-verification-copy]"),
      send: root.querySelector("[data-account-email-send]"),
      confirmForm: root.querySelector("[data-account-email-confirm-form]"),
      code: root.querySelector("[data-account-email-code]"),
      currentEmail: root.querySelector("[data-account-current-email]"),
      passwordReset: root.querySelector("[data-account-password-reset]"),
      logoutAll: root.querySelector("[data-account-logout-all]"),
      message: root.querySelector("[data-account-security-message]")
    };
    const state = { scope, security: null, challengeId: "", loaded: false, loading: false, busy: false };

    elements.emailForm?.addEventListener("submit", explicitEmailTarget ? requestVerification : changeEmail);
    if (!explicitEmailTarget) elements.send?.addEventListener("click", requestVerification);
    elements.confirmForm?.addEventListener("submit", confirmVerification);
    elements.logoutAll?.addEventListener("click", revokeAllSessions);
    elements.email?.addEventListener("input", () => {
      if (!explicitEmailTarget || !state.challengeId) return;
      const security = state.security || {};
      const destination = security.pendingEmail || security.email || "";
      if (String(elements.email.value || "").trim().toLowerCase() === destination) return;
      state.challengeId = "";
      if (elements.confirmForm) elements.confirmForm.hidden = true;
      render();
    });
    elements.code?.addEventListener("input", () => {
      elements.code.value = elements.code.value.replace(/\D/g, "").slice(0, 6);
    });
    const ownerDetails = root.closest("details");
    ownerDetails?.addEventListener("toggle", () => { if (ownerDetails.open) void load(); });
    render();

    async function load(force) {
      if (state.loading || state.busy || (state.loaded && !force)) return state.security;
      state.loading = true;
      setBusy(true);
      setMessage("Hesap güvenliği denetleniyor…");
      try {
        const result = await request(`/api/account/${scope}/security`);
        state.security = normalizeSecurity(result.security || result.accountSecurity || result.data);
        state.loaded = true;
        render();
        setMessage("");
        return state.security;
      } catch (error) {
        state.loaded = false;
        setMessage(error.message || "Hesap güvenliği bilgileri alınamadı.", "error");
        return null;
      } finally {
        state.loading = false;
        setBusy(false);
      }
    }

    async function changeEmail(event) {
      event.preventDefault();
      if (state.busy || !elements.email) return;
      const email = String(elements.email.value || "").trim().toLowerCase();
      if (!isValidEmail(email)) {
        setMessage("Geçerli bir e-posta adresi girin.", "error");
        elements.email.focus();
        return;
      }
      state.busy = true;
      setBusy(true);
      setMessage("E-posta kaydediliyor…");
      try {
        const result = await request(`/api/account/${scope}/email/change`, { method: "POST", body: { scope, email } });
        state.security = normalizeSecurity(result.security || result.accountSecurity || { email });
        state.challengeId = "";
        state.loaded = true;
        render();
        markFormClean(elements.emailForm);
        setMessage(result.message || "E-posta kaydedildi. Şimdi adresi doğrulayın.", "success");
        elements.send?.focus();
        notifyUpdated();
      } catch (error) {
        setMessage(error.message || "E-posta kaydedilemedi.", "error");
      } finally {
        state.busy = false;
        setBusy(false);
      }
    }

    async function requestVerification(event) {
      event?.preventDefault?.();
      if (state.busy) return;
      const email = explicitEmailTarget ? String(elements.email?.value || "").trim().toLowerCase() : "";
      if (explicitEmailTarget && !isValidEmail(email)) {
        setMessage("Geçerli bir kişisel e-posta adresi girin.", "error");
        elements.email?.focus();
        return;
      }
      state.busy = true;
      setBusy(true);
      setMessage("Doğrulama kodu gönderiliyor…");
      try {
        const body = explicitEmailTarget ? { scope, email } : { scope };
        const result = await request(`/api/account/${scope}/email-verification/request`, { method: "POST", body });
        state.challengeId = String(result.challengeId || "");
        if (!state.challengeId) throw new Error("Doğrulama isteği oluşturulamadı.");
        if (result.security || result.accountSecurity) {
          state.security = normalizeSecurity(result.security || result.accountSecurity);
          state.loaded = true;
          render();
        }
        if (elements.verificationTitle) elements.verificationTitle.textContent = "Doğrulama kodu gönderildi";
        if (elements.verificationCopy) {
          const destination = String(result.maskedEmail || "hesap e-postanıza");
          elements.verificationCopy.textContent = `Altı haneli kod ${destination} adresine gönderildi.`;
        }
        if (elements.confirmForm) elements.confirmForm.hidden = false;
        if (elements.send) elements.send.textContent = "Kodu tekrar gönder";
        if (elements.code) {
          elements.code.value = "";
          window.setTimeout(() => elements.code.focus(), 30);
        }
        setMessage(result.message || "Doğrulama kodu gönderildi.", "success");
      } catch (error) {
        setMessage(error.message || "Doğrulama kodu gönderilemedi.", "error");
      } finally {
        state.busy = false;
        setBusy(false);
      }
    }

    async function confirmVerification(event) {
      event.preventDefault();
      if (state.busy || !elements.code) return;
      const code = elements.code.value.replace(/\D/g, "");
      if (!state.challengeId) {
        setMessage("Önce yeni bir doğrulama kodu isteyin.", "error");
        elements.send?.focus();
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setMessage("Altı haneli doğrulama kodunu girin.", "error");
        elements.code.focus();
        return;
      }
      state.busy = true;
      setBusy(true);
      setMessage("E-posta doğrulanıyor…");
      try {
        const result = await request(`/api/account/${scope}/email-verification/confirm`, {
          method: "POST",
          body: { scope, challengeId: state.challengeId, code }
        });
        state.security = normalizeSecurity(result.security || result.accountSecurity || state.security);
        state.challengeId = "";
        state.loaded = true;
        render();
        markFormClean(elements.confirmForm);
        setMessage(result.message || "E-posta adresi doğrulandı.", "success");
        notifyUpdated();
      } catch (error) {
        setMessage(error.message || "E-posta doğrulanamadı.", "error");
        if ([400, 401].includes(Number(error.status))) elements.code.focus();
      } finally {
        state.busy = false;
        setBusy(false);
      }
    }

    async function revokeAllSessions() {
      if (state.busy || !window.confirm("Tüm cihazlardaki açık oturumlar ve bildirim bağlantıları kapatılsın mı?")) return;
      state.busy = true;
      setBusy(true);
      setMessage("Tüm cihazlardaki oturumlar kapatılıyor…");
      try {
        const result = await request(`/api/account/${scope}/sessions/revoke-all`, {
          method: "POST",
          body: { scope }
        });
        await unsubscribeCurrentPush(scope);
        setMessage(result.message || "Tüm cihazlardaki oturumlar kapatıldı.", "success");
        const fallback = scope === "admin" ? "/yonetici/" : scope === "personel" ? "/personel/" : "/mudavim/";
        const destination = safeScopeDestination(result.redirectTo, scope) || fallback;
        window.setTimeout(() => window.location.assign(destination), 500);
      } catch (error) {
        setMessage(error.message || "Oturumlar kapatılamadı.", "error");
        state.busy = false;
        setBusy(false);
      }
    }

    function render() {
      const security = state.security || {};
      const verified = Boolean(security.email && security.emailVerifiedAt && !security.emailVerificationRequired && !security.pendingEmail);
      const candidate = security.pendingEmail || security.email || "";
      if (elements.state) {
        elements.state.textContent = verified ? (explicitEmailTarget ? "✓ Doğrulandı" : "Doğrulandı") : candidate ? "Doğrulama bekliyor" : "E-posta gerekli";
        elements.state.dataset.state = verified ? "verified" : "pending";
      }
      if (elements.email && document.activeElement !== elements.email) elements.email.value = candidate;
      if (elements.currentEmail) elements.currentEmail.textContent = security.email || "Henüz eklenmedi";
      if (elements.passwordReset) elements.passwordReset.textContent = formatDateTime(security.lastPasswordResetAt) || "Bilgi yok";
      if (elements.verification) elements.verification.hidden = explicitEmailTarget ? !state.challengeId : verified || !candidate;
      if ((!explicitEmailTarget && (verified || !candidate)) || (explicitEmailTarget && !state.challengeId)) {
        state.challengeId = "";
        if (elements.confirmForm) elements.confirmForm.hidden = true;
        if (elements.send) elements.send.textContent = explicitEmailTarget ? "Kodu Gönder" : "Doğrulama kodu gönder";
      } else if (elements.verificationCopy && !state.challengeId) {
        elements.verificationCopy.textContent = `${candidate} adresine altı haneli güvenlik kodu gönderin.`;
      }
      if (explicitEmailTarget && elements.send && state.challengeId) elements.send.textContent = "Kodu Tekrar Gönder";
    }

    function setBusy(busy) {
      root.setAttribute("aria-busy", busy ? "true" : "false");
      root.querySelectorAll("button, input").forEach((control) => { control.disabled = Boolean(busy); });
    }

    function setMessage(message, tone) {
      if (!elements.message) return;
      elements.message.textContent = message || "";
      if (tone) elements.message.dataset.tone = tone;
      else delete elements.message.dataset.tone;
    }

    function notifyUpdated() {
      document.dispatchEvent(new CustomEvent("tahmisci:account-security-updated", {
        detail: { scope, security: { ...state.security } }
      }));
    }

    function reset() {
      state.security = null;
      state.challengeId = "";
      state.loaded = false;
      state.loading = false;
      state.busy = false;
      if (elements.email) elements.email.value = "";
      if (elements.code) elements.code.value = "";
      if (elements.confirmForm) elements.confirmForm.hidden = true;
      setMessage("");
      setBusy(false);
      render();
    }

    return { scope, load, reset };
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json" };
    const init = { method, credentials: "include", headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İşlem tamamlanamadı.");
      error.status = response.status;
      error.code = result.code || "";
      throw error;
    }
    return result;
  }

  function normalizeSecurity(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      email: String(source.email || "").trim().toLowerCase(),
      pendingEmail: String(source.pendingEmail || "").trim().toLowerCase(),
      emailVerifiedAt: source.emailVerifiedAt || null,
      emailVerificationRequired: source.emailVerificationRequired !== false,
      lastPasswordResetAt: source.lastPasswordResetAt || null
    };
  }

  function normalizeScope(value) {
    const scope = String(value || "").trim().toLowerCase();
    return scope === "admin" || scope === "personel" || scope === "mudavim" ? scope : "";
  }

  function isValidEmail(value) {
    return String(value || "").length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
  }

  function safeScopeDestination(value, scope) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (url.origin !== window.location.origin) return "";
      const root = scope === "admin" ? "/yonetici" : scope === "personel" ? "/personel" : "/mudavim";
      if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_error) {
      return "";
    }
  }

  async function unsubscribeCurrentPush(scope) {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(scope === "admin" ? "/yonetici/" : scope === "personel" ? "/personel/" : "/mudavim/").catch(() => null);
    const subscription = registration && registration.pushManager
      ? await registration.pushManager.getSubscription().catch(() => null)
      : null;
    if (subscription) await subscription.unsubscribe().catch(() => false);
  }

  function formatDateTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Istanbul"
    }).format(date);
  }

  function markFormClean(form) {
    if (!(form instanceof HTMLFormElement)) return;
    document.dispatchEvent(new CustomEvent("tahmisci:pwa-form-clean", { detail: { form } }));
  }
})();
