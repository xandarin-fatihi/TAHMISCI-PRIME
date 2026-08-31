"use strict";

const crypto = require("crypto");
const { normalizeAppTarget, safeAppDeepLink } = require("../app-targets");
const { migrateSiteState } = require("../site-state");
const { migratePricingSystem } = require("../pricing");
const { normalizeAdminDefaults } = require("../admin-defaults");
const categoryIcons = require("../../../../shared/scripts/category-icons");
const {
  normalizeNameHistory,
  normalizeProductCode,
  normalizeProductCodeList,
  normalizeProductCodeRegistry,
  registryCodeForEntity
} = require("./product-code-registry");
const {
  FATURA_CAPABILITIES,
  FATURA_ROLES,
  normalizeSectionAccess
} = require("../procurement-access");
const { normalizePersonelSectionAccess } = require("../personel-section-access");

const STORE_SCHEMA_VERSION = 21;
const PROCUREMENT_SCHEMA_VERSION = 1;
const DEFAULT_FATURA_CAPABILITIES = Object.freeze([
  "supplier.read",
  "receipt.create",
  "receipt.submit",
  "documents.read",
  "documents.upload"
]);

function migrateStore(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalizedMenuState = normalizeMenuState(source.menuState);
  const pricingMigration = migratePricingSystem(source.pricing || normalizedMenuState.pricing, normalizedMenuState);
  const next = {
    ...source,
    schemaVersion: STORE_SCHEMA_VERSION,
    // Monotonic durable revision used by the in-memory snapshot and optimistic
    // concurrency guard. Legacy stores start at zero and are upgraded once by
    // FileStore.ensure without changing any domain revision.
    storeRevision: Math.max(0, Math.trunc(finiteNumber(source.storeRevision, 0))),
    menuState: pricingMigration.menuState,
    menuUpdatedAt: source.menuUpdatedAt || null,
    pricing: pricingMigration.pricing,
    revisions: normalizeStoreRevisions(source.revisions, source.pricingRevision),
    idempotencyRequests: normalizeArray(source.idempotencyRequests).slice(-500),
    pricingAudit: normalizeArray(source.pricingAudit).slice(-200),
    pricingImportDrafts: normalizeArray(source.pricingImportDrafts).slice(-20),
    dataImportMappings: normalizeDataImportMappings(source.dataImportMappings),
    dataImportDrafts: normalizeArray(source.dataImportDrafts).slice(-20),
    dataImportHistory: normalizeArray(source.dataImportHistory).slice(-100),
    dataImportBackups: normalizeArray(source.dataImportBackups).slice(-10),
    dataImportIdempotency: normalizeArray(source.dataImportIdempotency).slice(-500),
    catalogMigrations: normalizeCatalogMigrations(source.catalogMigrations),
    recipeState: normalizeRecipeState(source.recipeState),
    recipeUpdatedAt: source.recipeUpdatedAt || null,
    siteState: migrateSiteState(source.siteState),
    siteUpdatedAt: source.siteUpdatedAt || null,
    siteRevisions: normalizeRevisions(source.siteRevisions),
    feedbackItems: normalizeArray(source.feedbackItems),
    feedbackUpdatedAt: source.feedbackUpdatedAt || null,
    stockState: normalizeStockState(source.stockState),
    stockUpdatedAt: source.stockUpdatedAt || null,
    recipeUsers: normalizeRecipeUsers(source.recipeUsers),
    mudavimAccounts: normalizeMudavimAccounts(source.mudavimAccounts),
    recipeAssignments: normalizeArray(source.recipeAssignments),
    recipeActivity: normalizeArray(source.recipeActivity),
    authSessions: normalizeAuthSessions(source.authSessions),
    passwordResetChallenges: normalizePasswordResetChallenges(source.passwordResetChallenges),
    emailVerificationChallenges: normalizeEmailVerificationChallenges(source.emailVerificationChallenges),
    securityAudit: normalizeSecurityAudit(source.securityAudit),
    notifications: normalizeNotifications(source.notifications),
    notificationPreferences: normalizeNotificationPreferences(source.notificationPreferences || source.preferences),
    notificationOutbox: normalizeNotificationOutbox(source.notificationOutbox || source.outbox),
    pushSubscriptions: normalizePushSubscriptions(source.pushSubscriptions),
    notificationSchedulerState: normalizeNotificationSchedulerState(source.notificationSchedulerState || source.schedulerState),
    workforceTasks: normalizeWorkforceTasks(source.workforceTasks),
    workforceAssignments: normalizeWorkforceAssignments(source.workforceAssignments, source.workforceTasks),
    workforceShipments: normalizeArray(source.workforceShipments),
    workforceShiftRequests: normalizeWorkforceShiftRequests(source.workforceShiftRequests),
    workforceShiftPlans: normalizeWorkforceShiftPlans(source.workforceShiftPlans),
    workforceShiftPlanRevisions: normalizeWorkforceShiftPlanRevisions(source.workforceShiftPlanRevisions),
    workforceShiftSettings: normalizeWorkforceShiftSettings(source.workforceShiftSettings),
    workforceMigrationArchive: collectWorkforceMigrationArchive(source),
    deletedRecipeUsers: normalizeDeletedRecipeUsers(source.deletedRecipeUsers),
    procurement: normalizeProcurement(source.procurement),
    adminDefaults: normalizeAdminDefaults(source.adminDefaults),
    admin: normalizeAdmin(source.admin)
  };

  next.notificationPreferences = reconcileNotificationPreferenceEmails(next.notificationPreferences, next);
  clearLegacyUnverifiedPersonelAdminEmails(next);
  next.notificationOutbox = reconcileNotificationOutboxRecipients(next.notificationOutbox, next.notifications);
  next.recipeCatalog = reconcileRecipeCatalog(next.recipeState, source.recipeCatalog);
  next.workforceAssignments = reconcileWorkforceAssignments(next.workforceTasks, next.workforceAssignments, next.recipeUsers);
  next.workforceTasks = syncWorkforceTaskAssignees(next.workforceTasks, next.workforceAssignments);
  const linked = migrateMenuRecipeLinks(next.menuState, next.recipeCatalog, next.recipeState);
  next.menuState = linked.menuState;
  next.recipeLinkReview = linked.review;
  next.productCodeRegistry = normalizeProductCodeRegistry(source.productCodeRegistry, next);
  next.workforceShipments = normalizeWorkforceShipments(source.workforceShipments, next.stockState, next.productCodeRegistry);
  next.procurement = reconcileProcurementBranchMetadata(next.procurement, source.procurement, next.workforceShipments);
  markWorkforcePersonnelState(next);
  next.workforceMigrationState = {
    version: 1,
    schemaVersion: STORE_SCHEMA_VERSION,
    completed: true,
    archivedRecordCount: next.workforceMigrationArchive.length
  };
  return next;
}

function normalizeStoreRevisions(value, legacyPricingRevision) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const inventory = Math.max(0, Math.trunc(finiteNumber(source.inventory ?? source.stock, 0)));
  const catalog = Math.max(0, Math.trunc(finiteNumber(source.catalog ?? source.dataImportCatalog, 0)));
  return {
    ...source,
    publish: Math.max(0, Math.trunc(finiteNumber(source.publish, 0))),
    pricing: Math.max(0, Math.trunc(finiteNumber(source.pricing ?? legacyPricingRevision, 0))),
    dataImport: Math.max(0, Math.trunc(finiteNumber(source.dataImport, 0))),
    dataImportCatalog: Math.max(0, Math.trunc(finiteNumber(source.dataImportCatalog, 0))),
    dataImportRecipes: Math.max(0, Math.trunc(finiteNumber(source.dataImportRecipes, 0))),
    dataImportStock: Math.max(0, Math.trunc(finiteNumber(source.dataImportStock, 0))),
    catalogMigration: Math.max(0, Math.trunc(finiteNumber(source.catalogMigration, 0))),
    workforce: Math.max(0, Math.trunc(finiteNumber(source.workforce, 0))),
    procurement: Math.max(0, Math.trunc(finiteNumber(source.procurement, 0))),
    inventory,
    shipment: Math.max(0, Math.trunc(finiteNumber(source.shipment ?? source.workforce, 0))),
    catalog,
    site: Math.max(0, Math.trunc(finiteNumber(source.site, 0))),
    notification: Math.max(0, Math.trunc(finiteNumber(source.notification, 0))),
    stock: Math.max(inventory, catalog, Math.max(0, Math.trunc(finiteNumber(source.stock, 0))))
  };
}

function normalizeCatalogMigrations(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim().slice(0, 200);
    const version = String(item.version || "").trim().slice(0, 120);
    if (!id || !version) return null;
    return {
      ...item,
      id,
      version,
      status: ["completed", "failed"].includes(item.status) ? item.status : "completed",
      actor: String(item.actor || "system").slice(0, 200),
      requestId: String(item.requestId || "").slice(0, 200),
      startedAt: item.startedAt || null,
      completedAt: item.completedAt || null,
      revision: Math.max(0, Math.trunc(finiteNumber(item.revision, 0))),
      beforeFingerprint: String(item.beforeFingerprint || "").slice(0, 128),
      afterFingerprint: String(item.afterFingerprint || "").slice(0, 128),
      summary: item.summary && typeof item.summary === "object" && !Array.isArray(item.summary) ? item.summary : {}
    };
  }).filter(Boolean).slice(-20);
}

function normalizeDataImportMappings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const workbook of ["menu", "pricing", "recipe", "stock"]) {
    result[workbook] = normalizeArray(source[workbook]).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const entityId = String(item.entityId || "").trim();
      const sheetNormalizedName = String(item.sheetNormalizedName || "").trim();
      const sourceNormalizedName = String(item.sourceNormalizedName || "").trim();
      if (!entityId || !sheetNormalizedName || !sourceNormalizedName) return null;
      return {
        ...item,
        kind: String(item.kind || ""),
        entityId,
        sheetNormalizedName,
        sourceNormalizedName,
        sourceSheet: String(item.sourceSheet || ""),
        productCode: normalizeProductCode(item.productCode),
        productCodeAliases: normalizeProductCodeList(item.productCodeAliases),
        nameHistory: normalizeNameHistory(item.nameHistory),
        importKey: String(item.importKey || ""),
        externalId: String(item.externalId || ""),
        aliasIds: normalizeArray(item.aliasIds).map((alias) => String(alias || "").trim()).filter(Boolean).slice(0, 100),
        lastImportedAt: item.lastImportedAt || null,
        lastImportOperationId: String(item.lastImportOperationId || "")
      };
    }).filter(Boolean).slice(-10000);
  }
  return result;
}

function normalizePasswordResetChallenges(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const scope = ["admin", "personel", "mudavim"].includes(String(item.scope || "")) ? String(item.scope) : "";
    const id = String(item.id || "").trim().slice(0, 160);
    const emailHash = String(item.emailHash || "").trim().slice(0, 128);
    const codeHash = String(item.codeHash || "").trim().slice(0, 128);
    if (!id || !scope || !emailHash || !codeHash) return null;
    return {
      id,
      purpose: String(item.purpose || "password_reset") === "password_reset" ? "password_reset" : "password_reset",
      emailHash,
      scope,
      targetUserId: String(item.targetUserId || "").trim().slice(0, 160),
      identifierHash: String(item.identifierHash || "").trim().slice(0, 128),
      codeHash,
      accountVersion: Math.max(0, Math.trunc(finiteNumber(item.accountVersion, 0))),
      attempts: Math.max(0, Math.trunc(finiteNumber(item.attempts, 0))),
      expiresAt: normalizeStoredDate(item.expiresAt, new Date(0).toISOString()),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      usedAt: item.usedAt ? normalizeStoredDate(item.usedAt, new Date(0).toISOString()) : null,
      revokedAt: item.revokedAt ? normalizeStoredDate(item.revokedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean).slice(-500);
}

function normalizeEmailVerificationChallenges(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const scope = ["admin", "personel", "mudavim"].includes(String(item.scope || "")) ? String(item.scope) : "";
    const id = String(item.id || "").trim().slice(0, 160);
    const targetUserId = String(item.targetUserId || "").trim().slice(0, 160);
    const destinationHash = String(item.destinationHash || "").trim().slice(0, 128);
    const codeHash = String(item.codeHash || "").trim().slice(0, 128);
    if (!id || !scope || !targetUserId || !destinationHash || !codeHash) return null;
    return {
      id,
      purpose: "email_verification",
      scope,
      targetUserId,
      destinationHash,
      codeHash,
      accountVersion: Math.max(0, Math.trunc(finiteNumber(item.accountVersion, 0))),
      attempts: Math.max(0, Math.trunc(finiteNumber(item.attempts, 0))),
      expiresAt: normalizeStoredDate(item.expiresAt, new Date(0).toISOString()),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      usedAt: item.usedAt ? normalizeStoredDate(item.usedAt, new Date(0).toISOString()) : null,
      revokedAt: item.revokedAt ? normalizeStoredDate(item.revokedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean).slice(-500);
}

function normalizeSecurityAudit(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const action = String(item.action || "").trim().slice(0, 100);
    if (!id || !action) return null;
    return {
      id,
      action,
      scope: ["admin", "personel", "mudavim"].includes(item.scope) ? item.scope : "",
      accountId: String(item.accountId || "").slice(0, 160),
      result: String(item.result || "recorded").slice(0, 80),
      ipHash: String(item.ipHash || "").slice(0, 64),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString())
    };
  }).filter(Boolean).slice(-2000);
}

