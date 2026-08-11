"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { migrateStore, STORE_SCHEMA_VERSION } = require("../src/store/migrations");
const {
  createNotificationInStore,
  createNotificationsInStore,
  getNotificationPreferences,
  publishNotificationEvent,
  retainNotifications,
  updateNotificationPreferencesInStore
} = require("../src/notification-service");
const { createNotificationDeliveryWorker, retryDelayMs } = require("../src/notification-delivery");
const { createNotificationScheduler } = require("../src/notification-scheduler");
const { registerNotificationRoutes } = require("../src/notification-routes");
const { absoluteNotificationLink, createMailService } = require("../src/mail-service");

test("bildirim migration'ı canonical koleksiyonları geriye uyumlu ve veri kaybetmeden normalize eder", () => {
  const migrated = migrateStore({
    notificationPreferences: [{
      ownerRole: "admin", ownerId: "x", inApp: false, email: true,
      categories: { tasks: false, training: false, stock: false },
      reminders: { task24h: false, shift2h: false }
    }],
    notifications: [{
      id: "n1", recipientRole: "personel", recipientId: "p1", category: "task_reminder",
      title: "Yeni görev", body: "Açılış kontrolü", dedupeKey: "same"
    }],
    notificationOutbox: [
      { id: "o1", notificationId: "n1", channel: "email", status: "pending", attempts: 1, dedupeKey: "mail:n1", createdAt: "2026-08-01T00:00:00Z" },
      { id: "o2", notificationId: "n1", channel: "email", status: "delivered", attempts: 2, dedupeKey: "mail:n1", createdAt: "2026-08-01T00:01:00Z" }
    ],
    schedulerState: { lastRunAt: "2026-08-01T00:00:00Z", leaseOwner: "worker", criticalStockState: { s1: { isCritical: true, revision: 2 } } }
  });
  assert.equal(migrated.schemaVersion, STORE_SCHEMA_VERSION);
  assert.equal(migrated.notifications[0].category, "task");
  assert.equal(migrated.notifications[0].title, "Yeni görev");
  assert.equal(migrated.notifications[0].body, "Açılış kontrolü");
  assert.equal(migrated.notificationPreferences[0].ownerRole, "manager");
  assert.equal(migrated.notificationPreferences[0].ownerId, "manager");
  assert.equal(migrated.notificationPreferences[0].inAppEnabled, false);
  assert.equal(migrated.notificationPreferences[0].taskNotifications, false);
  assert.equal(migrated.notificationPreferences[0].trainingNotifications, false);
  assert.equal(migrated.notificationPreferences[0].stockNotifications, false);
  assert.equal(migrated.notificationPreferences[0].taskReminder24h, false);
  assert.equal(migrated.notificationPreferences[0].shiftReminder2h, false);
  assert.equal(migrated.notificationOutbox.length, 1);
  assert.equal(migrated.notificationOutbox[0].status, "sent");
  assert.equal(migrated.notificationOutbox[0].attemptCount, 2);
  assert.equal(migrated.notificationSchedulerState.leaseOwner, "worker");
  assert.equal(migrated.notificationSchedulerState.criticalStockState.s1.revision, 2);
});

test("retention önce okunmuş ve arşivlenmiş kayıtları temizler, okunmamış bildirimi düşürmez", () => {
  const items = [
    notificationRecord("unread-old", null, null, "2026-01-01T00:00:00Z"),
    notificationRecord("read-old", "2026-01-02T00:00:00Z", null, "2026-01-02T00:00:00Z"),
    notificationRecord("archived-new", null, "2026-01-03T00:00:00Z", "2026-01-03T00:00:00Z")
  ];
  const retained = retainNotifications(items, 2);
  assert.equal(retained.some((item) => item.id === "unread-old"), true);
  assert.equal(retained.some((item) => item.id === "archived-new"), true);
  assert.equal(retained.some((item) => item.id === "read-old"), false);
});

