"use strict";

const crypto = require("node:crypto");
const { constants: fsConstants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_PIXELS = 60 * 1000 * 1000;
const MAX_IMAGE_SIDE = 24_000;
const PRIVATE_FILE_PATTERN = /^[a-f0-9]{48}\.(?:jpg|png|webp)$/;
const INDEX_FILE_PATTERN = /^[a-f0-9]{64}\.json$/;
const MIME_DETAILS = Object.freeze({
  "image/jpeg": { extension: ".jpg", label: "JPEG" },
  "image/png": { extension: ".png", label: "PNG" },
  "image/webp": { extension: ".webp", label: "WebP" }
});
const PUBLIC_DOCUMENT_FIELDS = new Set([
  "id", "type", "documentType", "originalName", "mimeType", "sizeBytes",
  "width", "height", "supplierId", "shipmentId", "shipmentIds",
  "shipmentItemIds", "documentNumber", "documentDate", "note", "status",
  "archivedAt", "archivedBy", "createdAt", "createdBy", "updatedAt", "updatedBy"
]);

class ProcurementDocumentError extends Error {
  constructor(code, message, status = 400, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProcurementDocumentError";
    this.code = code;
    this.status = status;
    this.expose = true;
  }
}

function createProcurementDocumentService(options = {}) {
  const documentsDir = path.resolve(String(options.documentsDir || "").trim() || path.join(process.cwd(), "storage", "procurement-documents"));
  const indexDir = path.join(documentsDir, ".dedupe");
  const maxUploadBytes = positiveInteger(options.maxUploadBytes, DEFAULT_MAX_UPLOAD_BYTES);
  const orphanGraceMs = nonNegativeInteger(options.orphanGraceMs, DEFAULT_ORPHAN_GRACE_MS);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const randomBytes = typeof options.randomBytes === "function" ? options.randomBytes : crypto.randomBytes;
  const imageProcessor = typeof options.imageProcessor === "function" ? options.imageProcessor : null;
  const strictImageProcessing = options.strictImageProcessing === true;
  const leases = new Map();
  const generations = new Map();
  let readyPromise;

  function init() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          await fs.mkdir(documentsDir, { recursive: true, mode: 0o700 });
          await fs.mkdir(indexDir, { recursive: true, mode: 0o700 });
          const [rootStats, indexStats] = await Promise.all([fs.lstat(documentsDir), fs.lstat(indexDir)]);
          if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || !indexStats.isDirectory() || indexStats.isSymbolicLink()) {
            throw new Error("unsafe private storage directory");
          }
          await Promise.all([
            fs.access(documentsDir, fsConstants.R_OK | fsConstants.W_OK),
            fs.access(indexDir, fsConstants.R_OK | fsConstants.W_OK)
          ]);
        } catch (error) {
          throw documentError("DOCUMENT_STORAGE_UNAVAILABLE", "Özel belge deposu kullanılamıyor.", 500, error);
        }
      })();
    }
    return readyPromise;
  }

  async function storeUpload({ buffer, originalName, declaredMimeType } = {}) {
    validateUploadBuffer(buffer, maxUploadBytes);
    const detectedMimeType = detectImageType(buffer);
    if (!detectedMimeType) {
      throw documentError("UNSUPPORTED_DOCUMENT_TYPE", "Yalnızca geçerli JPEG, PNG veya WebP görselleri yüklenebilir.");
    }
    validateDeclaredType(declaredMimeType, detectedMimeType);
    validateFilenameType(originalName, detectedMimeType);

    const sanitizedName = sanitizeOriginalFilename(originalName, MIME_DETAILS[detectedMimeType].extension);
    let processed = sanitizeImage(buffer, detectedMimeType);
    processed = await optionallyProcessImage(processed, imageProcessor, strictImageProcessing);
    if (processed.buffer.length > maxUploadBytes) {
      throw documentError("DOCUMENT_TOO_LARGE", `Belge en fazla ${maxUploadBytes} bayt olabilir.`, 413);
    }

    const sha256 = sha256Hex(processed.buffer);
    await init();

    const indexed = await readValidIndex(sha256);
    if (indexed) {
      return leaseMetadata(indexed, sanitizedName, true, false);
    }

    const createdNames = [];
    try {
      const physicalName = await writeRandomFile(processed.buffer, processed.extension);
      createdNames.push(physicalName);
      let thumbnailPhysicalName = physicalName;
      let thumbnailMimeType = processed.mimeType;
      let thumbnailSizeBytes = processed.buffer.length;

      if (processed.thumbnailBuffer) {
        const thumbnail = sanitizeImage(processed.thumbnailBuffer, processed.thumbnailMimeType);
        thumbnailPhysicalName = await writeRandomFile(thumbnail.buffer, thumbnail.extension);
        createdNames.push(thumbnailPhysicalName);
        thumbnailMimeType = thumbnail.mimeType;
        thumbnailSizeBytes = thumbnail.buffer.length;
      }

      const record = {
        storageVersion: 1,
        sha256,
        physicalName,
        mimeType: processed.mimeType,
        extension: processed.extension,
        sizeBytes: processed.buffer.length,
        width: processed.width,
        height: processed.height,
        thumbnailPhysicalName,
        thumbnailMimeType,
        thumbnailSizeBytes,
        thumbnailGenerated: thumbnailPhysicalName !== physicalName,
        metadataStripped: processed.metadataStripped,
        metadataRemoved: processed.metadataRemoved === true,
        reencoded: processed.reencoded,
        createdAt: new Date(now()).toISOString()
      };

      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await fs.writeFile(indexPath(sha256), JSON.stringify(record), { flag: "wx", mode: 0o600 });
          generations.set(physicalName, { owned: true, activeLeases: 0, committed: false, record });
          return leaseMetadata(record, sanitizedName, false, true);
        } catch (error) {
          if (!error || error.code !== "EEXIST") throw error;
          const winner = await readValidIndex(sha256);
          if (winner) {
            await removeNames(createdNames);
            return leaseMetadata(winner, sanitizedName, true, false);
          }
          await safeUnlink(indexPath(sha256));
        }
      }
      throw documentError("DOCUMENT_STORAGE_CONFLICT", "Belge güvenli depoya kaydedilemedi.", 503);
    } catch (error) {
      await removeNames(createdNames);
      if (error instanceof ProcurementDocumentError) throw error;
      throw documentError("DOCUMENT_STORAGE_FAILED", "Belge güvenli depoya kaydedilemedi.", 500, error);
    }
  }

  function leaseMetadata(record, originalName, deduplicated, owned) {
    const physicalName = record.physicalName;
    let generation = generations.get(physicalName);
    if (!generation) {
      generation = { owned, activeLeases: 0, committed: !owned, record };
      generations.set(physicalName, generation);
    }
    generation.activeLeases += 1;
    const token = randomBytes(18).toString("hex");
    leases.set(token, physicalName);

    const metadata = {
      storageVersion: 1,
      originalName,
      mimeType: record.mimeType,
      extension: record.extension,
      sizeBytes: record.sizeBytes,
      width: record.width,
      height: record.height,
      sha256: record.sha256,
      physicalName,
      thumbnailPhysicalName: record.thumbnailPhysicalName || physicalName,
      thumbnailMimeType: record.thumbnailMimeType || record.mimeType,
      thumbnailSizeBytes: positiveInteger(record.thumbnailSizeBytes, record.sizeBytes),
      thumbnailGenerated: Boolean(record.thumbnailGenerated),
      metadataStripped: record.metadataStripped !== false,
      metadataRemoved: record.metadataRemoved === true,
      reencoded: record.reencoded === true,
      deduplicated: Boolean(deduplicated)
    };
    Object.defineProperty(metadata, "_storageLeaseToken", { value: token, enumerable: false });
    return metadata;
  }

  function commitUpload(metadata) {
    const token = metadata && metadata._storageLeaseToken;
    const physicalName = token && leases.get(token);
    if (!physicalName) return false;
    leases.delete(token);
    const generation = generations.get(physicalName);
    if (generation) {
      generation.activeLeases = Math.max(0, generation.activeLeases - 1);
      generation.committed = true;
      if (!generation.activeLeases) generations.delete(physicalName);
    }
    return true;
  }

  async function removePhysicalFiles(metadata, options = {}) {
    await init();
    if (options.force === true) return forceRemoveMetadataFiles(metadata);

    const token = metadata && metadata._storageLeaseToken;
    const physicalName = token && leases.get(token);
    if (!physicalName) return { filesRemoved: 0, indexRemoved: false };
    leases.delete(token);
    const generation = generations.get(physicalName);
    if (!generation) return { filesRemoved: 0, indexRemoved: false };
    generation.activeLeases = Math.max(0, generation.activeLeases - 1);
    if (!generation.owned || generation.committed || generation.activeLeases) {
      if (!generation.activeLeases) generations.delete(physicalName);
      return { filesRemoved: 0, indexRemoved: false };
    }
    generations.delete(physicalName);
    return forceRemoveMetadataFiles(generation.record);
  }

  async function forceRemoveMetadataFiles(metadata) {
    const names = uniquePrivateNames([
      metadata && metadata.physicalName,
      metadata && metadata.thumbnailPhysicalName
    ]);
    let filesRemoved = 0;
    for (const name of names) {
      if (await safeUnlink(privatePath(name))) filesRemoved += 1;
    }
    let indexRemoved = false;
    const hash = safeHash(metadata && (metadata.sha256 || metadata.contentHash));
    if (hash) {
      const indexed = await readIndexRecord(hash, { verifyContent: false, removeInvalid: false });
      if (!indexed || names.includes(indexed.physicalName)) indexRemoved = await safeUnlink(indexPath(hash));
    }
    return { filesRemoved, indexRemoved };
  }

  async function resolveContent(document, { thumbnail = false } = {}) {
    await init();
    const requestedName = thumbnail
      ? document && (document.thumbnailPhysicalName || document.physicalName)
      : document && document.physicalName;
    const physicalName = validatePrivateName(requestedName);
    if (!physicalName) throw documentError("DOCUMENT_CONTENT_NOT_FOUND", "Belge içeriği bulunamadı.", 404);

    try {
      const stats = await fs.lstat(privatePath(physicalName));
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw documentError("DOCUMENT_CONTENT_NOT_FOUND", "Belge içeriği bulunamadı.", 404);
      }
      const buffer = await fs.readFile(privatePath(physicalName));
      const detectedMimeType = detectImageType(buffer);
      const expectedMimeType = thumbnail
        ? String(document.thumbnailMimeType || mimeTypeForPrivateName(physicalName) || document.mimeType || "")
        : String(document.mimeType || "");
      if (!detectedMimeType || (expectedMimeType && detectedMimeType !== expectedMimeType)) {
        throw documentError("DOCUMENT_CONTENT_INVALID", "Belge içeriği doğrulanamadı.", 409);
      }
      const expectedHash = thumbnail && physicalName !== document.physicalName
        ? ""
        : safeHash(document.sha256 || document.contentHash);
      if (expectedHash && sha256Hex(buffer) !== expectedHash) {
        throw documentError("DOCUMENT_CONTENT_INVALID", "Belge içeriği doğrulanamadı.", 409);
      }
      return {
        buffer,
        mimeType: detectedMimeType,
        sizeBytes: buffer.length,
        etag: `"sha256-${sha256Hex(buffer)}"`,
        thumbnail: Boolean(thumbnail && physicalName !== document.physicalName)
      };
    } catch (error) {
      if (error instanceof ProcurementDocumentError) throw error;
      if (error && error.code === "ENOENT") {
        throw documentError("DOCUMENT_CONTENT_NOT_FOUND", "Belge içeriği bulunamadı.", 404);
      }
      throw documentError("DOCUMENT_CONTENT_READ_FAILED", "Belge içeriği okunamadı.", 500, error);
    }
  }

  async function sendAuthorizedContent(req, res, { document, thumbnail = false, authorize } = {}) {
    if (typeof authorize !== "function") {
      throw documentError("DOCUMENT_AUTHORIZATION_REQUIRED", "Belge erişim denetimi yapılandırılmamış.", 500);
    }
    const authorized = await authorize(req, document);
    if (!authorized) {
      res.set("Cache-Control", "no-store");
      res.status(403).json({ ok: false, message: "Bu belgeyi görüntüleme yetkiniz yok." });
      return false;
    }
    const content = await resolveContent(document, { thumbnail });
    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": content.mimeType,
      "Content-Length": String(content.sizeBytes),
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      ETag: content.etag
    });
    res.status(200).send(content.buffer);
    return true;
  }

  async function cleanupOrphans({ documents, graceMs = orphanGraceMs } = {}) {
    if (!Array.isArray(documents)) {
      throw documentError("DOCUMENT_REFERENCES_REQUIRED", "Orphan temizliği için belge kayıtları zorunludur.", 500);
    }
    await init();
    const referenced = new Set();
    for (const document of documents) {
      for (const name of uniquePrivateNames([
        document && document.physicalName,
        document && document.thumbnailPhysicalName,
        document && document.storage && document.storage.physicalName,
        document && document.storage && document.storage.thumbnailPhysicalName
      ])) referenced.add(name);
    }
    for (const physicalName of leases.values()) referenced.add(physicalName);
    for (const generation of generations.values()) {
      for (const name of uniquePrivateNames([
        generation && generation.record && generation.record.physicalName,
        generation && generation.record && generation.record.thumbnailPhysicalName
      ])) referenced.add(name);
    }

    const cutoff = now() - nonNegativeInteger(graceMs, orphanGraceMs);
    let filesRemoved = 0;
    let indexesRemoved = 0;
    let skipped = 0;
    for (const entry of await fs.readdir(documentsDir, { withFileTypes: true })) {
      if (entry.name === ".dedupe") continue;
      if (!entry.isFile() || !validatePrivateName(entry.name) || referenced.has(entry.name)) {
        skipped += 1;
        continue;
      }
      const stats = await fs.lstat(privatePath(entry.name));
      if (stats.isSymbolicLink() || stats.mtimeMs > cutoff) {
        skipped += 1;
        continue;
      }
      if (await safeUnlink(privatePath(entry.name))) filesRemoved += 1;
    }

    for (const entry of await fs.readdir(indexDir, { withFileTypes: true })) {
      if (!entry.isFile() || !INDEX_FILE_PATTERN.test(entry.name)) continue;
      const fullPath = path.join(indexDir, entry.name);
      const stats = await fs.lstat(fullPath);
      if (stats.mtimeMs > cutoff) continue;
      const hash = entry.name.slice(0, -5);
      const record = await readIndexRecord(hash, { verifyContent: false, removeInvalid: false });
      if (!record || !referenced.has(record.physicalName)) {
        if (await safeUnlink(fullPath)) indexesRemoved += 1;
      }
    }
    return { filesRemoved, indexesRemoved, skipped };
  }

  async function readValidIndex(hash) {
    return readIndexRecord(hash, { verifyContent: true, removeInvalid: true });
  }

  async function readIndexRecord(hash, { verifyContent, removeInvalid }) {
    if (!safeHash(hash)) return null;
    const filePath = indexPath(hash);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const record = JSON.parse(raw);
      if (!validIndexRecord(record, hash)) throw new Error("invalid index");
      if (verifyContent) {
        const content = await fs.readFile(privatePath(record.physicalName));
        if (content.length !== Number(record.sizeBytes) || sha256Hex(content) !== hash || detectImageType(content) !== record.mimeType) {
          throw new Error("invalid content");
        }
      }
      return record;
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      if (removeInvalid) await safeUnlink(filePath);
      return null;
    }
  }

  function validIndexRecord(record, hash) {
    return record && record.storageVersion === 1
      && record.sha256 === hash
      && Boolean(validatePrivateName(record.physicalName))
      && Boolean(validatePrivateName(record.thumbnailPhysicalName || record.physicalName))
      && MIME_DETAILS[record.mimeType]
      && MIME_DETAILS[record.mimeType].extension === record.extension
      && Number.isInteger(record.sizeBytes)
      && record.sizeBytes > 0
      && record.sizeBytes <= maxUploadBytes;
  }

  async function writeRandomFile(buffer, extension) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const name = `${randomBytes(24).toString("hex")}${extension}`;
      try {
        await fs.writeFile(privatePath(name), buffer, { flag: "wx", mode: 0o600 });
        return name;
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
      }
    }
    throw documentError("DOCUMENT_NAME_COLLISION", "Belge güvenli depoya kaydedilemedi.", 503);
  }

  function privatePath(name) {
    const safeName = validatePrivateName(name);
    if (!safeName) throw documentError("INVALID_PHYSICAL_NAME", "Belge depolama kaydı geçersiz.", 500);
    return path.join(documentsDir, safeName);
  }

  function indexPath(hash) {
    const safe = safeHash(hash);
    if (!safe) throw documentError("INVALID_DOCUMENT_HASH", "Belge depolama kaydı geçersiz.", 500);
    return path.join(indexDir, `${safe}.json`);
  }

  async function removeNames(names) {
    for (const name of uniquePrivateNames(names)) await safeUnlink(privatePath(name));
  }

  return {
    cleanupOrphans,
    commitUpload,
    documentsDir,
    init,
    maxUploadBytes,
    removePhysicalFiles,
    resolveContent,
    sendAuthorizedContent,
    storeUpload
  };
}

