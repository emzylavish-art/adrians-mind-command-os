import type { Workspace } from "./types.ts";
import { groupUsage } from "./usage-ledger.ts";

const DAY = 86_400_000;
export type ChartInterval = "Daily" | "Weekly" | "Cumulative";

export function profileActivity(ws: Pick<Workspace, "usage" | "runs">, interval: ChartInterval, now = Date.now()) {
  const today = Math.floor(now / DAY);
  const days = groupUsage(ws.usage, "day").filter(day => day.key !== "unknown");
  const byDay = new Map(days.map(day => [Date.parse(day.key) / DAY, day]));
  let longestStreak = 0, streak = 0, previous = -Infinity, knownTokens = 0, peak = 0, missing = 0;
  for (const [day, bucket] of byDay) {
    const known = bucket.knownPromptTokens + bucket.knownCompletionTokens;
    knownTokens += known;
    peak = Math.max(peak, known);
    missing += bucket.incomplete;
    streak = previous + 1 === day ? streak + 1 : 1;
    previous = day;
    longestStreak = Math.max(streak, longestStreak);
  }
  const completed = ws.runs.filter(run => run.state === "completed").map(run => Date.parse(run.updatedAt) - Date.parse(run.createdAt)).filter(ms => Number.isFinite(ms) && ms >= 0);
  const buckets: { date: string; end: string; known: number; receipts: number; partial: number }[] = [];
  let cumulative = 0;
  for (let index = 0; index < 84; index++) {
    const day = today - 83 + index;
    const date = new Date(day * DAY).toISOString().slice(0, 10);
    const data = byDay.get(day);
    const known = (data?.knownPromptTokens ?? 0) + (data?.knownCompletionTokens ?? 0);
    cumulative += known;
    if (interval !== "Weekly" || index % 7 === 0) buckets.push({ date, end: date, known: 0, receipts: 0, partial: 0 });
    const bucket = buckets[buckets.length - 1];
    bucket.end = date;
    bucket.known = interval === "Cumulative" ? cumulative : bucket.known + known;
    bucket.receipts += data?.operations ?? 0;
    bucket.partial += data?.incomplete ?? 0;
  }
  return { buckets, knownTokens, peak, missing, longestStreak, currentStreak: previous >= today - 1 ? streak : 0,
    longestRunMs: completed.length ? completed.reduce((a, b) => Math.max(a, b), 0) : null };
}
