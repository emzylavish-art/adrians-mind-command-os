import { scheduleOccurrences, type ScheduleTiming } from "./schedule-policy.ts";

export type TickJob = {
  id: string;
  ownerId: string;
  enabled: boolean;
  nextRunAt: string;
  intervalMinutes: number;
  timeZone: string;
  clockHour: number | null;
  clockMinute: number | null;
  timing?: ScheduleTiming;
};

export type TickLease = { workerId: string; until: string };

export type TickResult = { id: string; ownerId: string; status: "ran" | "skipped" | "failed"; detail: string };

function advance(job: TickJob, now: string): string {
  return scheduleOccurrences(job, now).nextRunAt;
}

export function tickSchedules(
  jobs: TickJob[],
  now: string,
  workerId: string,
  leases: Map<string, TickLease>,
  run: (job: TickJob) => { ok: boolean; detail: string },
): { jobs: TickJob[]; results: TickResult[] } {
  const results: TickResult[] = [];
  const next = jobs.map((job) => {
    if (!job.enabled || job.nextRunAt > now) return job;
    const lease = leases.get(`${job.ownerId}:${job.id}`);
    if (lease && lease.until > now && lease.workerId !== workerId) {
      results.push({ id: job.id, ownerId: job.ownerId, status: "skipped", detail: "Another worker holds this job. It was not run twice." });
      return job;
    }
    leases.set(`${job.ownerId}:${job.id}`, { workerId, until: new Date(Date.parse(now) + 60_000).toISOString() });
    let outcome: { ok: boolean; detail: string };
    try { outcome = run(job); }
    catch { outcome = { ok: false, detail: "The executor threw after dispatch. Its outcome is unknown; reconcile before another attempt." }; }
    results.push({ id: job.id, ownerId: job.ownerId, status: outcome.ok ? "ran" : "failed", detail: outcome.detail });
    return { ...job, nextRunAt: advance(job, now) };
  });
  return { jobs: next, results };
}
