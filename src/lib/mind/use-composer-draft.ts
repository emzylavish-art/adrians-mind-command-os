import { useCallback, useMemo, useSyncExternalStore, type SetStateAction } from "react";

/** Each open tab owns its drafts. Temporary conversations keep drafts in memory only. */
export function useComposerDraft<T>(scope: string, field: string, initial: T, persist: boolean) {
  const fields = useMemo(() => new Map<string, T>(), []);
  const listeners = useMemo(() => new Set<() => void>(), []);
  const key = `amcos.draft.v1.${scope}.${field}`;
  const getSnapshot = useCallback(() => {
    if (!fields.has(key)) {
      let value = initial;
      if (persist) {
        try {
          const raw = window.sessionStorage.getItem(key);
          if (raw !== null) value = JSON.parse(raw) as T;
        } catch { /* A disabled storage area still permits an in-memory draft. */ }
      }
      fields.set(key, value);
    }
    return fields.get(key) as T;
  }, [fields, initial, key, persist]);
  const subscribe = useCallback((notify: () => void) => {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, [listeners]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial);
  const setValue = useCallback((update: SetStateAction<T>) => {
    const next = typeof update === "function" ? (update as (previous: T) => T)(getSnapshot()) : update;
    fields.set(key, next);
    if (persist) {
      try {
        if (next === null || next === "" || (Array.isArray(next) && next.length === 0)) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // An out-of-quota write must not restore an older attachment or text on reload.
        try { window.sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
        window.dispatchEvent(new Event("adrian-draft-storage-full"));
      }
    }
    for (const notify of listeners) notify();
  }, [fields, getSnapshot, key, listeners, persist]);
  return [value, setValue] as const;
}
