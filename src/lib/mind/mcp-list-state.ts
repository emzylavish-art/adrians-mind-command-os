/**
 * Fleet panel async loads: MCP servers, MCP tools, PC approvals, and Scheduled worker health.
 * A failed load (401/403, 5xx, network, timeout, non-JSON) must never look like an empty/offline success.
 * Classification reuses failure-states.ts kinds; the banner follows the standard red failure banner.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "./failure-states.ts";

/** Client list-load budget; matches HTTP_RPC_TIMEOUT_MS in mcp/registry.ts (15s). */
export const MCP_LIST_LOAD_TIMEOUT_MS = 15_000;

export type McpListServer = { id: string; label: string; kind: string; enabled: boolean };

export type McpToolRow = {
  serverId: string;
  serverLabel: string;
  name: string;
  description: string;
  enabled: boolean;
  status?: string;
};

export type PcApprovalRow = {
  id: string;
  token: string;
  command: string;
  agentId: string;
  agentLabel: string;
  expiresAt: string;
};

export type FleetListState<T> =
  | { status: "loading" }
  | { status: "ready"; items: T[] }
  | { status: "error"; kind: HonestFailureKind; message: string };

/** @deprecated Prefer FleetListState — kept for existing MCP server list callers. */
export type McpListState =
  | { status: "loading" }
  | { status: "ready"; servers: McpListServer[] }
  | { status: "error"; kind: HonestFailureKind; message: string };

export const MCP_LIST_EMPTY_COPY = "No MCP servers are registered.";
export const MCP_LIST_LOADING_COPY = "Loading MCP servers…";
export const MCP_TOOLS_EMPTY_COPY = "No MCP tools are registered.";
export const MCP_TOOLS_LOADING_COPY = "Loading MCP tools…";
export const PC_APPROVALS_EMPTY_COPY = "No pending PC shell approvals.";
export const PC_APPROVALS_LOADING_COPY = "Loading PC shell approvals…";
export const WORKER_HEALTH_LOADING_COPY = "Checking the worker…";

function statusOf(caught: unknown): number | null {
  if (!caught || typeof caught !== "object") return null;
  const record = caught as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [record.status, record.statusCode, record.response?.status]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function isTimeoutFailure(caught: unknown, raw: string): boolean {
  if (caught && typeof caught === "object") {
    const name = (caught as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") return true;
  }
  if (statusOf(caught) === 408) return true;
  return /timed out|timeout/i.test(raw);
}

type ListFailureScope = "mcp_list" | "mcp_tools" | "pc_approvals" | "worker_health";

const LIST_FAILED_COPY: Record<ListFailureScope, string> = {
  mcp_list: HONEST_FAILURE_MESSAGES.mcp_list_failed,
  mcp_tools: HONEST_FAILURE_MESSAGES.mcp_tools_list_failed,
  pc_approvals: HONEST_FAILURE_MESSAGES.pc_approvals_list_failed,
  worker_health: HONEST_FAILURE_MESSAGES.worker_health_failed,
};

/** Map a rejected list load to one honest banner message + failure-states kind. */
export function classifyListFailure(
  caught: unknown,
  scope: ListFailureScope = "mcp_list",
): { kind: HonestFailureKind; message: string } {
  const failed = LIST_FAILED_COPY[scope];
  const status = statusOf(caught);
  const raw = caught instanceof Error ? caught.message : typeof caught === "string" ? caught : "";
  if (isTimeoutFailure(caught, raw)) {
    return { kind: "network_failure", message: `${failed} (timed out)` };
  }
  if (status === 401 || raw === "Unauthorized" || /sign in is required/i.test(raw)) {
    return { kind: "auth_required", message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (status === 403 || /cross-site request blocked|^Forbidden/i.test(raw)) {
    return { kind: "forbidden_cross_site", message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  }
  if (status !== null && status >= 500) {
    return { kind: "network_failure", message: `${failed} (HTTP ${status})` };
  }
  if (caught instanceof SyntaxError || /not valid JSON|Unexpected token|JSON\.parse|not JSON/i.test(raw)) {
    return { kind: "network_failure", message: `${failed} (response was not JSON)` };
  }
  const normalized = normalizeClientFailureMessage(caught);
  const kind = classifyHonestFailure(normalized);
  if (kind === "auth_required") {
    return { kind, message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
}

/** @deprecated Prefer classifyListFailure(..., "mcp_list"). */
export function classifyMcpListFailure(caught: unknown): { kind: HonestFailureKind; message: string } {
  return classifyListFailure(caught, "mcp_list");
}

function isServer(value: unknown): value is McpListServer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.label === "string";
}

function isTool(value: unknown): value is McpToolRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.serverId === "string" && typeof row.name === "string";
}

function isApproval(value: unknown): value is PcApprovalRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.token === "string" && typeof row.command === "string";
}

/** Race a load against a client timeout. Always settles (never hangs). */
export function withListTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000) || 1}s.`), { status: 408, name: "TimeoutError" }));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Monotonic generation helper: ignore stale responses from an older load. */
export function nextListGeneration(current: number): number {
  return current + 1;
}

export function isCurrentListGeneration(expected: number, current: number): boolean {
  return expected === current;
}

/** Run one MCP server list load. Resolves to ready (possibly empty) or error; never throws. */
export async function loadMcpList(
  fetchList: () => Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<McpListState> {
  const timeoutMs = options?.timeoutMs ?? MCP_LIST_LOAD_TIMEOUT_MS;
  try {
    const result = (await withListTimeout(fetchList(), timeoutMs, "The MCP server list")) as { servers?: unknown } | null;
    if (!result || typeof result !== "object" || !Array.isArray(result.servers) || !result.servers.every(isServer)) {
      return { status: "error", kind: "network_failure", message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} (response was not JSON)` };
    }
    return { status: "ready", servers: result.servers as McpListServer[] };
  } catch (caught) {
    return { status: "error", ...classifyListFailure(caught, "mcp_list") };
  }
}

