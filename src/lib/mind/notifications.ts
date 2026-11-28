import type { Workspace } from "./types.ts";

export type WorkspaceNotice = { id: string; title: string; detail: string; at: string; urgent: boolean; view: "runs" | "scheduled" | "activity" | "research" | "chat"; target: string; messageId?: string; group?: string; occurrences?: number };
export type NotificationPreferences = { completedRuns: boolean; activity: boolean; research?: boolean; media?: boolean; quietStart: number | null; quietEnd: number | null };
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { completedRuns: true, activity: true, research: true, media: true, quietStart: null, quietEnd: null };

/** Stable resource/event identities deduplicate repeated polling snapshots. */
export function workspaceNotices(ws: Workspace, preferences = DEFAULT_NOTIFICATION_PREFERENCES, research: { id: string; version: number; question: string; at: string }[] = []): WorkspaceNotice[] {
  const rows: WorkspaceNotice[] = [];
  for (const run of ws.runs) {
    const urgent = run.state === "waiting_approval" || run.state === "failed" || run.state === "waiting_external";
    if (!urgent && !(preferences.completedRuns && run.state === "completed")) continue;
    const approval = run.state === "waiting_approval" ? run.pendingApproval : undefined;
    const agent = ws.agents.find((item) => item.id === run.agentId)?.name || "Saved agent";
    rows.push({ id: `run:${run.id}:${run.state}:${approval?.id ?? run.updatedAt}`, title: approval ? `${agent} requests approval` : run.state === "waiting_approval" ? "Approval needed" : `Run ${run.state.replaceAll("_", " ")}`, detail: approval ? `${approval.tool} → ${approval.destination}. Review the exact action; permission expires ${approval.expiresAt}. ${run.goal}` : run.goal, at: run.updatedAt, urgent, view: "runs", target: run.id, group: `run:${run.id}` });
  }
  for (const job of ws.schedules) if (job.lastError) rows.push({ id: `schedule:${job.id}:${job.lastRunAt ?? ""}:${job.lastError}`, title: "Schedule needs attention", detail: `${job.name}: ${job.lastError}`, at: job.lastRunAt ?? job.lastAttemptAt ?? job.nextRunAt, urgent: true, view: "scheduled", target: job.id });
  if (preferences.activity) for (const event of ws.audit) rows.push({ id: `activity:${event.id}`, title: event.action.replaceAll("_", " "), detail: event.result, at: event.at, urgent: false, view: "activity", target: event.id });
  if (preferences.research !== false) for (const report of research) rows.push({ id: `research:${report.id}:${report.version}`, title: "Research report saved", detail: `${report.question} · version ${report.version}`, at: report.at, urgent: false, view: "research", target: report.id, group: `research:${report.id}` });
  if (preferences.media !== false) for (const chat of ws.chats) {
    if (chat.temporary) continue;
    for (const message of chat.messages) {
      if (message.role !== "assistant" || message.kind === "error") continue;
      if (message.videoUrl || message.images?.some((image) => image.origin === "generated" || image.origin === "edited")) rows.push({ id: `media:${chat.id}:${message.id}`, title: message.videoUrl ? "Video ready" : "Image ready", detail: `${chat.title} · ${message.model || "Model unreported"}`, at: message.at, urgent: false, view: "chat", target: chat.id, messageId: message.id, group: `media:${chat.id}` });
    }
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.at.localeCompare(a.at));
}

export function isQuietHour(preferences: NotificationPreferences, hour: number) {
  const { quietStart: start, quietEnd: end } = preferences;
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function notificationIds(storage: Pick<Storage, "getItem">, key: string): string[] {
  try {
    const ids: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(-5000) : [];
  } catch { return []; }
}

export function readNotificationPreferences(storage: Pick<Storage, "getItem">): NotificationPreferences {
  try {
    const value = JSON.parse(storage.getItem("notifications.preferences.v1") ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_NOTIFICATION_PREFERENCES;
    const hour = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 24 ? n : null;
    return { completedRuns: value.completedRuns !== false, activity: value.activity !== false,
      research: value.research !== false, media: value.media !== false, quietStart: hour(value.quietStart), quietEnd: hour(value.quietEnd) };
  } catch { return DEFAULT_NOTIFICATION_PREFERENCES; }
}
