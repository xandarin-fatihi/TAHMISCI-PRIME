"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  createProcurementDocumentService,
  detectImageType,
  safeDocumentMetadata,
  sanitizeImage,
  sanitizeOriginalFilename
} = require("../src/procurement-documents");
const { createProcurementImageProcessor } = require("../src/procurement-image-processor");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64"
);
const WEBP_1X1 = makeWebpFixture();

test("JPEG, PNG ve WebP gerçek imza/yapı üzerinden tanınır; sahte içerik reddedilir", () => {
  assert.equal(detectImageType(JPEG_1X1), "image/jpeg");
  assert.equal(detectImageType(PNG_1X1), "image/png");
  assert.equal(detectImageType(WEBP_1X1), "image/webp");
  for (const fixture of [JPEG_1X1, PNG_1X1, WEBP_1X1]) {
    const image = sanitizeImage(fixture);
    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
    assert.ok(image.buffer.length > 20);
  }
  assert.throws(
    () => sanitizeImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    (error) => error.code === "INVALID_DOCUMENT_STRUCTURE" && error.status === 400
  );
});

test("özel depolama EXIF'i çıkarır, rastgele ad kullanır ve sanitize edilmiş hash ile fiziksel dedupe yapar", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-docs-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({ documentsDir: runRoot, maxUploadBytes: 2 * 1024 * 1024 });
  const withExif = addJpegExif(JPEG_1X1, "GPS=40.7128,-74.0060;owner=private");

  const first = await service.storeUpload({
    buffer: withExif,
    originalName: "../kamera\u202e-fatura.jpg",
    declaredMimeType: "image/jpeg"
  });
  service.commitUpload(first);
  const duplicate = await service.storeUpload({
    buffer: JPEG_1X1,
    originalName: "aynı-belge.jpeg",
    declaredMimeType: "image/jpeg"
  });
  service.commitUpload(duplicate);

  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.physicalName, first.physicalName);
  assert.equal(duplicate.sha256, first.sha256);
  assert.match(first.physicalName, /^[a-f0-9]{48}\.jpg$/);
  assert.doesNotMatch(first.physicalName, /kamera|fatura|\.\./i);
  assert.equal(Object.keys(first).includes("_storageLeaseToken"), false);

  const stored = await service.resolveContent(first);
  assert.equal(stored.mimeType, "image/jpeg");
  assert.equal(stored.buffer.includes(Buffer.from("GPS=")), false);
  assert.equal(stored.buffer.includes(Buffer.from("Exif\0\0", "binary")), false);

  const files = (await fs.readdir(runRoot)).filter((name) => /\.(?:jpg|png|webp)$/.test(name));
  assert.deepEqual(files, [first.physicalName], "aynı görünür belge yalnız bir fiziksel nesne üretmeli");

  const publicMetadata = safeDocumentMetadata({
    id: "doc-1",
    documentType: "fatura",
    originalName: first.originalName,
    physicalName: first.physicalName,
    thumbnailPhysicalName: first.thumbnailPhysicalName,
    sha256: first.sha256,
    serverPath: path.join(runRoot, first.physicalName)
  });
  assert.equal(publicMetadata.id, "doc-1");
  assert.equal(publicMetadata.thumbnailAvailable, true);
  assert.equal("physicalName" in publicMetadata, false);
  assert.equal("thumbnailPhysicalName" in publicMetadata, false);
  assert.equal("sha256" in publicMetadata, false);
  assert.equal("serverPath" in publicMetadata, false);
});

test("MIME/uzantı/boyut kontrolleri yazmadan önce hata verir", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-validation-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({ documentsDir: runRoot, maxUploadBytes: PNG_1X1.length });

  await assert.rejects(
    service.storeUpload({ buffer: PNG_1X1, originalName: "fatura.jpg", declaredMimeType: "image/png" }),
    (error) => error.code === "DOCUMENT_EXTENSION_MISMATCH"
  );
  await assert.rejects(
    service.storeUpload({ buffer: PNG_1X1, originalName: "fatura.png", declaredMimeType: "image/jpeg" }),
    (error) => error.code === "DOCUMENT_MIME_MISMATCH"
  );
  await assert.rejects(
    service.storeUpload({ buffer: Buffer.alloc(PNG_1X1.length + 1), originalName: "fatura.png", declaredMimeType: "image/png" }),
    (error) => error.code === "DOCUMENT_TOO_LARGE" && error.status === 413
  );
  assert.deepEqual(await fs.readdir(runRoot), [], "geçersiz içerik fiziksel dosya veya index üretmemeli");
});

test("kullanılamayan private dizin hatası fiziksel sunucu yolunu dışarı sızdırmaz", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-storage-error-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const invalidDirectory = path.join(runRoot, "not-a-directory");
  await fs.writeFile(invalidDirectory, "private");
  const service = createProcurementDocumentService({ documentsDir: invalidDirectory });
  await assert.rejects(service.init(), (error) => {
    assert.equal(error.code, "DOCUMENT_STORAGE_UNAVAILABLE");
    assert.equal(error.status, 500);
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(runRoot), "i"));
    return true;
  });
});

