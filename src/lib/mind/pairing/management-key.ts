import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-only management key for minting pairing codes.
 * Never log, never send to client or laptop, never include in Notion.
 */
const ENV_NAME = "MIND_PAIRING_MANAGEMENT_KEY";
const SECRETS_FILE = join("/home/box/.secrets", "mind_pairing_management.key");

let testOverride: string | null = null;

export function setManagementKeyForTests(value: string | null) {
  testOverride = value;
}

export function readManagementKey(): { ok: true; key: string } | { ok: false; error: string } {
  if (testOverride !== null) {
    if (!testOverride) return { ok: false, error: "Management key is not configured." };
    return { ok: true, key: testOverride };
  }
  const fromEnv = process.env[ENV_NAME]?.trim();
  if (fromEnv) return { ok: true, key: fromEnv };
  try {
    const fromFile = readFileSync(SECRETS_FILE, "utf8").trim();
    if (fromFile) return { ok: true, key: fromFile };
  } catch {
    /* missing file is fine; fall through */
  }
  return { ok: false, error: "Management key is not configured." };
}

/** Redact helper — always returns a fixed label; never the key. */
export function managementKeyLabel(): string {
  return "[management-key:redacted]";
}
