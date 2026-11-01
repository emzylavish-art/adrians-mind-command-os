#!/usr/bin/env node
/**
 * Mint a one-time pairing code for the HP EliteBook and print only the code,
 * expiry, and the exact PowerShell install line. Never prints the management key.
 *
 * Usage:
 *   node scripts/pairing/pair-elitebook.mjs --base https://YOUR_DASHBOARD
 *   MIND_PAIRING_DASHBOARD_URL=https://... node scripts/pairing/pair-elitebook.mjs
 */
import { mintPairingCode, setManagementKeyForTests } from "../../src/lib/mind/pairing/index.ts";
import { setPairingStoreDirectory } from "../../src/lib/mind/pairing/store.ts";
import { join } from "node:path";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = (arg("base") || process.env.MIND_PAIRING_DASHBOARD_URL || "").replace(/\/$/, "");
if (!base) {
  console.error("Pass --base https://YOUR_DASHBOARD or set MIND_PAIRING_DASHBOARD_URL");
  process.exit(2);
}
if (!base.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(base)) {
  console.error("Dashboard URL must be HTTPS (or localhost HTTP for lab only).");
  process.exit(2);
}

// Use real management key from env/file via readManagementKey (no override).
setManagementKeyForTests(null);
setPairingStoreDirectory(join(process.cwd(), ".data", "mind-pairing"));

const userId = process.env.MIND_PAIRING_USER_ID || "dev-user";
const minted = mintPairingCode(userId);
if (!minted.ok) {
  console.error(minted.error);
  process.exit(1);
}

console.log(`PAIRING_CODE=${minted.code}`);
console.log(`EXPIRES_AT=${minted.expiresAt}`);
console.log("");
console.log("Run on the EliteBook (from agent/windows):");
console.log(
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\\Install-MindAgent.ps1 -DashboardUrl "${base}" -PairingCode "${minted.code}"`,
);
