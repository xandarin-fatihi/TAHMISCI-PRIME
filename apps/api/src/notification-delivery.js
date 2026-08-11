"use strict";

const crypto = require("crypto");
const { getNotificationPreferences } = require("./notification-service");

const RETRY_DELAYS_MS = Object.freeze([60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000]);

function createNotificationDeliveryWorker(options) {
  const {
    store,
    config = {},
    mailService,
    pushService,
    logError = console.error,
    clock = () => new Date(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = options || {};
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("Bildirim teslim işçisi için geçerli store gerekli.");
  }
  const workerId = `notification-worker-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const maxAttempts = Math.max(1, Number(config.notificationMaxAttempts || 5));
  const batchSize = Math.max(1, Math.min(100, Number(config.notificationWorkerBatchSize || 20)));
  const intervalMs = Math.max(1000, Number(config.notificationWorkerIntervalMs || 15000));
  let timer = null;
  let running = false;
  let stopped = true;

  async function tick() {
    if (running) return { processed: 0, skipped: "running" };
    running = true;
    let processed = 0;
    let sent = 0;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const claimed = await claimNext();
        if (!claimed) break;
        const result = await deliver(claimed);
        processed += 1;
        if (result && result.sent) sent += 1;
      }
      const now = nowDate(clock).toISOString();
      await updateSchedulerState({ lastOutboxRunAt: now, ...(sent ? { lastOutboxSuccessAt: now } : {}) });
      return { processed, sent };
    } finally {
      running = false;
    }
  }

  async function claimNext() {
    let claimed = null;
    const now = nowDate(clock);
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    await store.update((data) => {
      data.notificationOutbox = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
      for (const item of data.notificationOutbox) {
        if (item && item.status === "processing" && item.lockedAt && item.lockedAt < staleBefore) {
          item.status = "pending";
          item.lockedAt = null;
          item.lockedBy = "";
        }
      }
      const candidate = data.notificationOutbox
        .filter((item) => item && item.status === "pending"
          && Number(item.attemptCount || 0) < maxAttempts
          && (!item.nextAttemptAt || !Number.isFinite(Date.parse(item.nextAttemptAt)) || Date.parse(item.nextAttemptAt) <= now.getTime()))
        .sort((left, right) => String(left.nextAttemptAt || left.createdAt || "").localeCompare(String(right.nextAttemptAt || right.createdAt || "")))[0];
      if (!candidate) return data;
      candidate.status = "processing";
      candidate.lockedAt = now.toISOString();
      candidate.lockedBy = workerId;
      candidate.lastAttemptAt = now.toISOString();
      candidate.attemptCount = Math.max(0, Number(candidate.attemptCount || 0)) + 1;
      candidate.updatedAt = now.toISOString();
      claimed = { ...candidate };
      return data;
    });
    return claimed;
  }

  async function deliver(item) {
    const snapshot = await store.read();
    const notification = (snapshot.notifications || []).find((entry) => entry && entry.id === item.notificationId);
    if (!notification) return finish(item, permanentError("Bildirim kaydı bulunamadı.", "NOTIFICATION_MISSING"));
    if (!recipientIsActive(snapshot, notification.recipientRole, notification.recipientId)) {
      await removeRecipientSubscriptions(notification.recipientRole, notification.recipientId);
      return cancel(item, "Alıcı hesabı aktif değil.");
    }
    try {
      const preference = getNotificationPreferences(snapshot, notification.recipientRole, notification.recipientId);
      const quietUntil = notification.severity === "critical" ? null : quietHoursEnd(preference, nowDate(clock));
      if (quietUntil) return defer(item, quietUntil);
      if (item.channel === "email") {
        if (!preference.emailEnabled || !preference.emailAddress || preference.emailAddress !== String(item.destination || "").toLowerCase()) {
          return cancel(item, "E-posta bildirimi alıcı tarafından kapatıldı.");
        }
        const emailConfigured = mailService && typeof mailService.sendNotificationEmail === "function"
          && (typeof mailService.isConfigured !== "function" || mailService.isConfigured());
        if (config.notificationsEmailEnabled === false || !emailConfigured) {
          throw permanentError("E-posta bildirim kanalı yapılandırılmamış.", "EMAIL_NOT_CONFIGURED");
        }
        await mailService.sendNotificationEmail(notification, item.destination);
      } else if (item.channel === "push") {
        if (!preference.pushEnabled) return cancel(item, "Push bildirimi alıcı tarafından kapatıldı.");
        const pushConfigured = pushService && typeof pushService.sendNotificationPush === "function"
          && (typeof pushService.isConfigured !== "function" || pushService.isConfigured());
        if (!pushConfigured) {
          throw permanentError("Web Push kanalı yapılandırılmamış.", "PUSH_NOT_CONFIGURED");
        }
        const subscription = (snapshot.pushSubscriptions || []).find((entry) => entry && !entry.disabledAt
          && entry.ownerRole === notification.recipientRole
          && String(entry.ownerId) === String(notification.recipientId)
          && (entry.id === item.subscriptionId || entry.endpoint === item.destination));
        if (!subscription) throw permanentError("Push aboneliği bulunamadı.", "PUSH_SUBSCRIPTION_MISSING");
        await pushService.sendNotificationPush(notification, subscription.subscription || subscription);
        await recordPushSuccess(subscription.id);
      } else {
        throw permanentError("Desteklenmeyen bildirim kanalı.", "UNSUPPORTED_CHANNEL");
      }
      await finish(item, null);
      return { sent: true };
    } catch (error) {
      const statusCode = Number(error && (error.statusCode || error.status) || 0);
      const permanent = Boolean(error && error.permanent)
        || [404, 410].includes(statusCode)
        || ["SMTP_NOT_CONFIGURED", "EMAIL_NOT_CONFIGURED", "PUSH_NOT_CONFIGURED", "INVALID_EMAIL_DESTINATION", "PUSH_SUBSCRIPTION_MISSING", "UNSUPPORTED_CHANNEL"].includes(error && error.code);
      if (item.channel === "push") {
        if ([404, 410].includes(statusCode)) await removePushSubscription(item);
        else if (!permanent) await recordPushFailure(item);
      }
      if (!permanent) logError("Bildirim teslimi başarısız", safeDeliveryError(error));
      await finish(item, error, permanent);
      return { sent: false, permanent };
    }
  }

  async function finish(item, error, permanent = Boolean(error && error.permanent)) {
    const now = nowDate(clock);
    await store.update((data) => {
      const current = (data.notificationOutbox || []).find((entry) => entry && entry.id === item.id);
      if (!current || current.status !== "processing" || current.lockedBy !== workerId) return data;
      current.lockedAt = null;
      current.lockedBy = "";
      current.updatedAt = now.toISOString();
      if (!error) {
        current.status = "sent";
        current.sentAt = now.toISOString();
        current.nextAttemptAt = null;
        current.lastError = "";
      } else {
        const exhausted = Number(current.attemptCount || 0) >= maxAttempts;
        current.status = permanent || exhausted ? "failed" : "pending";
        current.lastError = safeStoredError(error);
        current.nextAttemptAt = current.status === "pending"
          ? new Date(now.getTime() + retryDelayMs(current.attemptCount)).toISOString()
          : null;
      }
      return data;
    });
  }

  async function cancel(item, reason) {
    const now = nowDate(clock).toISOString();
    await store.update((data) => {
      const current = (data.notificationOutbox || []).find((entry) => entry && entry.id === item.id);
      if (!current || current.status !== "processing" || current.lockedBy !== workerId) return data;
      current.status = "cancelled";
      current.lockedAt = null;
      current.lockedBy = "";
      current.nextAttemptAt = null;
      current.lastError = String(reason || "Teslim iptal edildi.").slice(0, 500);
      current.updatedAt = now;
      return data;
    });
    return { sent: false, cancelled: true };
  }

  async function defer(item, until) {
    const nextAttemptAt = until.toISOString();
    await store.update((data) => {
      const current = (data.notificationOutbox || []).find((entry) => entry && entry.id === item.id);
      if (!current || current.status !== "processing" || current.lockedBy !== workerId) return data;
      current.status = "pending";
      current.attemptCount = Math.max(0, Number(current.attemptCount || 0) - 1);
      current.nextAttemptAt = nextAttemptAt;
      current.lockedAt = null;
      current.lockedBy = "";
      current.lastError = "";
      current.updatedAt = nowDate(clock).toISOString();
      return data;
    });
    return { sent: false, deferred: true, nextAttemptAt };
  }

  async function removePushSubscription(item) {
    await store.update((data) => {
      data.pushSubscriptions = (data.pushSubscriptions || []).filter((entry) => !(entry
        && (entry.id === item.subscriptionId || entry.endpoint === item.destination)));
      return data;
    });
  }

  async function removeRecipientSubscriptions(role, id) {
    await store.update((data) => {
      data.pushSubscriptions = (data.pushSubscriptions || []).filter((entry) => !(entry
        && entry.ownerRole === role && String(entry.ownerId) === String(id)));
      for (const entry of data.notificationOutbox || []) {
        if (entry && entry.recipientRole === role && String(entry.recipientId) === String(id)
          && ["pending", "processing"].includes(entry.status)) {
          entry.status = "cancelled";
          entry.lockedAt = null;
          entry.lockedBy = "";
          entry.nextAttemptAt = null;
          entry.lastError = "Alıcı hesabı aktif değil.";
          entry.updatedAt = nowDate(clock).toISOString();
        }
      }
      return data;
    });
  }

  async function recordPushSuccess(subscriptionId) {
    const timestamp = nowDate(clock).toISOString();
    await store.update((data) => {
      const subscription = (data.pushSubscriptions || []).find((entry) => entry && entry.id === subscriptionId);
      if (subscription) {
        subscription.lastSuccessAt = timestamp;
        subscription.failureCount = 0;
        subscription.updatedAt = timestamp;
      }
      return data;
    });
  }

  async function recordPushFailure(item) {
    const timestamp = nowDate(clock).toISOString();
    await store.update((data) => {
      const subscription = (data.pushSubscriptions || []).find((entry) => entry
        && (entry.id === item.subscriptionId || entry.endpoint === item.destination));
      if (subscription) {
        subscription.failureCount = Math.max(0, Number(subscription.failureCount || 0)) + 1;
        subscription.updatedAt = timestamp;
      }
      return data;
    });
  }

  async function retry(outboxId) {
    const id = String(outboxId || "").trim();
    if (!id || id.length > 180) throw requestError(400, "Geçerli bir teslim kaydı kimliği gerekli.");
    let updated = null;
    await store.update((data) => {
      const item = (data.notificationOutbox || []).find((entry) => entry && entry.id === id);
      if (!item) throw requestError(404, "Bildirim teslim kaydı bulunamadı.");
      if (item.status === "sent") throw requestError(409, "Başarıyla teslim edilen bildirim yeniden gönderilemez.");
      if (["pending", "processing"].includes(item.status)) throw requestError(409, "Bildirim teslimi zaten bekliyor veya işleniyor.");
      const now = nowDate(clock).toISOString();
      item.status = "pending";
      item.attemptCount = 0;
      item.nextAttemptAt = now;
      item.lockedAt = null;
      item.lockedBy = "";
      item.lastError = "";
      item.updatedAt = now;
      updated = { ...item };
      return data;
    });
    queueMicrotask(() => void tick().catch((error) => logError("Bildirim teslimi yeniden denenemedi", safeDeliveryError(error))));
    return updated;
  }

  async function health() {
    const data = await store.read();
    const items = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
    const count = (status, channel) => items.filter((item) => item && item.status === status && (!channel || item.channel === channel)).length;
    const sent = count("sent");
    return {
      pending: count("pending"),
      processing: count("processing"),
      failed: count("failed"),
      cancelled: count("cancelled"),
      sent,
      delivered: sent,
      email: { pending: count("pending", "email"), sent: count("sent", "email"), failed: count("failed", "email") },
      push: { pending: count("pending", "push"), sent: count("sent", "push"), failed: count("failed", "push") },
      invalidPushSubscriptions: (data.pushSubscriptions || []).filter((item) => item && (item.disabledAt || Number(item.failureCount || 0) >= 3)).length,
      lastProcessedAt: data.notificationSchedulerState && data.notificationSchedulerState.lastOutboxRunAt || null,
      lastSuccessAt: data.notificationSchedulerState && data.notificationSchedulerState.lastOutboxSuccessAt || null,
      workerRunning: !stopped
    };
  }

  async function updateSchedulerState(patch) {
    await store.update((data) => {
      data.notificationSchedulerState = {
        ...(data.notificationSchedulerState || {}),
        ...patch,
        updatedAt: nowDate(clock).toISOString()
      };
      return data;
    });
  }

  function start() {
    if (timer) return;
    stopped = false;
    timer = setIntervalFn(() => void tick().catch((error) => logError("Bildirim outbox işçisi hatası", safeDeliveryError(error))), intervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    queueMicrotask(() => void tick().catch((error) => logError("Bildirim outbox başlatma hatası", safeDeliveryError(error))));
  }

  async function stop() {
    stopped = true;
    if (timer) clearIntervalFn(timer);
    timer = null;
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return { health, retry, start, stop, tick, workerId };
}

function retryDelayMs(attempt) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Number(attempt || 1) - 1));
  return RETRY_DELAYS_MS[index];
}

function quietHoursEnd(preference, now) {
  if (!preference || preference.quietHoursEnabled !== true) return null;
  const start = clockMinutes(preference.quietHoursStart);
  const end = clockMinutes(preference.quietHoursEnd);
  if (start < 0 || end < 0 || start === end) return null;
  const current = zonedClockMinutes(now, preference.timezone || "Europe/Istanbul");
  if (current < 0) return null;
  const active = start < end ? current >= start && current < end : current >= start || current < end;
  if (!active) return null;
  const delayMinutes = current < end ? end - current : (24 * 60 - current) + end;
  return new Date(now.getTime() + Math.max(1, delayMinutes) * 60 * 1000);
}

function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : -1;
}

function zonedClockMinutes(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const hours = Number(parts.find((part) => part.type === "hour")?.value);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isInteger(hours) && Number.isInteger(minutes) ? hours * 60 + minutes : -1;
  } catch (_error) {
    return -1;
  }
}

function recipientIsActive(data, role, id) {
  if (role === "manager") return true;
  const users = Array.isArray(data.recipeUsers) ? data.recipeUsers : [];
  if (!users.length) return true;
  const user = users.find((item) => item && String(item.id) === String(id));
  return Boolean(user && user.active !== false);
}

function permanentError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.permanent = true;
  return error;
}

function requestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowDate(clock) {
  const candidate = typeof clock === "function" ? clock() : new Date();
  const date = candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function safeStoredError(error) {
  const code = String(error && error.code || "").slice(0, 80);
  const message = String(error && error.message || "Teslim hatası")
    .replace(/(?:smtp|https?):\/\/[^\s]+/gi, "teslim kanalı")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "***@***")
    .slice(0, 400);
  return [code, message].filter(Boolean).join(": ").slice(0, 500);
}

function safeDeliveryError(error) {
  return {
    code: String(error && error.code || ""),
    status: Number(error && (error.statusCode || error.status) || 0),
    message: safeStoredError(error).slice(0, 300)
  };
}

module.exports = { RETRY_DELAYS_MS, createNotificationDeliveryWorker, quietHoursEnd, retryDelayMs };
