export const CAPABILITIES = {
  read: "procurement.read", supplierRead: "supplier.read", supplierManage: "supplier.manage",
  links: "supplierProduct.manage", receiptCreate: "receipt.create", receiptSubmit: "receipt.submit",
  receiptApprove: "receipt.approve", receiptReject: "receipt.reject", accountingRead: "accounting.read",
  accountingPost: "accounting.post", accountingReverse: "accounting.reverse", paymentCreate: "payment.create",
  paymentReverse: "payment.reverse", documentsRead: "documents.read", documentsUpload: "documents.upload",
  documentsArchive: "documents.archive", users: "procurement.users.manage"
};

export const state = {
  context: null, revision: 0, workforceRevision: 0, activeView: "dashboard", loaded: new Map(), eventSource: null,
  suppliers: [], productLinks: [], shipments: [], documents: [], ledgerEntries: [], payments: [], users: [], auditEvents: [],
  dashboard: null, settings: null, filters: Object.create(null), detail: null
};

export function has(capability) {
  const actor = state.context && state.context.actor;
  return Boolean(actor && (actor.type === "admin" || (actor.capabilities || []).includes(capability)));
}

export function updateRevision(payload) {
  const revision = Number(payload && payload.revision);
  const workforceRevision = Number(payload && payload.workforceRevision);
  if (Number.isFinite(revision) && revision >= 0) state.revision = revision;
  if (Number.isFinite(workforceRevision) && workforceRevision >= 0) state.workforceRevision = workforceRevision;
}

export function invalidate(scopes = []) {
  for (const scope of scopes) state.loaded.delete(scope);
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

export function trMoney(kurus) {
  const amount = Number(kurus || 0) / 100;
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(amount);
}

export function trDate(value, withTime = false) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("tr-TR", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

export function statusBadge(value) {
  const status = String(value || "");
  const map = {
    taslak: ["Taslak", "is-muted"], onay_bekliyor: ["Onay bekliyor", "is-warning"], onaylandı: ["Onaylandı", "is-success"],
    reddedildi: ["Reddedildi", "is-danger"], posted: ["Muhasebeleştirildi", "is-success"], not_posted: ["Muhasebe bekliyor", "is-warning"],
    reversed: ["Ters kayıt", "is-muted"], available: ["Belge var", "is-success"], missing: ["Belge eksik", "is-warning"],
    active: ["Aktif", "is-success"], passive: ["Pasif", "is-muted"]
  };
  const item = map[status] || [status || "Belirsiz", "is-muted"];
  return `<span class="badge ${item[1]}">${escapeHtml(item[0])}</span>`;
}

export function requestKey(prefix) {
  const random = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function value(formData, name) { return String(formData.get(name) || "").trim(); }
export function integerKurus(valueText) {
  const normalized = String(valueText || "0").trim().replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Geçerli ve negatif olmayan bir tutar girin.");
  return Math.round(amount * 100);
}

export function icon(name) {
  const paths = {
    dashboard: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    shipments: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    suppliers: '<path d="M4 20V7l8-4 8 4v13"/><path d="M8 10h2M14 10h2M8 14h2M14 14h2M10 20v-3h4v3"/>',
    links: '<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/>',
    documents: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h6"/>',
    ledger: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M16 14h2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 11a4 4 0 0 1 4 4v2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.dashboard}</svg>`;
}
