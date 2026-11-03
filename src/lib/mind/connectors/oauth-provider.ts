import { timingSafeEqual } from "node:crypto";
import {
  clearConnection,
  CONNECTOR_DISPLAY_NAMES,
  getAccessToken,
  newOAuthState,
  readConnection,
  savePendingOAuth,
  storeAccessToken,
  takePendingOAuth,
  toPublic,
  type ConnectionPublic,
  type ConnectorId,
} from "./store.ts";


function ownerIdsMatch(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Never relay upstream bodies that might contain tokens; fixed client-safe errors only. */
function safeTokenExchangeError(status: number): string {
  return `Token exchange failed (${status}). Nothing was stored.`;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export type TokenAuthStyle = "basic" | "body" | "basic_and_body";
export type RevokeStyle = "none" | "bearer_json" | "form_token" | "github_basic" | "slack_auth_revoke";

export type OAuthProviderEnv = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
};

export type AccountHints = {
  accountLabel?: string;
  workspaceName?: string;
  workspaceId?: string;
  botId?: string;
};

export type OAuthProvider = {
  id: ConnectorId;
  displayName: string;
  /** Env var names for documentation / .env.example */
  envKeys: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    revokeUrl?: string;
  };
  defaults: {
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
  };
  scopes: string[];
  pkce: boolean;
  tokenAuth: TokenAuthStyle;
  revokeStyle: RevokeStyle;
  /** Extra authorize query params (e.g. Notion owner=user, Google access_type) */
  authorizeExtra?: Record<string, string>;
  readEnv: (env?: NodeJS.ProcessEnv) => OAuthProviderEnv;
  parseAccount: (json: Record<string, unknown>) => AccountHints;
  /** Optional: reshape provider-specific token JSON so access_token is top-level. */
  normalizeTokenJson?: (json: Record<string, unknown>) => Record<string, unknown>;
  notConfiguredDetail?: string;
};

export function providerConfigured(env: OAuthProviderEnv): boolean {
  return Boolean(env.clientId && env.clientSecret && env.redirectUri);
}

/**
 * Exact authorize hosts per connector. Env AUTHORIZE_URL overrides must still
 * land on one of these hosts (https only, default port). Fail closed otherwise.
 */
export const OAUTH_AUTHORIZE_HOSTS: Record<ConnectorId, readonly string[]> = {
  notion: ["api.notion.com"],
  gmail: ["accounts.google.com"],
  google_calendar: ["accounts.google.com"],
  google_drive: ["accounts.google.com"],
  dropbox: ["www.dropbox.com"],
  onedrive: ["login.microsoftonline.com"],
  pcloud: ["my.pcloud.com"],
  slack: ["slack.com"],
  github: ["github.com"],
};

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/** Honest client-safe error; never echo the bad URL or secrets. */
function safeAuthorizeConfigError(name: string, kind: "authorize" | "redirect"): string {
  return kind === "authorize"
    ? `${name} authorize URL is not allowed. Use the official provider host over https. Nothing was started.`
    : `${name} redirect URI is not allowed. Use https (or http on localhost) without credentials. Nothing was started.`;
}

/**
 * Validate OAuth authorize URL: https only, exact allowlisted host, no userinfo,
 * no odd ports, no javascript:/data:/http: or lookalike hosts.
 */
export function validateOAuthAuthorizeUrl(
  connector: ConnectorId,
  authorizeUrl: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  const allowed = OAUTH_AUTHORIZE_HOSTS[connector];
  if (!allowed?.length) {
    return { ok: false, reason: "unknown_connector" };
  }
  const trimmed = typeof authorizeUrl === "string" ? authorizeUrl.trim() : "";
  if (!trimmed) return { ok: false, reason: "empty" };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("http:")) {
    return { ok: false, reason: "bad_scheme" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "bad_scheme" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo" };
  }
  // URL.hostname is already IDNA/lowercase and strips brackets for IPv6.
  const host = url.hostname.toLowerCase();
  if (!allowed.includes(host)) {
    return { ok: false, reason: "host_not_allowlisted" };
  }
  // Default https port only (empty or 443). Reject :8443, :80, etc.
  if (url.port && url.port !== "443") {
    return { ok: false, reason: "odd_port" };
  }
  return { ok: true, url };
}

