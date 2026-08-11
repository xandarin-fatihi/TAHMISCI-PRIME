"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { migrateStore, STORE_SCHEMA_VERSION } = require("../src/store/migrations");

test("Faz 5 migration eski toplu görevi kişi bazlı assignment kayıtlarına yalnız bir kez dönüştürür", () => {
  const source = {
    schemaVersion: 10,
    recipeUsers: [
      { id: "person-a", name: "Ayşe", username: "ayse", active: true },
      { id: "person-b", name: "Bora", username: "bora", active: false }
    ],
    workforceTasks: [{
      id: "legacy-task",
      text: "Eski tek metinli görev",
      assignedUserIds: ["person-a", "person-b"],
      status: "active",
      createdAt: "2026-01-01T08:00:00.000Z"
    }],
    workforceAssignments: [],
    workforceShiftPlans: [{ id: "published-plan", weekStart: "2026-01-05", personId: "person-a", date: "2026-01-05", status: "published", type: "morning" }]
  };

  const once = migrateStore(source);
  const twice = migrateStore(once);
  assert.equal(once.schemaVersion, STORE_SCHEMA_VERSION);
  assert.equal(once.workforceTasks[0].items.length, 1);
  assert.equal(once.workforceAssignments.length, 2);
  assert.equal(new Set(once.workforceAssignments.map((item) => `${item.taskId}:${item.userId}`)).size, 2);
  assert.equal(once.workforceAssignments.find((item) => item.userId === "person-b").personInactive, true);
  assert.equal(once.workforceShiftPlans[0].status, "published", "eski yayın taslağa dönmemeli");
  assert.deepEqual(twice.workforceAssignments, once.workforceAssignments, "migration ikinci açılışta assignment çoğaltmamalı");
  assert.deepEqual(twice.workforceMigrationState, once.workforceMigrationState);
});

test("Faz 5 migration güvenli dönüştürülemeyen kaydı arşivler ve onaylı sevkiyatın stok referansını korur", () => {
  const source = {
    schemaVersion: 10,
    recipeUsers: [],
    deletedRecipeUsers: [{ id: "deleted-person", name: "Silinen Personel", username: "silinen", deletedAt: "2026-02-01T08:00:00.000Z" }],
    workforceTasks: [{ id: "task-1", title: "Görev", items: [{ id: "item-1", text: "Madde" }] }],
    workforceAssignments: [
      { id: "assignment-1", taskId: "task-1", userId: "deleted-person", status: "completed", completedItemIds: ["item-1"] },
      { id: "broken-assignment", taskId: "task-1", status: "pending" }
    ],
    workforceShipments: [{
      id: "legacy-approved-shipment",
      userId: "deleted-person",
      userName: "Silinen Personel",
      status: "approved",
      approvedAt: "2026-02-02T08:00:00.000Z",
      items: [{ productId: "stock-1", quantity: 2, unit: "adet" }]
    }],
    stockState: {
      categories: [],
      products: [{ id: "stock-1", productCode: "ST-1", name: "Stok", active: true, stockQuantity: 12, unit: "adet" }],
      movements: [{ id: "movement-1", shipmentId: "legacy-approved-shipment", productId: "stock-1", quantity: 2, unit: "adet", createdAt: "2026-02-02T08:00:00.000Z" }]
    }
  };

  const migrated = migrateStore(source);
  const shipment = migrated.workforceShipments[0];
  assert.equal(shipment.status, "onaylandı");
  assert.ok(shipment.stockAppliedAt);
  assert.equal(shipment.stockMovementRef, "movement-1");
  assert.deepEqual(shipment.stockMovementRefs, ["movement-1"]);
  assert.equal(shipment.personDeleted, true);
  assert.equal(migrated.workforceAssignments[0].personDeleted, true);
  assert.ok(migrated.workforceMigrationArchive.some((item) => item.reason === "missing_task_or_person"));
  assert.equal(migrated.workforceMigrationState.archivedRecordCount, migrated.workforceMigrationArchive.length);
  assert.deepEqual(migrateStore(migrated).workforceMigrationArchive, migrated.workforceMigrationArchive);
});
