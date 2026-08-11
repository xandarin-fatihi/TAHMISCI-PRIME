"use strict";
// Persistent opaque sessions: raw tokens live only in the client cookie/Bearer header.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const SESSION_ROLES = new Set(["admin", "personel"]);
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
      const data = await store.read();
      const user = (Array.isArray(data.recipeUsers) ? data.recipeUsers : [])
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
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requirePersonelOrPreview(req, res, next) {
    try {
      const previewPayload = await verifyPreviewRequest(req);
      if (!previewPayload) return requireActivePersonel(req, res, next);

      const data = await store.read();
      const user = (Array.isArray(data.recipeUsers) ? data.recipeUsers : [])
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

  function clearAdminCookie(res) {
    res.clearCookie(config.adminCookieName, clearCookieOptions(config));
  }

  function clearRecipeCookie(res) {
    res.clearCookie(config.recipeCookieName, clearCookieOptions(config));
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
    const resolved = await resolveToken(token, ["admin", "personel"]);
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

  async function revokeRequestSession(req, roles = ["admin", "personel"]) {
    const allowedRoles = new Set(roles);
    const tokens = uniqueTokens([
      bearerToken(req),
      cookieToken(req),
      recipeCookieToken(req)
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
    for (const token of tokens) {
      const resolved = await resolveToken(token, roles);
      if (resolved) return resolved;
    }
    return null;
  }

  async function resolveToken(token, roles) {
    if (!token) return null;
    const allowedRoles = new Set(roles);
    const tokenHash = hashToken(token);
    const data = await store.read();
    const session = (data.authSessions || []).find((item) => (
      !item.revokedAt
      && allowedRoles.has(item.role)
      && safeHashEquals(tokenHash, item.tokenHash)
    ));
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
      const data = await store.read();
      const adminSession = (data.authSessions || []).find((session) => (
        session.id === payload.sub && session.role === "admin" && !session.revokedAt
      ));
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

  return {
    attachAdminCookie,
    attachRecipeCookie,
    clearAdminCookie,
    clearRecipeCookie,
    createAdminSession,
    createRecipeSession,
    redirectIfAdmin,
    requireAdmin,
    requireAdminPage,
    requireActivePersonel,
    requirePersonel: requireActivePersonel,
    requirePersonelOrPreview,
    requireRecipe,
    revokeRequestSession,
    revokeRoleSessions,
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
  return {
    sub: personel ? String(session.userId || "recipe") : "admin",
    role: personel ? "recipe" : "admin",
    sessionRole: session.role,
    sessionId: session.id,
    userId: personel && session.userId ? String(session.userId) : undefined,
    username: personel ? String(session.username || "") : undefined,
    name: personel ? String(session.name || "") : undefined,
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
