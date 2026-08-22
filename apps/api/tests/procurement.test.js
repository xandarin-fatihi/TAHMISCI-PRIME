"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createProcurementDocumentService } = require("../src/procurement-documents");
const { createProcurementService, safeDocumentMetadata } = require("../src/procurement-service");
const { registerProcurementRoutes } = require("../src/procurement-routes");
const { createProcurementPaymentReminders } = require("../src/notification-scheduler");
const notificationService = require("../src/notification-service");
const { normalizeStore } = require("../src/store/file-store");
const { migrateStore, STORE_SCHEMA_VERSION } = require("../src/store/migrations");

const ADMIN = Object.freeze({
  type: "admin",
  id: "admin",
  name: "Yönetici",
  role: "yönetici",
  branchId: "main",
  capabilities: []
});
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("procurement migration geriye uyumlu ve tekrar çalıştırıldığında idempotenttir", () => {
  const legacy = {
    schemaVersion: 16,
    stockState: {
      products: [{ id: "stock-1", productCode: "KHV-1", name: "Kahve", unit: "kg", stockQuantity: 4, active: true }],
      movements: [{ id: "move-1", shipmentId: "shipment-1", transactionRef: "stock-ref-1", type: "inbound_shipment" }]
    },
    recipeUsers: [{ id: "person-1", username: "barista", name: "Barista", active: true }],
    workforceShipments: [{
      id: "shipment-1",
      status: "approved",
      stockAppliedAt: "2026-08-01T10:00:00.000Z",
      stockMovementRef: "stock-ref-1",
      items: [{ productId: "stock-1", quantity: 2, unit: "kg" }]
    }]
  };

  const first = migrateStore(legacy);
  const second = migrateStore(first);

  assert.equal(first.schemaVersion, STORE_SCHEMA_VERSION);
  assert.equal(first.procurement.version, 1);
  assert.equal(first.procurement.revision, 0);
  assert.deepEqual(Object.keys(first.procurement).sort(), [
    "auditEvents", "documents", "idempotencyRecords", "ledgerEntries", "payments", "revision", "settings",
    "supplierProductLinks", "suppliers", "version"
  ]);
  assert.equal(first.workforceShipments.length, 1);
  assert.equal(first.workforceShipments[0].stockAppliedAt, "2026-08-01T10:00:00.000Z");
  assert.equal(first.workforceShipments[0].stockMovementRef, "stock-ref-1");
  assert.equal(first.workforceShipments[0].accountingStatus, "not_posted");
  assert.equal(first.workforceShipments[0].branchId, "main");
  assert.deepEqual(first.recipeUsers[0].faturaCapabilities, [
    "supplier.read", "receipt.create", "receipt.submit", "documents.read", "documents.upload"
  ]);
  assert.equal(first.recipeUsers[0].faturaAccessEnabled, true);
  assert.equal(first.recipeUsers[0].faturaTemplate, "ozel");
  assert.deepEqual(second.procurement, first.procurement);
  assert.equal(second.workforceShipments.length, 1);
});

