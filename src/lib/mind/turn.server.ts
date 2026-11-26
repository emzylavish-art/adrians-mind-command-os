import { modelExecutionPlan, type ModelExecutionPlan } from "./execution-plan.ts";
import { withFailureEnvelope } from "./failure-envelope.ts";
import { DEV_USER_ID, isLoopbackPreview, requireUserId } from "../auth/verify.server";
import { guardMindEnv } from "./isolation";
import { checkTurnSize, createChatTurnPreflight } from "./limits";
import { assembleTurn } from "./prompt";
import { sanitizeAttachments, type ImageAttachment } from "./media";
import type { ChatContent } from "./media/types";
import { resolveXaiInferenceApiKey } from "./xai-adapter";
import type { HistoryInputMessage } from "./media/history";
import { allowedModelIds, isConnectedGrokModel, resolveModelTier, type ResolvedModelTier } from "./model-tiers";
import { assertLiveProvider } from "./providers";
import { callConfiguredProvider, httpStatusForProviderSelection, routeSelectedModel, selectProvider } from "./provider-call";
import { configuredProviders } from "./provider-call";
import { ADRIAN_MIND_IDENTITY, builtinModules, executeConsultPlan, type HelperReceipt, type HelperReply, customModules, orchestratorInstruction, planModelConsult } from "./model-consult.ts";
import { adrianPcEnabled, runAdrianPc } from "./adrian-pc.server.ts";
import { ownerScreenshotReader } from "./pc-vision.server.ts";
import { consequentialSpeechRefusal } from "./frontier-2031.ts";
import { destructiveSpeechRefusal } from "./reversibility.ts";
import { ensureLocalCapabilityFile, runLocalCommand } from "./local-capabilities.ts";
import path from "node:path";
import { buildRelayModelBody, relayModelStream } from "./relay";
import { chatTurnTimeoutMs } from "./turn-timeouts";
import { decideFetchSite } from "./request-guard";
import { parseModelTierField, readJsonObjectBody } from "./request-body";
import { readModelPayload, reportedModel } from "./stream";
import { resolveDatabaseUrl } from "../env.server.ts";
import { LOGIC_ROUTE_LABEL, resolveRequestedRoute, toAdapterMessages, type LogicRouteId } from "./logic-routes.ts";
import { inspectLogicRoutes, runLogicRoute } from "./logic-route-adapter.server.ts";
import { parseCustomProviderChoice, executeCustomChat } from "./ai-provider-config.server.ts";
import { claimTurn, pruneTurnReceipts, turnOperationExpiry } from "./turn-receipt.ts";
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
  composerMode?: unknown;
  orchestrator?: unknown;
  consultHelpers?: unknown;
  maxHelpers?: unknown;
  freeOnly?: unknown;
  temporary?: unknown;
  memoryPolicyRevision?: unknown;
  contextPolicy?: unknown;
  projectContext?: unknown;
};

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

