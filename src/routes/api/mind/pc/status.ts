import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { listAgents, onlineAgents } from "@/lib/mind/pc-pairing/store";
import { adrianPcEnabled, runAdrianPc } from "@/lib/mind/adrian-pc.server";
import { currentLocalDestination } from "@/lib/mind/native-policy.server";
import { PC_CAPABILITIES } from "@/lib/mind/pc-capability";
import { clientPlatformAvailability } from "@/lib/mind/client-runtime-contract";
import type { VisionPolicy } from "@/lib/mind/pc-vision";
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
          const agents = listAgents(userId).map((a) => ({
            id: a.id,
            label: a.label,
            registeredAt: a.registeredAt,
            lastSeenAt: a.lastSeenAt,
          }));
          const online = onlineAgents(userId).map((a) => a.id);
          return json({
            ok: true,
            stopState: await readHaltState(userId),
            agents,
            localExecution: currentLocalDestination(),
            capabilities: PC_CAPABILITIES,
            clients: ["web", "windows", "ios", "android"].map(surface => clientPlatformAvailability(surface as "web" | "windows" | "ios" | "android")),
            onlineAgentIds: online,
            detail: online.length
              ? `${online.length} paired PC agent(s) online. This does not identify the current local executor or prove a requested operation ran.`
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
          const endpoint = new URL(request.url);
          const origin = request.headers.get("origin");
          if ((origin && origin !== endpoint.origin) || request.headers.get("sec-fetch-site") === "cross-site") return json({ ok: false, ran: false, error: "Cross-site computer requests are blocked." }, 403);
          if (!adrianPcEnabled() || !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
            return json({ ok: false, ran: false, error: "This website cannot control the PC. Open the installed Adrian's Mind app." }, 409);
          }
          const body = await request.json().catch(() => null) as { text?: unknown; destination?: unknown; visionPolicy?: VisionPolicy } | null;
          const text = typeof body?.text === "string" ? body.text : "";
          if (body?.destination !== "current-device") return json({ ok: false, ran: false, error: "Choose the current installed device explicitly. A paired online PC is not automatically selected.", localExecution: currentLocalDestination() }, 409);
          if (!text.trim() || text.length > 24000) return json({ ok: false, ran: false, error: "A bounded computer request is required." }, 400);
          const halted = await haltIsOn(userId);
          const result = await runAdrianPc({ text, halted, recheckHalt: () => haltIsOn(userId), visionPolicy: body?.visionPolicy, signal: request.signal });
          return json({ ok: result.completed, ...result }, result.completed ? 200 : result.state === "blocked" ? 409 : 422);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
