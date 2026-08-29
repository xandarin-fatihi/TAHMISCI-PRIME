"use strict";

const { APP_ROOTS, normalizeAppTarget, safeAppDeepLink } = require("./app-targets");

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
    const appTarget = normalizeAppTarget(notification && notification.appTarget, notification && notification.deepLink, role);
    const fallbackLink = APP_ROOTS[appTarget];
    const deepLink = safeAppDeepLink(notification && notification.deepLink, appTarget, fallbackLink);
    const iconRoot = `/assets/app-icons/${appTarget}`;
    const notificationId = String(notification && notification.id || "").replace(/[\r\n\u0000-\u001f\u007f]+/g, "").slice(0, 180);
    const payload = JSON.stringify({
      title: String(notification && notification.title || "Tahmisçi bildirimi").replace(/[\r\n]+/g, " ").slice(0, 180),
      body: String(notification && notification.body || "").replace(/[\r\n]+/g, " ").slice(0, 500),
      icon: `${iconRoot}/icon-192.png`,
      badge: `${iconRoot}/icon-192.png`,
      tag: `tahmisci-${role}-${notificationId || "notification"}`.slice(0, 240),
      renotify: false,
      vibrate: notification && notification.severity === "critical" ? [180, 80, 180, 80, 240] : [120, 60, 120],
      requireInteraction: notification && notification.severity === "critical",
      deepLink,
      appTarget,
      id: notificationId,
      data: {
        notificationId,
        deepLink,
        appTarget,
        category: String(notification && notification.category || "system").slice(0, 40),
        recipientRole: role
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

function safeDeepLink(value, fallback, appTarget = "personel") {
  return safeAppDeepLink(value, appTarget, fallback);
}

module.exports = { createPushService, safeDeepLink };
