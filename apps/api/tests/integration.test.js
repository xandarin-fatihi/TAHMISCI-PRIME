"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { buildPublicBootstrap } = require("../src/public-bootstrap");
const { migrateSiteState } = require("../src/site-state");
const { createFileStore, normalizeStore } = require("../src/store/file-store");
const { loadDefaults } = require("../src/store/seed-defaults");
const { migrateStore, reconcileRecipeCatalog } = require("../src/store/migrations");
const { validateMenuState, validateSiteState } = require("../src/validators");
const menuDesignSchema = require("../../../shared/scripts/menu-design-schema");

function fixture() {
  return {
    futureSafeField: { retained: true },
    admin: { passwordHash: "hash", recipePasswordHash: "recipe-hash", customAdminField: "keep" },
    recipeUsers: [{ id: "u1", username: "barista", passwordHash: "secret-hash", active: true }],
    recipeAssignments: [{ id: "a1", userId: "u1", kind: "exam" }],
    recipeActivity: [{ id: "x1", userId: "u1", type: "exam_completed" }],
    feedbackItems: [{ id: "f1" }],
    recipeState: {
      Kahveler: {
        Latte: {
          Standart: { content: "Espresso, süt", preparation: "Gizli hazırlık", note: "Barista notu", active: true, order: 4 }
        }
      }
    },
    menuState: {
      settings: {},
      categories: [{
        id: "coffee",
        name: "Kahveler",
        active: true,
        products: [{
          id: "latte",
          name: "Latte",
          active: true,
          stock: "active",
          prices: { standard: 125 },
          details: { ingredients: "Manuel içerik", calories: "180", allergens: "Süt" }
        }]
      }]
    },
    siteState: { hero: { slides: [{ id: "one", visible: true, order: 0, title: { tr: "Başlık" } }] } }
  };
}

test("workforce revision fallback 401/403 sonrası tek oturum-sonlandı olayı üretir ve yalnız aktif bölümde başlar", async () => {
  const source = await fs.readFile(path.resolve(__dirname, "../../personel/workforce.js"), "utf8");
  const listeners = new Map();
  const intervals = new Map();
  let timerId = 0;
  let lastPollingCallback = null;
  let fetchCount = 0;
  const fetchPaths = [];
  let sessionEndedCount = 0;
  let authenticated = false;
  let unauthorizedStatus = 401;

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const document = {
    hidden: false,
    activeElement: null,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).slice().forEach((handler) => handler(event));
      return true;
    },
    getElementById() { return null; }
  };
  const window = {
    location: { search: "", origin: "http://localhost:6060" },
    setInterval(callback) {
      const id = ++timerId;
      lastPollingCallback = callback;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    setTimeout() { return 0; }
  };
  const fetch = async (path) => {
    fetchCount += 1;
    fetchPaths.push(String(path));
    return authenticated
      ? { ok: true, status: 200, json: async () => ({ ok: true, tasks: [], shipments: [], shiftRequests: [], shiftPlans: [] }) }
      : { ok: false, status: unauthorizedStatus, json: async () => ({ ok: false, message: "Personel oturumu gerekli." }) };
  };
  const context = vm.createContext({
    window,
    document,
    fetch,
    CustomEvent: FakeCustomEvent,
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: "apps/personel/workforce.js" });
  document.addEventListener("personel:session-ended", () => { sessionEndedCount += 1; });
  document.dispatchEvent(new FakeCustomEvent("DOMContentLoaded"));
  document.dispatchEvent(new FakeCustomEvent("personel:session-started", { detail: { userId: "u1" } }));
  assert.equal(intervals.size, 0, "workforce bölümü açılmadan fallback timer başlamamalı");

  document.dispatchEvent(new FakeCustomEvent("personel:section-change", { detail: { section: "tasks" } }));
  await flushPromises();
  assert.equal(fetchCount, 1);
  assert.equal(sessionEndedCount, 1);
  assert.equal(intervals.size, 0, "401 polling intervalini durdurmalı");

  lastPollingCallback();
  document.dispatchEvent(new FakeCustomEvent("personel:section-change", { detail: { section: "tasks" } }));
  await flushPromises();
  assert.equal(fetchCount, 1, "oturum bittikten sonra aynı istek tekrarlanmamalı");
  assert.equal(sessionEndedCount, 1, "oturum-sonlandı olayı yalnız bir kez gönderilmeli");

  authenticated = true;
  document.dispatchEvent(new FakeCustomEvent("personel:session-started", { detail: { userId: "u1" } }));
  assert.equal(intervals.size, 0, "başarılı yeniden giriş workforce verisini eager yüklememeli");
  document.dispatchEvent(new FakeCustomEvent("personel:section-change", { detail: { section: "tasks" } }));
  await flushPromises();
  assert.equal(fetchCount, 2);
  assert.equal(intervals.size, 1, "aktif workforce bölümünde seyrek fallback kurulmalı");
  lastPollingCallback();
  await flushPromises();
  assert.equal(fetchCount, 3, "yeniden girişten sonra revision denetimi çalışmalı");
  assert.match(fetchPaths.at(-1), /scope=revision/, "fallback tam workforce yerine küçük revision projection istemeli");

  authenticated = false;
  unauthorizedStatus = 403;
  lastPollingCallback();
  await flushPromises();
  assert.equal(fetchCount, 4);
  assert.equal(sessionEndedCount, 2, "403 yeni oturum dönemini yalnız bir kez sonlandırmalı");
  assert.equal(intervals.size, 0, "403 polling intervalini durdurmalı");
  lastPollingCallback();
  await flushPromises();
  assert.equal(fetchCount, 4, "403 sonrasında aynı istek tekrarlanmamalı");
  assert.equal(sessionEndedCount, 2);
});

