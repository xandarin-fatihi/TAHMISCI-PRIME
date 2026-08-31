(function () {
  "use strict";

  const DEFAULT_PRICING = {
    schemaVersion: 1,
    types: [
      { id: "standard", name: "Standart", active: true, order: 0, options: [
        { id: "standard", label: "Standart", unit: "", order: 0, active: true }
      ] },
      { id: "size", name: "Boyut", active: true, order: 1, options: [
        { id: "small", label: "Küçük", unit: "", order: 0, active: true },
        { id: "medium", label: "Orta", unit: "", order: 1, active: true },
        { id: "large", label: "Büyük", unit: "", order: 2, active: true }
      ] },
      { id: "shot", name: "Shot", active: true, order: 2, options: [
        { id: "single", label: "Single", unit: "", order: 0, active: true },
        { id: "double", label: "Double", unit: "", order: 1, active: true }
      ] }
    ]
  };

  const state = {
    pricing: DEFAULT_PRICING,
    revision: 0,
    selectedIds: new Set(),
    formProductId: "",
    formTypeId: "",
    bulkMessage: "",
    bulkMessageKind: "",
    busy: false,
    loaded: false,
    initialized: false,
    editingTypeId: "",
    history: [],
    historyBusy: false,
    historyLoaded: false,
    historyMessage: "",
    historyMessageKind: ""
  };

  const els = {};

  function init() {
    cacheElements();
    if (!els.priceMode || !els.bulkPriceApply) return;
    bindEvents();
    ensureOptionRows(2);
    state.initialized = true;
    window.TahmisciPricing = api;
    waitForAdmin();
  }

  function cacheElements() {
    [
      "priceMode", "pricingValueFields", "newPriceTypeButton", "priceTypeModal", "priceTypeForm",
      "priceTypeName", "priceTypeOptionCount", "priceTypeOptionList", "addPriceTypeOption",
      "priceTypeActive", "priceTypeExistingList", "priceTypeMessage", "savePriceTypeButton", "bulkPriceCategory", "bulkPricingType",
      "bulkPricingOption", "bulkPriceSearch", "bulkPriceProductList", "bulkPriceSelectedCount",
      "bulkPriceClearSelection", "bulkPricingOperation", "bulkPricingRounding", "bulkPriceValue",
      "bulkPriceValueLabel", "bulkPriceSummary", "bulkPriceApply",
      "bulkPriceManualButton", "bulkPriceRevisionStatus",
      "openPricingHistory", "pricingHistoryCard", "pricingHistoryList", "pricingHistoryMessage", "refreshPricingHistory"
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function waitForAdmin() {
    const admin = bridge();
    if (!admin || !admin.snapshot().menuState) {
      window.setTimeout(waitForAdmin, 120);
      return;
    }
    loadPricing();
    syncFromAdmin();
  }

  function bridge() {
    return window.TahmisciAdminBridge || null;
  }

  function operationResult(type, reason) {
    const factory = window.TahmisciOperationResults && window.TahmisciOperationResults[type];
    return typeof factory === "function"
      ? factory(reason)
      : { operationOutcome: type, reason: String(reason || "") };
  }

  function runPricingOperation(key, button, operation, options = {}) {
    const coordinator = window.TahmisciOperations;
    const promise = !coordinator || typeof coordinator.run !== "function"
      ? Promise.resolve().then(operation)
      : coordinator.run(`pricing:${key}`, operation, {
        ...options,
        button,
        classification: window.TahmisciOperationClasses && window.TahmisciOperationClasses.IMMEDIATE || "immediate-operation"
      });
    return promise.catch(() => undefined);
  }

  function bindEvents() {
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.priceTypeModal.hidden) closeModal();
    });
    els.priceTypeForm.addEventListener("submit", savePriceType);
    els.addPriceTypeOption.addEventListener("click", () => ensureOptionRows(optionRows().length + 1));
    els.priceTypeOptionCount.addEventListener("input", () => {
      ensureOptionRows(clamp(Number(els.priceTypeOptionCount.value || 1), 1, 20));
    });
    els.priceTypeOptionList.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-pricing-option]");
      if (!remove) return;
      const rows = optionRows();
      if (rows.length <= 1) return showModalMessage("En az bir fiyat seçeneği gereklidir.");
      remove.closest(".pricing-type-option-row").remove();
      normalizeOptionRows();
    });
  }

  function handleClick(event) {
    if (event.target.closest("#newPriceTypeButton, [data-open-pricing-types]")) {
      event.preventDefault();
      openModal();
      return;
    }
    if (event.target.closest("#openPricingHistory")) {
      event.preventDefault();
      if (els.pricingHistoryCard) {
        els.pricingHistoryCard.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
        window.setTimeout(() => els.refreshPricingHistory && els.refreshPricingHistory.focus(), reducedMotion() ? 0 : 280);
      }
      if (!state.historyLoaded) loadPricingHistory();
      return;
    }
    if (event.target.closest("#refreshPricingHistory")) {
      event.preventDefault();
      loadPricingHistory(true);
      return;
    }
    const undoPricing = event.target.closest("[data-undo-pricing-operation]");
    if (undoPricing) {
      event.preventDefault();
      undoPricingOperation(undoPricing.dataset.undoPricingOperation, undoPricing);
      return;
    }
    if (event.target.closest("#bulkPriceManualButton")) {
      event.preventDefault();
      const target = document.querySelector(".bulk-price-picker-card");
      if (target) target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      window.setTimeout(() => els.bulkPriceCategory && els.bulkPriceCategory.focus(), reducedMotion() ? 0 : 280);
      return;
    }
    if (event.target.closest("[data-pricing-modal-close]")) {
      event.preventDefault();
      closeModal();
      return;
    }
    const deleteType = event.target.closest("[data-delete-pricing-type]");
    if (deleteType) {
      event.preventDefault();
      deletePricingType(deleteType.dataset.deletePricingType, deleteType);
      return;
    }
    const editType = event.target.closest("[data-edit-pricing-type]");
    if (editType) {
      event.preventDefault();
      openModal(editType.dataset.editPricingType);
      return;
    }
    if (event.target === els.priceTypeModal) closeModal();
    if (event.target.closest("#bulkPriceClearSelection")) {
      event.preventDefault();
      state.selectedIds.clear();
      state.bulkMessage = "";
      renderBulk();
      return;
    }
    if (event.target.closest("#bulkPriceApply")) {
      event.preventDefault();
      applyBulkUpdate();
      return;
    }
    const selectAll = event.target.closest("[data-bulk-pricing-select-all]");
    if (selectAll) {
      const checked = Boolean(selectAll.checked);
      filteredBulkEntries().forEach((entry) => checked ? state.selectedIds.add(entry.product.id) : state.selectedIds.delete(entry.product.id));
      renderBulk();
    }
  }

  function handleInput(event) {
    if (event.target === els.bulkPriceSearch || event.target === els.bulkPriceValue) {
      state.bulkMessage = "";
      renderBulk();
      return;
    }
    if (event.target.closest("#pricingValueFields")) {
      writeProductFromForm(selectedProduct());
      const admin = bridge();
      if (admin) admin.markMenuDirty("Ürün fiyatları kaydedilmedi");
      if (window.TahmisciLivePreview) window.TahmisciLivePreview.notifyDraft();
    }
  }

  function handleChange(event) {
    if (event.target === els.priceMode) {
      changeProductPricingType(event.target.value);
      return;
    }
    if ([els.bulkPriceCategory, els.bulkPricingType, els.bulkPricingOption, els.bulkPricingOperation, els.bulkPricingRounding].includes(event.target)
        || event.target.name === "bulkPricingScope") {
      state.bulkMessage = "";
      renderBulk();
      return;
    }
    const item = event.target.closest("[data-bulk-pricing-product]");
    if (item) {
      const id = item.dataset.bulkPricingProduct;
      item.checked ? state.selectedIds.add(id) : state.selectedIds.delete(id);
      renderBulk();
      return;
    }
    if (event.target.closest("#pricingValueFields")) {
      writeProductFromForm(selectedProduct());
      const admin = bridge();
      if (admin) admin.markMenuDirty("Ürün fiyatları kaydedilmedi");
    }
  }

  async function loadPricing() {
    try {
      const result = await bridge().backendRequest("/api/admin/pricing");
      state.pricing = normalizePricing(result.pricing);
      state.revision = finiteRevision(result.revision);
      state.loaded = true;
      bridge().setPricing(state.pricing);
      renderExistingTypes();
    } catch (error) {
      const localPricing = bridge().snapshot().menuState && bridge().snapshot().menuState.pricing;
      state.pricing = normalizePricing(localPricing || DEFAULT_PRICING);
      state.loaded = true;
    }
    renderPricingRevision();
    state.formProductId = "";
    syncFromAdmin();
    renderBulk();
    loadPricingHistory();
  }

  function normalizePricing(pricing) {
    const source = pricing && typeof pricing === "object" ? pricing : DEFAULT_PRICING;
    const types = Array.isArray(source.types) ? source.types : DEFAULT_PRICING.types;
    const normalized = types.map((type, typeIndex) => {
      const id = safeId(type && type.id) || `type-${typeIndex + 1}`;
      const options = Array.isArray(type && type.options) ? type.options : [];
      return {
        id,
        name: String(type && type.name || id),
        active: type && type.active !== false,
        order: finiteNumber(type && type.order, typeIndex),
        usageCount: finiteNumber(type && type.usageCount, 0),
        options: options.map((option, optionIndex) => ({
          id: safeId(option && option.id) || `option-${optionIndex + 1}`,
          label: String(option && (option.label || option.name) || `Seçenek ${optionIndex + 1}`),
          value: optionalNumber(option && option.value),
          unit: String(option && option.unit || ""),
          order: finiteNumber(option && option.order, optionIndex),
          active: option && option.active !== false
        })).sort((a, b) => a.order - b.order)
      };
    }).filter((type) => type.options.length).sort((a, b) => a.order - b.order);
    return { schemaVersion: finiteNumber(source.schemaVersion, 1), types: normalized.length ? normalized : DEFAULT_PRICING.types };
  }

  function activeTypes() {
    return state.pricing.types.filter((type) => type.active !== false);
  }

  function pricingType(typeId) {
    return state.pricing.types.find((type) => type.id === typeId) || activeTypes()[0] || state.pricing.types[0];
  }

  function selectedProduct() {
    const admin = bridge();
    return admin && admin.selectedProduct();
  }

  function syncFromAdmin() {
    if (!state.initialized) return;
    if (state.loaded && bridge()) bridge().setPricing(state.pricing);
    populateTypeSelect(els.priceMode, productPricing(selectedProduct()).typeId);
    syncProductPricingForm();
    renderBulk();
  }

  function populateTypeSelect(select, requestedValue) {
    if (!select) return;
    const types = activeTypes().slice();
    const requestedType = state.pricing.types.find((type) => type.id === requestedValue);
    if (requestedType && !types.some((type) => type.id === requestedType.id)) types.push(requestedType);
    const current = types.some((type) => type.id === requestedValue) ? requestedValue : types[0] && types[0].id || "standard";
    select.innerHTML = types.map((type) => `<option value="${escapeAttribute(type.id)}">${escapeHTML(type.name)}</option>`).join("");
    select.value = current;
  }

  function syncProductPricingForm() {
    const product = selectedProduct();
    if (!product) {
      els.pricingValueFields.innerHTML = '<div class="bulk-price-empty">Fiyatlarını düzenlemek için bir ürün seçin.</div>';
      state.formProductId = "";
      state.formTypeId = "";
      return;
    }
    const pricing = productPricing(product);
    populateTypeSelect(els.priceMode, pricing.typeId);
    if (state.formProductId === product.id && state.formTypeId === pricing.typeId && els.pricingValueFields.children.length) return;
    state.formProductId = product.id;
    state.formTypeId = pricing.typeId;
    renderProductValueFields(pricing);
  }

  function renderProductValueFields(productPrice) {
    const type = pricingType(productPrice.typeId);
    if (!type) {
      els.pricingValueFields.innerHTML = '<div class="bulk-price-empty">Aktif fiyat tipi bulunamadı.</div>';
      return;
    }
    els.pricingValueFields.innerHTML = type.options.map((option) => {
      const record = productPrice.values[option.id] || { price: "", active: true };
      return `
        <label class="pricing-value-field">
          <span class="pricing-value-field__head"><strong>${escapeHTML(option.label)}</strong><small>${escapeHTML(option.unit || "₺")}</small></span>
          <input type="number" min="0" step="0.01" inputmode="decimal" value="${escapeAttribute(priceInputValue(record.price))}" data-pricing-option-id="${escapeAttribute(option.id)}" aria-label="${escapeAttribute(option.label)} fiyatı">
          <label class="pricing-value-field__toggle"><input type="checkbox" data-pricing-option-active="${escapeAttribute(option.id)}" ${record.active === false ? "" : "checked"}> QR menüde aktif</label>
        </label>`;
    }).join("");
  }

  function changeProductPricingType(typeId) {
    const product = selectedProduct();
    const type = pricingType(typeId);
    if (!product || !type) return;
    const previous = productPricing(product);
    product.pricing = {
      typeId: type.id,
      values: Object.fromEntries(type.options.map((option) => [option.id, previous.typeId === type.id && previous.values[option.id]
        ? previous.values[option.id]
        : { price: "", active: true }]))
    };
    state.formProductId = product.id;
    state.formTypeId = type.id;
    populateTypeSelect(els.priceMode, type.id);
    renderProductValueFields(product.pricing);
    writeCompatibilityPricing(product, type, product.pricing.values);
    bridge().markMenuDirty("Ürün fiyat tipi kaydedilmedi");
    if (window.TahmisciLivePreview) window.TahmisciLivePreview.notifyDraft();
  }

  function writeProductFromForm(product) {
    if (!product || !els.priceMode || !els.pricingValueFields) return false;
    const type = pricingType(els.priceMode.value);
    if (!type) return false;
    const values = {};
    type.options.forEach((option) => {
      const input = els.pricingValueFields.querySelector(`[data-pricing-option-id="${CSS.escape(option.id)}"]`);
      const active = els.pricingValueFields.querySelector(`[data-pricing-option-active="${CSS.escape(option.id)}"]`);
      values[option.id] = {
        price: input && input.value !== "" ? Number(input.value) : "",
        active: active ? active.checked : true
      };
    });
    product.pricing = { typeId: type.id, values };
    writeCompatibilityPricing(product, type, values);
    return true;
  }

  function writeCompatibilityPricing(product, type, values) {
    const optionPrice = (id) => values[id] && values[id].price !== "" ? values[id].price : "";
    product.variants = type.options.filter((option) => values[option.id] && values[option.id].active !== false)
      .map((option) => ({ label: option.label, price: optionPrice(option.id) }));
    if (type.id === "size") {
      product.priceMode = "sizes";
      product.prices = { standard: "", k: optionPrice("small"), o: optionPrice("medium"), b: optionPrice("large"), single: "", double: "" };
    } else if (type.id === "shot") {
      product.priceMode = "singleDouble";
      product.prices = { standard: "", k: "", o: "", b: "", single: optionPrice("single"), double: optionPrice("double") };
    } else {
      product.priceMode = "standard";
      const first = type.options.find((option) => values[option.id] && values[option.id].active !== false && hasPrice(values[option.id].price));
      product.prices = { standard: first ? values[first.id].price : "", k: "", o: "", b: "", single: "", double: "" };
    }
  }

  function productPricing(product) {
    if (!product) return { typeId: activeTypes()[0] && activeTypes()[0].id || "standard", values: {} };
    const direct = product.pricing && typeof product.pricing === "object" ? product.pricing : null;
    if (direct && pricingType(direct.typeId)) {
      const values = {};
      Object.entries(direct.values || {}).forEach(([id, value]) => {
        values[id] = normalizePriceRecord(value);
      });
      return { typeId: direct.typeId, values };
    }
    const mode = product.priceMode === "sizes" ? "size" : product.priceMode === "singleDouble" ? "shot" : "standard";
    const prices = product.prices || {};
    if (mode === "size") return { typeId: "size", values: {
      small: { price: priceValue(prices.k), active: true },
      medium: { price: priceValue(prices.o), active: true },
      large: { price: priceValue(prices.b), active: true }
    } };
    if (mode === "shot") return { typeId: "shot", values: {
      single: { price: priceValue(prices.single), active: true },
      double: { price: priceValue(prices.double), active: true }
    } };
    return { typeId: "standard", values: { standard: { price: priceValue(prices.standard), active: true } } };
  }

  function openModal(typeId) {
    const editing = state.pricing.types.find((type) => type.id === typeId) || null;
    state.editingTypeId = editing ? editing.id : "";
    els.priceTypeForm.reset();
    els.priceTypeOptionList.innerHTML = "";
    els.priceTypeName.value = editing ? editing.name : "";
    els.priceTypeActive.checked = editing ? editing.active !== false : true;
    ensureOptionRows(editing ? editing.options.length : 2);
    if (editing) {
      optionRows().forEach((row, index) => {
        const option = editing.options[index];
        row.dataset.optionId = option.id;
        row.querySelector("[data-option-label]").value = option.label;
        row.querySelector("[data-option-value]").value = option.value == null ? "" : String(option.value);
        row.querySelector("[data-option-unit]").value = option.unit || "";
        row.querySelector("[data-option-order]").value = String(option.order);
        row.querySelector("[data-option-active]").value = option.active === false ? "false" : "true";
      });
    }
    const title = document.getElementById("priceTypeTitle");
    if (title) title.textContent = editing ? "Fiyat Tipini Düzenle" : "Yeni Fiyat Tipi";
    renderExistingTypes();
    showModalMessage("");
    els.priceTypeModal.hidden = false;
    syncPricingModalLock();
    window.setTimeout(() => els.priceTypeName.focus(), 0);
  }

  function closeModal() {
    if (state.busy) return;
    els.priceTypeModal.hidden = true;
    state.editingTypeId = "";
    syncPricingModalLock();
  }

  function syncPricingModalLock() {
    const open = Boolean(els.priceTypeModal && !els.priceTypeModal.hidden);
    document.documentElement.classList.toggle("is-pricing-modal-open", open);
  }

  function renderPricingRevision() {
    if (!els.bulkPriceRevisionStatus) return;
    els.bulkPriceRevisionStatus.textContent = state.loaded ? `Güncel · Revizyon ${state.revision}` : "Fiyat verisi yükleniyor";
    els.bulkPriceRevisionStatus.classList.toggle("is-ready", state.loaded);
  }

  function optionRows() {
    return Array.from(els.priceTypeOptionList.querySelectorAll(".pricing-type-option-row"));
  }

  function ensureOptionRows(count) {
    const safeCount = clamp(Number(count || 1), 1, 20);
    while (optionRows().length < safeCount) appendOptionRow();
    while (optionRows().length > safeCount) optionRows().pop().remove();
    normalizeOptionRows();
  }

  function appendOptionRow() {
    const index = optionRows().length;
    const row = document.createElement("div");
    row.className = "pricing-type-option-row";
    row.innerHTML = `
      <label><span>Seçenek adı</span><input type="text" maxlength="60" data-option-label placeholder="Örn. ${index ? "250 gr" : "130 gr"}" required></label>
      <label><span>Sayısal değer</span><input type="number" min="0" step="0.01" data-option-value placeholder="${index ? "250" : "130"}"></label>
      <label><span>Birim</span><input type="text" maxlength="12" data-option-unit placeholder="gr"></label>
      <label><span>Sıra</span><input type="number" min="0" step="1" value="${index}" data-option-order></label>
      <label><span>Durum</span><select data-option-active><option value="true">Aktif</option><option value="false">Pasif</option></select></label>
      <button class="ui-button ui-button--danger ui-button--icon ui-button--sm" type="button" data-remove-pricing-option aria-label="Seçeneği kaldır">×</button>`;
    els.priceTypeOptionList.appendChild(row);
  }

  function normalizeOptionRows() {
    optionRows().forEach((row, index) => {
      row.dataset.optionIndex = String(index);
      const order = row.querySelector("[data-option-order]");
      if (order && order.value === "") order.value = String(index);
    });
    els.priceTypeOptionCount.value = String(optionRows().length);
  }

  function savePriceType(event) {
    event.preventDefault();
    if (state.busy) return Promise.resolve(operationResult("skipped", "busy"));
    return runPricingOperation("type-save", els.savePriceTypeButton, () => executeSavePriceType(event));
  }

  async function executeSavePriceType(event) {
    event.preventDefault();
    if (state.busy) return operationResult("skipped", "busy");
    const name = String(els.priceTypeName.value || "").trim();
    const rows = optionRows().map((row, index) => ({
      label: String(row.querySelector("[data-option-label]").value || "").trim(),
      value: optionalNumber(row.querySelector("[data-option-value]").value),
      unit: String(row.querySelector("[data-option-unit]").value || "").trim(),
      order: finiteNumber(row.querySelector("[data-option-order]").value, index),
      active: row.querySelector("[data-option-active]").value !== "false"
    }));
    const validation = validateNewType(name, rows);
    if (validation) {
      showModalMessage(validation);
      return operationResult("skipped", "validation");
    }
    const editing = state.pricing.types.find((type) => type.id === state.editingTypeId) || null;
    const typeId = editing ? editing.id : uniqueId(slugify(name), state.pricing.types.map((type) => type.id));
    const usedOptionIds = [];
    const type = {
      id: typeId,
      name,
      active: els.priceTypeActive.checked,
      order: editing ? editing.order : state.pricing.types.length,
      options: rows.map((row, index) => {
        const existingId = optionRows()[index] && safeId(optionRows()[index].dataset.optionId);
        const id = existingId || uniqueId(slugify(row.label), usedOptionIds);
        usedOptionIds.push(id);
        return Object.assign({ id }, row, { order: finiteNumber(row.order, index) });
      })
    };
    setModalBusy(true);
    showModalMessage("");
    try {
      const idempotencyKey = requestId();
      const result = await bridge().backendRequest("/api/admin/pricing/types", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: { requestId: idempotencyKey, expectedRevision: state.revision, type }
      });
      state.pricing = normalizePricing(result.pricing || { ...state.pricing, types: state.pricing.types.concat(type) });
      state.revision = finiteRevision(result.revision, state.revision + 1);
      if (result.publishRevision != null) bridge().setPublishRevision(result.publishRevision);
      bridge().setPricing(state.pricing);
      renderPricingRevision();
      state.formProductId = "";
      const assignCreatedType = !editing && type.active !== false;
      closeModalAfterBusy();
      syncFromAdmin();
      if (assignCreatedType) {
        els.priceMode.value = type.id;
        changeProductPricingType(type.id);
      }
      loadPricingHistory(true);
    } catch (error) {
      showModalMessage(error.message || "Fiyat tipi kaydedilemedi.");
      setModalBusy(false);
      throw error;
    }
  }

  function validateNewType(name, rows) {
    if (!name) return "Fiyat tipi adı zorunludur.";
    if (state.pricing.types.some((type) => type.id !== state.editingTypeId && normalizeText(type.name) === normalizeText(name))) return "Bu adla bir fiyat tipi zaten var.";
    if (!rows.length) return "En az bir fiyat seçeneği gereklidir.";
    if (rows.some((row) => !row.label)) return "Bütün seçenek adlarını doldurun.";
    const names = rows.map((row) => normalizeText(row.label));
    if (new Set(names).size !== names.length) return "Aynı seçenek adı birden fazla kullanılamaz.";
    return "";
  }

  function renderExistingTypes() {
    if (!els.priceTypeExistingList) return;
    els.priceTypeExistingList.innerHTML = state.pricing.types.map((type) => {
      const activeOptions = type.options.filter((option) => option.active !== false).length;
      return `
        <article class="pricing-existing-type${type.active === false ? " is-archived" : ""}">
          <div class="pricing-existing-type__head">
            <div><strong>${escapeHTML(type.name)}</strong><small>${activeOptions}/${type.options.length} aktif seçenek</small></div>
            <span class="ui-badge ${type.active === false ? "is-blocked" : "is-ready"}">${type.active === false ? "Arşivli" : "Aktif"}</span>
          </div>
          <div class="pricing-existing-type__options">${type.options.map((option) => `
            <span class="${option.active === false ? "is-passive" : ""}">${escapeHTML(option.label)}${option.unit ? ` · ${escapeHTML(option.unit)}` : ""}</span>`).join("")}
          </div>
          <div class="pricing-existing-type__actions">
            <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-edit-pricing-type="${escapeAttribute(type.id)}">Düzenle</button>
            <button class="ui-button ui-button--danger ui-button--sm" type="button" data-delete-pricing-type="${escapeAttribute(type.id)}" aria-label="${escapeAttribute(type.name)} tipini sil veya arşivle">Sil / Arşivle</button>
          </div>
        </article>`;
    }).join("");
  }

  function deletePricingType(typeId, button) {
    if (state.busy) return Promise.resolve(operationResult("skipped", "busy"));
    return runPricingOperation(`type-delete:${typeId}`, button, () => executeDeletePricingType(typeId));
  }

  async function executeDeletePricingType(typeId) {
    if (state.busy) return operationResult("skipped", "busy");
    const type = state.pricing.types.find((item) => item.id === typeId);
    if (!type) return operationResult("skipped", "missing-type");
    if (!await window.TahmisciAdminDialogs.confirm(`“${type.name}” fiyat tipi silinecek veya kullanımdaysa arşivlenecek.`, { title: "Fiyat tipini sil", confirmLabel: "Sil / Arşivle", danger: true })) {
      return operationResult("cancelled", "user-cancelled");
    }
    const idempotencyKey = requestId();
    setModalBusy(true);
    showModalMessage("");
    try {
      const result = await bridge().backendRequest(`/api/admin/pricing/types/${encodeURIComponent(typeId)}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": idempotencyKey },
        body: { requestId: idempotencyKey, expectedRevision: state.revision }
      });
      state.pricing = normalizePricing(result.pricing);
      state.revision = finiteRevision(result.revision, state.revision + 1);
      if (result.publishRevision != null) bridge().setPublishRevision(result.publishRevision);
      bridge().setPricing(state.pricing);
      renderPricingRevision();
      renderExistingTypes();
      state.formProductId = "";
      syncFromAdmin();
      showModalMessage(result.action === "archived" ? "Kullanımdaki fiyat tipi arşivlendi." : "Fiyat tipi silindi.");
      loadPricingHistory(true);
    } catch (error) {
      showModalMessage(error.message || "Fiyat tipi silinemedi.");
      throw error;
    } finally {
      setModalBusy(false);
    }
  }

  function setModalBusy(busy) {
    state.busy = busy;
    els.savePriceTypeButton.disabled = busy;
    els.savePriceTypeButton.setAttribute("aria-busy", String(busy));
    els.savePriceTypeButton.textContent = busy ? "Kaydediliyor…" : "Fiyat Tipini Kaydet";
  }

  function closeModalAfterBusy() {
    setModalBusy(false);
    closeModal();
  }

  function showModalMessage(message) {
    els.priceTypeMessage.textContent = message || "";
    els.priceTypeMessage.hidden = !message;
  }

  async function loadPricingHistory(force) {
    if (!els.pricingHistoryList || state.historyBusy) return;
    state.historyBusy = true;
    if (force) {
      state.historyMessage = "";
      state.historyMessageKind = "";
    }
    renderPricingHistory();
    try {
      const result = await bridge().backendRequest("/api/admin/pricing/history?limit=50");
      const records = result && (result.history || result.operations || result.items || result.records);
      state.history = Array.isArray(records) ? records : [];
      state.historyLoaded = true;
      if (result && result.revision != null) state.revision = finiteRevision(result.revision, state.revision);
    } catch (error) {
      state.historyMessage = error.message || "Fiyat işlem geçmişi yüklenemedi.";
      state.historyMessageKind = "error";
    } finally {
      state.historyBusy = false;
      renderPricingHistory();
      renderPricingRevision();
    }
  }

  function renderPricingHistory() {
    if (!els.pricingHistoryList) return;
    if (els.refreshPricingHistory) {
      els.refreshPricingHistory.disabled = state.historyBusy;
      els.refreshPricingHistory.setAttribute("aria-busy", String(state.historyBusy));
      els.refreshPricingHistory.textContent = state.historyBusy ? "Yükleniyor…" : "Geçmişi Yenile";
    }
    if (els.pricingHistoryMessage) {
      els.pricingHistoryMessage.hidden = !state.historyMessage;
      els.pricingHistoryMessage.textContent = state.historyMessage || "";
      els.pricingHistoryMessage.className = `pricing-history-message${state.historyMessageKind ? ` is-${state.historyMessageKind}` : ""}`;
    }
    if (state.historyBusy && !state.historyLoaded) {
      els.pricingHistoryList.innerHTML = '<div class="pricing-history-empty">İşlem geçmişi yükleniyor…</div>';
      return;
    }
    if (!state.history.length) {
      els.pricingHistoryList.innerHTML = '<div class="pricing-history-empty">Henüz kayıtlı bir fiyat işlemi bulunmuyor.</div>';
      return;
    }
    els.pricingHistoryList.innerHTML = state.history.map((record) => {
      const id = String(record.id || record.operationId || "");
      const kind = String(record.kind || record.type || "pricing_operation");
      const changed = finiteNumber(record.changedRowCount, Array.isArray(record.changedRows) ? record.changedRows.length : finiteNumber(record.changeCount, 0));
      const affected = finiteNumber(record.affectedProductCount, finiteNumber(record.productCount, uniqueHistoryProductCount(record)));
      const undone = Boolean(record.undoneAt || record.revertedAt || record.status === "undone" || record.status === "reverted");
      const undoable = !undone && Boolean(record.canUndo === true || record.undoAvailable === true || record.undoable === true);
      return `
        <article class="pricing-history-item${undone ? " is-undone" : ""}">
          <div class="pricing-history-item__icon" aria-hidden="true">${escapeHTML(historyKindIcon(kind))}</div>
          <div class="pricing-history-item__body">
            <div class="pricing-history-item__title">
              <strong>${escapeHTML(historyKindLabel(kind))}</strong>
              <span class="ui-badge ${undone ? "is-blocked" : "is-ready"}">${undone ? "Geri alındı" : "Tamamlandı"}</span>
            </div>
            <p>${affected} ürün · ${changed} fiyat alanı${record.filename ? ` · ${escapeHTML(record.filename)}` : ""}</p>
            <small>${escapeHTML(formatDateTime(record.createdAt || record.updatedAt))} · ${escapeHTML(id || "İşlem kimliği yok")}</small>
          </div>
          <div class="pricing-history-item__actions">
            ${undoable ? `<button class="ui-button ui-button--secondary ui-button--sm" type="button" data-undo-pricing-operation="${escapeAttribute(id)}" ${state.historyBusy ? "disabled" : ""}>Geri Al</button>` : ""}
          </div>
        </article>`;
    }).join("");
  }

  function uniqueHistoryProductCount(record) {
    const rows = Array.isArray(record && record.changedRows) ? record.changedRows : [];
    return new Set(rows.map((row) => String(row && row.productId || "")).filter(Boolean)).size;
  }

  function historyKindLabel(kind) {
    return ({
      pricing_bulk_update: "Toplu fiyat güncellemesi",
      pricing_excel_import: "Excel fiyat aktarımı",
      pricing_type_created: "Fiyat tipi oluşturuldu",
      pricing_type_updated: "Fiyat tipi güncellendi",
      pricing_type_archived: "Fiyat tipi arşivlendi",
      pricing_type_deleted: "Fiyat tipi silindi",
      pricing_operation_undone: "Fiyat işlemi geri alındı"
    })[kind] || "Fiyat işlemi";
  }

  function historyKindIcon(kind) {
    if (kind.includes("excel")) return "XLS";
    if (kind.includes("type")) return "TİP";
    if (kind.includes("undo")) return "↶";
    return "₺";
  }

  function formatDateTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Tarih bilinmiyor";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function undoPricingOperation(operationId, button) {
    if (!operationId || state.historyBusy || state.busy) {
      return Promise.resolve(operationResult("skipped", "busy"));
    }
    return runPricingOperation(`history-undo:${operationId}`, button, () => executeUndoPricingOperation(operationId), {
      onSettled: renderPricingHistory
    });
  }

  async function executeUndoPricingOperation(operationId) {
    if (state.historyBusy || state.busy) return operationResult("skipped", "busy");
    if (typeof bridge().hasPendingMenuChanges === "function" && bridge().hasPendingMenuChanges()) {
      state.historyMessage = "Geri almadan önce kaydedilmemiş menü değişikliklerini yayınlayın.";
      state.historyMessageKind = "error";
      renderPricingHistory();
      return operationResult("skipped", "pending-menu-changes");
    }
    if (!await window.TahmisciAdminDialogs.confirm("Bu fiyat işlemi ters kayıt oluşturarak atomik biçimde geri alınacak.", { title: "Fiyat işlemini geri al", confirmLabel: "Geri al", danger: true })) {
      return operationResult("cancelled", "user-cancelled");
    }
    const id = requestId();
    state.historyBusy = true;
    state.historyMessage = "";
    state.historyMessageKind = "";
    renderPricingHistory();
    try {
      const result = await bridge().backendRequest(`/api/admin/pricing/history/${encodeURIComponent(operationId)}/undo`, {
        method: "POST",
        headers: { "Idempotency-Key": id },
        body: { requestId: id, expectedRevision: state.revision }
      });
      state.revision = finiteRevision(result.revision, state.revision + 1);
      if (result.publishRevision != null) bridge().setPublishRevision(result.publishRevision);
      const refreshed = await bridge().backendRequest("/api/menu");
      if (refreshed.pricing) state.pricing = normalizePricing(refreshed.pricing);
      if (refreshed.menuState) bridge().replaceMenuState(refreshed.menuState);
      if (refreshed.publishRevision != null) bridge().setPublishRevision(refreshed.publishRevision);
      bridge().setPricing(state.pricing);
      state.formProductId = "";
      state.historyMessage = `İşlem geri alındı${result.operationId ? ` · ${result.operationId}` : ""}.`;
      state.historyMessageKind = "success";
      state.bulkMessage = state.historyMessage;
      state.bulkMessageKind = "success";
      syncFromAdmin();
    } catch (error) {
      state.historyMessage = error.message || "Fiyat işlemi geri alınamadı.";
      state.historyMessageKind = "error";
      throw error;
    } finally {
      state.historyBusy = false;
      renderPricingHistory();
    }
    await loadPricingHistory(true);
  }

  function renderBulk() {
    if (!els.bulkPricingType || !bridge() || !bridge().snapshot().menuState) return;
    populateBulkFilters();
    const entries = filteredBulkEntries();
    const affected = affectedBulkEntries(entries);
    const value = Number(els.bulkPriceValue.value);
    const validValue = els.bulkPriceValue.value !== "" && Number.isFinite(value) && value >= 0;
    const option = selectedBulkOption();
    const operation = els.bulkPricingOperation.value || "set";
    els.bulkPriceValueLabel.textContent = operation.includes("percent") ? "Oran (%)" : operation === "set" ? "Yeni fiyat (₺)" : "Tutar (₺)";
    els.bulkPriceSelectedCount.textContent = `${affected.length} ürün · ${affected.length} fiyat alanı`;
    els.bulkPriceProductList.innerHTML = renderBulkTable(entries, value, validValue);
    els.bulkPriceApply.disabled = state.busy || !option || !affected.length || !validValue || (operation !== "set" && value <= 0);
    els.bulkPriceApply.setAttribute("aria-busy", String(state.busy));
    els.bulkPriceApply.textContent = state.busy ? "Atomik güncelleme uygulanıyor…" : "Onayla ve Atomik Uygula";
    renderBulkSummary(affected, value, validValue);
    renderPricingRevision();
  }

  function populateBulkFilters() {
    const menu = bridge().snapshot().menuState;
    const categoryValue = els.bulkPriceCategory.value || "all";
    els.bulkPriceCategory.innerHTML = '<option value="all">Tüm kategoriler</option>'
      + (menu.categories || []).map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>`).join("");
    els.bulkPriceCategory.value = categoryValue === "all" || (menu.categories || []).some((category) => category.id === categoryValue) ? categoryValue : "all";
    const typeValue = els.bulkPricingType.value || activeTypes()[0] && activeTypes()[0].id;
    populateTypeSelect(els.bulkPricingType, typeValue);
    const type = pricingType(els.bulkPricingType.value);
    const options = type ? type.options.filter((option) => option.active !== false) : [];
    const optionValue = els.bulkPricingOption.value || options[0] && options[0].id;
    els.bulkPricingOption.innerHTML = options.map((option) => `<option value="${escapeAttribute(option.id)}">${escapeHTML(option.label)}${option.unit ? ` · ${escapeHTML(option.unit)}` : ""}</option>`).join("");
    els.bulkPricingOption.value = options.some((option) => option.id === optionValue) ? optionValue : options[0] && options[0].id || "";
  }

  function flatProducts() {
    const menu = bridge().snapshot().menuState;
    return (menu.categories || []).flatMap((category) => (category.products || []).map((product) => ({ category, product })));
  }

  function filteredBulkEntries() {
    const categoryId = els.bulkPriceCategory.value || "all";
    const typeId = els.bulkPricingType.value;
    const optionId = els.bulkPricingOption.value;
    const query = normalizeText(els.bulkPriceSearch.value || "");
    return flatProducts().map((entry) => ({ ...entry, priceModel: productPricing(entry.product) })).filter((entry) => {
      if (categoryId !== "all" && entry.category.id !== categoryId) return false;
      if (entry.priceModel.typeId !== typeId) return false;
      const record = entry.priceModel.values[optionId];
      if (!record || record.active === false || !hasPrice(record.price)) return false;
      return !query || normalizeText(`${entry.product.name} ${entry.category.name}`).includes(query);
    });
  }

  function affectedBulkEntries(entries) {
    const scope = document.querySelector('input[name="bulkPricingScope"]:checked')?.value || "filtered";
    return scope === "selected" ? entries.filter((entry) => state.selectedIds.has(entry.product.id)) : entries;
  }

  function selectedBulkOption() {
    const type = pricingType(els.bulkPricingType.value);
    return type && type.options.find((option) => option.id === els.bulkPricingOption.value);
  }

  function renderBulkTable(entries, value, validValue) {
    if (!entries.length) return '<div class="bulk-price-empty">Bu fiyat tipi ve seçenekte fiyatı bulunan ürün yok.</div>';
    const option = selectedBulkOption();
    const type = pricingType(els.bulkPricingType.value);
    const allSelected = entries.every((entry) => state.selectedIds.has(entry.product.id));
    return `<div class="bulk-pricing-table-wrap"><table class="bulk-pricing-table">
      <thead><tr><th><input type="checkbox" data-bulk-pricing-select-all ${allSelected ? "checked" : ""} aria-label="Tümünü seç"></th><th>Ürün</th><th>Kategori</th><th>Fiyat tipi</th><th>Seçenek</th><th>Eski fiyat</th><th>Yeni fiyat</th><th>Değişim</th><th>Uyarı</th></tr></thead>
      <tbody>${entries.map((entry) => {
        const oldPrice = Number(entry.priceModel.values[option.id].price);
        const nextPrice = validValue ? calculatePrice(oldPrice, els.bulkPricingOperation.value, value, els.bulkPricingRounding.value) : oldPrice;
        const delta = nextPrice - oldPrice;
        const warning = nextPrice === 0 ? "0 ₺ fiyat" : nextPrice < 0 ? "Geçersiz" : "";
        return `<tr>
          <td><input type="checkbox" data-bulk-pricing-product="${escapeAttribute(entry.product.id)}" ${state.selectedIds.has(entry.product.id) ? "checked" : ""} aria-label="${escapeAttribute(entry.product.name)} ürününü seç"></td>
          <td><strong>${escapeHTML(entry.product.name)}</strong></td><td>${escapeHTML(entry.category.name)}</td><td>${escapeHTML(type.name)}</td><td>${escapeHTML(option.label)}</td>
          <td>${formatMoney(oldPrice)}</td><td>${validValue ? formatMoney(nextPrice) : "—"}</td>
          <td class="bulk-pricing-delta ${delta >= 0 ? "is-positive" : "is-negative"}">${validValue ? `${delta >= 0 ? "+" : ""}${formatMoney(delta)}` : "—"}</td>
          <td class="bulk-pricing-warning">${escapeHTML(warning)}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function renderBulkSummary(affected, value, validValue) {
    els.bulkPriceSummary.classList.toggle("is-success", state.bulkMessageKind === "success");
    els.bulkPriceSummary.classList.toggle("is-error", state.bulkMessageKind === "error");
    if (state.bulkMessage) {
      els.bulkPriceSummary.innerHTML = `<h4>İşlem durumu</h4><p>${escapeHTML(state.bulkMessage)}</p>`;
      return;
    }
    if (!affected.length) {
      els.bulkPriceSummary.innerHTML = "<h4>8 · Eski / yeni fiyat önizlemesi</h4><p>Filtreye uygun ürün veya seçili kayıt bulunmuyor.</p>";
      return;
    }
    if (!validValue) {
      els.bulkPriceSummary.innerHTML = `<h4>8 · Eski / yeni fiyat önizlemesi</h4><p>${affected.length} ürün bulundu · işlem değerini girin.</p>`;
      return;
    }
    const optionId = els.bulkPricingOption.value;
    const totals = affected.reduce((result, entry) => {
      const oldPrice = Number(entry.priceModel.values[optionId].price);
      const nextPrice = calculatePrice(oldPrice, els.bulkPricingOperation.value, value, els.bulkPricingRounding.value);
      result.old += oldPrice;
      result.next += nextPrice;
      return result;
    }, { old: 0, next: 0 });
    els.bulkPriceSummary.innerHTML = `<h4>8 · Onay özeti</h4><dl>
      <div><dt>Etkilenecek ürün</dt><dd>${affected.length}</dd></div><div><dt>Fiyat alanı</dt><dd>${affected.length}</dd></div>
      <div><dt>Toplam eski</dt><dd>${formatMoney(totals.old)}</dd></div><div><dt>Toplam yeni</dt><dd>${formatMoney(totals.next)}</dd></div>
    </dl>`;
  }

  function applyBulkUpdate() {
    if (state.busy) return Promise.resolve(operationResult("skipped", "busy"));
    return runPricingOperation("bulk-apply", els.bulkPriceApply, executeBulkUpdate, {
      onSettled: renderBulk
    });
  }

  async function executeBulkUpdate() {
    if (state.busy) return operationResult("skipped", "busy");
    const entries = affectedBulkEntries(filteredBulkEntries());
    const value = Number(els.bulkPriceValue.value);
    const operation = els.bulkPricingOperation.value;
    if (!entries.length || !Number.isFinite(value) || value < 0 || (operation !== "set" && value <= 0)) {
      return operationResult("skipped", "validation");
    }
    if (typeof bridge().hasPendingMenuChanges === "function" && bridge().hasPendingMenuChanges()) {
      state.bulkMessage = "Veri çakışmasını önlemek için önce kaydedilmemiş menü değişikliklerini yayınlayın.";
      state.bulkMessageKind = "error";
      renderBulk();
      return operationResult("skipped", "pending-menu-changes");
    }
    const option = selectedBulkOption();
    const confirmed = await window.TahmisciAdminDialogs.confirm(`${entries.length} ürünün “${option.label}” fiyatı atomik olarak güncellenecek.`, { title: "Toplu fiyat güncelle", confirmLabel: "Güncelle" });
    if (!confirmed) return operationResult("cancelled", "user-cancelled");
    const id = requestId();
    state.busy = true;
    state.bulkMessage = "";
    renderBulk();
    try {
      const result = await bridge().backendRequest("/api/admin/pricing/bulk-update", {
        method: "POST",
        headers: { "Idempotency-Key": id },
        body: {
          requestId: id,
          expectedRevision: state.revision,
          typeId: els.bulkPricingType.value,
          optionIds: [option.id],
          productIds: entries.map((entry) => entry.product.id),
          operation,
          value,
          rounding: els.bulkPricingRounding.value === "none" ? null : Number(els.bulkPricingRounding.value)
        }
      });
      state.revision = finiteRevision(result.revision, state.revision + 1);
      if (result.publishRevision != null) bridge().setPublishRevision(result.publishRevision);
      const refreshed = await bridge().backendRequest("/api/menu");
      if (refreshed.pricing) state.pricing = normalizePricing(refreshed.pricing);
      if (refreshed.menuState) bridge().replaceMenuState(refreshed.menuState);
      if (refreshed.publishRevision != null) bridge().setPublishRevision(refreshed.publishRevision);
      bridge().setPricing(state.pricing);
      state.bulkMessage = `${finiteNumber(result.changedRowCount, entries.length)} fiyat alanı, ${finiteNumber(result.affectedProductCount, entries.length)} ürün üzerinde atomik olarak güncellendi${result.operationId ? ` · İşlem ID: ${result.operationId}` : ""}.`;
      state.bulkMessageKind = "success";
      state.selectedIds.clear();
      loadPricingHistory(true);
    } catch (error) {
      state.bulkMessage = error.message || "Toplu fiyat güncellemesi uygulanamadı.";
      state.bulkMessageKind = "error";
      throw error;
    } finally {
      state.busy = false;
      renderBulk();
    }
  }

  function calculatePrice(current, operation, value, rounding) {
    let next = current;
    if (operation === "set") next = value;
    if (operation === "add") next = current + value;
    if (operation === "subtract") next = current - value;
    if (operation === "increase_percent") next = current * (1 + value / 100);
    if (operation === "decrease_percent") next = current * (1 - value / 100);
    next = Math.max(0, next);
    const step = rounding && rounding !== "none" ? Number(rounding) : 0;
    if (step > 0) next = Math.round(next / step) * step;
    return Math.round((next + Number.EPSILON) * 100) / 100;
  }

  function normalizePriceRecord(value) {
    if (value && typeof value === "object") return { price: priceValue(value.price), active: value.active !== false };
    return { price: priceValue(value), active: true };
  }

  function priceValue(value) {
    if (value === "" || value === null || value === undefined) return "";
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : "";
  }

  function priceInputValue(value) {
    const normalized = priceValue(value);
    return normalized === "" ? "" : String(normalized);
  }

  function hasPrice(value) {
    return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function formatMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(number)} ₺`;
  }

  function optionalNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function finiteRevision(value, fallback) {
    return Math.max(0, Math.trunc(finiteNumber(value, fallback || 0)));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeText(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  function slugify(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pricing";
  }

  function safeId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) ? id : "";
  }

  function uniqueId(base, used) {
    const safeBase = safeId(base) || "pricing";
    let id = safeBase;
    let suffix = 2;
    const set = new Set(used);
    while (set.has(id)) id = `${safeBase}-${suffix++}`;
    return id;
  }

  function requestId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `pricing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#96;");
  }

  const api = {
    syncFromAdmin,
    renderBulk,
    writeProductFromForm,
    pricing() {
      return state.pricing;
    },
    revision() {
      return state.revision;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}());
