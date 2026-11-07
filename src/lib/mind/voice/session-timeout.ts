/** Bound a voice session mint that would otherwise stay on "Getting session…". */

export const SPEAK_SESSION_TIMEOUT_MS = 10_000;
export const SPEAK_SESSION_TIMEOUT_MESSAGE = "Getting session timed out. Nothing was started.";

export class SpeakSessionTimeoutError extends Error {
  constructor() {
    super(SPEAK_SESSION_TIMEOUT_MESSAGE);
    this.name = "TimeoutError";
  }
}

/**
 * Resolve `work`, or reject when `ms` passes or `signal` aborts.
 * Abort uses `AbortError` so callers can tell cancel apart from a timeout.
 */
export async function withSessionTimeout<T>(
  work: () => Promise<T>,
  ms = SPEAK_SESSION_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    if (timer) clearTimeout(timer);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new SpeakSessionTimeoutError()), ms);
      }),
      new Promise<T>((_, reject) => {
        if (!signal) return;
        if (signal.aborted) reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        else signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
