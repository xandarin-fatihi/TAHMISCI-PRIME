"use strict";

// Production secrets and writable paths must be injected from an environment
// file stored outside the checkout. This file intentionally contains no
// credentials and fails closed when the minimum production contract is absent.

const REQUIRED_ENV = [
  "MAIN_DOMAIN",
  "ADMIN_DOMAIN",
  "ALLOWED_ORIGINS",
  "JWT_SECRET",
  "PASSWORD_MANAGER_KEY",
  "DATA_FILE",
  "MEDIA_DIR",
  "PROCUREMENT_DOCUMENTS_DIR",
  "BACKUP_DIR",
  "COOKIE_SECURE",
  "TRUST_PROXY"
];

const FORWARDED_ENV = [
  "PUBLIC_SITE_URL",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "ADMIN_COOKIE_NAME",
  "RECIPE_COOKIE_NAME",
  "COOKIE_SAME_SITE",
  "ALLOW_LOCALHOST_ORIGINS",
  "API_JSON_LIMIT_KB",
  "API_URLENCODED_LIMIT_KB",
  "PROCUREMENT_MAX_UPLOAD_BYTES",
  "PASSWORD_RESET_EMAIL",
  "PASSWORD_RESET_CODE_TTL_MINUTES",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "MUDAVIM_SMTP_HOST",
  "MUDAVIM_SMTP_PORT",
  "MUDAVIM_SMTP_SECURE",
  "MUDAVIM_SMTP_USER",
  "MUDAVIM_SMTP_PASS",
  "MUDAVIM_SMTP_FROM",
  "NOTIFICATIONS_EMAIL_ENABLED",
  "NOTIFICATIONS_MANAGER_EMAIL",
  "VAPID_SUBJECT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "NOTIFICATION_WORKERS_ENABLED",
  "NOTIFICATION_WORKER_INTERVAL_MS",
  "NOTIFICATION_REMINDER_INTERVAL_MS",
  "NOTIFICATION_MAX_ATTEMPTS",
  "DEFAULT_PANEL_PASSWORD",
  "DEFAULT_RECIPE_PASSWORD",
  "BCRYPT_ROUNDS"
];

function cleanEnvironmentValue(name) {
  const value = process.env[name];
  return value === undefined || value === null ? "" : String(value).trim();
}

const missing = REQUIRED_ENV.filter((name) => !cleanEnvironmentValue(name));
if (missing.length) {
  throw new Error(
    `PM2 production environment is incomplete. Missing: ${missing.join(", ")}. `
      + "Load the external environment file before starting PM2."
  );
}

const runtimeEnvironment = {
  NODE_ENV: "production",
  PORT: cleanEnvironmentValue("PORT") || "8080"
};

[...REQUIRED_ENV, ...FORWARDED_ENV].forEach((name) => {
  const value = process.env[name];
  if (value !== undefined) runtimeEnvironment[name] = String(value);
});

module.exports = {
  apps: [
    {
      name: "tahmisci-api",
      script: "src/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: runtimeEnvironment,
      env_production: runtimeEnvironment,
      autorestart: true,
      watch: false,
      max_memory_restart: "350M",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 15000,
      listen_timeout: 10000,
      time: true,
      merge_logs: true
    }
  ]
};
