"use strict";

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { readWorkbook } = require("./simple-xlsx");
const { serializeLegacyMenuState } = require("./pricing");
const {
  createDataImportColdStore,
  migrateLegacyDataImportPayloads
} = require("./data-import-cold-store");
const {
  WORKBOOKS,
  analyzeDataImport,
  catalogFingerprint,
  importRevision,
  legacyCatalogFingerprint,
  productCodeFingerprint,
  normalizeImportDomains,
  domainsToScopes,
  scopesToDomains,
  domainRevisionSnapshot,
  domainFingerprintSnapshot,
  domainProductCodeFingerprintSnapshot,
  domainCatalogSnapshot,
  restoreDomainCatalogSnapshot,
  buildImportReadbackManifest
} = require("./data-import");

const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

function registerDataImportRoutes(options) {
  const {
    app, store, auth, requireAdminRequestOrigin,
    riskOperationLimiter = (_req, _res, next) => next(),
    broadcastMenuUpdate, broadcastRecipeUpdate, broadcastStockUpdate, broadcastPublicUpdate
  } = options;
  const coldStore = options.dataImportColdStore || createDataImportColdStore({
    rootDir: options.dataImportColdDir
      || (store.filePath ? path.join(path.dirname(store.filePath), "data-import-cold") : "")
  });
  let coldReadyPromise = null;
  const ensureColdReady = () => {
    if (!coldReadyPromise) {
      coldReadyPromise = migrateLegacyDataImportPayloads(store, coldStore)
        .catch((error) => {
          coldReadyPromise = null;
          throw error;
        });
    }
    return coldReadyPromise;
  };

  app.get("/api/admin/data-imports/history", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      await ensureColdReady();
      const data = await store.read();
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const history = (data.dataImportHistory || []).slice().reverse().slice(0, limit).map(publicHistory);
      res.json({ ok: true, revision: importRevision(data), history });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/data-imports/analyze", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, express.json({ limit: "82mb", strict: true }), async (req, res, next) => {
    try {
      await ensureColdReady();
      const parsed = parseFiles(req.body && req.body.files);
      const requestId = requestIdentifier(req, req.body || {});
      const actor = actorFromRequest(req);
      const scope = `data-import:analyze:${actor}`;
      const analysisId = `data-import-analysis-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
      let replay = false;
      let response;
      await store.update(async (data, context = {}) => {
        const previous = await idempotentResponse(data, scope, requestId, coldStore);
        if (previous) {
          replay = true;
          response = previous;
          return context.noChange !== undefined ? context.noChange : data;
        }
        const analysis = analyzeDataImport(data, parsed, { analysisId, now: createdAt });
        const draft = { ...analysis, actor, createdAt, expiresAt };
        const draftRecord = await coldStore.externalizeDraft(draft);
        data.dataImportDrafts = activeDrafts(data.dataImportDrafts).concat(draftRecord).slice(-20);
        const analysisStatus = analysis.report.errorCount === 0 && analysis.report.changeCount === 0
          ? "unchanged"
          : "analyzed";
        data.dataImportHistory = (data.dataImportHistory || []).concat({
          id: analysisId,
          importId: analysisId,
          analysisId,
          kind: "analyze",
          actor,
          requestId,
          files: analysis.files,
          scopes: analysis.scopes,
          importScope: analysis.scopes,
          report: analysis.report,
          changeCount: analysis.changes.length,
          revisionBefore: analysis.expectedRevision,
          revisionAfter: analysis.expectedRevision,
          fingerprintVersion: analysis.fingerprintVersion,
          beforeFingerprint: analysis.expectedFingerprint,
          beforeProductCodeFingerprint: analysis.expectedProductCodeFingerprint,
          createdAt,
          status: analysisStatus,
          validationStatus: analysisStatus === "unchanged" ? "not_required" : "analyzed"
        }).slice(-100);
        response = {
          ok: true, analysisId, createdAt, expiresAt,
          expectedRevision: analysis.expectedRevision,
          files: analysis.files, scopes: analysis.scopes, report: analysis.report,
          domains: analysis.domains,
          changes: analysis.changes, issues: analysis.issues, canApply: analysis.report.canApply
        };
        await rememberIdempotency(data, scope, requestId, response, createdAt, coldStore);
        return data;
      });
      res.status(replay ? 200 : 201).json(response);
    } catch (error) { routeError(error, res, next); }
  });

  app.post("/api/admin/data-imports/apply", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, async (req, res, next) => {
    try {
      await ensureColdReady();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const analysisId = String(body.analysisId || "").trim();
      if (!/^data-import-analysis-[a-z0-9-]{20,}$/i.test(analysisId)) throw clientError(400, "Geçerli bir analiz kaydı gerekli.");
      const requestId = requestIdentifier(req, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const actor = actorFromRequest(req);
      const scope = `data-import:apply:${analysisId}`;
      let replay = false;
      let response;
      let rollbackSnapshot = null;
      let expectedReadbackFingerprint = "";
      const committedState = await store.update(async (data, context = {}) => {
        const previous = await idempotentResponse(data, scope, requestId, coldStore);
        if (previous) {
          replay = true;
          response = previous;
          return context.noChange !== undefined ? context.noChange : data;
        }
        data.dataImportDrafts = activeDrafts(data.dataImportDrafts);
        const draftRecord = data.dataImportDrafts.find((item) => item.id === analysisId || item.analysisId === analysisId);
        if (!draftRecord) throw clientError(404, "Analiz kaydı bulunamadı veya süresi doldu. Dosyaları yeniden analiz edin.");
        const draft = await coldStore.resolveDraft(draftRecord);
        if (!draft) throw clientError(409, "Analiz payload kaydı çözülemedi. Dosyaları yeniden analiz edin.");
        if (draft.actor !== actor) throw clientError(403, "Bu analiz kaydını uygulama yetkiniz yok.");
        const requestedDomains = normalizeRequestedDomains(body.domains, draft);
        const selectedDomains = requestedDomains.length ? requestedDomains : normalizeImportDomains([], draft.scopes);
        if (!selectedDomains.length) throw clientError(400, "Uygulanacak en az bir veri alanı seçin.");
        for (const domain of selectedDomains) {
          const readiness = draft.domains && draft.domains[domain];
          if (readiness && readiness.selected !== true) throw clientError(409, `${domain} bu analizde seçili değil.`);
          if (readiness && readiness.canApply !== true) throw clientError(409, `${domain} veri alanındaki kritik analiz hataları giderilmeden aktarım uygulanamaz.`);
        }
        const appliedScopes = domainsToScopes(selectedDomains, draft.scopes);
        if (!appliedScopes.length) throw clientError(409, "Seçilen veri alanları için uygulanabilir dosya bulunamadı.");
        if (archiveConfirmationRequired(draft, selectedDomains) && body.confirmArchiveImpact !== true) {
          throw clientError(409, "Bu aktarım katalog kayıtlarının önemli bir bölümünü arşivleyecek. Arşiv etkisini açıkça onaylayın.");
        }
        // İstek analizde verilen revizyonu taşımalı. Canlı global revizyon burada
        // karşılaştırılmaz; seçili domain'in gerçekten bayat olup olmadığını aşağıdaki
        // domain revizyonu ve fingerprint muhafızları belirler.
        if (expectedRevision !== draft.expectedRevision) throw clientError(409, "Veri revizyonu analizden sonra değişti. Yeniden analiz edin.");
        assertDomainDraftIsCurrent(data, draft, selectedDomains, appliedScopes);
        if (!draft.expectedDomainFingerprints) {
          const currentFingerprint = Number(draft.fingerprintVersion || 0) >= 2
            ? catalogFingerprint(data, appliedScopes)
            : legacyCatalogFingerprint(data);
          if (currentFingerprint !== draft.expectedFingerprint) throw clientError(409, "Seçili veri alanı analizden sonra değişti. Yeniden analiz edin.");
          if (draft.expectedProductCodeFingerprint
            && productCodeFingerprint(data, appliedScopes) !== draft.expectedProductCodeFingerprint) {
            throw clientError(409, "Ürün kodu bağlantıları analizden sonra değişti. Yeniden analiz edin.");
          }
        }

        const now = new Date().toISOString();
        const operationId = `data-import-${crypto.randomUUID()}`;
        const before = domainCatalogSnapshot(data, selectedDomains);
        rollbackSnapshot = structuredClone(before);
        const revisionBefore = importRevision(data);
        const publishRevisionBefore = Number(data.revisions && data.revisions.publish || 0);
        const pricingRevisionBefore = Number(data.revisions && data.revisions.pricing || 0);
        const beforeFingerprint = catalogFingerprint(data, appliedScopes);
        const beforeProductCodeFingerprint = productCodeFingerprint(data, appliedScopes);
        applyPlan(data, draft.plan, appliedScopes);
        stampImportedMetadata(data, operationId, now, appliedScopes);
        expectedReadbackFingerprint = readbackManifestFingerprint(
          buildImportReadbackManifest(draft.plan, appliedScopes)
        );
        data.revisions.dataImport = revisionBefore + 1;
        bumpDomainRevisions(data, selectedDomains);
        data.revisions.publish = Number(data.revisions.publish || 0) + 1;
        if (appliedScopes.includes("pricing")) data.revisions.pricing = Number(data.revisions.pricing || 0) + 1;
        if (appliedScopes.includes("menu") || appliedScopes.includes("pricing")) data.menuUpdatedAt = now;
        if (appliedScopes.includes("pricing")) data.pricingUpdatedAt = now;
        if (appliedScopes.includes("recipes")) data.recipeUpdatedAt = now;
        if (appliedScopes.includes("stock")) data.stockUpdatedAt = now;
        const backupId = `data-import-backup-${crypto.randomUUID()}`;
        const history = {
          id: operationId, importId: operationId, kind: "apply", requestId, analysisId, actor, files: draft.files,
          scopes: appliedScopes, domains: selectedDomains, report: selectedDomainReport(draft, selectedDomains), changeCount: selectedDomainChanges(draft, selectedDomains).length,
          importScope: appliedScopes, fingerprintVersion: 3,
          revisionBefore, revisionAfter: data.revisions.dataImport,
          publishRevisionBefore, pricingRevisionBefore,
          publishRevisionAfter: data.revisions.publish,
          pricingRevisionAfter: data.revisions.pricing,
          domainRevisionsBefore: draft.expectedDomainRevisions || {},
          domainRevisionsAfter: domainRevisionSnapshot(data, selectedDomains),
          expectedReadbackFingerprint,
          beforeFingerprint, beforeProductCodeFingerprint,
          afterFingerprint: "", afterProductCodeFingerprint: "",
          committedFingerprint: "", persistedFingerprint: "",
          committedProductCodeFingerprint: "", persistedProductCodeFingerprint: "",
          validationStatus: "pending", validationFailureReason: "",
          appliedAt: now, rolledBackAt: null, rollbackReason: "", rollbackVerified: null,
          backupId, createdAt: now, status: "applied", undoneAt: null, undoneBy: "", undoOperationId: ""
        };
        const backupRecord = await coldStore.externalizeBackup({ id: backupId, operationId, createdAt: now, domains: selectedDomains, scopes: appliedScopes, snapshot: before });
        data.dataImportBackups = (data.dataImportBackups || []).concat(backupRecord).slice(-10);
        data.dataImportHistory = (data.dataImportHistory || []).concat(history).slice(-100);
        data.dataImportDrafts = data.dataImportDrafts.filter((item) => item !== draftRecord);
        response = {
          ok: true, operationId, analysisId, revision: data.revisions.dataImport,
          publishRevision: data.revisions.publish, pricingRevision: data.revisions.pricing,
          changedScopes: appliedScopes, changedDomains: selectedDomains, report: selectedDomainReport(draft, selectedDomains), changedCount: selectedDomainChanges(draft, selectedDomains).length,
          canUndo: true, validationStatus: "pending", updatedAt: now
        };
        await rememberIdempotency(data, scope, requestId, response, now, coldStore);
        return data;
      }, {
        backupLabel: `excel-import-${analysisId}-${requestId}`,
        shouldBackup: (data) => !(data.dataImportIdempotency || []).some((item) => item.scope === scope && item.requestId === requestId)
      });
      if (!replay || response.validationStatus !== "verified") {
        const readback = await store.read();
        const validationDetails = buildReadbackValidation(
          committedState,
          readback,
          response.changedScopes,
          response.operationId,
          response.revision,
          expectedReadbackFingerprint || String(findImportHistory(committedState, response.operationId)?.expectedReadbackFingerprint || ""),
          response.changedDomains
        );
        if (!validationDetails.valid) {
          const committedHistory = findImportHistory(committedState, response.operationId)
            || findImportHistory(readback, response.operationId);
          rollbackSnapshot = rollbackSnapshot || await findImportBackupSnapshot(committedState, response.operationId, coldStore);
          const rolledBackAt = new Date().toISOString();
          const rollbackReason = validationDetails.failureReason;
          console.error("[data-import] apply readback validation failed", {
            operationId: response.operationId,
            analysisId,
            requestId,
            validation: validationDetails
          });

          if (!rollbackSnapshot || !committedHistory) {
            throw clientError(500, `Aktarım doğrulaması başarısız oldu (${rollbackReason}); güvenli geri alma kaydı bulunamadı.`, validationDetails.failureCode);
          }

          const rollbackCommitted = await store.update((data) => {
            restoreDomainCatalogSnapshot(data, rollbackSnapshot, response.changedDomains || scopesToDomains(response.changedScopes));
            data.revisions.dataImport = Number(committedHistory.revisionBefore || 0);
            data.revisions.publish = Number(committedHistory.publishRevisionBefore || 0);
            data.revisions.pricing = Number(committedHistory.pricingRevisionBefore || 0);
            restoreDomainRevisionSnapshot(data, committedHistory.domainRevisionsBefore, response.changedDomains);
            let failed = findImportHistory(data, response.operationId);
            if (!failed) {
              failed = structuredClone(committedHistory);
              data.dataImportHistory = (data.dataImportHistory || []).concat(failed).slice(-100);
            }
            if (failed) {
              applyReadbackAudit(failed, validationDetails);
              failed.status = "failed_readback";
              failed.failedAt = rolledBackAt;
              failed.undoneAt = rolledBackAt;
              failed.rolledBackAt = rolledBackAt;
              failed.rollbackReason = rollbackReason;
              failed.rollbackApplied = true;
              failed.rollbackVerified = null;
            }
            data.dataImportIdempotency = (data.dataImportIdempotency || [])
              .filter((item) => !(item.scope === scope && item.requestId === requestId));
            return data;
          });
          const rollbackReadback = await store.read();
          const rollbackValidation = buildRollbackValidation(
            rollbackCommitted,
            rollbackReadback,
            response.changedScopes,
            committedHistory
          );
          await store.update((data) => {
            const failed = findImportHistory(data, response.operationId);
            if (failed) {
              failed.rollbackVerified = rollbackValidation.verified;
              failed.rollbackValidation = rollbackValidation;
            }
            return data;
          });
          const suffix = rollbackValidation.verified
            ? "katalog güvenli yedekten geri yüklendi ve doğrulandı"
            : "katalog geri yüklendi ancak rollback readback doğrulaması eşleşmedi";
          throw clientError(500, `Aktarım yazma doğrulaması başarısız oldu (${rollbackReason}); ${suffix}.`, validationDetails.failureCode);
        }

        response = { ...response, validationStatus: "verified", readback: validationDetails.readback };
        const validatedAt = new Date().toISOString();
        const validatedState = await store.update(async (data) => {
          const history = findImportHistory(data, response.operationId);
          if (history) {
            applyReadbackAudit(history, validationDetails);
            history.status = "applied";
            history.validationStatus = "verified";
            history.validatedAt = validatedAt;
            history.afterFingerprint = validationDetails.committedFingerprint;
            history.afterProductCodeFingerprint = validationDetails.committedProductCodeFingerprint;
          }
          await updateIdempotentResponse(data, scope, requestId, response, coldStore);
          return data;
        });
        broadcastImport(validatedState, response.changedScopes, response.updatedAt, options);
      }
      res.json(response);
    } catch (error) { routeError(error, res, next); }
  });

  app.post("/api/admin/data-imports/:id/undo", requireAdminRequestOrigin, auth.requireAdmin, riskOperationLimiter, async (req, res, next) => {
    try {
      await ensureColdReady();
      const operationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const requestId = requestIdentifier(req, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const actor = actorFromRequest(req);
      const scope = `data-import:undo:${operationId}`;
      let replay = false;
      let response;
      const committedUndo = await store.update(async (data, context = {}) => {
        const previous = await idempotentResponse(data, scope, requestId, coldStore);
        if (previous) {
          replay = true;
          response = previous;
          return context.noChange !== undefined ? context.noChange : data;
        }
        const source = (data.dataImportHistory || []).find((item) => item.id === operationId && item.kind === "apply");
        if (!source) throw clientError(404, "Aktarım geçmişi bulunamadı.");
        if (Number(source.fingerprintVersion || 0) < 3 && importRevision(data) !== expectedRevision) throw clientError(409, "Veri revizyonu değişti. Geçmişi yenileyin.");
        if (Number(source.fingerprintVersion || 0) >= 3 && expectedRevision > importRevision(data)) throw clientError(409, "Geçerli veri revizyonu gerekli.");
        if (source.undoneAt) throw clientError(409, "Bu aktarım daha önce geri alındı.");
        const sourceFingerprint = Number(source.fingerprintVersion || 0) >= 2
          ? catalogFingerprint(data, source.scopes)
          : legacyCatalogFingerprint(data);
        if (sourceFingerprint !== source.afterFingerprint) throw clientError(409, "Aktarımdan sonra manuel değişiklik yapıldığı için güvenli geri alma mümkün değil.");
        if (source.afterProductCodeFingerprint
          && productCodeFingerprint(data, source.scopes) !== source.afterProductCodeFingerprint) {
          throw clientError(409, "Aktarımdan sonra ürün kodu bağlantıları değiştiği için güvenli geri alma mümkün değil.");
        }
        const backup = (data.dataImportBackups || []).find((item) => item.id === source.backupId && item.operationId === source.id);
        const backupSnapshot = await coldStore.resolveBackupSnapshot(backup);
        if (!backup || !backupSnapshot) throw clientError(409, "Geri alma yedeği bulunamadı.");
        const sourceDomains = normalizeImportDomains(source.domains, source.scopes);
        const sourceDomainRevisions = source.domainRevisionsAfter || {};
        const currentDomainRevisions = domainRevisionSnapshot(data, sourceDomains);
        for (const domain of sourceDomains) {
          if (sourceDomainRevisions[domain] !== undefined && Number(sourceDomainRevisions[domain]) !== Number(currentDomainRevisions[domain])) {
            throw clientError(409, `${domain} veri alanında aktarım sonrasında değişiklik yapıldığı için güvenli geri alma mümkün değil.`);
          }
        }
        const now = new Date().toISOString();
        const undoOperationId = `data-import-undo-${crypto.randomUUID()}`;
        restoreDomainCatalogSnapshot(data, backupSnapshot, sourceDomains);
        data.revisions.dataImport = importRevision(data) + 1;
        bumpDomainRevisions(data, sourceDomains);
        data.revisions.publish = Number(data.revisions.publish || 0) + 1;
        if (source.scopes.includes("pricing")) data.revisions.pricing = Number(data.revisions.pricing || 0) + 1;
        if (source.scopes.includes("menu") || source.scopes.includes("pricing")) data.menuUpdatedAt = now;
        if (source.scopes.includes("pricing")) data.pricingUpdatedAt = now;
        if (source.scopes.includes("recipes")) data.recipeUpdatedAt = now;
        if (source.scopes.includes("stock")) data.stockUpdatedAt = now;
        source.undoneAt = now; source.undoneBy = actor; source.undoOperationId = undoOperationId;
        const undoHistory = {
          id: undoOperationId, kind: "undo", sourceOperationId: source.id, requestId, actor,
          scopes: source.scopes, domains: sourceDomains, importScope: source.scopes, fingerprintVersion: 3,
          domainRevisionsAfter: domainRevisionSnapshot(data, sourceDomains),
          revisionBefore: data.revisions.dataImport - 1, revisionAfter: data.revisions.dataImport,
          publishRevisionAfter: data.revisions.publish, createdAt: now, status: "undone", changeCount: source.changeCount,
          afterFingerprint: "", afterProductCodeFingerprint: "", validationStatus: "pending"
        };
        data.dataImportHistory = data.dataImportHistory.concat(undoHistory).slice(-100);
        response = { ok: true, operationId: undoOperationId, sourceOperationId: source.id, revision: data.revisions.dataImport, publishRevision: data.revisions.publish, changedScopes: source.scopes, changedDomains: sourceDomains, updatedAt: now };
        await rememberIdempotency(data, scope, requestId, response, now, coldStore);
        return data;
      });
      if (!replay) {
        const readback = await store.read();
        const undo = (readback.dataImportHistory || []).find((item) => item.id === response.operationId);
        const committedFingerprint = catalogFingerprint(committedUndo, response.changedScopes);
        const persistedFingerprint = catalogFingerprint(readback, response.changedScopes);
        const committedProductCodeFingerprint = productCodeFingerprint(committedUndo, response.changedScopes);
        const persistedProductCodeFingerprint = productCodeFingerprint(readback, response.changedScopes);
        if (!undo || committedFingerprint !== persistedFingerprint
          || committedProductCodeFingerprint !== persistedProductCodeFingerprint) {
          throw clientError(500, "Geri alma yazma doğrulaması başarısız oldu.");
        }
        const validatedUndo = await store.update((data) => {
          const history = findImportHistory(data, response.operationId);
          if (history) {
            history.afterFingerprint = committedFingerprint;
            history.afterProductCodeFingerprint = committedProductCodeFingerprint;
            history.committedFingerprint = committedFingerprint;
            history.persistedFingerprint = persistedFingerprint;
            history.committedProductCodeFingerprint = committedProductCodeFingerprint;
            history.persistedProductCodeFingerprint = persistedProductCodeFingerprint;
            history.validationStatus = "verified";
          }
          return data;
        });
        broadcastImport(validatedUndo, response.changedScopes, response.updatedAt, options);
      }
      res.json(response);
    } catch (error) { routeError(error, res, next); }
  });

  return { ready: ensureColdReady, coldStore };
}

function parseFiles(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const workbooks = {};
  const files = {};
  let total = 0;
  for (const key of WORKBOOKS) {
    if (!source[key]) continue;
    const filename = String(source[key].filename || `TAHMISCI-${key}.xlsx`).trim().slice(0, 180);
    if (!/\.xlsx$/i.test(filename)) throw clientError(400, `${filename}: yalnızca .xlsx dosyası desteklenir.`);
    const rawContent = String(source[key].contentBase64 || "");
    const dataUrl = rawContent.match(/^data:([^;,]+);base64,/i);
    const declaredMime = String(source[key].mimeType || source[key].type || dataUrl && dataUrl[1] || "").trim().toLowerCase();
    if (declaredMime && !new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream"
    ]).has(declaredMime)) {
      throw clientError(400, `${filename}: MIME türü XLSX dosyasıyla uyuşmuyor.`);
    }
    const encoded = rawContent.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw clientError(400, `${filename}: dosya içeriği geçersiz.`);
    }
    let buffer;
    try { buffer = Buffer.from(encoded, "base64"); } catch (_error) { throw clientError(400, `${filename}: dosya içeriği geçersiz.`); }
    if (!buffer.length) throw clientError(400, `${filename}: dosya boş.`);
    if (buffer.length > MAX_FILE_BYTES) throw clientError(413, `${filename}: dosya 20 MB sınırını aşıyor.`);
    if (!isXlsxSignature(buffer)) throw clientError(400, `${filename}: dosya imzası geçerli bir XLSX arşivi değil.`);
    total += buffer.length;
    if (total > MAX_TOTAL_BYTES) throw clientError(413, "Toplam Excel boyutu 60 MB sınırını aşıyor.");
    try { workbooks[key] = readWorkbook(buffer); } catch (_error) { throw clientError(400, `${filename}: Excel dosyası okunamadı.`); }
    if (!workbooks[key].SheetNames.length) throw clientError(400, `${filename}: çalışma sayfası bulunamadı.`);
    files[key] = { filename, size: buffer.length, hash: crypto.createHash("sha256").update(buffer).digest("hex") };
  }
  if (!Object.keys(files).length) throw clientError(400, "Analiz için en az bir Excel dosyası seçin.");
  return { workbooks, files };
}

function isXlsxSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return new Set([0x04034b50, 0x06054b50, 0x08074b50]).has(buffer.readUInt32LE(0));
}

function applyPlan(data, plan, scopes) {
  if (scopes.includes("menu") || scopes.includes("pricing")) {
    data.menuState = structuredClone(plan.menuState);
    data.pricing = structuredClone(plan.pricing);
  }
  if (scopes.includes("recipes")) {
    data.recipeState = structuredClone(plan.recipeState);
    data.recipeCatalog = structuredClone(plan.recipeCatalog);
    data.recipeLinkReview = structuredClone(plan.recipeLinkReview || []);
  }
  if (scopes.includes("stock")) data.stockState = structuredClone(plan.stockState);
  applyScopedMappings(data, plan.mappings, scopes);
  applyReferenceRewrites(data, plan.referenceRewrites, scopes);
}

function applyScopedMappings(data, mappings, scopes) {
  const target = data.dataImportMappings || (data.dataImportMappings = { menu: [], pricing: [], recipe: [], stock: [] });
  const source = mappings || {};
  if (scopes.includes("menu")) target.menu = structuredClone(source.menu || []);
  if (scopes.includes("pricing")) target.pricing = structuredClone(source.pricing || []);
  if (scopes.includes("recipes")) target.recipe = structuredClone(source.recipe || []);
  if (scopes.includes("stock")) target.stock = structuredClone(source.stock || []);
}

function applyReferenceRewrites(data, rewritesInput, scopes) {
  const rewrites = rewritesInput && typeof rewritesInput === "object" ? rewritesInput : {};
  const menuProducts = rewrites.menuProducts || {};
  const menuCategories = rewrites.menuCategories || {};
  const stockProducts = rewrites.stockProducts || {};
  const stockCategories = rewrites.stockCategories || {};

  if (scopes.includes("menu") || scopes.includes("pricing")) {
    rewriteMenuReferences(data.siteState, menuProducts, menuCategories);
    for (const revision of data.siteRevisions || []) rewriteMenuReferences(revision, menuProducts, menuCategories);
  }
  if (scopes.includes("stock")) for (const shipment of data.workforceShipments || []) {
    for (const item of shipment.items || shipment.lines || []) {
      if (stockProducts[String(item.productId)]) item.productId = stockProducts[String(item.productId)];
      if (stockCategories[String(item.categoryId)]) item.categoryId = stockCategories[String(item.categoryId)];
    }
  }
}

function rewriteMenuReferences(value, productRewrites, categoryRewrites) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteMenuReferences(item, productRewrites, categoryRewrites));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "productId" && productRewrites[String(entry)]) value[key] = productRewrites[String(entry)];
    else if (key === "categoryId" && categoryRewrites[String(entry)]) value[key] = categoryRewrites[String(entry)];
    else if (key === "productIds" && Array.isArray(entry)) value[key] = [...new Set(entry.map((id) => productRewrites[String(id)] || id))];
    else rewriteMenuReferences(entry, productRewrites, categoryRewrites);
  }
}

function stampImportedMetadata(data, operationId, now, scopes) {
  const stamp = (item) => {
    if (item && typeof item === "object" && item.sourceType === "excel") {
      item.lastImportedAt = now;
      item.lastImportOperationId = operationId;
    }
  };
  if (scopes.includes("menu") || scopes.includes("pricing")) for (const category of data.menuState.categories || []) { stamp(category); (category.products || []).forEach(stamp); }
  if (scopes.includes("recipes")) for (const products of Object.values(data.recipeState || {})) for (const sizes of Object.values(products || {})) for (const item of Object.values(sizes || {})) stamp(item);
  if (scopes.includes("stock")) { (data.stockState.categories || []).forEach(stamp); (data.stockState.products || []).forEach(stamp); }
  const mappingScopes = [];
  if (scopes.includes("menu")) mappingScopes.push("menu");
  if (scopes.includes("pricing")) mappingScopes.push("pricing");
  if (scopes.includes("recipes")) mappingScopes.push("recipe");
  if (scopes.includes("stock")) mappingScopes.push("stock");
  for (const scope of mappingScopes) for (const mapping of data.dataImportMappings && data.dataImportMappings[scope] || []) { mapping.lastImportedAt = now; mapping.lastImportOperationId = operationId; }
}

function broadcastImport(data, scopes, updatedAt, options) {
  const set = new Set(scopes || []);
  if ((set.has("menu") || set.has("pricing")) && typeof options.broadcastMenuUpdate === "function") options.broadcastMenuUpdate(serializeLegacyMenuState(data.menuState, data.pricing), updatedAt, data.pricing, data.revisions.pricing);
  if (set.has("recipes") && typeof options.broadcastRecipeUpdate === "function") options.broadcastRecipeUpdate(data.recipeState, updatedAt, data.recipeCatalog || []);
  if (set.has("stock") && typeof options.broadcastStockUpdate === "function") options.broadcastStockUpdate(data.stockState, updatedAt);
  if ((set.has("menu") || set.has("pricing")) && typeof options.broadcastPublicUpdate === "function") options.broadcastPublicUpdate(data, "data-import");
}

function buildReadbackValidation(committed, persisted, scopes, operationId, expectedRevision, expectedReadbackFingerprint, domains) {
  const committedHistory = findImportHistory(committed, operationId);
  const persistedHistory = findImportHistory(persisted, operationId);
  const committedFingerprint = catalogFingerprint(committed, scopes);
  const persistedFingerprint = catalogFingerprint(persisted, scopes);
  const committedProductCodeFingerprint = productCodeFingerprint(committed, scopes);
  const persistedProductCodeFingerprint = productCodeFingerprint(persisted, scopes);
  const catalogMatches = committedFingerprint === persistedFingerprint;
  const productCodesMatch = committedProductCodeFingerprint === persistedProductCodeFingerprint;
  const committedManifest = buildImportReadbackManifest(committed, scopes);
  const persistedManifest = buildImportReadbackManifest(persisted, scopes);
  const committedReadbackFingerprint = readbackManifestFingerprint(committedManifest);
  const persistedReadbackFingerprint = readbackManifestFingerprint(persistedManifest);
  const readbackMatches = committedReadbackFingerprint === persistedReadbackFingerprint;
  const planMatches = !expectedReadbackFingerprint
    || (committedReadbackFingerprint === expectedReadbackFingerprint
      && persistedReadbackFingerprint === expectedReadbackFingerprint);
  const expectedDomainRevisions = committedHistory && committedHistory.domainRevisionsAfter || {};
  const committedDomainRevisions = domainRevisionSnapshot(committed, domains || []);
  const persistedDomainRevisions = domainRevisionSnapshot(persisted, domains || []);
  const domainRevisionsMatch = Object.keys(expectedDomainRevisions).every((domain) => (
    Number(committedDomainRevisions[domain]) === Number(expectedDomainRevisions[domain])
      && Number(persistedDomainRevisions[domain]) === Number(expectedDomainRevisions[domain])
  ));
  const metadataMatches = Boolean(
    committedHistory
    && persistedHistory
    && Number(committedHistory.revisionAfter) === Number(expectedRevision)
    && Number(persistedHistory.revisionAfter) === Number(expectedRevision)
    && importRevision(committed) === Number(expectedRevision)
    && importRevision(persisted) === Number(expectedRevision)
  );
  const reasons = [];
  if (!catalogMatches) reasons.push("katalog fingerprint eşleşmedi");
  if (!productCodesMatch) reasons.push("ürün kodu fingerprint eşleşmedi");
  if (!readbackMatches) reasons.push("kalıcı readback manifest eşleşmedi");
  if (!planMatches) reasons.push("uygulanan veri analiz planıyla eşleşmedi");
  if (!domainRevisionsMatch) reasons.push("domain revizyonları eşleşmedi");
  if (!metadataMatches) reasons.push("işlem metadata veya revizyon kaydı eşleşmedi");
  const failureCode = !catalogMatches ? "readback_catalog_mismatch"
    : !productCodesMatch ? "readback_product_code_mismatch"
      : !readbackMatches ? "readback_manifest_mismatch"
        : !planMatches ? "readback_plan_mismatch"
          : (!domainRevisionsMatch || !metadataMatches) ? "readback_revision_mismatch" : "";
  return {
    importId: operationId,
    importScope: Array.isArray(scopes) ? [...scopes] : [],
    revisionAfter: Number(expectedRevision),
    committedFingerprint,
    persistedFingerprint,
    committedProductCodeFingerprint,
    persistedProductCodeFingerprint,
    catalogMatches,
    productCodesMatch,
    expectedReadbackFingerprint,
    committedReadbackFingerprint,
    persistedReadbackFingerprint,
    readbackMatches,
    planMatches,
    domainRevisionsMatch,
    metadataMatches,
    valid: reasons.length === 0,
    validationStatus: reasons.length === 0 ? "verified" : "failed",
    failureCode,
    failureReason: reasons.join("; "),
    readback: readbackSummary(persistedManifest, persisted, domains)
  };
}

function readbackSummary(manifest, data, domains) {
  return {
    productCount: Number(manifest && manifest.catalog && manifest.catalog.productCount || 0),
    pricedProductCount: (manifest && manifest.catalog && manifest.catalog.products || [])
      .filter((product) => product.pricingStatus === "priced").length,
    recipeCount: Number(manifest && manifest.recipes && manifest.recipes.records && manifest.recipes.records.length || 0),
    stockProductCount: Number(manifest && manifest.stock && manifest.stock.productCount || 0),
    revisions: {
      dataImport: importRevision(data),
      publish: Number(data && data.revisions && data.revisions.publish || 0),
      pricing: Number(data && data.revisions && data.revisions.pricing || 0),
      domains: domainRevisionSnapshot(data, domains || [])
    }
  };
}

function readbackManifestFingerprint(value) {
  return crypto.createHash("sha256").update(stableCanonicalJson(value)).digest("hex");
}

function stableCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function applyReadbackAudit(history, details) {
  history.committedFingerprint = details.committedFingerprint;
  history.persistedFingerprint = details.persistedFingerprint;
  history.committedProductCodeFingerprint = details.committedProductCodeFingerprint;
  history.persistedProductCodeFingerprint = details.persistedProductCodeFingerprint;
  history.validationStatus = details.valid ? "verified" : "failed";
  history.validationFailureCode = details.failureCode || "";
  history.validationFailureReason = details.failureReason || "";
  history.validationDetails = { ...details };
}

function buildRollbackValidation(committed, persisted, scopes, sourceHistory) {
  const committedFingerprint = catalogFingerprint(committed, scopes);
  const persistedFingerprint = catalogFingerprint(persisted, scopes);
  const committedProductCodeFingerprint = productCodeFingerprint(committed, scopes);
  const persistedProductCodeFingerprint = productCodeFingerprint(persisted, scopes);
  const expectedFingerprint = String(sourceHistory.beforeFingerprint || "");
  const expectedProductCodeFingerprint = String(sourceHistory.beforeProductCodeFingerprint || "");
  const catalogMatches = committedFingerprint === persistedFingerprint
    && (!expectedFingerprint || persistedFingerprint === expectedFingerprint);
  const productCodesMatch = committedProductCodeFingerprint === persistedProductCodeFingerprint
    && (!expectedProductCodeFingerprint || persistedProductCodeFingerprint === expectedProductCodeFingerprint);
  const revisionMatches = importRevision(committed) === Number(sourceHistory.revisionBefore || 0)
    && importRevision(persisted) === Number(sourceHistory.revisionBefore || 0)
    && Number(committed.revisions && committed.revisions.publish || 0) === Number(sourceHistory.publishRevisionBefore || 0)
    && Number(persisted.revisions && persisted.revisions.publish || 0) === Number(sourceHistory.publishRevisionBefore || 0)
    && Number(committed.revisions && committed.revisions.pricing || 0) === Number(sourceHistory.pricingRevisionBefore || 0)
    && Number(persisted.revisions && persisted.revisions.pricing || 0) === Number(sourceHistory.pricingRevisionBefore || 0);
  return {
    expectedFingerprint,
    committedFingerprint,
    persistedFingerprint,
    expectedProductCodeFingerprint,
    committedProductCodeFingerprint,
    persistedProductCodeFingerprint,
    catalogMatches,
    productCodesMatch,
    revisionMatches,
    verified: catalogMatches && productCodesMatch && revisionMatches
  };
}

function findImportHistory(data, operationId) {
  return (data && data.dataImportHistory || []).find((item) => item && item.id === operationId) || null;
}

async function findImportBackupSnapshot(data, operationId, coldStore) {
  const backup = (data && data.dataImportBackups || []).find((item) => item && item.operationId === operationId);
  return backup ? coldStore.resolveBackupSnapshot(backup) : null;
}

async function updateIdempotentResponse(data, scope, requestId, response, coldStore) {
  const entry = (data.dataImportIdempotency || []).find((item) => item.scope === scope && item.requestId === requestId);
  if (!entry) return;
  const updated = await coldStore.externalizeIdempotency({
    scope,
    requestId,
    createdAt: entry.createdAt,
    response: structuredClone(response)
  });
  entry.responseRef = updated.responseRef;
  delete entry.response;
}

function publicHistory(item) {
  return {
    id: item.id, kind: item.kind, sourceOperationId: item.sourceOperationId || "", files: item.files || [],
    scopes: item.scopes || [], domains: item.domains || scopesToDomains(item.scopes), report: item.report || null, changeCount: Number(item.changeCount || 0),
    revision: item.revisionAfter, revisionBefore: item.revisionBefore, revisionAfter: item.revisionAfter, actor: item.actor,
    createdAt: item.createdAt, undoneAt: item.undoneAt || null, undoOperationId: item.undoOperationId || "",
    status: item.status || item.kind, canUndo: item.kind === "apply" && item.status !== "failed_readback" && !item.undoneAt,
    importId: item.importId || item.id, importScope: item.importScope || item.scopes || [],
    validationStatus: item.validationStatus || "", validationFailureReason: item.validationFailureReason || "",
    validationFailureCode: item.validationFailureCode || "",
    validationDetails: item.validationDetails && typeof item.validationDetails === "object"
      ? structuredClone(item.validationDetails)
      : null,
    committedFingerprint: item.committedFingerprint || "", persistedFingerprint: item.persistedFingerprint || "",
    committedProductCodeFingerprint: item.committedProductCodeFingerprint || "",
    persistedProductCodeFingerprint: item.persistedProductCodeFingerprint || "",
    appliedAt: item.appliedAt || item.createdAt || null, rolledBackAt: item.rolledBackAt || null,
    validatedAt: item.validatedAt || null, failedAt: item.failedAt || null,
    rollbackReason: item.rollbackReason || "", rollbackApplied: item.rollbackApplied === true,
    rollbackVerified: item.rollbackVerified === true,
    rollbackValidation: item.rollbackValidation && typeof item.rollbackValidation === "object"
      ? structuredClone(item.rollbackValidation)
      : null,
    fingerprintVersion: Number(item.fingerprintVersion || 0)
  };
}

function normalizeRequestedDomains(value, draft) {
  if (value === undefined || value === null) return normalizeImportDomains([], draft && draft.scopes);
  if (!Array.isArray(value)) throw clientError(400, "domains alanı bir dizi olmalıdır.");
  const normalized = normalizeImportDomains(value);
  if (normalized.length !== new Set(value.map((item) => String(item || "").trim().toLowerCase())).size) {
    throw clientError(400, "Bilinmeyen veya yinelenen veri alanı seçildi.");
  }
  return normalized;
}

function archiveConfirmationRequired(draft, domains) {
  if (!draft || !draft.report || draft.report.requiresArchiveConfirmation !== true) return false;
  const selected = new Set(domains);
  const archived = (draft.changes || []).filter((change) => change.operation === "archive" && selected.has(changeDomain(change))).length;
  return archived > 0;
}

function changeDomain(item) {
  const workbook = String(item && item.workbook || "");
  if (workbook === "menu" || workbook === "pricing") return "catalog";
  if (workbook === "recipe" || workbook === "recipes") return "recipes";
  if (workbook === "stock") return "stock";
  return "";
}

function selectedDomainChanges(draft, domains) {
  const selected = new Set(domains);
  return (draft.changes || []).filter((change) => selected.has(changeDomain(change)));
}

function selectedDomainReport(draft, domains) {
  const selected = new Set(domains);
  const domainEntries = Object.entries(draft.domains || {}).filter(([domain]) => selected.has(domain));
  return {
    ...(draft.report || {}),
    selectedDomains: [...selected],
    changeCount: selectedDomainChanges(draft, domains).length,
    warningCount: domainEntries.reduce((sum, [, item]) => sum + Number(item.warningCount || 0), 0),
    errorCount: domainEntries.reduce((sum, [, item]) => sum + Number(item.errorCount || 0), 0),
    canApply: domainEntries.every(([, item]) => item.canApply === true)
  };
}

function domainRevisionKey(domain) { return `dataImport${domain[0].toUpperCase()}${domain.slice(1)}`; }

function bumpDomainRevisions(data, domains) {
  data.revisions = data.revisions || {};
  for (const domain of normalizeImportDomains(domains)) {
    const key = domainRevisionKey(domain);
    data.revisions[key] = Math.max(0, Number(data.revisions[key] || 0)) + 1;
  }
}

function restoreDomainRevisionSnapshot(data, snapshot, domains) {
  data.revisions = data.revisions || {};
  for (const domain of normalizeImportDomains(domains)) {
    const key = domainRevisionKey(domain);
    if (snapshot && snapshot[domain] !== undefined) data.revisions[key] = Number(snapshot[domain]);
  }
}

function assertDomainDraftIsCurrent(data, draft, domains, scopes) {
  const expectedRevisions = draft.expectedDomainRevisions || {};
  const currentRevisions = domainRevisionSnapshot(data, domains);
  const expectedFingerprints = draft.expectedDomainFingerprints || {};
  const currentFingerprints = domainFingerprintSnapshot(data, domains);
  const expectedCodeFingerprints = draft.expectedDomainProductCodeFingerprints || {};
  const currentCodeFingerprints = domainProductCodeFingerprintSnapshot(data, domains);
  for (const domain of domains) {
    if (expectedRevisions[domain] !== undefined && Number(expectedRevisions[domain]) !== Number(currentRevisions[domain])) throw clientError(409, `${domain} veri alanı analizden sonra değişti. Yeniden analiz edin.`);
    if (expectedFingerprints[domain] && expectedFingerprints[domain] !== currentFingerprints[domain]) throw clientError(409, `${domain} veri alanı analizden sonra değişti. Yeniden analiz edin.`);
    if (expectedCodeFingerprints[domain] && expectedCodeFingerprints[domain] !== currentCodeFingerprints[domain]) throw clientError(409, `${domain} ürün kodları analizden sonra değişti. Yeniden analiz edin.`);
  }
}

function activeDrafts(items) { const now = Date.now(); return (Array.isArray(items) ? items : []).filter((item) => item && Date.parse(item.expiresAt) > now); }
function actorFromRequest(req) { return String(req.admin && (req.admin.sessionId || req.admin.sub) || "admin"); }
function requestIdentifier(req, body) { const value = String(req.header("Idempotency-Key") || req.header("X-Request-ID") || body.requestId || "").trim(); if (!/^[a-zA-Z0-9._:-]{8,180}$/.test(value)) throw clientError(400, "Geçerli requestId veya Idempotency-Key gerekli."); return value; }
function requiredRevision(value) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw clientError(400, "Geçerli expectedRevision gerekli."); return number; }
async function idempotentResponse(data, scope, requestId, coldStore) {
  const matches = (data.dataImportIdempotency || []).filter((entry) => entry.requestId === requestId);
  const item = matches.find((entry) => entry.scope === scope);
  if (item) return coldStore.resolveIdempotencyResponse(item);
  if (matches.length) throw clientError(409, "Bu requestId daha önce farklı bir Excel işlemi için kullanıldı.");
  return null;
}
async function rememberIdempotency(data, scope, requestId, response, createdAt, coldStore) {
  const entry = await coldStore.externalizeIdempotency({ scope, requestId, response: structuredClone(response), createdAt });
  data.dataImportIdempotency = (data.dataImportIdempotency || []).concat(entry).slice(-500);
}
function clientError(status, message, code = "") { const error = new Error(message); error.status = status; error.code = code; return error; }
function routeError(error, res, next) {
  if (error && (error.type === "entity.too.large" || Number(error.status) === 413)) {
    return res.status(413).json({ ok: false, message: "Excel yükleme isteği izin verilen boyut sınırını aşıyor." });
  }
  if (error && Number(error.status) >= 400 && Number(error.status) < 600) {
    return res.status(Number(error.status)).json({ ok: false, ...(error.code ? { code: error.code } : {}), message: error.message });
  }
  return next(error);
}

module.exports = { isXlsxSignature, parseFiles, registerDataImportRoutes };
