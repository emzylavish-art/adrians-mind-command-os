import { reconcileSessionReads, classifySessionError, type SessionRead } from "./session-resolution.ts";
import { getRequest } from "@tanstack/react-start/server";
import { localPreviewIdentityAllowed, verifiedSessionIdentity, verifiedSupabaseCandidate } from "./session-user.ts";
import { gateIdentityEnabled } from "./gate-identity.server";
import { auth, authConfigured } from "./server";
import { hasSupabaseCredential, identitiesAgree } from "./identity-continuity.ts";

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
async function readSupabaseSessionUser(): Promise<SessionRead> {
  const request = getRequest();
  const hasCredential = /(?:^|;\s*)sb-[^=;]*auth-token/i.test(request?.headers.get("cookie") ?? "");
  try {
    const { readSupabaseEnv, createSupabaseServerClient } = await import("../supabase/server");
    if (!readSupabaseEnv()) return { state: "absent" };
    const { data, error } = await createSupabaseServerClient().auth.getUser();
    if (error) return classifySessionError(error, hasCredential);
    return data.user?.id ? { state: "verified", user: { id: data.user.id, email: data.user.email ?? null } } : { state: hasCredential ? "rejected" : "absent" };
  } catch (error) { return classifySessionError(error, hasCredential); }
}
async function readBetterAuthSessionUser(bearerToken?: string): Promise<SessionRead> {
  if (!authConfigured && !gateIdentityEnabled()) return { state: "absent" };
  const request = getRequest(); if (!request) return { state: "absent" };
  const headers = new Headers(request.headers); if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  const credentialPresent = !!bearerToken || /(?:^|;\s*)(?:__Host-)?(?:grok-auth|better-auth)\./i.test(headers.get("cookie") ?? "");
  try {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    return session?.user?.id ? { state: "verified", user: { id: session.user.id, email: session.user.email ?? null } } : { state: credentialPresent ? "rejected" : "absent" };
  } catch (error) { return classifySessionError(error, credentialPresent); }
}
export async function getSessionUser(bearerToken?: string): Promise<VerifiedUser | null> {
  const [primary, secondary] = await Promise.all([readSupabaseSessionUser(), readBetterAuthSessionUser(bearerToken)]);
  return reconcileSessionReads(primary, secondary);
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
    if (/(?:^|;\s*)(?:(?:__Host-)?(?:grok-auth|better-auth)\.|sb-[^=;]*auth-token)/i.test(headers.get("cookie") ?? "")) return false;
    return localPreviewIdentityAllowed(headers.get("host") ?? "", process.env);
  } catch {
    return false;
  }
}