function normalizeNotifications(value) {
  const normalized = normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const recipientRole = normalizeNotificationRole(item.recipientRole);
    const recipientId = recipientRole === "manager" ? "manager" : String(item.recipientId || "").trim().slice(0, 160);
    const id = String(item.id || "").trim().slice(0, 180);
    if (!id || !recipientRole || !recipientId) return null;
    const appTarget = normalizeAppTarget(item.appTarget, item.deepLink, recipientRole);
    return {
      ...item,
      id,
      recipientRole,
      recipientId,
      category: normalizeNotificationCategory(item.category),
      eventType: String(item.eventType || "notification").trim().slice(0, 120) || "notification",
      title: repairNotificationText(item.title || "Bildirim").trim().slice(0, 180) || "Bildirim",
      body: repairNotificationText(item.body || "").trim().slice(0, 1200),
      severity: item.severity === "error" ? "critical" : ["info", "success", "warning", "critical"].includes(item.severity) ? item.severity : "info",
      entityType: String(item.entityType || "").trim().slice(0, 100),
      entityId: String(item.entityId || "").trim().slice(0, 180),
      deepLink: safeAppDeepLink(item.deepLink, appTarget),
      appTarget,
      dedupeKey: String(item.dedupeKey || "").trim().slice(0, 240),
      metadata: normalizeNotificationMetadata(item.metadata),
      inAppVisible: item.inAppVisible !== false,
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date(0).toISOString()),
      readAt: item.readAt ? normalizeStoredDate(item.readAt, new Date(0).toISOString()) : null,
      archivedAt: item.archivedAt ? normalizeStoredDate(item.archivedAt, new Date(0).toISOString()) : null,
      deletedAt: item.deletedAt ? normalizeStoredDate(item.deletedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean);
  const byEvent = new Map();
  for (const item of normalized) {
    const key = item.dedupeKey ? `${item.recipientRole}\u0000${item.recipientId}\u0000${item.dedupeKey}` : `id:${item.id}`;
    const current = byEvent.get(key);
    if (!current) byEvent.set(key, item);
    else {
      current.readAt = current.readAt || item.readAt;
      current.archivedAt = current.archivedAt || item.archivedAt;
      current.deletedAt = current.deletedAt || item.deletedAt;
      if (String(item.updatedAt || "") > String(current.updatedAt || "")) current.updatedAt = item.updatedAt;
    }
  }
  const deduped = [...byEvent.values()];
  if (deduped.length <= 10000) return deduped;
  const unread = deduped.filter((item) => !item.readAt && !item.archivedAt);
  const completed = deduped.filter((item) => item.readAt || item.archivedAt)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return unread.concat(completed.slice(0, Math.max(0, 10000 - unread.length)))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

function normalizeNotificationPreferences(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  const normalized = source.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const ownerRole = normalizeNotificationRole(item.ownerRole || item.recipientRole);
    const ownerId = ownerRole === "manager" ? "manager" : String(item.ownerId || item.recipientId || "").trim().slice(0, 160);
    if (!ownerRole || !ownerId) return null;
    return {
      ownerRole,
      ownerId,
      inAppEnabled: item.inAppEnabled !== undefined ? item.inAppEnabled !== false : item.inApp !== false,
      emailEnabled: item.emailEnabled !== undefined ? item.emailEnabled === true : item.email === true,
      pushEnabled: item.pushEnabled !== undefined ? item.pushEnabled === true : item.push === true,
      pushVibrationEnabled: item.pushVibrationEnabled !== false,
      emailAddress: String(item.emailAddress || "").trim().toLowerCase().slice(0, 254),
      taskNotifications: notificationPreferenceFlag(item, "taskNotifications", "tasks", true),
      shiftNotifications: notificationPreferenceFlag(item, "shiftNotifications", "shifts", true),
      shipmentNotifications: notificationPreferenceFlag(item, "shipmentNotifications", "shipments", true),
      stockNotifications: notificationPreferenceFlag(item, "stockNotifications", "stock", true),
      systemNotifications: notificationPreferenceFlag(item, "systemNotifications", "system", true),
      mudavimNotifications: notificationPreferenceFlag(item, "mudavimNotifications", "mudavim", true),
      campaignNotifications: notificationPreferenceFlag(item, "campaignNotifications", "campaign", true),
      reminderNotifications: notificationPreferenceFlag(item, "reminderNotifications", "reminders", true),
      taskReminder24h: notificationReminderFlag(item, "taskReminder24h", "task24h"),
      taskReminder2h: notificationReminderFlag(item, "taskReminder2h", "task2h"),
      overdueReminder: notificationReminderFlag(item, "overdueReminder", "overdue"),
      shiftReminder12h: notificationReminderFlag(item, "shiftReminder12h", "shift12h"),
      shiftReminder2h: notificationReminderFlag(item, "shiftReminder2h", "shift2h"),
      quietHoursEnabled: item.quietHoursEnabled === true || Boolean(item.quietHours && item.quietHours.enabled),
      quietHoursStart: normalizeClock(item.quietHoursStart || item.quietHours && item.quietHours.start, "22:00"),
      quietHoursEnd: normalizeClock(item.quietHoursEnd || item.quietHours && item.quietHours.end, "08:00"),
      timezone: String(item.timezone || item.quietHours && item.quietHours.timezone || "Europe/Istanbul").slice(0, 80),
      updatedAt: item.updatedAt ? normalizeStoredDate(item.updatedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean);
  const byOwner = new Map();
  for (const item of normalized) byOwner.set(`${item.ownerRole}\u0000${item.ownerId}`, item);
  return [...byOwner.values()].slice(-2000);
}

function reconcileNotificationPreferenceEmails(preferences, data) {
  return (Array.isArray(preferences) ? preferences : []).map((preference) => {
    if (!preference) return preference;
    const account = preference.ownerRole === "manager"
      ? data && data.admin
      : preference.ownerRole === "mudavim"
        ? (Array.isArray(data && data.mudavimAccounts) ? data.mudavimAccounts : [])
          .find((item) => item && String(item.id || "") === String(preference.ownerId || ""))
        : (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
          .find((item) => item && String(item.id || "") === String(preference.ownerId || ""));
    const candidate = account && account.emailVerifiedAt
      ? String(account.emailNormalized || account.email || "").trim().toLowerCase().slice(0, 254)
      : "";
    const verifiedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
    return {
      ...preference,
      emailEnabled: Boolean(preference.emailEnabled && verifiedEmail),
      emailAddress: verifiedEmail,
      emailVerified: Boolean(verifiedEmail)
    };
  });
}

function normalizeNotificationOutbox(value) {
  const normalized = normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const notificationId = String(item.notificationId || "").trim().slice(0, 180);
    const channel = ["email", "push"].includes(item.channel) ? item.channel : "";
    const recipientRole = normalizeNotificationRole(item.recipientRole);
    const recipientId = recipientRole === "manager" ? "manager" : String(item.recipientId || "").trim().slice(0, 160);
    if (!id || !notificationId || !channel) return null;
    return {
      ...item,
      id,
      notificationId,
      channel,
      recipientRole,
      recipientId,
      status: normalizeOutboxStatus(item.status),
      attemptCount: Math.max(0, Math.trunc(finiteNumber(item.attemptCount ?? item.attempts, 0))),
      nextAttemptAt: normalizeStoredDate(item.nextAttemptAt, new Date(0).toISOString()),
      lockedAt: item.lockedAt ? normalizeStoredDate(item.lockedAt, new Date(0).toISOString()) : null,
      lastAttemptAt: item.lastAttemptAt ? normalizeStoredDate(item.lastAttemptAt, new Date(0).toISOString()) : null,
      sentAt: item.sentAt || item.deliveredAt ? normalizeStoredDate(item.sentAt || item.deliveredAt, new Date(0).toISOString()) : null,
      destination: String(item.destination || "").slice(0, 2048),
      subscriptionId: String(item.subscriptionId || "").slice(0, 180),
      dedupeKey: String(item.dedupeKey || "").slice(0, 240),
      lastError: String(item.lastError || "").slice(0, 500),
      lockedBy: String(item.lockedBy || "").slice(0, 180),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date(0).toISOString())
    };
  }).filter(Boolean);
  const byDelivery = new Map();
  for (const item of normalized) {
    const role = normalizeNotificationRole(item.recipientRole);
    const recipientId = role === "manager" ? "manager" : String(item.recipientId || "");
    const logicalDelivery = `${item.notificationId}\u0000${item.channel}\u0000${item.channel === "push"
      ? item.subscriptionId || item.destination
      : String(item.destination || "").toLowerCase() || "email"}`;
    const key = `${role}\u0000${recipientId}\u0000${logicalDelivery}`;
    const current = byDelivery.get(key);
    const priority = outboxStatusPriority(item.status);
    const currentPriority = outboxStatusPriority(current && current.status);
    if (!current
      || priority > currentPriority
      || (priority === currentPriority && String(item.updatedAt || "") > String(current.updatedAt || ""))) byDelivery.set(key, item);
  }
  const deduped = [...byDelivery.values()];
  if (deduped.length <= 20000) return deduped;
  const active = deduped.filter((item) => ["pending", "processing"].includes(item.status));
  const completed = deduped.filter((item) => !["pending", "processing"].includes(item.status))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return active.concat(completed.slice(0, Math.max(0, 20000 - active.length)));
}

function reconcileNotificationOutboxRecipients(items, notifications) {
  const notificationsById = new Map();
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || !notification.id) continue;
    if (!notificationsById.has(notification.id)) notificationsById.set(notification.id, []);
    notificationsById.get(notification.id).push(notification);
  }
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item) return item;
    const candidates = notificationsById.get(item.notificationId) || [];
    const claimedRole = normalizeNotificationRole(item.recipientRole);
    const claimedId = claimedRole === "manager" ? "manager" : String(item.recipientId || "");
    let notification = candidates.find((entry) => entry.recipientRole === claimedRole
      && String(entry.recipientRole === "manager" ? "manager" : entry.recipientId || "") === claimedId);
    if (!notification && !claimedRole && candidates.length === 1) notification = candidates[0];
    if (notification) {
      return {
        ...item,
        recipientRole: notification.recipientRole,
        recipientId: notification.recipientId
      };
    }
    if (!candidates.length || !claimedRole || !claimedId) return item;
    return {
      ...item,
      status: item.status === "sent" ? "sent" : "cancelled",
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: "",
      lastError: item.status === "sent" ? item.lastError : "Bildirim teslim alıcısı eşleşmediği için iptal edildi."
    };
  });
}

function normalizePushSubscriptions(value) {
  const normalized = normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const ownerRole = normalizeNotificationRole(item.ownerRole || item.recipientRole);
    const ownerId = ownerRole === "manager" ? "manager" : String(item.ownerId || item.recipientId || "").trim().slice(0, 160);
    const endpoint = String(item.endpoint || item.subscription && item.subscription.endpoint || "").trim().slice(0, 2048);
    if (!ownerRole || !ownerId || !/^https:\/\//i.test(endpoint)) return null;
    const subscription = item.subscription && typeof item.subscription === "object" ? item.subscription : item;
    return {
      id: String(item.id || stableStockId("push-subscription", `${ownerRole}\u0000${ownerId}\u0000${endpoint}`)),
      ownerRole,
      ownerId,
      appTarget: normalizeAppTarget(item.appId || item.appTarget, item.deepLink, ownerRole),
      appId: normalizeAppTarget(item.appId || item.appTarget, item.deepLink, ownerRole),
      endpoint,
      subscription: {
        endpoint,
        expirationTime: subscription.expirationTime || null,
        keys: subscription.keys && typeof subscription.keys === "object" ? {
          p256dh: String(subscription.keys.p256dh || "").slice(0, 500),
          auth: String(subscription.keys.auth || "").slice(0, 500)
        } : {}
      },
      keys: subscription.keys && typeof subscription.keys === "object" ? {
        p256dh: String(subscription.keys.p256dh || "").slice(0, 500),
        auth: String(subscription.keys.auth || "").slice(0, 500)
      } : {},
      userAgent: String(item.userAgent || "").slice(0, 500),
      deviceId: String(item.deviceId || "").trim().slice(0, 180),
      deviceName: String(item.deviceName || "").trim().slice(0, 120),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date(0).toISOString()),
      lastSeenAt: normalizeStoredDate(item.lastSeenAt || item.updatedAt || item.createdAt, new Date(0).toISOString()),
      lastSuccessAt: item.lastSuccessAt ? normalizeStoredDate(item.lastSuccessAt, new Date(0).toISOString()) : null,
      lastFailureAt: item.lastFailureAt ? normalizeStoredDate(item.lastFailureAt, new Date(0).toISOString()) : null,
      failureCount: Math.max(0, Math.trunc(finiteNumber(item.failureCount, 0))),
      disabledAt: item.disabledAt ? normalizeStoredDate(item.disabledAt, new Date(0).toISOString()) : null,
      revokedAt: item.revokedAt ? normalizeStoredDate(item.revokedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean);
  const byOwnerDevice = new Map();
  for (const item of normalized) {
    const identity = item.deviceId ? `device:${item.deviceId}` : `endpoint:${item.endpoint}`;
    const key = `${item.ownerRole}\u0000${item.ownerId}\u0000${item.appTarget}\u0000${identity}`;
    const current = byOwnerDevice.get(key);
    if (!current || String(item.updatedAt || "") >= String(current.updatedAt || "")) byOwnerDevice.set(key, item);
  }
  const deduped = [...byOwnerDevice.values()];
  const activeByEndpoint = new Map();
  const retained = [];
  for (const item of deduped.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))) {
    if (item.revokedAt) {
      retained.push(item);
      continue;
    }
    const endpointKey = `${item.appId || item.appTarget}\u0000${item.endpoint}`;
    if (activeByEndpoint.has(endpointKey)) continue;
    activeByEndpoint.set(endpointKey, item);
    retained.push(item);
  }
  return retained.slice(0, 5000);
}

