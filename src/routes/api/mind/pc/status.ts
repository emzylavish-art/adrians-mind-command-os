import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { listAgents, onlineAgents } from "@/lib/mind/pc-pairing/store";
import { adrianPcEnabled, runAdrianPc } from "@/lib/mind/adrian-pc.server";
import { haltIsOn } from "@/lib/mind/halt.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const agents = listAgents(userId).map((a) => ({
            id: a.id,
            label: a.label,
            registeredAt: a.registeredAt,
            lastSeenAt: a.lastSeenAt,
          }));
          const online = onlineAgents(userId).map((a) => a.id);
          return json({
            ok: true,
            agents,
            onlineAgentIds: online,
            detail: online.length
              ? `${online.length} paired PC agent(s) online.`
              : "No paired PC online. Register an agent via POST /api/mind/pc/register, then poll /api/mind/pc/jobs.",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          if (!adrianPcEnabled()) {
            return json({ ok: false, ran: false, error: "This website cannot control the PC. Open the installed Adrian's Mind app." }, 409);
          }
          const body = await request.json().catch(() => null) as { text?: unknown } | null;
          const text = typeof body?.text === "string" ? body.text : "";
          const halted = await haltIsOn(userId);
          const result = await runAdrianPc({ text, halted });
          return json({ ok: true, ran: result.ran, output: result.output });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
