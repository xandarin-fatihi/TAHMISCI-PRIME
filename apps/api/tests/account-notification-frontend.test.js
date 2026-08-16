"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..", "..", "..");

test("yönetici ve personel girişleri yalnız kendi kapsamlarına kilitli şifre yenileme bağlantısı sunar", () => {
  const adminShell = read("apps/admin/index.html");
  const adminLogin = read("apps/auth/login.html");
  const personelShell = read("apps/personel/index.html");

  assert.equal(matches(adminShell, /Şifremi unuttum/g), 1);
  assert.equal(matches(adminLogin, /Şifremi unuttum/g), 1);
  assert.equal(matches(personelShell, /Şifremi unuttum/g), 1);
  assert.match(adminShell, /href="\/password-reset\/\?scope=admin&amp;returnTo=%2Fyonetici%2F"/);
  assert.match(adminLogin, /href="\/password-reset\/\?scope=admin&amp;returnTo=%2Fyonetici%2F"/);
  assert.match(personelShell, /href="\/password-reset\/\?scope=personel&amp;returnTo=%2Fpersonel%2F"/);
});

test("ortak şifre yenileme görünümü kapsamı değiştirtmez ve yalnız canonical scoped API kullanır", () => {
  const html = read("apps/auth/password-reset/index.html");
  const source = read("public/assets/scripts/password-reset.js");

  assert.match(html, /id="accountScope" type="hidden" value="admin"/);
  assert.match(html, /Bu kurtarma bağlantısı kilitlidir\./);
  assert.doesNotMatch(html, /name="scope"|type="radio"[^>]+scope/i);
  assert.doesNotMatch(`${html}\n${source}`, /personelAccounts|accountList|hesap listesi/i);
  assert.match(source, /`\/api\/account\/password-reset\/\$\{encodeURIComponent\(state\.scope\)\}\/\$\{action\}`/);
  assert.match(source, /if \(state\.scope === "admin"\) paths\.push\(`\/api\/admin\/password-reset\/\$\{action\}`\)/);
  assert.doesNotMatch(source, /`\/api\/(?:personel\/)?password-reset\//);
});

test("hesap güvenliği panelleri canonical e-posta doğrulama akışına bağlıdır", () => {
  const adminHtml = read("apps/admin/index.html");
  const personelHtml = read("apps/personel/index.html");
  const securitySource = read("shared/scripts/account-security.js");
  const adminSource = read("apps/admin/scripts/app.js");

  assert.match(adminHtml, /data-account-security data-account-scope="admin"/);
  assert.match(personelHtml, /data-account-security data-account-scope="personel"/);
  for (const html of [adminHtml, personelHtml]) {
    assert.match(html, /\/shared\/styles\/account-security\.css/);
    assert.match(html, /\/shared\/scripts\/account-security\.js/);
  }
  assert.match(securitySource, /`\/api\/account\/\$\{scope\}\/security`/);
  assert.match(securitySource, /`\/api\/account\/\$\{scope\}\/email\/change`/);
  assert.match(securitySource, /`\/api\/account\/\$\{scope\}\/email-verification\/request`/);
  assert.match(securitySource, /`\/api\/account\/\$\{scope\}\/email-verification\/confirm`/);
  assert.match(securitySource, /`\/api\/account\/\$\{scope\}\/sessions\/revoke-all`/);
  assert.match(adminHtml, /data-account-logout-all/);
  assert.match(personelHtml, /data-account-logout-all/);
  assert.match(adminHtml, /id="staffUserEmail" type="email"[^>]+required/);
  assert.match(adminSource, /email:\s*\(els\.staffUserEmail/);
});

test("iki bildirim merkezi gelen kutusu, arşiv, ayarlar ve cihaz yönetimini birlikte sunar", () => {
  const adminHtml = read("apps/admin/index.html");
  const adminSource = read("apps/admin/scripts/app.js");
  const personelHtml = read("apps/personel/index.html");
  const personelSource = read("apps/personel/notifications.js");

  assert.match(adminHtml, /data-notification-filter="archived"/);
  assert.match(adminHtml, /id="adminNotificationClearArchive"/);
  assert.match(adminHtml, /id="adminNotificationDevices"/);
  assert.match(personelHtml, /data-notification-view="archived"/);
  assert.match(personelHtml, /id="personelNotificationClearArchive"/);
  assert.match(personelHtml, /id="personelNotificationDevices"/);

  for (const source of [adminSource, personelSource]) {
    assert.match(source, /set\("includeArchived", "true"\)/);
    assert.match(source, /set\("archived", "true"\)/);
    assert.match(source, /\/archive`?,? \{ method: "DELETE"/);
    assert.match(source, /\/push-subscriptions/);
    assert.match(source, /\/push-subscriptions\/\$\{encodeURIComponent\(id\)\}/);
    assert.match(source, /emailVerified/);
    assert.match(source, /deviceId/);
  }
  assert.match(adminSource, /\$\{ADMIN_NOTIFICATION_API\}\/\$\{encodeURIComponent\(id\)\}\/\$\{action\}/);
  assert.match(personelSource, /\$\{API_ROOT\}\/\$\{encodeURIComponent\(notification\.id\)\}\/restore/);
  assert.match(personelSource, /method: "DELETE"/);
});

