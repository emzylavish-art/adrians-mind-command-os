import type { Sql } from "../db.ts";
import { haltFleet, runDueSchedules, tickFleet, type AgentRun, type ScheduleJob } from "./fleet.ts";
import { readHaltState } from "./halt.server.ts";
import { scheduleOccurrences } from "./schedule-policy.ts";
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
  return scheduleOccurrences(job, now).nextRunAt;
}

export function claimSchedules(jobs: ScheduleJob[], now: string, workerId: string): Claim {
  const claimed: string[] = [];
  const skipped: string[] = [];
  const recovered: string[] = [];
  const next = jobs.map((job) => {
    if (!job.enabled || job.nextRunAt > now) return job;
    if (job.leaseUntil && job.leaseUntil > now && job.leaseWorker) {
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
      const result = claimSchedules(current.halted ? [] : current.schedules, now, workerId);
      return { result, workspace: result.claimed.length ? { ...current, schedules: result.jobs } : undefined };
    });
    summary.skipped += claim.skipped.length;
    summary.recovered += claim.recovered.length;
    if (claim.claimed.length === 0) continue;
    const outcomes = new Map<string, { ok: boolean; detail: string }>();
    for (const id of claim.claimed) {
      const job = claim.jobs.find((item) => item.id === id);
      if (!job) continue;
      try { outcomes.set(id, run(job)); }
      catch { outcomes.set(id, { ok: false, detail: "The executor threw after dispatch. Its outcome is unknown; reconcile before another attempt." }); }
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
        return { ...job, nextRunAt: advance(job, now), lastAttemptAt: now, lastRunAt: failed ? job.lastRunAt : now, lastError: failed ? outcome.detail : "", lastStatus: failed ? "failed" as const : "ran" as const, leaseWorker: null, leaseUntil: null };
      });
      const entries = audit.filter((entry) => completed.has(entry.target));
      return { result: undefined, workspace: entries.length ? { ...current, schedules, audit: [...entries, ...current.audit].slice(0, 200) } : undefined };
    });
    for (const outcome of outcomes.values()) summary[outcome.ok ? "ran" : "failed"] += 1;
  }
  return summary;
}

/** Advance only scheduled local runs. External tools remain waiting for the owner/runtime. */
export async function runLocalSchedulePass(sql: Sql, now: string, workerId: string, readStop = readHaltState, environment: "local-worker" | "hosted-worker" = "local-worker"): Promise<WorkerPass> {
  if (!sql.transaction) throw new Error("A schedule pass requires transactional storage.");
  const owners = await sql<{ user_id: string }>`select user_id from mind_snapshot`;
  const summary: WorkerPass = { owners: owners.length, ran: 0, failed: 0, skipped: 0, recovered: 0 };
  for (const owner of owners) {
    const stop = await readStop(owner.user_id);
    if (stop === "unknown") {
      summary.skipped++;
      continue;
    }
    const result = await updateOwnerWorkspace(sql, owner.user_id, (current) => {
      if (current.halted || stop === "on") {
        const pending = current.schedules.some((job) => job.enabled) || current.runs.some((run) => !["completed", "failed", "canceled"].includes(run.state));
        if (!pending) return { result: { ran: 0, failed: 0 } };
        const stopped = haltFleet({ ...current, halted: true }, now);
        return { workspace: { ...stopped, schedules: stopped.schedules.map((job) => ({ ...job, enabled: false })) }, result: { ran: 0, failed: 0 } };
      }
      const heartbeat = { ...current, schedules: current.schedules.map(job => job.enabled && job.executionTarget === environment ? { ...job, workerId, workerHeartbeatAt: now } : job) };
      const due = runDueSchedules(heartbeat, now, environment);
      const owned = (run: AgentRun) => run.id.startsWith("scheduled:") || run.parentId?.startsWith("scheduled:");
      const scheduledRuns = due.runs.filter(owned);
      const active = scheduledRuns.some((run) => run.state === "queued" || run.state === "running");
      const justAttempted = due.schedules.some((job, i) => job !== current.schedules[i]);
      if (!active && !justAttempted) return { result: { ran: 0, failed: 0 } };
      const stepped = tickFleet({ ...due, runs: scheduledRuns }, { workerId, now, runtime: "scheduled-local", environment });
      const changed = stepped.runs.filter((run) => !run.parentId && current.runs.find(old => old.id === run.id)?.state !== run.state);
      const failed = due.schedules.filter((job, i) => job !== current.schedules[i] && job.lastError).length;
      // This local step finished inside the owner snapshot transaction. A later one-shot
      // process can safely take the next step as soon as the transaction commits.
      const released = stepped.runs.map((run) => run.workerId === workerId ? { ...run, workerId: null, leaseUntil: null } : run);
      return {
        workspace: { ...stepped, runs: [...released, ...due.runs.filter((run) => !owned(run))] },
        result: { ran: changed.filter((r) => r.state === "completed").length, failed: failed + changed.filter((r) => r.state === "failed").length },
      };
    });
    summary.ran += result.ran;
    summary.failed += result.failed;
  }
  return summary;
}
