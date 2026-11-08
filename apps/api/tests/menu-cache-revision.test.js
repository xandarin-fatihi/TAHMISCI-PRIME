"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runRoot = path.join(os.tmpdir(), `tahmisci-menu-cache-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATA_FILE = path.join(runRoot, "store.json");
process.env.MEDIA_DIR = path.join(runRoot, "media");
process.env.DEFAULT_PANEL_PASSWORD = "Panel123456";
process.env.DEFAULT_RECIPE_PASSWORD = "Recipe123456";
process.env.JWT_SECRET = "menu-cache-test-secret-longer-than-thirty-two-characters";
process.env.COOKIE_SECURE = "false";
process.env.ALLOW_LOCALHOST_ORIGINS = "true";
process.env.NOTIFICATION_WORKERS_ENABLED = "false";

const { app, prepareRuntime, shutdownRuntime, store } = require("../src/server");

let server;
let baseUrl;

test.before(async () => {
  await prepareRuntime();
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await shutdownRuntime(server, { timeoutMs: 2000 });
  await fs.rm(runRoot, { recursive: true, force: true });
});

test("menü ve public bootstrap revizyon tabanlı ETag ile eski cevabı doğrular", async () => {
  for (const pathname of ["/api/menu", "/api/public/bootstrap"]) {
    const first = await fetch(`${baseUrl}${pathname}`);
    const etag = first.headers.get("etag");
    assert.equal(first.status, 200);
    assert.ok(etag);
    assert.match(first.headers.get("cache-control") || "", /must-revalidate/);
    await first.arrayBuffer();

    const unchanged = await fetch(`${baseUrl}${pathname}`, { headers: { "If-None-Match": etag } });
    assert.equal(unchanged.headers.get("etag"), etag);
    assert.equal(unchanged.status, 304);
  }

  const before = await fetch(`${baseUrl}/api/menu`);
  const previousEtag = before.headers.get("etag");
  await before.arrayBuffer();
  await store.update((data) => {
    data.revisions.publish = Number(data.revisions.publish || 0) + 1;
    data.menuUpdatedAt = new Date().toISOString();
    return data;
  });

  const changed = await fetch(`${baseUrl}/api/menu`, { headers: { "If-None-Match": previousEtag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), previousEtag);
  assert.ok(Number(changed.headers.get("x-publish-revision")) > 0);
});

test("menü yayını hazır seçimi ve özelleştirilen renkleri ayrı saklar", async () => {
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "Panel123456" })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const before = await (await fetch(`${baseUrl}/api/menu`)).json();
  const menuState = before.menuState;
  Object.assign(menuState.settings, {
    themeMode: "ready",
    readyTheme: "reindeer-woods",
    readyThemePlayback: "shuffle",
    readyThemePool: ["reindeer-woods", "santa-post", "witch-espresso"],
    seasonalConcept: "matcha-cilek",
    bgColor: "#dae2cb"
  });
  const publish = async () => fetch(`${baseUrl}/api/menu`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({ menuState })
  });
  for (const [mode, playback] of [["ready", "shuffle"], ["ready", "fixed"], ["custom", "fixed"]]) {
    menuState.settings.themeMode = mode;
    menuState.settings.readyThemePlayback = playback;
    assert.equal((await publish()).status, 200);
    const response = await (await fetch(`${baseUrl}/api/menu`)).json();
    const settings = response.menuState.settings;
    assert.deepEqual([settings.themeMode, settings.readyTheme, settings.readyThemePlayback], [mode, "reindeer-woods", playback]);
    assert.deepEqual(settings.readyThemePool, ["reindeer-woods", "santa-post", "witch-espresso"]);
    assert.deepEqual([settings.seasonalConcept, settings.bgColor], ["matcha-cilek", "#dae2cb"]);
  }
});
