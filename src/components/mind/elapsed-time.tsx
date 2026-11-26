import { useEffect, useState } from "react";
import { subscribeVisibleClock } from "@/lib/mind/visible-clock";
/** Keep recording clocks local so a one-second tick never re-renders the whole workspace. */
export function ElapsedTime({ startedAt, seconds = 0, clock = false }: { startedAt?: number | null; seconds?: number; clock?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    return subscribeVisibleClock({ tick: setNow, now: Date.now, visible: () => document.visibilityState === "visible",
      timers: window, subscribeVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      } });
  }, [startedAt]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : seconds;
  return <>{clock ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : elapsed}</>;
}
