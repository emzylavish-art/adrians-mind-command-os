export type BrowserTimers = {
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(id: number): void;
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(id: number): void;
};

/** Enqueue/visibility wakes are coalesced; the interval is only a recovery heartbeat. */
export function startBrowserWorkPump(input: {
  step: () => void;
  visible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  timers: BrowserTimers;
}) {
  let disposed = false;
  let pending: number | null = null;
  let running = false;
  const wake = () => {
    if (disposed || pending !== null || running || !input.visible()) return;
    pending = input.timers.setTimeout(() => {
      pending = null;
      if (disposed || running || !input.visible()) return;
      running = true;
      try { input.step(); } finally { running = false; }
    }, 0);
  };
  const heartbeat = input.timers.setInterval(wake, 2000);
  const unsubscribe = input.subscribeVisibility(wake);
  wake();
  return {
    wake,
    dispose() {
      disposed = true;
      if (pending !== null) input.timers.clearTimeout(pending);
      pending = null;
      input.timers.clearInterval(heartbeat);
      unsubscribe();
    },
  };
}
