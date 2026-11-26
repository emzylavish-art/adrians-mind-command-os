import { createHash } from "node:crypto";
import type { Sql } from "../../db.ts";
import type { StoredConnection } from "./store.ts";
import type { NotionTurn } from "../notion.ts";
import { notionReturnHref, type NotionOperationObservation } from "../notion-operation-status.ts";

export function notionGrantGeneration(grant: StoredConnection): string {
  // Legacy archived grants have no generation. Ciphertext is server-only and never returned.
  return grant.grantGeneration || createHash("sha256").update(grant.accessTokenEnc).digest("hex");
}
export function observationFromTurn(grant: StoredConnection, turn: NotionTurn, chatId?: string, startedAt = new Date().toISOString()): NotionOperationObservation | null {
  const operation = turn.failure?.operation ?? turn.action;
  if (!["search", "read", "append"].includes(operation) || turn.needsConfirmation || turn.ambiguous || (!turn.ok && !turn.failure && !turn.wrote)) return null;
  const page = operation === "search" ? null : turn.pages[0];
  return {
    workspaceId: grant.workspaceId || "legacy", grantGeneration: notionGrantGeneration(grant),
    operation: operation as NotionOperationObservation["operation"], pageId: page?.id ?? "", pageTitle: page?.title ?? "",
    ok: turn.ok, wrote: turn.wrote, verified: turn.verified, observedAt: startedAt,
    ...(turn.failure ? { failure: turn.failure } : {}),
    ...(notionReturnHref(chatId) ? { chatId } : {}),
  };
}
export async function saveNotionObservation(sql: Sql, owner: string, observation: NotionOperationObservation) {
  await sql.query("INSERT INTO mind_notion_operation_status(owner_id,workspace_id,page_id,operation,grant_generation,outcome,observed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(owner_id,workspace_id,page_id,operation) DO UPDATE SET grant_generation=excluded.grant_generation,outcome=excluded.outcome,observed_at=excluded.observed_at WHERE mind_notion_operation_status.observed_at<=excluded.observed_at",
    [owner, observation.workspaceId, observation.pageId, observation.operation, observation.grantGeneration, JSON.stringify(observation), observation.observedAt]);
}
export async function readNotionObservations(sql: Sql, owner: string, workspaceId: string): Promise<NotionOperationObservation[]> {
  const rows = await sql.query<{ outcome: NotionOperationObservation }>("SELECT outcome FROM mind_notion_operation_status WHERE owner_id=$1 AND workspace_id=$2 ORDER BY observed_at DESC LIMIT 200", [owner, workspaceId]);
  return rows.map((row) => row.outcome);
}
