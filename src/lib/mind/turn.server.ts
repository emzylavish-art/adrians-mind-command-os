import { readHaltState } from "./halt.server.ts";
import { writeUsageReceipt, trackUsageResponse } from "./usage-ledger.server.ts";
import type { UsageReceipt } from "./usage-ledger.ts";
import { providerRequestId } from "./provider-usage.ts";
import { withExecutionReceipts } from "./execution-response.ts";
import type { ConsultExecutionReceipt } from "./model-consult.ts";
import { readModelExecutions, saveModelExecution } from "./model-execution.server.ts";
import type { ProviderReceipt } from "./provider-receipt.ts";
import { selectContextHistory } from "./context-budget.ts";
import { modelExecutionPlan, type ModelExecutionPlan } from "./execution-plan.ts";
import { withFailureEnvelope } from "./failure-envelope.ts";
import { toNativeProviderTurns } from "./ai-provider-native.ts";
import type { ModelCapabilities } from "./model-capabilities.ts";
import type { SkillApplicationReceipt } from "./skill-activation.ts";
import { consultationResponse, providerResponse } from "./provider-response.ts";
import { isOpenRouterFreeModel } from "./provider-catalog.ts";
import { validatePrimaryConfiguration } from "./turn-primary-selection.ts";
import { listEnvironmentModelCatalogs, validateEnvironmentModel } from "./environment-model-catalog.server.ts";
import { catalogForProvider } from "./environment-model-catalog.ts";
import { completeLegacyModelReply, type LegacyPreparedTurn, type LegacyTurnDependencies } from "./legacy-turn.server.ts";
import { turnErrorCode } from "./turn-error.ts";
import { applyOwnerMemoryPolicy, assertOwnerMemoryDispatch } from "./memory/policy.server.ts";
import { reserveOwnerDispatch } from "./dispatch-controls.server.ts";
import { randomUUID } from "node:crypto";
import { dispatchContext, financialProviderId, runSettledDispatch, settleDispatchResult, type DispatchOutcome } from "./dispatch-attempt.ts";
import type { MonetaryDispatchContext } from "./financial-policy.ts";
import { normalizeContextReceipt, type ContextReceipt } from "./conversation-context.ts";
import { sessionErrorStatus } from "../auth/session-resolution.ts";
import { DEV_USER_ID, isLoopbackPreview, requireUserId } from "../auth/verify.server";
import { guardMindEnv } from "./isolation";
import { checkTurnSize, createChatTurnPreflight } from "./limits";
import { consumeSharedMindRateLimit } from "./rate-limit.server.ts";
import { assembleTurn } from "./prompt";
import { sanitizeAttachments, type ImageAttachment } from "./media";
import type { ChatContent } from "./media/types";
import { resolveXaiInferenceApiKey } from "./xai-adapter";
import type { HistoryInputMessage } from "./media/history";
import { isAvailableGrokSelection, parseModelControls, reconcileTierParams, resolveModelTier } from "./model-tiers";
import { assertLiveProvider } from "./providers";
import { callConfiguredProvider, httpStatusForProviderSelection, routeSelectedModel, selectProvider } from "./provider-call";
import { configuredProviders } from "./provider-call";
import { collectConsultHelp, ADRIAN_MIND_IDENTITY, builtinModules, customModules, orchestratorInstruction, planModelConsult, type ConsultReply, executeConsultPlan, type HelperReceipt, type HelperReply, collectConsultReport, isLocalConsultRunner, type ConsultAttempt, type ConsultHelperReply } from "./model-consult.ts";
import { adrianPcEnabled, runAdrianPc } from "./adrian-pc.server.ts";
import { ownerScreenshotReader } from "./pc-vision.server.ts";
import { consequentialSpeechRefusal } from "./frontier-2031.ts";
import { destructiveSpeechRefusal } from "./reversibility.ts";
import { ensureLocalCapabilityFile, runLocalCommand } from "./local-capabilities.ts";
import path from "node:path";
import { relayModelStream } from "./relay";
import { chatTurnTimeoutMs } from "./turn-timeouts";
import { decideFetchSite } from "./request-guard";
import { parseModelTierField, readJsonObjectBody } from "./request-body";
import { readModelPayload, reportedModel } from "./stream";
import { resolveDatabaseUrl } from "../env.server.ts";
import { LOGIC_ROUTE_LABEL, resolveRequestedRoute, toAdapterMessages, type LogicRouteId } from "./logic-routes.ts";
import { inspectLogicRoutes, runLogicRoute } from "./logic-route-adapter.server.ts";
import { parseCustomProviderChoice, executeCustomChat, validateCustomProviderSelection } from "./ai-provider-config.server.ts";
import { finishTurnReceipt, claimTurn, pruneTurnReceipts, turnOperationExpiry, readTurnReceipt } from "./turn-receipt.ts";
import { readTurnRecovery, recoverableTurnResponse } from "./turn-recovery.ts";
import { governedModelCall, reserveResourceOperation, settleResourceOperation, settleResourceStream } from "./resource-governor.server.ts";
import { assertCurrentMemoryContext } from "./memory/dispatch-policy.server.ts";
import { resolveTurnInstructions, instructionContext, recordLoadedInstructions, type LoadedInstruction } from "./skill-instructions.server.ts";
import type { Sql } from "../db";

/** Default Expert model id — kept for status/docs; live turns use resolveModelTier. */
export const MIND_MODEL = "grok-4.5";
/** Raised so a few downscaled image data-URLs can ride with the turn JSON. */
const MAX_BODY = 2_500_000;

type NoteItem = { id: string; text: string };

export type TurnBody = {
  text?: unknown;
  memory?: unknown;
  chatId?: unknown;
  projectId?: unknown;
  operationId?: unknown;
  taskId?: unknown;
  halted?: unknown;
  history?: unknown;
  memoryContext?: unknown;
  provider?: unknown;
  personalityId?: unknown;
  customPersonality?: unknown;
  /** UI picker: Auto | Fast | Expert | Heavy | Build */
  modelTier?: unknown;
  /** A live xAI model id. Used only when it is in the connected Grok list. */
  requestedModel?: unknown;
  /** Astra, Sol, or Luna. When set, this route is used instead of the Grok tier. */
  logicRoute?: unknown;
  /** Optional image attachments (data-URLs) for multimodal Direct turns. */
  images?: unknown;
  /** Optional explicit note to persist with this turn (owner-scoped). */
  saveMemory?: unknown;
  botKnowledge?: unknown;
  projectInstructions?: unknown;
  checkpoints?: unknown;
  skillApplications?: unknown;
  knowledgePassages?: unknown;
  selectedImageMessageIds?: unknown;
  composerMode?: unknown;
  usageChannel?: unknown;
  orchestrator?: unknown;
  consult?: unknown;
  modelControls?: unknown;
  previousTier?: unknown;
  consultHelpers?: unknown;
  maxHelpers?: unknown;
  freeOnly?: unknown;
  temporary?: unknown;
  memoryPolicyRevision?: unknown;
  contextPolicy?: unknown;
  projectContext?: unknown;
};

