import type { RecoveryRecord, Workspace } from './types.ts';

export function normalizeRecovery(value: unknown): RecoveryRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.message !== 'string') return [];
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    const row: RecoveryRecord = { id: item.id.slice(0, 200), at: typeof item.at === 'string' ? item.at : '', action: typeof item.action === 'string' ? item.action.slice(0, 100) : 'review', target: typeof item.target === 'string' ? item.target.slice(0, 300) : '', message: item.message.slice(0, 1200), state: item.state === 'resolved' || item.state === 'dismissed' ? item.state : 'open' };
    for (const key of ['chatId', 'workspaceId', 'operationId', 'outcome'] as const) if (typeof item[key] === 'string') row[key] = item[key].slice(0, 200);
    if (typeof item.text === 'string') row.text = item.text.slice(0, 8000);
    if (typeof item.pageId === 'string' || item.pageId === null) row.pageId = item.pageId;
    return [row];
  });
}

export function saveRecovery(ws: Workspace, record: RecoveryRecord): Workspace {
  return { ...ws, recovery: [record, ...(ws.recovery ?? []).filter((item) => item.id !== record.id)].slice(0, 200) };
}
export function closeRecovery(ws: Workspace, id: string, state: 'dismissed' | 'resolved'): Workspace {
  return { ...ws, recovery: (ws.recovery ?? []).map((item) => item.id === id ? { ...item, state } : item) };
}
import { classifyHonestFailure, type HonestFailureKind } from "./failure-states.ts";
import type { RouteFailureAction } from "./route-failure.ts";
export type RecoveryEntry = { message: string; auditId: string; target: string; createdAt: string; retry: (() => void) | null; kind: HonestFailureKind | null; action?: RouteFailureAction; chatId?: string; operationId?: string };
export function upsertRecovery(entries: RecoveryEntry[], entry: RecoveryEntry) { return [entry, ...entries.filter((row) => row.auditId !== entry.auditId)]; }
export function dismissRecovery(entries: RecoveryEntry[], id: string) { return entries.filter((row) => row.auditId !== id); }
/** Persist identity and outcome only. Closures are deliberately not reconstructed as writes after reload. */
export function serializeRecoveries(entries: RecoveryEntry[]) { return JSON.stringify(entries.map(({ retry: _retry, ...row }) => row)); }
export function readRecoveries(raw: string | null): RecoveryEntry[] {
  try { const parsed: unknown = JSON.parse(raw || "[]"); if (!Array.isArray(parsed)) return []; return parsed.flatMap((row) => row && typeof row.auditId === "string" && typeof row.target === "string" && typeof row.message === "string" ? [{ ...row, retry: null, action: row.action === "setup" ? "setup" : "retry", kind: typeof row.kind === "string" ? row.kind : null } as RecoveryEntry] : []); } catch { return []; }
}
export function failureKindForAction(action: string): HonestFailureKind | null {
  const kinds: Record<string, HonestFailureKind> = { auth_required: "auth_required", session_rejected: "auth_required", session_unavailable: "network_failure", service_unavailable: "network_failure", provider_credentials_rejected: "model_unavailable", billing_required: "model_unavailable", invalid_response: "model_unavailable", forbidden_cross_site: "forbidden_cross_site", model_unavailable: "model_unavailable", provider_unavailable: "model_unavailable", rate_limited: "rate_limited", research_failed: "research_failed", notion_failed: "notion_failed", notion_search_failed: "notion_failed", mcp_tool_failed: "mcp_tool_failed", database_write_failed: "database_write_failed", emergency_stop_active: "emergency_stop_active", image_generation_failed: "image_generation_failed", chat_timeout: "chat_timeout", network_failure: "network_failure" };
  return kinds[action] ?? null;
}

/** Structured unknown is deliberately null; localized copy cannot turn it into an auth error. */
export function recoveryKind(action: string, message: string, structuredKind?: HonestFailureKind | null): HonestFailureKind | null {
  return structuredKind !== undefined ? structuredKind : failureKindForAction(action) ?? classifyHonestFailure(message);
}
