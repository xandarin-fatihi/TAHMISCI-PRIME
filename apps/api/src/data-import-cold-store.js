"use strict";

const crypto = require("crypto");
const defaultFs = require("fs/promises");
const path = require("path");

const COLD_REFERENCE_VERSION = 1;
const COLD_KINDS = new Set(["drafts", "backups", "idempotency"]);

/**
 * Large Excel import payloads live outside the request hot-store. References
 * are content addressed, so a failed hot-store commit can only leave a safe
 * orphan and can never overwrite a payload referenced by an older revision.
 */
function createDataImportColdStore(options = {}) {
  const fs = options.fsPromises || defaultFs;
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : "";
  const memory = new Map();

  return Object.freeze({
    persistent: Boolean(rootDir),
    rootDir,
    writePayload,
    readPayload,
    resolveDraft,
    resolveBackupSnapshot,
    resolveIdempotencyResponse,
    externalizeDraft,
    externalizeBackup,
    externalizeIdempotency
  });

  async function writePayload(kindInput, idInput, payload) {
    const kind = normalizeKind(kindInput);
    const id = safeId(idInput);
    const serializedPayload = JSON.stringify(payload);
    if (serializedPayload === undefined) throw new TypeError("Cold payload JSON olarak serileştirilemedi.");
    const checksum = crypto.createHash("sha256").update(serializedPayload).digest("hex");
    const relativeFile = `${kind}/${id}-${checksum.slice(0, 20)}.json`;
    const reference = Object.freeze({
      version: COLD_REFERENCE_VERSION,
      kind,
      id,
      file: relativeFile.replace(/\\/g, "/"),
      checksum,
      bytes: Buffer.byteLength(serializedPayload),
      createdAt: new Date().toISOString()
    });
    const envelope = `${JSON.stringify({
      version: COLD_REFERENCE_VERSION,
      kind,
      id,
      checksum,
      payload
    })}\n`;

    if (!rootDir) {
      memory.set(relativeFile.replace(/\\/g, "/"), envelope);
      return reference;
    }

    const target = resolveReferencePath(reference);
    const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      try {
        await fs.access(target);
        return reference;
      } catch (_missing) {
        // Content-addressed file does not exist yet.
      }
      await fs.writeFile(tmp, envelope, { encoding: "utf8", flag: "wx" });
      await fs.rename(tmp, target);
      return reference;
    } catch (error) {
      try { await fs.unlink(tmp); } catch (_cleanupError) { /* best effort */ }
      throw error;
    }
  }

  async function readPayload(reference) {
    validateReference(reference);
    let content;
    if (!rootDir) {
      content = memory.get(String(reference.file));
      if (!content) throw coldMissingError(reference);
    } else {
      try {
        content = await fs.readFile(resolveReferencePath(reference), "utf8");
      } catch (error) {
        if (error && error.code === "ENOENT") throw coldMissingError(reference);
        throw error;
      }
    }
    let envelope;
    try { envelope = JSON.parse(content); } catch (_error) { throw coldCorruptError(reference); }
    if (!envelope || envelope.version !== COLD_REFERENCE_VERSION
      || envelope.kind !== reference.kind || envelope.id !== reference.id) {
      throw coldCorruptError(reference);
    }
    const serializedPayload = JSON.stringify(envelope.payload);
    const checksum = crypto.createHash("sha256").update(serializedPayload).digest("hex");
    if (checksum !== reference.checksum || checksum !== envelope.checksum) throw coldCorruptError(reference);
    return structuredClone(envelope.payload);
  }

  async function resolveDraft(record) {
    if (!record || typeof record !== "object") return null;
    return record.payloadRef ? readPayload(record.payloadRef) : structuredClone(record);
  }

  async function resolveBackupSnapshot(record) {
    if (!record || typeof record !== "object") return null;
    if (record.snapshotRef) return readPayload(record.snapshotRef);
    return Object.prototype.hasOwnProperty.call(record, "snapshot") ? structuredClone(record.snapshot) : null;
  }

  async function resolveIdempotencyResponse(record) {
    if (!record || typeof record !== "object") return null;
    if (record.responseRef) return readPayload(record.responseRef);
    return Object.prototype.hasOwnProperty.call(record, "response") ? structuredClone(record.response) : null;
  }

  async function externalizeDraft(record) {
    if (!record || typeof record !== "object" || record.payloadRef) return structuredClone(record);
    const id = String(record.id || record.analysisId || crypto.randomUUID());
    const payloadRef = await writePayload("drafts", id, record);
    return compactDraft(record, payloadRef);
  }

  async function externalizeBackup(record) {
    if (!record || typeof record !== "object" || record.snapshotRef
      || !Object.prototype.hasOwnProperty.call(record, "snapshot")) return structuredClone(record);
    const id = String(record.id || record.operationId || crypto.randomUUID());
    const snapshotRef = await writePayload("backups", id, record.snapshot);
    const next = { ...record, snapshotRef };
    delete next.snapshot;
    return next;
  }

  async function externalizeIdempotency(record) {
    if (!record || typeof record !== "object" || record.responseRef
      || !Object.prototype.hasOwnProperty.call(record, "response")) return structuredClone(record);
    const id = `${record.scope || "operation"}-${record.requestId || crypto.randomUUID()}`;
    const responseRef = await writePayload("idempotency", id, record.response);
    const next = { ...record, responseRef };
    delete next.response;
    return next;
  }

  function resolveReferencePath(reference) {
    validateReference(reference);
    const target = path.resolve(rootDir, ...String(reference.file).split("/"));
    const relative = path.relative(rootDir, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw coldCorruptError(reference);
    return target;
  }
}

