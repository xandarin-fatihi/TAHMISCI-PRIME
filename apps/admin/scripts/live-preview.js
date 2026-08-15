(function () {
  "use strict";

  const MESSAGE_TYPE = "tahmisci:preview-draft";
  const ACK_TYPE = "tahmisci:preview-ready";
  const ERROR_TYPE = "tahmisci:preview-error";
  const SCHEMA_VERSION = 1;
  const DEVICE_STORAGE_KEY = "tahmisci-admin-preview-device";
  const HISTORY_LIMIT = 12;

  const SECTION_CONFIG = Object.freeze({
    menu: Object.freeze({ key: "menu", section: "menu", source: "menu", title: "Menü Görünümü" }),
    banner: Object.freeze({ key: "banner", section: "banner", source: "menu", title: "Banner Önizlemesi" }),
    category: Object.freeze({ key: "category", section: "category", source: "menu", title: "Kategori Önizlemesi" }),
    product: Object.freeze({ key: "product", section: "product", source: "menu", title: "Ürün Önizlemesi" }),
    bulkPrice: Object.freeze({ key: "bulkPrice", section: "bulkPrice", source: "menu", title: "Fiyat Önizlemesi" }),
    stock: Object.freeze({ key: "stock", section: "stock", source: "personel", title: "Personel Stok Önizlemesi" }),
    recipe: Object.freeze({ key: "recipe", section: "recipe", source: "personel", title: "Personel Reçete Önizlemesi" }),
    tasks: Object.freeze({ key: "tasks", section: "tasks", source: "personel", title: "Personel Yapılacaklar Önizlemesi" }),
    shipment: Object.freeze({ key: "shipment", section: "shipment", source: "personel", title: "Personel Sevkiyat Önizlemesi" }),
    shift: Object.freeze({ key: "shift", section: "shift", source: "personel", title: "Personel Shift Önizlemesi" }),
    staffAccess: Object.freeze({ key: "staffAccess", section: "tasks", source: "personel", title: "Personel Paneli Önizlemesi" }),
    settings: Object.freeze({ key: "settings", section: "settings", source: "menu", title: "Menü Görünümü" })
  });
  const SECTION_ALIASES = Object.freeze({ shipments: "shipment", shifts: "shift", workforceTasks: "tasks" });
  const PREVIEW_SECTIONS = new Set(Object.values(SECTION_CONFIG).map((item) => item.section));
  const DEVICE_GEOMETRY = Object.freeze({
    mobile: Object.freeze({
      sourceWidth: 390,
      sourceHeight: 844,
      outerWidth: 414,
      outerHeight: 884,
      viewportX: 12,
      viewportY: 20
    }),
    desktop: Object.freeze({
      sourceWidth: 1440,
      sourceHeight: 900,
      outerWidth: 1464,
      outerHeight: 994,
      viewportX: 12,
      viewportY: 12
    })
  });
  const historyBySection = new Map();
  const previewTokens = new Map();
  const previewTokenRequests = new Map();
  let previewTokenGeneration = 0;
  let globalDrawer = null;
  let pendingSection = "overview";
  let pendingPublishedSnapshot = null;

  function calculateContainScale(availableWidth, availableHeight, outerWidth, outerHeight) {
    const safeWidth = Math.max(1, Number(availableWidth) || 0);
    const safeHeight = Math.max(1, Number(availableHeight) || 0);
    const safeOuterWidth = Math.max(1, Number(outerWidth) || 0);
    const safeOuterHeight = Math.max(1, Number(outerHeight) || 0);
    const candidate = Math.min(1, safeWidth / safeOuterWidth, safeHeight / safeOuterHeight);
    if (!Number.isFinite(candidate) || candidate <= 0) return 0.01;
    return Math.max(0.01, Math.floor(candidate * 100000) / 100000);
  }

  const STATUS_LABELS = Object.freeze({
    preparing: "Hazırlanıyor",
    connecting: "Bağlanıyor",
    draft: "Taslak gösteriliyor",
    current: "Güncel",
    published: "Yayınlandı",
    "token-expired": "Token süresi doldu",
    origin: "Origin doğrulanamadı",
    backend: "Backend bağlantısı yok",
    error: "Önizleme hatası",
    unavailable: "Bu bölüm için önizleme bulunmuyor"
  });

  function normalizeSectionKey(value) {
    const requested = String(value || "").trim();
    const aliased = SECTION_ALIASES[requested] || requested;
    return Object.prototype.hasOwnProperty.call(SECTION_CONFIG, aliased) ? aliased : aliased || "overview";
  }

  function resolveSectionConfig(value) {
    return SECTION_CONFIG[normalizeSectionKey(value)] || null;
  }

  function safePreviewSection(value) {
    const section = String(value || "menu");
    return PREVIEW_SECTIONS.has(section) ? section : "menu";
  }

  function sourcesForSection(section) {
    return [personnelMode(section) ? "personel" : "menu"];
  }

  function personnelMode(section) {
    return { stock: "stock", recipe: "recipe", tasks: "tasks", shipment: "shipment", shift: "shift" }[section] || "";
  }

  function publicOrigin() {
    const explicit = window.TAHMISCI_PUBLIC_URL;
    if (explicit) return normalizeOrigin(new URL(String(explicit), window.location.href).origin);
    const host = window.location.hostname || "localhost";
    const publicHost = host.startsWith("admin.") ? host.slice(6) : host;
    const port = window.location.port ? `:${window.location.port}` : "";
    return normalizeOrigin(`${window.location.protocol}//${publicHost}${port}`);
  }

  function routeFor(source, section, session) {
    const origin = session.publicOrigin || publicOrigin();
    const params = new URLSearchParams({
      preview: "admin",
      section: safePreviewSection(section),
      previewToken: session.token
    });
    return source === "menu"
      ? `${origin}/?${params.toString()}`
      : `${origin}/personel/?${params.toString()}`;
  }

  async function previewToken(mode, options = {}) {
    if (options.force) previewTokens.delete(mode);
    const cached = previewTokens.get(mode);
    if (cached && cached.expiresAt > Date.now() + 15000) return cached;
    if (previewTokenRequests.has(mode)) return previewTokenRequests.get(mode);

    const generation = previewTokenGeneration;
    const request = (async () => {
      const admin = bridge();
      if (!admin || typeof admin.backendRequest !== "function") throw new Error("Önizleme oturumu hazırlanamadı.");
      const result = await admin.backendRequest("/api/admin/preview-token", { method: "POST", body: { mode } });
      const token = String(result.previewToken || result.token || "");
      if (!token) throw new Error("Önizleme anahtarı alınamadı.");
      const expiresAt = Date.parse(result.expiresAt || "") || Date.now() + 4 * 60 * 1000;
      const allowedOrigins = new Set((Array.isArray(result.allowedOrigins) ? result.allowedOrigins : [])
        .map(normalizeOrigin)
        .filter(Boolean));
      const session = {
        token,
        mode,
        expiresAt,
        allowedOrigins,
        publicOrigin: normalizeOrigin(result.publicOrigin) || publicOrigin()
      };
      if (generation === previewTokenGeneration) previewTokens.set(mode, session);
      return session;
    })();

    previewTokenRequests.set(mode, request);
    try {
      return await request;
    } finally {
      if (previewTokenRequests.get(mode) === request) previewTokenRequests.delete(mode);
    }
  }

  function clearPreviewSessions() {
    previewTokenGeneration += 1;
    previewTokens.clear();
    previewTokenRequests.clear();
  }

  function bridge() {
    return window.TahmisciAdminBridge || null;
  }

  function snapshot(section) {
    const admin = bridge();
    const current = admin && typeof admin.snapshot === "function" ? admin.snapshot() : {};
    const safeSection = safePreviewSection(section);
    const value = { section: safeSection };
    if (safeSection === "recipe") value.recipeState = clone(current.recipeState || null);
    else if (safeSection === "stock") value.stockState = clone(current.stockState || null);
    else if (!["tasks", "shipment", "shift"].includes(safeSection)) {
      value.menuState = clone(current.menuState || null);
      value.pricing = clone(current.pricing || current.menuState && current.menuState.pricing || null);
    }
    return value;
  }

  function snapshotRevision(section) {
    const admin = bridge();
    return admin && typeof admin.previewRevision === "function"
      ? Number(admin.previewRevision(safePreviewSection(section)) || 0)
      : 0;
  }

  function relevantSnapshot(value, section) {
    if (section === "recipe") return value && value.recipeState;
    if (section === "stock") return value && value.stockState;
    if (["tasks", "shipment", "shift"].includes(section)) return value;
    return value && value.menuState;
  }

  function isDraft(section) {
    const admin = bridge();
    if (!admin) return false;
    if (typeof admin.isScopeDirty === "function") return Boolean(admin.isScopeDirty(safePreviewSection(section)));
    return Boolean(typeof admin.hasPendingChanges === "function" && admin.hasPendingChanges());
  }

  function historyState(config) {
    const key = config.key;
    if (!historyBySection.has(key)) {
      historyBySection.set(key, {
        history: [],
        historyIndex: -1,
        publishedSnapshot: null,
        source: config.source,
        device: readStoredDevice(),
        status: "current",
        justPublished: false
      });
    }
    return historyBySection.get(key);
  }

  function pushHistory(state, current, section) {
    const revision = snapshotRevision(section);
    const hash = revision > 0 ? `${safePreviewSection(section)}:${revision}` : fingerprint(relevantSnapshot(current, section));
    const selected = state.history[state.historyIndex];
    if (selected && selected.hash === hash) return false;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({ hash, snapshot: clone(current) });
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.historyIndex = state.history.length - 1;
    return true;
  }

  function captureSectionHistory(config) {
    const state = historyState(config);
    const current = snapshot(config.section);
    pushHistory(state, current, config.section);
    if (!isDraft(config.section)) state.publishedSnapshot = clone(current);
    state.source = config.source;
    state.status = isDraft(config.section) ? "draft" : state.justPublished ? "published" : "current";
    return state;
  }

  function applyPublishedToHistory(publishedSnapshot) {
    if (!publishedSnapshot || typeof publishedSnapshot !== "object") return;
    pendingPublishedSnapshot = clone(publishedSnapshot);
    historyBySection.forEach((state, key) => {
      const config = SECTION_CONFIG[key];
      if (!config) return;
      const current = snapshot(config.section);
      state.publishedSnapshot = clone(publishedSnapshot);
      pushHistory(state, current, config.section);
      const currentHash = fingerprint(relevantSnapshot(current, config.section));
      const publishedHash = fingerprint(relevantSnapshot(publishedSnapshot, config.section));
      state.justPublished = !isDraft(config.section) && currentHash === publishedHash;
      state.status = state.justPublished ? "published" : "draft";
    });
  }

  function validIncomingMessage(event, instance) {
    if (!instance || instance.destroyed || !instance.frame || event.source !== instance.frame.contentWindow) return false;
    if (!instance.origin || event.origin !== instance.origin || !instance.allowedOrigins.has(event.origin)) return false;
    const data = event.data;
    return Boolean(data && typeof data === "object"
      && data.schemaVersion === SCHEMA_VERSION
      && data.previewSession === instance.sessionToken
      && (data.type === ACK_TYPE || data.type === ERROR_TYPE));
  }

  class LivePreviewPanel {
    constructor(target, options = {}) {
      this.target = target;
      this.section = safePreviewSection(options.section);
      this.historyKey = options.historyKey || this.section;
      this.config = { key: this.historyKey, section: this.section, source: options.source || sourcesForSection(this.section)[0] };
      this.allowedSources = sourcesForSection(this.section);
      this.historyState = historyState(this.config);
      this.source = this.allowedSources.includes(this.historyState.source) ? this.historyState.source : this.config.source;
      this.device = ["mobile", "desktop"].includes(this.historyState.device) ? this.historyState.device : readStoredDevice();
      this.onStatus = typeof options.onStatus === "function" ? options.onStatus : null;
      this.onDevice = typeof options.onDevice === "function" ? options.onDevice : null;
      this.refreshCallback = typeof options.refresh === "function" ? options.refresh : null;
      this.settingsButton = options.settingsButton || null;
      this.messageTimer = 0;
      this.loadTimer = 0;
      this.ackTimer = 0;
      this.expiryTimer = 0;
      this.scaleFrame = 0;
      this.scaleRevision = 0;
      this.appliedGeometryDevice = "";
      this.lastScaleLayout = "";
      this.navigationId = 0;
      this.statusKey = "preparing";
      this.sessionToken = "";
      this.sessionMode = "";
      this.origin = "";
      this.allowedOrigins = new Set();
      this.destroyed = false;
      this.handlePanelClick = this.handlePanelClick.bind(this);
      this.handleFrameLoad = this.handleFrameLoad.bind(this);
      this.handleWindowResize = this.syncFrameScale.bind(this);
      this.render();
      this.bind();
      this.seedHistory();
      if (window.ResizeObserver) {
        this.resizeObserver = new window.ResizeObserver(() => this.syncFrameScale());
        this.resizeObserver.observe(this.stage);
      }
      this.navigate();
    }

    render() {
      this.target.classList.add("live-preview-controller-host");
      this.target.innerHTML = `
        <section class="live-preview-panel" data-live-preview-panel>
          <div class="live-preview-panel__stage" data-preview-stage>
            <div class="live-preview-device-fit" data-preview-device-fit>
              <div class="live-preview-device" data-preview-device-shell data-device="mobile">
                <div class="live-preview-device__camera" aria-hidden="true"></div>
                <div class="live-preview-device__viewport" data-preview-device-viewport>
                  <iframe data-preview-frame title="Gerçek uygulama canlı önizlemesi" loading="eager" referrerpolicy="origin"></iframe>
                </div>
                <div class="live-preview-device__gesture" aria-hidden="true"></div>
                <div class="live-preview-device__stand" aria-hidden="true"></div>
              </div>
            </div>
            <div class="live-preview-panel__state" data-preview-loading><span class="live-preview-panel__spinner"></span><strong data-preview-loading-label>Hazırlanıyor</strong></div>
            <div class="live-preview-panel__state live-preview-panel__state--error" data-preview-error hidden>
              <strong data-preview-error-title>Önizleme yüklenemedi</strong><span data-preview-error-detail>Bağlantıyı kontrol edip yeniden deneyin.</span>
              <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-preview-retry>Yeniden yükle</button>
            </div>
            <div class="live-preview-panel__state" data-preview-empty hidden><strong>Önizlenecek veri yok</strong><span>İlk kaydı eklediğinizde gerçek uygulama burada görünecek.</span></div>
          </div>
          <div class="live-preview-settings-backdrop" data-preview-settings-dismiss aria-hidden="true" hidden></div>
          <div
            class="live-preview-settings"
            id="globalLivePreviewSettings"
            data-preview-settings
            role="region"
            aria-label="Önizleme ayarları"
            hidden>
            <div class="live-preview-settings__heading">
              <strong>Önizleme Ayarları</strong>
              <span>Görünüm ve taslak araçları</span>
            </div>
            <section class="live-preview-settings__section" data-preview-source-section>
              <h3>Önizleme kaynağı</h3>
              <div class="live-preview-panel__segmented" data-preview-source-group role="group" aria-label="Önizleme kaynağı">
                <button type="button" data-preview-source="menu">Menü</button>
                <button type="button" data-preview-source="personel">Personel</button>
              </div>
            </section>
            <section class="live-preview-settings__section">
              <h3>Cihaz</h3>
              <div class="live-preview-panel__segmented" role="group" aria-label="Önizleme cihazı">
                <button type="button" data-preview-device="mobile" aria-label="Mobil önizleme">Mobil</button>
                <button type="button" data-preview-device="desktop" aria-label="Masaüstü önizleme">Masaüstü</button>
              </div>
              <small class="live-preview-settings__note" data-preview-device-note></small>
            </section>
            <section class="live-preview-settings__section">
              <h3>Geçmiş işlemleri</h3>
              <div class="live-preview-settings__history" role="group" aria-label="Taslak geçmişi">
                <button class="ui-button ui-button--ghost ui-button--sm" type="button" data-preview-undo disabled>Geri al</button>
                <button class="ui-button ui-button--ghost ui-button--sm" type="button" data-preview-redo disabled>Yinele</button>
                <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-preview-revert disabled>Yayına dön</button>
              </div>
            </section>
            <section class="live-preview-settings__section live-preview-settings__technical">
              <h3>Teknik bilgiler</h3>
              <span>Yalnızca bu cihazda kayıtlı</span>
              <div><span>Maskelenmiş önizleme route'u</span><code data-preview-route></code></div>
            </section>
            <section class="live-preview-settings__section live-preview-settings__reload">
              <h3>Yenileme</h3>
              <button class="ui-button ui-button--secondary ui-button--block" type="button" data-preview-retry>Önizlemeyi yeniden yükle</button>
            </section>
          </div>
        </section>`;
      this.panel = this.target.querySelector("[data-live-preview-panel]");
      this.frame = this.target.querySelector("[data-preview-frame]");
      this.stage = this.target.querySelector("[data-preview-stage]");
      this.deviceFit = this.target.querySelector("[data-preview-device-fit]");
      this.deviceShell = this.target.querySelector("[data-preview-device-shell]");
      this.deviceViewport = this.target.querySelector("[data-preview-device-viewport]");
      this.loading = this.target.querySelector("[data-preview-loading]");
      this.loadingLabel = this.target.querySelector("[data-preview-loading-label]");
      this.error = this.target.querySelector("[data-preview-error]");
      this.empty = this.target.querySelector("[data-preview-empty]");
      this.settingsBackdrop = this.target.querySelector("[data-preview-settings-dismiss]");
      this.settingsPopover = this.target.querySelector("[data-preview-settings]");
      this.deviceNote = this.target.querySelector("[data-preview-device-note]");
      this.route = this.target.querySelector("[data-preview-route]");
      this.undoButton = this.target.querySelector("[data-preview-undo]");
      this.redoButton = this.target.querySelector("[data-preview-redo]");
      this.revertButton = this.target.querySelector("[data-preview-revert]");
      this.syncControls();
    }

    bind() {
      this.panel.addEventListener("click", this.handlePanelClick);
      this.frame.addEventListener("load", this.handleFrameLoad);
      window.addEventListener("resize", this.handleWindowResize, { passive: true });
    }

    isSettingsOpen() {
      return Boolean(this.settingsPopover && !this.settingsPopover.hidden);
    }

    openSettings() {
      if (this.destroyed || !this.settingsPopover || this.isSettingsOpen()) return false;
      this.settingsPopover.hidden = false;
      if (this.settingsBackdrop) this.settingsBackdrop.hidden = false;
      if (this.settingsButton) {
        this.settingsButton.setAttribute("aria-expanded", "true");
        this.settingsButton.classList.add("is-active");
      }
      window.requestAnimationFrame(() => {
        if (this.destroyed || !this.isSettingsOpen()) return;
        const firstControl = Array.from(this.settingsPopover.querySelectorAll("button"))
          .find((button) => !button.hidden && !button.disabled);
        if (firstControl) firstControl.focus({ preventScroll: true });
      });
      return true;
    }

    closeSettings(options = {}) {
      if (!this.settingsPopover) return false;
      const wasOpen = this.isSettingsOpen();
      this.settingsPopover.hidden = true;
      if (this.settingsBackdrop) this.settingsBackdrop.hidden = true;
      if (this.settingsButton) {
        this.settingsButton.setAttribute("aria-expanded", "false");
        this.settingsButton.classList.remove("is-active");
        if (wasOpen && options.returnFocus !== false && this.settingsButton.isConnected) {
          this.settingsButton.focus({ preventScroll: true });
        }
      }
      return wasOpen;
    }

    toggleSettings() {
      return this.isSettingsOpen() ? this.closeSettings() : this.openSettings();
    }

    handlePanelClick(event) {
      if (this.destroyed) return;
      if (event.target.closest("[data-preview-settings-dismiss]")) {
        this.closeSettings();
        return;
      }
      const sourceButton = event.target.closest("[data-preview-source]");
      const deviceButton = event.target.closest("[data-preview-device]");
      if (sourceButton && this.allowedSources.includes(sourceButton.dataset.previewSource)) {
        this.source = sourceButton.dataset.previewSource;
        this.historyState.source = this.source;
        this.syncControls();
        this.navigate();
        return;
      }
      if (deviceButton && ["mobile", "desktop"].includes(deviceButton.dataset.previewDevice)) {
        this.device = deviceButton.dataset.previewDevice;
        this.historyState.device = this.device;
        writeStoredDevice(this.device);
        this.syncControls();
        this.queueDraft();
        return;
      }
      if (event.target.closest("[data-preview-undo]")) this.undo();
      if (event.target.closest("[data-preview-redo]")) this.redo();
      if (event.target.closest("[data-preview-revert]")) this.revertPublished();
      if (event.target.closest("[data-preview-retry]")) this.reload();
    }

    handleFrameLoad() {
      if (this.destroyed || !this.sessionToken || !this.frame || this.frame.hidden) return;
      window.clearTimeout(this.loadTimer);
      this.setLoading(false);
      this.setError(false);
      this.setStatus("connecting");
      this.syncEmptyState();
      this.syncFrameScale();
      this.queueDraft(true);
      window.clearTimeout(this.ackTimer);
      this.ackTimer = window.setTimeout(() => {
        if (!this.destroyed && this.statusKey === "connecting") {
          this.setError(true, "backend", "Önizleme alıcısı yanıt vermedi.");
        }
      }, 6000);
    }

    update(options = {}) {
      if (this.destroyed) return;
      const nextSection = safePreviewSection(options.section || this.section);
      const nextHistoryKey = options.historyKey || nextSection;
      const sectionChanged = nextSection !== this.section;
      const historyChanged = nextHistoryKey !== this.historyKey;
      if (historyChanged) {
        this.historyKey = nextHistoryKey;
        this.config = { key: nextHistoryKey, section: nextSection, source: options.source || sourcesForSection(nextSection)[0] };
        this.historyState = historyState(this.config);
      }
      this.section = nextSection;
      this.allowedSources = sourcesForSection(this.section);
      const requestedSource = options.source || this.historyState.source;
      const nextSource = this.allowedSources.includes(requestedSource) ? requestedSource : this.allowedSources[0];
      const routeChanged = sectionChanged || nextSource !== this.source;
      this.source = nextSource;
      this.historyState.source = nextSource;
      this.refreshCallback = typeof options.refresh === "function" ? options.refresh : this.refreshCallback;
      if (options.settingsButton) this.settingsButton = options.settingsButton;
      if (historyChanged && ["mobile", "desktop"].includes(this.historyState.device)) this.device = this.historyState.device;
      if (["mobile", "desktop"].includes(options.device)) this.device = options.device;
      this.historyState.device = this.device;
      this.seedHistory();
      this.syncControls();
      this.syncEmptyState();
      if (routeChanged) this.navigate();
      else this.queueDraft();
    }

    syncControls() {
      if (!this.panel) return;
      this.panel.dataset.device = this.device;
      const sourceGroup = this.panel.querySelector("[data-preview-source-group]");
      if (sourceGroup) sourceGroup.hidden = this.allowedSources.length === 0;
      this.panel.querySelectorAll("[data-preview-source]").forEach((button) => {
        const available = this.allowedSources.includes(button.dataset.previewSource);
        const selected = available && button.dataset.previewSource === this.source;
        button.hidden = !available;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      this.panel.querySelectorAll("[data-preview-device]").forEach((button) => {
        const selected = button.dataset.previewDevice === this.device;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      if (this.deviceNote) {
        const geometry = DEVICE_GEOMETRY[this.device] || DEVICE_GEOMETRY.mobile;
        this.deviceNote.textContent = `${geometry.sourceWidth} × ${geometry.sourceHeight} gerçek viewport`;
      }
      if (!["preparing", "connecting", "error", "token-expired", "origin", "backend", "published"].includes(this.statusKey)) {
        this.setStatus(isDraft(this.section) ? "draft" : "current");
      }
      this.updateHistoryControls();
      this.syncFrameScale();
      if (this.onDevice) this.onDevice(this.device);
    }

    async navigate(forceToken = false) {
      if (this.destroyed) return;
      const navigationId = ++this.navigationId;
      this.resetFrameForNavigation();
      this.setLoading(true, "Hazırlanıyor");
      this.setError(false);
      this.setStatus("preparing");
      const mode = this.source === "menu" ? "menu" : personnelMode(this.section);
      let session;
      try {
        session = await previewToken(mode, { force: forceToken });
      } catch (error) {
        if (this.destroyed || navigationId !== this.navigationId) return;
        this.setLoading(false);
        this.setError(true, "backend", error.message || "Önizleme oturumu hazırlanamadı.");
        return;
      }
      if (this.destroyed || navigationId !== this.navigationId) return;

      const url = routeFor(this.source, this.section, session);
      const parsedUrl = new URL(url);
      const targetOrigin = parsedUrl.origin;
      const adminOrigin = normalizeOrigin(window.location.origin);
      if (!session.allowedOrigins.has(adminOrigin) || !session.allowedOrigins.has(targetOrigin)) {
        this.setLoading(false);
        this.setError(true, "origin", "Yönetici veya hedef origin backend izin listesinde değil.");
        return;
      }

      if (this.sessionMode && this.sessionMode !== mode) previewTokens.delete(this.sessionMode);
      this.origin = targetOrigin;
      this.allowedOrigins = session.allowedOrigins;
      this.sessionToken = session.token;
      this.sessionMode = mode;
      const safeUrl = new URL(url);
      safeUrl.searchParams.set("previewToken", "korumalı");
      this.route.textContent = `${safeUrl.pathname}${safeUrl.search}`;
      this.frame.hidden = false;
      this.frame.src = url;
      this.setStatus("connecting");
      window.clearTimeout(this.loadTimer);
      this.loadTimer = window.setTimeout(() => {
        if (this.destroyed || navigationId !== this.navigationId) return;
        this.setLoading(false);
        this.setError(true, "backend", "Önizleme route’u zamanında yüklenemedi.");
      }, 9000);
      window.clearTimeout(this.expiryTimer);
      const renewalToken = session.token;
      this.expiryTimer = window.setTimeout(() => {
        if (this.destroyed || this.sessionToken !== renewalToken) return;
        previewTokens.delete(mode);
        this.navigate(true);
      }, Math.max(1000, session.expiresAt - Date.now() - 15000));
    }

    resetFrameForNavigation() {
      window.clearTimeout(this.messageTimer);
      window.clearTimeout(this.loadTimer);
      window.clearTimeout(this.ackTimer);
      window.clearTimeout(this.expiryTimer);
      this.sessionToken = "";
      this.origin = "";
      this.allowedOrigins = new Set();
      if (this.frame) this.frame.hidden = true;
      if (this.route) this.route.textContent = "";
    }

    reload() {
      if (this.destroyed) return;
      if (this.refreshCallback) this.refreshCallback();
      this.navigate(true);
    }

    syncFrameScale() {
      if (this.destroyed || !this.stage || !this.deviceFit || !this.deviceShell || !this.deviceViewport || !this.frame) return;
      const revision = ++this.scaleRevision;
      if (this.scaleFrame) {
        if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(this.scaleFrame);
        else window.clearTimeout(this.scaleFrame);
        this.scaleFrame = 0;
      }
      this.applyFrameScale();
      const requestFrame = typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0);
      this.scaleFrame = requestFrame(() => {
        this.scaleFrame = 0;
        if (this.destroyed || revision !== this.scaleRevision) return;
        this.applyFrameScale();
      });
    }

    applyFrameScale() {
      if (this.destroyed || !this.stage || !this.deviceFit || !this.deviceShell) return;
      const geometry = DEVICE_GEOMETRY[this.device] || DEVICE_GEOMETRY.mobile;
      this.applyDeviceGeometry(geometry);
      const stageRect = this.stage.getBoundingClientRect();
      const stageStyle = typeof window.getComputedStyle === "function" ? window.getComputedStyle(this.stage) : null;
      const cssPixel = (value) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const horizontalPadding = stageStyle
        ? cssPixel(stageStyle.paddingLeft) + cssPixel(stageStyle.paddingRight)
        : 0;
      const verticalPadding = stageStyle
        ? cssPixel(stageStyle.paddingTop) + cssPixel(stageStyle.paddingBottom)
        : 0;
      const safetyGap = 4;
      const availableWidth = Math.max(1, stageRect.width - horizontalPadding - safetyGap);
      const availableHeight = Math.max(1, stageRect.height - verticalPadding - safetyGap);
      const scale = calculateContainScale(
        availableWidth,
        availableHeight,
        geometry.outerWidth,
        geometry.outerHeight
      );
      const layoutKey = [
        this.device,
        Math.round(availableWidth * 10) / 10,
        Math.round(availableHeight * 10) / 10,
        scale
      ].join(":");
      if (layoutKey === this.lastScaleLayout) return;
      this.lastScaleLayout = layoutKey;
      this.deviceShell.style.transform = `scale(${scale})`;
      this.deviceFit.style.width = `${geometry.outerWidth * scale}px`;
      this.deviceFit.style.height = `${geometry.outerHeight * scale}px`;
    }

    applyDeviceGeometry(geometry) {
      if (!geometry || !this.deviceShell || !this.deviceViewport || !this.frame) return;
      if (this.appliedGeometryDevice === this.device) return;
      this.appliedGeometryDevice = this.device;
      this.lastScaleLayout = "";
      this.deviceShell.dataset.device = this.device;
      this.deviceShell.style.width = `${geometry.outerWidth}px`;
      this.deviceShell.style.height = `${geometry.outerHeight}px`;
      this.deviceShell.style.setProperty("--preview-viewport-x", `${geometry.viewportX}px`);
      this.deviceShell.style.setProperty("--preview-viewport-y", `${geometry.viewportY}px`);
      this.deviceShell.style.setProperty("--preview-viewport-width", `${geometry.sourceWidth}px`);
      this.deviceShell.style.setProperty("--preview-viewport-height", `${geometry.sourceHeight}px`);
      this.deviceShell.style.transformOrigin = "top left";
      this.deviceShell.style.transform = "scale(1)";
      this.deviceViewport.style.width = `${geometry.sourceWidth}px`;
      this.deviceViewport.style.height = `${geometry.sourceHeight}px`;
      this.frame.style.width = `${geometry.sourceWidth}px`;
      this.frame.style.height = `${geometry.sourceHeight}px`;
      this.frame.style.transform = "none";
      this.frame.style.transformOrigin = "initial";
    }

    setLoading(active, label) {
      if (!this.loading || !this.stage) return;
      this.loading.hidden = !active;
      if (label && this.loadingLabel) this.loadingLabel.textContent = label;
      if (active && this.empty) this.empty.hidden = true;
      this.stage.setAttribute("aria-busy", String(active));
      this.syncDeviceVisibility();
    }

    setError(active, kind = "error", message = "") {
      if (!this.error) return;
      this.error.hidden = !active;
      if (!active) {
        this.syncDeviceVisibility();
        return;
      }
      this.setStatus(kind);
      if (this.empty) this.empty.hidden = true;
      const title = this.error.querySelector("[data-preview-error-title]");
      const detail = this.error.querySelector("[data-preview-error-detail]");
      const titles = {
        "token-expired": "Token süresi doldu",
        origin: "Origin doğrulanamadı",
        backend: "Backend bağlantısı yok",
        error: "Önizleme yüklenemedi"
      };
      if (title) title.textContent = titles[kind] || titles.error;
      if (detail) detail.textContent = message || "Bağlantıyı kontrol edip yeniden deneyin.";
      this.syncDeviceVisibility();
    }

    setStatus(key) {
      if (this.destroyed) return;
      this.statusKey = STATUS_LABELS[key] ? key : "error";
      this.historyState.status = this.statusKey;
      if (this.status) {
        this.status.textContent = STATUS_LABELS[this.statusKey];
        this.status.dataset.state = this.statusKey;
      }
      if (this.onStatus) this.onStatus(this.statusKey);
    }

    syncEmptyState() {
      if (!this.error || !this.loading || !this.empty || !this.error.hidden || !this.loading.hidden) return;
      const current = snapshot(this.section);
      const menuEmpty = !current.menuState || !Array.isArray(current.menuState.categories) || current.menuState.categories.length === 0;
      const recipeEmpty = !current.recipeState || typeof current.recipeState !== "object" || Object.keys(current.recipeState).length === 0;
      const stockProducts = current.stockState && Array.isArray(current.stockState.products) ? current.stockState.products : [];
      const empty = this.source === "menu"
        ? menuEmpty
        : this.section === "stock"
          ? stockProducts.length === 0
          : this.section === "recipe" && recipeEmpty;
      this.empty.hidden = !empty;
      this.syncDeviceVisibility();
    }

    syncDeviceVisibility() {
      if (!this.deviceFit) return;
      const hasVisibleState = Boolean(
        (this.loading && !this.loading.hidden)
        || (this.error && !this.error.hidden)
        || (this.empty && !this.empty.hidden)
        || (this.frame && this.frame.hidden)
      );
      this.deviceFit.hidden = hasVisibleState;
    }

    queueDraft(immediate) {
      if (this.destroyed) return;
      this.captureHistory();
      window.clearTimeout(this.messageTimer);
      this.messageTimer = window.setTimeout(() => this.postDraft(), immediate ? 0 : 180);
    }

    postDraft() {
      if (this.destroyed || !this.frame || !this.frame.contentWindow || !this.origin || !this.sessionToken) return;
      if (!this.allowedOrigins.has(this.origin) || !this.allowedOrigins.has(normalizeOrigin(window.location.origin))) {
        this.setError(true, "origin", "Önizleme mesajı izinli origin dışına gönderilemez.");
        return;
      }
      const payload = snapshot(this.section);
      if (!payload.menuState && !payload.recipeState && !payload.stockState) return;
      const draft = isDraft(this.section);
      if (draft) this.historyState.justPublished = false;
      this.frame.contentWindow.postMessage({
        type: MESSAGE_TYPE,
        schemaVersion: SCHEMA_VERSION,
        previewSession: this.sessionToken,
        scope: this.source === "menu" ? "menu" : this.section,
        data: this.source === "menu" ? payload.menuState : payload,
        source: this.source,
        device: this.device,
        section: this.section,
        draft
      }, this.origin);
      this.setStatus(draft ? "draft" : this.historyState.justPublished ? "published" : "current");
      this.syncEmptyState();
    }

    seedHistory() {
      if (!this.historyState.history.length) {
        const current = snapshot(this.section);
        pushHistory(this.historyState, current, this.section);
        if (!isDraft(this.section)) this.historyState.publishedSnapshot = clone(current);
      }
      this.updateHistoryControls();
    }

    captureHistory() {
      const current = snapshot(this.section);
      const selected = this.historyState.history[this.historyState.historyIndex];
      const hash = fingerprint(relevantSnapshot(current, this.section));
      if (!selected || selected.hash !== hash) pushHistory(this.historyState, current, this.section);
      if (!isDraft(this.section)) this.historyState.publishedSnapshot = clone(current);
      this.updateHistoryControls();
    }

    undo() {
      if (this.historyState.historyIndex <= 0) return;
      this.applyHistory(this.historyState.historyIndex - 1);
    }

    redo() {
      if (this.historyState.historyIndex >= this.historyState.history.length - 1) return;
      this.applyHistory(this.historyState.historyIndex + 1);
    }

    applyHistory(index) {
      const item = this.historyState.history[index];
      const admin = bridge();
      if (!item || !admin || typeof admin.applyPreviewSnapshot !== "function") return;
      this.historyState.historyIndex = index;
      admin.applyPreviewSnapshot(clone(item.snapshot), this.section);
      this.updateHistoryControls();
      this.queueDraft(true);
    }

    revertPublished() {
      const admin = bridge();
      if (!this.historyState.publishedSnapshot || !admin || typeof admin.applyPreviewSnapshot !== "function") return;
      admin.applyPreviewSnapshot(clone(this.historyState.publishedSnapshot), this.section);
      this.captureHistory();
      this.queueDraft(true);
    }

    updateHistoryControls() {
      if (!this.undoButton) return;
      this.undoButton.disabled = this.historyState.historyIndex <= 0;
      this.redoButton.disabled = this.historyState.historyIndex < 0
        || this.historyState.historyIndex >= this.historyState.history.length - 1;
      const current = this.historyState.history[this.historyState.historyIndex];
      const publishedHash = this.historyState.publishedSnapshot
        && fingerprint(relevantSnapshot(this.historyState.publishedSnapshot, this.section));
      this.revertButton.disabled = !publishedHash || Boolean(current && current.hash === publishedHash);
    }

    markPublished(publishedSnapshot) {
      if (this.destroyed) return;
      const current = snapshot(this.section);
      const published = publishedSnapshot && typeof publishedSnapshot === "object"
        ? clone(publishedSnapshot)
        : clone(current);
      this.historyState.publishedSnapshot = published;
      pushHistory(this.historyState, current, this.section);
      const currentHash = fingerprint(relevantSnapshot(current, this.section));
      const publishedHash = fingerprint(relevantSnapshot(published, this.section));
      this.historyState.justPublished = !isDraft(this.section) && currentHash === publishedHash;
      this.setStatus(this.historyState.justPublished ? "published" : "draft");
      this.updateHistoryControls();
      this.queueDraft(true);
    }

    destroy() {
      if (this.destroyed) return;
      this.closeSettings({ returnFocus: false });
      this.destroyed = true;
      this.navigationId += 1;
      ["messageTimer", "loadTimer", "ackTimer", "expiryTimer"].forEach((key) => {
        window.clearTimeout(this[key]);
        this[key] = 0;
      });
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.scaleFrame) {
        if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(this.scaleFrame);
        else window.clearTimeout(this.scaleFrame);
        this.scaleFrame = 0;
      }
      this.scaleRevision += 1;
      window.removeEventListener("resize", this.handleWindowResize);
      if (this.panel) this.panel.removeEventListener("click", this.handlePanelClick);
      if (this.frame) {
        this.frame.removeEventListener("load", this.handleFrameLoad);
        this.frame.src = "about:blank";
        this.frame.removeAttribute("src");
        this.frame.remove();
      }
      if (this.sessionMode) previewTokens.delete(this.sessionMode);
      this.sessionToken = "";
      this.sessionMode = "";
      this.origin = "";
      this.allowedOrigins.clear();
      this.target.classList.remove("live-preview-controller-host");
      this.target.replaceChildren();
      clearPreviewSessions();
    }
  }

  class GlobalLivePreviewDrawer {
    constructor(elements) {
      this.trigger = elements.trigger;
      this.drawer = elements.drawer;
      this.host = elements.host;
      this.heading = elements.heading;
      this.closeButton = elements.closeButton;
      this.settingsButton = elements.settingsButton;
      this.statusBadge = elements.statusBadge;
      this.statusText = elements.statusText;
      this.statusDot = elements.statusDot;
      this.shell = elements.shell;
      this.currentKey = "overview";
      this.config = null;
      this.instance = null;
      this.isOpen = false;
      this.statusKey = "current";
      this.handleTriggerClick = () => this.toggle();
      this.handleCloseClick = () => this.close();
      this.handleSettingsClick = () => {
        if (this.isOpen && this.instance && !this.instance.destroyed) this.instance.toggleSettings();
      };
      this.handleDocumentClick = this.handleDocumentClick.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.trigger.addEventListener("click", this.handleTriggerClick);
      this.closeButton.addEventListener("click", this.handleCloseClick);
      this.settingsButton.addEventListener("click", this.handleSettingsClick);
      document.addEventListener("click", this.handleDocumentClick);
      document.addEventListener("keydown", this.handleKeydown);
      const admin = bridge();
      const initial = pendingSection !== "overview"
        ? pendingSection
        : admin && typeof admin.activeSection === "function"
          ? admin.activeSection()
          : this.shell && this.shell.dataset.activeSection || "overview";
      this.updateForSection(initial);
      this.applyOpenState(false);
    }

    open() {
      if (this.isOpen || !this.config) return false;
      this.isOpen = true;
      this.applyOpenState(true);
      this.setStatus("preparing");
      this.mountOrUpdatePreview();
      window.requestAnimationFrame(() => {
        if (this.isOpen) this.closeButton.focus({ preventScroll: true });
      });
      return true;
    }

    close(options = {}) {
      if (!this.isOpen) return false;
      this.isOpen = false;
      this.closeSettings({ returnFocus: false });
      this.destroyActivePanel();
      this.applyOpenState(false);
      this.syncStatus();
      if (options.returnFocus !== false) this.trigger.focus({ preventScroll: true });
      return true;
    }

    toggle() {
      return this.isOpen ? this.close() : this.open();
    }

    updateForSection(section) {
      const nextKey = normalizeSectionKey(section);
      const sectionChanged = nextKey !== this.currentKey;
      if (sectionChanged) this.closeSettings({ returnFocus: false });
      this.currentKey = nextKey;
      this.config = resolveSectionConfig(this.currentKey);
      pendingSection = this.currentKey;
      this.heading.textContent = this.config ? this.config.title : "Önizleme bulunmuyor";
      this.trigger.disabled = !this.config && !this.isOpen;
      this.trigger.setAttribute("aria-disabled", String(!this.config));
      this.settingsButton.disabled = !this.config;

      if (!this.config) {
        this.destroyActivePanel();
        if (this.isOpen) this.renderUnavailable();
        this.setStatus("unavailable");
        return;
      }

      if (this.isOpen) {
        captureSectionHistory(this.config);
        if (pendingPublishedSnapshot && !historyState(this.config).publishedSnapshot) {
          historyState(this.config).publishedSnapshot = clone(pendingPublishedSnapshot);
        }
        this.mountOrUpdatePreview();
      } else {
        const state = historyState(this.config);
        state.status = isDraft(this.config.section) ? "draft" : "current";
        this.syncStatus();
      }
    }

    mountOrUpdatePreview() {
      if (!this.isOpen || !this.config) return null;
      const options = {
        section: this.config.section,
        historyKey: this.config.key,
        source: this.config.source,
        title: this.config.title,
        settingsButton: this.settingsButton,
        onStatus: (status) => this.setStatus(status),
        onDevice: (device) => this.syncDevice(device)
      };
      if (this.instance && !this.instance.destroyed) this.instance.update(options);
      else {
        this.host.replaceChildren();
        this.instance = new LivePreviewPanel(this.host, options);
      }
      this.syncDevice(this.instance.device);
      return this.instance;
    }

    notifyDraft() {
      if (!this.config) {
        this.setStatus("unavailable");
        return;
      }
      if (this.isOpen && this.instance && !this.instance.destroyed) this.instance.queueDraft();
      else {
        const state = historyState(this.config);
        state.status = isDraft(this.config.section) ? "draft" : "current";
        this.syncStatus();
      }
    }

    markPublished(publishedSnapshot) {
      if (this.isOpen && this.instance && !this.instance.destroyed) {
        applyPublishedToHistory(publishedSnapshot);
        this.instance.markPublished(publishedSnapshot);
      } else {
        const state = historyState(this.config);
        state.history = [];
        state.historyIndex = -1;
        state.publishedSnapshot = null;
        state.justPublished = false;
        state.status = "current";
        pendingPublishedSnapshot = null;
        this.setStatus("current");
      }
    }

    syncStatus() {
      if (!this.config) {
        this.setStatus("unavailable");
        return;
      }
      if (this.isOpen && this.instance && !this.instance.destroyed) {
        this.setStatus(this.instance.statusKey);
        return;
      }
      const state = historyState(this.config);
      const next = isDraft(this.config.section) ? "draft" : state.justPublished ? "published" : "current";
      this.setStatus(next);
    }

    setStatus(status) {
      this.statusKey = STATUS_LABELS[status] ? status : "error";
      const label = STATUS_LABELS[this.statusKey];
      const action = this.isOpen ? "Canlı önizlemeyi kapat" : "Canlı önizlemeyi aç";
      this.trigger.dataset.previewStatus = this.statusKey;
      this.statusDot.dataset.state = this.statusKey;
      this.statusBadge.dataset.state = this.statusKey;
      this.statusBadge.textContent = label;
      this.statusText.textContent = `Canlı önizleme durumu: ${label}`;
      this.trigger.setAttribute("aria-label", `${action}. Durum: ${label}.`);
    }

    syncDevice(device) {
      const value = device === "desktop" ? "desktop" : "mobile";
      this.drawer.dataset.device = value;
      if (this.shell) this.shell.dataset.globalPreviewDevice = value;
    }

    renderUnavailable() {
      this.closeSettings({ returnFocus: false });
      this.host.innerHTML = `
        <div class="global-preview-empty" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <strong>Bu bölüm için önizleme bulunmuyor</strong>
          <span>Gerçek müşteri veya personel karşılığı olan bir bölüme geçtiğinizde önizleme kullanılabilir.</span>
        </div>`;
    }

    destroyActivePanel() {
      if (this.instance) this.instance.destroy();
      this.instance = null;
      this.host.replaceChildren();
    }

    applyOpenState(open) {
      this.drawer.classList.toggle("is-open", open);
      this.drawer.setAttribute("aria-hidden", String(!open));
      this.trigger.setAttribute("aria-expanded", String(open));
      this.trigger.disabled = !this.config && !open;
      this.settingsButton.disabled = !this.config;
      if (open) this.drawer.removeAttribute("inert");
      else this.drawer.setAttribute("inert", "");
      if (this.shell) this.shell.classList.toggle("is-global-preview-open", open);
      this.setStatus(this.statusKey);
    }

    closeSettings(options = {}) {
      if (!this.instance || this.instance.destroyed) {
        this.settingsButton.setAttribute("aria-expanded", "false");
        this.settingsButton.classList.remove("is-active");
        return false;
      }
      return this.instance.closeSettings(options);
    }

    handleDocumentClick(event) {
      if (!this.isOpen || !this.instance || !this.instance.isSettingsOpen()) return;
      if (this.settingsButton.contains(event.target) || this.instance.settingsPopover.contains(event.target)) return;
      this.closeSettings();
    }

    handleKeydown(event) {
      if (event.key !== "Escape" || !this.isOpen) return;
      if (this.instance && this.instance.isSettingsOpen()) {
        event.preventDefault();
        this.closeSettings();
        return;
      }
      if (hasVisibleDialog()) return;
      event.preventDefault();
      this.close();
    }

    destroy() {
      this.close({ returnFocus: false });
      this.trigger.removeEventListener("click", this.handleTriggerClick);
      this.closeButton.removeEventListener("click", this.handleCloseClick);
      this.settingsButton.removeEventListener("click", this.handleSettingsClick);
      document.removeEventListener("click", this.handleDocumentClick);
      document.removeEventListener("keydown", this.handleKeydown);
      this.destroyActivePanel();
      clearPreviewSessions();
    }
  }

  function hasVisibleDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')).some((node) => {
      let current = node;
      while (current && current !== document.documentElement) {
        if (current.hidden || current.hasAttribute && current.hasAttribute("hidden")) return false;
        current = current.parentElement;
      }
      return true;
    });
  }

  function installGlobalDrawer() {
    if (globalDrawer) return globalDrawer;
    const elements = {
      trigger: document.querySelector("[data-global-preview-trigger]"),
      drawer: document.querySelector("[data-global-preview-drawer]"),
      host: document.querySelector("[data-global-preview-host]"),
      heading: document.querySelector("[data-global-preview-heading]"),
      closeButton: document.querySelector("[data-global-preview-close]"),
      settingsButton: document.querySelector("[data-global-preview-settings-button]"),
      statusBadge: document.querySelector("[data-global-preview-status-badge]"),
      statusText: document.querySelector("[data-global-preview-status-text]"),
      statusDot: document.querySelector("[data-global-preview-status-dot]"),
      shell: document.getElementById("panelShell")
    };
    if (!elements.trigger || !elements.drawer || !elements.host || !elements.heading
      || !elements.closeButton || !elements.settingsButton || !elements.statusBadge
      || !elements.statusText || !elements.statusDot) return null;
    globalDrawer = new GlobalLivePreviewDrawer(elements);
    return globalDrawer;
  }

  function updateSection(section) {
    pendingSection = normalizeSectionKey(section);
    const drawer = installGlobalDrawer();
    if (drawer) drawer.updateForSection(pendingSection);
    return drawer;
  }

  function compatibleMount(_target, options = {}) {
    if (options.section) updateSection(options.section);
    return installGlobalDrawer();
  }

  function handlePreviewMessage(event) {
    const instance = globalDrawer && globalDrawer.instance;
    if (!validIncomingMessage(event, instance)) return;
    window.clearTimeout(instance.ackTimer);
    if (event.data.type === ERROR_TYPE) {
      const kind = event.data.code === "token-expired" ? "token-expired" : "error";
      instance.setError(true, kind, String(event.data.message || "Önizleme taslağı uygulanamadı."));
      return;
    }
    instance.setLoading(false);
    instance.setError(false);
    instance.setStatus(event.data.draft ? "draft" : instance.historyState.justPublished ? "published" : "current");
    if (!event.data.draft) instance.historyState.justPublished = false;
  }

  window.addEventListener("message", handlePreviewMessage);

  window.TahmisciLivePreview = {
    mount: compatibleMount,
    renderFromAdmin: compatibleMount,
    open() {
      const drawer = installGlobalDrawer();
      return drawer ? drawer.open() : false;
    },
    close() {
      return globalDrawer ? globalDrawer.close() : false;
    },
    toggle() {
      const drawer = installGlobalDrawer();
      return drawer ? drawer.toggle() : false;
    },
    updateSection,
    notifyDraft() {
      const drawer = installGlobalDrawer();
      if (drawer) drawer.notifyDraft();
      else {
        const config = resolveSectionConfig(pendingSection);
        if (config) historyState(config).status = isDraft(config.section) ? "draft" : "current";
      }
    },
    markPublished(publishedSnapshot) {
      if (globalDrawer) globalDrawer.markPublished(publishedSnapshot);
      else {
        historyBySection.forEach((state) => {
          state.history = [];
          state.historyIndex = -1;
          state.publishedSnapshot = null;
          state.justPublished = false;
          state.status = "current";
        });
        pendingPublishedSnapshot = null;
      }
    },
    destroy() {
      if (globalDrawer) globalDrawer.destroy();
      globalDrawer = null;
      clearPreviewSessions();
    },
    __testing: Object.freeze({
      calculateContainScale(availableWidth, availableHeight, device = "mobile") {
        const geometry = DEVICE_GEOMETRY[device] || DEVICE_GEOMETRY.mobile;
        return calculateContainScale(availableWidth, availableHeight, geometry.outerWidth, geometry.outerHeight);
      },
      getDeviceGeometry(device = "mobile") {
        return { ...(DEVICE_GEOMETRY[device] || DEVICE_GEOMETRY.mobile) };
      },
      resolveSectionConfig(value) {
        const config = resolveSectionConfig(value);
        return config ? { ...config } : null;
      },
      getHistorySummary() {
        return Array.from(historyBySection.entries()).map(([key, state]) => ({
          key,
          length: state.history.length,
          historyIndex: state.historyIndex,
          hasPublishedSnapshot: Boolean(state.publishedSnapshot),
          source: state.source,
          device: state.device,
          status: state.status
        }));
      },
      getControllerState() {
        return {
          installed: Boolean(globalDrawer),
          open: Boolean(globalDrawer && globalDrawer.isOpen),
          section: globalDrawer ? globalDrawer.currentKey : pendingSection,
          instanceCount: globalDrawer && globalDrawer.instance ? 1 : 0,
          status: globalDrawer ? globalDrawer.statusKey : "current"
        };
      }
    })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installGlobalDrawer, { once: true });
  } else {
    installGlobalDrawer();
  }

  function readStoredDevice() {
    try {
      return window.localStorage.getItem(DEVICE_STORAGE_KEY) === "desktop" ? "desktop" : "mobile";
    } catch (_error) {
      return "mobile";
    }
  }

  function writeStoredDevice(device) {
    try {
      window.localStorage.setItem(DEVICE_STORAGE_KEY, device === "desktop" ? "desktop" : "mobile");
    } catch (_error) {}
  }

  function normalizeOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
    } catch (_error) {
      return "";
    }
  }

  function fingerprint(value) {
    try {
      return JSON.stringify(value == null ? null : value);
    } catch (_error) {
      return "";
    }
  }

  function clone(value) {
    if (value == null) return value;
    if (typeof window.structuredClone === "function") return window.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
}());
