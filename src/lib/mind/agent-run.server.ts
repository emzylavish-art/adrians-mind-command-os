import { requireUserId } from "../auth/verify.server";
import { runBoundedAgent } from "./agent";
import { createBudgetedAgentModel } from "./agent-model-dispatch.server.ts";
import { resolveModelTier } from "./model-tiers";
import { AGENT_TIMEOUT_REPLY, agentRunTimeoutMs, boundAbortSignal, isTimeoutAbort } from "./turn-timeouts";
import { guardMindEnv } from "./isolation";
import { AGENT_RATE_LIMIT_REPLY, jsonRateLimited } from "./limits";
import { consumeSharedMindRateLimit } from "./rate-limit.server.ts";
import { decideFetchSite } from "./request-guard";
import { sanitizeAttachments } from "./media/index.ts";
import { resolveXaiInferenceApiKey } from "./xai-adapter";
import { parseModelTierField, readJsonObjectBody } from "./request-body";
import { resolveDatabaseUrl } from "../env.server.ts";
import { governedModelCall } from "./resource-governor.server.ts";
import { normalizeProviderReceipt } from "./provider-call.ts";
import { readAuthorizedAgentContext } from "./memory/dispatch-policy.server.ts";

const MAX_BODY = 2_500_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function handleAgentRun(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed.", log: [] }, 405);
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return json({ ok: false, error: "Forbidden: cross-site request blocked", log: [] }, 403);
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  let userId: string;
  try {
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message, log: [] }, message === "Unauthorized" ? 401 : 403);
  }
  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error, log: [] }, read.status);
  const body: { goal?: unknown; projects?: unknown; chats?: unknown; notes?: unknown; modelTier?: unknown; images?: unknown; operationId?: unknown; projectId?: unknown; taskId?: unknown } = read.body;
  if (body.operationId !== undefined && (typeof body.operationId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(body.operationId))) return json({ ok: false, dispatched: false, error: "The agent operation identity is invalid. Nothing was sent.", log: [] }, 400);
  if ([['projectId', 160], ['taskId', 240]].some(([key, max]) => { const value = read.body[String(key)]; return value != null && (typeof value !== "string" || !value.trim() || value.length > Number(max) || /\p{Cc}/u.test(value)); })) return json({ ok: false, dispatched: false, error: "The agent project or task scope is invalid. Nothing was sent.", log: [] }, 400);
  if (read.body.freeOnly === true) return json({ ok: false, error: "Free-only mode prevents use of the paid agent runtime.", log: [] }, 403);
  const tierField = parseModelTierField(body.modelTier);
  if (!tierField.ok) return json({ ok: false, error: tierField.error, log: [] }, 400);
  const { haltIsOn } = await import("./halt.server");
  if (await haltIsOn(userId)) return json({ ok: false, error: "Emergency stop is on. No new action can run.", log: [] });
  // Rate limit after body guard + tier parse so malformed bodies stay 400 and do not consume a token.
  const limited = await consumeSharedMindRateLimit("agent", userId, 6);
  if (!limited.ok && "unavailable" in limited) return json({ ok: false, error: "Usage limits could not be checked. No agent call was sent.", log: [] }, 503);
  if (!limited.ok) return jsonRateLimited(AGENT_RATE_LIMIT_REPLY, limited.retryAfterSec, { log: [] });
  const gate = guardMindEnv({
    databaseUrl: resolveDatabaseUrl(process.env),
    mindUrl: process.env.MIND_SUPABASE_URL,
    mindRef: process.env.MIND_SUPABASE_PROJECT_REF,
  });
  if (!gate.ok) return json({ ok: false, error: gate.error, log: [] });
  const keyed = resolveXaiInferenceApiKey(process.env);
  if (!keyed.ok) return json({ ok: false, error: keyed.error, log: [] });
  const apiKey = keyed.key;
  const currentContext = await readAuthorizedAgentContext(userId, read.body);
  if (!currentContext.ok) return json({ ...currentContext, log: [] }, 409);
  const ws = currentContext.workspace;
  const goal = typeof body.goal === "string" ? body.goal : "";
  const tier = resolveModelTier(tierField.tier, goal || (Array.isArray(body.images) && body.images.length ? "image" : ""), process.env);
  const images = sanitizeAttachments(body.images);
  const bound = boundAbortSignal(request.signal, agentRunTimeoutMs());
  const budgeted = createBudgetedAgentModel({
    ownerId: userId, apiKey, signal: bound.signal,
    operationId: body.operationId, projectId: body.projectId, taskId: body.taskId,
    options: { model: tier.model, temperature: tier.params.temperature, max_tokens: tier.params.max_tokens, reasoning_effort: tier.params.reasoning_effort },
  });
  try {
    const result = budgeted.finish(await runBoundedAgent({
      ws,
      goal: goal || (images.length ? "Describe the attached image and use tools only if needed." : ""),
      model: budgeted.model,
      signal: bound.signal,
      autonomy: "ask",
      halted: false,
      beforeStep: async () => {
        if (await haltIsOn(userId)) throw new Error("Emergency stop is on. No new agent step can run.");
        const current = await readAuthorizedAgentContext(userId, read.body);
        if (!current.ok) throw new Error(current.error);
        Object.assign(ws, current.workspace);
      },
      approved: true,
      images,
    }));
    if (!result.ok && isTimeoutAbort(bound.signal, bound.signal.reason)) {
      return json({
        ...result,
        ok: false,
        text: "",
        log: result.log,
        error: AGENT_TIMEOUT_REPLY,
        model: tier.model,
        modelTier: tier.selected,
        resolvedTier: tier.resolved,
        tierReason: tier.reason,
      });
    }
    return json({
      ...result,
      ok: result.ok,
      text: result.text,
      log: result.log,
      error: result.error ?? "",
      model: tier.model,
      modelTier: tier.selected,
      resolvedTier: tier.resolved,
      tierReason: tier.reason,
      images: result.images?.map((image) => ({ dataUrl: image.dataUrl, name: image.name, mime: image.mime })) ?? [],
    });
  } catch (caught) {
    if (isTimeoutAbort(bound.signal, caught) || isTimeoutAbort(bound.signal, bound.signal.reason)) {
      return json({
        ...budgeted.finish({ ok: false, text: "", log: [], error: AGENT_TIMEOUT_REPLY }),
        ok: false,
        text: "",
        log: [],
        error: AGENT_TIMEOUT_REPLY,
        model: tier.model,
        modelTier: tier.selected,
        resolvedTier: tier.resolved,
        tierReason: tier.reason,
      });
    }
    throw caught;
  } finally {
    bound.cleanup();
  }
}
