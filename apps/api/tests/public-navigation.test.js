"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const runRoot = path.join(os.tmpdir(), `tahmisci-public-nav-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATA_FILE = path.join(runRoot, "store.json");
process.env.MEDIA_DIR = path.join(runRoot, "media");
process.env.DEFAULT_PANEL_PASSWORD = "Panel123456";
process.env.DEFAULT_RECIPE_PASSWORD = "Recipe123456";
process.env.JWT_SECRET = "test-secret-that-is-longer-than-thirty-two-characters-123456789";
process.env.COOKIE_SECURE = "false";
process.env.ALLOW_LOCALHOST_ORIGINS = "true";

const { app, prepareRuntime, shutdownRuntime } = require("../src/server");

let server;
let baseUrl;
let browser;
let browserPort;
let chromeUserData;

test.before(async () => {
  await prepareRuntime();
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (browser) {
    browser.kill();
    await sleep(400);
  }
  if (chromeUserData) await fsp.rm(chromeUserData, { recursive: true, force: true });
  await shutdownRuntime(server);
  await fsp.rm(runRoot, { recursive: true, force: true });
});

test("public header navigation renders, localizes, updates with SSE and keeps fallback", async (t) => {
  // PASIF_SITE_MODULU_BASLANGIC
  return t.skip("Site modülü geçici olarak pasif.");
  // PASIF_SITE_MODULU_BITIS
  if (typeof WebSocket !== "function") return t.skip("WebSocket destekli Node gerekli.");
  const chromePath = findChrome();
  if (!chromePath) return t.skip("Chrome bulunamadı.");

  await ensureBrowser(chromePath);
  const page = await openPage();
  try {
    await navigate(page, `${baseUrl}/`);
    await waitFor(page, "() => document.querySelectorAll('.header-nav .nav-link').length === 5");

    let state = await page.evaluate(collectNavigationState());
    assert.deepEqual(state.desktopLabels, ["Ana Sayfa", "Menü", "Hakkımızda", "İletişim", "Müdavim"]);
    assert.deepEqual(state.desktopHrefs, ["#top", "#menu", "#about", "#contact", "/mudavim/"]);
    assert.equal(state.mobileCount, 5);
    assert.equal(state.mobileMenuActive, false);

    await page.evaluate("localStorage.setItem('site_language', 'en'); window.location.reload();");
    await sleep(1800);
    await waitFor(page, "() => document.querySelector('.header-nav .nav-link')?.textContent.includes('Home')");
    state = await page.evaluate(collectNavigationState());
    assert.deepEqual(state.desktopLabels, ["Home", "Menu", "About", "Contact", "Müdavim"]);

    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.evaluate("document.getElementById('mobileMenuBtn').click()");
    await waitFor(page, "() => document.getElementById('mobileNav')?.classList.contains('active')");
    state = await page.evaluate(collectNavigationState());
    assert.equal(state.mobileCount, 5);
    await page.evaluate("document.querySelector('.mobile-nav-content .mobile-nav-link[href=\"#menu\"]')?.click()");
    await waitFor(page, "() => !document.getElementById('mobileNav')?.classList.contains('active')");
    state = await page.evaluate("({ hash: location.hash, closed: !document.getElementById('mobileNav')?.classList.contains('active') })");
    assert.equal(state.hash, "#menu");
    assert.equal(state.closed, true);

    const token = await login();
    const siteState = (await json("/api/site")).body.siteState;
    siteState.header.navigation[0].label.en = "Start";
    siteState.header.navigation[3].visible = false;
    const saved = await json("/api/site", {
      method: "PUT",
      headers: adminHeaders(token),
      body: JSON.stringify({ siteState })
    });
    assert.equal(saved.response.status, 200);
    await waitFor(page, "() => Array.from(document.querySelectorAll('.header-nav .nav-link')).map((a) => a.textContent.trim()).join('|') === 'Start|Menu|About|Müdavim'");
    state = await page.evaluate(collectNavigationState());
    assert.deepEqual(state.desktopLabels, ["Start", "Menu", "About", "Müdavim"]);
    assert.equal(state.mobileCount, 4);

    const fallbackPage = await openPage({ failBootstrap: true });
    try {
      await navigate(fallbackPage, `${baseUrl}/`);
      await waitFor(fallbackPage, "() => document.querySelectorAll('.header-nav .nav-link').length === 5");
      const fallbackState = await fallbackPage.evaluate(collectNavigationState());
      assert.deepEqual(fallbackState.desktopLabels, ["Home", "Menu", "About", "Contact", "Müdavim"]);
      assert.deepEqual(fallbackState.desktopHrefs, ["#top", "#menu", "#about", "#contact", "/mudavim/"]);
    } finally {
      fallbackPage.close();
    }
  } finally {
    page.close();
  }
});

function collectNavigationState() {
  return `(() => ({
    desktopLabels: Array.from(document.querySelectorAll('.header-nav .nav-link')).map((item) => item.textContent.trim()),
    desktopHrefs: Array.from(document.querySelectorAll('.header-nav .nav-link')).map((item) => item.getAttribute('href')),
    mobileLabels: Array.from(document.querySelectorAll('.mobile-nav-content .mobile-nav-link')).map((item) => item.textContent.trim()),
    mobileCount: document.querySelectorAll('.mobile-nav-content .mobile-nav-link').length,
    mobileMenuActive: document.getElementById('mobileNav')?.classList.contains('active') === true,
    cartVisible: !!document.getElementById('mobileCartBtn') && getComputedStyle(document.getElementById('mobileCartBtn')).display !== 'none'
  }))()`;
}

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

async function login() {
  const { response, body } = await json("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ password: "Panel123456" })
  });
  assert.equal(response.status, 200);
  return body.token;
}

function adminHeaders(token) {
  return { Authorization: `Bearer ${token}`, Origin: baseUrl, "Content-Type": "application/json" };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function ensureBrowser(chromePath) {
  if (browser) return;
  browserPort = 9400 + Math.floor(Math.random() * 500);
  chromeUserData = path.join(os.tmpdir(), `tahmisci-nav-chrome-${Date.now()}`);
  browser = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${browserPort}`,
    `--user-data-dir=${chromeUserData}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { stdio: "ignore" });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${browserPort}/json/version`);
      return;
    } catch (_error) {
      await sleep(100);
    }
  }
  throw new Error("Chrome DevTools başlatılamadı.");
}

async function openPage(options = {}) {
  const target = await fetch(`http://127.0.0.1:${browserPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.open();
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Network.enable");
  if (options.failBootstrap) {
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/public/bootstrap*", requestStage: "Request" }] });
    page.on("Fetch.requestPaused", (params) => {
      page.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 500,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ ok: false })).toString("base64")
      }).catch(() => {});
    });
  }
  return page;
}

async function navigate(page, url) {
  await page.send("Page.navigate", { url });
  await sleep(2200);
}

async function waitFor(page, expression, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await page.evaluate(`(${expression})()`);
    if (result) return;
    await sleep(120);
  }
  throw new Error(`Koşul sağlanmadı: ${expression}`);
}

class CdpPage {
  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event) => this.handleMessage(event.data);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluate failed");
    return result.result.value;
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
      return;
    }
    const handlers = this.handlers.get(message.method) || [];
    handlers.forEach((handler) => handler(message.params || {}));
  }

  close() {
    try { this.ws.close(); } catch (_error) {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
