import { haltIsOn } from "@/lib/mind/halt.server";
import { createFileRoute } from "@tanstack/react-router";
import { acceptJob, claimNextJob, findAgentByToken, offerNextJob, readJob, recordCapabilities, recordFileProtocol, touchAgent } from "@/lib/mind/pc-pairing/coordination.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function authenticate(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match ? await findAgentByToken(match[1]) : null;
}

export const Route = createFileRoute("/api/mind/pc/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const agent = await authenticate(request);
        if (!agent) return json({ ok: false, error: "Valid agent token required." }, 401);
        const body = await request.json().catch(() => null);
        if (body?.action === "heartbeat") {
          const saved = await recordCapabilities(agent.id, body.capabilities);
          if (!saved) return json({ ok: false, error: "A valid explicit device capability manifest is required." }, 400);
          await touchAgent(agent.id);
          return json({ ok: true, capabilitiesRecorded: true });
        }
        if (typeof body?.jobId !== "string" || typeof body.receiptId !== "string" || !/^[a-f0-9]{32}$/.test(body.receiptId)) {
          return json({ ok: false, error: "A job ID and delivery receipt are required." }, 400);
        }
        if (await haltIsOn(agent.ownerId)) return json({ ok: false, error: "Emergency stop is on or unavailable." }, 423);
        const job = await acceptJob(agent.id, body.jobId, body.receiptId);
        if (!job) return json({ ok: true, accepted: false });
        return json({ ok: true, accepted: true, status: job.status });
      },
      GET: async ({ request }) => {
        const agent = await authenticate(request);
        if (!agent) return json({ ok: false, error: "Valid agent token required." }, 401);
        await touchAgent(agent.id);
        const requestedJobId = new URL(request.url).searchParams.get("jobId");
        if (requestedJobId) {
          const job = await readJob(requestedJobId);
          if (!job || job.agentId !== agent.id) return json({ ok: false, error: "Job not found." }, 404);
          return json({ ok: true, job: { id: job.id, kind: job.kind, status: job.status, error: job.error || "" } });
        }
        if (await haltIsOn(agent.ownerId)) {
          return json({ ok: true, job: null, detail: "Emergency stop is on or unavailable. Job stayed queued." });
        }
        const offer = new URL(request.url).searchParams.get("delivery") === "offer";
        await recordFileProtocol(agent.id, offer);
        const job = offer ? await offerNextJob(agent.id) : await claimNextJob(agent.id);
        if (!job) return json({ ok: true, job: null });
        return json({
          ok: true,
          offered: offer,
          job: {
            id: job.id,
            kind: job.kind,
            payload: job.payload ?? {},
            command: job.command,
            confirm: job.confirm,
            createdAt: job.createdAt,
          },
        });
      },
    },
  },
});
