import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { DEFAULT_RESOURCE_POLICY, readResourcePolicy, resourceEstimate, resourcePlanAllowed, isAutomaticallyFreeModelRoute, type ResourcePolicy, type ResourcePrice } from "./resource-policy.ts";

export type ResourceReservation = { operationId: string; taskId: string; owner: string; day: string; estimate: number | null; price?: ResourcePrice; inputTokens: number; outputTokens: number };
async function database(): Promise<Sql> { return (await import("../db.ts")).getSql(); }
export async function getResourcePolicy(owner: string, db?: Sql): Promise<{ policy: ResourcePolicy; revision: number }> {
  const sql = db ?? await database();
  const [row] = await sql<{ policy: unknown; revision: number }>`select policy, revision from mind_resource_policy where owner_id = ${owner}`;
  return row ? { policy: readResourcePolicy(row.policy), revision: row.revision } : { policy: { ...DEFAULT_RESOURCE_POLICY, prices: {} }, revision: 0 };
}
export async function saveResourcePolicy(owner: string, value: unknown, expectedRevision: number, db?: Sql): Promise<number> {
  const policy = readResourcePolicy(value);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid policy revision.");
  const sql = db ?? await database();
  if (!sql.transaction) throw new Error("Atomic policy storage is unavailable.");
  return sql.transaction(async (tx) => {
    await tx.query("insert into mind_resource_policy(owner_id, revision, policy) values($1, 0, $2::jsonb) on conflict do nothing", [owner, JSON.stringify(DEFAULT_RESOURCE_POLICY)]);
    const result = await tx.query<{ revision: number }>("update mind_resource_policy set policy=$3::jsonb, revision=revision+1, updated_at=now() where owner_id=$1 and revision=$2 returning revision", [owner, expectedRevision, JSON.stringify(policy)]);
    if (!result[0]) throw new Error("Spending policy changed elsewhere. Reload before saving.");
    return result[0].revision;
  });
}
export async function reserveResourceOperation(input: { owner: string; taskId: string; provider: string; model: string; free: boolean; freeOnly?: boolean; unknownCost?: boolean; unknownTokens?: boolean; inputTokens: number; outputTokens: number; db?: Sql }): Promise<ResourceReservation> {
  const sql = input.db ?? await database();
  if (!sql.transaction) throw new Error("Atomic resource authorization is unavailable.");
  const day = new Date().toISOString().slice(0, 10);
  return sql.transaction(async (tx) => {
    await tx.query("insert into mind_resource_policy(owner_id, revision, policy) values($1,0,$2::jsonb) on conflict do nothing", [input.owner, JSON.stringify(DEFAULT_RESOURCE_POLICY)]);
    const [row] = await tx.query<{ policy: unknown }>("select policy from mind_resource_policy where owner_id=$1 for update", [input.owner]);
    const policy = readResourcePolicy(row.policy);
    if (input.freeOnly) policy.freeOnly = true;
    if (input.unknownTokens && policy.maxTokensPerDay !== null) throw new Error("Token usage is unknown. This token policy cannot authorize an unmetered process.");
    await tx.query("insert into mind_resource_day(owner_id, day) values($1,$2) on conflict do nothing", [input.owner, day]);
    const [usage] = await tx.query<{ calls: number; tokens: number; reserved_usd_micros: number; calculated_usd_micros: number }>("select * from mind_resource_day where owner_id=$1 and day=$2 for update", [input.owner, day]);
    // Unfinished attempts retain their monetary hold; concurrency leases expire after ten minutes.
    const [running] = await tx.query<{ count: number }>("select count(*)::integer as count from mind_resource_operation where owner_id=$1 and status='reserved' and created_at > now() - interval '10 minutes'", [input.owner]);
    const price = policy.prices[`${input.provider}:${input.model}`];
    const estimate = input.free ? 0 : input.unknownCost ? null : resourceEstimate(price, input.inputTokens, input.outputTokens);
    const error = resourcePlanAllowed({ policy, free: input.free, estimate, calls: Number(usage.calls), active: Number(running.count), tokens: Number(usage.tokens) + input.inputTokens + input.outputTokens - 1, committed: Number(usage.reserved_usd_micros) + Number(usage.calculated_usd_micros) });
    if (error) throw new Error(error);
    const operationId = randomUUID();
    await tx.query("update mind_resource_day set calls=calls+1, tokens=tokens+$3, reserved_usd_micros=reserved_usd_micros+$4 where owner_id=$1 and day=$2", [input.owner, day, input.inputTokens + input.outputTokens, estimate ?? 0]);
    await tx.query("insert into mind_resource_operation(owner_id,operation_id,task_id,provider,model,day,estimated_usd_micros,reserved_usd_micros,pricing_revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9)", [input.owner, operationId, input.taskId, input.provider, input.model, day, estimate, estimate ?? 0, price?.revision ?? null]);
    return { operationId, taskId: input.taskId, owner: input.owner, day, estimate, price, inputTokens: input.inputTokens, outputTokens: input.outputTokens };
  });
}
export async function settleResourceOperation(reservation: ResourceReservation, result: { usage?: { prompt_tokens?: number; completion_tokens?: number } | null; requestId?: string | null; outcome: "succeeded" | "failed" | "unknown" | "not_dispatched" }, db?: Sql): Promise<void> {
  const sql = db ?? await database();
  if (!sql.transaction) throw new Error("Atomic resource settlement is unavailable.");
  const prompt = result.usage?.prompt_tokens;
  const completion = result.usage?.completion_tokens;
  const known = typeof prompt === "number" && typeof completion === "number" && Number.isSafeInteger(prompt) && prompt >= 0 && Number.isSafeInteger(completion) && completion >= 0;
  const calculated = result.outcome === "not_dispatched" || reservation.estimate === 0 ? 0 : known ? resourceEstimate(reservation.price, prompt, completion) : null;
  await sql.transaction(async (tx) => {
    const updated = await tx.query("update mind_resource_operation set status=$3, calculated_usd_micros=$4, usage=$5::jsonb, request_id=$6, updated_at=now() where owner_id=$1 and operation_id=$2 and status='reserved' returning operation_id", [reservation.owner, reservation.operationId, result.outcome, calculated, JSON.stringify(result.usage ?? null), result.requestId ?? null]);
    if (!updated.length) return;
    if (calculated !== null) await tx.query("update mind_resource_day set reserved_usd_micros=greatest(0,reserved_usd_micros-$3), calculated_usd_micros=calculated_usd_micros+$4 where owner_id=$1 and day=$2", [reservation.owner, reservation.day, reservation.estimate ?? 0, calculated]);
    if (known) await tx.query("update mind_resource_day set tokens=greatest(0,tokens-$3)+$4 where owner_id=$1 and day=$2", [reservation.owner, reservation.day, reservation.inputTokens + reservation.outputTokens, prompt + completion]);
  });
}
export async function resourceLedger(owner: string, db?: Sql) {
  const sql = db ?? await database();
  return sql.query("select operation_id, task_id, provider, model, status, estimated_usd_micros, reserved_usd_micros, calculated_usd_micros, pricing_revision, usage, request_id, created_at from mind_resource_operation where owner_id=$1 order by created_at desc limit 100", [owner]);
}

