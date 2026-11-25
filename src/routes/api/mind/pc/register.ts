import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { findAgentByToken, registerAgent, unregisterAgent } from "@/lib/mind/pc-pairing/store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/register")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        try {
          const bearer = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
          const query = new URL(request.url).searchParams;
          if (query.get("self") === "1") {
            const agent = bearer && findAgentByToken(bearer);
            if (!agent) return json({ ok: false, error: "Valid agent token required." }, 401);
            return json({ ok: unregisterAgent(agent.ownerId, agent.id) });
          }
          const ownerId = await requireUserId(bearer);
          const id = query.get("agentId") ?? "";
          if (!unregisterAgent(ownerId, id)) return json({ ok: false, error: "Agent not found." }, 404);
          return json({ ok: true });
        } catch {
          return json({ ok: false, error: "Sign in is required." }, 401);
        }
      },
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const body = (await request.json().catch(() => ({}))) as { label?: string; pairingSecret?: string };
          const result = registerAgent({
            ownerId: userId,
            label: typeof body.label === "string" ? body.label : undefined,
            pairingSecret: typeof body.pairingSecret === "string" ? body.pairingSecret : undefined,
            expectedPairingSecret: process.env.MIND_PC_PAIRING_SECRET,
          });
          if (!result.ok) return json(result, 403);
          return json({
            ok: true,
            agentId: result.agentId,
            agentToken: result.agentToken,
            label: result.label,
            pollUrl: "/api/mind/pc/jobs",
            resultUrl: "/api/mind/pc/result",
            note: "Store agentToken on the PC agent only. It is shown once.",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
