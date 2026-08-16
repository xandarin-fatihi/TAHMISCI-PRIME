"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runRoot = path.join(os.tmpdir(), `tahmisci-notification-hooks-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATA_FILE = path.join(runRoot, "store.json");
process.env.MEDIA_DIR = path.join(runRoot, "media");
process.env.DEFAULT_PANEL_PASSWORD = "Panel123456";
process.env.DEFAULT_RECIPE_PASSWORD = "Recipe123456";
process.env.JWT_SECRET = "notification-hook-test-secret-longer-than-thirty-two-characters";
process.env.COOKIE_SECURE = "false";
process.env.ALLOW_LOCALHOST_ORIGINS = "true";

const { app, notificationService, prepareRuntime, shutdownRuntime, store } = require("../src/app");

let server;
let baseUrl;

test.before(async () => {
  await prepareRuntime();
  await store.update((data) => {
    data.recipeState = {
      Sıcaklar: {
        "Bildirim Kahvesi": {
          Standart: {
            content: "Kahve, su",
            preparation: "Kahveyi ölç, suyu ekle ve servis et.",
            active: true
          }
        }
      }
    };
    data.stockState = stockState(10);
    return data;
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await shutdownRuntime(server, { timeoutMs: 2000 });
  await fs.rm(runRoot, { recursive: true, force: true });
});

test("pasif eğitim modülünün reçete atama, kaldırma, tamamlama ve tekrar olayları bildirim üretmez", async () => {
  const adminToken = await loginAdmin();
  const user = await createPersonnel(adminToken, `bildirim-${Date.now()}`);
  const personnelCookie = await loginPersonnel(user.username, "Personel123456");
  const published = [];
  const unsubscribe = notificationService.subscribeNotificationEvents((notification) => published.push(notification));

  try {
    const training = await createAssignment(adminToken, user.id, "training");
    assert.equal(training.response.status, 201);
    let snapshot = await store.read();
    assert.equal(countNotifications(snapshot, "recipe_assignment_created", training.body.assignment.id), 0);
    assert.equal(published.some((item) => item.eventType === "recipe_assignment_created"), false);

    const completed = await json(`/api/recipe/assignments/${encodeURIComponent(training.body.assignment.id)}/submit`, {
      method: "POST",
      headers: { Origin: baseUrl, Cookie: personnelCookie, "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(completed.response.status, 200);
    snapshot = await store.read();
    assert.equal(countNotifications(snapshot, "recipe_assignment_completed", training.body.assignment.id), 0);
    assert.equal(published.some((item) => item.eventType === "recipe_assignment_completed"), false);

    const removable = await createAssignment(adminToken, user.id, "homework");
    assert.equal(removable.response.status, 201);
    const removed = await json(`/api/admin/recipe-assignments/${encodeURIComponent(removable.body.assignment.id)}`, {
      method: "DELETE",
      headers: adminHeaders(adminToken)
    });
    assert.equal(removed.response.status, 200);
    snapshot = await store.read();
    assert.equal(countNotifications(snapshot, "recipe_assignment_removed", removable.body.assignment.id), 0);

    const retryAssignmentId = `retry-assignment-${Date.now()}`;
    await store.update((data) => {
      data.recipeAssignments.push({
        id: retryAssignmentId,
        userId: user.id,
        username: user.username,
        name: user.name,
        title: "Bildirim sınavı",
        category: "Sıcaklar",
        product: "Bildirim Kahvesi",
        size: "Standart",
        assignmentKind: "exam",
        assignmentType: "quiz",
        scopeType: "products",
        recipeItems: [{ key: "sicaklar|bildirim-kahvesi|standart", category: "Sıcaklar", product: "Bildirim Kahvesi", size: "Standart" }],
        questions: [{ text: "Doğru seçenek?", options: ["Yanlış", "Doğru"], correctIndex: 1, key: "q1" }],
        passingScore: 100,
        status: "pending",
        retryCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return data;
    });
    const retry = await json(`/api/recipe/assignments/${encodeURIComponent(retryAssignmentId)}/submit`, {
      method: "POST",
      headers: { Origin: baseUrl, Cookie: personnelCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [0] })
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.assignment.status, "retry_required");
    snapshot = await store.read();
    assert.equal(countNotifications(snapshot, "recipe_assignment_retry_required", retryAssignmentId), 0);
    assert.equal(published.some((item) => item.eventType === "recipe_assignment_retry_required"), false);
  } finally {
    unsubscribe();
  }
});

test("stok yalnız eşik durum geçişinde yönetici bildirimi üretir ve aynı durumu çoğaltmaz", async () => {
  const adminToken = await loginAdmin();
  await store.update((data) => {
    data.stockState = stockState(10);
    data.notifications = (data.notifications || []).filter((item) => item.entityId !== "notification-stock-product");
    return data;
  });

  assert.equal((await saveStock(adminToken, 4)).response.status, 200);
  assert.equal((await saveStock(adminToken, 4)).response.status, 200);
  let snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "stock_critical", "notification-stock-product"), 1);

  assert.equal((await saveStock(adminToken, 8)).response.status, 200);
  assert.equal((await saveStock(adminToken, 8)).response.status, 200);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "stock_recovered", "notification-stock-product"), 1);

  const movement = await json("/api/stock/movements", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ productId: "notification-stock-product", type: "stock_out", quantity: 4, reason: "Eşik testi" })
  });
  assert.equal(movement.response.status, 201);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "stock_critical", "notification-stock-product"), 2, "güvenli seviyeden sonraki yeni kritik geçiş bildirilmelidir");
  assert.ok(snapshot.notifications.filter((item) => item.entityId === "notification-stock-product").every((item) => item.recipientRole === "manager"));
});

