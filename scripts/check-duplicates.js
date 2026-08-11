"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const assetRoot = path.join(root, "public", "assets");
const seen = new Map();
const duplicates = [];

walk(assetRoot);

if (duplicates.length) {
  console.error(`Duplicate production assets found:\n- ${duplicates.join("\n- ")}`);
  process.exit(1);
}

console.log("Duplicate production asset bulunmadi.");

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const hash = crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
    const relative = path.relative(root, fullPath);
    if (seen.has(hash)) duplicates.push(`${relative} == ${seen.get(hash)}`);
    else seen.set(hash, relative);
  }
}
