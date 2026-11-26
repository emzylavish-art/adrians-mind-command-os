import type { Sql } from "../db.ts";
import { reserveFinancialWithinTransaction, settleFinancialReservation } from "./financial-policy.server.ts";
import type { MonetaryDispatchContext, MonetarySettlement } from "./financial-policy.ts";
export type DispatchPolicy = { paused: boolean; dailyLimit: number; revision: number; usedToday: number };
const dayBucket = (now: number) => `day:${new Date(now).toISOString().slice(0, 10)}`;
async function connection(injected?: Sql) { if (injected) return injected; return (await import("../db.ts")).getSql(); }
export async function readDispatchPolicy(ownerId: string, injected?: Sql, now = Date.now()): Promise<DispatchPolicy> {
  const sql = await connection(injected);
  const rows = await sql<{ paused: boolean; daily_limit: number; revision: number }>`select paused,daily_limit,revision from mind_dispatch_policy where user_id=${ownerId}`;
  const usage = await sql<{ used: number }>`select used from mind_dispatch_bucket where user_id=${ownerId} and bucket=${dayBucket(now)}`;
  return { paused: rows[0]?.paused === true, dailyLimit: Number(rows[0]?.daily_limit ?? 1000), revision: Number(rows[0]?.revision ?? 0), usedToday: Number(usage[0]?.used ?? 0) };
}
export async function saveDispatchPolicy(ownerId: string, input: { paused: boolean; dailyLimit: number; expectedRevision: number }, injected?: Sql) {
  if (!ownerId || !input || typeof input.paused !== "boolean" || !Number.isInteger(input.dailyLimit) || input.dailyLimit < 0 || input.dailyLimit > 10000 || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) return { ok: false as const, error: "Choose a daily request limit from 0 to 10,000 and refresh the current policy first." };
  const sql = await connection(injected);
  const rows = input.expectedRevision === 0
    ? await sql`insert into mind_dispatch_policy (user_id,paused,daily_limit,revision) values (${ownerId},${input.paused},${input.dailyLimit},1) on conflict (user_id) do nothing returning revision`
    : await sql`update mind_dispatch_policy set paused=${input.paused},daily_limit=${input.dailyLimit},revision=revision+1,updated_at=now() where user_id=${ownerId} and revision=${input.expectedRevision} returning revision`;
  return rows.length ? { ok: true as const } : { ok: false as const, error: "The policy changed in another session. Refresh it before saving again." };
}

/** One reservation per actual dispatch, across workers and restarts. Local time is UTC and clearly surfaced. */
export async function reserveOwnerDispatch(ownerId: string, injected?: Sql, now = Date.now(), monetaryContext?: MonetaryDispatchContext): Promise<{ ok: true; reservationId?: string } | { ok: false; error: string; status: number; retryAfter?: number; approvalId?: string }> {
  try {
    const sql = await connection(injected); if (!sql.transaction) throw new Error("Atomic storage required");
    return await sql.transaction(async (tx) => {
      await tx`insert into mind_dispatch_policy (user_id) values (${ownerId}) on conflict (user_id) do nothing`;
      const rows = await tx<{ paused: boolean; daily_limit: number }>`select paused,daily_limit from mind_dispatch_policy where user_id=${ownerId} for update`;
      const policy = rows[0]; if (!policy) throw new Error("Missing policy");
      if (policy.paused) return { ok: false as const, error: "Provider requests are paused for this account. No new request was dispatched.", status: 403 };
      const minute = `minute:${Math.floor(now / 60000)}`; const day = dayBucket(now);
      const counts = await tx<{ bucket: string; used: number }>`select bucket,used from mind_dispatch_bucket where user_id=${ownerId} and bucket in (${minute},${day})`;
      const usage = new Map(counts.map((row) => [row.bucket, Number(row.used)]));
      if ((usage.get(day) ?? 0) >= Number(policy.daily_limit)) return { ok: false as const, error: "The account’s daily provider request limit is reached. No paid fallback or automatic retry was started.", status: 429, retryAfter: Math.max(1, Math.ceil((Date.parse(new Date(now + 86400000).toISOString().slice(0, 10)) - now) / 1000)) };
      if ((usage.get(minute) ?? 0) >= 24) return { ok: false as const, error: "The account’s provider dispatch limit is reached. Wait before explicitly retrying.", status: 429, retryAfter: Math.max(1, Math.ceil((60000 - now % 60000) / 1000)) };
      const monetary = await reserveFinancialWithinTransaction(tx, ownerId, monetaryContext, now);
      if (!monetary.ok) return monetary;
      for (const bucket of [minute, day]) await tx`insert into mind_dispatch_bucket (user_id,bucket,used) values (${ownerId},${bucket},1) on conflict (user_id,bucket) do update set used=mind_dispatch_bucket.used+1,updated_at=now()`;
      await tx`delete from mind_dispatch_bucket where user_id=${ownerId} and updated_at < now() - interval '2 days'`;
      return { ok: true as const, ...(monetary.reservationId ? { reservationId: monetary.reservationId } : {}) };
    });
  } catch { return { ok: false, error: "Shared provider limits could not be verified. No provider was called. Retry when account storage is available.", status: 503 }; }
}

/** Actual USD receipts settle holds; absent money retains unknown conservative reservations. */
export function settleOwnerDispatch(ownerId: string, reservationId: string | undefined, receipt: MonetarySettlement, injected?: Sql) {
  return settleFinancialReservation(ownerId, reservationId, receipt, injected);
}
