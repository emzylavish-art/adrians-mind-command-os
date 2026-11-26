import { buildRuntimeCapabilities } from "./runtime-capabilities.ts";
import { machineRequired } from "./account-workspace.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listJobEvents, onlineAgents, readJob } from "../pc-pairing/coordination.server.ts";
import { readCodingFileSnapshot } from "./hosted/file-receipts.ts";
import { HOSTED_BUILD_MODEL, adrianBuildCommand, adrianHostedWorkspace, closeHostedCodingSession, packageLabel, resolveBuildWorkspace, runCodingTurn, runHostedPrompt, type CodingMode } from "./hosted/acp-client.ts";
import { snapshotHostedWorkspace } from "./hosted/shell.server.ts";
import { recordKimiAttempt } from "./persist.ts";
import { readBuildSourceReceipt } from "./source-receipt.ts";
import { createHash, randomUUID } from "node:crypto";
import { buildRuntimeUsage, observeBuildRuntime, recordUsageObservation, type UsageRecorder } from "../usage-observation.server.ts";
import { runGovernedHostedCoding } from "./hosted/resource-dispatch.server.ts";
import { prepareBuildTask } from "./build-guidance.ts";
import { pairedBuildPayload, pairedBuildReceipt } from "./paired-build-receipt.ts";
import { dispatchContext, reserveDispatchAttempt, runSettledDispatch } from "../dispatch-attempt.ts";
import { resolveXaiInferenceApiKey } from "../media/xai-key.ts";

