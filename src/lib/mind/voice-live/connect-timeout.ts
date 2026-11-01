/** Hard timeouts for live-voice connect phases (headless / no-device safe). */

export const MIC_PROBE_TIMEOUT_MS = 8_000;
export const MINT_TIMEOUT_MS = 10_000;
export const WS_OPEN_TIMEOUT_MS = 10_000;
export const MIC_START_TIMEOUT_MS = 8_000;

export class ConnectTimeoutError extends Error {
  readonly phase: "mic" | "mint" | "ws" | "mic-start";
  constructor(phase: ConnectTimeoutError["phase"], message: string) {
    super(message);
    this.name = "ConnectTimeoutError";
    this.phase = phase;
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  phase: ConnectTimeoutError["phase"],
  message: string,
  signal?: AbortSignal | null,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Live voice start was canceled."), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(() => {
      reject(new ConnectTimeoutError(phase, message));
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Live voice start was canceled."), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError")
  );
}
