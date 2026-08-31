let activeDialog = null;

export function requestText(options = {}) {
  return openDialog({ ...options, kind: "text" });
}

export function confirmAction(options = {}) {
  return openDialog({ ...options, kind: "confirm" });
}

function openDialog(options) {
  if (activeDialog) activeDialog.cancel();
  return new Promise((resolve) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement("dialog");
    dialog.className = "fatura-dialog fatura-action-dialog";
    const isText = options.kind === "text";
    const title = escapeHtml(options.title || (isText ? "Bilgi gerekli" : "İşlemi onaylayın"));
    const description = escapeHtml(options.description || "");
    const label = escapeHtml(options.label || "Açıklama");
    const value = escapeHtml(options.value ?? options.initialValue ?? "");
    const confirmLabel = escapeHtml(options.confirmLabel || (isText ? "Devam et" : "Onayla"));
    const dangerClass = options.danger === true ? " ui-button--danger" : " ui-button--primary";
    dialog.innerHTML = `<form method="dialog" class="fatura-action-dialog__shell">
      <header><div><p class="eyebrow">TAHMİSÇİ FATURA</p><h2>${title}</h2>${description ? `<p>${description}</p>` : ""}</div><button class="dialog-close" type="button" data-action-dialog-cancel aria-label="Pencereyi kapat">×</button></header>
      <div class="dialog-body">${isText ? `<label class="fatura-action-dialog__field">${label}<textarea data-action-dialog-input maxlength="${Number(options.maxLength || 500)}" ${options.required === false ? "" : "required"}>${value}</textarea></label><p class="form-message" data-action-dialog-message role="alert"></p>` : `<p class="fatura-action-dialog__copy">${description || "Bu işlem mevcut kayıt üzerinde uygulanacaktır."}</p>`}</div>
      <footer><button class="ui-button ui-button--secondary" type="button" data-action-dialog-cancel>Vazgeç</button><button class="ui-button${dangerClass}" type="submit" value="confirm">${confirmLabel}</button></footer>
    </form>`;
    const form = dialog.querySelector("form");
    const input = dialog.querySelector("[data-action-dialog-input]");
    const finish = (result) => {
      if (activeDialog && activeDialog.dialog === dialog) activeDialog = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      document.body.classList.toggle("dialog-open", Boolean(document.querySelector("dialog[open]")));
      if (returnFocus && returnFocus.isConnected) requestAnimationFrame(() => returnFocus.focus());
      resolve(result);
    };
    const cancel = () => finish(isText ? null : false);
    activeDialog = { dialog, cancel };
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); cancel(); });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-action-dialog-cancel]")) cancel();
    });
    dialog.addEventListener("keydown", trapFocus);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isText) return finish(true);
      const result = String(input && input.value || "").trim();
      if (!result && options.required !== false) {
        dialog.querySelector("[data-action-dialog-message]").textContent = "Bu alan zorunludur.";
        input.focus();
        return;
      }
      finish(result);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    document.body.classList.add("dialog-open");
    (input || dialog.querySelector("[data-action-dialog-cancel]"))?.focus();
  });
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const items = [...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}
