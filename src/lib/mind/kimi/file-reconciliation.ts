import type { Sql } from "../../db.ts";
import { fileRevision } from "./file-revision.ts";
import { accountFilePath } from "./account-workspace.ts";
export type FileReconciliation = { action: "rename" | "delete"; path: string; to?: string; expectedRevision: string };
/** Reconcile only the already-reviewed revision, never a newly changed account copy. */
export async function reconcileStoredMutation(sql: Sql, owner: string, input: FileReconciliation, diskMatches: () => boolean): Promise<{ ok: boolean; error?: string }> {
  if (!sql.transaction) return { ok: false, error: "Atomic account storage is unavailable." };
  const path = accountFilePath(input.path);
  const to = input.action === "rename" ? accountFilePath(input.to) : null;
  if (!path || (input.action === "rename" && !to) || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) return { ok: false, error: "Invalid reviewed reconciliation." };
  return sql.transaction(async (tx) => {
    const [source] = await tx.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id=$1 and path=$2 for update", [owner, path]);
    if (!diskMatches()) return { ok: false, error: "The disk copy changed. Review both copies before reconciling." };
    if (source && fileRevision(source.text_copy) !== input.expectedRevision) return { ok: false, error: "The account copy changed. It was preserved for a fresh review." };
    if (input.action === "delete") {
      if (source) await tx.query("delete from mind_kimi_file where user_id=$1 and path=$2", [owner, path]);
      return { ok: true };
    }
    const [destination] = await tx.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id=$1 and path=$2 for update", [owner, to]);
    if (!source) return destination && fileRevision(destination.text_copy) === input.expectedRevision ? { ok: true } : { ok: false, error: "The account destination does not match the reviewed rename." };
    if (destination) return { ok: false, error: "The destination already exists in account storage. Both copies were preserved." };
    try {
      await tx.query("update mind_kimi_file set path=$3, updated_at=now() where user_id=$1 and path=$2", [owner, path, to]);
      return { ok: true };
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") return { ok: false, error: "The destination was created concurrently. Review it before reconciling." };
      throw error;
    }
  });
}
