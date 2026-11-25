import { machineRequired } from "./account-workspace.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, onlineAgents, readJob } from "../pc-pairing/store";
import { KIMI_CAPABILITIES, capabilitySummary } from "./capabilities";
import { archiveProject, listAudit, listProjects, listProviders, listSessions, saveProject, saveProvider, saveSessionMeta } from "./build-store";
import { adrianHostedWorkspace, packageLabel, resolveBuildWorkspace, runCodingTurn } from "./hosted/acp-client.ts";
import { recordKimiAttempt } from "./persist.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function owner(request: Request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Unauthorized";
  return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
}

export async function handleKimiCapabilities(request: Request): Promise<Response> {
  try {
    await owner(request);
    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
    return json({ ok: true, capabilities: KIMI_CAPABILITIES, summary: capabilitySummary(), runtimeVerified: false });
  } catch (error) { return fail(error); }
}

export async function handleKimiProjects(request: Request): Promise<Response> {
  try {
    const ownerId = await owner(request);
    if (request.method === "GET") return json({ ok: true, projects: listProjects(ownerId), sessions: listSessions(ownerId), audit: listAudit(ownerId) });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
    const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string; label?: string; cwd?: string; instructions?: string; jobId?: string; name?: string; archived?: boolean };
    if (body.action === "archive") {
      const ok = archiveProject(ownerId, body.id || "");
      return json({ ok, error: ok ? undefined : "Project not found." }, ok ? 200 : 404);
    }
    if (body.action === "session") {
      const job = readJob(body.jobId || "");
      if (!job || job.ownerId !== ownerId) return json({ ok: false, error: "Session not found." }, 404);
      return json({ ok: true, session: saveSessionMeta({ ownerId, jobId: job.id, name: body.name, archived: body.archived }) });
    }
    return json({ ok: true, project: saveProject({ ownerId, id: body.id, label: body.label || "", cwd: body.cwd || "", instructions: body.instructions }) });
  } catch (error) { return fail(error); }
}

export async function handleKimiProviders(request: Request): Promise<Response> {
  try {
    const ownerId = await owner(request);
    if (request.method === "GET") return json({ ok: true, providers: listProviders(ownerId), limitation: "Saved keys are encrypted and are not injected into Kimi. Kimi still uses its local CLI login." });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
    const body = (await request.json().catch(() => ({}))) as { label?: string; model?: string; baseUrl?: string; apiKey?: string };
    const provider = saveProvider({ ownerId, label: body.label, model: body.model || "", baseUrl: body.baseUrl, apiKey: body.apiKey });
    return json({ ok: true, provider }, 201);
  } catch (error) { return fail(error); }
}

export async function handleKimiVoice(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = assertSameOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  try {
    const ownerId = await owner(request);
    if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. Voice task was not queued." }, 403);
    const agent = onlineAgents(ownerId)[0];
    const body = (await request.json().catch(() => ({}))) as { transcript?: string; cwd?: string; instructions?: string };
    const transcript = body.transcript?.trim().slice(0, 4_000) || "";
    if (!transcript) return json({ ok: false, error: "transcript is required." }, 400);
    const instructions = body.instructions?.trim().slice(0, 2_000) || "";
    const prompt = `${instructions ? `Project instructions:\n${instructions}\n\n` : ""}[Adrian Speak transcript]\n${transcript}`;
    if (!agent) {
      if (ownerId !== "dev-user") return json({ ok: false, executed: false, error: machineRequired }, 409);
      const workspace = resolveBuildWorkspace(body.cwd) || adrianHostedWorkspace();
      const turn = await runCodingTurn({ prompt, cwd: workspace, mode: "auto" });
      await recordKimiAttempt({ ownerId, status: turn.ok ? "session_created" : "failed", error: turn.error });
      return json({ ok: turn.ok, executed: turn.ok, output: turn.output || "", sessionId: turn.sessionId, package: packageLabel(turn.command), limitation: "Audio was not sent to Kimi. The transcript ran in the hosted Build workspace." }, turn.ok ? 200 : 409);
    }
    const job = enqueueJob({ ownerId, agentId: agent.id, kind: "kimi-acp", command: "kimi acp", confirm: false, payload: { prompt, cwd: body.cwd?.trim().slice(0, 500) || undefined, source: "adrian-speak" } });
    return json({ ok: true, jobId: job.id, status: job.status, limitation: "Audio was not sent to Kimi. The transcript uses the same Build session queue." }, 202);
  } catch (error) { return fail(error); }
}