/**
 * Validate configurable redirect_uri origin: https (or http on loopback only),
 * no userinfo, no javascript/data, no credentials@host tricks.
 */
export function validateOAuthRedirectUri(
  redirectUri: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = typeof redirectUri === "string" ? redirectUri.trim() : "";
  if (!trimmed) return { ok: false, reason: "empty" };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) {
    return { ok: false, reason: "bad_scheme" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo" };
  }
  const local = isLoopbackHost(url.hostname);
  if (url.protocol === "http:") {
    if (!local) return { ok: false, reason: "http_non_local" };
  } else if (url.protocol !== "https:") {
    return { ok: false, reason: "bad_scheme" };
  }
  // Reject obviously odd ports on non-loopback https (allow empty/443; also common app ports on loopback).
  if (!local && url.protocol === "https:" && url.port && url.port !== "443") {
    return { ok: false, reason: "odd_port" };
  }
  return { ok: true, url };
}


/**
 * Exact token endpoint hosts per connector. Env *_OAUTH_TOKEN_URL overrides must
 * still land on one of these hosts (https only, default port). Fail closed.
 */
export const OAUTH_TOKEN_HOSTS: Record<ConnectorId, readonly string[]> = {
  notion: ["api.notion.com"],
  gmail: ["oauth2.googleapis.com"],
  google_calendar: ["oauth2.googleapis.com"],
  google_drive: ["oauth2.googleapis.com"],
  dropbox: ["api.dropboxapi.com"],
  onedrive: ["login.microsoftonline.com"],
  pcloud: ["api.pcloud.com", "eapi.pcloud.com"],
  slack: ["slack.com"],
  github: ["github.com"],
};

/** Exact revoke endpoint hosts (subset may be empty when provider has no revoke). */
export const OAUTH_REVOKE_HOSTS: Record<ConnectorId, readonly string[]> = {
  notion: ["api.notion.com"],
  gmail: ["oauth2.googleapis.com"],
  google_calendar: ["oauth2.googleapis.com"],
  google_drive: ["oauth2.googleapis.com"],
  dropbox: ["api.dropboxapi.com"],
  onedrive: ["login.microsoftonline.com"],
  pcloud: ["api.pcloud.com", "eapi.pcloud.com"],
  slack: ["slack.com"],
  github: ["api.github.com", "github.com"],
};

function safeTokenUrlConfigError(name: string): string {
  return `${name} token URL is not allowed. Use the official provider host over https. Nothing was stored.`;
}

/**
 * Validate OAuth token URL: https only, exact allowlisted host, no userinfo,
 * no odd ports. Same style as validateOAuthAuthorizeUrl.
 */
export function validateOAuthTokenUrl(
  connector: ConnectorId,
  tokenUrl: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  const allowed = OAUTH_TOKEN_HOSTS[connector];
  if (!allowed?.length) return { ok: false, reason: "unknown_connector" };
  const trimmed = typeof tokenUrl === "string" ? tokenUrl.trim() : "";
  if (!trimmed) return { ok: false, reason: "empty" };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("http:")) {
    return { ok: false, reason: "bad_scheme" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "bad_scheme" };
  if (url.username || url.password) return { ok: false, reason: "userinfo" };
  const host = url.hostname.toLowerCase();
  if (!allowed.includes(host)) return { ok: false, reason: "host_not_allowlisted" };
  if (url.port && url.port !== "443") return { ok: false, reason: "odd_port" };
  return { ok: true, url };
}

export function validateOAuthRevokeUrl(
  connector: ConnectorId,
  revokeUrl: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  const allowed = OAUTH_REVOKE_HOSTS[connector];
  if (!allowed?.length) return { ok: false, reason: "unknown_connector" };
  const trimmed = typeof revokeUrl === "string" ? revokeUrl.trim() : "";
  if (!trimmed) return { ok: false, reason: "empty" };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("http:")) {
    return { ok: false, reason: "bad_scheme" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "bad_scheme" };
  if (url.username || url.password) return { ok: false, reason: "userinfo" };
  const host = url.hostname.toLowerCase();
  if (!allowed.includes(host)) return { ok: false, reason: "host_not_allowlisted" };
  if (url.port && url.port !== "443") return { ok: false, reason: "odd_port" };
  return { ok: true, url };
}