async function optionallyProcessImage(sanitized, imageProcessor, strict) {
  if (!imageProcessor) return { ...sanitized, reencoded: false, thumbnailBuffer: null, thumbnailMimeType: "" };
  try {
    const output = await imageProcessor({
      buffer: sanitized.buffer,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
      maxThumbnailSide: 480
    });
    if (!output || !Buffer.isBuffer(output.buffer)) throw new Error("invalid processor output");
    const primary = sanitizeImage(output.buffer, detectImageType(output.buffer));
    let thumbnailBuffer = null;
    let thumbnailMimeType = "";
    if (Buffer.isBuffer(output.thumbnailBuffer)) {
      thumbnailMimeType = detectImageType(output.thumbnailBuffer);
      thumbnailBuffer = sanitizeImage(output.thumbnailBuffer, thumbnailMimeType).buffer;
    }
    return {
      ...primary,
      metadataStripped: true,
      reencoded: output.reencoded !== false,
      thumbnailBuffer,
      thumbnailMimeType
    };
  } catch (error) {
    if (strict) throw documentError("DOCUMENT_PROCESSING_FAILED", "Belge görseli güvenli biçimde işlenemedi.", 422, error);
    return { ...sanitized, reencoded: false, thumbnailBuffer: null, thumbnailMimeType: "" };
  }
}

