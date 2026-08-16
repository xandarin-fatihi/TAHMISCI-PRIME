(function () {
  "use strict";

  const requestForm = document.getElementById("requestForm");
  const confirmForm = document.getElementById("confirmForm");
  const identifierInput = document.getElementById("identifierInput");
  const scopeInput = document.getElementById("accountScope");
  const scopeLabel = document.getElementById("accountScopeLabel");
  const pageTitle = document.getElementById("pageTitle");
  const pageIntro = document.getElementById("pageIntro");
  const requestButton = document.getElementById("requestButton");
  const confirmButton = document.getElementById("confirmButton");
  const sendAgainButton = document.getElementById("sendAgainButton");
  const changeAccountButton = document.getElementById("changeAccountButton");
  const passwordToggle = document.getElementById("passwordToggle");
  const newPasswordInput = document.getElementById("newPasswordInput");
  const maskedEmail = document.getElementById("maskedEmail");
  const statusBox = document.getElementById("status");
  const loginLink = document.getElementById("loginLink");
  const otpInputs = Array.from(document.querySelectorAll("#otpInputs input"));
  const GENERIC_MESSAGE = "Bilgiler kayıtlarımızla eşleşiyorsa doğrulama kodu gönderildi.";
  const context = resolveEntryContext();
  const state = { busy: false, challengeId: "", scope: context.scope, identifier: "" };

  applyLockedContext();
  requestForm.addEventListener("submit", (event) => { event.preventDefault(); requestCode(false).catch(() => {}); });
  confirmForm.addEventListener("submit", submitPassword);
  sendAgainButton.addEventListener("click", () => requestCode(true).catch(() => {}));
  changeAccountButton.addEventListener("click", resetToRequest);
  passwordToggle.addEventListener("click", togglePassword);
  newPasswordInput.addEventListener("input", renderPasswordRules);
  otpInputs.forEach((input, index) => {
    input.addEventListener("input", () => handleOtpInput(input, index));
    input.addEventListener("keydown", (event) => handleOtpKeydown(event, index));
    input.addEventListener("paste", handleOtpPaste);
  });

  function resolveEntryContext() {
    const params = new URLSearchParams(window.location.search);
    const requestedScope = normalizeScope(params.get("scope"));
    const referrerScope = scopeFromReferrer(document.referrer);
    const scope = requestedScope || referrerScope || "admin";
    return { scope, returnTo: safeReturnTo(params.get("returnTo"), scope) || defaultReturnTo(scope) };
  }

  function normalizeScope(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "personel" || normalized === "admin" ? normalized : "";
  }

  function scopeFromReferrer(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) return "";
      if (url.pathname === "/personel" || url.pathname.startsWith("/personel/")) return "personel";
      if (url.pathname === "/yonetici" || url.pathname.startsWith("/yonetici/") || url.pathname === "/panel" || url.pathname.startsWith("/panel/")) return "admin";
    } catch (_error) {}
    return "";
  }

  function safeReturnTo(value, scope) {
    if (!value || !scope) return "";
    try {
      const url = new URL(String(value), window.location.origin);
      if (url.origin !== window.location.origin) return "";
      const allowed = scope === "personel"
        ? (url.pathname === "/personel" || url.pathname.startsWith("/personel/"))
        : (url.pathname === "/yonetici" || url.pathname.startsWith("/yonetici/") || url.pathname === "/panel" || url.pathname.startsWith("/panel/"));
      return allowed ? `${url.pathname}${url.search}${url.hash}` : "";
    } catch (_error) {
      return "";
    }
  }

  function defaultReturnTo(scope) {
    return scope === "personel" ? "/personel/" : "/yonetici/";
  }

  function applyLockedContext() {
    const label = state.scope === "personel" ? "Personel" : "Yönetici";
    scopeInput.value = state.scope;
    scopeLabel.textContent = label;
    pageTitle.textContent = `${label} Şifre Yenileme`;
    document.title = `${label} Şifre Yenileme | Tahmisçi`;
    pageIntro.textContent = `${label} hesabınıza ait doğrulanmış e-postaya gönderilen tek kullanımlık kodla şifrenizi yenileyin.`;
    loginLink.href = context.returnTo;
    loginLink.textContent = `← ${label} girişine dön`;
  }

  async function requestCode(isResend) {
    if (state.busy) return;
    const identifier = identifierInput.value.trim();
    if (!identifier || identifier.length > 254) {
      showStatus("Kullanıcı adınızı veya e-posta adresinizi girin.", "error");
      identifierInput.focus();
      return;
    }
    state.identifier = identifier;
    setBusy(true, isResend ? "Tekrar gönderiliyor..." : "Kod gönderiliyor...");
    try {
      const result = await resetApi("request", {
        scope: state.scope,
        identifier,
        returnTo: context.returnTo,
        challengeId: isResend ? state.challengeId || undefined : undefined
      });
      state.challengeId = String(result.challengeId || result.requestId || state.challengeId || "");
      maskedEmail.textContent = String(result.maskedEmail || "doğrulanmış hesap e-postanıza");
      showStatus(GENERIC_MESSAGE, "success");
      if (state.challengeId) {
        requestForm.hidden = true;
        confirmForm.hidden = false;
        clearOtp();
        window.setTimeout(() => otpInputs[0].focus(), 40);
      }
    } catch (error) {
      showStatus(error.message || "Doğrulama kodu gönderilemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (state.busy) return;
    const code = otpInputs.map((input) => input.value).join("");
    const password = newPasswordInput.value;
    if (!state.challengeId) {
      showStatus("Kurtarma isteği geçersiz. Yeni kod isteyin.", "error");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      showStatus("Altı haneli doğrulama kodunu eksiksiz girin.", "error");
      otpInputs.find((input) => !input.value)?.focus();
      return;
    }
    if (!passwordIsValid(password)) {
      showStatus("Şifre en az 10 karakter olmalı, bir harf ve bir rakam içermelidir.", "error");
      newPasswordInput.focus();
      return;
    }
    setBusy(true, "Şifre güncelleniyor...");
    try {
      const result = await resetApi("confirm", {
        challengeId: state.challengeId,
        scope: state.scope,
        identifier: state.identifier,
        code,
        newPassword: password
      });
      showStatus(result.message || "Şifre başarıyla güncellendi. Tüm açık oturumlar kapatıldı.", "success");
      confirmButton.textContent = "Şifre güncellendi";
      const destination = safeReturnTo(result.redirectTo, state.scope) || context.returnTo;
      window.setTimeout(() => { window.location.href = destination; }, 1000);
    } catch (error) {
      showStatus(error.message || "Şifre güncellenemedi.", "error");
      if ([400, 401].includes(Number(error.status))) otpInputs[0].focus();
    } finally {
      setBusy(false);
    }
  }

  async function resetApi(action, body) {
    const paths = [`/api/account/password-reset/${encodeURIComponent(state.scope)}/${action}`];
    if (state.scope === "admin") paths.push(`/api/admin/password-reset/${action}`);
    let lastError = null;
    for (const path of paths) {
      try { return await postJson(path, body); } catch (error) {
        lastError = error;
        if (Number(error.status) !== 404) throw error;
      }
    }
    throw lastError || new Error("İşlem tamamlanamadı.");
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İşlem tamamlanamadı.");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function setBusy(busy, message) {
    state.busy = busy;
    [requestButton, confirmButton, sendAgainButton, changeAccountButton].forEach((button) => { button.disabled = busy; });
    identifierInput.disabled = busy || requestForm.hidden;
    otpInputs.forEach((input) => { input.disabled = busy; });
    newPasswordInput.disabled = busy;
    if (busy && message) showStatus(message);
    requestButton.textContent = busy ? "Lütfen bekleyin..." : "Doğrulama kodu gönder";
    if (confirmButton.textContent !== "Şifre güncellendi") confirmButton.textContent = busy ? "Güncelleniyor..." : "Şifreyi değiştir";
  }

  function resetToRequest() {
    if (state.busy) return;
    state.challengeId = "";
    state.identifier = "";
    confirmForm.hidden = true;
    requestForm.hidden = false;
    identifierInput.disabled = false;
    newPasswordInput.value = "";
    clearOtp();
    renderPasswordRules();
    showStatus("Hesabınıza ait kullanıcı adını veya e-postayı girin.");
    identifierInput.focus();
  }

  function handleOtpInput(input, index) {
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value && index < otpInputs.length - 1) otpInputs[index + 1].focus();
  }
  function handleOtpKeydown(event, index) {
    if (event.key === "Backspace" && !otpInputs[index].value && index > 0) otpInputs[index - 1].focus();
    if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); otpInputs[index - 1].focus(); }
    if (event.key === "ArrowRight" && index < otpInputs.length - 1) { event.preventDefault(); otpInputs[index + 1].focus(); }
  }
  function handleOtpPaste(event) {
    const digits = String(event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    otpInputs.forEach((input, index) => { input.value = digits[index] || ""; });
    otpInputs[Math.min(digits.length, 6) - 1].focus();
  }
  function clearOtp() { otpInputs.forEach((input) => { input.value = ""; }); }
  function passwordIsValid(value) { return value.length >= 10 && value.length <= 72 && /[a-zA-ZÇĞİÖŞÜçğıöşü]/.test(value) && /\d/.test(value); }
  function renderPasswordRules() {
    const value = newPasswordInput.value;
    document.getElementById("ruleLength").classList.toggle("is-valid", value.length >= 10 && value.length <= 72);
    document.getElementById("ruleLetter").classList.toggle("is-valid", /[a-zA-ZÇĞİÖŞÜçğıöşü]/.test(value));
    document.getElementById("ruleNumber").classList.toggle("is-valid", /\d/.test(value));
  }
  function togglePassword() {
    const visible = newPasswordInput.type === "text";
    newPasswordInput.type = visible ? "password" : "text";
    passwordToggle.textContent = visible ? "Göster" : "Gizle";
    passwordToggle.setAttribute("aria-pressed", String(!visible));
    newPasswordInput.focus();
  }
  function showStatus(message, kind) {
    statusBox.textContent = message;
    statusBox.classList.toggle("is-error", kind === "error");
    statusBox.classList.toggle("is-success", kind === "success");
  }

  renderPasswordRules();
})();
