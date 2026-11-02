/**
 * Server-side OAuth refresh for storage accounts (Google Drive, Dropbox, OneDrive).
 * Mints short-lived access tokens from encrypted StoredConnection.refreshTokenEnc
 * or MIND_*_REFRESH_TOKEN env vars + client credentials. Caches in memory until
 * shortly before expiry. Never logs token values.
 */
import { decryptSecret } from "./crypto.ts";
import {
  getRefreshToken,
  readConnection,
  storeAccessToken,
  type ConnectorId,
} from "./store.ts";

export const STORAGE_OAUTH_SERVICES = ["google_drive", "dropbox", "onedrive"] as const;
export type StorageOAuthService = (typeof STORAGE_OAUTH_SERVICES)[number];

export function isStorageOAuthService(value: string): value is StorageOAuthService {
  return (STORAGE_OAUTH_SERVICES as readonly string[]).includes(value);
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

type RefreshProviderConfig = {
  connector: StorageOAuthService;
  tokenUrl: string;
  tokenUrlEnv: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  refreshTokenEnv: string;
  /** Optional scopes sent on refresh (Microsoft). */
  refreshScope?: string;
};

const PROVIDERS: Record<StorageOAuthService, RefreshProviderConfig> = {
  google_drive: {
    connector: "google_drive",
    tokenUrl: "https://oauth2.googleapis.com/token",
    tokenUrlEnv: "GOOGLE_OAUTH_TOKEN_URL",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    refreshTokenEnv: "MIND_GOOGLE_DRIVE_REFRESH_TOKEN",
  },
  dropbox: {
    connector: "dropbox",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    tokenUrlEnv: "DROPBOX_OAUTH_TOKEN_URL",
    clientIdEnv: "DROPBOX_OAUTH_CLIENT_ID",
    clientSecretEnv: "DROPBOX_OAUTH_CLIENT_SECRET",
    refreshTokenEnv: "MIND_DROPBOX_REFRESH_TOKEN",
  },
  onedrive: {
    connector: "onedrive",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    tokenUrlEnv: "MICROSOFT_OAUTH_TOKEN_URL",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    refreshTokenEnv: "MIND_ONEDRIVE_REFRESH_TOKEN",
    refreshScope: "Files.ReadWrite offline_access",
  },
};

/** Leave this many ms of headroom before treating a cached token as expired. */
export const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;
/** When provider omits expires_in, assume ~1 hour. */
const DEFAULT_EXPIRES_IN_SEC = 3600;

type CacheEntry = {
  accessToken: string;
  expiresAtMs: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(ownerId: string, service: StorageOAuthService): string {
  return `${service}::${ownerId}`;
}

export function clearStorageAccessTokenCache() {
  cache.clear();
}

export function storageAccessTokenCacheSize(): number {
  return cache.size;
}

/** Test helper: peek expiry without exposing the token. */
export function peekStorageAccessTokenCache(
  ownerId: string,
  service: StorageOAuthService,
): { hit: boolean; expiresAtMs?: number } {
  const entry = cache.get(cacheKey(ownerId, service));
  if (!entry) return { hit: false };
  return { hit: true, expiresAtMs: entry.expiresAtMs };
}

function trimEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

export function storageRefreshEnvKeys(service: StorageOAuthService): {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
} {
  const p = PROVIDERS[service];
  return {
    refreshToken: p.refreshTokenEnv,
    clientId: p.clientIdEnv,
    clientSecret: p.clientSecretEnv,
  };
}

export type ResolveRefreshMaterial =
  | {
      ok: true;
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      source: "record" | "env";
      accountLabel?: string;
      scopes?: string;
    }
  | { ok: false; reason: "missing_refresh" | "missing_client"; detail: string };

/**
 * Locate a refresh token (encrypted record or env) plus OAuth client credentials.
 * Never returns access tokens. Errors never include secret values.
 */
export function resolveStorageRefreshMaterial(
  ownerId: string,
  service: StorageOAuthService,
  env: Record<string, string | undefined> = process.env,
): ResolveRefreshMaterial {
  const cfg = PROVIDERS[service];
  const clientId = trimEnv(env, cfg.clientIdEnv);
  const clientSecret = trimEnv(env, cfg.clientSecretEnv);
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason: "missing_client",
      detail: `${service} refresh requires ${cfg.clientIdEnv} and ${cfg.clientSecretEnv}.`,
    };
  }

  const fromRecord = getRefreshToken(ownerId, service as ConnectorId);
  if (fromRecord) {
    const conn = readConnection(ownerId, service as ConnectorId);
    return {
      ok: true,
      refreshToken: fromRecord,
      clientId,
      clientSecret,
      source: "record",
      accountLabel: conn?.accountLabel,
      scopes: conn?.scopes,
    };
  }

  const fromEnv = trimEnv(env, cfg.refreshTokenEnv);
  if (fromEnv) {
    return {
      ok: true,
      refreshToken: fromEnv,
      clientId,
      clientSecret,
      source: "env",
    };
  }

  return {
    ok: false,
    reason: "missing_refresh",
    detail: `${service} has no refresh token. Connect on ServiceBoard or set ${cfg.refreshTokenEnv}.`,
  };
}

