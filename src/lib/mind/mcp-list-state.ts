/**
 * MCP server list: loading vs empty vs error.
 * A failed list load (401/403, 5xx, network rejection, non-JSON) must never look like an empty list.
 * Classification reuses failure-states.ts kinds; the banner follows the standard red failure banner.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "./failure-states.ts";

export type McpListServer = { id: string; label: string; kind: string; enabled: boolean };

export type McpListState =
  | { status: "loading" }
  | { status: "ready"; servers: McpListServer[] }
  | { status: "error"; kind: HonestFailureKind; message: string };

export const MCP_LIST_EMPTY_COPY = "No MCP servers are registered.";
export const MCP_LIST_LOADING_COPY = "Loading MCP servers…";

function statusOf(caught: unknown): number | null {
  if (!caught || typeof caught !== "object") return null;
  const record = caught as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [record.status, record.statusCode, record.response?.status]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Map a rejected list load to one honest banner message + failure-states kind. */
export function classifyMcpListFailure(caught: unknown): { kind: HonestFailureKind; message: string } {
  const status = statusOf(caught);
  const raw = caught instanceof Error ? caught.message : typeof caught === "string" ? caught : "";
  if (status === 401 || raw === "Unauthorized" || /sign in is required/i.test(raw)) {
    return { kind: "auth_required", message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (status === 403 || /cross-site request blocked|^Forbidden/i.test(raw)) {
    return { kind: "forbidden_cross_site", message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  }
  if (status !== null && status >= 500) {
    return { kind: "network_failure", message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} (HTTP ${status})` };
  }
  if (caught instanceof SyntaxError || /not valid JSON|Unexpected token|JSON\.parse|not JSON/i.test(raw)) {
    return { kind: "network_failure", message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} (response was not JSON)` };
  }
  const normalized = normalizeClientFailureMessage(caught);
  const kind = classifyHonestFailure(normalized);
  if (kind === "auth_required") {
    return { kind, message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  return { kind: "network_failure", message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
}

function isServer(value: unknown): value is McpListServer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.label === "string";
}

/** Run one list load. Resolves to ready (possibly empty) or error; never throws. */
export async function loadMcpList(fetchList: () => Promise<unknown>): Promise<McpListState> {
  try {
    const result = (await fetchList()) as { servers?: unknown } | null;
    if (!result || typeof result !== "object" || !Array.isArray(result.servers) || !result.servers.every(isServer)) {
      return { status: "error", kind: "network_failure", message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} (response was not JSON)` };
    }
    return { status: "ready", servers: result.servers as McpListServer[] };
  } catch (caught) {
    return { status: "error", ...classifyMcpListFailure(caught) };
  }
}

/** Retry wrapper: each click runs the same load at most once while in flight, and only once per banner. */
export function onceListRetry(action: () => void): () => void {
  let used = false;
  return () => {
    if (used) return;
    used = true;
    action();
  };
}

/** Non-list rows for the MCP server list (loading / empty / error). Ready-with-servers renders nothing here. */
export function McpListStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: McpListState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status === "loading") {
    return createElement("li", { className: "text-sm text-muted", role: "status", "aria-busy": "true", "data-testid": "mcp-list-loading" }, MCP_LIST_LOADING_COPY);
  }
  if (state.status === "ready") {
    if (state.servers.length > 0) return null;
    return createElement("li", { className: "text-sm text-muted", "data-testid": "mcp-list-empty" }, MCP_LIST_EMPTY_COPY);
  }
  return createElement(
    "li",
    {
      className: "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": state.kind,
      "data-mcp-list-state": "error",
    },
    createElement("p", { className: "text-sm text-danger" }, state.message),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "failure-retry",
          className: "inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink",
          onClick: onRetry,
        },
        "Retry",
      ),
      onViewLog
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "failure-view-log",
              className: "inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-4 text-sm text-danger",
              onClick: onViewLog,
            },
            "View log",
          )
        : null,
    ),
  );
}
