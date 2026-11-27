import type { Sql } from "./db.ts";

export type DatabaseReadiness = { connected: true; workspaceSchema: true };

/** Read-only workspace readiness. Success is connectivity/schema proof, not backup or provider proof. */
export async function verifyDatabaseReadiness(sql: Pick<Sql, "query">): Promise<DatabaseReadiness> {
  try {
    await sql.query("select 1 as connected");
  } catch {
    throw new Error("Database readiness failed: the configured database could not be reached.");
  }
  try {
    // Parse the columns the persistence path requires without reading owner records.
    await sql.query("select user_id, payload, updated_at from mind_snapshot limit 0");
    await sql.query("select user_id, id, messages, retrieval_log from mind_chat limit 0");
    await sql.query("select user_id, id, scope, body, versions from mind_memory limit 0");
  } catch {
    throw new Error("Database readiness failed: required workspace schema is unavailable. Apply the reviewed migrations before release.");
  }
  return { connected: true, workspaceSchema: true };
}
