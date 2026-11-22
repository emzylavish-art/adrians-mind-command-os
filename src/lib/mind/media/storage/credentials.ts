import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StorageService } from "./types.ts";
import { localDataPath } from "../../../local-data.ts";

/**
 * Credential resolver for storage rotation.
 * Reads existing connection records (.data/mind-connectors/.../<service>.json)
 * or env vars. Does NOT implement OAuth — MCP Integration Bot owns that.
 */

type ConnectionRecord = {
  connector?: string;
  ownerId?: string;
  accessToken?: string;
  accessTokenEnc?: string;
  accountLabel?: string;
  connectedAt?: string;
};

let connectorDirectory = localDataPath("mind-connectors");

export function setStorageConnectorDirectory(next: string) {
  connectorDirectory = next;
}

export function storageConnectorDirectory() {
  return connectorDirectory;
}

const ENV_KEYS: Record<StorageService, string> = {
  google_drive: "MIND_GOOGLE_DRIVE_TOKEN",
  dropbox: "MIND_DROPBOX_TOKEN",
  onedrive: "MIND_ONEDRIVE_TOKEN",
};

/** Map storage service → on-disk connection record filename stem. */
function recordStem(service: StorageService): string {
  return service; // google_drive.json, dropbox.json, onedrive.json
}

function ownerDir(ownerId: string) {
  return join(connectorDirectory, createHash("sha256").update(ownerId).digest("hex"));
}

export function storageRecordPath(ownerId: string, service: StorageService) {
  return join(ownerDir(ownerId), `${recordStem(service)}.json`);
}

export function readStorageConnectionRecord(ownerId: string, service: StorageService): ConnectionRecord | null {
  const path = storageRecordPath(ownerId, service);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ConnectionRecord;
    if (parsed.ownerId && parsed.ownerId !== ownerId) return null;
    if (parsed.connector && parsed.connector !== service) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type ResolveTokenResult =
  | { ok: true; token: string; accountLabel?: string; source: "env" | "record" }
  | { ok: false; reason: "not_connected" | "encrypted_only" | "incomplete"; detail: string };

export function resolveStorageAccessToken(
  ownerId: string,
  service: StorageService,
  env: Record<string, string | undefined> = process.env,
): ResolveTokenResult {
  const envKey = ENV_KEYS[service];
  const fromEnv = env[envKey]?.trim();
  if (fromEnv) {
    return { ok: true, token: fromEnv, accountLabel: "env-token", source: "env" };
  }

  const record = readStorageConnectionRecord(ownerId, service);
  if (!record) {
    return {
      ok: false,
      reason: "not_connected",
      detail: `${service} is not connected. Connect it on ServiceBoard (MCP Integration owns OAuth), or set ${envKey}.`,
    };
  }
  if (typeof record.accessToken === "string" && record.accessToken.trim()) {
    return {
      ok: true,
      token: record.accessToken.trim(),
      accountLabel: record.accountLabel,
      source: "record",
    };
  }
  if (record.accessTokenEnc) {
    return {
      ok: false,
      reason: "encrypted_only",
      detail: `${service} connection record exists but the token is encrypted. MCP Integration Bot must expose a decryptable token helper.`,
    };
  }
  return {
    ok: false,
    reason: "incomplete",
    detail: `${service} connection record is incomplete (no usable token).`,
  };
}

export function isStorageAccountConnected(
  ownerId: string,
  service: StorageService,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveStorageAccessToken(ownerId, service, env).ok === true;
}
