import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORBIDDEN_REFS } from "../../registry.ts";
import { setConnectorDirectory } from "../../connectors/store.ts";
import {
  decryptStoredAccessToken,
  hasStorageRefreshCapability,
  isStorageOAuthService,
  mintStorageAccessToken,
  type FetchLike,
} from "../../connectors/storage-token-refresh.ts";
import type { StorageService } from "./types.ts";

/**
 * Credential resolver for storage rotation.
 * Drive, Dropbox, and OneDrive read connection records
 * (.data/mind-connectors/.../<service>.json) or env vars.
 * Supabase Storage reads the project URL and service key from env only.
 * Does NOT implement OAuth — MCP Integration Bot owns that.
 * Never log token values.
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

/**
 * Primary env var for each service. Values are read with dynamic lookup so a
 * bundler cannot inline them into a client build. Never log these values.
 * Supabase also accepts SUPABASE_SECRET_KEY when the service-role var is unset.
 */
export const ENV_KEYS: Record<StorageService, string> = {
  supabase: "SUPABASE_SERVICE_ROLE_KEY",
  google_drive: "MIND_GOOGLE_DRIVE_TOKEN",
  dropbox: "MIND_DROPBOX_TOKEN",
  onedrive: "MIND_ONEDRIVE_TOKEN",
  pcloud: "MIND_PCLOUD_TOKEN",
};

const ENV_KEY_FALLBACKS: Partial<Record<StorageService, readonly string[]>> = {
  supabase: ["SUPABASE_SECRET_KEY"],
};

/** URL env vars for Supabase Storage, first match wins. Not a secret. */
export const SUPABASE_URL_ENV_KEYS = ["MIND_SUPABASE_URL", "SUPABASE_URL"] as const;

/** Media uploads are allowed only on this project. */
export const SUPABASE_STORAGE_PROJECT_REF = "xarxhdsnprpnosimehon";

export const SUPABASE_STORAGE_ORIGIN = `https://${SUPABASE_STORAGE_PROJECT_REF}.supabase.co`;

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readEnvToken(service: StorageService, env: Record<string, string | undefined>): string | undefined {
  const keys = [ENV_KEYS[service], ...(ENV_KEY_FALLBACKS[service] ?? [])];
  for (const key of keys) {
    const value = readEnvValue(env, key);
    if (value) return value;
  }
  return undefined;
}

/**
 * Supabase project origin from env. Returns null unless the URL is https on the
 * media project. Credentials are never taken from a connection record.
 */
export function resolveSupabaseStorageOrigin(env: Record<string, string | undefined>): string | null {
  let raw = "";
  for (const key of SUPABASE_URL_ENV_KEYS) {
    const value = readEnvValue(env, key);
    if (value) {
      raw = value;
      break;
    }
  }
  if (!raw) return null;
  if (FORBIDDEN_REFS.some((ref) => raw.includes(ref))) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.origin !== SUPABASE_STORAGE_ORIGIN) return null;
  if (FORBIDDEN_REFS.some((ref) => parsed.origin.includes(ref))) return null;
  return parsed.origin;
}

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
  const fromEnv = readEnvToken(service, env);
  if (service === "supabase") {
    // Env only. A connector JSON must not supply the service-role key.
    if (!fromEnv || !resolveSupabaseStorageOrigin(env)) {
      return {
        ok: false,
        reason: "not_connected",
        detail:
          "Supabase Storage is not configured. Set MIND_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).",
      };
    }
    return { ok: true, token: fromEnv, accountLabel: "env-token", source: "env" };
  }
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
