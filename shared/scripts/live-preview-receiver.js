(function () {
  "use strict";

  const MESSAGE_TYPE = "tahmisci:preview-draft";
  const READY_TYPE = "tahmisci:preview-ready";
  const ERROR_TYPE = "tahmisci:preview-error";
  const SCHEMA_VERSION = 1;
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") !== "admin") return;

  const previewSession = String(params.get("previewToken") || "").trim();
  const requestedSection = String(params.get("section") || "recipe").trim().slice(0, 40);
  let parentOrigin = referrerOrigin();
  let allowedOrigins = new Set();
  let previewSessionValid = false;
  let previewExpiryTimer = 0;

  const configPromise = loadPreviewConfig();
  window.addEventListener("message", handlePreviewMessage);
  document.addEventListener("DOMContentLoaded", initializePreviewReceiver);

  async function loadPreviewConfig() {
    if (!previewSession) throw new Error("Önizleme oturumu bulunamadı.");
    const [configResponse, sessionResponse] = await Promise.all([
      fetch("/api/public/preview-config", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      }),
      fetch("/api/public/preview-session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ previewToken: previewSession })
      })
    ]);
    const [result, session] = await Promise.all([
      configResponse.json().catch(() => ({})),
      sessionResponse.json().catch(() => ({}))
    ]);
    if (!configResponse.ok || result.ok === false || result.schemaVersion !== SCHEMA_VERSION) {
      throw new Error("Önizleme origin yapılandırması alınamadı.");
    }
    if (!sessionResponse.ok || session.ok === false || session.schemaVersion !== SCHEMA_VERSION) {
      throw new Error("Önizleme oturumu doğrulanamadı.");
    }
    if (String(session.mode || "") !== expectedPreviewMode()) {
      throw new Error("Önizleme modu bu ekranla eşleşmiyor.");
    }
    allowedOrigins = new Set((Array.isArray(result.allowedOrigins) ? result.allowedOrigins : [])
      .map(normalizeOrigin)
      .filter(Boolean));
    if (!allowedOrigins.size) throw new Error("Önizleme origin listesi boş.");
    const expiresAt = Date.parse(session.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Önizleme oturumunun süresi dolmuş.");
    previewSessionValid = true;
    window.clearTimeout(previewExpiryTimer);
    previewExpiryTimer = window.setTimeout(() => {
      previewSessionValid = false;
      allowedOrigins.clear();
    }, Math.max(1, expiresAt - Date.now()));
    return allowedOrigins;
  }

  async function initializePreviewReceiver() {
    try {
      await configPromise;
      activateRequestedSection();
      window.setTimeout(activateRequestedSection, 300);
      if (parentOrigin && isAllowedOrigin(parentOrigin) && previewSession) {
        acknowledge(READY_TYPE, { section: requestedSection, status: "connected" });
      }
    } catch (_error) {
      // Güvenilir origin listesi yoksa mesaj kanalı bilerek açılmaz.
    }
  }

  async function handlePreviewMessage(event) {
    try {
      await configPromise;
    } catch (_error) {
      return;
    }
    if (!previewSessionValid || event.source !== window.parent || !isAllowedOrigin(event.origin)) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    parentOrigin = event.origin;

    const message = event.data;
    if (!message || typeof message !== "object" || message.type !== MESSAGE_TYPE) return;
    if (!previewSession || message.previewSession !== previewSession) return;
    if (!validDraftMessage(message)) {
      acknowledge(ERROR_TYPE, { code: "invalid-payload", message: "Geçersiz önizleme verisi." });
      return;
    }

    window.__TAHMISCI_PREVIEW_DRAFT__ = message.data;
    document.dispatchEvent(new CustomEvent(MESSAGE_TYPE, { detail: message }));
    acknowledge(READY_TYPE, {
      section: message.section || message.scope,
      draft: Boolean(message.draft),
      status: message.draft ? "draft" : "current"
    });
  }

  function validDraftMessage(message) {
    if (message.schemaVersion !== SCHEMA_VERSION) return false;
    if (!message.data || typeof message.data !== "object" || Array.isArray(message.data)) return false;
    if (!['menu', 'personel'].includes(String(message.source || ""))) return false;
    if (String(message.scope || "").length > 40 || String(message.section || "").length > 40) return false;
    return true;
  }

  function activateRequestedSection() {
    if (!window.CSS || typeof window.CSS.escape !== "function") return;
    const button = document.querySelector(`.personel-nav [data-section="${CSS.escape(requestedSection)}"]`);
    if (button) button.click();
  }

  function expectedPreviewMode() {
    if (!String(window.location.pathname || "").startsWith("/personel")) return "menu";
    return ["recipe", "stock", "tasks", "shipment", "shift"].includes(requestedSection)
      ? requestedSection
      : "recipe";
  }

  function acknowledge(type, detail) {
    if (window.parent === window || !parentOrigin || !isAllowedOrigin(parentOrigin)) return;
    window.parent.postMessage(Object.assign({
      type,
      schemaVersion: SCHEMA_VERSION,
      version: SCHEMA_VERSION,
      previewSession
    }, detail || {}), parentOrigin);
  }

  function isAllowedOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    return Boolean(normalized && allowedOrigins.has(normalized));
  }

  function referrerOrigin() {
    try {
      return document.referrer ? new URL(document.referrer).origin : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
    } catch (_error) {
      return "";
    }
  }
}());