export const OAUTH_TOKEN_FETCH_TIMEOUT_MS = 15_000;

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  input: { ownerId: string; env?: OAuthProviderEnv },
): { ok: true; url: string; state: string } | { ok: false; error: string } {
  const env = input.env ?? provider.readEnv();
  const name = provider.displayName;
  if (!providerConfigured(env) || !env.clientId || !env.redirectUri || !env.authorizeUrl) {
    return {
      ok: false,
      error:
        provider.notConfiguredDetail ||
        `${name} OAuth is not configured. Set ${provider.envKeys.clientId}, ${provider.envKeys.clientSecret}, and ${provider.envKeys.redirectUri}. Nothing was started.`,
    };
  }

  const redirectCheck = validateOAuthRedirectUri(env.redirectUri);
  if (!redirectCheck.ok) {
    return { ok: false, error: safeAuthorizeConfigError(name, "redirect") };
  }

  const authorizeCheck = validateOAuthAuthorizeUrl(provider.id, env.authorizeUrl);
  if (!authorizeCheck.ok) {
    return { ok: false, error: safeAuthorizeConfigError(name, "authorize") };
  }

  const { state, codeVerifier, codeChallenge } = newOAuthState();
  savePendingOAuth({
    state,
    ownerId: input.ownerId,
    connector: provider.id,
    codeVerifier,
    redirectUri: env.redirectUri,
    createdAt: new Date().toISOString(),
    scopes: provider.scopes.join(" "),
  });

  const url = new URL(authorizeCheck.url.toString());
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("state", state);
  if (provider.scopes.length) {
    url.searchParams.set("scope", provider.scopes.join(" "));
  }
  if (provider.pkce) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(provider.authorizeExtra || {})) {
    url.searchParams.set(k, v);
  }
  // Final belt-and-suspenders: never return a URL that left the allowlist while adding params.
  const finalCheck = validateOAuthAuthorizeUrl(provider.id, url.origin + url.pathname);
  if (!finalCheck.ok) {
    return { ok: false, error: safeAuthorizeConfigError(name, "authorize") };
  }
  return { ok: true, url: url.toString(), state };
}

export async function exchangeAuthorizationCode(
  provider: OAuthProvider,
  input: {
    code: string;
    state: string;
    /** When set, must match the owner who started OAuth (session bind). */
    expectedOwnerId?: string;
    env?: OAuthProviderEnv;
    fetch?: FetchLike;
  },
): Promise<{ ok: true; public: ConnectionPublic } | { ok: false; error: string }> {
  const env = input.env ?? provider.readEnv();
  const name = provider.displayName;
  if (!providerConfigured(env) || !env.clientId || !env.clientSecret || !env.tokenUrl) {
    return { ok: false, error: `${name} OAuth is not configured. Nothing was stored.` };
  }
  // Reject open-looking redirect_uri: pending.redirectUri must equal configured env redirect.
  if (env.redirectUri && typeof env.redirectUri === "string") {
    /* checked after pending load */
  }
  const pending = takePendingOAuth(input.state);
  if (!pending || pending.connector !== provider.id) {
    return { ok: false, error: "OAuth state is invalid or expired. Nothing was stored." };
  }
  if (input.expectedOwnerId && !ownerIdsMatch(pending.ownerId, input.expectedOwnerId)) {
    return { ok: false, error: "OAuth state does not match the signed-in user. Nothing was stored." };
  }
  if (env.redirectUri && pending.redirectUri !== env.redirectUri) {
    return { ok: false, error: "OAuth redirect URI mismatch. Nothing was stored." };
  }
  const tokenCheck = validateOAuthTokenUrl(provider.id, env.tokenUrl);
  if (!tokenCheck.ok) {
    return { ok: false, error: safeTokenUrlConfigError(name) };
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: pending.redirectUri,
  });
  if (provider.pkce) {
    body.set("code_verifier", pending.codeVerifier);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (provider.tokenAuth === "basic" || provider.tokenAuth === "basic_and_body") {
    headers.Authorization = `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`;
  }
  if (provider.tokenAuth === "body" || provider.tokenAuth === "basic_and_body") {
    body.set("client_id", env.clientId);
    body.set("client_secret", env.clientSecret);
  }
  const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OAUTH_TOKEN_FETCH_TIMEOUT_MS);
    try {
      response = await fetchImpl(tokenCheck.url.toString(), {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: `${name} token endpoint could not be reached. Nothing was stored.` };
  }
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, error: `${name} token endpoint tried to redirect. Nothing was stored.` };
  }
  let json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (json && provider.normalizeTokenJson) {
    json = provider.normalizeTokenJson(json);
  }
  if (!response.ok || !json || typeof json.access_token !== "string") {
    return { ok: false, error: safeTokenExchangeError(response.status) };
  }
  const hints = provider.parseAccount(json);
  try {
    const conn = storeAccessToken({
      ownerId: pending.ownerId,
      connector: provider.id,
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      workspaceName: hints.workspaceName,
      workspaceId: hints.workspaceId,
      botId: hints.botId,
      accountLabel: hints.accountLabel,
      tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
      scopes: typeof json.scope === "string" ? json.scope : pending.scopes,
    });
    return { ok: true, public: toPublic(provider.id, conn, true) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token could not be stored encrypted.";
    return { ok: false, error: `${message} Nothing was stored.` };
  }
}

