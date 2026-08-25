"use strict";

const crypto = require("crypto");
const { normalizeStockState } = require("./store/migrations");
const stockService = require("./stock-service");

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/;

function registerStockLocationRoutes(deps) {
  const {
    app,
    store,
    auth,
    requireAdminRequestOrigin,
    requireAdminOrMainRequestOrigin,
    broadcastStockUpdate,
    incrementPublishRevision,
    notificationService,
    queueStockThresholdNotifications
  } = deps;

  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const nowIso = () => new Date().toISOString();

  function requestId(req, required = false) {
    const value = String(
      req.get("Idempotency-Key")
      || req.get("X-Request-ID")
      || req.body && (req.body.requestId || req.body.idempotencyKey)
      || ""
    ).trim().slice(0, 160);
    if (!value && required) throw fail("Bu işlem için requestId veya Idempotency-Key gerekli.");
    if (value && !REQUEST_ID_PATTERN.test(value)) throw fail("Geçerli bir requestId veya Idempotency-Key gerekli.");
    return value;
  }

  function adminActor(req) {
    return {
      type: "admin",
      id: String(req.admin && (req.admin.userId || req.admin.sub) || "admin"),
      name: String(req.admin && (req.admin.name || req.admin.username) || "Yönetici")
    };
  }

  function personnelActor(req) {
    const user = req.recipeUser || {};
    return {
      type: "personel",
      id: String(user.id || req.recipe && req.recipe.userId || ""),
      name: String(user.name || user.username || "Personel"),
      branchId: String(user.branchId || "main"),
      stockLocationId: String(user.stockLocationId || "")
    };
  }

  function stockRevision(data) {
    return Math.max(0, Number(data && data.revisions && data.revisions.stock || 0));
  }

  function persistStockMutation(data, stockState, timestamp) {
    data.stockState = normalizeStockState(stockState);
    data.stockUpdatedAt = timestamp;
    data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions)
      ? data.revisions
      : {};
    data.revisions.stock = stockRevision(data) + 1;
    if (typeof incrementPublishRevision === "function") incrementPublishRevision(data);
    return data.stockState;
  }

  function publishNotifications(pending) {
    if (!notificationService || typeof notificationService.publishNotificationEvent !== "function") return;
    for (const notification of pending) notificationService.publishNotificationEvent(notification);
  }

  function queueNotification(data, pending, input) {
    if (!notificationService || typeof notificationService.createNotificationInStore !== "function") return;
    const notification = notificationService.createNotificationInStore(data, input);
    if (notification) pending.push(notification);
  }

  function publicLocations(stockState, actor) {
    const locations = stockService.getLocations(stockState);
    if (!actor || actor.type === "admin") return locations;
    const ownId = stockService.actorLocationId(stockState, actor);
    return locations.filter((location) => location.id === ownId);
  }

  function personnelForLocations(data) {
    return (data.recipeUsers || []).filter((user) => user && user.id).map((user) => ({
      id: String(user.id),
      name: String(user.name || user.displayName || user.username || "Personel"),
      username: String(user.username || ""),
      active: user.active !== false,
      stockLocationId: String(user.stockLocationId || "")
    }));
  }

  function locationsForAdmin(data, stockState) {
    const assignments = new Map();
    for (const person of personnelForLocations(data)) {
      if (!assignments.has(person.stockLocationId)) assignments.set(person.stockLocationId, []);
      assignments.get(person.stockLocationId).push(person.id);
    }
    return stockService.getLocations(stockState, { includeInactive: true }).map((location) => ({
      ...location,
      assignedPersonnelIds: assignments.get(String(location.id)) || []
    }));
  }

  function locationPayload(data, locationId, actor) {
    const state = normalizeStockState(data.stockState);
    const inventory = stockService.getLocationInventory(state, locationId);
    return {
      ok: true,
      location: inventory.location,
      locations: publicLocations(state, actor),
      balances: inventory.balances,
      summary: inventory.summary,
      revision: stockRevision(data),
      publishRevision: Number(data.revisions && data.revisions.publish || 0),
      updatedAt: data.stockUpdatedAt || state.updatedAt || null
    };
  }

  app.get("/api/admin/stock/locations", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({
        ok: true,
        locations: locationsForAdmin(data, state),
        personnel: personnelForLocations(data),
        revision: stockRevision(data),
        updatedAt: data.stockUpdatedAt || state.updatedAt || null
      });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/stock/locations", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const name = String(body.name || "").trim().slice(0, 120);
      const code = normalizeLocationCode(body.code || name);
      const type = String(body.type || "other").trim();
        if (!name || !code) throw fail("Depo adı ve kodu zorunludur.");
        if (!stockService.LOCATION_TYPES.has(type)) throw fail("Depo türü geçersiz.");
        if (type !== "cafe" && normalizeIdList(body.assignedPersonnelIds).length) {
          throw fail("Personel yalnızca Kafe Deposuna atanabilir.");
        }
      const operationId = requestId(req);
      const timestamp = nowIso();
      let location;
      const saved = await store.update((data) => {
        const state = normalizeStockState(data.stockState);
        if (state.locations.some((item) => item.code === code)) throw fail("Bu depo kodu zaten kullanılıyor.", 409);
        location = {
          id: uniqueLocationId(state, code),
          code,
          name,
          description: String(body.description || "").trim().slice(0, 500),
          type,
          active: body.active !== false,
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.max(0, Math.trunc(Number(body.sortOrder))) : state.locations.length * 10 + 10,
          isDefault: body.isDefault === true,
          assignedPersonnelIds: normalizeIdList(body.assignedPersonnelIds),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        if (location.isDefault) {
          for (const existing of state.locations) existing.isDefault = false;
        }
        state.locations.push(location);
        assignPersonnelToLocation(data, state, location.id, location.assignedPersonnelIds);
        persistStockMutation(data, normalizeStockState(state), timestamp);
        appendStockAudit(data, adminActor(req), "stock.location.create", location.id, operationId, null, location, timestamp);
        return data;
      });
      broadcastStockUpdate(saved.stockState, timestamp);
      const stockState = normalizeStockState(saved.stockState);
      res.status(201).json({ ok: true, location, locations: locationsForAdmin(saved, stockState), personnel: personnelForLocations(saved), stockState, revision: stockRevision(saved), updatedAt: timestamp });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/stock/locations/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req);
      const timestamp = nowIso();
      let location;
      const saved = await store.update((data) => {
        assertExpectedStockRevision(data, body);
        const state = normalizeStockState(data.stockState);
        location = state.locations.find((item) => String(item.id) === String(req.params.id));
        if (!location) throw fail("Stok lokasyonu bulunamadı.", 404);
        const previous = { ...location };
        if (body.name !== undefined) {
          const name = String(body.name || "").trim().slice(0, 120);
          if (!name) throw fail("Depo adı boş olamaz.");
          location.name = name;
        }
        if (body.description !== undefined) location.description = String(body.description || "").trim().slice(0, 500);
        if (body.code !== undefined) {
          const code = normalizeLocationCode(body.code);
          if (!code) throw fail("Depo kodu geçersiz.");
          if (state.locations.some((item) => item.id !== location.id && item.code === code)) throw fail("Bu depo kodu zaten kullanılıyor.", 409);
          location.code = code;
        }
        if (body.type !== undefined) {
          const type = String(body.type || "").trim();
          if (!stockService.LOCATION_TYPES.has(type)) throw fail("Depo türü geçersiz.");
          location.type = type;
        }
        if (body.active !== undefined) {
          if (location.code === "GENEL" && body.active === false) throw fail("Genel Depo pasifleştirilemez.", 409);
          location.active = body.active !== false;
        }
        if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) location.sortOrder = Math.max(0, Math.trunc(Number(body.sortOrder)));
        if (body.isDefault !== undefined) {
          const makeDefault = body.isDefault === true;
          if (makeDefault) {
            for (const candidate of state.locations) candidate.isDefault = candidate.id === location.id;
          } else if (location.code !== "GENEL") {
            location.isDefault = false;
            if (!(state.locations || []).some((candidate) => candidate.isDefault)) {
              const general = (state.locations || []).find((candidate) => candidate.code === "GENEL");
              if (general) general.isDefault = true;
            }
          }
        }
        if (body.assignedPersonnelIds !== undefined) {
          const nextAssignments = normalizeIdList(body.assignedPersonnelIds);
          if (location.type !== "cafe" && nextAssignments.length) {
            throw fail("Personel yalnızca Kafe Deposuna atanabilir.");
          }
          const previousAssignments = Array.isArray(location.assignedPersonnelIds) ? location.assignedPersonnelIds.slice() : [];
          assignPersonnelToLocation(data, state, location.id, nextAssignments, previousAssignments);
          location.assignedPersonnelIds = nextAssignments;
        }
        if (body.active === false && location.type === "cafe" && (data.recipeUsers || []).some((user) => user.active !== false && String(user.stockLocationId || "") === String(location.id))) {
          throw fail("Bu depoya atanmış aktif personel varken depo pasifleştirilemez.", 409);
        }
        location.updatedAt = timestamp;
        persistStockMutation(data, normalizeStockState(state), timestamp);
        appendStockAudit(data, adminActor(req), "stock.location.update", location.id, operationId, previous, location, timestamp);
        return data;
      });
      broadcastStockUpdate(saved.stockState, timestamp);
      const stockState = normalizeStockState(saved.stockState);
      location = stockState.locations.find((item) => item.id === location.id);
      res.json({ ok: true, location, locations: locationsForAdmin(saved, stockState), personnel: personnelForLocations(saved), stockState, revision: stockRevision(saved), updatedAt: timestamp });
    } catch (error) { next(error); }
  });

  app.delete("/api/admin/stock/locations/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let location;
      const saved = await store.update((data) => {
        assertExpectedStockRevision(data, body);
        const state = normalizeStockState(data.stockState);
        location = state.locations.find((item) => String(item.id) === String(req.params.id));
        if (!location) throw fail("Stok lokasyonu bulunamadı.", 404);
        if (["CAFE", "GENEL"].includes(location.code)) throw fail("Sistem depoları kaldırılamaz; yalnızca adı ve eşikleri düzenlenebilir.", 409);
        if (location.isDefault) throw fail("Varsayılan depo pasifleştirilmeden önce başka bir varsayılan depo seçin.", 409);
        if ((data.recipeUsers || []).some((user) => user.active !== false && String(user.stockLocationId || "") === String(location.id))) {
          throw fail("Bu depoya atanmış aktif personel varken depo pasifleştirilemez.", 409);
        }
        const previous = { ...location };
        location.active = false;
        location.deactivatedAt = timestamp;
        location.updatedAt = timestamp;
        persistStockMutation(data, state, timestamp);
        appendStockAudit(data, adminActor(req), "stock.location.deactivate", location.id, operationId, previous, location, timestamp);
        return data;
      });
      broadcastStockUpdate(saved.stockState, timestamp);
      const state = normalizeStockState(saved.stockState);
      res.json({ ok: true, location: state.locations.find((item) => item.id === location.id), locations: locationsForAdmin(saved, state), revision: stockRevision(saved), updatedAt: timestamp });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/stock/inventory", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      const locationId = String(req.query.locationId || stockService.defaultGeneralLocation(state).id);
      res.json(locationPayload(data, locationId, adminActor(req)));
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/stock/inventory/:productId", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req);
      const locationId = String(body.locationId || "").trim();
      if (!locationId) throw fail("Depo seçimi zorunludur.");
      const timestamp = nowIso();
      let balance;
      const saved = await store.update((data) => {
        assertExpectedStockRevision(data, body);
        const state = normalizeStockState(data.stockState);
        const location = stockService.getLocation(state, locationId);
        const product = state.products.find((item) => String(item.id) === String(req.params.productId));
        if (!product) throw fail("Stok ürünü bulunamadı.", 404);
        balance = state.balances.find((item) => item.locationId === location.id && item.productId === product.id);
        if (!balance) throw fail("Stok bakiyesi bulunamadı.", 404);
        const previous = { balance: { ...balance }, product: { ...product } };
        for (const field of ["criticalThreshold", "orderThreshold", "targetLevel"]) {
          if (body[field] === undefined) continue;
          const value = Number(body[field]);
          if (!Number.isFinite(value) || value < 0) throw fail("Eşik değerleri negatif olamaz.");
          balance[field] = Math.round(value * 1000) / 1000;
        }
        const currentBaseUnit = String(product.baseUnit || product.unit || "adet");
        const nextBaseUnit = body.baseUnit === undefined ? currentBaseUnit : String(body.baseUnit || "").trim().toLocaleLowerCase("tr-TR");
        if (!nextBaseUnit) throw fail("Temel birim boş olamaz.");
        const hasHistory = state.movements.some((movement) => String(movement.productId) === String(product.id));
        const hasBalance = state.balances.some((candidate) => String(candidate.productId) === String(product.id) && Number(candidate.quantity || 0) !== 0);
        if (nextBaseUnit !== currentBaseUnit && (hasHistory || hasBalance)) {
          throw fail("Hareket geçmişi veya bakiye bulunan ürünün temel birimi değiştirilemez. Toplu birim dönüşümünü düzenleyebilirsiniz.", 409);
        }
        if (body.baseUnit !== undefined) {
          product.baseUnit = nextBaseUnit;
          product.unit = nextBaseUnit;
        }
        if (body.bulkUnit !== undefined) {
          product.bulkUnit = String(body.bulkUnit || "").trim().toLocaleLowerCase("tr-TR");
          product.caseUnit = product.bulkUnit;
        }
        if (body.unitsPerBulkUnit !== undefined || body.unitsPerCase !== undefined) {
          const factor = Number(body.unitsPerBulkUnit ?? body.unitsPerCase);
          if (!Number.isFinite(factor) || factor < 0) throw fail("Toplu birim dönüşümü negatif olamaz.");
          product.unitsPerBulkUnit = Math.round(factor * 1000) / 1000;
          product.unitsPerCase = product.unitsPerBulkUnit;
        }
        if (body.allowDecimal !== undefined) product.allowDecimal = body.allowDecimal === true;
        if (body.defaultMovementUnit !== undefined) product.defaultMovementUnit = String(body.defaultMovementUnit || nextBaseUnit).trim().toLocaleLowerCase("tr-TR");
        if (product.bulkUnit && Number(product.unitsPerBulkUnit || 0) <= 0) throw fail("Toplu birim kullanılıyorsa dönüşüm miktarı sıfırdan büyük olmalıdır.");
        const allowedUnits = stockService.allowedProductUnits(product);
        if (!allowedUnits.includes(product.defaultMovementUnit)) throw fail("Varsayılan hareket birimi ürünün temel veya toplu birimi olmalıdır.");
        balance.updatedAt = timestamp;
        product.updatedAt = timestamp;
        persistStockMutation(data, state, timestamp);
        appendStockAudit(data, adminActor(req), "stock.inventory.settings", `${location.id}:${product.id}`, operationId, previous, { balance, product }, timestamp);
        return data;
      });
      broadcastStockUpdate(saved.stockState, timestamp);
      const payload = locationPayload(saved, locationId, adminActor(req));
      res.json({ ...payload, balance: payload.balances.find((item) => item.productId === req.params.productId) || balance });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/stock/counts", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({ ok: true, counts: stockService.serializeCounts(state, req.query || {}), locations: stockService.getLocations(state, { includeInactive: true }), revision: stockRevision(data), updatedAt: data.stockUpdatedAt || state.updatedAt || null });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/stock/counts", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("start"));
  app.patch("/api/admin/stock/counts/:id", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("update"));
  app.post("/api/admin/stock/counts/:id/approve", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("approve"));
  app.post("/api/admin/stock/counts/:id/cancel", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("cancel"));

  function countMutationHandler(action) {
    return async (req, res, next) => {
      try {
        const body = req.body || {};
        const operationId = requestId(req, true);
        const timestamp = nowIso();
        const actor = adminActor(req);
        const pendingNotifications = [];
        let result;
        const saved = await store.update((data, context) => {
          assertExpectedStockRevision(data, body);
          const previousState = normalizeStockState(data.stockState);
          if (action === "start") result = stockService.startStockCount(previousState, { ...body, requestId: operationId }, actor, { now: timestamp });
          else if (action === "update") result = stockService.updateStockCount(previousState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp });
          else if (action === "approve") result = stockService.approveStockCount(previousState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp });
          else result = stockService.cancelStockCount(previousState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp });
          if (result.idempotent) return context.noChange;
          persistStockMutation(data, result.stockState, timestamp);
          if (action === "approve" && typeof queueStockThresholdNotifications === "function") {
            queueStockThresholdNotifications(data, pendingNotifications, previousState, result.stockState, { operationId, updatedAt: timestamp });
          }
          appendStockAudit(data, actor, `stock.count.${action}`, result.count && result.count.id || req.params.id, operationId, null, result.count, timestamp);
          return data;
        });
        if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp);
        publishNotifications(pendingNotifications);
        res.status(action === "start" && !result.idempotent ? 201 : 200).json({ ok: true, count: result.count, movements: result.movements || [], idempotent: result.idempotent, stockState: normalizeStockState(saved.stockState), revision: stockRevision(saved), updatedAt: saved.stockUpdatedAt || timestamp });
      } catch (error) { next(error); }
    };
  }

  app.get("/api/admin/stock/movements", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({
        ok: true,
        movements: stockService.serializeMovements(state, req.query || {}),
        locations: stockService.getLocations(state, { includeInactive: true }),
        revision: stockRevision(data),
        updatedAt: data.stockUpdatedAt || state.updatedAt || null
      });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/stock/movements", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body && (req.body.movement || req.body) || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        assertExpectedStockRevision(data, body);
        const previousStockState = normalizeStockState(data.stockState);
        result = stockService.applyStockMovement(previousStockState, { ...body, requestId: operationId }, adminActor(req), { now: timestamp });
        // Retried HTTP requests must return the original movement without a
        // second store revision, audit row or durable write.
        if (result.idempotent) return context.noChange;
        persistStockMutation(data, result.stockState, timestamp);
        if (typeof queueStockThresholdNotifications === "function") {
          queueStockThresholdNotifications(data, pendingNotifications, previousStockState, result.stockState, { operationId, updatedAt: timestamp });
        }
        appendStockAudit(data, adminActor(req), "stock.movement.apply", result.movement && result.movement.id, operationId, null, result.movement, timestamp);
        return data;
      });
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp);
      publishNotifications(pendingNotifications);
      const inventory = stockService.getLocationInventory(saved.stockState, String(body.locationId || result.movement && result.movement.locationId || ""));
      res.status(result.idempotent ? 200 : 201).json({ ok: true, movement: result.movement, stockState: normalizeStockState(saved.stockState), inventory: { location: inventory.location, balances: inventory.balances, summary: inventory.summary }, idempotent: result.idempotent, revision: stockRevision(saved), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/stock/transfers", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      const status = String(req.query.status || "").trim();
      let transfers = stockService.serializeTransfers(state, req.query || {});
      if (status) transfers = transfers.filter((transfer) => transfer.status === status);
      res.json({ ok: true, transfers, locations: stockService.getLocations(state, { includeInactive: true }), revision: stockRevision(data), updatedAt: data.stockUpdatedAt || state.updatedAt || null });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/stock/transfers", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const actor = adminActor(req);
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        assertExpectedStockRevision(data, body);
        const previousStockState = normalizeStockState(data.stockState);
        const created = stockService.createTransferRequest(previousStockState, { ...body, requestId: operationId }, actor, { now: timestamp });
        result = created;
        if ((body.approveNow === true || body.directApply === true) && !created.idempotent) {
          result = stockService.approveTransfer(created.stockState, created.transfer.id, { requestId: `${operationId}:approve`, note: body.note }, actor, { now: timestamp });
        }
        if (result.idempotent) return context.noChange;
        persistStockMutation(data, result.stockState, timestamp);
        if (typeof queueStockThresholdNotifications === "function") {
          queueStockThresholdNotifications(data, pendingNotifications, previousStockState, result.stockState, { operationId, updatedAt: timestamp });
        }
        appendStockAudit(data, actor, body.approveNow === true || body.directApply === true ? "stock.transfer.direct" : "stock.transfer.request", result.transfer && result.transfer.id, operationId, null, result.transfer, timestamp);
        return data;
      });
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp);
      publishNotifications(pendingNotifications);
      res.status(result.idempotent ? 200 : 201).json({ ok: true, transfer: result.transfer, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, revision: stockRevision(saved), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/stock/transfers/:id/approve", requireAdminRequestOrigin, auth.requireAdmin, transferDecisionHandler("approve"));
  app.post("/api/admin/stock/transfers/:id/reject", requireAdminRequestOrigin, auth.requireAdmin, transferDecisionHandler("reject"));
  app.post("/api/admin/stock/transfers/:id/cancel", requireAdminRequestOrigin, auth.requireAdmin, transferDecisionHandler("cancel"));

  function transferDecisionHandler(decision) {
    return async (req, res, next) => {
      try {
        const body = req.body || {};
        const operationId = requestId(req, true);
        const timestamp = nowIso();
        const actor = adminActor(req);
        const pendingNotifications = [];
        let result;
        const saved = await store.update((data, context) => {
          assertExpectedStockRevision(data, body);
          const previousStockState = normalizeStockState(data.stockState);
          result = decision === "approve"
            ? stockService.approveTransfer(previousStockState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp })
            : decision === "reject"
              ? stockService.rejectTransfer(previousStockState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp })
              : stockService.cancelTransfer(previousStockState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp });
          if (result.idempotent) return context.noChange;
          persistStockMutation(data, result.stockState, timestamp);
          if (typeof queueStockThresholdNotifications === "function") {
            queueStockThresholdNotifications(data, pendingNotifications, previousStockState, result.stockState, { operationId, updatedAt: timestamp });
          }
          appendStockAudit(data, actor, `stock.transfer.${decision}`, req.params.id, operationId, null, result.transfer, timestamp);
          const requestedBy = String(result.transfer && result.transfer.requestedBy || "");
          if (requestedBy && decision !== "cancel") queueNotification(data, pendingNotifications, {
            recipientRole: "personnel",
            recipientId: requestedBy,
            category: "stock",
            eventType: decision === "approve" ? "stock_transfer_approved" : "stock_transfer_rejected",
            title: decision === "approve" ? "Depo transfer talebin onaylandı" : "Depo transfer talebin reddedildi",
            body: `${result.transfer.product && (result.transfer.product.name || result.transfer.product.productName) || "Stok ürünü"} için transfer talebin ${decision === "approve" ? "onaylandı" : "reddedildi"}.`,
            severity: decision === "approve" ? "success" : "warning",
            entityType: "stock_transfer",
            entityId: result.transfer.id,
            deepLink: `/personel/?section=stock&transferId=${encodeURIComponent(result.transfer.id)}`,
            dedupeKey: `stock-transfer-${decision}:${result.transfer.id}:${requestedBy}`,
            metadata: { transferId: result.transfer.id }
          });
          return data;
        });
        if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp);
        publishNotifications(pendingNotifications);
        res.json({ ok: true, transfer: result.transfer, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, revision: stockRevision(saved), updatedAt: saved.stockUpdatedAt || timestamp });
      } catch (error) { next(error); }
    };
  }

  app.post("/api/admin/stock/movements/:id/reverse", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const actor = adminActor(req);
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        assertExpectedStockRevision(data, body);
        const previousStockState = normalizeStockState(data.stockState);
        result = stockService.reverseMovement(previousStockState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp });
        if (result.idempotent) return context.noChange;
        persistStockMutation(data, result.stockState, timestamp);
        if (typeof queueStockThresholdNotifications === "function") {
          queueStockThresholdNotifications(data, pendingNotifications, previousStockState, result.stockState, { operationId, updatedAt: timestamp });
        }
        appendStockAudit(data, actor, "stock.movement.reverse", req.params.id, operationId, null, { movementIds: result.movements.map((item) => item.id) }, timestamp);
        return data;
      });
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp);
      publishNotifications(pendingNotifications);
      res.json({ ok: true, movements: result.movements, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, revision: stockRevision(saved), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  app.get("/api/workforce/stock", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const actor = personnelActor(req);
      const state = normalizeStockState(data.stockState);
      const locationId = stockService.actorLocationId(state, actor);
      const payload = locationPayload(data, locationId, actor);
      payload.transfers = stockService.serializeTransfers(state, { locationId, userId: actor.id });
      res.json(payload);
    } catch (error) { next(error); }
  });

  app.get("/api/workforce/stock/transfer-requests", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const actor = personnelActor(req);
      const state = normalizeStockState(data.stockState);
      const locationId = stockService.actorLocationId(state, actor);
      res.json({ ok: true, location: stockService.getLocation(state, locationId), transfers: stockService.serializeTransfers(state, { locationId, userId: actor.id }), revision: stockRevision(data), updatedAt: data.stockUpdatedAt || state.updatedAt || null });
    } catch (error) { next(error); }
  });

  app.post("/api/workforce/stock/transfer-requests", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const actor = personnelActor(req);
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const from = stockService.defaultGeneralLocation(state);
        const toLocationId = stockService.actorLocationId(state, actor);
        result = stockService.createTransferRequest(state, {
          productId: body.productId || body.stockProductId,
          productCode: body.productCode || body.stockProductCode,
          quantity: body.quantity,
          unit: body.unit,
          note: body.note,
          urgency: body.urgency,
          requestId: operationId,
          fromLocationId: from && from.id,
          toLocationId
        }, actor, { now: timestamp, fromLocationId: from && from.id, toLocationId });
        if (result.idempotent) return context.noChange;
        persistStockMutation(data, result.stockState, timestamp);
        queueNotification(data, pendingNotifications, {
          recipientRole: "manager",
          recipientId: "manager",
          category: "stock",
          eventType: "stock_transfer_requested",
          title: "Yeni depo transfer talebi",
          body: `${actor.name}, ${result.transfer.product && (result.transfer.product.name || result.transfer.product.productName) || "stok ürünü"} için transfer istedi.`,
          severity: result.transfer.urgency === "critical" ? "critical" : "warning",
          entityType: "stock_transfer",
          entityId: result.transfer.id,
          deepLink: `/yonetici/?section=stock&stockPanel=transfers&transferId=${encodeURIComponent(result.transfer.id)}`,
          dedupeKey: `stock-transfer-requested:${result.transfer.id}:manager`,
          metadata: { transferId: result.transfer.id, locationId: toLocationId, personId: actor.id }
        });
        appendStockAudit(data, actor, "stock.transfer.request", result.transfer.id, operationId, null, result.transfer, timestamp);
        return data;
      });
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp);
      publishNotifications(pendingNotifications);
      res.status(result.idempotent ? 200 : 201).json({ ok: true, transfer: result.transfer, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, revision: stockRevision(saved), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  return { stockRevision };
}

function normalizeLocationCode(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function uniqueLocationId(state, code) {
  const base = `stock-location-${String(code || "depo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  if (!(state.locations || []).some((item) => item.id === base)) return base;
  return `${base}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeIdList(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 1000);
}

function assignPersonnelToLocation(data, state, locationId, personnelIds, previousIds = []) {
  const assigned = new Set(personnelIds || []);
  const previousAssigned = new Set(previousIds || (state.locations || []).find((location) => String(location.id) === String(locationId))?.assignedPersonnelIds || []);
  for (const user of data.recipeUsers || []) {
    if (String(user.stockLocationId || "") === String(locationId)) previousAssigned.add(String(user.id));
  }
  const fallbackCafe = (state.locations || []).find((location) => location.code === "CAFE" || location.type === "cafe");
  for (const location of state.locations || []) {
    if (location.id === locationId) continue;
    location.assignedPersonnelIds = (location.assignedPersonnelIds || []).filter((id) => !assigned.has(String(id)));
  }
  for (const user of data.recipeUsers || []) {
    if (assigned.has(String(user.id))) user.stockLocationId = locationId;
    else if (previousAssigned.has(String(user.id)) && fallbackCafe) user.stockLocationId = fallbackCafe.id;
  }
}

function assertExpectedStockRevision(data, body) {
  if (!body || body.expectedRevision === undefined || body.expectedRevision === null || body.expectedRevision === "") return;
  const expected = Number(body.expectedRevision);
  const current = Math.max(0, Number(data.revisions && data.revisions.stock || 0));
  if (!Number.isInteger(expected) || expected < 0) throw Object.assign(new Error("Beklenen stok revision geçersiz."), { status: 400 });
  if (expected !== current) throw Object.assign(new Error("Stok verisi başka bir işlemle güncellendi. Yenileyip tekrar deneyin."), { status: 409 });
}

function appendStockAudit(data, actor, action, entityId, requestId, previous, next, timestamp) {
  data.recipeActivity = (Array.isArray(data.recipeActivity) ? data.recipeActivity : []).concat({
    id: `stock-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    type: action,
    action,
    actorId: String(actor && actor.id || "system"),
    actorRole: actor && actor.type === "admin" ? "admin" : "personel",
    userId: String(actor && actor.id || "system"),
    name: String(actor && actor.name || "Sistem"),
    entityType: action.includes("location") ? "stock_location" : action.includes("transfer") ? "stock_transfer" : "stock_movement",
    entityId: String(entityId || ""),
    requestId: String(requestId || ""),
    previousState: previous || null,
    nextState: next || null,
    createdAt: timestamp
  }).slice(-5000);
}

module.exports = { registerStockLocationRoutes };