function sanitizeImage(buffer, expectedMimeType) {
  const mimeType = detectImageType(buffer);
  if (!mimeType || (expectedMimeType && mimeType !== expectedMimeType)) {
    throw documentError("INVALID_DOCUMENT_SIGNATURE", "Belge içeriği bildirilen görsel formatıyla uyuşmuyor.");
  }
  if (mimeType === "image/jpeg") return sanitizeJpeg(buffer);
  if (mimeType === "image/png") return sanitizePng(buffer);
  return sanitizeWebp(buffer);
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function sanitizeJpeg(buffer) {
  const output = [buffer.subarray(0, 2)];
  let index = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let sawEnd = false;
  let stripped = false;

  while (index < buffer.length) {
    if (buffer[index] !== 0xff) throw invalidImage("JPEG");
    const markerStart = index;
    while (index < buffer.length && buffer[index] === 0xff) index += 1;
    if (index >= buffer.length || buffer[index] === 0x00) throw invalidImage("JPEG");
    const marker = buffer[index];
    index += 1;

    if (marker === 0xd9) {
      output.push(Buffer.from([0xff, 0xd9]));
      sawEnd = true;
      if (index !== buffer.length) throw invalidImage("JPEG");
      break;
    }
    if (marker === 0xd8) throw invalidImage("JPEG");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      output.push(buffer.subarray(markerStart, index));
      continue;
    }
    if (index + 2 > buffer.length) throw invalidImage("JPEG");
    const segmentLength = buffer.readUInt16BE(index);
    if (segmentLength < 2 || index + segmentLength > buffer.length) throw invalidImage("JPEG");
    const segmentEnd = index + segmentLength;
    const dataStart = index + 2;

    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 8) throw invalidImage("JPEG");
      height = buffer.readUInt16BE(dataStart + 1);
      width = buffer.readUInt16BE(dataStart + 3);
      validateDimensions(width, height, "JPEG");
    }

    if (marker === 0xda) {
      sawScan = true;
      output.push(buffer.subarray(markerStart, segmentEnd));
      index = segmentEnd;
      const scanStart = index;
      let foundMarker = false;
      while (index < buffer.length - 1) {
        if (buffer[index] !== 0xff) {
          index += 1;
          continue;
        }
        const next = buffer[index + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          index += 2;
          continue;
        }
        output.push(buffer.subarray(scanStart, index));
        foundMarker = true;
        break;
      }
      if (!foundMarker) throw invalidImage("JPEG");
      continue;
    }

    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      stripped = true;
    } else {
      output.push(buffer.subarray(markerStart, segmentEnd));
    }
    index = segmentEnd;
  }

  if (!sawEnd || !sawScan || !width || !height) throw invalidImage("JPEG");
  const sanitized = Buffer.concat(output);
  return {
    buffer: sanitized,
    mimeType: "image/jpeg",
    extension: ".jpg",
    width,
    height,
    metadataStripped: true,
    metadataRemoved: stripped || sanitized.length !== buffer.length
  };
}