test("merkezi servis dedupe, canonical kategori, tercih ve atomik outbox kurallarını uygular", () => {
  const data = emptyNotificationStore();
  updateNotificationPreferencesInStore(data, "personnel", "p1", {
    emailEnabled: true, pushEnabled: true, emailAddress: "PERSONEL@example.com",
    categories: { training: false, stock: false },
    reminders: { task24h: false, task2h: true, overdue: true, shift12h: false, shift2h: true }
  }, { now: "2026-08-09T10:00:00Z" });
  data.pushSubscriptions.push({
    id: "sub-1", ownerRole: "personnel", ownerId: "p1", endpoint: "https://push.example/one",
    subscription: { endpoint: "https://push.example/one", keys: { p256dh: "x", auth: "y" } }
  });

  const input = {
    recipientRole: "personnel", recipientId: "p1", category: "task_reminder", eventType: "assigned",
    title: "Yeni görev", body: "Açılış kontrolü", dedupeKey: "task-1-p1", deepLink: "/personel/#tasks"
  };
  const created = createNotificationInStore(data, input, { now: "2026-08-09T10:00:00Z" });
  assert.equal(created.category, "task");
  assert.equal(data.notifications.length, 1);
  assert.deepEqual(data.notificationOutbox.map((item) => item.channel).sort(), ["email", "push"]);
  assert.equal(createNotificationInStore(data, input), null);
  assert.equal(data.notifications.length, 1);
  assert.equal(createNotificationsInStore(data, [{ ...input, recipientId: "p2", dedupeKey: "task-1-p2" }]).length, 1);

  const preferences = getNotificationPreferences(data, "personnel", "p1");
  assert.equal(preferences.emailAddress, "personel@example.com");
  assert.equal(preferences.trainingNotifications, false);
  assert.equal(preferences.stockNotifications, false);
  assert.equal(preferences.taskReminder24h, false);
  assert.equal(preferences.shiftReminder2h, true);
});

test("kritik sistem ve veri bütünlüğü bildirimi uygulama içi tercihle kapatılamaz", () => {
  const data = emptyNotificationStore();
  updateNotificationPreferencesInStore(data, "manager", "manager", { inAppEnabled: false, systemNotifications: false });
  const critical = createNotificationInStore(data, {
    recipientRole: "manager", recipientId: "manager", category: "system", eventType: "data_integrity_failure",
    severity: "critical", title: "Veri bütünlüğü uyarısı", dedupeKey: "integrity-1"
  });
  const ordinary = createNotificationInStore(data, {
    recipientRole: "manager", recipientId: "manager", category: "system", eventType: "information",
    severity: "info", title: "Bilgi", dedupeKey: "information-1"
  });
  assert.equal(critical.inAppVisible, true);
  assert.equal(ordinary.inAppVisible, false);
});

test("scheduler 24 saat, 2 saat ve gecikme görev hatırlatmalarını en fazla bir kez üretir", async () => {
  const data = emptyNotificationStore();
  data.workforceTasks = [
    { id: "t1", title: "Kapanış kontrolü", status: "active", dueAt: "2026-08-10T09:00:00Z" },
    { id: "t2", title: "Tamamlanan", status: "completed", dueAt: "2026-08-10T09:00:00Z" }
  ];
  data.workforceAssignments = [
    { id: "a1", taskId: "t1", userId: "p1", status: "pending" },
    { id: "a2", taskId: "t2", userId: "p1", status: "completed" }
  ];
  const store = memoryStore(data);
  const scheduler = createNotificationScheduler({ store, clock: () => new Date("2026-08-09T10:00:00Z"), intervalMs: 60000, logError() {} });

  assert.equal((await scheduler.tick("2026-08-09T10:00:00Z")).created, 1);
  assert.equal((await scheduler.tick("2026-08-09T10:00:00Z")).created, 0);
  assert.equal((await scheduler.tick("2026-08-10T08:00:00Z")).created, 1);
  assert.equal((await scheduler.tick("2026-08-10T10:00:00Z")).created, 1);
  assert.equal((await scheduler.tick("2026-08-10T11:00:00Z")).created, 0);

  const events = (await store.read()).notifications.map((item) => item.eventType).sort();
  assert.deepEqual(events, ["task_overdue", "task_reminder_24h", "task_reminder_2h"]);
  assert.equal((await store.read()).notifications.some((item) => item.entityId === "t2"), false);
  assert.equal(scheduler.intervalMs, 60000);

  const lateStore = memoryStore({
    ...emptyNotificationStore(),
    workforceTasks: [{ id: "late-task", title: "Yakın görev", status: "active", dueAt: "2026-08-10T09:00:00Z" }],
    workforceAssignments: [{ id: "late-assignment", taskId: "late-task", userId: "p1", status: "pending" }]
  });
  const lateScheduler = createNotificationScheduler({ store: lateStore, intervalMs: 60000, logError() {} });
  assert.equal((await lateScheduler.tick("2026-08-10T08:00:00Z")).created, 1);
  assert.deepEqual((await lateStore.read()).notifications.map((item) => item.eventType), ["task_reminder_2h"]);
});

