import { nextClock } from "./schedule-clock.ts";

export type ScheduleTiming = "fixed_rate" | "fixed_delay";
export type MissedSchedulePolicy = "latest" | "skip" | "ask" | "all" | "once" | "review";
export type SchedulePolicyInput = {
  nextRunAt: string;
  intervalMinutes: number;
  timeZone: string;
  clockHour: number | null;
  clockMinute: number | null;
  timing?: ScheduleTiming;
  missedPolicy?: MissedSchedulePolicy;
};

/** Recovery is bounded per pass; unqueued occurrences remain due for a later pass. */
export const MAX_RECOVERED_OCCURRENCES = 10;

export function scheduleOccurrences(job: SchedulePolicyInput, now: string): {
  occurrences: string[];
  nextRunAt: string;
  missed: number;
  needsReview: boolean;
} {
  const nowMs = Date.parse(now);
  const dueMs = Date.parse(job.nextRunAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(dueMs) || dueMs > nowMs) {
    return { occurrences: [], nextRunAt: job.nextRunAt, missed: 0, needsReview: false };
  }
  const interval = Math.max(5, Math.min(10_080, job.intervalMinutes || 1440)) * 60_000;
  const policy = job.missedPolicy === "review" ? "ask" : job.missedPolicy === "once" ? "latest" : job.missedPolicy ?? "latest";
  let due: string[] = [];
  let nextRunAt: string;
  let missed: number;
  if (job.clockHour == null) {
    const count = Math.floor((nowMs - dueMs) / interval) + 1;
    missed = Math.max(0, count - 1);
    const latest = new Date(dueMs + (count - 1) * interval).toISOString();
    due = policy === "all"
      ? Array.from({ length: Math.min(count, MAX_RECOVERED_OCCURRENCES) }, (_, index) => new Date(dueMs + index * interval).toISOString())
      : [latest];
    nextRunAt = job.timing === "fixed_delay" && !(policy === "all" && count > due.length)
      ? new Date(nowMs + interval).toISOString()
      : new Date(dueMs + (policy === "all" ? due.length : count) * interval).toISOString();
  } else {
    // Calendar occurrences must be calculated in their time zone, not by adding 24h.
    let cursor = job.nextRunAt;
    let count = 0;
    let latest = cursor;
    // Bound work on corrupt or years-old imports. The remainder stays pending.
    while (cursor <= now && count < 366) {
      latest = cursor;
      if (due.length < MAX_RECOVERED_OCCURRENCES) due.push(cursor);
      count++;
      cursor = nextClock(cursor, job.timeZone, job.clockHour, job.clockMinute ?? 0, cursor).at;
    }
    missed = Math.max(0, count - 1);
    if (policy !== "all") due = [latest];
    nextRunAt = policy === "all"
      ? nextClock(due[due.length - 1]!, job.timeZone, job.clockHour, job.clockMinute ?? 0, due[due.length - 1]).at
      : cursor <= now ? nextClock(now, job.timeZone, job.clockHour, job.clockMinute ?? 0).at : cursor;
  }
  const isLate = nowMs - dueMs > 60_000;
  if (policy === "ask" && isLate) return { occurrences: [], nextRunAt: job.nextRunAt, missed: Math.max(1, missed), needsReview: true };
  if (policy === "skip" && isLate) return { occurrences: [], nextRunAt, missed: Math.max(1, missed), needsReview: false };
  return { occurrences: due, nextRunAt, missed, needsReview: false };
}
