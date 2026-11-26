import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { EXECUTION_LEDGER_TTL_MS, executionMetadata, type ExecutionOutcome, type RecordIssuedResult } from "./execution-ledger.ts";
import { writeToolRun } from "./notion-record.ts";

/** Called only after a server-side adapter supplies the outcome. Never accepts client outcomes. */
export async function issueDurableExecution(sql: Sql, ownerId: string, outcome: ExecutionOutcome, now = Date.now()): Promise<string> {
  const id = randomUUID();
  const safe: ExecutionOutcome = {
    tool: outcome.tool.slice(0, 80), action: outcome.action === "voice" ? "voice" : "chat",
    ok: outcome.ok === true, detail: outcome.detail.slice(0, 500),
    ...(outcome.metadata ? { metadata: executionMetadata(outcome.metadata) } : {}),
  };
  await sql.query("INSERT INTO mind_execution_receipt(owner_id,id,outcome,issued_at_ms) VALUES($1,$2,$3::jsonb,$4)",
    [ownerId, id, JSON.stringify(safe), now]);
  return id;
}

/** Validation, idempotent insertion and consumption commit together, across server instances. */
export async function recordDurableExecution(sql: Sql, ownerId: string, id: string, now = Date.now()): Promise<RecordIssuedResult> {
  if (!sql.transaction) return { ok: false, error: "Execution storage cannot start a transaction. Retry recording later." };
  try {
    return await sql.transaction(async (tx) => {
      const rows = await tx.query<{ outcome: ExecutionOutcome; issued_at_ms: number | string; recorded_at: unknown }>(
        "SELECT outcome,issued_at_ms,recorded_at FROM mind_execution_receipt WHERE owner_id=$1 AND id=$2 FOR UPDATE", [ownerId, id]);
      const receipt = rows[0];
      if (!receipt) return { ok: false, error: "That execution id is not recognized. Nothing was recorded." };
      // A client retry after a lost response returns the recorded outcome without creating another row.
      if (receipt.recorded_at) return { ok: true };
      if (now - Number(receipt.issued_at_ms) > EXECUTION_LEDGER_TTL_MS) {
        return { ok: false, error: "That execution receipt expired. The original action was not repeated." };
      }
      await writeToolRun(tx, ownerId, { id, ...receipt.outcome });
      await tx.query("UPDATE mind_execution_receipt SET recorded_at=now() WHERE owner_id=$1 AND id=$2", [ownerId, id]);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "The execution record could not be saved. Retry recording; the original action will not run again." };
  }
}
