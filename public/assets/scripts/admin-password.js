"use strict";

const form = document.getElementById("passwordForm");
const statusBox = document.getElementById("status");
const submitButton = form.querySelector("button[type='submit']");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusBox.textContent = "Guncelleniyor...";
  submitButton.disabled = true;

  try {
    const formData = new FormData(form);
    const newPassword = String(formData.get("newPassword") || "");

    if (newPassword.length < 10 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      statusBox.textContent = "Sifre en az 10 karakter olmali, harf ve rakam icermeli.";
      return;
    }

    const response = await fetch("/api/admin/password", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Manager-Key": formData.get("managerKey")
      },
      body: JSON.stringify({
        newPassword
      })
    });

    const result = await response.json().catch(() => ({}));
    statusBox.textContent = result.message || (response.ok ? "Sifre guncellendi." : "Islem basarisiz.");

    if (response.ok) form.reset();
  } catch (error) {
    statusBox.textContent = error.message || "Backend baglantisi kurulamadi.";
  } finally {
    submitButton.disabled = false;
  }
});

