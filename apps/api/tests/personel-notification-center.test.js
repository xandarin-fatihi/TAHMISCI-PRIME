"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(root, "apps", "personel", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "apps", "personel", "notifications.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "apps", "personel", "personel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "apps", "personel", "notifications.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "apps", "personel", "sw.js"), "utf8");

test("Personel bildirim merkezi erişilebilir çekmece, filtre ve kalıcı tercih alanlarını sunar", () => {
  assert.equal((html.match(/id="personelNotificationTrigger"/g) || []).length, 1);
  assert.match(html, /aria-controls="personelNotificationDrawer"/);
  assert.match(html, /id="personelNotificationDrawer"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  for (const category of ["all", "task", "shipment", "shift", "training"]) {
    assert.match(html, new RegExp(`data-notification-category="${category}"`));
  }
  for (const field of [
    "emailAddress", "inAppEnabled", "emailEnabled", "taskNotifications", "shipmentNotifications",
    "shiftNotifications", "trainingNotifications", "taskReminder24h", "taskReminder2h",
    "overdueReminder", "shiftReminder12h", "shiftReminder2h", "quietHoursEnabled"
  ]) assert.match(html, new RegExp(`name="${field}"`), `${field} tercihi eksik`);
});

test("Personel istemcisi canonical API, doğru unread query, SSE ve polling fallback kullanır", () => {
  assert.match(script, /API_ROOT\s*=\s*"\/api\/notifications"/);
  assert.match(script, /parameters\.set\("unread", "true"\)/);
  assert.doesNotMatch(script, /parameters\.set\("unreadOnly"/);
  for (const endpoint of ["/unread-count", "/read-all", "/preferences", "/push-subscriptions", "/events"]) {
    assert.ok(script.includes(endpoint), `${endpoint} istemci bağlantısı eksik`);
  }
  assert.match(script, /new EventSource\(`\$\{API_ROOT\}\/events`/);
  assert.match(script, /startPolling/);
  assert.match(script, /scheduleReconnect/);
});

test("Personel push izni sadece düğme eyleminden istenir ve çıkışta abonelik kaldırılır", () => {
  const permissionCalls = [...script.matchAll(/Notification\.requestPermission\s*\(/g)];
  assert.equal(permissionCalls.length, 1);
  const enableStart = script.indexOf("async function enablePush");
  const enableEnd = script.indexOf("async function disablePush", enableStart);
  assert.ok(permissionCalls[0].index > enableStart && permissionCalls[0].index < enableEnd);
  assert.match(script, /async function beforeLogout/);
  assert.match(script, /method:\s*"DELETE"/);
  assert.match(shell, /TahmisciPersonelNotifications\.beforeLogout/);
});

test("Personel deep-link resolver mevcut sekmeleri, hash rotalarını ve entity hedeflerini güvenle açar", () => {
  assert.match(script, /url\.origin !== window\.location\.origin/);
  assert.match(script, /normalizePersonelNotificationSection\(url\.hash/);
  assert.match(script, /taskId/);
  assert.match(script, /assignmentId/);
  assert.match(script, /alignShiftWeek/);
  assert.match(script, /tahmisci:open-recipe-assignment/);
});

test("Personel service worker push bildirimi ve güvenli tıklama yönlendirmesini cache dışı API ile korur", () => {
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /safePersonelDeepLink/);
  assert.match(serviceWorker, /neverCachePrefixes:\s*\["\/api\/"/);
});

test("Personel bildirim stili mobil, odak, açık başlık ve azaltılmış hareket durumlarını kapsar", () => {
  assert.match(styles, /\.personel-notification-drawer\s*\{/);
  assert.match(styles, /\.personel-notification-card__open\s*\{/);
  assert.match(styles, /@media \(max-width:\s*760px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.key !== "Tab"/);
});
