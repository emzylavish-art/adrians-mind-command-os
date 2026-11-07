import { reasonCode, safeReason, type CallProvenance } from "../../lib/mind/mcp/call-contract.ts";

export type AttemptView = CallProvenance & {
  status: string;
  text: string;
  retryable: false;
};

export function startAttempt(localAttemptId: string): { localAttemptId: string } {
  return { localAttemptId };
}

/** Ignore a late response from an older click. Never copies an upstream request id. */
export function acceptResult(
  activeId: string,
  incoming: { localAttemptId: string; status: string; text: string },
): AttemptView | "stale" {
  if (incoming.localAttemptId !== activeId) return "stale";
  return {
    localAttemptId: incoming.localAttemptId,
    upstreamRequestId: null,
    status: incoming.status,
    text: incoming.status === "ok" ? incoming.text : safeReason(reasonCode(incoming.status), incoming.text),
    retryable: false,
  };
}

export function dismissResult(): null {
  return null;
}