test("kalıcı silme modalı yazılı onay istemez, koordinatör çift tıklamada tek işlem yürütür ve hata akışında listeyi değiştirmez", async () => {
  const [html, appSource, coordinatorSource] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../admin/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/app.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../../shared/scripts/save-coordinator.js"), "utf8")
  ]);

  assert.match(html, /id="staffDeleteModal"[\s\S]*Personeli Kalıcı Olarak Sil/);
  assert.match(html, /id="staffDeleteCloseButton"[\s\S]*data-staff-delete-close/);
  assert.match(html, /id="staffDeleteConsent"[\s\S]*Kalıcı silme işlemini anlıyorum/);
  assert.match(html, /id="staffDeleteConfirmButton"[\s\S]*disabled>Personeli Kalıcı Sil/);
  assert.match(html, /Eski görevler, atamalar ve aktivite kayıtları korunur/);

  const lifecycleStart = appSource.indexOf("function openStaffDeleteDialog");
  const lifecycleEnd = appSource.indexOf("function resetStaffUserForm", lifecycleStart);
  const lifecycleSource = appSource.slice(lifecycleStart, lifecycleEnd);
  assert.ok(lifecycleStart > 0 && lifecycleEnd > lifecycleStart);
  assert.doesNotMatch(lifecycleSource, /prompt\s*\(/);
  assert.match(lifecycleSource, /runStaffImmediateOperation\([\s\S]*staff-permanent-delete/);
  assert.match(lifecycleSource, /busyText:\s*"Siliniyor…"/);
  assert.match(lifecycleSource, /let staffDeleteBusy|staffDeleteBusy/);
  assert.match(lifecycleSource, /if \(staffDeleteBusy && options\.force !== true\) return/);
  assert.match(lifecycleSource, /function handleStaffDeleteModalClick\(event\) \{\s*if \(staffDeleteBusy\) return/);
  assert.match(lifecycleSource, /if \(!els\.staffDeleteConsent \|\| !els\.staffDeleteConsent\.checked\)/);
  assert.match(lifecycleSource, /setStaffDeleteBusy\(true\)/);
  assert.match(lifecycleSource, /staffDeleteCloseButton\.disabled = staffDeleteBusy/);
  assert.match(lifecycleSource, /staffDeleteCancelButton\.disabled = staffDeleteBusy/);
  assert.match(lifecycleSource, /staffDeleteConsent\.disabled = staffDeleteBusy/);
  assert.match(lifecycleSource, /staffDeleteConfirmButton\.disabled = staffDeleteBusy \|\| !consented/);
  assert.match(lifecycleSource, /catch \(error\) \{\s*setStaffDeleteBusy\(false\)/);
  assert.match(lifecycleSource, /closeStaffDeleteDialog\(\{ force: true, restoreFocus: false \}\)/);
  assert.match(lifecycleSource, /catch \(error\)[\s\S]*staffDeleteError/);
  assert.match(appSource, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*if \(!staffDeleteBusy\) closeStaffDeleteDialog\(\)/);
  assert.doesNotMatch(lifecycleSource, /recipeAccess\.users\s*=\s*[^;]*filter/);
  assert.ok(
    lifecycleSource.indexOf("applyStaffAccessResponse(result)") > lifecycleSource.indexOf("await runStaffImmediateOperation"),
    "kullanıcı listesi yalnız başarılı backend sonucundan sonra güncellenmeli"
  );

  const window = {};
  vm.runInNewContext(coordinatorSource, { window, Promise, TypeError }, { filename: "shared/scripts/save-coordinator.js" });
  const button = {
    innerHTML: "Personeli Kalıcı Sil",
    textContent: "Personeli Kalıcı Sil",
    disabled: false,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; }
  };
  let deleteCount = 0;
  let releaseDelete;
  const deleteOperation = () => {
    deleteCount += 1;
    return new Promise((resolve) => { releaseDelete = resolve; });
  };
  const first = window.TahmisciOperations.run("staff-permanent-delete:u1", deleteOperation, {
    button,
    busyText: "Siliniyor…",
    classification: window.TahmisciOperationClasses.IMMEDIATE
  });
  const second = window.TahmisciOperations.run("staff-permanent-delete:u1", deleteOperation, {
    button,
    busyText: "Siliniyor…",
    classification: window.TahmisciOperationClasses.IMMEDIATE
  });
  assert.equal(first, second);
  assert.equal(button.disabled, true);
  await flushPromises();
  assert.equal(deleteCount, 1);
  releaseDelete({ ok: true });
  await first;
  assert.equal(button.disabled, false);
});

test("Faz 3 canlı önizleme yalnız izinli parent origin ve eşleşen kısa ömürlü oturumu kabul eder", async () => {
  const [receiverSource, adminPreviewSource, adminAppSource, adminHtml, qrHtml, qrSource, personelHtml] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../../shared/scripts/live-preview-receiver.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/live-preview.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/app.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../qr-menu/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../qr-menu/scripts/app.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../personel/index.html"), "utf8")
  ]);

  assert.match(adminPreviewSource, /const HISTORY_LIMIT = 12/);
  assert.match(adminPreviewSource, /data-preview-undo[\s\S]*data-preview-redo[\s\S]*data-preview-revert/);
  assert.match(adminPreviewSource, /allowedOrigins[\s\S]*previewSession/);
  assert.match(adminPreviewSource, /navigate\(true\)[\s\S]*expiresAt - Date\.now\(\) - 15000/);
  assert.match(adminPreviewSource, /markPublished\(publishedSnapshot\)/);
  assert.match(adminAppSource, /markPublished\(snapshot\.previewSnapshot\)/);
  assert.match(adminAppSource, /previewSnapshot:\s*\{[\s\S]*menuState:[\s\S]*recipeState:[\s\S]*stockState:/);
  assert.doesNotMatch(adminPreviewSource, /this\.origin\s*!==\s*window\.location\.origin/);
  assert.equal((adminHtml.match(/data-global-preview-trigger/g) || []).length, 1);
  assert.equal((adminHtml.match(/data-global-preview-drawer/g) || []).length, 1);
  assert.equal((adminHtml.match(/data-global-preview-host/g) || []).length, 1);
  assert.doesNotMatch(adminHtml, /id="(?:livePreview|bulkPriceLivePreview|stockLivePreview|settingsLivePreview)"/);
  assert.doesNotMatch(adminHtml, /class="[^"]*(?:preview-column|stock-live-preview-card|settings-desktop-preview-card|live-preview-embedded)/);
  assert.doesNotMatch(adminHtml, /<iframe\b/i, "iframe yalnız çekmece açıldığında üretilmeli");
  assert.doesNotMatch(adminHtml, /id="settingsDesktopPreviewFrame"/);
  assert.match(qrHtml, /shared\/scripts\/live-preview-receiver\.js/);
  assert.match(personelHtml, /shared\/scripts\/live-preview-receiver\.js/);
  assert.doesNotMatch(qrHtml, /secret-face/);
  assert.doesNotMatch(qrSource, /secretFace|adminPanelUrl|bindSecretPanelGesture/);
  assert.match(receiverSource, /\/api\/public\/preview-session/);

  const listeners = new Map();
  const dispatched = [];
  const posted = [];
  const parent = { postMessage(message, origin) { posted.push({ message, origin }); } };
  const document = {
    referrer: "https://admin.allowed.test/yonetici/",
    addEventListener(type, handler) { listeners.set(type, handler); },
    querySelector() { return null; },
    dispatchEvent(event) { dispatched.push(event); return true; }
  };
  const window = {
    location: { search: "?preview=admin&section=stock&previewToken=short-lived-session", pathname: "/personel/" },
    parent,
    CSS: { escape(value) { return String(value); } },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const fetch = async (url) => url === "/api/public/preview-session"
    ? {
        ok: true,
        json: async () => ({ ok: true, schemaVersion: 1, mode: "stock", expiresAt: new Date(Date.now() + 60_000).toISOString() })
      }
    : {
        ok: true,
        json: async () => ({
          ok: true,
          schemaVersion: 1,
          allowedOrigins: ["https://admin.allowed.test", "https://public.allowed.test"]
        })
      };
  vm.runInNewContext(receiverSource, {
    window,
    document,
    fetch,
    CustomEvent: FakeCustomEvent,
    URL,
    URLSearchParams,
    CSS: window.CSS,
    Set,
    String,
    Array,
    Object,
    Boolean,
    Error,
    JSON,
    Date,
    Number
  }, { filename: "shared/scripts/live-preview-receiver.js" });

  await listeners.get("DOMContentLoaded")();
  await flushPromises();
  const initialPostedCount = posted.length;
  const messageHandler = listeners.get("message");
  const validData = {
    type: "tahmisci:preview-draft",
    schemaVersion: 1,
    previewSession: "short-lived-session",
    source: "personel",
    scope: "stock",
    section: "stock",
    draft: true,
    data: { stockState: { products: [] } }
  };

  await messageHandler({ source: parent, origin: "https://random.invalid", data: validData });
  assert.equal(dispatched.length, 0, "rastgele origin taslağı uygulanmamalı");
  assert.equal(posted.length, initialPostedCount, "rastgele origin yanıt kanalı açmamalı");

  await messageHandler({
    source: parent,
    origin: "https://admin.allowed.test",
    data: { ...validData, previewSession: "wrong-session" }
  });
  assert.equal(dispatched.length, 0, "yanlış preview oturumu uygulanmamalı");

  await messageHandler({ source: parent, origin: "https://admin.allowed.test", data: validData });
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, "tahmisci:preview-draft");
  assert.equal(posted.at(-1).origin, "https://admin.allowed.test");
  assert.equal(posted.at(-1).message.previewSession, "short-lived-session");
});

