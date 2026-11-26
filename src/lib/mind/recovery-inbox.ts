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
