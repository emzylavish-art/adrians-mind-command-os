import type { Sql } from "../db.ts";
import type { ScheduleJob } from "./fleet.ts";
import { nextClock } from "./schedule-clock.ts";
import { updateOwnerWorkspace } from "./store.ts";
import type { AuditEntry } from "./types.ts";

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
  run: (job: ScheduleJob) => { ok: boolean; detail: string } = () => ({ ok: false, detail: "No schedule executor is configured. This job was not run." }),
): Promise<WorkerPass> {
  const rows = await sql<{ user_id: string }>`select user_id from mind_snapshot`;
  const summary: WorkerPass = { owners: rows.length, ran: 0, skipped: 0, failed: 0, recovered: 0 };
  for (const row of rows) {
    const claim = await updateOwnerWorkspace(sql, row.user_id, (current) => {
      const result = claimSchedules(current.schedules, now, workerId);
      return { result, workspace: result.claimed.length ? { ...current, schedules: result.jobs } : undefined };
    });
    summary.skipped += claim.skipped.length;
    summary.recovered += claim.recovered.length;
    if (claim.claimed.length === 0) continue;
    const outcomes = new Map<string, { ok: boolean; detail: string }>();
    for (const id of claim.claimed) {
      const job = claim.jobs.find((item) => item.id === id);
      if (!job) continue;
      outcomes.set(id, run(job));
    }
    const audit: AuditEntry[] = [...outcomes.entries()].map(([id, outcome]) => ({
      id: `audit-${leaseKey(row.user_id, id)}-${now}`,
      at: now,
      action: outcome.ok ? "schedule_ran" : "schedule_failed",
      target: id,
      result: outcome.detail,
    }));
    const leases = new Map(claim.jobs.map((job) => [job.id, job.leaseUntil]));
    await updateOwnerWorkspace(sql, row.user_id, (current) => {
      const completed = new Set<string>();
      const schedules = current.schedules.map((job) => {
        const outcome = outcomes.get(job.id);
        if (!outcome || job.leaseWorker !== workerId || job.leaseUntil !== leases.get(job.id)) return job;
        completed.add(job.id);
        const failed = !outcome.ok;
        return { ...job, nextRunAt: advance(job, now), lastRunAt: now, lastError: failed ? outcome.detail : "", lastStatus: failed ? "failed" as const : "ran" as const, leaseWorker: null, leaseUntil: null };
      });
      const entries = audit.filter((entry) => completed.has(entry.target));
      return { result: undefined, workspace: entries.length ? { ...current, schedules, audit: [...entries, ...current.audit].slice(0, 200) } : undefined };
    });
    for (const outcome of outcomes.values()) summary[outcome.ok ? "ran" : "failed"] += 1;
  }
  return summary;
}
