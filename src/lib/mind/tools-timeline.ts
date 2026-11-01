import type { ToolEvent, ToolStatus } from "./orchestrator.ts";
import type { AuditEntry } from "./types.ts";
import { CAPABILITIES, type CapabilityStatus } from "./registry.ts";

export type ToolTimelineRow = {
  id: string;
  toolId: string;
  name: string;
  status: ToolStatus;
  text: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  auditId: string | null;
};

export type TimedToolEvent = ToolEvent & { atMs: number };

export function toolDisplayName(toolId: string): string {
  const map: Record<string, string> = {
    list_projects: "List projects",
    list_chats: "List chats",
    search_notes: "Search notes",
    list_schedules: "List schedules",
    run_due_schedules: "Run due schedules",
    search_skills: "Search skills",
    notion: "Notion",
    realtime_voice: "Realtime voice",
  };
  return map[toolId] ?? toolId;
}

/** Fold orchestrator tool events into timeline rows. Running starts a row; terminal statuses close it. */
export function applyToolEvent(rows: ToolTimelineRow[], event: TimedToolEvent): ToolTimelineRow[] {
  const at = event.atMs;
  if (event.status === "running" || event.status === "queued" || event.status === "awaiting_confirmation") {
    const existing = rows.find((row) => row.toolId === event.toolId && row.endedAtMs == null);
    if (existing) {
      return rows.map((row) =>
        row.id === existing.id
          ? { ...row, id: event.id, status: event.status, text: event.text, startedAtMs: row.startedAtMs ?? at }
          : row,
      );
    }
    return [
      ...rows,
      {
        id: event.id,
        toolId: event.toolId,
        name: toolDisplayName(event.toolId),
        status: event.status,
        text: event.text,
        startedAtMs: at,
        endedAtMs: null,
        auditId: null,
      },
    ];
  }
  const open = [...rows].reverse().find((row) => row.toolId === event.toolId && row.endedAtMs == null);
  if (open) {
    return rows.map((row) =>
      row.id === open.id
        ? {
            ...row,
            id: event.id,
            status: event.status,
            text: event.text,
            endedAtMs: at,
            startedAtMs: row.startedAtMs ?? at,
          }
        : row,
    );
  }
  return [
    ...rows,
    {
      id: event.id,
      toolId: event.toolId,
      name: toolDisplayName(event.toolId),
      status: event.status,
      text: event.text,
      startedAtMs: at,
      endedAtMs: at,
      auditId: null,
    },
  ];
}

export function foldToolEvents(events: TimedToolEvent[]): ToolTimelineRow[] {
  return events.reduce<ToolTimelineRow[]>((rows, event) => applyToolEvent(rows, event), []);
}

export function attachAuditIds(rows: ToolTimelineRow[], byTool: Record<string, string>): ToolTimelineRow[] {
  return rows.map((row) => ({ ...row, auditId: byTool[row.toolId] ?? row.auditId }));
}

export function timelineCounts(rows: ToolTimelineRow[]): { done: number; total: number; running: boolean; failed: boolean } {
  const total = rows.length;
  const done = rows.filter((row) => row.endedAtMs != null).length;
  const running = rows.some((row) => row.status === "running" || row.status === "queued" || row.status === "awaiting_confirmation");
  const failed = rows.some((row) => row.status === "failed" || row.status === "timed_out" || row.status === "cancelled");
  return { done, total, running, failed };
}

export function elapsedMs(row: ToolTimelineRow, nowMs: number): number | null {
  if (row.startedAtMs == null) return null;
  const end = row.endedAtMs ?? nowMs;
  return Math.max(0, end - row.startedAtMs);
}

