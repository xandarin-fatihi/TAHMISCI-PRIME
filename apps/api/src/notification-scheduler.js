"use strict";

const crypto = require("crypto");
const {
  createNotificationInStore,
  getNotificationPreferences,
  publishNotificationEvent
} = require("./notification-service");

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_LEASE_MS = 90 * 1000;

function createNotificationScheduler(options) {
  const {
    store,
    intervalMs = DEFAULT_INTERVAL_MS,
    leaseMs = Math.max(DEFAULT_LEASE_MS, Number(intervalMs || DEFAULT_INTERVAL_MS) + 30000),
    logError = console.error,
    clock = () => new Date(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = options || {};
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("Bildirim zamanlayıcısı için geçerli store gerekli.");
  }
  const owner = `notification-scheduler-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const safeIntervalMs = Math.max(30000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
  const safeLeaseMs = Math.max(60000, Number(leaseMs) || DEFAULT_LEASE_MS);
  let timer = null;
  let running = false;

  async function tick(nowValue) {
    if (running) return { created: 0, skipped: "running" };
    const now = validDate(nowValue === undefined ? clock() : nowValue);
    if (!now) return { created: 0, skipped: "invalid-time" };
    running = true;
    const created = [];
    let claimed = false;
    try {
      // Empty ticks never acquire a lease or enter the durable write queue.
      // The preview clones only collections that notification creation mutates.
      const snapshot = await store.read();
      if (!previewSchedulerChanges(snapshot, now)) return { created: 0, skipped: "no-work" };
      claimed = await claimLease(now);
      if (!claimed) return { created: 0, skipped: "leased" };
      const diagnostics = { invalidTaskDates: 0, invalidShiftDates: 0 };
      await store.update((data) => {
        const beforeCount = created.length;
        createTaskReminders(data, now, created, diagnostics);
        createShiftReminders(data, now, created, diagnostics);
        const stockStateChanged = createCriticalStockNotifications(data, now, created);
        createManagerPendingReminders(data, now, created);
        if (created.length === beforeCount && !stockStateChanged) return noChange(store, data);
        data.notificationSchedulerState = {
          ...(data.notificationSchedulerState || {}),
          lastRunAt: now.toISOString(),
          lastTickAt: now.toISOString(),
          lastReminderScanAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
        return data;
      });
      if (diagnostics.invalidTaskDates || diagnostics.invalidShiftDates) {
        logError("Bildirim zamanlayıcısı geçersiz tarihleri atladı", diagnostics);
      }
      for (const notification of created) publishNotificationEvent(notification);
      return { created: created.length };
    } catch (error) {
      logError("Bildirim hatırlatma zamanlayıcısı hatası", safeSchedulerError(error));
      return { created: 0, error: true };
    } finally {
      if (claimed) await releaseLease().catch((error) => logError("Bildirim zamanlayıcısı kilidi bırakılamadı", safeSchedulerError(error)));
      running = false;
    }
  }

  async function claimLease(now) {
    let acquired = false;
    await store.update((data) => {
      const state = data.notificationSchedulerState && typeof data.notificationSchedulerState === "object"
        ? data.notificationSchedulerState
        : {};
      const leaseExpiry = Date.parse(state.leaseExpiresAt || "");
      if (state.leaseOwner && state.leaseOwner !== owner && Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime()) return noChange(store, data);
      data.notificationSchedulerState = {
        ...state,
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + safeLeaseMs).toISOString(),
        updatedAt: now.toISOString()
      };
      acquired = true;
      return data;
    });
    return acquired;
  }

  async function releaseLease() {
    const now = validDate(clock()) || new Date();
    await store.update((data) => {
      const state = data.notificationSchedulerState || {};
      if (state.leaseOwner !== owner) return noChange(store, data);
      data.notificationSchedulerState = {
        ...state,
        leaseOwner: "",
        leaseExpiresAt: null,
        updatedAt: now.toISOString()
      };
      return data;
    });
  }

  function start() {
    if (timer) return;
    timer = setIntervalFn(() => void tick(), safeIntervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    queueMicrotask(() => void tick());
  }

  async function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return { intervalMs: safeIntervalMs, owner, start, stop, tick };
}

function createTaskReminders(data, now, created, diagnostics = {}) {
  const tasks = new Map((Array.isArray(data.workforceTasks) ? data.workforceTasks : [])
    .filter(Boolean).map((task) => [String(task.id || ""), task]));
  for (const assignment of Array.isArray(data.workforceAssignments) ? data.workforceAssignments : []) {
    if (!assignment || isCompletedOrCancelled(assignment.status)) continue;
    const task = tasks.get(String(assignment.taskId || ""));
    if (!task || isCompletedOrCancelled(task.status) || normalizeLookup(task.status) === "archived") continue;
    const personId = String(assignment.userId || assignment.personId || assignment.personnelId || "").trim();
    if (!personId) continue;
    const dueAt = taskDueDate(task);
    if (!dueAt) {
      if (task.dueAt || task.dueDate) diagnostics.invalidTaskDates = Number(diagnostics.invalidTaskDates || 0) + 1;
      continue;
    }
    const remainingMs = dueAt.getTime() - now.getTime();
    const preferences = getNotificationPreferences(data, "personnel", personId);
    const scheduleToken = shortToken(dueAt.toISOString());
    const base = {
      recipientRole: "personnel",
      recipientId: personId,
      category: "task",
      entityType: "task",
      entityId: String(task.id || ""),
      deepLink: `/personel/?section=tasks&taskId=${encodeURIComponent(String(task.id || ""))}`,
      metadata: { dueAt: dueAt.toISOString(), taskTitle: String(task.title || "") }
    };
    if (remainingMs > 2 * HOUR_MS && remainingMs <= 24 * HOUR_MS && preferences.taskReminder24h) {
      addNotification(data, created, {
        ...base,
        eventType: "task_reminder_24h",
        title: "Görevin teslim tarihi yaklaşıyor",
        body: `${String(task.title || "Atanmış görev")} 24 saat içinde tamamlanmalı.`,
        severity: "warning",
        dedupeKey: `task-reminder-24h:${task.id}:${personId}:${scheduleToken}`
      }, now);
    }
    if (remainingMs > 0 && remainingMs <= 2 * HOUR_MS && preferences.taskReminder2h) {
      addNotification(data, created, {
        ...base,
        eventType: "task_reminder_2h",
        title: "Görevin için son 2 saat",
        body: `${String(task.title || "Atanmış görev")} için teslim zamanı yaklaştı.`,
        severity: "warning",
        dedupeKey: `task-reminder-2h:${task.id}:${personId}:${scheduleToken}`
      }, now);
    }
    if (remainingMs <= 0 && preferences.overdueReminder) {
      addNotification(data, created, {
        ...base,
        eventType: "task_overdue",
        title: "Görevin süresi geçti",
        body: `${String(task.title || "Atanmış görev")} görevinin teslim süresi geçti.`,
        severity: "critical",
        dedupeKey: `task-overdue:${task.id}:${personId}:${scheduleToken}`
      }, now);
    }
  }
}

function createShiftReminders(data, now, created, diagnostics = {}) {
  for (const plan of Array.isArray(data.workforceShiftPlans) ? data.workforceShiftPlans : []) {
    if (!plan || normalizeLookup(plan.status) !== "published" || isLeaveShift(plan.type)) continue;
    const personId = String(plan.personId || plan.userId || plan.personnelId || "").trim();
    if (!personId) continue;
    const startsAt = shiftStartDate(plan);
    if (!startsAt) {
      if (plan.date || plan.startTime) diagnostics.invalidShiftDates = Number(diagnostics.invalidShiftDates || 0) + 1;
      continue;
    }
    const remainingMs = startsAt.getTime() - now.getTime();
    if (remainingMs <= 0) continue;
    const preferences = getNotificationPreferences(data, "personnel", personId);
    const revision = String(plan.publicationRevision || plan.revision || plan.publishedAt || "published");
    const shiftId = String(plan.id || `${personId}-${plan.date}-${plan.startTime || ""}`);
    const scheduleToken = shortToken(`${startsAt.toISOString()}:${revision}`);
    const shiftText = [String(plan.type || "Vardiya"), formatTimeRange(plan.startTime, plan.endTime)].filter(Boolean).join(" · ");
    const base = {
      recipientRole: "personnel",
      recipientId: personId,
      category: "shift",
      entityType: "shift",
      entityId: shiftId,
      deepLink: `/personel/?section=shift&weekStart=${encodeURIComponent(String(plan.weekStart || ""))}`,
      metadata: { date: plan.date, startTime: plan.startTime || "", endTime: plan.endTime || "", publicationRevision: revision }
    };
    if (remainingMs > 2 * HOUR_MS && remainingMs <= 12 * HOUR_MS && preferences.shiftReminder12h) {
      addNotification(data, created, {
        ...base,
        eventType: "shift_reminder_12h",
        title: "Vardiyan 12 saat içinde başlıyor",
        body: `${formatTurkishDate(plan.date)} · ${shiftText}`,
        severity: "info",
        dedupeKey: `shift-reminder-12h:${shiftId}:${personId}:${scheduleToken}`
      }, now);
    }
    if (remainingMs <= 2 * HOUR_MS && preferences.shiftReminder2h) {
      addNotification(data, created, {
        ...base,
        eventType: "shift_reminder_2h",
        title: "Vardiyan 2 saat içinde başlıyor",
        body: `${formatTurkishDate(plan.date)} · ${shiftText}`,
        severity: "warning",
        dedupeKey: `shift-reminder-2h:${shiftId}:${personId}:${scheduleToken}`
      }, now);
    }
  }
}

function createCriticalStockNotifications(data, now, created) {
  const state = data.notificationSchedulerState || (data.notificationSchedulerState = {});
  const previousStates = state.criticalStockState && typeof state.criticalStockState === "object"
    ? state.criticalStockState
    : {};
  const nextStates = {};
  let stateChanged = false;
  const products = data.stockState && Array.isArray(data.stockState.products) ? data.stockState.products : [];
  for (const product of products) {
    if (!product || !product.id || product.active === false) continue;
    const quantity = finiteNumber(product.stockQuantity ?? product.quantity ?? product.stock);
    const explicitThreshold = finiteNumber(product.criticalThreshold);
    const threshold = explicitThreshold > 0 ? explicitThreshold : finiteNumber(product.orderThreshold ?? product.warningThreshold);
    if (!Number.isFinite(quantity) || !(threshold > 0)) continue;
    const id = String(product.id);
    const previous = previousStates[id] && typeof previousStates[id] === "object" ? previousStates[id] : {};
    const isCritical = quantity <= threshold;
    const revision = Math.max(0, Number(previous.revision || 0)) + (isCritical && previous.isCritical !== true ? 1 : 0);
    const same = previous.isCritical === isCritical
      && Number(previous.revision || 0) === revision
      && Number(previous.quantity) === quantity
      && Number(previous.threshold) === threshold;
    nextStates[id] = same
      ? previous
      : { isCritical, revision, quantity, threshold, updatedAt: now.toISOString() };
    if (!same) stateChanged = true;
    if (!isCritical || previous.isCritical === true) continue;
    addNotification(data, created, {
      recipientRole: "manager",
      recipientId: "manager",
      category: "stock",
      eventType: "stock_critical",
      title: "Kritik stok uyarısı",
      body: `${String(product.name || product.productName || "Stok ürünü")} kritik stok seviyesine düştü.`,
      severity: "critical",
      entityType: "stock_product",
      entityId: id,
      deepLink: `/yonetici/?section=stock&productId=${encodeURIComponent(id)}`,
      dedupeKey: `stock-critical:${id}:${revision}`,
      metadata: { productName: String(product.name || product.productName || ""), quantity, threshold, unit: String(product.unit || "") }
    }, now);
  }
  if (Object.keys(previousStates).some((id) => !Object.prototype.hasOwnProperty.call(nextStates, id))) stateChanged = true;
  if (stateChanged) state.criticalStockState = nextStates;
  return stateChanged;
}

function createManagerPendingReminders(data, now, created) {
  const shipments = (Array.isArray(data.workforceShipments) ? data.workforceShipments : [])
    .filter((item) => item && normalizeLookup(item.status) === "onay bekliyor").length;
  const shiftRequests = (Array.isArray(data.workforceShiftRequests) ? data.workforceShiftRequests : [])
    .filter((item) => item && normalizeLookup(item.status) === "onay bekliyor").length;
  if (!shipments && !shiftRequests) return;
  addNotification(data, created, {
    recipientRole: "manager",
    recipientId: "manager",
    category: "system",
    eventType: "pending_workforce_actions",
    title: "Bekleyen personel işlemleri var",
    body: `${shipments} sevkiyat ve ${shiftRequests} vardiya/izin talebi karar bekliyor.`,
    severity: "warning",
    entityType: "workforce",
    entityId: "pending",
    deepLink: "/yonetici/?section=personel&workforce=operations",
    dedupeKey: `manager-pending:${dateKeyInIstanbul(now)}:${shipments}:${shiftRequests}`
  }, now);
}

function addNotification(data, created, input, now) {
  const notification = createNotificationInStore(data, input, { now });
  if (notification) created.push(notification);
}

function taskDueDate(task) {
  const value = task && (task.dueAt || (task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00+03:00` : ""));
  return validDate(value);
}