function directTurnContext(body: TurnBody, text: string, history: HistoryInputMessage[], consultHelp: string, skillInstructions = "") {
  if (body.memory !== undefined && body.memory !== "on" && body.memory !== "off") return { ok: false as const, error: "Invalid memory setting." };
  const memoryContext = Array.isArray(body.memoryContext) ? body.memoryContext.filter(isNote).slice(0, 12) : [];
  const sized = checkTurnSize({ text, history, memoryContext, images: [] });
  if (!sized.ok) return sized;
  const assembled = assembleTurn({ text, history: [], memory: body.memory === "on" ? "on" : "off", memoryContext,
    personalityId: body.personalityId, customPersonality: body.customPersonality, botKnowledge: body.botKnowledge, projectContext: body.projectContext, instructionContext: skillInstructions, consultHelp });
  if (!assembled.ok) return assembled;
  return { ok: true as const, systemPrompt: String(assembled.messages[0].content), usedIds: assembled.usedIds };
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

export async function prepareMindTurnWithHelp(userId: string, data: TurnBody, consultHelp = "", resolvedInstructions?: LoadedInstruction[]) {
  const { haltIsOn } = await import("./halt.server");
  if ((await haltIsOn(userId)) || data.halted === true) {
    return { ok: false as const, error: "Emergency stop is on. No new action can run." };
  }
  const permission = await assertCurrentMemoryContext(userId, data);
  if (!permission.ok) return permission;
  let instructions: LoadedInstruction[];
  try { instructions = resolvedInstructions ?? await resolveTurnInstructions(userId, data.chatId); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Assigned instructions could not be verified." }; }
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
  const history = Array.isArray(data.history) ? data.history.filter(isHistory).slice(-12) : [];
  const memoryContext = Array.isArray(data.memoryContext) ? data.memoryContext.filter(isNote).slice(0, 12) : [];
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
  const assembled = assembleTurn({
    memory,
    history,
    text: text || "Describe the attached image.",
    memoryContext,
    images,
    personalityId: data.personalityId,
    customPersonality: data.customPersonality,
    botKnowledge: data.botKnowledge,
    projectContext: data.projectContext,
    instructionContext: instructionContext(instructions),
    consultHelp,
  });
  if (!assembled.ok) return { ok: false as const, error: assembled.error };
  const tier = resolveModelTier(data.modelTier, text || "image", process.env);
  const requested = isConnectedGrokModel(data.requestedModel) ? data.requestedModel : null;
  if (requested) tier.model = requested;
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
    dispatchBody: data,
    instructions,
  };
}

export async function completeModelReply(prepared: {
  assembled: { messages: { role: "system" | "user" | "assistant"; content: ChatContent }[]; usedIds: string[] };
  memory: "off" | "on";
  model: string;
  modelTier: ResolvedModelTier;
  userId: string;
  dispatchBody?: TurnBody;
  instructions?: LoadedInstruction[];
}) {
  if (!allowedModelIds(process.env).has(prepared.model)) {
    return { ok: false as const, error: "That model is not available. Another provider is not substituted." };
  }
  const keyed = resolveXaiInferenceApiKey(process.env);
  if (!keyed.ok) return { ok: false as const, error: keyed.error };
  const apiKey = keyed.key;
  const permission = await assertCurrentMemoryContext(prepared.userId, prepared.dispatchBody ?? {});
  if (!permission.ok) return permission;
  const ran = await governedModelCall({ owner: prepared.userId, taskId: crypto.randomUUID(), provider: "grok", model: prepared.model,
    inputChars: JSON.stringify(prepared.assembled.messages).length, outputTokens: prepared.modelTier.params.max_tokens,
    freeOnly: prepared.dispatchBody?.freeOnly === true,
    call: async () => {
      if (prepared.instructions?.length) await recordLoadedInstructions(prepared.userId, prepared.instructions);
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(25_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildRelayModelBody(prepared.model, prepared.assembled.messages, {
          temperature: prepared.modelTier.params.temperature, max_tokens: prepared.modelTier.params.max_tokens, reasoning_effort: prepared.modelTier.params.reasoning_effort,
        })),
      });
      const raw = await response.text();
      const parsed = readModelPayload(raw);
      return { ok: response.ok, response: new Response(raw, { status: response.status, headers: response.headers }), usage: parsed.usage, requestId: response.headers.get("x-request-id") };
    },
  });
  if (!ran.ok) return { ok: false as const, error: "error" in ran ? ran.error : "The selected provider did not complete this request." };
  const res = ran.response;
  if (!res.ok) return { ok: false as const, error: `Grok returned ${res.status}. Nothing was saved as a success.` };
  const parsed = readModelPayload(await res.text());
  if (!parsed.text) return { ok: false as const, error: "Grok returned an empty reply." };
  return {
    ok: true as const,
    text: parsed.text,
    model: reportedModel(parsed.model),
    modelTier: prepared.modelTier.selected,
    resolvedTier: prepared.modelTier.resolved,
    tierReason: prepared.modelTier.reason,
    requestId: res.headers.get("x-request-id"),
    usage: parsed.usage,
    memory: prepared.memory,
    usedIds: prepared.assembled.usedIds,
    memorySaved: false as const,
    savedMemoryId: null as string | null,
  };
}

