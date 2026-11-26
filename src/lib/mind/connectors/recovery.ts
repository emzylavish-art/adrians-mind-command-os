async function getSql() { return (await import("../../db.ts")).getSql(); }
import { hasDurableOAuthStore } from "./durable-oauth.server.ts";
import { readLocalOAuthRecovery, saveLocalOAuthRecovery, type ConnectorId, type OAuthRecovery, type ConnectionPublic } from "./store.ts";

export async function saveOAuthRecovery(ownerId: string, connector: ConnectorId, record: OAuthRecovery): Promise<void> {
  if (!hasDurableOAuthStore()) { saveLocalOAuthRecovery(ownerId, connector, record); return; }
  await (await getSql()).query("INSERT INTO mind_oauth_recovery(owner_id,connector,connection_at,status,detail,at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,connector,connection_at) DO UPDATE SET status=excluded.status,detail=excluded.detail,at=excluded.at",
    [ownerId, connector, record.connectionAt, record.status, record.detail.slice(0, 500), record.at]);
}

export async function readOAuthRecovery(ownerId: string, connector: ConnectorId, connectionAt?: string): Promise<OAuthRecovery | null> {
  if (!hasDurableOAuthStore()) return readLocalOAuthRecovery(ownerId, connector, connectionAt);
  const row = (await (await getSql()).query<{ connection_at: string; status: string; detail: string; at: string | Date }>(
    "SELECT connection_at,status,detail,at FROM mind_oauth_recovery WHERE owner_id=$1 AND connector=$2 AND ($3::text IS NULL OR connection_at=$3) ORDER BY (status='revocation_unknown') DESC,at DESC LIMIT 1", [ownerId, connector, connectionAt ?? null]))[0];
  return row ? { connectionAt: row.connection_at, status: row.status, detail: row.detail, at: new Date(row.at).toISOString() } : null;
}

export function withOAuthRecovery(pub: ConnectionPublic, record: OAuthRecovery | null): ConnectionPublic {
  if (!record || record.status === "revoked" || record.status === "refreshed") return pub;
  // A fresh connection supersedes an older refresh failure, but not unresolved provider revocation.
  if (record.status === "reconnect_required" && pub.connectedAt !== record.connectionAt) return pub;
  return { ...pub, detail: `${pub.detail} ${record.detail}`, recovery: { status: record.status, detail: record.detail, at: record.at } };
}
