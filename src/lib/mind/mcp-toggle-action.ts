/**
 * Tools panel MCP server enable/disable toggle.
 * Rejected toggles must show a red Retry banner — never a silent no-op.
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

export type McpToggleParams = {
  id: string;
  enabled: boolean;
  /** Display label for the one-line banner (optional). */
  label?: string;
};

export type McpToggleServerRow = {
  id: string;
  label: string;
  kind: string;
  enabled: boolean;
};

export type McpToggleActionState =
  | { status: "idle" }
  | { status: "running"; params: McpToggleParams }
  | { status: "ok"; note: string }
  | { status: "error"; kind: HonestFailureKind; message: string; params: McpToggleParams };

export function snapshotMcpToggleParams(input: {
  id: string;
  enabled: boolean;
  label?: string;
}): McpToggleParams {
  return {
    id: input.id,
    enabled: input.enabled === true,
    ...(input.label ? { label: input.label } : {}),
  };
}

function classifyToggleFailure(caught: unknown): { kind: HonestFailureKind; message: string } {
  const failed = HONEST_FAILURE_MESSAGES.mcp_toggle_failed;
  const normalized = normalizeClientFailureMessage(caught);
  const kind = classifyHonestFailure(normalized) ?? "network_failure";
  if (kind === "auth_required") {
    return { kind, message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  if (kind === "network_failure" || /Failed to fetch|NetworkError|timed out|timeout/i.test(normalized)) {
    return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
  }
  const detail = normalized.trim();
  return {
    kind: "network_failure",
    message: detail ? `${failed} ${detail}`.slice(0, 300) : `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}`,
  };
}

export type McpToggleCallResult = { servers: McpToggleServerRow[] };

/**
 * Run one MCP enable/disable toggle via an injected mcpRegistryToggle-compatible function.
 * Never throws. Error paths keep the identical params for Retry.
 */
export async function runMcpToggle(
  params: McpToggleParams,
  toggle: (input: { data: { id: string; enabled: boolean } }) => Promise<McpToggleCallResult>,
): Promise<
  | { ok: true; note: string; servers: McpToggleServerRow[]; params: McpToggleParams }
  | { ok: false; kind: HonestFailureKind; message: string; params: McpToggleParams }
> {
  const snap = snapshotMcpToggleParams(params);
  try {
    const result = await toggle({ data: { id: snap.id, enabled: snap.enabled } });
    const servers = Array.isArray(result?.servers) ? result.servers : [];
    const verb = snap.enabled ? "enabled" : "disabled";
    const name = snap.label?.trim() || snap.id;
    return { ok: true, note: `${name} ${verb}.`, servers, params: snap };
  } catch (caught) {
    const classified = classifyToggleFailure(caught);
    return { ok: false, ...classified, params: snap };
  }
}

export { onceRetry };

/** Red failure banner for a failed MCP toggle (Retry re-runs identical id/enabled). */
export function McpToggleActionStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: McpToggleActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className: "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-3 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": state.kind,
      "data-mcp-toggle-id": state.params.id,
      "data-mcp-toggle-enabled": state.params.enabled ? "true" : "false",
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