function json(body: unknown, status = 200, retryAfter?: string) {
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
  const delay = Number.isFinite(seconds) && seconds >= 0 && seconds <= 604_800 ? new Date(Date.now() + seconds * 1000).toISOString() : undefined;
  return new Response(JSON.stringify(withFailureEnvelope(body, { subsystem: "chat", status, operationKind: "generation", ...(delay ? { retryAfterAt: delay } : {}) })), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
  });
}

function logicSse(input: {
  text: string;
  model: string;
  requestedModel: string | null;
  route: LogicRouteId;
  usedIds: string[];
  credentialFallback: "OPENAI_API_KEY" | null;
  resourceOperationId?: string;
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
    resourceOperationId: input.resourceOperationId,
    executionPlan: modelExecutionPlan("independent", [input.route]),
    credentialFallback: input.credentialFallback,
    tierReason: `Owner selected ${label}.`,
  };
  const body = `event: delta\ndata: ${JSON.stringify({ text: input.text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}

async function handleLogicTurn(userId: string, data: TurnBody, route: LogicRouteId, preflight: () => Promise<Response | null>, markDispatched: () => void, taskId: string, signal: AbortSignal, instructions: LoadedInstruction[]): Promise<Response> {
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
  const history = Array.isArray(data.history) ? data.history.filter(isHistory).slice(-12) : [];
  const memoryContext = Array.isArray(data.memoryContext) ? data.memoryContext.filter(isNote).slice(0, 12) : [];
  const sized = checkTurnSize({ text, history, memoryContext, images: [] });
  if (!sized.ok) return json(sized, 400);
  const memory: "off" | "on" | null = data.memory === "on" ? "on" : data.memory === "off" ? "off" : null;
  if (!memory) return json({ ok: false, error: "Memory setting is invalid." }, 400);
  const gate = envCheck();
  if (!gate.ok) return json({ ok: false, error: gate.error });
  const assembled = assembleTurn({ memory, history, text, memoryContext, images: [], personalityId: data.personalityId, customPersonality: data.customPersonality, botKnowledge: data.botKnowledge, projectContext: data.projectContext, instructionContext: instructionContext(instructions) });
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
  const ran = await governedModelCall({ owner: userId, taskId, provider: route, model: view.model || route, unknownTokens: true, unknownCost: true, inputChars: JSON.stringify(flat.messages).length, freeOnly: data.freeOnly === true, signal, call: async () => { if (instructions.length) await recordLoadedInstructions(userId, instructions, taskId); return runLogicRoute({
    signal,
    route,
    messages: flat.messages,
    env: process.env,
    inspect: async () => inspected,
  }); } });
  if (!ran.ok) return json({ ok: false, error: ran.error, logicRoute: route, provider: route }, "called" in ran && ran.called ? 502 : 503);
  return logicSse({
    text: ran.content,
    model: ran.model,
    requestedModel: ran.requestedModel,
    route: ran.provider,
    usedIds: assembled.usedIds,
    credentialFallback: ran.credentialFallback,
    resourceOperationId: ran.resourceOperationId,
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
    return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  let userId: string;
  try {
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
  if (request.method === "GET") return json({ operationId: `${Date.now()}-${crypto.randomUUID()}` });
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
      return json({ ok: false, error, duplicate: receipt !== "different" }, 409);
    }
  } catch {
    return json({ ok: false, error: "Send verification is temporarily unavailable. The provider was not contacted." }, 503);
  }
  let dispatched = false;
  const response = await dispatchMindTurn(request, userId, read.body, () => { dispatched = true; });
  // The insert is the protection. A failed audit update must not hide a real reply.
  try {
    await pruneTurnReceipts(sql);
  } catch {
    // The existing receipt keeps later deliveries from starting another call.
  }
  return recoverableTurnResponse({ response, sql, owner: userId, operation: operationId, retain: read.body.temporary !== true && read.body.retainResponse !== false, dispatched });
}

async function dispatchMindTurn(request: Request, userId: string, data: Record<string, unknown>, markDispatched: () => void = () => {}): Promise<Response> {
  if (request.signal.aborted) return json({ ok: false, error: "This send was canceled before it started." }, 499);
  let body = data as TurnBody;
  const { readHaltState } = await import("./halt.server.ts");
  const checkStop = async () => {
    const state = body.halted === true ? "on" : await readHaltState(userId);
    if (state === "unknown") {
      return json({ ok: false, error: "Emergency stop status is unavailable. Nothing was sent." }, 503);
    }
    if (state === "on") return json({ ok: false, error: "Emergency stop is on. Nothing was sent." }, 403);
    return null;
  };
  const stopped = await checkStop();
  if (stopped) return stopped;
  const localOwner = userId === DEV_USER_ID && isLoopbackPreview() && !process.env.VERCEL;
  if (localOwner && adrianPcEnabled() && typeof body.text === "string" && body.text.trim()) {
    const pc = await runAdrianPc({ text: body.text, halted: false, readImage: ownerScreenshotReader(userId) });
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
  const helperReceipts: HelperReceipt[] = [];
  const withHelperReceipts = async (response: Response | null) => response && helperReceipts.length ? json({ ...await response.json(), helperReceipts }, response.status, response.headers.get("retry-after") ?? undefined) : response;
  const ratePreflight = createChatTurnPreflight(userId, async () => false);
  const preflight = async () => {
    if (request.signal.aborted) return withHelperReceipts(json({ ok: false, error: "This send was canceled before dispatch." }, 499));
    const stop = await checkStop();
    if (stop) return withHelperReceipts(stop);
    const memory = await assertCurrentMemoryContext(userId, body);
    if (!memory.ok) return withHelperReceipts(json(memory, 409));
    return withHelperReceipts(await ratePreflight());
  };
  const taskId = request.headers.get("x-mind-turn-id") || crypto.randomUUID();
  let instructions: LoadedInstruction[];
  try { instructions = await resolveTurnInstructions(userId, body.chatId); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Assigned instructions could not be verified." }, 409); }
  const skillInstructions = instructionContext(instructions);
  const govern = <T extends { ok: boolean; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; requestId?: string | null }>(provider: string, model: string, call: () => Promise<T>) => governedModelCall({ owner: userId, taskId, provider, model, inputChars: JSON.stringify(body).length + skillInstructions.length, outputTokens: provider.startsWith("custom:") ? 2048 : 1024, freeOnly: body.freeOnly === true, signal: request.signal, call: async () => { if (instructions.length) await recordLoadedInstructions(userId, instructions, taskId); return call(); } });
  let executionPlan: ModelExecutionPlan | undefined;
  const turnJson = (value: Record<string, unknown>, status = 200, retryAfter?: string) => json({ ...value, operationId: taskId, helperReceipts }, status, retryAfter);
  // Validate before contacting any helper. Invalid turns cannot incur helper costs.
  if (body.freeOnly !== undefined && typeof body.freeOnly !== "boolean") return turnJson({ ok: false, error: "Invalid spending policy." }, 400);
  if (body.consultHelpers !== undefined && (!Array.isArray(body.consultHelpers) || body.consultHelpers.some((id) => typeof id !== "string"))) return turnJson({ ok: false, error: "Invalid helper selection." }, 400);
  const initialText = typeof body.text === "string" ? body.text.trim() : "";
  const initialContext = directTurnContext(body, initialText || "Describe the attached image.", Array.isArray(body.history) ? body.history.filter(isHistory) : [], "");
  if (!initialContext.ok) return turnJson(initialContext, 400);
  const initialTier = parseModelTierField(body.modelTier);
  if (!initialTier.ok) return turnJson(initialTier, 400);
  const freeRoute = (id: unknown) => id === "ollama" || id === "nemotron" || id === "openrouter";
  const requestedPrimary = body.composerMode === "orchestrator" ? body.orchestrator || body.provider : body.logicRoute || body.provider || "grok";
  if (body.freeOnly === true && (!freeRoute(requestedPrimary) || (Array.isArray(body.consultHelpers) && body.consultHelpers.some((id) => !freeRoute(id))))) return turnJson({ ok: false, error: "Free-only blocks this provider plan. Choose a verified free OpenRouter route or your local model." }, 403);
  let consultHelp = "";
  if (body.composerMode === "orchestrator") {
    const asked = typeof body.text === "string" ? body.text.trim() : "";
    const orchestrator = typeof body.orchestrator === "string" && body.orchestrator
      ? body.orchestrator
      : typeof body.provider === "string" ? body.provider : "";
    const modules = await modulesConnectedNow(userId);
    const planned = planModelConsult({ orchestrator, modules, question: asked, authorizedHelpers: body.consultHelpers as string[] | undefined, maxHelpers: typeof body.maxHelpers === "number" ? body.maxHelpers : undefined });
    if (!planned.ok) return turnJson({ ok: false, error: planned.error, provider: orchestrator }, 400);
    if (sanitizeAttachments(body.images).length && planned.plan.orchestrator !== "grok") {
      return turnJson({
        ok: false,
        error: "That connected model cannot see images in this app. Remove the images or choose a connected model that can. Another model was not substituted.",
        provider: planned.plan.orchestrator,
      }, 400);
    }
    const blocked = await preflight();
    if (blocked) return blocked;
    executionPlan = planned.plan.execution;
    const collected = await executeConsultPlan(planned.plan, async (id, requestText, signal) => {
      if (await preflight()) return { ok: false, text: "", error: "Dispatch no longer authorized." };
      markDispatched();
      const custom = id.startsWith("custom:") ? parseCustomProviderChoice(id) : null;
      const configured = selectProvider(id, process.env);
      const helperProvider = custom?.ok ? `custom:${custom.id}` : id === "nemotron" ? "openrouter" : id;
      const helperModel = custom?.ok ? custom.model : id === "grok" ? "grok-4.5" : id === "nemotron" ? "nvidia/nemotron-nano-9b-v2:free" : id === "ollama" ? process.env.OLLAMA_MODEL || "local" : configured.ok ? configured.model : id;
      return govern(helperProvider, helperModel, () => askConnectedModule(userId, id, `${requestText}\n\n${skillInstructions}`, signal));
    }, { signal: request.signal });
    helperReceipts.push(...collected.receipts);
    consultHelp = orchestratorInstruction(planned.plan, collected.help);
    body = { ...body, provider: planned.plan.orchestrator, logicRoute: undefined };
  }
  const tierField = parseModelTierField(body.modelTier);
  if (!tierField.ok) return turnJson({ ok: false, error: tierField.error }, 400);
  const logicField = resolveRequestedRoute({ logicRoute: body.logicRoute, provider: body.provider });
  if (!logicField.ok) return turnJson({ ok: false, error: logicField.error }, 400);
  if (logicField.route) return handleLogicTurn(userId, body, logicField.route, preflight, markDispatched, taskId, request.signal, instructions);
  if (typeof body.provider === "string" && body.provider.startsWith("custom:")) {
    const chosen = parseCustomProviderChoice(body.provider);
    if (!chosen.ok) return turnJson(chosen, 400);
    const { haltIsOn } = await import("./halt.server.ts");
    if (await haltIsOn(userId) || body.halted === true) return turnJson({ ok: false, error: "Emergency stop is on." }, 403);
    const images = sanitizeAttachments(body.images);
    if (images.length) return turnJson({ ok: false, error: "This custom API route currently supports text only. Remove image attachments." }, 400);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return turnJson({ ok: false, error: "Write a message first." }, 400);
    const memory = body.memory === "on" ? "on" : body.memory === "off" ? "off" : null;
    if (!memory) return turnJson({ ok: false, error: "Invalid memory setting." }, 400);
    const history = Array.isArray(body.history) ? body.history.filter(isHistory).slice(-12) : [];
    const memoryContext = Array.isArray(body.memoryContext) ? body.memoryContext.filter(isNote).slice(0, 12) : [];
    const sized = checkTurnSize({ text, history, memoryContext, images: [] });
    if (!sized.ok) return turnJson(sized, 400);
    const gate = envCheck();
    if (!gate.ok) return turnJson({ ok: false, error: gate.error }, 503);
    const assembled = assembleTurn({ memory, history, text, memoryContext, images: [], personalityId: body.personalityId, customPersonality: body.customPersonality, botKnowledge: body.botKnowledge, projectContext: body.projectContext, instructionContext: skillInstructions, consultHelp });
    if (!assembled.ok) return turnJson({ ok: false, error: assembled.error }, 400);
    const formatted = toAdapterMessages(assembled.messages);
    if (!formatted.ok) return turnJson({ ok: false, error: formatted.error }, 400);
    const blocked = await preflight();
    if (blocked) return blocked;
    try {
      markDispatched();
      const result = await govern("custom:" + chosen.id, chosen.model, () => executeCustomChat(userId, chosen, formatted.messages, request.signal));
      if (!result.ok) return turnJson(result, result.httpStatus ?? 502);
      const done = { executionPlan: executionPlan ?? modelExecutionPlan("independent", [body.provider]), resourceOperationId: result.resourceOperationId, text: result.text, model: result.model, provider: result.provider, requestedModel: chosen.model, helperReceipts, usedIds: assembled.usedIds, usage: result.usage, requestId: result.requestId };
      const stream = `event: delta\ndata: ${JSON.stringify({ text: result.text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    } catch {
      return turnJson({ ok: false, error: "The custom API or provider database is unavailable." }, 503);
    }
  }
  const pendingImages = sanitizeAttachments(body.images);
  const requestedProvider = body.provider == null || body.provider === "" ? "grok" : body.provider;
  // Prefer vision honesty over missing-key when a non-Grok provider is requested with images.
  if (pendingImages.length > 0 && typeof requestedProvider === "string" && requestedProvider !== "grok") {
    return turnJson({
      ok: false,
      error: `${requestedProvider} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
      provider: requestedProvider,
    }, 400);
  }
  const selected = selectProvider(body.provider, process.env);
  if (selected.ok && selected.id !== "grok" && typeof body.requestedModel === "string" && body.requestedModel !== selected.model) {
    return turnJson({ ok: false, error: "The configured model changed. Choose the current model before sending again." }, 409);
  }
  if (requestedProvider === "nemotron" || requestedProvider === "ollama" || requestedProvider === "openrouter") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return turnJson({ ok: false, error: "Write a message first." }, 400);
    const history = Array.isArray(body.history) ? body.history.filter(isHistory) : [];
    const context = directTurnContext(body, text, history, consultHelp, skillInstructions);
    if (!context.ok) return turnJson(context, 400);
    const blocked = await preflight();
    if (blocked) return blocked;
    if ((requestedProvider === "nemotron" || requestedProvider === "openrouter") && !process.env.OPENROUTER_API_KEY?.trim()) {
      return turnJson({ ok: false, error: "OpenRouter is selected, but no OpenRouter key is connected. Nothing was sent.", provider: requestedProvider }, 503);
    }
    markDispatched();
    const routed = await govern(requestedProvider === "nemotron" ? "openrouter" : requestedProvider, requestedProvider === "nemotron" ? "nvidia/nemotron-nano-9b-v2:free" : requestedProvider === "openrouter" ? process.env.OPENROUTER_MODEL || "" : process.env.OLLAMA_MODEL || "local", () => routeSelectedModel({
      id: requestedProvider,
      systemPrompt: context.systemPrompt,
      history,
      prompt: text,
      env: process.env,
      signal: request.signal,
      fetch: globalThis.fetch,
    }));
    if (!routed.ok) return turnJson({ ok: false, error: routed.error, provider: requestedProvider }, routed.httpStatus ?? 502, "retryAfter" in routed ? routed.retryAfter : undefined);
    const done = { executionPlan: executionPlan ?? modelExecutionPlan("independent", [requestedProvider]), resourceOperationId: routed.resourceOperationId, text: routed.text, model: routed.model, requestedModel: routed.requestedModel, provider: requestedProvider === "nemotron" ? "openrouter" : requestedProvider, usage: routed.usage ?? null, usedIds: context.usedIds, requestId: routed.requestId ?? null, finishReason: routed.finishReason ?? null, helperReceipts };
    const stream = "event: delta\ndata: " + JSON.stringify({ text: routed.text }) + "\n\nevent: done\ndata: " + JSON.stringify(done) + "\n\n";
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }
  if (!selected.ok) {
    // If images somehow accompany a failed non-Grok selection, still prefer cannot-see copy.
    if (pendingImages.length > 0 && requestedProvider !== "grok") {
      return turnJson({
        ok: false,
        error: `${requestedProvider} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
        provider: requestedProvider,
      }, 400);
    }
    return turnJson(selected, httpStatusForProviderSelection(selected.error));
  }
  if (selected.id !== "grok") {
    if (pendingImages.length > 0) {
      return turnJson({
        ok: false,
        error: `${selected.id} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
        provider: selected.id,
      }, 400);
    }
    const { haltIsOn } = await import("./halt.server");
    if ((await haltIsOn(userId)) || body.halted === true) return turnJson({ ok: false, error: "Emergency stop is on. No new action can run." }, 403);
    // Same chat rate limit as Grok — non-Grok must not skip the token bucket.
    const blocked = await preflight();
    if (blocked) return blocked;
    const key = process.env[selected.id === "openai" ? "OPENAI_API_KEY" : selected.id === "anthropic" ? "ANTHROPIC_API_KEY" : selected.id === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"] ?? "";
    const history = Array.isArray(body.history)
      ? body.history.filter(isHistory).map((item) => ({ role: item.role, content: item.content }))
      : [];
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return turnJson({ ok: false, error: "Write a message first." }, 400);
    const context = directTurnContext(body, text, history, consultHelp, skillInstructions);
    if (!context.ok) return turnJson(context, 400);
    markDispatched();
    const providerId = selected.id;
    const called = await govern(providerId, selected.model, () => callConfiguredProvider({
      id: providerId,
      model: selected.model,
      key,
      prompt: text,
      systemPrompt: context.systemPrompt,
      history,
      signal: request.signal,
      fetch: globalThis.fetch,
    }));
    if (!called.ok) return turnJson({ ok: false, error: called.error, provider: selected.id }, called.httpStatus ?? 502, "retryAfter" in called ? called.retryAfter : undefined);
    // Use the same SSE contract as the Grok and custom-provider chat paths.
    const done = { executionPlan: executionPlan ?? modelExecutionPlan("independent", [providerId]), resourceOperationId: called.resourceOperationId, text: called.text, model: reportedModel(called.model), requestedModel: selected.model, provider: selected.id, usage: called.usage ?? null, usedIds: context.usedIds, requestId: called.requestId ?? null, finishReason: called.finishReason ?? null, helperReceipts };
    const stream = "event: delta\ndata: " + JSON.stringify({ text: called.text }) +
      "\n\nevent: done\ndata: " + JSON.stringify(done) + "\n\n";
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }
  const prepared = await prepareMindTurnWithHelp(userId, body, consultHelp, instructions);
  if (!prepared.ok) return turnJson(prepared);
  if (!allowedModelIds(process.env).has(prepared.model)) {
    return turnJson({ ok: false, error: "That model is not available. Another provider is not substituted." });
  }
  const blocked = await preflight();
  if (blocked) return blocked;
  const keyed = resolveXaiInferenceApiKey(process.env);
  if (!keyed.ok) {
    return turnJson({ ok: false, error: keyed.error, provider: "grok" }, 503);
  }
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
  let resource;
  try {
    resource = await reserveResourceOperation({ owner: userId, taskId, provider: "grok", model: prepared.model, free: false, freeOnly: body.freeOnly === true, inputTokens: Math.ceil(JSON.stringify(prepared.assembled.messages).length / 3), outputTokens: prepared.modelTier.params.max_tokens ?? 1024 });
  } catch (error) { return turnJson({ ok: false, error: error instanceof Error ? error.message : "Resource authorization unavailable." }, 403); }
  const finalCheck = await preflight();
  if (finalCheck) { await settleResourceOperation(resource, { outcome: "not_dispatched" }).catch(() => {}); return finalCheck; }
  if (instructions.length) await recordLoadedInstructions(userId, instructions, taskId);
  markDispatched();
  const relayed = relayModelStream({
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
      helperReceipts,
      executionPlan: executionPlan ?? modelExecutionPlan("independent", ["grok"]),
      resourceOperationId: resource.operationId,
      modelTier: prepared.modelTier.selected,
      resolvedTier: prepared.modelTier.resolved,
      tierReason: prepared.modelTier.reason,
      images: prepared.images.length,
      memorySaved,
      savedMemoryId,
    },
  });
  return settleResourceStream(relayed, resource);
}

/** Exported for scripts/tests that build a multimodal Direct turn without the HTTP handler. */
export type { ImageAttachment };

async function modulesConnectedNow(userId: string) {
  const modules = builtinModules({
    grokConfigured: resolveXaiInferenceApiKey(process.env).ok,
    providers: configuredProviders(process.env),
    localRunner: Boolean(process.env.LOCAL_MODEL_URL),
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

async function askConnectedModule(userId: string, id: string, requestText: string, signal: AbortSignal): Promise<HelperReply> {
  if (id.startsWith("custom:")) {
    const chosen = parseCustomProviderChoice(id);
    if (!chosen.ok) return { ok: false, text: "" };
    const result = await executeCustomChat(userId, chosen, [
      { role: "system", content: ADRIAN_MIND_IDENTITY },
      { role: "user", content: requestText },
    ], signal);
    return result.ok ? { ...result, ok: true } : { ok: false, text: "", error: result.error };
  }
  if (id === "grok") {
    const keyed = resolveXaiInferenceApiKey(process.env);
    if (!keyed.ok) return { ok: false, text: "" };
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        headers: { "content-type": "application/json", authorization: `Bearer ${keyed.key}` },
        body: JSON.stringify({
          model: "grok-4.5",
          messages: [
            { role: "system", content: ADRIAN_MIND_IDENTITY },
            { role: "user", content: requestText },
          ],
          max_tokens: 400,
          stream: false,
        }),
      });
      if (!res.ok) return { ok: false, text: "" };
      const parsed = readModelPayload(await res.text());
      return parsed.text ? { ok: true, text: parsed.text, model: parsed.model, requestedModel: "grok-4.5", usage: parsed.usage, requestId: res.headers.get("x-request-id") } : { ok: false, text: "", error: "No assistant text returned." };
    } catch {
      return { ok: false, text: "" };
    }
  }
  if (id === "nemotron" || id === "ollama" || id === "openrouter") {
    const result = await routeSelectedModel({ id, prompt: requestText, env: process.env, signal, fetch: globalThis.fetch });
    return result;
  }
  const selected = selectProvider(id, process.env);
  if (!selected.ok || selected.id === "grok") return { ok: false, text: "" };
  const keyName = selected.id === "openai" ? "OPENAI_API_KEY" : selected.id === "anthropic" ? "ANTHROPIC_API_KEY" : selected.id === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
  const key = process.env[keyName] ?? "";
  if (!key) return { ok: false, text: "" };
  const called = await callConfiguredProvider({
    id: selected.id,
    key,
    model: selected.model,
    prompt: requestText,
    systemPrompt: ADRIAN_MIND_IDENTITY,
    signal,
    fetch: globalThis.fetch,
  });
  return { ...called, requestedModel: selected.model };
}
