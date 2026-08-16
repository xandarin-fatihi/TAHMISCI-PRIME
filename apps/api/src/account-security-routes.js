"use strict";

const crypto = require("crypto");

const PUBLIC_RESET_MESSAGE = "Bilgiler kayıtlarımızla eşleşiyorsa doğrulama kodu gönderildi.";
const ACCOUNT_SCOPES = new Set(["admin", "personel"]);

function registerAccountSecurityRoutes(options) {
  const {
    app,
    store,
    auth,
    config,
    mailService,
    bcrypt,
    validatePassword,
    requireRequestOrigin,
    requestLimiter,
    confirmLimiter
  } = options;

  if (!app || !store || !auth || !config || !mailService || !bcrypt
    || typeof validatePassword !== "function" || typeof requireRequestOrigin !== "function"
    || typeof requestLimiter !== "function" || typeof confirmLimiter !== "function") {
    throw new TypeError("Hesap güvenliği rotaları için eksiksiz bağımlılıklar gerekli.");
  }

  const accountAuth = (req, res, next) => {
    const scope = lockedScope(req);
    if (!scope) return res.status(400).json({ ok: false, message: "Hesap kapsamı geçersiz." });
    if (!bodyScopeMatches(req, scope)) {
      return res.status(400).json({ ok: false, message: "Hesap kapsamı giriş ekranıyla eşleşmiyor." });
    }
    req.accountScope = scope;
    return scope === "admin" ? auth.requireAdmin(req, res, next) : auth.requireActivePersonel(req, res, next);
  };

  const securityHandler = async (req, res, next) => {
    try {
      const data = await requestStore(req, store);
      const account = resolveAuthenticatedAccount(data, req, req.accountScope);
      if (!account) return res.status(404).json({ ok: false, message: "Hesap bulunamadı." });
      return res.json({ ok: true, scope: req.accountScope, security: publicAccountSecurity(account) });
    } catch (error) {
      return next(error);
    }
  };

  const emailChangeHandler = async (req, res, next) => {
    try {
      const email = normalizeAccountEmail(req.body && req.body.email);
      if (!isEmailLike(email)) return res.status(400).json({ ok: false, message: "Geçerli bir e-posta adresi girin." });
      const now = new Date().toISOString();
      let security = null;
      await store.update((data) => {
        const account = resolveAuthenticatedAccount(data, req, req.accountScope);
        if (!account) throw httpError(404, "Hesap bulunamadı.");
        assertUniqueEmail(data, req.accountScope, email, accountIdentity(req.accountScope, account));
        applyPendingEmail(account, email, now);
        revokeEmailChallenges(data, req.accountScope, accountIdentity(req.accountScope, account), now);
        appendSecurityAudit(data, req, {
          action: "account_email_changed",
          scope: req.accountScope,
          accountId: accountIdentity(req.accountScope, account),
          result: "pending_verification",
          createdAt: now
        }, config);
        security = publicAccountSecurity(account);
        return data;
      });
      return res.json({ ok: true, scope: req.accountScope, security, message: "E-posta adresi doğrulama bekliyor." });
    } catch (error) {
      return next(error);
    }
  };

  const emailVerificationRequestHandler = async (req, res, next) => {
    try {
      if (!mailConfigured(config, mailService)) {
        return res.status(503).json({ ok: false, message: "E-posta gönderimi henüz yapılandırılmamış." });
      }
      const snapshot = await requestStore(req, store);
      const initialAccount = resolveAuthenticatedAccount(snapshot, req, req.accountScope);
      if (!initialAccount) return res.status(404).json({ ok: false, message: "Hesap bulunamadı." });
      const destination = normalizeAccountEmail(initialAccount.pendingEmail || initialAccount.emailNormalized || initialAccount.email);
      if (!isEmailLike(destination)) {
        return res.status(400).json({ ok: false, message: "Önce geçerli bir e-posta adresi ekleyin." });
      }

      const accountId = accountIdentity(req.accountScope, initialAccount);
      const activeChallenge = latestActiveChallenge(snapshot.emailVerificationChallenges, {
        purpose: "email_verification",
        scope: req.accountScope,
        targetUserId: accountId
      });
      const resendMs = config.emailVerificationResendSeconds * 1000;
      if (activeChallenge && Date.now() - Date.parse(activeChallenge.createdAt || 0) < resendMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((resendMs - (Date.now() - Date.parse(activeChallenge.createdAt))) / 1000));
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({ ok: false, retryAfterSeconds, message: `Yeni kod için ${retryAfterSeconds} saniye bekleyin.` });
      }

      const challengeId = `verify-${crypto.randomUUID()}`;
      const code = securityCode(config);
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + config.emailVerificationTtlMinutes * 60 * 1000).toISOString();
      const version = Math.max(0, Number(initialAccount.emailVerificationVersion || 0));
      const destinationHash = hashEmail(destination, config);
      const codeHash = hashChallengeCode({ challengeId, purpose: "email_verification", scope: req.accountScope, targetUserId: accountId, version, code }, config);

      await store.update((data) => {
        const account = resolveAuthenticatedAccount(data, req, req.accountScope);
        if (!account || accountIdentity(req.accountScope, account) !== accountId) throw httpError(404, "Hesap bulunamadı.");
        if (normalizeAccountEmail(account.pendingEmail || account.emailNormalized || account.email) !== destination
          || Number(account.emailVerificationVersion || 0) !== version) {
          throw httpError(409, "E-posta bilgisi değişti. Yeniden deneyin.");
        }
        revokeEmailChallenges(data, req.accountScope, accountId, createdAt);
        data.emailVerificationChallenges = (Array.isArray(data.emailVerificationChallenges) ? data.emailVerificationChallenges : []).concat({
          id: challengeId,
          purpose: "email_verification",
          scope: req.accountScope,
          targetUserId: accountId,
          destinationHash,
          codeHash,
          accountVersion: version,
          attempts: 0,
          expiresAt,
          createdAt,
          usedAt: null,
          revokedAt: null
        }).slice(-500);
        appendSecurityAudit(data, req, {
          action: "email_verification_requested",
          scope: req.accountScope,
          accountId,
          result: "queued",
          createdAt
        }, config);
        return data;
      });

      try {
        await sendSecurityCode(mailService, config, {
          to: destination,
          code,
          purpose: "email_verification",
          accountLabel: req.accountScope === "admin" ? "Yönetici hesabı" : "Personel hesabı",
          ttlMinutes: config.emailVerificationTtlMinutes
        });
      } catch (error) {
        await revokeChallengeAfterDeliveryFailure(store, "emailVerificationChallenges", challengeId, req, config, "email_verification_delivery_failed");
        return res.status(503).json({ ok: false, message: "Doğrulama e-postası gönderilemedi. Yapılandırmayı kontrol edin." });
      }

      return res.json({
        ok: true,
        challengeId,
        expiresAt,
        maskedEmail: maskEmail(destination),
        message: `Doğrulama kodu gönderildi. Kod ${config.emailVerificationTtlMinutes} dakika geçerlidir.`
      });
    } catch (error) {
      return next(error);
    }
  };

  const emailVerificationConfirmHandler = async (req, res, next) => {
    try {
      const challengeId = String(req.body && req.body.challengeId || "").trim();
      const code = String(req.body && req.body.code || "").replace(/\D/g, "");
      if (!/^verify-[a-f0-9-]{36}$/i.test(challengeId) || code.length !== 6) {
        return res.status(400).json({ ok: false, message: "Doğrulama bilgileri geçersiz." });
      }
      let outcome = { status: 400, message: "Doğrulama bilgileri geçersiz." };
      await store.update((data) => {
        const now = new Date().toISOString();
        const account = resolveAuthenticatedAccount(data, req, req.accountScope);
        if (!account) return data;
        const accountId = accountIdentity(req.accountScope, account);
        const challenge = (Array.isArray(data.emailVerificationChallenges) ? data.emailVerificationChallenges : [])
          .find((item) => item && item.id === challengeId);
        if (!challenge || challenge.usedAt || challenge.revokedAt || challenge.scope !== req.accountScope
          || String(challenge.targetUserId || "") !== accountId) return data;
        if (Date.parse(challenge.expiresAt || 0) <= Date.now()) {
          challenge.revokedAt = now;
          outcome = { status: 400, message: "Doğrulama kodunun süresi doldu. Yeni kod isteyin." };
          appendSecurityAudit(data, req, { action: "email_verification_failed", scope: req.accountScope, accountId, result: "expired", createdAt: now }, config);
          return data;
        }
        challenge.attempts = Number(challenge.attempts || 0) + 1;
        if (challenge.attempts > config.emailVerificationMaxAttempts) {
          challenge.revokedAt = now;
          outcome = { status: 429, message: "Çok fazla hatalı deneme yapıldı. Yeni kod isteyin." };
          appendSecurityAudit(data, req, { action: "email_verification_locked", scope: req.accountScope, accountId, result: "blocked", createdAt: now }, config);
          return data;
        }
        const version = Math.max(0, Number(account.emailVerificationVersion || 0));
        const expectedHash = hashChallengeCode({ challengeId, purpose: "email_verification", scope: req.accountScope, targetUserId: accountId, version, code }, config);
        const destination = normalizeAccountEmail(account.pendingEmail || account.emailNormalized || account.email);
        if (!safeEqual(challenge.codeHash, expectedHash) || challenge.destinationHash !== hashEmail(destination, config)
          || Number(challenge.accountVersion || 0) !== version) {
          outcome = { status: 401, message: "Doğrulama kodu hatalı." };
          appendSecurityAudit(data, req, { action: "email_verification_failed", scope: req.accountScope, accountId, result: "invalid_code", createdAt: now }, config);
          return data;
        }
        account.email = destination;
        account.emailNormalized = destination;
        account.pendingEmail = "";
        account.emailVerifiedAt = now;
        account.emailVerificationRequired = false;
        account.updatedAt = now;
        challenge.usedAt = now;
        syncVerifiedNotificationEmail(data, req.accountScope, accountId, destination, now);
        appendSecurityAudit(data, req, { action: "email_verified", scope: req.accountScope, accountId, result: "success", createdAt: now }, config);
        outcome = { status: 200, message: "E-posta adresi doğrulandı.", security: publicAccountSecurity(account) };
        return data;
      });
      if (outcome.status !== 200) return res.status(outcome.status).json({ ok: false, message: outcome.message });
      return res.json({ ok: true, message: outcome.message, security: outcome.security });
    } catch (error) {
      return next(error);
    }
  };

  const revokeAllSessionsHandler = async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      let accountId = "";
      await store.update((data) => {
        const account = resolveAuthenticatedAccount(data, req, req.accountScope);
        if (!account) throw httpError(404, "Hesap bulunamadı.");
        accountId = accountIdentity(req.accountScope, account);
        revokeAccountSessionsAndPush(data, req.accountScope, accountId, now);
        appendSecurityAudit(data, req, {
          action: "account_sessions_revoked",
          scope: req.accountScope,
          accountId,
          result: "success",
          createdAt: now
        }, config);
        return data;
      });
      if (req.accountScope === "admin") auth.clearAdminCookie(res);
      else auth.clearRecipeCookie(res);
      res.set("Cache-Control", "no-store");
      return res.json({
        ok: true,
        message: "Tüm cihazlardaki oturumlar ve bildirim bağlantıları kapatıldı.",
        redirectTo: req.accountScope === "admin" ? "/yonetici/" : "/personel/"
      });
    } catch (error) {
      return next(error);
    }
  };

  registerAuthenticatedRoutes(app, requireRequestOrigin, accountAuth, {
    securityHandler,
    emailChangeHandler,
    emailVerificationRequestHandler,
    emailVerificationConfirmHandler,
    revokeAllSessionsHandler,
    requestLimiter,
    confirmLimiter
  });

  const resetRequest = (scope) => async (req, res, next) => {
    try {
      if (!bodyScopeMatches(req, scope)) {
        return res.status(400).json({ ok: false, message: "Hesap kapsamı giriş ekranıyla eşleşmiyor." });
      }
      if (!mailConfigured(config, mailService)) {
        return res.status(503).json({ ok: false, message: "E-posta ile parola sıfırlama henüz yapılandırılmamış." });
      }
      const identifier = normalizeIdentifier(req.body && (req.body.identifier || req.body.username || req.body.email));
      const identifierHash = hashIdentifier(identifier, scope, config);
      const snapshot = await store.read();
      const match = resolveResetAccount(snapshot, scope, identifier, config);
      const targetUserId = match ? accountIdentity(scope, match.account) : "";
      const destination = match ? match.destination : "";
      const active = latestActiveChallenge(snapshot.passwordResetChallenges, { purpose: "password_reset", scope, identifierHash });
      const resendMs = config.passwordResetResendSeconds * 1000;
      if (active && Date.now() - Date.parse(active.createdAt || 0) < resendMs) {
        return res.json(publicResetResponse(active.id, scope, config));
      }

      const challengeId = `reset-${crypto.randomUUID()}`;
      const code = securityCode(config);
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + config.passwordResetCodeTtlMinutes * 60 * 1000).toISOString();
      const accountVersion = match ? Math.max(0, Number(match.account.emailVerificationVersion || 0)) : 0;
      const codeHash = hashChallengeCode({ challengeId, purpose: "password_reset", scope, targetUserId, version: accountVersion, code }, config);
      await store.update((data) => {
        revokeMatchingResetChallenges(data, scope, identifierHash, createdAt);
        data.passwordResetChallenges = (Array.isArray(data.passwordResetChallenges) ? data.passwordResetChallenges : []).concat({
          id: challengeId,
          purpose: "password_reset",
          scope,
          targetUserId,
          identifierHash,
          emailHash: destination ? hashEmail(destination, config) : hashEmail(`decoy-${challengeId}@invalid.local`, config),
          codeHash,
          accountVersion,
          attempts: 0,
          expiresAt,
          createdAt,
          usedAt: null,
          revokedAt: null
        }).slice(-500);
        appendSecurityAudit(data, req, {
          action: "password_reset_requested",
          scope,
          accountId: targetUserId,
          result: match ? "eligible" : "decoy",
          createdAt
        }, config);
        return data;
      });

      if (match && destination) {
        try {
          await sendSecurityCode(mailService, config, {
            to: destination,
            code,
            purpose: "password_reset",
            accountLabel: scope === "admin" ? "Yönetici hesabı" : "Personel hesabı",
            ttlMinutes: config.passwordResetCodeTtlMinutes
          });
        } catch (error) {
          await revokeChallengeAfterDeliveryFailure(store, "passwordResetChallenges", challengeId, req, config, "password_reset_delivery_failed");
          // Hesabın varlığını SMTP sonucundan da çıkarsatmayız. İstek her
          // durumda aynı genel yanıtı verir; hata yalnız güvenlik audit'ine yazılır.
        }
      }
      return res.json(publicResetResponse(challengeId, scope, config));
    } catch (error) {
      return next(error);
    }
  };

  const resetConfirm = (scope) => async (req, res, next) => {
    try {
      if (!bodyScopeMatches(req, scope)) {
        return res.status(400).json({ ok: false, message: "Hesap kapsamı giriş ekranıyla eşleşmiyor." });
      }
      const challengeId = String(req.body && req.body.challengeId || "").trim();
      const code = String(req.body && req.body.code || "").replace(/\D/g, "");
      const newPassword = String(req.body && req.body.newPassword || "");
      if (!/^reset-[a-f0-9-]{36}$/i.test(challengeId) || code.length !== 6) {
        return res.status(400).json({ ok: false, message: "Doğrulama bilgileri geçersiz." });
      }
      const passwordError = validatePassword(newPassword);
      if (passwordError) return res.status(400).json({ ok: false, message: passwordError });
      const preliminary = await store.read();
      const passwordHash = resetChallengeMatches(preliminary, scope, challengeId, code, config)
        ? await bcrypt.hash(newPassword, config.bcryptRounds)
        : "";
      let outcome = { status: 400, message: "Doğrulama bilgileri geçersiz." };
      await store.update((data) => {
        const now = new Date().toISOString();
        const challenge = (Array.isArray(data.passwordResetChallenges) ? data.passwordResetChallenges : [])
          .find((item) => item && item.id === challengeId);
        if (!challenge || challenge.usedAt || challenge.revokedAt || challenge.scope !== scope || challenge.purpose !== "password_reset") return data;
        if (Date.parse(challenge.expiresAt || 0) <= Date.now()) {
          challenge.revokedAt = now;
          outcome = { status: 400, message: "Doğrulama kodunun süresi doldu. Yeni kod isteyin." };
          appendSecurityAudit(data, req, { action: "password_reset_failed", scope, accountId: challenge.targetUserId, result: "expired", createdAt: now }, config);
          return data;
        }
        challenge.attempts = Number(challenge.attempts || 0) + 1;
        if (challenge.attempts > config.passwordResetMaxAttempts) {
          challenge.revokedAt = now;
          outcome = { status: 429, message: "Çok fazla hatalı deneme yapıldı. Yeni kod isteyin." };
          appendSecurityAudit(data, req, { action: "password_reset_locked", scope, accountId: challenge.targetUserId, result: "blocked", createdAt: now }, config);
          return data;
        }
        const target = resolveChallengeAccount(data, scope, challenge.targetUserId, config);
        const version = target ? Math.max(0, Number(target.account.emailVerificationVersion || 0)) : Number(challenge.accountVersion || 0);
        const expected = hashChallengeCode({ challengeId, purpose: "password_reset", scope, targetUserId: String(challenge.targetUserId || ""), version, code }, config);
        if (!passwordHash || !target || !safeEqual(challenge.codeHash, expected) || Number(challenge.accountVersion || 0) !== version) {
          outcome = { status: 401, message: "Doğrulama kodu hatalı." };
          appendSecurityAudit(data, req, { action: "password_reset_failed", scope, accountId: challenge.targetUserId, result: "invalid_code", createdAt: now }, config);
          return data;
        }

        target.account[target.passwordField] = passwordHash;
        target.account.lastPasswordResetAt = now;
        target.account[target.updatedAtField] = now;
        revokeAccountSessionsAndPush(data, scope, accountIdentity(scope, target.account), now);
        challenge.usedAt = now;
        revokeOtherResetChallenges(data, scope, challenge.targetUserId, challenge.id, now);
        appendSecurityAudit(data, req, { action: "password_reset_completed", scope, accountId: accountIdentity(scope, target.account), result: "success", createdAt: now }, config);
        outcome = {
          status: 200,
          message: scope === "admin" ? "Yönetici parolası güncellendi." : "Personel parolası güncellendi.",
          redirectTo: scope === "admin" ? "/login.html" : "/personel/"
        };
        return data;
      });
      if (outcome.status !== 200) return res.status(outcome.status).json({ ok: false, message: outcome.message });
      if (scope === "admin") auth.clearAdminCookie(res);
      else auth.clearRecipeCookie(res);
      return res.json({ ok: true, message: outcome.message, redirectTo: outcome.redirectTo });
    } catch (error) {
      return next(error);
    }
  };

  app.post("/api/account/password-reset/admin/request", requireRequestOrigin, requestLimiter, resetRequest("admin"));
  app.post("/api/account/password-reset/admin/confirm", requireRequestOrigin, confirmLimiter, resetConfirm("admin"));
  app.post("/api/account/password-reset/personel/request", requireRequestOrigin, requestLimiter, resetRequest("personel"));
  app.post("/api/account/password-reset/personel/confirm", requireRequestOrigin, confirmLimiter, resetConfirm("personel"));

  // Geriye uyumlu Yönetici yolu kaynak kapsamını sunucu tarafında kilitler.
  app.post("/api/admin/password-reset/request", requireRequestOrigin, requestLimiter, resetRequest("admin"));
  app.post("/api/admin/password-reset/confirm", requireRequestOrigin, confirmLimiter, resetConfirm("admin"));
}

