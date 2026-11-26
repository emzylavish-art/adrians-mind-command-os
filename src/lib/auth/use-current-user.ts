import { useEffect, useMemo, useRef, useState } from "react";
import { authClient, authEnabled, getBearerToken } from "./client";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  emailVerified?: boolean;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
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
  error?: string | null;
};

const DEV_STATE: CurrentUserState = { user: DEV_USER, isPending: false };

/**
 * Current user + loading state. Same behavior in live preview and when deployed:
 *   - Auth enabled -> the real signed-in user; `user` is `null` while
 *                            the session resolves (`isPending: true`) and when
 *                            signed out (`isPending: false`). Session comes from
 *                            Better Auth `useSession()` → `/api/auth/get-session`
 *                            (cookie when deployed; bearer in live preview).
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
  const session = authClient.useSession();
  const [canonical, setCanonical] = useState<{ user: { id: string; email: string | null; emailVerified?: boolean; displayName?: string | null; profileImageUrl?: string | null } | null; pending: boolean; error?: string | null }>({ user: null, pending: true });
  const request = useRef(0);
  // The same verified owner endpoint used by writes checks both session
  // systems. A display-only session must never choose a different owner.
  useEffect(() => {
    let live = true;
    let controller: AbortController | undefined;
    const refresh = () => {
      const generation = ++request.current;
      controller?.abort();
      controller = new AbortController();
      setCanonical((current) => current.user ? current : { user: null, pending: true });
      const token = getBearerToken();
      void fetch("/api/auth/owner", { credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      }).then(async (response) => {
        const body = await response.json() as { user?: { id?: unknown; email?: unknown; emailVerified?: unknown; displayName?: unknown; profileImageUrl?: unknown } | null; error?: string };
        if (!response.ok) throw new Error(response.status === 409 && body.error ? body.error : "The account could not be verified. Try refreshing or sign out.");
        const user = body.user && typeof body.user.id === "string"
          ? { id: body.user.id, email: typeof body.user.email === "string" ? body.user.email : null, emailVerified: body.user.emailVerified === true, displayName: typeof body.user.displayName === "string" ? body.user.displayName : null, profileImageUrl: typeof body.user.profileImageUrl === "string" ? body.user.profileImageUrl : null } : null;
        if (live && request.current === generation) setCanonical({ user, pending: false });
      }).catch((error) => {
        if (live && request.current === generation) setCanonical({ user: null, pending: false, error: error instanceof Error ? error.message : "The account could not be verified." });
      });
    };
    setCanonical({ user: null, pending: true });
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("adrian-auth-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      ++request.current;
      controller?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("adrian-auth-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [session.data?.user.id]);
  const id = canonical.user?.id;
  const sameDisplaySession = id && session.data?.user.id === id ? session.data.user : null;
  const displayName = canonical.user?.displayName ?? sameDisplaySession?.name ?? null;
  const primaryEmail = canonical.user?.email ?? null;
  const emailVerified = canonical.user?.emailVerified === true;
  const profileImageUrl = canonical.user?.profileImageUrl ?? sameDisplaySession?.image ?? null;
  const user = useMemo<AppUser | null>(
    () => (id ? { id, displayName, primaryEmail, emailVerified, profileImageUrl, isDevFallback: id === "dev-user" } : null),
    [id, displayName, primaryEmail, emailVerified, profileImageUrl],
  );
  return useMemo(() => ({ user, isPending: canonical.pending, error: canonical.error }), [user, canonical.pending, canonical.error]);
}

/**
 * Convenience view of `useCurrentUserState().user` for display (e.g.
 * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
 * for redirects/guards use `useCurrentUserState()` and check `isPending`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
