"use strict";

const defaultFs = require("fs/promises");
const path = require("path");
const { performance, monitorEventLoopDelay } = require("perf_hooks");
const bcrypt = require("bcryptjs");
const { migrateStore, STORE_SCHEMA_VERSION } = require("./migrations");

const NO_CHANGE = Symbol("TAHMISCI_FILE_STORE_NO_CHANGE");

/**
 * Revision controlled, copy-on-write file store.
 * Normal reads resolve the immutable in-memory snapshot. Disk reads only happen
 * at startup, durable-write readback, or when a throttled external-change check
 * observes a different file version.
 */
function createFileStore(filePath, options = {}) {
  const fs = options.fsPromises || defaultFs;
  const bcryptRounds = Number(options.bcryptRounds || 12);
  const defaultPanelPassword = String(options.defaultPanelPassword || "");
  const defaultRecipePassword = String(options.defaultRecipePassword || defaultPanelPassword || "");
  const externalCheckIntervalMs = clampNumber(options.externalCheckIntervalMs, 1000, 100, 60000);
  let writeQueue = Promise.resolve();
  let initializePromise = null;
  let refreshPromise = null;
  let snapshotContext = null;
  let lastStatCheckAt = 0;

  const metrics = {
    diskReadCount: 0,
    diskWriteCount: 0,
    snapshotResolveCount: 0,
    requestSnapshotResolveCount: 0,
    refreshCheckCount: 0,
    externalRefreshCount: 0,
    noOpUpdateCount: 0,
    parseMs: 0,
    migrateMs: 0,
    stringifyMs: 0,
    durableWriteMs: 0,
    writeQueueWaitMs: 0,
    lastParseMs: 0,
    lastMigrateMs: 0,
    lastStringifyMs: 0,
    lastDurableWriteMs: 0,
    lastWriteQueueWaitMs: 0
  };
  const eventLoopHistogram = options.enableEventLoopMetrics === false
    ? null
    : monitorEventLoopDelay({ resolution: clampNumber(options.eventLoopResolutionMs, 20, 10, 100) });
  if (eventLoopHistogram) eventLoopHistogram.enable();

  const store = {
    NO_CHANGE,
    filePath,
    ensure,
    read,
    getSnapshot,
    getRequestSnapshot,
    update,
    drain,
    refresh: () => refreshIfChanged(true),
    noChange: () => NO_CHANGE,
    getMetrics,
    resetMetrics,
    close
  };

  return store;

  async function ensure() {
    if (snapshotContext) return snapshotContext.data;
    if (initializePromise) return (await initializePromise).data;
    initializePromise = initializeStore();
    try {
      return (await initializePromise).data;
    } finally {
      initializePromise = null;
    }
  }

  async function initializeStore() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let exists = true;
    try {
      await fs.access(filePath);
    } catch (_error) {
      exists = false;
    }

    if (!exists) {
      if (!defaultPanelPassword) {
        throw new Error("Ilk admin sifresi icin DEFAULT_PANEL_PASSWORD ortam degiskeni zorunludur.");
      }
      const passwordHash = await bcrypt.hash(defaultPanelPassword, bcryptRounds);
      const recipePasswordHash = defaultRecipePassword === defaultPanelPassword
        ? passwordHash
        : await bcrypt.hash(defaultRecipePassword, bcryptRounds);
      const initial = defaultStore(passwordHash, recipePasswordHash);
      initial.storeRevision = Math.max(1, Number(initial.storeRevision || 0));
      await durableWrite(initial);
    }

    const loaded = await loadFromDisk();
    let normalized = loaded.data;
    let changed = loaded.normalizedChanged;
    let stat = loaded.stat;
    let timings = loaded.timings;
    if (!normalized.admin || !normalized.admin.passwordHash) {
      if (!defaultPanelPassword) {
        throw new Error("Eksik admin hash'i onarmak icin DEFAULT_PANEL_PASSWORD ortam degiskeni zorunludur.");
      }
      normalized.admin = {
        ...(normalized.admin || {}),
        passwordHash: await bcrypt.hash(defaultPanelPassword, bcryptRounds),
        recipePasswordHash: defaultRecipePassword ? await bcrypt.hash(defaultRecipePassword, bcryptRounds) : "",
        updatedAt: new Date().toISOString()
      };
      changed = true;
    }
    if (!normalized.admin.recipePasswordHash) {
      normalized.admin.recipePasswordHash = normalized.admin.passwordHash;
      normalized.admin.recipeUpdatedAt = normalized.admin.updatedAt || new Date().toISOString();
      changed = true;
    }
    if (changed) {
      normalized.storeRevision = Math.max(1, Number(normalized.storeRevision || 0) + 1);
      await durableWrite(normalized);
      const readback = await loadFromDisk();
      normalized = readback.data;
      stat = readback.stat;
      timings = readback.timings;
    }
    snapshotContext = createSnapshotContext(normalized, stat, timings);
    lastStatCheckAt = Date.now();
    return snapshotContext;
  }

  async function read() {
    try {
      return (await getSnapshot()).data;
    } catch (error) {
      error.message = `Store dosyasi okunamadi: ${error.message}`;
      throw error;
    }
  }

  async function getSnapshot(snapshotOptions = {}) {
    if (!snapshotContext) await ensure();
    await refreshIfChanged(snapshotOptions.forceRefresh === true);
    metrics.snapshotResolveCount += 1;
    if (!snapshotContext) throw new Error("Store bellek snapshot'i hazirlanamadi.");
    return snapshotContext;
  }

  async function getRequestSnapshot(req) {
    if (req && req.storeContext && req.storeSnapshot && Number.isInteger(req.storeRevision)) {
      return req.storeContext;
    }
    const startedAt = performance.now();
    const context = await getSnapshot();
    metrics.requestSnapshotResolveCount += 1;
    const requestContext = Object.freeze({
      ...context,
      timings: Object.freeze({
        snapshotResolveMs: roundMs(performance.now() - startedAt),
        diskRefreshMs: context.timings && Number(context.timings.diskRefreshMs || 0) || 0
      })
    });
    if (req && typeof req === "object") {
      req.storeContext = requestContext;
      req.storeSnapshot = context.data;
      req.storeRevision = context.revision;
      req.storeIndexes = context.indexes;
      req.storePerformance = Object.freeze({ diskReadCount: 0, snapshotResolveCount: 1, revision: context.revision });
    }
    return requestContext;
  }

  async function update(mutator, updateOptions = {}) {
    if (typeof mutator !== "function") throw new TypeError("Store update mutator fonksiyonu gerekli.");
    const queuedAt = performance.now();
    const nextWrite = writeQueue.catch(() => {}).then(async () => {
      recordDuration("writeQueueWaitMs", "lastWriteQueueWaitMs", performance.now() - queuedAt);
      if (!snapshotContext) await ensure();
      await refreshIfChanged(true);
      const currentContext = snapshotContext;
      const expectedRevision = updateOptions.expectedRevision;
      if (expectedRevision !== undefined && Number(expectedRevision) !== currentContext.revision) {
        const conflict = new Error("Store revizyonu degisti; islem guncel veriyle yeniden denenmeli.");
        conflict.status = 409;
        conflict.code = "STORE_REVISION_CONFLICT";
        conflict.expectedRevision = Number(expectedRevision);
        conflict.actualRevision = currentContext.revision;
        throw conflict;
      }

      const draft = structuredClone(currentContext.data);
      const result = await mutator(draft, {
        revision: currentContext.revision,
        indexes: currentContext.indexes,
        noChange: NO_CHANGE
      });
      if (result === NO_CHANGE) {
        metrics.noOpUpdateCount += 1;
        return currentContext.data;
      }

      const candidate = result === undefined ? draft : result;
      const migrateStartedAt = performance.now();
      const committed = normalizeStore(candidate);
      recordDuration("migrateMs", "lastMigrateMs", performance.now() - migrateStartedAt);
      committed.storeRevision = currentContext.revision + 1;

      const shouldBackup = updateOptions.backupLabel
        && (typeof updateOptions.shouldBackup !== "function" || updateOptions.shouldBackup(currentContext.data));
      if (shouldBackup) await writeStoreBackup(currentContext.data, updateOptions.backupLabel);

      // The active memory snapshot changes only after durable rename and readback.
      await durableWrite(committed);
      const readback = await loadFromDisk();
      if (Number(readback.data.storeRevision || 0) !== committed.storeRevision) {
        throw new Error("Store durable write readback revizyonu dogrulanamadi.");
      }
      snapshotContext = createSnapshotContext(readback.data, readback.stat, readback.timings);
      lastStatCheckAt = Date.now();
      return snapshotContext.data;
    });

    writeQueue = nextWrite.catch(() => {});
    return nextWrite;
  }

  async function drain() {
    await writeQueue;
  }

  async function refreshIfChanged(force) {
    if (!snapshotContext) return { refreshed: false, diskRefreshMs: 0 };
    const now = Date.now();
    if (!force && now - lastStatCheckAt < externalCheckIntervalMs) return { refreshed: false, diskRefreshMs: 0 };
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const startedAt = performance.now();
      lastStatCheckAt = now;
      metrics.refreshCheckCount += 1;
      const stat = await fs.stat(filePath);
      if (sameFileVersion(snapshotContext, stat)) {
        return { refreshed: false, diskRefreshMs: roundMs(performance.now() - startedAt) };
      }
      const loaded = await loadFromDisk();
      // Preserve monotonic process revision for legacy/external writers.
      if (Number(loaded.data.storeRevision || 0) <= snapshotContext.revision) {
        loaded.data.storeRevision = snapshotContext.revision + 1;
      }
      snapshotContext = createSnapshotContext(loaded.data, loaded.stat, {
        ...loaded.timings,
        diskRefreshMs: roundMs(performance.now() - startedAt)
      });
      metrics.externalRefreshCount += 1;
      return { refreshed: true, diskRefreshMs: roundMs(performance.now() - startedAt) };
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function loadFromDisk() {
    const startedAt = performance.now();
    const content = await fs.readFile(filePath, "utf8");
    metrics.diskReadCount += 1;
    const parseStartedAt = performance.now();
    const raw = JSON.parse(content);
    const parseMs = performance.now() - parseStartedAt;
    recordDuration("parseMs", "lastParseMs", parseMs);
    const migrateStartedAt = performance.now();
    const data = normalizeStore(raw);
    const migrateMs = performance.now() - migrateStartedAt;
    recordDuration("migrateMs", "lastMigrateMs", migrateMs);
    const stat = await fs.stat(filePath);
    return {
      data,
      stat,
      normalizedChanged: data.schemaVersion !== raw.schemaVersion
        || Number(data.storeRevision || 0) !== Number(raw.storeRevision || 0),
      timings: {
        diskRefreshMs: roundMs(performance.now() - startedAt),
        parseMs: roundMs(parseMs),
        migrateMs: roundMs(migrateMs)
      }
    };
  }

  async function durableWrite(data) {
    const startedAt = performance.now();
    const stringifyStartedAt = performance.now();
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    recordDuration("stringifyMs", "lastStringifyMs", performance.now() - stringifyStartedAt);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmpPath, serialized, "utf8");
      await renameWithTransientRetry(tmpPath, filePath);
      metrics.diskWriteCount += 1;
      recordDuration("durableWriteMs", "lastDurableWriteMs", performance.now() - startedAt);
    } catch (error) {
      try { await fs.unlink(tmpPath); } catch (_cleanupError) { /* best effort */ }
      throw error;
    }
  }

  async function writeStoreBackup(data, label) {
    const backupRoot = path.join(path.dirname(filePath), "backups");
    const safeLabel = String(label || "store")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "store";
    const backupPath = path.join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeLabel}.json`);
    const tmpPath = `${backupPath}.${process.pid}.tmp`;
    await fs.mkdir(backupRoot, { recursive: true });
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await renameWithTransientRetry(tmpPath, backupPath);
    } catch (error) {
      try { await fs.unlink(tmpPath); } catch (_cleanupError) { /* best effort */ }
      throw error;
    }
  }

  async function renameWithTransientRetry(sourcePath, targetPath) {
    const delays = [25, 50, 100, 200, 400];
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(sourcePath, targetPath);
        return;
      } catch (error) {
        const transient = error && ["EPERM", "EBUSY", "EACCES"].includes(error.code);
        if (!transient || attempt >= delays.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  function createSnapshotContext(data, stat, timings = {}) {
    const frozenData = deepFreeze(data);
    return Object.freeze({
      data: frozenData,
      revision: Math.max(0, Math.trunc(Number(data && data.storeRevision || 0))),
      indexes: createIndexes(frozenData),
      loadedAt: new Date().toISOString(),
      mtimeMs: Number(stat && stat.mtimeMs || 0),
      fileSize: Number(stat && stat.size || 0),
      timings: Object.freeze({
        diskRefreshMs: roundMs(timings.diskRefreshMs),
        parseMs: roundMs(timings.parseMs),
        migrateMs: roundMs(timings.migrateMs)
      })
    });
  }

  function getMetrics() {
    return Object.freeze({
      ...metrics,
      revision: snapshotContext ? snapshotContext.revision : 0,
      snapshotLoadedAt: snapshotContext ? snapshotContext.loadedAt : null,
      snapshotFileSize: snapshotContext ? snapshotContext.fileSize : 0,
      eventLoopDelayP50Ms: histogramMs(eventLoopHistogram, 50),
      eventLoopDelayP95Ms: histogramMs(eventLoopHistogram, 95),
      eventLoopDelayMaxMs: eventLoopHistogram ? roundMs(eventLoopHistogram.max / 1e6) : 0
    });
  }

  function resetMetrics() {
    for (const key of Object.keys(metrics)) metrics[key] = 0;
    if (eventLoopHistogram) eventLoopHistogram.reset();
  }

  function close() {
    if (eventLoopHistogram) eventLoopHistogram.disable();
  }

  function recordDuration(totalKey, lastKey, value) {
    const duration = roundMs(value);
    metrics[totalKey] = roundMs(Number(metrics[totalKey] || 0) + duration);
    metrics[lastKey] = duration;
  }
}

function createIndexes(data) {
  const sessionByTokenHash = new Map();
  const sessionById = new Map();
  for (const session of Array.isArray(data.authSessions) ? data.authSessions : []) {
    if (!session || !session.id) continue;
    sessionById.set(String(session.id), session);
    if (session.tokenHash) sessionByTokenHash.set(String(session.tokenHash), session);
  }
  const recipeUserById = new Map();
  for (const user of Array.isArray(data.recipeUsers) ? data.recipeUsers : []) {
    if (user && user.id) recipeUserById.set(String(user.id), user);
  }
  return Object.freeze({ sessionByTokenHash, sessionById, recipeUserById });
}

function sameFileVersion(context, stat) {
  return Boolean(context
    && Math.abs(Number(context.mtimeMs || 0) - Number(stat && stat.mtimeMs || 0)) < 0.01
    && Number(context.fileSize || 0) === Number(stat && stat.size || 0));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function histogramMs(histogram, percentile) {
  if (!histogram || !histogram.count) return 0;
  return roundMs(histogram.percentile(percentile) / 1e6);
}

function roundMs(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : 0;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeStore(data) {
  return migrateStore(data);
}

function defaultStore(passwordHash, recipePasswordHash) {
  return normalizeStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    storeRevision: 0,
    menuState: { settings: {}, categories: [] },
    menuUpdatedAt: null,
    pricing: { schemaVersion: 1, types: [] },
    revisions: { publish: 0, pricing: 0, workforce: 0, procurement: 0 },
    idempotencyRequests: [],
    pricingAudit: [],
    dataImportMappings: { menu: [], pricing: [], recipe: [], stock: [] },
    dataImportDrafts: [],
    dataImportHistory: [],
    dataImportBackups: [],
    dataImportIdempotency: [],
    catalogMigrations: [],
    productCodeRegistry: { schemaVersion: 1, entries: [], conflicts: [] },
    recipeState: {},
    recipeUpdatedAt: null,
    recipeCatalog: [],
    recipeLinkReview: [],
    recipeUsers: [],
    mudavimAccounts: [],
    deletedRecipeUsers: [],
    recipeAssignments: [],
    recipeActivity: [],
    authSessions: [],
    passwordResetChallenges: [],
    emailVerificationChallenges: [],
    notifications: [],
    notificationPreferences: [],
    notificationOutbox: [],
    pushSubscriptions: [],
    notificationSchedulerState: {
      lastRunAt: null, leaseOwner: "", leaseExpiresAt: null, updatedAt: null,
      lastTickAt: null, lastReminderScanAt: null, lastOutboxRunAt: null,
      lastOutboxSuccessAt: null, reminderKeys: []
    },
    workforceTasks: [],
    workforceAssignments: [],
    workforceShipments: [],
    workforceShiftRequests: [],
    workforceShiftPlans: [],
    workforceShiftPlanRevisions: [],
    workforceShiftSettings: {
      morning: { startTime: "08:00", endTime: "16:00" },
      evening: { startTime: "16:00", endTime: "00:00" },
      updatedAt: null,
      updatedBy: null
    },
    workforceMigrationArchive: [],
    workforceMigrationState: { version: 1, schemaVersion: STORE_SCHEMA_VERSION, completed: true, archivedRecordCount: 0 },
    siteState: {},
    siteUpdatedAt: null,
    siteRevisions: [],
    feedbackItems: [],
    feedbackUpdatedAt: null,
    procurement: {
      version: 1,
      revision: 0,
      suppliers: [],
      supplierProductLinks: [],
      supplierIndependentProducts: [],
      documents: [],
      ledgerEntries: [],
      payments: [],
      auditEvents: [],
      idempotencyRecords: [],
      settings: {}
    },
    stockState: {},
    stockUpdatedAt: null,
    adminDefaults: { menuDesign: null, systemSettings: null },
    admin: {
      passwordHash,
      recipePasswordHash: recipePasswordHash || passwordHash,
      updatedAt: new Date().toISOString(),
      recipeUpdatedAt: new Date().toISOString()
    }
  });
}

module.exports = { NO_CHANGE, createFileStore, defaultStore, normalizeStore };
