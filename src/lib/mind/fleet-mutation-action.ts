/**
 * Fleet panel local mutations (add agent, deploy, enqueue, schedule, connection, mailbox).
 * apply() ok:false must show a red Retry banner — never a muted note only.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  type HonestFailureKind,
} from "./failure-states.ts";
import type { FleetTool, ProviderConnection } from "./fleet.ts";
import { onceRetry } from "./retry-fidelity.ts";
import type { Workspace } from "./types.ts";

export type FleetMutationParams =
  | { kind: "add_template"; templateName: string }
  | { kind: "add_custom"; name: string; instructions: string; tools: FleetTool[] }
  | { kind: "deploy"; agentId: string; target: "local-worker" | "hosted-worker" }
  | { kind: "enqueue"; agentId: string; goal: string }
  | { kind: "enqueue_no_agent"; goal: string }
  | { kind: "add_connection"; provider: ProviderConnection["provider"]; label: string }
  | { kind: "add_mailbox"; label: string; address: string }
  | {
      kind: "add_schedule";
      name: string;
      agentId: string | null;
      intervalMinutes: number;
      timeZone: string;
      clockHour: number | null;
      clockMinute: number;
    };

export type FleetMutationActionState =
  | { status: "idle" }
  | { status: "error"; kind: HonestFailureKind; message: string; params: FleetMutationParams };

export function snapshotFleetMutationParams(params: FleetMutationParams): FleetMutationParams {
  switch (params.kind) {
    case "add_template":
      return { kind: "add_template", templateName: params.templateName };
    case "add_custom":
      return {
        kind: "add_custom",
        name: params.name,
        instructions: params.instructions,
        tools: [...params.tools],
      };
    case "deploy":
      return { kind: "deploy", agentId: params.agentId, target: params.target };
    case "enqueue":
      return { kind: "enqueue", agentId: params.agentId, goal: params.goal };
    case "enqueue_no_agent":
      return { kind: "enqueue_no_agent", goal: params.goal };
    case "add_connection":
      return { kind: "add_connection", provider: params.provider, label: params.label };
    case "add_mailbox":
      return { kind: "add_mailbox", label: params.label, address: params.address };
    case "add_schedule":
      return {
        kind: "add_schedule",
        name: params.name,
        agentId: params.agentId,
        intervalMinutes: params.intervalMinutes,
        timeZone: params.timeZone,
        clockHour: params.clockHour,
        clockMinute: params.clockMinute,
      };
  }
}

function classifyFleetMutationFailure(error: string): { kind: HonestFailureKind; message: string } {
  const failed = HONEST_FAILURE_MESSAGES.fleet_mutation_failed;
  const detail = (error || "").trim();
  if (!detail) {
    return { kind: "network_failure", message: failed };
  }
  const kind = classifyHonestFailure(detail) ?? "network_failure";
  if (kind === "emergency_stop_active") {
    return { kind, message: detail.slice(0, 300) };
  }
  return { kind: "network_failure", message: detail.slice(0, 300) };
}

export type FleetMutationResult =
  | { ok: true; ws: Workspace }
  | { ok: false; error: string };

/**
 * Run one fleet mutation via an injected executor that receives snapshotted params.
 * Never throws. Error paths keep identical params for Retry.
 */
export function runFleetMutation(
  params: FleetMutationParams,
  execute: (params: FleetMutationParams) => FleetMutationResult,
):
  | { ok: true; ws: Workspace; params: FleetMutationParams }
  | { ok: false; kind: HonestFailureKind; message: string; params: FleetMutationParams } {
  const snap = snapshotFleetMutationParams(params);
  try {
    const result = execute(snap);
    if (!result.ok) {
      const classified = classifyFleetMutationFailure(result.error);
      return { ok: false, ...classified, params: snap };
    }
    return { ok: true, ws: result.ws, params: snap };
  } catch (caught) {
    const message =
      caught instanceof Error && caught.message.trim()
        ? caught.message.trim()
        : HONEST_FAILURE_MESSAGES.fleet_mutation_failed;
    const classified = classifyFleetMutationFailure(message);
    return { ok: false, ...classified, params: snap };
  }
}

export { onceRetry };

/** Red failure banner for a failed fleet mutation (Retry re-runs identical params). */
export function FleetMutationFailureBanner({
  state,
  onRetry,
  onViewLog,
}: {
  state: FleetMutationActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className:
        "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-3 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": "fleet_mutation_failed",
    },
    createElement("p", { className: "text-sm text-danger", "data-testid": "fleet-mutation-error" }, state.message),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "failure-retry",
          className:
            "inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink",
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
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-4 text-sm text-danger",
              onClick: onViewLog,
            },
            "View log",
          )
        : null,
    ),
  );
}
