import { randomUUID } from "node:crypto";
async function getSql() { return (await import("../../db.ts")).getSql(); }
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { hasDurableOAuthStore, listDurableNotionWorkspaces, readDurableConnection, replaceDurableGrant } from "./durable-oauth.server.ts";
import { localNotionWorkspaces, readConnection, replaceLocalGrant, type ConnectorId, type StoredConnection } from "./store.ts";
import { getProvider } from "./providers.ts";
import type { FetchLike, OAuthProviderEnv } from "./oauth-provider.ts";
import { readOAuthRecovery, saveOAuthRecovery } from "./recovery.ts";
import { tokenExpiresAt } from "./token-expiry.ts";

type TokenResult = { ok: true; token: string; grant: StoredConnection; refreshed: boolean } | { ok: false; error: string; reconnect: boolean };
const localClaims = new Set<string>();

async function claimRefresh(ownerId: string, connector: ConnectorId, workspaceId: string): Promise<(() => Promise<void>) | null> {
  const key = JSON.stringify([ownerId, connector, workspaceId]);
  if (!hasDurableOAuthStore()) {
    if (localClaims.has(key)) return null;
    localClaims.add(key);
    return async () => { localClaims.delete(key); };
  }
  const sql = await getSql();
  const claim = randomUUID();
  const rows = await sql.query("INSERT INTO mind_oauth_refresh_claim(owner_id,connector,workspace_id,claim,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 seconds') ON CONFLICT(owner_id,connector,workspace_id) DO UPDATE SET claim=excluded.claim,expires_at=excluded.expires_at WHERE mind_oauth_refresh_claim.expires_at<now() RETURNING claim", [ownerId, connector, workspaceId, claim]);
  if (!rows.length) return null;
  return async () => { await sql.query("DELETE FROM mind_oauth_refresh_claim WHERE owner_id=$1 AND connector=$2 AND workspace_id=$3 AND claim=$4", [ownerId, connector, workspaceId, claim]); };
}

async function selectedGrant(ownerId: string, connector: ConnectorId, workspaceId?: string): Promise<StoredConnection | null> {
  if (connector === "notion" && workspaceId) {
    const rows = hasDurableOAuthStore() ? await listDurableNotionWorkspaces(ownerId) : localNotionWorkspaces(ownerId);
    return rows.find((row) => (row.workspaceId || "legacy") === workspaceId) ?? null;
  }
  return hasDurableOAuthStore() ? readDurableConnection(ownerId, connector) : readConnection(ownerId, connector);
}

