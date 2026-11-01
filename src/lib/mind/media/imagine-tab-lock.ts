/**
 * Cross-tab Imagine spam brake (BroadcastChannel + localStorage).
 * Complements the server rate limit; does not replace it.
 */
const LOCK_KEY = "amcos.imagine.lock.v1";
const CHANNEL = "amcos.imagine.lock";

export type ImagineTabLock = {
  tryAcquire(): boolean;
  release(): void;
  dispose(): void;
};

export function createImagineTabLock(ownerKey = "default"): ImagineTabLock {
  const key = `${LOCK_KEY}:${ownerKey}`;
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    channel = null;
  }
  let holding = false;

  const onMessage = (event: MessageEvent) => {
    if (event?.data?.type === "acquire" && event.data.key === key && !holding) {
      /* peer acquired — local tryAcquire will see localStorage */
    }
  };
  channel?.addEventListener("message", onMessage);

  return {
    tryAcquire() {
      try {
        const raw = localStorage.getItem(key);
        const now = Date.now();
        if (raw) {
          const parsed = JSON.parse(raw) as { until?: number };
          if (typeof parsed.until === "number" && parsed.until > now) return false;
        }
        localStorage.setItem(key, JSON.stringify({ until: now + 15_000 }));
        channel?.postMessage({ type: "acquire", key });
        holding = true;
        return true;
      } catch {
        // private mode — allow; server rate limit still applies
        holding = true;
        return true;
      }
    },
    release() {
      holding = false;
      try {
        localStorage.removeItem(key);
        channel?.postMessage({ type: "release", key });
      } catch {
        /* ignore */
      }
    },
    dispose() {
      this.release();
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      channel = null;
    },
  };
}