test("personel pasifleştirme ve kalıcı silme push abonelikleriyle bekleyen teslimleri durdurur", async () => {
  const adminToken = await loginAdmin();
  const user = await createPersonnel(adminToken, `teslim-${Date.now()}`);
  await addDeliveryRecords(user.id, "deactivate");

  const deactivated = await json(`/api/admin/recipe-users/${encodeURIComponent(user.id)}`, {
    method: "DELETE",
    headers: adminHeaders(adminToken)
  });
  assert.equal(deactivated.response.status, 200);
  assertDeliverySuspended(await store.read(), user.id, "deactivate");

  const reactivated = await json(`/api/admin/recipe-users/${encodeURIComponent(user.id)}`, {
    method: "PUT",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ name: user.name, username: user.username, password: "", active: true })
  });
  assert.equal(reactivated.response.status, 200);
  await addDeliveryRecords(user.id, "delete");

  const deleted = await json(`/api/admin/recipe-users/${encodeURIComponent(user.id)}/permanent`, {
    method: "DELETE",
    headers: adminHeaders(adminToken)
  });
  assert.equal(deleted.response.status, 200);
  assertDeliverySuspended(await store.read(), user.id, "delete");
});

test("workforce görev bildirimleri gerçek rotalarda idempotent oluşur", async () => {
  const suffix = Date.now();
  const adminToken = await loginAdmin();
  const user = await createPersonnel(adminToken, `gorev-${suffix}`);
  const personnelCookie = await loginPersonnel(user.username, "Personel123456");
  const createKey = `notify-task-create-${suffix}`;
  const createBody = {
    title: "Bildirim görev testi",
    items: [{ id: "kontrol", text: "Kontrolü tamamla" }],
    targetType: "selected",
    assignedUserIds: [user.id],
    priority: "high",
    requestId: createKey
  };
  const created = await workforceJson("/api/admin/workforce/tasks", adminToken, createKey, createBody, "POST");
  const createReplay = await workforceJson("/api/admin/workforce/tasks", adminToken, createKey, createBody, "POST");
  assert.equal(created.response.status, 201);
  assert.equal(createReplay.response.status, 200);
  assert.equal(createReplay.body.idempotent, true);
  assert.equal(createReplay.body.task.id, created.body.task.id);

  const taskId = created.body.task.id;
  let snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "task_assigned", taskId), 1);

  const updateKey = `notify-task-update-${suffix}`;
  const updateBody = { title: "Bildirim görevi güncellendi", priority: "urgent", requestId: updateKey };
  const updated = await workforceJson(`/api/admin/workforce/tasks/${encodeURIComponent(taskId)}`, adminToken, updateKey, updateBody, "PATCH");
  const updateReplay = await workforceJson(`/api/admin/workforce/tasks/${encodeURIComponent(taskId)}`, adminToken, updateKey, updateBody, "PATCH");
  assert.equal(updated.response.status, 200);
  assert.equal(updateReplay.body.idempotent, true);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "task_updated", taskId), 1);

  const itemId = created.body.task.items[0].id;
  const completeKey = `notify-task-complete-${suffix}`;
  const completeBody = { completed: true, requestId: completeKey };
  const completed = await personnelWorkforceJson(
    `/api/workforce/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`,
    personnelCookie,
    completeKey,
    completeBody,
    "PATCH"
  );
  const completeReplay = await personnelWorkforceJson(
    `/api/workforce/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`,
    personnelCookie,
    completeKey,
    completeBody,
    "PATCH"
  );
  assert.equal(completed.response.status, 200);
  assert.equal(completeReplay.body.idempotent, true);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "task_completed", taskId), 1);
});

