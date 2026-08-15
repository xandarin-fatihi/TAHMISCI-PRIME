"use strict";

const crypto = require("crypto");
const {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  createNotificationInStore,
  getNotificationPreferences,
  normalizeNotificationCategory,
  publishNotificationEvent,
  recipientMatches,
  subscribeNotificationEvents,
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
  let notificationEventRevision = 0;

  registerRecipientRoutes({ prefix: "/api/notifications", guards: personelGuards, role: "personnel" });
  registerRecipientRoutes({ prefix: "/api/admin/notifications", guards: adminGuards, role: "manager", admin: true });

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

    for (const action of ["read", "unread", "archive"]) {
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
            notification = publicNotification(item);
            return data;
          });
          noStore(res).json({ ok: true, notification, unreadCount: unreadCount(saved, owner) });
        } catch (error) { next(error); }
      });
    }

    app.post(`${prefix}/read-all`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const timestamp = new Date().toISOString();
        let updatedCount = 0;
        await store.update((data) => {
          for (const item of data.notifications || []) {
            if (!recipientMatches(item, owner.role, owner.id) || item.archivedAt || item.readAt || item.inAppVisible === false) continue;
            item.readAt = timestamp;
            updatedCount += 1;
          }
          return data;
        });
        noStore(res).json({ ok: true, updatedCount, unreadCount: 0 });
      } catch (error) { next(error); }
    });

    app.get(`${prefix}/preferences`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        noStore(res).json({
          ok: true,
          preferences: getNotificationPreferences(data, owner.role, owner.id),
          capabilities: notificationCapabilities(pushService)
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
        noStore(res).json({ ok: true, preferences, capabilities: notificationCapabilities(pushService) });
      } catch (error) { next(error); }
    };
    app.put(`${prefix}/preferences`, ...guards, updatePreferences);
    app.patch(`${prefix}/preferences`, ...guards, updatePreferences);

    app.post(`${prefix}/push-subscriptions`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const subscription = validatePushSubscription(req.body && (req.body.subscription || req.body));
        let saved = null;
        await store.update((data) => {
          data.pushSubscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
          const foreign = data.pushSubscriptions.find((item) => item && item.endpoint === subscription.endpoint
            && (item.ownerRole !== owner.role || String(item.ownerId) !== owner.id));
          if (foreign) {
            const error = new Error("Bu Push aboneliği başka bir hesaba bağlı.");
            error.status = 409;
            throw error;
          }
          const current = data.pushSubscriptions.find((item) => item
            && item.ownerRole === owner.role
            && item.ownerId === owner.id
            && item.endpoint === subscription.endpoint);
          const timestamp = new Date().toISOString();
          saved = {
            id: current && current.id || `push-subscription-${crypto.randomUUID()}`,
            ownerRole: owner.role,
            ownerId: owner.id,
            endpoint: subscription.endpoint,
            subscription,
            keys: subscription.keys,
            userAgent: String(req.get("user-agent") || "").slice(0, 500),
            createdAt: current && current.createdAt || timestamp,
            updatedAt: timestamp,
            lastSuccessAt: current && current.lastSuccessAt || null,
            failureCount: current && current.failureCount || 0
          };
          if (current) Object.assign(current, saved);
          else data.pushSubscriptions.push(saved);
          return data;
        });
        noStore(res).status(201).json({ ok: true, subscription: { id: saved.id, endpoint: saved.endpoint } });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/push-subscriptions`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const endpoint = String(req.body && req.body.endpoint || "").trim();
        if (!endpoint) throw badRequest("Push aboneliği endpoint bilgisi gerekli.");
        let removed = 0;
        await store.update((data) => {
          const before = (data.pushSubscriptions || []).length;
          const removedIds = (data.pushSubscriptions || []).filter((item) => item
            && item.ownerRole === owner.role
            && String(item.ownerId) === owner.id
            && item.endpoint === endpoint).map((item) => item.id);
          data.pushSubscriptions = (data.pushSubscriptions || []).filter((item) => !(item
            && item.ownerRole === owner.role
            && item.ownerId === owner.id
            && item.endpoint === endpoint));
          removed = before - data.pushSubscriptions.length;
          for (const item of data.notificationOutbox || []) {
            if (item && item.channel === "push" && item.recipientRole === owner.role
              && String(item.recipientId) === owner.id
              && (item.destination === endpoint || removedIds.includes(item.subscriptionId))
              && ["pending", "processing"].includes(item.status)) {
              item.status = "cancelled";
              item.nextAttemptAt = null;
              item.lockedAt = null;
              item.lockedBy = "";
              item.lastError = "Push aboneliği kullanıcı tarafından kaldırıldı.";
              item.updatedAt = new Date().toISOString();
            }
          }
          return data;
        });
        noStore(res).json({ ok: true, removed });
      } catch (error) { next(error); }
    });

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
          if (closed || !recipientMatches(notification, owner.role, owner.id) || notification.inAppVisible === false) return;
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
        const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
        if (typeof heartbeat.unref === "function") heartbeat.unref();
        req.once("close", () => { closed = true; clearInterval(heartbeat); unsubscribe(); });
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
  let items = (data.notifications || []).filter((item) => item
    && recipientMatches(item, owner.role, owner.id)
    && item.inAppVisible !== false
    && (String(query.includeArchived || "") === "true" || !item.archivedAt));
  if ([query.unread, query.unreadOnly].some((value) => String(value || "") === "true")) items = items.filter((item) => !item.readAt);
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
    && item.inAppVisible !== false
    && !item.archivedAt
    && !item.readAt).length;
}

function findOwnedNotification(data, id, owner) {
  const item = (data.notifications || []).find((entry) => entry && entry.id === String(id || ""));
  if (!item || !recipientMatches(item, owner.role, owner.id)) {
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
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    readAt: item.readAt || null,
    archivedAt: item.archivedAt || null
  };
}

function notificationCapabilities(pushService) {
  const pushSupported = Boolean(pushService && pushService.isConfigured());
  return { pushSupported, vapidPublicKey: pushSupported ? pushService.publicKey : "" };
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
    if (!item || !recipientMatches(item, owner.role, owner.id)) continue;
    revision = Math.max(revision, Date.parse(item.createdAt || "") || 0);
  }
  return revision;
}

function nextNotificationRevision(current, notification) {
  const hinted = Date.parse(notification && notification.createdAt || "") || 0;
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
