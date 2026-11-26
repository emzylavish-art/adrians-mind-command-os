import type { Sql } from "../db.ts";
import { pullMindEvents } from "./stream.ts";
import type { UsageReceipt } from "./usage-ledger.ts";
import { validTokenCount } from "./provider-usage.ts";

/** No prompts, credentials, account labels, or response text are persisted here. */
export async function writeUsageReceipt(sql: Sql, ownerId: string, receipt: UsageReceipt): Promise<void> {
  const safe = { ...receipt, id: `${receipt.operationId}/${receipt.stage}`, promptTokens: validTokenCount(receipt.promptTokens) ?? null, completionTokens: validTokenCount(receipt.completionTokens) ?? null };
  await sql`insert into mind_usage_ledger (user_id, operation_id, stage, at, payload)
    values (${ownerId}, ${receipt.operationId}, ${receipt.stage}, ${receipt.at}, ${JSON.stringify(safe)}::jsonb)
    on conflict (user_id, operation_id, stage) do update set payload = excluded.payload || jsonb_build_object(
      'promptTokens', coalesce(nullif(excluded.payload->'promptTokens', 'null'::jsonb), mind_usage_ledger.payload->'promptTokens', 'null'::jsonb),
      'completionTokens', coalesce(nullif(excluded.payload->'completionTokens', 'null'::jsonb), mind_usage_ledger.payload->'completionTokens', 'null'::jsonb),
      'requestId', coalesce(nullif(excluded.payload->'requestId', 'null'::jsonb), mind_usage_ledger.payload->'requestId', 'null'::jsonb)
    )
    where mind_usage_ledger.payload->>'outcome' <> 'completed' or excluded.payload->>'outcome' = 'completed'`;
}

export async function readUsageLedger(sql: Sql, ownerId: string, input: { offset?: number; limit?: number; from?: string; to?: string } = {}) {
  const integer = (value: number | undefined, fallback: number, minimum: number, maximum: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
  const limit = integer(input.limit, 200, 1, 500);
  // Do not clamp successive pages to the same arbitrary offset: that repeats
  // one page forever when an owner has more historical receipts than the cap.
  const offset = integer(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const from = input.from && Number.isFinite(Date.parse(input.from)) ? new Date(input.from).toISOString() : "1970-01-01T00:00:00.000Z";
  const to = input.to && Number.isFinite(Date.parse(input.to)) ? new Date(input.to).toISOString() : new Date().toISOString();
  const rows = await sql<{ payload: UsageReceipt }>`select payload from mind_usage_ledger where user_id = ${ownerId} and at >= ${from} and at <= ${to} order by at desc, operation_id, stage limit ${limit + 1} offset ${offset}`;
  return { entries: rows.slice(0, limit).map(row => typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload), nextOffset: rows.length > limit && Number.isSafeInteger(offset + limit) ? offset + limit : null, from, to };
}

/** Observe the existing response; never repeat inference to obtain accounting. */
export function trackUsageResponse(response: Response, initial: UsageReceipt, record: (receipt: UsageReceipt) => Promise<void>): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "", terminal = false;
  const save = (receipt: UsageReceipt) => record(receipt).catch(() => undefined);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          if (!terminal) await save({ ...initial, outcome: "unconfirmed" });
          controller.close(); return;
        }
        carry += decoder.decode(chunk.value, { stream: true });
        const parsed = pullMindEvents(carry); carry = parsed.rest;
        // A malformed/unbounded frame cannot grow an accounting buffer indefinitely.
        if (carry.length > 3_000_000) carry = "";
        for (const event of parsed.events) {
          if (event.event === "done") {
            terminal = true;
            await save({ ...initial, outcome: "completed", provider: event.provider ?? initial.provider, model: event.model, requestedModel: event.requestedModel ?? initial.requestedModel, requestId: event.requestId, promptTokens: event.usage?.prompt_tokens ?? null, completionTokens: event.usage?.completion_tokens ?? null });
          } else if (event.event === "error" || event.event === "canceled") {
            terminal = true; await save({ ...initial, outcome: event.event === "canceled" ? "canceled" : "failed" });
          }
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        if (!terminal) await save({ ...initial, outcome: "unconfirmed" });
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (!terminal) await save({ ...initial, outcome: "unconfirmed" });
      await reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
