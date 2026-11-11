import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { appendJobEvent, findAgentByToken, listJobEvents, readJob } from "@/lib/mind/pc-pairing/store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/mind/pc/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const agent = findAgentByToken(bearer(request));
        if (!agent) return json({ ok: false, error: "Unknown agent token." }, 401);
        const body = (await request.json().catch(() => ({}))) as { jobId?: unknown; type?: unknown; payload?: unknown };
        const jobId = typeof body.jobId === "string" ? body.jobId : "";
        const type = typeof body.type === "string" ? body.type : "";
        const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {};
        if (!jobId || !type) return json({ ok: false, error: "jobId and type are required." }, 400);
        if (JSON.stringify(payload).length > 50_000) return json({ ok: false, error: "Event payload is too large." }, 413);
        const event = appendJobEvent({ jobId, agentId: agent.id, type, payload });
        if (!event) return json({ ok: false, error: "Kimi job not found for this agent." }, 404);
        return json({ ok: true, eventId: event.id });
      },
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const token = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const ownerId = await requireUserId(token);
          const jobId = new URL(request.url).searchParams.get("jobId") || "";
          const job = readJob(jobId);
          if (!job || job.ownerId !== ownerId) return json({ ok: false, error: "Kimi job not found." }, 404);
          return json({ ok: true, events: listJobEvents(ownerId, jobId) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
