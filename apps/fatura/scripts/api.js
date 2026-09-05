const API_ROOT = "/api/procurement/v1";
const inFlightGets = new Map();
const documentUploads = new WeakMap();
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const DOCUMENT_ERRORS = Object.freeze({
  DOCUMENT_TOO_LARGE: "Fotoğraf çok büyük. Daha düşük çözünürlükte tekrar deneyin.",
  DOCUMENT_PROCESSING_FAILED: "Fotoğraf işlenemedi. JPEG olarak tekrar deneyin.",
  DOCUMENT_PROCESSING_UNAVAILABLE: "Bu görsel formatı sunucuda işlenemiyor. JPEG veya PNG deneyin.",
  UNSUPPORTED_DOCUMENT_TYPE: "JPEG, PNG, WebP, HEIC, HEIF veya PDF seçin.",
  DOCUMENT_MIME_MISMATCH: "Dosya biçimi doğrulanamadı.",
  DOCUMENT_EXTENSION_MISMATCH: "Dosya biçimi doğrulanamadı."
});

export class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message || "İşlem tamamlanamadı.");
    this.name = "ApiError";
    this.status = Number(status || 0);
    this.payload = payload;
    this.code = payload && payload.code || "";
  }
}

export function requestId(prefix = "fatura") {
  const random = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const url = path.startsWith("/api/") ? path : `${API_ROOT}${path.startsWith("/") ? path : `/${path}`}`;
  const dedupeKey = method === "GET" && options.dedupe !== false ? `${url}` : "";
  if (dedupeKey && inFlightGets.has(dedupeKey)) return inFlightGets.get(dedupeKey);
  const task = execute(url, method, options).finally(() => dedupeKey && inFlightGets.delete(dedupeKey));
  if (dedupeKey) inFlightGets.set(dedupeKey, task);
  return task;
}

async function execute(url, method, options) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body !== undefined && body !== null && !options.raw) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  if (!new Set(["GET", "HEAD"]).has(method)) {
    const id = options.requestId || requestId(method.toLowerCase());
    headers.set("Idempotency-Key", id);
    headers.set("X-Request-ID", id);
    if (options.expectedRevision !== undefined && options.expectedRevision !== null) {
      headers.set("X-Expected-Revision", String(options.expectedRevision));
    }
    if (options.expectedInventoryRevision !== undefined && options.expectedInventoryRevision !== null) {
      headers.set("X-Expected-Inventory-Revision", String(options.expectedInventoryRevision));
    }
    if (options.expectedCatalogRevision !== undefined && options.expectedCatalogRevision !== null) {
      headers.set("X-Expected-Catalog-Revision", String(options.expectedCatalogRevision));
    }
  }
  let response;
  try {
    response = await fetch(url, { method, headers, body, credentials: "include", cache: "no-store", signal: options.signal });
  } catch (error) {
    throw new ApiError(navigator.onLine ? "Sunucuya ulaşılamadı. Lütfen tekrar deneyin." : "Çevrimdışısınız. Mali işlemler çevrimdışı sıraya alınmaz.", 0, { cause: error && error.message });
  }
  if (options.responseType === "blob") {
    if (!response.ok) throw await responseError(response);
    return response.blob();
  }
  if (options.responseType === "text") {
    if (!response.ok) throw await responseError(response);
    return response.text();
  }
  const payload = await readPayload(response);
  if (!response.ok) throw new ApiError(payload && payload.message || `İşlem tamamlanamadı (${response.status}).`, response.status, payload);
  return payload;
}

async function readPayload(response) {
  const type = String(response.headers.get("content-type") || "");
  if (!type.includes("json")) return { ok: response.ok, text: await response.text() };
  try { return await response.json(); } catch (_error) { return { ok: response.ok }; }
}

async function responseError(response) {
  const payload = await readPayload(response);
  return new ApiError(payload && payload.message || `İşlem tamamlanamadı (${response.status}).`, response.status, payload);
}

export async function login(scope, values) {
  const endpoint = scope === "admin" ? "/api/admin/login" : "/api/recipe/login";
  return api(endpoint, { method: "POST", body: values, requestId: requestId(`login-${scope}`) });
}

