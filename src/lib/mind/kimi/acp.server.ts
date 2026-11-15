import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listJobEvents, onlineAgents, readJob } from "../pc-pairing/store";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adrianBuildCommand, adrianHostedWorkspace, closeHostedCodingSession, packageLabel, resolveBuildWorkspace, runCodingTurn, runHostedPrompt, type CodingMode } from "./hosted/acp-client.ts";
import { snapshotHostedWorkspace } from "./hosted/shell.server.ts";
import { recordKimiAttempt } from "./persist.ts";

const MAX_PROMPT = 8_000;
const MAX_CWD = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function safeRead(path: string): string {
  try { return readFileSync(path, "utf8").slice(0, 20_000); } catch { return ""; }
}

function fileChange(workspace: string, prompt: string): { path: string; before: string; after: string }[] {
  const match = prompt.match(/([A-Za-z0-9._/-]+\.(?:md|txt|json|ts|tsx|js|py|css))/i);
  const relative = match?.[1]?.replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return [];
  const path = join(workspace, relative);
  if (!path.startsWith(`${workspace}/`) && path !== workspace) return [];
  const before = safeRead(path);
  return [{ path: relative, before, after: before }];
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
      const body = (await request.json().catch(() => ({}))) as { prompt?: unknown; cwd?: unknown; mode?: unknown; resumeSessionId?: unknown; fork?: unknown; action?: unknown };
      if ((body as { action?: unknown }).action === "close") {
        const sessionId = typeof body.resumeSessionId === "string" ? body.resumeSessionId.trim().slice(0, 80) : "";
        if (!sessionId) return json({ ok: false, error: "session id is required to close the coding process." }, 400);
        return json({ ok: true, closed: closeHostedCodingSession(sessionId), sessionId });
      }
      if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. No Kimi session was queued." }, 403);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT) : "";
      if (!prompt) return json({ ok: false, error: "prompt is required." }, 400);
      const requestedCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim().slice(0, MAX_CWD) : undefined;
      const cwd = resolveBuildWorkspace(requestedCwd);
      const mode = body.mode === "plan" || body.mode === "auto" || body.mode === "yolo" || body.mode === "default" ? body.mode as CodingMode : undefined;
      const resumeSessionId = typeof body.resumeSessionId === "string" ? body.resumeSessionId.trim().slice(0, 80) : "";
      const agents = onlineAgents(ownerId);
      if (agents.length === 0) {
        if (mode || resumeSessionId || body.fork === true) {
          const workspace = cwd || adrianHostedWorkspace();
          const checkpoint = snapshotHostedWorkspace();
          const watched = fileChange(workspace, prompt);
          const turn = await runCodingTurn({ prompt, cwd: workspace, mode, resumeSessionId: resumeSessionId || undefined, fork: body.fork === true });
          const filesChanged = watched.flatMap((item) => {
            const after = safeRead(join(workspace, item.path));
            return item.before === after ? [] : [{ ...item, after }];
          });
          await recordKimiAttempt({ ownerId, status: turn.ok ? "session_created" : "failed", error: turn.error });
          return json({
            ok: turn.ok,
            executed: turn.ok,
            error: turn.ok ? undefined : turn.error || "The coding package did not finish the task.",
            output: turn.output || "",
            sessionId: turn.sessionId,
            mode: turn.mode,
            resumed: turn.resumed,
            forkedSessionId: turn.forkedSessionId,
            mcpServers: turn.mcpServers,
            package: packageLabel(turn.command),
            loginRequired: false,
            processAlive: turn.processAlive === true,
            reused: turn.reused === true,
            clientCalls: turn.clientCalls || [],
            processNote: turn.processNote || "",
            filesChanged,
            workspace,
            checkpoint,
          }, turn.ok ? 200 : 409);
        }
        const hosted = await runHostedPrompt(prompt, adrianBuildCommand(), cwd || adrianHostedWorkspace());
        await recordKimiAttempt({ ownerId, status: hosted.status, error: hosted.error });
        const accepted = hosted.status === "session_created";
        return json({
          ok: accepted,
          executed: accepted,
          loginRequired: hosted.status === "authentication_required",
          error: accepted ? undefined : hosted.error || "The coding package did not accept the task. No extra login is requested.",
          runtime: hosted.status,
          version: hosted.version,
          agent: hosted.agentName,
          output: hosted.output || "",
          package: packageLabel(hosted.command),
        }, accepted ? 200 : hosted.status === "not_configured" ? 503 : 409);
      }
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
        eventsUrl: `/api/mind/build/session?jobId=${encodeURIComponent(job.id)}`,
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