function sanitizePng(buffer) {
  const signature = buffer.subarray(0, 8);
  const output = [signature];
  const keptAncillary = new Set(["cHRM", "gAMA", "sRGB", "sBIT", "bKGD", "tRNS"]);
  const knownCritical = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
  let index = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let stripped = false;

  while (index < buffer.length) {
    if (index + 12 > buffer.length) throw invalidImage("PNG");
    const length = buffer.readUInt32BE(index);
    const chunkEnd = index + 12 + length;
    if (chunkEnd > buffer.length) throw invalidImage("PNG");
    const typeBuffer = buffer.subarray(index + 4, index + 8);
    const type = typeBuffer.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) throw invalidImage("PNG");
    const data = buffer.subarray(index + 8, index + 8 + length);
    const expectedCrc = buffer.readUInt32BE(index + 8 + length);
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) throw invalidImage("PNG");

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) throw invalidImage("PNG");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      validatePngHeader(data, width, height);
      sawHeader = true;
    } else if (type === "IHDR") {
      throw invalidImage("PNG");
    }

    const critical = (typeBuffer[0] & 0x20) === 0;
    if (critical && !knownCritical.has(type)) throw invalidImage("PNG");
    if (type === "IDAT") sawData = true;
    const keep = critical || keptAncillary.has(type);
    if (keep) output.push(buffer.subarray(index, chunkEnd));
    else stripped = true;
    index = chunkEnd;

    if (type === "IEND") {
      if (length !== 0 || index !== buffer.length) throw invalidImage("PNG");
      sawEnd = true;
      break;
    }
  }

  if (!sawHeader || !sawData || !sawEnd) throw invalidImage("PNG");
  const sanitized = Buffer.concat(output);
  return {
    buffer: sanitized,
    mimeType: "image/png",
    extension: ".png",
    width,
    height,
    metadataStripped: true,
    metadataRemoved: stripped || sanitized.length !== buffer.length
  };
}

