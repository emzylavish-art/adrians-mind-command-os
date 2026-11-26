import { useEffect, useMemo, useSyncExternalStore } from "react";
import { authClient, authEnabled, getBearerToken } from "./client";
import { createSessionIdentityStore, PENDING_SESSION, readSessionIdentity, type CanonicalSessionState } from "./session-state";
import { previewPathPrefix } from "../preview-path-prefix";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  emailVerified?: boolean;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
  sessionSource?: "supabase" | "better-auth" | "both";
};

/**
 * Stable fallback user, used ONLY when auth is disabled
 * (`VITE_AUTH_ENABLED=false`, the shipped default). With auth on, the sandbox
 * live preview does real sign-in via the baked preview client. Its id is
 * `"dev-user"` — the SAME id `verify.server.ts` returns server-side — so per-user
 * rows written in that mode belong to one consistent owner.
 */
export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
};

/** `useCurrentUserState()` result: the user plus the session-loading flag. */
export type CurrentUserState = {
  /** The user — `null` BOTH while the session loads and when signed out. */
  user: AppUser | null;
  /** True while the session is still resolving — don't treat `user: null` as signed out yet. */
  isPending: boolean;
  status?: CanonicalSessionState["status"];
  error?: string | null;
  retry?: () => void;
};

const DEV_STATE: CurrentUserState = { user: DEV_USER, isPending: false, status: "authenticated", error: null };
const identityStore = createSessionIdentityStore(() => {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return readSessionIdentity(fetch, `${prefix}/api/mind/session`, getBearerToken());
});
const serverSnapshot = () => PENDING_SESSION;

/**
 * Current user + loading state. Same behavior in live preview and when deployed:
 *   - Auth enabled -> the real signed-in user; `user` is `null` while
 *                            the session resolves (`isPending: true`) and when
 *                            signed out (`isPending: false`). Identity comes from
 *                            `/api/mind/session`, the same verified owner contract
 *                            used by execution and persistence. Better Auth updates
 *                            trigger revalidation; cached profile data is display only.
 *   - Auth disabled (`VITE_AUTH_ENABLED=false`) -> `DEV_USER`, never pending.
 *
 * Protect a route by waiting out `isPending` before acting on `user` —
 * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
 * every hard reload:
 *
 *   import { RedirectToSignIn } from "@/lib/auth/gates";
 *   const { user, isPending } = useCurrentUserState();
 *   if (isPending) return null;              // still resolving — don't redirect yet
 *   if (!user) return <RedirectToSignIn />;  // definitely signed out
 *
 * `authEnabled` is a module-level constant fixed at load, so the guarded hook
 * call keeps a stable hook order across every render of a given component.
 */
export function useCurrentUserState(): CurrentUserState {
  if (!authEnabled) return DEV_STATE;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- authEnabled is constant for the app's lifetime
  return useSessionUserState();
}

function useSessionUserState(): CurrentUserState {
  const { data, isPending: brokerPending } = authClient.useSession();
  const brokerId = data?.user.id ?? "signed-out";
  const requestKey = `${brokerPending ? "pending" : "resolved"}:${brokerId}`;
  const session = useSyncExternalStore(identityStore.subscribe, identityStore.getSnapshot, serverSnapshot);
  useEffect(() => {
    void identityStore.refresh(requestKey);
    const refresh = () => { void identityStore.refresh(requestKey, true); };
    window.addEventListener("focus", refresh);
    window.addEventListener("adrian-auth-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("adrian-auth-changed", refresh);
    };
  }, [requestKey]);
  const retry = () => { void identityStore.refresh(requestKey, true); };
  const keyIsCurrent = identityStore.matchesKey(requestKey);
  const verifiedId = keyIsCurrent ? session.user?.id : undefined;
  const brokerMatches = verifiedId === data?.user.id;
  const user = useMemo<AppUser | null>(() => verifiedId ? {
    id: verifiedId,
    displayName: brokerMatches ? data?.user.name ?? null : null,
    primaryEmail: session.user?.email ?? null,
    emailVerified: brokerMatches ? data?.user.emailVerified === true : undefined,
    profileImageUrl: brokerMatches ? data?.user.image ?? null : null,
    isDevFallback: false,
    sessionSource: session.user?.sessionSource,
  } : null, [verifiedId, brokerMatches, data?.user.name, data?.user.emailVerified, data?.user.image, session.user]);
  return { user, isPending: !keyIsCurrent || session.status === "pending", status: keyIsCurrent ? session.status : "pending", error: keyIsCurrent ? session.error : null, retry };
}

/**
 * Convenience view of `useCurrentUserState().user` for display (e.g.
 * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
 * for redirects/guards use `useCurrentUserState()` and check `isPending`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
