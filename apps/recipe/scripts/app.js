// Developer: Uzeyir | System Key: xandar | Source integrity marker
(function () {
  "use strict";

  const BACKEND_URL_KEY = "tahmisci.backend.url";
  const PREVIEW_TOKEN = readPreviewToken();
  const THEME_KEY = "tahmisci.menu.theme";
  const CHANNEL_NAME = "tahmisci-recipe-updates";

  const LEGACY_CATEGORY_NAMES = {
    Demlemeler: "Demlemeler",
    Espresso: "Espresso Bazlılar",
    Matcha: "Matcha Serisi",
    Aromali: "Aromalı Latteler",
    Sicak: "İmza Sıcak",
    Soguk: "İmza Soğuk",
    Hazirlik: "Hazırlık"
  };

  const HOME_GROUPS = [
    {
      id: "hot",
      number: "01",
      title: "SICAKLAR",
      description: "Sıcak kahve ve imza içecek reçeteleri",
      illustration: "/assets/images/recipe-vintage/cezve.svg",
      layout: "large"
    },
    {
      id: "cold",
      number: "02",
      title: "SOĞUKLAR",
      description: "Soğuk kahve ve ferah içecek reçeteleri",
      illustration: "/assets/images/recipe-vintage/cold-glass.svg",
      layout: "large"
    },
    {
      id: "specials",
      number: "03",
      title: "TAHMİSÇİ SPECIALLER",
      description: "Tahmisçi'ye özgü özel servis reçeteleri",
      illustration: "/assets/images/recipe-vintage/barista.svg",
      layout: "large"
    },
    {
      id: "brews",
      number: "04",
      title: "DEMLEMELER",
      description: "Filtre ve nitelikli demleme reçeteleri",
      illustration: "/assets/images/recipe-vintage/pour-over.svg",
      layout: "wide"
    },
    {
      id: "prep",
      number: "05",
      title: "HAZIRLIK",
      description: "Hazırlık ölçüleri ve barista notları",
      illustration: "/assets/images/recipe-vintage/recipe-notes.svg",
      layout: "wide"
    }
  ];

  const state = {
    data: {},
    activeCategory: "all",
    activeGroup: "",
    homeMode: true,
    search: "",
    entries: [],
    suggestions: [],
    channel: null,
    eventSource: null,
    currentModalRecipe: null,
    activeModalPanel: "content",
    baristaName: "Personel",
    accessGranted: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    document.body.classList.toggle("is-personel-embed", isPersonelEmbed());
    state.data = loadRecipes();
    hydrateBaristaName();
    applyStoredTheme();
    bindEvents();
    renderAll();
    setupLiveUpdates();
    await hydrateRecipesFromBackend();
    if (isPersonelEmbed()) {
      state.accessGranted = true;
      applyRecipeAccessState();
    } else if (await verifyBackendSession()) {
      state.accessGranted = true;
      applyRecipeAccessState();
    } else {
      state.accessGranted = false;
      applyRecipeAccessState();
    }
  }

  function cacheElements() {
    [
      "recipeGate", "recipeGateForm", "recipeGatePassword", "recipeGateError",
      "recipeTabs", "recipeHome", "recipeGrid", "recipeEmpty", "recipeSearch", "recipeSuggestions", "recipeModal",
      "recipeModalCategory", "recipeModalTitle", "recipeModalSize", "recipeModalSteps",
      "recipeModalActions", "recipeSectionTitle", "recipeModeIcon", "recipeBaristaName"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    if (els.recipeGateForm) els.recipeGateForm.addEventListener("submit", handleRecipeGateSubmit);
    if (els.recipeHome) els.recipeHome.addEventListener("error", handleHomeIllustrationError, true);
    window.addEventListener("message", handlePreviewDraftMessage);
    applyRecipeAccessState();

    document.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (actionTarget) {
        const action = actionTarget.dataset.action;
        if (action === "theme") toggleTheme();
        if (action === "close-recipe") closeRecipeModal();
        if (action === "recipe-content") renderRecipeModalPanel("content");
        if (action === "recipe-preparation") renderRecipeModalPanel("preparation");
        return;
      }

      const homeCard = event.target.closest("[data-recipe-home-group]");
      if (homeCard) {
        openHomeGroup(homeCard.dataset.recipeHomeGroup);
        return;
      }

      const backButton = event.target.closest("[data-recipe-back-home]");
      if (backButton) {
        state.homeMode = true;
        state.activeGroup = "";
        state.activeCategory = "all";
        state.search = "";
        if (els.recipeSearch) els.recipeSearch.value = "";
        renderAll();
        scrollToRecipeTop();
        return;
      }

      const tab = event.target.closest("[data-recipe-tab]");
      if (tab) {
        state.homeMode = false;
        state.activeCategory = tab.dataset.recipeTab || "all";
        renderAll();
        scrollToRecipeTop();
        return;
      }

      const sizeButton = event.target.closest("[data-recipe-size-index]");
      if (sizeButton) {
        const entry = state.entries[Number(sizeButton.dataset.recipeIndex)];
        const size = entry && entry.sizes[Number(sizeButton.dataset.recipeSizeIndex)];
        openRecipeModal(entry, size);
        hideSuggestions();
        return;
      }

      const card = event.target.closest("[data-recipe-index]");
      if (card) {
        openRecipeModal(state.entries[Number(card.dataset.recipeIndex)]);
        hideSuggestions();
        return;
      }

      const suggestion = event.target.closest("[data-recipe-suggestion]");
      if (suggestion) {
        const entry = state.suggestions[Number(suggestion.dataset.recipeSuggestion)];
        if (!entry) return;
        state.activeGroup = groupIdForCategory(entry.category);
        state.activeCategory = entry.category || "all";
        state.homeMode = false;
        state.search = entry.product;
        if (els.recipeSearch) els.recipeSearch.value = entry.product;
        renderAll();
        hideSuggestions();
        openRecipeModal(entry);
        return;
      }

      if (event.target === els.recipeModal) closeRecipeModal();
      if (els.recipeSuggestions && !event.target.closest(".recipe-search")) hideSuggestions();
    });

    if (els.recipeSearch) {
      els.recipeSearch.addEventListener("input", () => {
        state.search = els.recipeSearch.value.trim();
        renderAll();
        renderSuggestions();
      });
      els.recipeSearch.addEventListener("focus", renderSuggestions);
      els.recipeSearch.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideSuggestions();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeRecipeModal();
        hideSuggestions();
      }
    });
  }

  function handleHomeIllustrationError(event) {
    const image = event.target;
    if (!image || !image.matches || !image.matches(".recipe-home-illustration img")) return;
    image.hidden = true;
    const illustration = image.closest(".recipe-home-illustration");
    if (illustration) illustration.classList.add("is-image-missing");
  }

  function handlePreviewDraftMessage(event) {
    if (event.origin !== window.location.origin) return;
    const payload = event.data;
    if (!payload || payload.type !== "tahmisci:preview-draft" || payload.schemaVersion !== 1) return;
    if (payload.scope !== "recipes" || !isRecipeStatePayload(payload.data)) return;
    state.data = normalizeRecipeData(payload.data);
    ensureActiveSelection();
    renderAll();
  }

  async function handleRecipeGateSubmit(event) {
    event.preventDefault();
    const password = (els.recipeGatePassword && els.recipeGatePassword.value || "").trim();
    const result = await validateRecipePassword(password);

    if (result.ok) {
      state.accessGranted = true;
      if (els.recipeGateError) els.recipeGateError.hidden = true;
      if (els.recipeGatePassword) els.recipeGatePassword.value = "";
      applyRecipeAccessState();
      return;
    }

    if (els.recipeGateError) {
      els.recipeGateError.textContent = result.message || "Şifre hatalı. Lütfen tekrar deneyin.";
      els.recipeGateError.hidden = false;
    }
    if (els.recipeGatePassword) {
      els.recipeGatePassword.value = "";
      els.recipeGatePassword.focus();
    }
  }

  async function validateRecipePassword(password) {
    if (!backendBaseUrl() || !window.fetch) return { ok: false, message: "Backend bağlantısı gerekli." };
    const backendResult = await loginBackend(password);
    if (backendResult.status === "ok") return { ok: true };
    if (backendResult.status === "limited") return { ok: false, message: backendResult.message || "Çok fazla hatalı deneme yapıldı. Lütfen biraz sonra tekrar deneyin." };
    if (backendResult.status === "denied") return { ok: false, message: backendResult.message || "Backend şifresi hatalı." };
    return { ok: false, message: "Backend bağlantısı kurulamadı." };
  }

  async function loginBackend(password) {
    try {
      const response = await fetch(`${backendBaseUrl()}/api/recipe/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) return { status: "denied", message: result.message || "" };
      if (response.status === 429) return { status: "limited", message: result.message || "" };
      if (!response.ok || result.ok === false) return { status: "denied", message: result.message || "" };
      return { status: "ok" };
    } catch (error) {
      return { status: "unavailable" };
    }
  }

  function isPersonelEmbed() {
    return window.location.pathname.startsWith("/personel/recete-embed");
  }

  async function verifyBackendSession() {
    if (!backendBaseUrl() || !window.fetch) return false;
    try {
      // The standalone recipe gate accepts the generic recipe/admin session.
      // /api/recipe/me is intentionally reserved for an identified personnel session.
      const response = await fetch(withPreviewToken(`${backendBaseUrl()}/api/recipes`), {
        credentials: "include"
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  function applyRecipeAccessState() {
    const unlocked = isPersonelEmbed() || state.accessGranted;
    document.body.classList.toggle("recipe-locked", !unlocked);
    if (els.recipeGate) els.recipeGate.hidden = unlocked;
    if (!unlocked && els.recipeGatePassword) window.setTimeout(() => els.recipeGatePassword.focus(), 60);
  }

  function setupLiveUpdates() {
    if ("BroadcastChannel" in window) {
      state.channel = new BroadcastChannel(CHANNEL_NAME);
      state.channel.addEventListener("message", (event) => {
        if (event.data && event.data.type === "recipes-updated") hydrateRecipesFromBackend();
      });
    }

    setupBackendRecipeEvents();
  }

  function loadRecipes() {
    return {};
  }

  async function hydrateRecipesFromBackend() {
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.fetch) return;
    try {
      const result = await backendRequest("/api/recipes");
      if (!isRecipeStatePayload(result.recipeState)) return;
      state.data = normalizeRecipeData(result.recipeState);
      ensureActiveSelection();
      renderAll();
    } catch (error) {}
  }

  function setupBackendRecipeEvents() {
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.EventSource || state.eventSource) return;
    state.eventSource = new EventSource(`${baseUrl}/api/recipes/events`);
    state.eventSource.addEventListener("recipes", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!isRecipeStatePayload(payload.recipeState)) return;
        state.data = normalizeRecipeData(payload.recipeState);
        ensureActiveSelection();
        renderAll();
      } catch (error) {}
    });
  }

  function backendBaseUrl() {
    const queryValue = (() => {
      try {
        return new URLSearchParams(window.location.search).get("backend") || "";
      } catch (error) {
        return "";
      }
    })();
    if (queryValue) safeLocalSet(BACKEND_URL_KEY, queryValue);
    const explicit = window.TAHMISCI_BACKEND_URL || queryValue || safeLocalGet(BACKEND_URL_KEY) || "";
    if (explicit) return String(explicit).replace(/\/+$/, "");
    if (window.location.protocol === "http:" || window.location.protocol === "https:") return window.location.origin;
    return "";
  }

  async function backendRequest(path) {
    const response = await fetch(withPreviewToken(`${backendBaseUrl()}${path}`), {
      credentials: "include"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.message || "Backend isteği başarısız.");
    return result;
  }

  function readPreviewToken() {
    try {
      return new URLSearchParams(window.location.search).get("previewToken") || "";
    } catch (_error) {
      return "";
    }
  }

  function withPreviewToken(value) {
    if (!PREVIEW_TOKEN) return value;
    const url = new URL(value, window.location.origin);
    url.searchParams.set("previewToken", PREVIEW_TOKEN);
    return url.toString();
  }

  function hasRecipeContent(recipeState) {
    if (!recipeState || typeof recipeState !== "object" || Array.isArray(recipeState)) return false;
    return Object.keys(recipeState).some((category) => {
      const products = recipeState[category];
      return products && typeof products === "object" && Object.keys(products).length;
    });
  }

  function isRecipeStatePayload(recipeState) {
    return Boolean(recipeState && typeof recipeState === "object" && !Array.isArray(recipeState));
  }

  function normalizeRecipeData(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    const normalized = {};
    Object.keys(data).forEach((category) => {
      if (isAllCategory(category)) return;
      const products = data[category];
      if (!products || typeof products !== "object") return;
      normalized[category] = {};
      Object.keys(products).forEach((product) => {
        if (!String(product || "").trim()) return;
        const sizes = products[product];
        if (!sizes || typeof sizes !== "object") return;
        normalized[category][product] = {};
        Object.keys(sizes).forEach((size) => {
          normalized[category][product][size] = normalizeRecipeItem(sizes[size]);
        });
      });
      if (!Object.keys(normalized[category]).length) delete normalized[category];
    });
    return normalized;
  }

  function renderAll() {
    renderBaristaName();
    if (!hasRecipeContent(state.data)) {
      if (els.recipeTabs) els.recipeTabs.hidden = true;
      if (els.recipeHome) {
        els.recipeHome.hidden = true;
        els.recipeHome.innerHTML = "";
      }
      if (els.recipeGrid) {
        els.recipeGrid.hidden = true;
        els.recipeGrid.innerHTML = "";
      }
      if (els.recipeEmpty) {
        els.recipeEmpty.textContent = "Henüz veri aktarılmadı.";
        els.recipeEmpty.hidden = false;
      }
      return;
    }
    const hasSearch = Boolean(normalizeText(state.search));
    if (state.homeMode && !hasSearch) {
      if (els.recipeTabs) els.recipeTabs.hidden = true;
      if (els.recipeGrid) {
        els.recipeGrid.hidden = true;
        els.recipeGrid.innerHTML = "";
      }
      if (els.recipeEmpty) els.recipeEmpty.hidden = true;
      renderHome();
      return;
    }

    if (els.recipeHome) {
      els.recipeHome.hidden = true;
      els.recipeHome.innerHTML = "";
    }
    if (els.recipeTabs) els.recipeTabs.hidden = false;
    if (els.recipeGrid) els.recipeGrid.hidden = false;
    renderTabs();
    renderRecipes();
  }

  function renderHome() {
    if (!els.recipeHome) return;
    els.recipeHome.hidden = false;
    els.recipeHome.innerHTML = HOME_GROUPS.map((group) => {
      const categories = categoriesForHomeGroup(group.id);
      const entries = entriesForCategories(categories);
      const chips = categories.slice(0, group.layout === "wide" ? 4 : 3);
      const hiddenCount = Math.max(0, categories.length - chips.length);
      return `
        <button class="recipe-home-card is-${group.layout}" type="button" data-recipe-home-group="${group.id}" ${entries.length ? "" : "disabled"}>
          <span class="recipe-home-illustration" aria-hidden="true">
            <span class="recipe-home-number">${escapeHTML(group.number)}</span>
            <img src="${escapeAttribute(group.illustration)}" alt="" loading="eager" decoding="async">
          </span>
          <span class="recipe-home-content">
            <span class="recipe-home-kicker">REÇETE GRUBU</span>
            <strong class="recipe-home-title">${escapeHTML(group.title)}</strong>
            <em class="recipe-home-desc">${escapeHTML(group.description)}</em>
            <small class="recipe-home-meta">${categories.length} kategori · ${entries.length} ürün</small>
            <span class="recipe-home-chips">
              ${chips.map((category) => `<b>${escapeHTML(displayCategory(category))}</b>`).join("")}
              ${hiddenCount ? `<b>+${hiddenCount}</b>` : ""}
            </span>
          </span>
          <span class="recipe-home-open">Kategoriyi Aç <span aria-hidden="true">→</span></span>
        </button>
      `;
    }).join("");
  }

  function renderTabs() {
    if (!els.recipeTabs) return;
    const categories = state.activeGroup ? categoriesForHomeGroup(state.activeGroup) : recipeCategoryNames();
    const allCount = entriesForCategories(categories).length;
    els.recipeTabs.innerHTML = "";
    els.recipeTabs.appendChild(makeBackTab());
    els.recipeTabs.appendChild(makeTab(state.activeGroup ? homeGroupTitle(state.activeGroup) : "Tümü", "all", allCount));
    categories.forEach((category) => {
      const count = groupedRecipes(category).length;
      if (count === 0) return;
      els.recipeTabs.appendChild(makeTab(displayCategory(category), category, count));
    });
  }

  function recipeCategoryNames() {
    return Object.keys(state.data || {}).filter((category) => !isAllCategory(category));
  }

  function makeBackTab() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recipe-tab recipe-back-tab";
    button.dataset.recipeBackHome = "true";
    button.innerHTML = "ANA KATEGORİLER";
    return button;
  }

  function makeTab(label, id, count) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `recipe-tab${state.activeCategory === id ? " active" : ""}`;
    button.dataset.recipeTab = id;
    button.innerHTML = `${escapeHTML(label)} <small>${count}</small>`;
    return button;
  }

  function renderRecipes() {
    const q = normalizeText(state.search);
    state.entries = groupedRecipes(state.activeCategory)
      .filter((entry) => !q || normalizeText(entry.searchBlob).includes(q));

    if (!els.recipeGrid || !els.recipeEmpty) return;
    els.recipeGrid.innerHTML = "";
    els.recipeEmpty.textContent = "Bu aramada reçete bulunamadı.";
    els.recipeEmpty.hidden = state.entries.length !== 0;
    state.entries.forEach((entry, index) => els.recipeGrid.appendChild(buildRecipeCard(entry, index)));
  }

  function buildRecipeCard(entry, index) {
    const card = document.createElement("article");
    card.className = "recipe-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.recipeIndex = String(index);
    card.innerHTML = `
      <div>
        <p class="recipe-card-kicker">${escapeHTML(displayCategory(entry.category))}</p>
        <h2>${escapeHTML(entry.product)}</h2>
      </div>
      <div class="recipe-size-options" aria-label="${escapeAttribute(entry.product)} ölçüleri">
        ${entry.sizes.map((sizeItem, sizeIndex) => `
          <button class="size-badge" type="button" data-recipe-index="${index}" data-recipe-size-index="${sizeIndex}">
            ${escapeHTML(sizeItem.size)}
          </button>
        `).join("")}
      </div>
      <div class="recipe-card-footer">
        <span>${entry.sizes.length} ölçü</span>
        <span class="open-label">Detay</span>
      </div>
    `;
    return card;
  }

  function openRecipeModal(entry, sizeItem) {
    if (!entry) return;
    const selectedSize = sizeItem || entry.sizes && entry.sizes[0] || entry;
    els.recipeModalCategory.textContent = displayCategory(entry.category);
    els.recipeModalTitle.textContent = entry.product;
    els.recipeModalSize.textContent = selectedSize.size;
    state.currentModalRecipe = normalizeRecipeItem(selectedSize.recipe);
    renderRecipeModalPanel("content");
    els.recipeModal.classList.add("is-open");
    els.recipeModal.setAttribute("aria-hidden", "false");
  }

  function renderRecipeModalPanel(panel) {
    const recipe = normalizeRecipeItem(state.currentModalRecipe);
    const hasPreparation = Boolean(recipe.preparation);
    const activePanel = panel === "preparation" && hasPreparation ? "preparation" : "content";
    state.activeModalPanel = activePanel;

    if (els.recipeModalActions) {
      els.recipeModalActions.hidden = !hasPreparation;
      Array.from(els.recipeModalActions.querySelectorAll("[data-action]")).forEach((button) => {
        button.classList.toggle("is-active", button.dataset.action === `recipe-${activePanel}`);
      });
    }

    if (els.recipeSectionTitle) els.recipeSectionTitle.textContent = activePanel === "preparation" ? "Hazırlanışı" : "İçerik";
    const text = activePanel === "preparation" ? recipe.preparation : recipe.content;
    els.recipeModalSteps.innerHTML = splitRecipe(text, activePanel)
      .map((step) => `<li>${escapeHTML(step)}</li>`)
      .join("");
  }

  function closeRecipeModal() {
    if (!els.recipeModal) return;
    els.recipeModal.classList.remove("is-open");
    els.recipeModal.setAttribute("aria-hidden", "true");
    state.currentModalRecipe = null;
    state.activeModalPanel = "content";
  }

  function flattenRecipes(categoryFilter) {
    const entries = [];
    Object.keys(state.data).forEach((category) => {
      if (isAllCategory(category)) return;
      if (categoryFilter && category !== categoryFilter) return;
      Object.keys(state.data[category] || {}).forEach((product) => {
        const sizes = Object.keys(state.data[category][product] || {}).map((size) => {
          const recipe = normalizeRecipeItem(state.data[category][product][size]);
          return { size, recipe };
        });
        if (!sizes.length) return;
        entries.push({
          category,
          product,
          sizes,
          searchBlob: `${category} ${product} ${sizes.map((item) => `${item.size} ${item.recipe.content} ${item.recipe.preparation}`).join(" ")}`
        });
      });
    });
    return entries;
  }

  function groupedRecipes(groupId) {
    if (!groupId || groupId === "all") {
      if (state.activeGroup) return entriesForCategories(categoriesForHomeGroup(state.activeGroup));
      return flattenRecipes();
    }
    return flattenRecipes(groupId);
  }

  function entriesForCategories(categories) {
    const allowed = new Set(categories);
    return flattenRecipes().filter((entry) => allowed.has(entry.category));
  }

  function categoriesForHomeGroup(groupId) {
    return recipeCategoryNames().filter((category) => groupIdForCategory(category) === groupId);
  }

  function groupIdForCategory(category) {
    const key = normalizeKey(category);
    if (!key || isAllCategory(category)) return "";
    if (key.includes("special")) return "specials";
    if (key.includes("demlem")) return "brews";
    if (key.includes("hazir")) return "prep";
    if (key.includes("sicak")) return "hot";
    if (key.includes("soguk")) return "cold";
    if (["espresso", "matcha", "aromali", "sicak"].includes(key)) return "hot";
    if (key === "soguk") return "cold";
    return "";
  }

  function homeGroupTitle(groupId) {
    const group = HOME_GROUPS.find((item) => item.id === groupId);
    return group ? group.title : "Tümü";
  }

  function openHomeGroup(groupId) {
    state.homeMode = false;
    state.activeGroup = groupId || "";
    state.activeCategory = "all";
    state.search = "";
    if (els.recipeSearch) els.recipeSearch.value = "";
    renderAll();
    scrollToRecipeTop();
  }

  function ensureActiveSelection() {
    if (state.activeGroup && !categoriesForHomeGroup(state.activeGroup).length) state.activeGroup = "";
    if (state.activeCategory !== "all" && !groupedRecipes(state.activeCategory).length) state.activeCategory = "all";
  }

  function scrollToRecipeTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSuggestions() {
    if (!els.recipeSuggestions) return;
    const q = normalizeText(state.search || (els.recipeSearch && els.recipeSearch.value) || "");
    if (!q) {
      hideSuggestions();
      return;
    }

    state.suggestions = flattenRecipes()
      .filter((entry) => normalizeText(entry.searchBlob).includes(q))
      .slice(0, 8);

    els.recipeSuggestions.hidden = false;
    if (!state.suggestions.length) {
      els.recipeSuggestions.innerHTML = `<div class="recipe-suggestion-item"><strong>Sonuç bulunamadı</strong><span>Başka bir ürün veya ölçü deneyin.</span></div>`;
      return;
    }

    els.recipeSuggestions.innerHTML = state.suggestions.map((entry, index) => `
      <button class="recipe-suggestion-item" type="button" data-recipe-suggestion="${index}">
        <strong>${escapeHTML(entry.product)}</strong>
        <span>${entry.sizes.length} ölçü · ${escapeHTML(displayCategory(entry.category))}</span>
      </button>
    `).join("");
  }

  function hideSuggestions() {
    if (!els.recipeSuggestions) return;
    els.recipeSuggestions.hidden = true;
    els.recipeSuggestions.innerHTML = "";
    state.suggestions = [];
  }

  function normalizeRecipeItem(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return {
        content: String(value.content || value.recipe || value.ingredients || "").trim(),
        preparation: String(value.preparation || value.method || value.steps || value.description || "").trim()
      };
    }
    return { content: String(value || "").trim(), preparation: "" };
  }

  function splitRecipe(value, panel) {
    const text = String(value || "").trim();
    if (!text) return ["Reçete bilgisi henüz girilmedi."];
    const splitter = panel === "preparation" ? /\n+|;\s+/g : /\n+|\s+[–-]\s+|\s+\+\s+/g;
    const parts = text.split(splitter).map((item) => item.trim()).filter(Boolean);
    return parts.length ? parts : [text];
  }

  function displayCategory(category) {
    return LEGACY_CATEGORY_NAMES[category] || category;
  }

  function isAllCategory(category) {
    const key = normalizeKey(category);
    return key === "tumu" || key === "tum" || key === "all";
  }

  function hydrateBaristaName() {
    state.baristaName = readPersonNameFromStorage() || state.baristaName || "Personel";
    renderBaristaName();
  }

  function renderBaristaName() {
    if (els.recipeBaristaName) els.recipeBaristaName.textContent = state.baristaName || "Personel";
  }

  function readPersonNameFromStorage() {
    const keys = [
      "tahmisci.personel.session.v1",
      "tahmisci.personel.profile.v1",
      "tahmisci.personel.auth.v1",
      "tahmisci.personel.user.v1"
    ];
    for (const key of keys) {
      const value = readStorageJSON(window.localStorage, key);
      const name = pickName(value);
      if (name) return name;
    }
    return "";
  }

  function readStorageJSON(storage, key) {
    try {
      const value = storage.getItem(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function pickName(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    const direct = value.profileName || value.displayName || value.fullName || value.memberName || value.name || value.username || value.userName;
    if (direct) return String(direct).trim();
    return pickName(value.profile) || pickName(value.user);
  }

  function applyStoredTheme() {
    if (safeLocalGet(THEME_KEY) === "dark") document.body.classList.add("dark-mode");
    updateThemeIcon();
  }

  function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    safeLocalSet(THEME_KEY, document.body.classList.contains("dark-mode") ? "dark" : "light");
    updateThemeIcon();
  }

  function updateThemeIcon() {
    if (!els.recipeModeIcon) return;
    const isDark = document.body.classList.contains("dark-mode");
    const iconPath = document.getElementById("recipeModeIconPath");
    if (iconPath) {
      iconPath.setAttribute("d", isDark
        ? "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
        : "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z");
    }
    els.recipeModeIcon.setAttribute("data-theme-icon", isDark ? "light" : "dark");
  }

  function normalizeText(text) {
    return normalizeKey(text).toUpperCase();
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ç/g, "c")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u");
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
  }

  function safeLocalGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return "";
    }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {}
  }

})();
