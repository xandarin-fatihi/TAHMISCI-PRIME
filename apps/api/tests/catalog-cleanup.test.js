"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const {
  CATALOG_CLEANUP_VERSION,
  applyCatalogCleanup,
  buildCatalogCleanupPreview,
  catalogCleanupFingerprint,
  completedCatalogCleanup
} = require("../src/catalog-cleanup");
const { createFileStore, defaultStore } = require("../src/store/file-store");

test("tek seferlik katalog temizliği yalnız katalogları temizler ve referanslı stok ürününü arşivleyerek korur", () => {
  const data = fixtureStore();
  const protectedBefore = protectedSnapshot(data);
  const preview = buildCatalogCleanupPreview(data);
  assert.equal(preview.completed, false);
  assert.equal(preview.summary.stockProductsPreservedForHistory, 1);

  const first = applyCatalogCleanup(data, {
    operationId: "catalog-cleanup-test",
    requestId: "catalog-cleanup-request-test",
    actor: "manager-test",
    now: "2026-08-08T12:00:00.000Z"
  });
  assert.equal(first.idempotent, false);
  assert.deepEqual(data.menuState.categories, []);
  assert.deepEqual(data.recipeState, {});
  assert.deepEqual(data.recipeCatalog, []);
  assert.deepEqual(data.dataImportMappings, { menu: [], pricing: [], recipe: [], stock: [] });
  assert.deepEqual(data.dataImportDrafts, []);
  assert.deepEqual(data.pricingImportDrafts, []);
  assert.equal(data.stockState.products.length, 1);
  assert.equal(data.stockState.products[0].id, "stock-referenced");
  assert.equal(data.stockState.products[0].active, false);
  assert.equal(data.stockState.products[0].statusSource, "catalog_cleanup_reference_preserved");
  assert.equal(data.stockState.products.some((product) => product.id === "stock-unreferenced"), false);
  assert.equal(data.stockState.movements.length, 1);
  assert.deepEqual(protectedSnapshot(data), protectedBefore);
  assert.equal(first.marker.afterFingerprint, catalogCleanupFingerprint(data));

  const second = applyCatalogCleanup(data, { operationId: "must-not-run-twice" });
  assert.equal(second.idempotent, true);
  assert.equal(second.marker.id, "catalog-cleanup-test");
  assert.equal(data.catalogMigrations.filter((item) => item.version === CATALOG_CLEANUP_VERSION).length, 1);
});

