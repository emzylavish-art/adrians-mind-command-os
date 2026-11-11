import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listJobEvents, onlineAgents, readJob } from "../pc-pairing/store";

const MAX_CWD = 500;
const MAX_PATH = 1_000;
const MAX_CONTENT = 1_000_000;
const OPERATIONS = new Set(["list", "read", "write", "search", "rename", "delete"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function ownerIdFromRequest(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

export async function handleKimiFiles(request: Request): Promise<Response> {
  try {
    const ownerId = await ownerIdFromRequest(request);
    if (request.method === "POST") {
      const origin = assertSameOrigin(request);
      if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
      if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. No file operation was queued." }, 403);
      const agents = onlineAgents(ownerId);
      if (!agents.length) return json({ ok: false, error: "No paired Windows Companion is online." }, 409);
      const body = (await request.json().catch(() => ({}))) as { operation?: unknown; cwd?: unknown; path?: unknown; content?: unknown; to?: unknown; query?: unknown; confirm?: unknown };
      const operation = typeof body.operation === "string" ? body.operation : "";
      if (!OPERATIONS.has(operation)) return json({ ok: false, error: "Unsupported file operation." }, 400);
      const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim().slice(0, MAX_CWD) : undefined;
      const path = typeof body.path === "string" ? body.path.slice(0, MAX_PATH) : undefined;
      const content = typeof body.content === "string" ? body.content : undefined;
      const to = typeof body.to === "string" ? body.to.slice(0, MAX_PATH) : undefined;
      const query = typeof body.query === "string" ? body.query.slice(0, 200) : undefined;
      if ((operation === "read" || operation === "write" || operation === "rename" || operation === "delete") && !path) return json({ ok: false, error: "path is required." }, 400);
      if (operation === "rename" && !to) return json({ ok: false, error: "to is required." }, 400);
      if (operation === "search" && !query) return json({ ok: false, error: "query is required." }, 400);
      if ((operation === "rename" || operation === "delete") && body.confirm !== true) return json({ ok: false, error: "Explicit confirmation is required. Nothing changed." }, 400);
      if (operation === "write" && (content === undefined || content.length > MAX_CONTENT)) return json({ ok: false, error: "content is required and must be at most 1 MB." }, 400);
      const agent = agents[0];
      const job = enqueueJob({ ownerId, agentId: agent.id, kind: "file-op", command: `file:${operation}`, confirm: false, payload: { operation, cwd, path, content, to, query, confirm: body.confirm === true } });
      return json({ ok: true, jobId: job.id, status: job.status, operation }, 202);
    }
    if (request.method === "GET") {
      const jobId = new URL(request.url).searchParams.get("jobId") || "";
      const job = readJob(jobId);
      if (!job || job.ownerId !== ownerId || job.kind !== "file-op") return json({ ok: false, error: "File operation not found." }, 404);
      return json({ ok: true, job: { id: job.id, status: job.status, output: job.output || "", error: job.error || "", createdAt: job.createdAt, updatedAt: job.updatedAt }, events: listJobEvents(ownerId, job.id) });
    }
    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
}
