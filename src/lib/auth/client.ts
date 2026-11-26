import { createAuthClient } from "better-auth/react";
import { runPreSignInSignOut, runSignOut, settleWithin } from "../../../scripts/sign-out-plan.mjs";
import { GROK_PROVIDERS } from "./providers";
import { waitForPopupToken } from "./popup-message";
import { readSessionIdentity } from "./session-state";
import { previewPathPrefix } from "../preview-path-prefix";

/**
 * Better Auth client for this React SPA (browser-side).
 *
 * Talks to this app's OWN Better Auth at same-origin `/api/auth/*`. In the live
 * preview the app is an embedded iframe with PARTITIONED cookies, so after a
 * popup sign-in it can't read the session cookie — it authenticates with a
 * bearer token instead (captured from the popup, see `signIn`). The `onRequest`
 * hook attaches that token when present; when deployed (cookie auth) no token
 * is stored, so nothing changes.
 *
 * To sign out call `signOut()` below, NOT `authClient.signOut()`: the raw call
 * leaves the bearer token in place, and `onRequest` keeps re-attaching it, so
 * the visitor stays signed in.
 */
export const authClient = createAuthClient({
  fetchOptions: {
    onRequest(ctx) {
      const token = getBearerToken();
      if (token) ctx.headers.set("Authorization", `Bearer ${token}`);
      return ctx;
    },
  },
});

/**
 * True when sign-in UI should be shown — i.e. whenever `VITE_AUTH_ENABLED` is
 * not `"false"`. The shipped template sets it to `"false"`
 * (`.grok/app-env.json`), which selects the dev user (see `use-current-user`);
 * with the key removed, sign-in is real in preview (baked preview client) and
 * when deployed (injected per-app client).
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/** The upstream providers to render sign-in buttons for. */
export { GROK_PROVIDERS };

// ── Live-preview bearer token ────────────────────────────────────────────────
// The embedded preview iframe has partitioned cookies, so we keep the session's
// bearer token in sessionStorage and attach it to every Better Auth request (and
// to server functions, via `@/lib/auth/middleware`). Empty everywhere except the
// preview after a popup sign-in, so the cookie path is untouched elsewhere.
const BEARER_KEY = "grok-auth.bearer-token";

/** The stored preview bearer token, or null. */
export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

function setBearerToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* storage unavailable — the canonical identity refresh verifies actual state. */
  }
  window.dispatchEvent(new Event("adrian-auth-changed"));
}

/**
 * The sandbox live preview runs this app inside an iframe on a `*.grok-sandbox.com`
 * host, where a full-page redirect to the broker can't work — so sign-in uses a
 * popup there and a normal redirect everywhere else.
 */
function inLivePreview(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".grok-sandbox.com")
  );
}

/**
 * Start sign-in with one upstream provider (`providerId` from `GROK_PROVIDERS`),
 * federating through the Grok auth broker.
 *
 * - **Live preview** (`*.grok-sandbox.com` iframe): opens a POPUP to
 *   `/auth/popup`, served by the template Vite plugin (see `vite.config.ts` +
 *   `popup.server.ts`) — 302s to the broker/upstream login (no app chrome) and,
 *   on return, posts the session bearer token back. We store it and refresh the
 *   session; no top-level navigation of the iframe to the broker.
 * - **Deployed** (and local non-iframe): a normal full-page redirect into the broker.
 *
 * Either way it clears any existing local session FIRST so switching providers
 * actually switches identity.
 */
