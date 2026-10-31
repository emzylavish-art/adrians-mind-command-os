import { nextClock } from "./schedule-clock.ts";

export type TickJob = {
  id: string;
  ownerId: string;
  enabled: boolean;
  nextRunAt: string;
  intervalMinutes: number;
  timeZone: string;
  clockHour: number | null;
  clockMinute: number | null;
};

export type TickLease = { workerId: string; until: string };

export type TickResult = { id: string; ownerId: string; status: "ran" | "skipped" | "failed"; detail: string };

function advance(job: TickJob, now: string): string {
  if (job.clockHour == null) {
    const start = Date.parse(now);
    return new Date((Number.isFinite(start) ? start : Date.now()) + job.intervalMinutes * 60_000).toISOString();
  }
  return nextClock(now, job.timeZone || "UTC", job.clockHour, job.clockMinute ?? 0).at;
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
    const outcome = run(job);
    results.push({ id: job.id, ownerId: job.ownerId, status: outcome.ok ? "ran" : "failed", detail: outcome.detail });
    return { ...job, nextRunAt: advance(job, now) };
  });
  return { jobs: next, results };
}