test("mal kabul, belge, muhasebe ve ödeme etkileri birbirinden ayrıdır", async () => {
  const store = createMemoryStore();
  const service = createService(store);
  const stockBefore = (await store.read()).stockState.products[0].stockQuantity;

  const supplierResult = await service.createSupplier(ADMIN, {
    code: "TED-001",
    name: "Deneme Tedarikçi",
    paymentTermDays: 15
  }, mutation("supplier-create", 0));
  const supplierId = supplierResult.supplier.id;

  const shipmentResult = await service.createShipment(ADMIN, {
    supplierId,
    documentType: "fatura",
    items: [{ stockProductId: "stock-1", quantity: 2, unit: "kg", unitPriceKurus: 1250 }]
  }, mutation("shipment-create", 1));
  const shipmentId = shipmentResult.shipment.id;
  assert.equal(shipmentResult.shipment.status, "taslak");
  assert.equal((await store.read()).stockState.products[0].stockQuantity, stockBefore);

  await service.submitShipment(ADMIN, shipmentId, {}, mutation("shipment-submit", 2));
  assert.equal((await store.read()).stockState.products[0].stockQuantity, stockBefore);

  const documentResult = await service.recordDocument(ADMIN, {
    supplierId,
    shipmentIds: [shipmentId],
    documentType: "fatura",
    documentDate: "2026-08-22"
  }, {
    physicalName: "random-private.webp",
    thumbnailPhysicalName: "random-private.thumb.webp",
    originalName: "fatura.webp",
    mimeType: "image/webp",
    sizeBytes: 2048,
    sha256: "a".repeat(64)
  }, mutation("document-upload", 3));
  assert.equal(documentResult.document.physicalName, undefined);
  assert.equal((await store.read()).procurement.ledgerEntries.length, 0);
  assert.equal((await store.read()).stockState.products[0].stockQuantity, stockBefore);

  const accountResult = await service.accountShipment(ADMIN, shipmentId, {
    documentId: documentResult.document.id,
    amountKurus: 2500
  }, mutation("shipment-account", 4));
  assert.equal(accountResult.ledgerEntry.amountKurus, -2500);
  assert.equal((await store.read()).stockState.products[0].stockQuantity, stockBefore);

  const replay = await service.accountShipment(ADMIN, shipmentId, {
    amountKurus: 9999
  }, mutation("shipment-account", 4));
  assert.equal(replay.idempotent, true);
  assert.equal((await store.read()).procurement.ledgerEntries.length, 1);
  await assert.rejects(
    service.accountShipment(ADMIN, shipmentId, { amountKurus: 2500 }, mutation("shipment-account-new", 5)),
    (error) => error.status === 409 && error.code === "SHIPMENT_ALREADY_ACCOUNTED"
  );

  const paymentResult = await service.createPayment(ADMIN, {
    supplierId,
    amountKurus: 1000,
    paymentDate: "2026-08-22"
  }, mutation("payment-create", 5));
  assert.equal(paymentResult.ledgerEntry.amountKurus, 1000);
  assert.equal((await store.read()).stockState.products[0].stockQuantity, stockBefore);

  const reversePayment = await service.reversePayment(ADMIN, paymentResult.payment.id, {
    reason: "Yanlış banka hesabı"
  }, mutation("payment-reverse", 6));
  assert.equal(reversePayment.ledgerEntry.amountKurus, -1000);

  const reverseAccounting = await service.reverseShipmentAccounting(ADMIN, shipmentId, {
    reason: "Fatura iptal edildi"
  }, mutation("account-reverse", 7));
  assert.equal(reverseAccounting.ledgerEntry.amountKurus, 2500);
  const independentExpense = await service.createLedgerEntry(ADMIN, {
    supplierId,
    type: "adjustment",
    amountKurus: -500,
    note: "Stok dışı masraf"
  }, mutation("ledger-create", 8));
  assert.equal(independentExpense.ledgerEntry.shipmentId, "");
  const independentReversal = await service.reverseLedgerEntry(ADMIN, independentExpense.ledgerEntry.id, {
    reason: "Masraf kaydı düzeltildi"
  }, mutation("ledger-reverse", 9));
  assert.equal(independentReversal.ledgerEntry.amountKurus, 500);
  const snapshot = await store.read();
  assert.equal(snapshot.procurement.ledgerEntries.length, 6);
  assert.equal(snapshot.procurement.ledgerEntries.reduce((sum, entry) => sum + entry.amountKurus, 0), 0);
  assert.equal(snapshot.stockState.products[0].stockQuantity, stockBefore);
});

