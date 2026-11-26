import { nextClock } from "./schedule-clock.ts";

export type MissedRunPolicy = "once" | "skip" | "review";
export type ScheduleRecovery = { dueCount: number; nextRunAt: string; overdue: boolean };

/** Keep interval schedules anchored to their original due time after a late check. */
export function scheduleRecovery(job: {
  nextRunAt: string;
  intervalMinutes: number;
  clockHour: number | null;
  clockMinute: number | null;
  timeZone: string;
}, now: string): ScheduleRecovery {
  const due = Date.parse(job.nextRunAt);
  const at = Date.parse(now);
  if (!Number.isFinite(due) || !Number.isFinite(at)) {
    throw new Error("The schedule has an invalid due time. Nothing was queued.");
  }
  if (due > at) return { dueCount: 0, nextRunAt: job.nextRunAt, overdue: false };
  if (job.clockHour != null) {
    // Clock schedules use the existing zone/DST resolver. Count only observed due
    // slots; do not guess a number of 24-hour periods across daylight-saving time.
    let next = job.nextRunAt;
    let dueCount = 0;
    while (next <= now && dueCount < 366) {
      dueCount += 1;
      next = nextClock(next, job.timeZone || "UTC", job.clockHour, job.clockMinute ?? 0, next).at;
    }
    if (next <= now) next = nextClock(now, job.timeZone || "UTC", job.clockHour, job.clockMinute ?? 0, job.nextRunAt).at;
    return { dueCount, nextRunAt: next, overdue: dueCount > 1 };
  }
  const interval = Math.max(5, Math.min(10_080, job.intervalMinutes || 1440)) * 60_000;
  const dueCount = Math.floor((at - due) / interval) + 1;
  return { dueCount, nextRunAt: new Date(due + dueCount * interval).toISOString(), overdue: dueCount > 1 };
}
