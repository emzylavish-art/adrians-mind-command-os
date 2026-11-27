/** Durable, owner-scoped OAuth store for serverless production.
 * Never stores plaintext access/refresh tokens or PKCE verifier.
 * The local filesystem store remains available for isolated tests.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../../db.ts";
async function getSql() { return (await import("../../db.ts")).getSql(); }
import { resolveDatabaseUrl } from "../../env.server.ts";
import { encryptSecret, decryptSecret } from "./crypto.ts";
import { sameExternalAccount, isConnectorId, isValidOAuthState, PENDING_OAUTH_TTL_MS,
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
  grant_generation: string | null; external_account_id: string | null;
  connected_at: string | Date; token_type: string | null; scopes: string | null;
  expires_at?: string | Date | null;
  scope_source?: "provider" | "requested" | "unknown" | null;
};
function restore(row: ConnRow): StoredConnection | null {
  if (!isConnectorId(row.connector)) return null;
  return {
    ownerId: row.owner_id, connector: row.connector,
    accessTokenEnc: row.access_token_enc,
    ...(row.grant_generation ? { grantGeneration: row.grant_generation } : {}),
    ...(row.external_account_id ? { externalAccountId: row.external_account_id } : {}),
    ...(row.refresh_token_enc ? { refreshTokenEnc: row.refresh_token_enc } : {}),
    ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.bot_id ? { botId: row.bot_id } : {}),
    ...(row.account_label ? { accountLabel: row.account_label } : {}),
    connectedAt: new Date(row.connected_at).toISOString(),
    ...(row.token_type ? { tokenType: row.token_type } : {}),
    ...(row.scopes ? { scopes: row.scopes } : {}),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.scope_source ? { scopeEvidence: row.scope_source } : {}),
  };
}
export async function readDurableConnection(ownerId: string, connector: ConnectorId, tx?: Sql): Promise<StoredConnection | null> {
  const sql = tx ?? await getSql();
  const rows = await sql.query<ConnRow>(
    "SELECT owner_id, connector, access_token_enc, refresh_token_enc, workspace_name, workspace_id, bot_id, account_label, connected_at, token_type, scopes, grant_generation, external_account_id FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2",
    [ownerId, connector],
  );
  return rows.length ? restore(rows[0]) : null;
}
export async function saveDurableConnection(input: {
  ownerId: string; connector: ConnectorId; accessToken: string; refreshToken?: string;
  workspaceName?: string; workspaceId?: string; botId?: string;
  accountLabel?: string; externalAccountId?: string; tokenType?: string; scopes?: string;
}, claim: string): Promise<StoredConnection> {
  if (!input.ownerId || !isConnectorId(input.connector) || !input.accessToken) throw new Error("Invalid OAuth connection.");
  const accessTokenEnc = encryptSecret(input.accessToken).ciphertext;
  const database = await getSql();
  if (!database.transaction) throw new Error("OAuth transaction unavailable.");
  return database.transaction(async (sql) => {
    await lockConnection(sql, input.ownerId, input.connector);
    const claimed = await sql.query("DELETE FROM mind_oauth_pending WHERE state_hash=$1 AND owner_id=$2 AND connector=$3 AND expires_at>now() RETURNING state_hash", [hashState(claim), input.ownerId, input.connector]);
    if (!claimed.length) throw new Error("This connection attempt has expired or was disconnected.");
    const active = await readDurableConnection(input.ownerId, input.connector, sql);
    if (input.connector === "notion" && active?.workspaceId && !input.workspaceId) throw new Error("Notion did not identify the workspace.");
    const previous = input.connector === "notion" && input.workspaceId && active?.workspaceId !== input.workspaceId
      ? (await sql.query<{ record: StoredConnection }>("SELECT record FROM mind_notion_workspaces WHERE owner_id=$1 AND workspace_id=$2", [input.ownerId, input.workspaceId]))[0]?.record ?? null
      : active;
    const refreshTokenEnc = input.refreshToken ? encryptSecret(input.refreshToken).ciphertext : sameExternalAccount(previous, input) ? previous?.refreshTokenEnc ?? null : null;
    const conn: StoredConnection = {
      ownerId: input.ownerId, connector: input.connector, accessTokenEnc, grantGeneration: randomUUID(), externalAccountId: input.externalAccountId, connectedAt: new Date().toISOString(),
      ...(refreshTokenEnc ? { refreshTokenEnc } : {}), workspaceName: input.workspaceName, workspaceId: input.workspaceId,
      botId: input.botId, accountLabel: input.accountLabel, tokenType: input.tokenType, scopes: input.scopes,
    };
    if (input.connector === "notion" && input.workspaceId) {
      await archiveWorkspace(sql, conn);
      if (active && active.workspaceId !== input.workspaceId) return conn;
    }
    await writeActive(sql, conn);
    return conn;
  });
}
async function archiveWorkspace(sql: Sql, conn: StoredConnection) {
  if (!conn.workspaceId) return;
  await sql.query("INSERT INTO mind_notion_workspaces(owner_id, workspace_id, record) VALUES($1,$2,$3::jsonb) ON CONFLICT(owner_id,workspace_id) DO UPDATE SET record=excluded.record",
    [conn.ownerId, conn.workspaceId, JSON.stringify(conn)]);
}
export async function listDurableNotionWorkspaces(owner: string, tx?: Sql): Promise<StoredConnection[]> {
  const sql = tx ?? await getSql();
  const rows = await sql.query<{ record: StoredConnection }>("SELECT record FROM mind_notion_workspaces WHERE owner_id=$1", [owner]);
  const spaces = new Map(rows.map(({ record }) => [record.workspaceId, record]));
  const active = await readDurableConnection(owner, "notion", sql);
  if (active) spaces.set(active.workspaceId, active);
  return [...spaces.values()];
}
export async function selectDurableNotionWorkspace(owner: string, id: string) {
  const sql = await getSql();
  if (!sql.transaction) throw new Error("OAuth transaction unavailable.");
  await sql.transaction(async (tx) => {
    await lockConnection(tx, owner, "notion");
    const active = await readDurableConnection(owner, "notion", tx);
    const next = (await listDurableNotionWorkspaces(owner, tx)).find((row) => (row.workspaceId || "legacy") === id);
    if (!next) throw new Error("That workspace is no longer connected.");
    if (active) await archiveWorkspace(tx, active);
    await writeActive(tx, next);
  });
}
async function writeActive(sql: Sql, conn: StoredConnection) {
    await sql.query(
      "INSERT INTO mind_oauth_connections (owner_id, connector, access_token_enc, refresh_token_enc, workspace_name, workspace_id, bot_id, account_label, connected_at, token_type, scopes, grant_generation, external_account_id)" +
      " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)" +
      " ON CONFLICT (owner_id,connector) DO UPDATE SET access_token_enc=excluded.access_token_enc, refresh_token_enc=excluded.refresh_token_enc," +
      " workspace_name=excluded.workspace_name, workspace_id=excluded.workspace_id, bot_id=excluded.bot_id," +
      " account_label=excluded.account_label, connected_at=excluded.connected_at, token_type=excluded.token_type, scopes=excluded.scopes, grant_generation=excluded.grant_generation, external_account_id=excluded.external_account_id",
      [conn.ownerId,conn.connector,conn.accessTokenEnc,conn.refreshTokenEnc ?? null,conn.workspaceName ?? null,conn.workspaceId ?? null,
        conn.botId ?? null,conn.accountLabel ?? null,conn.connectedAt,conn.tokenType ?? null,conn.scopes ?? null,conn.grantGeneration ?? randomUUID(),conn.externalAccountId ?? null],
    );
}
async function lockConnection(sql: Sql, owner: string, connector: ConnectorId) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [owner, connector]);
}
export async function clearDurableConnection(ownerId: string, connector: ConnectorId, expectedConnectedAt?: string): Promise<StoredConnection | null> {
  const sql = await getSql();
  if (!sql.transaction) throw new Error("OAuth transaction unavailable.");
  return sql.transaction(async (tx) => {
    await lockConnection(tx, ownerId, connector);
    const active = await readDurableConnection(ownerId, connector, tx);
    if (expectedConnectedAt && active?.connectedAt !== expectedConnectedAt) throw new Error("The selected connection changed. Refresh before disconnecting.");
    if (active) await tx.query("INSERT INTO mind_oauth_recovery(owner_id,connector,connection_at,status,detail) VALUES($1,$2,$3,'revocation_unknown',$4) ON CONFLICT(owner_id,connector,connection_at) DO UPDATE SET status=excluded.status,detail=excluded.detail,at=now()",
      [ownerId, connector, active.connectedAt, "Local access removed. Provider-side revocation is not yet confirmed."]);
    if (connector === "notion") {
      await tx.query("DELETE FROM mind_notion_workspaces WHERE owner_id=$1 AND workspace_id=(SELECT workspace_id FROM mind_oauth_connections WHERE owner_id=$1 AND connector=$2)", [ownerId, connector]);
    }
    await tx.query("DELETE FROM mind_oauth_pending WHERE owner_id=$1 AND connector=$2", [ownerId, connector]);
    await tx.query("DELETE FROM mind_oauth_connections WHERE owner_id=$1 AND connector=$2", [ownerId, connector]);
    return active;
  });
}
export async function getDurableAccessToken(ownerId: string, connector: ConnectorId): Promise<string | null> {
  const row = await readDurableConnection(ownerId, connector);
  return row ? decryptSecret(row.accessTokenEnc) : null;
}
/** Compare-and-set using the exact encrypted grant snapshot. No lock spans userinfo I/O. */
export async function updateDurableAccountIdentity(snapshot: StoredConnection, identity: { email: string | null; subject: string | null }, tx?: Sql): Promise<boolean> {
  if (!snapshot.ownerId || !isConnectorId(snapshot.connector) || (!identity.email && !identity.subject)) return false;
  const sql = tx ?? await getSql();
  const rows = await sql.query(
    "UPDATE mind_oauth_connections SET account_label=COALESCE($3, account_label), external_account_id=COALESCE($4, external_account_id)" +
    " WHERE owner_id=$1 AND connector=$2 AND grant_generation IS NOT DISTINCT FROM $5 AND access_token_enc=$6 RETURNING owner_id",
    [snapshot.ownerId, snapshot.connector, identity.email, identity.subject, snapshot.grantGeneration ?? null, snapshot.accessTokenEnc],
  );
  return rows.length === 1;
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
export async function takeDurablePendingOAuth(state: string, claim: string): Promise<PendingOAuth | null> {
  if (!isValidOAuthState(state)) return null;
  const sql = await getSql();
  const rows = await sql.query<PendingRow>(
    "UPDATE mind_oauth_pending SET state_hash=$2 WHERE state_hash=$1" +
    " RETURNING owner_id, connector, code_verifier_enc, redirect_uri, scopes, created_at, expires_at",
    [hashState(state),hashState(claim)],
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

/** Rotate only the exact grant that was refreshed; a disconnect/reconnect wins any race. */
export async function replaceDurableGrant(expected: StoredConnection, next: StoredConnection): Promise<boolean> {
  const database = await getSql();
  if (!database.transaction) throw new Error("OAuth transaction unavailable.");
  return database.transaction(async (sql) => {
    await lockConnection(sql, expected.ownerId, expected.connector);
    const active = await readDurableConnection(expected.ownerId, expected.connector, sql);
    const current = expected.connector === "notion" && expected.workspaceId
      ? (await listDurableNotionWorkspaces(expected.ownerId, sql)).find((row) => row.workspaceId === expected.workspaceId)
      : active;
    if (!current || current.connectedAt !== expected.connectedAt || current.accessTokenEnc !== expected.accessTokenEnc) return false;
    if (next.connector === "notion" && next.workspaceId) await archiveWorkspace(sql, next);
    if (active?.connectedAt === expected.connectedAt && active.accessTokenEnc === expected.accessTokenEnc) await writeActive(sql, next);
    return true;
  });
}
