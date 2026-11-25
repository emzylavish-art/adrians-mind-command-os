import { useCallback, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from "react";

const clearEvent = "adrian-clear-account-drafts";
function ownerPrefix(owner: string) { return "amcos.draft.v1.[" + JSON.stringify(owner) + ","; }

export function clearAccountDrafts(owner: string) {
  const prefix = ownerPrefix(owner);
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  }
  window.dispatchEvent(new CustomEvent(clearEvent, { detail: prefix }));
}

/** Each open tab owns its drafts. Temporary conversations keep drafts in memory only. */
export function useComposerDraft<T>(scope: string, field: string, initial: T, persist: boolean) {
  const fields = useMemo(() => new Map<string, T>(), []);
  const listeners = useMemo(() => new Set<() => void>(), []);
  const key = `amcos.draft.v1.${scope}.${field}`;
  const read = useCallback((key: string, persist: boolean) => {
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
  }, [fields, initial]);
  const getSnapshot = useCallback(() => read(key, persist), [read, key, persist]);
  const subscribe = useCallback((notify: () => void) => {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, [listeners]);
  useEffect(() => {
    const clear = (event: Event) => {
      const prefix = (event as CustomEvent<string>).detail;
      for (const stored of fields.keys()) if (stored.startsWith(prefix)) fields.delete(stored);
      for (const notify of listeners) notify();
    };
    window.addEventListener(clearEvent, clear);
    return () => window.removeEventListener(clearEvent, clear);
  }, [fields, listeners]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial);
  const write = useCallback((key: string, persist: boolean, update: SetStateAction<T>) => {
    const next = typeof update === "function" ? (update as (previous: T) => T)(read(key, persist)) : update;
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
  }, [fields, read, listeners]);
  const setValue = useCallback((update: SetStateAction<T>) => write(key, persist, update), [key, persist, write]);
  const setInScope = useCallback((scope: string, persist: boolean, update: SetStateAction<T>) =>
    write(`amcos.draft.v1.${scope}.${field}`, persist, update), [field, write]);
  return [value, setValue, setInScope] as const;
}
