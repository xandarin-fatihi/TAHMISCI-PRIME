"use strict";

const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const { normalizeStore } = require("../src/store/file-store");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..", "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(projectRoot, "storage", "local", "store.json");

main().catch((error) => {
  console.error(`Migration basarisiz: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const raw = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const migrated = normalizeStore(raw);
  const tmp = `${dataFile}.${process.pid}.migration.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  await fs.rename(tmp, dataFile);
  console.log(`Store schemaVersion=${migrated.schemaVersion}: ${dataFile}`);
}
