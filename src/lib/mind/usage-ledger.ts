import type { UsageEntry } from "./types.ts";
import { validTokenCount } from "./provider-usage.ts";

export type UsageOutcome = "unconfirmed" | "rejected_before_dispatch" | "completed" | "failed" | "canceled";
export type UsageReceipt = Omit<UsageEntry, "kind"> & {
  operationId: string; stage: string; outcome: UsageOutcome; dispatched: boolean;
};

export function usageIdentity(entry: Pick<UsageEntry, "id" | "operationId" | "stage">): string {
  return entry.operationId ? `${entry.operationId}/${entry.stage ?? "answer"}` : entry.id;
}
export function mergeUsageEntries(entries: UsageEntry[]): UsageEntry[] {
  const rows = new Map<string, UsageEntry>();
  for (const entry of entries) {
    const key = usageIdentity(entry);
    const previous = rows.get(key);
    const previousQuality = previous ? (previous.outcome === "completed" ? 8 : 0) + (previous.kind === "actual" ? 4 : previous.kind === "partial" ? 2 : 0) : -1;
    const quality = (entry.outcome === "completed" ? 8 : 0) + (entry.kind === "actual" ? 4 : entry.kind === "partial" ? 2 : 0);
    if (!previous || quality > previousQuality || quality === previousQuality && entry.at > previous.at) rows.set(key, entry);
  }
  return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
}
export function usageTotals(rows: UsageEntry[]) {
  return mergeUsageEntries(rows).reduce((total, row) => {
    const prompt = validTokenCount(row.promptTokens), completion = validTokenCount(row.completionTokens);
    total.operations++;
    if (prompt === undefined || completion === undefined) total.incomplete++;
    if (prompt !== undefined) total.knownPromptTokens += prompt;
    if (completion !== undefined) total.knownCompletionTokens += completion;
    return total;
  }, { operations: 0, incomplete: 0, knownPromptTokens: 0, knownCompletionTokens: 0 });
}