test("PWA kurulumu yalnız görünür kullanıcı eyleminden prompt çağırır", () => {
  const source = read("shared/scripts/pwa-client.js");
  const beforeInstall = between(source, "function handleBeforeInstallPrompt", "function showInstallReady");
  const requestInstall = between(source, "function requestInstall", "function handleAppInstalled");

  assert.match(source, /addEventListener\("beforeinstallprompt", handleBeforeInstallPrompt\)/);
  assert.match(beforeInstall, /event\.preventDefault\(\)/);
  assert.doesNotMatch(beforeInstall, /\.prompt\(\)/);
  assert.match(source, /actionLabel: "Uygulamayı Yükle"/);
  assert.match(source, /onAction: requestInstall/);
  assert.match(requestInstall, /const promptResult = promptEvent\.prompt\(\)/);
  assert.equal(matches(source, /promptEvent\.prompt\(\)/g), 1);
});

test("standalone bildirim tanıtımı yalnız kullanıcı seçimiyle izin akışını başlatır", () => {
  const pwaSource = read("shared/scripts/pwa-client.js");
  const adminSource = read("apps/admin/scripts/app.js");
  const personelSource = read("apps/personel/notifications.js");

  assert.match(pwaSource, /Görev, sevkiyat ve vardiya bildirimlerini telefonundan al\./);
  assert.match(pwaSource, /actionLabel: "Bildirimleri Aç"/);
  assert.match(pwaSource, /secondaryActionLabel: "Şimdi Değil"/);
  assert.match(pwaSource, /registerNotificationPrompt/);
  assert.doesNotMatch(pwaSource, /Notification\.requestPermission/);
  assert.match(adminSource, /registerNotificationPrompt/);
  assert.match(personelSource, /registerNotificationPrompt/);
  assert.match(adminSource, /Notification\.requestPermission\(\)/);
  assert.match(personelSource, /Notification\.requestPermission\(\)/);
});

test("değiştirilen tarayıcı scriptleri sözdizimsel olarak geçerlidir", () => {
  const scripts = [
    "public/assets/scripts/password-reset.js",
    "shared/scripts/account-security.js",
    "shared/scripts/pwa-client.js",
    "apps/personel/notifications.js",
    "apps/admin/scripts/app.js",
    "apps/admin/sw.js",
    "apps/personel/sw.js",
    "apps/qr-menu/sw.js"
  ];

  for (const relativeFile of scripts) {
    assert.doesNotThrow(() => new vm.Script(read(relativeFile), { filename: relativeFile }));
  }
});

function read(relativeFile) {
  return fs.readFileSync(path.join(projectRoot, relativeFile), "utf8");
}

function matches(value, pattern) {
  return (value.match(pattern) || []).length;
}

function between(value, start, end) {
  const startAt = value.indexOf(start);
  const endAt = value.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0 && endAt > startAt, `${start} bölümü bulunamadı`);
  return value.slice(startAt, endAt);
}