export async function logout(scope) {
  return api(scope === "admin" ? "/api/admin/logout" : "/api/recipe/logout", { method: "POST", body: {}, requestId: requestId(`logout-${scope}`) });
}

export async function uploadDocument(file, metadata, expectedRevision) {
  if (!(file instanceof File) || !file.size) throw new ApiError("Yüklenecek belge seçilmedi.", 400);
  // Aynı dosya ve bağlantılar için eşzamanlı çağrılar ve belirsiz ağ hataları tek işlem kimliğini kullanır.
  const key = JSON.stringify([metadata.documentType, metadata.supplierId, metadata.shipmentIds || [], metadata.shipmentItemIds || [], metadata.documentNumber, metadata.documentDate]);
  let attempts = documentUploads.get(file);
  if (!attempts) { attempts = new Map(); documentUploads.set(file, attempts); }
  let attempt = attempts.get(key);
  if (!attempt) { attempt = { id: requestId("document-upload"), task: null }; attempts.set(key, attempt); }
  if (attempt.task) return attempt.task;
  attempt.task = sendDocument(file, metadata, expectedRevision, attempt.id).catch((error) => {
    attempt.task = null;
    const message = error.code === "DOCUMENT_TOO_LARGE" && error.payload?.mimeType === "application/pdf"
      ? "Belge çok büyük. PDF en fazla 10 MB olabilir."
      : DOCUMENT_ERRORS[error.code] || (error.status === 0 ? "Bağlantı nedeniyle yükleme tamamlanamadı." : error.message);
    throw new ApiError(message, error.status || 0, error.payload);
  });
  return attempt.task;
}

async function sendDocument(original, metadata, expectedRevision, operationId) {
  const detectedType = await documentSignature(original);
  const declaredType = String(original.type || "").toLowerCase();
  const knownTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
  const phoneTypes = ["image/jpeg", "image/heic", "image/heif"];
  // iOS paylaşım/picker MIME'ı ve uzantısı, dönüştürülmüş fotoğrafın içeriğinden farklı olabilir.
  const phoneAlias = phoneTypes.includes(declaredType) && phoneTypes.includes(detectedType);
  const mimeType = (!knownTypes.includes(declaredType) || phoneAlias) ? detectedType || "application/octet-stream" : declaredType;
  const file = mimeType === detectedType ? await prepareDocumentImage(original, detectedType) : original;
  const maxBytes = detectedType === "application/pdf" ? 10 * 1024 * 1024 : MAX_DOCUMENT_BYTES;
  if (file.size > maxBytes) throw new ApiError(DOCUMENT_ERRORS.DOCUMENT_TOO_LARGE, 413, { code: "DOCUMENT_TOO_LARGE", mimeType: detectedType });
  let name = file.name || "belge";
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  if (file === original && ["jpg", "jpeg", "heic", "heif"].includes(extension) && phoneTypes.includes(detectedType)) {
    name = name.replace(/\.[^.]+$/, detectedType === "image/jpeg" ? ".jpg" : detectedType === "image/heic" ? ".heic" : ".heif");
  }
  const headers = new Headers({
    "Content-Type": file === original ? mimeType : file.type,
    "X-File-Name": encodeURIComponent(name),
    "X-Document-Type": encodeURIComponent(metadata.documentType || "diğer"),
    "X-Supplier-Id": metadata.supplierId || "",
    "X-Shipment-Ids": (metadata.shipmentIds || []).join(","),
    "X-Shipment-Item-Ids": (metadata.shipmentItemIds || []).join(","),
    "X-Document-Number": encodeURIComponent(metadata.documentNumber || ""),
    "X-Document-Date": metadata.documentDate || ""
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const payload = await api("/documents", { method: "POST", headers, body: file, raw: true, expectedRevision, requestId: operationId, signal: controller.signal });
    if (!payload?.document?.id) throw new ApiError("Bağlantı nedeniyle yükleme tamamlanamadı.", 0);
    return payload;
  } finally { clearTimeout(timeout); }
}

async function documentSignature(file) {
  try {
    const slice = file.slice(0, 32);
    const bytes = new Uint8Array(typeof slice.arrayBuffer === "function" ? await slice.arrayBuffer() : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(slice);
    }));
    const text = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
    if ([137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) return "image/png";
    if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
    if (text(0, 5) === "%PDF-") return "application/pdf";
    if (text(4, 8) === "ftyp") {
      if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(text(8, 12))) return "image/heic";
      if (["heif", "mif1", "msf1"].includes(text(8, 12))) return "image/heif";
    }
  } catch (_error) { /* Dosya okuma/format doğrulamasını sunucu tamamlar. */ }
  return "";
}

