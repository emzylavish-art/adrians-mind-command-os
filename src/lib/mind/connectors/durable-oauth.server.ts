/** Durable, owner-scoped OAuth store for serverless production.
 * Never stores plaintext access/refresh tokens or PKCE verifier.
 * The local filesystem store remains available for isolated tests.
 */
import { createHash } from "node:crypto";
import { getSql } from "../../db.ts";
import { resolveDatabaseUrl } from "../../env.server.ts";
import { encryptSecret, decryptSecret } from "./crypto.ts";
import { isConnectorId, isValidOAuthState, PENDING_OAUTH_TTL_MS,
  type ConnectorId, type PendingOAuth, type StoredConnection } from "./store.ts";

export function hasDurableOAuthStore(): boolean {
  return Boolean(resolveDatabaseUrl(process.env));
}
function hashState(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
type ConnRow = {
  owner_id: string; connector: string; access_token_enc: string;
  refresh_token_enc: string | null; workspace_name: string | null;
  workspace_id: string | null; bot_id: string | null; account_label: string | null;
  connected_at: string | Date; token_type: string | null; scopes: string | null;
};
function restore(row: ConnRow): StoredConnection | null {
  if (!isConnectorId(row.connector)) return null;
  return {
    ownerId: row.owner_id, connector: row.connector,
    accessTokenEnc: row.access_token_enc,
    ...(row.refresh_token_enc ? { refreshTokenEnc: row.refresh_token_enc } : {}),
    ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.bot_id ? { botId: row.bot_id } : {}),
    ...(row.account_label ? { accountLabel: row.account_label } : {}),
    connectedAt: new Date(row.connected_at).toISOString(),
    ...(row.token_type ? { tokenType: row.token_type } : {}),
    ...(row.scopes ? { scopes: row.scopes } : {}),
  };
}
export async function readDurableConnection(ownerId: string, connector: ConnectorId): Promise<StoredConnection | null> {
  const sql = await getSql();
  const rows = await sql.query<ConnRow>(
    "SELECT owner_id, connector, access_token_enc, refresh_token_enc, workspace_name, workspace_id, bot_id, account_label, connected_at, token_type, scopes FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2",
    [ownerId, connector],
  );
  return rows.length ? restore(rows[0]) : null;
}
export async function saveDurableConnection(input: {
  ownerId: string; connector: ConnectorId; accessToken: string; refreshToken?: string;
  workspaceName?: string; workspaceId?: string; botId?: string;
  accountLabel?: string; tokenType?: string; scopes?: string;
}): Promise<StoredConnection> {
  if (!input.ownerId || !isConnectorId(input.connector) || !input.accessToken) throw new Error("Invalid OAuth connection.");
  const accessTokenEnc = encryptSecret(input.accessToken).ciphertext;
  const previous = input.refreshToken ? null : await readDurableConnection(input.ownerId, input.connector);
  const refreshTokenEnc = input.refreshToken ? encryptSecret(input.refreshToken).ciphertext : previous?.refreshTokenEnc ?? null;
  const when = new Date().toISOString();
  const sql = await getSql();
  await sql.query(
    "INSERT INTO mind_oauth_connections (owner_id, connector, access_token_enc, refresh_token_enc, workspace_name, workspace_id, bot_id, account_label, connected_at, token_type, scopes)" +
    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)" +
    " ON CONFLICT (owner_id,connector) DO UPDATE SET access_token_enc=excluded.access_token_enc, refresh_token_enc=excluded.refresh_token_enc," +
    " workspace_name=excluded.workspace_name, workspace_id=excluded.workspace_id, bot_id=excluded.bot_id," +
    " account_label=excluded.account_label, connected_at=excluded.connected_at, token_type=excluded.token_type, scopes=excluded.scopes",
    [input.ownerId,input.connector,accessTokenEnc,refreshTokenEnc,input.workspaceName ?? null,input.workspaceId ?? null,
      input.botId ?? null,input.accountLabel ?? null,when,input.tokenType ?? null,input.scopes ?? null],
  );
  return {
    ownerId: input.ownerId, connector: input.connector, accessTokenEnc,
    ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
    connectedAt: when, workspaceName: input.workspaceName, workspaceId: input.workspaceId,
    botId: input.botId, accountLabel: input.accountLabel, tokenType: input.tokenType, scopes: input.scopes,
  };
}
export async function clearDurableConnection(ownerId: string, connector: ConnectorId): Promise<void> {
  const sql = await getSql();
  await sql.query("DELETE FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2", [ownerId, connector]);
}
export async function getDurableAccessToken(ownerId: string, connector: ConnectorId): Promise<string | null> {
  const row = await readDurableConnection(ownerId, connector);
  return row ? decryptSecret(row.accessTokenEnc) : null;
}
export async function saveDurablePendingOAuth(pending: PendingOAuth): Promise<void> {
  if (!isValidOAuthState(pending.state) || !pending.ownerId || !isConnectorId(pending.connector)) {
    throw new Error("Invalid pending OAuth state.");
  }
  const created = Date.parse(pending.createdAt);
  if (!Number.isFinite(created) || Math.abs(Date.now() - created) > 60_000) {
    throw new Error("OAuth state creation time is invalid.");
  }
  const sql = await getSql();
  await sql.query(
    "INSERT INTO mind_oauth_pending (state_hash, owner_id, connector, code_verifier_enc, redirect_uri, scopes, created_at, expires_at)" +
    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [hashState(pending.state),pending.ownerId,pending.connector,encryptSecret(pending.codeVerifier).ciphertext,
      pending.redirectUri,pending.scopes ?? null,pending.createdAt,new Date(created + PENDING_OAUTH_TTL_MS).toISOString()],
  );
  await sql.query("DELETE FROM mind_oauth_pending WHERE expires_at < now()").catch(() => undefined);
}
type PendingRow = {
  owner_id: string; connector: string; code_verifier_enc: string;
  redirect_uri: string; scopes: string | null; created_at: string | Date; expires_at: string | Date;
};
export async function takeDurablePendingOAuth(state: string): Promise<PendingOAuth | null> {
  if (!isValidOAuthState(state)) return null;
  const sql = await getSql();
  const rows = await sql.query<PendingRow>(
    "DELETE FROM mind_oauth_pending WHERE state_hash = $1" +
    " RETURNING owner_id, connector, code_verifier_enc, redirect_uri, scopes, created_at, expires_at",
    [hashState(state)],
  );
  const row = rows[0];
  if (!row || !isConnectorId(row.connector)) return null;
  const created = new Date(row.created_at).getTime(), expires = new Date(row.expires_at).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(expires) ||
      Date.now() > expires || Date.now() - created > PENDING_OAUTH_TTL_MS) return null;
  const codeVerifier = decryptSecret(row.code_verifier_enc);
  if (!codeVerifier) return null;
  return { state, ownerId: row.owner_id, connector: row.connector, codeVerifier,
    redirectUri: row.redirect_uri, createdAt: new Date(created).toISOString(),
    ...(row.scopes ? { scopes: row.scopes } : {}) };
}
