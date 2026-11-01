import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { registerAgent } from "@/lib/mind/pc-pairing/store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