async function prepareDocumentImage(file, mimeType) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return file;
  let decoded;
  let canvas;
  try {
    if (typeof createImageBitmap === "function") {
      try { decoded = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_error) { /* WebKit native fallback */ }
    }
    if (!decoded) decoded = await decodeDocumentImage(file);
    const width = decoded.naturalWidth || decoded.width;
    const height = decoded.naturalHeight || decoded.height;
    if (width > 24000 || height > 24000 || width * height > 60000000) {
      throw new ApiError(DOCUMENT_ERRORS.DOCUMENT_TOO_LARGE, 413, { code: "DOCUMENT_TOO_LARGE" });
    }
    const scale = Math.min(1, 4000 / Math.max(width, height));
    if (scale === 1 && file.size <= 2 * 1024 * 1024) return file;
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType === "image/jpeg" ? "image/jpeg" : "image/webp", .85));
    if (!blob || (scale === 1 && blob.size >= file.size)) return file;
    const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "belge"}.${extension}`, { type: blob.type, lastModified: file.lastModified });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return file;
  } finally {
    decoded?.close?.();
    if (decoded instanceof HTMLImageElement) decoded.src = "";
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

function decodeDocumentImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const finish = (error) => {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      URL.revokeObjectURL(url);
      if (error) { image.src = ""; reject(error); } else resolve(image);
    };
    const timeout = setTimeout(() => finish(new Error("Görsel okuma zaman aşımı.")), 15000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error("Görsel tarayıcıda çözülemedi."));
    image.src = url;
  });
}

export async function uploadStockWorkbook(file, targetLocationId, revisions = {}) {
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name || "")) {
    throw new ApiError("Yalnız .xlsx stok dosyası seçilebilir.", 422);
  }
  if (file.size > 20 * 1024 * 1024) throw new ApiError("Excel dosyası en fazla 20 MB olabilir.", 413);
  if (!String(targetLocationId || "").trim()) throw new ApiError("Hedef depo seçimi zorunludur.", 422);
  const form = new FormData();
  form.append("targetLocationId", String(targetLocationId));
  form.append("file", file, file.name);
  return api("/stock/excel/import", {
    method: "POST",
    body: form,
    raw: true,
    requestId: requestId("stock-excel-import"),
    expectedInventoryRevision: revisions.inventory,
    expectedCatalogRevision: revisions.catalog
  });
}

export function exportUrl(kind) {
  return `${API_ROOT}/export?kind=${encodeURIComponent(kind || "ledger")}`;
}

export async function downloadExport(kind, filters = {}) {
  const params = new URLSearchParams({ kind: kind || "ledger" });
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  }
  let response;
  try {
    response = await fetch(`${API_ROOT}/export?${params}`, { credentials: "include", cache: "no-store" });
  } catch (error) {
    throw new ApiError(navigator.onLine ? "Excel çıktısı alınırken sunucuya ulaşılamadı." : "Çevrimdışıyken Excel çıktısı alınamaz.", 0, { cause: error && error.message });
  }
  if (!response.ok) throw await responseError(response);
  const disposition = String(response.headers.get("content-disposition") || "");
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainName = disposition.match(/filename="?([^";]+)"?/i);
  let filename = encodedName ? encodedName[1] : plainName ? plainName[1] : `tahmisci-${kind || "ledger"}.xlsx`;
  try { filename = decodeURIComponent(filename); } catch (_error) {}
  return { blob: await response.blob(), filename };
}