test("capability, pasif tedarikçi ve revision kuralları server tarafında uygulanır", async () => {
  const store = createMemoryStore();
  const service = createService(store);
  const operationActor = {
    type: "personel",
    id: "person-1",
    name: "Operasyon",
    role: "operasyon",
    branchId: "branch-server",
    capabilities: ["procurement.read", "supplier.read", "receipt.create", "receipt.submit"]
  };

  await assert.rejects(
    service.createSupplier(operationActor, { code: "X", name: "Yetkisiz" }, mutation("forbidden-supplier", 0)),
    (error) => error.status === 403 && error.code === "PROCUREMENT_CAPABILITY_REQUIRED"
  );
  await assert.rejects(
    service.createSupplier(ADMIN, { code: "X", name: "Eksik revision" }, { requestId: "missing-revision" }),
    (error) => error.status === 400 && error.code === "EXPECTED_REVISION_REQUIRED"
  );

  const supplier = await service.createSupplier(ADMIN, { code: "PAS-1", name: "Pasif Aday" }, mutation("supplier-create", 0));
  await service.deactivateSupplier(ADMIN, supplier.supplier.id, { reason: "Artık çalışılmıyor" }, mutation("supplier-deactivate", 1));
  await assert.rejects(
    service.createShipment(operationActor, {
      supplierId: supplier.supplier.id,
      items: [{ stockProductId: "stock-1", quantity: 1, unit: "kg", unitPriceKurus: 100 }],
      branchId: "client-forged"
    }, mutation("inactive-shipment", 2)),
    (error) => error.status === 409 && error.code === "SUPPLIER_INACTIVE"
  );
  assert.equal((await store.read()).workforceShipments.length, 1);
});

test("Fatura erişim şablonları kalıcıdır, bildirim üretir ve personel sevkiyatları şube kapsamında kalır", async () => {
  const store = createMemoryStore();
  let sequence = 0;
  const workforceInvalidations = [];
  const service = createProcurementService({
    store,
    notificationService,
    notifyWorkforceChange: (event) => workforceInvalidations.push(event),
    now: () => new Date("2026-08-22T10:00:00.000Z"),
    createId: (prefix) => `${prefix}-${++sequence}`
  });

  const before = await service.listUsers(ADMIN);
  const malKabul = before.accessTemplates.find((item) => item.key === "mal_kabul");
  assert.ok(malKabul);
  assert.deepEqual(malKabul.sections, ["shipments"]);

  const updated = await service.updateUserAccess(ADMIN, "person-1", {
    faturaTemplate: "mal_kabul",
    faturaAccessEnabled: true
  }, mutation("access-template", 0));
  assert.equal(updated.user.faturaAccessEnabled, true);
  assert.equal(updated.user.faturaTemplate, "mal_kabul");
  assert.ok(updated.user.faturaCapabilities.includes("receipt.approve"));
  assert.deepEqual(updated.user.faturaSections, ["shipments"]);
  let snapshot = await store.read();
  assert.equal(snapshot.notifications.filter((item) => item.eventType === "procurement_access_updated").length, 1);
  assert.equal(snapshot.procurement.auditEvents.at(-1).action, "user-access.update");

  const otherBranchActor = {
    type: "personel",
    id: "other-person",
    name: "Diğer Şube",
    role: "mal_kabul",
    branchId: "branch-other",
    capabilities: ["receipt.approve", "receipt.reject"]
  };
  const list = await service.listShipments(otherBranchActor);
  assert.equal(list.shipments.length, 0);
  const sameBranchReader = await service.listShipments({
    ...otherBranchActor,
    id: "branch-reader",
    branchId: "main",
    capabilities: ["procurement.read"]
  });
  assert.equal(sameBranchReader.shipments.length, 1, "procurement.read aynı şubedeki Mal Kabul kayıtlarını görmeli");
  await assert.rejects(
    service.getShipment(otherBranchActor, "shipment-pending"),
    (error) => error.status === 404 && error.code === "SHIPMENT_NOT_FOUND"
  );
  snapshot = await store.read();
  assert.equal(snapshot.workforceShipments[0].status, "onay_bekliyor");

  const receiptActor = {
    type: "personel",
    id: "receipt-main",
    name: "Mal Kabul",
    role: "mal_kabul",
    branchId: "main",
    template: "mal_kabul",
    capabilities: ["receipt.create", "receipt.submit", "receipt.reject", "documents.read", "documents.upload"]
  };
  const created = await service.createShipment(receiptActor, {
    items: [{ stockProductId: "stock-1", quantity: 1, unit: "kg", unitPriceKurus: 12345 }]
  }, mutation("branch-shipment-create", 1));
  const submitted = await service.submitShipment(receiptActor, created.shipment.id, {}, mutation("branch-shipment-submit", 2));
  const projected = await service.getShipment(receiptActor, submitted.shipment.id);
  assert.equal(projected.ledgerEntries.length, 0, "muhasebe yetkisi olmayan Mal Kabul kullanıcısına cari kayıt sızmamalı");
  assert.equal(Object.hasOwn(projected.shipment.items[0], "unitPriceKurus"), false, "mali satır alanı capability projection ile gizlenmeli");
  await service.rejectShipment(receiptActor, submitted.shipment.id, { reason: "Kontrol reddi" }, mutation("branch-shipment-reject", 3));
  assert.equal(workforceInvalidations.length, 3, "create/submit/reject mutationları workforce SSE invalidation üretmeli");
  snapshot = await store.read();
  const rejection = snapshot.notifications.find((item) => item.eventType === "shipment_rejected" && item.entityId === submitted.shipment.id);
  assert.match(rejection.deepLink, /^\/personel\/\?section=shipment&shipmentId=/);
});

