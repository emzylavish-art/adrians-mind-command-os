import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { auth } from "@/lib/auth/server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { publicSessionRows, sessionToRevoke } from "@/lib/auth/session-center";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";
import { passkeyConfiguration } from "@/lib/auth/passkey-policy";
import { accountMailConfiguration } from "@/lib/auth/account-mail";
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function current(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const owner = await requireUserId(bearer);
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session || session.user.id !== owner) return null;
  return { owner, session, rows: await auth.api.listSessions({ headers: request.headers }) };
}
export const Route = createFileRoute("/api/mind/sessions")({ server: { handlers: {
  GET: async ({ request }) => {
    try {
      const result = await current(request);
      if (!result) return reply({ ok: false, error: "This account’s sign-in provider does not expose device sessions through Adrian. Manage sessions with that provider. No device list was inferred." }, 409);
      const accounts = await auth.api.listUserAccounts({ headers: request.headers });
      const credential = accounts.some(account => account.providerId === "credential");
      const origin = new URL(request.url).origin;
      return reply({
        ok: true, source: "Better Auth",
        passkeys: passkeyConfiguration(process.env)?.origin === origin,
        passwordAuthenticator: credential ? result.session.user.twoFactorEnabled === true : null,
        recoveryEmail: credential && accountMailConfiguration(process.env)?.origin === origin
          ? { address: result.session.user.email, verified: result.session.user.emailVerified } : null,
        sessions: publicSessionRows(result.rows, result.owner, result.session.session.id),
      });
    } catch (error) {
      return reply({ ok: false, error: error instanceof Error ? error.message : "Session verification is unavailable." }, sessionErrorStatus(error));
    }
  },
  POST: async ({ request }) => {
    const origin = assertSameOrigin(request); if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
    try {
      const parsed = await readJsonObjectBody(request, 1000);
      if (!parsed.ok) return reply({ ok: false, error: parsed.error }, parsed.status);
      const body = parsed.body;
      if ((body.action !== "revoke" || typeof body.id !== "string") &&
          (body.action !== "lockdown" || typeof body.currentId !== "string")) return reply({ ok: false, error: "Choose a session action." }, 400);
      const result = await current(request); if (!result) return reply({ ok: false, error: "Session ownership could not be verified." }, 409);
      if (body.action === "lockdown") {
        const currentId = result.session.session.id;
        if (body.currentId !== currentId) return reply({ ok: false, error: "The current session changed. Refresh sessions and review the action again." }, 409);
        const acknowledgement = await auth.api.revokeOtherSessions({ headers: request.headers });
        if (acknowledgement.status !== true) return reply({ ok: false, error: "The provider did not confirm session revocation. Refresh sessions before trying again." }, 503);
        const refreshed = await current(request);
        if (!refreshed || refreshed.owner !== result.owner || refreshed.session.session.id !== currentId) {
          return reply({ ok: false, error: "The provider acknowledged revocation. The current session could not be reverified." }, 409);
        }
        const sessions = publicSessionRows(refreshed.rows, result.owner, currentId);
        return reply({ ok: true, sessions, remainingOther: sessions.filter(row => !row.current).length });
      }
      if (typeof body.id !== "string") return reply({ ok: false, error: "Choose a session to revoke." }, 400);
      const selected = sessionToRevoke(result.rows, result.owner, body.id, result.session.session.id); if (!selected.ok) return reply(selected, 409);
      await auth.api.revokeSession({ headers: request.headers, body: { token: selected.token } });
      return reply({ ok: true, revokedId: body.id });
    } catch (error) { return reply({ ok: false, error: error instanceof Error ? error.message : "The session was not revoked." }, sessionErrorStatus(error)); }
  },
} } });