test("sevkiyat bildirimleri ve stok etkisi create, approve ve reject tekrarlarında exactly-once kalır", async () => {
  const suffix = Date.now();
  const adminToken = await loginAdmin();
  const user = await createPersonnel(adminToken, `sevkiyat-${suffix}`);
  const personnelCookie = await loginPersonnel(user.username, "Personel123456");
  assert.equal((await saveStock(adminToken, 10)).response.status, 200);

  const createKey = `notify-shipment-create-${suffix}`;
  const createBody = {
    items: [{ productId: "notification-stock-product", quantity: 2, unit: "şişe" }],
    note: "Onay bildirimi testi",
    requestId: createKey
  };
  const created = await personnelWorkforceJson("/api/workforce/shipments", personnelCookie, createKey, createBody, "POST");
  const createReplay = await personnelWorkforceJson("/api/workforce/shipments", personnelCookie, createKey, createBody, "POST");
  assert.equal(created.response.status, 201);
  assert.equal(createReplay.body.idempotent, true);
  assert.equal(createReplay.body.shipment.id, created.body.shipment.id);
  let snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shipment_reported", created.body.shipment.id), 1);
  assert.equal(stockQuantity(snapshot), 10, "sevkiyat bildirimi stoğu değiştirmemelidir");

  const approveKey = `notify-shipment-approve-${suffix}`;
  const approvePath = `/api/admin/workforce/shipments/${encodeURIComponent(created.body.shipment.id)}/approve`;
  const approved = await workforceJson(approvePath, adminToken, approveKey, { note: "Kabul", requestId: approveKey }, "POST");
  const approveReplay = await workforceJson(approvePath, adminToken, approveKey, { note: "Kabul", requestId: approveKey }, "POST");
  const approveSecondKey = `notify-shipment-approve-second-${suffix}`;
  const approveSecond = await workforceJson(approvePath, adminToken, approveSecondKey, { note: "Tekrar", requestId: approveSecondKey }, "POST");
  assert.equal(approved.response.status, 200);
  assert.equal(approveReplay.body.idempotent, true);
  assert.equal(approveSecond.body.idempotent, true);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shipment_approved", created.body.shipment.id), 1);
  assert.equal(stockQuantity(snapshot), 12);
  assert.equal((snapshot.stockState.movements || []).filter((item) => item.shipmentId === created.body.shipment.id).length, 1);

  const rejectCreateKey = `notify-shipment-reject-create-${suffix}`;
  const rejectedShipment = await personnelWorkforceJson("/api/workforce/shipments", personnelCookie, rejectCreateKey, {
    items: [{ productId: "notification-stock-product", quantity: 1, unit: "şişe" }],
    requestId: rejectCreateKey
  }, "POST");
  assert.equal(rejectedShipment.response.status, 201);
  const rejectKey = `notify-shipment-reject-${suffix}`;
  const rejectPath = `/api/admin/workforce/shipments/${encodeURIComponent(rejectedShipment.body.shipment.id)}/reject`;
  const rejected = await workforceJson(rejectPath, adminToken, rejectKey, { rejectionReason: "Miktarı kontrol edin", requestId: rejectKey }, "POST");
  const rejectReplay = await workforceJson(rejectPath, adminToken, rejectKey, { rejectionReason: "Miktarı kontrol edin", requestId: rejectKey }, "POST");
  assert.equal(rejected.response.status, 200);
  assert.equal(rejectReplay.body.idempotent, true);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shipment_rejected", rejectedShipment.body.shipment.id), 1);
  assert.equal(stockQuantity(snapshot), 12, "reddetme stoğu değiştirmemelidir");
});

