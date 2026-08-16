"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");

const NOTIFICATION_CATEGORIES = Object.freeze(["task", "shipment", "shift", "stock", "system"]);
const NOTIFICATION_SEVERITIES = Object.freeze(["info", "success", "warning", "critical"]);
const MAX_NOTIFICATIONS = 10000;
const MAX_OUTBOX_ITEMS = 20000;

const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(500);

function createNotificationInStore(data, input, options = {}) {
  if (!data || typeof data !== "object") throw new TypeError("Bildirim için geçerli store verisi gerekli.");
  const normalized = normalizeNotificationInput(input, options);
  // PASİF MODÜL: Eğitim bildirimleri yeni kayıt veya teslim kuyruğu üretmez.
  if (isRetiredNotificationCategory(normalized.category, normalized.eventType)) return null;
  data.notifications = Array.isArray(data.notifications) ? data.notifications : [];
  data.notificationPreferences = Array.isArray(data.notificationPreferences) ? data.notificationPreferences : [];
  data.notificationOutbox = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
  data.pushSubscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];

  if (normalized.dedupeKey && !options.force) {
    const duplicate = data.notifications.find((item) => item
      && item.recipientRole === normalized.recipientRole
      && String(item.recipientId) === normalized.recipientId
      && item.dedupeKey === normalized.dedupeKey);
    if (duplicate) return null;
  }

  const preference = getNotificationPreferences(data, normalized.recipientRole, normalized.recipientId);
  const categoryEnabled = preferenceCategoryEnabled(preference, normalized.category);
  const mandatory = isMandatoryNotification(normalized);
  const createdAt = normalized.createdAt || nowIso(options.now);
  const notification = {
    id: normalized.id || `notification-${crypto.randomUUID()}`,
    recipientRole: normalized.recipientRole,
    recipientId: normalized.recipientId,
    category: normalized.category,
    eventType: normalized.eventType,
    title: normalized.title,
    body: normalized.body,
    severity: normalized.severity,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    deepLink: normalized.deepLink,
    createdAt,
    updatedAt: createdAt,
    readAt: null,
    archivedAt: null,
    dedupeKey: normalized.dedupeKey,
    metadata: normalized.metadata,
    inAppVisible: mandatory || (preference.inAppEnabled !== false && categoryEnabled)
  };
  data.notifications.push(notification);
  data.notifications = retainNotifications(data.notifications, MAX_NOTIFICATIONS);

  if (categoryEnabled && preference.emailEnabled && preference.emailAddress) {
    enqueueOutbox(data, notification, "email", preference.emailAddress, options);
  }
  if (categoryEnabled && preference.pushEnabled) {
    const subscriptions = data.pushSubscriptions.filter((item) => item
      && !item.disabledAt
      && !item.revokedAt
      && normalizeRole(item.ownerRole || item.recipientRole) === notification.recipientRole
      && String(notification.recipientRole === "manager" ? "manager" : item.ownerId || item.recipientId || "") === notification.recipientId);
    for (const subscription of subscriptions) {
      enqueueOutbox(data, notification, "push", subscription.endpoint, { ...options, subscriptionId: subscription.id });
    }
  }
  return notification;
}

function createNotificationsInStore(data, inputs, options = {}) {
  const created = [];
  for (const input of Array.isArray(inputs) ? inputs : []) {
    const notification = createNotificationInStore(data, input, options);
    if (notification) created.push(notification);
  }
  return created;
}