async function migrateLegacyDataImportPayloads(store, coldStore) {
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("Data import cold migration için geçerli store gerekli.");
  }
  const current = await store.read();
  if (!hasEmbeddedPayloads(current)) return { changed: false, drafts: 0, backups: 0, idempotency: 0 };

  const counts = { drafts: 0, backups: 0, idempotency: 0 };
  await store.update(async (data, context = {}) => {
    let changed = false;
    data.dataImportDrafts = await Promise.all((data.dataImportDrafts || []).map(async (record) => {
      if (!record || record.payloadRef) return record;
      changed = true; counts.drafts += 1;
      return coldStore.externalizeDraft(record);
    }));
    data.dataImportBackups = await Promise.all((data.dataImportBackups || []).map(async (record) => {
      if (!record || record.snapshotRef || !Object.prototype.hasOwnProperty.call(record, "snapshot")) return record;
      changed = true; counts.backups += 1;
      return coldStore.externalizeBackup(record);
    }));
    data.dataImportIdempotency = await Promise.all((data.dataImportIdempotency || []).map(async (record) => {
      if (!record || record.responseRef || !Object.prototype.hasOwnProperty.call(record, "response")) return record;
      changed = true; counts.idempotency += 1;
      return coldStore.externalizeIdempotency(record);
    }));
    if (!changed && context.noChange !== undefined) return context.noChange;
    return data;
  });
  return { changed: true, ...counts };
}

function hasEmbeddedPayloads(data) {
  return (data && data.dataImportDrafts || []).some((item) => item && !item.payloadRef)
    || (data && data.dataImportBackups || []).some((item) => item && !item.snapshotRef && Object.prototype.hasOwnProperty.call(item, "snapshot"))
    || (data && data.dataImportIdempotency || []).some((item) => item && !item.responseRef && Object.prototype.hasOwnProperty.call(item, "response"));
}

function compactDraft(record, payloadRef) {
  return {
    id: record.id || record.analysisId,
    analysisId: record.analysisId || record.id,
    actor: record.actor || "",
    createdAt: record.createdAt || null,
    expiresAt: record.expiresAt || null,
    expectedRevision: Number(record.expectedRevision || 0),
    files: structuredClone(record.files || []),
    scopes: structuredClone(record.scopes || []),
    payloadRef
  };
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (!COLD_KINDS.has(kind)) throw new TypeError("Bilinmeyen data import cold payload türü.");
  return kind;
}

function safeId(value) {
  const normalized = String(value || "payload")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || "payload";
}

function validateReference(reference) {
  if (!reference || Number(reference.version) !== COLD_REFERENCE_VERSION
    || !COLD_KINDS.has(String(reference.kind || ""))
    || !/^[a-f0-9]{64}$/.test(String(reference.checksum || ""))
    || !/^[a-z]+\/[a-zA-Z0-9._-]+\.json$/.test(String(reference.file || ""))) {
    throw coldCorruptError(reference);
  }
}

function coldMissingError(reference) {
  const error = new Error(`Excel aktarım cold payload dosyası bulunamadı: ${reference && reference.id || "bilinmeyen"}`);
  error.status = 409;
  error.code = "DATA_IMPORT_COLD_PAYLOAD_MISSING";
  return error;
}

function coldCorruptError(reference) {
  const error = new Error(`Excel aktarım cold payload kaydı geçersiz: ${reference && reference.id || "bilinmeyen"}`);
  error.status = 409;
  error.code = "DATA_IMPORT_COLD_PAYLOAD_CORRUPT";
  return error;
}

module.exports = {
  COLD_REFERENCE_VERSION,
  createDataImportColdStore,
  hasEmbeddedPayloads,
  migrateLegacyDataImportPayloads
};