export async function signIn(
  providerId: string,
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<void> {
  const callbackURL = opts.callbackURL ?? "/";
  const errorCallbackURL = opts.errorCallbackURL ?? "/";

  // Open the popup SYNCHRONOUSLY on the user gesture — before any await
  // (including signOut). Awaiting first drops user-gesture privilege in some
  // browsers when the opener is a cross-origin live-preview iframe.
  const transactionId = crypto.randomUUID();
  const popup = inLivePreview() ? openSignInPopup(providerId, transactionId) : null;
  if (inLivePreview() && !popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in. Your current session was kept.");

  let hasCurrentSession = false;
  let previousSource: "supabase" | "better-auth" | "both" = "better-auth";
  const checked = await settleWithin(async () => {
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    const previous = await readSessionIdentity(fetch, `${prefix}/api/mind/session`, getBearerToken());
    if (previous.status === "conflict" || previous.status === "unavailable" || previous.status === "pending") {
      throw new Error("Account verification failed");
    }
    hasCurrentSession = previous.status === "authenticated";
    previousSource = previous.user?.sessionSource ?? "better-auth";
  }, 10_000);
  if (checked !== "ok") {
    popup?.close();
    throw new Error("The current account could not be verified. Sign-in was not started; resolve the account warning and try again.");
  }

  if (popup?.closed) throw new Error("Sign-in was canceled before account switching started. Your current session was kept.");

  // Clear any prior session so switching providers actually switches identity.
  // Bounded because the popup is already open — a request that never settles
  // would leave it hanging — but bounded PER ENVIRONMENT: only the server can
  // end a deployed session, so cutting it short at the preview's 1.5s would
  // start OAuth with the old session still live.
  try { await runPreSignInSignOut({
    livePreview: inLivePreview() && previousSource === "better-auth",
    hasBearer: Boolean(getBearerToken()),
    requireConfirmation: hasCurrentSession,
    requestSignOut: () => endVerifiedSessions(previousSource),
    clearToken: () => setBearerToken(null),
  }); } catch (error) { popup?.close(); throw error; }

  if (inLivePreview()) {
    if (!popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in");
    if (popup.closed) throw new Error("Sign-in was canceled. Sign in again to recover the original account workspace.");
    const completed = waitForPopupToken(popup, transactionId);
    // The popup remains on a same-origin waiting document until the prior
    // session has ended; OAuth cannot race ahead of the sign-out request.
    popup.location.replace(popupStartUrl(providerId, transactionId));
    const token = await completed;
    if (!token) throw new Error("Sign-in was canceled or failed. The previous session may already have ended. Sign in again to recover the original account workspace.");
    setBearerToken(token);
    // Refresh the client session store with the bearer attached (onRequest).
    // Avoid a full iframe reload when we're already on the destination — that
    // reload was the slow "still loading after the popup closed" feeling.
    try {
      await authClient.getSession();
    } catch {
      /* session store will recover on next useSession fetch */
    }
    if (typeof window !== "undefined") {
      const dest = new URL(callbackURL, window.location.origin);
      const here = window.location;
      if (dest.origin !== here.origin || dest.pathname !== here.pathname || dest.search !== here.search) {
        window.location.href = callbackURL;
      }
    }
    return;
  }

  const { data, error } = await authClient.signIn.social({
    provider: providerId,
    callbackURL,
    errorCallbackURL,
  });
  if (error) throw new Error(error.message ?? "Sign-in failed");
  if (data?.url) window.location.href = data.url;
}

/**
 * Open `/auth/popup` in a new window. Must run synchronously inside the click
 * handler (no await before this). The path is served by the template Vite
 * plugin (`authPopupPlugin` in vite.config.ts) — NOT by a React route.
 *
 * Opens a real same-origin waiting document, so user-gesture permission is
 * retained without starting OAuth before the previous session is ended.
 */
function popupStartUrl(providerId: string, transactionId: string): string {
  return `${window.location.origin}/auth/popup?providerId=${encodeURIComponent(providerId)}&transactionId=${encodeURIComponent(transactionId)}`;
}

function openSignInPopup(providerId: string, transactionId: string): Window | null {
  const url = `${popupStartUrl(providerId, transactionId)}&wait=1`;
  // Unique name per attempt so a prior attempt stuck on the SPA is not reused.
  const name = `grok-signin-${transactionId}`;
  return window.open(url, name, "popup,width=500,height=650");
}

/** End every accepted app session before reporting sign-out. */
async function requestAllSessionSignOut(): Promise<void> {
  const response = await fetch("/api/auth/owner-sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("An account session could not be ended. Retry sign out.");
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("adrian-auth-changed"));
}

/**
 * Sign out of THIS app's local session, clear the preview token, then redirect.
 *
 * Use this, never `authClient.signOut()` — see the note on `authClient`.
 * Sequencing lives in `scripts/sign-out-plan.mjs` so it can be unit-tested.
 *
 * **Rejects when deployed if the server never confirms.** There the session is
 * an HttpOnly cookie only the server can clear, so redirecting anyway would
 * report a sign-out that did not happen. `<UserButton />` handles that for you;
 * a hand-rolled control must catch it and let the visitor retry. Preview sessions also require confirmed invalidation before redirect.
 */
export async function signOut(redirectTo = "/", sessionSource: "supabase" | "better-auth" | "both" = "both"): Promise<void> {
  await runSignOut({
    livePreview: false,
    hasBearer: Boolean(getBearerToken()),
    requestSignOut: () => sessionSource === "both" || inLivePreview() ? requestAllSessionSignOut() : endVerifiedSessions(sessionSource),
    clearToken: () => setBearerToken(null),
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}

/** Clear exactly the canonical verified authorities before leaving their workspace. */
async function endVerifiedSessions(source: "supabase" | "better-auth" | "both"): Promise<void> {
  if (source !== "better-auth") {
    const { endSupabaseSession } = await import("../supabase/actions");
    const result = await endSupabaseSession();
    if (!result.ok) throw new Error(result.error);
  }
  if (source !== "supabase") {
    const { error } = await authClient.signOut();
    if (error) throw new Error(error.message ?? "Sign-out failed");
  }
}