function registerAuthenticatedRoutes(app, origin, accountAuth, handlers) {
  for (const scope of ACCOUNT_SCOPES) {
    const lock = (req, _res, next) => {
      req.lockedAccountScope = scope;
      next();
    };
    app.get(`/api/account/${scope}/security`, origin, lock, accountAuth, handlers.securityHandler);
    app.post(`/api/account/${scope}/email/change`, origin, lock, accountAuth, handlers.emailChangeHandler);
    app.post(`/api/account/${scope}/email-verification/request`, origin, handlers.requestLimiter, lock, accountAuth, handlers.emailVerificationRequestHandler);
    app.post(`/api/account/${scope}/email-verification/confirm`, origin, handlers.confirmLimiter, lock, accountAuth, handlers.emailVerificationConfirmHandler);
    app.post(`/api/account/${scope}/sessions/revoke-all`, origin, handlers.confirmLimiter, lock, accountAuth, handlers.revokeAllSessionsHandler);
  }
}

function lockedScope(req) {
  const serverLocked = String(req.lockedAccountScope || "").trim().toLowerCase();
  return ACCOUNT_SCOPES.has(serverLocked) ? serverLocked : "";
}

function bodyScopeMatches(req, locked) {
  const supplied = String(req.body && req.body.scope || "").trim().toLowerCase();
  return !supplied || supplied === locked;
}