function getNotificationPreferences(data, ownerRole, ownerId) {
  const role = normalizeRole(ownerRole);
  const id = role === "manager" ? "manager" : String(ownerId || "").trim();
  const existing = (Array.isArray(data && data.notificationPreferences) ? data.notificationPreferences : [])
    .find((item) => item && normalizeRole(item.ownerRole || item.recipientRole) === role
      && String(role === "manager" ? "manager" : item.ownerId || item.recipientId || "") === id);
  const categories = existing && existing.categories && typeof existing.categories === "object" ? existing.categories : {};
  const reminders = existing && existing.reminders && typeof existing.reminders === "object" ? existing.reminders : {};
  const masterReminder = existing ? legacyFlag(existing.reminderNotifications, categories.reminder, true) : true;
  const verifiedEmail = getVerifiedAccountEmail(data, role, id);
  return {
    ownerRole: role,
    ownerId: id,
    inAppEnabled: existing ? legacyFlag(existing.inAppEnabled, existing.inApp, true) : true,
    pushEnabled: existing ? legacyFlag(existing.pushEnabled, existing.push, false) : false,
    emailEnabled: Boolean(verifiedEmail && (existing ? legacyFlag(existing.emailEnabled, existing.email, false) : false)),
    emailAddress: verifiedEmail,
    emailVerified: Boolean(verifiedEmail),
    taskNotifications: preferenceFlag(existing, "taskNotifications", categories.task ?? categories.tasks, true),
    shipmentNotifications: preferenceFlag(existing, "shipmentNotifications", categories.shipment ?? categories.shipments, true),
    shiftNotifications: preferenceFlag(existing, "shiftNotifications", categories.shift ?? categories.shifts, true),
    stockNotifications: preferenceFlag(existing, "stockNotifications", categories.stock, true),
    systemNotifications: preferenceFlag(existing, "systemNotifications", categories.system, true),
    reminderNotifications: masterReminder,
    taskReminder24h: preferenceFlag(existing, "taskReminder24h", reminders.task24h, masterReminder),
    taskReminder2h: preferenceFlag(existing, "taskReminder2h", reminders.task2h, masterReminder),
    overdueReminder: preferenceFlag(existing, "overdueReminder", reminders.overdue, masterReminder),
    shiftReminder12h: preferenceFlag(existing, "shiftReminder12h", reminders.shift12h, masterReminder),
    shiftReminder2h: preferenceFlag(existing, "shiftReminder2h", reminders.shift2h, masterReminder),
    quietHoursEnabled: existing ? existing.quietHoursEnabled === true || Boolean(existing.quietHours && existing.quietHours.enabled) : false,
    quietHoursStart: normalizeClock(existing && (existing.quietHoursStart || existing.quietHours && existing.quietHours.start), "22:00"),
    quietHoursEnd: normalizeClock(existing && (existing.quietHoursEnd || existing.quietHours && existing.quietHours.end), "08:00"),
    timezone: normalizeTimezone(existing && (existing.timezone || existing.quietHours && existing.quietHours.timezone)),
    updatedAt: existing && existing.updatedAt || null
  };
}

