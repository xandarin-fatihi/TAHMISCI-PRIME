"use strict";

const { once } = require("events");
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
  const { startServer } = require("../src/server");
  server = await startServer();
  if (!server.listening) await Promise.race([once(server, "listening"), once(server, "error").then(([error]) => Promise.reject(error))]);
  printLocalBanner();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
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
