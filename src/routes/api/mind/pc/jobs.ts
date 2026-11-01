import { createFileRoute } from "@tanstack/react-router";
import { claimNextJob, findAgentByToken } from "@/lib/mind/pc-pairing/store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorization = request.headers.get("authorization");
        const token = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
        if (!token) return json({ ok: false, error: "Agent token required." }, 401);
        const agent = findAgentByToken(token);
        if (!agent) return json({ ok: false, error: "Unknown agent token." }, 401);
        const job = claimNextJob(agent.id);
        if (!job) return json({ ok: true, job: null });
        return json({
          ok: true,
          job: { id: job.id, command: job.command, confirm: job.confirm, createdAt: job.createdAt },
        });
      },
    },
  },
});
