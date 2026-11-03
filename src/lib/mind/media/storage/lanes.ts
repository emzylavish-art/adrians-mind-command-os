/**
 * Multi-lane storage credentials (server-only).
 *
 * One encrypted StoredConnection record per (credentialOwnerId, service) is not enough
 * when Media Storage Fleet addresses lanes like `gdrive-emmanuelohilebo4` while the
 * signed-in app owner is a different account. Lane ids select which account config /
 * credential owner to use, with path-safe validation and env isolation so a lane never
 * silently picks up another lane's MIND_*_TOKEN / MIND_*_REFRESH_TOKEN.
 */
import { loadStorageAccountsConfig } from "./config.ts";
import {
  resolveStorageAccessToken,
  resolveStorageAccessTokenAsync,
  type ResolveTokenAsyncDeps,
  type ResolveTokenResult,
} from "./credentials.ts";
import type { StorageAccountConfig, StorageService } from "./types.ts";
import { storageRefreshEnvKeys } from "../../connectors/storage-token-refresh.ts";
import { isStorageOAuthService } from "../../connectors/storage-token-refresh.ts";

const LANE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const MAX_LANE_ID_LEN = 64;

const GENERIC_ACCESS_ENV: Record<StorageService, string> = {
  google_drive: "MIND_GOOGLE_DRIVE_TOKEN",
  dropbox: "MIND_DROPBOX_TOKEN",
  onedrive: "MIND_ONEDRIVE_TOKEN",
  pcloud: "MIND_PCLOUD_TOKEN",
};

export class InvalidStorageLaneIdError extends Error {
  readonly code = "invalid_lane_id" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidStorageLaneIdError";
  }
}

/**
 * Validate a Media Storage Fleet lane id.
 * Rejects empty, overlong, path-traversal, separators, and non [a-z0-9-] forms.
 */
export function assertValidLaneId(laneId: string): string {
  if (typeof laneId !== "string") {
    throw new InvalidStorageLaneIdError("laneId must be a string.");
  }
  const id = laneId.trim();
  if (!id) {
    throw new InvalidStorageLaneIdError("laneId is empty.");
  }
  if (id.length > MAX_LANE_ID_LEN) {
    throw new InvalidStorageLaneIdError(`laneId exceeds ${MAX_LANE_ID_LEN} characters.`);
  }
  if (
    id.includes("..") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id.includes("%") ||
    id.includes(":")
  ) {
    throw new InvalidStorageLaneIdError("laneId contains path-unsafe characters.");
  }
  if (!LANE_ID_RE.test(id)) {
    throw new InvalidStorageLaneIdError(
      "laneId must be alphanumeric segments separated by single hyphens (e.g. gdrive-emmanuelohilebo4).",
    );
  }
  return id;
}

/** Env key for a lane-scoped access or refresh token (never log the value). */
export function laneEnvKey(laneId: string, kind: "TOKEN" | "REFRESH_TOKEN"): string {
  const id = assertValidLaneId(laneId);
  const safe = id.toUpperCase().replace(/-/g, "_");
  return `MIND_STORAGE_LANE_${safe}_${kind}`;
}

export function credentialOwnerForAccount(
  account: StorageAccountConfig,
  signedInOwnerId: string,
): string {
  const explicit = account.credentialOwnerId?.trim();
  return explicit || signedInOwnerId;
}

/**
 * Build an env view for resolving one account/lane.
 * - Strips generic MIND_*_TOKEN / MIND_*_REFRESH_TOKEN for the service when the
 *   account uses a laneId or a credentialOwnerId that differs from the signed-in owner,
 *   so another account's break-glass env never leaks into this lane.
 * - Injects lane-scoped TOKEN / REFRESH_TOKEN into the generic keys when present,
 *   so the existing refresh mint path works unchanged.
 */
