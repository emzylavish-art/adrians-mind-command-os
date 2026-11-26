import { runHostedFileOperation } from "./hosted-files.server.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listJobEvents, onlineAgents, readJob } from "../pc-pairing/coordination.server.ts";

const MAX_CWD = 500;
const MAX_PATH = 1_000;
const MAX_CONTENT = 1_000_000;
const OPERATIONS = new Set(["list", "read", "write", "search", "rename", "delete"]);
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
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
      const body = (await request.json().catch(() => ({}))) as { operation?: unknown; cwd?: unknown; path?: unknown; content?: unknown; to?: unknown; query?: unknown; confirm?: unknown; expectedContent?: unknown; expectedMissing?: unknown; expectedRevision?: unknown; workspace?: unknown; action?: unknown; expectedSnapshot?: unknown; cursor?: unknown; directory?: unknown };
      const agents = await onlineAgents(ownerId);
      const requested = body.workspace;
      if (requested !== undefined && (typeof requested !== "string" || !requested)) return json({ ok: false, error: "Invalid workspace." }, 400);
      if (requested === undefined && agents.length > 1) return json({ ok: false, error: "Choose the computer that owns this workspace. No alternate was selected." }, 409);
      const agent = requested === undefined ? agents[0] : agents.find((item) => item.id === requested);
      if (requested !== undefined && requested !== "hosted" && !agent) {
        return json({ ok: false, error: "The PC that owns this file is offline. Reconnect it to continue." }, 409);
      }
      if (!agent) {
        if (body.cwd && requested !== "hosted") return json({ ok: false, error: "Reconnect the PC that owns this workspace path." }, 409);
        const response = await runHostedFileOperation(body, ownerId);
        response.headers.set("X-Mind-Workspace", "hosted");
        return response;
      }
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

      if ((body.expectedContent !== undefined || body.expectedMissing === true || body.expectedRevision !== undefined) && agent.fileProtocol !== 2) {
        return json({ ok: false, error: "Update the paired companion before changing a reviewed file." }, 409);
      }
      if ((operation === "rename" || operation === "delete") && typeof body.expectedRevision !== "string") {
        return json({ ok: false, error: "Read the file again before confirming this change." }, 409);
      }
      if (operation === "write" && body.expectedMissing !== true && typeof body.expectedContent !== "string" && typeof body.expectedRevision !== "string") return json({ ok: false, error: "Read the file before saving, or explicitly create a missing file." }, 409);
      const job = await enqueueJob({ ownerId, agentId: agent.id, kind: "file-op", command: `file:${operation}`, confirm: false, payload: { operation, cwd, path, content, to, query, expectedContent: body.expectedContent, expectedRevision: body.expectedRevision, expectedMissing: body.expectedMissing === true, confirm: body.confirm === true } });
      return json({ ok: true, jobId: job.id, workspace: agent.id, status: job.status, operation }, 202);
    }
    if (request.method === "GET") {
      const jobId = new URL(request.url).searchParams.get("jobId") || "";
      const job = await readJob(jobId);
      if (!job || job.ownerId !== ownerId || job.kind !== "file-op") return json({ ok: false, error: "File operation not found." }, 404);
      return json({ ok: true, job: { id: job.id, status: job.status, output: job.output || "", error: job.error || "", createdAt: job.createdAt, updatedAt: job.updatedAt }, events: await listJobEvents(ownerId, job.id) });
    }
    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
}