function normalizeNotificationSchedulerState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    lastRunAt: source.lastRunAt ? normalizeStoredDate(source.lastRunAt, new Date(0).toISOString()) : null,
    leaseOwner: String(source.leaseOwner || "").slice(0, 160),
    leaseExpiresAt: source.leaseExpiresAt ? normalizeStoredDate(source.leaseExpiresAt, new Date(0).toISOString()) : null,
    updatedAt: source.updatedAt ? normalizeStoredDate(source.updatedAt, new Date(0).toISOString()) : null,
    lastTickAt: source.lastTickAt ? normalizeStoredDate(source.lastTickAt, new Date(0).toISOString()) : null,
    lastReminderScanAt: source.lastReminderScanAt ? normalizeStoredDate(source.lastReminderScanAt, new Date(0).toISOString()) : null,
    lastOutboxRunAt: source.lastOutboxRunAt ? normalizeStoredDate(source.lastOutboxRunAt, new Date(0).toISOString()) : null,
    lastOutboxSuccessAt: source.lastOutboxSuccessAt ? normalizeStoredDate(source.lastOutboxSuccessAt, new Date(0).toISOString()) : null,
    reminderKeys: normalizeArray(source.reminderKeys).map((key) => String(key || "").slice(0, 240)).filter(Boolean).slice(-5000),
    criticalStockState: normalizeCriticalStockState(source.criticalStockState)
  };
}

function notificationPreferenceFlag(item, directKey, categoryKey, fallback) {
  if (item[directKey] !== undefined) return item[directKey] !== false;
  if (item.categories && item.categories[categoryKey] !== undefined) return item.categories[categoryKey] !== false;
  const singular = String(categoryKey || "").replace(/s$/, "");
  if (item.categories && item.categories[singular] !== undefined) return item.categories[singular] !== false;
  return fallback;
}

function notificationReminderFlag(item, directKey, reminderKey) {
  if (typeof item[directKey] === "boolean") return item[directKey];
  if (item.reminders && typeof item.reminders[reminderKey] === "boolean") return item.reminders[reminderKey];
  return item.reminderNotifications !== false;
}

function normalizeClock(value, fallback) {
  const text = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function normalizeOutboxStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["sent", "delivered"].includes(status)) return "sent";
  if (["failed", "dead_letter"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["processing", "in_progress", "locked"].includes(status)) return "processing";
  return "pending";
}

function outboxStatusPriority(status) {
  return { sent: 5, processing: 4, pending: 3, failed: 2, cancelled: 1 }[status] || 0;
}

function normalizeNotificationRole(value) {
  const role = normalizeNotificationLookup(value);
  if (["manager", "admin", "yonetici"].includes(role)) return "manager";
  if (["personnel", "personel", "recipe"].includes(role)) return "personnel";
  if (["mudavim", "member", "customer"].includes(role)) return "mudavim";
  return "";
}

function normalizeNotificationCategory(value) {
  const key = normalizeNotificationLookup(value);
  if (["task", "gorev", "yapilacak"].some((term) => key.includes(term))) return "task";
  if (["shipment", "sevkiyat"].some((term) => key.includes(term))) return "shipment";
  if (["shift", "vardiya", "izin"].some((term) => key.includes(term))) return "shift";
  if (["training", "egitim", "sinav", "recete"].some((term) => key.includes(term))) return "training";
  if (["stock", "stok"].some((term) => key.includes(term))) return "stock";
  if (["campaign", "kampanya", "firsat", "pazarlama"].some((term) => key.includes(term))) return "campaign";
  if (["mudavim", "member", "customer", "duyuru"].some((term) => key.includes(term))) return "mudavim";
  return "system";
}

function normalizeCriticalStockState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawId, rawState] of Object.entries(value).slice(-5000)) {
    const id = String(rawId || "").slice(0, 180);
    if (!id || !rawState || typeof rawState !== "object" || Array.isArray(rawState)) continue;
    result[id] = {
      isCritical: rawState.isCritical === true,
      revision: Math.max(0, Math.trunc(finiteNumber(rawState.revision, 0))),
      quantity: finiteNumber(rawState.quantity, 0),
      threshold: Math.max(0, finiteNumber(rawState.threshold, 0)),
      updatedAt: rawState.updatedAt ? normalizeStoredDate(rawState.updatedAt, new Date(0).toISOString()) : null
    };
  }
  return result;
}

function normalizeNotificationMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    return Buffer.byteLength(json, "utf8") <= 8000 ? JSON.parse(json) : {};
  } catch (_error) {
    return {};
  }
}

function normalizeNotificationLookup(value) {
  return repairNotificationText(value).trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

function repairNotificationText(value) {
  let result = String(value || "");
  const markerPattern = /[\u00c3\u00c4\u00c5\u00c2\u00e2][^\s]*/g;
  for (let index = 0; index < 3 && markerPattern.test(result); index += 1) {
    markerPattern.lastIndex = 0;
    const decoded = result.replace(markerPattern, decodeLegacyNotificationToken);
    if (decoded === result) break;
    result = decoded;
  }
  return result;
}

function decodeLegacyNotificationToken(token) {
  const bytes = [];
  for (const character of token) {
    const code = character.codePointAt(0);
    if (code <= 255) bytes.push(code);
    else if (Object.prototype.hasOwnProperty.call(WINDOWS_1252_BYTES, character)) bytes.push(WINDOWS_1252_BYTES[character]);
    else return token;
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded.includes("�") ? token : decoded;
}

const WINDOWS_1252_BYTES = Object.freeze({
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91,
  "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98,
  "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f
});

function normalizeStoredDate(value, fallback) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback;
}

function normalizeMenuState(menuState) {
  const source = menuState && typeof menuState === "object" && !Array.isArray(menuState) ? menuState : {};
  return {
    ...source,
    settings: source.settings && typeof source.settings === "object" && !Array.isArray(source.settings) ? source.settings : {},
    categories: Array.isArray(source.categories)
      ? source.categories.map((category, categoryIndex) => normalizeMenuCategory(category, categoryIndex)).filter(Boolean)
      : []
  };
}

function normalizeMenuCategory(category, index) {
  if (!category || typeof category !== "object" || Array.isArray(category)) return null;
  const id = String(category.id || `category-${index + 1}`);
  return {
    ...category,
    id,
    name: String(category.name || `Kategori ${index + 1}`),
    active: category.active !== false,
    order: finiteNumber(category.order, index),
    iconKey: normalizeCategoryIconKey(category.iconKey || category.icon, category.name),
    icon: categoryIcons.getIconClass(normalizeCategoryIconKey(category.iconKey || category.icon, category.name)),
    ...normalizeSourceMetadata(category),
    products: Array.isArray(category.products)
      ? category.products.map((product, productIndex) => normalizeMenuProduct(product, id, productIndex)).filter(Boolean)
      : []
  };
}

function normalizeCategoryIconKey(value, categoryName) {
  const text = String(value || "").trim();
  if (text && categoryIcons.ICONS[text]) return text;
  return categoryIcons.inferIconKey(categoryName);
}

function normalizeMenuProduct(product, categoryId, index) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const details = product.details && typeof product.details === "object" && !Array.isArray(product.details)
    ? product.details
    : {};
  const manualContent = String(product.manualContent ?? details.ingredients ?? product.ingredients ?? "").trim();
  const hasExplicitContentMode = Object.prototype.hasOwnProperty.call(product, "contentMode");
  const mode = hasExplicitContentMode ? normalizeContentMode(product.contentMode, product.recipeId, manualContent) : (product.recipeId ? "recipe" : undefined);
  return {
    ...product,
    id: String(product.id || `${categoryId || "category"}-product-${index + 1}`),
    name: String(product.name || `Ürün ${index + 1}`),
    active: product.active !== false,
    order: finiteNumber(product.order, index),
    contentMode: mode,
    recipeId: mode === "recipe" ? String(product.recipeId || "") : String(product.recipeId || ""),
    recipeSize: String(product.recipeSize || ""),
    manualContent,
    ...normalizeSourceMetadata(product),
    details: {
      ...details,
      calories: String(details.calories ?? product.calories ?? ""),
      allergens: String(details.allergens ?? product.allergens ?? ""),
      ingredients: manualContent
    }
  };
}

function normalizeRecipeState(recipeState) {
  if (!recipeState || typeof recipeState !== "object" || Array.isArray(recipeState)) return {};
  const normalized = {};
  for (const [categoryName, products] of Object.entries(recipeState)) {
    if (!categoryName || !products || typeof products !== "object" || Array.isArray(products)) continue;
    const nextProducts = {};
    for (const [productName, sizes] of Object.entries(products)) {
      if (!productName || !sizes || typeof sizes !== "object" || Array.isArray(sizes)) continue;
      const nextSizes = {};
      for (const [sizeName, recipe] of Object.entries(sizes)) {
        if (!sizeName) continue;
        nextSizes[sizeName] = normalizeRecipeItem(recipe);
      }
      nextProducts[productName] = nextSizes;
    }
    normalized[categoryName] = nextProducts;
  }
  return normalized;
}

function normalizeRecipeItem(recipe) {
  if (recipe && typeof recipe === "object" && !Array.isArray(recipe)) {
    return {
      ...recipe,
      content: String(recipe.content ?? recipe.recipe ?? recipe.ingredients ?? "").trim(),
      preparation: String(recipe.preparation ?? recipe.method ?? recipe.steps ?? recipe.description ?? "").trim(),
      note: String(recipe.note ?? recipe.productNote ?? "").trim(),
      active: recipe.active !== false,
      order: finiteNumber(recipe.order, 0),
      ...normalizeSourceMetadata(recipe)
    };
  }
  return String(recipe || "");
}

function reconcileRecipeCatalog(recipeState, existing) {
  const records = Array.isArray(existing) ? existing.filter(isCatalogRecord).map((item) => ({ ...item })) : [];
  const claimed = new Set();
  const result = [];

  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const product of Object.keys(products || {})) {
      const exact = records.find((item) => !claimed.has(item.id) && item.category === category && item.product === product);
      const record = exact || {
        id: stableRecipeId(category, product),
        category,
        product,
        createdAt: new Date(0).toISOString()
      };
      claimed.add(record.id);
      result.push({
        ...record,
        id: String(record.id),
        category,
        product,
        updatedAt: record.updatedAt || null
      });
    }
  }
  return result;
}

function migrateMenuRecipeLinks(menuState, recipeCatalog, recipeState) {
  const nameIndex = new Map();
  recipeCatalog.forEach((record) => {
    const key = normalizeName(record.product);
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(record);
  });

  const validRecipeIds = new Set(recipeCatalog.map((item) => item.id));
  const review = [];
  const categories = menuState.categories.map((category) => ({
    ...category,
    products: category.products.map((product) => {
      const next = { ...product };
      if (next.recipeId && validRecipeIds.has(next.recipeId)) {
        next.contentMode = next.contentMode || "recipe";
        next.recipeLinkStatus = "linked";
        return next;
      }

      if (!next.recipeId && next.contentMode === undefined) {
        const candidates = nameIndex.get(normalizeName(next.name)) || [];
        if (candidates.length === 1) {
          next.recipeId = candidates[0].id;
          next.contentMode = "recipe";
          next.recipeSize = chooseRecipeSize(recipeState, candidates[0]);
          next.recipeLinkStatus = "linked";
          return next;
        }
      }

      if (next.contentMode === "recipe" && !validRecipeIds.has(next.recipeId)) {
        next.contentMode = next.manualContent ? "manual" : "hidden";
      }
      if (!next.contentMode) next.contentMode = next.manualContent ? "manual" : "hidden";
      next.recipeLinkStatus = "needs-review";
      review.push({
        productId: next.id,
        categoryId: category.id,
        productName: next.name,
        reason: (nameIndex.get(normalizeName(next.name)) || []).length > 1 ? "ambiguous" : "not-found"
      });
      return next;
    })
  }));
  return { menuState: { ...menuState, categories }, review };
}

function chooseRecipeSize(recipeState, record, preferredSize = "") {
  const sizes = recipeState?.[record.category]?.[record.product] || {};
  const activeEntries = Object.entries(sizes).filter(([, value]) => normalizeRecipeItem(value).active !== false);
  if (!activeEntries.length) return "";
  const preferred = [preferredSize, "Standart", "16 oz"].filter(Boolean);
  for (const name of preferred) {
    const match = activeEntries.find(([size]) => normalizeName(size) === normalizeName(name));
    if (match) return match[0];
  }
  activeEntries.sort(([, first], [, second]) => finiteNumber(normalizeRecipeItem(first).order, 0) - finiteNumber(normalizeRecipeItem(second).order, 0));
  return activeEntries[0][0];
}

function stableRecipeId(category, product) {
  return `recipe-${crypto.createHash("sha256").update(`${category}\u0000${product}`, "utf8").digest("hex").slice(0, 20)}`;
}

function normalizeContentMode(mode, recipeId, manualContent) {
  if (["recipe", "manual", "hidden", "not-required"].includes(mode)) return mode;
  if (recipeId) return "recipe";
  return manualContent ? "manual" : "hidden";
}

function normalizeRecipeUsers(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const requestedCapabilities = Array.isArray(item.faturaCapabilities)
      ? item.faturaCapabilities
      : DEFAULT_FATURA_CAPABILITIES;
    const capabilities = [...new Set(requestedCapabilities
      .map((capability) => String(capability || "").trim())
      .filter((capability) => FATURA_CAPABILITIES.has(capability)))];
    const accessEnabled = typeof item.faturaAccessEnabled === "boolean"
      ? item.faturaAccessEnabled
      : capabilities.length > 0;
    const role = FATURA_ROLES.has(String(item.faturaRole || "")) ? String(item.faturaRole) : "operasyon";
    const template = procurementText(item.faturaTemplate, 40) || "ozel";
    const sectionAccess = normalizeSectionAccess(item.faturaSectionAccess, {
      capabilities,
      allowManagement: template === "yonetici" || role === "yönetici"
    });
    return {
      ...item,
      ...normalizeAccountSecurity(item),
      faturaAccessEnabled: accessEnabled,
      faturaRole: role,
      faturaTemplate: template,
      faturaCapabilities: accessEnabled ? capabilities : [],
      faturaSectionAccess: sectionAccess,
      personelSectionAccess: normalizePersonelSectionAccess(item.personelSectionAccess),
      // Stok lokasyonu yalnızca sunucu tarafındaki oturumdan çözülür. Eski
      // personel kayıtları güvenli başlangıç olarak Kafe Deposuna bağlanır.
      stockLocationId: String(item.stockLocationId || item.locationId || "stock-location-cafe").trim() || "stock-location-cafe"
    };
  }).filter(Boolean);
}

