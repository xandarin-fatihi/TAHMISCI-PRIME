"use strict";

const nodemailer = require("nodemailer");

function createMailService(config, options = {}) {
  let transporter = null;
  const transportFactory = options.transportFactory || nodemailer.createTransport;

  function isConfigured() {
    return Boolean(config.smtpHost && config.smtpPort && config.smtpUser && config.smtpPass);
  }

  function getTransporter() {
    if (transporter) return transporter;
    if (!isConfigured()) {
      const error = new Error("SMTP bildirim kanalı yapılandırılmamış.");
      error.code = "SMTP_NOT_CONFIGURED";
      throw error;
    }
    transporter = transportFactory({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.smtpUser, pass: config.smtpPass },
      disableFileAccess: true,
      disableUrlAccess: true
    });
    return transporter;
  }

  async function sendNotificationEmail(notification, destination) {
    const to = String(destination || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      const error = new Error("Bildirim e-posta adresi geçersiz.");
      error.code = "INVALID_EMAIL_DESTINATION";
      throw error;
    }
    const title = String(notification && notification.title || "Tahmisçi bildirimi").replace(/[\r\n]+/g, " ").slice(0, 180);
    const body = String(notification && notification.body || "").slice(0, 1200);
    const deepLink = absoluteNotificationLink(notification, config);
    return getTransporter().sendMail({
      from: config.smtpFrom || config.smtpUser,
      to,
      disableFileAccess: true,
      disableUrlAccess: true,
      subject: `Tahmisçi | ${title}`,
      text: [title, "", body, deepLink].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.55;color:#2c1609\">",
        `<h2>${escapeHtml(title)}</h2>`,
        body ? `<p>${escapeHtml(body)}</p>` : "",
        deepLink ? `<p><a href=\"${escapeHtml(deepLink)}\">Tahmisçi panelinde aç</a></p>` : "",
        "</div>"
      ].join("")
    });
  }

  async function close() {
    if (transporter && typeof transporter.close === "function") transporter.close();
    transporter = null;
  }

  return { close, getTransporter, isConfigured, sendNotificationEmail };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteNotificationLink(notification, config) {
  const path = String(notification && notification.deepLink || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) return "";
  const role = notification && notification.recipientRole === "manager" ? "manager" : "personnel";
  const candidate = role === "manager"
    ? config.adminDomain || config.publicSiteUrl || config.mainDomain
    : config.publicSiteUrl || config.mainDomain;
  const origin = normalizeOrigin(candidate);
  if (!origin) return "";
  try { return new URL(path, `${origin}/`).toString(); } catch (_error) { return ""; }
}

function normalizeOrigin(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch (_error) {
    return "";
  }
}

module.exports = { absoluteNotificationLink, createMailService };
