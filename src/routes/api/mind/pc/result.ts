import { createFileRoute } from "@tanstack/react-router";
import { completeJob, findAgentByToken } from "@/lib/mind/pc-pairing/coordination.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization");
        const token = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
        if (!token) return json({ ok: false, error: "Agent token required." }, 401);
        const agent = await findAgentByToken(token);
        if (!agent) return json({ ok: false, error: "Unknown agent token." }, 401);
        const body = (await request.json().catch(() => ({}))) as {
          jobId?: string;
          ok?: boolean;
          cancelled?: boolean;
          receiptId?: string;
          output?: string;
          error?: string;
        };
        if (typeof body.ok !== "boolean") return json({ ok: false, error: "An explicit execution result is required." }, 400);
        if (!body.jobId) return json({ ok: false, error: "jobId required." }, 400);
        const job = await completeJob({
          jobId: body.jobId,
          agentId: agent.id,
          ok: body.ok,
          cancelled: body.cancelled === true,
          receiptId: typeof body.receiptId === "string" ? body.receiptId : undefined,
          output: typeof body.output === "string" ? body.output : "",
          error: typeof body.error === "string" ? body.error : "",
        });
        if (!job) return json({ ok: false, error: "Job not found for this agent." }, 404);
        return json({ ok: true, status: job.status, lateOutcome: job.lateOutcome ?? null });
      },
    },
  },
});
