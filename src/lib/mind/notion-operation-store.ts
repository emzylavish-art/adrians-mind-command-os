import type { Sql } from "../db.ts";
import type { NotionPage } from "./notion.ts";

export type NotionOperationState = "prepared" | "dispatched" | "accepted" | "verified" | "rejected" | "uncertain";
export type NotionOperation = {
  id: string; workspaceId: string; fingerprint: string; page: NotionPage;
  state: NotionOperationState; blockIds: string[];
};
export type NotionOperationStore = {
  read: (id: string) => Promise<NotionOperation | null>;
  prepare: (operation: NotionOperation) => Promise<NotionOperation>;
  claim: (id: string, fingerprint: string) => Promise<boolean>;
  finish: (id: string, state: NotionOperationState, blockIds?: string[]) => Promise<void>;
};

/** Owner scoping is supplied by verified server authentication, never by the browser. */
export function sqlNotionOperationStore(sql: Sql, ownerId: string): NotionOperationStore {
  const read = async (id: string): Promise<NotionOperation | null> => {
    const rows = await sql.query<{ id: string; workspace_id: string; fingerprint: string; page: NotionPage; state: NotionOperationState; block_ids: string[] }>(
      "SELECT id,workspace_id,fingerprint,page,state,block_ids FROM mind_notion_operation WHERE owner_id=$1 AND id=$2", [ownerId, id]);
    const row = rows[0];
    return row ? { id: row.id, workspaceId: row.workspace_id, fingerprint: row.fingerprint, page: row.page, state: row.state, blockIds: row.block_ids } : null;
  };
  return {
    read,
    prepare: async (op) => {
      await sql.query("INSERT INTO mind_notion_operation(owner_id,id,workspace_id,fingerprint,page,state) VALUES($1,$2,$3,$4,$5::jsonb,'prepared') ON CONFLICT(owner_id,id) DO NOTHING",
        [ownerId, op.id, op.workspaceId, op.fingerprint, JSON.stringify(op.page)]);
      const saved = await read(op.id);
      if (!saved) throw new Error("Operation preparation was not saved.");
      return saved;
    },
    claim: async (id, fingerprint) => (await sql.query(
      "UPDATE mind_notion_operation SET state='dispatched',updated_at=now() WHERE owner_id=$1 AND id=$2 AND fingerprint=$3 AND state='prepared' RETURNING id",
      [ownerId, id, fingerprint])).length === 1,
    finish: async (id, state, blockIds) => {
      await sql.query("UPDATE mind_notion_operation SET state=CASE WHEN state='verified' THEN state ELSE $3 END,block_ids=COALESCE($4::jsonb,block_ids),updated_at=now() WHERE owner_id=$1 AND id=$2",
        [ownerId, id, state, blockIds ? JSON.stringify(blockIds) : null]);
    },
  };
}