function loadParsedControls(value: unknown) { const parsed = parseModelControls(value); return parsed.ok ? parsed.controls : {}; }
function readCheckpoints(value: unknown) { return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && typeof row.id === "string" && typeof row.text === "string" && Array.isArray(row.sourceMessageIds) && ["decision", "requirement", "correction", "unresolved"].includes(row.kind) && ["active", "superseded", "open"].includes(row.state)).slice(0, 100) : []; }
function isHistory(item: unknown): item is HistoryInputMessage {
  if (!item || typeof item !== "object") return false;
  const record = item as { role?: unknown; content?: unknown; images?: unknown };
  if (!(record.role === "user" || record.role === "assistant") || typeof record.content !== "string") return false;
  if (record.images != null && !Array.isArray(record.images)) return false;
  return true;
}

function isNote(item: unknown): item is NoteItem {
  if (!item || typeof item !== "object") return false;
  const record = item as { id?: unknown; text?: unknown };
  return typeof record.id === "string" && typeof record.text === "string";
}

function directTurnContext(body: TurnBody, text: string, history: HistoryInputMessage[], consultHelp: string, selected: { model?: string; capabilities?: ModelCapabilities; supportsImages?: boolean } = {}) {
  if (body.memory !== undefined && body.memory !== "on" && body.memory !== "off") return { ok: false as const, error: "Invalid memory setting." };
  const memoryContext = Array.isArray(body.memoryContext) ? body.memoryContext.filter(isNote) : [];
  const images = selected.supportsImages ? sanitizeAttachments(body.images) : [];
  const sized = checkTurnSize({ text, history, memoryContext, images });
  if (!sized.ok) return sized;
  const assembled = assembleTurn({ text, history, images, memory: body.memory === "on" ? "on" : "off", memoryContext,
    personalityId: body.personalityId, customPersonality: body.customPersonality, botKnowledge: body.botKnowledge, skillApplications: body.skillApplications, projectContext: body.projectContext, knowledgePassages: body.knowledgePassages, projectInstructions: body.projectInstructions, contextOptions: { model: selected.model ?? (typeof body.requestedModel === "string" ? body.requestedModel : undefined), contextWindowTokens: selected.capabilities?.contextWindowTokens, maxInputTokens: selected.capabilities?.maxInputTokens, outputTokens: loadParsedControls(body.modelControls).answerTokens, supportsImages: selected.supportsImages === true, selectedImageMessageIds: Array.isArray(body.selectedImageMessageIds) ? body.selectedImageMessageIds.filter((id): id is string => typeof id === "string") : [] }, checkpoints: readCheckpoints(body.checkpoints), consultHelp });
  if (!assembled.ok) return assembled;
  const selectedHistory = assembled.messages.slice(1, -1).flatMap((message) => message.role === "user" || message.role === "assistant"
    ? [{ role: message.role, content: typeof message.content === "string" ? message.content : "[Historical image omitted: this route is text only.]" }]
    : []);
  return { ok: true as const, systemPrompt: String(assembled.messages[0].content), usedIds: assembled.usedIds, contextReceipt: assembled.contextReceipt, skillReceipts: assembled.skillReceipts, history: selectedHistory, messages: assembled.messages };
}

function envCheck() {
  return guardMindEnv({
    databaseUrl: resolveDatabaseUrl(process.env),
    mindUrl: process.env.MIND_SUPABASE_URL,
    mindRef: process.env.MIND_SUPABASE_PROJECT_REF,
  });
}

export async function prepareMindTurn(userId: string, data: TurnBody) {
  return prepareMindTurnWithHelp(userId, data, "");
}

export async function prepareMindTurnWithHelp(userId: string, data: TurnBody, consultHelp = "") {
  const { haltIsOn } = await import("./halt.server");
  if ((await haltIsOn(userId)) || data.halted === true) {
    return { ok: false as const, error: "Emergency stop is on. No new action can run." };
  }
  const permission = await assertCurrentMemoryContext(userId, data);
  if (!permission.ok) return permission;
  const spoken = typeof data.text === "string" ? data.text : "";
  const refused = consequentialSpeechRefusal(spoken);
  if (refused) return { ok: false as const, error: refused };
  const destructive = destructiveSpeechRefusal(spoken);
  if (destructive) return { ok: false as const, error: destructive };
  // Body-field validation before rate limit so malformed/empty turns get honest 400s
  // and do not consume a chat token. (HTTP JSON body guard already ran in handleMindTurn.)
  const tierField = parseModelTierField(data.modelTier);
  if (!tierField.ok) return { ok: false as const, error: tierField.error };
  const images = sanitizeAttachments(data.images);
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text && images.length === 0) return { ok: false as const, error: "Write a message first." };
  const history = Array.isArray(data.history) ? data.history.filter(isHistory) : [];
  const memoryContext = Array.isArray(data.memoryContext) ? data.memoryContext.filter(isNote) : [];
  const sized = checkTurnSize({
    text: text || "Describe the attached image.",
    history,
    memoryContext,
    images,
  });
  if (!sized.ok) return sized;
  const memory: "off" | "on" | null = data.memory === "on" ? "on" : data.memory === "off" ? "off" : null;
  if (!memory) return { ok: false as const, error: "Memory setting is invalid." };
  const routed = assertLiveProvider(data.provider);
  if (!routed.ok) return routed;
  const gate = envCheck();
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const controls = parseModelControls(data.modelControls);
  if (!controls.ok) return controls;
  const tier = resolveModelTier(data.modelTier, text || "image", process.env, { previousTier: ["Fast", "Expert", "Heavy", "Build"].includes(String(data.previousTier)) ? data.previousTier as Exclude<import("./model-tiers").ModelTier, "Auto"> : undefined, controls: controls.controls });
  const catalogs = await listEnvironmentModelCatalogs(userId).catch(() => null);
  if (!catalogs) return { ok: false as const, error: "Current model catalogue evidence could not be read. Nothing was sent." };
  const catalog = catalogForProvider(catalogs, "grok");
  if (data.requestedModel != null && !isAvailableGrokSelection(data.requestedModel, process.env, catalog)) return { ok: false as const, error: "The selected Grok model is unavailable in the current catalogue. Your selection was preserved; nothing was substituted." };
  const requested = typeof data.requestedModel === "string" ? data.requestedModel : null;
  if (requested) { tier.model = requested; tier.params = reconcileTierParams(requested, tier.params); }
  const readiness = await validateEnvironmentModel(userId, "grok", tier.model, { images: images.length, outputTokens: tier.params.max_tokens });
  if (!readiness.ok) return readiness;
  const capabilities = "capabilities" in readiness ? readiness.capabilities : undefined;
  const assembled = assembleTurn({
    memory,
    history,
    text: text || "Describe the attached image.",
    memoryContext,
    images,
    personalityId: data.personalityId,
    customPersonality: data.customPersonality,
    botKnowledge: data.botKnowledge,
    skillApplications: data.skillApplications,
    projectContext: data.projectContext, knowledgePassages: data.knowledgePassages,
    projectInstructions: data.projectInstructions,
    checkpoints: readCheckpoints(data.checkpoints),
    contextOptions: { model: tier.model, contextWindowTokens: capabilities?.contextWindowTokens, maxInputTokens: capabilities?.maxInputTokens, outputTokens: tier.params.max_tokens, selectedImageMessageIds: Array.isArray(data.selectedImageMessageIds) ? data.selectedImageMessageIds.filter((id): id is string => typeof id === "string") : [], supportsImages: readiness.availability === "catalogued" ? capabilities?.imageInput === "supported" : true },
    consultHelp,
  });
  if (!assembled.ok) return { ok: false as const, error: assembled.error };
  const saveMemoryText = typeof data.saveMemory === "string" ? data.saveMemory.trim() : "";
  const chatId = typeof data.chatId === "string" ? data.chatId.trim() : "";
  if (memory === "on" && saveMemoryText && !chatId) return { ok: false as const, error: "Select a conversation before saving chat memory." };
  return {
    ok: true as const,
    assembled,
    memory,
    model: tier.model,
    modelTier: tier,
    provider: routed.id,
    images,
    saveMemoryText,
    chatId,
    userId,
    operationId: data.operationId,
    taskId: data.taskId,
    projectId: data.projectId,
    dispatchBody: data,
    usedSavedMemory: assembled.usedIds.length > 0 || Boolean(data.botKnowledge) || (Array.isArray(data.knowledgePassages) && data.knowledgePassages.length > 0) || (memory === "on" && Boolean(data.projectInstructions)),
  };
}

