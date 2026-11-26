import { buildRuntimeCapabilities } from "./runtime-capabilities.ts";
import { machineRequired } from "./account-workspace.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, onlineAgents, readJob } from "../pc-pairing/coordination.server.ts";
import { KIMI_CAPABILITIES, capabilitySummary } from "./capabilities";
import { archiveProject, listAudit, listProjects, listProviders, listSessions, saveProject, saveProvider, saveSessionMeta } from "./build-store";
import { HOSTED_BUILD_MODEL, adrianHostedWorkspace, packageLabel, resolveBuildWorkspace, runCodingTurn } from "./hosted/acp-client.ts";
import { recordKimiAttempt } from "./persist.ts";
import { runGovernedHostedCoding } from "./hosted/resource-dispatch.server.ts";
import { dispatchContext, reserveDispatchAttempt, runSettledDispatch } from "../dispatch-attempt.ts";
import { resolveXaiInferenceApiKey } from "../media/xai-key.ts";

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
    const agent = onlineAgents(ownerId)[0];
    const body = (await request.json().catch(() => ({}))) as { transcript?: string; cwd?: string; instructions?: string; operationId?: unknown; taskId?: unknown; projectId?: unknown };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript || transcript.length > 4_000) return json({ ok: false, error: "Provide a transcript between 1 and 4,000 characters. Nothing was truncated or sent." }, 400);
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    if (instructions.length > 2_000) return json({ ok: false, error: "Project instructions exceed 2,000 characters. Nothing was truncated or sent." }, 400);
    const prompt = `${instructions ? `Project instructions:\n${instructions}\n\n` : ""}[Adrian Speak transcript]\n${transcript}`;
    if (!agent) {
      if (ownerId !== "dev-user") return json({ ok: false, executed: false, error: machineRequired }, 409);
      if (!resolveXaiInferenceApiKey()) return json({ ok: false, executed: false, error: "The hosted Build provider is not configured. Nothing was sent." }, 503);
      const workspace = resolveBuildWorkspace(body.cwd) || adrianHostedWorkspace();
      const context = dispatchContext({ operationId: body.operationId || request.headers.get("x-mind-operation-id"), taskId: body.taskId, projectId: body.projectId, provider: "xai", model: HOSTED_BUILD_MODEL, stage: "hosted-build-voice", args: { prompt, cwd: workspace, mode: "auto" }, textOnly: false });
      const reserved = await reserveDispatchAttempt(ownerId, context);
      if (!reserved.ok) return json({ ok: false, executed: false, error: reserved.error, approvalId: reserved.approvalId }, reserved.status);
      const turn = await runSettledDispatch(ownerId, reserved.reservationId, async () => { const result = await runCodingTurn({ prompt, cwd: workspace, ownerId, mode: "auto" }); return { ...result, dispatched: result.requestDispatched === true }; });
      const auditSaved = await recordKimiAttempt({ ownerId, status: turn.ok ? "session_created" : "failed", error: turn.error });
      return json({ ok: turn.ok, executed: turn.requestDispatched === true, requestDispatched: turn.requestDispatched === true, error: turn.error, output: turn.output || "", outputComplete: turn.outputComplete, outputCharacters: turn.outputCharacters, operationId: turn.operationId, toolReceipts: turn.toolReceipts, filesChanged: turn.filesChanged, verification: turn.verification, sessionId: turn.sessionId, package: packageLabel(turn.command), auditSaved, persistenceWarning: auditSaved ? undefined : "The coding result was received, but the account attempt record could not be saved.", limitation: "Audio was not sent to Kimi. The transcript ran in the hosted Build workspace." }, turn.ok ? 200 : 409);
    }
    const job = enqueueJob({ ownerId, agentId: agent.id, kind: "kimi-acp", command: "kimi acp", confirm: false, payload: { prompt, cwd: body.cwd?.trim().slice(0, 500) || undefined, source: "adrian-speak" } });
    return json({ ok: true, jobId: job.id, status: job.status, limitation: "Audio was not sent to Kimi. The transcript uses the same Build session queue." }, 202);
  } catch (error) { return fail(error); }
}
