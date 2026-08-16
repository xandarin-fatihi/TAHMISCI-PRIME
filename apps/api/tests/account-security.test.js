"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assignUnverifiedAccountEmail,
  publicAccountSecurity,
  revokeAccountSessionsAndPush
} = require("../src/account-security-routes");
const { createMailService } = require("../src/mail-service");
const { migrateStore, STORE_SCHEMA_VERSION } = require("../src/store/migrations");

test("hesap güvenliği alanları ve challenge koleksiyonları kalıcı store'da normalize edilir", () => {
  const migrated = migrateStore({
    admin: { passwordHash: "admin-hash", email: "ADMIN@Example.Test" },
    recipeUsers: [{ id: "person-1", username: "barista", email: "Barista@Example.Test" }],
    passwordResetChallenges: [{
      id: "reset-example",
      scope: "personel",
      targetUserId: "person-1",
      identifierHash: "identifier-hash",
      emailHash: "email-hash",
      codeHash: "code-hash",
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: "2029-01-01T00:00:00.000Z"
    }],
    emailVerificationChallenges: [{
      id: "verify-example",
      scope: "personel",
      targetUserId: "person-1",
      destinationHash: "destination-hash",
      codeHash: "code-hash",
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: "2029-01-01T00:00:00.000Z"
    }]
  });

  assert.equal(migrated.schemaVersion, STORE_SCHEMA_VERSION);
  assert.equal(migrated.admin.email, "admin@example.test");
  assert.equal(migrated.admin.emailVerificationRequired, true);
  assert.equal(migrated.recipeUsers[0].emailNormalized, "barista@example.test");
  assert.equal(migrated.recipeUsers[0].emailVerifiedAt, null);
  assert.equal(migrated.passwordResetChallenges[0].identifierHash, "identifier-hash");
  assert.equal(migrated.emailVerificationChallenges[0].purpose, "email_verification");
  assert.deepEqual(migrated.securityAudit, []);
});

test("admin tarafından atanan personel e-postası benzersiz kalır ve eski doğrulama kodunu iptal eder", () => {
  const now = "2026-08-16T12:00:00.000Z";
  const first = {
    id: "person-1",
    email: "verified@example.test",
    emailNormalized: "verified@example.test",
    emailVerifiedAt: "2026-08-01T12:00:00.000Z",
    emailVerificationVersion: 2
  };
  const second = { id: "person-2", email: "other@example.test", emailNormalized: "other@example.test" };
  const data = {
    recipeUsers: [first, second],
    emailVerificationChallenges: [{ id: "verify-old", scope: "personel", targetUserId: "person-1", usedAt: null, revokedAt: null }]
  };

  const security = assignUnverifiedAccountEmail(data, "personel", first, "NEW@Example.Test", now);
  assert.equal(security.email, "verified@example.test");
  assert.equal(security.pendingEmail, "new@example.test");
  assert.equal(security.emailVerificationRequired, true);
  assert.equal(first.emailVerificationVersion, 3);
  assert.equal(data.emailVerificationChallenges[0].revokedAt, now);
  assert.throws(
    () => assignUnverifiedAccountEmail(data, "personel", first, "other@example.test", now),
    (error) => error && error.status === 409
  );
  assert.equal(publicAccountSecurity(first).pendingEmail, "new@example.test");
});

test("hesap güvenliği e-postası güvenli içerik ve taşıma seçenekleriyle gönderilir", async () => {
  let sent = null;
  const service = createMailService({
    smtpHost: "smtp.example.test",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "mailer@example.test",
    smtpPass: "secret",
    smtpFrom: "security@example.test"
  }, {
    transportFactory: () => ({
      sendMail: async (message) => {
        sent = message;
        return { messageId: "mail-1" };
      },
      close() {}
    })
  });

  await service.sendAccountSecurityCode({
    to: "USER@Example.Test",
    code: "123456",
    purpose: "password_reset",
    accountLabel: "<script>alert(1)</script>",
    ttlMinutes: 10
  });

  assert.equal(sent.to, "user@example.test");
  assert.equal(sent.disableFileAccess, true);
  assert.equal(sent.disableUrlAccess, true);
  assert.match(sent.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(sent.html, /<script>/);
  await service.close();
});

test("tüm cihazlardan çıkış yalnız hedef hesabın oturum ve push bağlarını iptal eder", () => {
  const now = "2026-08-16T14:00:00.000Z";
  const data = {
    authSessions: [
      { id: "target-session", role: "personel", userId: "person-1", revokedAt: null },
      { id: "other-session", role: "personel", userId: "person-2", revokedAt: null },
      { id: "admin-session", role: "admin", userId: null, revokedAt: null }
    ],
    pushSubscriptions: [
      { id: "target-device", ownerRole: "personnel", ownerId: "person-1", revokedAt: null },
      { id: "other-device", ownerRole: "personnel", ownerId: "person-2", revokedAt: null }
    ],
    notificationPreferences: [
      { ownerRole: "personnel", ownerId: "person-1", pushEnabled: true },
      { ownerRole: "personnel", ownerId: "person-2", pushEnabled: true }
    ]
  };

  revokeAccountSessionsAndPush(data, "personel", "person-1", now);

  assert.equal(data.authSessions[0].revokedAt, now);
  assert.equal(data.authSessions[1].revokedAt, null);
  assert.equal(data.authSessions[2].revokedAt, null);
  assert.equal(data.pushSubscriptions[0].revokedAt, now);
  assert.equal(data.pushSubscriptions[1].revokedAt, null);
  assert.equal(data.notificationPreferences[0].pushEnabled, false);
  assert.equal(data.notificationPreferences[1].pushEnabled, true);
});
