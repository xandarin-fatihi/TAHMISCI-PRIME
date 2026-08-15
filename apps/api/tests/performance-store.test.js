"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createAuthMiddleware } = require("../src/middleware/auth");
const { createNotificationDeliveryWorker } = require("../src/notification-delivery");
const { createNotificationScheduler } = require("../src/notification-scheduler");
const { createFileStore, defaultStore, normalizeStore } = require("../src/store/file-store");

test("warm snapshot reads diskten okumaz ve request context bir kez cozulur", async (t) => {
  const fixture = await fileStoreFixture(t);
  fixture.store.resetMetrics();

  const first = await fixture.store.read();
  const second = await fixture.store.read();
  assert.strictEqual(first, second);
  const req = {};
  const context = await fixture.store.getRequestSnapshot(req);
  assert.strictEqual(await fixture.store.getRequestSnapshot(req), context);
  assert.strictEqual(req.storeSnapshot, first);
  assert.equal(req.storeRevision, context.revision);

  const metrics = fixture.store.getMetrics();
  assert.equal(metrics.diskReadCount, 0);
  assert.equal(metrics.snapshotResolveCount, 3);
  assert.equal(metrics.requestSnapshotResolveCount, 1);
});

test("auth ve handler ayni request snapshot revision ve indekslerini kullanir", async (t) => {
  const token = "ths_performance_request_scope_token";
  const fixture = await fileStoreFixture(t, (data) => {
    data.recipeUsers = [{ id: "person-1", username: "barista", name: "Barista", active: true }];
    data.authSessions = [{
      id: "session-person-1",
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      role: "personel",
      userId: "person-1",
      username: "barista",
      name: "Barista",
      createdAt: new Date().toISOString(),
      revokedAt: null
    }];
  });
  fixture.store.resetMetrics();
  const auth = createAuthMiddleware({
    adminCookieName: "admin_session",
    recipeCookieName: "personel_session",
    jwtSecret: "x".repeat(48),
    jwtIssuer: "test",
    jwtAudience: "test",
    cookieSameSite: "lax"
  }, fixture.store);
  const req = {
    method: "GET",
    originalUrl: "/api/workforce/me",
    query: {},
    header(name) { return String(name).toLowerCase() === "cookie" ? `personel_session=${token}` : ""; }
  };
  const response = fakeResponse();
  await new Promise((resolve, reject) => auth.requireActivePersonel(req, response, (error) => error ? reject(error) : resolve()));

  const handlerContext = await fixture.store.getRequestSnapshot(req);
  assert.equal(req.recipeUser.id, "person-1");
  assert.equal(handlerContext.revision, req.storeRevision);
  assert.strictEqual(handlerContext.data, req.storeSnapshot);
  assert.equal(fixture.store.getMetrics().requestSnapshotResolveCount, 1);
  assert.equal(fixture.store.getMetrics().diskReadCount, 0);
});

test("durable write hatasi aktif memory snapshot'i degistirmez", async (t) => {
  let failRename = false;
  const proxiedFs = new Proxy(fs, {
    get(target, property) {
      if (property === "rename") {
        return async (...args) => {
          if (failRename) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
          return target.rename(...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const fixture = await fileStoreFixture(t, null, { fsPromises: proxiedFs });
  const before = await fixture.store.getSnapshot();
  failRename = true;
  await assert.rejects(fixture.store.update((data) => {
    data.feedbackUpdatedAt = "2030-01-01T00:00:00.000Z";
    return data;
  }), /injected rename failure/);
  failRename = false;
  const after = await fixture.store.getSnapshot();
  assert.equal(after.revision, before.revision);
  assert.strictEqual(after.data, before.data);
  assert.equal(after.data.feedbackUpdatedAt, null);
});

test("external mtime degisikligi kontrollu refresh ile yeni snapshot'a gecirir", async (t) => {
  const fixture = await fileStoreFixture(t, null, { externalCheckIntervalMs: 100 });
  const before = await fixture.store.getSnapshot();
  const external = structuredClone(before.data);
  external.storeRevision = before.revision + 7;
  external.feedbackUpdatedAt = "2031-02-03T04:05:06.000Z";
  await new Promise((resolve) => setTimeout(resolve, 120));
  await fs.writeFile(fixture.filePath, `${JSON.stringify(external, null, 2)}\n`, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 120));
  fixture.store.resetMetrics();
  const refreshed = await fixture.store.getSnapshot();
  assert.equal(refreshed.data.feedbackUpdatedAt, external.feedbackUpdatedAt);
  assert.equal(refreshed.revision, external.storeRevision);
  assert.equal(fixture.store.getMetrics().externalRefreshCount, 1);
  assert.equal(fixture.store.getMetrics().diskReadCount, 1);
});

test("explicit no-op update stringify, backup ve durable write yapmaz", async (t) => {
  const fixture = await fileStoreFixture(t);
  const before = await fixture.store.getSnapshot();
  fixture.store.resetMetrics();
  const result = await fixture.store.update(() => fixture.store.noChange(), { backupLabel: "must-not-exist" });
  const metrics = fixture.store.getMetrics();
  assert.strictEqual(result, before.data);
  assert.equal(metrics.diskWriteCount, 0);
  assert.equal(metrics.stringifyMs, 0);
  assert.equal(metrics.noOpUpdateCount, 1);
});

test("bos notification worker tick'leri tam store write uretmez", async (t) => {
  const fixture = await fileStoreFixture(t);
  const delivery = createNotificationDeliveryWorker({
    store: fixture.store,
    config: { notificationWorkerIntervalMs: 15000 },
    logError() {}
  });
  const scheduler = createNotificationScheduler({
    store: fixture.store,
    intervalMs: 60000,
    clock: () => new Date("2032-01-01T09:00:00.000Z"),
    logError() {}
  });
  fixture.store.resetMetrics();
  assert.deepEqual(await delivery.tick(), { processed: 0, sent: 0 });
  const schedulerResult = await scheduler.tick();
  assert.equal(schedulerResult.created, 0);
  assert.equal(schedulerResult.skipped, "no-work");
  assert.equal(fixture.store.getMetrics().diskWriteCount, 0);
});

async function fileStoreFixture(t, mutate, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-performance-store-"));
  const filePath = path.join(directory, "store.json");
  const data = defaultStore("admin-hash", "recipe-hash");
  data.storeRevision = 1;
  if (typeof mutate === "function") mutate(data);
  await fs.writeFile(filePath, `${JSON.stringify(normalizeStore(data), null, 2)}\n`, "utf8");
  const store = createFileStore(filePath, {
    enableEventLoopMetrics: false,
    externalCheckIntervalMs: 1000,
    ...options
  });
  await store.ensure();
  t.after(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, filePath, store };
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    cookie(...args) { this.cookies.push(args); return this; },
    clearCookie() { return this; },
    redirect() { return this; }
  };
}
