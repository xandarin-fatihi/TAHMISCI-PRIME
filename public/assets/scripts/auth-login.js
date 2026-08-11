"use strict";

if (window.location.pathname === "/login.html") {
  window.history.replaceState(null, "", "/yonetici/");
}

const TOKEN_KEY = "tahmisci.backend.panel.token";
const AUTH_KEY = "tahmisci.panel.auth.v2";
const form = document.getElementById("loginForm");
const passwordInput = document.getElementById("passwordInput");
const statusBox = document.getElementById("status");
const submitButton = form.querySelector("button[type='submit']");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusBox.textContent = "Doğrulanıyor...";
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false || !result.token) {
      throw new Error(result.message || "Giriş başarısız.");
    }
    window.sessionStorage.setItem(TOKEN_KEY, result.token);
    window.sessionStorage.setItem(AUTH_KEY, "ok");
    window.location.href = safeNextUrl();
  } catch (error) {
    statusBox.textContent = error.message || "Giriş başarısız.";
    passwordInput.value = "";
    passwordInput.select();
  } finally {
    submitButton.disabled = false;
  }
});

function safeNextUrl() {
  const fallback = "/yonetici/";
  const value = new URLSearchParams(window.location.search).get("next") || fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/^\/panel\/?(?:\?|$)/.test(value)) {
    return value.replace(/^\/panel\/?/, "/yonetici/");
  }
  if (/^\/yonetici(?:\/?(?:\?|$))/.test(value)) {
    return value.replace(/^\/yonetici(?:\/?)/, "/yonetici/");
  }
  return fallback;
}
