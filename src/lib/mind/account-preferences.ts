export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & { keyFor?: (key: string) => string };

export function accountPreferenceKey(ownerId: string | null, key: string) {
  return `amcos.account-preferences.v1.${encodeURIComponent(ownerId ?? "guest")}.${encodeURIComponent(key)}`;
}

/** Execution preferences never inherit an unowned legacy key or another account. */
export function accountPreferences(storage: PreferenceStorage | null, ownerId: string | null): PreferenceStorage {
  const transient = new Map<string, string>();
  return {
    keyFor: (key) => accountPreferenceKey(ownerId, key),
    getItem(key) { return storage ? storage.getItem(accountPreferenceKey(ownerId, key)) : transient.get(key) ?? null; },
    setItem(key, value) { if (storage) storage.setItem(accountPreferenceKey(ownerId, key), value); else transient.set(key, value); },
    removeItem(key) { if (storage) storage.removeItem(accountPreferenceKey(ownerId, key)); else transient.delete(key); },
  };
}