function sanitizeWebp(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(4) !== buffer.length - 8) throw invalidImage("WebP");
  const keptTypes = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
  const chunks = [];
  let index = 12;
  let width = 0;
  let height = 0;
  let sawCanvas = false;
  let sawBitstream = false;
  let stripped = false;

  while (index < buffer.length) {
    if (index + 8 > buffer.length) throw invalidImage("WebP");
    const type = buffer.subarray(index, index + 4).toString("ascii");
    const length = buffer.readUInt32LE(index + 4);
    const paddedLength = length + (length % 2);
    const end = index + 8 + paddedLength;
    if (!/^[\x20-\x7e]{4}$/.test(type) || end > buffer.length) throw invalidImage("WebP");
    let data = Buffer.from(buffer.subarray(index + 8, index + 8 + length));

    if (type === "VP8X") {
      if (data.length !== 10) throw invalidImage("WebP");
      width = 1 + readUInt24LE(data, 4);
      height = 1 + readUInt24LE(data, 7);
      data[0] &= ~(0x20 | 0x08 | 0x04);
      sawCanvas = true;
    } else if (type === "VP8 ") {
      if (data.length < 10 || !data.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) throw invalidImage("WebP");
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
      sawBitstream = true;
    } else if (type === "VP8L") {
      if (data.length < 5 || data[0] !== 0x2f) throw invalidImage("WebP");
      width = 1 + data[1] + ((data[2] & 0x3f) << 8);
      height = 1 + ((data[2] >> 6) | (data[3] << 2) | ((data[4] & 0x0f) << 10));
      sawBitstream = true;
    } else if (type === "ANMF") {
      if (data.length < 16) throw invalidImage("WebP");
      sawBitstream = true;
    }

    if (keptTypes.has(type)) chunks.push(makeWebpChunk(type, data));
    else stripped = true;
    index = end;
  }

  if (index !== buffer.length || !sawBitstream || (!sawCanvas && (!width || !height))) throw invalidImage("WebP");
  validateDimensions(width, height, "WebP");
  const payload = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  const sanitized = Buffer.concat([header, payload]);
  return {
    buffer: sanitized,
    mimeType: "image/webp",
    extension: ".webp",
    width,
    height,
    metadataStripped: true,
    metadataRemoved: stripped || !sanitized.equals(buffer)
  };
}