test("belge, cari ve ödeme kayıtları personel için şube kapsamında kalır", async () => {
  const store = createMemoryStore();
  await store.update((data) => {
    data.procurement.documents = [
      { id: "doc-main", branchId: "main", documentType: "fatura", originalName: "main.png", createdBy: "main-user" },
      { id: "doc-other", branchId: "other", documentType: "fatura", originalName: "other.png", createdBy: "other-user" }
    ];
    data.procurement.ledgerEntries = [
      { id: "ledger-main", branchId: "main", supplierId: "supplier-main", type: "adjustment", amountKurus: -100, createdAt: "2026-08-22T08:00:00.000Z" },
      { id: "ledger-other", branchId: "other", supplierId: "supplier-other", type: "payment", amountKurus: 100, createdAt: "2026-08-22T09:00:00.000Z" }
    ];
    data.procurement.payments = [
      { id: "payment-other", branchId: "other", supplierId: "supplier-other", ledgerEntryId: "ledger-other", amountKurus: 100, status: "recorded" }
    ];
    return data;
  });
  const service = createService(store);
  const mainActor = {
    type: "personel",
    id: "main-accounting",
    name: "Ana Şube Muhasebe",
    branchId: "main",
    capabilities: ["documents.read", "accounting.read", "accounting.reverse", "payment.reverse"]
  };
  const documents = await service.listDocuments(mainActor);
  assert.deepEqual(documents.documents.map((item) => item.id), ["doc-main"]);
  await assert.rejects(service.getDocument(mainActor, "doc-other"), (error) => error.status === 404);
  const ledger = await service.listLedger(mainActor);
  assert.deepEqual(ledger.entries.map((item) => item.id), ["ledger-main"]);
  const accountingPosterShipments = await service.listShipments({
    ...mainActor,
    capabilities: ["accounting.post"]
  });
  assert.equal(accountingPosterShipments.shipments.length, 1, "mutation capability sahibi GET shipments sözleşmesinden dışlanmamalı");
  await assert.rejects(
    service.reversePayment(mainActor, "payment-other", { reason: "Yetkisiz" }, mutation("cross-branch-payment", 0)),
    (error) => error.status === 404 && error.code === "PAYMENT_NOT_FOUND"
  );
});