test("shift talep kararları ve yayın bildirimleri idempotent kalır, taslak bildirim üretmez", async () => {
  const suffix = Date.now();
  const adminToken = await loginAdmin();
  const user = await createPersonnel(adminToken, `shift-${suffix}`);
  const personnelCookie = await loginPersonnel(user.username, "Personel123456");
  const weekStart = futureMonday();

  const requestKey = `notify-shift-request-${suffix}`;
  const requestBody = { type: "morning", date: weekStart, description: "Sabah tercihi", requestId: requestKey };
  const requested = await personnelWorkforceJson("/api/workforce/shift-requests", personnelCookie, requestKey, requestBody, "POST");
  const requestReplay = await personnelWorkforceJson("/api/workforce/shift-requests", personnelCookie, requestKey, requestBody, "POST");
  assert.equal(requested.response.status, 201);
  assert.equal(requestReplay.body.idempotent, true);
  let snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shift_request_created", requested.body.request.id), 1);

  const approveKey = `notify-shift-approve-${suffix}`;
  const approvePath = `/api/admin/workforce/shift-requests/${encodeURIComponent(requested.body.request.id)}/approve`;
  const approved = await workforceJson(approvePath, adminToken, approveKey, { note: "Uygun", requestId: approveKey }, "POST");
  const approveReplay = await workforceJson(approvePath, adminToken, approveKey, { note: "Uygun", requestId: approveKey }, "POST");
  assert.equal(approved.response.status, 200);
  assert.equal(approveReplay.body.idempotent, true);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shift_request_approved", requested.body.request.id), 1);

  const rejectRequestKey = `notify-shift-reject-request-${suffix}`;
  const rejectDate = addDays(weekStart, 1);
  const rejectRequest = await personnelWorkforceJson("/api/workforce/shift-requests", personnelCookie, rejectRequestKey, {
    type: "evening", date: rejectDate, requestId: rejectRequestKey
  }, "POST");
  assert.equal(rejectRequest.response.status, 201);
  const rejectKey = `notify-shift-reject-${suffix}`;
  const rejectPath = `/api/admin/workforce/shift-requests/${encodeURIComponent(rejectRequest.body.request.id)}/reject`;
  const rejected = await workforceJson(rejectPath, adminToken, rejectKey, { note: "Plan dolu", requestId: rejectKey }, "POST");
  const rejectReplay = await workforceJson(rejectPath, adminToken, rejectKey, { note: "Plan dolu", requestId: rejectKey }, "POST");
  assert.equal(rejected.response.status, 200);
  assert.equal(rejectReplay.body.idempotent, true);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shift_request_rejected", rejectRequest.body.request.id), 1);

  const plan = [{ personId: user.id, date: weekStart, type: "morning", startTime: "08:00", endTime: "16:00", source: "manual" }];
  const draftKey = `notify-shift-draft-${suffix}`;
  const beforeDraftNotifications = countNotifications(await store.read(), "shift_published", weekStart);
  const drafted = await workforceJson(`/api/admin/workforce/shifts/${weekStart}`, adminToken, draftKey, {
    plans: plan, publish: false, requestId: draftKey
  }, "PUT");
  assert.equal(drafted.response.status, 200);
  assert.equal(countNotifications(await store.read(), "shift_published", weekStart), beforeDraftNotifications);

  const publishKey = `notify-shift-publish-${suffix}`;
  const publishBody = { plans: drafted.body.plans, publish: true, requestId: publishKey };
  const published = await workforceJson(`/api/admin/workforce/shifts/${weekStart}`, adminToken, publishKey, publishBody, "PUT");
  const publishReplay = await workforceJson(`/api/admin/workforce/shifts/${weekStart}`, adminToken, publishKey, publishBody, "PUT");
  assert.equal(published.response.status, 200);
  assert.equal(publishReplay.body.idempotent, true);
  assert.equal(publishReplay.body.publicationRevision, published.body.publicationRevision);
  snapshot = await store.read();
  assert.equal(countNotifications(snapshot, "shift_published", weekStart), 1);
});

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

