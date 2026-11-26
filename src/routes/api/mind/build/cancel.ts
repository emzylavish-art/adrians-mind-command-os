import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { requestJobCancel, readJob } from "@/lib/mind/pc-pairing/coordination.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/mind/build/cancel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const ownerId = await requireUserId(bearer);
          const body = (await request.json().catch(() => ({}))) as { jobId?: unknown };
          const jobId = typeof body.jobId === "string" ? body.jobId : "";
          const existing = await readJob(jobId);
          if (!existing || existing.ownerId !== ownerId || existing.kind !== "kimi-acp") return json({ ok: false, error: "Kimi job not found." }, 404);
          const job = await requestJobCancel(ownerId, jobId);
          if (!job) return json({ ok: false, error: "This Kimi job is already settled." }, 409);
          return json({ ok: true, jobId: job.id, status: job.status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