test("scheduler yayınlanmış vardiyada 12 ve 2 saat hatırlatmalarını üretir, izinliyi atlar", async () => {
  const data = emptyNotificationStore();
  data.workforceShiftPlans = [
    { id: "s1", personId: "p1", weekStart: "2026-08-10", date: "2026-08-10", type: "Sabah", startTime: "08:00", endTime: "16:00", status: "published", publicationRevision: 3 },
    { id: "s2", personId: "p1", weekStart: "2026-08-10", date: "2026-08-10", type: "İzinli", status: "published", publicationRevision: 3 }
  ];
  const store = memoryStore(data);
  const scheduler = createNotificationScheduler({ store, clock: () => new Date("2026-08-09T18:00:00Z"), intervalMs: 60000, logError() {} });
  assert.equal((await scheduler.tick("2026-08-09T18:00:00Z")).created, 1);
  assert.equal((await scheduler.tick("2026-08-10T04:00:00Z")).created, 1);
  assert.equal((await scheduler.tick("2026-08-10T04:00:00Z")).created, 0);
  assert.deepEqual((await store.read()).notifications.map((item) => item.eventType).sort(), ["shift_reminder_12h", "shift_reminder_2h"]);

  const lateStore = memoryStore({
    ...emptyNotificationStore(),
    workforceShiftPlans: [{ id: "late-shift", personId: "p1", weekStart: "2026-08-10", date: "2026-08-10", type: "Sabah", startTime: "08:00", endTime: "16:00", status: "published", publicationRevision: 1 }]
  });
  const lateScheduler = createNotificationScheduler({ store: lateStore, intervalMs: 60000, logError() {} });
  assert.equal((await lateScheduler.tick("2026-08-10T04:00:00Z")).created, 1);
  assert.deepEqual((await lateStore.read()).notifications.map((item) => item.eventType), ["shift_reminder_2h"]);
});

test("kritik stok yalnız eşik geçişinde bildirilir ve güvenli seviyeden sonra yeniden bildirilebilir", async () => {
  const data = emptyNotificationStore();
  data.stockState.products = [{ id: "stock-1", name: "Vanilya Şurubu", stockQuantity: 8, criticalThreshold: 5, unit: "şişe", active: true }];
  const store = memoryStore(data);
  const scheduler = createNotificationScheduler({ store, clock: () => new Date("2026-08-09T10:00:00Z"), intervalMs: 60000, logError() {} });
  assert.equal((await scheduler.tick("2026-08-09T10:00:00Z")).created, 0);
  await setStockQuantity(store, 4);
  assert.equal((await scheduler.tick("2026-08-09T10:01:00Z")).created, 1);
  assert.equal((await scheduler.tick("2026-08-09T10:02:00Z")).created, 0);
  await setStockQuantity(store, 9);
  assert.equal((await scheduler.tick("2026-08-09T10:03:00Z")).created, 0);
  await setStockQuantity(store, 3);
  assert.equal((await scheduler.tick("2026-08-09T10:04:00Z")).created, 1);
  const notifications = (await store.read()).notifications;
  assert.deepEqual(notifications.map((item) => item.dedupeKey), ["stock-critical:stock-1:1", "stock-critical:stock-1:2"]);
  assert.equal(notifications.every((item) => item.recipientRole === "manager"), true);
});