const MAX_CWD = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function fileChange(workspace: string, prompt: string) {
  const match = prompt.match(/([A-Za-z0-9._/-]+\.(?:md|txt|json|ts|tsx|js|py|css))/i);
  const relative = match?.[1]?.replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return null;
  return readCodingFileSnapshot(workspace, relative);
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
      const body = (await request.json().catch(() => ({}))) as { prompt?: unknown; skillApplications?: unknown; cwd?: unknown; mode?: unknown; resumeSessionId?: unknown; fork?: unknown; action?: unknown; agentId?: unknown; jobKey?: unknown; operationId?: unknown; taskId?: unknown; projectId?: unknown };
      if ((body as { action?: unknown }).action === "close") {
        if (ownerId !== "dev-user") return json({ ok: false, error: machineRequired }, 409);
        const sessionId = typeof body.resumeSessionId === "string" ? body.resumeSessionId.trim().slice(0, 80) : "";
        if (!sessionId) return json({ ok: false, error: "session id is required to close the coding process." }, 400);
        return json({ ok: true, closed: closeHostedCodingSession(sessionId), sessionId });
      }
      if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. No Kimi session was queued." }, 403);
      const prepared = prepareBuildTask(body.prompt, body.skillApplications);
      if (!prepared.ok) return json({ ok: false, error: prepared.error }, 400);
      const prompt = prepared.prompt;
      const requestedCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim().slice(0, MAX_CWD) : undefined;
      const mode = body.mode === "plan" || body.mode === "auto" || body.mode === "yolo" || body.mode === "default" ? body.mode as CodingMode : undefined;
      const resumeSessionId = typeof body.resumeSessionId === "string" ? body.resumeSessionId.trim().slice(0, 80) : "";
      const agents = onlineAgents(ownerId);
      const agent = body.agentId === undefined ? agents[0] : agents.find((item) => item.id === body.agentId);
      if (body.agentId !== undefined && !agent) return json({ ok: false, error: "The selected Build PC is offline. Reconnect it before submitting." }, 409);
      if (body.jobKey !== undefined && (typeof body.jobKey !== "string" || !/^[a-f0-9]{32}$/.test(body.jobKey))) return json({ ok: false, error: "Invalid job ID." }, 400);
      if (!agent) {
        if (ownerId !== "dev-user") return json({ ok: false, executed: false, error: machineRequired }, 409);
        if (!resolveXaiInferenceApiKey()) return json({ ok: false, executed: false, error: "The hosted Build provider is not configured. Nothing was sent." }, 503);
        const cwd = resolveBuildWorkspace(requestedCwd);
        const context = dispatchContext({ operationId: body.operationId || body.jobKey || request.headers.get("x-mind-operation-id"), taskId: body.taskId, projectId: body.projectId,
          provider: "xai", model: HOSTED_BUILD_MODEL, stage: "hosted-build", args: { prompt, cwd, mode, resumeSessionId, fork: body.fork === true }, textOnly: false });
        const reserved = await reserveDispatchAttempt(ownerId, context);
        if (!reserved.ok) return json({ ok: false, executed: false, error: reserved.error, approvalId: reserved.approvalId }, reserved.status);
        if (mode || resumeSessionId || body.fork === true) {
          const workspace = cwd || adrianHostedWorkspace();
          const checkpoint = snapshotHostedWorkspace();
          const watched = fileChange(workspace, prompt);
          const turn = await runSettledDispatch(ownerId, reserved.reservationId, async () => { const result = await runCodingTurn({ prompt, cwd: workspace, ownerId, mode, resumeSessionId: resumeSessionId || undefined, fork: body.fork === true }); return { ...result, dispatched: result.requestDispatched === true }; });
          const current = watched?.ok ? readCodingFileSnapshot(workspace, watched.path) : null;
          const observed = watched?.ok && current?.ok && (watched.content !== current.content || watched.exists !== current.exists) ? [{ path: watched.path, before: watched.content, after: current.content, beforeExists: watched.exists, afterExists: current.exists }] : [];
          const fileReviewWarnings = [watched && !watched.ok ? watched.error : "", current && !current.ok ? current.error : ""].filter(Boolean);
          const filesChanged = [...(turn.filesChanged || []), ...observed.filter(item => !turn.filesChanged?.some(change => change.path === item.path))];
          const auditSaved = await recordKimiAttempt({ ownerId, status: turn.ok ? "session_created" : "failed", error: turn.error });
          if (!auditSaved) fileReviewWarnings.push("The coding result was received, but the account attempt record could not be saved.");
          return json({
            ok: turn.ok,
            executed: turn.requestDispatched === true,
            requestDispatched: turn.requestDispatched === true,
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
            toolReceipts: turn.toolReceipts || [],
            operationId: turn.operationId,
            outputComplete: turn.outputComplete,
            outputCharacters: turn.outputCharacters,
            verification: turn.verification,
            processNote: turn.processNote || "",
            filesChanged,
            fileReviewWarnings,
            fileReviewScope: "Host callback writes and the first bounded prompt path; other native changes require Git review.",
            skillReceipts: turn.requestDispatched ? prepared.skillReceipts : [],
            workspace,
            checkpoint,
          }, turn.ok ? 200 : 409);
        }
        const hosted = await runSettledDispatch(ownerId, reserved.reservationId, async () => { const result = await runHostedPrompt(prompt, adrianBuildCommand(), cwd || adrianHostedWorkspace()); return { ...result, ok: result.status === "session_created", dispatched: result.requestDispatched === true }; });
        const auditSaved = await recordKimiAttempt({ ownerId, status: hosted.status, error: hosted.error });
        const accepted = hosted.status === "session_created";
        return json({
          ok: accepted,
          executed: hosted.requestDispatched === true,
          requestDispatched: hosted.requestDispatched === true,
          auditSaved,
          persistenceWarning: auditSaved ? undefined : "The coding result was received, but its account attempt record could not be saved.",
          loginRequired: hosted.status === "authentication_required",
          error: accepted ? undefined : hosted.error || "The coding package did not accept the task. No extra login is requested.",
          runtime: hosted.status,
          version: hosted.version,
          agent: hosted.agentName,
          output: hosted.output || "",
          skillReceipts: accepted ? prepared.skillReceipts : [],
          package: packageLabel(hosted.command),
        }, accepted ? 200 : hosted.status === "not_configured" ? 503 : 409);
      }
      const job = enqueueJob({
        jobKey: typeof body.jobKey === "string" ? body.jobKey : undefined,
        ownerId,
        agentId: agent.id,
        kind: "kimi-acp",
        command: "kimi acp",
        confirm: false,
        payload: pairedBuildPayload(prompt, prepared.skillReceipts, requestedCwd),
      });
      return json({
        ok: true,
        jobId: job.id,
        agentId: agent.id,
        agentLabel: agent.label,
        status: job.status,
        receipt: pairedBuildReceipt(job, ownerId),
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
        receipt: pairedBuildReceipt(job, ownerId),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
    }
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}
