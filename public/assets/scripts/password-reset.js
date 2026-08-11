(function () {
  "use strict";

  const requestForm = document.getElementById("requestForm");
  const confirmForm = document.getElementById("confirmForm");
  const emailInput = document.getElementById("emailInput");
  const personelField = document.getElementById("personelField");
  const personelInput = document.getElementById("personelInput");
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
  const state = { busy: false, challengeId: "", scope: "admin", userId: "", maskedEmail: "", accountsLoaded: false };

  requestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    requestCode(false).catch(() => {});
  });
  confirmForm.addEventListener("submit", submitPassword);
  sendAgainButton.addEventListener("click", () => requestCode(true).catch(() => {}));
  changeAccountButton.addEventListener("click", resetToRequest);
  passwordToggle.addEventListener("click", togglePassword);
  newPasswordInput.addEventListener("input", renderPasswordRules);
  document.querySelectorAll('input[name="scope"]').forEach((input) => input.addEventListener("change", handleScopeChange));
  otpInputs.forEach((input, index) => {
    input.addEventListener("input", () => handleOtpInput(input, index));
    input.addEventListener("keydown", (event) => handleOtpKeydown(event, index));
    input.addEventListener("paste", handleOtpPaste);
  });

  function selectedScope() {
    return document.querySelector('input[name="scope"]:checked').value;
  }

  function handleScopeChange() {
    state.scope = selectedScope();
    state.userId = "";
    state.accountsLoaded = false;
    personelInput.innerHTML = '<option value="">Hesaplar güvenli doğrulamadan sonra listelenir</option>';
    personelInput.disabled = true;
    personelField.hidden = state.scope !== "personel";
    requestButton.textContent = state.scope === "personel" ? "Personel hesaplarını doğrula" : "Doğrulama kodu gönder";
    loginLink.href = state.scope === "personel" ? "/personel/" : "/login.html";
  }

  async function requestCode(isResend) {
    if (state.busy) return;
    state.scope = selectedScope();
    const email = emailInput.value.trim();
    if (!emailInput.checkValidity()) {
      showStatus("Geçerli bir e-posta adresi girin.", "error");
      emailInput.focus();
      return;
    }
    const selectedUserId = state.scope === "personel" && !personelInput.disabled ? personelInput.value : state.userId;
    if (state.scope === "personel" && !personelInput.disabled && !selectedUserId) {
      showStatus("Şifresi değiştirilecek personel hesabını seçin.", "error");
      personelInput.focus();
      return;
    }
    setBusy(true, isResend ? "Tekrar gönderiliyor..." : "Kod gönderiliyor...");
    try {
      const result = await api("/api/admin/password-reset/request", {
        email,
        scope: state.scope,
        userId: selectedUserId || undefined
      });
      if (result.requiresPersonelSelection) {
        const accounts = Array.isArray(result.personelAccounts) ? result.personelAccounts : [];
        state.accountsLoaded = true;
        personelInput.innerHTML = '<option value="">Personel hesabı seçin</option>' + accounts.map((user) => (
          `<option value="${escapeAttribute(user.id)}">${escapeHtml(user.name)} · @${escapeHtml(user.username)}</option>`
        )).join("");
        personelInput.disabled = false;
        personelField.hidden = false;
        requestButton.textContent = "Doğrulama kodu gönder";
        showStatus(result.message || "Personel hesabını seçin.");
        personelInput.focus();
        return;
      }
      if (!result.challengeId) {
        showStatus(result.message || "Eğer bilgiler yetkiliyse doğrulama kodu gönderildi.");
        return;
      }
      state.challengeId = result.challengeId;
      state.userId = result.userId || selectedUserId || "";
      state.maskedEmail = result.maskedEmail || "yetkili e-posta adresi";
      maskedEmail.textContent = state.maskedEmail;
      requestForm.hidden = true;
      confirmForm.hidden = false;
      clearOtp();
      showStatus(result.message || "Doğrulama kodu gönderildi.", "success");
      window.setTimeout(() => otpInputs[0].focus(), 40);
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
      const result = await api("/api/admin/password-reset/confirm", {
        challengeId: state.challengeId,
        email: emailInput.value.trim(),
        scope: state.scope,
        userId: state.userId || undefined,
        code,
        newPassword: password
      });
      showStatus(result.message || "Şifre başarıyla güncellendi.", "success");
      confirmButton.textContent = "Şifre güncellendi";
      window.setTimeout(() => {
        window.location.href = result.redirectTo || (state.scope === "personel" ? "/personel/" : "/login.html");
      }, 1100);
    } catch (error) {
      showStatus(error.message || "Şifre güncellenemedi.", "error");
      if (Number(error.status) === 401) otpInputs[0].focus();
    } finally {
      setBusy(false);
    }
  }

  async function api(path, body) {
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
    document.querySelectorAll('input[name="scope"], #emailInput').forEach((control) => { control.disabled = busy; });
    personelInput.disabled = busy || !state.accountsLoaded;
    if (busy && message) showStatus(message);
    requestButton.textContent = busy ? "Lütfen bekleyin..." : (state.scope === "personel" && !state.accountsLoaded ? "Personel hesaplarını doğrula" : "Doğrulama kodu gönder");
    confirmButton.textContent = busy ? "Güncelleniyor..." : "Şifreyi değiştir";
  }

  function resetToRequest() {
    if (state.busy) return;
    state.challengeId = "";
    state.userId = "";
    confirmForm.hidden = true;
    requestForm.hidden = false;
    newPasswordInput.value = "";
    clearOtp();
    renderPasswordRules();
    showStatus("Hesap türünü ve yetkili e-postayı yeniden seçebilirsiniz.");
    emailInput.focus();
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
  function passwordIsValid(value) { return value.length >= 10 && value.length <= 72 && /[a-zA-Z]/.test(value) && /\d/.test(value); }
  function renderPasswordRules() {
    const value = newPasswordInput.value;
    document.getElementById("ruleLength").classList.toggle("is-valid", value.length >= 10 && value.length <= 72);
    document.getElementById("ruleLetter").classList.toggle("is-valid", /[a-zA-Z]/.test(value));
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
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }

  handleScopeChange();
  renderPasswordRules();
})();
