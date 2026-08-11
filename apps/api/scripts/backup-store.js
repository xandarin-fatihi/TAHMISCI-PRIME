"use strict";

const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..", "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(projectRoot, "storage", "local", "store.json");
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(projectRoot, "storage", "backups");

main().catch((error) => {
  console.error(`Backup basarisiz: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  await fs.access(dataFile);
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `store-${stamp}.json`);
  await fs.copyFile(dataFile, target);
  console.log(target);
}