async function requestStore(req, store) {
  return req.storeContext && req.storeContext.data ? req.storeContext.data : store.read();
}

function resolveAuthenticatedAccount(data, req, scope) {
  if (scope === "admin") return data && data.admin || null;
  const userId = String(req.recipeUser && req.recipeUser.id || req.recipe && req.recipe.userId || "").trim();
  return (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
    .find((user) => user && String(user.id || "") === userId && user.active !== false) || null;
}

function resolveResetAccount(data, scope, identifier, config) {
  if (!identifier) return null;
  if (scope === "admin") {
    const account = data && data.admin || {};
    const verified = verifiedAccountEmail(account);
    if (verified && normalizeIdentifier(verified) === identifier) return { account, destination: verified };
    const emergency = normalizeAccountEmail(config.passwordResetEmail);
    if (emergency && normalizeIdentifier(emergency) === identifier) return { account, destination: emergency, emergency: true };
    return null;
  }
  const users = Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [];
  const account = users.find((user) => {
    if (!user || user.active === false) return false;
    const verified = verifiedAccountEmail(user);
    return normalizeIdentifier(user.username) === identifier || (verified && normalizeIdentifier(verified) === identifier);
  });
  const destination = account && verifiedAccountEmail(account);
  if (account && destination) return { account, destination, passwordField: "passwordHash", updatedAtField: "updatedAt" };
  const emergency = normalizeAccountEmail(config.passwordResetEmail);
  if (!users.length && data && data.admin && emergency && normalizeIdentifier(emergency) === identifier) {
    return {
      account: data.admin,
      destination: emergency,
      legacyPersonel: true,
      passwordField: "recipePasswordHash",
      updatedAtField: "recipeUpdatedAt"
    };
  }
  return null;
}

function resolveChallengeAccount(data, scope, accountId, config) {
  if (scope === "admin") {
    const account = data && data.admin || null;
    if (!account || accountId !== "manager") return null;
    const destination = verifiedAccountEmail(account) || normalizeAccountEmail(config.passwordResetEmail);
    return destination ? { account, destination, passwordField: "passwordHash", updatedAtField: "updatedAt" } : null;
  }
  if (String(accountId || "") === "legacy" && data && data.admin
    && !(Array.isArray(data.recipeUsers) && data.recipeUsers.length)) {
    const destination = normalizeAccountEmail(config.passwordResetEmail);
    return destination ? {
      account: data.admin,
      destination,
      legacyPersonel: true,
      passwordField: "recipePasswordHash",
      updatedAtField: "recipeUpdatedAt"
    } : null;
  }
  const account = (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
    .find((user) => user && user.active !== false && String(user.id || "") === String(accountId || ""));
  const destination = account && verifiedAccountEmail(account);
  return account && destination ? { account, destination, passwordField: "passwordHash", updatedAtField: "updatedAt" } : null;
}

function resetChallengeMatches(data, scope, challengeId, code, config) {
  const challenge = (Array.isArray(data && data.passwordResetChallenges) ? data.passwordResetChallenges : [])
    .find((item) => item && item.id === challengeId);
  if (!challenge || challenge.usedAt || challenge.revokedAt || challenge.scope !== scope
    || challenge.purpose !== "password_reset" || Date.parse(challenge.expiresAt || 0) <= Date.now()
    || Number(challenge.attempts || 0) >= config.passwordResetMaxAttempts) return false;
  const target = resolveChallengeAccount(data, scope, challenge.targetUserId, config);
  if (!target) return false;
  const version = Math.max(0, Number(target.account.emailVerificationVersion || 0));
  if (Number(challenge.accountVersion || 0) !== version) return false;
  const expected = hashChallengeCode({
    challengeId,
    purpose: "password_reset",
    scope,
    targetUserId: String(challenge.targetUserId || ""),
    version,
    code
  }, config);
  return safeEqual(challenge.codeHash, expected);
}

function verifiedAccountEmail(account) {
  if (!account || !account.emailVerifiedAt) return "";
  const email = normalizeAccountEmail(account.emailNormalized || account.email);
  return isEmailLike(email) ? email : "";
}

function accountIdentity(scope, account) {
  if (scope === "admin") return "manager";
  return String(account && account.id || "legacy").trim() || "legacy";
}

function publicAccountSecurity(account) {
  const email = normalizeAccountEmail(account && (account.emailNormalized || account.email));
  const pendingEmail = normalizeAccountEmail(account && account.pendingEmail);
  return {
    email,
    pendingEmail,
    emailVerifiedAt: account && account.emailVerifiedAt || null,
    emailVerificationRequired: Boolean(account && account.emailVerificationRequired) || !Boolean(account && account.emailVerifiedAt),
    lastPasswordResetAt: account && account.lastPasswordResetAt || null
  };
}

function applyPendingEmail(account, email, now) {
  const current = normalizeAccountEmail(account.emailNormalized || account.email);
  if (email === current && account.emailVerifiedAt) {
    account.pendingEmail = "";
    account.emailVerificationRequired = false;
    return;
  }
  account.emailVerificationVersion = Math.max(0, Number(account.emailVerificationVersion || 0)) + 1;
  if (current && account.emailVerifiedAt) {
    account.pendingEmail = email;
  } else {
    account.email = email;
    account.emailNormalized = email;
    account.pendingEmail = "";
    account.emailVerifiedAt = null;
  }
  account.emailVerificationRequired = true;
  account.updatedAt = now;
}

function assignUnverifiedAccountEmail(data, scope, account, rawEmail, now = new Date().toISOString()) {
  const email = normalizeAccountEmail(rawEmail);
  if (email && !isEmailLike(email)) throw httpError(400, "Geçerli bir e-posta adresi girin.");
  const accountId = accountIdentity(scope, account);
  if (email) {
    assertUniqueEmail(data, scope, email, accountId);
    applyPendingEmail(account, email, now);
  } else {
    const hadEmail = Boolean(account.email || account.emailNormalized || account.pendingEmail || account.emailVerifiedAt);
    account.email = "";
    account.emailNormalized = "";
    account.pendingEmail = "";
    account.emailVerifiedAt = null;
    account.emailVerificationRequired = true;
    if (hadEmail) {
      account.emailVerificationVersion = Math.max(0, Number(account.emailVerificationVersion || 0)) + 1;
      account.updatedAt = now;
    }
  }
  revokeEmailChallenges(data, scope, accountId, now);
  return publicAccountSecurity(account);
}

function assertUniqueEmail(data, scope, email, accountId) {
  const accounts = scope === "admin" ? [data.admin] : (Array.isArray(data.recipeUsers) ? data.recipeUsers : []);
  const duplicate = accounts.some((account) => {
    if (!account || accountIdentity(scope, account) === accountId) return false;
    return [account.emailNormalized, account.email, account.pendingEmail]
      .some((value) => normalizeAccountEmail(value) === email);
  });
  if (duplicate) throw httpError(409, "Bu e-posta adresi başka bir hesapta kullanılıyor.");
}

function revokeEmailChallenges(data, scope, targetUserId, revokedAt) {
  data.emailVerificationChallenges = (Array.isArray(data.emailVerificationChallenges) ? data.emailVerificationChallenges : []).map((item) => {
    if (!item || item.usedAt || item.revokedAt || item.scope !== scope || String(item.targetUserId || "") !== String(targetUserId || "")) return item;
    return { ...item, revokedAt };
  });
}

function revokeMatchingResetChallenges(data, scope, identifierHash, revokedAt) {
  data.passwordResetChallenges = (Array.isArray(data.passwordResetChallenges) ? data.passwordResetChallenges : []).map((item) => {
    if (!item || item.usedAt || item.revokedAt || item.scope !== scope || item.identifierHash !== identifierHash) return item;
    return { ...item, revokedAt };
  });
}

function revokeOtherResetChallenges(data, scope, targetUserId, usedChallengeId, revokedAt) {
  data.passwordResetChallenges = (Array.isArray(data.passwordResetChallenges) ? data.passwordResetChallenges : []).map((item) => {
    if (!item || item.id === usedChallengeId || item.usedAt || item.revokedAt || item.scope !== scope
      || String(item.targetUserId || "") !== String(targetUserId || "")) return item;
    return { ...item, revokedAt };
  });
}

function latestActiveChallenge(items, match) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || item.usedAt || item.revokedAt || Date.parse(item.expiresAt || 0) <= Date.now()) return false;
    return Object.entries(match).every(([key, value]) => item[key] === value);
  }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function syncVerifiedNotificationEmail(data, scope, accountId, email, updatedAt) {
  const ownerRole = scope === "admin" ? "manager" : "personnel";
  const ownerId = scope === "admin" ? "manager" : accountId;
  const preference = (Array.isArray(data.notificationPreferences) ? data.notificationPreferences : [])
    .find((item) => item && item.ownerRole === ownerRole && String(item.ownerId || "") === ownerId);
  if (preference) {
    preference.emailAddress = email;
    preference.updatedAt = updatedAt;
  }
}

