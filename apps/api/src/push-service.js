"use strict";

function createPushService(config = {}, options = {}) {
  let webPush = options.webPush || null;
  if (!webPush) {
    try { webPush = require("web-push"); } catch (_error) { webPush = null; }
  }
  let configurationError = null;
  let configured = Boolean(webPush && config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject);
  if (configured) {
    try {
      webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    } catch (error) {
      configured = false;
      configurationError = error;
    }
  }

  async function sendNotificationPush(notification, subscription) {
    if (!configured) {
      const error = new Error(configurationError
        ? "Web Push yapılandırması geçersiz."
        : "Web Push kanalı yapılandırılmamış.");
      error.code = "PUSH_NOT_CONFIGURED";
      error.permanent = true;
      throw error;
    }
    const role = notification && notification.recipientRole === "manager" ? "manager" : "personnel";
    const fallbackLink = role === "manager" ? "/yonetici/" : "/personel/";
    const deepLink = safeDeepLink(notification && notification.deepLink, fallbackLink);
    const iconRoot = role === "manager" ? "/assets/app-icons/yonetici" : "/assets/app-icons/personel";
    const payload = JSON.stringify({
      title: String(notification && notification.title || "Tahmisçi bildirimi").replace(/[\r\n]+/g, " ").slice(0, 180),
      body: String(notification && notification.body || "").replace(/[\r\n]+/g, " ").slice(0, 500),
      icon: `${iconRoot}/icon-192.png`,
      badge: `${iconRoot}/icon-192.png`,
      data: {
        notificationId: String(notification && notification.id || "").slice(0, 180),
        deepLink,
        category: String(notification && notification.category || "system").slice(0, 40)
      }
    });
    return webPush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: notification && notification.severity === "critical" ? "high" : "normal" });
  }

  return {
    isConfigured: () => configured,
    publicKey: configured ? config.vapidPublicKey : "",
    sendNotificationPush
  };
}

function safeDeepLink(value, fallback) {
  const link = String(value || "").trim().slice(0, 500);
  return link.startsWith("/") && !link.startsWith("//") && !/[\r\n]/.test(link) ? link : fallback;
}

module.exports = { createPushService };