function normalizeMudavimAccounts(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const accountData = { ...item };
    for (const phoneField of [
      "phone", "phoneNumber", "phoneNormalized", "pendingPhone", "phoneVerifiedAt",
      "phoneVerificationVersion", "phoneOtp", "mobile", "gsm"
    ]) delete accountData[phoneField];
    const id = String(item.id || "").trim().slice(0, 160);
    const fullName = String(item.fullName || item.name || "").trim().slice(0, 120);
    if (!id || !fullName || !String(item.passwordHash || "")) return null;
    const security = normalizeAccountSecurity(item);
    const status = ["pending_email_verification", "active", "disabled"].includes(item.status)
      ? item.status
      : security.emailVerifiedAt ? "active" : "pending_email_verification";
    return {
      ...accountData,
      ...security,
      id,
      passwordHash: String(item.passwordHash || ""),
      fullName,
      alias: String(item.alias || "").trim().slice(0, 60),
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.birthDate || "")) ? String(item.birthDate) : "",
      campaignConsent: item.campaignConsent === true,
      membershipTermsVersion: String(item.membershipTermsVersion || "").slice(0, 40),
      membershipTermsAcceptedAt: item.membershipTermsAcceptedAt ? normalizeStoredDate(item.membershipTermsAcceptedAt, new Date(0).toISOString()) : null,
      privacyNoticeVersion: String(item.privacyNoticeVersion || "").slice(0, 40),
      privacyNoticeAcknowledgedAt: item.privacyNoticeAcknowledgedAt ? normalizeStoredDate(item.privacyNoticeAcknowledgedAt, new Date(0).toISOString()) : null,
      campaignConsentVersion: String(item.campaignConsentVersion || "").slice(0, 40),
      campaignConsentAt: item.campaignConsentAt ? normalizeStoredDate(item.campaignConsentAt, new Date(0).toISOString()) : null,
      campaignConsentRevokedAt: item.campaignConsentRevokedAt ? normalizeStoredDate(item.campaignConsentRevokedAt, new Date(0).toISOString()) : null,
      createdAt: normalizeStoredDate(item.createdAt, new Date().toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date().toISOString()),
      status
    };
  }).filter(Boolean).slice(-100000);
}

function clearLegacyUnverifiedPersonelAdminEmails(data) {
  const adminEmail = normalizeSecurityEmail(data && data.admin && (data.admin.emailNormalized || data.admin.email));
  if (!adminEmail) return;
  const clearedAt = new Date().toISOString();
  for (const account of Array.isArray(data.recipeUsers) ? data.recipeUsers : []) {
    const email = normalizeSecurityEmail(account && (account.emailNormalized || account.email));
    const isUnverifiedLegacyDefault = account
      && email === adminEmail
      && !account.emailVerifiedAt
      && !account.pendingEmail
      && Math.max(0, Math.trunc(finiteNumber(account.emailVerificationVersion, 0))) === 0;
    if (!isUnverifiedLegacyDefault) continue;
    account.email = "";
    account.emailNormalized = "";
    account.emailVerificationRequired = true;
    data.securityAudit = normalizeSecurityAudit((Array.isArray(data.securityAudit) ? data.securityAudit : []).concat({
      id: `security-migration-${crypto.randomUUID()}`,
      action: "legacy_personel_admin_email_cleared",
      scope: "personel",
      accountId: String(account.id || ""),
      result: "unverified_default_removed",
      ipHash: "",
      createdAt: clearedAt
    }));
  }
}

function normalizeAdmin(admin) {
  const source = admin && typeof admin === "object" && !Array.isArray(admin) ? admin : {};
  return {
    ...source,
    ...normalizeAccountSecurity(source),
    passwordHash: String(source.passwordHash || ""),
    recipePasswordHash: String(source.recipePasswordHash || source.passwordHash || ""),
    updatedAt: source.updatedAt || null,
    recipeUpdatedAt: source.recipeUpdatedAt || source.updatedAt || null
  };
}

function normalizeAccountSecurity(source) {
  const email = normalizeSecurityEmail(source.emailNormalized || source.email);
  const pendingCandidate = normalizeSecurityEmail(source.pendingEmail);
  const pendingEmail = pendingCandidate && pendingCandidate !== email ? pendingCandidate : "";
  const emailVerifiedAt = email && source.emailVerifiedAt
    ? normalizeStoredDate(source.emailVerifiedAt, null)
    : null;
  return {
    email,
    emailNormalized: email,
    pendingEmail,
    emailVerifiedAt,
    emailVerificationRequired: Boolean(source.emailVerificationRequired) || !emailVerifiedAt || Boolean(pendingEmail),
    emailVerificationVersion: Math.max(0, Math.trunc(finiteNumber(source.emailVerificationVersion, 0))),
    lastPasswordResetAt: source.lastPasswordResetAt
      ? normalizeStoredDate(source.lastPasswordResetAt, null)
      : null
  };
}

function normalizeSecurityEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeAuthSessions(items) {
  return normalizeArray(items).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const role = ["admin", "personel", "mudavim"].includes(item.role) ? item.role : "";
    const tokenHash = String(item.tokenHash || "").toLowerCase();
    if (!role || !/^[a-f0-9]{64}$/.test(tokenHash)) return null;
    return {
      id: String(item.id || `session-${crypto.randomUUID()}`),
      tokenHash,
      role,
      userId: ["personel", "mudavim"].includes(role) && item.userId ? String(item.userId) : null,
      username: ["personel", "mudavim"].includes(role) ? String(item.username || "") : "",
      name: ["personel", "mudavim"].includes(role) ? String(item.name || "") : "",
      createdAt: item.createdAt || new Date().toISOString(),
      revokedAt: item.revokedAt || null
    };
  }).filter(Boolean);
}

function normalizeRevisions(items) {
  return normalizeArray(items).slice(-10);
}

function normalizeWorkforceShiftSettings(settings) {
  const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const morning = source.morning && typeof source.morning === "object" ? source.morning : {};
  const evening = source.evening && typeof source.evening === "object" ? source.evening : {};
  return {
    ...source,
    morning: {
      startTime: String(morning.startTime || "08:00"),
      endTime: String(morning.endTime || "16:00")
    },
    evening: {
      startTime: String(evening.startTime || "16:00"),
      endTime: String(evening.endTime || "00:00")
    },
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null
  };
}

function normalizeStockState(stockState) {
  const source = stockState && typeof stockState === "object" && !Array.isArray(stockState) ? stockState : defaultStockState();
  const categories = Array.isArray(source.categories)
    ? source.categories.map(normalizeStockCategory).filter(Boolean)
    : defaultStockState().categories;
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const products = Array.isArray(source.products)
    ? source.products.map((product, index) => normalizeStockProduct(product, index, categoryNames)).filter(Boolean)
    : defaultStockState().products;
  const unitDefinitions = normalizeStockUnitDefinitions(source.unitDefinitions, products);
  const locations = normalizeStockLocations(source.locations);
  const generalLocation = locations.find((location) => location.code === "GENEL" || location.type === "central") || locations[0];
  const cafeLocation = locations.find((location) => location.code === "CAFE" || location.type === "cafe") || locations[0];
  const legacyMigrationRequired = !Array.isArray(source.balances) || Number(source.locationMigrationVersion || 0) < 1;
  // Yalnız henüz lokasyon migration'ı yapılmamış eski tekil stoklar operasyon
  // kaynağı olan Kafe Deposuna bağlanır. Mevcut çok-depolu dağılım asla taşınmaz.
  const balances = normalizeStockBalances(source.balances, products, locations, legacyMigrationRequired, cafeLocation && cafeLocation.id);
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const movements = normalizeArray(source.movements)
    .map((movement) => normalizeStockMovement(movement, productsById, legacyMigrationRequired ? cafeLocation && cafeLocation.id : generalLocation && generalLocation.id))
    .filter(Boolean).slice(0, 5000);
  const next = {
    ...source,
    schemaVersion: 3,
    locationMigrationVersion: 1,
    unitMetadataMigrationVersion: 2,
    unitCatalogMigrationVersion: 1,
    categories,
    products,
    unitDefinitions,
    locations,
    balances,
    movements,
    transfers: normalizeStockTransfers(source.transfers, productsById, locations),
    counts: normalizeStockCounts(source.counts || source.stockCounts, productsById, locations),
    operationKeys: normalizeStockOperationKeys(source.operationKeys),
    notificationSettings: source.notificationSettings && typeof source.notificationSettings === "object" && !Array.isArray(source.notificationSettings)
      ? source.notificationSettings
      : {},
    migrationAudit: normalizeStockMigrationAudit(source.migrationAudit, legacyMigrationRequired, balances, cafeLocation)
  };
  // `stockQuantity` remains a calculated legacy projection so current public
  // API consumers keep working, but every persistent balance is location-bound.
  const totals = new Map();
  balances.forEach((balance) => totals.set(String(balance.productId), (totals.get(String(balance.productId)) || 0) + Number(balance.quantity || 0)));
  next.products = next.products.map((product) => {
    const stockQuantity = Math.max(0, finiteNumber(totals.get(String(product.id)), 0));
    return {
      ...product,
      stockQuantity,
      stockQuantityText: `${stockQuantity} ${product.unit || "adet"}`
    };
  });
  return next;
}

const DEFAULT_STOCK_BASE_UNITS = Object.freeze(["adet", "şişe", "litre", "ml", "kg", "gr", "metre"]);
const DEFAULT_STOCK_BULK_UNITS = Object.freeze(["koli", "kasa", "paket", "kutu", "çuval"]);

function normalizeStockUnitDefinitions(value, products = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const base = source ? normalizeStockUnitList(source.base || source.baseUnits) : DEFAULT_STOCK_BASE_UNITS.slice();
  const bulk = source ? normalizeStockUnitList(source.bulk || source.bulkUnits) : DEFAULT_STOCK_BULK_UNITS.slice();
  for (const product of normalizeArray(products)) {
    const baseUnit = normalizeStockUnit(product && (product.baseUnit || product.unit));
    const bulkUnit = normalizeStockUnit(product && (product.bulkUnit || product.caseUnit));
    if (baseUnit && !base.includes(baseUnit)) base.push(baseUnit);
    if (bulkUnit && !bulk.includes(bulkUnit)) bulk.push(bulkUnit);
  }
  return {
    base: base.slice(0, 200),
    bulk: bulk.slice(0, 200),
    updatedAt: source && source.updatedAt || null,
    updatedBy: source && String(source.updatedBy || "") || ""
  };
}

function normalizeStockUnitList(value) {
  const seen = new Set();
  const result = [];
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  for (const item of source) {
    const unit = normalizeStockUnit(item);
    const key = stockUnitIdentity(unit);
    if (!unit || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(unit);
  }
  return result;
}

function stockUnitIdentity(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ");
}

function normalizeStockLocations(value) {
  const required = [
    { id: "stock-location-cafe", code: "CAFE", name: "Kafe Deposu", type: "cafe", active: true, sortOrder: 10, isDefault: true },
    { id: "stock-location-general", code: "GENEL", name: "Genel Depo", type: "central", active: true, sortOrder: 20, isDefault: false }
  ];
  const source = normalizeArray(value);
  const seenIds = new Set();
  const seenCodes = new Set();
  const result = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const code = String(item.code || "").trim().toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9_-]/g, "").slice(0, 48);
    const id = String(item.id || "").trim().slice(0, 180);
    if (!id || !code || seenIds.has(id) || seenCodes.has(code)) continue;
    seenIds.add(id);
    seenCodes.add(code);
    result.push({
      ...item,
      id,
      code,
      name: String(item.name || code).trim().slice(0, 120) || code,
      description: String(item.description || "").trim().slice(0, 500),
      type: ["cafe", "central", "other"].includes(item.type) ? item.type : "other",
      active: item.active !== false,
      sortOrder: Math.max(0, Math.trunc(finiteNumber(item.sortOrder, result.length * 10))),
      isDefault: item.isDefault === true,
      assignedPersonnelIds: normalizeArray(item.assignedPersonnelIds).map((idValue) => String(idValue || "").trim()).filter(Boolean).slice(0, 1000),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      deactivatedAt: item.active === false ? item.deactivatedAt || item.updatedAt || null : null
    });
  }
  for (const location of required) {
    const existing = result.find((item) => item.code === location.code || item.id === location.id);
    if (existing) {
      if (!existing.id) existing.id = location.id;
      if (location.code === "CAFE" && existing.active !== false && !result.some((item) => item.active !== false && item.isDefault)) existing.isDefault = true;
      continue;
    }
    result.push({ ...location, description: "", assignedPersonnelIds: [], createdAt: null, updatedAt: null, deactivatedAt: null });
  }
  if (!result.some((item) => item.active !== false && item.isDefault)) {
    const cafe = result.find((item) => item.active !== false && item.code === "CAFE");
    if (cafe) cafe.isDefault = true;
  }
  const defaultLocation = result.find((item) => item.active !== false && item.isDefault)
    || result.find((item) => item.active !== false && item.code === "CAFE")
    || result.find((item) => item.active !== false)
    || result.find((item) => item.isDefault)
    || result.find((item) => item.code === "CAFE")
    || result[0];
  for (const location of result) location.isDefault = Boolean(defaultLocation && location.id === defaultLocation.id);
  return result.sort((first, second) => Number(first.sortOrder || 0) - Number(second.sortOrder || 0) || String(first.name).localeCompare(String(second.name), "tr"));
}

