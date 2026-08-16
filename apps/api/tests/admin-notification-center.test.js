"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(root, "apps", "admin", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "apps", "admin", "scripts", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "apps", "admin", "styles", "notifications.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "apps", "admin", "sw.js"), "utf8");

test("Yönetici bildirim merkezi tek zil, erişilebilir çekmece ve gerçek ayar kontrolleri sunar", () => {
  assert.equal((html.match(/id="adminNotificationTrigger"/g) || []).length, 1);
  assert.match(html, /aria-controls="adminNotificationDrawer"/);
  assert.match(html, /id="adminNotificationDrawer"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(html, /data-notification-filter="all"/);
  assert.match(html, /data-notification-filter="unread"/);
  assert.match(html, /id="adminNotificationPreferences"/);
  assert.match(html, /id="adminNotificationPush"/);
  assert.match(html, /id="adminNotificationTest"/);
  for (const field of [
    "emailAddress", "taskNotifications", "shipmentNotifications", "shiftNotifications",
    "stockNotifications", "taskReminder24h", "taskReminder2h",
    "overdueReminder", "shiftReminder12h", "shiftReminder2h", "quietHoursEnabled",
    "quietHoursStart", "quietHoursEnd"
  ]) assert.match(html, new RegExp(`name="${field}"`), `${field} tercihi eksik`);
  assert.doesNotMatch(html, /id="adminNotificationCategory"[\s\S]*?<\/select>[\s\S]{0,40}value="training"|name="trainingNotifications"/);
  assert.doesNotMatch(script, /trainingNotifications|training:\s*"Eğitim"|case\s+"training"/);
  assert.match(html, /styles\/notifications\.css/);
  assert.doesNotMatch(html, /adminNotificationTrigger[\s\S]{0,400}(?:fa-bell|flaticon|emoji)/i);
});

test("Bildirim merkezi canonical API, SSE ve polling fallback ile backend sonucunu kullanır", () => {
  assert.match(script, /ADMIN_NOTIFICATION_API\s*=\s*"\/api\/admin\/notifications"/);
  for (const endpoint of [
    "/unread-count", "/read-all", "/preferences", "/push-subscriptions", "/delivery-health", "/events", "/test"
  ]) assert.ok(script.includes(endpoint), `${endpoint} istemci bağlantısı eksik`);
  assert.match(script, /new EventSource\([^)]*ADMIN_NOTIFICATION_API[^)]*\/events/);
  assert.match(script, /startAdminNotificationPolling/);
  assert.match(script, /method:\s*"PATCH"/);
  assert.match(script, /data-notification-action="archive"/);
  assert.match(script, /loadAdminNotifications\(\)/);
});

test("Push izni yalnızca açık kullanıcı eylemi içinde istenir", () => {
  const permissionCalls = [...script.matchAll(/Notification\.requestPermission\s*\(/g)];
  assert.equal(permissionCalls.length, 1);
  const toggleStart = script.indexOf("async function toggleAdminPushSubscription");
  const toggleEnd = script.indexOf("function urlBase64ToUint8Array", toggleStart);
  assert.ok(permissionCalls[0].index > toggleStart && permissionCalls[0].index < toggleEnd);
  assert.match(script.slice(toggleStart, toggleEnd), /pushManager\.subscribe/);
  assert.match(script.slice(toggleStart, toggleEnd), /push-subscriptions/);
  assert.match(script, /detachAdminPushSubscription/);
  assert.match(script, /await detachAdminPushSubscription\(\)/);
});

test("Yönetici service worker push ve güvenli panel deep-link tıklamasını destekler", () => {
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /clients\.matchAll/);
  assert.match(serviceWorker, /safeAdminDeepLink/);
  assert.match(serviceWorker, /neverCachePrefixes:\s*\["\/api\/"/);
});

test("Bildirim deep-link'i yalnız panel içinde güvenle resolve edilir", () => {
  assert.match(script, /target\.origin === window\.location\.origin/);
  assert.match(script, /target\.pathname\.startsWith\("\/yonetici\/"\)/);
  assert.match(script, /searchParams\.get\("workforce"\)/);
  assert.match(script, /workforceTasksAccordion/);
  assert.match(script, /workforceShipmentsAccordion/);
  assert.match(script, /workforceShiftsAccordion/);
  assert.match(script, /normalizeAdminNotificationSection/);
  assert.match(script, /"personel"[\s\S]*return "staffAccess"/);
  assert.match(script, /"shipments"[\s\S]*return "stock"/);
});

test("Personel sahipliği dört akordiyonda kalır, sevkiyat Stok & Sevkiyat bölümünde tek kaynaktır", () => {
  const staffStart = html.indexOf('id="staffAccessCard"');
  const staffEnd = html.indexOf('</main>', staffStart);
  const staffMarkup = html.slice(staffStart, staffEnd);
  assert.ok(staffStart >= 0 && staffEnd > staffStart);
  assert.match(staffMarkup, /class="staff-step">1<\/span>[\s\S]*Personel Hesabı/);
  assert.match(staffMarkup, /class="staff-step">2<\/span>[\s\S]*Yapılacaklar/);
  assert.match(staffMarkup, /class="staff-step">3<\/span>[\s\S]*Shift Yönetimi/);
  assert.match(staffMarkup, /class="staff-step">4<\/span>[\s\S]*Kayıt Defteri/);
  assert.doesNotMatch(staffMarkup, /id="workforceShipmentsAccordion"/);
  assert.match(html, /id="stockCard"[\s\S]*Stok &amp; Sevkiyat[\s\S]*id="stockManagementAccordion"[\s\S]*id="workforceShipmentsAccordion"/);
  assert.equal((html.match(/id="workforceShipmentsPanel"/g) || []).length, 1);
  assert.match(html, /PASİF MODÜL: Eğitim \/ Görev \/ Sınav Atama/);
});

test("Yönetici gerçek zamanlı bağlantısı polling yedeğine geçer ve kontrollü yeniden bağlanır", () => {
  assert.match(script, /scheduleAdminNotificationReconnect/);
  assert.match(script, /notificationReconnectAttempt/);
  assert.match(script, /Math\.min\(30000/);
  assert.match(script, /startAdminNotificationPolling\(\)/);
  assert.match(script, /closeBackendEvents[\s\S]*notificationReconnectTimer/);
});

test("Bildirim çekmecesi mobil, odak ve azaltılmış hareket kurallarını korur", () => {
  assert.match(styles, /\.admin-notification-drawer\s*\{/);
  assert.match(styles, /width:\s*min\(440px/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(styles, /@media \(max-width:\s*720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /#adminNotificationCategory/);
  assert.match(styles, /#adminNotificationCategory[\s\S]*background-image/);
  assert.match(script, /handleAdminNotificationKeydown/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.key !== "Tab"/);
});