test("admin sidebar orta alanı görünür scrollbar olmadan açık ve daraltılmış durumda kaydırılabilir kalır", async () => {
  const [adminHtml, compactCss] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../admin/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/styles/admin-compact.css"), "utf8")
  ]);

  assert.match(adminHtml, /class="sidebar-scroll-region" tabindex="0" aria-label="Panel navigasyonu ve hızlı listeler"/);
  const scrollRule = compactCss.match(/\.admin-shell \.sidebar-scroll-region\s*\{([^}]+)\}/);
  assert.ok(scrollRule, "mevcut sidebar scroll kapsayıcısı korunmalı");
  assert.match(scrollRule[1], /overflow-y:\s*auto/);
  assert.match(scrollRule[1], /overflow-x:\s*hidden/);
  assert.match(scrollRule[1], /scrollbar-width:\s*none/);
  assert.match(scrollRule[1], /-ms-overflow-style:\s*none/);
  assert.match(scrollRule[1], /overscroll-behavior:\s*contain/);
  assert.doesNotMatch(scrollRule[1], /scrollbar-gutter/);
  assert.match(compactCss, /\.admin-shell \.sidebar-scroll-region::\-webkit-scrollbar\s*\{[^}]*display:\s*none[^}]*width:\s*0[^}]*height:\s*0/);
  assert.match(compactCss, /\.admin-shell\.is-sidebar-collapsed \.panel-nav a/);
  assert.ok(
    adminHtml.indexOf('class="sidebar-scroll-region"') < adminHtml.indexOf('class="admin-profile-wrap"'),
    "profil alanı kaydırılabilir orta alanın dışında kalmalı"
  );
});

test("Faz 4 öncesi personel sidebar geometrisi ve reçete iframe kabuğu taşmasız kalır", async () => {
  const [personelHtml, compactCss, personelSource] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../personel/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../personel/personel-compact.css"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../personel/personel.js"), "utf8")
  ]);

  assert.match(compactCss, /--personel-sidebar-open:\s*224px/);
  assert.match(compactCss, /--personel-sidebar-closed:\s*76px/);
  assert.match(compactCss, /--personel-sidebar-closed-padding:\s*10px/);
  assert.match(compactCss, /\.personel-dashboard\.is-sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*var\(--personel-sidebar-closed\)/);
  assert.match(compactCss, /\.personel-dashboard\.is-sidebar-collapsed \.personel-nav button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*box-sizing:\s*border-box/);
  assert.match(compactCss, /\.personel-dashboard\.is-sidebar-collapsed \.sidebar-user\s*\{[^}]*width:\s*44px[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
  assert.match(compactCss, /\.personel-dashboard \.personel-sidebar\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto[^}]*border-right:/);
  assert.match(compactCss, /\[data-active-section="recipe"\] \.recipe-section\s*\{[^}]*width:\s*100%[^}]*height:\s*calc\(100dvh - 56px\)[^}]*overflow:\s*hidden[^}]*border:\s*0/);
  assert.match(compactCss, /\[data-active-section="recipe"\] \.recipe-section iframe\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*border:\s*0/);
  assert.match(personelHtml, /id="recipeFrame"[^>]*src="about:blank"[^>]*data-src="\/personel\/recete-embed\/"/);
  assert.match(personelSource, /function compactRecipeFrame\(\)\s*\{[^}]*recipeFrame\.style\.height = "100%"/);
  assert.doesNotMatch(personelSource, /personelRecipeCompactStyle|resizeRecipeFrame/);
});

test("reçete ana ekranı gerçek verili vintage 3-2-1 kart düzenini yerel SVG ailesiyle kurar", async () => {
  const assetNames = ["cezve.svg", "cold-glass.svg", "barista.svg", "pour-over.svg", "recipe-notes.svg"];
  const [recipeSource, recipeCss, ...assets] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../recipe/scripts/app.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../recipe/styles/recipe.css"), "utf8"),
    ...assetNames.map((name) => fs.readFile(path.resolve(__dirname, `../../../public/assets/images/recipe-vintage/${name}`), "utf8"))
  ]);
  const groupsSource = recipeSource.slice(recipeSource.indexOf("const HOME_GROUPS"), recipeSource.indexOf("const state"));
  const renderStart = recipeSource.indexOf("function renderHome");
  const renderEnd = recipeSource.indexOf("function renderTabs", renderStart);
  const renderSource = recipeSource.slice(renderStart, renderEnd);

  ["01", "02", "03", "04", "05"].forEach((number) => assert.match(groupsSource, new RegExp(`number: "${number}"`)));
  ["SICAKLAR", "SOĞUKLAR", "TAHMİSÇİ SPECIALLER", "DEMLEMELER", "HAZIRLIK"].forEach((title) => assert.match(groupsSource, new RegExp(title)));
  assetNames.forEach((name) => assert.match(groupsSource, new RegExp(`/assets/images/recipe-vintage/${name.replace(".", "\\.")}`)));
  assert.doesNotMatch(groupsSource, /☕|✦|⌬|☷|▱|😀|📒|🧊/u);
  assert.match(renderSource, /data-recipe-home-group="\$\{group\.id\}"/);
  assert.match(renderSource, /recipe-home-illustration[\s\S]*<img src="\$\{escapeAttribute\(group\.illustration\)\}"/);
  assert.match(recipeSource, /recipeHome\.addEventListener\("error", handleHomeIllustrationError, true\)/);
  assert.match(recipeSource, /image\.hidden = true[\s\S]*is-image-missing/);
  assert.match(renderSource, /\$\{categories\.length\} kategori · \$\{entries\.length\} ürün/);
  assert.match(renderSource, /chips\.map\(\(category\)/);
  assert.match(renderSource, /recipe-home-open">Kategoriyi Aç/);
  assert.match(recipeCss, /\.recipe-home\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(recipeCss, /\.recipe-home-card\s*\{[^}]*grid-column:\s*span 2/);
  assert.match(recipeCss, /\.recipe-home-card\.is-wide\s*\{[^}]*grid-column:\s*span 3/);
  assert.match(recipeCss, /\.recipe-home-card\s*\{[^}]*grid-template:\s*"art content"[\s\S]*?"action action"/);
  assert.match(recipeCss, /\.recipe-home-content\s*\{[^}]*grid-area:\s*content[^}]*min-width:\s*0/);
  const actionRule = recipeCss.match(/\.recipe-home-open\s*\{([^}]+)\}/);
  assert.ok(actionRule);
  assert.match(actionRule[1], /grid-area:\s*action/);
  assert.match(actionRule[1], /min-height:\s*40px/);
  assert.doesNotMatch(actionRule[1], /position:\s*absolute/);
  const embedCardRule = recipeCss.match(/body\.is-personel-embed \.recipe-home-card\s*\{([^}]+)\}/);
  assert.ok(embedCardRule);
  assert.doesNotMatch(embedCardRule[1], /grid-template/);
  assert.match(recipeCss, /@media \(max-width: 1100px\)[\s\S]*\.recipe-home\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(recipeCss, /@media \(max-width: 760px\)[\s\S]*\.recipe-home,[\s\S]*\.recipe-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(recipeCss, /100vw/, "iframe ve kart genişliği viewport yerine gerçek kapsayıcıyı kullanmalı");
  assert.match(recipeCss, /body\.is-personel-embed \.recipe-header\s*\{[^}]*grid-template:\s*"tools topbar"[^}]*margin:\s*0 auto/);
  assert.match(recipeCss, /body\.is-personel-embed :is\(\.recipe-logo-box, \.recipe-title-block, \.recipe-person-row\)\s*\{[^}]*display:\s*none/);
  assert.match(recipeCss, /body\.is-personel-embed \.recipe-tools\s*\{[^}]*grid-area:\s*tools/);
  assets.forEach((source, index) => {
    assert.match(source, /^<svg\b/);
    assert.match(source, /viewBox="0 0 240 180"/);
    assert.match(source, /stroke="#6a3b25"/);
    assert.doesNotMatch(source, /<text\b|<foreignObject\b/i, `${assetNames[index]} metin veya geçici sembol içermemeli`);
  });
  for (const name of assetNames) {
    await assert.rejects(
      fs.access(path.resolve(__dirname, `../../../assets/images/recipe-vintage/${name}`)),
      `${name} yanlış proje kökü altında ikinci production kopyası olarak kalmamalı`
    );
  }
});

