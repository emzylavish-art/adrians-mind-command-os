import type { SessionIdentity } from "./session-http.ts";

export type CanonicalSessionState = {
  status: "pending" | "authenticated" | "signed-out" | "conflict" | "unavailable";
  user: SessionIdentity | null;
  error: string | null;
};
export const PENDING_SESSION: CanonicalSessionState = { status: "pending", user: null, error: null };

/** Shared by all auth consumers; an older response cannot restore the previous owner. */
export function createSessionIdentityStore(read: () => Promise<CanonicalSessionState>) {
  let snapshot = PENDING_SESSION;
  let generation = 0;
  let key: string | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CanonicalSessionState) => { snapshot = next; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => snapshot,
    matchesKey: (candidate: string) => key === candidate,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh(nextKey: string, force = false): Promise<void> {
      if (key === nextKey && (pending || !force)) return pending ?? Promise.resolve();
      key = nextKey;
      const attempt = ++generation;
      publish(PENDING_SESSION);
      pending = read().then(
        (next) => { if (attempt === generation) publish(next); },
        () => { if (attempt === generation) publish({ status: "unavailable", user: null, error: "Account verification is unavailable. Try again before sending or saving account data." }); },
      ).finally(() => { if (attempt === generation) pending = null; });
      return pending;
    },
  };
}

export async function readSessionIdentity(fetchImpl: typeof fetch, url: string, bearer: string | null): Promise<CanonicalSessionState> {
  const response = await fetchImpl(url, {
    credentials: "include", cache: "no-store",
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json() as Partial<CanonicalSessionState>;
  if (!response.ok || data.status === "conflict" || data.status === "unavailable") {
    return { status: data.status === "conflict" ? "conflict" : "unavailable", user: null, error: data.error || "Account verification is unavailable." };
  }
  if (data.status === "authenticated" && typeof data.user?.id === "string" && data.user.id) {
    return { status: "authenticated", user: data.user, error: null };
  }
  if (data.status === "signed-out" && data.user === null) return { status: "signed-out", user: null, error: null };
  return { status: "unavailable", user: null, error: "The account response was incomplete. Try again." };
}