test("rollback yalnız sahipsiz yeni nesneyi siler; commit edilmiş dedupe nesnesini korur", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-rollback-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({ documentsDir: runRoot });

  const staged = await service.storeUpload({ buffer: PNG_1X1, originalName: "staged.png", declaredMimeType: "image/png" });
  const rolledBack = await service.removePhysicalFiles(staged);
  assert.equal(rolledBack.filesRemoved, 1);
  await assert.rejects(service.resolveContent(staged), (error) => error.status === 404);

  const committed = await service.storeUpload({ buffer: PNG_1X1, originalName: "saved.png", declaredMimeType: "image/png" });
  service.commitUpload(committed);
  const existingLease = await service.storeUpload({ buffer: PNG_1X1, originalName: "again.png", declaredMimeType: "image/png" });
  const duplicateRollback = await service.removePhysicalFiles(existingLease);
  assert.equal(duplicateRollback.filesRemoved, 0);
  assert.equal((await service.resolveContent(committed)).mimeType, "image/png");
});

test("auth-gated gönderim yetkisizi okumadan reddeder ve yetkili içeriği no-store döndürür", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-auth-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({ documentsDir: runRoot });
  const stored = await service.storeUpload({ buffer: PNG_1X1, originalName: "kanıt.png", declaredMimeType: "image/png" });
  service.commitUpload(stored);

  const denied = responseDouble();
  const deniedResult = await service.sendAuthorizedContent({}, denied, {
    document: { ...stored, physicalName: "../../private.png" },
    authorize: async () => false
  });
  assert.equal(deniedResult, false);
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.body, { ok: false, message: "Bu belgeyi görüntüleme yetkiniz yok." });
  assert.doesNotMatch(JSON.stringify(denied.body), /proc-auth|physical|private\.png/i);

  const allowed = responseDouble();
  const allowedResult = await service.sendAuthorizedContent({ authSession: { role: "admin" } }, allowed, {
    document: stored,
    thumbnail: true,
    authorize: async (req) => req.authSession.role === "admin"
  });
  assert.equal(allowedResult, true);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(allowed.headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(allowed.headers["X-Content-Type-Options"], "nosniff");
  assert.deepEqual(allowed.body, (await service.resolveContent(stored)).buffer);

  await assert.rejects(
    service.sendAuthorizedContent({}, responseDouble(), { document: stored }),
    (error) => error.code === "DOCUMENT_AUTHORIZATION_REQUIRED" && error.status === 500
  );
});

test("opsiyonel güvenli image processor ayrı thumbnail/re-encode çıktısını private depoda tutar", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-thumbnail-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({
    documentsDir: runRoot,
    imageProcessor: async ({ buffer }) => ({ buffer, thumbnailBuffer: PNG_1X1, reencoded: true })
  });
  const stored = await service.storeUpload({ buffer: JPEG_1X1, originalName: "kamera.jpg", declaredMimeType: "image/jpeg" });
  service.commitUpload(stored);

  assert.equal(stored.reencoded, true);
  assert.equal(stored.thumbnailGenerated, true);
  assert.notEqual(stored.thumbnailPhysicalName, stored.physicalName);
  assert.match(stored.thumbnailPhysicalName, /^[a-f0-9]{48}\.png$/);
  const persistedShape = {
    mimeType: stored.mimeType,
    sha256: stored.sha256,
    physicalName: stored.physicalName,
    thumbnailPhysicalName: stored.thumbnailPhysicalName
  };
  const thumbnail = await service.resolveContent(persistedShape, { thumbnail: true });
  assert.equal(thumbnail.mimeType, "image/png");
  assert.equal(thumbnail.thumbnail, true);
  assert.deepEqual(thumbnail.buffer, PNG_1X1);
});

test("production image processor görseli WebP olarak yeniden kodlar ve gerçek thumbnail üretir", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-sharp-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({
    documentsDir: runRoot,
    imageProcessor: createProcurementImageProcessor(),
    strictImageProcessing: true
  });
  const stored = await service.storeUpload({ buffer: PNG_1X1, originalName: "kamera.png", declaredMimeType: "image/png" });
  service.commitUpload(stored);

  assert.equal(stored.mimeType, "image/webp");
  assert.equal(stored.reencoded, true);
  assert.equal(stored.metadataStripped, true);
  assert.equal(stored.thumbnailGenerated, true);
  assert.notEqual(stored.thumbnailPhysicalName, stored.physicalName);
  const full = await service.resolveContent(stored);
  const thumbnail = await service.resolveContent(stored, { thumbnail: true });
  assert.equal(detectImageType(full.buffer), "image/webp");
  assert.equal(detectImageType(thumbnail.buffer), "image/webp");
});

