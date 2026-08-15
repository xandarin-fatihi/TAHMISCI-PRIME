"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("menu, recipe ve stock SSE başlangıçta katalog snapshot göndermiyor", () => {
  const source = read("apps/api/src/app.js");
  for (const [route, scope, clients] of [
    ["/api/menu/events", "menu", "sseClients"],
    ["/api/recipes/events", "recipes", "recipeSseClients"],
    ["/api/stock/events", "stock", "stockSseClients"]
  ]) {
    const routeIndex = source.indexOf(`app.get(\"${route}\"`);
    assert.ok(routeIndex >= 0, `${route} eksik`);
    const routeBody = source.slice(routeIndex, source.indexOf("\n});", routeIndex) + 4);
    assert.match(routeBody, new RegExp(`openRevisionStream\\(req, res, ${clients}, \\"${scope}\\"`));
    assert.doesNotMatch(routeBody, /menuState:|recipeState:|stockState:/);
  }
  assert.match(source, /retry: \$\{SSE_RETRY_MS\}/);
  assert.match(source, /X-Accel-Buffering/);
  assert.match(source, /requiresRefetch/);
});

test("workforce projection ve revision stream mevcut URL sözleşmesini koruyor", () => {
  const source = read("apps/api/src/workforce-routes.js");
  assert.match(source, /"\/api\/workforce\/me"/);
  assert.match(source, /"\/api\/workforce\/events"/);
  assert.match(source, /"\/api\/admin\/workforce\/events"/);
  assert.match(source, /req\.query && \(req\.query\.scope \|\| req\.query\.projection\)/);
  assert.match(source, /action: "invalidate"/);
  assert.match(source, /await updateStore\(/);
});

test("notification SSE olay başına store okumadan unread sayısını güncelliyor", () => {
  const source = read("apps/api/src/notification-routes.js");
  const listenerStart = source.indexOf("const listener = (notification) =>");
  const listenerEnd = source.indexOf("const unsubscribe", listenerStart);
  assert.ok(listenerStart >= 0 && listenerEnd > listenerStart);
  const listener = source.slice(listenerStart, listenerEnd);
  assert.doesNotMatch(listener, /store\.read\(/);
  assert.match(listener, /currentUnreadCount \+= 1/);
  assert.match(source, /id: \$\{String\(id\)/);
});

test("PWA update kontrolü seyrek, nginx JSON sıkıştırmalı ve SSE buffersızdır", () => {
  const pwaClient = read("shared/scripts/pwa-client.js");
  const nginx = read("deploy/nginx/tahmiscicoffee.com.conf.example");
  assert.match(pwaClient, /updateCheckIntervalMs = 6 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(pwaClient, /setTimeout\(\(\) => registration\.update\(\).*1500/);
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /application\/json/);
  assert.match(nginx, /gzip off;[\s\S]*proxy_buffering off;/);
});
