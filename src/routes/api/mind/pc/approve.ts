import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { consumePcApproval } from "@/lib/mind/pc-pairing/approvals";
import { haltIsOn } from "@/lib/mind/halt.server";
import { runOnPairedAgent } from "@/lib/mind/pc-pairing/run";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/approve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const originCheck = assertSameOrigin(request);
          if (!originCheck.ok) return json({ ok: false, error: originCheck.error }, 403);
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          if (await haltIsOn(userId)) {
            return json({ ok: false, error: "Emergency stop is on. Approval was not consumed. Nothing ran." }, 403);
          }
          const body = (await request.json().catch(() => ({}))) as {
            approvalId?: string;
            token?: string;
            command?: string;
          };
          const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
          const token = typeof body.token === "string" ? body.token : "";
          if (!approvalId || !token) {
            return json({ ok: false, error: "approvalId and token are required." }, 400);
          }
          const consumed = consumePcApproval({
            ownerId: userId,
            approvalId,
            token,
            expectedCommand: typeof body.command === "string" ? body.command : undefined,
          });
          if (!consumed.ok) {
            return json({ ok: false, error: consumed.error }, 403);
          }
          const result = await runOnPairedAgent({
            ownerId: userId,
            agentId: consumed.record.agentId ?? undefined,
            command: consumed.record.command,
            confirm: true,
          });
          if (!result) {
            return json({
              ok: false,
              error: "Approval was consumed, but no paired PC is online. Nothing ran.",
              approvalId: consumed.record.id,
            });
          }
          return json({
            ok: result.ok,
            status: result.status,
            text: result.text,
            data: result.data,
            approvalId: consumed.record.id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json(
            { ok: false, error: message === "Unauthorized" ? "Sign in is required." : message },
            message === "Unauthorized" ? 401 : 403,
          );
        }
      },
    },
  },
});