export function formatElapsed(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export type RailService = { name: string; state: string; tone: "ok" | "warn" | "danger" | "muted" };

export function connectedServicesRail(input: {
  grokConfigured: boolean | null;
  notionState?: string | null;
  mcpConnected: boolean;
}): RailService[] {
  const grok =
    input.grokConfigured === true
      ? { name: "Grok", state: "Configured", tone: "ok" as const }
      : input.grokConfigured === false
        ? { name: "Grok", state: "Not configured", tone: "danger" as const }
        : { name: "Grok", state: "Checking", tone: "muted" as const };
  const notion =
    input.notionState === "connected"
      ? { name: "Notion", state: "Connected", tone: "ok" as const }
      : { name: "Notion", state: "Not connected", tone: "danger" as const };
  return [
    grok,
    notion,
    { name: "Gmail", state: "Not connected", tone: "danger" },
    { name: "Local computer", state: "Not paired", tone: "danger" },
    { name: "MCP", state: input.mcpConnected ? "Connected" : "Not connected", tone: input.mcpConnected ? "ok" : "danger" },
    { name: "Web search", state: capabilityWord(CAPABILITIES.find((item) => item.id === "research")?.status ?? "unconfigured"), tone: "warn" },
  ];
}

function capabilityWord(status: CapabilityStatus): string {
  if (status === "ready" || status === "live_verified") return "Ready";
  if (status === "configured") return "Configured";
  if (status === "blocked") return "Blocked";
  if (status === "paid_required") return "Paid, not called";
  if (status === "local_required") return "Local only";
  if (status === "planned") return "Planned";
  return "Not configured";
}

export type SystemStatusRow = { name: string; state: string; ok: boolean };

export function systemStatusRail(input: {
  grokConfigured: boolean | null;
  databaseConfigured: boolean;
  searchConfigured: boolean;
  signedIn: boolean | null;
}): { headline: string; rows: SystemStatusRow[] } {
  const rows: SystemStatusRow[] = [
    {
      name: "Grok key",
      state: input.grokConfigured === true ? "Configured" : input.grokConfigured === false ? "Not configured" : "Unknown",
      ok: input.grokConfigured === true,
    },
    {
      name: "Database URL",
      state: input.databaseConfigured ? "Configured" : "Not configured",
      ok: input.databaseConfigured,
    },
    {
      name: "Search",
      state: input.searchConfigured ? "Configured" : "Not configured",
      ok: input.searchConfigured,
    },
    {
      name: "Sign-in",
      state: input.signedIn === true ? "Signed in" : input.signedIn === false ? "Signed out" : "Unknown",
      ok: input.signedIn === true,
    },
  ];
  const okCount = rows.filter((row) => row.ok).length;
  return {
    headline: okCount === rows.length ? "All checked items configured" : `${okCount}/${rows.length} configured`,
    rows,
  };
}

export type RecentTask = { id: string; label: string; result: string; at: string };

export function recentTasksFromAudit(audit: AuditEntry[], limit = 6): RecentTask[] {
  return audit.slice(0, limit).map((entry) => ({
    id: entry.id,
    label: entry.action,
    result: entry.result,
    at: entry.at,
  }));
}

export type AgentActivityLive = {
  live: boolean;
  label: string;
  step: number;
  total: number;
  detail: string;
  percent: number;
};

export function agentActivityFromTimeline(rows: ToolTimelineRow[]): AgentActivityLive {
  const counts = timelineCounts(rows);
  if (counts.total === 0) {
    return { live: false, label: "Idle", step: 0, total: 0, detail: "No tools are running.", percent: 0 };
  }
  const current = rows.find((row) => row.endedAtMs == null) ?? rows[rows.length - 1];
  const step = Math.min(counts.done + (counts.running ? 1 : 0), counts.total);
  const percent = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
  return {
    live: counts.running,
    label: current?.name ?? "Tools",
    step,
    total: counts.total,
    detail: current ? `${current.status}: ${current.text}` : "No tools are running.",
    percent: counts.running ? percent : counts.failed && counts.done === counts.total ? percent : 100,
  };
}

export function workspaceHasDatabaseUrl(detail: string): boolean {
  return /postgres|neon|dedicated/i.test(detail) && !/not set|pglite|memory|no dedicated/i.test(detail);
}
