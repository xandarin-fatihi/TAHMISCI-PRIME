"use strict";

const { once } = require("events");
const fs = require("fs/promises");
const path = require("path");
const {
  buildLocalEnvironment,
  getLocalCredentials,
  getLocalPaths,
  parseLocalPort
} = require("../src/local-development");

const port = parseLocalPort();
Object.assign(process.env, buildLocalEnvironment({ port, kind: "dev" }));

let server = null;
let closing = false;

main().catch((error) => {
  console.error(`Lokal sunucu baslatilamadi: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  await cleanupOrphanLocalStoreTemps();
  const { startServer } = require("../src/server");
  server = await startServer();
  if (!server.listening) await Promise.race([once(server, "listening"), once(server, "error").then(([error]) => Promise.reject(error))]);
  printLocalBanner();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function cleanupOrphanLocalStoreTemps() {
  const dataFile = getLocalPaths("dev").dataFile;
  const directory = path.dirname(dataFile);
  const baseName = path.basename(dataFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const temporaryFilePattern = new RegExp(`^${baseName}\\.(\\d+)\\.\\d+\\.tmp$`);
  const staleBefore = Date.now() - (60 * 60 * 1000);

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(temporaryFilePattern);
      if (!match) continue;
      const ownerPid = Number(match[1]);
      if (processIsActive(ownerPid)) continue;
      const target = path.join(directory, entry.name);
      try {
        const stat = await fs.stat(target);
        if (stat.mtimeMs > staleBefore) continue;
        await fs.unlink(target);
        console.log(`Eski lokal store geçici dosyası temizlendi: ${entry.name}`);
      } catch (error) {
        console.warn(`Lokal store geçici dosyası temizlenemedi (${entry.name}): ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Lokal store geçici dosya kontrolü başarısız: ${error.message}`);
  }
}

function processIsActive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function printLocalBanner() {
  const origin = `http://localhost:${port}`;
  const credentials = getLocalCredentials();
  const paths = getLocalPaths("dev");
  console.log("\nTahmisci lokal geliştirme hazır");
  console.log(`QR Menü   : ${origin}/`);
  console.log(`Site      : ${origin}/site/`);
  console.log(`Müdavim   : ${origin}/mudavim/`);
  console.log(`Yönetici  : ${origin}/yonetici/`);
  console.log(`Personel  : ${origin}/personel/`);
  console.log(`Fatura    : ${origin}/fatura/`);
  console.log(`Health    : ${origin}/api/health`);
  console.log(`Yerel Yönetici şifresi: ${credentials.adminPassword}`);
  console.log(`Lokal recete sifre: ${credentials.recipePassword}`);
  console.log(`Lokal store      : ${paths.dataFile}`);
  console.log("Durdurmak icin Ctrl+C kullanin.\n");
}

async function shutdown() {
  if (closing) return;
  closing = true;
  if (server) await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}
