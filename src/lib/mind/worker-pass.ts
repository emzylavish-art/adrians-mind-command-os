import type { Sql } from "../db.ts";
import type { ScheduleJob } from "./fleet.ts";
import { nextClock } from "./schedule-clock.ts";
import { writeSnapshot } from "./store.ts";
import type { AuditEntry } from "./types.ts";
import { normalizeWorkspace } from "./workspace.ts";

export type WorkerPass = { owners: number; ran: number; skipped: number; failed: number; recovered: number };

export type Claim = { jobs: ScheduleJob[]; claimed: string[]; skipped: string[]; recovered: string[] };

function leaseKey(ownerId: string, id: string) {
  return `${ownerId}:${id}`;
}

function later(now: string, minutes: number) {
  const start = Date.parse(now);
  return new Date((Number.isFinite(start) ? start : Date.now()) + minutes * 60_000).toISOString();
}

function advance(job: ScheduleJob, now: string) {
  if (job.clockHour == null) return later(now, job.intervalMinutes);
  return nextClock(now, job.timeZone || "UTC", job.clockHour, job.clockMinute ?? 0).at;
}

export function claimSchedules(jobs: ScheduleJob[], now: string, workerId: string): Claim {
  const claimed: string[] = [];
  const skipped: string[] = [];
  const recovered: string[] = [];
  const next = jobs.map((job) => {
    if (!job.enabled || job.nextRunAt > now) return job;
    if (job.leaseUntil && job.leaseUntil > now && job.leaseWorker && job.leaseWorker !== workerId) {
      skipped.push(job.id);
      return job;
    }
    if (job.leaseWorker && job.leaseUntil && job.leaseUntil <= now) recovered.push(job.id);
    claimed.push(job.id);
    return { ...job, leaseWorker: workerId, leaseUntil: later(now, 1) };
  });
  return { jobs: next, claimed, skipped, recovered };
}

export async function runWorkerPass(
  sql: Sql,
  now: string,
  workerId: string,
  run: (job: ScheduleJob) => { ok: boolean; detail: string } = () => ({ ok: true, detail: "Queued. No model was called." }),
): Promise<WorkerPass> {
  const rows = await sql<{ user_id: string; payload: unknown }>`select user_id, payload from mind_snapshot`;
  const summary: WorkerPass = { owners: rows.length, ran: 0, skipped: 0, failed: 0, recovered: 0 };
  for (const row of rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as unknown : row.payload;
    const ws = normalizeWorkspace(payload);
    const claim = claimSchedules(ws.schedules, now, workerId);
    summary.skipped += claim.skipped.length;
    summary.recovered += claim.recovered.length;
    if (claim.claimed.length === 0) continue;
    await writeSnapshot(sql, row.user_id, { ...ws, schedules: claim.jobs });
    const outcomes = new Map<string, { ok: boolean; detail: string }>();
    for (const id of claim.claimed) {
      const job = claim.jobs.find((item) => item.id === id);
      if (!job) continue;
      outcomes.set(id, run(job));
    }
    const schedules = claim.jobs.map((job) => {
      const outcome = outcomes.get(job.id);
      if (!outcome) return job;
      const failed = !outcome.ok;
      return { ...job, nextRunAt: advance(job, now), lastRunAt: now, lastError: failed ? outcome.detail : "", lastStatus: failed ? "failed" as const : "ran" as const, leaseWorker: null, leaseUntil: null };
    });
    const audit: AuditEntry[] = [...outcomes.entries()].map(([id, outcome]) => ({
      id: `audit-${leaseKey(row.user_id, id)}-${now}`,
      at: now,
      action: outcome.ok ? "schedule_ran" : "schedule_failed",
      target: id,
      result: outcome.detail,
    }));
    await writeSnapshot(sql, row.user_id, { ...ws, schedules, audit: [...audit, ...ws.audit].slice(0, 200) });
    for (const outcome of outcomes.values()) summary[outcome.ok ? "ran" : "failed"] += 1;
  }
  return summary;
}
