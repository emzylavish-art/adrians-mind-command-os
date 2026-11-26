import type { BrowserTimers } from "./browser-work-pump.ts";

/** Presentation only: execution deadlines never depend on a visible tab's timer. */
export function subscribeVisibleClock(input: {
  tick: (now: number) => void;
  now: () => number;
  visible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  timers: Pick<BrowserTimers, "setInterval" | "clearInterval">;
  intervalMs?: number;
}) {
  let timer: number | null = null;
  const stop = () => { if (timer !== null) input.timers.clearInterval(timer); timer = null; };
  const refresh = () => {
    stop();
    if (!input.visible()) return;
    input.tick(input.now());
    timer = input.timers.setInterval(() => input.tick(input.now()), input.intervalMs ?? 1000);
  };
  const unsubscribe = input.subscribeVisibility(refresh);
  refresh();
  return () => { stop(); unsubscribe(); };
}