test("outbox 1dk, 5dk, 30dk ve 2sa retry takvimini izler ve tek başarılı teslim yapar", async () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(retryDelayMs), [60000, 300000, 1800000, 7200000, 7200000]);
  const data = emptyNotificationStore();
  updateNotificationPreferencesInStore(data, "manager", "manager", { emailEnabled: true, emailAddress: "manager@example.com" });
  createNotificationInStore(data, { recipientRole: "manager", recipientId: "manager", title: "Test", dedupeKey: "delivery-1" }, { now: "2026-08-09T10:00:00Z" });
  const store = memoryStore(data);
  let now = new Date("2026-08-09T10:00:00Z");
  let calls = 0;
  let successful = 0;
  const worker = createNotificationDeliveryWorker({
    store,
    config: { notificationsEmailEnabled: true, notificationMaxAttempts: 5, notificationWorkerIntervalMs: 100000 },
    clock: () => now,
    mailService: {
      isConfigured: () => true,
      async sendNotificationEmail() {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error("Geçici ağ hatası"), { code: "ECONNRESET" });
        successful += 1;
      }
    },
    pushService: { isConfigured: () => false, async sendNotificationPush() {} },
    logError() {}
  });
  assert.equal((await worker.tick()).processed, 1);
  let outbox = (await store.read()).notificationOutbox[0];
  assert.equal(outbox.status, "pending");
  assert.equal(outbox.nextAttemptAt, "2026-08-09T10:01:00.000Z");
  now = new Date("2026-08-09T10:00:59Z");
  assert.equal((await worker.tick()).processed, 0);
  now = new Date("2026-08-09T10:01:00Z");
  assert.equal((await worker.tick()).processed, 1);
  outbox = (await store.read()).notificationOutbox[0];
  assert.equal(outbox.nextAttemptAt, "2026-08-09T10:06:00.000Z");
  now = new Date("2026-08-09T10:06:00Z");
  assert.equal((await worker.tick()).sent, 1);
  assert.equal((await store.read()).notificationOutbox[0].status, "sent");
  assert.equal((await worker.tick()).processed, 0);
  assert.equal(calls, 3);
  assert.equal(successful, 1);
  assert.equal((await worker.health()).delivered, 1);
});

test("sessiz saatlerde e-posta ve push denemesi tüketilmeden saat sonuna ertelenir", async () => {
  const data = emptyNotificationStore();
  updateNotificationPreferencesInStore(data, "manager", "manager", {
    emailEnabled: true,
    emailAddress: "manager@example.com",
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    timezone: "Europe/Istanbul"
  });
  createNotificationInStore(data, {
    recipientRole: "manager",
    recipientId: "manager",
    title: "Sessiz saat teslimi",
    dedupeKey: "quiet-delivery"
  }, { now: "2026-08-09T20:30:00Z" });
  const store = memoryStore(data);
  let now = new Date("2026-08-09T20:30:00Z");
  let calls = 0;
  const worker = createNotificationDeliveryWorker({
    store,
    config: { notificationsEmailEnabled: true },
    clock: () => now,
    mailService: { isConfigured: () => true, async sendNotificationEmail() { calls += 1; } },
    pushService: { isConfigured: () => false, async sendNotificationPush() {} }
  });

  assert.equal((await worker.tick()).processed, 1);
  let outbox = (await store.read()).notificationOutbox[0];
  assert.equal(calls, 0);
  assert.equal(outbox.status, "pending");
  assert.equal(outbox.attemptCount, 0);
  assert.equal(outbox.nextAttemptAt, "2026-08-10T04:00:00.000Z");

  now = new Date(outbox.nextAttemptAt);
  assert.equal((await worker.tick()).sent, 1);
  outbox = (await store.read()).notificationOutbox[0];
  assert.equal(calls, 1);
  assert.equal(outbox.status, "sent");
});

test("SMTP kapalıyken ana bildirim kalır, teslim yapılandırılmamış olarak başarısız olur", async () => {
  const data = emptyNotificationStore();
  updateNotificationPreferencesInStore(data, "manager", "manager", { emailEnabled: true, emailAddress: "manager@example.com" });
  createNotificationInStore(data, { recipientRole: "manager", recipientId: "manager", title: "SMTP yok", dedupeKey: "smtp-off" });
  const store = memoryStore(data);
  let networkCalls = 0;
  const worker = createNotificationDeliveryWorker({
    store,
    config: { notificationsEmailEnabled: false },
    mailService: { isConfigured: () => true, async sendNotificationEmail() { networkCalls += 1; } },
    pushService: { isConfigured: () => false, async sendNotificationPush() {} },
    logError() {}
  });
  assert.equal((await worker.tick()).processed, 1);
  const snapshot = await store.read();
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.notificationOutbox[0].status, "failed");
  assert.match(snapshot.notificationOutbox[0].lastError, /EMAIL_NOT_CONFIGURED/);
  assert.equal(networkCalls, 0);
});

