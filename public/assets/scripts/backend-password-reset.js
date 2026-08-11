"use strict";

const requestForm = document.getElementById("requestForm");
const confirmForm = document.getElementById("confirmForm");
const emailInput = document.getElementById("emailInput");
const scopeInput = document.getElementById("scopeInput");
const codeInput = document.getElementById("codeInput");
const newPasswordInput = document.getElementById("newPasswordInput");
const sendAgainButton = document.getElementById("sendAgainButton");
const statusBox = document.getElementById("status");

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await requestCode();
});

sendAgainButton.addEventListener("click", requestCode);

confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(confirmForm, true);
  showStatus("Sifre guncelleniyor...");

  try {
    const response = await fetch("/api/admin/password-reset/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailInput.value,
        scope: scopeInput.value,
        code: codeInput.value,
        newPassword: newPasswordInput.value
      })
    });
    const result = await response.json().catch(() => ({}));
    showStatus(result.message || (response.ok ? "Sifre guncellendi." : "Islem basarisiz."), !response.ok);
    if (response.ok) {
      const nextUrl = scopeInput.value === "recipe" ? "/recete/" : "/yonetici/";
      confirmForm.reset();
      window.setTimeout(() => {
        window.location.href = nextUrl;
      }, 1400);
    }
  } catch (error) {
    showStatus(error.message || "Backend baglantisi kurulamadi.", true);
  } finally {
    setBusy(confirmForm, false);
  }
});

async function requestCode() {
  setBusy(requestForm, true);
  setBusy(confirmForm, true);
  showStatus("Kod gonderiliyor...");

  try {
    const response = await fetch("/api/admin/password-reset/request", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput.value })
    });
    const result = await response.json().catch(() => ({}));
    showStatus(result.message || (response.ok ? "Kod gonderildi." : "Islem basarisiz."), !response.ok);
    if (response.ok) {
      confirmForm.hidden = false;
      window.setTimeout(() => codeInput.focus(), 60);
    }
  } catch (error) {
    showStatus(error.message || "Backend baglantisi kurulamadi.", true);
  } finally {
    setBusy(requestForm, false);
    setBusy(confirmForm, false);
  }
}

function showStatus(message, isError) {
  statusBox.textContent = message;
  statusBox.classList.toggle("is-error", Boolean(isError));
}

function setBusy(form, busy) {
  Array.from(form.querySelectorAll("button")).forEach((button) => {
    button.disabled = busy;
  });
}
