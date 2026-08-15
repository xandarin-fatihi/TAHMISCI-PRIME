"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createDataImportColdStore,
  migrateLegacyDataImportPayloads
} = require("../src/data-import-cold-store");
const { createFileStore, defaultStore, normalizeStore } = require("../src/store/file-store");

test("legacy embedded import payloadları durable cold referanslara idempotent taşınır", async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-import-cold-"));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const dataFile = path.join(runRoot, "store.json");
  const coldRoot = path.join(runRoot, "data-import-cold");
  const largePlanValue = "plan-payload-".repeat(50000);
  const largeBackupValue = "backup-payload-".repeat(50000);
  const largeResponseValue = "response-payload-".repeat(50000);
  const initial = normalizeStore(defaultStore("test-admin-hash", "test-recipe-hash"));
  initial.storeRevision = 7;
  initial.dataImportDrafts = [{
    id: "data-import-analysis-legacy-cold-00000001",
    analysisId: "data-import-analysis-legacy-cold-00000001",
    actor: "manager-test",
    createdAt: "2026-08-15T08:00:00.000Z",
    expiresAt: "2099-08-15T09:00:00.000Z",
    expectedRevision: 3,
    scopes: ["menu"],
    files: { menu: { filename: "TAHMISCI-MENU.xlsx" } },
    plan: { menuState: { largePlanValue } },
    changes: [{ operation: "update", value: largePlanValue }],
    issues: []
  }];
  initial.dataImportBackups = [{
    id: "data-import-backup-legacy-cold-00000001",
    operationId: "data-import-legacy-cold-00000001",
    createdAt: "2026-08-15T08:05:00.000Z",
    snapshot: { menuState: { largeBackupValue } }
  }];
  initial.dataImportIdempotency = [{
    scope: "data-import:analyze:manager-test",
    requestId: "legacy-cold-request-0001",
    createdAt: "2026-08-15T08:00:00.000Z",
    response: { ok: true, analysisId: "data-import-analysis-legacy-cold-00000001", largeResponseValue }
  }];
  await fs.writeFile(dataFile, `${JSON.stringify(initial)}\n`, "utf8");
  const beforeBytes = (await fs.stat(dataFile)).size;

  const store = createFileStore(dataFile, {
    defaultPanelPassword: "unused-test-password",
    defaultRecipePassword: "unused-test-password",
    enableEventLoopMetrics: false
  });
  t.after(() => store.close());
  const coldStore = createDataImportColdStore({ rootDir: coldRoot });
  const first = await migrateLegacyDataImportPayloads(store, coldStore);
  assert.deepEqual(first, { changed: true, drafts: 1, backups: 1, idempotency: 1 });

  const hot = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const afterBytes = (await fs.stat(dataFile)).size;
  assert.ok(afterBytes < beforeBytes * 0.2, `hot store küçülmeli (${beforeBytes} -> ${afterBytes})`);
  assert.ok(hot.dataImportDrafts[0].payloadRef);
  assert.equal(Object.hasOwn(hot.dataImportDrafts[0], "plan"), false);
  assert.ok(hot.dataImportBackups[0].snapshotRef);
  assert.equal(Object.hasOwn(hot.dataImportBackups[0], "snapshot"), false);
  assert.ok(hot.dataImportIdempotency[0].responseRef);
  assert.equal(Object.hasOwn(hot.dataImportIdempotency[0], "response"), false);

  const draft = await coldStore.resolveDraft(hot.dataImportDrafts[0]);
  const snapshot = await coldStore.resolveBackupSnapshot(hot.dataImportBackups[0]);
  const response = await coldStore.resolveIdempotencyResponse(hot.dataImportIdempotency[0]);
  assert.equal(draft.plan.menuState.largePlanValue, largePlanValue);
  assert.equal(snapshot.menuState.largeBackupValue, largeBackupValue);
  assert.equal(response.largeResponseValue, largeResponseValue);

  const filesBeforeReplay = await listColdFiles(coldRoot);
  const second = await migrateLegacyDataImportPayloads(store, coldStore);
  const filesAfterReplay = await listColdFiles(coldRoot);
  assert.deepEqual(second, { changed: false, drafts: 0, backups: 0, idempotency: 0 });
  assert.deepEqual(filesAfterReplay, filesBeforeReplay, "tekrar migration cold payload çoğaltmamalı");
});

async function listColdFiles(root) {
  const output = [];
  for (const kind of ["drafts", "backups", "idempotency"]) {
    const directory = path.join(root, kind);
    let entries = [];
    try { entries = await fs.readdir(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    output.push(...entries.map((name) => `${kind}/${name}`).sort());
  }
  return output.sort();
}