test("admin stok editörü işlem gruplarını tek grid sözleşmesinde tutar ve hareketi tek backend isteğiyle uygular", async () => {
  const [adminHtml, adminCss, adminSource] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../admin/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/styles/admin.css"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/app.js"), "utf8")
  ]);
  const buttonIds = [
    "stockAddCategoryButton", "stockAddProductButton", "stockAddSupplierButton",
    "stockEditorIncreaseButton", "stockEditorDecreaseButton",
    "stockDeleteProductButton", "stockDeleteCategoryButton"
  ];

  assert.match(adminHtml, /stock-editor-action-group--create[\s\S]*stock-editor-action-group--movement[\s\S]*stock-editor-action-group--danger/);
  buttonIds.forEach((id) => assert.equal((adminHtml.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} tekil kalmalı`));
  assert.equal((adminCss.match(/\.stock-editor-actions\s*\{/g) || []).length, 1, "çakışan stock-editor-actions grid'i kalmamalı");
  assert.match(adminCss, /\.stock-editor-action-group--create\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(adminCss, /\.stock-editor-action-group--movement,[\s\S]*\.stock-editor-action-group--danger\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(adminCss, /@media \(max-width: 520px\)[\s\S]*\.stock-editor-action-group--danger\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  buttonIds.forEach((id) => assert.match(adminSource, new RegExp(`${id}\\) els\\.${id}\\.addEventListener`), `${id} event bağı korunmalı`));
  const submitStart = adminSource.indexOf("async function submitStockAction");
  const submitEnd = adminSource.indexOf("function applyLocalStockMovement", submitStart);
  const submitSource = adminSource.slice(submitStart, submitEnd);
  assert.match(adminSource, /stockActionSubmitting:\s*false/);
  assert.match(submitSource, /if \(!state\.stockAction \|\| state\.stockActionSubmitting\) return/);
  assert.match(submitSource, /state\.stockActionSubmitting = true/);
  assert.match(submitSource, /backendRequest\("\/api\/stock\/movements",\s*\{ method: "POST"/);
  assert.match(submitSource, /state\.stock = normalizeStockStateForAdmin\(result\.stockState\)/);
  assert.match(submitSource, /coordinator\.run\(operationKey, executeMovement/);
  assert.match(submitSource, /finally \{\s*state\.stockActionSubmitting = false/);
});

test("Faz 3-4 global canlı önizleme tekil, lazy ve bölüm geçmişi ayrılmış çalışır", async () => {
  const [source, adminHtml, appSource, pricingSource, componentCss] = await Promise.all([
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/live-preview.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/index.html"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/app.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/scripts/pricing.js"), "utf8"),
    fs.readFile(path.resolve(__dirname, "../../admin/styles/admin-components.css"), "utf8")
  ]);

  assert.equal((source.match(/new LivePreviewPanel\(/g) || []).length, 1, "yalnız tek instance üretim yolu olmalı");
  assert.equal((source.match(/<iframe\s+data-preview-frame/g) || []).length, 1, "yalnız tek iframe şablonu olmalı");
  assert.match(source, /const historyBySection = new Map\(\)/);
  assert.match(source, /destroy\(\)[\s\S]*resizeObserver\.disconnect\(\)[\s\S]*about:blank[\s\S]*sessionToken = ""/);
  assert.match(source, /this\.destroyed \|\| navigationId !== this\.navigationId/);
  assert.match(source, /clearPreviewSessions\(\)/);
  assert.match(source, /this\.trigger\.dataset\.previewStatus = this\.statusKey/);
  assert.match(source, /this\.statusDot\.dataset\.state = this\.statusKey/);
  assert.match(source, /this\.trigger\.setAttribute\("aria-label", `\$\{action\}\. Durum: \$\{label\}\.`\)/);
  assert.match(source, /data-preview-device-fit/);
  assert.match(source, /data-preview-device-shell/);
  assert.match(source, /data-preview-device-viewport/);
  assert.match(source, /live-preview-device__camera/);
  assert.match(source, /live-preview-device__gesture/);
  assert.match(source, /live-preview-device__stand/);
  assert.match(source, /safeWidth \/ safeOuterWidth, safeHeight \/ safeOuterHeight/);
  assert.match(source, /this\.deviceShell\.style\.transform = `scale\(\$\{scale\}\)`/);
  assert.match(source, /this\.frame\.style\.transform = "none"/);
  assert.match(source, /data-preview-settings/);
  assert.match(source, /data-preview-settings-dismiss/);
  assert.match(source, /data-preview-source-group/);
  assert.match(source, /data-preview-device-note/);
  assert.match(source, /data-preview-undo/);
  assert.match(source, /data-preview-redo/);
  assert.match(source, /data-preview-revert/);
  assert.match(source, /data-preview-route/);
  assert.match(source, /handleDocumentClick\(event\)/);
  assert.match(source, /this\.instance\.isSettingsOpen\(\)/);
  assert.match(source, /this\.statusBadge\.dataset\.state = this\.statusKey/);
  assert.match(source, /layoutKey === this\.lastScaleLayout/);
  assert.doesNotMatch(source, /<header class="live-preview-panel__head"/);
  assert.doesNotMatch(source, /class="live-preview-panel__toolbar"/);
  assert.doesNotMatch(source, /class="live-preview-panel__foot"/);
  assert.doesNotMatch(source, /window\.innerHeight|this\.stage\.style\.height/);
  const panelRule = componentCss.match(/\.live-preview-panel\s*\{([^}]+)\}/);
  assert.ok(panelRule, "önizleme paneli stili bulunmalı");
  assert.match(panelRule[1], /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(panelRule[1], /auto\s+auto/);
  const stageRule = componentCss.match(/\.live-preview-panel__stage\s*\{([^}]+)\}/);
  assert.ok(stageRule, "cihaz sahnesi stili bulunmalı");
  assert.match(stageRule[1], /height:\s*100%/);
  assert.match(stageRule[1], /min-height:\s*0/);
  assert.match(stageRule[1], /overflow:\s*hidden/);
  assert.doesNotMatch(stageRule[1], /max-height|overflow:\s*auto/);
  assert.match(componentCss, /\.global-preview-drawer__host\.live-preview-controller-host\s*\{[^}]*overflow:\s*hidden/);
  assert.match(componentCss, /\.live-preview-settings-backdrop\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*4/);
  const settingsRule = componentCss.match(/\.live-preview-settings\s*\{([^}]+)\}/);
  assert.ok(settingsRule, "önizleme ayarları popover stili bulunmalı");
  assert.match(settingsRule[1], /position:\s*absolute/);
  assert.match(settingsRule[1], /overflow-y:\s*auto/);
  assert.doesNotMatch(source, /const instances = new Map\(\)/);
  assert.doesNotMatch(appSource, /stockLivePreview|settingsLivePreview|renderStockLivePreview|renderSettingsPreview/);
  assert.doesNotMatch(pricingSource, /bulkPriceLivePreview|mountBulkPreview/);
  assert.equal((adminHtml.match(/data-global-preview-trigger/g) || []).length, 1);
  assert.equal((adminHtml.match(/data-global-preview-host/g) || []).length, 1);
  assert.equal((adminHtml.match(/data-global-preview-settings-button/g) || []).length, 1);
  assert.equal((adminHtml.match(/data-global-preview-status-badge/g) || []).length, 1);
  assert.match(adminHtml, /data-global-preview-settings-button[\s\S]*aria-controls="globalLivePreviewSettings"[\s\S]*aria-expanded="false"/);
  assert.match(adminHtml, /data-global-preview-settings-button[\s\S]*<svg[^>]*aria-hidden="true"/);

  let backendRequests = 0;
  let dirty = false;
  const listeners = new Map();
  const document = {
    readyState: "loading",
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    documentElement: {}
  };
  const window = {
    location: { href: "https://admin.allowed.test/yonetici/", origin: "https://admin.allowed.test", hostname: "admin.allowed.test", port: "", protocol: "https:" },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame(callback) { callback(); },
    innerHeight: 900,
    localStorage: { getItem() { return null; }, setItem() {} },
    structuredClone(value) { return JSON.parse(JSON.stringify(value)); },
    TahmisciAdminBridge: {
      snapshot() {
        return {
          menuState: { categories: [{ id: "menu" }] },
          recipeState: { Kahve: {} },
          stockState: { products: [{ id: "stock" }] }
        };
      },
      isScopeDirty() { return dirty; },
      hasPendingChanges() { return dirty; },
      async backendRequest() { backendRequests += 1; return {}; }
    }
  };

  vm.runInNewContext(source, {
    window,
    document,
    URL,
    URLSearchParams,
    Set,
    Map,
    Object,
    Array,
    String,
    Boolean,
    Number,
    Date,
    JSON,
    Error
  }, { filename: "apps/admin/scripts/live-preview.js" });

  const api = window.TahmisciLivePreview;
  const mobileGeometry = api.__testing.getDeviceGeometry("mobile");
  const desktopGeometry = api.__testing.getDeviceGeometry("desktop");
  assert.equal(mobileGeometry.sourceWidth, 390);
  assert.equal(mobileGeometry.sourceHeight, 844);
  assert.equal(desktopGeometry.sourceWidth, 1440);
  assert.equal(desktopGeometry.sourceHeight, 900);
  const mobileScale = api.__testing.calculateContainScale(390, 520, "mobile");
  const desktopScale = api.__testing.calculateContainScale(760, 510, "desktop");
  assert.ok(Number.isFinite(mobileScale) && mobileScale > 0 && mobileScale <= 1);
  assert.ok(Number.isFinite(desktopScale) && desktopScale > 0 && desktopScale <= 1);
  assert.ok(mobileGeometry.outerWidth * mobileScale <= 390);
  assert.ok(mobileGeometry.outerHeight * mobileScale <= 520);
  assert.ok(desktopGeometry.outerWidth * desktopScale <= 760);
  assert.ok(desktopGeometry.outerHeight * desktopScale <= 510);
  const menuConfig = api.__testing.resolveSectionConfig("menu");
  assert.equal(menuConfig.key, "menu");
  assert.equal(menuConfig.section, "menu");
  assert.equal(menuConfig.source, "menu");
  assert.equal(menuConfig.title, "Menü Görünümü");
  assert.equal(api.__testing.resolveSectionConfig("overview"), null);
  assert.equal(api.__testing.resolveSectionConfig("feedback"), null);
  assert.equal(api.__testing.resolveSectionConfig("stock").source, "personel");
  assert.equal(api.__testing.resolveSectionConfig("recipe").section, "recipe");
  assert.equal(api.__testing.resolveSectionConfig("shipments").section, "shipment");

  api.updateSection("menu");
  api.notifyDraft();
  dirty = true;
  api.notifyDraft();
  api.updateSection("stock");
  api.notifyDraft();
  api.updateSection("menu");
  assert.doesNotThrow(() => api.markPublished({
    menuState: { categories: [{ id: "menu" }] },
    recipeState: { Kahve: {} },
    stockState: { products: [{ id: "stock" }] }
  }));

  const histories = api.__testing.getHistorySummary();
  const menuHistory = histories.find((entry) => entry.key === "menu");
  const stockHistory = histories.find((entry) => entry.key === "stock");
  assert.ok(menuHistory && stockHistory, "menü ve stok geçmişleri ayrı Map kayıtları olmalı");
  assert.equal(menuHistory.source, "menu");
  assert.equal(stockHistory.source, "personel");
  assert.ok(menuHistory.length <= 12 && stockHistory.length <= 12);
  assert.equal(api.__testing.getControllerState().instanceCount, 0, "kapalı çekmece iframe instance başlatmamalı");
  assert.equal(backendRequests, 0, "kapalı çekmece preview token istememeli");
});

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("store normalizasyonu uygulama verisini ve bilinmeyen güvenli alanları korur", () => {
  const migrated = migrateStore(fixture());
  assert.equal(migrated.futureSafeField.retained, true);
  assert.equal(migrated.recipeUsers[0].username, "barista");
  assert.equal(migrated.recipeAssignments[0].kind, "exam");
  assert.equal(migrated.recipeActivity[0].type, "exam_completed");
  assert.equal(migrated.admin.customAdminField, "keep");
  const item = migrated.recipeState.Kahveler.Latte.Standart;
  assert.deepEqual({ note: item.note, active: item.active, order: item.order }, { note: "Barista notu", active: true, order: 4 });
  assert.deepEqual(migrateStore(migrated), migrated, "migration idempotent olmalı");
});

test("ortak tasarım şeması eski kayıtları koruyucu ve idempotent biçimde taşır", () => {
  const legacy = {
    settings: {
      designPresetVersion: "tahmisci-20260522a",
      bgColor: "#71e52e",
      accentColor: "#659a78",
      fonts: { title: "Özel Font" },
      typography: { menuTitle: 41 },
      banner: {
        mode: "video",
        title: "Özel banner",
        videos: ["https://cdn.example.test/banner.mp4"],
        images: [{ id: "hero", src: "/media/hero.jpg", name: "Hero" }],
        productIds: ["latte"]
      }
    },
    categories: [{
      id: "coffee",
      name: "Kahveler",
      color: "#123456",
      style: {
        type: "image",
        imageUrl: "https://cdn.example.test/category.jpg",
        gradientStart: "#102030",
        gradientEnd: "#405060",
        gradientAngle: 123,
        overlay: 0.42
      },
      products: [{
        id: "latte",
        name: "Latte",
        cardColor: "#654321",
        imageUrl: "/media/latte.jpg",
        imageOverlay: 0.27,
        style: {
          type: "gradient",
          color: "#654321",
          gradientStart: "#111111",
          gradientEnd: "#222222",
          gradientAngle: 87,
          overlay: 0.27
        }
      }]
    }]
  };
  const original = JSON.parse(JSON.stringify(legacy));
  const normalized = menuDesignSchema.normalizeMenuState(legacy);

  assert.deepEqual(legacy, original, "normalizasyon giriş nesnesini değiştirmemeli");
  assert.equal(normalized.settings.designSchemaVersion, 2);
  assert.equal(normalized.settings.appliedPresetId, "tahmisci-legacy-green");
  assert.equal(normalized.settings.bgColor, "#71e52e");
  assert.equal(normalized.settings.accentColor, "#659a78");
  assert.equal(normalized.settings.fonts.title, "Özel Font");
  assert.equal(normalized.settings.typography.menuTitle, 41);
  assert.equal(normalized.settings.banner.videos[0].src, "https://cdn.example.test/banner.mp4");
  assert.equal(normalized.categories[0].style.imageUrl, "https://cdn.example.test/category.jpg");
  assert.equal(normalized.categories[0].products[0].style.gradientAngle, 87);
  assert.equal(validateMenuState(normalized), "");
  assert.deepEqual(menuDesignSchema.normalizeMenuState(normalized), normalized);
});

test("file store kullanıcı, atama ve aktiviteyi yazıp tekrar okur", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tahmisci-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createFileStore(path.join(directory, "store.json"), {
    defaultPanelPassword: "Panel123456",
    defaultRecipePassword: "Recipe123456",
    bcryptRounds: 10
  });
  await store.ensure();
  await store.update((data) => {
    data.recipeUsers.push({ id: "u1", username: "barista", passwordHash: "hash", active: true });
    data.recipeAssignments.push({ id: "a1", userId: "u1", kind: "homework" });
    data.recipeActivity.push({ id: "x1", userId: "u1", type: "homework_created" });
    data.recipeState = fixture().recipeState;
    return data;
  });
  const reloaded = await store.read();
  assert.equal(reloaded.recipeUsers[0].id, "u1");
  assert.equal(reloaded.recipeAssignments[0].id, "a1");
  assert.equal(reloaded.recipeActivity[0].id, "x1");
  assert.equal(reloaded.recipeState.Kahveler.Latte.Standart.note, "Barista notu");
});

test("ilk güvenli eşleştirme yalnızca benzersiz tam adları bağlar", () => {
  const unique = migrateStore(fixture());
  const product = unique.menuState.categories[0].products[0];
  assert.equal(product.contentMode, "recipe");
  assert.ok(product.recipeId);
  assert.equal(product.recipeLinkStatus, "linked");

  const duplicate = fixture();
  duplicate.recipeState.Buzlular = { Latte: { "16 oz": { content: "Soğuk içerik", preparation: "Gizli" } } };
  const ambiguous = migrateStore(duplicate);
  const ambiguousProduct = ambiguous.menuState.categories[0].products[0];
  assert.equal(ambiguousProduct.recipeId, "");
  assert.equal(ambiguousProduct.contentMode, "manual");
  assert.equal(ambiguous.recipeLinkReview[0].reason, "ambiguous");
});

test("public bootstrap fiyat/aktiflik ve güvenli reçete içeriğini doğru projekte eder", () => {
  const data = migrateStore(fixture());
  const first = buildPublicBootstrap(data);
  const product = first.menu.products[0];
  assert.equal(product.basePrice, 125);
  assert.equal(product.content, "Espresso, süt");
  const encoded = JSON.stringify(first);
  assert.equal(encoded.includes("Gizli hazırlık"), false);
  assert.equal(encoded.includes("Barista notu"), false);
  assert.equal(encoded.includes("recipeUsers"), false);
  assert.equal(encoded.includes("passwordHash"), false);

  data.recipeState.Kahveler.Latte.Standart.content = "Espresso, yulaf sütü";
  assert.equal(buildPublicBootstrap(data).menu.products[0].content, "Espresso, yulaf sütü");

  data.menuState.categories[0].products[0].active = false;
  assert.equal(buildPublicBootstrap(data).menu.productCount, 0);
});

test("public bootstrap güvenli tasarım allowlistini taşır ve canonical store'u değiştirmez", () => {
  const data = migrateStore(fixture());
  data.menuState.settings = {
    designSchemaVersion: 2,
    appliedPresetId: "integration-custom",
    bgColor: "#102030",
    darkBgColor: "#080604",
    accentColor: "#a04f2a",
    textColor: "#2c1609",
    buttonTextColor: "#fffaf3",
    cardColor: "rgba(255,250,243,.9)",
    productCardColor: "#fff8ee",
    categoryCardColor: "#f0dfcc",
    socialIconColor: "#64351f",
    socialIconSize: 34,
    menuBackgroundImage: "/media/menu-background.jpg",
    menuBackground: {
      type: "image",
      image: "/media/menu-background.jpg",
      imageUrl: "file:///C:/private/menu.jpg",
      gradientStart: "#102030",
      gradientEnd: "#405060",
      gradientAngle: 120,
      overlay: 0.31
    },
    fonts: { title: "Özel Başlık", category: "Özel Kategori", product: "Özel Ürün" },
    typography: { menuTitle: 41, categoryTitle: 27, productTitle: 17, productDesc: 12, productIngredients: 11, productPrice: 14 },
    bottomActions: {
      popular: { type: "solid", color: "#4a2414", gradientStart: "#4a2414", gradientEnd: "#5a2d1a", gradientAngle: 10, overlay: 0 },
      suggest: { type: "image", color: "#5a2d1a", imageUrl: "/media/suggest.jpg", gradientStart: "#5a2d1a", gradientEnd: "#6a3d2a", gradientAngle: 25, overlay: 0.2 }
    },
    banner: {
      mode: "images",
      title: "Günün seçkisi",
      subtitle: "Özel sunum",
      video: "/media/banner.mp4",
      videoUrl: "https://cdn.example.test/banner.mp4",
      videos: [{ id: "video-one", src: "https://cdn.example.test/banner.mp4", name: "Banner", adminOnly: "secret" }],
      images: [
        { id: "image-one", src: "/media/banner.jpg", name: "Banner görseli", editorToken: "secret" },
        { id: "unsafe", src: "file:///C:/private/banner.jpg", name: "Yerel dosya" }
      ],
      productIds: ["latte"]
    },
    menuUpdateDate: "2026-08-02",
    adminEditorToken: "must-not-leak"
  };
  const category = data.menuState.categories[0];
  category.color = "#3d2418";
  category.image = "/media/category.jpg";
  category.style = { type: "gradient", color: "#3d2418", image: "", imageUrl: "", gradientStart: "#3d2418", gradientEnd: "#76513c", gradientAngle: 135, overlay: 0.22, editorOnly: true };
  const product = category.products[0];
  product.cardColor = "#fff4e5";
  product.imageUrl = "/media/latte.jpg";
  product.imageOverlay = 0.18;
  product.style = { type: "image", color: "#fff4e5", image: "", imageUrl: "/media/product-card.jpg", gradientStart: "#fff4e5", gradientEnd: "#ead0b2", gradientAngle: 145, overlay: 0.18, internalNote: "secret" };
  const before = JSON.stringify(data);

  const bootstrap = buildPublicBootstrap(data);
  assert.equal(JSON.stringify(data), before, "public read canonical store'u mutate etmemeli");
  assert.equal(bootstrap.menu.settings.bgColor, "#102030");
  assert.equal(bootstrap.menu.settings.fonts.title, "Özel Başlık");
  assert.equal(bootstrap.menu.settings.typography.menuTitle, 41);
  assert.equal(bootstrap.menu.settings.menuBackground.image, "/media/menu-background.jpg");
  assert.equal(bootstrap.menu.settings.menuBackground.imageUrl, "", "yerel dosya yolu projekte edilmemeli");
  assert.equal(bootstrap.menu.settings.banner.images.length, 1);
  assert.deepEqual(Object.keys(bootstrap.menu.settings.banner.images[0]).sort(), ["id", "kind", "name", "size", "src", "type"]);
  assert.equal(bootstrap.menu.categories[0].style.gradientStart, "#3d2418");
  assert.equal(bootstrap.menu.products[0].cardColor, "#fff4e5");
  assert.equal(bootstrap.menu.products[0].style.imageUrl, "/media/product-card.jpg");
  const encoded = JSON.stringify(bootstrap);
  assert.equal(encoded.includes("must-not-leak"), false);
  assert.equal(encoded.includes("editorOnly"), false);
  assert.equal(encoded.includes("internalNote"), false);
  assert.equal(encoded.includes("C:/private"), false);
});

test("menu tasarım doğrulaması bozuk nested yapı ve güvensiz medyayı reddeder", () => {
  const valid = menuDesignSchema.normalizeMenuState(fixture().menuState);
  assert.equal(validateMenuState(valid), "");

  const invalidStyle = JSON.parse(JSON.stringify(valid));
  invalidStyle.categories[0].style = [];
  assert.match(validateMenuState(invalidStyle), /style nesne/i);

  const invalidBanner = JSON.parse(JSON.stringify(valid));
  invalidBanner.settings.banner.images = ["file:///C:/private/banner.jpg"];
  assert.match(validateMenuState(invalidBanner), /guvensiz medya|guvenli bir image/i);

  const invalidTypography = JSON.parse(JSON.stringify(valid));
  invalidTypography.settings.typography.menuTitle = Infinity;
  assert.match(validateMenuState(invalidTypography), /typography\.menuTitle/i);
});

test("stable reçete bağlantısı ad değişikliğinde, manuel ve gizli modlarda çalışır", () => {
  const data = migrateStore(fixture());
  const product = data.menuState.categories[0].products[0];
  const stableId = product.recipeId;
  data.recipeState.Kahveler["Latte Yeni"] = data.recipeState.Kahveler.Latte;
  delete data.recipeState.Kahveler.Latte;
  data.recipeCatalog = data.recipeCatalog.map((item) => item.id === stableId ? { ...item, product: "Latte Yeni" } : item);
  data.recipeCatalog = reconcileRecipeCatalog(data.recipeState, data.recipeCatalog);
  assert.equal(buildPublicBootstrap(data).menu.products[0].content, "Espresso, süt");

  product.contentMode = "manual";
  product.manualContent = "Manuel yayın";
  assert.equal(buildPublicBootstrap(data).menu.products[0].content, "Manuel yayın");
  product.contentMode = "hidden";
  assert.equal(buildPublicBootstrap(data).menu.products[0].content, "");
});

test("siteState sürümlenir, restart normalizasyonunda korunur ve zararlı içerik reddedilir", () => {
  const state = migrateSiteState({ hero: { slides: [{ id: "main", visible: true, order: 0, title: { tr: "Yeni hero" } }] } });
  state.about.description.tr = "Yeni hakkımızda";
  const reloaded = normalizeStore({ ...fixture(), siteState: state });
  assert.equal(reloaded.siteState.schemaVersion, 3);
  assert.equal(reloaded.siteState.about.description.tr, "Yeni hakkımızda");
  assert.match(validateSiteState({ ...state, seo: { ...state.seo, canonicalUrl: "javascript:alert(1)" } }), /guvensiz/);
  assert.match(validateSiteState({ ...state, about: { ...state.about, description: { tr: "<img onerror=alert(1)>" } } }), /guvensiz/);
});

test("eski Windows lokal seedindeki bozuk Türkçe varsayılanlar veri kaybetmeden onarılır", () => {
  const migrated = migrateSiteState({
    header: { navigation: [
      { id: "home", label: { tr: "Ana Sayfa", en: "Home" }, url: "#top", visible: true, order: 0 },
      { id: "menu", label: { tr: "Men?", en: "Menu" }, url: "#menu", visible: true, order: 1 }
    ] },
    hero: { slides: [{
      id: "hero-main",
      title: { tr: "Kahvenin iyi hali", en: "Coffee at its best" },
      description: { tr: "?zenle hazirlanan kahveler ve g?n?n her anina eslik eden lezzetler.", en: "Carefully prepared coffees and flavors for every moment of the day." },
      buttonText: { tr: "Men?y? Kesfet", en: "Explore the Menu" }
    }] },
    about: { title: { tr: "Yönetici tarafından yazılmış özel başlık?", en: "Custom" } }
  });

  assert.equal(migrated.header.navigation[1].label.tr, "Menü");
  assert.equal(migrated.hero.slides[0].description.tr, "Özenle hazırlanan kahveler ve günün her anına eşlik eden lezzetler.");
  assert.equal(migrated.hero.slides[0].buttonText.tr, "Menüyü Keşfet");
  assert.equal(migrated.about.title.tr, "Yönetici tarafından yazılmış özel başlık?");
});

test("Müdavim duyuruları sıralı bloklarla korunur ve public çıktıda yalnızca yayınlanan içerik görünür", () => {
  const data = migrateStore(fixture());
  data.siteState = migrateSiteState(data.siteState);
  data.siteState.mudavim.announcements = [
    {
      id: "taslak",
      title: "Taslak duyuru",
      slug: "taslak-duyuru",
      order: 0,
      isPublished: false,
      blocks: [{ id: "taslak-metin", type: "text", content: "Yayınlanmamalı", order: 0 }]
    },
    {
      id: "yayinda",
      title: "Yayındaki duyuru",
      slug: "yayindaki-duyuru",
      order: 1,
      isPublished: true,
      blocks: [
        { id: "yayinda-gorsel", type: "image", imageUrl: "/media/duyuru.webp", alt: "Duyuru", order: 1 },
        { id: "yayinda-metin", type: "text", content: "Önce metin", order: 0 },
        {
          id: "yayinda-gorsel-metin",
          type: "image-text",
          badge: "YENİ",
          date: "2026-07-19",
          heading: "Yeni sezon",
          body: "Görsel solda, metin sağda.",
          imageUrl: "/media/yeni-sezon.webp",
          alt: "Yeni sezon duyurusu",
          order: 2
        },
        {
          id: "yayinda-metin-gorsel",
          type: "text-image",
          badge: "ETKİNLİK",
          heading: "Atölye buluşması",
          body: "Metin solda, görsel sağda.",
          imageUrl: "/media/atolye.webp",
          order: 3
        }
      ]
    }
  ];

  const normalized = normalizeStore(data);
  assert.equal(normalized.siteState.mudavim.announcements.length, 2);
  const publicAnnouncements = buildPublicBootstrap(normalized).siteState.mudavim.announcements;
  assert.equal(publicAnnouncements.length, 1);
  assert.equal(publicAnnouncements[0].id, "yayinda");
  assert.deepEqual(publicAnnouncements[0].blocks.map((block) => block.type), ["text", "image", "image-text", "text-image"]);
  assert.equal(publicAnnouncements[0].blocks[2].badge, "YENİ");
  assert.equal(publicAnnouncements[0].blocks[2].heading, "Yeni sezon");
  assert.equal(publicAnnouncements[0].blocks[2].body, "Görsel solda, metin sağda.");
  assert.equal("content" in publicAnnouncements[0].blocks[2], false);
  assert.equal(JSON.stringify(publicAnnouncements).includes("Yayınlanmamalı"), false);
  assert.match(validateSiteState({
    ...normalized.siteState,
    mudavim: {
      announcements: [{
        id: "zararli",
        title: "Zararlı",
        isPublished: true,
        blocks: [{ id: "gorsel", type: "image", imageUrl: "javascript:alert(1)" }]
      }]
    }
  }), /guvensiz/);
});

test("başlangıç katalog kaynağı boş kalır ve gömülü gerçek işletme verisi okunmaz", async () => {
  const defaults = await loadDefaults(path.resolve(__dirname, "..", ".."));
  const count = defaults.menuState.categories.reduce((total, category) => total + category.products.length, 0);
  assert.equal(defaults.menuState.categories.length, 0);
  assert.equal(count, 0);
  assert.equal(Object.keys(defaults.recipeState).length, 0);
});

test("admin varsayılan arayüzü sistem ve cihaz kapsamını ayırır, erişilebilir modalı korur", async () => {
  const root = path.resolve(__dirname, "..", "..", "..");
  const [html, source] = await Promise.all([
    fs.readFile(path.join(root, "apps", "admin", "index.html"), "utf8"),
    fs.readFile(path.join(root, "apps", "admin", "scripts", "app.js"), "utf8")
  ]);
  assert.match(html, /id="saveAdminMenuDefaultButton"[^>]*>Yönetici Varsayılanı Olarak Kaydet/);
  assert.match(html, /id="restoreMenuDefaultButton"[^>]*>Varsayılana Dön/);
  assert.match(html, /id="settingsResetDeviceButton"[^>]*>Bu Cihazın Ayarlarını Sıfırla/);
  assert.match(html, /id="settingsSaveSystemDefaultButton"/);
  assert.match(html, /aria-modal="true"[^>]*aria-labelledby="defaultChoiceTitle"[^>]*aria-describedby="defaultChoiceDescription"/);
  assert.match(source, /backendRequest\("\/api\/admin\/defaults\/menu-design"/);
  assert.match(source, /MENU_DESIGN_SCHEMA\.createFactoryDesignSnapshot/);
  assert.match(source, /MENU_DESIGN_SCHEMA\.applyDesignSnapshot/);
  assert.match(source, /if \(event\.key === "Tab"\) trapDefaultChoiceFocus\(event\)/);
  assert.match(source, /if \(event\.key === "Escape"\)/);
  assert.doesNotMatch(source, /safeLocalSet\(CUSTOM_DEFAULT_KEY/);
});

test("üç uygulama bağımsız PWA kimliği kullanır ve menü favicon zinciri korunur", async () => {
  const root = path.resolve(__dirname, "..", "..", "..");
  const definitions = [
    ["qr-menu", "Tahmisçi Dijital Menü", "/", "/qr-menu/manifest.webmanifest", "menu"],
    ["personel", "Tahmisçi Personel", "/personel/", "/personel/manifest.webmanifest", "personel"],
    ["admin", "Tahmisçi Yönetici", "/yonetici/", "/yonetici/manifest.webmanifest", "yonetici"]
  ];

  for (const [folder, name, route, manifestHref, iconFamily] of definitions) {
    const [html, manifestSource] = await Promise.all([
      fs.readFile(path.join(root, "apps", folder, "index.html"), "utf8"),
      fs.readFile(path.join(root, "apps", folder, "manifest.webmanifest"), "utf8")
    ]);
    const manifest = JSON.parse(manifestSource);
    assert.equal(manifest.name, name);
    assert.equal(manifest.id, route);
    assert.equal(manifest.start_url, route);
    assert.equal(manifest.scope, route);
    assert.match(html, new RegExp(`rel="manifest" href="${manifestHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(html, new RegExp(`/assets/app-icons/${iconFamily}/favicon-32\\.png`));
    assert.match(html, new RegExp(`/assets/app-icons/${iconFamily}/apple-touch-icon-180\\.png`));
    assert.match(html, /name="theme-color" content="#5a2f1d"/);
  }

  const faviconProvider = await fs.readFile(path.join(root, "apps", "website", "scripts", "api", "public-data-provider.js"), "utf8");
  const headerNavigation = await fs.readFile(path.join(root, "apps", "website", "scripts", "components", "header-navigation.js"), "utf8");
  assert.match(faviconProvider, /seo\.favicon/);
  assert.match(faviconProvider, /link\[rel="icon"\]/);
  assert.match(headerNavigation, /applyFavicon\(cfg\.favicon_url\)/);
  assert.match(headerNavigation, /navigator\.serviceWorker\.register/);
  assert.doesNotMatch(headerNavigation, /cache-first|caches\.open/i);
});