test("ortak mail servisi güvenli mutlak deep link ve dosya/URL erişim kilidi üretir", async () => {
  let transportOptions = null;
  let message = null;
  const service = createMailService({
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "sender@example.com",
    smtpPass: "secret",
    smtpFrom: "Tahmisçi <sender@example.com>",
    adminDomain: "yonetici.example.com",
    publicSiteUrl: "https://menu.example.com"
  }, {
    transportFactory(options) {
      transportOptions = options;
      return { async sendMail(payload) { message = payload; return { accepted: [payload.to] }; }, close() {} };
    }
  });
  assert.equal(absoluteNotificationLink({ recipientRole: "manager", deepLink: "/yonetici/?section=staff" }, {
    adminDomain: "yonetici.example.com"
  }), "https://yonetici.example.com/yonetici/?section=staff");
  await service.sendNotificationEmail({
    recipientRole: "manager",
    title: "Görev <tamamlandı>",
    body: "Güvenli içerik",
    deepLink: "/yonetici/?section=staff"
  }, "manager@example.com");
  assert.equal(transportOptions.disableFileAccess, true);
  assert.equal(transportOptions.disableUrlAccess, true);
  assert.equal(message.disableFileAccess, true);
  assert.equal(message.disableUrlAccess, true);
  assert.match(message.html, /https:\/\/yonetici\.example\.com\/yonetici\/\?section=staff/);
  assert.match(message.html, /Görev &lt;tamamlandı&gt;/);
  assert.doesNotMatch(message.html, /<tamamlandı>/);
});

test("Push 410 yanıtı geçersiz aboneliği kaldırır fakat ana bildirimi korur", async () => {
  const data = emptyNotificationStore();
  updateNotificationPreferencesInStore(data, "personnel", "p1", { pushEnabled: true });
  data.pushSubscriptions.push({
    id: "sub-410", ownerRole: "personnel", ownerId: "p1", endpoint: "https://push.example/gone",
    subscription: { endpoint: "https://push.example/gone", keys: { p256dh: "x", auth: "y" } }
  });
  createNotificationInStore(data, { recipientRole: "personnel", recipientId: "p1", title: "Push", dedupeKey: "push-410" });
  const store = memoryStore(data);
  const worker = createNotificationDeliveryWorker({
    store,
    config: {},
    mailService: { isConfigured: () => false, async sendNotificationEmail() {} },
    pushService: {
      isConfigured: () => true,
      async sendNotificationPush() { throw Object.assign(new Error("Gone"), { statusCode: 410 }); }
    },
    logError() {}
  });
  await worker.tick();
  const snapshot = await store.read();
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.pushSubscriptions.length, 0);
  assert.equal(snapshot.notificationOutbox[0].status, "failed");
});