function safeRefreshError(service: StorageOAuthService, status: number): string {
  return `${service} token refresh failed (HTTP ${status}). Reconnect the account or check OAuth client credentials.`;
}

export type MintAccessTokenResult =
  | {
      ok: true;
      accessToken: string;
      expiresAtMs: number;
      source: "cache" | "refresh";
      accountLabel?: string;
    }
  | { ok: false; error: string };

/**
 * Mint (or return cached) access token via the provider token endpoint.
 * Optionally persists a rotated refresh token back into the encrypted record.
 */
export async function mintStorageAccessToken(
  ownerId: string,
  service: StorageOAuthService,
  opts: {
    env?: Record<string, string | undefined>;
    fetch?: FetchLike;
    nowMs?: number;
    /** Persist rotated refresh + fresh access into the connector record when source is record. */
    persistRotated?: boolean;
  } = {},
): Promise<MintAccessTokenResult> {
  const env = opts.env ?? process.env;
  const now = opts.nowMs ?? Date.now();
  const key = cacheKey(ownerId, service);
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs - ACCESS_TOKEN_EXPIRY_SKEW_MS > now) {
    return {
      ok: true,
      accessToken: cached.accessToken,
      expiresAtMs: cached.expiresAtMs,
      source: "cache",
    };
  }

  const material = resolveStorageRefreshMaterial(ownerId, service, env);
  if (!material.ok) {
    return { ok: false, error: material.detail };
  }

  const cfg = PROVIDERS[service];
  const tokenUrl = trimEnv(env, cfg.tokenUrlEnv) || cfg.tokenUrl;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: material.refreshToken,
    client_id: material.clientId,
    client_secret: material.clientSecret,
  });
  if (cfg.refreshScope) {
    body.set("scope", cfg.refreshScope);
  }

  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
  } catch {
    return { ok: false, error: `${service} token refresh could not reach the provider.` };
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }

  if (!response.ok || typeof json.access_token !== "string" || !json.access_token) {
    // Never include upstream body (may contain tokens / error descriptions with secrets).
    return { ok: false, error: safeRefreshError(service, response.status) };
  }

  const expiresIn =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in) && json.expires_in > 0
      ? json.expires_in
      : DEFAULT_EXPIRES_IN_SEC;
  const expiresAtMs = now + expiresIn * 1000;
  const accessToken = json.access_token;

  cache.set(key, { accessToken, expiresAtMs });

  const rotatedRefresh =
    typeof json.refresh_token === "string" && json.refresh_token.trim()
      ? json.refresh_token.trim()
      : undefined;

  if (opts.persistRotated !== false && material.source === "record") {
    try {
      const existing = readConnection(ownerId, service as ConnectorId);
      storeAccessToken({
        ownerId,
        connector: service as ConnectorId,
        accessToken,
        refreshToken: rotatedRefresh || material.refreshToken,
        accountLabel: existing?.accountLabel || material.accountLabel,
        scopes: existing?.scopes || material.scopes,
        tokenType: typeof json.token_type === "string" ? json.token_type : existing?.tokenType,
        workspaceName: existing?.workspaceName,
        workspaceId: existing?.workspaceId,
        botId: existing?.botId,
      });
    } catch {
      // Refresh succeeded; persistence failure must not leak secrets or fail the mint.
    }
  }

  return {
    ok: true,
    accessToken,
    expiresAtMs,
    source: "refresh",
    accountLabel: material.accountLabel,
  };
}

/**
 * Decrypt a stored access token without refreshing. Returns null if missing/undecryptable.
 */
export function decryptStoredAccessToken(ownerId: string, service: StorageOAuthService): string | null {
  const conn = readConnection(ownerId, service as ConnectorId);
  if (!conn?.accessTokenEnc) return null;
  return decryptSecret(conn.accessTokenEnc);
}

export function hasStorageRefreshCapability(
  ownerId: string,
  service: StorageOAuthService,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const material = resolveStorageRefreshMaterial(ownerId, service, env);
  return material.ok;
}