/** Shared dispatch wrapper; each helper and final answer reserves independently. */
export async function governedModelCall<T extends { ok: boolean; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; requestId?: string | null }>(input: {
  owner: string; taskId: string; provider: string; model: string; inputChars: number; outputTokens?: number; freeOnly?: boolean; unknownTokens?: boolean; unknownCost?: boolean; signal?: AbortSignal; call: () => Promise<T>;
}): Promise<(T & { resourceOperationId: string }) | { ok: false; text: string; error: string; model: string; httpStatus: number }> {
  let reservation: ResourceReservation;
  try {
    if (input.signal?.aborted) throw new Error("Canceled before dispatch.");
    reservation = await reserveResourceOperation({ owner: input.owner, taskId: input.taskId, provider: input.provider, model: input.model, free: isAutomaticallyFreeModelRoute(input.provider, input.model, process.env.LOCAL_MODEL_URL), freeOnly: input.freeOnly, unknownTokens: input.unknownTokens, unknownCost: input.unknownCost, inputTokens: Math.ceil(input.inputChars / 3), outputTokens: input.outputTokens ?? 1024 });
  } catch (error) { return { ok: false, text: "", model: input.model, httpStatus: 403, error: error instanceof Error ? error.message : "Resource authorization unavailable. Nothing was sent." }; }
  let started = false;
  try {
    // Recheck durable stop after reservation and immediately before the adapter boundary.
    const { haltIsOn } = await import("./halt.server.ts");
    if (input.signal?.aborted || await haltIsOn(input.owner)) throw new Error("Execution stopped before provider dispatch.");
    started = true;
    const result = await input.call();
    await settleResourceOperation(reservation, { usage: result.usage, requestId: result.requestId, outcome: result.ok ? "succeeded" : "unknown" }).catch(() => {});
    return { ...result, resourceOperationId: reservation.operationId };
  } catch (error) {
    await settleResourceOperation(reservation, { outcome: started ? "unknown" : "not_dispatched" }).catch(() => {});
    return { ok: false, text: "", model: input.model, httpStatus: 502, error: error instanceof Error ? error.message : "Provider outcome is unknown. No automatic retry was attempted." };
  }
}

export function settleResourceStream(response: Response, reservation: ResourceReservation): Response {
  if (!response.body) { void settleResourceOperation(reservation, { outcome: "unknown" }).catch(() => {}); return response; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  let finished = false;
  const settle = async (result: Parameters<typeof settleResourceOperation>[1]) => {
    if (finished) return; finished = true;
    await settleResourceOperation(reservation, result).catch(() => {});
  };
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) { await settle({ outcome: "unknown" }); controller.close(); return; }
        rest += decoder.decode(part.value, { stream: true });
        const frames = rest.split("\n\n"); rest = frames.pop() || "";
        for (const frame of frames) {
          if (!frame.startsWith("event: done")) continue;
          const line = frame.split("\n").find((v) => v.startsWith("data:"));
          if (!line) continue;
          try { const value = JSON.parse(line.slice(5)); await settle({ outcome: "succeeded", usage: value.usage, requestId: value.requestId }); } catch { /* incomplete receipt is unknown */ }
        }
        if (rest.length > 1_000_000) rest = "";
        controller.enqueue(part.value);
      } catch (error) { await settle({ outcome: "unknown" }); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); await settle({ outcome: "unknown" }); },
  }), { status: response.status, headers: response.headers });
}