test("bildirim API'si sahiplik, filtre, cursor, limit, tercih, sağlık ve retry sınırlarını korur", async (t) => {
  const data = emptyNotificationStore();
  createNotificationInStore(data, {
    recipientRole: "personnel", recipientId: "p1", category: "task", severity: "warning",
    title: "P1 yeni", dedupeKey: "p1-new", createdAt: "2026-08-09T11:00:00Z"
  });
  createNotificationInStore(data, {
    recipientRole: "personnel", recipientId: "p1", category: "shift", severity: "info",
    title: "P1 eski", dedupeKey: "p1-old", createdAt: "2026-08-09T10:00:00Z"
  });
  createNotificationInStore(data, { recipientRole: "personnel", recipientId: "p2", title: "P2 bildirimi", dedupeKey: "p2" });
  const store = memoryStore(data);
  let retriedId = "";
  const { server, base } = await notificationServer(store, {
    health: async () => ({ pending: 1 }),
    retry: async (id) => { retriedId = id; return { id, status: "pending" }; }
  });
  t.after(() => closeServer(server));

  const firstResponse = await fetch(`${base}/api/notifications?limit=1`);
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(first.notifications.length, 1);
  assert.equal(first.notifications[0].title, "P1 yeni");
  assert.equal(first.unreadCount, 2);
  assert.ok(first.nextCursor);

  const second = await (await fetch(`${base}/api/notifications?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.equal(second.notifications[0].title, "P1 eski");
  const filtered = await (await fetch(`${base}/api/notifications?severity=warning&category=task`)).json();
  assert.deepEqual(filtered.notifications.map((item) => item.title), ["P1 yeni"]);
  assert.equal((await fetch(`${base}/api/notifications?limit=abc`)).status, 400);
  assert.equal((await fetch(`${base}/api/notifications?category=bilinmeyen`)).status, 400);

  const foreignId = data.notifications.find((item) => item.recipientId === "p2").id;
  assert.equal((await fetch(`${base}/api/notifications/${foreignId}/read`, { method: "PATCH" })).status, 404);
  const ownId = first.notifications[0].id;
  const readResult = await (await fetch(`${base}/api/notifications/${ownId}/read`, { method: "PATCH" })).json();
  assert.equal(readResult.unreadCount, 1);

  const preferenceResponse = await fetch(`${base}/api/notifications/preferences`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ categories: { training: false, stock: false }, reminders: { task24h: false, shift2h: false } })
  });
  const preferenceResult = await preferenceResponse.json();
  assert.equal(preferenceResult.preferences.trainingNotifications, false);
  assert.equal(preferenceResult.preferences.stockNotifications, false);
  assert.equal(preferenceResult.preferences.taskReminder24h, false);
  assert.equal(preferenceResult.preferences.shiftReminder2h, false);

  const health = await (await fetch(`${base}/api/admin/notifications/delivery-health`)).json();
  assert.equal(health.health.pending, 1);
  const retry = await fetch(`${base}/api/admin/notifications/outbox/outbox-1/retry`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.equal(retriedId, "outbox-1");
});

test("SSE yalnız oturum sahibinin güvenli bildirim olayını gerçek zamanlı iletir", async (t) => {
  const store = memoryStore(emptyNotificationStore());
  const { server, base } = await notificationServer(store, { health: async () => ({}), retry: async () => ({}) });
  t.after(() => closeServer(server));
  const controller = new AbortController();
  const response = await fetch(`${base}/api/notifications/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  try {
    received += decoder.decode((await reader.read()).value, { stream: true });
    publishNotificationEvent({ id: "foreign", recipientRole: "personnel", recipientId: "p2", title: "Yabancı", inAppVisible: true });
    let own = null;
    await store.update((data) => {
      own = createNotificationInStore(data, {
        recipientRole: "personnel", recipientId: "p1", category: "task", title: "Canlı bildirim", dedupeKey: "sse-own"
      });
      return data;
    });
    publishNotificationEvent(own);
    const deadline = Date.now() + 2000;
    while (!received.includes("Canlı bildirim") && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("SSE zaman aşımı")), 500))
      ]);
      if (chunk.done) break;
      received += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(received, /event: notification/);
    assert.match(received, /Canlı bildirim/);
    assert.doesNotMatch(received, /Yabancı/);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});

function notificationRecord(id, readAt, archivedAt, createdAt) {
  return { id, readAt, archivedAt, createdAt };
}

function emptyNotificationStore() {
  return {
    notifications: [], notificationPreferences: [], notificationOutbox: [], pushSubscriptions: [],
    notificationSchedulerState: {}, workforceTasks: [], workforceAssignments: [], workforceShiftPlans: [],
    workforceShipments: [], workforceShiftRequests: [], recipeUsers: [], stockState: { products: [] }
  };
}

function memoryStore(initial) {
  let data = structuredClone(initial);
  let chain = Promise.resolve();
  return {
    async read() { await chain; return structuredClone(data); },
    async update(mutator) {
      let output;
      const operation = chain.catch(() => {}).then(async () => {
        const draft = structuredClone(data);
        const result = await mutator(draft);
        data = structuredClone(result === undefined ? draft : result);
        output = structuredClone(data);
      });
      chain = operation.catch(() => {});
      await operation;
      return output;
    }
  };
}

async function setStockQuantity(store, quantity) {
  await store.update((data) => {
    data.stockState.products[0].stockQuantity = quantity;
    return data;
  });
}

async function notificationServer(store, deliveryWorker) {
  const app = express();
  app.use(express.json());
  const pass = (_req, _res, next) => next();
  registerNotificationRoutes({
    app, store,
    auth: {
      requireActivePersonel(req, _res, next) { req.recipeUser = { id: "p1" }; next(); },
      requireAdmin(req, _res, next) { req.admin = { role: "admin" }; next(); }
    },
    config: {}, deliveryWorker,
    pushService: { isConfigured: () => false, publicKey: "" },
    requireAdminRequestOrigin: pass,
    requireAdminOrMainRequestOrigin: pass,
    riskOperationLimiter: pass
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, message: error.message }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}
