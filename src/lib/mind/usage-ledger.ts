import type { UsageEntry } from "./types.ts";
import { validTokenCount } from "./provider-usage.ts";

export type UsageOutcome = "unconfirmed" | "rejected_before_dispatch" | "completed" | "failed" | "canceled";
export type UsageReceipt = Omit<UsageEntry, "kind"> & {
  operationId: string; stage: string; outcome: UsageOutcome; dispatched: boolean;
};
export const USAGE_CHANNELS = ["chat", "orchestrator", "speak", "build", "image", "agent"] as const;
export const MAX_USAGE_PERIOD_ROWS = 10_000;
export const USAGE_RETENTION_BATCH = 1_000;
export type UsageGrouping = "day" | "month" | "provider" | "channel";
export type UsagePeriod = { from: string; to: string; entries: UsageEntry[]; nextOffset: number | null; complete: boolean };
export type UsagePage = { entries: (UsageEntry | UsageReceipt)[]; nextOffset: number | null; from: string; to: string };

export function usageIdentity(entry: Pick<UsageEntry, "id" | "operationId" | "stage" | "role">): string {
  if (entry.role === "helper" && !entry.stage) return entry.id;
  return entry.operationId ? `${entry.operationId}/${entry.stage ?? "answer"}` : entry.id;
}
export function mergeUsageEntries(entries: (UsageEntry | UsageReceipt)[]): UsageEntry[] {
  const rows = new Map<string, UsageEntry>();
  for (const raw of entries) {
    const known = Number(validTokenCount(raw.promptTokens) !== undefined) + Number(validTokenCount(raw.completionTokens) !== undefined);
    const entry: UsageEntry = { ...raw, kind: "kind" in raw ? raw.kind : known === 2 ? "actual" : known === 1 ? "partial" : "unknown" };
    const key = usageIdentity(entry);
    const previous = rows.get(key);
    const previousQuality = previous ? (previous.outcome === "completed" ? 8 : 0) + (previous.kind === "actual" ? 4 : previous.kind === "partial" ? 2 : 0) : -1;
    const quality = (entry.outcome === "completed" ? 8 : 0) + (entry.kind === "actual" ? 4 : entry.kind === "partial" ? 2 : 0);
    if (!previous || quality > previousQuality || quality === previousQuality && entry.at > previous.at) rows.set(key, entry);
  }
  return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
}
export function usageTotals(rows: (UsageEntry | UsageReceipt)[]) {
  return mergeUsageEntries(rows).reduce((total, row) => {
    const prompt = validTokenCount(row.promptTokens), completion = validTokenCount(row.completionTokens);
    total.operations++;
    if (prompt === undefined || completion === undefined) total.incomplete++;
    if (prompt !== undefined) total.knownPromptTokens += prompt;
    if (completion !== undefined) total.knownCompletionTokens += completion;
    return total;
  }, { operations: 0, incomplete: 0, knownPromptTokens: 0, knownCompletionTokens: 0 });
}

/** Legacy receipts have unknown channels; stage names must not invent attribution. */
export function usageChannel(entry: Pick<UsageEntry, "channel">): string {
  return USAGE_CHANNELS.includes(entry.channel as typeof USAGE_CHANNELS[number]) ? entry.channel! : "unknown";
}

export function groupUsage(rows: (UsageEntry | UsageReceipt)[], grouping: UsageGrouping) {
  const groups = new Map<string, UsageEntry[]>();
  for (const row of mergeUsageEntries(rows)) {
    const timestamp = Date.parse(row.at);
    const key = grouping === "provider" ? row.provider?.trim() || "unknown"
      : grouping === "channel" ? usageChannel(row)
      : Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, grouping === "day" ? 10 : 7) : "unknown";
    const bucket = groups.get(key) ?? [];
    bucket.push(row); groups.set(key, bucket);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => ({ key, ...usageTotals(entries) }));
}

export function usageRetentionCutoff(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getTime() > now) return null;
  return date.toISOString();
}

export function usageDateRange(fromDate: string, throughDate: string, now = Date.now()): { from: string; to: string } | null {
  const from = usageRetentionCutoff(fromDate, now), through = usageRetentionCutoff(throughDate, now);
  if (!from || !through || from > through) return null;
  return { from, to: new Date(Math.min(Date.parse(through) + 86_400_000 - 1, now)).toISOString() };
}

/** Fetch bounded pages with one frozen UTC period. Partial results stay explicit. */
export async function loadUsagePeriod(
  page: (input: { offset: number; limit: number; from: string; to: string }) => Promise<UsagePage>,
  range: { from: string; to: string },
  maxRows = MAX_USAGE_PERIOD_ROWS,
): Promise<UsagePeriod> {
  const cap = Number.isSafeInteger(maxRows) ? Math.max(1, Math.min(MAX_USAGE_PERIOD_ROWS, maxRows)) : MAX_USAGE_PERIOD_ROWS;
  const entries: (UsageEntry | UsageReceipt)[] = [];
  let nextOffset: number | null = 0;
  do {
    const offset: number = nextOffset;
    const limit = Math.min(500, cap - entries.length);
    const result: UsagePage = await page({ ...range, offset, limit });
    if (!Array.isArray(result.entries) || result.entries.length > limit || result.from !== range.from || result.to !== range.to) throw new Error("Usage history returned an inconsistent page. Reload the selected period.");
    const next: number | null = result.nextOffset;
    if (next !== null && (!Number.isSafeInteger(next) || next !== offset + result.entries.length || next <= offset)) throw new Error("Usage history pagination did not advance. Reload the selected period.");
    entries.push(...result.entries); nextOffset = next;
  } while (nextOffset !== null && entries.length < cap);
  return { ...range, entries: mergeUsageEntries(entries), nextOffset, complete: nextOffset === null };
}

export function usageExport(period: UsagePeriod) {
  return {
    format: "adrian-usage-v1", generatedAt: new Date().toISOString(), from: period.from, to: period.to,
    complete: period.complete, loadedCount: period.entries.length, nextOffset: period.nextOffset,
    coverage: period.complete ? "All saved receipts returned for the selected period." : "Partial export: the load limit was reached. Narrow the period to obtain complete totals.",
    totals: usageTotals(period.entries), dailyUtc: groupUsage(period.entries, "day"), monthlyUtc: groupUsage(period.entries, "month"),
    providers: groupUsage(period.entries, "provider"), channels: groupUsage(period.entries, "channel"), entries: period.entries,
    note: "Known tokens only. Missing usage and missing historical channels remain unknown. Execution stages are counted separately. Tokens are not a bill; provider billing reconciliation is not verified.",
  };
}