/** Run one MCP tools list load. Never throws; never looks like an empty success on failure. */
export async function loadMcpToolsList(
  fetchTools: () => Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<FleetListState<McpToolRow>> {
  const timeoutMs = options?.timeoutMs ?? MCP_LIST_LOAD_TIMEOUT_MS;
  try {
    const result = (await withListTimeout(fetchTools(), timeoutMs, "The MCP tools list")) as { tools?: unknown } | null;
    if (!result || typeof result !== "object" || !Array.isArray(result.tools) || !result.tools.every(isTool)) {
      return { status: "error", kind: "network_failure", message: `${HONEST_FAILURE_MESSAGES.mcp_tools_list_failed} (response was not JSON)` };
    }
    return { status: "ready", items: result.tools as McpToolRow[] };
  } catch (caught) {
    return { status: "error", ...classifyListFailure(caught, "mcp_tools") };
  }
}

/**
 * Run one PC approvals list load.
 * fetchApprovals should throw on HTTP/network failure and return the parsed body on success.
 */
export async function loadPcApprovalsList(
  fetchApprovals: () => Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<FleetListState<PcApprovalRow>> {
  const timeoutMs = options?.timeoutMs ?? MCP_LIST_LOAD_TIMEOUT_MS;
  try {
    const result = (await withListTimeout(fetchApprovals(), timeoutMs, "The PC shell approvals list")) as
      | { ok?: boolean; approvals?: unknown }
      | null;
    if (!result || typeof result !== "object" || result.ok !== true || !Array.isArray(result.approvals) || !result.approvals.every(isApproval)) {
      if (result && typeof result === "object" && "status" in result && typeof (result as { status: unknown }).status === "number") {
        return { status: "error", ...classifyListFailure(result, "pc_approvals") };
      }
      return {
        status: "error",
        kind: "network_failure",
        message: `${HONEST_FAILURE_MESSAGES.pc_approvals_list_failed} (response was not JSON)`,
      };
    }
    return { status: "ready", items: result.approvals as PcApprovalRow[] };
  } catch (caught) {
    return { status: "error", ...classifyListFailure(caught, "pc_approvals") };
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

function FleetListStatusRowsInner({
  state,
  loadingCopy,
  emptyCopy,
  loadingTestId,
  emptyTestId,
  onRetry,
  onViewLog,
}: {
  state: { status: "loading" } | { status: "ready"; empty: boolean } | { status: "error"; kind: HonestFailureKind; message: string };
  loadingCopy: string;
  emptyCopy: string;
  loadingTestId: string;
  emptyTestId: string;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status === "loading") {
    return createElement("li", { className: "text-sm text-muted", role: "status", "aria-busy": "true", "data-testid": loadingTestId }, loadingCopy);
  }
  if (state.status === "ready") {
    if (!state.empty) return null;
    return createElement("li", { className: "text-sm text-muted", "data-testid": emptyTestId }, emptyCopy);
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
  const normalized =
    state.status === "ready"
      ? ({ status: "ready", empty: state.servers.length === 0 } as const)
      : state;
  return FleetListStatusRowsInner({
    state: normalized,
    loadingCopy: MCP_LIST_LOADING_COPY,
    emptyCopy: MCP_LIST_EMPTY_COPY,
    loadingTestId: "mcp-list-loading",
    emptyTestId: "mcp-list-empty",
    onRetry,
    onViewLog,
  });
}

/** Loading / empty / error rows for the MCP tools list. */
export function McpToolsListStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: FleetListState<McpToolRow>;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  const normalized =
    state.status === "ready"
      ? ({ status: "ready", empty: state.items.length === 0 } as const)
      : state;
  return FleetListStatusRowsInner({
    state: normalized,
    loadingCopy: MCP_TOOLS_LOADING_COPY,
    emptyCopy: MCP_TOOLS_EMPTY_COPY,
    loadingTestId: "mcp-tools-list-loading",
    emptyTestId: "mcp-tools-list-empty",
    onRetry,
    onViewLog,
  });
}

/** Loading / empty / error rows for the PC approvals list. */
export function PcApprovalsListStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: FleetListState<PcApprovalRow>;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  const normalized =
    state.status === "ready"
      ? ({ status: "ready", empty: state.items.length === 0 } as const)
      : state;
  return FleetListStatusRowsInner({
    state: normalized,
    loadingCopy: PC_APPROVALS_LOADING_COPY,
    emptyCopy: PC_APPROVALS_EMPTY_COPY,
    loadingTestId: "pc-approvals-list-loading",
    emptyTestId: "pc-approvals-list-empty",
    onRetry,
    onViewLog,
  });
}

export type WorkerHealthSnapshot = {
  state: "offline" | "local";
  detail: string;
  localOnly?: boolean;
  hosted?: boolean;
};

export type WorkerHealthState =
  | { status: "loading" }
  | { status: "ready"; health: WorkerHealthSnapshot }
  | { status: "error"; kind: HonestFailureKind; message: string };

function isWorkerHealth(value: unknown): value is WorkerHealthSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (row.state === "offline" || row.state === "local") && typeof row.detail === "string" && row.detail.trim().length > 0;
}

/**
 * Run one workerHealth probe for the Scheduled panel.
 * Honest offline/local detail is ready; rejected/hung/malformed probes are error (never muted "nothing online").
 */
export async function loadWorkerHealthStatus(
  fetchHealth: () => Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<WorkerHealthState> {
  const timeoutMs = options?.timeoutMs ?? MCP_LIST_LOAD_TIMEOUT_MS;
  try {
    const result = await withListTimeout(fetchHealth(), timeoutMs, "The worker status");
    if (!isWorkerHealth(result)) {
      return {
        status: "error",
        kind: "network_failure",
        message: `${HONEST_FAILURE_MESSAGES.worker_health_failed} (response was not JSON)`,
      };
    }
    return { status: "ready", health: result };
  } catch (caught) {
    return { status: "error", ...classifyListFailure(caught, "worker_health") };
  }
}

/** Loading / error rows for Scheduled worker health. Ready detail is rendered by the panel hero. */
export function WorkerHealthStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: WorkerHealthState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status === "ready") return null;
  return FleetListStatusRowsInner({
    state,
    loadingCopy: WORKER_HEALTH_LOADING_COPY,
    emptyCopy: "",
    loadingTestId: "worker-health-loading",
    emptyTestId: "worker-health-empty",
    onRetry,
    onViewLog,
  });
}