async function loginAdmin() {
  const result = await json("/api/admin/login", {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "Panel123456" })
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

function adminHeaders(token) {
  return { Authorization: `Bearer ${token}`, Origin: baseUrl, "Content-Type": "application/json" };
}

function workforceJson(pathname, token, requestId, body, method) {
  return json(pathname, {
    method,
    headers: { ...adminHeaders(token), "Idempotency-Key": requestId },
    body: JSON.stringify(body)
  });
}

function personnelWorkforceJson(pathname, cookie, requestId, body, method) {
  return json(pathname, {
    method,
    headers: { Origin: baseUrl, Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify(body)
  });
}

async function createPersonnel(adminToken, username) {
  const result = await json("/api/admin/recipe-users", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ name: "Bildirim Personeli", username, password: "Personel123456" })
  });
  assert.equal(result.response.status, 201);
  return result.body.user;
}

async function loginPersonnel(username, password) {
  const result = await json("/api/recipe/login", {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assert.equal(result.response.status, 200);
  return String(result.response.headers.get("set-cookie") || "").split(";")[0];
}

function createAssignment(adminToken, userId, assignmentKind) {
  return json("/api/admin/recipe-assignments", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({
      userId,
      category: "Sıcaklar",
      product: "Bildirim Kahvesi",
      size: "Standart",
      assignmentKind,
      scopeType: "products"
    })
  });
}

function stockState(quantity) {
  return {
    schemaVersion: 1,
    categories: [{ id: "notification-stock-category", name: "Bildirim Stok", active: true }],
    products: [{
      id: "notification-stock-product",
      categoryId: "notification-stock-category",
      name: "Vanilya Şurubu",
      productName: "Vanilya Şurubu",
      productCode: "STK-NOTIFICATION-001",
      unit: "şişe",
      stockQuantity: quantity,
      orderThreshold: 7,
      criticalThreshold: 5,
      active: true
    }],
    movements: []
  };
}

function saveStock(adminToken, quantity) {
  return json("/api/admin/stock", {
    method: "PUT",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({ stockState: stockState(quantity) })
  });
}

function countNotifications(data, eventType, entityId) {
  return (data.notifications || []).filter((item) => item.eventType === eventType && item.entityId === entityId).length;
}

function stockQuantity(data) {
  return Number((data.stockState.products || []).find((item) => item.id === "notification-stock-product").stockQuantity);
}

function futureMonday() {
  const date = new Date(Date.now() + 14 * 86400000);
  date.setUTCHours(12, 0, 0, 0);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (8 - weekday) % 7);
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function addDeliveryRecords(userId, suffix) {
  await store.update((data) => {
    data.pushSubscriptions = (data.pushSubscriptions || []).concat({
      id: `push-${suffix}`,
      ownerRole: "personnel",
      ownerId: userId,
      endpoint: `https://push.test/${suffix}`,
      subscription: { endpoint: `https://push.test/${suffix}`, keys: { p256dh: "key", auth: "auth" } }
    });
    data.notificationOutbox = (data.notificationOutbox || []).concat(
      deliveryRecord(userId, suffix, "pending"),
      deliveryRecord(userId, `${suffix}-failed`, "failed"),
      deliveryRecord(userId, `${suffix}-sent`, "sent")
    );
    return data;
  });
}

function deliveryRecord(userId, suffix, status) {
  return {
    id: `outbox-${suffix}`,
    notificationId: `notification-${suffix}`,
    channel: "push",
    recipientRole: "personnel",
    recipientId: userId,
    destination: `https://push.test/${suffix}`,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function assertDeliverySuspended(data, userId, suffix) {
  assert.equal((data.pushSubscriptions || []).some((item) => item.ownerRole === "personnel" && item.ownerId === userId), false);
  assert.equal(data.notificationOutbox.find((item) => item.id === `outbox-${suffix}`).status, "cancelled");
  assert.equal(data.notificationOutbox.find((item) => item.id === `outbox-${suffix}-failed`).status, "cancelled");
  assert.equal(data.notificationOutbox.find((item) => item.id === `outbox-${suffix}-sent`).status, "sent");
}
