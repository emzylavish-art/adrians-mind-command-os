/**
 * Gap #28 — short TTL + single-flight cache for buildDashboardStatus.
 * Does not invent payloads; only memoizes a real build result.
 */

export const STATUS_SERVER_TTL_MS = 8_000;

export type StatusBuildFn<T> = () => Promise<T>;

export type StatusServerCacheControls<T> = {
  get: (build: StatusBuildFn<T>, nowMs?: number) => Promise<T>;
  clear: () => void;
  /** Test/introspection */
  peek: () => { at: number; hasValue: boolean; inflight: boolean };
};

export function createStatusServerCache<T>(ttlMs = STATUS_SERVER_TTL_MS): StatusServerCacheControls<T> {
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : STATUS_SERVER_TTL_MS;
  let at = 0;
  let value: T | undefined;
  let inflight: Promise<T> | null = null;

  return {
    async get(build, nowMs = Date.now()) {
      if (value !== undefined && nowMs - at < ttl) return value;
      if (inflight) return inflight;
      const started = nowMs;
      const p = Promise.resolve()
        .then(() => build())
        .then((v) => {
          value = v;
          at = started;
          inflight = null;
          return v;
        })
        .catch((err) => {
          inflight = null;
          throw err;
        });
      inflight = p;
      return p;
    },
    clear() {
      at = 0;
      value = undefined;
      inflight = null;
    },
    peek() {
      return { at, hasValue: value !== undefined, inflight: inflight != null };
    },
  };
}

/** Process-wide cache for the status route. */
export const dashboardStatusServerCache = createStatusServerCache<unknown>();
