import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listJobEvents, onlineAgents, readJob } from "../pc-pairing/store";

const MAX_PROMPT = 8_000;
const MAX_CWD = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function ownerIdFromRequest(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

export async function handleKimiSession(request: Request): Promise<Response> {
  if (request.method === "POST") {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
    try {
      const ownerId = await ownerIdFromRequest(request);
      if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. No Kimi session was queued." }, 403);
      const agents = onlineAgents(ownerId);
      if (agents.length === 0) return json({ ok: false, error: "No paired Windows Companion is online." }, 409);
      const body = (await request.json().catch(() => ({}))) as { prompt?: unknown; cwd?: unknown };
      const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT) : "";
      if (!prompt) return json({ ok: false, error: "prompt is required." }, 400);
      const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim().slice(0, MAX_CWD) : undefined;
      const agent = agents[0];
      const job = enqueueJob({
        ownerId,
        agentId: agent.id,
        kind: "kimi-acp",
        command: "kimi acp",
        confirm: false,
        payload: { prompt, cwd },
      });
      return json({
        ok: true,
        jobId: job.id,
        agentId: agent.id,
        agentLabel: agent.label,
        status: job.status,
        eventsUrl: `/api/mind/kimi/session?jobId=${encodeURIComponent(job.id)}`,
      }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
    }
  }

  if (request.method === "GET") {
    try {
      const ownerId = await ownerIdFromRequest(request);
      const jobId = new URL(request.url).searchParams.get("jobId") || "";
      const job = readJob(jobId);
      if (!job || job.ownerId !== ownerId || job.kind !== "kimi-acp") return json({ ok: false, error: "Kimi job not found." }, 404);
      return json({
        ok: true,
        job: {
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          output: job.output || "",
          error: job.error || "",
        },
        events: listJobEvents(ownerId, job.id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
    }
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}