function revokeAccountSessionsAndPush(data, scope, accountId, now) {
  const legacyPersonel = scope === "personel" && accountId === "legacy";
  data.authSessions = (Array.isArray(data.authSessions) ? data.authSessions : []).map((session) => {
    const matches = scope === "admin"
      ? session && session.role === "admin"
      : session && session.role === "personel" && (legacyPersonel
        ? !String(session.userId || "")
        : String(session.userId || "") === accountId);
    return matches && !session.revokedAt ? { ...session, revokedAt: now } : session;
  });
  const ownerRole = scope === "admin" ? "manager" : "personnel";
  const ownerId = scope === "admin" ? "manager" : accountId;
  data.pushSubscriptions = (Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : []).map((item) => {
    if (!item || item.ownerRole !== ownerRole || String(item.ownerId || "") !== ownerId || item.revokedAt) return item;
    return { ...item, revokedAt: now, disabledAt: item.disabledAt || now, updatedAt: now };
  });
  data.notificationPreferences = (Array.isArray(data.notificationPreferences) ? data.notificationPreferences : []).map((item) => {
    if (!item || item.ownerRole !== ownerRole || String(item.ownerId || "") !== ownerId) return item;
    return { ...item, pushEnabled: false, updatedAt: now };
  });
}

function appendSecurityAudit(data, req, event, config) {
  const ip = String(req.ip || req.socket && req.socket.remoteAddress || "");
  const ipHash = crypto.createHmac("sha256", config.jwtSecret).update(`security-ip:${ip}`).digest("hex").slice(0, 24);
  data.securityAudit = (Array.isArray(data.securityAudit) ? data.securityAudit : []).concat({
    id: `security-${crypto.randomUUID()}`,
    action: String(event.action || "security_event").slice(0, 100),
    scope: ACCOUNT_SCOPES.has(event.scope) ? event.scope : "",
    accountId: String(event.accountId || "").slice(0, 160),
    result: String(event.result || "recorded").slice(0, 80),
    ipHash,
    createdAt: event.createdAt || new Date().toISOString()
  }).slice(-2000);
}

