/** Debounce final voice transcripts before POSTing build steers. */

export const BUILD_STEER_DEBOUNCE_MS = 450;

export type DebouncedSteerController = {
  /** Schedule a final transcript. Returns a promise for the flushed text (or null if superseded). */
  push: (text: string) => Promise<string | null>;
  flushNow: () => string | null;
  clear: () => void;
  pending: () => string | null;
};

export function createDebouncedSteer(delayMs = BUILD_STEER_DEBOUNCE_MS): DebouncedSteerController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: string | null = null;
  let waiters: Array<(value: string | null) => void> = [];

  const resolveAll = (value: string | null) => {
    const batch = waiters;
    waiters = [];
    for (const w of batch) w(value);
  };

  const flushNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const text = latest;
    latest = null;
    resolveAll(text);
    return text;
  };

  return {
    push(text: string) {
      latest = text;
      if (timer) clearTimeout(timer);
      return new Promise<string | null>((resolve) => {
        waiters.push(resolve);
        timer = setTimeout(() => {
          timer = null;
          const out = latest;
          latest = null;
          resolveAll(out);
        }, delayMs);
      });
    },
    flushNow,
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      latest = null;
      resolveAll(null);
    },
    pending: () => latest,
  };
}
