/**
 * Tools panel "Try SELECT 1" MCP call results.
 * Rejected/errored calls must show a red Retry banner — never a muted note only.
 * Lives under src/lib/mind (not mcp/) so Error Banners can own it without touching mcp/.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "./failure-states.ts";
import { onceRetry } from "./retry-fidelity.ts";

export type McpTrySelectParams = {
  serverId: string;
  serverLabel: string;
  tool: "pglite_query";
  args: { sql: "SELECT 1 AS n" };
};

export type McpCallActionState =
  | { status: "idle" }
  | { status: "running"; params: McpTrySelectParams }
  | { status: "ok"; note: string }
  | { status: "error"; kind: HonestFailureKind; message: string; params: McpTrySelectParams };

export const MCP_TRY_SELECT_SQL = "SELECT 1 AS n" as const;

export function snapshotMcpTrySelectParams(input: {
  serverId: string;
  serverLabel: string;
}): McpTrySelectParams {
  return {
    serverId: input.serverId,
    serverLabel: input.serverLabel,
    tool: "pglite_query",
    args: { sql: MCP_TRY_SELECT_SQL },
  };
}

function classifyCallFailure(caught: unknown): { kind: HonestFailureKind; message: string } {
  const failed = HONEST_FAILURE_MESSAGES.mcp_try_select_failed;
  const normalized = normalizeClientFailureMessage(caught);
  const kind = classifyHonestFailure(normalized) ?? "network_failure";
  if (kind === "auth_required") {
    return { kind, message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  if (kind === "mcp_tool_failed") {
    const detail = normalized.trim() || HONEST_FAILURE_MESSAGES.mcp_tool_failed;
    return { kind, message: detail.includes("Try SELECT") ? detail : `${failed} ${detail}`.slice(0, 300) };
  }
  if (kind === "network_failure" || /Failed to fetch|NetworkError|timed out|timeout/i.test(normalized)) {
    return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
  }
  const detail = normalized.trim();
  return {
    kind: "network_failure",
    message: detail ? `${failed} ${detail}`.slice(0, 300) : `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}`,
  };
}

export type McpRegistryCallResult = {
  status?: string;
  text?: string;
  ok?: boolean;
  needsConfirmation?: boolean;
  error?: string;
};

/**
 * Run one Try SELECT 1 via an injected mcpRegistryCall-compatible function.
 * Never throws. Error paths keep the identical params for Retry.
 */
export async function runMcpTrySelect(
  params: McpTrySelectParams,
  call: (input: { data: { serverId: string; tool: string; args: { sql: string } } }) => Promise<McpRegistryCallResult>,
): Promise<
  | { ok: true; note: string; status: string }
  | { ok: false; kind: HonestFailureKind; message: string; params: McpTrySelectParams }
> {
  try {
    const result = await call({
      data: { serverId: params.serverId, tool: params.tool, args: { sql: params.args.sql } },
    });
    const status = typeof result.status === "string" ? result.status : result.ok === false ? "error" : "ok";
    if (result.ok === false || status === "error" || status === "timeout") {
      const detail =
        (typeof result.error === "string" && result.error.trim())
        || (typeof result.text === "string" && result.text.trim())
        || status;
      return {
        ok: false,
        kind: status === "timeout" ? "network_failure" : "mcp_tool_failed",
        message: `${HONEST_FAILURE_MESSAGES.mcp_try_select_failed} ${detail}`.slice(0, 300),
        params,
      };
    }
    const text = typeof result.text === "string" ? result.text : "";
    return { ok: true, note: `${status}: ${text}`, status };
  } catch (caught) {
    const classified = classifyCallFailure(caught);
    return { ok: false, ...classified, params };
  }
}

export { onceRetry };

export function McpCallActionStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: McpCallActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className: "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": state.kind,
      "data-mcp-try-select": "error",
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