function makeWebpChunk(type, data) {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function validatePngHeader(data, width, height) {
  validateDimensions(width, height, "PNG");
  const bitDepth = data[8];
  const colorType = data[9];
  const allowedDepths = {
    0: new Set([1, 2, 4, 8, 16]),
    2: new Set([8, 16]),
    3: new Set([1, 2, 4, 8]),
    4: new Set([8, 16]),
    6: new Set([8, 16])
  };
  if (!allowedDepths[colorType] || !allowedDepths[colorType].has(bitDepth)) throw invalidImage("PNG");
  if (data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) throw invalidImage("PNG");
}

function validateDimensions(width, height, label) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw invalidImage(label);
  }
}

function isJpegStartOfFrame(marker) {
  return (marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function validateUploadBuffer(buffer, maxUploadBytes) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw documentError("DOCUMENT_REQUIRED", "Belge görseli gerekli.");
  }
  if (buffer.length > maxUploadBytes) {
    throw documentError("DOCUMENT_TOO_LARGE", `Belge en fazla ${maxUploadBytes} bayt olabilir.`, 413);
  }
}

function validateDeclaredType(value, detectedMimeType) {
  const declared = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") return;
  if (!MIME_DETAILS[declared] || declared !== detectedMimeType) {
    throw documentError("DOCUMENT_MIME_MISMATCH", "Belgenin MIME türü ile dosya içeriği uyuşmuyor.");
  }
}

