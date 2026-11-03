import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setConnectorDirectory } from "../../connectors/store.ts";
import {
  decryptStoredAccessToken,
  hasStorageRefreshCapability,
  isStorageOAuthService,
  mintStorageAccessToken,
  type FetchLike,
  type StorageOAuthService,
} from "../../connectors/storage-token-refresh.ts";
import type { StorageService } from "./types.ts";

/**
 * Credential resolver for storage rotation.
 * Prefers plain env access tokens, then decryptable StoredConnection access tokens,
 * then server-side refresh (encrypted refreshTokenEnc or MIND_*_REFRESH_TOKEN + client secrets).
 * Does NOT implement the interactive OAuth authorize UI — MCP Integration owns that.
 */

type ConnectionRecord = {
  connector?: string;
  ownerId?: string;
  accessToken?: string;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  accountLabel?: string;
  connectedAt?: string;
};

let connectorDirectory = join(process.cwd(), ".data", "mind-connectors");

export function setStorageConnectorDirectory(next: string) {
  connectorDirectory = next;
  // Keep MCP connector store in lockstep so decrypt/refresh see the same records.
  setConnectorDirectory(next);
}

export function storageConnectorDirectory() {
  return connectorDirectory;
}

const ENV_KEYS: Record<StorageService, string> = {
  google_drive: "MIND_GOOGLE_DRIVE_TOKEN",
  dropbox: "MIND_DROPBOX_TOKEN",
  onedrive: "MIND_ONEDRIVE_TOKEN",
  pcloud: "MIND_PCLOUD_TOKEN",
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
  | { ok: true; token: string; accountLabel?: string; source: "env" | "record" | "refresh" | "cache" }
  | {
      ok: false;
      reason: "not_connected" | "encrypted_only" | "incomplete" | "refresh_failed";
      detail: string;
    };

/**
 * Synchronous resolver: plain env access tokens, plaintext test records,
 * or already-decryptable accessTokenEnc. Does not network-refresh.
 */
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
    // Refresh capability (env refresh token) still counts as "connected" for sync status
    // only when we can mint later; sync path cannot mint — report not_connected unless
    // callers use the async resolver.
    if (isStorageOAuthService(service) && hasStorageRefreshCapability(ownerId, service, env)) {
      return {
        ok: false,
        reason: "incomplete",
        detail: `${service} has a refresh token but no access token in this sync path. Use the async credential resolver.`,
      };
    }
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
    const decrypted = decryptStoredAccessToken(ownerId, service as import("../../connectors/store.ts").ConnectorId);
    if (decrypted) {
      return {
        ok: true,
        token: decrypted,
        accountLabel: record.accountLabel,
        source: "record",
      };
    }
    if (
      isStorageOAuthService(service) &&
      (record.refreshTokenEnc || hasStorageRefreshCapability(ownerId, service, env))
    ) {
      return {
        ok: false,
        reason: "incomplete",
        detail: `${service} connection needs a refreshed access token. Use the async credential resolver.`,
      };
    }
    return {
      ok: false,
      reason: "encrypted_only",
      detail: `${service} connection record exists but the token could not be decrypted.`,
    };
  }
  return {
    ok: false,
    reason: "incomplete",
    detail: `${service} connection record is incomplete (no usable token).`,
  };
}

export type ResolveTokenAsyncDeps = {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  nowMs?: number;
};

/**
 * Async resolver: keeps sync behavior, then refreshes via provider token endpoint
 * when a refresh token + client credentials are available.
 */
export async function resolveStorageAccessTokenAsync(
  ownerId: string,
  service: StorageService,
  deps: ResolveTokenAsyncDeps = {},
): Promise<ResolveTokenResult> {
  const env = deps.env ?? process.env;

  // Break-glass / short-lived plain access token still wins when explicitly set.
  const envKey = ENV_KEYS[service];
  const fromEnv = env[envKey]?.trim();
  if (fromEnv) {
    return { ok: true, token: fromEnv, accountLabel: "env-token", source: "env" };
  }

  if (isStorageOAuthService(service) && hasStorageRefreshCapability(ownerId, service, env)) {
    const minted = await mintStorageAccessToken(ownerId, service, {
      env,
      fetch: deps.fetch,
      nowMs: deps.nowMs,
    });
    if (minted.ok) {
      return {
        ok: true,
        token: minted.accessToken,
        accountLabel: minted.accountLabel,
        source: minted.source === "cache" ? "cache" : "refresh",
      };
    }
    // Fall through to decryptable access token if refresh failed.
    const syncAfterFail = resolveStorageAccessToken(ownerId, service, env);
    if (syncAfterFail.ok) return syncAfterFail;
    return { ok: false, reason: "refresh_failed", detail: minted.error };
  }

  return resolveStorageAccessToken(ownerId, service, env);
}

export function isStorageAccountConnected(
  ownerId: string,
  service: StorageService,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (resolveStorageAccessToken(ownerId, service, env).ok) return true;
  if (isStorageOAuthService(service) && hasStorageRefreshCapability(ownerId, service, env)) return true;
  return false;
}
