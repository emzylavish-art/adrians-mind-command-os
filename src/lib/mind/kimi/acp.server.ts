import { buildRuntimeCapabilities } from "./runtime-capabilities.ts";
import { machineRequired } from "./account-workspace.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listAgents, listJobEvents, onlineAgents, readJob } from "../pc-pairing/coordination.server.ts";
import { readCodingFileSnapshot } from "./hosted/file-receipts.ts";
import { HOSTED_BUILD_MODEL, adrianBuildCommand, adrianHostedWorkspace, closeHostedCodingSession, packageLabel, resolveBuildWorkspace, runCodingTurn, runHostedPrompt, type CodingMode } from "./hosted/acp-client.ts";
import { readHostedGitBranch, snapshotHostedWorkspace } from "./hosted/shell.server.ts";
import { recordKimiAttempt } from "./persist.ts";
import { readBuildSourceReceipt } from "./source-receipt.ts";
import { createHash } from "node:crypto";
import { buildRuntimeUsage, observeBuildRuntime, recordUsageObservation, type UsageRecorder } from "../usage-observation.server.ts";
import { prepareBuildTask } from "./build-guidance.ts";
import { pairedBuildPayload, pairedBuildReceipt, pairedBuildReviewScope, pairedBuildRunResult } from "./paired-build-receipt.ts";
import { dispatchContext, reserveDispatchAttempt, runSettledDispatch } from "../dispatch-attempt.ts";
import { resolveXaiInferenceApiKey } from "../media/xai-key.ts";
import { buildBranchName } from "./build-scope.ts";

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

function observePairedJob(ownerId: string, job: NonNullable<Awaited<ReturnType<typeof readJob>>>, record: UsageRecorder) {
  const state = job.status === "done" ? "completed" : job.status === "cancelled" ? "canceled" : job.status === "timeout" || job.status === "error" ? "failed" : job.status === "queued" ? "queued" : "running";
  return record(ownerId, buildRuntimeUsage({ operationId: "build:" + job.id, at: job.createdAt, state, started: job.status !== "queued" && (job.status !== "cancelled" || !!job.acceptedAt) })).catch(() => undefined);
}

