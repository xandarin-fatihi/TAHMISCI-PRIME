"use strict";

const { normalizeProductCode } = require("./store/product-code-registry");
const stockService = require("./stock-service");

const SHIPMENT_UNITS = new Set(["koli", "paket", "adet", "kg", "gr", "litre", "ml", "şişe"]);
const SHIFT_TYPES = new Set(["morning", "evening", "leave", "custom", "unassigned"]);
const REQUEST_TYPES = new Set(["leave", "morning", "evening", "custom"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WORKFORCE_IDEMPOTENCY_LIMIT = 500;
const WORKFORCE_SSE_RETRY_MS = 5000;
const WORKFORCE_SSE_HEARTBEAT_MS = 25000;

function registerWorkforceRoutes(deps) {
  const {
    app,
    store,
    auth,
    crypto,
    normalizeStockState,
    requireAdminRequestOrigin,
    requireAdminOrMainRequestOrigin,
    broadcastStockUpdate,
    queueStockThresholdNotifications,
    notificationService,
    notifyProcurementChange,
    publishGatewayEvent
  } = deps;

  const createId = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const isoNow = () => new Date().toISOString();
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const activeUsers = (data) => (data.recipeUsers || []).filter((user) => user.active !== false);
  const currentStaff = (req) => req.recipeUser || null;
  const workforceClients = new Set();
  const adminWorkforceClients = new Set();

  function queueNotification(data, pending, input) {
    if (!notificationService || typeof notificationService.createNotificationInStore !== "function") return null;
    const notification = notificationService.createNotificationInStore(data, input);
    if (notification) pending.push(notification);
    return notification;
  }

  function publishNotifications(pending) {
    if (!notificationService || typeof notificationService.publishNotificationEvent !== "function") return;
    for (const notification of pending) notificationService.publishNotificationEvent(notification);
  }

  function managerNotification(input) {
    return { recipientRole: "manager", recipientId: "manager", ...input };
  }

  function personnelNotification(personId, input) {
    return { recipientRole: "personnel", recipientId: String(personId || ""), ...input };
  }

  function queueFaturaShipmentNotifications(data, pending, shipment) {
    const receiptCapabilities = new Set(["procurement.read", "receipt.approve", "receipt.reject", "accounting.read", "accounting.post", "supplier.manage"]);
    const branchId = String(shipment && shipment.branchId || "main");
    for (const user of activeUsers(data)) {
      if (!user || user.faturaAccessEnabled === false || String(user.id || "") === String(shipment.userId || "")) continue;
      if (String(user.branchId || "main") !== branchId) continue;
      const capabilities = Array.isArray(user.faturaCapabilities) ? user.faturaCapabilities : [];
      if (!capabilities.some((item) => receiptCapabilities.has(String(item)))) continue;
      queueNotification(data, pending, personnelNotification(user.id, {
        category: "shipment",
        eventType: "shipment_reported",
        title: "Yeni mal kabul onay bekliyor",
        body: `${shipment.userName || "Personel"} tarafından ${(shipment.items || []).length} ürünlük sevkiyat bildirildi.`,
        severity: "warning",
        entityType: "shipment",
        entityId: shipment.id,
        deepLink: `/fatura/?view=shipments&shipmentId=${encodeURIComponent(shipment.id)}`,
        dedupeKey: `shipment-reported:${shipment.id}:fatura:${user.id}`,
        metadata: { branchId, personId: shipment.userId, personName: shipment.userName, itemCount: (shipment.items || []).length }
      }));
    }
  }

  function operationRequestId(req) {
    const value = String(
      req.get("Idempotency-Key")
      || req.get("X-Request-ID")
      || req.body && req.body.requestId
      || ""
    ).trim().slice(0, 160);
    if (value && !/^[a-zA-Z0-9._:-]{8,160}$/.test(value)) {
      throw fail("Geçerli bir requestId veya Idempotency-Key gerekli.", 400);
    }
    return value;
  }

  function workforceRevision(data) {
    return Math.max(0, Number(data.revisions && data.revisions.workforce || 0));
  }

  function assertExpectedRevision(data, body) {
    const raw = body && body.expectedRevision;
    if (raw === undefined || raw === null || raw === "") return;
    const expected = Number(raw);
    if (!Number.isInteger(expected) || expected < 0) throw fail("Beklenen workforce revision geçersiz.", 400);
    if (expected !== workforceRevision(data)) throw fail("Workforce verisi başka bir işlemle güncellendi. Yenileyip tekrar deneyin.", 409);
  }

  function findIdempotent(data, operation, requestId) {
    if (!requestId) return null;
    const entries = data.idempotencyRequests || [];
    const matching = entries.find((item) =>
      item && item.scope === "workforce" && item.operation === operation && item.requestId === requestId
    ) || null;
    if (!matching && entries.some((item) => item && item.scope === "workforce" && item.requestId === requestId)) {
      throw fail("Bu requestId daha önce farklı bir workforce işlemi için kullanıldı.", 409);
    }
    return matching;
  }

  function recordIdempotent(data, operation, requestId, resourceId, revision, extra = {}) {
    if (!requestId) return;
    data.idempotencyRequests = (data.idempotencyRequests || []).concat({
      scope: "workforce",
      operation,
      requestId,
      resourceId: String(resourceId || ""),
      revision,
      createdAt: isoNow(),
      ...extra
    }).slice(-WORKFORCE_IDEMPOTENCY_LIMIT);
  }

  function recordProcurementShipmentAudit(data, req, shipment, requestId, stockMovementRef, timestamp, action = "shipment.stock-approve") {
    const actor = req.procurementActor || (req.admin ? {
      type: "admin",
      id: String(req.admin.userId || req.admin.sub || "admin"),
      name: String(req.admin.name || req.admin.username || "Yönetici")
    } : null);
    if (!actor || !actor.id) return 0;
    const procurement = data.procurement && typeof data.procurement === "object" && !Array.isArray(data.procurement)
      ? data.procurement
      : (data.procurement = {});
    const current = Math.max(0, Math.trunc(Number(procurement.revision || 0)));
    const expectedRaw = req.body && req.body.procurementExpectedRevision;
    const hasExpected = expectedRaw !== undefined && expectedRaw !== null && expectedRaw !== "";
    const expected = Number(expectedRaw);
    if (req.procurementActor && (!hasExpected || !Number.isInteger(expected) || expected < 0)) throw fail("Geçerli procurement expectedRevision gerekli.", 400);
    if (hasExpected && expected !== current) throw fail("Tahmisçi Fatura verisi başka bir işlemle güncellendi. Yenileyip tekrar deneyin.", 409);
    const revision = current + 1;
    procurement.version = Math.max(1, Math.trunc(Number(procurement.version || 0)));
    procurement.revision = revision;
    procurement.auditEvents = (Array.isArray(procurement.auditEvents) ? procurement.auditEvents : []).concat({
      id: createId("procurement-audit"),
      action,
      entityType: "shipment",
      entityId: shipment.id,
      actorType: actor.type === "admin" ? "admin" : "personel",
      actorId: String(actor.id),
      actorName: String(actor.name || actor.id),
      revision,
      requestId,
      metadata: stockMovementRef ? { stockMovementRef } : {},
      createdAt: timestamp
    }).slice(-5000);
    data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
    data.revisions.procurement = revision;
    data.revisions.shipment = Math.max(0, Number(data.revisions.shipment || 0)) + 1;
    return revision;
  }

  function recordProcurementShipmentReportedAudit(data, actor, shipment, requestId, timestamp) {
    const procurement = data.procurement && typeof data.procurement === "object" && !Array.isArray(data.procurement)
      ? data.procurement
      : (data.procurement = {});
    const revision = Math.max(0, Math.trunc(Number(procurement.revision || 0))) + 1;
    procurement.version = Math.max(1, Math.trunc(Number(procurement.version || 0)));
    procurement.revision = revision;
    procurement.auditEvents = (Array.isArray(procurement.auditEvents) ? procurement.auditEvents : []).concat({
      id: createId("procurement-audit"),
      action: "shipment.reported",
      entityType: "shipment",
      entityId: shipment.id,
      actorType: "personel",
      actorId: String(actor && actor.id || shipment.userId || ""),
      actorName: String(actor && (actor.name || actor.username) || shipment.userName || "Personel"),
      revision,
      requestId,
      metadata: { branchId: String(shipment.branchId || "main"), itemCount: (shipment.items || []).length },
      createdAt: timestamp
    }).slice(-5000);
    data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
    data.revisions.procurement = revision;
    data.revisions.shipment = Math.max(0, Number(data.revisions.shipment || 0)) + 1;
    return revision;
  }

  function touchWorkforceRevision(data) {
    if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) data.revisions = {};
    data.revisions.workforce = workforceRevision(data) + 1;
    return data.revisions.workforce;
  }

  async function updateStore(mutator) {
    let beforeRevision = 0;
    let afterRevision = 0;
    const saved = await store.update((data, context) => {
      beforeRevision = workforceRevision(data);
      const result = mutator(data, context);
      if (result === context.noChange) {
        afterRevision = beforeRevision;
        return context.noChange;
      }
      const next = result === undefined ? data : result;
      afterRevision = workforceRevision(next);
      return next;
    });
    if (afterRevision > beforeRevision) broadcastWorkforceInvalidation(afterRevision);
    return saved;
  }

  function dataForRequest(req) {
    return req.storeSnapshot || null;
  }

  async function resolveRequestData(req) {
    return dataForRequest(req) || store.read();
  }

  function requestedScopes(req) {
    const value = String(req.query && (req.query.scope || req.query.projection) || "").trim().toLowerCase();
    if (!value || value === "full") return null;
    return new Set(value.split(",").map((part) => part.trim()).filter(Boolean));
  }

  function includesScope(scopes, name) {
    return !scopes || scopes.has(name);
  }

  function openWorkforceEvents(req, res, clients, data, ownerKey) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity"
    });
    if (res.socket) res.socket.setTimeout(0);
    res.write(`retry: ${WORKFORCE_SSE_RETRY_MS}\n\n`);
    const revision = workforceRevision(data);
    const rawLastId = Number(String(req.get("Last-Event-ID") || "").split(":").pop() || 0);
    writeWorkforceSse(res, "ready", {
      revision,
      scope: "workforce",
      action: "ready",
      requiresRefetch: Number.isSafeInteger(rawLastId) && rawLastId > 0 && rawLastId < revision
    }, revision);

    const clientId = cleanClientId(req.query && req.query.clientId);
    if (clientId) {
      for (const existing of Array.from(clients)) {
        if (existing.clientId === clientId && existing.ownerKey === ownerKey) closeClient(existing, clients);
      }
    }
    const client = {
      res,
      ownerKey,
      clientId,
      heartbeat: setInterval(() => {
        if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
      }, WORKFORCE_SSE_HEARTBEAT_MS)
    };
    if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
    clients.add(client);
    req.once("close", () => closeClient(client, clients, false));
  }

  function broadcastWorkforceInvalidation(revision) {
    const payload = {
      revision,
      scope: "workforce",
      action: "invalidate",
      changedIds: [],
      requiresRefetch: true,
      updatedAt: isoNow()
    };
    for (const clients of [workforceClients, adminWorkforceClients]) {
      for (const client of clients) {
        if (!client.res.writableEnded) writeWorkforceSse(client.res, "workforce", payload, revision);
      }
    }
    if (typeof publishGatewayEvent === "function") publishGatewayEvent({
      topic: "workforce",
      type: "workforce.updated",
      entityType: "workforce",
      revision,
      timestamp: payload.updatedAt,
      targets: ["personel", "yonetici", "fatura"]
    });
  }

  function writeWorkforceSse(res, event, payload, revision) {
    if (revision !== undefined && revision !== null) res.write(`id: ${revision}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function cleanClientId(value) {
    const id = String(value || "").trim();
    return /^[a-z0-9._:-]{8,128}$/i.test(id) ? id : "";
  }

  function closeClient(client, clients, end = true) {
    if (!client) return;
    if (client.heartbeat) clearInterval(client.heartbeat);
    clients.delete(client);
    if (end) {
      try { if (!client.res.writableEnded) client.res.end(); } catch (_error) {}
    }
  }

  function requireStaff(req, res) {
    if (!req.recipe || req.recipe.role !== "recipe" || !req.recipe.userId || !currentStaff(req)) {
      res.status(403).json({ ok: false, message: "Personel oturumu gerekli." });
      return false;
    }
    return true;
  }

  function activity(data, type, user, extra = {}) {
    const timestamp = isoNow();
    const entry = {
      id: createId("activity"),
      type,
      action: type,
      actorId: String(user && user.id || "admin"),
      actorRole: user && user.id && user.id !== "admin" ? "personel" : "admin",
      userId: String(user && user.id || "admin"),
      name: String(user && user.name || "Yönetici"),
      username: String(user && user.username || ""),
      createdAt: timestamp,
      ...extra
    };
    data.recipeActivity = (data.recipeActivity || []).concat(entry).slice(-5000);
    return entry;
  }

  function replayResponse(record) {
    if (!record) return null;
    return {
      ...(record.response && typeof record.response === "object" ? record.response : {
        ok: true,
        requestId: record.requestId,
        revision: record.revision,
        resourceId: record.resourceId
      }),
      idempotent: true
    };
  }

  function assignmentPercent(assignment, task) {
    const itemIds = new Set((task.items || []).map((item) => item.id));
    const completed = new Set((assignment.completedItemIds || []).filter((itemId) => itemIds.has(itemId)));
    return itemIds.size ? Math.round((completed.size / itemIds.size) * 100) : assignment.status === "completed" ? 100 : 0;
  }

  function publicAssignment(assignment, task, usersById) {
    const user = usersById.get(assignment.userId);
    return {
      ...assignment,
      name: user ? user.name : assignment.userName || "Personel",
      username: user ? user.username : assignment.username || "",
      completedItemIds: assignment.completedItemIds || [],
      percent: assignmentPercent(assignment, task),
      workflowStatus: assignmentWorkflowStatus(assignment, task)
    };
  }

  function publicTask(task, assignments, usersById) {
    const taskAssignments = assignments
      .filter((assignment) => assignment.taskId === task.id)
      .map((assignment) => publicAssignment(assignment, task, usersById));
    const completed = taskAssignments.filter((assignment) => assignment.status === "completed").length;
    return {
      ...task,
      assignments: taskAssignments,
      percent: taskAssignments.length
        ? Math.round(taskAssignments.reduce((sum, assignment) => sum + assignment.percent, 0) / taskAssignments.length)
        : 0,
      completedAssignmentCount: completed,
      assignmentCount: taskAssignments.length,
      workflowStatus: taskWorkflowStatus(task, taskAssignments)
    };
  }

  function publicShipment(shipment, stockState) {
    const products = new Map((stockState.products || []).map((product) => [product.id, product]));
    const productsByCode = new Map((stockState.products || [])
      .map((product) => [normalizeProductCode(product.productCode), product])
      .filter(([code]) => code));
    const destinationLocation = (stockState.locations || []).find((location) =>
      String(location.id) === String(shipment && shipment.destinationLocationId || "")
    ) || null;
    return {
      ...shipment,
      destinationLocationId: shipment && shipment.destinationLocationId || null,
      destinationLocationName: destinationLocation
        ? destinationLocation.name
        : shipment && shipment.destinationLocationName || null,
      items: (shipment.items || []).map((line) => {
        const lineCode = normalizeProductCode(line.stockProductCode || line.productCode);
        const product = productsByCode.get(lineCode) || products.get(line.stockProductId || line.productId);
        const locationBalance = destinationLocation && product
          ? stockService.getProductBalance(stockState, destinationLocation.id, product.id)
          : null;
        // Shipments are received into one location. Legacy records without a
        // selected target retain the total projection until a manager chooses
        // the target during approval.
        const currentStock = Number(locationBalance ? locationBalance.quantity : product && product.stockQuantity || 0);
        const baseQuantity = Number(line.baseQuantity ?? line.quantity);
        return {
          ...line,
          productCode: product && product.productCode || lineCode || "",
          stockProductCode: product && product.productCode || lineCode || "",
          currentStock,
          currentStockUnit: product ? product.unit : line.baseUnit,
          expectedStock: shipment.stockAppliedAt ? currentStock : currentStock + baseQuantity,
          destinationLocationId: destinationLocation && destinationLocation.id || shipment && shipment.destinationLocationId || null,
          destinationLocationName: destinationLocation && destinationLocation.name || shipment && shipment.destinationLocationName || null
        };
      })
    };
  }

  function publicUser(user) {
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      active: user.active !== false,
      profile: user.profile || {}
    };
  }

  function workforceStats(data) {
    const today = turkeyDateKey();
    const users = data.recipeUsers || [];
    const activeIds = new Set(activeUsers(data).map((user) => user.id));
    const publishedToday = new Set(
      (data.workforceShiftPlans || [])
        .filter((plan) => plan.status === "published" && plan.date === today && plan.type !== "leave" && activeIds.has(plan.personId))
        .map((plan) => plan.personId)
    );
    const pendingShipments = (data.workforceShipments || []).filter((item) => item.status === "onay_bekliyor").length;
    const pendingRequests = (data.workforceShiftRequests || []).filter((item) => item.status === "onay_bekliyor").length;
    return {
      totalPersonnel: users.length,
      activePersonnel: activeIds.size,
      todayShift: publishedToday.size,
      pendingOperations: pendingShipments + pendingRequests,
      pendingShipments,
      pendingShiftRequests: pendingRequests
    };
  }

  app.get(
    "/api/admin/workforce",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const data = await resolveRequestData(req);
        const users = data.recipeUsers || [];
        const usersById = new Map(users.map((user) => [user.id, user]));
        const stockState = normalizeStockState(data.stockState);
        const requestedWeek = String(req.query.weekStart || "");
        const plans = requestedWeek
          ? (data.workforceShiftPlans || []).filter((plan) => plan.weekStart === requestedWeek)
          : (data.workforceShiftPlans || []);
        const scopes = requestedScopes(req);
        const payload = {
          ok: true,
          stats: workforceStats(data),
          users: activeUsers(data).map(publicUser),
          allUsers: users.map(publicUser),
          stockUpdatedAt: data.stockUpdatedAt || null,
          revision: workforceRevision(data)
        };
        if (includesScope(scopes, "tasks")) {
          payload.tasks = (data.workforceTasks || []).map((task) => publicTask(task, data.workforceAssignments || [], usersById));
          payload.taskActivity = (data.recipeActivity || []).filter((item) => item.workforceTaskId).slice(-1000);
        }
        if (includesScope(scopes, "shipments")) {
          payload.shipments = (data.workforceShipments || [])
            .map((shipment) => publicShipment(shipment, stockState))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        }
        if (includesScope(scopes, "shift")) {
          payload.shiftRequests = (data.workforceShiftRequests || []).slice()
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          payload.shiftPlans = plans;
          payload.shiftPlanRevisions = (data.workforceShiftPlanRevisions || []).filter((revision) =>
            !requestedWeek || revision.weekStart === requestedWeek
          );
          payload.shiftSettings = normalizeShiftSettings(data.workforceShiftSettings);
        }
        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/api/workforce/me",
    requireAdminOrMainRequestOrigin,
    auth.requirePersonelOrPreview,
    async (req, res, next) => {
      try {
        const data = await resolveRequestData(req);
        const previewMode = req.recipe && req.recipe.role === "preview";
        if (!previewMode && !requireStaff(req, res)) return;
        const staff = previewMode ? (activeUsers(data)[0] || null) : currentStaff(req);
        const userId = staff ? staff.id : "";
        const usersById = new Map((data.recipeUsers || []).map((user) => [user.id, user]));
        const assignments = (data.workforceAssignments || []).filter((assignment) => assignment.userId === userId);
        const assignmentTaskIds = new Set(assignments.map((assignment) => assignment.taskId));
        const requestedWeek = String(req.query.weekStart || "");
        const plans = (data.workforceShiftPlans || []).filter((plan) =>
          plan.personId === userId &&
          plan.status === "published" &&
          (!requestedWeek || plan.weekStart === requestedWeek)
        );
        const stockState = normalizeStockState(data.stockState);
        const scopes = requestedScopes(req);
        const payload = {
          ok: true,
          preview: previewMode,
          user: staff ? publicUser(staff) : null,
          revision: workforceRevision(data)
        };
        if (includesScope(scopes, "tasks")) {
          payload.tasks = (data.workforceTasks || [])
            .filter((task) => assignmentTaskIds.has(task.id) && task.status !== "archived")
            .map((task) => ({
              ...publicTask(task, assignments, usersById),
              assignedUserIds: [userId]
            }));
        }
        if (includesScope(scopes, "shipments")) {
          payload.shipments = (data.workforceShipments || [])
            .filter((shipment) => shipment.userId === userId)
            .map((shipment) => publicShipment(shipment, stockState))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        }
        if (includesScope(scopes, "shift")) {
          payload.shiftRequests = (data.workforceShiftRequests || [])
            .filter((request) => request.personId === userId)
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          payload.shiftPlans = plans.sort((a, b) => String(a.date).localeCompare(String(b.date)));
          payload.shiftSettings = normalizeShiftSettings(data.workforceShiftSettings);
        }
        if (includesScope(scopes, "stock")) payload.stockState = stockState;
        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/api/workforce/events",
    requireAdminOrMainRequestOrigin,
    auth.requirePersonelOrPreview,
    async (req, res, next) => {
      try {
        const data = await resolveRequestData(req);
        const previewMode = req.recipe && req.recipe.role === "preview";
        if (!previewMode && !requireStaff(req, res)) return;
        const staff = previewMode ? activeUsers(data)[0] : currentStaff(req);
        openWorkforceEvents(req, res, workforceClients, data, String(staff && staff.id || "preview"));
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/api/admin/workforce/events",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const data = await resolveRequestData(req);
        openWorkforceEvents(req, res, adminWorkforceClients, data, "manager");
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/admin/workforce/tasks",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const title = String(body.title || "").trim().slice(0, 160);
        const description = String(body.description || "").trim().slice(0, 1000);
        const dueDate = String(body.dueDate || "").trim();
        const dueTime = String(body.dueTime || "").trim();
        const managerNote = String(body.managerNote || body.adminNote || "").trim().slice(0, 1000);
        const items = normalizeTaskItems(body.items);
        if (!title || !items.length) {
          return res.status(400).json({ ok: false, message: "Başlık ve en az bir görev maddesi zorunludur." });
        }
        if (dueDate && !DATE_PATTERN.test(dueDate)) {
          return res.status(400).json({ ok: false, message: "Teslim tarihi geçersiz." });
        }
        if (dueTime && !TIME_PATTERN.test(dueTime)) {
          return res.status(400).json({ ok: false, message: "Teslim saati geçersiz." });
        }

        let createdTask;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        const saved = await updateStore((data) => {
          const previous = findIdempotent(data, "task_create", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          const available = activeUsers(data);
          const availableIds = new Set(available.map((user) => user.id));
          const requestedIds = Array.isArray(body.assignedUserIds) ? body.assignedUserIds.map(String) : [];
          const assignedUserIds = body.targetType === "all"
            ? available.map((user) => user.id)
            : [...new Set(requestedIds.filter((userId) => availableIds.has(userId)))];
          if (!assignedUserIds.length) throw fail("En az bir aktif personel seçin.");

          const timestamp = isoNow();
          const usersById = new Map(available.map((user) => [user.id, user]));
          createdTask = {
            id: createId("task"),
            title,
            description,
            items,
            targetType: body.targetType === "all" ? "all" : "selected",
            priority: ["low", "normal", "high", "urgent"].includes(body.priority) ? body.priority : "normal",
            dueDate,
            dueTime,
            dueAt: dueDate ? `${dueDate}T${dueTime || "23:59"}:00.000+03:00` : "",
            managerNote,
            assignedUserIds,
            createdBy: "admin",
            createdAt: timestamp,
            updatedAt: timestamp,
            status: "active",
            revision: 1
          };
          const newAssignments = assignedUserIds.map((userId) => {
            const assignedUser = usersById.get(userId);
            return {
              id: createId("task-assignment"),
              taskId: createdTask.id,
              userId,
              userName: assignedUser && assignedUser.name || "",
              username: assignedUser && assignedUser.username || "",
              status: "pending",
              completedItemIds: [],
              progress: 0,
              assignedAt: timestamp,
              startedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
              completedAt: null,
              revision: 1
            };
          });
          data.workforceTasks = (data.workforceTasks || []).concat(createdTask);
          data.workforceAssignments = (data.workforceAssignments || []).concat(newAssignments);
          activity(data, "task_assigned", { id: "admin", name: "Yönetici" }, {
            assignmentTitle: title,
            workforceTaskId: createdTask.id,
            assignedUserIds
          });
          for (const userId of assignedUserIds) {
            queueNotification(data, pendingNotifications, personnelNotification(userId, {
              category: "task",
              eventType: "task_assigned",
              title: "Yeni görev atandı",
              body: `${title}${createdTask.dueAt ? ` · Teslim: ${createdTask.dueDate} ${createdTask.dueTime || "23.59"}` : ""}`,
              severity: createdTask.priority === "urgent" ? "critical" : createdTask.priority === "high" ? "warning" : "info",
              entityType: "task",
              entityId: createdTask.id,
              deepLink: `/personel/?section=tasks&taskId=${encodeURIComponent(createdTask.id)}`,
              dedupeKey: `task-assigned:${createdTask.id}:${userId}`,
              metadata: { taskTitle: title, priority: createdTask.priority, dueAt: createdTask.dueAt || null }
            }));
          }
          const revision = touchWorkforceRevision(data);
          const allUsersById = new Map((data.recipeUsers || []).map((user) => [user.id, user]));
          response = {
            ok: true,
            requestId,
            revision,
            task: publicTask(createdTask, data.workforceAssignments || [], allUsersById)
          };
          recordIdempotent(data, "task_create", requestId, createdTask.id, revision, { response });
          return data;
        });
        if (!response && createdTask) {
          const usersById = new Map((saved.recipeUsers || []).map((user) => [user.id, user]));
          response = { ok: true, revision: workforceRevision(saved), task: publicTask(createdTask, saved.workforceAssignments || [], usersById) };
        }
        publishNotifications(pendingNotifications);
        res.status(replayed ? 200 : 201).json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  app.patch(
    "/api/admin/workforce/tasks/:taskId",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
        const requestedStatus = String(body.status || "");
        const status = requestedStatus === "iptal_edildi" ? "cancelled" : requestedStatus;
        if (hasStatus && !["active", "completed", "archived", "cancelled"].includes(status)) {
          return res.status(400).json({ ok: false, message: "Görev durumu geçersiz." });
        }
        if (body.dueDate && !DATE_PATTERN.test(String(body.dueDate))) {
          return res.status(400).json({ ok: false, message: "Teslim tarihi geçersiz." });
        }
        if (body.dueTime && !TIME_PATTERN.test(String(body.dueTime))) {
          return res.status(400).json({ ok: false, message: "Teslim saati geçersiz." });
        }
        let task;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        const saved = await updateStore((data) => {
          const previous = findIdempotent(data, "task_update", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          task = (data.workforceTasks || []).find((item) => item.id === req.params.taskId);
          if (!task) throw fail("Görev bulunamadı.", 404);
          if (task.status === "archived" && (!hasStatus || status !== "archived")) throw fail("Arşivlenmiş görev değiştirilemez.", 409);
          const before = {
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            managerNote: task.managerNote,
            itemSignature: JSON.stringify(task.items || []),
            assignedUserIds: [...new Set((task.assignedUserIds || []).map(String))]
          };
          if (Object.prototype.hasOwnProperty.call(body, "title")) {
            const title = String(body.title || "").trim().slice(0, 160);
            if (!title) throw fail("Görev başlığı zorunludur.");
            task.title = title;
          }
          if (Object.prototype.hasOwnProperty.call(body, "description")) task.description = String(body.description || "").trim().slice(0, 1000);
          if (Object.prototype.hasOwnProperty.call(body, "managerNote") || Object.prototype.hasOwnProperty.call(body, "adminNote")) {
            task.managerNote = String(body.managerNote || body.adminNote || "").trim().slice(0, 1000);
          }
          if (Object.prototype.hasOwnProperty.call(body, "priority")) {
            if (!["low", "normal", "high", "urgent"].includes(body.priority)) throw fail("Görev önceliği geçersiz.");
            task.priority = body.priority;
          }
          if (Object.prototype.hasOwnProperty.call(body, "dueDate") || Object.prototype.hasOwnProperty.call(body, "dueTime")) {
            task.dueDate = Object.prototype.hasOwnProperty.call(body, "dueDate") ? String(body.dueDate || "") : String(task.dueDate || "");
            task.dueTime = Object.prototype.hasOwnProperty.call(body, "dueTime") ? String(body.dueTime || "") : String(task.dueTime || "");
            task.dueAt = task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00.000+03:00` : "";
          }
          if (Object.prototype.hasOwnProperty.call(body, "items")) {
            const items = normalizeTaskItems(body.items);
            if (!items.length) throw fail("En az bir görev maddesi zorunludur.");
            task.items = items;
          }
          if (hasStatus) task.status = status;
          task.updatedAt = isoNow();
          task.revision = Math.max(0, Number(task.revision || 0)) + 1;
          if (hasStatus && status === "completed") task.completedAt = task.updatedAt;
          if (hasStatus && status === "archived") task.archivedAt = task.updatedAt;

          const available = activeUsers(data);
          const usersById = new Map(available.map((user) => [String(user.id), user]));
          let nextAssignedIds = before.assignedUserIds;
          if (Array.isArray(body.assignedUserIds)) {
            nextAssignedIds = [...new Set(body.assignedUserIds.map(String).filter((id) => usersById.has(id)))];
            if (!nextAssignedIds.length) throw fail("En az bir aktif personel seçin.");
          }
          const removedUserIds = before.assignedUserIds.filter((id) => !nextAssignedIds.includes(id));
          const addedUserIds = nextAssignedIds.filter((id) => !before.assignedUserIds.includes(id));
          task.assignedUserIds = nextAssignedIds;
          for (const assignment of data.workforceAssignments || []) {
            if (assignment.taskId !== task.id) continue;
            if (removedUserIds.includes(String(assignment.userId))) {
              assignment.status = "cancelled";
              assignment.cancelledAt = task.updatedAt;
            }
            if (Object.prototype.hasOwnProperty.call(body, "items") && assignment.status !== "cancelled") {
              const validItemIds = new Set((task.items || []).map((item) => item.id));
              assignment.completedItemIds = (assignment.completedItemIds || []).filter((id) => validItemIds.has(id));
              assignment.progress = assignmentPercent(assignment, task);
              assignment.status = assignment.progress === 100 ? "completed" : assignment.progress > 0 ? "in_progress" : "pending";
            }
            assignment.updatedAt = task.updatedAt;
            assignment.revision = Math.max(0, Number(assignment.revision || 0)) + 1;
          }
          for (const userId of addedUserIds) {
            const user = usersById.get(userId);
            data.workforceAssignments = (data.workforceAssignments || []).concat({
              id: createId("task-assignment"), taskId: task.id, userId,
              userName: user && user.name || "", username: user && user.username || "",
              status: "pending", completedItemIds: [], progress: 0,
              assignedAt: task.updatedAt, startedAt: null, createdAt: task.updatedAt,
              updatedAt: task.updatedAt, completedAt: null, revision: 1
            });
          }
          if (hasStatus && status === "cancelled") {
            task.cancelledAt = task.updatedAt;
            task.cancelledBy = "admin";
            for (const assignment of data.workforceAssignments || []) {
              if (assignment.taskId !== task.id) continue;
              assignment.status = "cancelled";
              assignment.cancelledAt = task.updatedAt;
              assignment.updatedAt = task.updatedAt;
              assignment.revision = Math.max(0, Number(assignment.revision || 0)) + 1;
            }
          }
          activity(data, hasStatus ? "task_status_changed" : "task_updated", { id: "admin", name: "Yönetici" }, {
            assignmentTitle: task.title,
            workforceTaskId: task.id,
            status: task.status
          });
          const contentChanged = before.title !== task.title || before.description !== task.description || before.priority !== task.priority
            || before.dueDate !== task.dueDate || before.dueTime !== task.dueTime || before.managerNote !== task.managerNote
            || before.itemSignature !== JSON.stringify(task.items || []);
          const removedRecipients = hasStatus && status === "cancelled" ? nextAssignedIds : removedUserIds;
          for (const userId of removedRecipients) {
            queueNotification(data, pendingNotifications, personnelNotification(userId, {
                category: "task",
                eventType: "task_removed",
                title: "Görev kaldırıldı",
                body: `${task.title} görevi Yönetici tarafından kaldırıldı.`,
                severity: "warning",
                entityType: "task",
                entityId: task.id,
                deepLink: "/personel/?section=tasks",
                dedupeKey: `task-removed:${task.id}:${task.revision}:${userId}`,
                metadata: { taskTitle: task.title }
            }));
          }
          for (const userId of addedUserIds) {
            queueNotification(data, pendingNotifications, personnelNotification(userId, {
              category: "task", eventType: "task_assigned", title: "Yeni görev atandı",
              body: `${task.title}${task.dueAt ? ` · Teslim: ${task.dueDate} ${task.dueTime || "23.59"}` : ""}`,
              severity: task.priority === "urgent" ? "critical" : task.priority === "high" ? "warning" : "info",
              entityType: "task", entityId: task.id,
              deepLink: `/personel/?section=tasks&taskId=${encodeURIComponent(task.id)}`,
              dedupeKey: `task-assigned:${task.id}:${userId}`,
              metadata: { taskTitle: task.title, priority: task.priority, dueAt: task.dueAt || null }
            }));
          }
          if (contentChanged) {
            for (const userId of nextAssignedIds.filter((id) => !addedUserIds.includes(id) && !removedRecipients.includes(id))) {
              queueNotification(data, pendingNotifications, personnelNotification(userId, {
                category: "task", eventType: "task_updated", title: "Görev güncellendi",
                body: `${task.title} görevinin ayrıntıları güncellendi.`, severity: "warning",
                entityType: "task", entityId: task.id,
                deepLink: `/personel/?section=tasks&taskId=${encodeURIComponent(task.id)}`,
                dedupeKey: `task-updated:${task.id}:${task.revision}:${userId}`,
                metadata: { taskTitle: task.title, priority: task.priority, dueAt: task.dueAt || null }
              }));
            }
          }
          const revision = touchWorkforceRevision(data);
          const allUsersById = new Map((data.recipeUsers || []).map((user) => [user.id, user]));
          response = { ok: true, requestId, revision, task: publicTask(task, data.workforceAssignments || [], allUsersById) };
          recordIdempotent(data, "task_update", requestId, task.id, revision, { response });
          return data;
        });
        if (!response && task) {
          const usersById = new Map((saved.recipeUsers || []).map((user) => [user.id, user]));
          response = { ok: true, revision: workforceRevision(saved), task: publicTask(task, saved.workforceAssignments || [], usersById) };
        }
        publishNotifications(pendingNotifications);
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.patch(
    "/api/workforce/tasks/:taskId/items/:itemId",
    requireAdminOrMainRequestOrigin,
    auth.requireActivePersonel,
    async (req, res, next) => {
      try {
        if (!requireStaff(req, res)) return;
        const body = req.body || {};
        const requestId = operationRequestId(req);
        let updatedAssignment;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        await updateStore((data) => {
          const previous = findIdempotent(data, "task_item_update", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          const task = (data.workforceTasks || []).find((item) => item.id === req.params.taskId);
          const assignment = (data.workforceAssignments || []).find((item) =>
            item.taskId === req.params.taskId && item.userId === req.recipe.userId
          );
          if (!task || !assignment) throw fail("Görev bulunamadı.", 404);
          if (["archived", "cancelled"].includes(task.status)) throw fail("İptal edilmiş veya arşivlenmiş görev değiştirilemez.", 409);
          const item = (task.items || []).find((candidate) => candidate.id === req.params.itemId);
          if (!item) throw fail("Görev maddesi bulunamadı.", 404);

          const previousAssignmentStatus = assignment.status;
          const completedItemIds = new Set(assignment.completedItemIds || []);
          if (body.completed === true) completedItemIds.add(item.id);
          else completedItemIds.delete(item.id);
          assignment.completedItemIds = [...completedItemIds];
          const percentage = assignmentPercent(assignment, task);
          assignment.status = percentage === 100 ? "completed" : percentage > 0 ? "in_progress" : "pending";
          assignment.progress = percentage;
          if (percentage > 0 && !assignment.startedAt) assignment.startedAt = isoNow();
          assignment.completedAt = assignment.status === "completed" ? isoNow() : null;
          assignment.updatedAt = isoNow();
          assignment.revision = Math.max(0, Number(assignment.revision || 0)) + 1;
          const taskAssignments = (data.workforceAssignments || []).filter((candidate) => candidate.taskId === task.id);
          const allCompleted = taskAssignments.length > 0 && taskAssignments.every((candidate) =>
            assignmentPercent(candidate, task) === 100
          );
          if (task.status !== "archived") {
            task.status = allCompleted ? "completed" : "active";
            task.completedAt = allCompleted ? assignment.updatedAt : null;
            task.updatedAt = assignment.updatedAt;
            task.revision = Math.max(0, Number(task.revision || 0)) + 1;
          }
          updatedAssignment = { ...assignment, percent: percentage };
          activity(data, assignment.status === "completed" ? "task_completed" : "task_progress", currentStaff(req), {
            assignmentTitle: task.title,
            workforceTaskId: task.id,
            workforceAssignmentId: assignment.id,
            completedItemId: item.id,
            completed: completedItemIds.has(item.id),
            percent: percentage
          });
          if (previousAssignmentStatus !== assignment.status && ["in_progress", "completed"].includes(assignment.status)) {
            const completed = assignment.status === "completed";
            queueNotification(data, pendingNotifications, managerNotification({
              category: "task",
              eventType: completed ? "task_completed" : "task_started",
              title: completed ? "Görev tamamlandı" : "Göreve başlandı",
              body: `${currentStaff(req).name || currentStaff(req).username || "Personel"}, ${task.title} görevini ${completed ? "tamamladı" : "başlattı"}.`,
              severity: completed ? "success" : "info",
              entityType: "task",
              entityId: task.id,
              deepLink: `/yonetici/?section=staffAccess&workforce=tasks&entityId=${encodeURIComponent(task.id)}`,
              dedupeKey: `task-${completed ? "completed" : "started"}:${task.id}:${assignment.id}`,
              metadata: { taskTitle: task.title, personId: assignment.userId, personName: assignment.userName || currentStaff(req).name || "" }
            }));
          }
          const revision = touchWorkforceRevision(data);
          response = { ok: true, requestId, revision, assignment: updatedAssignment };
          recordIdempotent(data, "task_item_update", requestId, assignment.id, revision, { response });
          return data;
        });
        publishNotifications(pendingNotifications);
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/workforce/shipments",
    requireAdminOrMainRequestOrigin,
    auth.requireActivePersonel,
    async (req, res, next) => {
      try {
        if (!requireStaff(req, res)) return;
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const requestedItems = Array.isArray(body.items) ? body.items : [];
        if (!requestedItems.length) {
          return res.status(400).json({ ok: false, message: "Sevkiyat sepeti boş." });
        }

        let shipment;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        await updateStore((data, context) => {
          const previous = findIdempotent(data, "shipment_create", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return context.noChange;
          }
          assertExpectedRevision(data, body);
          const stockState = normalizeStockState(data.stockState);
          const reporter = currentStaff(req);
          const assignedLocationId = stockService.actorLocationId(stockState, {
            type: "personel",
            id: reporter && reporter.id || req.recipe && req.recipe.userId || "",
            stockLocationId: reporter && reporter.stockLocationId || ""
          });
          const requestedDestinationId = String(body.destinationLocationId || body.destinationLocationCode || "").trim();
          const destinationLocation = stockService.getLocation(stockState, requestedDestinationId || assignedLocationId);
          if (destinationLocation.type !== "cafe" || destinationLocation.id !== assignedLocationId) {
            throw fail("Sevkiyat yalnızca atanmış aktif Kafe Deposuna bildirilebilir.", 403);
          }
          const products = new Map(stockState.products.map((product) => [product.id, product]));
          const productsByCode = new Map(stockState.products
            .map((product) => [normalizeProductCode(product.productCode), product])
            .filter(([code]) => code));
          const seenProducts = new Set();
          const lines = requestedItems.map((requested) => {
            const productId = String(requested.productId || "");
            const requestedCode = normalizeProductCode(requested.stockProductCode || requested.productCode);
            const product = productsByCode.get(requestedCode) || products.get(productId);
            const quantity = Number(requested.quantity);
            const unit = normalizeUnit(requested.unit || product && product.unit);
            if (!product || product.active === false || product.sourcePresent === false || product.archivedAt) {
              throw fail("Seçilen stok ürünü aktif katalogda bulunamadı.");
            }
            const identity = normalizeProductCode(product.productCode) || product.id;
            if (requestedCode && normalizeProductCode(product.productCode) !== requestedCode) {
              throw fail("Seçilen stok ürün kodu güncel katalogla eşleşmiyor.", 409);
            }
            if (seenProducts.has(identity)) throw fail("Aynı ürün sevkiyata birden fazla kez eklenemez.");
            if (!Number.isFinite(quantity) || quantity <= 0) throw fail("Sevkiyat miktarı sıfırdan büyük olmalıdır.");
            if (!SHIPMENT_UNITS.has(unit) && unit !== normalizeUnit(product.unit)) {
              throw fail("Sevkiyat birimi geçersiz.");
            }
            seenProducts.add(identity);
            const conversion = convertToBaseUnit(quantity, unit, product);
            const destinationBalance = stockService.getProductBalance(stockState, destinationLocation.id, product.id);
            const currentStock = roundNumber(Number(destinationBalance.quantity || 0));
            return {
              id: createId("shipment-item"),
              productId: product.id,
              stockProductId: product.id,
              productCode: normalizeProductCode(product.productCode),
              stockProductCode: normalizeProductCode(product.productCode),
              name: product.name,
              categoryId: product.categoryId,
              category: product.category,
              quantity: roundNumber(quantity),
              unit,
              baseQuantity: conversion.quantity,
              baseUnit: product.unit,
              conversionFactor: conversion.factor,
              packageInfo: conversion.packageInfo || null,
              currentStockSnapshot: currentStock,
              stockAfterApprovalSnapshot: roundNumber(currentStock + conversion.quantity),
              destinationLocationId: destinationLocation.id,
              destinationLocationName: destinationLocation.name
            };
          });
          const timestamp = isoNow();
          shipment = {
            id: createId("shipment"),
            userId: req.recipe.userId,
            userName: reporter.name || reporter.username,
            branchId: String(reporter.branchId || "main"),
            destinationLocationId: destinationLocation.id,
            destinationLocationName: destinationLocation.name,
            items: lines,
            note: String(body.note || "").trim().slice(0, 250),
            status: "onay_bekliyor",
            createdAt: timestamp,
            updatedAt: timestamp,
            stockAppliedAt: null,
            stockMovementRef: null,
            approvedBy: null,
            approvedAt: null,
            requestId,
            revision: 1
          };
          data.workforceShipments = (data.workforceShipments || []).concat(shipment);
          activity(data, "shipment_reported", currentStaff(req), {
            assignmentTitle: `${lines.length} ürün`,
            workforceShipmentId: shipment.id
          });
          queueNotification(data, pendingNotifications, managerNotification({
            category: "shipment",
            eventType: "shipment_reported",
            title: "Yeni sevkiyat onayı bekliyor",
            body: `${shipment.userName || "Personel"} tarafından ${lines.length} ürünlük sevkiyat bildirildi.`,
            severity: "warning",
            entityType: "shipment",
            entityId: shipment.id,
            deepLink: `/fatura/?view=stock&workforce=shipments&entityId=${encodeURIComponent(shipment.id)}`,
            dedupeKey: `shipment-reported:${shipment.id}:manager`,
            metadata: { personId: shipment.userId, personName: shipment.userName, itemCount: lines.length }
          }));
          queueFaturaShipmentNotifications(data, pendingNotifications, shipment);
          const procurementRevision = recordProcurementShipmentReportedAudit(data, reporter, shipment, requestId, timestamp);
          const revision = touchWorkforceRevision(data);
          response = {
            ok: true,
            requestId,
            revision,
            procurementRevision,
            shipmentRevision: Number(data.revisions && data.revisions.shipment || 0),
            shipment: publicShipment(shipment, stockState)
          };
          recordIdempotent(data, "shipment_create", requestId, shipment.id, revision, { response });
          return data;
        });
        publishNotifications(pendingNotifications);
        if (!replayed && typeof notifyProcurementChange === "function") {
          notifyProcurementChange({
            type: "shipment.reported",
            entityType: "shipment",
            entityId: shipment.id,
            revision: response && response.procurementRevision || 0,
            shipmentRevision: response && response.shipmentRevision || 0,
            createdAt: shipment.createdAt
          });
        }
        res.status(replayed ? 200 : 201).json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  async function handleShipmentDecision(req, res, next) {
      try {
        const decision = String(req.params.decision || "");
        if (!["approve", "reject"].includes(decision)) {
          return res.status(400).json({ ok: false, message: "Sevkiyat kararı geçersiz." });
        }
        let shipment;
        let updatedStockState = null;
        let idempotent = false;
        let updatedAt = null;
        const body = req.body || {};
        const decisionActor = req.procurementActor && req.procurementActor.id
          ? req.procurementActor
          : { id: "admin", name: "Yönetici", role: "admin" };
        const requestId = operationRequestId(req);
        const rejectionReason = String(body.rejectionReason || body.reason || body.note || "").trim().slice(0, 250);
        if (decision === "reject" && !rejectionReason) {
          return res.status(400).json({ ok: false, message: "Reddetme nedeni zorunludur." });
        }
        let response;
        const pendingNotifications = [];

        const saved = await updateStore((data, context) => {
          const previous = findIdempotent(data, `shipment_${decision}`, requestId);
          if (previous) {
            idempotent = true;
            response = replayResponse(previous);
            return context.noChange;
          }
          assertExpectedRevision(data, body);
          shipment = (data.workforceShipments || []).find((item) => item.id === req.params.id);
          if (!shipment) throw fail("Sevkiyat bulunamadı.", 404);
          if (decisionActor.type !== "admin"
            && String(shipment.branchId || "main") !== String(decisionActor.branchId || "main")) {
            throw fail("Sevkiyat bulunamadı.", 404);
          }

          if (decision === "approve" && shipment.status === "onaylandı" && shipment.stockAppliedAt && shipment.stockMovementRef) {
            idempotent = true;
            updatedStockState = normalizeStockState(data.stockState);
            updatedAt = data.stockUpdatedAt || shipment.stockAppliedAt;
            response = {
              ok: true,
              idempotent: true,
              requestId,
              revision: workforceRevision(data),
              shipment: publicShipment(shipment, updatedStockState),
              stockState: updatedStockState,
              publishRevision: data.revisions && data.revisions.publish || 0,
              updatedAt
            };
            return context.noChange;
          }
          if (shipment.status !== "onay_bekliyor") {
            throw fail("Bu sevkiyat daha önce işleme alınmış.", 409);
          }

          const timestamp = isoNow();
          shipment.adminNote = String(body.note || "").trim().slice(0, 250);
          shipment.updatedAt = timestamp;
          shipment.revision = Math.max(0, Number(shipment.revision || 0)) + 1;
          if (decision === "reject") {
            shipment.status = "reddedildi";
            shipment.rejectedBy = String(decisionActor.id);
            shipment.rejectedAt = timestamp;
            shipment.rejectionReason = rejectionReason;
            if (!shipment.adminNote) shipment.adminNote = rejectionReason;
            activity(data, "shipment_rejected", decisionActor, {
              assignmentTitle: shipment.id,
              workforceShipmentId: shipment.id
            });
            queueNotification(data, pendingNotifications, personnelNotification(shipment.userId, {
              category: "shipment",
              eventType: "shipment_rejected",
              title: "Sevkiyat bildirimin reddedildi",
              body: rejectionReason ? `Yönetici açıklaması: ${rejectionReason}` : "Sevkiyat bildirimin Yönetici tarafından reddedildi.",
              severity: "warning",
              entityType: "shipment",
              entityId: shipment.id,
              deepLink: `/personel/?section=shipment&shipmentId=${encodeURIComponent(shipment.id)}`,
              dedupeKey: `shipment-rejected:${shipment.id}:${shipment.userId}`,
              metadata: { rejectionReason }
            }));
            const procurementRevision = recordProcurementShipmentAudit(
              data,
              req,
              shipment,
              requestId,
              "",
              timestamp,
              "shipment.reject"
            );
            const revision = touchWorkforceRevision(data);
            response = {
              ok: true,
              requestId,
              revision,
              procurementRevision,
              shipmentRevision: Number(data.revisions && data.revisions.shipment || 0),
              shipment: publicShipment(shipment, normalizeStockState(data.stockState)),
              stockState: null
            };
            recordIdempotent(data, "shipment_reject", requestId, shipment.id, revision, { response });
            return data;
          }

          if (shipment.stockAppliedAt || shipment.stockMovementRef) {
            throw fail("Bu sevkiyatın stok etkisi daha önce uygulanmış.", 409);
          }
          const previousStockState = normalizeStockState(data.stockState);
          let stockState = previousStockState;
          // A destination is deliberately required at the last authoritative
          // point. Older pending shipments have no target; their approval UI
          // must choose one instead of silently adding it to the old pool.
          const destinationId = String(body.destinationLocationId || shipment.destinationLocationId || "").trim();
          if (!destinationId) throw fail("Sevkiyat onayı için hedef depo seçimi zorunludur.", 400);
          const destination = stockService.getLocation(stockState, destinationId);
          shipment.destinationLocationId = destination.id;
          shipment.destinationLocationName = destination.name;
          const stockMovementRef = createId("shipment-stock-transaction");
          const stockMovementRefs = [];
          const movementActor = {
            type: "admin",
            id: String(decisionActor.id || "admin"),
            name: String(decisionActor.name || decisionActor.username || "Yönetici")
          };
          for (let index = 0; index < (shipment.items || []).length; index += 1) {
            const line = shipment.items[index];
            const lineRequestId = requestId ? `${requestId}:shipment:${index}` : "";
            const applied = stockService.applyStockMovement(stockState, {
              type: "inbound_shipment",
              productId: line.stockProductId || line.productId,
              productCode: line.stockProductCode || line.productCode,
              quantity: line.quantity,
              unit: line.unit || line.baseUnit,
              locationId: destination.id,
              referenceType: "shipment",
              referenceId: shipment.id,
              shipmentId: shipment.id,
              requestId: lineRequestId,
              transactionRef: stockMovementRef,
              approvedBy: movementActor.id,
              personnelId: shipment.userId,
              note: shipment.adminNote || `Sevkiyat: ${shipment.id}`,
              reason: "Onaylı sevkiyat"
            }, movementActor, { now: timestamp, requestId: lineRequestId });
            stockState = applied.stockState;
            if (applied.movement) stockMovementRefs.push(applied.movement.id);
          }
          shipment.status = "onaylandı";
          shipment.approvedBy = String(decisionActor.id);
          shipment.approvedAt = timestamp;
          shipment.stockAppliedAt = timestamp;
          shipment.stockMovementRef = stockMovementRef;
          shipment.stockMovementRefs = stockMovementRefs;
          data.stockState = stockState;
          if (typeof queueStockThresholdNotifications === "function") {
            queueStockThresholdNotifications(data, pendingNotifications, previousStockState, stockState, {
              operationId: stockMovementRef,
              updatedAt: timestamp
            });
          }
          data.stockUpdatedAt = timestamp;
          data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
          data.revisions.inventory = Math.max(0, Number(data.revisions.inventory || 0)) + 1;
          data.revisions.stock = Math.max(Number(data.revisions.stock || 0) + 1, data.revisions.inventory);
          updatedAt = timestamp;
          updatedStockState = stockState;
          activity(data, "shipment_approved", decisionActor, {
            assignmentTitle: shipment.id,
            workforceShipmentId: shipment.id,
            stockMovementRef
          });
          const procurementRevision = recordProcurementShipmentAudit(data, req, shipment, requestId, stockMovementRef, timestamp);
          queueNotification(data, pendingNotifications, personnelNotification(shipment.userId, {
            category: "shipment",
            eventType: "shipment_approved",
            title: "Sevkiyat bildirimin onaylandı",
            body: `${(shipment.items || []).length} ürünlük sevkiyatın onaylandı ve stok güncellendi.`,
            severity: "success",
            entityType: "shipment",
            entityId: shipment.id,
            deepLink: `/personel/?section=shipment&shipmentId=${encodeURIComponent(shipment.id)}`,
            dedupeKey: `shipment-approved:${shipment.id}:${shipment.userId}`,
            metadata: { itemCount: (shipment.items || []).length, stockMovementRef }
          }));
          const revision = touchWorkforceRevision(data);
          response = {
            ok: true,
            idempotent: false,
            requestId,
            revision,
            shipment: publicShipment(shipment, stockState),
            stockState,
            publishRevision: data.revisions && data.revisions.publish || 0,
            procurementRevision,
            shipmentRevision: Number(data.revisions && data.revisions.shipment || 0),
            updatedAt
          };
          recordIdempotent(data, "shipment_approve", requestId, shipment.id, revision, { response });
          return data;
        });

        updatedStockState = updatedStockState || (decision === "approve" ? normalizeStockState(saved.stockState) : null);
        if (decision === "approve" && typeof broadcastStockUpdate === "function") {
          broadcastStockUpdate(
            updatedStockState,
            updatedAt || saved.stockUpdatedAt || shipment.stockAppliedAt,
            Number(saved.revisions && saved.revisions.inventory || 0),
            "inventory"
          );
        }
        publishNotifications(pendingNotifications);
        if (!idempotent && typeof notifyProcurementChange === "function") {
          notifyProcurementChange({
            type: decision === "approve" ? "shipment.stock-approved" : "shipment.rejected",
            entityType: "shipment",
            entityId: shipment.id,
            revision: response && response.procurementRevision || response && response.revision || 0,
            shipmentRevision: response && response.shipmentRevision || 0,
            createdAt: shipment.updatedAt
          });
        }
        if (!response) {
          response = {
            ok: true,
            idempotent,
            requestId,
            revision: workforceRevision(saved),
            shipment: publicShipment(shipment, normalizeStockState(saved.stockState)),
            stockState: updatedStockState,
            publishRevision: saved.revisions && saved.revisions.publish || 0,
            updatedAt: updatedAt || saved.stockUpdatedAt || null
          };
        }
        res.json({ ...response, idempotent: idempotent || response.idempotent === true });
      } catch (error) {
        next(error);
      }
  }

  app.post(
    "/api/admin/workforce/shipments/:id/:decision",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    handleShipmentDecision
  );

  app.post(
    "/api/workforce/shift-requests",
    requireAdminOrMainRequestOrigin,
    auth.requireActivePersonel,
    async (req, res, next) => {
      try {
        if (!requireStaff(req, res)) return;
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const type = String(body.type || "");
        const date = String(body.date || "");
        if (!REQUEST_TYPES.has(type)) {
          return res.status(400).json({ ok: false, message: "Talep türü geçersiz." });
        }
        if (!DATE_PATTERN.test(date)) {
          return res.status(400).json({ ok: false, message: "Geçerli bir tarih seçin." });
        }
        if (date < turkeyDateKey()) {
          return res.status(400).json({ ok: false, message: "Geçmiş tarih için vardiya veya izin talebi oluşturulamaz." });
        }
        const times = requestTimes(type, body);
        if (times.error) return res.status(400).json({ ok: false, message: times.error });

        let request;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        await updateStore((data) => {
          const previous = findIdempotent(data, "shift_request_create", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          const duplicate = (data.workforceShiftRequests || []).some((item) =>
            item.personId === req.recipe.userId &&
            item.date === date &&
            item.type === type &&
            item.status === "onay_bekliyor"
          );
          if (duplicate) throw fail("Bu tarih ve tür için bekleyen bir talebiniz zaten var.", 409);
          const timestamp = isoNow();
          request = {
            id: createId("shift-request"),
            personId: req.recipe.userId,
            personName: currentStaff(req).name || currentStaff(req).username,
            date,
            type,
            startTime: times.startTime,
            endTime: times.endTime,
            description: String(body.description || "").trim().slice(0, 250),
            status: "onay_bekliyor",
            createdAt: timestamp,
            updatedAt: timestamp,
            decidedAt: null,
            adminNote: "",
            requestId,
            revision: 1
          };
          data.workforceShiftRequests = (data.workforceShiftRequests || []).concat(request);
          activity(data, "shift_requested", currentStaff(req), {
            assignmentTitle: type,
            workforceShiftRequestId: request.id,
            date
          });
          queueNotification(data, pendingNotifications, managerNotification({
            category: "shift",
            eventType: "shift_request_created",
            title: "Yeni vardiya talebi",
            body: `${request.personName || "Personel"}, ${request.date} tarihi için vardiya/izin talebi gönderdi.`,
            severity: "info",
            entityType: "shift_request",
            entityId: request.id,
            deepLink: `/yonetici/?section=staffAccess&workforce=shifts&entityId=${encodeURIComponent(request.id)}`,
            dedupeKey: `shift-request-created:${request.id}:manager`,
            metadata: { personId: request.personId, personName: request.personName, date: request.date, requestType: request.type }
          }));
          const revision = touchWorkforceRevision(data);
          response = { ok: true, requestId, revision, request };
          recordIdempotent(data, "shift_request_create", requestId, request.id, revision, { response });
          return data;
        });
        publishNotifications(pendingNotifications);
        res.status(replayed ? 200 : 201).json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.delete(
    "/api/workforce/shift-requests/:id",
    requireAdminOrMainRequestOrigin,
    auth.requireActivePersonel,
    async (req, res, next) => {
      try {
        if (!requireStaff(req, res)) return;
        const body = req.body || {};
        const requestId = operationRequestId(req);
        let request;
        let response;
        let replayed = false;
        await updateStore((data) => {
          const previous = findIdempotent(data, "shift_request_cancel", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          request = (data.workforceShiftRequests || []).find((item) =>
            item.id === req.params.id && item.personId === req.recipe.userId
          );
          if (!request) throw fail("Talep bulunamadı.", 404);
          if (request.status !== "onay_bekliyor") throw fail("Karar verilmiş talep iptal edilemez.", 409);
          request.status = "iptal_edildi";
          request.cancelledAt = isoNow();
          request.updatedAt = request.cancelledAt;
          request.revision = Math.max(0, Number(request.revision || 0)) + 1;
          activity(data, "shift_request_cancelled", currentStaff(req), {
            assignmentTitle: request.type,
            workforceShiftRequestId: request.id,
            date: request.date
          });
          const revision = touchWorkforceRevision(data);
          response = { ok: true, requestId, revision, request };
          recordIdempotent(data, "shift_request_cancel", requestId, request.id, revision, { response });
          return data;
        });
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/admin/workforce/shift-requests/:id/:decision",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const decision = String(req.params.decision || "");
        if (!["approve", "reject"].includes(decision)) {
          return res.status(400).json({ ok: false, message: "Talep kararı geçersiz." });
        }
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const adminNote = String(body.note || body.adminNote || body.rejectionReason || "").trim().slice(0, 250);
        if (decision === "reject" && !adminNote) {
          return res.status(400).json({ ok: false, message: "Reddetme nedeni zorunludur." });
        }
        let request;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        await updateStore((data) => {
          const previous = findIdempotent(data, `shift_request_${decision}`, requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          request = (data.workforceShiftRequests || []).find((item) => item.id === req.params.id);
          if (!request) throw fail("Talep bulunamadı.", 404);
          if (request.status !== "onay_bekliyor") throw fail("Talep daha önce işleme alınmış.", 409);
          const timestamp = isoNow();
          request.status = decision === "approve" ? "onaylandı" : "reddedildi";
          request.adminNote = adminNote;
          request.rejectionReason = decision === "reject" ? adminNote : "";
          request.decidedBy = "admin";
          request.decidedAt = timestamp;
          request.updatedAt = timestamp;
          request.revision = Math.max(0, Number(request.revision || 0)) + 1;
          activity(data, decision === "approve" ? "shift_request_approved" : "shift_request_rejected", {
            id: "admin",
            name: "Yönetici"
          }, {
            assignmentTitle: request.type,
            workforceShiftRequestId: request.id,
            personId: request.personId,
            date: request.date
          });
          queueNotification(data, pendingNotifications, personnelNotification(request.personId, {
            category: "shift",
            eventType: decision === "approve" ? "shift_request_approved" : "shift_request_rejected",
            title: decision === "approve" ? "Vardiya talebin onaylandı" : "Vardiya talebin reddedildi",
            body: `${request.date} tarihli talebin ${decision === "approve" ? "onaylandı" : "reddedildi"}.${adminNote ? ` Yönetici notu: ${adminNote}` : ""}`,
            severity: decision === "approve" ? "success" : "warning",
            entityType: "shift_request",
            entityId: request.id,
            deepLink: `/personel/?section=shift&requestId=${encodeURIComponent(request.id)}`,
            dedupeKey: `shift-request-${decision === "approve" ? "approved" : "rejected"}:${request.id}:${request.personId}`,
            metadata: { date: request.date, requestType: request.type, adminNote }
          }));
          const revision = touchWorkforceRevision(data);
          response = { ok: true, requestId, revision, request };
          recordIdempotent(data, `shift_request_${decision}`, requestId, request.id, revision, { response });
          return data;
        });
        publishNotifications(pendingNotifications);
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.put(
    "/api/admin/workforce/shift-settings",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const settings = validateShiftSettings(body);
        if (settings.error) return res.status(400).json({ ok: false, message: settings.error });
        let savedSettings;
        let response;
        let replayed = false;
        await updateStore((data) => {
          const previous = findIdempotent(data, "shift_settings_update", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          savedSettings = { ...settings.value, updatedAt: isoNow(), updatedBy: "admin" };
          data.workforceShiftSettings = savedSettings;
          activity(data, "shift_settings_updated", { id: "admin", name: "Yönetici" });
          const revision = touchWorkforceRevision(data);
          response = { ok: true, requestId, revision, shiftSettings: savedSettings };
          recordIdempotent(data, "shift_settings_update", requestId, "shift-settings", revision, { response });
          return data;
        });
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.put(
    "/api/admin/workforce/shifts/:weekStart",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const weekStart = String(req.params.weekStart || "");
        if (!isMonday(weekStart)) {
          return res.status(400).json({ ok: false, message: "Hafta başlangıcı Pazartesi olmalıdır." });
        }
        const body = req.body || {};
        const requestId = operationRequestId(req);
        const publish = body.publish === true;
        let savedPlans;
        let revision;
        let response;
        let replayed = false;
        const pendingNotifications = [];
        await updateStore((data) => {
          const operation = publish ? "shifts_publish" : "shifts_draft_save";
          const previous = findIdempotent(data, operation, requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          const availableUsers = activeUsers(data);
          const usersById = new Map(availableUsers.map((user) => [user.id, user]));
          const validUsers = new Set(usersById.keys());
          const settings = normalizeShiftSettings(data.workforceShiftSettings);
          const requestPlans = Array.isArray(body.plans) ? body.plans : [];
          const sourcePlans = requestPlans.length
            ? requestPlans
            : publish
              ? (data.workforceShiftPlans || []).filter((plan) => plan.weekStart === weekStart && plan.status === "draft")
              : [];
          if (!sourcePlans.length) throw fail("Kaydedilecek vardiya planı bulunamadı.");
          savedPlans = normalizePlans(sourcePlans, weekStart, validUsers, settings, publish, createId, isoNow)
            .filter((plan) => plan.type !== "unassigned");
          savedPlans.forEach((plan) => {
            const user = usersById.get(plan.personId);
            plan.personName = user && user.name || plan.personName || "";
          });

          const previousPublished = (data.workforceShiftPlans || []).filter((plan) =>
            plan.weekStart === weekStart && plan.status === "published"
          );
          const currentPublicationRevision = Math.max(
            previousPublished.length ? 1 : 0,
            ...previousPublished.map((plan) => Number(plan.publicationRevision || plan.revision || 0)),
            ...(data.workforceShiftPlanRevisions || [])
              .filter((item) => item.weekStart === weekStart)
              .map((item) => Number(item.revision || 0))
          );
          if (publish && previousPublished.length) {
            revision = {
              id: createId("shift-revision"),
              weekStart,
              revision: Math.max(1, currentPublicationRevision),
              plans: previousPublished,
              archivedAt: isoNow(),
              archivedBy: "admin"
            };
            data.workforceShiftPlanRevisions = (data.workforceShiftPlanRevisions || []).concat(revision);
          }
          if (publish) {
            const publicationRevision = currentPublicationRevision + 1 || 1;
            savedPlans.forEach((plan) => {
              plan.publicationRevision = publicationRevision;
              plan.revision = publicationRevision;
              plan.updatedPublication = Boolean(revision);
            });
            const affectedPersonIds = [...new Set(savedPlans.map((plan) => plan.personId))].filter((personId) => {
              if (!previousPublished.length) return true;
              const signature = (plans) => JSON.stringify(plans
                .filter((plan) => plan.personId === personId)
                .map((plan) => [plan.date, plan.type, plan.startTime || "", plan.endTime || ""])
                .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
              return signature(savedPlans) !== signature(previousPublished);
            });
            for (const personId of affectedPersonIds) {
              const updatedPublication = previousPublished.some((plan) => plan.personId === personId);
              queueNotification(data, pendingNotifications, personnelNotification(personId, {
                category: "shift",
                eventType: updatedPublication ? "shift_updated" : "shift_published",
                title: updatedPublication ? "Vardiyan güncellendi" : "Yeni haftalık vardiyan yayınlandı",
                body: `${weekStart} haftasına ait vardiya planın ${updatedPublication ? "güncellendi" : "yayınlandı"}.`,
                severity: updatedPublication ? "warning" : "success",
                entityType: "shift_plan",
                entityId: weekStart,
                deepLink: `/personel/?section=shift&weekStart=${encodeURIComponent(weekStart)}`,
                dedupeKey: `shift-${updatedPublication ? "updated" : "published"}:${weekStart}:${publicationRevision}:${personId}`,
                metadata: { weekStart, publicationRevision, updatedPublication }
              }));
            }
          }

          const retained = (data.workforceShiftPlans || []).filter((plan) => {
            if (plan.weekStart !== weekStart) return true;
            if (publish) return plan.status !== "published" && plan.status !== "draft";
            return plan.status !== "draft";
          });
          data.workforceShiftPlans = retained.concat(savedPlans);
          activity(data, publish ? "shifts_published" : "shifts_drafted", {
            id: "admin",
            name: "Yönetici"
          }, {
            assignmentTitle: `${weekStart} haftası`,
            weekStart,
            updatedPublication: publish && previousPublished.length > 0,
            revisionId: revision && revision.id
          });
          const workforceRev = touchWorkforceRevision(data);
          response = {
            ok: true,
            requestId,
            revision: workforceRev,
            plans: savedPlans,
            published: publish,
            publicationRevision: publish && savedPlans[0] ? savedPlans[0].publicationRevision : null,
            updatedPublication: Boolean(revision),
            revisionId: revision && revision.id || null
          };
          recordIdempotent(data, operation, requestId, weekStart, workforceRev, { response });
          return data;
        });
        publishNotifications(pendingNotifications);
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/admin/workforce/shifts/:weekStart/apply-draft",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const weekStart = String(req.params.weekStart || "");
        if (!isMonday(weekStart)) {
          return res.status(400).json({ ok: false, message: "Hafta başlangıcı Pazartesi olmalıdır." });
        }
        const body = req.body || {};
        const requestId = operationRequestId(req);
        let plans;
        let response;
        let replayed = false;
        await updateStore((data) => {
          const previous = findIdempotent(data, "shifts_apply_draft", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          plans = (data.workforceShiftPlans || []).filter((plan) =>
            plan.weekStart === weekStart && plan.status === "draft"
          );
          if (!plans.length) throw fail("Uygulanacak taslak bulunamadı.", 404);
          const timestamp = isoNow();
          plans.forEach((plan) => {
            plan.appliedAt = timestamp;
            plan.updatedAt = timestamp;
          });
          activity(data, "shifts_draft_applied", { id: "admin", name: "Yönetici" }, {
            assignmentTitle: `${weekStart} haftası`,
            weekStart
          });
          const revision = touchWorkforceRevision(data);
          response = { ok: true, requestId, revision, plans, published: false };
          recordIdempotent(data, "shifts_apply_draft", requestId, weekStart, revision, { response });
          return data;
        });
        res.json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/admin/workforce/shifts/:weekStart/auto-draft",
    requireAdminRequestOrigin,
    auth.requireAdmin,
    async (req, res, next) => {
      try {
        const weekStart = String(req.params.weekStart || "");
        if (!isMonday(weekStart)) {
          return res.status(400).json({ ok: false, message: "Hafta başlangıcı Pazartesi olmalıdır." });
        }
        if (weekStart <= currentWeekStart()) {
          return res.status(409).json({ ok: false, message: "Otomatik taslak yalnızca gelecek haftalar için oluşturulabilir." });
        }
        const body = req.body || {};
        const requestId = operationRequestId(req);

        let plans;
        let response;
        let replayed = false;
        await updateStore((data) => {
          const previous = findIdempotent(data, "shifts_auto_draft", requestId);
          if (previous) {
            response = replayResponse(previous);
            replayed = true;
            return data;
          }
          assertExpectedRevision(data, body);
          const users = activeUsers(data);
          if (!users.length) throw fail("Aktif personel bulunamadı.", 409);
          const settings = normalizeShiftSettings(data.workforceShiftSettings);
          const approvedRequests = (data.workforceShiftRequests || [])
            .filter((request) => request.status === "onaylandı")
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
          const start = new Date(`${weekStart}T00:00:00.000Z`);
          const timestamp = isoNow();
          plans = [];
          const conflicts = [];
          let consideredRequestCount = 0;

          for (let day = 0; day < 7; day += 1) {
            const date = new Date(start.getTime() + day * 86400000).toISOString().slice(0, 10);
            users.forEach((user, userIndex) => {
              const requests = approvedRequests.filter((request) =>
                request.personId === user.id && request.date === date
              );
              const approvedLeave = requests.find((request) => request.type === "leave");
              const preference = approvedLeave || requests.find((request) => request.type !== "leave");
              consideredRequestCount += preference ? 1 : 0;
              if (requests.length > 1) {
                conflicts.push({ personId: user.id, date, requestIds: requests.map((request) => request.id), selectedRequestId: preference && preference.id });
              }
              let type = (userIndex + day) % 2 === 0 ? "morning" : "evening";
              let source = "auto";
              if (preference) {
                type = preference.type;
                source = "approved_request";
              }
              const times = shiftTimes(type, preference || {}, settings);
              plans.push({
                id: createId("shift"),
                weekStart,
                personId: user.id,
                personName: user.name || user.username,
                date,
                type,
                startTime: times.startTime,
                endTime: times.endTime,
                status: "draft",
                source,
                sourceRequestId: preference && preference.id || null,
                publishedAt: null,
                createdAt: timestamp,
                updatedAt: timestamp
              });
            });
          }

          data.workforceShiftPlans = (data.workforceShiftPlans || [])
            .filter((plan) => plan.weekStart !== weekStart || plan.status !== "draft")
            .concat(plans);
          activity(data, "shifts_auto_drafted", { id: "admin", name: "Yönetici" }, {
            assignmentTitle: `${weekStart} haftası`,
            weekStart
          });
          const revision = touchWorkforceRevision(data);
          response = {
            ok: true,
            requestId,
            revision,
            plans,
            proposal: {
              consideredRequestCount,
              conflicts,
              appliedRules: ["Onaylı izin önceliği", "En eski onaylı tercih", "Dengeli sabah/akşam dönüşümü"],
              limitations: ["Rol/şube minimumu, haftalık azami saat ve dinlenme kuralı mevcut veri modelinde otomatik doğrulanmıyor."]
            }
          };
          recordIdempotent(data, "shifts_auto_draft", requestId, weekStart, revision, { response });
          return data;
        });
        res.status(replayed ? 200 : 201).json({ ...response, idempotent: replayed || response.idempotent === true });
      } catch (error) {
        next(error);
      }
    }
  );

  async function decideWorkforceShipment(input = {}) {
    const sourceRequest = input.req && typeof input.req === "object" ? input.req : {};
    const requestId = String(input.requestId || "").trim();
    const proxyRequest = Object.create(sourceRequest);
    proxyRequest.params = {
      ...(sourceRequest.params || {}),
      id: String(input.shipmentId || ""),
      decision: String(input.decision || "approve")
    };
    proxyRequest.body = {
      ...(sourceRequest.body || {}),
      requestId,
      expectedRevision: input.expectedRevision,
      procurementExpectedRevision: input.procurementExpectedRevision,
      note: String(input.note || ""),
      rejectionReason: String(input.rejectionReason || ""),
      destinationLocationId: String(input.destinationLocationId || "")
    };
    proxyRequest.procurementActor = input.actor || null;
    if (typeof proxyRequest.get !== "function") {
      proxyRequest.get = (name) => {
        const key = String(name || "").toLowerCase();
        if (key === "idempotency-key" || key === "x-request-id") return requestId;
        return "";
      };
    }

    return new Promise((resolve, reject) => {
      let statusCode = 200;
      const response = {
        status(code) {
          statusCode = Number(code) || 500;
          return this;
        },
        json(payload) {
          if (statusCode >= 400) {
            const error = fail(payload && payload.message || "Sevkiyat işlemi tamamlanamadı.", statusCode);
            error.payload = payload;
            reject(error);
          } else {
            resolve(payload);
          }
          return this;
        }
      };
      handleShipmentDecision(proxyRequest, response, reject);
    });
  }

  return {
    approveWorkforceShipment(input = {}) {
      return decideWorkforceShipment({ ...input, decision: "approve" });
    },
    invalidateWorkforce(input = {}) {
      const revision = Math.max(0, Math.trunc(Number(input.revision || 0)));
      if (revision > 0) broadcastWorkforceInvalidation(revision);
    },
    decideWorkforceShipment
  };
}

function normalizeTaskItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.map((item, index) => {
    const text = String(item && typeof item === "object" ? item.text : item || "").trim().slice(0, 300);
    let id = String(item && typeof item === "object" && item.id || `item-${index + 1}`).trim().slice(0, 80);
    if (!id || seen.has(id)) {
      const baseId = `item-${index + 1}`;
      id = baseId;
      let suffix = 2;
      while (seen.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
    }
    seen.add(id);
    return { id, text, order: index };
  }).filter((item) => item.text);
}

function assignmentWorkflowStatus(assignment, task) {
  if ((assignment && assignment.status === "cancelled") || (task && task.status === "cancelled")) return "iptal_edildi";
  if (assignment && assignment.status === "completed") return "tamamlandi";
  if (isTaskOverdue(task)) return "gecikti";
  if (assignment && assignment.status === "in_progress") return "devam_ediyor";
  return "atandi";
}

function taskWorkflowStatus(task, assignments) {
  if (task && task.status === "draft") return "taslak";
  if (task && ["cancelled", "archived"].includes(task.status)) return "iptal_edildi";
  const list = Array.isArray(assignments) ? assignments : [];
  if ((task && task.status === "completed") || (list.length && list.every((assignment) => assignment.status === "completed"))) return "tamamlandi";
  if (isTaskOverdue(task)) return "gecikti";
  if (list.some((assignment) => ["in_progress", "completed"].includes(assignment.status))) return "devam_ediyor";
  return "atandi";
}

function isTaskOverdue(task, now = Date.now()) {
  if (!task || ["completed", "cancelled", "archived"].includes(task.status)) return false;
  const dueAt = task.dueAt || (task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00+03:00` : "");
  const timestamp = Date.parse(dueAt);
  return Number.isFinite(timestamp) && timestamp < now;
}

function normalizeUnit(value) {
  const unit = String(value || "").trim().toLocaleLowerCase("tr-TR");
  return {
    l: "litre",
    lt: "litre",
    liter: "litre",
    kilogram: "kg",
    gram: "gr",
    tane: "adet",
    kutu: "paket",
    sise: "şişe"
  }[unit] || unit;
}

function convertToBaseUnit(quantity, requestedUnit, product) {
  const baseUnit = normalizeUnit(product.unit);
  if (requestedUnit === baseUnit) return { quantity: roundNumber(quantity), factor: 1 };
  const mass = { kg: 1000, gr: 1 };
  const volume = { litre: 1000, ml: 1 };
  if (mass[requestedUnit] && mass[baseUnit]) {
    const factor = mass[requestedUnit] / mass[baseUnit];
    return { quantity: roundNumber(quantity * factor), factor };
  }
  if (volume[requestedUnit] && volume[baseUnit]) {
    const factor = volume[requestedUnit] / volume[baseUnit];
    return { quantity: roundNumber(quantity * factor), factor };
  }

  const packageMetadata = product.packageInfo;
  const packageCount = positiveNumber(
    product.unitsPerCase ??
    product.packageSize ??
    product.packSize ??
    product.piecesPerBox ??
    product.koliIci ??
    (packageMetadata && typeof packageMetadata === "object"
      ? packageMetadata.unitsPerCase || packageMetadata.quantity
      : packageMetadata)
  );
  if (requestedUnit === "koli" && packageCount && ["paket", "adet", "şişe"].includes(baseUnit)) {
    return {
      quantity: roundNumber(quantity * packageCount),
      factor: packageCount,
      packageInfo: `1 koli = ${packageCount} ${baseUnit}`
    };
  }
  if (baseUnit === "koli" && packageCount && ["paket", "adet", "şişe"].includes(requestedUnit)) {
    return {
      quantity: roundNumber(quantity / packageCount),
      factor: 1 / packageCount,
      packageInfo: `1 koli = ${packageCount} ${requestedUnit}`
    };
  }
  throw Object.assign(new Error(`"${requestedUnit}" birimi bu ürünün stok birimi "${baseUnit}" ile uyumlu değil.`), {
    status: 400
  });
}

function positiveNumber(value) {
  const match = typeof value === "number" ? value : String(value || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  const number = Number(Array.isArray(match) ? match[0] : match);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function requestTimes(type, body) {
  if (type !== "custom") return { startTime: null, endTime: null };
  const startTime = String(body.startTime || "");
  const endTime = String(body.endTime || "");
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime) || startTime >= endTime) {
    return { error: "Başlangıç saati bitiş saatinden önce olmalıdır." };
  }
  return { startTime, endTime };
}

function normalizeShiftSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const morning = source.morning || {};
  const evening = source.evening || {};
  return {
    morning: {
      startTime: TIME_PATTERN.test(morning.startTime) ? morning.startTime : "08:00",
      endTime: TIME_PATTERN.test(morning.endTime) ? morning.endTime : "16:00"
    },
    evening: {
      startTime: TIME_PATTERN.test(evening.startTime) ? evening.startTime : "16:00",
      endTime: TIME_PATTERN.test(evening.endTime) ? evening.endTime : "00:00"
    },
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null
  };
}

function validateShiftSettings(body) {
  const settings = normalizeShiftSettings(body);
  for (const type of ["morning", "evening"]) {
    const value = body[type] || {};
    if (!TIME_PATTERN.test(String(value.startTime || "")) || !TIME_PATTERN.test(String(value.endTime || ""))) {
      return { error: "Sabah ve akşam vardiya saatleri geçerli olmalıdır." };
    }
    if (value.startTime === value.endTime) {
      return { error: "Vardiya başlangıç ve bitiş saati aynı olamaz." };
    }
  }
  return { value: settings };
}

function shiftTimes(type, source, settings) {
  if (type === "leave" || type === "unassigned") return { startTime: null, endTime: null };
  if (type === "custom") return { startTime: source.startTime, endTime: source.endTime };
  return settings[type] || settings.morning;
}

function normalizePlans(plans, weekStart, validUsers, settings, publish, createId, isoNow) {
  const weekDates = new Set(Array.from({ length: 7 }, (_, index) => {
    const start = new Date(`${weekStart}T00:00:00.000Z`);
    return new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
  }));
  const seen = new Set();
  const timestamp = isoNow();
  return plans.map((plan) => {
    const personId = String(plan.personId || "");
    const date = String(plan.date || "");
    const type = String(plan.type || "");
    if (!validUsers.has(personId)) throw Object.assign(new Error("Plan yalnızca aktif personele atanabilir."), { status: 400 });
    if (!weekDates.has(date)) throw Object.assign(new Error("Plan tarihi seçilen haftanın dışında."), { status: 400 });
    if (!SHIFT_TYPES.has(type)) throw Object.assign(new Error("Vardiya türü geçersiz."), { status: 400 });
    const key = `${personId}:${date}`;
    if (seen.has(key)) throw Object.assign(new Error("Aynı personel ve gün için birden fazla vardiya olamaz."), { status: 400 });
    seen.add(key);
    const times = shiftTimes(type, plan, settings);
    if (type === "custom" && (!TIME_PATTERN.test(times.startTime) || !TIME_PATTERN.test(times.endTime) || times.startTime >= times.endTime)) {
      throw Object.assign(new Error("Özel vardiya saat aralığı geçersiz."), { status: 400 });
    }
    return {
      id: String(plan.id || createId("shift")),
      weekStart,
      personId,
      date,
      type,
      startTime: times.startTime || null,
      endTime: times.endTime || null,
      status: publish ? "published" : "draft",
      source: String(plan.source || "manual"),
      publishedAt: publish ? timestamp : null,
      createdAt: plan.createdAt || timestamp,
      updatedAt: timestamp
    };
  });
}

function isMonday(dateString) {
  if (!DATE_PATTERN.test(dateString)) return false;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 1;
}

function currentWeekStart() {
  const date = new Date(`${turkeyDateKey()}T12:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function turkeyDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

module.exports = { registerWorkforceRoutes };
