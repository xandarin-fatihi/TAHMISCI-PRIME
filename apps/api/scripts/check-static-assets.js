"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const pages = [
  "apps/website/index.html",
  "apps/website/mudavim/index.html",
  "apps/admin/index.html",
  "apps/qr-menu/index.html",
  "apps/qr-menu/offline.html",
  "apps/personel/index.html",
  "apps/personel/offline.html",
  "apps/admin/offline.html",
  "apps/recipe/index.html",
  "apps/auth/login.html",
  "apps/auth/password-reset/index.html",
  "apps/api/public/index.html",
  "apps/api/public/password-reset.html",
  "apps/personel/stok/index.html"
];
const missing = [];
const criticalRuntimeAssets = [
  "/assets/images/recipe-vintage/cezve.svg",
  "/assets/images/recipe-vintage/cold-glass.svg",
  "/assets/images/recipe-vintage/barista.svg",
  "/assets/images/recipe-vintage/pour-over.svg",
  "/assets/images/recipe-vintage/recipe-notes.svg"
];
const criticalPwaAssets = [
  "/qr-menu/sw.js",
  "/personel/sw.js",
  "/yonetici/sw.js",
  "/qr-menu/offline.html",
  "/personel/offline.html",
  "/yonetici/offline.html",
  "/shared/scripts/pwa-client.js",
  "/shared/scripts/pwa-sw-runtime.js",
  "/shared/styles/pwa-ui.css"
];

for (const relativePage of pages) {
  const pagePath = path.join(projectRoot, relativePage);
  const html = fs.readFileSync(pagePath, "utf8");
  const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const reference of references) {
    const clean = reference.split(/[?#]/)[0].replace(/^\/+/, "");
    if (!clean || /^(?:https?:|mailto:|tel:|data:|#)/i.test(reference)) continue;
    if (!/\.[a-z0-9]{2,5}$/i.test(clean)) continue;
    const target = reference.startsWith("/")
      ? routeFile(clean)
      : path.resolve(path.dirname(pagePath), clean);
    if (target && !fs.existsSync(target)) missing.push(`${relativePage} -> ${reference}`);
  }
}

const siteIndex = fs.readFileSync(path.join(projectRoot, "apps", "website", "index.html"), "utf8");
if (/recipe-data\.js/i.test(siteIndex)) missing.push("apps/website/index.html statik recete kopyasi yukluyor");
for (const fileName of ["api/public-data-provider.js", "bootstrap/initialize-site.js"]) {
  const source = fs.readFileSync(path.join(projectRoot, "apps", "website", "scripts", fileName), "utf8");
  if (/window\.fetch\s*=/.test(source)) missing.push(`${fileName} global fetch mudalesi iceriyor`);
}

const recipeSource = fs.readFileSync(path.join(projectRoot, "apps", "recipe", "scripts", "app.js"), "utf8");
for (const reference of criticalRuntimeAssets) {
  const clean = reference.replace(/^\/+/, "");
  const target = routeFile(clean);
  if (!recipeSource.includes(reference)) missing.push(`apps/recipe/scripts/app.js kritik asset referansi eksik: ${reference}`);
  if (!target || !fs.existsSync(target)) {
    missing.push(`kritik runtime asset bulunamadi: ${reference}`);
    continue;
  }
  const source = fs.readFileSync(target, "utf8").trim();
  if (!source.startsWith("<svg") || /<script\b|<foreignObject\b|\son\w+\s*=/i.test(source)) {
    missing.push(`kritik runtime SVG gecersiz veya guvensiz: ${reference}`);
  }
}

for (const reference of criticalPwaAssets) {
  const target = routeFile(reference.replace(/^\/+/, ""));
  if (!target || !fs.existsSync(target)) missing.push(`kritik PWA asset bulunamadi: ${reference}`);
}

if (missing.length) {
  console.error(`Statik baglanti kontrolu basarisiz:\n- ${missing.join("\n- ")}`);
  process.exit(1);
}

console.log(`${pages.length} HTML dosyasindaki yerel baglantilar, ${criticalRuntimeAssets.length} kritik runtime SVG ve ${criticalPwaAssets.length} PWA yolu dogrulandi.`);

function routeFile(clean) {
  if (clean.startsWith("assets/")) return path.join(projectRoot, "public", clean);
  if (clean.startsWith("shared/")) return path.join(projectRoot, clean);
  if (clean.startsWith("styles/")) return path.join(projectRoot, "apps", "website", clean);
  if (clean.startsWith("scripts/")) return path.join(projectRoot, "apps", "website", clean);
  if (clean.startsWith("mudavim/")) return path.join(projectRoot, "apps", "website", clean);
  if (clean.startsWith("yonetici/")) return path.join(projectRoot, "apps", "admin", clean.slice("yonetici/".length));
  if (clean.startsWith("personel/")) return path.join(projectRoot, "apps", "personel", clean.slice("personel/".length));
  if (clean.startsWith("recete/")) return path.join(projectRoot, "apps", "recipe", clean.slice("recete/".length));
  if (clean.startsWith("qr-menu/")) return path.join(projectRoot, "apps", "qr-menu", clean.slice("qr-menu/".length));
  if (clean === "sw.js") return path.join(projectRoot, "apps", "website", clean);
  return path.join(projectRoot, clean);
}
