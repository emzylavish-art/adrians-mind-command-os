import type { Sql } from "../db.ts";
import { enqueueRun, tickFleet, type ScheduleJob } from "./fleet.ts";
import { nextClock } from "./schedule-clock.ts";
import { writeSnapshot } from "./store.ts";
import type { AuditEntry } from "./types.ts";
import { normalizeWorkspace } from "./workspace.ts";

export type WorkerPass = { owners: number; ran: number; skipped: number; failed: number; recovered: number; agentPasses: number };

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

/**
 * Dispatches due schedules. The default handler queues a real, bounded agent
 * run in the owner workspace; it does not claim to execute an AI model.
 * Callers may supply an explicit handler for deterministic tests or adapters.
 *
 * The file-backed local worker is not a hosted always-on executor.
 */
export async function runWorkerPass(
  sql: Sql,
  now: string,
  workerId: string,
  run?: (job: ScheduleJob) => { ok: boolean; detail: string },
): Promise<WorkerPass> {
  const rows = await sql<{ user_id: string; payload: unknown }>`select user_id, payload from mind_snapshot`;
  const summary: WorkerPass = { owners: rows.length, ran: 0, skipped: 0, failed: 0, recovered: 0, agentPasses: 0 };
  for (const row of rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as unknown : row.payload;
    const ws = normalizeWorkspace(payload);
    // An emergency stop must never create agent runs, even from due schedules.
    if (ws.halted) {
      summary.skipped += ws.schedules.filter((job) => job.enabled && job.nextRunAt <= now).length;
      continue;
    }
    const claim = claimSchedules(ws.schedules, now, workerId);
    summary.skipped += claim.skipped.length;
    summary.recovered += claim.recovered.length;
    if (claim.claimed.length === 0) {
      // The schedule runner is also the local agent worker. Queued runs must
      // progress even when there are no schedules due in this minute.
      // With no browser/search driver supplied, remote actions fail closed.
      const runnable = ws.runs.some(
        (item) => item.state === "queued" ||
          (item.state === "running" && (!item.leaseUntil || item.leaseUntil <= now)),
      );
      if (runnable) {
        const progressed = tickFleet(ws, { now, workerId });
        if (JSON.stringify(progressed) !== JSON.stringify(ws)) {
          await writeSnapshot(sql, row.user_id, progressed);
          summary.agentPasses += 1;
        }
      }
      continue;
    }
    let nextWs = { ...ws, schedules: claim.jobs };
    // Persist the short-lived lease before dispatching a task.
    await writeSnapshot(sql, row.user_id, nextWs);
    const outcomes = new Map<string, { ok: boolean; detail: string }>();
    for (const id of claim.claimed) {
      const job = claim.jobs.find((item) => item.id === id);
      if (!job) continue;
      let outcome: { ok: boolean; detail: string };
      try {
        if (run) {
          outcome = run(job);
        } else if (!job.agentId) {
          outcome = { ok: false, detail: "No agent is assigned. Nothing was queued." };
        } else {
          const queued = enqueueRun(nextWs, job.agentId, job.name, now);
          if (queued.ok) {
            nextWs = queued.ws;
            outcome = { ok: true, detail: "Agent run queued. It has not executed yet." };
          } else {
            outcome = { ok: false, detail: queued.error };
          }
        }
      } catch {
        outcome = { ok: false, detail: "The schedule handler failed. Nothing was marked successful." };
      }
      outcomes.set(id, outcome);
    }
    const schedules = nextWs.schedules.map((job) => {
      const outcome = outcomes.get(job.id);
      if (!outcome) return job;
      const failed = !outcome.ok;
      return {
        ...job,
        nextRunAt: advance(job, now),
        lastRunAt: now,
        lastError: failed ? outcome.detail : "",
        // This status describes the schedule trigger, not execution of the agent.
        lastStatus: failed ? "failed" as const : "ran" as const,
        leaseWorker: null,
        leaseUntil: null,
      };
    });
    const audit: AuditEntry[] = [...outcomes.entries()].map(([id, outcome]) => ({
      id: `audit-${leaseKey(row.user_id, id)}-${now}`,
      at: now,
      action: !outcome.ok ? "schedule_failed" : run ? "schedule_ran" : "schedule_queued",
      target: id,
      result: outcome.detail,
    }));
    await writeSnapshot(sql, row.user_id, { ...nextWs, schedules, audit: [...audit, ...nextWs.audit].slice(0, 200) });
    for (const outcome of outcomes.values()) summary[outcome.ok ? "ran" : "failed"] += 1;
  }
  return summary;
}