function validateFilenameType(value, detectedMimeType) {
  const extension = path.extname(String(value || "").trim()).toLowerCase();
  if (!extension) return;
  const normalized = extension === ".jpeg" ? ".jpg" : extension;
  if ([".jpg", ".png", ".webp"].includes(normalized) && normalized !== MIME_DETAILS[detectedMimeType].extension) {
    throw documentError("DOCUMENT_EXTENSION_MISMATCH", "Belgenin dosya uzantısı ile içeriği uyuşmuyor.");
  }
}

function sanitizeOriginalFilename(value, fallbackExtension = "") {
  let name = String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!name) name = `belge${fallbackExtension}`;
  if (name.length > 160) {
    const extension = path.extname(name).slice(0, 12);
    name = `${name.slice(0, Math.max(1, 160 - extension.length)).trim()}${extension}`;
  }
  return name || `belge${fallbackExtension}`;
}

function safeDocumentMetadata(document) {
  const source = document && typeof document === "object" ? document : {};
  const safe = {};
  for (const field of PUBLIC_DOCUMENT_FIELDS) {
    if (source[field] === undefined) continue;
    safe[field] = Array.isArray(source[field]) ? source[field].map((item) => String(item)) : source[field];
  }
  safe.thumbnailAvailable = Boolean(source.thumbnailPhysicalName || source.physicalName);
  return safe;
}

function invalidImage(label) {
  return documentError("INVALID_DOCUMENT_STRUCTURE", `${label} görsel yapısı geçersiz veya güvenli sınırların dışında.`);
}

function documentError(code, message, status = 400, cause) {
  return new ProcurementDocumentError(code, message, status, cause);
}

function validatePrivateName(value) {
  const name = String(value || "");
  return PRIVATE_FILE_PATTERN.test(name) && path.basename(name) === name ? name : "";
}

function mimeTypeForPrivateName(value) {
  return {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
  }[path.extname(String(value || "")).toLowerCase()] || "";
}

function uniquePrivateNames(values) {
  return [...new Set((values || []).map(validatePrivateName).filter(Boolean))];
}

function safeHash(value) {
  const hash = String(value || "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_unused, entry) => {
      let current = entry;
      for (let bit = 0; bit < 8; bit += 1) current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
      return current >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = {
  DEFAULT_MAX_UPLOAD_BYTES,
  ProcurementDocumentError,
  createProcurementDocumentService,
  detectImageType,
  safeDocumentMetadata,
  sanitizeImage,
  sanitizeOriginalFilename
};
