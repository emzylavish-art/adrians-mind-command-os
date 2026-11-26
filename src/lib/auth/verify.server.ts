import { getRequest } from "@tanstack/react-start/server";
import { localPreviewIdentityAllowed, verifiedSessionIdentity, verifiedSupabaseCandidate } from "./session-user.ts";
import { gateIdentityEnabled } from "./gate-identity.server";
import { auth, authConfigured } from "./server";

/**
 * Server-side session resolution (server-only).
 *
 * Because this app runs its OWN Better Auth at same-origin `/api/auth/*`, the
 * session cookie is sent with every request to this app — server functions AND
 * SSR loaders included. So we resolve the user straight from the request cookies
 * via `auth.api.getSession` (no client-minted JWT needed). Never trust a
 * client-supplied user id — only the result of this verification.
 */

export { authConfigured };

/** Credential-free identity for a local development or packaged workstation. */
export const DEV_USER_ID = "dev-user";

/**
 * Thrown by `requireUserId` when the caller has no valid session. Carries
 * `status: 401`; the message is a stable contract — match
 * `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; email: string | null; sessionSource?: "supabase" | "better-auth" | "both" };

/**
 * Resolve the signed-in user from the current request, or `null` when auth isn't
 * configured / nobody is signed in. Safe to call from server functions and SSR
 * loaders.
 *
 * `bearerToken` is for the LIVE PREVIEW: the app runs in a partitioned iframe
 * whose cookies don't reach the server, so `authMiddleware` forwards the session
 * as a bearer token, which we present as `Authorization: Bearer …` (the `bearer`
 * plugin resolves it). When deployed no token is passed and the cookie is used.
 */
async function readSupabaseSessionUser(): Promise<VerifiedUser | null> {
  const { readSupabaseEnv, createSupabaseServerClient } = await import("../supabase/server");
  if (!readSupabaseEnv()) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  return verifiedSupabaseCandidate({ user: data.user, error });
}

async function readBetterAuthSessionUser(
  bearerToken?: string,
): Promise<VerifiedUser | null> {
  if (!authConfigured && !gateIdentityEnabled()) return null;
  const request = getRequest();
  if (!request) return null;
  let headers = request.headers;
  if (bearerToken) {
    headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  // The UI can use the signed cache for rendering. Authority for server-side work
  // must come from the current session record, including after revocation.
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

export async function getSessionUser(
  bearerToken?: string,
): Promise<VerifiedUser | null> {
  const [supabaseUser, betterAuthUser] = await Promise.all([
    readSupabaseSessionUser(), readBetterAuthSessionUser(bearerToken),
  ]);
  return verifiedSessionIdentity({ supabaseUser, betterAuthUser });
}

/**
 * Resolve the current user id for a server function, or throw when unauthorized.
 * Prefer `authMiddleware` (`./middleware`), which calls this for you.
 * Use a verified user whenever credentials are supplied. Only a local
 * development or packaged PC process can grant a credential-free offline identity.
 */
export async function requireUserId(bearerToken?: string): Promise<string> {
  if (!bearerToken && isLoopbackPreview()) return DEV_USER_ID;
  const user = await getSessionUser(bearerToken);
  if (!user || user.id === DEV_USER_ID) throw new UnauthorizedError();
  return user.id;
}

/** This computer's preview only, with no session credential presented. */
export function isLoopbackPreview(): boolean {
  try {
    const headers = getRequest().headers;
    if (headers.has("authorization") || headers.has("x-grok-identity")) return false;
    if (/(?:^|;\s*)(?:__Host-grok-auth\.|sb-[^=;]*auth-token)/i.test(headers.get("cookie") ?? "")) return false;
    return localPreviewIdentityAllowed(headers.get("host") ?? "", process.env);
  } catch {
    return false;
  }
}
