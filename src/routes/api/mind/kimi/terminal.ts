import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { haltIsOn } from "@/lib/mind/halt.server";
import { createPcApproval } from "@/lib/mind/pc-pairing/approvals";
import { onlineAgents } from "@/lib/mind/pc-pairing/store";
import { createHostedTerminalApproval, runHostedTerminal } from "@/lib/mind/kimi/hosted/shell.server.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/mind/kimi/terminal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const ownerId = await requireUserId(bearer);
          if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. Terminal approval was not created." }, 403);
          const agent = onlineAgents(ownerId)[0];
          const body = (await request.json().catch(() => ({}))) as { command?: unknown; confirm?: unknown; approvalId?: unknown; token?: unknown };
          const command = typeof body.command === "string" ? body.command.trim().slice(0, 500) : "";
          if (!command) return json({ ok: false, error: "command is required." }, 400);
          if (!agent) {
            if (body.confirm === true) {
              const result = await runHostedTerminal({
                id: typeof body.approvalId === "string" ? body.approvalId : "",
                token: typeof body.token === "string" ? body.token : "",
                command,
              });
              return json({ ok: result.ok, text: result.text, error: result.error, hosted: true }, result.ok ? 200 : 400);
            }
            return json({ ok: true, hosted: true, approval: createHostedTerminalApproval(command) }, 202);
          }
          const approval = createPcApproval({ ownerId, command, agentId: agent.id, agentLabel: agent.label });
          return json({ ok: true, approval: { id: approval.id, token: approval.token, command: approval.command, agentId: approval.agentId, agentLabel: approval.agentLabel, expiresAt: approval.expiresAt, status: approval.status } }, 202);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
