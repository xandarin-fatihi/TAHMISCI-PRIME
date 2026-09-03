const API_ROOT = "/api/procurement/v1";
const inFlightGets = new Map();

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
  if (!(file instanceof File)) throw new ApiError("Yüklenecek belge seçilmedi.", 400);
  const headers = new Headers({
    "Content-Type": file.type || "application/octet-stream",
    "X-File-Name": encodeURIComponent(file.name || "belge"),
    "X-Document-Type": metadata.documentType || "diğer",
    "X-Supplier-Id": metadata.supplierId || "",
    "X-Shipment-Ids": (metadata.shipmentIds || []).join(","),
    "X-Shipment-Item-Ids": (metadata.shipmentItemIds || []).join(","),
    "X-Document-Number": metadata.documentNumber || "",
    "X-Document-Date": metadata.documentDate || ""
  });
  return api("/documents", { method: "POST", headers, body: file, raw: true, expectedRevision, requestId: requestId("document-upload") });
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
