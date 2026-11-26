import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { auth } from "@/lib/auth/server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { publicSessionRows, sessionToRevoke } from "@/lib/auth/session-center";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function current(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const owner = await requireUserId(bearer);
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session || session.user.id !== owner) return null;
  return { owner, session, rows: await auth.api.listSessions({ headers: request.headers }) };
}
export const Route = createFileRoute("/api/mind/sessions")({ server: { handlers: {
  GET: async ({ request }) => { try { const result = await current(request); return result ? reply({ ok: true, source: "Better Auth", sessions: publicSessionRows(result.rows, result.owner, result.session.session.id) }) : reply({ ok: false, error: "This account’s sign-in provider does not expose device sessions through Adrian. Manage sessions with that provider. No device list was inferred." }, 409); } catch (error) { return reply({ ok: false, error: error instanceof Error ? error.message : "Session verification is unavailable." }, sessionErrorStatus(error)); } },
  POST: async ({ request }) => {
    const origin = assertSameOrigin(request); if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
    try {
      const raw = await request.text(); if (raw.length > 1000) return reply({ ok: false, error: "Invalid session action." }, 413);
      const body = JSON.parse(raw); if (body.action !== "revoke" || typeof body.id !== "string") return reply({ ok: false, error: "Select a session to revoke." }, 400);
      const result = await current(request); if (!result) return reply({ ok: false, error: "Session ownership could not be verified." }, 409);
      const selected = sessionToRevoke(result.rows, result.owner, body.id, result.session.session.id); if (!selected.ok) return reply(selected, 409);
      await auth.api.revokeSession({ headers: request.headers, body: { token: selected.token } });
      return reply({ ok: true, revokedId: body.id });
    } catch (error) { return reply({ ok: false, error: error instanceof Error ? error.message : "The session was not revoked." }, sessionErrorStatus(error)); }
  },
} } });