test("FileStore katalog temizliğinden önce tam yedek alır ve idempotent tekrarda ikinci yedek üretmez", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-catalog-cleanup-"));
  const filePath = path.join(root, "store.json");
  try {
    const passwordHash = await bcrypt.hash("Panel123456", 4);
    const source = Object.assign(defaultStore(passwordHash, passwordHash), fixtureStore(), {
      admin: { passwordHash, recipePasswordHash: passwordHash, updatedAt: "2026-08-08T10:00:00.000Z" }
    });
    await fs.writeFile(filePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
    const store = createFileStore(filePath, { defaultPanelPassword: "Panel123456", bcryptRounds: 4 });
    await store.ensure();

    const run = async (operationId) => store.update((data) => applyCatalogCleanup(data, {
      operationId,
      requestId: `${operationId}-request`,
      now: "2026-08-08T12:00:00.000Z"
    }).data, {
      backupLabel: `catalog-cleanup-${operationId}`,
      shouldBackup: (data) => !completedCatalogCleanup(data)
    });

    await run("catalog-cleanup-file-store");
    await run("catalog-cleanup-file-store-replay");
    const backupFiles = await fs.readdir(path.join(root, "backups"));
    assert.equal(backupFiles.length, 1);
    const backup = JSON.parse(await fs.readFile(path.join(root, "backups", backupFiles[0]), "utf8"));
    assert.equal(backup.menuState.categories.length, 1);
    assert.equal(backup.recipeUsers[0].id, "person-1");

    const persisted = await store.read();
    assert.ok(completedCatalogCleanup(persisted));
    assert.equal(persisted.menuState.categories.length, 0);
    assert.equal(persisted.workforceShipments[0].items[0].productId, "stock-referenced");
    assert.equal(persisted.stockState.products[0].id, "stock-referenced");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function fixtureStore() {
  return {
    schemaVersion: 8,
    revisions: { publish: 3, pricing: 2, dataImport: 4 },
    menuState: {
      settings: { theme: "cream" },
      categories: [{ id: "menu-cat", name: "Sıcaklar", products: [{ id: "menu-product", name: "Latte", pricing: { typeId: "standard", values: { standard: { price: 90 } } } }] }]
    },
    pricing: { schemaVersion: 1, types: [{ id: "standard", name: "Standart", options: [{ id: "standard", label: "Standart" }] }] },
    pricingImportDrafts: [{ id: "old-pricing-draft" }],
    pricingAudit: [{ id: "pricing-audit-kept" }],
    recipeState: { Sıcaklar: { Latte: { Standart: { id: "recipe-item", content: "Süt", preparation: "Hazırla" } } } },
    recipeCatalog: [{ id: "recipe-latte", category: "Sıcaklar", product: "Latte" }],
    recipeLinkReview: [{ productId: "menu-product" }],
    stockState: {
      categories: [{ id: "stock-cat", name: "Sütler" }, { id: "unused-cat", name: "Diğer" }],
      products: [
        { id: "stock-referenced", categoryId: "stock-cat", category: "Sütler", productName: "Süt", name: "Süt", stockQuantity: 10, unit: "adet" },
        { id: "stock-unreferenced", categoryId: "unused-cat", category: "Diğer", productName: "Şurup", name: "Şurup", stockQuantity: 5, unit: "adet" }
      ],
      movements: [{ id: "movement-1", productId: "stock-referenced", productName: "Süt", type: "stock_in", quantity: 3, unit: "adet" }],
      notificationSettings: { email: true }
    },
    dataImportMappings: { menu: [{ entityId: "menu-product" }], pricing: [], recipe: [], stock: [{ entityId: "stock-referenced" }] },
    dataImportDrafts: [{ id: "old-draft" }],
    dataImportIdempotency: [{ requestId: "old-import-request" }],
    dataImportHistory: [{ id: "audit-import-kept" }],
    dataImportBackups: [{ id: "import-backup-kept" }],
    admin: { passwordHash: "hash", recipePasswordHash: "hash" },
    recipeUsers: [{ id: "person-1", name: "Ali", active: true }],
    recipeAssignments: [{ id: "assignment-1", userId: "person-1", recipeItems: [{ product: "Latte" }] }],
    recipeActivity: [{ id: "activity-1", type: "assigned" }],
    authSessions: [{ id: "session-1", role: "personel", userId: "person-1", tokenHash: "a".repeat(64) }],
    workforceTasks: [{ id: "task-1", title: "Görev" }],
    workforceAssignments: [{ id: "task-assignment-1", taskId: "task-1", userId: "person-1" }],
    workforceShipments: [{ id: "shipment-1", userId: "person-1", items: [{ productId: "stock-referenced", stockProductId: "stock-referenced", name: "Süt" }] }],
    workforceShiftRequests: [{ id: "shift-request-1", userId: "person-1" }],
    workforceShiftPlans: [{ id: "shift-plan-1", personId: "person-1" }],
    workforceShiftPlanRevisions: [{ id: "shift-revision-1" }],
    workforceShiftSettings: { morning: { startTime: "08:00", endTime: "16:00" }, evening: { startTime: "16:00", endTime: "00:00" } },
    adminDefaults: { menuDesign: { theme: "cream" } },
    siteState: { settings: { brand: "Tahmisçi" } },
    feedbackItems: [{ id: "feedback-1" }]
  };
}

function protectedSnapshot(data) {
  return structuredClone({
    admin: data.admin,
    recipeUsers: data.recipeUsers,
    recipeAssignments: data.recipeAssignments,
    recipeActivity: data.recipeActivity,
    authSessions: data.authSessions,
    workforceTasks: data.workforceTasks,
    workforceAssignments: data.workforceAssignments,
    workforceShipments: data.workforceShipments,
    workforceShiftRequests: data.workforceShiftRequests,
    workforceShiftPlans: data.workforceShiftPlans,
    workforceShiftPlanRevisions: data.workforceShiftPlanRevisions,
    workforceShiftSettings: data.workforceShiftSettings,
    adminDefaults: data.adminDefaults,
    siteState: data.siteState,
    feedbackItems: data.feedbackItems,
    pricingAudit: data.pricingAudit,
    dataImportHistory: data.dataImportHistory,
    dataImportBackups: data.dataImportBackups
  });
}