test("Shift Yönetimi tek geometri kaynağıyla taşmasız grid ve mevcut backend eylemlerini korur", async () => {
  const root = path.resolve(__dirname, "..", "..", "..");
  const [mainCss, compactCss, workforceSource] = await Promise.all([
    fs.readFile(path.join(root, "apps", "admin", "styles", "admin.css"), "utf8"),
    fs.readFile(path.join(root, "apps", "admin", "styles", "admin-compact.css"), "utf8"),
    fs.readFile(path.join(root, "apps", "admin", "scripts", "workforce.js"), "utf8")
  ]);

  assert.match(mainCss, /grid-template-columns:\s*minmax\(240px, 250px\) minmax\(0, 1fr\) minmax\(280px, 296px\)/);
  assert.match(mainCss, /\.workforce-shift-templates > label > span:last-child\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
  assert.match(mainCss, /\.workforce-shift-grid\s*{[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*visible/s);
  assert.match(mainCss, /\.workforce-request-list > \.workforce-list-heading > span\s*{[^}]*flex:\s*0 0 auto[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(compactCss, /\.workforce-shift-layout\s*{[^}]*grid-template-columns/s);
  assert.doesNotMatch(compactCss, /grid-template-columns:\s*(?:170|180|190|205|230)px[^;]*;/);
  assert.match(workforceSource, /data-template="morning\.startTime"[^>]*>[\s\S]*?<span aria-hidden="true">–<\/span>[\s\S]*?data-template="morning\.endTime"/);
  assert.match(workforceSource, /api\(`\/api\/admin\/workforce\/shift-requests\/\$\{encodeURIComponent\(id\)\}\/\$\{decision\}`/);
  assert.match(workforceSource, /api\(`\/api\/admin\/workforce\/shifts\/\$\{encodeURIComponent\(state\.weekStart\)\}`/);
});
