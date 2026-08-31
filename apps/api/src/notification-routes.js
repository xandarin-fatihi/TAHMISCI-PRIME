"use strict";

const crypto = require("crypto");
const { APP_ROOTS, normalizeAppTarget } = require("./app-targets");
const {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  createNotificationInStore,
  getNotificationPreferences,
  isRetiredNotificationCategory,
  normalizeNotificationCategory,
  normalizeRole,
  publishNotificationEvent,
  publishNotificationStateEvent,
  recipientMatches,
  subscribeNotificationEvents,
  subscribeNotificationStateEvents,
  updateNotificationPreferencesInStore
} = require("./notification-service");

function registerNotificationRoutes(options) {
  const {
    app, store, auth, config, deliveryWorker, pushService,
    requireAdminRequestOrigin, requireAdminOrMainRequestOrigin,
    riskOperationLimiter = (_req, _res, next) => next()
  } = options;
  const personelGuards = [requireAdminOrMainRequestOrigin, auth.requireActivePersonel];
  const adminGuards = [requireAdminRequestOrigin, auth.requireAdmin];
  const mudavimGuards = [requireAdminOrMainRequestOrigin, auth.requireMudavim];
  let notificationEventRevision = 0;

  registerRecipientRoutes({ prefix: "/api/notifications", guards: personelGuards, role: "personnel" });
  registerRecipientRoutes({ prefix: "/api/admin/notifications", guards: adminGuards, role: "manager", admin: true });
  registerRecipientRoutes({ prefix: "/api/mudavim/notifications", guards: mudavimGuards, role: "mudavim" });

  function registerRecipientRoutes({ prefix, guards, role, admin = false }) {
    app.get(prefix, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        const result = listNotifications(data, owner, req.query || {});
        noStore(res).json({ ok: true, ...result });
      } catch (error) { next(error); }
    });

    app.get(`${prefix}/unread-count`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        noStore(res).json({ ok: true, unreadCount: unreadCount(data, owner) });
      } catch (error) { next(error); }
    });

    for (const action of ["read", "unread", "archive", "restore"]) {
      app.patch(`${prefix}/:id/${action}`, ...guards, async (req, res, next) => {
        try {
          const owner = recipientFromRequest(req, role);
          const notificationId = validateId(req.params.id, "Bildirim kimliği");
          let notification = null;
          const saved = await store.update((data) => {
            const item = findOwnedNotification(data, notificationId, owner);
            const timestamp = new Date().toISOString();
            if (action === "read") item.readAt = timestamp;
            if (action === "unread") item.readAt = null;
            if (action === "archive") item.archivedAt = timestamp;
            if (action === "restore") item.archivedAt = null;
            item.updatedAt = timestamp;
            notification = publicNotification(item);
            return data;
          });
          const count = unreadCount(saved, owner);
          publishNotificationStateEvent({
            recipientRole: owner.role, recipientId: owner.id, action,
            notificationId, notification, unreadCount: count, updatedAt: notification.updatedAt
          });
          noStore(res).json({ ok: true, notification, unreadCount: count });
        } catch (error) { next(error); }
      });
    }

    app.delete(`${prefix}/archive`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        let deletedCount = 0;
        const saved = await store.update((data) => {
          const archived = (data.notifications || [])
            .filter((item) => item && !isRetiredNotificationCategory(item.category, item.eventType)
              && recipientMatches(item, owner.role, owner.id) && item.archivedAt && !item.deletedAt);
          const archivedRecords = new Set(archived);
          const archivedIds = new Set(archived.map((item) => item.id));
          deletedCount = archived.length;
          if (!deletedCount) return data;
          data.notifications = (data.notifications || []).filter((item) => !archivedRecords.has(item));
          cancelNotificationOutbox(data, owner, archivedIds, "Bildirim arşivi kullanıcı tarafından temizlendi.");
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "archive-cleared",
          deletedCount, unreadCount: count, updatedAt: new Date().toISOString()
        });
        noStore(res).json({ ok: true, deletedCount, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/:id`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const notificationId = validateId(req.params.id, "Bildirim kimliği");
        const saved = await store.update((data) => {
          const owned = findOwnedNotification(data, notificationId, owner);
          data.notifications = (data.notifications || []).filter((item) => item !== owned);
          cancelNotificationOutbox(data, owner, new Set([notificationId]), "Bildirim kullanıcı tarafından silindi.");
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "deleted",
          notificationId, unreadCount: count, updatedAt: new Date().toISOString()
        });
        noStore(res).json({ ok: true, deletedId: notificationId, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/read-all`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const timestamp = new Date().toISOString();
        let updatedCount = 0;
        const saved = await store.update((data) => {
          for (const item of data.notifications || []) {
            if (!recipientMatches(item, owner.role, owner.id) || isRetiredNotificationCategory(item.category, item.eventType)
              || item.deletedAt || item.archivedAt || item.readAt || item.inAppVisible === false) continue;
            item.readAt = timestamp;
            item.updatedAt = timestamp;
            updatedCount += 1;
          }
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "read-all",
          updatedCount, unreadCount: count, updatedAt: timestamp
        });
        noStore(res).json({ ok: true, updatedCount, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.get(`${prefix}/preferences`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        const preferences = getNotificationPreferences(data, owner.role, owner.id);
        noStore(res).json({
          ok: true,
          preferences,
          capabilities: notificationCapabilities(pushService, preferences)
        });
      } catch (error) { next(error); }
    });

    const updatePreferences = async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        let preferences = null;
        await store.update((data) => {
          preferences = updateNotificationPreferencesInStore(data, owner.role, owner.id, req.body || {});
          return data;
        });
        noStore(res).json({ ok: true, preferences, capabilities: notificationCapabilities(pushService, preferences) });
      } catch (error) { next(error); }
    };
    app.put(`${prefix}/preferences`, ...guards, updatePreferences);
    app.patch(`${prefix}/preferences`, ...guards, updatePreferences);

    app.get(`${prefix}/push-subscriptions`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        const currentDeviceId = normalizedDeviceId(req.get("x-tahmisci-device-id"));
        const appTarget = requestPushAppTarget(req, owner);
        const devices = (data.pushSubscriptions || [])
          .filter((item) => pushSubscriptionMatches(item, owner, appTarget) && !item.revokedAt)
          .sort((a, b) => String(b.lastSeenAt || b.updatedAt || "").localeCompare(String(a.lastSeenAt || a.updatedAt || "")))
          .map((item) => publicPushDevice(item, currentDeviceId));
        noStore(res).json({ ok: true, devices, subscriptions: devices });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/push-subscriptions`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const subscription = validatePushSubscription(req.body && (req.body.subscription || req.body));
        const deviceId = normalizedDeviceId(req.body && req.body.deviceId || req.get("x-tahmisci-device-id"));
        const deviceName = normalizedDeviceName(req.body && req.body.deviceName, req.get("user-agent"));
        const appTarget = requestPushAppTarget(req, owner);
        let saved = null;
        await store.update((data) => {
          data.pushSubscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
          const foreign = data.pushSubscriptions.find((item) => item && !item.revokedAt && item.endpoint === subscription.endpoint
            && !pushSubscriptionMatches(item, owner));
          if (foreign) {
            const error = new Error("Bu Push aboneliği başka bir hesaba bağlı.");
            error.status = 409;
            throw error;
          }
          const currentByDevice = deviceId && data.pushSubscriptions.find((item) => pushSubscriptionMatches(item, owner, appTarget)
            && item.deviceId === deviceId);
          const currentByEndpoint = data.pushSubscriptions.find((item) => pushSubscriptionMatches(item, owner, appTarget)
            && item.endpoint === subscription.endpoint);
          const current = currentByDevice || currentByEndpoint;
          const timestamp = new Date().toISOString();
          const superseded = new Set();
          for (const item of data.pushSubscriptions) {
            if (!item || item === current || !pushSubscriptionMatches(item, owner)) continue;
            if (pushSubscriptionAppTarget(item) !== appTarget) continue;
            if (item.endpoint === subscription.endpoint || deviceId && item.deviceId === deviceId) superseded.add(item);
          }
          if (superseded.size) {
            const supersededIds = [...superseded].map((item) => item.id);
            const supersededEndpoints = [...superseded].map((item) => item.endpoint);
            data.pushSubscriptions = data.pushSubscriptions.filter((item) => !superseded.has(item));
            cancelPushOutbox(data, owner, supersededIds, supersededEndpoints, "Cihaz aboneliği yenilendi.", timestamp);
          }
          if (current && current.endpoint && current.endpoint !== subscription.endpoint) {
            cancelPushOutbox(data, owner, [current.id], [current.endpoint], "Cihaz aboneliği yenilendi.", timestamp);
          }
          saved = {
            id: current && current.id || `push-subscription-${crypto.randomUUID()}`,
            ownerRole: owner.role,
            ownerId: owner.id,
            appTarget,
            appId: appTarget,
            endpoint: subscription.endpoint,
            subscription,
            keys: subscription.keys,
            deviceId: deviceId || (current && current.deviceId) || "",
            deviceName: deviceName || (current && current.deviceName) || "Bu cihaz",
            userAgent: String(req.get("user-agent") || "").slice(0, 500),
            createdAt: (current && current.createdAt) || timestamp,
            updatedAt: timestamp,
            lastSeenAt: timestamp,
            lastSuccessAt: (current && current.lastSuccessAt) || null,
            failureCount: (current && current.failureCount) || 0,
            disabledAt: null,
            revokedAt: null
          };
          if (current) Object.assign(current, saved);
          else data.pushSubscriptions.push(saved);
          return data;
        });
        noStore(res).status(201).json({ ok: true, subscription: publicPushDevice(saved, deviceId, { includeEndpoint: true }) });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/push-subscriptions`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const endpoint = String(req.body && req.body.endpoint || "").trim();
        const appTarget = requestPushAppTarget(req, owner);
        if (!endpoint) throw badRequest("Push aboneliği endpoint bilgisi gerekli.");
        let removed = 0;
        await store.update((data) => {
          const timestamp = new Date().toISOString();
          const matches = (data.pushSubscriptions || []).filter((item) => pushSubscriptionMatches(item, owner, appTarget)
            && item.endpoint === endpoint && !item.revokedAt);
          for (const item of matches) {
            item.revokedAt = timestamp;
            item.updatedAt = timestamp;
          }
          removed = matches.length;
          cancelPushOutbox(data, owner, matches.map((item) => item.id), [endpoint], "Push aboneliği kullanıcı tarafından kaldırıldı.", timestamp);
          return data;
        });
        noStore(res).json({ ok: true, removed });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/push-subscriptions/:id`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const subscriptionId = validateId(req.params.id, "Cihaz kimliği");
        const appTarget = requestPushAppTarget(req, owner);
        let removed = 0;
        await store.update((data) => {
          const owned = (data.pushSubscriptions || []).find((item) => item && item.id === subscriptionId
            && pushSubscriptionMatches(item, owner, appTarget) && !item.revokedAt);
          if (!owned) throw notFound("Bağlı cihaz bulunamadı.");
          const timestamp = new Date().toISOString();
          owned.revokedAt = timestamp;
          owned.updatedAt = timestamp;
          cancelPushOutbox(data, owner, [owned.id], [owned.endpoint], "Cihaz bildirimi kullanıcı tarafından kapatıldı.", timestamp);
          removed = 1;
          return data;
        });
        noStore(res).json({ ok: true, removed, revokedId: subscriptionId });
      } catch (error) { next(error); }
    });

    if (!admin) {
      app.post(`${prefix}/test`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          if (!pushService || typeof pushService.isConfigured !== "function" || !pushService.isConfigured()
            || typeof pushService.sendNotificationPush !== "function") {
            throw httpError(503, "Telefon bildirimleri sunucuda henüz etkinleştirilmemiş.");
          }
          const owner = recipientFromRequest(req, role);
          const appTarget = requestPushAppTarget(req, owner);
          const requestedSubscriptionId = String(req.body && req.body.subscriptionId || "").trim();
          if (requestedSubscriptionId) validateId(requestedSubscriptionId, "Cihaz kimliği");
          const requestedDeviceId = normalizedDeviceId(req.body && req.body.deviceId || req.get("x-tahmisci-device-id"));
          const data = req.storeSnapshot || await store.read();
          const preference = getNotificationPreferences(data, owner.role, owner.id);
          const subscriptions = (data.pushSubscriptions || [])
            .filter((item) => pushSubscriptionMatches(item, owner, appTarget) && !item.disabledAt && !item.revokedAt)
            .sort((left, right) => String(right.lastSeenAt || right.updatedAt || right.createdAt || "")
              .localeCompare(String(left.lastSeenAt || left.updatedAt || left.createdAt || "")));
          const subscription = requestedSubscriptionId
            ? subscriptions.find((item) => item.id === requestedSubscriptionId)
            : requestedDeviceId
              ? subscriptions.find((item) => normalizedDeviceId(item.deviceId) === requestedDeviceId)
              : subscriptions[0];
          if (!subscription) throw httpError(409, "Bu hesap için etkin bir bildirim cihazı bulunamadı. Bildirimleri yeniden açın.");

          const notification = {
            id: `push-test-${crypto.randomUUID()}`,
            recipientRole: owner.role,
            recipientId: owner.id,
            category: "system",
            eventType: "notification_test",
            title: "Tahmisçi test bildirimi",
            body: "Telefon bildirimleri bu cihazda çalışıyor.",
            severity: "success",
            deepLink: appTarget === "personel" ? "/personel/#notifications" : APP_ROOTS[appTarget],
            appTarget
          };
          try {
            await pushService.sendNotificationPush(notification, subscription.subscription || subscription, {
              vibrationEnabled: preference.pushVibrationEnabled !== false
            });
          } catch (error) {
            const statusCode = Number(error && (error.statusCode || error.status) || 0);
            if ([404, 410].includes(statusCode)) {
              await disableOwnedPushSubscription(store, owner, subscription.id, statusCode);
              throw httpError(410, "Bildirim aboneliğinin süresi dolmuş. Bildirimleri yeniden açın.");
            }
            throw httpError(502, "Test bildirimi teslim edilemedi. Lütfen tekrar deneyin.");
          }
          const deliveredAt = new Date().toISOString();
          await store.update((snapshot) => {
            const current = (snapshot.pushSubscriptions || []).find((item) => item && item.id === subscription.id
              && pushSubscriptionMatches(item, owner) && !item.disabledAt && !item.revokedAt);
            if (current) {
              current.lastSuccessAt = deliveredAt;
              current.lastSeenAt = deliveredAt;
              current.updatedAt = deliveredAt;
              current.failureCount = 0;
            }
            return snapshot;
          });
          noStore(res).json({
            ok: true,
            delivered: true,
            deliveredAt,
            subscription: publicPushDevice({
              ...subscription,
              lastSuccessAt: deliveredAt,
              lastSeenAt: deliveredAt,
              updatedAt: deliveredAt
            }, requestedDeviceId)
          });
        } catch (error) { next(error); }
      });
    }

    app.get(`${prefix}/events`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        res.set({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "Content-Encoding": "identity"
        });
        res.flushHeaders();
        if (res.socket) res.socket.setTimeout(0);
        res.write("retry: 5000\n\n");
        let closed = false;
        const initialData = req.storeSnapshot || await store.read();
        let currentUnreadCount = unreadCount(initialData, owner);
        notificationEventRevision = Math.max(notificationEventRevision, newestNotificationRevision(initialData, owner));
        const lastEventId = Number(String(req.get("Last-Event-ID") || "").split(":").pop() || 0);
        writeSse(res, "ready", {
          revision: notificationEventRevision,
          scope: "notifications",
          action: "ready",
          requiresRefetch: Number.isSafeInteger(lastEventId) && lastEventId > 0 && lastEventId < notificationEventRevision,
          unreadCount: currentUnreadCount
        }, notificationEventRevision);
        const deliveredIds = new Set();
        const listener = (notification) => {
          if (closed || !recipientMatches(notification, owner.role, owner.id)
            || isRetiredNotificationCategory(notification.category, notification.eventType) || notification.inAppVisible === false) return;
          const notificationId = String(notification.id || "");
          if (notificationId && deliveredIds.has(notificationId)) return;
          if (notificationId) {
            deliveredIds.add(notificationId);
            if (deliveredIds.size > 200) deliveredIds.delete(deliveredIds.values().next().value);
          }
          if (!notification.archivedAt && !notification.readAt) currentUnreadCount += 1;
          notificationEventRevision = nextNotificationRevision(notificationEventRevision, notification);
          writeSse(res, "notification", {
            revision: notificationEventRevision,
            scope: "notifications",
            action: "created",
            requiresRefetch: false,
            notification: publicNotification(notification),
            unreadCount: currentUnreadCount
          }, notificationEventRevision);
        };
        const unsubscribe = subscribeNotificationEvents(listener);
        const stateListener = (event) => {
          if (closed || !recipientMatches(event, owner.role, owner.id)) return;
          if (Number.isSafeInteger(Number(event.unreadCount))) currentUnreadCount = Math.max(0, Number(event.unreadCount));
          notificationEventRevision = nextNotificationRevision(notificationEventRevision, { updatedAt: event.updatedAt });
          writeSse(res, "notification", {
            revision: notificationEventRevision,
            scope: "notifications",
            action: String(event.action || "updated"),
            requiresRefetch: true,
            notificationId: String(event.notificationId || ""),
            deletedCount: Math.max(0, Number(event.deletedCount || 0)),
            updatedCount: Math.max(0, Number(event.updatedCount || 0)),
            unreadCount: currentUnreadCount
          }, notificationEventRevision);
        };
        const unsubscribeState = subscribeNotificationStateEvents(stateListener);
        const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
        if (typeof heartbeat.unref === "function") heartbeat.unref();
        req.once("close", () => { closed = true; clearInterval(heartbeat); unsubscribe(); unsubscribeState(); });
      } catch (error) { next(error); }
    });

    if (admin) {
      app.post(`${prefix}/test`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          let notification = null;
          await store.update((data) => {
            notification = createNotificationInStore(data, {
              recipientRole: "manager",
              recipientId: "manager",
              category: "system",
              eventType: "notification_test",
              title: String(req.body && req.body.title || "Tahmisçi bildirim testi"),
              body: String(req.body && req.body.body || "Bildirim altyapısı çalışıyor."),
              severity: "success",
              deepLink: "/yonetici/",
              dedupeKey: `notification-test:${crypto.randomUUID()}`
            });
            return data;
          });
          publishNotificationEvent(notification);
          noStore(res).status(201).json({ ok: true, notification: publicNotification(notification) });
        } catch (error) { next(error); }
      });

      app.get(`${prefix}/delivery-health`, ...guards, async (_req, res, next) => {
        try { noStore(res).json({ ok: true, health: await deliveryWorker.health() }); } catch (error) { next(error); }
      });

      app.post(`${prefix}/outbox/:id/retry`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          const id = validateId(req.params.id, "Teslim kaydı kimliği");
          noStore(res).json({ ok: true, outbox: await deliveryWorker.retry(id) });
        } catch (error) { next(error); }
      });
    }
  }
}

function recipientFromRequest(req, role) {
  if (role === "manager") return { role: "manager", id: "manager" };
  if (role === "mudavim") {
    const id = String(req.mudavimUser && req.mudavimUser.id || req.mudavim && req.mudavim.userId || "").trim();
    if (!id) {
      const error = new Error("Aktif Müdavim hesabı gerekli.");
      error.status = 403;
      throw error;
    }
    return { role: "mudavim", id };
  }
  const id = String(req.recipeUser && req.recipeUser.id || req.recipe && req.recipe.userId || "").trim();
  if (!id) {
    const error = new Error("Aktif personel hesabı gerekli.");
    error.status = 403;
    throw error;
  }
  return { role: "personnel", id };
}

function listNotifications(data, owner, query) {
  const limitValue = query.limit === undefined || query.limit === "" ? 30 : Number(query.limit);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) throw badRequest("Limit 1 ile 100 arasında bir tam sayı olmalıdır.");
  const limit = limitValue;
  const category = parseCategoryFilter(query.category);
  const severity = parseSeverityFilter(query.severity);
  const cursor = String(query.cursor || "").trim();
  if (cursor.length > 180) throw badRequest("Bildirim imleci geçersiz.");
  const archivedOnly = String(query.archived || "") === "true" || String(query.status || "").toLowerCase() === "archived";
  const includeArchived = archivedOnly || String(query.includeArchived || "") === "true";
  let items = (data.notifications || []).filter((item) => item
    && recipientMatches(item, owner.role, owner.id)
    && !isRetiredNotificationCategory(item.category, item.eventType)
    && !item.deletedAt
    && item.inAppVisible !== false
    && (includeArchived || !item.archivedAt));
  if (archivedOnly) items = items.filter((item) => Boolean(item.archivedAt));
  if ([query.unread, query.unreadOnly].some((value) => String(value || "") === "true")) {
    items = items.filter((item) => !item.readAt && !item.archivedAt);
  }
  if (category) items = items.filter((item) => normalizeNotificationCategory(item.category) === category);
  if (severity) items = items.filter((item) => item.severity === severity);
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
  if (cursor) {
    const cursorIndex = items.findIndex((item) => item.id === cursor);
    if (cursorIndex < 0) throw badRequest("Bildirim imleci artık geçerli değil; listeyi yenileyin.");
    items = items.slice(cursorIndex + 1);
  }
  const page = items.slice(0, limit);
  return {
    notifications: page.map(publicNotification),
    unreadCount: unreadCount(data, owner),
    nextCursor: items.length > limit && page.length ? page[page.length - 1].id : null
  };
}

function unreadCount(data, owner) {
  return (data.notifications || []).filter((item) => item
    && recipientMatches(item, owner.role, owner.id)
    && !isRetiredNotificationCategory(item.category, item.eventType)
    && !item.deletedAt
    && item.inAppVisible !== false
    && !item.archivedAt
    && !item.readAt).length;
}

function findOwnedNotification(data, id, owner) {
  const item = (data.notifications || []).find((entry) => entry
    && entry.id === String(id || "")
    && !entry.deletedAt
    && !isRetiredNotificationCategory(entry.category, entry.eventType)
    && recipientMatches(entry, owner.role, owner.id));
  if (!item) {
    const error = new Error("Bildirim bulunamadı.");
    error.status = 404;
    throw error;
  }
  return item;
}

function publicNotification(item) {
  return {
    id: item.id,
    category: item.category,
    eventType: item.eventType,
    title: item.title,
    body: item.body,
    severity: item.severity,
    entityType: item.entityType || "",
    entityId: item.entityId || "",
    deepLink: item.deepLink || "",
    appTarget: item.appTarget || "",
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    readAt: item.readAt || null,
    archivedAt: item.archivedAt || null
  };
}

function notificationCapabilities(pushService, preferences = {}) {
  const pushSupported = Boolean(pushService && pushService.isConfigured());
  const emailVerified = preferences.emailVerified === true;
  return {
    pushSupported,
    vapidPublicKey: pushSupported ? pushService.publicKey : "",
    emailSupported: emailVerified,
    emailVerified
  };
}

function pushSubscriptionMatches(item, owner, appTarget = "") {
  if (!item || !owner) return false;
  const role = normalizeRole(item.ownerRole || item.recipientRole);
  const id = role === "manager" ? "manager" : String(item.ownerId || item.recipientId || "");
  return role === owner.role && id === owner.id
    && (!appTarget || pushSubscriptionAppTarget(item) === appTarget);
}

function requestPushAppTarget(req, owner) {
  const body = req && req.body && typeof req.body === "object" ? req.body : {};
  return normalizeAppTarget(
    body.appId || body.appTarget || req.get("x-tahmisci-app-id") || req.get("x-tahmisci-app-target"),
    "",
    owner && owner.role
  );
}

function pushSubscriptionAppTarget(item) {
  return normalizeAppTarget(
    item && (item.appId || item.appTarget),
    "",
    normalizeRole(item && (item.ownerRole || item.recipientRole))
  );
}

function normalizedDeviceId(value) {
  const id = String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
  return id;
}

function normalizedDeviceName(value, userAgent) {
  const explicit = String(value || "").trim().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").slice(0, 120);
  if (explicit) return explicit;
  const agent = String(userAgent || "");
  if (/Edg\//i.test(agent)) return "Microsoft Edge";
  if (/Firefox\//i.test(agent)) return "Firefox";
  if (/(?:Chrome|CriOS)\//i.test(agent)) return "Google Chrome";
  if (/Safari\//i.test(agent) && !/Chrome|Chromium|Android/i.test(agent)) return "Safari";
  return "Bu cihaz";
}

function publicPushDevice(item, currentDeviceId, options = {}) {
  const deviceId = normalizedDeviceId(item && item.deviceId);
  const deviceName = normalizedDeviceName(item && item.deviceName, item && item.userAgent);
  const device = {
    id: String(item && item.id || ""),
    deviceId,
    deviceName,
    name: deviceName,
    appTarget: pushSubscriptionAppTarget(item),
    appId: pushSubscriptionAppTarget(item),
    createdAt: item && item.createdAt || null,
    updatedAt: item && item.updatedAt || null,
    lastSeenAt: item && (item.lastSeenAt || item.updatedAt || item.createdAt) || null,
    lastSuccessAt: item && item.lastSuccessAt || null,
    disabledAt: item && item.disabledAt || null,
    status: item && item.disabledAt ? "disabled" : "active",
    current: Boolean(currentDeviceId && deviceId && currentDeviceId === deviceId)
  };
  device.isCurrent = device.current;
  if (options.includeEndpoint) device.endpoint = String(item && item.endpoint || "");
  return device;
}

function cancelNotificationOutbox(data, owner, notificationIds, reason, timestamp = new Date().toISOString()) {
  cancelOutboxItems(data, (item) => item
    && notificationIds.has(item.notificationId)
    && normalizeRole(item.recipientRole) === owner.role
    && String(owner.role === "manager" ? "manager" : item.recipientId || "") === owner.id, reason, timestamp);
}

function cancelPushOutbox(data, owner, subscriptionIds, endpoints, reason, timestamp = new Date().toISOString()) {
  const ids = new Set((subscriptionIds || []).filter(Boolean));
  const destinations = new Set((endpoints || []).filter(Boolean));
  cancelOutboxItems(data, (item) => item
    && item.channel === "push"
    && normalizeRole(item.recipientRole) === owner.role
    && String(owner.role === "manager" ? "manager" : item.recipientId || "") === owner.id
    && (ids.has(item.subscriptionId) || destinations.has(item.destination)), reason, timestamp);
}

function cancelOutboxItems(data, matches, reason, timestamp) {
  for (const item of data.notificationOutbox || []) {
    if (!matches(item) || ["sent", "cancelled"].includes(item.status)) continue;
    item.status = "cancelled";
    item.nextAttemptAt = null;
    item.lockedAt = null;
    item.lockedBy = "";
    item.lastError = String(reason || "Bildirim teslimi kullanıcı tarafından iptal edildi.").slice(0, 500);
    item.updatedAt = timestamp;
  }
}

function validatePushSubscription(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const endpoint = String(source.endpoint || "").trim();
  const p256dh = String(source.keys && source.keys.p256dh || "").trim();
  const auth = String(source.keys && source.keys.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth || endpoint.length > 2048 || p256dh.length > 500 || auth.length > 500) {
    throw badRequest("Geçerli bir Web Push aboneliği gerekli.");
  }
  return { endpoint, expirationTime: source.expirationTime || null, keys: { p256dh, auth } };
}

function writeSse(res, event, payload, id) {
  if (res.writableEnded) return;
  if (id !== undefined && id !== null) res.write(`id: ${String(id).replace(/[\r\n]/g, "")}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function newestNotificationRevision(data, owner) {
  let revision = 0;
  for (const item of data.notifications || []) {
    if (!item || item.deletedAt || isRetiredNotificationCategory(item.category, item.eventType)
      || !recipientMatches(item, owner.role, owner.id)) continue;
    revision = Math.max(revision, Date.parse(item.updatedAt || item.createdAt || "") || 0);
  }
  return revision;
}

function nextNotificationRevision(current, notification) {
  const hinted = Date.parse(notification && (notification.updatedAt || notification.createdAt) || "") || 0;
  return hinted > current ? hinted : current + 1;
}

function noStore(res) {
  res.set("Cache-Control", "no-store");
  return res;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function disableOwnedPushSubscription(store, owner, subscriptionId, statusCode) {
  const timestamp = new Date().toISOString();
  await store.update((data) => {
    const subscription = (data.pushSubscriptions || []).find((item) => item && item.id === subscriptionId
      && pushSubscriptionMatches(item, owner));
    if (!subscription || subscription.revokedAt) return data;
    subscription.disabledAt = subscription.disabledAt || timestamp;
    subscription.lastFailureAt = timestamp;
    subscription.failureCount = Math.max(0, Number(subscription.failureCount || 0)) + 1;
    subscription.updatedAt = timestamp;
    for (const item of data.notificationOutbox || []) {
      if (!item || item.channel !== "push" || item.subscriptionId !== subscription.id
        || !["pending", "processing"].includes(item.status)) continue;
      item.status = "cancelled";
      item.nextAttemptAt = null;
      item.lockedAt = null;
      item.lockedBy = "";
      item.lastError = `Push aboneliği ${statusCode === 404 ? "bulunamadığı" : "sona erdiği"} için devre dışı bırakıldı.`;
      item.updatedAt = timestamp;
    }
    return data;
  });
}

function validateId(value, label) {
  const id = String(value || "").trim();
  if (!id || id.length > 180 || /[\u0000-\u001f\u007f]/.test(id)) throw badRequest(`${label} geçersiz.`);
  return id;
}

function parseCategoryFilter(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const category = normalizeNotificationCategory(text);
  const normalizedInput = text.toLocaleLowerCase("tr-TR").replace(/[_-]+/g, " ");
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    throw badRequest(`Kategori ${NOTIFICATION_CATEGORIES.join(", ")} değerlerinden biri olmalıdır.`);
  }
  if (category === "system" && !["system", "sistem", "reminder", "hatırlatma", "hatirlatma"].includes(normalizedInput)) {
    throw badRequest(`Kategori ${NOTIFICATION_CATEGORIES.join(", ")} değerlerinden biri olmalıdır.`);
  }
  return category;
}

function parseSeverityFilter(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (!severity) return "";
  if (!NOTIFICATION_SEVERITIES.includes(severity)) throw badRequest("Bildirim önem düzeyi geçersiz.");
  return severity;
}

module.exports = {
  listNotifications,
  publicNotification,
  registerNotificationRoutes,
  unreadCount,
  validatePushSubscription
};
