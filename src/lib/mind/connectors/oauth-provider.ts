import { decryptSecret } from "./crypto.ts";
import { timingSafeEqual } from "node:crypto";
import {
  clearConnection,
  CONNECTOR_DISPLAY_NAMES,
  newOAuthState,
  readConnection,
  savePendingOAuth,
  storeAccessToken,
  takePendingOAuth,
  toPublic,
  type ConnectionPublic,
  type ConnectorId,
  type PendingOAuth,
} from "./store.ts";
import { hasDurableOAuthStore, saveDurablePendingOAuth, takeDurablePendingOAuth, saveDurableConnection, readDurableConnection, clearDurableConnection } from "./durable-oauth.server.ts";
import { updateDurableAccountIdentity } from "./durable-oauth.server.ts";
import { googleAccountIdentity, type GoogleIdentity } from "./google-account.server.ts";
import { tokenExpiresAt } from "./token-expiry.ts";
import { readOAuthRecovery, saveOAuthRecovery, withOAuthRecovery } from "./recovery.ts";
import { readLocalOAuthRecovery } from "./store.ts";

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

export type TokenAuthStyle = "basic" | "body" | "basic_and_body" | "public";
export type RevokeStyle = "none" | "notion_basic" | "form_token" | "github_basic" | "slack_auth_revoke";

export type OAuthProviderEnv = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
};

export type AccountHints = {
  externalAccountId?: string;
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
  resource?: string;
  revokeStyle: RevokeStyle;
  /** Extra authorize query params (e.g. Notion owner=user, Google access_type) */
  authorizeExtra?: Record<string, string>;
  readEnv: (env?: NodeJS.ProcessEnv) => OAuthProviderEnv;
  parseAccount: (json: Record<string, unknown>) => AccountHints;
  /** Optional: reshape provider-specific token JSON so access_token is top-level. */
  normalizeTokenJson?: (json: Record<string, unknown>) => Record<string, unknown>;
  notConfiguredDetail?: string;
};

export function providerConfigured(env: OAuthProviderEnv, tokenAuth?: TokenAuthStyle): boolean {
  return Boolean(env.clientId && (tokenAuth === "public" || env.clientSecret) && env.redirectUri);
}

function prepareAuthorizeUrl(
  provider: OAuthProvider,
  input: { ownerId: string; env?: OAuthProviderEnv },
): { ok: true; url: string; state: string; pending: PendingOAuth } | { ok: false; error: string } {
  const env = input.env ?? provider.readEnv();
  const name = provider.displayName;
  if (!providerConfigured(env, provider.tokenAuth) || !env.clientId || !env.redirectUri || !env.authorizeUrl) {
    return {
      ok: false,
      error:
        provider.notConfiguredDetail ||
        `${name} OAuth is not configured. Set ${provider.envKeys.clientId}, ${provider.envKeys.clientSecret}, and ${provider.envKeys.redirectUri}. Nothing was started.`,
    };
  }
  try {
    const redirect = new URL(env.redirectUri);
    const local = redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1";
    if (redirect.protocol === "http:" && !local) {
      return { ok: false, error: `${name} redirect URI must use https (or http on localhost). Nothing was started.` };
    }
    if (redirect.protocol !== "https:" && redirect.protocol !== "http:") {
      return { ok: false, error: `${name} redirect URI scheme is not allowed. Nothing was started.` };
    }
  } catch {
    return { ok: false, error: `${name} redirect URI is invalid. Nothing was started.` };
  }
  const { state, codeVerifier, codeChallenge } = newOAuthState();
  const pending: PendingOAuth = {
    state,
    ownerId: input.ownerId,
    connector: provider.id,
    codeVerifier,
    redirectUri: env.redirectUri,
    createdAt: new Date().toISOString(),
    scopes: provider.scopes.join(" "),
  };
  const url = new URL(env.authorizeUrl);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("state", state);
  if (provider.resource) url.searchParams.set("resource", provider.resource);
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
  return { ok: true, url: url.toString(), state, pending };
}

/** Synchronous local/test entrypoint. Production routes use the async durable variant. */
export function buildAuthorizeUrl(
  provider: OAuthProvider,
  input: { ownerId: string; env?: OAuthProviderEnv },
): { ok: true; url: string; state: string } | { ok: false; error: string } {
  const ready = prepareAuthorizeUrl(provider, input);
  if (!ready.ok) return ready;
  savePendingOAuth(ready.pending);
  return { ok: true, url: ready.url, state: ready.state };
}

