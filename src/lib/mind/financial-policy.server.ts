import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { DEFAULT_FINANCIAL_POLICY, financialPeriods, parseFinancialPolicy, validMoney, validateMonetaryContext, type FinancialApproval, type FinancialLedgerRow, type FinancialPolicy, type FinancialReservationResult, type FinancialSnapshot, type MonetaryDispatchContext, type MonetarySettlement } from "./financial-policy.ts";
const stamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const object = (value: unknown): Record<string, unknown> => typeof value === "string" ? JSON.parse(value) : value as Record<string, unknown>;
async function connection(injected?: Sql) { return injected ?? (await import("../db.ts")).getSql(); }
const deny = (error: string, status = 409): FinancialReservationResult => ({ ok: false, error, status });
function storedPolicy(row?: { policy: unknown; revision: number }): FinancialPolicy {
  if (!row) return structuredClone(DEFAULT_FINANCIAL_POLICY);
  const parsed = parseFinancialPolicy({ ...object(row.policy), expectedRevision: Number(row.revision) });
  if (!parsed.ok) throw new Error("Stored monetary policy is invalid");
  return { ...parsed.policy, revision: Number(row.revision) };
}
export function monetaryRequestHash(context: MonetaryDispatchContext): string {
  return createHash("sha256").update(JSON.stringify([context.operationId, context.provider, context.model, context.projectId ?? null, context.taskId ?? context.operationId, context.requestHash ?? null, context.textOnly === true])).digest("hex");
}
async function lockedPolicy(tx: Sql, owner: string): Promise<FinancialPolicy> {
  await tx`insert into mind_financial_policy (user_id,policy) values (${owner},${JSON.stringify(DEFAULT_FINANCIAL_POLICY)}::jsonb) on conflict (user_id) do nothing`;
  const rows = await tx<{ policy: unknown; revision: number }>`select policy,revision from mind_financial_policy where user_id=${owner} for update`;
  if (!rows[0]) throw new Error("Monetary policy row could not be locked");
  return storedPolicy(rows[0]);
}
function safeTotal(value: unknown): number { const amount = Number(value ?? 0); if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Budget usage is not a safe integer"); return amount; }
async function totals(tx: Sql, owner: string, now: number, context?: MonetaryDispatchContext) {
  const periods = financialPeriods(now); const provider = context?.provider ?? ""; const project = context?.projectId ?? "(unscoped)"; const task = context?.taskId ?? context?.operationId ?? "";
  const rows = await tx<{ day_micros: unknown; week_micros: unknown; month_micros: unknown; provider_micros: unknown; project_micros: unknown; task_micros: unknown; unknown_count: unknown }>`select
    coalesce(sum(case when day_bucket=${periods.day} then case when state='released' then 0 else coalesce(actual_micros,reserved_micros) end else 0 end),0) as day_micros,
    coalesce(sum(case when week_bucket=${periods.week} then case when state='released' then 0 else coalesce(actual_micros,reserved_micros) end else 0 end),0) as week_micros,
    coalesce(sum(case when month_bucket=${periods.month} then case when state='released' then 0 else coalesce(actual_micros,reserved_micros) end else 0 end),0) as month_micros,
    coalesce(sum(case when month_bucket=${periods.month} and provider=${provider} then case when state='released' then 0 else coalesce(actual_micros,reserved_micros) end else 0 end),0) as provider_micros,
    coalesce(sum(case when month_bucket=${periods.month} and coalesce(project_id,'(unscoped)')=${project} then case when state='released' then 0 else coalesce(actual_micros,reserved_micros) end else 0 end),0) as project_micros,
    coalesce(sum(case when task_id=${task} then case when state='released' then 0 else coalesce(actual_micros,reserved_micros) end else 0 end),0) as task_micros,
    count(*) filter (where state in ('reserved','unknown')) as unknown_count
    from mind_financial_ledger where user_id=${owner}`;
  const row = rows[0];
  return { dayMicros: safeTotal(row?.day_micros), weekMicros: safeTotal(row?.week_micros), monthMicros: safeTotal(row?.month_micros), providerMicros: safeTotal(row?.provider_micros), projectMicros: safeTotal(row?.project_micros), taskMicros: safeTotal(row?.task_micros), unknownCount: safeTotal(row?.unknown_count) };
}
/** Called while the shared dispatch transaction is open; lock serializes all concurrent monetary reservations. */
export async function reserveFinancialWithinTransaction(tx: Sql, owner: string, context: MonetaryDispatchContext | undefined, now: number): Promise<FinancialReservationResult> {
  const policy = await lockedPolicy(tx, owner);
  if (!policy.enabled) return { ok: true };
  if (!validateMonetaryContext(context)) return deny("Monetary controls are enabled, but this operation cannot identify its exact provider, model and operation. No provider was called.");
  const task = context.taskId ?? context.operationId;
  const requestHash = monetaryRequestHash(context);
  const existing = await tx<{ request_hash: string; state: string }>`select request_hash,state from mind_financial_ledger where user_id=${owner} and operation_id=${context.operationId}`;
  if (existing.length) return deny(existing[0].request_hash !== requestHash ? "This operation ID belongs to different financial arguments. Nothing was dispatched." : "This operation already has a financial reservation or receipt. It cannot be automatically replayed; reconcile its status and prepare a new operation.");
  const freeRows = context.textOnly === true && context.provider === "openrouter"
    ? await tx<{ evidence: unknown; expires_at: unknown }>`select evidence,expires_at from mind_verified_free_pricing where user_id=${owner} and provider=${context.provider} and model=${context.model} and expires_at>${new Date(now).toISOString()}` : [];
  const free = freeRows.some(row => { const evidence = object(row.evidence); return evidence.source === "https://openrouter.ai/api/v1/models" && evidence.prompt === "0" && evidence.completion === "0" && evidence.extraChargesAbsent === true && evidence.model === context.model; });
  if (policy.freeOnly && !free) return deny("Free-only monetary policy requires fresh verified zero-price text-model metadata and compatible text-only configuration. A model name or owner estimate is not free-price proof.");
  const ceiling = policy.ceilings.find(row => row.provider === context.provider && row.model === context.model && Date.parse(row.expiresAt) > now);
  if (!free && (!ceiling || ceiling.ceilingMicros <= 0)) return deny(`${context.provider} / ${context.model} has no current positive owner-approved cost ceiling. Pricing is unknown or expired; no provider was called. Add an explicitly labeled estimate or verify eligible free pricing.`);
  const amount = free ? 0 : ceiling!.ceilingMicros;
  const used = await totals(tx, owner, now, context);
  const caps: Array<[string, number, number]> = [["daily UTC", used.dayMicros, policy.dailyLimitMicros], ["weekly UTC (Monday)", used.weekMicros, policy.weeklyLimitMicros], ["monthly UTC", used.monthMicros, policy.monthlyLimitMicros], ["task", used.taskMicros, policy.taskLimitMicros]];
  if (Object.hasOwn(policy.providerMonthlyCaps, context.provider)) caps.push(["provider monthly", used.providerMicros, policy.providerMonthlyCaps[context.provider]]);
  if (Object.hasOwn(policy.projectMonthlyCaps, context.projectId ?? "(unscoped)")) caps.push(["project monthly", used.projectMicros, policy.projectMonthlyCaps[context.projectId ?? "(unscoped)"]]);
  const exceeded = caps.find(([, spent, limit]) => spent + amount > limit);
  if (exceeded) return deny(`The ${exceeded[0]} monetary budget has insufficient unreserved allowance. Unknown charges remain reserved. No provider was called.`, 429);
  if (amount > policy.approvalAboveMicros) {
    const approvalId = createHash("sha256").update(`${owner}\0${requestHash}\0${policy.revision}\0${amount}`).digest("hex");
    const rows = await tx<{ state: string; expires_at: unknown; request_hash: string; policy_revision: number }>`select state,expires_at,request_hash,policy_revision from mind_financial_approval where user_id=${owner} and id=${approvalId}`;
    const review = rows[0];
    if (review && ["revoked", "consumed"].includes(review.state)) return deny("This costly-operation review was revoked or already used. Prepare a new operation and review its exact scope; the old review cannot be restored.");
    if (!review || review.state !== "approved" || Date.parse(stamp(review.expires_at)) <= now || review.request_hash !== requestHash || Number(review.policy_revision) !== policy.revision) {
      const expiresAt = new Date(now + 5 * 60_000).toISOString();
      await tx`insert into mind_financial_approval (user_id,id,operation_id,request_hash,request,ceiling_micros,policy_revision,state,expires_at) values (${owner},${approvalId},${context.operationId},${requestHash},${JSON.stringify({ ...context, projectId: context.projectId ?? null, taskId: task })}::jsonb,${amount},${policy.revision},'pending',${expiresAt}) on conflict (user_id,id) do update set state='pending',expires_at=excluded.expires_at,updated_at=now() where mind_financial_approval.state in ('pending','approved') and mind_financial_approval.expires_at <= ${new Date(now).toISOString()}`;
      return { ok: false, status: 409, approvalId, error: "This execution exceeds your automatic-approval threshold. Review the exact pending provider/model/task ceiling in Usage & budgets, then explicitly retry this unchanged operation. Nothing was sent." };
    }
    await tx`update mind_financial_approval set state='consumed',updated_at=now() where user_id=${owner} and id=${approvalId} and state='approved'`;
  }
  const id = randomUUID(); const periods = financialPeriods(now);
  await tx`insert into mind_financial_ledger (user_id,id,operation_id,request_hash,provider,model,project_id,task_id,reserved_micros,state,cost_basis,day_bucket,week_bucket,month_bucket,policy_revision,created_at,updated_at) values (${owner},${id},${context.operationId},${requestHash},${context.provider},${context.model},${context.projectId ?? null},${task},${amount},'reserved',${free ? "verified_free" : "owner_estimate"},${periods.day},${periods.week},${periods.month},${policy.revision},${new Date(now).toISOString()},${new Date(now).toISOString()})`;
  return { ok: true, reservationId: id };
}
export async function saveFinancialPolicy(owner: string, value: unknown, injected?: Sql) {
  const input = parseFinancialPolicy(value); if (!owner || !input.ok) return { ok: false as const, error: input.ok ? "Owner required." : input.error };
  const sql = await connection(injected); if (!sql.transaction) return { ok: false as const, error: "Atomic monetary policy storage is unavailable." };
  return sql.transaction(async tx => {
    const updated = input.expectedRevision === 0
      ? await tx`insert into mind_financial_policy (user_id,policy,revision) values (${owner},${JSON.stringify(input.policy)}::jsonb,1) on conflict (user_id) do nothing returning revision`
      : await tx`update mind_financial_policy set policy=${JSON.stringify(input.policy)}::jsonb,revision=revision+1,updated_at=now() where user_id=${owner} and revision=${input.expectedRevision} returning revision`;
    if (!updated.length) return { ok: false as const, error: "Monetary policy changed in another session. Refresh before saving." };
    await tx`update mind_financial_approval set state='revoked',updated_at=now() where user_id=${owner} and state in ('pending','approved')`;
    return { ok: true as const };
  });
}
export async function approveFinancialRequest(owner: string, id: string, approve: boolean, injected?: Sql, now = Date.now()) {
  const sql = await connection(injected); if (!sql.transaction || !/^[a-f0-9]{64}$/.test(id)) return { ok: false as const, error: "A current monetary approval is required." };
  return sql.transaction(async tx => {
    const policy = await lockedPolicy(tx, owner);
    const rows = await tx<{ state: string; expires_at: unknown; policy_revision: number }>`select state,expires_at,policy_revision from mind_financial_approval where user_id=${owner} and id=${id} for update`;
    const row = rows[0];
    if (!row || !["pending","approved"].includes(row.state) || Date.parse(stamp(row.expires_at)) <= now || Number(row.policy_revision) !== policy.revision || !policy.enabled) return { ok: false as const, error: "This review expired, changed or was already used. Request a fresh exact review." };
    await tx`update mind_financial_approval set state=${approve ? "approved" : "revoked"},expires_at=${new Date(now + 5 * 60_000).toISOString()},updated_at=now() where user_id=${owner} and id=${id}`;
    return { ok: true as const };
  });
}
export async function settleFinancialReservation(owner: string, id: string | undefined, receipt: MonetarySettlement, injected?: Sql): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: true };
  try {
    const sql = await connection(injected); if (!sql.transaction) throw new Error("Atomic settlement required");
    return await sql.transaction(async tx => {
      await lockedPolicy(tx, owner);
      const rows = await tx<{ state: string; actual_micros: unknown; cost_basis: string }>`select state,actual_micros,cost_basis from mind_financial_ledger where user_id=${owner} and id=${id} for update`;
      const row = rows[0]; if (!row) return { ok: false, error: "The owner's financial reservation was not found." };
      if (row.state === "settled" || row.state === "released") return { ok: true }; // A later callback cannot undo a settled charge or invoice.
      const actual = receipt.currency === "USD" && validMoney(receipt.actualCostMicros) ? receipt.actualCostMicros : null;
      const state = receipt.outcome === "not_sent" && (actual === null || actual === 0) ? "released" : actual !== null ? "settled" : "unknown";
      await tx`update mind_financial_ledger set state=${state},actual_micros=${state === "released" ? 0 : actual},cost_basis=${actual !== null && state !== "released" ? "provider_reported" : row.cost_basis},provider_request_id=${typeof receipt.providerRequestId === "string" ? receipt.providerRequestId.slice(0,240) : null},updated_at=now() where user_id=${owner} and id=${id}`;
      return { ok: true };
    });
  } catch { return { ok: false, error: "Dollar settlement could not be recorded. The conservative reservation remains; reconcile it before treating the amount as spent or free." }; }
}
export async function reconcileFinancialInvoice(owner: string, input: { reservationId: string; invoiceRef: string; actualCostMicros: number; currency: string; confirmed: boolean }, injected?: Sql) {
  if (!input || input.confirmed !== true || input.currency !== "USD" || !validMoney(input.actualCostMicros) || typeof input.invoiceRef !== "string" || !input.invoiceRef.trim() || input.invoiceRef.length > 240) return { ok: false as const, error: "Confirm the exact USD invoice amount and a bounded invoice reference." };
  const sql = await connection(injected); if (!sql.transaction) return { ok: false as const, error: "Atomic invoice reconciliation is unavailable." };
  return sql.transaction(async tx => {
    await lockedPolicy(tx, owner);
    const rows = await tx<{ actual_micros: unknown }>`select actual_micros from mind_financial_ledger where user_id=${owner} and id=${input.reservationId} for update`;
    if (!rows.length) return { ok: false as const, error: "This account has no matching reservation." };
    const prior = await tx<{ actual_micros: unknown }>`select actual_micros from mind_financial_reconciliation where user_id=${owner} and ledger_id=${input.reservationId} and invoice_ref=${input.invoiceRef}`;
    if (prior.length) return Number(prior[0].actual_micros) === input.actualCostMicros ? { ok: true as const } : { ok: false as const, error: "That invoice reference already records a different amount. Use a distinct correction reference so the audit trail is retained." };
    await tx`insert into mind_financial_reconciliation (user_id,id,ledger_id,invoice_ref,actual_micros,previous_micros) values (${owner},${randomUUID()},${input.reservationId},${input.invoiceRef},${input.actualCostMicros},${rows[0].actual_micros ?? null})`;
    await tx`update mind_financial_ledger set actual_micros=${input.actualCostMicros},state='settled',cost_basis='owner_invoice',invoice_ref=${input.invoiceRef},updated_at=now() where user_id=${owner} and id=${input.reservationId}`;
    return { ok: true as const };
  });
}
function ledgerRow(row: Record<string, unknown>): FinancialLedgerRow {
  return { id: String(row.id), operationId: String(row.operation_id), provider: String(row.provider), model: String(row.model), projectId: row.project_id == null ? null : String(row.project_id), taskId: String(row.task_id), reservedMicros: safeTotal(row.reserved_micros), actualMicros: row.actual_micros == null ? null : safeTotal(row.actual_micros), state: row.state as FinancialLedgerRow["state"], costBasis: row.cost_basis as FinancialLedgerRow["costBasis"], providerRequestId: row.provider_request_id == null ? null : String(row.provider_request_id), createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at), invoiceRef: row.invoice_ref == null ? null : String(row.invoice_ref) };
}
export async function readFinancialSnapshot(owner: string, injected?: Sql, now = Date.now()): Promise<FinancialSnapshot> {
  const sql = await connection(injected);
  const policy = storedPolicy((await sql<{ policy: unknown; revision: number }>`select policy,revision from mind_financial_policy where user_id=${owner}`)[0]);
  const ledger = await sql<Record<string,unknown>>`select * from mind_financial_ledger where user_id=${owner} order by created_at desc,id desc limit 1001`;
  const corrections = await sql<Record<string,unknown>>`select id,ledger_id,invoice_ref,actual_micros,previous_micros,created_at from mind_financial_reconciliation where user_id=${owner} order by created_at desc,id desc limit 1001`;
  const pending = await sql<Record<string,unknown>>`select id,operation_id,request,ceiling_micros,state,expires_at from mind_financial_approval where user_id=${owner} and state in ('pending','approved') order by updated_at desc limit 100`;
  const approvals: FinancialApproval[] = pending.map(row => { const request = object(row.request); return { id: String(row.id), operationId: String(row.operation_id), provider: String(request.provider), model: String(request.model), projectId: request.projectId == null ? null : String(request.projectId), taskId: String(request.taskId), ceilingMicros: safeTotal(row.ceiling_micros), state: row.state as FinancialApproval["state"], expiresAt: stamp(row.expires_at) }; });
  const verified = await sql<{ provider: string; model: string; expires_at: unknown }>`select provider,model,expires_at from mind_verified_free_pricing where user_id=${owner} and expires_at>${new Date(now).toISOString()} order by provider,model limit 1000`;
  return { policy, totals: await totals(sql, owner, now), ledger: ledger.slice(0,1000).map(ledgerRow), reconciliations: corrections.slice(0,1000).map(row => ({ id: String(row.id), reservationId: String(row.ledger_id), invoiceRef: String(row.invoice_ref), actualMicros: safeTotal(row.actual_micros), previousMicros: row.previous_micros == null ? null : safeTotal(row.previous_micros), createdAt: stamp(row.created_at) })), approvals, verifiedFreeModels: verified.map(row => ({ provider: row.provider, model: row.model, expiresAt: stamp(row.expires_at) })), incompleteHistory: ledger.length > 1000 || corrections.length > 1000 };
}
/** A deliberate owner refresh of official public metadata; never a provider inference call. */
export async function refreshVerifiedFreePricing(owner: string, injected?: Sql, fetcher: typeof fetch = fetch, now = Date.now(), timeoutMs = 8000) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new Error("Pricing catalogue timed out.")); }, Math.max(1,Math.min(timeoutMs,8000))); });
    const body = await Promise.race([(async () => {
      const response = await fetcher("https://openrouter.ai/api/v1/models", { redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`Pricing catalogue returned HTTP ${response.status}.`);
      const length = response.headers.get("content-length");
      if (length && Number(length) > 5_000_000) { void response.body?.cancel().catch(() => {}); throw new Error("Pricing catalogue exceeded its supported size."); }
      if (!response.body) throw new Error("Pricing catalogue returned no body.");
      reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0; let text = "";
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 5_000_000) { void reader.cancel().catch(() => {}); throw new Error("Pricing catalogue exceeded its supported size."); }
        text += decoder.decode(part.value, { stream: true });
      }
      return text + decoder.decode();
    })(), deadline]);
    const parsed = JSON.parse(body) as { data?: unknown };
    if (!Array.isArray(parsed.data) || parsed.data.length > 10000) throw new Error("Pricing catalogue response is invalid.");
    const seen = new Set<string>();
    const free = parsed.data.flatMap(value => {
      if (!value || typeof value !== "object") return [];
      const row = value as { id?: unknown; pricing?: unknown };
      if (typeof row.id !== "string" || !row.id.endsWith(":free") || row.id.length > 240 || /\p{Cc}/u.test(row.id) || !row.pricing || typeof row.pricing !== "object" || Array.isArray(row.pricing)) return [];
      if (seen.has(row.id)) throw new Error("Pricing catalogue repeats a model identity.");
      seen.add(row.id);
      const pricing = row.pricing as Record<string,unknown>;
      // Unknown fields, conditional overrides, missing rates and any positive modality charge
      // disqualify proof. The all-zero text contract never guesses how an exception applies.
      const rates = new Set(["prompt","completion","request","image","web_search","internal_reasoning","input_cache_read","input_cache_write","image_output","audio","audio_output","image_token","input_audio_cache","input_cache_write_1h"]);
      if (pricing.prompt === undefined || pricing.completion === undefined || Object.entries(pricing).some(([key,price]) => key === "overrides" ? !Array.isArray(price) || price.length > 0 : !rates.has(key) || typeof price !== "string" || !/^0(?:\.0+)?$/.test(price))) return [];
      return [{ model: row.id, evidence: { model: row.id, source: "https://openrouter.ai/api/v1/models", prompt: "0", completion: "0", extraChargesAbsent: true, capturedAt: new Date(now).toISOString(), scope: "text_only" } }];
    });
    const sql = await connection(injected); if (!sql.transaction) return { ok: false as const, error: "Atomic pricing evidence storage is unavailable." };
    await sql.transaction(async tx => { await lockedPolicy(tx,owner); await tx`delete from mind_verified_free_pricing where user_id=${owner} and provider='openrouter'`; for (const row of free) await tx`insert into mind_verified_free_pricing (user_id,provider,model,evidence,expires_at) values (${owner},'openrouter',${row.model},${JSON.stringify(row.evidence)}::jsonb,${new Date(now + 15*60_000).toISOString()})`; });
    return { ok: true as const, count: free.length };
  } catch (error) { return { ok: false as const, error: `${error instanceof Error ? error.message : "Pricing catalogue could not be verified."} Existing evidence keeps its original expiry; this failed refresh authorizes nothing new.` }; }
  finally { if (timer) clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
}
