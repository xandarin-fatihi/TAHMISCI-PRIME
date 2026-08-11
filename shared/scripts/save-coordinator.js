(function (global) {
  "use strict";

  const OPERATION_CLASSES = Object.freeze({
    DRAFT_PUBLISH: "draft-publish",
    IMMEDIATE: "immediate-operation",
    DEVICE: "device-preference"
  });

  const STATUS_LABELS = Object.freeze({
    dirty: "Kaydedilmemiş değişiklik",
    draft: "Taslak",
    saving: "Kaydediliyor",
    publishing: "Yayınlanıyor",
    published: "Yayınlandı",
    applied: "Anında uygulandı",
    device: "Yalnızca bu cihazda kayıtlı",
    cancelled: "İşlem iptal edildi",
    skipped: "İşlem uygulanmadı",
    error: "İşlem başarısız",
    conflict: "Çakışma oluştu",
    offline: "Bağlantı kesildi",
    retryable: "Yeniden denenebilir"
  });

  const OPERATION_RESULTS = Object.freeze({
    cancelled(reason = "") {
      return { operationOutcome: "cancelled", reason: String(reason || "") };
    },
    skipped(reason = "") {
      return { operationOutcome: "skipped", reason: String(reason || "") };
    }
  });

  class OperationCoordinator {
    constructor(options = {}) {
      this.inFlight = new Map();
      this.onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};
    }

    run(key, operation, options = {}) {
      const operationKey = String(key || "default");
      if (this.inFlight.has(operationKey)) return this.inFlight.get(operationKey);
      if (typeof operation !== "function") {
        return Promise.reject(new TypeError("İşlem tanımlı değil."));
      }

      const classification = Object.values(OPERATION_CLASSES).includes(options.classification)
        ? options.classification
        : OPERATION_CLASSES.DRAFT_PUBLISH;
      const button = options.button || null;
      const initialHtml = button ? button.innerHTML : "";
      const initialDisabled = button ? button.disabled : false;
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.dataset.operationClass = classification;
        if (options.busyText) button.textContent = options.busyText;
      }
      this.onStatus(options.startStatus || "saving", { key: operationKey, classification });

      const promise = Promise.resolve()
        .then(operation)
        .then((result) => {
          const operationOutcome = result && typeof result === "object"
            ? String(result.operationOutcome || "")
            : "";
          if (operationOutcome === "cancelled" || operationOutcome === "skipped") {
            this.onStatus(operationOutcome, { key: operationKey, classification, result });
            return result;
          }
          const successStatus = options.successStatus || (
            classification === OPERATION_CLASSES.IMMEDIATE
              ? "applied"
              : classification === OPERATION_CLASSES.DEVICE ? "device" : "published"
          );
          this.onStatus(successStatus, { key: operationKey, classification, result });
          return result;
        })
        .catch((error) => {
          const status = Number(error && error.status || 0) === 409 ? "conflict" : "error";
          this.onStatus(status, { key: operationKey, classification, error });
          throw error;
        })
        .finally(() => {
          this.inFlight.delete(operationKey);
          if (button) {
            button.removeAttribute("aria-busy");
            if (options.restoreButtonState !== false) {
              button.disabled = initialDisabled;
              button.innerHTML = initialHtml;
            }
          }
          if (typeof options.onSettled === "function") options.onSettled();
        });

      this.inFlight.set(operationKey, promise);
      return promise;
    }

    isRunning(key) {
      return this.inFlight.has(String(key || "default"));
    }

    isSaving(key) {
      return this.isRunning(key);
    }
  }

  global.TahmisciOperationClasses = OPERATION_CLASSES;
  global.TahmisciOperationStatusLabels = STATUS_LABELS;
  global.TahmisciOperationResults = OPERATION_RESULTS;
  global.TahmisciOperationCoordinator = OperationCoordinator;
  global.TahmisciOperations = new OperationCoordinator();
  global.TahmisciSaveCoordinator = OperationCoordinator;
})(window);