export async function buildAuthorizeUrlPersistent(
  provider: OAuthProvider,
  input: { ownerId: string; env?: OAuthProviderEnv },
): Promise<{ ok: true; url: string; state: string } | { ok: false; error: string }> {
  const ready = prepareAuthorizeUrl(provider, input);
  if (!ready.ok) return ready;
  if (hasDurableOAuthStore()) await saveDurablePendingOAuth(ready.pending);
  else savePendingOAuth(ready.pending);
  return { ok: true, url: ready.url, state: ready.state };
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
  if (!providerConfigured(env, provider.tokenAuth) || !env.clientId || !env.tokenUrl) {
    return { ok: false, error: `${name} OAuth is not configured. Nothing was stored.` };
  }
  // Reject open-looking redirect_uri: pending.redirectUri must equal configured env redirect.
  if (env.redirectUri && typeof env.redirectUri === "string") {
    /* checked after pending load */
  }
  const claim = newOAuthState().state;
  const pending = hasDurableOAuthStore() ? await takeDurablePendingOAuth(input.state, claim) : takePendingOAuth(input.state);
  if (!pending || pending.connector !== provider.id) {
    return { ok: false, error: "OAuth state is invalid or expired. Nothing was stored." };
  }
  if (input.expectedOwnerId && !ownerIdsMatch(pending.ownerId, input.expectedOwnerId)) {
    return { ok: false, error: "OAuth state does not match the signed-in user. Nothing was stored." };
  }
  if (env.redirectUri && pending.redirectUri !== env.redirectUri) {
    return { ok: false, error: "OAuth redirect URI mismatch. Nothing was stored." };
  }
  if (!hasDurableOAuthStore()) savePendingOAuth({ ...pending, state: claim });
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
  if (provider.resource) body.set("resource", provider.resource);
  if (provider.tokenAuth === "public") body.set("client_id", env.clientId);
  if ((provider.tokenAuth === "body" || provider.tokenAuth === "basic_and_body") && env.clientSecret) {
    body.set("client_id", env.clientId);
    body.set("client_secret", env.clientSecret);
  }
  const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(env.tokenUrl, { method: "POST", headers, body });
  } catch {
    return { ok: false, error: `${name} token endpoint could not be reached. Nothing was stored.` };
  }
  let json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (json && provider.normalizeTokenJson) {
    json = provider.normalizeTokenJson(json);
  }
  if (!response.ok || !json || typeof json.access_token !== "string") {
    return { ok: false, error: safeTokenExchangeError(response.status) };
  }
  const hints = provider.parseAccount(json);
  if (provider.id === "gmail" || provider.id === "google_calendar" || provider.id === "google_drive" || provider.id === "youtube") {
    const identity = await googleAccountIdentity(json.access_token, input.fetch ?? fetch);
    if (identity?.email) hints.accountLabel = identity.email;
    if (identity?.subject) hints.externalAccountId = identity.subject;
  }
  try {
    const save = hasDurableOAuthStore()
      ? (payload: Parameters<typeof storeAccessToken>[0]) => saveDurableConnection(payload, claim)
      : async (payload: Parameters<typeof storeAccessToken>[0]) => {
          if (!takePendingOAuth(claim)) throw new Error("This connection attempt has expired or was disconnected.");
          return storeAccessToken(payload);
        };
    const conn = await save({
      ownerId: pending.ownerId,
      connector: provider.id,
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      workspaceName: hints.workspaceName,
      workspaceId: hints.workspaceId,
      botId: hints.botId,
      accountLabel: hints.accountLabel,
      externalAccountId: hints.externalAccountId,
      tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
      scopes: typeof json.scope === "string" ? json.scope : pending.scopes,
      expiresAt: tokenExpiresAt(json.expires_in),
      scopeEvidence: typeof json.scope === "string" ? "provider" : "requested",
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
  return withOAuthRecovery(toPublic(provider.id, readConnection(ownerId, provider.id), providerConfigured(cfg, provider.tokenAuth)), readLocalOAuthRecovery(ownerId, provider.id));
}

/** Production status reads persisted connection rows across serverless instances. */
export async function connectionStatusPersistent(
  provider: OAuthProvider,
  ownerId: string,
  env?: OAuthProviderEnv,
): Promise<ConnectionPublic> {
  const cfg = env ?? provider.readEnv();
  const conn = hasDurableOAuthStore()
    ? await readDurableConnection(ownerId, provider.id)
    : readConnection(ownerId, provider.id);
  const labeled = conn && hasDurableOAuthStore() && (!conn.accountLabel?.includes("@") || !conn.externalAccountId)
    && (provider.id === "gmail" || provider.id === "google_calendar" || provider.id === "google_drive" || provider.id === "youtube")
    ? await labelFromGoogle(ownerId, provider.id, conn)
    : conn;
  return withOAuthRecovery(toPublic(provider.id, labeled, providerConfigured(cfg, provider.tokenAuth)), await readOAuthRecovery(ownerId, provider.id));
}
/** Testable enrichment boundary: use one snapshot and reread after any asynchronous lookup. */
export async function labelFromGoogle(ownerId: string, connector: ConnectorId, conn: NonNullable<Awaited<ReturnType<typeof readDurableConnection>>>, deps: {
  lookup?: (token: string) => Promise<GoogleIdentity | null>;
  update?: typeof updateDurableAccountIdentity;
  read?: typeof readDurableConnection;
} = {}) {
  const token = decryptSecret(conn.accessTokenEnc);
  const identity = token ? await (deps.lookup ?? googleAccountIdentity)(token) : null;
  if (identity) await (deps.update ?? updateDurableAccountIdentity)(conn, identity);
  // A replacement or disconnect can occur even if userinfo failed. Never return A after B.
  return (deps.read ?? readDurableConnection)(ownerId, connector);
}

export type DisconnectResult = ConnectionPublic & { revokeOk?: boolean; revokeDetail?: string };

export async function disconnectProvider(
  provider: OAuthProvider,
  input: { ownerId: string; env?: OAuthProviderEnv; fetch?: FetchLike; expectedConnectedAt?: string },
): Promise<DisconnectResult> {
  const env = input.env ?? provider.readEnv();
  const removed = hasDurableOAuthStore()
    ? await clearDurableConnection(input.ownerId, provider.id, input.expectedConnectedAt)
    : clearConnection(input.ownerId, provider.id, input.expectedConnectedAt);
  const token = removed ? decryptSecret(removed.accessTokenEnc) : null;
  let revokeOk: boolean | undefined;
  let revokeDetail: string | undefined;
  if (token && env.revokeUrl && provider.revokeStyle !== "none") {
    const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
    try {
      let response: Awaited<ReturnType<FetchLike>> | null = null;
      if (provider.revokeStyle === "notion_basic" && env.clientId && env.clientSecret) {
        response = await fetchImpl(env.revokeUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });
      } else if (provider.revokeStyle === "form_token") {
        response = await fetchImpl(env.revokeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(provider.tokenAuth === "public" && env.clientId ? { token, client_id: env.clientId } : { token }),
        });
      } else if (provider.revokeStyle === "slack_auth_revoke") {
        response = await fetchImpl(env.revokeUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }),
        });
      } else if (provider.revokeStyle === "github_basic" && env.clientId && env.clientSecret) {
        response = await fetchImpl(env.revokeUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: token }),
        });
      }
      revokeOk = await revocationSucceeded(provider.revokeStyle, response);
      revokeDetail = revokeOk
        ? "Provider revoke succeeded; local token cleared."
        : "Provider revoke failed or was unreachable; local token was still cleared.";
    } catch {
      revokeOk = false;
      revokeDetail = "Provider revoke failed or was unreachable; local token was still cleared.";
    }
  }
  if (removed && revokeOk === undefined) revokeDetail = "Local access was removed. Provider-side revocation was not confirmed.";
  if (removed) {
    try {
      await saveOAuthRecovery(input.ownerId, provider.id, {
        connectionAt: removed.connectedAt, status: revokeOk === true ? "revoked" : "revocation_unknown",
        detail: revokeOk ? "Provider revocation was confirmed and local access is removed." : `${revokeDetail ?? "Provider-side revocation was not confirmed."} Review this application's access in ${provider.displayName} account settings.`,
        at: new Date().toISOString(),
      });
    } catch { revokeDetail = `${revokeDetail ?? "Local access was removed."} The final revocation record could not be saved; the pending recovery record remains.`; }
  }
  const pub = withOAuthRecovery(toPublic(provider.id, null, providerConfigured(env, provider.tokenAuth)), await readOAuthRecovery(input.ownerId, provider.id).catch(() => null));
  const detail =
    revokeDetail && !pub.recovery
      ? `${pub.detail} ${revokeDetail}`
      : pub.detail;
  return { ...pub, detail, revokeOk, revokeDetail };
}

export function displayNameFor(id: ConnectorId): string {
  return CONNECTOR_DISPLAY_NAMES[id];
}

/** Provider contracts: Notion/Google return 200; GitHub token deletion returns 204; Slack requires revoked:true. */
export async function revocationSucceeded(style: RevokeStyle, response: Awaited<ReturnType<FetchLike>> | null): Promise<boolean> {
  if (!response?.ok) return false;
  if (style === "github_basic") return response.status === 204;
  if (style === "form_token" || style === "notion_basic") return response.status === 200;
  if (style === "slack_auth_revoke") {
    const result = await response.json().catch(() => null) as { ok?: unknown; revoked?: unknown } | null;
    return response.status === 200 && result?.ok === true && result.revoked === true;
  }
  return false;
}