export function isolateEnvForStorageAccount(
  env: Record<string, string | undefined>,
  account: StorageAccountConfig,
  signedInOwnerId: string,
): Record<string, string | undefined> {
  const credentialOwnerId = credentialOwnerForAccount(account, signedInOwnerId);
  const needsIsolation =
    Boolean(account.laneId?.trim()) || credentialOwnerId !== signedInOwnerId;

  const next: Record<string, string | undefined> = { ...env };
  const accessKey = GENERIC_ACCESS_ENV[account.service];
  const refreshKeys = isStorageOAuthService(account.service)
    ? storageRefreshEnvKeys(account.service)
    : null;

  if (needsIsolation) {
    delete next[accessKey];
    if (refreshKeys) delete next[refreshKeys.refreshToken];
  }

  const laneRaw = account.laneId?.trim();
  if (laneRaw) {
    const laneId = assertValidLaneId(laneRaw);
    const laneAccess = env[laneEnvKey(laneId, "TOKEN")]?.trim();
    const laneRefresh = env[laneEnvKey(laneId, "REFRESH_TOKEN")]?.trim();
    if (laneAccess) next[accessKey] = laneAccess;
    if (laneRefresh && refreshKeys) next[refreshKeys.refreshToken] = laneRefresh;
  }

  return next;
}

export function findStorageAccountByLaneId(
  laneId: string,
  config = loadStorageAccountsConfig(),
): StorageAccountConfig | null {
  const id = assertValidLaneId(laneId);
  for (const account of config.accounts) {
    const raw = account.laneId?.trim();
    if (!raw) continue;
    try {
      if (assertValidLaneId(raw) === id) return account;
    } catch {
      continue;
    }
  }
  return null;
}

export type ResolveLaneDeps = ResolveTokenAsyncDeps & {
  /** Required when the account has no credentialOwnerId — usually the signed-in owner. */
  fallbackOwnerId?: string;
  configPath?: string;
};

/**
 * Resolve an access token for a Media Storage Fleet lane id.
 * Uses that lane's credentialOwnerId + lane-scoped env only.
 */
export async function resolveStorageLaneAccessToken(
  laneId: string,
  deps: ResolveLaneDeps = {},
): Promise<ResolveTokenResult> {
  let id: string;
  try {
    id = assertValidLaneId(laneId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid lane id.";
    return { ok: false, reason: "not_connected", detail };
  }

  const config = loadStorageAccountsConfig(deps.configPath);
  const account = findStorageAccountByLaneId(id, config);
  if (!account) {
    return {
      ok: false,
      reason: "not_connected",
      detail: `Unknown storage lane "${id}". Add it to media-storage-accounts.json with laneId + credentialOwnerId.`,
    };
  }

  return resolveStorageAccessTokenForAccount(
    deps.fallbackOwnerId?.trim() || account.credentialOwnerId?.trim() || "",
    account,
    deps,
  );
}

/**
 * Resolve credentials for one configured storage account, respecting lane isolation.
 * `signedInOwnerId` is the app session owner; credentialOwnerId on the account wins for records.
 */
export async function resolveStorageAccessTokenForAccount(
  signedInOwnerId: string,
  account: StorageAccountConfig,
  deps: ResolveTokenAsyncDeps = {},
): Promise<ResolveTokenResult> {
  const signedIn = signedInOwnerId?.trim();
  const credentialOwnerId = credentialOwnerForAccount(account, signedIn || account.credentialOwnerId?.trim() || "");
  if (!credentialOwnerId) {
    return {
      ok: false,
      reason: "not_connected",
      detail: `${account.service} account is missing credentialOwnerId (and no signed-in owner was provided).`,
    };
  }

  const baseEnv = deps.env ?? process.env;
  const env = isolateEnvForStorageAccount(baseEnv, account, signedIn || credentialOwnerId);

  return resolveStorageAccessTokenAsync(credentialOwnerId, account.service, {
    ...deps,
    env,
  });
}

/** Sync helper for tests / status when refresh is not required. */
export function resolveStorageAccessTokenForAccountSync(
  signedInOwnerId: string,
  account: StorageAccountConfig,
  env: Record<string, string | undefined> = process.env,
): ResolveTokenResult {
  const signedIn = signedInOwnerId?.trim();
  const credentialOwnerId = credentialOwnerForAccount(account, signedIn || account.credentialOwnerId?.trim() || "");
  if (!credentialOwnerId) {
    return {
      ok: false,
      reason: "not_connected",
      detail: `${account.service} account is missing credentialOwnerId (and no signed-in owner was provided).`,
    };
  }
  const isolated = isolateEnvForStorageAccount(env, account, signedIn || credentialOwnerId);
  return resolveStorageAccessToken(credentialOwnerId, account.service, isolated);
}
