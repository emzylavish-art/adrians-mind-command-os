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

/** Summarize retained account records. Never infer use from a configured tool or a model name. */
export function profileInsights(workspace: Pick<Workspace, "chats" | "runs">) {
  const tiers = new Map<string, number>();
  const efforts = new Map<string, number>();
  let effortReports = 0;
  const replies = new Set<string>();
  const skills = new Set<string>();
  let tierReceipts = 0;
  let appliedSkills = 0;
  let skillReports = 0;
  for (const chat of workspace.chats) {
    if (chat.temporary) continue;
    for (const message of chat.messages) {
      if (message.role !== "assistant" || message.kind === "error" || message.delivery || message.inheritedFrom) continue;
      const key = message.executionEvidence?.executionId || message.executionId || JSON.stringify([chat.id, message.id]);
      if (replies.has(key)) continue;
      replies.add(key);
      if (message.resolvedTier) {
        tiers.set(message.resolvedTier, (tiers.get(message.resolvedTier) ?? 0) + 1);
        tierReceipts++;
      }
      if (message.requestedReasoningEffort) {
        efforts.set(message.requestedReasoningEffort, (efforts.get(message.requestedReasoningEffort) ?? 0) + 1);
        effortReports++;
      }
      if (Array.isArray(message.skillReceipts)) {
        skillReports++;
        const applied = new Set(message.skillReceipts.filter(receipt => receipt.stage === "instructions_applied").map(receipt => receipt.skillId));
        appliedSkills += applied.size;
        for (const id of applied) skills.add(id);
      }
    }
  }

  const operations = new Map<string, Set<string>>();
  for (const run of workspace.runs) {
    for (const step of run.stepResults ?? []) {
      let name: string;
      let id = JSON.stringify([run.id, step.stepId]);
      if (step.status !== "success" && step.status !== "empty") continue;
      switch (step.tool) {
        case "gmail_read":
        case "gmail_send":
          if (!step.receipt?.operationId || !step.receipt.accountId) continue;
          name = "Gmail";
          id = JSON.stringify([step.receipt.accountId, step.receipt.operationId]);
          break;
        case "web_search": name = "Web search"; break;
        case "browser": name = "Browser"; break;
        default: continue;
      }
      const ids = operations.get(name) ?? new Set<string>();
      ids.add(id);
      operations.set(name, ids);
    }
  }
  const plugins = [...operations].map(([name, ids]) => ({ name, count: ids.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const peakEffort = Math.max(0, ...efforts.values());
  const topEfforts = [...efforts.keys()].filter(level => efforts.get(level) === peakEffort).sort();
  return { topEfforts, peakEffort, effortReports, plugins, tierReceipts, replies: replies.size, fast: tiers.get("Fast") ?? 0,
    skillReports, distinctSkills: skills.size, appliedSkills };
}