function updateNotificationPreferencesInStore(data, ownerRole, ownerId, input, options = {}) {
  data.notificationPreferences = Array.isArray(data.notificationPreferences) ? data.notificationPreferences : [];
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const current = getNotificationPreferences(data, ownerRole, ownerId);
  const channels = source.channels && typeof source.channels === "object" ? source.channels : {};
  const categories = source.categories && typeof source.categories === "object" ? source.categories : {};
  const reminders = source.reminders && typeof source.reminders === "object" ? source.reminders : {};
  const verifiedEmail = getVerifiedAccountEmail(data, current.ownerRole, current.ownerId);
  const requestedEmailEnabled = booleanValue(source.emailEnabled, booleanValue(channels.email, current.emailEnabled));
  if (requestedEmailEnabled && !verifiedEmail) {
    const error = new Error("E-posta bildirimleri için doğrulanmış hesap e-postası gerekli.");
    error.status = 409;
    error.code = "EMAIL_VERIFICATION_REQUIRED";
    throw error;
  }
  const masterReminder = booleanValue(source.reminderNotifications, booleanValue(categories.reminder, current.reminderNotifications));
  const masterWasExplicit = typeof source.reminderNotifications === "boolean" || typeof categories.reminder === "boolean";
  const next = {
    ...current,
    inAppEnabled: booleanValue(source.inAppEnabled, booleanValue(channels.inApp, current.inAppEnabled)),
    pushEnabled: booleanValue(source.pushEnabled, booleanValue(channels.push, current.pushEnabled)),
    emailEnabled: Boolean(requestedEmailEnabled && verifiedEmail),
    emailAddress: verifiedEmail,
    emailVerified: Boolean(verifiedEmail),
    taskNotifications: booleanValue(source.taskNotifications, booleanValue(categories.task ?? categories.tasks, current.taskNotifications)),
    shipmentNotifications: booleanValue(source.shipmentNotifications, booleanValue(categories.shipment ?? categories.shipments, current.shipmentNotifications)),
    shiftNotifications: booleanValue(source.shiftNotifications, booleanValue(categories.shift ?? categories.shifts, current.shiftNotifications)),
    stockNotifications: booleanValue(source.stockNotifications, booleanValue(categories.stock, current.stockNotifications)),
    systemNotifications: booleanValue(source.systemNotifications, booleanValue(categories.system, current.systemNotifications)),
    reminderNotifications: masterReminder,
    taskReminder24h: booleanValue(source.taskReminder24h, booleanValue(reminders.task24h, masterWasExplicit ? masterReminder : current.taskReminder24h)),
    taskReminder2h: booleanValue(source.taskReminder2h, booleanValue(reminders.task2h, masterWasExplicit ? masterReminder : current.taskReminder2h)),
    overdueReminder: booleanValue(source.overdueReminder, booleanValue(reminders.overdue, masterWasExplicit ? masterReminder : current.overdueReminder)),
    shiftReminder12h: booleanValue(source.shiftReminder12h, booleanValue(reminders.shift12h, masterWasExplicit ? masterReminder : current.shiftReminder12h)),
    shiftReminder2h: booleanValue(source.shiftReminder2h, booleanValue(reminders.shift2h, masterWasExplicit ? masterReminder : current.shiftReminder2h)),
    quietHoursEnabled: booleanValue(source.quietHoursEnabled, current.quietHoursEnabled),
    quietHoursStart: normalizeClock(source.quietHoursStart, current.quietHoursStart),
    quietHoursEnd: normalizeClock(source.quietHoursEnd, current.quietHoursEnd),
    timezone: normalizeTimezone(source.timezone || current.timezone),
    updatedAt: nowIso(options.now)
  };
  const index = data.notificationPreferences.findIndex((item) => item
    && normalizeRole(item.ownerRole || item.recipientRole) === current.ownerRole
    && String(current.ownerRole === "manager" ? "manager" : item.ownerId || item.recipientId || "") === current.ownerId);
  if (index >= 0) data.notificationPreferences[index] = next;
  else data.notificationPreferences.push(next);
  return next;
}

function publishNotificationEvent(notification) {
  if (!notification || !notification.id
    || isRetiredNotificationCategory(notification.category, notification.eventType)) return;
  notificationEvents.emit("notification", notification);
}

function subscribeNotificationEvents(listener) {
  notificationEvents.on("notification", listener);
  return () => notificationEvents.off("notification", listener);
}

function publishNotificationStateEvent(event) {
  if (!event || !normalizeRole(event.recipientRole) || !event.recipientId) return;
  notificationEvents.emit("state", event);
}

function subscribeNotificationStateEvents(listener) {
  notificationEvents.on("state", listener);
  return () => notificationEvents.off("state", listener);
}

function recipientMatches(notification, role, id) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  const normalizedId = normalizedRole === "manager" ? "manager" : String(id || "").trim();
  if (!normalizedId) return false;
  return Boolean(notification
    && normalizeRole(notification.recipientRole) === normalizedRole
    && String(normalizedRole === "manager" ? "manager" : notification.recipientId) === normalizedId);
}

function normalizeNotificationInput(input, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const recipientRole = normalizeRole(source.recipientRole);
  const recipientId = recipientRole === "manager" ? "manager" : String(source.recipientId || "").trim().slice(0, 160);
  const title = String(source.title || "").trim().slice(0, 180);
  if (!recipientRole || !recipientId || !title) {
    const error = new Error("Bildirim alıcısı ve başlığı zorunludur.");
    error.status = 400;
    throw error;
  }
  return {
    id: String(source.id || "").trim().slice(0, 180),
    recipientRole,
    recipientId,
    category: normalizeNotificationCategory(source.category),
    eventType: normalizeEventType(source.eventType),
    title,
    body: String(source.body || "").trim().slice(0, 1200),
    severity: source.severity === "error" ? "critical" : NOTIFICATION_SEVERITIES.includes(source.severity) ? source.severity : "info",
    entityType: String(source.entityType || "").trim().slice(0, 100),
    entityId: String(source.entityId || "").trim().slice(0, 180),
    deepLink: safeDeepLink(source.deepLink),
    createdAt: source.createdAt ? nowIso(source.createdAt) : nowIso(options.now),
    dedupeKey: String(source.dedupeKey || "").trim().slice(0, 240),
    metadata: sanitizeMetadata(source.metadata)
  };
}