function normalizeStockBalances(value, products, locations, legacyMigrationRequired, legacyLocationId) {
  const validProducts = new Set(products.map((product) => String(product.id)));
  const validLocations = new Set(locations.map((location) => String(location.id)));
  const seen = new Set();
  const balances = [];
  if (!legacyMigrationRequired) {
    for (const item of normalizeArray(value)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const locationId = String(item.locationId || "").trim();
      const productId = String(item.productId || item.stockProductId || "").trim();
      const key = `${locationId}\u0000${productId}`;
      if (!validLocations.has(locationId) || !validProducts.has(productId) || seen.has(key)) continue;
      seen.add(key);
      balances.push({
        ...item,
        id: String(item.id || stableStockId("stock-balance", key)),
        locationId,
        productId,
        quantity: Math.max(0, finiteNumber(item.quantity ?? item.stockQuantity, 0)),
        revision: Math.max(0, Math.trunc(finiteNumber(item.revision, 0))),
        criticalThreshold: Math.max(0, finiteNumber(item.criticalThreshold, 0)),
        orderThreshold: Math.max(0, finiteNumber(item.orderThreshold ?? item.warningThreshold, 0)),
        targetLevel: Math.max(0, finiteNumber(item.targetLevel, 0)),
        updatedAt: item.updatedAt || null
      });
    }
  }
  for (const product of products) {
    for (const location of locations) {
      const key = `${location.id}\u0000${product.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quantity = legacyMigrationRequired && location.id === legacyLocationId
        ? Math.max(0, finiteNumber(product.stockQuantity ?? product.quantity ?? product.stock, 0))
        : 0;
      // İlk lokasyon migration'ında eski tekil stok Kafe Deposuna bağlanır.
      // Daha önce tamamlanmış store'lar bu kola girmez; mevcut dağılım korunur.
      const inheritLegacyThresholds = location.id === legacyLocationId;
      balances.push({
        id: stableStockId("stock-balance", key),
        locationId: location.id,
        productId: product.id,
        quantity,
        revision: 0,
        criticalThreshold: inheritLegacyThresholds ? Math.max(0, finiteNumber(product.criticalThreshold, 0)) : 0,
        orderThreshold: inheritLegacyThresholds ? Math.max(0, finiteNumber(product.orderThreshold ?? product.warningThreshold, 0)) : 0,
        targetLevel: inheritLegacyThresholds ? Math.max(0, finiteNumber(product.targetLevel, 0)) : 0,
        updatedAt: product.updatedAt || null
      });
    }
  }
  return balances;
}

function normalizeStockMigrationAudit(value, legacyMigrationRequired, balances, destinationLocation) {
  const source = normalizeArray(value).filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!legacyMigrationRequired || source.some((item) => item.id === "stock-location-migration-v1")) return source.slice(-100);
  const destinationLocationId = String(destinationLocation && destinationLocation.id || "stock-location-cafe");
  const migratedQuantity = balances
    .filter((balance) => String(balance.locationId) === destinationLocationId)
    .reduce((total, balance) => total + Number(balance.quantity || 0), 0);
  return source.concat({
    id: "stock-location-migration-v1",
    type: "legacy_single_balance_to_cafe",
    destinationLocationId,
    migratedProductCount: balances.filter((balance) => String(balance.locationId) === destinationLocationId && Number(balance.quantity || 0) > 0).length,
    migratedQuantity: Math.max(0, finiteNumber(migratedQuantity, 0)),
    appliedAt: null
  }).slice(-100);
}

function normalizeStockTransfers(value, productsById, locations) {
  const locationIds = new Set(locations.map((location) => String(location.id)));
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim();
    const productId = String(item.productId || item.stockProductId || item.items && item.items[0] && (item.items[0].productId || item.items[0].stockProductId) || "").trim();
    const fromLocationId = String(item.fromLocationId || "").trim();
    const toLocationId = String(item.toLocationId || "").trim();
    if (!id || seen.has(id) || !productsById.has(productId) || !locationIds.has(fromLocationId) || !locationIds.has(toLocationId) || fromLocationId === toLocationId) return null;
    seen.add(id);
    const rawItems = normalizeArray(item.items).length ? normalizeArray(item.items) : [item];
    const itemIds = new Set();
    const items = rawItems.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const entryProductId = String(entry.productId || entry.stockProductId || "").trim();
      const product = productsById.get(entryProductId);
      if (!product || itemIds.has(entryProductId)) return null;
      itemIds.add(entryProductId);
      const baseUnit = normalizeStockUnit(entry.baseUnit || product.baseUnit || product.unit || "adet");
      const snapshot = entry.conversionSnapshot && typeof entry.conversionSnapshot === "object" && !Array.isArray(entry.conversionSnapshot)
        ? { ...entry.conversionSnapshot }
        : null;
      const schemaVersionValue = entry.unitSchemaVersion ?? (snapshot && snapshot.unitSchemaVersion);
      const unitSchemaVersion = Number.isInteger(Number(schemaVersionValue)) && Number(schemaVersionValue) > 0
        ? Math.trunc(Number(schemaVersionValue))
        : null;
      return {
        productId: entryProductId,
        quantity: Math.max(0, finiteNumber(entry.quantity, 0)),
        baseUnit,
        sourceQuantity: Math.max(0, finiteNumber(entry.sourceQuantity ?? entry.quantity, 0)),
        sourceUnit: normalizeStockUnit(entry.sourceUnit || entry.inputUnit || entry.baseUnit || baseUnit),
        unitSchemaVersion,
        conversionFactor: Math.max(0, finiteNumber(entry.conversionFactor, 1)),
        conversionSnapshot: snapshot ? { ...snapshot, unitSchemaVersion } : null,
        sourceExpectedRevision: entry.sourceExpectedRevision === null || entry.sourceExpectedRevision === undefined
          ? null
          : Math.max(0, Math.trunc(finiteNumber(entry.sourceExpectedRevision, 0))),
        destinationExpectedRevision: entry.destinationExpectedRevision === null || entry.destinationExpectedRevision === undefined
          ? null
          : Math.max(0, Math.trunc(finiteNumber(entry.destinationExpectedRevision, 0)))
      };
    }).filter((entry) => entry && entry.quantity > 0);
    if (!items.length) return null;
    const firstItem = items[0];
    return {
      ...item,
      id,
      status: ["draft", "pending", "approved", "rejected", "cancelled"].includes(item.status) ? item.status : "pending",
      productId: firstItem.productId,
      items,
      fromLocationId,
      toLocationId,
      quantity: firstItem.quantity,
      baseUnit: firstItem.baseUnit,
      sourceQuantity: firstItem.sourceQuantity,
      sourceUnit: firstItem.sourceUnit,
      unitSchemaVersion: firstItem.unitSchemaVersion,
      conversionFactor: firstItem.conversionFactor,
      conversionSnapshot: firstItem.conversionSnapshot,
      requestedBy: String(item.requestedBy || ""),
      requestedByName: String(item.requestedByName || ""),
      requestId: String(item.requestId || ""),
      transactionRef: String(item.transactionRef || "") || null,
      movementIds: normalizeArray(item.movementIds).map((movementId) => String(movementId || "").trim()).filter(Boolean),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || item.createdAt || null
    };
  }).filter(Boolean).slice(0, 2000);
}

function normalizeStockCounts(value, productsById, locations) {
  const locationIds = new Set(locations.map((location) => String(location.id)));
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim();
    const locationId = String(item.locationId || "").trim();
    if (!id || seen.has(id) || !locationIds.has(locationId)) return null;
    seen.add(id);
    const items = normalizeArray(item.items).map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const productId = String(entry.productId || entry.stockProductId || "").trim();
      const product = productsById.get(productId);
      if (!product) return null;
      const systemQuantity = Math.max(0, finiteNumber(entry.systemQuantity ?? entry.expectedQuantity, 0));
      const countedValue = entry.countedQuantity ?? entry.physicalQuantity;
      const countedQuantity = countedValue === null || countedValue === undefined || countedValue === ""
        ? null
        : Math.max(0, finiteNumber(countedValue, 0));
      return {
        ...entry,
        id: String(entry.id || stableStockId("stock-count-item", `${id}\u0000${productId}\u0000${index}`)),
        productId,
        systemQuantity,
        countedQuantity,
        inputQuantity: countedQuantity === null ? null : Math.max(0, finiteNumber(entry.inputQuantity ?? countedQuantity, countedQuantity)),
        inputUnit: normalizeStockUnit(entry.inputUnit || entry.unit || product.baseUnit || product.unit),
        conversionFactor: Math.max(0, finiteNumber(entry.conversionFactor, 1)),
        difference: countedQuantity === null ? null : finiteNumber(entry.difference, countedQuantity - systemQuantity),
        note: String(entry.note || "").trim().slice(0, 500),
        movementId: entry.movementId ? String(entry.movementId) : null,
        updatedAt: entry.updatedAt || null
      };
    }).filter(Boolean);
    return {
      ...item,
      id,
      locationId,
      status: ["active", "completed", "cancelled"].includes(item.status) ? item.status : "active",
      items,
      startedBy: String(item.startedBy || item.createdBy || ""),
      startedByName: String(item.startedByName || item.createdByName || ""),
      completedBy: item.completedBy ? String(item.completedBy) : null,
      cancelledBy: item.cancelledBy ? String(item.cancelledBy) : null,
      requestId: String(item.requestId || ""),
      movementIds: normalizeArray(item.movementIds).map((movementId) => String(movementId || "").trim()).filter(Boolean),
      note: String(item.note || "").trim().slice(0, 500),
      createdAt: item.createdAt || item.startedAt || null,
      startedAt: item.startedAt || item.createdAt || null,
      updatedAt: item.updatedAt || item.startedAt || item.createdAt || null,
      completedAt: item.completedAt || null,
      cancelledAt: item.cancelledAt || null,
      appliedAt: item.appliedAt || null
    };
  }).filter(Boolean).slice(0, 1000);
}

function normalizeStockOperationKeys(value) {
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const key = String(item.key || "").trim().slice(0, 260);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return { ...item, key, type: String(item.type || ""), requestId: String(item.requestId || ""), value: item.value && typeof item.value === "object" ? item.value : {}, createdAt: item.createdAt || null };
  }).filter(Boolean).slice(-1000);
}

function normalizeStockCategory(category, index) {
  if (!category || typeof category !== "object" || Array.isArray(category)) return null;
  const name = String(category.name || `Kategori ${index + 1}`).trim();
  return {
    ...category,
    id: String(category.id || stableStockId("stock-category", name || index)),
    name,
    active: category.active !== false,
    order: finiteNumber(category.order, index),
    ...normalizeSourceMetadata(category)
  };
}

function normalizeStockProduct(product, index, categoryNames) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const categoryId = String(product.categoryId || stableStockId("stock-category", product.category || "Genel")).trim();
  const baseUnit = normalizeStockUnit(product.baseUnit || product.unit || "adet") || "adet";
  const bulkUnit = normalizeStockUnit(product.bulkUnit || product.caseUnit || product.purchaseUnit || "");
  const packageMetadata = product.packageInfo && typeof product.packageInfo === "object" ? product.packageInfo : {};
  const unitsPerBulkUnit = Math.max(0, finiteNumber(
    product.unitsPerBulkUnit ?? product.unitsPerCase ?? product.packageSize ?? product.packSize
      ?? product.piecesPerBox ?? product.koliIci ?? packageMetadata.unitsPerCase ?? packageMetadata.quantity,
    0
  ));
  const allowDecimal = typeof product.allowDecimal === "boolean"
    ? product.allowDecimal
    : ["kg", "gr", "litre", "ml"].includes(baseUnit);
  const requestedDefaultUnit = normalizeStockUnit(product.defaultMovementUnit || baseUnit);
  const defaultMovementUnit = requestedDefaultUnit === bulkUnit && bulkUnit && unitsPerBulkUnit > 0
    ? bulkUnit
    : baseUnit;
  const normalizedSchema = normalizeStockUnitSchemaHistory(product, {
    baseUnit,
    bulkUnit,
    unitsPerBulkUnit,
    allowDecimal,
    defaultMovementUnit
  });
  return {
    ...product,
    id: String(product.id || stableStockId("stock-product", `${categoryId}\u0000${product.productName || product.name || index}`)),
    categoryId,
    category: String(product.category || categoryNames.get(categoryId) || "Genel"),
    productName: String(product.productName || product.name || `Stok Ürünü ${index + 1}`),
    name: String(product.name || product.productName || `Stok Ürünü ${index + 1}`),
    unit: baseUnit,
    baseUnit,
    bulkUnit,
    caseUnit: bulkUnit,
    unitsPerBulkUnit,
    unitsPerCase: unitsPerBulkUnit,
    allowDecimal,
    defaultMovementUnit,
    unitSchemaVersion: normalizedSchema.version,
    unitSchemaHistory: normalizedSchema.history,
    unitSchemaSource: ["manual", "excel", "legacy"].includes(String(product.unitSchemaSource || ""))
      ? String(product.unitSchemaSource)
      : (product.sourceType === "excel" ? "excel" : product.sourceType === "manual" ? "manual" : "legacy"),
    unitSchemaLocked: product.unitSchemaLocked === true,
    unitSchemaUpdatedAt: product.unitSchemaUpdatedAt || null,
    stockQuantity: Math.max(0, finiteNumber(product.stockQuantity ?? product.quantity ?? product.stock, 0)),
    stockQuantityText: String(product.stockQuantityText ?? product.quantityText ?? product.stockQuantity ?? product.quantity ?? product.stock ?? ""),
    orderThreshold: Math.max(0, finiteNumber(product.orderThreshold ?? product.warningThreshold, 0)),
    orderThresholdText: String(product.orderThresholdText ?? product.warningThresholdText ?? product.orderThreshold ?? product.warningThreshold ?? ""),
    criticalThreshold: Math.max(0, finiteNumber(product.criticalThreshold, 0)),
    targetLevel: Math.max(0, finiteNumber(product.targetLevel, 0)),
    brand: String(product.brand || product.supplier || ""),
    supplier: String(product.supplier || product.brand || ""),
    note: String(product.note || ""),
    imageUrl: String(product.imageUrl || product.image || ""),
    active: product.active !== false,
    updatedAt: product.updatedAt || null,
    ...normalizeSourceMetadata(product)
  };
}

function normalizeStockUnit(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.value ?? value.code ?? value.unit ?? value.baseUnit ?? value.name ?? value.label ?? ""
    : value;
  const unit = String(source || "").trim().toLocaleLowerCase("tr-TR");
  const ascii = unit.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalized = {
    l: "litre", lt: "litre", liter: "litre", litre: "litre",
    kilogram: "kg", kilo: "kg", gram: "gr",
    tane: "adet", adet: "adet", sise: "şişe", "şişe": "şişe",
    kutu: "kutu", paket: "paket", koli: "koli", kasa: "kasa", cuval: "çuval", "çuval": "çuval"
  }[ascii] || unit;
  return normalized && normalized.length <= 30 && /^[\p{L}\p{N} _-]+$/u.test(normalized) ? normalized : "";
}

function normalizeStockUnitSchemaHistory(product, activeSchema) {
  const requestedVersion = Math.max(1, Math.trunc(finiteNumber(product.unitSchemaVersion, 1)));
  const history = normalizeArray(product.unitSchemaHistory).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const version = Math.max(1, Math.trunc(finiteNumber(entry.version, 0)));
    const baseUnit = normalizeStockUnit(entry.baseUnit || entry.unit || "");
    if (!baseUnit) return null;
    const bulkUnit = normalizeStockUnit(entry.bulkUnit || entry.caseUnit || "");
    const unitsPerBulkUnit = bulkUnit
      ? Math.max(0, finiteNumber(entry.unitsPerBulkUnit ?? entry.unitsPerCase, 0))
      : 0;
    return {
      version,
      baseUnit,
      bulkUnit,
      unitsPerBulkUnit,
      allowDecimal: typeof entry.allowDecimal === "boolean" ? entry.allowDecimal : ["kg", "gr", "litre", "ml"].includes(baseUnit),
      defaultMovementUnit: normalizeStockUnit(entry.defaultMovementUnit || baseUnit) || baseUnit,
      validFrom: entry.validFrom || null,
      validUntil: entry.validUntil || null
    };
  }).filter(Boolean).sort((left, right) => left.version - right.version);
  const sameSchema = (entry) => entry
    && entry.baseUnit === activeSchema.baseUnit
    && entry.bulkUnit === activeSchema.bulkUnit
    && Number(entry.unitsPerBulkUnit || 0) === Number(activeSchema.unitsPerBulkUnit || 0)
    && entry.allowDecimal === activeSchema.allowDecimal
    && entry.defaultMovementUnit === activeSchema.defaultMovementUnit;
  const maxVersion = history.reduce((maximum, entry) => Math.max(maximum, entry.version), 0);
  let version = Math.max(requestedVersion, maxVersion || 1);
  let activeEntry = history.find((entry) => entry.version === version && sameSchema(entry));
  if (!activeEntry) {
    if (history.length) version = Math.max(version, maxVersion + 1);
    activeEntry = {
      version,
      ...activeSchema,
      validFrom: product.unitSchemaUpdatedAt || product.createdAt || null,
      validUntil: null
    };
    history.push(activeEntry);
  }
  history.sort((left, right) => left.version - right.version);
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    const next = history[index + 1];
    if (entry.version === version) entry.validUntil = null;
    else if (!entry.validUntil && next && next.validFrom) entry.validUntil = next.validFrom;
  }
  return { version, history };
}

function normalizeStockMovement(movement, productsById = new Map(), legacyGeneralLocationId = "stock-location-general") {
  if (!movement || typeof movement !== "object" || Array.isArray(movement)) return null;
  const productId = String(movement.stockProductId || movement.productId || "");
  const product = productsById.get(productId);
  const baseUnit = normalizeStockUnit(movement.baseUnit || movement.unit || product && (product.baseUnit || product.unit) || "adet") || "adet";
  const sourceQuantity = Math.max(0, finiteNumber(movement.inputQuantity ?? movement.sourceQuantity ?? movement.quantity, 0));
  const sourceUnit = normalizeStockUnit(movement.inputUnit || movement.sourceUnit || movement.unit || baseUnit) || baseUnit;
  const previousBalance = Math.max(0, finiteNumber(movement.previousBalance ?? movement.previousStock, 0));
  const resultingBalance = Math.max(0, finiteNumber(movement.resultingBalance ?? movement.resultingStock, 0));
  const inferredDelta = resultingBalance - previousBalance;
  const baseQuantityDelta = finiteNumber(movement.baseQuantityDelta, inferredDelta);
  const explicitSnapshot = movement.conversionSnapshot && typeof movement.conversionSnapshot === "object" && !Array.isArray(movement.conversionSnapshot)
    ? movement.conversionSnapshot
    : null;
  const schemaVersionValue = movement.unitSchemaVersion ?? (explicitSnapshot && explicitSnapshot.unitSchemaVersion);
  const unitSchemaVersion = Number.isInteger(Number(schemaVersionValue)) && Number(schemaVersionValue) > 0
    ? Math.trunc(Number(schemaVersionValue))
    : null;
  const hasMovementFactor = movement.conversionFactor !== null
    && movement.conversionFactor !== undefined
    && movement.conversionFactor !== "";
  const hasSnapshotFactor = explicitSnapshot
    && explicitSnapshot.factor !== null
    && explicitSnapshot.factor !== undefined
    && explicitSnapshot.factor !== "";
  const explicitConversionFactor = hasMovementFactor && Number.isFinite(Number(movement.conversionFactor))
    ? Number(movement.conversionFactor)
    : hasSnapshotFactor && Number.isFinite(Number(explicitSnapshot.factor)) ? Number(explicitSnapshot.factor) : null;
  const conversionSnapshot = explicitSnapshot
    ? {
        ...explicitSnapshot,
        baseUnit: normalizeStockUnit(explicitSnapshot.baseUnit || baseUnit) || baseUnit,
        bulkUnit: normalizeStockUnit(explicitSnapshot.bulkUnit || ""),
        unitsPerBulkUnit: Math.max(0, finiteNumber(explicitSnapshot.unitsPerBulkUnit ?? explicitSnapshot.unitsPerCase, 0)),
        inputUnit: normalizeStockUnit(explicitSnapshot.inputUnit || sourceUnit) || sourceUnit,
        factor: hasSnapshotFactor && Number.isFinite(Number(explicitSnapshot.factor)) ? Number(explicitSnapshot.factor) : explicitConversionFactor,
        unitSchemaVersion
      }
    : {
        baseUnit,
        bulkUnit: "",
        unitsPerBulkUnit: 0,
        inputUnit: sourceUnit,
        factor: explicitConversionFactor,
        unitSchemaVersion: null,
        legacyInferred: true
      };
  return {
    ...movement,
    id: String(movement.id || stableStockId("stock-movement", `${movement.productId || ""}\u0000${movement.createdAt || Date.now()}`)),
    productId: String(movement.productId || movement.stockProductId || ""),
    stockProductCode: normalizeProductCode(movement.stockProductCode || product && product.productCode),
    productName: String(movement.productName || ""),
    type: ["opening_balance", "manual_in", "manual_out", "waste", "inbound_shipment", "shipment_in", "transfer", "transfer_out", "transfer_in", "adjustment", "correction", "reversal", "stock_in", "stock_out", "order_suggestion", "import"].includes(movement.type) ? movement.type : "stock_out",
    quantity: Math.max(0, finiteNumber(movement.quantity, 0)),
    baseQuantity: Math.max(0, finiteNumber(movement.baseQuantity ?? movement.quantity, Math.abs(baseQuantityDelta))),
    unit: baseUnit,
    baseUnit,
    sourceQuantity,
    sourceUnit,
    inputQuantity: sourceQuantity,
    inputUnit: sourceUnit,
    baseQuantityDelta,
    unitSchemaVersion,
    conversionSnapshot,
    conversionFactor: explicitConversionFactor,
    locationId: String(movement.locationId || movement.toLocationId || movement.fromLocationId || legacyGeneralLocationId || ""),
    fromLocationId: movement.fromLocationId ? String(movement.fromLocationId) : null,
    toLocationId: movement.toLocationId ? String(movement.toLocationId) : null,
    transactionRef: String(movement.transactionRef || ""),
    transferId: String(movement.transferId || movement.referenceType === "transfer" && movement.referenceId || ""),
    referenceType: String(movement.referenceType || ""),
    referenceId: String(movement.referenceId || ""),
    previousBalance,
    resultingBalance,
    previousStock: previousBalance,
    resultingStock: resultingBalance,
    shipmentId: String(movement.shipmentId || ""),
    personnelId: String(movement.personnelId || movement.userId || ""),
    approvedBy: String(movement.approvedBy || ""),
    actorId: String(movement.actorId || movement.personnelId || movement.userId || ""),
    requestId: String(movement.requestId || ""),
    idempotencyKey: String(movement.idempotencyKey || movement.requestId || ""),
    expectedRevision: movement.expectedRevision === null || movement.expectedRevision === undefined
      ? null
      : Math.max(0, Math.trunc(finiteNumber(movement.expectedRevision, 0))),
    reason: String(movement.reason || ""),
    note: String(movement.note || ""),
    actor: String(movement.actor || "system"),
    createdAt: movement.createdAt || new Date(0).toISOString(),
    approvedAt: movement.approvedAt || movement.createdAt || new Date(0).toISOString(),
    reversedMovementId: movement.reversedMovementId || null
  };
}

function defaultStockState() {
  return {
    schemaVersion: 3,
    locationMigrationVersion: 1,
    unitMetadataMigrationVersion: 2,
    unitCatalogMigrationVersion: 1,
    unitDefinitions: {
      base: DEFAULT_STOCK_BASE_UNITS.slice(),
      bulk: DEFAULT_STOCK_BULK_UNITS.slice(),
      updatedAt: null,
      updatedBy: ""
    },
    categories: [],
    products: [],
    locations: [
      { id: "stock-location-cafe", code: "CAFE", name: "Kafe Deposu", type: "cafe", active: true, sortOrder: 10, isDefault: true, assignedPersonnelIds: [] },
      { id: "stock-location-general", code: "GENEL", name: "Genel Depo", type: "central", active: true, sortOrder: 20, isDefault: false, assignedPersonnelIds: [] }
    ],
    balances: [],
    movements: [],
    transfers: [],
    counts: [],
    operationKeys: [],
    notificationSettings: {}
  };
}

function normalizeSourceMetadata(value) {
  const source = value && typeof value === "object" ? value : {};
  const sourceType = ["excel", "manual", "legacy"].includes(source.sourceType) ? source.sourceType : "legacy";
  return {
    sourceType,
    sourceWorkbook: ["menu", "pricing", "recipe", "stock"].includes(source.sourceWorkbook) ? source.sourceWorkbook : "",
    sourceSheet: String(source.sourceSheet || ""),
    sourceNormalizedName: String(source.sourceNormalizedName || ""),
    productCode: normalizeProductCode(source.productCode),
    productCodeAliases: normalizeProductCodeList(source.productCodeAliases),
    nameHistory: normalizeNameHistory(source.nameHistory),
    importKey: String(source.importKey || ""),
    externalId: String(source.externalId || ""),
    aliasIds: normalizeArray(source.aliasIds).map((alias) => String(alias || "").trim()).filter(Boolean).slice(0, 100),
    sourcePresent: source.sourcePresent !== false,
    statusSource: String(source.statusSource || (sourceType === "legacy" ? "legacy" : "")),
    lastImportedAt: source.lastImportedAt || null,
    lastImportOperationId: String(source.lastImportOperationId || "")
  };
}

function collectWorkforceMigrationArchive(source) {
  const archived = new Map(normalizeArray(source.workforceMigrationArchive)
    .filter((item) => item && typeof item === "object" && item.id)
    .map((item) => [String(item.id), item]));
  const add = (scope, index, reason, record) => {
    const id = stableStockId("workforce-migration-archive", `${scope}\u0000${index}\u0000${reason}\u0000${JSON.stringify(record)}`);
    if (!archived.has(id)) archived.set(id, { id, scope, reason, sourceIndex: index, record });
  };

  for (const [scope, records] of [
    ["task", source.workforceTasks],
    ["shipment", source.workforceShipments],
    ["shift_request", source.workforceShiftRequests],
    ["shift_revision", source.workforceShiftPlanRevisions]
  ]) {
    normalizeArray(records).forEach((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) add(scope, index, "invalid_record", record);
    });
  }

  const assignmentIdentities = new Set();
  normalizeArray(source.workforceAssignments).forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      add("assignment", index, "invalid_record", record);
      return;
    }
    const taskId = String(record.taskId || "");
    const userId = String(record.userId || record.personnelId || record.personId || "");
    if (!taskId || !userId) {
      add("assignment", index, "missing_task_or_person", record);
      return;
    }
    const identity = `${taskId}\u0000${userId}`;
    if (assignmentIdentities.has(identity)) add("assignment", index, "duplicate_assignment", record);
    assignmentIdentities.add(identity);
  });

  const planIdentities = new Set();
  normalizeArray(source.workforceShiftPlans).forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      add("shift_plan", index, "invalid_record", record);
      return;
    }
    const personId = String(record.personId || record.personnelId || record.userId || "");
    if (!personId) {
      add("shift_plan", index, "missing_person", record);
      return;
    }
    const status = ["published", "yayınlandı", "yayinlandi"].includes(record.status) ? "published" : "draft";
    const identity = `${record.weekStart || ""}\u0000${personId}\u0000${record.date || ""}\u0000${status}`;
    if (planIdentities.has(identity)) add("shift_plan", index, "duplicate_plan", record);
    planIdentities.add(identity);
  });

  return [...archived.values()].slice(-1000);
}

function normalizeProcurement(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...source,
    version: Math.max(PROCUREMENT_SCHEMA_VERSION, Math.trunc(finiteNumber(source.version, 0))),
    revision: Math.max(0, Math.trunc(finiteNumber(source.revision, 0))),
    suppliers: normalizeProcurementEntities(source.suppliers, normalizeProcurementSupplier),
    supplierProductLinks: normalizeProcurementEntities(source.supplierProductLinks, normalizeSupplierProductLink),
    supplierIndependentProducts: normalizeProcurementEntities(source.supplierIndependentProducts, normalizeSupplierIndependentProduct),
    documents: normalizeProcurementEntities(source.documents, normalizeProcurementDocument),
    ledgerEntries: normalizeProcurementEntities(source.ledgerEntries, normalizeLedgerEntry),
    payments: normalizeProcurementEntities(source.payments, normalizeProcurementPayment),
    auditEvents: normalizeProcurementEntities(source.auditEvents, normalizeProcurementAuditEvent).slice(-5000),
    idempotencyRecords: normalizeProcurementEntities(source.idempotencyRecords, normalizeProcurementIdempotency).slice(-1000),
    settings: normalizeProcurementSettings(source.settings)
  };
}

function reconcileProcurementBranchMetadata(procurement, rawProcurement, shipments) {
  const raw = rawProcurement && typeof rawProcurement === "object" && !Array.isArray(rawProcurement) ? rawProcurement : {};
  const shipmentIndex = new Map(normalizeArray(shipments).map((shipment) => [String(shipment.id || ""), shipment]));
  const rawDocuments = new Map(normalizeArray(raw.documents).map((item) => [String(item && item.id || ""), item]));
  const rawLedger = new Map(normalizeArray(raw.ledgerEntries).map((item) => [String(item && item.id || ""), item]));
  const rawPayments = new Map(normalizeArray(raw.payments).map((item) => [String(item && item.id || ""), item]));
  const documentIndex = new Map(procurement.documents.map((document) => [document.id, document]));
  const branchFromShipment = (id) => procurementText(shipmentIndex.get(String(id || "")) && shipmentIndex.get(String(id || "")).branchId, 80) || "";
  for (const document of procurement.documents) {
    const original = rawDocuments.get(document.id);
    if (original && original.branchId) continue;
    const linkedBranch = (document.shipmentIds || []).map(branchFromShipment).find(Boolean);
    if (linkedBranch) document.branchId = linkedBranch;
  }
  for (const entry of procurement.ledgerEntries) {
    const original = rawLedger.get(entry.id);
    if (original && original.branchId) continue;
    const document = documentIndex.get(entry.documentId);
    entry.branchId = branchFromShipment(entry.shipmentId) || document && document.branchId || entry.branchId || "main";
  }
  const ledgerIndex = new Map(procurement.ledgerEntries.map((entry) => [entry.id, entry]));
  for (const payment of procurement.payments) {
    const original = rawPayments.get(payment.id);
    if (original && original.branchId) continue;
    const entry = ledgerIndex.get(payment.ledgerEntryId);
    const document = documentIndex.get(payment.documentId);
    payment.branchId = entry && entry.branchId || document && document.branchId || payment.branchId || "main";
  }
  return procurement;
}

function normalizeProcurementEntities(value, normalizer) {
  const byId = new Map();
  normalizeArray(value).forEach((item, index) => {
    const normalized = normalizer(item, index);
    if (normalized && normalized.id) byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
}

function normalizeProcurementSupplier(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  if (!id) return null;
  return {
    ...item,
    id,
    code: procurementText(item.code, 80),
    name: procurementText(item.name, 180),
    taxNumber: procurementText(item.taxNumber, 32),
    phone: procurementText(item.phone, 40),
    email: procurementText(item.email, 254).toLowerCase(),
    address: procurementText(item.address, 1000),
    paymentTermDays: Math.max(0, Math.min(3650, Math.trunc(finiteNumber(item.paymentTermDays, 0)))),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.createdAt || null,
    createdBy: procurementText(item.createdBy, 180),
    updatedBy: procurementText(item.updatedBy || item.createdBy, 180)
  };
}

function normalizeSupplierProductLink(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  const supplierId = procurementText(item.supplierId, 180);
  const stockProductId = procurementText(item.stockProductId || item.productId, 180);
  const stockProductCode = normalizeProductCode(item.stockProductCode || item.productCode);
  if (!id || !supplierId || (!stockProductId && !stockProductCode)) return null;
  const conversionFactor = finiteNumber(item.conversionFactor, 1);
  return {
    ...item,
    id,
    supplierId,
    stockProductId,
    stockProductCode,
    supplierProductName: procurementText(item.supplierProductName, 180),
    supplierProductCode: procurementText(item.supplierProductCode, 100),
    purchaseUnit: procurementText(item.purchaseUnit, 40),
    conversionFactor: conversionFactor > 0 ? conversionFactor : 1,
    defaultPurchasePriceKurus: Math.max(0, normalizeKurus(item.defaultPurchasePriceKurus, 0)),
    lastPurchasePriceKurus: Math.max(0, normalizeKurus(item.lastPurchasePriceKurus, 0)),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.createdAt || null
  };
}

function normalizeSupplierIndependentProduct(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  const supplierId = procurementText(item.supplierId, 180);
  const name = procurementText(item.name, 180);
  if (!id || !supplierId || !name) return null;
  return {
    ...item,
    id,
    supplierId,
    name,
    code: procurementText(item.code, 100),
    purchaseUnit: procurementText(item.purchaseUnit, 40),
    defaultPurchasePriceKurus: Math.max(0, normalizeKurus(item.defaultPurchasePriceKurus, 0)),
    lastPurchasePriceKurus: Math.max(0, normalizeKurus(item.lastPurchasePriceKurus, 0)),
    note: procurementText(item.note, 1000),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.createdAt || null,
    createdBy: procurementText(item.createdBy, 180),
    updatedBy: procurementText(item.updatedBy || item.createdBy, 180)
  };
}

function normalizeProcurementDocument(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  if (!id) return null;
  const documentType = ["fatura", "irsaliye", "fiş", "makbuz", "diğer"].includes(String(item.documentType || ""))
    ? String(item.documentType)
    : "diğer";
  return {
    ...item,
    id,
    branchId: procurementText(item.branchId, 80) || "main",
    supplierId: procurementText(item.supplierId, 180),
    shipmentIds: normalizeProcurementStringArray(item.shipmentIds || (item.shipmentId ? [item.shipmentId] : []), 180),
    shipmentItemIds: normalizeProcurementStringArray(item.shipmentItemIds || item.lineIds, 180),
    documentType,
    documentNumber: procurementText(item.documentNumber, 120),
    documentDate: procurementText(item.documentDate, 10),
    originalName: procurementText(item.originalName, 255),
    mimeType: procurementText(item.mimeType, 100),
    sizeBytes: Math.max(0, Math.trunc(finiteNumber(item.sizeBytes, 0))),
    sha256: procurementText(item.sha256, 128),
    physicalName: procurementText(item.physicalName, 255),
    thumbnailPhysicalName: procurementText(item.thumbnailPhysicalName, 255),
    archivedAt: item.archivedAt || null,
    archivedBy: procurementText(item.archivedBy, 180),
    createdAt: item.createdAt || null,
    createdBy: procurementText(item.createdBy, 180)
  };
}

function normalizeLedgerEntry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  const supplierId = procurementText(item.supplierId, 180);
  const type = ["invoice", "payment", "credit_note", "reversal", "opening_balance", "adjustment"].includes(String(item.type || ""))
    ? String(item.type)
    : "adjustment";
  if (!id || !supplierId) return null;
  return {
    ...item,
    id,
    supplierId,
    branchId: procurementText(item.branchId, 80) || "main",
    shipmentId: procurementText(item.shipmentId, 180),
    documentId: procurementText(item.documentId, 180),
    type,
    amountKurus: normalizeKurus(item.amountKurus, 0),
    balanceAfterKurus: item.balanceAfterKurus === undefined ? undefined : normalizeKurus(item.balanceAfterKurus, 0),
    dueDate: procurementText(item.dueDate, 10),
    note: procurementText(item.note, 1000),
    sourceType: procurementText(item.sourceType, 100),
    sourceId: procurementText(item.sourceId, 180),
    reversalOf: procurementText(item.reversalOf, 180),
    createdBy: procurementText(item.createdBy, 180),
    createdAt: item.createdAt || null,
    idempotencyKey: procurementText(item.idempotencyKey, 160)
  };
}

function normalizeProcurementPayment(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  const supplierId = procurementText(item.supplierId, 180);
  if (!id || !supplierId) return null;
  return {
    ...item,
    id,
    supplierId,
    branchId: procurementText(item.branchId, 80) || "main",
    documentId: procurementText(item.documentId, 180),
    ledgerEntryId: procurementText(item.ledgerEntryId, 180),
    amountKurus: Math.abs(normalizeKurus(item.amountKurus, 0)),
    paymentDate: procurementText(item.paymentDate, 10),
    method: procurementText(item.method, 80),
    reference: procurementText(item.reference, 180),
    note: procurementText(item.note, 1000),
    status: item.status === "reversed" ? "reversed" : "recorded",
    reversalLedgerEntryId: procurementText(item.reversalLedgerEntryId, 180),
    reversedAt: item.reversedAt || null,
    reversedBy: procurementText(item.reversedBy, 180),
    createdAt: item.createdAt || null,
    createdBy: procurementText(item.createdBy, 180)
  };
}

function normalizeProcurementAuditEvent(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 180);
  if (!id) return null;
  return {
    ...item,
    id,
    action: procurementText(item.action, 120),
    entityType: procurementText(item.entityType, 100),
    entityId: procurementText(item.entityId, 180),
    actorType: item.actorType === "admin" ? "admin" : "personel",
    actorId: procurementText(item.actorId, 180),
    actorName: procurementText(item.actorName, 180),
    revision: Math.max(0, Math.trunc(finiteNumber(item.revision, 0))),
    requestId: procurementText(item.requestId, 160),
    metadata: item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {},
    createdAt: item.createdAt || null
  };
}

function normalizeProcurementIdempotency(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = procurementText(item.id, 320);
  const key = procurementText(item.key || item.requestId, 160);
  if (!id || !key) return null;
  return {
    ...item,
    id,
    key,
    operation: procurementText(item.operation, 120),
    actorId: procurementText(item.actorId, 180),
    resourceId: procurementText(item.resourceId, 180),
    revision: Math.max(0, Math.trunc(finiteNumber(item.revision, 0))),
    response: item.response && typeof item.response === "object" && !Array.isArray(item.response) ? item.response : {},
    createdAt: item.createdAt || null
  };
}

function normalizeProcurementSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const units = normalizeProcurementStringArray(source.units, 40);
  const accountingDocumentTypes = normalizeProcurementStringArray(source.accountingDocumentTypes, 40)
    .filter((type) => ["fatura", "fiş", "makbuz"].includes(type));
  return {
    ...source,
    defaultBranchId: procurementText(source.defaultBranchId, 80) || "main",
    currency: "TRY",
    dueSoonDays: Math.max(1, Math.min(90, Math.trunc(finiteNumber(source.dueSoonDays, 7)))),
    units: units.length ? units : ["koli", "paket", "adet", "kg", "gr", "litre", "ml", "şişe"],
    accountingDocumentTypes: accountingDocumentTypes.length ? accountingDocumentTypes : ["fatura", "fiş", "makbuz"],
    updatedAt: source.updatedAt || null,
    updatedBy: procurementText(source.updatedBy, 180)
  };
}

function normalizeProcurementStringArray(value, maxLength) {
  return [...new Set(normalizeArray(value)
    .map((item) => procurementText(item, maxLength))
    .filter(Boolean))];
}

function normalizeKurus(value, fallback) {
  const number = Number(value);
  if (Number.isSafeInteger(number)) return number;
  const fallbackNumber = Number(fallback);
  return Number.isSafeInteger(fallbackNumber) ? fallbackNumber : 0;
}

function procurementText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function markWorkforcePersonnelState(data) {
  const users = new Map(normalizeArray(data.recipeUsers).map((user) => [String(user && user.id || ""), user]));
  const deleted = new Map(normalizeArray(data.deletedRecipeUsers).map((user) => [String(user && (user.id || user.userId) || ""), user]));
  const mark = (record, personId, nameFields = []) => {
    const id = String(personId || "");
    if (!record || !id || id === "admin") return;
    const user = users.get(id);
    if (user) {
      record.personInactive = user.active === false;
      return;
    }
    const tombstone = deleted.get(id);
    const currentName = nameFields.map((field) => String(record[field] || "").trim()).find(Boolean);
    record.personDeleted = true;
    record.personNameSnapshot = record.personNameSnapshot || currentName || tombstone && tombstone.name || "Silinmiş personel";
    record.personUsernameSnapshot = record.personUsernameSnapshot || tombstone && tombstone.username || "";
    record.personDeletedAt = record.personDeletedAt || tombstone && tombstone.deletedAt || null;
  };

  normalizeArray(data.workforceAssignments).forEach((record) => mark(record, record.userId || record.personnelId, ["userName", "name"]));
  normalizeArray(data.workforceShipments).forEach((record) => mark(record, record.userId || record.personnelId, ["userName", "personName"]));
  normalizeArray(data.workforceShiftRequests).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  normalizeArray(data.workforceShiftPlans).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  normalizeArray(data.workforceShiftPlanRevisions).forEach((revision) => {
    normalizeArray(revision.plans).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  });
  normalizeArray(data.stockState && data.stockState.movements).forEach((record) => mark(record, record.personnelId || record.userId, ["personName", "userName"]));
}

function normalizeWorkforceShipments(value, stockState, productCodeRegistry) {
  const products = new Map((stockState && stockState.products || []).map((product) => [String(product.id), product]));
  const locations = new Map((stockState && stockState.locations || []).map((location) => [String(location.id), location]));
  const movementsByShipment = new Map();
  for (const movement of stockState && stockState.movements || []) {
    const shipmentId = String(movement && movement.shipmentId || "");
    if (!shipmentId) continue;
    const refs = movementsByShipment.get(shipmentId) || [];
    refs.push(String(movement.id || movement.transactionRef || "").trim());
    movementsByShipment.set(shipmentId, refs.filter(Boolean));
  }
  return normalizeArray(value).map((shipment) => {
    if (!shipment || typeof shipment !== "object" || Array.isArray(shipment)) return null;
    const status = normalizeShipmentStatus(shipment.status);
    const evidenceDocumentIds = normalizeProcurementStringArray(shipment.evidenceDocumentIds, 180);
    const accountingEntryIds = normalizeProcurementStringArray(shipment.accountingEntryIds, 180);
    const stockMovementRefs = [...new Set([
      ...normalizeArray(shipment.stockMovementRefs || (shipment.stockMovementRef ? [shipment.stockMovementRef] : [])),
      ...(movementsByShipment.get(String(shipment.id || "")) || [])
    ])].map((item) => String(item || "").trim()).filter(Boolean);
    const shipmentMovement = (stockState && stockState.movements || []).find((movement) =>
      String(movement && movement.shipmentId || "") === String(shipment.id || "") && movement.locationId
    );
    const requestedDestinationId = String(shipment.destinationLocationId || shipmentMovement && shipmentMovement.locationId || "").trim();
    const destination = locations.get(requestedDestinationId) || null;
    return {
      ...shipment,
      status,
      revision: Math.max(0, Math.trunc(finiteNumber(shipment.revision, 0))),
      expectedRevision: Math.max(0, Math.trunc(finiteNumber(shipment.expectedRevision, shipment.revision || 0))),
      requestId: String(shipment.requestId || ""),
      supplierId: procurementText(shipment.supplierId, 180),
      branchId: procurementText(shipment.branchId, 80) || "main",
      evidenceDocumentIds,
      documentType: procurementText(shipment.documentType, 40),
      documentNumber: procurementText(shipment.documentNumber, 120),
      documentDate: procurementText(shipment.documentDate, 10),
      accountingStatus: shipment.accountingStatus === "reversed"
        ? "reversed"
        : accountingEntryIds.length || shipment.accountingPostedAt
          ? "posted"
          : "not_posted",
      accountingEntryIds,
      accountingPostedAt: shipment.accountingPostedAt || null,
      accountingPostedBy: procurementText(shipment.accountingPostedBy, 180),
      evidenceStatus: shipment.evidenceStatus === "archived"
        ? "archived"
        : evidenceDocumentIds.length
          ? "available"
          : "missing",
      operationalStatus: procurementText(shipment.operationalStatus, 80) || status,
      updatedAt: shipment.updatedAt || shipment.createdAt || null,
      stockAppliedAt: shipment.stockAppliedAt || (status === "onaylandı" ? shipment.approvedAt || shipment.updatedAt || shipment.createdAt || null : null),
      stockMovementRef: String(shipment.stockMovementRef || stockMovementRefs[0] || "") || null,
      stockMovementRefs,
      destinationLocationId: destination ? destination.id : null,
      destinationLocationName: destination ? destination.name : String(shipment.destinationLocationName || "") || null,
      items: normalizeArray(shipment.items).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const productId = String(item.stockProductId || item.productId || "");
        const product = products.get(productId);
        const stockProductCode = normalizeProductCode(
          item.stockProductCode
          || product && product.productCode
          || registryCodeForEntity(productCodeRegistry, "stock", productId)
        );
        return { ...item, stockProductCode };
      }).filter(Boolean)
    };
  }).filter(Boolean);
}

function normalizeWorkforceTasks(value) {
  return normalizeArray(value).map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) return null;
    const id = String(task.id || stableStockId("workforce-task", `${task.createdAt || ""}\u0000${task.title || task.text || index}`));
    const rawItems = normalizeArray(task.items).length
      ? task.items
      : [task.item || task.text || task.title || "Görev"];
    const seen = new Set();
    const items = rawItems.map((item, itemIndex) => {
      const source = item && typeof item === "object" ? item : { text: item };
      const text = String(source.text || source.title || "").trim().slice(0, 300);
      if (!text) return null;
      let itemId = String(source.id || stableStockId("task-item", `${id}\u0000${itemIndex}\u0000${text}`));
      while (seen.has(itemId)) itemId = `${itemId}-${itemIndex + 1}`;
      seen.add(itemId);
      return { ...source, id: itemId, text, order: finiteNumber(source.order, itemIndex) };
    }).filter(Boolean);
    const dueDate = String(task.dueDate || (task.dueAt ? String(task.dueAt).slice(0, 10) : ""));
    const dueTime = String(task.dueTime || (task.dueAt && String(task.dueAt).includes("T") ? String(task.dueAt).slice(11, 16) : ""));
    return {
      ...task,
      id,
      title: String(task.title || task.text || "Görev").trim().slice(0, 160),
      description: String(task.description || "").trim().slice(0, 1000),
      managerNote: String(task.managerNote || task.adminNote || "").trim().slice(0, 1000),
      items,
      priority: ["low", "normal", "high", "urgent"].includes(task.priority) ? task.priority : "normal",
      dueDate,
      dueTime,
      dueAt: String(task.dueAt || (dueDate ? `${dueDate}T${dueTime || "23:59"}:00.000+03:00` : "")),
      status: normalizeTaskStatus(task.status),
      revision: Math.max(0, Math.trunc(finiteNumber(task.revision, 0))),
      assignedUserIds: [...new Set(normalizeArray(task.assignedUserIds).map(String).filter(Boolean))]
    };
  }).filter(Boolean);
}

function normalizeWorkforceAssignments(value, tasksValue) {
  const tasks = new Map(normalizeWorkforceTasks(tasksValue).map((task) => [task.id, task]));
  const seen = new Set();
  return normalizeArray(value).map((assignment, index) => {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return null;
    const taskId = String(assignment.taskId || "");
    const userId = String(assignment.userId || assignment.personnelId || assignment.personId || "");
    if (!taskId || !userId) return null;
    const identity = `${taskId}\u0000${userId}`;
    if (seen.has(identity)) return null;
    seen.add(identity);
    const task = tasks.get(taskId);
    const validItemIds = new Set(task ? task.items.map((item) => item.id) : []);
    const completedItemIds = [...new Set(normalizeArray(assignment.completedItemIds)
      .map(String).filter((itemId) => !validItemIds.size || validItemIds.has(itemId)))];
    const status = normalizeAssignmentStatus(assignment.status, completedItemIds.length, validItemIds.size);
    const progress = validItemIds.size ? Math.round(completedItemIds.length / validItemIds.size * 100) : status === "completed" ? 100 : 0;
    return {
      ...assignment,
      id: String(assignment.id || stableStockId("task-assignment", identity || index)),
      taskId,
      userId,
      personnelId: userId,
      status,
      completedItemIds,
      progress,
      assignedAt: assignment.assignedAt || assignment.createdAt || null,
      startedAt: assignment.startedAt || (progress > 0 ? assignment.updatedAt || assignment.createdAt || null : null),
      completedAt: status === "completed" ? assignment.completedAt || assignment.updatedAt || null : null,
      revision: Math.max(0, Math.trunc(finiteNumber(assignment.revision, 0)))
    };
  }).filter(Boolean);
}

function reconcileWorkforceAssignments(tasksValue, assignmentsValue, usersValue) {
  const tasks = normalizeWorkforceTasks(tasksValue);
  const users = new Map(normalizeArray(usersValue).map((user) => [String(user && user.id || ""), user]));
  const assignments = normalizeWorkforceAssignments(assignmentsValue, tasks);
  const byIdentity = new Map(assignments.map((assignment) => [`${assignment.taskId}\u0000${assignment.userId}`, assignment]));

  for (const task of tasks) {
    const legacyIds = [
      ...normalizeArray(task.assignedUserIds),
      task.userId,
      task.personId,
      task.personnelId
    ].map((value) => String(value || "")).filter(Boolean);
    const existingIds = assignments.filter((assignment) => assignment.taskId === task.id).map((assignment) => assignment.userId);
    const assignedUserIds = [...new Set([...legacyIds, ...existingIds])];
    task.assignedUserIds = assignedUserIds;
    for (const userId of assignedUserIds) {
      const identity = `${task.id}\u0000${userId}`;
      if (byIdentity.has(identity)) continue;
      const user = users.get(userId);
      const createdAt = task.createdAt || new Date(0).toISOString();
      const assignment = {
        id: stableStockId("task-assignment", identity),
        taskId: task.id,
        userId,
        personnelId: userId,
        userName: String(user && (user.name || user.username) || task.userName || "Personel"),
        username: String(user && user.username || task.username || ""),
        status: task.status === "cancelled" ? "cancelled" : task.status === "completed" ? "completed" : "pending",
        completedItemIds: task.status === "completed" ? task.items.map((item) => item.id) : [],
        progress: task.status === "completed" ? 100 : 0,
        assignedAt: createdAt,
        startedAt: null,
        completedAt: task.status === "completed" ? task.completedAt || task.updatedAt || createdAt : null,
        createdAt,
        updatedAt: task.updatedAt || createdAt,
        revision: 0,
        migratedFromLegacyTask: true
      };
      assignments.push(assignment);
      byIdentity.set(identity, assignment);
    }
  }
  return assignments;
}

function syncWorkforceTaskAssignees(tasksValue, assignmentsValue) {
  const assignments = normalizeArray(assignmentsValue);
  return normalizeWorkforceTasks(tasksValue).map((task) => ({
    ...task,
    assignedUserIds: [...new Set([
      ...normalizeArray(task.assignedUserIds).map(String),
      ...assignments.filter((assignment) => assignment.taskId === task.id).map((assignment) => String(assignment.userId || ""))
    ].filter(Boolean))]
  }));
}

function normalizeWorkforceShiftRequests(value) {
  return normalizeArray(value).map((request, index) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) return null;
    const personId = String(request.personId || request.personnelId || request.userId || "");
    return {
      ...request,
      id: String(request.id || stableStockId("shift-request", `${personId}\u0000${request.date || ""}\u0000${request.type || index}`)),
      personId,
      personnelId: personId,
      status: normalizeShiftRequestStatus(request.status),
      requestId: String(request.requestId || ""),
      revision: Math.max(0, Math.trunc(finiteNumber(request.revision, 0))),
      adminNote: String(request.adminNote || request.rejectionReason || "").slice(0, 250)
    };
  }).filter(Boolean);
}

function normalizeWorkforceShiftPlans(value) {
  const seen = new Set();
  return normalizeArray(value).map((plan, index) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
    const personId = String(plan.personId || plan.personnelId || plan.userId || "");
    const status = ["published", "yayınlandı", "yayinlandi"].includes(plan.status) ? "published" : "draft";
    const identity = `${plan.weekStart || ""}\u0000${personId}\u0000${plan.date || ""}\u0000${status}`;
    if (!personId || seen.has(identity)) return null;
    seen.add(identity);
    return {
      ...plan,
      id: String(plan.id || stableStockId("shift-plan", identity || index)),
      personId,
      personnelId: personId,
      status,
      revision: Math.max(0, Math.trunc(finiteNumber(plan.revision ?? plan.publicationRevision, 0)))
    };
  }).filter(Boolean);
}

function normalizeWorkforceShiftPlanRevisions(value) {
  return normalizeArray(value).map((revision, index) => {
    if (!revision || typeof revision !== "object" || Array.isArray(revision)) return null;
    return {
      ...revision,
      id: String(revision.id || stableStockId("shift-revision", `${revision.weekStart || ""}\u0000${revision.revision || index}`)),
      revision: Math.max(1, Math.trunc(finiteNumber(revision.revision, index + 1))),
      plans: normalizeWorkforceShiftPlans(revision.plans).map((plan) => ({ ...plan, status: "published" }))
    };
  }).filter(Boolean);
}

function normalizeDeletedRecipeUsers(value) {
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || item.userId || "");
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      ...item,
      id,
      userId: id,
      username: String(item.username || ""),
      name: String(item.name || "Silinmiş personel"),
      deletedAt: item.deletedAt || new Date(0).toISOString()
    };
  }).filter(Boolean);
}

function normalizeTaskStatus(status) {
  const value = String(status || "");
  if (["completed", "tamamlandi", "tamamlandı"].includes(value)) return "completed";
  if (["archived"].includes(value)) return "archived";
  if (["cancelled", "iptal_edildi"].includes(value)) return "cancelled";
  if (["draft", "taslak"].includes(value)) return "draft";
  return "active";
}

function normalizeAssignmentStatus(status, completedCount, itemCount) {
  const value = String(status || "");
  if (["completed", "tamamlandi", "tamamlandı"].includes(value) || (itemCount > 0 && completedCount >= itemCount)) return "completed";
  if (["in_progress", "devam_ediyor"].includes(value) || completedCount > 0) return "in_progress";
  if (["cancelled", "iptal_edildi"].includes(value)) return "cancelled";
  return "pending";
}

function normalizeShipmentStatus(status) {
  const value = String(status || "");
  if (["taslak", "draft"].includes(value)) return "taslak";
  if (["onaylandı", "onaylandi", "approved"].includes(value)) return "onaylandı";
  if (["reddedildi", "rejected"].includes(value)) return "reddedildi";
  return "onay_bekliyor";
}

function normalizeShiftRequestStatus(status) {
  const value = String(status || "");
  if (["onaylandı", "onaylandi", "approved"].includes(value)) return "onaylandı";
  if (["reddedildi", "rejected"].includes(value)) return "reddedildi";
  if (["iptal_edildi", "cancelled", "canceled"].includes(value)) return "iptal_edildi";
  return "onay_bekliyor";
}

function stableStockId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16)}`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isCatalogRecord(item) {
  return Boolean(item && typeof item === "object" && item.id && item.category && item.product);
}

function normalizeName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

module.exports = {
  DEFAULT_FATURA_CAPABILITIES,
  FATURA_CAPABILITIES,
  FATURA_ROLES,
  PROCUREMENT_SCHEMA_VERSION,
  STORE_SCHEMA_VERSION,
  chooseRecipeSize,
  migrateMenuRecipeLinks,
  migrateStore,
  normalizeMenuState,
  normalizeProcurement,
  normalizeRecipeItem,
  normalizeRecipeState,
  normalizeStockState,
  reconcileRecipeCatalog,
  stableRecipeId
};
