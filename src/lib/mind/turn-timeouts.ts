/** Bounded timeouts for chat stream and agent Run. Honest fail — never hang. */

/** Default chat SSE / turn budget (ms). Override with MIND_CHAT_TIMEOUT_MS (≥1000). */
export const DEFAULT_CHAT_TURN_TIMEOUT_MS = 30_000;
/** Default bounded-agent Run budget (ms). Override with MIND_AGENT_TIMEOUT_MS (≥1000). */
export const DEFAULT_AGENT_RUN_TIMEOUT_MS = 45_000;

/** @deprecated Prefer chatTurnTimeoutMs() — kept as the documented default. */
export const CHAT_TURN_TIMEOUT_MS = DEFAULT_CHAT_TURN_TIMEOUT_MS;
/** @deprecated Prefer agentRunTimeoutMs() — kept as the documented default. */
export const AGENT_RUN_TIMEOUT_MS = DEFAULT_AGENT_RUN_TIMEOUT_MS;

export const CHAT_TIMEOUT_REPLY = "Timed out waiting for the model. The provider may have processed this request. Sending again may repeat it.";
/** Mid-stream drop / fetch failure — distinct from a turn timeout. */
export const CHAT_DISCONNECT_REPLY = "Connection to the model dropped. The provider may have processed this request. Sending again may repeat it.";
export const AGENT_TIMEOUT_REPLY = "Timed out waiting for the planner. Nothing was marked finished.";

function readBudgetMs(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 1_000) return fallback;
  return Math.min(120_000, Math.floor(n));
}

export function chatTurnTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  return readBudgetMs(env.MIND_CHAT_TIMEOUT_MS, DEFAULT_CHAT_TURN_TIMEOUT_MS);
}

export function agentRunTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  return readBudgetMs(env.MIND_AGENT_TIMEOUT_MS, DEFAULT_AGENT_RUN_TIMEOUT_MS);
}

export function isTimeoutAbort(signal: AbortSignal | null | undefined, reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === "TimeoutError") return true;
  if (signal?.reason instanceof DOMException && signal.reason.name === "TimeoutError") return true;
  const msg = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return /timed out|TimeoutError/i.test(msg);
}

/**
 * Bound a parent signal with a timeout via setTimeout (fake-timer friendly).
 * Abort reason is TimeoutError so callers can map to CHAT_/AGENT_TIMEOUT_REPLY.
 */
export function boundAbortSignal(
  parent: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onParent = () => {
    if (!controller.signal.aborted) controller.abort(parent.reason);
  };
  if (parent.aborted) onParent();
  else parent.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("The operation timed out", "TimeoutError"));
    }
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}