async function revokeChallengeAfterDeliveryFailure(store, collection, challengeId, req, config, action) {
  await store.update((data) => {
    const now = new Date().toISOString();
    const challenge = (Array.isArray(data[collection]) ? data[collection] : []).find((item) => item && item.id === challengeId);
    if (challenge && !challenge.usedAt) challenge.revokedAt = now;
    appendSecurityAudit(data, req, { action, scope: challenge && challenge.scope, accountId: challenge && challenge.targetUserId, result: "failed", createdAt: now }, config);
    return data;
  });
}

function publicResetResponse(challengeId, scope, config) {
  return {
    ok: true,
    challengeId,
    scope,
    expiresInSeconds: config.passwordResetCodeTtlMinutes * 60,
    message: PUBLIC_RESET_MESSAGE
  };
}

function mailConfigured(config, mailService) {
  return Boolean((mailService && mailService.isConfigured && mailService.isConfigured()) || config.passwordResetTestCode);
}

async function sendSecurityCode(mailService, config, message) {
  if (config.nodeEnv === "test" && config.passwordResetTestCode) return { testMode: true };
  return mailService.sendAccountSecurityCode(message);
}

function securityCode(config) {
  return config.passwordResetTestCode || String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashIdentifier(identifier, scope, config) {
  return crypto.createHmac("sha256", config.jwtSecret).update(`reset-identifier:${scope}:${identifier}`).digest("hex");
}

function hashEmail(email, config) {
  return crypto.createHmac("sha256", config.jwtSecret).update(`account-email:${normalizeAccountEmail(email)}`).digest("hex");
}

function hashChallengeCode(input, config) {
  return crypto.createHmac("sha256", config.jwtSecret).update([
    input.challengeId,
    input.purpose,
    input.scope,
    input.targetUserId,
    String(input.version || 0),
    input.code
  ].join(":"), "utf8").digest("hex");
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function normalizeAccountEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").slice(0, 254);
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function maskEmail(email) {
  const [local = "", domain = ""] = normalizeAccountEmail(email).split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  applyPendingEmail,
  appendSecurityAudit,
  assignUnverifiedAccountEmail,
  assertUniqueEmail,
  normalizeAccountEmail,
  publicAccountSecurity,
  registerAccountSecurityRoutes,
  revokeAccountSessionsAndPush
};
