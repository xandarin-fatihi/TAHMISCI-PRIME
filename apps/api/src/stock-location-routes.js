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
    resolveProcurementActor,
    hasProcurementCapability,
    notificationService,
    queueStockThresholdNotifications
  } = deps;

  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const nowIso = () => new Date().toISOString();
  const registerAdminStockRoute = (method, suffix, ...handlers) => {
    // Legacy Yönetici yolu yalnız compatibility adapter'dır; iki yol da aynı
    // handler ve stok domain servisini kullanır.
    app[method](`/api/admin/stock${suffix}`, ...handlers);
    const businessHandler = handlers[handlers.length - 1];
    app[method](`/api/procurement/v1/stock${suffix}`,
      requireAdminOrMainRequestOrigin,
      auth.requireRecipe,
      attachProcurementActor,
      requireCanonicalCapability(stockCapability(method, suffix)),
      businessHandler);
  };

  async function attachProcurementActor(req, res, next) {
    try {
      const actor = typeof resolveProcurementActor === "function" ? await resolveProcurementActor(req) : null;
      if (!actor) return res.status(401).json({ ok: false, message: "Tahmisçi Fatura oturumu gerekli." });
      req.procurementActor = actor;
      return next();
    } catch (error) { return next(error); }
  }

  function requireCanonicalCapability(capability) {
    return (req, res, next) => {
      const allowed = typeof hasProcurementCapability === "function"
        ? hasProcurementCapability(req.procurementActor, capability)
        : req.procurementActor && req.procurementActor.type === "admin";
      return allowed ? next() : res.status(403).json({ ok: false, message: "Bu stok işlemi için yetkiniz yok.", capability });
    };
  }

  function stockCapability(method, suffix) {
    const verb = String(method || "get").toLowerCase();
    if (verb === "get") return "inventory.read";
    if (suffix.startsWith("/catalog") || suffix.startsWith("/unit-definitions")) return "inventory.catalog.manage";
    if (suffix.startsWith("/locations")) return "inventory.location.manage";
    if (suffix.startsWith("/counts")) return "inventory.count.manage";
    if (suffix.startsWith("/transfers") && (suffix.includes("/approve") || suffix.includes("/reject"))) return "inventory.transfer.approve";
    if (suffix.startsWith("/transfers")) return "inventory.transfer.create";
    if (suffix.startsWith("/movements") && suffix.includes("/reverse")) return "inventory.movement.reverse";
    if (suffix.startsWith("/movements")) return "inventory.movement.create";
    return "inventory.manage";
  }

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

  function routeOperation(state, type, operationId) {
    const key = type && operationId ? `${type}:${operationId}` : "";
    if (!key) return null;
    return (state.operationKeys || []).find((item) => item && item.key === key) || null;
  }

  function rememberRouteOperation(state, type, operationId, value, timestamp) {
    const key = type && operationId ? `${type}:${operationId}` : "";
    if (!key) return;
    state.operationKeys = (Array.isArray(state.operationKeys) ? state.operationKeys : [])
      .concat({ key, type, requestId: operationId, value: value || {}, createdAt: timestamp })
      .slice(-1000);
  }

  function adminActor(req) {
    const procurementActor = req.procurementActor;
    if (procurementActor && procurementActor.id) {
      return {
        type: procurementActor.type === "admin" ? "admin" : "personel",
        id: String(procurementActor.id),
        name: String(procurementActor.name || procurementActor.id),
        branchId: String(procurementActor.branchId || "main"),
        stockLocationId: String(procurementActor.stockLocationId || ""),
        inventoryManage: Boolean(typeof hasProcurementCapability === "function"
          && hasProcurementCapability(procurementActor, "inventory.manage")),
        inventoryTransfer: Boolean(typeof hasProcurementCapability === "function"
          && hasProcurementCapability(procurementActor, "inventory.transfer.create")),
        inventoryScope: procurementActor.type === "admin"
          || typeof hasProcurementCapability === "function" && hasProcurementCapability(procurementActor, "inventory.manage")
          ? "all"
          : "assigned"
      };
    }
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
    const revisions = data && data.revisions || {};
    return Math.max(0, Number(revisions.stock || 0));
  }

  function domainRevision(data, domain) {
    const revisions = data && data.revisions || {};
    return Math.max(0, Number(revisions[domain] || 0));
  }

  function canonicalRevisionPayload(data, primaryDomain = "inventory") {
    const inventoryRevision = domainRevision(data, "inventory");
    const catalogRevision = domainRevision(data, "catalog");
    return {
      revision: primaryDomain === "catalog" ? catalogRevision : inventoryRevision,
      inventoryRevision,
      catalogRevision,
      revisions: { inventory: inventoryRevision, catalog: catalogRevision, stock: stockRevision(data) }
    };
  }

  function persistStockMutation(data, stockState, timestamp, domains = "inventory") {
    data.stockState = normalizeStockState(stockState);
    data.stockUpdatedAt = timestamp;
    data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions)
      ? data.revisions
      : {};
    const keys = [...new Set((Array.isArray(domains) ? domains : [domains])
      .map((domain) => domain === "catalog" ? "catalog" : "inventory"))];
    for (const key of keys) data.revisions[key] = Math.max(0, Number(data.revisions[key] || 0)) + 1;
    data.revisions.stock = Math.max(
      Number(data.revisions.stock || 0) + 1,
      Number(data.revisions.inventory || 0),
      Number(data.revisions.catalog || 0)
    );
    return data.stockState;
  }

  function requireActorCapability(req, capability) {
    if (!req.procurementActor) return;
    if (typeof hasProcurementCapability === "function" && hasProcurementCapability(req.procurementActor, capability)) return;
    throw fail("Bu stok işlemi için yetkiniz yok.", 403);
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
    if (!actor || actor.type === "admin" || actor.inventoryManage === true || actor.inventoryScope === "all") return locations;
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
    return stockService.getLocations(stockState, { includeInactive: true }).map((location) => {
      const inventory = location.active === false
        ? { balances: [], summary: { totalProducts: 0, criticalProducts: 0, pendingTransfers: 0, lastUpdatedAt: location.updatedAt || null } }
        : stockService.getLocationInventory(stockState, location.id, { includeInactive: false });
      const sufficientProducts = inventory.balances.filter((balance) => balance.status === "Yeterli").length;
      const openSuggestions = inventory.balances.filter((balance) => balance.recommendation).length;
      const lastMovement = stockService.serializeMovements(stockState, { locationId: location.id })[0] || null;
      return {
        ...location,
        assignedPersonnelIds: assignments.get(String(location.id)) || [],
        inventorySummary: {
          ...inventory.summary,
          sufficientProducts,
          openSuggestions,
          stockedProducts: inventory.balances.filter((balance) => Number(balance.quantity || 0) > 0).length,
          lastMovementAt: lastMovement && lastMovement.createdAt || inventory.summary.lastUpdatedAt || null
        }
      };
    });
  }

  function locationPayload(data, locationId, actor) {
    const state = normalizeStockState(data.stockState);
    const inventory = stockService.getLocationInventory(state, locationId);
    return {
      ok: true,
      location: inventory.location,
      locations: publicLocations(state, actor),
      balances: actor && actor.type !== "admin"
        ? inventory.balances.map(personnelInventoryBalance)
        : inventory.balances,
      summary: inventory.summary,
      unitDefinitions: state.unitDefinitions,
      ...canonicalRevisionPayload(data, "inventory"),
      publishRevision: Number(data.revisions && data.revisions.publish || 0),
      updatedAt: data.stockUpdatedAt || state.updatedAt || null
    };
  }

  function normalizeCatalogUnit(value) {
    const unit = String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
    return unit && unit.length <= 30 && /^[\p{L}\p{N} _-]+$/u.test(unit) ? unit : "";
  }

  function catalogUnitKey(value) {
    return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/\s+/g, " ");
  }

  function unitCatalogUsage(state, kind, unit) {
    const key = catalogUnitKey(unit);
    return state.products.filter((product) => catalogUnitKey(kind === "base"
      ? product.baseUnit || product.unit
      : product.bulkUnit || product.caseUnit) === key);
  }

  function updateProductUnitReferences(state, kind, from, to, timestamp) {
    const fromKey = catalogUnitKey(from);
    for (const product of state.products) {
      if (kind === "base" && catalogUnitKey(product.baseUnit || product.unit) === fromKey) {
        product.baseUnit = to;
        product.unit = to;
        if (catalogUnitKey(product.defaultMovementUnit) === fromKey) product.defaultMovementUnit = to;
        product.updatedAt = timestamp;
      }
      if (kind === "bulk" && catalogUnitKey(product.bulkUnit || product.caseUnit) === fromKey) {
        product.bulkUnit = to;
        product.caseUnit = to;
        if (catalogUnitKey(product.defaultMovementUnit) === fromKey) product.defaultMovementUnit = to;
        product.updatedAt = timestamp;
      }
    }
  }

  function personnelInventoryBalance(balance) {
    const source = balance && typeof balance === "object" ? balance : {};
    const {
      generalQuantity: _generalQuantity,
      cafeQuantity: _cafeQuantity,
      otherLocationQuantity: _otherLocationQuantity,
      totalQuantity: _totalQuantity,
      totalQuantityDisplay: _totalQuantityDisplay,
      suggestedTransfer: _suggestedTransfer,
      product: sourceProduct,
      ...publicBalance
    } = source;
    const product = sourceProduct && typeof sourceProduct === "object" ? sourceProduct : {};
    const {
      stockQuantity: _stockQuantity,
      stockQuantityText: _stockQuantityText,
      totalQuantity: _productTotalQuantity,
      generalQuantity: _productGeneralQuantity,
      otherLocationQuantity: _productOtherLocationQuantity,
      suggestedTransfer: _productSuggestedTransfer,
      ...publicProduct
    } = product;
    const recommendation = source.recommendation && typeof source.recommendation === "object"
      ? { type: String(source.recommendation.type || "") }
      : null;
    return {
      ...publicBalance,
      product: {
        ...publicProduct,
        stockQuantity: Number(source.quantity || 0),
        stockQuantityText: source.quantityDisplay && source.quantityDisplay.display
          ? String(source.quantityDisplay.display)
          : `${Number(source.quantity || 0)} ${publicProduct.baseUnit || publicProduct.unit || "adet"}`
      },
      recommendation
    };
  }

  function catalogText(value, max = 180) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
  }

  function catalogIdentity(value) {
    return catalogText(value, 240).toLocaleLowerCase("tr-TR").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function validateCatalogProduct(state, body, current = null) {
    const name = catalogText(body.name || body.productName || current && (current.name || current.productName));
    const categoryId = catalogText(body.categoryId || current && current.categoryId);
    const category = state.categories.find((item) => String(item.id) === categoryId);
    if (!name) throw fail("Ürün adı zorunludur.", 422);
    if (!category) throw fail("Stok kategorisi bulunamadı.", 404);
    const productCode = catalogText(body.productCode !== undefined ? body.productCode : current && current.productCode, 80).toLocaleUpperCase("tr-TR");
    if (productCode && state.products.some((item) => item !== current
      && String(item.productCode || "").toLocaleUpperCase("tr-TR") === productCode)) {
      throw fail("Bu stok ürün kodu zaten kullanılıyor.", 409);
    }
    const baseUnit = normalizeCatalogUnit(body.baseUnit !== undefined ? body.baseUnit : current && (current.baseUnit || current.unit) || "adet");
    const bulkUnit = normalizeCatalogUnit(body.bulkUnit !== undefined ? body.bulkUnit : body.caseUnit !== undefined ? body.caseUnit : current && (current.bulkUnit || current.caseUnit) || "");
    const factorValue = body.unitsPerBulkUnit !== undefined ? body.unitsPerBulkUnit
      : body.unitsPerCase !== undefined ? body.unitsPerCase
        : current && (current.unitsPerBulkUnit ?? current.unitsPerCase) || 0;
    const factor = Math.round(Number(factorValue) * 1000) / 1000;
    if (!baseUnit) throw fail("Temel birim zorunludur.", 422);
    if (!Number.isFinite(factor) || factor < 0 || (bulkUnit && factor <= 0)) {
      throw fail("Toplu birim dönüşümü geçersiz.", 422);
    }
    const definitions = state.unitDefinitions || { base: [], bulk: [] };
    if (!(definitions.base || []).some((unit) => catalogUnitKey(unit) === catalogUnitKey(baseUnit))) {
      throw fail("Temel birim Birim Merkezi kataloğunda bulunmalıdır.", 422);
    }
    if (bulkUnit && !(definitions.bulk || []).some((unit) => catalogUnitKey(unit) === catalogUnitKey(bulkUnit))) {
      throw fail("Toplu birim Birim Merkezi kataloğunda bulunmalıdır.", 422);
    }
    return { name, category, categoryId, productCode, baseUnit, bulkUnit, factor };
  }

  registerAdminStockRoute("get", "/catalog", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({
        ok: true,
        stockState: state,
        unitDefinitions: state.unitDefinitions,
        ...canonicalRevisionPayload(data, "catalog"),
        updatedAt: data.stockUpdatedAt || state.updatedAt || null
      });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("get", "/unit-definitions", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({ ok: true, unitDefinitions: state.unitDefinitions, ...canonicalRevisionPayload(data, "catalog"), updatedAt: data.stockUpdatedAt || state.updatedAt || null });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/catalog/categories", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const name = catalogText(body.name, 120);
      if (!name) throw fail("Kategori adı zorunludur.", 422);
      let category;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const replay = routeOperation(state, "catalog_category_create", operationId);
        if (replay) {
          category = state.categories.find((item) => String(item.id) === String(replay.value && replay.value.categoryId));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "catalog", "catalog_category_create", operationId);
        if (state.categories.some((item) => catalogIdentity(item.name) === catalogIdentity(name))) {
          throw fail("Bu stok kategorisi zaten var.", 409);
        }
        category = {
          id: `stock-category-${crypto.randomUUID()}`,
          name,
          active: body.active !== false,
          order: state.categories.length,
          sourceType: "manual",
          statusSource: "manual",
          sourcePresent: true,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        state.categories.push(category);
        rememberRouteOperation(state, "catalog_category_create", operationId, { categoryId: category.id }, timestamp);
        persistStockMutation(data, state, timestamp, "catalog");
        appendStockAudit(data, adminActor(req), "stock.catalog.category.create", category.id, operationId, null, category, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "catalog"), "catalog");
      res.status(idempotent ? 200 : 201).json({ ok: true, category, entityId: category && category.id, idempotent, ...canonicalRevisionPayload(saved, "catalog"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("patch", "/catalog/categories/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let category;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const replay = routeOperation(state, "catalog_category_update", operationId);
        if (replay) {
          category = state.categories.find((item) => String(item.id) === String(req.params.id));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "catalog", "catalog_category_update", operationId);
        category = state.categories.find((item) => String(item.id) === String(req.params.id));
        if (!category) throw fail("Stok kategorisi bulunamadı.", 404);
        const previous = { ...category };
        const name = body.name === undefined ? category.name : catalogText(body.name, 120);
        if (!name) throw fail("Kategori adı zorunludur.", 422);
        if (state.categories.some((item) => item !== category && catalogIdentity(item.name) === catalogIdentity(name))) {
          throw fail("Bu stok kategorisi zaten var.", 409);
        }
        category.name = name;
        if (body.active !== undefined) category.active = body.active !== false;
        category.statusSource = "manual";
        category.sourceType = category.sourceType || "manual";
        category.updatedAt = timestamp;
        for (const product of state.products.filter((item) => String(item.categoryId) === String(category.id))) {
          product.category = name;
          product.updatedAt = timestamp;
        }
        rememberRouteOperation(state, "catalog_category_update", operationId, { categoryId: category.id }, timestamp);
        persistStockMutation(data, state, timestamp, "catalog");
        appendStockAudit(data, adminActor(req), "stock.catalog.category.update", category.id, operationId, previous, category, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "catalog"), "catalog");
      res.json({ ok: true, category, entityId: category && category.id, idempotent, ...canonicalRevisionPayload(saved, "catalog"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/catalog/products", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let product;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const replay = routeOperation(state, "catalog_product_create", operationId);
        if (replay) {
          product = state.products.find((item) => String(item.id) === String(replay.value && replay.value.productId));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "catalog", "catalog_product_create", operationId);
        const values = validateCatalogProduct(state, body);
        if (state.products.some((item) => String(item.categoryId) === values.categoryId
          && catalogIdentity(item.name || item.productName) === catalogIdentity(values.name))) {
          throw fail("Bu stok ürünü kategoride zaten var.", 409);
        }
        const supplier = catalogText(body.supplier !== undefined ? body.supplier : body.brand, 160);
        product = {
          id: `stock-product-${crypto.randomUUID()}`,
          name: values.name,
          productName: values.name,
          categoryId: values.categoryId,
          category: values.category.name,
          productCode: values.productCode,
          baseUnit: values.baseUnit,
          unit: values.baseUnit,
          bulkUnit: values.bulkUnit,
          caseUnit: values.bulkUnit,
          unitsPerBulkUnit: values.factor,
          unitsPerCase: values.factor,
          defaultMovementUnit: normalizeCatalogUnit(body.defaultMovementUnit) || values.baseUnit,
          allowDecimal: body.allowDecimal === undefined
            ? ["kg", "gr", "litre", "ml"].includes(values.baseUnit)
            : body.allowDecimal === true,
          supplier,
          brand: supplier,
          note: catalogText(body.note, 500),
          imageUrl: catalogText(body.imageUrl !== undefined ? body.imageUrl : body.image, 2048),
          active: body.active !== false,
          sourceType: "manual",
          statusSource: "manual",
          sourcePresent: true,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        state.products.push(product);
        const normalized = normalizeStockState(state);
        product = normalized.products.find((item) => String(item.id) === String(product.id));
        rememberRouteOperation(normalized, "catalog_product_create", operationId, { productId: product.id }, timestamp);
        persistStockMutation(data, normalized, timestamp, "catalog");
        appendStockAudit(data, adminActor(req), "stock.catalog.product.create", product.id, operationId, null, product, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "catalog"), "catalog");
      res.status(idempotent ? 200 : 201).json({ ok: true, product, entityId: product && product.id, idempotent, ...canonicalRevisionPayload(saved, "catalog"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("patch", "/catalog/products/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let product;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const replay = routeOperation(state, "catalog_product_update", operationId);
        if (replay) {
          product = state.products.find((item) => String(item.id) === String(req.params.id));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "catalog", "catalog_product_update", operationId);
        product = state.products.find((item) => String(item.id) === String(req.params.id));
        if (!product) throw fail("Stok ürünü bulunamadı.", 404);
        const previous = { ...product };
        const values = validateCatalogProduct(state, body, product);
        const baseChanged = catalogUnitKey(values.baseUnit) !== catalogUnitKey(product.baseUnit || product.unit);
        if (baseChanged && (state.movements.some((item) => String(item.productId) === String(product.id))
          || state.balances.some((item) => String(item.productId) === String(product.id) && Number(item.quantity || 0) !== 0))) {
          throw fail("Hareket geçmişi veya bakiye bulunan ürünün temel birimi değiştirilemez.", 409);
        }
        product.name = values.name;
        product.productName = values.name;
        product.categoryId = values.categoryId;
        product.category = values.category.name;
        product.productCode = values.productCode;
        product.baseUnit = values.baseUnit;
        product.unit = values.baseUnit;
        product.bulkUnit = values.bulkUnit;
        product.caseUnit = values.bulkUnit;
        product.unitsPerBulkUnit = values.factor;
        product.unitsPerCase = values.factor;
        if (body.supplier !== undefined || body.brand !== undefined) {
          const supplier = catalogText(body.supplier !== undefined ? body.supplier : body.brand, 160);
          product.supplier = supplier;
          product.brand = supplier;
        }
        if (body.note !== undefined) product.note = catalogText(body.note, 500);
        if (body.imageUrl !== undefined || body.image !== undefined) {
          product.imageUrl = catalogText(body.imageUrl !== undefined ? body.imageUrl : body.image, 2048);
        }
        if (body.allowDecimal !== undefined) product.allowDecimal = body.allowDecimal === true;
        product.active = body.active === undefined ? product.active !== false : body.active !== false;
        product.statusSource = "manual";
        product.updatedAt = timestamp;
        product.defaultMovementUnit = normalizeCatalogUnit(
          body.defaultMovementUnit !== undefined ? body.defaultMovementUnit : product.defaultMovementUnit
        ) || values.baseUnit;
        if (!stockService.allowedProductUnits(product).includes(product.defaultMovementUnit)) product.defaultMovementUnit = values.baseUnit;
        rememberRouteOperation(state, "catalog_product_update", operationId, { productId: product.id }, timestamp);
        persistStockMutation(data, state, timestamp, "catalog");
        appendStockAudit(data, adminActor(req), "stock.catalog.product.update", product.id, operationId, previous, product, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "catalog"), "catalog");
      res.json({ ok: true, product, entityId: product && product.id, idempotent, ...canonicalRevisionPayload(saved, "catalog"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("get", "/locations", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({
        ok: true,
        locations: locationsForAdmin(data, state),
        personnel: personnelForLocations(data),
        unitDefinitions: state.unitDefinitions,
        ...canonicalRevisionPayload(data, "inventory"),
        updatedAt: data.stockUpdatedAt || state.updatedAt || null
      });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/unit-definitions", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const action = String(body.action || "add").trim();
      const kind = String(body.kind || "").trim();
      if (!new Set(["add", "rename", "remove"]).has(action)) throw fail("Birim kataloğu işlemi geçersiz.", 422);
      if (!new Set(["base", "bulk"]).has(kind)) throw fail("Birim türü temel veya toplu olmalıdır.", 422);
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const operationSignature = JSON.stringify({ action, kind, values: body.values || body.value || "", from: body.from || "", to: body.to || "" });
      let unitDefinitions;
      let usage = [];
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const replay = routeOperation(state, `unit_catalog_${action}`, operationId);
        if (replay) {
          if (replay.value && replay.value.signature && replay.value.signature !== operationSignature) {
            throw fail("Bu requestId başka bir birim kataloğu işlemi için kullanıldı.", 409);
          }
          unitDefinitions = state.unitDefinitions;
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "catalog", `unit_catalog_${action}`, operationId);
        const definitions = state.unitDefinitions && typeof state.unitDefinitions === "object"
          ? state.unitDefinitions
          : { base: [], bulk: [] };
        const current = Array.isArray(definitions[kind]) ? definitions[kind].slice() : [];
        if (action === "add") {
          const rawValues = Array.isArray(body.values) ? body.values : String(body.values || body.value || "").split(",");
          const values = rawValues.map(normalizeCatalogUnit).filter(Boolean);
          if (!values.length) throw fail("En az bir geçerli birim girin.", 422);
          for (const value of values) {
            if (!current.some((item) => catalogUnitKey(item) === catalogUnitKey(value))) current.push(value);
          }
        } else {
          const from = normalizeCatalogUnit(body.from || body.value);
          if (!from || !current.some((item) => catalogUnitKey(item) === catalogUnitKey(from))) throw fail("Düzenlenecek birim bulunamadı.", 404);
          if (action === "rename") {
            const to = normalizeCatalogUnit(body.to);
            if (!to) throw fail("Yeni birim adı geçersiz.", 422);
            const next = current.filter((item) => catalogUnitKey(item) !== catalogUnitKey(from));
            if (!next.some((item) => catalogUnitKey(item) === catalogUnitKey(to))) next.push(to);
            definitions[kind] = next;
            updateProductUnitReferences(state, kind, from, to, timestamp);
          } else {
            usage = unitCatalogUsage(state, kind, from);
            if (usage.length) {
              const names = usage.slice(0, 8).map((product) => String(product.name || product.productName || product.id)).join(", ");
              throw fail(`“${from}” birimi ${usage.length} üründe kullanılıyor: ${names}. Önce ürün birimlerini değiştirin.`, 409);
            }
            definitions[kind] = current.filter((item) => catalogUnitKey(item) !== catalogUnitKey(from));
          }
        }
        if (action === "add") definitions[kind] = current;
        definitions.updatedAt = timestamp;
        definitions.updatedBy = adminActor(req).id;
        state.unitDefinitions = definitions;
        rememberRouteOperation(state, `unit_catalog_${action}`, operationId, { action, kind, signature: operationSignature }, timestamp);
        unitDefinitions = persistStockMutation(data, state, timestamp, "catalog").unitDefinitions;
        appendStockAudit(data, adminActor(req), `stock.unit_catalog.${action}`, kind, operationId, null, { unitDefinitions }, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "catalog"), "catalog");
      res.json({ ok: true, unitDefinitions: unitDefinitions || normalizeStockState(saved.stockState).unitDefinitions, usage, idempotent, ...canonicalRevisionPayload(saved, "catalog"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/locations", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
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
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let location;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const state = normalizeStockState(data.stockState);
        const replay = routeOperation(state, "location_create", operationId);
        if (replay) {
          location = state.locations.find((item) => String(item.id) === String(replay.value && replay.value.locationId));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "inventory", "location_create", operationId);
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
        rememberRouteOperation(state, "location_create", operationId, { locationId: location.id }, timestamp);
        persistStockMutation(data, normalizeStockState(state), timestamp);
        appendStockAudit(data, adminActor(req), "stock.location.create", location.id, operationId, null, location, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      const stockState = normalizeStockState(saved.stockState);
      res.status(idempotent ? 200 : 201).json({ ok: true, location, locations: locationsForAdmin(saved, stockState), personnel: personnelForLocations(saved), stockState, idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("patch", "/locations/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let location;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const replayState = normalizeStockState(data.stockState);
        const replay = routeOperation(replayState, "location_update", operationId);
        if (replay) {
          if (String(replay.value && replay.value.locationId || "") !== String(req.params.id)) {
            throw fail("Bu requestId başka bir depo güncellemesi için kullanıldı.", 409);
          }
          location = replayState.locations.find((item) => String(item.id) === String(replay.value && replay.value.locationId));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "inventory", "location_update", operationId);
        const state = replayState;
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
        rememberRouteOperation(state, "location_update", operationId, { locationId: location.id }, timestamp);
        persistStockMutation(data, normalizeStockState(state), timestamp);
        appendStockAudit(data, adminActor(req), "stock.location.update", location.id, operationId, previous, location, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      const stockState = normalizeStockState(saved.stockState);
      location = stockState.locations.find((item) => item.id === location.id);
      res.json({ ok: true, location, locations: locationsForAdmin(saved, stockState), personnel: personnelForLocations(saved), stockState, idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("delete", "/locations/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      let location;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const replayState = normalizeStockState(data.stockState);
        const replay = routeOperation(replayState, "location_deactivate", operationId);
        if (replay) {
          if (String(replay.value && replay.value.locationId || "") !== String(req.params.id)) {
            throw fail("Bu requestId başka bir depo işlemi için kullanıldı.", 409);
          }
          location = replayState.locations.find((item) => String(item.id) === String(replay.value && replay.value.locationId));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "inventory", "location_deactivate", operationId);
        const state = replayState;
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
        rememberRouteOperation(state, "location_deactivate", operationId, { locationId: location.id }, timestamp);
        persistStockMutation(data, state, timestamp);
        appendStockAudit(data, adminActor(req), "stock.location.deactivate", location.id, operationId, previous, location, timestamp);
        return data;
      });
      if (!idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      const state = normalizeStockState(saved.stockState);
      res.json({ ok: true, location: state.locations.find((item) => item.id === location.id), locations: locationsForAdmin(saved, state), idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("get", "/inventory", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      const locationId = String(req.query.locationId || stockService.defaultGeneralLocation(state).id);
      res.json(locationPayload(data, locationId, adminActor(req)));
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("patch", "/inventory/:productId", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const updatesCatalog = ["baseUnit", "bulkUnit", "unitsPerBulkUnit", "unitsPerCase", "allowDecimal", "defaultMovementUnit"]
        .some((field) => Object.prototype.hasOwnProperty.call(body, field));
      if (updatesCatalog) requireActorCapability(req, "inventory.catalog.manage");
      const operationId = requestId(req, true);
      const locationId = String(body.locationId || "").trim();
      if (!locationId) throw fail("Depo seçimi zorunludur.");
      const timestamp = nowIso();
      let balance;
      let idempotent = false;
      const saved = await store.update((data, context) => {
        const replayState = normalizeStockState(data.stockState);
        const replay = routeOperation(replayState, "inventory_threshold_update", operationId);
        if (replay) {
          if (String(replay.value && replay.value.locationId || "") !== String(locationId)
            || String(replay.value && replay.value.productId || "") !== String(req.params.productId)) {
            throw fail("Bu requestId başka bir ürün-depo ayarı için kullanıldı.", 409);
          }
          balance = replayState.balances.find((item) => String(item.locationId) === String(locationId)
            && String(item.productId) === String(req.params.productId));
          idempotent = true;
          return context.noChange;
        }
        assertExpectedDomainRevision(data, body, "inventory", "inventory_threshold_update", operationId);
        if (updatesCatalog) assertExpectedDomainRevision(data, body, "catalog", "inventory_threshold_update", operationId);
        const state = replayState;
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
        if (Number(balance.criticalThreshold || 0) > Number(balance.orderThreshold || 0)) {
          throw fail("Kritik eşik sipariş eşiğinden büyük olamaz.");
        }
        const currentBaseUnit = normalizeCatalogUnit(product.baseUnit || product.unit || "adet");
        const nextBaseUnit = body.baseUnit === undefined ? currentBaseUnit : normalizeCatalogUnit(body.baseUnit);
        if (!nextBaseUnit) throw fail("Temel birim boş olamaz.");
        const baseUnitChanged = catalogUnitKey(nextBaseUnit) !== catalogUnitKey(currentBaseUnit);
        const baseCatalog = state.unitDefinitions && Array.isArray(state.unitDefinitions.base) ? state.unitDefinitions.base : [];
        const bulkCatalog = state.unitDefinitions && Array.isArray(state.unitDefinitions.bulk) ? state.unitDefinitions.bulk : [];
        if (!baseCatalog.some((unit) => catalogUnitKey(unit) === catalogUnitKey(nextBaseUnit))) {
          throw fail("Temel birim merkezi Temel Birimler kataloğunda bulunmalıdır.", 422);
        }
        const hasHistory = state.movements.some((movement) => String(movement.productId) === String(product.id));
        const hasBalance = state.balances.some((candidate) => String(candidate.productId) === String(product.id) && Number(candidate.quantity || 0) !== 0);
        if (baseUnitChanged && (hasHistory || hasBalance)) {
          throw fail("Hareket geçmişi veya bakiye bulunan ürünün temel birimi değiştirilemez. Toplu birim dönüşümünü düzenleyebilirsiniz.", 409);
        }
        if (body.baseUnit !== undefined) {
          product.baseUnit = nextBaseUnit;
          product.unit = nextBaseUnit;
        }
        if (body.bulkUnit !== undefined) {
          product.bulkUnit = normalizeCatalogUnit(body.bulkUnit);
          if (product.bulkUnit && !bulkCatalog.some((unit) => catalogUnitKey(unit) === catalogUnitKey(product.bulkUnit))) {
            throw fail("Toplu birim merkezi Toplu Birimler kataloğunda bulunmalıdır.", 422);
          }
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
        balance.revision = Math.max(0, Number(balance.revision || 0)) + 1;
        product.updatedAt = timestamp;
        rememberRouteOperation(state, "inventory_threshold_update", operationId, { locationId: location.id, productId: product.id }, timestamp);
        persistStockMutation(data, state, timestamp, updatesCatalog ? ["inventory", "catalog"] : "inventory");
        appendStockAudit(data, adminActor(req), "stock.inventory.settings", `${location.id}:${product.id}`, operationId, previous, { balance, product }, timestamp);
        return data;
      });
      if (!idempotent) {
        broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
        if (updatesCatalog) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "catalog"), "catalog");
      }
      const payload = locationPayload(saved, locationId, adminActor(req));
      res.json({ ...payload, balance: payload.balances.find((item) => item.productId === req.params.productId) || balance, idempotent });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("get", "/counts", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({ ok: true, counts: stockService.serializeCounts(state, req.query || {}), locations: stockService.getLocations(state, { includeInactive: true }), ...canonicalRevisionPayload(data, "inventory"), updatedAt: data.stockUpdatedAt || state.updatedAt || null });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/counts", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("start"));
  registerAdminStockRoute("patch", "/counts/:id", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("update"));
  registerAdminStockRoute("post", "/counts/:id/approve", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("approve"));
  registerAdminStockRoute("post", "/counts/:id/cancel", requireAdminRequestOrigin, auth.requireAdmin, countMutationHandler("cancel"));

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
          assertExpectedDomainRevision(data, body, "inventory", `count_${action}`, operationId);
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
        if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
        publishNotifications(pendingNotifications);
        res.status(action === "start" && !result.idempotent ? 201 : 200).json({ ok: true, count: result.count, movements: result.movements || [], idempotent: result.idempotent, stockState: normalizeStockState(saved.stockState), ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
      } catch (error) { next(error); }
    };
  }

  registerAdminStockRoute("get", "/movements", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      res.json({
        ok: true,
        movements: stockService.serializeMovements(state, req.query || {}),
        locations: stockService.getLocations(state, { includeInactive: true }),
        ...canonicalRevisionPayload(data, "inventory"),
        updatedAt: data.stockUpdatedAt || state.updatedAt || null
      });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/movements", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body && (req.body.movement || req.body) || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        assertExpectedDomainRevision(data, body, "inventory", "movement", operationId);
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
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      publishNotifications(pendingNotifications);
      const inventory = stockService.getLocationInventory(saved.stockState, String(body.locationId || result.movement && result.movement.locationId || ""));
      res.status(result.idempotent ? 200 : 201).json({ ok: true, movement: result.movement, stockState: normalizeStockState(saved.stockState), inventory: { location: inventory.location, balances: inventory.balances, summary: inventory.summary }, idempotent: result.idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("get", "/transfers", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const state = normalizeStockState(data.stockState);
      const status = String(req.query.status || "").trim();
      let transfers = stockService.serializeTransfers(state, req.query || {});
      if (status) transfers = transfers.filter((transfer) => transfer.status === status);
      res.json({ ok: true, transfers, locations: stockService.getLocations(state, { includeInactive: true }), ...canonicalRevisionPayload(data, "inventory"), updatedAt: data.stockUpdatedAt || state.updatedAt || null });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/transfers", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (body.approveNow === true || body.directApply === true) requireActorCapability(req, "inventory.transfer.approve");
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const actor = adminActor(req);
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        assertExpectedDomainRevision(data, body, "inventory", "transfer_create", operationId);
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
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      publishNotifications(pendingNotifications);
      res.status(result.idempotent ? 200 : 201).json({ ok: true, transfer: result.transfer, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  registerAdminStockRoute("post", "/transfers/:id/approve", requireAdminRequestOrigin, auth.requireAdmin, transferDecisionHandler("approve"));
  registerAdminStockRoute("post", "/transfers/:id/reject", requireAdminRequestOrigin, auth.requireAdmin, transferDecisionHandler("reject"));
  registerAdminStockRoute("post", "/transfers/:id/cancel", requireAdminRequestOrigin, auth.requireAdmin, transferDecisionHandler("cancel"));

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
          assertExpectedDomainRevision(data, body, "inventory", `transfer_${decision}`, operationId);
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
        if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
        publishNotifications(pendingNotifications);
        res.json({ ok: true, transfer: result.transfer, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
      } catch (error) { next(error); }
    };
  }

  registerAdminStockRoute("post", "/movements/:id/reverse", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const actor = adminActor(req);
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        assertExpectedDomainRevision(data, body, "inventory", "movement_reverse", operationId);
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
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      publishNotifications(pendingNotifications);
      res.json({ ok: true, movements: result.movements, stockState: normalizeStockState(saved.stockState), idempotent: result.idempotent, ...canonicalRevisionPayload(saved, "inventory"), updatedAt: saved.stockUpdatedAt || timestamp });
    } catch (error) { next(error); }
  });

  app.get("/api/workforce/stock", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const actor = personnelActor(req);
      const state = normalizeStockState(data.stockState);
      const locationId = stockService.actorLocationId(state, actor);
      const payload = locationPayload(data, locationId, actor);
      res.json(payload);
    } catch (error) { next(error); }
  });

  app.get("/api/workforce/stock/movements", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      const data = req.storeSnapshot || await store.read();
      const actor = personnelActor(req);
      const state = normalizeStockState(data.stockState);
      const locationId = stockService.actorLocationId(state, actor);
      const requestedLocationId = String(req.query.locationId || "").trim();
      if (requestedLocationId && requestedLocationId !== locationId) {
        throw fail("Bu stok lokasyonunun hareket geçmişini görme yetkiniz yok.", 403);
      }
      const productId = String(req.query.productId || "").trim();
      if (productId && !(state.products || []).some((product) => String(product.id) === productId)) {
        throw fail("Stok ürünü bulunamadı.", 404);
      }
      const requestedLimit = Number(req.query.limit || 50);
      const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;
      const movements = stockService.serializeMovements(state, { locationId, productId })
        .filter((movement) => String(movement.actorId || movement.personnelId || "") === String(actor.id || ""))
        .slice(0, limit);
      res.json({
        ok: true,
        location: stockService.getLocation(state, locationId),
        movements,
        ...canonicalRevisionPayload(data, "inventory"),
        updatedAt: data.stockUpdatedAt || state.updatedAt || null
      });
    } catch (error) { next(error); }
  });

  app.post("/api/workforce/stock/movements/:id/reverse", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      const body = req.body || {};
      const operationId = requestId(req, true);
      const timestamp = nowIso();
      const actor = personnelActor(req);
      const pendingNotifications = [];
      let result;
      let locationId;
      const saved = await store.update((data, context) => {
        assertExpectedDomainRevision(data, body, "inventory", "movement_reverse", operationId);
        const previousStockState = normalizeStockState(data.stockState);
        locationId = stockService.actorLocationId(previousStockState, actor);
        result = stockService.reverseMovement(previousStockState, req.params.id, { ...body, requestId: operationId }, actor, { now: timestamp });
        if (result.idempotent) return context.noChange;
        persistStockMutation(data, result.stockState, timestamp);
        if (typeof queueStockThresholdNotifications === "function") {
          queueStockThresholdNotifications(data, pendingNotifications, previousStockState, result.stockState, { operationId, updatedAt: timestamp });
        }
        appendStockAudit(data, actor, "stock.movement.reverse", req.params.id, operationId, null, { movementIds: result.movements.map((item) => item.id) }, timestamp);
        return data;
      });
      if (!result.idempotent) broadcastStockUpdate(saved.stockState, timestamp, domainRevision(saved, "inventory"), "inventory");
      publishNotifications(pendingNotifications);
      const inventory = stockService.getLocationInventory(saved.stockState, locationId);
      res.json({
        ok: true,
        movements: result.movements,
        inventory: {
          location: inventory.location,
          balances: inventory.balances.map(personnelInventoryBalance),
          summary: inventory.summary
        },
        idempotent: result.idempotent,
        ...canonicalRevisionPayload(saved, "inventory"),
        updatedAt: saved.stockUpdatedAt || timestamp
      });
    } catch (error) { next(error); }
  });

  app.get("/api/workforce/stock/transfer-requests", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      res.status(403).json({
        ok: false,
        message: "Depolar arası transfer bilgileri Yönetici yetkisi gerektirir."
      });
    } catch (error) { next(error); }
  });

  app.post("/api/workforce/stock/transfer-requests", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
    try {
      res.status(403).json({
        ok: false,
        message: "Depolar arası transfer işlemi Yönetici yetkisi gerektirir."
      });
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

function assertExpectedDomainRevision(data, body, domain, operationType = "", operationId = "") {
  const operationKey = operationType && operationId ? `${operationType}:${operationId}` : "";
  const operationKeys = data && data.stockState && Array.isArray(data.stockState.operationKeys)
    ? data.stockState.operationKeys
    : [];
  if (operationKey && operationKeys.some((item) => item && item.key === operationKey)) return;
  const field = domain === "catalog" ? "expectedCatalogRevision" : "expectedInventoryRevision";
  const rawExpected = body && body[field] !== undefined ? body[field] : body && body.expectedRevision;
  if (rawExpected === undefined || rawExpected === null || rawExpected === "") {
    throw Object.assign(new Error(`Beklenen ${domain} revision zorunludur.`), { status: 400 });
  }
  const expected = Number(rawExpected);
  const current = Math.max(0, Number(data.revisions && data.revisions[domain] || 0));
  if (!Number.isInteger(expected) || expected < 0) throw Object.assign(new Error(`Beklenen ${domain} revision geçersiz.`), { status: 400 });
  if (expected !== current) throw Object.assign(new Error(`${domain === "catalog" ? "Stok kataloğu" : "Envanter"} başka bir işlemle güncellendi. Güncel veriler yükleniyor; tekrar deneyin.`), { status: 409 });
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
    entityType: action.includes("unit_catalog") ? "stock_unit_definition" : action.includes("location") ? "stock_location" : action.includes("transfer") ? "stock_transfer" : "stock_movement",
    entityId: String(entityId || ""),
    requestId: String(requestId || ""),
    previousState: previous || null,
    nextState: next || null,
    createdAt: timestamp
  }).slice(-5000);
}

module.exports = { registerStockLocationRoutes };
