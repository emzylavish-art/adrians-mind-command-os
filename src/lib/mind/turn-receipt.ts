import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const OPERATION_ID = /^(\d{13})-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function turnOperationExpiry(id: string, now = Date.now()): Date | null {
  const match = OPERATION_ID.exec(id);
  if (!match) return null;
  const issued = Number(match[1]);
  if (issued + DAY_MS <= now || issued > now + MAX_CLOCK_SKEW_MS) return null;
  // Leave room for clock differences between application instances and the DB.
  return new Date(issued + DAY_MS + MAX_CLOCK_SKEW_MS);
}

export async function claimTurn(
  sql: Sql,
  userId: string,
  operationId: string,
  body: Record<string, unknown>,
  expiresAt: Date,
): Promise<"claimed" | "different" | "waiting" | "responded"> {
  const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const inserted = await sql<{ operation_id: string }>`
    insert into mind_turn_receipt (user_id, operation_id, request_hash, expires_at)
    values (${userId}, ${operationId}, ${requestHash}, ${expiresAt.toISOString()})
    on conflict (user_id, operation_id) do nothing
    returning operation_id
  `;
  if (inserted.length) return "claimed";
  // A second statement sees the winner of a concurrent insert after it commits.
  const [receipt] = await sql<{ request_hash: string; responded: boolean }>`
    select request_hash, responded from mind_turn_receipt
    where user_id = ${userId} and operation_id = ${operationId}
  `;
  if (!receipt || receipt.request_hash !== requestHash) return "different";
  return receipt.responded ? "responded" : "waiting";
}

export async function finishTurnReceipt(sql: Sql, userId: string, operationId: string): Promise<void> {
  await sql`
    update mind_turn_receipt set responded = true
    where user_id = ${userId} and operation_id = ${operationId}
  `;
}

export async function pruneTurnReceipts(sql: Sql): Promise<void> {
  await sql`
    delete from mind_turn_receipt where (user_id, operation_id) in (
      select user_id, operation_id from mind_turn_receipt
      where expires_at < now() order by expires_at limit 100
    )
  `;
}
