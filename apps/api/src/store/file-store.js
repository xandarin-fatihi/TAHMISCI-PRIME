"use strict";

const fs = require("fs/promises");
const path = require("path");
const bcrypt = require("bcryptjs");
const { migrateStore, STORE_SCHEMA_VERSION } = require("./migrations");

function createFileStore(filePath, options = {}) {
  let writeQueue = Promise.resolve();
  const bcryptRounds = Number(options.bcryptRounds || 12);
  const defaultPanelPassword = String(options.defaultPanelPassword || "");
  const defaultRecipePassword = String(options.defaultRecipePassword || defaultPanelPassword || "");

  return {
    async ensure() {
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      try {
        await fs.access(filePath);
      } catch (_error) {
        if (!defaultPanelPassword) {
          throw new Error("Ilk admin sifresi icin DEFAULT_PANEL_PASSWORD ortam degiskeni zorunludur.");
        }

        const passwordHash = await bcrypt.hash(defaultPanelPassword, bcryptRounds);
        const recipePasswordHash = defaultRecipePassword === defaultPanelPassword
          ? passwordHash
          : await bcrypt.hash(defaultRecipePassword, bcryptRounds);
        await writeJson(defaultStore(passwordHash, recipePasswordHash));
      }

      const raw = await readRaw();
      const data = normalizeStore(raw);
      if (JSON.stringify(raw) !== JSON.stringify(data)) {
        await writeJson(data);
      }

      if (!data.admin || !data.admin.passwordHash) {
        if (!defaultPanelPassword) {
          throw new Error("Eksik admin hash'i onarmak icin DEFAULT_PANEL_PASSWORD ortam degiskeni zorunludur.");
        }

        data.admin = {
          ...(data.admin || {}),
          passwordHash: await bcrypt.hash(defaultPanelPassword, bcryptRounds),
          recipePasswordHash: defaultRecipePassword
            ? await bcrypt.hash(defaultRecipePassword, bcryptRounds)
            : "",
          updatedAt: new Date().toISOString()
        };
        await writeJson(normalizeStore(data));
      }

      if (!data.admin.recipePasswordHash) {
        data.admin.recipePasswordHash = data.admin.passwordHash;
        data.admin.recipeUpdatedAt = data.admin.updatedAt || new Date().toISOString();
        await writeJson(normalizeStore(data));
      }
    },

    async read() {
      try {
        return normalizeStore(await readRaw());
      } catch (error) {
        error.message = `Store dosyasi okunamadi: ${error.message}`;
        throw error;
      }
    },

    async update(mutator, updateOptions = {}) {
      const nextWrite = writeQueue.catch(() => {}).then(async () => {
        const current = await this.read();
        const shouldBackup = updateOptions.backupLabel
          && (typeof updateOptions.shouldBackup !== "function" || updateOptions.shouldBackup(current));
        if (shouldBackup) await writeStoreBackup(current, updateOptions.backupLabel);
        const mutated = await mutator(current);
        // Mutatorun son hali yalnızca burada canonical biçime dönüştürülür. Dönen
        // nesne, atomik rename ile diske yazılan nesnenin bizzat kendisidir; route
        // readback doğrulamasını başka bir ara migration kopyasıyla yapmamalıdır.
        const committed = normalizeStore(mutated === undefined ? current : mutated);
        await writeJson(committed);
        return committed;
      });

      writeQueue = nextWrite.catch(() => {});
      return nextWrite;
    },

    async drain() {
      await writeQueue;
    },

    filePath
  };

  async function readRaw() {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  }

  async function writeJson(data) {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
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
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, backupPath);
  }
}

function normalizeStore(data) {
  return migrateStore(data);
}

function defaultStore(passwordHash, recipePasswordHash) {
  return normalizeStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    menuState: { settings: {}, categories: [] },
    menuUpdatedAt: null,
    pricing: { schemaVersion: 1, types: [] },
    revisions: { publish: 0, pricing: 0, workforce: 0 },
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
    deletedRecipeUsers: [],
    recipeAssignments: [],
    recipeActivity: [],
    authSessions: [],
    passwordResetChallenges: [],
    notifications: [],
    notificationPreferences: [],
    notificationOutbox: [],
    pushSubscriptions: [],
    notificationSchedulerState: {
      lastRunAt: null,
      leaseOwner: "",
      leaseExpiresAt: null,
      updatedAt: null,
      lastTickAt: null,
      lastReminderScanAt: null,
      lastOutboxRunAt: null,
      lastOutboxSuccessAt: null,
      reminderKeys: []
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
    stockState: {},
    stockUpdatedAt: null,
    adminDefaults: {
      menuDesign: null,
      systemSettings: null
    },
    admin: {
      passwordHash,
      recipePasswordHash: recipePasswordHash || passwordHash,
      updatedAt: new Date().toISOString(),
      recipeUpdatedAt: new Date().toISOString()
    }
  });
}

module.exports = { createFileStore, defaultStore, normalizeStore };