export async function completeModelReply(prepared: LegacyPreparedTurn, deps: LegacyTurnDependencies = {}) {
  return completeLegacyModelReply(prepared, deps);
}

function json(body: unknown, status = 200, retryAfter?: string) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const responseBody = record?.ok === false ? { ...record, code: turnErrorCode(record.code, status) } : body;
  return new Response(JSON.stringify(responseBody), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-mind-primary-dispatched": "0", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
  });
}

function failureReceipt(result: Partial<ProviderReceipt> & { model?: string; requestedModel?: string | null; dispatched?: boolean }) {
  return { usage: result.usage ?? null, requestId: result.requestId ?? null, model: result.model,
    requestedModel: result.requestedModel, executionLocation: result.executionLocation, dispatched: result.dispatched };
}

function logicSse(input: {
  text: string;
  model: string;
  requestedModel: string | null;
  route: LogicRouteId;
  usedIds: string[];
  credentialFallback: "OPENAI_API_KEY" | null;
  contextReceipt?: ContextReceipt;
  skillReceipts?: SkillApplicationReceipt[];
}): Response {
  const label = LOGIC_ROUTE_LABEL[input.route];
  const done = {
    text: input.text,
    model: input.model,
    requestedModel: input.requestedModel,
    provider: input.route,
    usage: null,
    usedIds: input.usedIds,
    requestId: null,
    logicRoute: input.route,
    credentialFallback: input.credentialFallback,
    tierReason: `Owner selected ${label}.`,
    contextReceipt: input.contextReceipt, skillReceipts: input.skillReceipts, delivery: "buffered",
  };
  const body = `event: delta\ndata: ${JSON.stringify({ text: input.text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}

async function handleLogicTurn(userId: string, data: TurnBody, route: LogicRouteId, preflight: () => Promise<Response | null>, markDispatched: () => void, settle: (result: DispatchOutcome) => Promise<void>): Promise<Response> {
  const label = LOGIC_ROUTE_LABEL[route];
  const images = sanitizeAttachments(data.images);
  if (images.length > 0) {
    return json({
      ok: false,
      error: `${label} cannot see images in this app. Remove the attached images. Nothing was sent. Another route was not substituted.`,
      logicRoute: route,
    }, 400);
  }
  const { haltIsOn } = await import("./halt.server");
  if ((await haltIsOn(userId)) || data.halted === true) {
    return json({ ok: false, error: "Emergency stop is on. No new action can run." });
  }
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return json({ ok: false, error: "Write a message first. Nothing was sent." }, 400);
  const history = Array.isArray(data.history) ? data.history.filter(isHistory) : [];
  const memoryContext = Array.isArray(data.memoryContext) ? data.memoryContext.filter(isNote) : [];
  const sized = checkTurnSize({ text, history, memoryContext, images: [] });
  if (!sized.ok) return json(sized, 400);
  const memory: "off" | "on" | null = data.memory === "on" ? "on" : data.memory === "off" ? "off" : null;
  if (!memory) return json({ ok: false, error: "Memory setting is invalid." }, 400);
  const gate = envCheck();
  if (!gate.ok) return json({ ok: false, error: gate.error });
  const assembled = assembleTurn({ memory, history, text, memoryContext, images: [], personalityId: data.personalityId, customPersonality: data.customPersonality, botKnowledge: data.botKnowledge, skillApplications: data.skillApplications, projectContext: data.projectContext, knowledgePassages: data.knowledgePassages, projectInstructions: data.projectInstructions, checkpoints: readCheckpoints(data.checkpoints), contextOptions: { supportsImages: false, outputTokens: loadParsedControls(data.modelControls).answerTokens } });
  if (!assembled.ok) return json({ ok: false, error: assembled.error }, 400);
  const flat = toAdapterMessages(assembled.messages);
  if (!flat.ok) return json({ ok: false, error: flat.error }, 400);
  const inspected = await inspectLogicRoutes(process.env);
  const view = inspected.find((item) => item.id === route);
  if (!view?.ready) {
    return json({
      ok: false,
      error: view?.reason ?? `${label} is not ready. Nothing was sent.`,
      logicRoute: route,
      missing: view?.missing ?? [],
    }, 503);
  }
  const blocked = await preflight();
  if (blocked) return blocked;
  markDispatched();
  const ran = await runLogicRoute({
    route,
    messages: flat.messages,
    env: process.env,
    inspect: async () => inspected,
  });
  await settle({ ok: ran.ok, dispatched: ran.called });
  if (!ran.ok) return json({ ok: false, error: ran.error, logicRoute: route, provider: route }, ran.called ? 502 : 503);
  return logicSse({
    text: ran.content,
    model: ran.model,
    requestedModel: ran.requestedModel,
    route: ran.provider,
    usedIds: assembled.usedIds,
    credentialFallback: ran.credentialFallback,
    contextReceipt: assembled.contextReceipt, skillReceipts: assembled.skillReceipts,
  });
}

export async function handleMindTurn(request: Request): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return json({ ok: false, error: "Forbidden: cross-site request blocked", code: "forbidden_cross_site" }, 403);
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  let userId: string;
  try {
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : sessionErrorStatus(error));
  }
  if (request.method === "GET") {
    const operationId = new URL(request.url).searchParams.get("operationId");
    if (!operationId) return json({ operationId: `${Date.now()}-${crypto.randomUUID()}`, timeoutMs: chatTurnTimeoutMs() });
    if (!turnOperationExpiry(operationId)) return json({ ok: false, error: "This send receipt expired. Review the conversation; nothing was resent." }, 410);
    const gate = envCheck();
    if (!gate.ok) return json({ ok: false, error: gate.error }, 503);
    try {
      const { getSql } = await import("../db");
      const sql = await getSql();
      const state = await readTurnReceipt(sql, userId, operationId);
      const executions = await readModelExecutions(sql, userId, operationId);
      return json({ ownerId: userId, operationId, state, executions });
    } catch { return json({ ok: false, error: "Send verification is temporarily unavailable. Nothing was resent." }, 503); }
  }
  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const operationId = request.headers.get("x-mind-turn-id");
  if (operationId === null) return dispatchMindTurn(request, userId, read.body);
  const expiresAt = turnOperationExpiry(operationId);
  if (!expiresAt) {
    return json({ ok: false, error: "This send ID is invalid or expired. Check your conversation before starting a new send." }, 400);
  }
  const gate = envCheck();
  if (!gate.ok) return json({ ok: false, error: gate.error }, 503);
  let sql: Sql;
  try {
    const { getSql } = await import("../db");
    sql = await getSql();
    const receipt = await claimTurn(sql, userId, operationId, read.body, expiresAt);
    if (receipt !== "claimed") {
      if (receipt === "responded" && read.body.temporary !== true) {
        const recovered = await readTurnRecovery(sql, userId, operationId);
        if (recovered) return recovered;
      }
      const error = receipt === "different"
        ? "This send ID already belongs to a different request."
        : receipt === "waiting"
          ? "An earlier delivery is still processing or its outcome is unknown. Check the conversation before sending again."
          : "This request already reached the app. Check the conversation for its response before sending again.";
      return json({ ok: false, error, code: receipt === "different" ? "request_invalid" : "delivery_unconfirmed", duplicate: receipt !== "different" }, 409);
    }
  } catch {
    return json({ ok: false, error: "Send verification is temporarily unavailable. The provider was not contacted." }, 503);
  }
  let dispatched = false;
  let answerDispatched = false;
  const usage: UsageReceipt = {
    id: `${operationId}/answer`, operationId, stage: "answer", chatId: typeof read.body.chatId === "string" ? read.body.chatId : "",
    channel: read.body.usageChannel === "speak" ? "speak" : read.body.composerMode === "orchestrator" ? "orchestrator" : "chat",
    at: new Date().toISOString(), provider: typeof read.body.provider === "string" ? read.body.provider : "grok",
    requestedModel: typeof read.body.requestedModel === "string" ? read.body.requestedModel : undefined,
    model: "model unknown", requestId: null, promptTokens: null, completionTokens: null,
    outcome: "unconfirmed", dispatched: false,
  };
  const recordUsage = (entry: UsageReceipt) => writeUsageReceipt(sql, userId, entry);
  try {
    await recordUsage(usage);
  } catch {
    // Before dispatch, require a durable execution record. A missing migration or
    // unavailable ledger must not create an unrecorded paid request.
    await finishTurnReceipt(sql, userId, operationId, true).catch(() => undefined);
    const unavailable = json({ ok: false, error: "Execution accounting is unavailable. Nothing was sent. Try again after storage is restored." }, 503);
    unavailable.headers.set("x-mind-dispatch", "none");
    return unavailable;
  }
  let response: Response;
  try {
    response = await dispatchMindTurn(request, userId, read.body, (stage) => { dispatched = true; if (stage === "answer") answerDispatched = true; }, usage, recordUsage, receipt => saveModelExecution(sql, userId, receipt));
  } catch {
    response = json({ ok: false, error: "The request could not be completed. Check the conversation before sending again." }, 503);
  }
  const streaming = response.headers.get("content-type")?.includes("text/event-stream") === true;
  const accounted = { ...usage, dispatched: answerDispatched, outcome: !answerDispatched && !streaming ? "rejected_before_dispatch" as const : response.ok ? "unconfirmed" as const : "failed" as const };
  // Preserve a provider response after dispatch, even if its final accounting
  // write fails. The initial durable record remains explicitly unconfirmed.
  await recordUsage(accounted).catch(() => undefined);
  response.headers.set("x-mind-dispatch", dispatched ? "sent" : streaming ? "pending" : "none");
  if (answerDispatched || !streaming) response.headers.set("x-mind-primary-dispatched", answerDispatched ? "1" : "0");
  else response.headers.delete("x-mind-primary-dispatched");
  response = trackUsageResponse(response, accounted, (receipt) => recordUsage({ ...receipt, dispatched: answerDispatched }));
  // The insert is the protection. A failed audit update must not hide a real reply.
  try {
    await pruneTurnReceipts(sql);
  } catch {
    // The existing receipt keeps later deliveries from starting another call.
  }
  return recoverableTurnResponse({ response, sql, owner: userId, operation: operationId, retain: read.body.temporary !== true && read.body.retainResponse !== false, dispatched: streaming ? () => dispatched : dispatched });
}

async function dispatchMindTurn(request: Request, userId: string, data: Record<string, unknown>, onDispatched: (stage: "answer" | "helper") => void = () => {}, usage?: UsageReceipt, recordUsage?: (receipt: UsageReceipt) => Promise<void>, persistExecution?: (receipt: ConsultExecutionReceipt) => Promise<void>): Promise<Response> {
  let anyDispatched = false;
  const markDispatched = (stage: "answer" | "helper" = "answer") => { anyDispatched = true; onDispatched(stage); };
  if (request.signal.aborted) return json({ ok: false, error: "This send was canceled before it started.", code: "user_stopped" }, 499);
  let body = data as TurnBody;
  const { readHaltState } = await import("./halt.server.ts");
  const checkStop = async () => {
    const state = body.halted === true ? "on" : await readHaltState(userId);
    if (state === "unknown") {
      return json({ ok: false, error: "Emergency stop status is unavailable. Nothing was sent." }, 503);
    }
    if (state === "on") return json({ ok: false, error: "Emergency stop is on. Nothing was sent.", code: "emergency_stop_active" }, 403);
    return null;
  };
  const stopped = await checkStop();
  if (stopped) return stopped;
  const privacy = await applyOwnerMemoryPolicy(userId, body);
  if (!privacy.ok) return json(privacy, 503);
  body = privacy.body;
  // Validate the final request before any consultation can spend provider calls.
  const inputTier = parseModelTierField(body.modelTier);
  if (!inputTier.ok) return json({ ok: false, error: inputTier.error }, 400);
  if (body.memory !== "on" && body.memory !== "off") return json({ ok: false, error: "Memory setting is invalid." }, 400);
  const initialHistory = Array.isArray(body.history) ? body.history.filter(isHistory) : [];
  const initialNotes = Array.isArray(body.memoryContext) ? body.memoryContext.filter(isNote) : [];
  const initialSize = checkTurnSize({ text: typeof body.text === "string" ? body.text : "", history: initialHistory, memoryContext: initialNotes, images: sanitizeAttachments(body.images) });
  if (!initialSize.ok) return json(initialSize, 400);
  if (body.memory === "off" && initialNotes.length) return json({ ok: false, error: "Memory is off. No saved notes or helper requests were sent." }, 400);

  const localOwner = userId === DEV_USER_ID && isLoopbackPreview() && !process.env.VERCEL;
  if (localOwner && adrianPcEnabled() && typeof body.text === "string" && body.text.trim()) {
    const pc = await runAdrianPc({ text: body.text, halted: false });
    if (pc.ran) {
      markDispatched();
      body = { ...body, text: `${body.text}\n\nAdrian PC result: ${pc.output}` };
    }
  }
  if (localOwner && typeof body.text === "string") {
    try {
      ensureLocalCapabilityFile(path.join(process.cwd(), ".data", "local-capabilities.json"));
    } catch {
      /* A read-only disk must not stop the model call. */
    }
    const local = runLocalCommand(body.text);
    if (local) {
      markDispatched();
      const done = { text: local, model: "adrian-local", provider: "Adrian", usage: null, usedIds: [], requestId: null };
      const stream = `event: delta\ndata: ${JSON.stringify({ text: local })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    }
  }
  if (body.freeOnly !== undefined && typeof body.freeOnly !== "boolean") return json({ ok: false, error: "Invalid free-only setting. Nothing was sent." }, 400);
  if (body.freeOnly === true && body.composerMode !== "orchestrator") {
    const selected = typeof body.provider === "string" ? body.provider : "grok";
    if (body.logicRoute || (!selected.startsWith("custom:") && !["openrouter", "nemotron", "ollama"].includes(selected))) {
      return json({ ok: false, error: "Free-only mode does not authorize this provider's pricing. Choose an explicit free or local route. Nothing was sent." }, 400);
    }
    if (selected === "ollama" && !isLocalConsultRunner(process.env.LOCAL_MODEL_URL)) return json({ ok: false, error: "Free-only mode cannot establish that this runner is local. Configure a loopback runner or explicitly allow the selected route. Nothing was sent." }, 400);
  }
  const ratePreflight = createChatTurnPreflight(userId, async () => false, consumeSharedMindRateLimit);
  const taskId = request.headers.get("x-mind-turn-id") || randomUUID();
  let primaryDispatchContext: MonetaryDispatchContext | undefined;
  let primaryReservationId: string | undefined;
  let primaryDispatched = false;
  const markPrimaryDispatched = () => { primaryDispatched = true; markDispatched(); };
  const settlePrimary = (result: DispatchOutcome) => settleDispatchResult(userId, primaryReservationId, result);
  const preflight = async (context = primaryDispatchContext, onReserved?: (id: string | undefined) => void) => {
    if (request.signal.aborted) return json({ ok: false, error: "This send was canceled.", code: "user_stopped" }, 499);
    const stopped = await checkStop(); if (stopped) return stopped;
    if (context) {
      const compatible = await validateEnvironmentModel(userId, context.provider, context.model, { images: context === primaryDispatchContext ? sanitizeAttachments(body.images).length : 0, outputTokens: context === primaryDispatchContext ? primaryOutputTokens : context.provider === "xai" || context.provider === "anthropic" ? 400 : undefined });
      if (!compatible.ok) return json({ ...compatible, ...(!anyDispatched ? { dispatched: false } : {}) }, 409);
    }
    const permission = await assertCurrentMemoryContext(userId, body);
    if (!permission.ok) return json({ ...permission, ...(!anyDispatched ? { dispatched: false } : {}) }, 409);
    const privacy = await assertOwnerMemoryDispatch(userId, initialNotes.length > 0 || Boolean(body.botKnowledge) || (Array.isArray(body.knowledgePassages) && body.knowledgePassages.length > 0) || (body.memory === "on" && Boolean(body.projectInstructions)));
    if (!privacy.ok) return json({ ...privacy, code: "memory_policy_changed" }, 409);
    const rate = await ratePreflight(); if (rate) return rate;
    const reservation = await reserveOwnerDispatch(userId, undefined, undefined, context);
    if (reservation.ok) { if (onReserved) onReserved(reservation.reservationId); else primaryReservationId = reservation.reservationId; }
    // A primary refusal cannot authorize whole-turn replay after a helper or local action ran.
    return reservation.ok ? null : json({ ok: false, error: reservation.error, approvalId: reservation.approvalId, ...(!anyDispatched ? { dispatched: false } : {}) }, reservation.status, reservation.retryAfter === undefined ? undefined : String(reservation.retryAfter));
  };
  if (body.composerMode === "orchestrator") body = { ...body, provider: typeof body.orchestrator === "string" && body.orchestrator ? body.orchestrator : body.provider };
  const earlyLogic = resolveRequestedRoute({ logicRoute: body.logicRoute, provider: body.provider });
  if (!earlyLogic.ok) return json({ ok: false, error: earlyLogic.error }, 400);
  const controls = parseModelControls(body.modelControls);
  if (!controls.ok) return json({ ok: false, error: controls.error }, 400);
  const environment = envCheck();
  if (!environment.ok) return json({ ok: false, error: environment.error }, 503);
  const environmentCatalogs = await listEnvironmentModelCatalogs(userId).catch(() => null);
  if (!environmentCatalogs) return json({ ok: false, error: "Current model catalogue evidence could not be read. No helper was called.", ...(!anyDispatched ? { dispatched: false } : {}) }, 503);
  let selectedCapabilities: ModelCapabilities | undefined;
  let customSelection: { model: string; imageInput: boolean } | undefined;
  if (typeof body.provider === "string" && body.provider.startsWith("custom:")) {
    const selected = parseCustomProviderChoice(body.provider);
    if (!selected.ok) return json({ ok: false, error: selected.error }, 400);
    const valid = await validateCustomProviderSelection(userId, selected, { freeOnly: body.freeOnly === true, options: { images: sanitizeAttachments(body.images), controls: controls.controls } });
    if (!valid.ok) return json({ ok: false, error: valid.error }, 400);
    selectedCapabilities = valid.capabilities;
    customSelection = { model: selected.model, imageInput: valid.capabilities?.imageInput === "supported" };
  }
  const inspectedLogic = earlyLogic.route ? (await inspectLogicRoutes(process.env)).find((item) => item.id === earlyLogic.route) : undefined;
  if (earlyLogic.route && !inspectedLogic) return json({ ok: false, error: "The selected route readiness is unavailable. No helper was called." }, 503);
  const primary = validatePrimaryConfiguration({
    provider: body.provider, requestedModel: body.requestedModel, modelTier: body.modelTier, previousTier: body.previousTier,
    text: typeof body.text === "string" ? body.text.trim() : "", imageCount: sanitizeAttachments(body.images).length,
    controls: controls.controls, memory: body.memory, saveMemory: body.saveMemory, chatId: body.chatId,
    custom: customSelection, logic: inspectedLogic, catalog: catalogForProvider(environmentCatalogs, body.provider || "grok"), xai: body.provider == null || body.provider === "" || body.provider === "grok" ? resolveXaiInferenceApiKey(process.env) : { ok: false },
  }, process.env);
  if (!primary.ok) return json({ ok: false, error: primary.error }, primary.status);
  const primaryOutputTokens = controls.controls.answerTokens ?? (primary.provider === "grok" ? resolveModelTier(body.modelTier, typeof body.text === "string" ? body.text : "image", process.env, { controls: controls.controls, previousTier: ["Fast", "Expert", "Heavy", "Build"].includes(String(body.previousTier)) ? body.previousTier as Exclude<import("./model-tiers").ModelTier, "Auto"> : undefined }).params.max_tokens : primary.provider === "anthropic" ? 400 : undefined);
  const primaryReadiness = await validateEnvironmentModel(userId, primary.provider, primary.model, { images: sanitizeAttachments(body.images).length, outputTokens: primaryOutputTokens });
  if (!primaryReadiness.ok) return json({ ...primaryReadiness, ...(!anyDispatched ? { dispatched: false } : {}) }, 409);
  if (!customSelection && "capabilities" in primaryReadiness) selectedCapabilities = primaryReadiness.capabilities;
  const initialText = typeof body.text === "string" && body.text.trim() ? body.text.trim() : "Describe the attached image.";
  const contextValidation = directTurnContext(body, initialText, initialHistory, "", { model: primary.model, capabilities: selectedCapabilities, supportsImages: primary.supportsImages });
  if (!contextValidation.ok) return json(contextValidation, 400);
  if (customSelection) {
    const nativeValidation = toNativeProviderTurns(contextValidation.messages);
    if (!nativeValidation.ok) return json(nativeValidation, 400);
  }
  const setPrimaryContext = (messages: unknown, model = primary.model) => {
    primaryDispatchContext = dispatchContext({ operationId: taskId, taskId, projectId: body.projectId,
      provider: financialProviderId(primary.provider), model, stage: "primary",
      args: { messages, model, controls: controls.controls, chatId: body.chatId, saveMemory: body.saveMemory },
      textOnly: !contextValidation.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url")),
    });
  };
  setPrimaryContext(contextValidation.messages);
  const executions: ConsultExecutionReceipt[] = [];
  let consultHelp = "";
  let consultation: Awaited<ReturnType<typeof collectConsultHelp>> = [];
  if (body.composerMode === "orchestrator") {
    const asked = typeof body.text === "string" ? body.text.trim() : "";
    const orchestrator = typeof body.orchestrator === "string" && body.orchestrator
      ? body.orchestrator
      : typeof body.provider === "string" ? body.provider : "";
    const modules = await modulesConnectedNow(userId);
    const consult = body.consult && typeof body.consult === "object" ? body.consult as { helpers?: unknown; helperIds?: unknown; allowPaidHelpers?: unknown } : null;
    const requested = consult?.helperIds ?? (Array.isArray(consult?.helpers) ? consult.helpers.map((row) => row?.id) : []);
    if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string")) {
      return json({ ok: false, error: "The helper selection is invalid. Nothing was sent." }, 400);
    }
    const planned = planModelConsult({ orchestrator, modules, question: asked, helperIds: requested, allowPaidHelpers: consult?.allowPaidHelpers === true, freeOnly: body.freeOnly === true });
    if (!planned.ok) return json({ ok: false, error: planned.error, provider: orchestrator }, 400);
    if (sanitizeAttachments(body.images).length && planned.plan.orchestrator !== "grok" && !planned.plan.orchestrator.startsWith("custom:")) {
      return json({
        ok: false,
        error: "That connected model cannot see images in this app. Remove the images or choose a connected model that can. Another model was not substituted.",
        provider: planned.plan.orchestrator,
      }, 400);
    }
    const help = await collectConsultHelp(planned.plan, async (id, requestText) => {
      const configured = await validateHelperConfiguration(userId, id, requestText);
      if (!configured.ok) return { ok: false, dispatched: false, text: "", error: configured.error };
      const entry = usage ? { ...usage, id: `${usage.operationId}/helper:${id}`, stage: `helper:${id}`,
        provider: configured.provider, requestedModel: configured.model } : undefined;
      if (entry && recordUsage) {
        try { await recordUsage(entry); } catch { return { ok: false, dispatched: false, text: "", error: "Helper accounting is unavailable. Nothing was sent." }; }
      }
      let helperReservationId: string | undefined;
      const context = dispatchContext({ operationId: taskId, taskId, projectId: body.projectId, provider: financialProviderId(configured.provider), model: configured.model,
        stage: `helper-${id}`, args: { text: requestText, model: configured.model, system: ADRIAN_MIND_IDENTITY }, textOnly: true });
      const denied = await preflight(context, id => { helperReservationId = id; });
      if (denied) {
        if (entry && recordUsage) await recordUsage({ ...entry, outcome: "rejected_before_dispatch" }).catch(() => undefined);
        const detail = await denied.json().catch(() => ({})) as { error?: string; approvalId?: string };
        return { ok: false, dispatched: false, text: "", error: detail.error || "Execution stopped before this helper was called.", approvalId: detail.approvalId };
      }
      let sent = false;
      const result = await runSettledDispatch(userId, helperReservationId, async () => {
        const answer = await askConnectedModule(userId, id, requestText, () => { sent = true; markDispatched("helper"); }, request.signal, { freeOnly: body.freeOnly === true });
        return { ...answer, dispatched: sent };
      });
      if (entry && recordUsage) await recordUsage({ ...entry, dispatched: sent, outcome: result.ok ? "completed" : sent ? "unconfirmed" : "rejected_before_dispatch",
        model: result.model || "model unknown", requestId: result.requestId ?? null, promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null }).catch(() => undefined);
      return { ...result, requestedModel: configured.model, executionLocation: id === "ollama" && isLocalConsultRunner(process.env.LOCAL_MODEL_URL) ? "local" : "hosted" };
    }, { parentOperationId: taskId, onReceipt: async receipt => {
      executions.push(receipt);
      await persistExecution?.(receipt).catch(() => undefined);
    } });
    consultation = help;
    consultHelp = orchestratorInstruction(planned.plan, help);
    body = { ...body, provider: planned.plan.orchestrator, logicRoute: undefined };
  }
  // Return known helper receipts immediately, before the primary can fail or be canceled.
  const finishPrimary = async (): Promise<Response> => {
    const tierField = parseModelTierField(body.modelTier);
    if (!tierField.ok) return json({ ok: false, error: tierField.error }, 400);
    const logicField = resolveRequestedRoute({ logicRoute: body.logicRoute, provider: body.provider });
    if (!logicField.ok) return json({ ok: false, error: logicField.error }, 400);
    if (logicField.route) return handleLogicTurn(userId, body, logicField.route, preflight, markPrimaryDispatched, settlePrimary);
    if (typeof body.provider === "string" && body.provider.startsWith("custom:")) {
      const chosen = parseCustomProviderChoice(body.provider);
      if (!chosen.ok) return json(chosen, 400);
      const { haltIsOn } = await import("./halt.server.ts");
      if (await haltIsOn(userId) || body.halted === true) return json({ ok: false, error: "Emergency stop is on." }, 403);
      const images = sanitizeAttachments(body.images);

      const text = typeof body.text === "string" && body.text.trim() ? body.text.trim() : images.length ? "Describe the attached image." : "";
      if (!text) return json({ ok: false, error: "Write a message first." }, 400);
      const memory = body.memory === "on" ? "on" : body.memory === "off" ? "off" : null;
      if (!memory) return json({ ok: false, error: "Invalid memory setting." }, 400);
      const history = Array.isArray(body.history) ? body.history.filter(isHistory) : [];
      const memoryContext = Array.isArray(body.memoryContext) ? body.memoryContext.filter(isNote) : [];
      const sized = checkTurnSize({ text, history, memoryContext, images: [] });
      if (!sized.ok) return json(sized, 400);
      const gate = envCheck();
      if (!gate.ok) return json({ ok: false, error: gate.error }, 503);
      const assembled = assembleTurn({ memory, history, text, memoryContext, images, personalityId: body.personalityId, customPersonality: body.customPersonality, botKnowledge: body.botKnowledge, skillApplications: body.skillApplications, projectContext: body.projectContext, knowledgePassages: body.knowledgePassages, projectInstructions: body.projectInstructions, contextOptions: { model: chosen.model, contextWindowTokens: selectedCapabilities?.contextWindowTokens, maxInputTokens: selectedCapabilities?.maxInputTokens, outputTokens: controls.controls.answerTokens, supportsImages: selectedCapabilities?.imageInput === "supported", selectedImageMessageIds: Array.isArray(body.selectedImageMessageIds) ? body.selectedImageMessageIds.filter((id): id is string => typeof id === "string") : [] }, checkpoints: readCheckpoints(body.checkpoints), consultHelp });
      if (!assembled.ok) return json({ ok: false, error: assembled.error }, 400);
      const formatted = toNativeProviderTurns(assembled.messages);
      if (!formatted.ok) return json({ ok: false, error: formatted.error }, 400);
      setPrimaryContext(assembled.messages, chosen.model);
      const blocked = await preflight();
      if (blocked) return blocked;
      return providerResponse((onDelta, signal) => runSettledDispatch(userId, primaryReservationId, () => executeCustomChat(userId, chosen, formatted.messages, signal, { onDelta, onDispatch: markPrimaryDispatched, freeOnly: body.freeOnly === true, options: { controls: controls.controls } })), (result) => result.ok ? { text: result.text, model: result.model, provider: result.provider, requestedModel: chosen.model, usedIds: assembled.usedIds, contextReceipt: assembled.contextReceipt, skillReceipts: assembled.skillReceipts, consultation, usage: result.usage, requestId: result.requestId, responseId: result.responseId, actualCostMicros: result.actualCostMicros, currency: result.currency, delivery: result.delivery } : {}, request.signal);
    }
    const pendingImages = sanitizeAttachments(body.images);
    const requestedProvider = body.provider == null || body.provider === "" ? "grok" : body.provider;
    // Prefer vision honesty over missing-key when a non-Grok provider is requested with images.
    if (pendingImages.length > 0 && typeof requestedProvider === "string" && requestedProvider !== "grok") {
      return json({
        ok: false,
        error: `${requestedProvider} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
        provider: requestedProvider,
      }, 400);
    }
    const selected = selectProvider(body.provider, process.env);
    if (selected.ok && selected.id !== "grok" && typeof body.requestedModel === "string" && body.requestedModel !== selected.model) {
      return json({ ok: false, error: "The configured model changed. Choose the current model before sending again." }, 409);
    }
    if (requestedProvider === "nemotron" || requestedProvider === "ollama" || requestedProvider === "openrouter") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json({ ok: false, error: "Write a message first." }, 400);
      const history = Array.isArray(body.history) ? body.history.filter(isHistory) : [];
      const context = directTurnContext(body, text, history, consultHelp, { model: primary.model, capabilities: selectedCapabilities });
      if (!context.ok) return json(context, 400);
      if ((requestedProvider === "nemotron" || requestedProvider === "openrouter") && !process.env.OPENROUTER_API_KEY?.trim()) {
        return json({ ok: false, error: "OpenRouter is selected, but no OpenRouter key is connected. Nothing was sent.", provider: requestedProvider }, 503);
      }
      setPrimaryContext(context.messages);
      const blocked = await preflight();
      if (blocked) return blocked;
      return providerResponse(async (onDelta, signal) => {
        const routed = await runSettledDispatch(userId, primaryReservationId, () => routeSelectedModel({
          id: requestedProvider, systemPrompt: context.systemPrompt, history: context.history,
          controls: controls.controls, prompt: text, env: process.env, signal, onDelta, onDispatch: markPrimaryDispatched, fetch: globalThis.fetch,
        }));
        return { ...routed, provider: requestedProvider === "nemotron" ? "openrouter" : requestedProvider };
      }, result => ({ text: result.text, model: result.model, requestedModel: result.requestedModel, provider: result.provider,
        usage: result.usage ?? null, actualCostMicros: result.actualCostMicros, currency: result.currency,
        usedIds: context.usedIds, contextReceipt: context.contextReceipt, skillReceipts: context.skillReceipts, consultation,
        delivery: result.delivery || "buffered", requestId: result.requestId ?? null }), request.signal);
    }
    if (!selected.ok) {
      // If images somehow accompany a failed non-Grok selection, still prefer cannot-see copy.
      if (pendingImages.length > 0 && requestedProvider !== "grok") {
        return json({
          ok: false,
          error: `${requestedProvider} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
          provider: requestedProvider,
        }, 400);
      }
      return json(selected, httpStatusForProviderSelection(selected.error));
    }
    if (selected.id !== "grok") {
      if (pendingImages.length > 0) {
        return json({
          ok: false,
          error: `${selected.id} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
          provider: selected.id,
        }, 400);
      }
      const { haltIsOn } = await import("./halt.server");
      if ((await haltIsOn(userId)) || body.halted === true) return json({ ok: false, error: "Emergency stop is on. No new action can run." }, 403);
      const key = process.env[selected.id === "openai" ? "OPENAI_API_KEY" : selected.id === "anthropic" ? "ANTHROPIC_API_KEY" : selected.id === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"] ?? "";
      const history = Array.isArray(body.history)
        ? body.history.filter(isHistory).map((item) => ({ role: item.role, content: item.content }))
        : [];
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json({ ok: false, error: "Write a message first." }, 400);
      const context = directTurnContext(body, text, history, consultHelp, { model: primary.model, capabilities: selectedCapabilities });
      if (!context.ok) return json(context, 400);
      // Only a validated final request reserves a provider dispatch.
      setPrimaryContext(context.messages);
      const blocked = await preflight();
      if (blocked) return blocked;
      const selectedProvider = selected.id;
      return providerResponse(async (onDelta, signal) => {
        const called = await runSettledDispatch(userId, primaryReservationId, () => callConfiguredProvider({
          onDispatch: markPrimaryDispatched,
          id: selectedProvider, model: selected.model, key, prompt: text, systemPrompt: context.systemPrompt,
          history: context.history, controls: controls.controls, signal, onDelta, fetch: globalThis.fetch,
        }));
        return { ...called, provider: selected.id };
      }, result => ({ text: result.text, model: reportedModel(result.model), requestedModel: selected.model, provider: result.provider,
        usage: result.usage ?? null, actualCostMicros: result.actualCostMicros, currency: result.currency,
        usedIds: context.usedIds, contextReceipt: context.contextReceipt, skillReceipts: context.skillReceipts, consultation,
        delivery: result.delivery || "buffered", requestId: result.requestId ?? null }), request.signal);
    }
    const prepared = await prepareMindTurnWithHelp(userId, body, consultHelp);
    if (!prepared.ok) return json(prepared);
    const keyed = resolveXaiInferenceApiKey(process.env);
    if (!keyed.ok) {
      return json({ ok: false, error: keyed.error, provider: "grok" }, 503);
    }
    setPrimaryContext(prepared.assembled.messages, prepared.model);
    const blocked = await preflight();
    if (blocked) return blocked;
    const apiKey = keyed.key;
    let memorySaved = false;
    let savedMemoryId: string | null = null;
    const { shouldPersistTurnMemory, memorySignalFromSave } = await import("./memory/signal");
    if (shouldPersistTurnMemory({ memory: prepared.memory, saveText: prepared.saveMemoryText })) {
      const { getSql } = await import("../db");
      const { createOwnerMemory } = await import("./memory/owner-ops");
      markDispatched();
      const saved = await createOwnerMemory(await getSql(), userId, {
        scope: "chat",
        text: prepared.saveMemoryText,
        source: "turn",
        projectId: null,
        chatId: prepared.chatId,
      });
      const signal = memorySignalFromSave(saved.ok ? { ok: true, id: saved.item.id } : { ok: false });
      memorySaved = signal.memorySaved;
      savedMemoryId = signal.savedMemoryId;
    }
    return relayModelStream({
      onDispatch: markPrimaryDispatched,
      onSettled: settlePrimary,
      apiKey,
      model: prepared.model,
      messages: prepared.assembled.messages,
      usedIds: prepared.assembled.usedIds,
      requestSignal: request.signal,
      timeoutMs: chatTurnTimeoutMs(),
      params: {
        temperature: prepared.modelTier.params.temperature,
        max_tokens: prepared.modelTier.params.max_tokens,
        reasoning_effort: prepared.modelTier.params.reasoning_effort,
      },
      meta: {
        contextReceipt: prepared.assembled.contextReceipt,
        skillReceipts: prepared.assembled.skillReceipts,
        consultation,
        delivery: "streamed",
        modelTier: prepared.modelTier.selected,
        resolvedTier: prepared.modelTier.resolved,
        tierReason: prepared.modelTier.reason,
        images: prepared.images.length,
        memorySaved,
        savedMemoryId,
      },
    });
  };
  const safePrimary = async () => {
    try { return await finishPrimary(); }
    catch { await settlePrimary({ ok: false, dispatched: primaryDispatched }); return json({ ok: false, code: "unknown", error: "The selected request could not be completed. Its outcome is retained for review.", consultation }, 502); }
  };
  const finished = consultation.length ? consultationResponse(safePrimary, consultation, request.signal) : await safePrimary();
  return withExecutionReceipts(finished, executions);
}

/** Exported for scripts/tests that build a multimodal Direct turn without the HTTP handler. */
export type { ImageAttachment };

async function modulesConnectedNow(userId: string) {
  const modules = builtinModules({
    grokConfigured: resolveXaiInferenceApiKey(process.env).ok,
    providers: configuredProviders(process.env),
    localRunner: Boolean(process.env.LOCAL_MODEL_URL),
    localRunnerUrl: process.env.LOCAL_MODEL_URL,
    openrouterModel: process.env.OPENROUTER_MODEL,
    ollamaModel: process.env.OLLAMA_MODEL,
  });
  try {
    const { listAiProviders } = await import("./ai-provider-config.server.ts");
    const saved = await listAiProviders(userId);
    modules.push(...customModules(saved));
  } catch {
    /* A disconnected custom list is not invented. */
  }
  return modules;
}

async function validateHelperConfiguration(userId: string, id: string, text: string, requestedGrokModel = "grok-4.5"): Promise<{ ok: true; provider: string; model: string } | { ok: false; error: string }> {
  if (id.startsWith("custom:")) {
    const selected = parseCustomProviderChoice(id);
    if (!selected.ok) return selected;
    const valid = await validateCustomProviderSelection(userId, selected);
    return valid.ok ? { ok: true, provider: id, model: selected.model } : valid;
  }
  const selected = validatePrimaryConfiguration({ provider: id, requestedModel: id === "grok" ? requestedGrokModel : undefined, text, imageCount: 0, controls: {}, memory: "off", xai: id === "grok" ? resolveXaiInferenceApiKey(process.env) : { ok: false } }, process.env);
  if (!selected.ok) return selected;
  const readiness = await validateEnvironmentModel(userId, selected.provider, selected.model, { outputTokens: id === "grok" || id === "anthropic" ? 400 : undefined });
  return readiness.ok ? selected : readiness;
}

export async function callFleetProvider(userId: string, id: string, requestText: string, onDispatch: () => void, signal: AbortSignal, options: { operationId: string; tier?: import("./model-tiers.ts").ModelTier; freeOnly: boolean }): Promise<ConsultReply> {
  const model = id === "grok" ? resolveModelTier(options.tier ?? "Expert", requestText, process.env).model : undefined;
  const configured = await validateHelperConfiguration(userId, id, requestText, model);
  if (!configured.ok) return { ok: false, text: "", error: configured.error };
  const free = id === "nemotron" || (id === "openrouter" && isOpenRouterFreeModel(configured.model))
    || (id === "ollama" && isLocalConsultRunner(process.env.LOCAL_MODEL_URL));
  if (options.freeOnly && !free) return { ok: false, text: "", error: "This route has no verified free price for the selected model." };
  const context = dispatchContext({ operationId: options.operationId, provider: financialProviderId(configured.provider), model: configured.model,
    stage: "agent", args: { text: requestText, model: configured.model, system: ADRIAN_MIND_IDENTITY }, textOnly: true });
  signal.throwIfAborted();
  const reservation = await reserveOwnerDispatch(userId, undefined, undefined, context);
  if (!reservation.ok) return { ok: false, text: "", error: reservation.error };
  return runSettledDispatch(userId, reservation.reservationId, async () => {
    let dispatched = false;
    if (signal.aborted || await readHaltState(userId) !== "off") return { ok: false, text: "", error: "Execution stopped before the provider call.", dispatched };
    const answer = await askConnectedModule(userId, id, requestText, () => { dispatched = true; onDispatch(); }, signal, { freeOnly: options.freeOnly, model });
    return { ...answer, dispatched };
  });
}

async function askConnectedModule(userId: string, id: string, requestText: string, onDispatch: () => void, signal: AbortSignal, options: { freeOnly?: boolean; model?: string } = {}): Promise<ConsultReply> {
  const transport: typeof fetch = (...args) => {
    signal.throwIfAborted();
    onDispatch();
    return fetch(...args);
  };
  if (id.startsWith("custom:")) {
    const chosen = parseCustomProviderChoice(id);
    if (!chosen.ok) return { ok: false, text: "" };
    const result = await executeCustomChat(userId, chosen, [
      { role: "system", content: ADRIAN_MIND_IDENTITY },
      { role: "user", content: requestText },
    ], signal, { onDispatch, freeOnly: options.freeOnly });
    return { ok: result.ok, text: result.ok ? result.text : "", ...(!result.ok ? { error: result.error } : {}), model: result.model, provider: result.provider, usage: result.usage, requestId: result.requestId, responseId: result.responseId, actualCostMicros: result.actualCostMicros, currency: result.currency };
  }
  if (id === "grok") {
    const keyed = resolveXaiInferenceApiKey(process.env);
    if (!keyed.ok) return { ok: false, text: "" };
    try {
      const res = await transport("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${keyed.key}` },
        body: JSON.stringify({
          model: options.model ?? "grok-4.5",
          messages: [
            { role: "system", content: ADRIAN_MIND_IDENTITY },
            { role: "user", content: requestText },
          ],
          max_tokens: 400,
          stream: false,
        }),
      });
      if (!res.ok) return { ok: false, text: "", error: `Helper provider rejected this request (HTTP ${res.status}).` };
      const parsed = readModelPayload(await res.text());
      return { ok: Boolean(parsed.text), text: parsed.text, model: parsed.model, provider: "xai", usage: parsed.usage, requestId: res.headers.get("x-request-id") };
    } catch {
      return { ok: false, text: "" };
    }
  }
  if (id === "nemotron" || id === "ollama" || id === "openrouter") {
    const result = await routeSelectedModel({ id, prompt: requestText, env: process.env, signal, fetch: transport });
    return { ok: result.ok, text: result.text, error: result.error, model: result.model, provider: id, usage: result.usage, requestId: result.requestId, responseId: result.responseId, actualCostMicros: result.actualCostMicros, currency: result.currency };
  }
  const selected = selectProvider(id, process.env);
  if (!selected.ok || selected.id === "grok") return { ok: false, text: "" };
  const keyName = selected.id === "openai" ? "OPENAI_API_KEY" : selected.id === "anthropic" ? "ANTHROPIC_API_KEY" : selected.id === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
  const key = process.env[keyName] ?? "";
  if (!key) return { ok: false, text: "" };
  const called = await callConfiguredProvider({
    id: selected.id,
    model: selected.model,
    key,
    prompt: requestText,
    systemPrompt: ADRIAN_MIND_IDENTITY,
    signal,
    fetch: transport,
  });
  return { ok: called.ok, text: called.text, error: called.error, model: called.model, provider: selected.id, usage: called.usage, requestId: called.requestId, responseId: called.responseId, actualCostMicros: called.actualCostMicros, currency: called.currency };
}
