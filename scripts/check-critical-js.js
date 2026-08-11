"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const criticalFiles = [
  "apps/admin/scripts/app.js",
  "apps/admin/scripts/live-preview.js",
  "apps/admin/scripts/pricing.js",
  "apps/admin/scripts/workforce.js",
  "apps/admin/sw.js",
  "apps/personel/personel.js",
  "apps/personel/notifications.js",
  "apps/personel/workforce.js",
  "apps/personel/sw.js",
  "apps/qr-menu/scripts/app.js",
  "apps/qr-menu/sw.js",
  "apps/recipe/scripts/app.js",
  "public/assets/scripts/admin-password.js",
  "public/assets/scripts/auth-login.js",
  "public/assets/scripts/backend-password-reset.js",
  "public/assets/scripts/password-reset.js",
  "public/assets/scripts/redirect-personel.js",
  "apps/api/src/publish-routes.js",
  "apps/api/src/pricing.js",
  "apps/api/src/pricing-routes.js",
  "apps/api/src/pricing-excel.js",
  "apps/api/src/workforce-routes.js",
  "apps/api/src/admin-defaults.js",
  "apps/api/src/data-import.js",
  "apps/api/src/data-import-routes.js",
  "apps/api/src/catalog-cleanup.js",
  "apps/api/src/catalog-cleanup-routes.js",
  "apps/api/src/mail-service.js",
  "apps/api/src/notification-delivery.js",
  "apps/api/src/notification-routes.js",
  "apps/api/src/notification-scheduler.js",
  "apps/api/src/notification-service.js",
  "apps/api/src/push-service.js",
  "apps/api/src/store/product-code-registry.js",
  "shared/scripts/menu-design-schema.js",
  "shared/scripts/live-preview-receiver.js",
  "shared/scripts/save-coordinator.js",
  "shared/scripts/pwa-client.js",
  "shared/scripts/pwa-sw-runtime.js"
];

for (const relativeFile of criticalFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(projectRoot, relativeFile)], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `${relativeFile} doğrulanamadı.\n`);
    process.exit(result.status || 1);
  }
}

console.log(`${criticalFiles.length} kritik JavaScript dosyası doğrulandı.`);
