/** Bounded timeouts for chat stream and agent Run. Honest fail — never hang. */

export const CHAT_TURN_TIMEOUT_MS = 30_000;
export const AGENT_RUN_TIMEOUT_MS = 45_000;

export const CHAT_TIMEOUT_REPLY = "Timed out waiting for Grok. Nothing was saved as a success.";
export const AGENT_TIMEOUT_REPLY = "Timed out waiting for the planner. Nothing was marked finished.";

export function isTimeoutAbort(signal: AbortSignal | null | undefined, reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === "TimeoutError") return true;
  if (signal?.reason instanceof DOMException && signal.reason.name === "TimeoutError") return true;
  const msg = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return /timed out|TimeoutError/i.test(msg);
}

/** Prefer AbortSignal.timeout; fall back to a manual timer abort. */
export function boundAbortSignal(parent: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function") {
    const timed = AbortSignal.timeout(timeoutMs);
    return { signal: AbortSignal.any([parent, timed]), cleanup: () => undefined };
  }
  const controller = new AbortController();
  const onParent = () => controller.abort(parent.reason);
  if (parent.aborted) onParent();
  else parent.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}
