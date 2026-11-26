import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { deviceReadiness, listAgents, onlineAgents } from "@/lib/mind/pc-pairing/coordination.server";
import { adrianPcEnabled, runAdrianPc } from "@/lib/mind/adrian-pc.server";
import { ownerScreenshotReader } from "@/lib/mind/pc-vision.server";
import { haltIsOn, readHaltState } from "@/lib/mind/halt.server";

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
          const agents = (await listAgents(userId)).map((a) => ({
            id: a.id,
            label: a.label,
            registeredAt: a.registeredAt,
            lastSeenAt: a.lastSeenAt,
            readiness: deviceReadiness(a),
            capabilities: a.capabilities ?? null,
            legacyFileProtocol: a.fileProtocol ?? null,
          }));
          const online = (await onlineAgents(userId)).map((a) => a.id);
          return json({
            ok: true,
            stopState: await readHaltState(userId),
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
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
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
          const result = await runAdrianPc({ text, halted, readImage: ownerScreenshotReader(userId) });
          return json({ ok: true, ran: result.ran, output: result.output });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
