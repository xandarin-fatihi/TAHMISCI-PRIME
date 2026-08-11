"use strict";

const fs = require("fs/promises");
const { assertOwnedLocalTarget, getLocalPaths } = require("../src/local-development");

main().catch((error) => {
  console.error(`Lokal reset başarısız: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const paths = getLocalPaths("dev");
  const dataFile = assertOwnedLocalTarget(paths.dataFile, paths.dataFile);
  const mediaDir = assertOwnedLocalTarget(paths.mediaDir, paths.mediaDir);
  await fs.rm(dataFile, { force: true });
  await fs.rm(mediaDir, { recursive: true, force: true });
  console.log("Lokal store ve lokal medya sıfırlandı.");
  console.log(`Store: ${dataFile}`);
  console.log(`Medya: ${mediaDir}`);
  console.log("Production store ve medya klasörlerine dokunulmadı.");
}