test("orphan temizliği yalnız grace süresi dolmuş ve store tarafından referanslanmayan özel nesneleri kaldırır", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-orphan-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const service = createProcurementDocumentService({ documentsDir: runRoot });
  const orphan = await service.storeUpload({ buffer: WEBP_1X1, originalName: "orphan.webp", declaredMimeType: "image/webp" });
  service.commitUpload(orphan);
  await fs.utimes(path.join(runRoot, orphan.physicalName), new Date(0), new Date(0));
  await fs.utimes(path.join(runRoot, ".dedupe", `${orphan.sha256}.json`), new Date(0), new Date(0));

  const result = await service.cleanupOrphans({ documents: [], graceMs: 0 });
  assert.equal(result.filesRemoved, 1);
  assert.equal(result.indexesRemoved, 1);
  await assert.rejects(service.resolveContent(orphan), (error) => error.code === "DOCUMENT_CONTENT_NOT_FOUND");
  await assert.rejects(
    service.cleanupOrphans(),
    (error) => error.code === "DOCUMENT_REFERENCES_REQUIRED"
  );
});

test("production config private kalıcı dizini zorunlu tutar ve public media ile çakışmayı reddeder", async (context) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-proc-config-"));
  context.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const baseEnv = {
    ...process.env,
    NODE_ENV: "production",
    MAIN_DOMAIN: "tahmisci.test",
    ADMIN_DOMAIN: "tahmisci.test",
    PUBLIC_SITE_URL: "https://tahmisci.test",
    ALLOWED_ORIGINS: "https://tahmisci.test",
    JWT_SECRET: "secure-production-jwt-secret-with-at-least-thirty-two-characters",
    PASSWORD_MANAGER_KEY: "secure-production-manager-key-with-at-least-thirty-two-characters",
    COOKIE_SECURE: "true",
    TRUST_PROXY: "1",
    DATA_FILE: path.join(runRoot, "data", "store.json"),
    MEDIA_DIR: path.join(runRoot, "public-media"),
    DEFAULT_PANEL_PASSWORD: "",
    DEFAULT_RECIPE_PASSWORD: "",
    PASSWORD_RESET_EMAIL: "",
    SMTP_USER: "",
    SMTP_PASS: ""
  };

  const missing = runConfig({ ...baseEnv, PROCUREMENT_DOCUMENTS_DIR: "" });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /PROCUREMENT_DOCUMENTS_DIR/);

  const overlapping = runConfig({ ...baseEnv, PROCUREMENT_DOCUMENTS_DIR: path.join(runRoot, "public-media", "documents") });
  assert.notEqual(overlapping.status, 0);
  assert.match(`${overlapping.stdout}\n${overlapping.stderr}`, /MEDIA_DIR.*ic ice|PROCUREMENT_DOCUMENTS_DIR.*MEDIA_DIR/i);

  const valid = runConfig({ ...baseEnv, PROCUREMENT_DOCUMENTS_DIR: path.join(runRoot, "private-documents") });
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);

  const pm2Missing = runEcosystem({ ...baseEnv, BACKUP_DIR: path.join(runRoot, "backups"), PROCUREMENT_DOCUMENTS_DIR: "" });
  assert.notEqual(pm2Missing.status, 0);
  assert.match(`${pm2Missing.stdout}\n${pm2Missing.stderr}`, /PROCUREMENT_DOCUMENTS_DIR/);
  const pm2Valid = runEcosystem({
    ...baseEnv,
    BACKUP_DIR: path.join(runRoot, "backups"),
    PROCUREMENT_DOCUMENTS_DIR: path.join(runRoot, "private-documents"),
    PROCUREMENT_MAX_UPLOAD_BYTES: "10485760"
  });
  assert.equal(pm2Valid.status, 0, `${pm2Valid.stdout}\n${pm2Valid.stderr}`);
});

test("orijinal dosya adı yalnız güvenli metadata olarak normalize edilir", () => {
  assert.equal(sanitizeOriginalFilename("../../..\\fatura\r\n<script>.JPEG", ".jpg"), "fatura_script_.JPEG");
  assert.equal(sanitizeOriginalFilename("\u202e\u0000", ".png"), "belge.png");
  assert.ok(sanitizeOriginalFilename("a".repeat(300) + ".png", ".png").length <= 160);
});

function addJpegExif(jpeg, text) {
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), Buffer.from(text, "utf8")]);
  const segment = Buffer.alloc(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

function makeWebpFixture() {
  const fixture = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64");
  fixture.writeUInt32LE(fixture.length - 8, 4);
  fixture.writeUInt32LE(fixture.length - 20, 16);
  return fixture;
}

function responseDouble() {
  return {
    body: null,
    headers: {},
    statusCode: 0,
    set(nameOrValues, value) {
      if (typeof nameOrValues === "string") this.headers[nameOrValues] = value;
      else Object.assign(this.headers, nameOrValues);
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    }
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runConfig(env) {
  return spawnSync(process.execPath, ["-e", "require('./src/config').validateConfig()"], {
    cwd: path.resolve(__dirname, ".."),
    env,
    encoding: "utf8"
  });
}

function runEcosystem(env) {
  return spawnSync(process.execPath, ["-e", "require('./ecosystem.config.cjs')"], {
    cwd: path.resolve(__dirname, ".."),
    env,
    encoding: "utf8"
  });
}
