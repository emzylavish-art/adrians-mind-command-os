/**
 * Per-id motion state pruning (Cosmos Motion Bot c20).
 *
 * Dashboard keeps Maps of per-bot motion state (focus-ease, health crossfade,
 * character, …). Bots that leave status (rename, retire, id churn from a bad
 * feed) were never evicted, so a long-lived /dashboard tab grew those Maps without
 * bound. `pruneMotionStateMap` drops ids no longer live and hard-caps the Map
 * (oldest insertion first). Allocation-light (Map iterator only) — call it when
 * status/bot list changes, not every frame. Probes the live set; works with a Set, a Map, or an id array (array is O(n·m), fine for
 * the ≤ STAR_BATCH_MAX bots the scene renders).
 */
import { finiteOr } from "./sanitize.ts";

/** Hard cap for any per-id motion state Map. */
export const MOTION_STATE_MAP_MAX = 4096;

export type LiveIds =
  | ReadonlySet<string>
  | ReadonlyMap<string, unknown>
  | ReadonlyArray<string | null | undefined>
  | null
  | undefined;

function isLive(live: LiveIds, id: string): boolean {
  if (live == null) return false;
  if (Array.isArray(live)) {
    for (let i = 0; i < live.length; i++) if (live[i] === id) return true;
    return false;
  }
  return (live as ReadonlySet<string>).has(id);
}

/**
 * Remove entries whose key is not in `liveIds`, then evict oldest entries until
 * `size <= max`. `onEvict` lets callers park state (e.g. pose-hold) before drop.
 * `liveIds == null` is treated as "unknown" → no liveness pruning (only the cap),
 * so a failed/empty status fetch cannot wipe every star's motion state.
 * Returns the number of entries removed.
 */
export function pruneMotionStateMap<V>(
  map: Map<string, V> | null | undefined,
  liveIds: LiveIds,
  max: number = MOTION_STATE_MAP_MAX,
  onEvict?: (id: string, value: V) => void,
): number {
  if (!map || typeof map.size !== "number") return 0;
  const cap = Math.max(0, Math.floor(finiteOr(max, MOTION_STATE_MAP_MAX)));
  let removed = 0;
  if (liveIds != null) {
    // Deleting the current key during Map iteration is safe per spec.
    for (const [id, v] of map) {
      if (!isLive(liveIds, id)) {
        map.delete(id);
        removed++;
        if (onEvict) {
          try {
            onEvict(id, v);
          } catch {
            /* eviction hook must not break the frame */
          }
        }
      }
    }
  }
  if (map.size > cap) {
    for (const [id, v] of map) {
      if (map.size <= cap) break;
      map.delete(id);
      removed++;
      if (onEvict) {
        try {
          onEvict(id, v);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return removed;
}