/** Refresh credentials only; never retries an external action or changes the selected account/workspace. */
export async function resolveOAuthAccessToken(input: {
  ownerId: string; connector: ConnectorId; workspaceId?: string; forceRefresh?: boolean;
  env?: OAuthProviderEnv; fetch?: FetchLike; now?: number;
}): Promise<TokenResult> {
  const provider = getProvider(input.connector);
  const now = input.now ?? Date.now();
  let release: (() => Promise<void>) | null = null;
  try {
    let conn = await selectedGrant(input.ownerId, input.connector, input.workspaceId);
    if (!conn) return { ok: false, error: `${provider.displayName} is not connected to this selected account or workspace.`, reconnect: true };
    const prior = await readOAuthRecovery(input.ownerId, input.connector, conn.connectedAt);
    if (prior?.connectionAt === conn.connectedAt && prior.status === "reconnect_required") return { ok: false, error: prior.detail, reconnect: true };
    const token = decryptSecret(conn.accessTokenEnc);
    if (!token) return { ok: false, error: "The saved authorization could not be read. Reconnect this integration.", reconnect: true };
    if (!input.forceRefresh && (!conn.expiresAt || Date.parse(conn.expiresAt) > now + 30_000)) return { ok: true, token, grant: conn, refreshed: false };
    const env = input.env ?? provider.readEnv();
    const refresh = conn.refreshTokenEnc ? decryptSecret(conn.refreshTokenEnc) : null;
    if (!refresh || !env.clientId || (provider.tokenAuth !== "public" && !env.clientSecret) || !env.tokenUrl) return { ok: false, error: `${provider.displayName} authorization expired. Reconnect the same account or workspace.`, reconnect: true };
    const original = conn;
    release = await claimRefresh(input.ownerId, input.connector, conn.workspaceId ?? "");
    if (!release) return { ok: false, error: "Authorization renewal is already in progress. Retry this check shortly.", reconnect: false };
    // Re-read after claiming so a prior refresh cannot leave us using an obsolete rotating token.
    conn = await selectedGrant(input.ownerId, input.connector, input.workspaceId);
    if (!conn) return { ok: false, error: "This integration was disconnected during renewal.", reconnect: true };
    if (conn.connectedAt !== original.connectedAt || conn.workspaceId !== original.workspaceId || conn.accountLabel !== original.accountLabel) return { ok: false, error: "The selected connection changed before renewal. Retry from the current account; no action was sent.", reconnect: true };
    if (!input.forceRefresh && conn.expiresAt && Date.parse(conn.expiresAt) > now + 30_000) {
      const current = decryptSecret(conn.accessTokenEnc);
      if (current) return { ok: true, token: current, grant: conn, refreshed: false };
    }
    const refreshToken = conn.refreshTokenEnc ? decryptSecret(conn.refreshTokenEnc) : null;
    if (!refreshToken) return { ok: false, error: "The selected authorization changed. Reconnect the same account or workspace.", reconnect: true };
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
    if (provider.resource) body.set("resource", provider.resource);
    if (provider.tokenAuth === "public") body.set("client_id", env.clientId);
    if (provider.tokenAuth === "basic" || provider.tokenAuth === "basic_and_body") headers.Authorization = `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`;
    if ((provider.tokenAuth === "body" || provider.tokenAuth === "basic_and_body") && env.clientSecret) { body.set("client_id", env.clientId); body.set("client_secret", env.clientSecret); }
    const requestBody = input.connector === "notion" ? JSON.stringify(Object.fromEntries(body)) : body;
    if (input.connector === "notion") { headers["Content-Type"] = "application/json"; headers["Notion-Version"] = "2022-06-28"; }
    const reject = async (): Promise<TokenResult> => {
      const error = `${provider.displayName} authorization renewal was rejected or unconfirmed. Reconnect the same account or workspace. No external action was repeated.`;
      await saveOAuthRecovery(input.ownerId, input.connector, { connectionAt: conn!.connectedAt, status: "reconnect_required", detail: error, at: new Date(now).toISOString() });
      return { ok: false, error, reconnect: true };
    };
    let response: Awaited<ReturnType<FetchLike>>;
    try { response = await (input.fetch ?? globalThis.fetch)(env.tokenUrl, { method: "POST", headers, body: requestBody, signal: AbortSignal.timeout(15_000) }); }
    catch { return reject(); }
    let json = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (json && provider.normalizeTokenJson) json = provider.normalizeTokenJson(json);
    if (!response.ok || !json || typeof json.access_token !== "string" || !json.access_token || json.error || json.ok === false) return reject();
    const hints = provider.parseAccount(json);
    if (hints.workspaceId && conn.workspaceId && hints.workspaceId !== conn.workspaceId) return reject();
    const next: StoredConnection = { ...conn, accessTokenEnc: encryptSecret(json.access_token).ciphertext,
      refreshTokenEnc: typeof json.refresh_token === "string" && json.refresh_token ? encryptSecret(json.refresh_token).ciphertext : conn.refreshTokenEnc,
      expiresAt: tokenExpiresAt(json.expires_in, now), scopes: typeof json.scope === "string" ? json.scope : conn.scopes,
      scopeEvidence: typeof json.scope === "string" ? "provider" : conn.scopeEvidence };
    const saved = hasDurableOAuthStore() ? await replaceDurableGrant(conn, next) : replaceLocalGrant(conn, next);
    if (!saved) return { ok: false, error: "The selected connection changed during renewal. No action was sent using the replacement account.", reconnect: true };
    await saveOAuthRecovery(input.ownerId, input.connector, { connectionAt: conn.connectedAt, status: "refreshed", detail: "Authorization renewed for the same connection. Operation permissions are checked when used.", at: new Date(now).toISOString() });
    return { ok: true, token: json.access_token, grant: next, refreshed: true };
  } catch {
    return { ok: false, error: "Authorization recovery storage is unavailable. No external action was repeated.", reconnect: false };
  } finally { await release?.().catch(() => undefined); }
}
