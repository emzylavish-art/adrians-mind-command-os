import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SERVICE_BOARD_HINT,
  type CloudConnectionPublic,
  type CloudConnectionRecord,
  type CloudSource,
} from "./types.ts";

let directory = join(process.cwd(), ".data", "mind-connectors");

export function setCloudConnectorDirectory(next: string) {
  directory = next;
}

export function cloudConnectorDirectory() {
  return directory;
}

function ownerDir(ownerId: string) {
  return join(directory, createHash("sha256").update(ownerId).digest("hex"));
}

export function cloudRecordPath(ownerId: string, source: CloudSource) {
  return join(ownerDir(ownerId), `${source}.json`);
}

export function readCloudConnectionRecord(ownerId: string, source: CloudSource): CloudConnectionRecord | null {
  const path = cloudRecordPath(ownerId, source);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CloudConnectionRecord;
    if (parsed.ownerId !== ownerId || parsed.connector !== source) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasCloudConnectionRecord(ownerId: string, source: CloudSource): boolean {
  return readCloudConnectionRecord(ownerId, source) != null;
}

/**
 * Resolve a bearer token for Drive/OneDrive API calls.
 * Order: injected override → plaintext test field → MCP connectors getAccessToken (if present).
 * Never returns encrypted blobs to callers.
 */
export async function resolveCloudAccessToken(
  ownerId: string,
  source: CloudSource,
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (source === "onedrive") {
    return {
      ok: false,
      error: `OneDrive browse is stubbed until MCP Integration adds an OneDrive connection record. ${SERVICE_BOARD_HINT}`,
    };
  }
  const envKey = env.MIND_GOOGLE_DRIVE_TOKEN?.trim();
  if (envKey) return { ok: true, token: envKey };

  const record = readCloudConnectionRecord(ownerId, source);
  if (!record) {
    return { ok: false, error: `Google Drive is not connected. ${SERVICE_BOARD_HINT}` };
  }
  if (typeof record.accessToken === "string" && record.accessToken.trim()) {
    return { ok: true, token: record.accessToken.trim() };
  }

  // MCP Integration owns OAuth + encrypted token storage under src/lib/mind/connectors/.
  // When a google_drive connector lands, prefer writing a decryptable token the media
  // lane can resolve (or expose a server helper). Until then: plaintext test field,
  // MIND_GOOGLE_DRIVE_TOKEN, or accessTokenEnc without local decrypt → honest error.
  if (record.accessTokenEnc) {
    return {
      ok: false,
      error:
        "A Google Drive connection record exists, but the access token is encrypted. MCP Integration Bot owns connector crypto/OAuth — expose a Drive token helper or decryptable record for media browse.",
    };
  }
  return {
    ok: false,
    error: `Google Drive connection record is incomplete (no usable token). ${SERVICE_BOARD_HINT}`,
  };
}

export function cloudConnectionStatus(
  ownerId: string,
  source: CloudSource,
  env: Record<string, string | undefined> = process.env,
): CloudConnectionPublic {
  if (source === "onedrive") {
    return {
      source,
      state: "unsupported",
      detail: `OneDrive is stubbed. ${SERVICE_BOARD_HINT}`,
    };
  }
  if (env.MIND_GOOGLE_DRIVE_TOKEN?.trim()) {
    return {
      source,
      state: "connected",
      detail: "Google Drive token present on the server (MIND_GOOGLE_DRIVE_TOKEN). Browse is enabled. Prefer an MCP OAuth connection record when available.",
      accountLabel: "env-token",
    };
  }
  const record = readCloudConnectionRecord(ownerId, source);
  if (!record) {
    return {
      source,
      state: "not_connected",
      detail: `Google Drive is not connected. ${SERVICE_BOARD_HINT}`,
    };
  }
  return {
    source,
    state: "connected",
    detail: `Google Drive connection record found${record.accountLabel ? ` (${record.accountLabel})` : ""}. Tokens stay on the server.`,
    accountLabel: record.accountLabel,
    connectedAt: record.connectedAt,
  };
}

export function allCloudConnectionStatuses(
  ownerId: string,
  env: Record<string, string | undefined> = process.env,
): CloudConnectionPublic[] {
  return (["google_drive", "onedrive"] as CloudSource[]).map((source) => cloudConnectionStatus(ownerId, source, env));
}