export function connectionStatus(
  provider: OAuthProvider,
  ownerId: string,
  env?: OAuthProviderEnv,
): ConnectionPublic {
  const cfg = env ?? provider.readEnv();
  return toPublic(provider.id, readConnection(ownerId, provider.id), providerConfigured(cfg));
}

export type DisconnectResult = ConnectionPublic & { revokeOk?: boolean; revokeDetail?: string };

export async function disconnectProvider(
  provider: OAuthProvider,
  input: { ownerId: string; env?: OAuthProviderEnv; fetch?: FetchLike },
): Promise<DisconnectResult> {
  const env = input.env ?? provider.readEnv();
  const token = getAccessToken(input.ownerId, provider.id);
  let revokeOk: boolean | undefined;
  let revokeDetail: string | undefined;
  if (token && env.revokeUrl && provider.revokeStyle !== "none") {
    const revokeCheck = validateOAuthRevokeUrl(provider.id, env.revokeUrl);
    if (!revokeCheck.ok) {
      clearConnection(input.ownerId, provider.id);
      const pub = toPublic(provider.id, null, providerConfigured(env));
      return {
        ...pub,
        detail: `${pub.detail} Revoke URL is not allowed; local token was still cleared.`,
        revokeOk: false,
        revokeDetail: "Revoke URL is not allowed; local token was still cleared.",
      };
    }
    const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
    const revokeTarget = revokeCheck.url.toString();
    try {
      let response: Awaited<ReturnType<FetchLike>> | null = null;
      if (provider.revokeStyle === "bearer_json") {
        response = await fetchImpl(revokeTarget, {
          method: "POST",
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });
      } else if (provider.revokeStyle === "form_token") {
        response = await fetchImpl(revokeTarget, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } else if (provider.revokeStyle === "slack_auth_revoke") {
        response = await fetchImpl(revokeTarget, {
          method: "POST",
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }),
        });
      } else if (provider.revokeStyle === "github_basic" && env.clientId && env.clientSecret) {
        response = await fetchImpl(revokeTarget, {
          method: "DELETE",
          redirect: "manual",
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: token }),
        });
      }
      revokeOk = Boolean(response?.ok);
      revokeDetail = revokeOk
        ? "Provider revoke succeeded; local token cleared."
        : "Provider revoke failed or was unreachable; local token was still cleared.";
    } catch {
      revokeOk = false;
      revokeDetail = "Provider revoke failed or was unreachable; local token was still cleared.";
    }
  }
  clearConnection(input.ownerId, provider.id);
  const pub = toPublic(provider.id, null, providerConfigured(env));
  const detail =
    revokeDetail && pub.state !== "not_configured"
      ? `${pub.detail} ${revokeDetail}`
      : pub.detail;
  return { ...pub, detail, revokeOk, revokeDetail };
}

export function displayNameFor(id: ConnectorId): string {
  return CONNECTOR_DISPLAY_NAMES[id];
}