export async function handleKimiSession(request: Request, deps: { recordUsage?: UsageRecorder } = {}): Promise<Response> {
  const record = deps.recordUsage ?? recordUsageObservation;
  if (request.method === "POST") {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
    try {
      const ownerId = await ownerIdFromRequest(request);
      const body = (await request.json().catch(() => ({}))) as { prompt?: unknown; modeInstruction?: unknown; skillApplications?: unknown; cwd?: unknown; mode?: unknown; resumeSessionId?: unknown; fork?: unknown; action?: unknown; agentId?: unknown; jobKey?: unknown; operationId?: unknown; taskId?: unknown; projectId?: unknown; sourceChatId?: unknown; sourceReceipt?: unknown; expectedBranch?: unknown };
      if ((body as { action?: unknown }).action === "close") {
        if (ownerId !== "dev-user") return json({ ok: false, error: machineRequired }, 409);
        const sessionId = typeof body.resumeSessionId === "string" ? body.resumeSessionId.trim().slice(0, 80) : "";
        if (!sessionId) return json({ ok: false, error: "session id is required to close the coding process." }, 400);
        return json({ ok: true, closed: closeHostedCodingSession(sessionId), sessionId });
      }
      if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. No Kimi session was queued." }, 403);
      const prepared = prepareBuildTask(body.prompt, body.skillApplications, body.modeInstruction);
      if (!prepared.ok) return json({ ok: false, error: prepared.error }, 400);
      const prompt = prepared.prompt;
      const requestedCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim().slice(0, MAX_CWD) : undefined;
      const mode = body.mode === "plan" || body.mode === "auto" || body.mode === "yolo" || body.mode === "default" ? body.mode as CodingMode : undefined;
      const resumeSessionId = typeof body.resumeSessionId === "string" ? body.resumeSessionId.trim().slice(0, 80) : "";
      const expectedBranch = body.expectedBranch;
      if (expectedBranch !== undefined && !buildBranchName(expectedBranch)) return json({ ok: false, error: "Invalid target branch. Nothing was started." }, 400);
      const agents = await onlineAgents(ownerId);
      if (body.agentId === undefined && agents.length > 1) return json({ ok: false, error: "Choose the computer for this Build task. No alternate was selected." }, 409);
      const onlineAgent = body.agentId === "hosted" ? undefined : body.agentId === undefined ? agents[0] : agents.find((item) => item.id === body.agentId);
      const savedAgent = !onlineAgent && expectedBranch && typeof body.agentId === "string" && body.agentId !== "hosted"
        ? (await listAgents(ownerId)).find(item => item.id === body.agentId && item.capabilities?.codingRuntime === true) : undefined;
      const agent = onlineAgent || savedAgent;
      const sourceReceipt = readBuildSourceReceipt(body.sourceReceipt);
      if (body.sourceReceipt !== undefined && !sourceReceipt) return json({ ok: false, error: "The source revision receipt is invalid. Nothing was started." }, 400);
      if (sourceReceipt && (sourceReceipt.workspace !== (agent?.id || "hosted") || sourceReceipt.cwd !== (requestedCwd || ""))) return json({ ok: false, error: "The reviewed source belongs to a different execution workspace. Review it again." }, 409);
      if (body.agentId !== undefined && body.agentId !== "hosted" && !agent) return json({ ok: false, error: "The selected Build PC is offline. Reconnect it before submitting." }, 409);
      if (onlineAgent && !buildRuntimeCapabilities(ownerId, [onlineAgent])[1]?.coding && !(expectedBranch && onlineAgent.capabilities?.codingRuntime === true)) {
        return json({ ok: false, error: "The selected computer has not reported an available coding runtime. Reconnect or update it before submitting." }, 409);
      }
      if (body.jobKey !== undefined && (typeof body.jobKey !== "string" || !/^[a-f0-9]{32}$/.test(body.jobKey))) return json({ ok: false, error: "Invalid job ID." }, 400);
      if (expectedBranch && resumeSessionId) return json({ ok: false, error: "A target branch requires a new coding session." }, 409);
      if (expectedBranch && agent && (!sourceReceipt?.files.length || sourceReceipt.policy !== "saved" || !requestedCwd || !body.jobKey)) {
        return json({ ok: false, error: "Review at least one saved source file before queuing a branch-checked Build job." }, 409);
      }
      if (!agent) {
        if (ownerId !== "dev-user") return json({ ok: false, executed: false, error: machineRequired }, 409);
        if (!resolveXaiInferenceApiKey()) return json({ ok: false, executed: false, error: "The hosted Build provider is not configured. Nothing was sent." }, 503);
        const cwd = resolveBuildWorkspace(requestedCwd);
        if (expectedBranch && await readHostedGitBranch(cwd) !== expectedBranch) return json({ ok: false, executed: false, error: "The active Git branch could not be verified against the target. Check the workspace and branch before running." }, 409);
        for (const file of sourceReceipt?.files ?? []) {
          const current = readCodingFileSnapshot(cwd || adrianHostedWorkspace(), file.path);
          if (!current.ok || !current.exists || createHash("sha256").update(current.content).digest("hex") !== file.sha256) return json({ ok: false, error: "A reviewed source file changed or is unavailable. Review it before running." }, 409);
        }
        const context = dispatchContext({ operationId: body.operationId || body.jobKey || request.headers.get("x-mind-operation-id"), taskId: body.taskId, projectId: body.projectId,
          provider: "xai", model: HOSTED_BUILD_MODEL, stage: "hosted-build", args: { prompt, cwd, mode, resumeSessionId, sourceReceipt, expectedBranch, fork: body.fork === true }, textOnly: false });
        const reserved = await reserveDispatchAttempt(ownerId, context);
        if (!reserved.ok) return json({ ok: false, executed: false, error: reserved.error, approvalId: reserved.approvalId }, reserved.status);
        if (mode || resumeSessionId || body.fork === true) {
          const workspace = cwd || adrianHostedWorkspace();
          const checkpoint = snapshotHostedWorkspace();
          const watched = fileChange(workspace, prompt);
          const turn = await runSettledDispatch(ownerId, reserved.reservationId, async () => { const result = await observeBuildRuntime({ ownerId, operationId: context.operationId, record, run: () => runCodingTurn({ prompt, cwd: workspace, ownerId, mode, resumeSessionId: resumeSessionId || undefined, fork: body.fork === true }), state: result => result.ok ? "completed" : "failed" }); return { ...result, dispatched: result.requestDispatched === true }; });
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
            verifiedBranch: expectedBranch,
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
        const hosted = await runSettledDispatch(ownerId, reserved.reservationId, async () => { const result = await observeBuildRuntime({ ownerId, operationId: context.operationId, record, run: () => runHostedPrompt(prompt, adrianBuildCommand(), cwd || adrianHostedWorkspace()), state: result => result.status === "session_created" ? undefined : "failed" }); return { ...result, ok: result.status === "session_created", dispatched: result.requestDispatched === true }; });
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
          verifiedBranch: expectedBranch,
          version: hosted.version,
          agent: hosted.agentName,
          output: hosted.output || "",
          skillReceipts: accepted ? prepared.skillReceipts : [],
          package: packageLabel(hosted.command),
        }, accepted ? 200 : hosted.status === "not_configured" ? 503 : 409);
      }
      const reviewScope = body.sourceChatId === undefined ? null : pairedBuildReviewScope(body.projectId, body.sourceChatId, body.jobKey);
      if (body.sourceChatId !== undefined && !reviewScope) return json({ ok: false, error: "The Build result link has an invalid chat, project or run. Nothing was started." }, 400);
      const job = await enqueueJob({
        jobKey: typeof body.jobKey === "string" ? body.jobKey : undefined,
        ownerId,
        agentId: agent.id,
        kind: "kimi-acp",
        command: "kimi acp",
        confirm: false,
        payload: { ...pairedBuildPayload(prompt, prepared.skillReceipts, requestedCwd), sourceReceipt, ...(expectedBranch ? { expectedBranch } : {}), ...(reviewScope ? { reviewScope } : {}) },
      });
      await observePairedJob(ownerId, job, record);
      return json({
        ok: true,
        jobId: job.id,
        agentId: agent.id,
        agentLabel: agent.label,
        status: job.status,
        receipt: pairedBuildReceipt(job, ownerId),
        sourceReceipt, revisionVerified: false,
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
      const params = new URL(request.url).searchParams;
      const jobId = params.get("jobId") || "";
      const job = await readJob(jobId);
      if (!job || job.ownerId !== ownerId || job.kind !== "kimi-acp") return json({ ok: false, error: "Kimi job not found." }, 404);
      const reviewProject = params.get("reviewProject");
      const review = reviewProject === null ? null : pairedBuildRunResult(job, ownerId, reviewProject || null);
      if (reviewProject !== null && !review) return json({ ok: false, error: "Build run receipt not found for this project." }, 404);
      if (!review) await observePairedJob(ownerId, job, record);
      const sourceReceipt = readBuildSourceReceipt(job.payload?.sourceReceipt);
      const events = await listJobEvents(ownerId, job.id);
      const sourceDigest = sourceReceipt?.files.length ? createHash("sha256").update(JSON.stringify(sourceReceipt)).digest("hex") : null;
      const revisionVerified = sourceDigest !== null && events.some(event => event.type === "source_verified"
        && event.payload.sourceDigest === sourceDigest && event.payload.fileCount === sourceReceipt?.files.length
        && (job.payload?.expectedBranch === undefined || event.payload.branch === job.payload.expectedBranch));
      if (review) {
        if (review.receipt && revisionVerified && buildBranchName(job.payload?.expectedBranch)) review.receipt.verifiedBranch = job.payload.expectedBranch;
        return json({ ok: true, result: review });
      }
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
        sourceReceipt, revisionVerified,
        events,
        receipt: pairedBuildReceipt(job, ownerId),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
    }
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}