function shiftStartDate(plan) {
  if (!plan || !/^\d{4}-\d{2}-\d{2}$/.test(String(plan.date || ""))) return null;
  const time = /^\d{2}:\d{2}$/.test(String(plan.startTime || "")) ? plan.startTime : defaultShiftStart(plan.type);
  return validDate(`${plan.date}T${time}:00+03:00`);
}

function defaultShiftStart(type) {
  const key = normalizeLookup(type);
  if (key.includes("aksam")) return "16:00";
  if (key.includes("sabah")) return "08:00";
  return "";
}

function isLeaveShift(type) {
  const key = normalizeLookup(type);
  return ["izin", "izinli", "leave", "off", "unassigned"].some((value) => key === value || key.includes(value));
}

function isCompletedOrCancelled(status) {
  const key = normalizeLookup(status);
  return ["completed", "tamamlandi", "cancelled", "canceled", "iptal edildi", "iptal"].includes(key);
}

function dateKeyInIstanbul(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

function formatTurkishDate(value) {
  const date = validDate(`${value}T12:00:00+03:00`);
  return date ? new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long"
  }).format(date) : String(value || "");
}

function formatTimeRange(start, end) {
  return start && end ? `${start}–${end}` : String(start || "");
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function shortToken(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12);
}

function normalizeLookup(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

function previewSchedulerChanges(data, now) {
  const state = data.notificationSchedulerState && typeof data.notificationSchedulerState === "object"
    ? data.notificationSchedulerState
    : {};
  const preview = {
    ...data,
    notifications: [...(Array.isArray(data.notifications) ? data.notifications : [])],
    notificationOutbox: [...(Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [])],
    notificationSchedulerState: {
      ...state,
      criticalStockState: structuredClone(state.criticalStockState || {})
    }
  };
  const created = [];
  createTaskReminders(preview, now, created, {});
  createShiftReminders(preview, now, created, {});
  const stockStateChanged = createCriticalStockNotifications(preview, now, created);
  createManagerPendingReminders(preview, now, created);
  return created.length > 0 || stockStateChanged;
}

function noChange(store, data) {
  return store && typeof store.noChange === "function" ? store.noChange() : data;
}

function safeSchedulerError(error) {
  return { name: String(error && error.name || "Error"), message: String(error && error.message || "").slice(0, 300) };
}

module.exports = {
  createCriticalStockNotifications,
  createNotificationScheduler,
  createShiftReminders,
  createTaskReminders,
  dateKeyInIstanbul
};
