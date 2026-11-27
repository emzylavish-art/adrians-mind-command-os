import { createContext, useContext, useMemo, type ReactNode } from "react";
import { accountPreferences, type PreferenceStorage } from "@/lib/mind/account-preferences";

const PreferenceContext = createContext<PreferenceStorage | null>(null);
export function AccountPreferencesProvider({ ownerId, children }: { ownerId: string | null; children: ReactNode }) {
  const storage = useMemo(() => {
    let browser: Storage | null = null;
    try { browser = typeof window === "undefined" ? null : window.localStorage; } catch { /* session-only settings */ }
    return accountPreferences(browser, ownerId);
  }, [ownerId]);
  return <PreferenceContext.Provider value={storage}>{children}</PreferenceContext.Provider>;
}
export function useAccountPreferences() {
  const provided = useContext(PreferenceContext);
  const sessionOnly = useMemo(() => accountPreferences(null, null), []);
  return provided ?? sessionOnly;
}