test("route katmanı oturumu/capability'yi zorunlu kılar ve stok onayını ortak callback'e delege eder", async (t) => {
  const store = createMemoryStore();
  const documentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-route-"));
  t.after(() => fs.rm(documentsDir, { recursive: true, force: true }));
  const documentService = createProcurementDocumentService({ documentsDir, maxUploadBytes: 1024 * 1024 });
  let approvalCalls = 0;
  const app = express();
  app.use(express.json());
  const auth = {
    requireRecipe(req, res, next) {
      const role = req.get("X-Test-Role");
      if (!role) return res.status(401).json({ ok: false, message: "Oturum gerekli." });
      if (role === "preview") {
        req.authSession = { role: "admin" };
        req.recipe = { role: "preview", sessionRole: "admin", previewRole: "admin" };
      } else if (role === "admin") {
        req.authSession = { role: "admin" };
        req.recipe = { role: "admin", sessionRole: "admin" };
      } else {
        req.authSession = { role: "personel", userId: "person-1" };
        req.recipe = { role: "recipe", sessionRole: "personel", userId: "person-1" };
      }
      return next();
    }
  };
  const runtime = registerProcurementRoutes({
    app,
    store,
    auth,
    documentService,
    approveWorkforceShipment: async (input) => {
      approvalCalls += 1;
      assert.equal(input.shipmentId, "shipment-pending");
      assert.equal(input.actor.type, "admin");
      return { revision: 9, idempotent: false, shipment: { id: input.shipmentId, stockAppliedAt: "2026-08-22T10:00:00.000Z" } };
    }
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error.status || 500).json({ ok: false, message: error.message, code: error.code });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/api/procurement/v1/context`)).status, 401);
  assert.equal((await fetch(`${base}/api/procurement/v1/context`, { headers: { "X-Test-Role": "preview" } })).status, 401);
  let response = await fetch(`${base}/api/procurement/v1/suppliers`, { headers: { "X-Test-Role": "personel" } });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/procurement/v1/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-Role": "personel", "Idempotency-Key": "route-forbidden" },
    body: JSON.stringify({ expectedRevision: 0, code: "Y", name: "Yetkisiz" })
  });
  assert.equal(response.status, 403);

  response = await fetch(`${base}/api/procurement/v1/shipments/shipment-pending/approve-stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-Role": "admin", "Idempotency-Key": "route-approve-1" },
    body: JSON.stringify({ expectedRevision: 0, note: "Onay" })
  });
  assert.equal(response.status, 200);
  const approval = await response.json();
  assert.equal(approval.workforceRevision, 9);
  assert.equal(approvalCalls, 1);
  assert.equal((await store.read()).procurement.ledgerEntries.length, 0);
  assert.equal(typeof runtime.service.subscribe, "function");

  const sseController = new AbortController();
  const sseResponse = await fetch(`${base}/api/procurement/v1/events`, {
    headers: { "X-Test-Role": "personel" },
    signal: sseController.signal
  });
  assert.equal(sseResponse.status, 200);
  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  await reader.read(); // ready olayı
  runtime.service.publishExternalEvent({
    type: "document.upload",
    entityType: "document",
    entityId: "other-branch-secret-document",
    branchId: "other",
    revision: 99
  });
  const eventChunk = await Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("SSE invalidation alınamadı.")), 1500))
  ]);
  const personelEvent = decoder.decode(eventChunk.value || new Uint8Array());
  assert.match(personelEvent, /procurement\.invalidated/);
  assert.doesNotMatch(personelEvent, /other-branch-secret-document|entityId/);
  await reader.cancel();
  sseController.abort();

  response = await fetch(`${base}/api/procurement/v1/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-Test-Role": "admin",
      "X-File-Name": encodeURIComponent("kamera-fatura-kanıt.png"),
      "X-Document-Type": "fatura",
      "X-Expected-Revision": "0",
      "Idempotency-Key": "route-document-1"
    },
    body: PNG_1X1
  });
  assert.equal(response.status, 201);
  const uploaded = await response.json();
  assert.equal(uploaded.document.physicalName, undefined);
  assert.equal(uploaded.document.mimeType, "image/png");
  assert.equal(uploaded.document.originalName, "kamera-fatura-kanıt.png");

  assert.equal((await fetch(`${base}${uploaded.document.contentUrl}`)).status, 401);
  response = await fetch(`${base}${uploaded.document.contentUrl}`, { headers: { "X-Test-Role": "admin" } });
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG_1X1);
});

test("özel belge API metadata'sı fiziksel yolu sızdırmaz", () => {
  const safe = safeDocumentMetadata({
    id: "document-1",
    originalName: "fatura.webp",
    mimeType: "image/webp",
    physicalName: "secret-random-name.webp",
    thumbnailPhysicalName: "secret-random-name.thumb.webp",
    absolutePath: "C:\\private\\secret-random-name.webp"
  });
  assert.equal(safe.physicalName, undefined);
  assert.equal(safe.thumbnailPhysicalName, undefined);
  assert.equal(safe.absolutePath, undefined);
  assert.equal(safe.contentUrl, "/api/procurement/v1/documents/document-1/content");
});

test("belgesiz mal kabul ve ödeme vadesi bildirimleri dedupe edilerek üretilir", async () => {
  const store = createMemoryStore();
  let sequence = 0;
  const service = createProcurementService({
    store,
    notificationService,
    now: () => new Date("2026-08-22T10:00:00.000Z"),
    createId: (prefix) => `${prefix}-${++sequence}`
  });
  const supplier = await service.createSupplier(ADMIN, {
    code: "VDE-1", name: "Vadeli Tedarikçi", paymentTermDays: 3
  }, mutation("notice-supplier", 0));
  const shipment = await service.createShipment(ADMIN, {
    supplierId: supplier.supplier.id,
    items: [{ stockProductId: "stock-1", quantity: 1, unit: "kg", unitPriceKurus: 1000 }]
  }, mutation("notice-shipment", 1));
  await service.submitShipment(ADMIN, shipment.shipment.id, {}, mutation("notice-submit", 2));
  let snapshot = await store.read();
  assert.deepEqual(snapshot.notifications.map((item) => item.eventType).sort(), ["document_missing", "shipment_submitted"]);

  const document = await service.recordDocument(ADMIN, {
    supplierId: supplier.supplier.id,
    shipmentIds: [shipment.shipment.id],
    documentType: "fatura",
    documentDate: "2026-08-22"
  }, {
    physicalName: "notice-private.webp",
    thumbnailPhysicalName: "notice-private.thumb.webp",
    originalName: "notice.webp",
    mimeType: "image/webp",
    sizeBytes: 100,
    sha256: "b".repeat(64)
  }, mutation("notice-document", 3));
  await service.accountShipment(ADMIN, shipment.shipment.id, {
    documentId: document.document.id,
    amountKurus: 1000,
    dueDate: "2026-08-25",
    note: "Vadeli alım"
  }, mutation("notice-invoice", 4));
  snapshot = await store.read();
  const created = [];
  createProcurementPaymentReminders(snapshot, new Date("2026-08-22T10:00:00.000Z"), created);
  assert.equal(created.length, 1);
  assert.equal(created[0].eventType, "payment_due_soon");
  assert.equal(created[0].deepLink, "/fatura/");
  createProcurementPaymentReminders(snapshot, new Date("2026-08-22T11:00:00.000Z"), created);
  assert.equal(created.length, 1, "aynı vade aynı gün ikinci bildirim üretmemeli");
});

function mutation(requestId, expectedRevision) {
  return { requestId: `${requestId}-00000000`.slice(0, 40), expectedRevision };
}

function createService(store) {
  let sequence = 0;
  return createProcurementService({
    store,
    now: () => new Date("2026-08-22T10:00:00.000Z"),
    createId: (prefix) => `${prefix}-${++sequence}`
  });
}

function createMemoryStore() {
  let state = normalizeStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    storeRevision: 0,
    revisions: { publish: 0, workforce: 0, procurement: 0 },
    stockState: {
      products: [{
        id: "stock-1",
        productCode: "KHV-1",
        name: "Kahve",
        unit: "kg",
        stockQuantity: 5,
        active: true,
        sourcePresent: true
      }],
      movements: []
    },
    recipeUsers: [{
      id: "person-1",
      username: "operasyon",
      name: "Operasyon",
      active: true,
      branchId: "branch-server",
      faturaRole: "operasyon",
      faturaCapabilities: ["procurement.read", "supplier.read", "receipt.create", "receipt.submit"]
    }],
    workforceShipments: [{
      id: "shipment-pending",
      userId: "person-1",
      userName: "Operasyon",
      status: "onay_bekliyor",
      items: [{ stockProductId: "stock-1", productId: "stock-1", quantity: 1, unit: "kg" }],
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      revision: 1
    }],
    procurement: {}
  });
  const noChange = Symbol("no-change");
  return {
    async read() {
      return structuredClone(state);
    },
    async update(mutator) {
      const draft = structuredClone(state);
      const result = await mutator(draft, { noChange });
      if (result !== noChange) state = normalizeStore(result === undefined ? draft : result);
      return structuredClone(state);
    }
  };
}
