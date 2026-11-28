import { createFileRoute } from "@tanstack/react-router";
import { setTimeout as delay } from "node:timers/promises";
import { freshPasskeySession, passkeyAccess, passkeyConfiguration } from "@/lib/auth/passkey-policy";
import { SessionResolutionError } from "@/lib/auth/session-resolution";
import { accountMailConfiguration } from "@/lib/auth/account-mail";

const denied = (error: string, status: number) =>
  Response.json({ error, message: error }, { status, headers: { "cache-control": "no-store" } });

async function guardAuthenticator(request: Request, action: string | undefined) {
  const { assertSameOrigin } = await import("@/lib/mind/connectors/oauth-csrf");
  if (!assertSameOrigin(request).ok) return denied("Cross-origin request blocked.", 403);
  if (request.method !== "POST" || !action || !["enable", "disable", "verify-totp", "verify-backup-code"].includes(action)) {
    return denied("Authenticator action unavailable.", 404);
  }
  const { readJsonObjectBody } = await import("@/lib/mind/request-body");
  const parsed = await readJsonObjectBody(request.clone(), 4096);
  if (!parsed.ok) return denied(parsed.error, parsed.status);
  if (parsed.body.trustDevice === true || parsed.body.disableSession === true) return denied("This sign-in requires an authenticator or recovery code every time.", 400);
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const canonical = await getSessionUser();
  if (!canonical && action.startsWith("verify-")) return null;
  const { auth } = await import("@/lib/auth/server");
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!canonical || !session || session.user.id !== canonical.id) return denied("Sign in with the account that owns this authenticator.", 401);
  if (!freshPasskeySession(session.session.createdAt)) return denied("Sign in again before changing your authenticator.", 403);
  if (action === "verify-backup-code") return denied("Sign out before using a recovery code to sign in.", 409);
  return null;
}

async function guardAccountMail(request: Request, url: URL, action: string) {
  const config = accountMailConfiguration(process.env);
  if (!config || config.origin !== url.origin) return denied("Account email is unavailable from this origin.", 403);
  if (action === "verify-email" && request.method === "GET") {
    return url.searchParams.get("callbackURL") === config.origin + "/?section=settings&pane=sessions"
      ? null : denied("The verification link destination is invalid.", 400);
  }
  if (request.method !== "POST" || !["request-password-reset", "reset-password", "send-verification-email"].includes(action)) {
    return denied("Account email action unavailable.", 404);
  }
  const { assertSameOrigin } = await import("@/lib/mind/connectors/oauth-csrf");
  if (!assertSameOrigin(request).ok) return denied("Cross-origin request blocked.", 403);
  const { readJsonObjectBody } = await import("@/lib/mind/request-body");
  const parsed = await readJsonObjectBody(request.clone(), 4096);
  if (!parsed.ok) return denied(parsed.error, parsed.status);
  if (action === "request-password-reset" && parsed.body.redirectTo !== undefined) return denied("Account recovery uses the configured sign-in page.", 400);
  if (action === "send-verification-email") {
    const { getSessionUser } = await import("@/lib/auth/verify.server");
    const { auth } = await import("@/lib/auth/server");
    const canonical = await getSessionUser();
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    if (!canonical || !session || canonical.id !== session.user.id || parsed.body.email !== session.user.email) {
      return denied("Sign in to verify the email address on this account.", 401);
    }
    const accounts = await auth.api.listUserAccounts({ headers: request.headers });
    if (!accounts.some(account => account.providerId === "credential")) return denied("Verify this email with your account provider.", 409);
  }
  return null;
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return "AUTH_HANDLER_FAILURE";
}

async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const accountMailRoute = /^\/api\/auth\/(request-password-reset|reset-password|send-verification-email|verify-email)(?:\/.*)?$/i.exec(pathname);
    if (accountMailRoute) {
      if (pathname !== "/api/auth/" + accountMailRoute[1]) return denied("Account email action unavailable.", 404);
      const rejection = await guardAccountMail(request, url, accountMailRoute[1]);
      if (rejection) return rejection;
    }
    const authenticatorRoute = /^\/api\/auth\/two-factor(?:\/(.*))?$/i.exec(pathname);
    if (authenticatorRoute) {
      const rejection = await guardAuthenticator(request, authenticatorRoute[1]);
      if (rejection) return rejection;
    }
    const passkeyRoute = passkeyAccess(url.pathname);
    if (passkeyRoute) {
      const config = passkeyConfiguration(process.env);
      const { assertSameOrigin } = await import("@/lib/mind/connectors/oauth-csrf");
      if (!config || config.origin !== url.origin || !assertSameOrigin(request).ok) return denied("Passkeys are unavailable from this origin.", 403);
      if (passkeyRoute === "unknown") return denied("Passkey action unavailable.", 404);
      if (passkeyRoute !== "sign-in") {
        const { getSessionUser } = await import("@/lib/auth/verify.server");
        const { auth } = await import("@/lib/auth/server");
        const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const owner = await getSessionUser(bearer);
        const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
        if (!owner || !session || session.user.id !== owner.id) return denied("Sign in with the account that owns these passkeys.", 401);
        if (passkeyRoute === "change" && !freshPasskeySession(session.session.createdAt)) {
          return denied("Sign in again before changing passkeys.", 403);
        }
      }
    }
    if (request.method === "GET" && url.pathname.endsWith("/api/auth/owner")) {
      const { getSessionUser, isLoopbackPreview } = await import("@/lib/auth/verify.server");
      const authorization = request.headers.get("authorization");
      const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
      const user = isLoopbackPreview() ? { id: "dev-user", email: null } : await getSessionUser(bearer);
      return Response.json({ user }, { headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/auth/owner-sign-out")) {
      const { assertSameOrigin } = await import("@/lib/mind/connectors/oauth-csrf");
      const origin = assertSameOrigin(request);
      if (!origin.ok) return Response.json({ error: origin.error }, { status: 403 });
      const { readSupabaseEnv, createSupabaseServerClient } = await import("@/lib/supabase/server");
      if (readSupabaseEnv()) {
        const result = await createSupabaseServerClient().auth.signOut();
        if (result.error) return Response.json({ error: "The account session could not be ended. Retry sign out." }, { status: 503 });
      }
      return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    }
    const { auth } = await import("@/lib/auth/server");
    if (pathname !== "/api/auth/request-password-reset") return await auth.handler(request);
    const started = Date.now();
    const result = await auth.handler(request);
    // Cover both the account lookup and the bounded mail delivery attempt.
    await delay(Math.max(0, 5500 - (Date.now() - started)));
    return result;
  } catch (error) {
    if (error instanceof SessionResolutionError) return denied(error.message, error.status);
    if (error instanceof Error && error.name === "SessionConflictError") return Response.json({ user: null, error: error.message, code: "ACCOUNT_CONFLICT" }, { status: 409, headers: { "cache-control": "no-store" } });
    console.error("Authentication handler failed", { code: safeErrorCode(error) });
    return new Response("Unable to process authentication request.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
