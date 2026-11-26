import { useEffect, useRef } from "react";
import { registerFailureHandler, type MountedFailure } from "../../lib/mind/failure-mount.ts";
import { classifyHonestFailure, type HonestFailureKind } from "../../lib/mind/failure-states.ts";
import type { RouteFailureAction } from "../../lib/mind/route-failure.ts";
import { readFailureEnvelope, type FailureEnvelope } from "../../lib/mind/failure-envelope.ts";
import { normalizeRecoveryBindings, type RecoveryBindings } from "../../lib/mind/incidents.ts";

export type McpReportedOutcome = {
  message: string;
  action: string;
  target: string;
  kind: HonestFailureKind | null;
  retryable: boolean;
  failureAction: RouteFailureAction;
  envelope?: FailureEnvelope;
  bindings?: RecoveryBindings;
  temporary?: boolean;
};

function reportedOutcome(value: unknown): McpReportedOutcome {
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.message === "string" && typeof row.action === "string" && typeof row.target === "string") {
      const failureAction = row.failureAction === "setup" || row.failureAction === "none" ? row.failureAction : "retry";
      const envelope = readFailureEnvelope(row.envelope ?? row.failureEnvelope);
      return { message: envelope?.message ?? row.message, action: row.action, target: row.target, kind: classifyHonestFailure(envelope ?? row.message), retryable: row.retryable !== false && failureAction === "retry", failureAction, ...(envelope ? { envelope } : {}), bindings: normalizeRecoveryBindings(row.bindings), temporary: row.temporary === true };
    }
  }
  return { message: "The MCP operation failed.", action: "mcp_tool_failed", target: "mcp", kind: null, retryable: false, failureAction: "none" };
}

/** The app owns this subscription; it never emits recursively or survives its owner. */
export function useMcpFailureMount(present: (payload: MountedFailure<McpReportedOutcome>) => void): void {
  const latest = useRef(present);
  latest.current = present;
  useEffect(() => {
    let active = true;
    const unregister = registerFailureHandler("mcp", (payload) => {
      const outcome = reportedOutcome(payload.outcome);
      let used = false;
      latest.current({
        outcome,
        localCorrelationId: payload.localCorrelationId,
        retry: () => {
          if (!active || used || !outcome.retryable) return;
          used = true;
          payload.retry();
        },
      });
    });
    return () => {
      active = false;
      unregister();
    };
  }, []);
}
