"use strict";
// Persistent opaque sessions: raw tokens live only in the client cookie/Bearer header.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const SESSION_ROLES = new Set(["admin", "personel", "mudavim"]);
const PREVIEW_MODES = new Set(["menu", "recipe", "stock", "tasks", "shipment", "shift", "personel"]);
const PREVIEW_TTL_SECONDS = 5 * 60;
const PREVIEW_COOKIE_NAME = "tahmisci_preview_session";

function createAuthMiddleware(config, store) {
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new Error("Kalici oturumlar icin veri deposu gerekli.");
  }

  async function createAdminSession() {
    return createSession({ role: "admin", user: null });
  }

  async function createRecipeSession(user) {
    return createSession({ role: "personel", user });
  }

  async function createMudavimSession(user) {
    return createSession({ role: "mudavim", user });
  }

  async function createSession({ role, user }) {
    if (!SESSION_ROLES.has(role)) throw new Error("Gecersiz oturum rolu.");

    const token = `ths_${crypto.randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const record = {
      id: `session-${crypto.randomUUID()}`,
      tokenHash: hashToken(token),
      role,
      userId: user && user.id ? String(user.id) : null,
      username: user && user.username ? String(user.username) : "",
      name: user && user.name ? String(user.name) : "",
      createdAt: now,
      revokedAt: null
    };

    await store.update((data) => {
      data.authSessions = Array.isArray(data.authSessions) ? data.authSessions : [];
      data.authSessions.push(record);
      return data;
    });

    return { token, payload: payloadFromSession(record) };
  }

  async function requireAdmin(req, res, next) {
    try {
      const resolved = await resolveRequestSession(req, ["admin"], [cookieToken(req)]);
      if (!resolved) {
        return res.status(401).json({ ok: false, message: "Panel oturumu gerekli." });
      }

      setRequestSession(req, resolved, "admin");
      attachStoreTiming(req, res);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireAdminPage(req, res, next) {
    try {
      const resolved = await resolveRequestSession(req, ["admin"], [cookieToken(req)]);
      if (!resolved) {
        const nextUrl = encodeURIComponent(req.originalUrl || "/yonetici/");
        return res.redirect(302, `/login.html?next=${nextUrl}`);
      }

      setRequestSession(req, resolved, "admin");
      attachStoreTiming(req, res);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireRecipe(req, res, next) {
    try {
      const previewPayload = await verifyPreviewRequest(req);
      if (previewPayload) {
        req.recipe = previewPayload;
        if (req.previewToken && String(req.originalUrl || "").startsWith("/personel/recete-embed")) {
          res.cookie(PREVIEW_COOKIE_NAME, req.previewToken, {
            httpOnly: true,
            secure: Boolean(config.isProduction || config.cookieSecure),
            sameSite: "lax",
            path: "/personel/recete-embed",
            maxAge: PREVIEW_TTL_SECONDS * 1000
          });
        }
        attachStoreTiming(req, res);
        return next();
      }

      const resolved = await resolveRequestSession(req, ["admin", "personel"], [
        cookieToken(req),
        recipeCookieToken(req)
      ]);
      if (!resolved) {
        return res.status(401).json({ ok: false, message: "Recete oturumu gerekli." });
      }

      setRequestSession(req, resolved, "recipe");
      attachStoreTiming(req, res);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireActivePersonel(req, res, next) {
    try {
      const resolved = await resolveRequestSession(req, ["personel"], [recipeCookieToken(req)]);
      if (!resolved) {
        return res.status(401).json({ ok: false, message: "Personel oturumu gerekli." });
      }

      const userId = String(resolved.payload && resolved.payload.userId || "").trim();
      const context = await resolveStoreSnapshot(req);
      const user = context.indexes && context.indexes.recipeUserById
        ? context.indexes.recipeUserById.get(userId)
        : (Array.isArray(context.data.recipeUsers) ? context.data.recipeUsers : [])
          .find((item) => item && String(item.id || "") === userId);
      if (!userId || !user || user.active === false) {
        await revokeRequestSession(req, ["personel"]);
        clearRecipeCookie(res);
        return res.status(403).json({
          ok: false,
          message: "Aktif personel hesabı gerekli. Lütfen yeniden giriş yapın."
        });
      }

      setRequestSession(req, resolved, "recipe");
      req.recipeUser = user;
      req.recipe = Object.assign({}, req.recipe, {
        userId: String(user.id),
        username: String(user.username || ""),
        name: String(user.name || user.username || "")
      });
      attachStoreTiming(req, res);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireMudavim(req, res, next) {
    try {
      const resolved = await resolveRequestSession(req, ["mudavim"], [mudavimCookieToken(req)]);
      if (!resolved) return res.status(401).json({ ok: false, message: "Müdavim oturumu gerekli." });
      const userId = String(resolved.payload && resolved.payload.userId || "").trim();
      const context = await resolveStoreSnapshot(req);
      const user = (Array.isArray(context.data.mudavimAccounts) ? context.data.mudavimAccounts : [])
        .find((item) => item && String(item.id || "") === userId);
      if (!user || user.status !== "active" || !user.emailVerifiedAt) {
        await revokeRequestSession(req, ["mudavim"]);
        clearMudavimCookie(res);
        return res.status(403).json({ ok: false, message: "Doğrulanmış aktif Müdavim hesabı gerekli." });
      }
      setRequestSession(req, resolved, "mudavim");
      req.mudavimUser = user;
      attachStoreTiming(req, res);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requirePersonelOrPreview(req, res, next) {
    try {
      const previewPayload = await verifyPreviewRequest(req);
      if (!previewPayload) return requireActivePersonel(req, res, next);

      const context = await resolveStoreSnapshot(req);
      const user = (Array.isArray(context.data.recipeUsers) ? context.data.recipeUsers : [])
        .find((item) => item && item.active !== false && String(item.id || "").trim());
      if (!user) {
        return res.status(403).json({ ok: false, message: "Önizleme için aktif personel bulunamadı." });
      }

      req.recipeUser = user;
      req.recipe = Object.assign({}, previewPayload, {
        userId: String(user.id),
        username: String(user.username || ""),
        name: String(user.name || user.username || "")
      });
      if (req.previewToken && String(req.originalUrl || "").startsWith("/personel/recete-embed")) {
        res.cookie(PREVIEW_COOKIE_NAME, req.previewToken, {
          httpOnly: true,
          secure: Boolean(config.isProduction || config.cookieSecure),
          sameSite: "lax",
          path: "/personel/recete-embed",
          maxAge: PREVIEW_TTL_SECONDS * 1000
        });
      }
      attachStoreTiming(req, res);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function redirectIfAdmin(req, res, next) {
    try {
      const resolved = await resolveRequestSession(req, ["admin"], [cookieToken(req)]);
      if (resolved) return res.redirect(302, "/yonetici/");
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function attachAdminCookie(res, token) {
    res.cookie(config.adminCookieName, token, persistentCookieOptions(config));
  }

  function attachRecipeCookie(res, token) {
    res.cookie(config.recipeCookieName, token, persistentCookieOptions(config));
  }

  function attachMudavimCookie(res, token) {
    res.cookie(config.mudavimCookieName, token, persistentCookieOptions(config));
  }

  function clearAdminCookie(res) {
    res.clearCookie(config.adminCookieName, clearCookieOptions(config));
  }

  function clearRecipeCookie(res) {
    res.clearCookie(config.recipeCookieName, clearCookieOptions(config));
  }

  function clearMudavimCookie(res) {
    res.clearCookie(config.mudavimCookieName, clearCookieOptions(config));
  }

  async function verifyRequest(req) {
    const resolved = await resolveRequestSession(req, ["admin"], [cookieToken(req)]);
    if (!resolved) return null;
    setRequestSession(req, resolved, "admin");
    return req.admin;
  }

  async function verifyRecipeRequest(req) {
    const resolved = await resolveRequestSession(req, ["admin", "personel"], [
      cookieToken(req),
      recipeCookieToken(req)
    ]);
    if (!resolved) return null;
    setRequestSession(req, resolved, "recipe");
    return req.recipe;
  }

  async function sessionInfoFromToken(token) {
    const resolved = await resolveToken(token, ["admin", "personel", "mudavim"], await resolveStoreSnapshot());
    return resolved ? sessionInfoFromPayload(resolved.payload) : emptySessionInfo();
  }

  function signPreviewToken(mode, adminSessionId) {
    const normalizedMode = String(mode || "").trim().toLowerCase();
    const normalizedSessionId = String(adminSessionId || "").trim();
    if (!PREVIEW_MODES.has(normalizedMode) || !normalizedSessionId) {
      throw new Error("Gecersiz onizleme oturumu.");
    }
    return jwt.sign(
      { sub: normalizedSessionId, role: "preview", sessionRole: "admin", mode: normalizedMode },
      config.jwtSecret,
      {
        expiresIn: PREVIEW_TTL_SECONDS,
        issuer: config.jwtIssuer,
        audience: `${config.jwtAudience}:preview`
      }
    );
  }

  function previewTokenInfo(token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret, {
        issuer: config.jwtIssuer,
        audience: `${config.jwtAudience}:preview`
      });
      const mode = String(payload.mode || "");
      if (payload.role !== "preview" || payload.sessionRole !== "admin" || !PREVIEW_MODES.has(mode)) {
        return { mode: "", expiresAt: null, sessionId: "" };
      }
      return {
        mode,
        expiresAt: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null,
        sessionId: String(payload.sub || "")
      };
    } catch (_error) {
      return { mode: "", expiresAt: null, sessionId: "" };
    }
  }

  function sessionInfoFromPayload(payload) {
    return {
      expiresAt: null,
      issuedAt: payload && payload.createdAt ? payload.createdAt : null,
      ttlSeconds: null,
      persistent: true
    };
  }

  async function revokeRequestSession(req, roles = ["admin", "personel", "mudavim"]) {
    const allowedRoles = new Set(roles);
    const tokens = uniqueTokens([
      bearerToken(req),
      cookieToken(req),
      recipeCookieToken(req),
      mudavimCookieToken(req)
    ]);
    if (!tokens.length) return 0;

    const hashes = tokens.map(hashToken);
    let revoked = 0;
    await store.update((data) => {
      const now = new Date().toISOString();
      data.authSessions = (data.authSessions || []).map((session) => {
        if (session.revokedAt || !allowedRoles.has(session.role) || !hashes.some((hash) => safeHashEquals(hash, session.tokenHash))) {
          return session;
        }
        revoked += 1;
        return { ...session, revokedAt: now };
      });
      return data;
    });
    return revoked;
  }

  async function revokeRoleSessions(role) {
    return revokeMatchingSessions((session) => session.role === role);
  }

  async function revokeUserSessions(userId) {
    const normalizedUserId = String(userId || "");
    return revokeMatchingSessions((session) => session.role === "personel" && String(session.userId || "") === normalizedUserId);
  }

  async function revokeMudavimSessions(userId) {
    return revokeMatchingSessions((session) => session.role === "mudavim" && String(session.userId || "") === String(userId || ""));
  }

  async function revokeMatchingSessions(predicate) {
    let revoked = 0;
    await store.update((data) => {
      const now = new Date().toISOString();
      data.authSessions = (data.authSessions || []).map((session) => {
        if (session.revokedAt || !predicate(session)) return session;
        revoked += 1;
        return { ...session, revokedAt: now };
      });
      return data;
    });
    return revoked;
  }

  async function resolveRequestSession(req, roles, cookieCandidates) {
    const tokens = uniqueTokens([bearerToken(req), ...(cookieCandidates || [])]);
    const context = await resolveStoreSnapshot(req);
    for (const token of tokens) {
      const resolved = await resolveToken(token, roles, context);
      if (resolved) return resolved;
    }
    return null;
  }

  async function resolveToken(token, roles, context) {
    if (!token) return null;
    const allowedRoles = new Set(roles);
    const tokenHash = hashToken(token);
    const snapshot = context || await resolveStoreSnapshot();
    const indexed = snapshot.indexes && snapshot.indexes.sessionByTokenHash
      ? snapshot.indexes.sessionByTokenHash.get(tokenHash)
      : null;
    const session = indexed || (snapshot.data.authSessions || []).find((item) => safeHashEquals(tokenHash, item.tokenHash));
    if (session && (session.revokedAt || !allowedRoles.has(session.role))) return null;
    if (!session) return null;
    return { token, session, payload: payloadFromSession(session) };
  }

  async function verifyPreviewRequest(req) {
    if (String(req.method || "").toUpperCase() !== "GET") return null;
    const token = String(req.query && req.query.previewToken || previewCookieToken(req) || "").trim();
    if (!token) return null;
    try {
      const payload = jwt.verify(token, config.jwtSecret, {
        issuer: config.jwtIssuer,
        audience: `${config.jwtAudience}:preview`
      });
      if (payload.role !== "preview" || !PREVIEW_MODES.has(String(payload.mode || ""))) return null;
      if (!previewModeAllows(String(payload.mode), req.originalUrl || req.path || "")) return null;
      const context = await resolveStoreSnapshot(req);
      const adminSession = context.indexes && context.indexes.sessionById
        ? context.indexes.sessionById.get(String(payload.sub || ""))
        : (context.data.authSessions || []).find((session) => session.id === payload.sub);
      if (adminSession && (adminSession.role !== "admin" || adminSession.revokedAt)) return null;
      if (!adminSession) return null;
      req.previewToken = token;
      return {
        sub: String(payload.sub),
        role: "preview",
        sessionRole: "admin",
        previewRole: "admin",
        mode: String(payload.mode),
        createdAt: payload.iat ? new Date(Number(payload.iat) * 1000).toISOString() : null,
        expiresAt: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null
      };
    } catch (_error) {
      return null;
    }
  }

  function previewCookieToken(req) {
    if (!String(req.originalUrl || "").startsWith("/personel/recete-embed")) return "";
    const cookies = parseCookieHeader(req.header("Cookie") || "");
    return cookies[PREVIEW_COOKIE_NAME] || "";
  }

  function setRequestSession(req, resolved, target) {
    req.authSession = resolved.session;
    req.authToken = resolved.token;
    if (target === "admin") req.admin = resolved.payload;
    if (target === "recipe") req.recipe = resolved.payload;
    if (target === "mudavim") req.mudavim = resolved.payload;
  }

  async function resolveStoreSnapshot(req) {
    if (req && req.storeContext && req.storeSnapshot) return req.storeContext;
    if (typeof store.getRequestSnapshot === "function") return store.getRequestSnapshot(req);
    const data = await store.read();
    const context = { data, revision: Number(data && data.storeRevision || 0), indexes: null, timings: {} };
    if (req && typeof req === "object") {
      req.storeContext = context;
      req.storeSnapshot = data;
      req.storeRevision = context.revision;
      req.storeIndexes = null;
    }
    return context;
  }

  function attachStoreTiming(req, res) {
    if (config.performanceServerTiming === false || !res || typeof res.setHeader !== "function") return;
    const duration = Number(req && req.storeContext && req.storeContext.timings
      && req.storeContext.timings.snapshotResolveMs || 0);
    const value = `store;dur=${Number.isFinite(duration) ? Math.max(0, duration).toFixed(2) : "0.00"};desc="memory snapshot"`;
    const current = typeof res.getHeader === "function" ? res.getHeader("Server-Timing") : "";
    res.setHeader("Server-Timing", current ? `${current}, ${value}` : value);
  }

  function bearerToken(req) {
    const header = String(req.header("Authorization") || "");
    return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
  }

  function cookieToken(req) {
    const cookies = parseCookieHeader(req.header("Cookie") || "");
    return cookies[config.adminCookieName] || "";
  }

  function recipeCookieToken(req) {
    const cookies = parseCookieHeader(req.header("Cookie") || "");
    return cookies[config.recipeCookieName] || "";
  }

  function mudavimCookieToken(req) {
    const cookies = parseCookieHeader(req.header("Cookie") || "");
    return cookies[config.mudavimCookieName] || "";
  }

  return {
    attachAdminCookie,
    attachMudavimCookie,
    attachRecipeCookie,
    clearAdminCookie,
    clearMudavimCookie,
    clearRecipeCookie,
    createAdminSession,
    createMudavimSession,
    createRecipeSession,
    redirectIfAdmin,
    requireAdmin,
    requireAdminPage,
    requireActivePersonel,
    requireMudavim,
    requirePersonel: requireActivePersonel,
    requirePersonelOrPreview,
    requireRecipe,
    revokeRequestSession,
    revokeRoleSessions,
    revokeMudavimSessions,
    revokeUserSessions,
    sessionInfoFromPayload,
    sessionInfoFromToken,
    signPreviewToken,
    previewTokenInfo,
    verifyRecipeRequest,
    verifyRequest
  };
}

function payloadFromSession(session) {
  const personel = session.role === "personel";
  const mudavim = session.role === "mudavim";
  return {
    sub: personel ? String(session.userId || "recipe") : mudavim ? String(session.userId || "mudavim") : "admin",
    role: personel ? "recipe" : mudavim ? "mudavim" : "admin",
    sessionRole: session.role,
    sessionId: session.id,
    userId: (personel || mudavim) && session.userId ? String(session.userId) : undefined,
    username: (personel || mudavim) ? String(session.username || "") : undefined,
    name: (personel || mudavim) ? String(session.name || "") : undefined,
    createdAt: session.createdAt || null
  };
}

function persistentCookieOptions(config) {
  return {
    httpOnly: true,
    secure: Boolean(config.isProduction || config.cookieSecure),
    sameSite: config.cookieSameSite || "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS
  };
}

function clearCookieOptions(config) {
  return {
    httpOnly: true,
    secure: Boolean(config.isProduction || config.cookieSecure),
    sameSite: config.cookieSameSite || "lax",
    path: "/"
  };
}

function parseCookieHeader(header) {
  const cookies = {};
  String(header || "").split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_error) {
      cookies[key] = value;
    }
  });
  return cookies;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function safeHashEquals(first, second) {
  const left = Buffer.from(String(first || ""), "utf8");
  const right = Buffer.from(String(second || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function uniqueTokens(tokens) {
  return [...new Set(tokens.map((token) => String(token || "").trim()).filter(Boolean))];
}

function emptySessionInfo() {
  return { expiresAt: null, issuedAt: null, ttlSeconds: null, persistent: false };
}

function previewModeAllows(mode, requestPath) {
  const pathname = String(requestPath || "").split("?")[0];
  if (pathname === "/api/recipe/me") return mode !== "menu";
  if (mode === "personel") {
    return ["/api/recipes", "/api/stock", "/api/workforce/me", "/personel/recete-embed"].some((prefix) => pathname.startsWith(prefix));
  }
  if (mode === "recipe") return pathname.startsWith("/api/recipes") || pathname.startsWith("/personel/recete-embed");
  if (mode === "stock") return pathname.startsWith("/api/stock");
  if (["tasks", "shipment", "shift"].includes(mode)) return pathname.startsWith("/api/workforce/me");
  return false;
}

module.exports = { createAuthMiddleware };