function enqueueOutbox(data, notification, channel, destination, options = {}) {
  if (!data || !notification || !["email", "push"].includes(channel)) return null;
  data.notificationOutbox = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
  const recipientRole = normalizeRole(notification.recipientRole);
  const recipientId = recipientRole === "manager" ? "manager" : String(notification.recipientId || "").trim();
  if (!recipientRole || !recipientId) return null;
  const normalizedDestination = channel === "email" ? normalizeEmail(destination) : String(destination || "").trim().slice(0, 2048);
  if (!normalizedDestination) return null;
  const suffix = channel === "push" ? options.subscriptionId || normalizedDestination : "email";
  const dedupeKey = `${notification.id}:${channel}:${suffix}`.slice(0, 240);
  const existing = data.notificationOutbox.find((item) => item
    && item.dedupeKey === dedupeKey
    && item.channel === channel
    && normalizeRole(item.recipientRole) === recipientRole
    && String(recipientRole === "manager" ? "manager" : item.recipientId || "") === recipientId);
  if (existing) return existing;
  const createdAt = notification.createdAt || nowIso(options.now);
  const item = {
    id: `notification-outbox-${crypto.randomUUID()}`,
    notificationId: notification.id,
    channel,
    recipientRole,
    recipientId,
    destination: normalizedDestination,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: createdAt,
    lastAttemptAt: null,
    sentAt: null,
    lastError: "",
    dedupeKey,
    subscriptionId: String(options.subscriptionId || ""),
    lockedAt: null,
    lockedBy: "",
    createdAt,
    updatedAt: createdAt
  };
  data.notificationOutbox.push(item);
  data.notificationOutbox = retainOutbox(data.notificationOutbox, MAX_OUTBOX_ITEMS);
  return item;
}

function preferenceCategoryEnabled(preference, category) {
  switch (normalizeNotificationCategory(category)) {
    case "task": return preference.taskNotifications;
    case "shipment": return preference.shipmentNotifications;
    case "shift": return preference.shiftNotifications;
    case "training": return false;
    case "stock": return preference.stockNotifications;
    default: return preference.systemNotifications;
  }
}

function normalizeNotificationCategory(value) {
  const key = normalizeLookup(value);
  if (["task", "tasks", "gorev", "yapilacak", "task reminder", "gorev hatirlatma"].some((term) => key.includes(term))) return "task";
  if (["shipment", "shipments", "sevkiyat"].some((term) => key.includes(term))) return "shipment";
  if (["shift", "shifts", "vardiya", "izin"].some((term) => key.includes(term))) return "shift";
  if (["training", "trainings", "egitim", "sinav", "recete"].some((term) => key.includes(term))) return "training";
  if (["stock", "stok"].some((term) => key.includes(term))) return "stock";
  return "system";
}

function isRetiredNotificationCategory(value, eventType = "") {
  if (normalizeNotificationCategory(value) === "training") return true;
  const event = normalizeLookup(eventType);
  return ["recipe assignment", "training assigned", "training completed", "training started", "retry training"]
    .some((term) => event.includes(term));
}

function normalizeRole(value) {
  const role = normalizeLookup(value);
  if (["manager", "admin", "yonetici"].includes(role)) return "manager";
  if (["personnel", "personel", "recipe"].includes(role)) return "personnel";
  return "";
}

function safeDeepLink(value) {
  const link = String(value || "").trim().slice(0, 500);
  return link.startsWith("/") && !link.startsWith("//") && !/[\r\n]/.test(link) ? link : "";
}

function sanitizeMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return {};
  const result = Object.create(null);
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 40)) {
    const key = String(rawKey || "").slice(0, 80);
    if (!key || /(?:pass(?:word)?|secret|token|cookie|authorization|smtp|vapid|private.?key)/i.test(key)) continue;
    if (rawValue === null || typeof rawValue === "boolean" || typeof rawValue === "number") result[key] = rawValue;
    else if (typeof rawValue === "string") result[key] = rawValue.slice(0, 500);
    else if (Array.isArray(rawValue)) result[key] = rawValue.slice(0, 20).map((item) => typeof item === "string" ? item.slice(0, 200) : item).filter(isSafeScalar);
    else if (rawValue && typeof rawValue === "object") result[key] = sanitizeMetadata(rawValue, depth + 1);
  }
  try {
    return Buffer.byteLength(JSON.stringify(result), "utf8") <= 8000 ? result : {};
  } catch (_error) {
    return {};
  }
}

function retainNotifications(items, maxItems = MAX_NOTIFICATIONS) {
  if (!Array.isArray(items) || items.length <= maxItems) return items;
  const protectedItems = items.filter((item) => item && !item.deletedAt && !item.readAt && !item.archivedAt);
  const removable = items.filter((item) => !item || item.deletedAt || item.readAt || item.archivedAt)
    .sort((left, right) => String(right && right.createdAt || "").localeCompare(String(left && left.createdAt || "")));
  const slots = Math.max(0, maxItems - protectedItems.length);
  return protectedItems.concat(removable.slice(0, slots))
    .sort((left, right) => String(left && left.createdAt || "").localeCompare(String(right && right.createdAt || "")));
}

function retainOutbox(items, maxItems = MAX_OUTBOX_ITEMS) {
  if (!Array.isArray(items) || items.length <= maxItems) return items;
  const protectedItems = items.filter((item) => item && ["pending", "processing"].includes(item.status));
  const completed = items.filter((item) => !item || !["pending", "processing"].includes(item.status))
    .sort((left, right) => String(right && right.updatedAt || "").localeCompare(String(left && left.updatedAt || "")));
  const slots = Math.max(0, maxItems - protectedItems.length);
  return protectedItems.concat(completed.slice(0, slots));
}

function isMandatoryNotification(notification) {
  if (!notification || notification.severity !== "critical") return false;
  const event = normalizeLookup(notification.eventType);
  return notification.category === "system" || event.includes("security") || event.includes("guvenlik")
    || event.includes("data integrity") || event.includes("veri butunlugu");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function getVerifiedAccountEmail(data, ownerRole, ownerId) {
  const role = normalizeRole(ownerRole);
  const account = role === "manager"
    ? data && data.admin
    : (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
      .find((item) => item && String(item.id || "") === String(ownerId || ""));
  if (!account || !account.emailVerifiedAt) return "";
  const email = normalizeEmail(account.emailNormalized || account.email);
  return isValidEmail(email) ? email : "";
}

function normalizeClock(value, fallback) {
  const text = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function normalizeTimezone(value) {
  const timezone = String(value || "Europe/Istanbul").trim().slice(0, 80);
  try {
    new Intl.DateTimeFormat("tr-TR", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_error) {
    return "Europe/Istanbul";
  }
}

function normalizeEventType(value) {
  const eventType = String(value || "notification").trim().slice(0, 120);
  return eventType || "notification";
}

function normalizeLookup(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

function preferenceFlag(existing, directKey, legacyValue, fallback) {
  if (existing && typeof existing[directKey] === "boolean") return existing[directKey];
  return typeof legacyValue === "boolean" ? legacyValue : fallback;
}

function legacyFlag(primary, legacy, fallback) {
  if (typeof primary === "boolean") return primary;
  return typeof legacy === "boolean" ? legacy : fallback;
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function isSafeScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function nowIso(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  createNotificationInStore,
  createNotificationsInStore,
  enqueueOutbox,
  getNotificationPreferences,
  getVerifiedAccountEmail,
  isMandatoryNotification,
  isRetiredNotificationCategory,
  normalizeNotificationCategory,
  normalizeRole,
  preferenceCategoryEnabled,
  publishNotificationEvent,
  publishNotificationStateEvent,
  recipientMatches,
  retainNotifications,
  retainOutbox,
  sanitizeMetadata,
  subscribeNotificationEvents,
  subscribeNotificationStateEvents,
  updateNotificationPreferencesInStore
};
