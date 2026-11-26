import { buildRuntimeCapabilities } from "./runtime-capabilities.ts";
import { machineRequired } from "./account-workspace.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, onlineAgents, readJob } from "../pc-pairing/coordination.server.ts";
import { KIMI_CAPABILITIES, capabilitySummary } from "./capabilities";
import { archiveProject, listAudit, listProjects, listProviders, listSessions, saveProject, saveProvider, saveSessionMeta } from "./build-store";
import { adrianHostedWorkspace, packageLabel, resolveBuildWorkspace, runCodingTurn } from "./hosted/acp-client.ts";
import { recordKimiAttempt } from "./persist.ts";
import { runGovernedHostedCoding } from "./hosted/resource-dispatch.server.ts";

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
    const ownerId = await owner(request);
    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
    return json({ ok: true, capabilities: KIMI_CAPABILITIES, summary: capabilitySummary(), runtimeVerified: false, runtimes: buildRuntimeCapabilities(ownerId, await onlineAgents(ownerId)) });
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
      const job = await readJob(body.jobId || "");
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
    const agents = await onlineAgents(ownerId);
    const body = (await request.json().catch(() => ({}))) as { transcript?: string; cwd?: string; instructions?: string; agentId?: string };
    if (body.agentId === undefined && agents.length > 1) return json({ ok: false, error: "Choose a computer before submitting the voice task. No alternate was selected." }, 409);
    const agent = body.agentId === "hosted" ? undefined : body.agentId === undefined ? agents[0] : agents.find((item) => item.id === body.agentId);
    if (body.agentId !== undefined && body.agentId !== "hosted" && !agent) return json({ ok: false, error: "The selected computer is unavailable. No alternate was selected." }, 409);
    const transcript = body.transcript?.trim().slice(0, 4_000) || "";
    if (!transcript) return json({ ok: false, error: "transcript is required." }, 400);
    const instructions = body.instructions?.trim().slice(0, 2_000) || "";
    const prompt = `${instructions ? `Project instructions:\n${instructions}\n\n` : ""}[Adrian Speak transcript]\n${transcript}`;
    if (!agent) {
      if (ownerId !== "dev-user") return json({ ok: false, executed: false, error: machineRequired }, 409);
      const workspace = resolveBuildWorkspace(body.cwd) || adrianHostedWorkspace();
      const { result: turn, resourceReceipt } = await runGovernedHostedCoding(ownerId,
        () => runCodingTurn({ prompt, cwd: workspace, mode: "auto" }), (result) => result.ok);
      await recordKimiAttempt({ ownerId, status: turn.ok ? "session_created" : "failed", error: turn.error });
      return json({ ok: turn.ok, executed: turn.ok, output: turn.output || "", sessionId: turn.sessionId, instructionReceipt: turn.instructionReceipt, resourceReceipt, package: packageLabel(turn.command), limitation: "Audio was not sent to Kimi. The transcript ran in the hosted Build workspace." }, turn.ok ? 200 : 409);
    }
    if (!buildRuntimeCapabilities(ownerId, [agent])[1]?.coding) return json({ ok: false, error: "The selected computer has not reported an available coding runtime." }, 409);
    const job = await enqueueJob({ ownerId, agentId: agent.id, kind: "kimi-acp", command: "kimi acp", confirm: false, payload: { prompt, cwd: body.cwd?.trim().slice(0, 500) || undefined, source: "adrian-speak" } });
    return json({ ok: true, jobId: job.id, status: job.status, limitation: "Audio was not sent to Kimi. The transcript uses the same Build session queue." }, 202);
  } catch (error) { return fail(error); }
}
