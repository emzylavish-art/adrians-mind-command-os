/**
 * The three honest UI failure states already defined in this app.
 * Messages match server/client copy in turn.server, server.ts, policy, fleet, and live-turn.
 */

export type HonestFailureKind = "model_unavailable" | "database_write_failed" | "emergency_stop_active";

export const HONEST_FAILURE_MESSAGES = {
  model_unavailable: "That model is not available. Another provider is not substituted.",
  model_unreachable: "Grok could not be reached.",
  model_unconfigured: "Grok is not configured on the server.",
  database_write_failed: "The server copy could not be saved. The browser copy was kept.",
  emergency_stop_active: "Emergency stop is on. No new action can run.",
} as const;

export const HONEST_FAILURE_ACTIONS: Record<HonestFailureKind, string> = {
  model_unavailable: "model_unavailable",
  database_write_failed: "database_write_failed",
  emergency_stop_active: "emergency_stop_active",
};

const MODEL_UNAVAILABLE_MARKERS = [
  HONEST_FAILURE_MESSAGES.model_unavailable,
  HONEST_FAILURE_MESSAGES.model_unreachable,
  HONEST_FAILURE_MESSAGES.model_unconfigured,
  "No Grok key is configured",
  "Another provider is not substituted",
  "Grok did not answer in time",
  "Grok returned an empty reply",
  "That provider is not known",
];

export function classifyHonestFailure(message: string): HonestFailureKind | null {
  const text = message.trim();
  if (!text) return null;
  if (text === HONEST_FAILURE_MESSAGES.emergency_stop_active || text.startsWith("Emergency stop is on.")) {
    return "emergency_stop_active";
  }
  if (text === HONEST_FAILURE_MESSAGES.database_write_failed || text.includes("could not be saved")) {
    return "database_write_failed";
  }
  if (MODEL_UNAVAILABLE_MARKERS.some((marker) => text.includes(marker))) {
    return "model_unavailable";
  }
  return null;
}

export function honestFailureDescription(kind: HonestFailureKind, message?: string): string {
  if (message?.trim()) return message.trim();
  switch (kind) {
    case "model_unavailable":
      return HONEST_FAILURE_MESSAGES.model_unreachable;
    case "database_write_failed":
      return HONEST_FAILURE_MESSAGES.database_write_failed;
    case "emergency_stop_active":
      return HONEST_FAILURE_MESSAGES.emergency_stop_active;
  }
}

export function honestFailureAuditAction(kind: HonestFailureKind): string {
  return HONEST_FAILURE_ACTIONS[kind];
}

/** Retry keeps the same parameters object identity for the caller's closure to re-invoke. */
export function bindRetry<T extends unknown[]>(action: (...args: T) => void, args: T): () => void {
  return () => action(...args);
}
