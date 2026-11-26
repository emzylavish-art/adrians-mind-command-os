import type { Sql } from "../db.ts";
import { finishTurnReceipt } from "./turn-receipt.ts";

const MAX_RECOVERY_BYTES = 1_000_000;
export async function readTurnRecovery(sql: Sql, owner: string, operation: string): Promise<Response | null> {
  const [row] = await sql<{ response_body: string | null; response_status: number | null; response_type: string | null }>`
    select response_body, response_status, response_type from mind_turn_receipt
    where user_id = ${owner} and operation_id = ${operation} and expires_at > now() and responded = true
  `;
  if (!row?.response_body || !row.response_status || !row.response_type) return null;
  return new Response(row.response_body, { status: row.response_status, headers: { "content-type": row.response_type, "cache-control": "no-store", "x-mind-recovered": "true" } });
}

/** Saves only a fully delivered response under the existing owner and 24h expiry. */
export function recoverableTurnResponse(input: {
  response: Response; sql: Sql; owner: string; operation: string; retain: boolean; dispatched: boolean;
}): Response {
  const { response, sql, owner, operation, retain, dispatched } = input;
  if (!response.body) {
    void finishTurnReceipt(sql, owner, operation, !dispatched).catch(() => {});
    return response;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  const complete = async (store: boolean) => {
    if (finished) return;
    finished = true;
    try {
      if (store && retain && dispatched && size <= MAX_RECOVERY_BYTES) {
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        const content = new TextDecoder().decode(data);
        await sql`update mind_turn_receipt set response_body = ${content}, response_status = ${response.status}, response_type = ${response.headers.get("content-type") || "application/json"}, responded = true, retryable = false where user_id = ${owner} and operation_id = ${operation}`;
      } else await finishTurnReceipt(sql, owner, operation, !dispatched);
    } catch { /* Deduplication remains in force when optional recovery storage fails. */ }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) { await complete(true); controller.close(); return; }
        size += part.value.length;
        if (retain && size <= MAX_RECOVERY_BYTES) chunks.push(part.value.slice());
        else chunks.length = 0;
        controller.enqueue(part.value);
      } catch (error) { await complete(false); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); await complete(false); },
  });
  return new Response(body, { status: response.status, headers: response.headers });
}
