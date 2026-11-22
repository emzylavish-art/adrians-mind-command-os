import { requireUserId } from "../auth/verify.server";
import { guardMindEnv } from "./isolation";
import { CHAT_RATE_LIMIT_REPLY, checkTurnSize, consumeMindRateLimit, jsonRateLimited } from "./limits";
import { assembleTurn } from "./prompt";
import { sanitizeAttachments, type ImageAttachment } from "./media";
import type { ChatContent } from "./media/types";
import { resolveXaiInferenceApiKey } from "./xai-adapter";
import type { HistoryInputMessage } from "./media/history";
import { allowedModelIds, isConnectedGrokModel, resolveModelTier, type ResolvedModelTier } from "./model-tiers";
import { assertLiveProvider } from "./providers";
import { callConfiguredProvider, httpStatusForProviderSelection, routeSelectedModel, selectProvider } from "./provider-call";
import { configuredProviders } from "./provider-call";
import { ADRIAN_MIND_IDENTITY, builtinModules, collectConsultHelp, customModules, orchestratorInstruction, planModelConsult } from "./model-consult.ts";
import { adrianPcEnabled, runAdrianPc } from "./adrian-pc.server.ts";
import { consequentialSpeechRefusal } from "./frontier-2031.ts";
import { destructiveSpeechRefusal } from "./reversibility.ts";
import { ensureLocalCapabilityFile, runLocalCommand } from "./local-capabilities.ts";
import path from "node:path";
import { buildRelayModelBody, relayModelStream } from "./relay";
import { CHAT_TIMEOUT_REPLY, chatTurnTimeoutMs } from "./turn-timeouts";
import { decideFetchSite } from "./request-guard";
import { parseModelTierField, readJsonObjectBody } from "./request-body";
import { readModelPayload } from "./stream";
import { resolveDatabaseUrl } from "../env.server.ts";
import { LOGIC_ROUTE_LABEL, resolveRequestedRoute, toAdapterMessages, type LogicRouteId } from "./logic-routes.ts";
import { inspectLogicRoutes, runLogicRoute } from "./logic-route-adapter.server.ts";
import { parseCustomProviderChoice, executeCustomChat } from "./ai-provider-config.server.ts";
import { personalityInstruction } from "./personalities/index.ts";
import { botKnowledgeLine } from "./bot-model.ts";

/** Default Expert model id — kept for status/docs; live turns use resolveModelTier. */
export const MIND_MODEL = "grok-4.5";
/** Raised so a few downscaled image data-URLs can ride with the turn JSON. */
const MAX_BODY = 2_500_000;

type NoteItem = { id: string; text: string };

export type TurnBody = {
  text?: unknown;
  memory?: unknown;
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
    consultHelp,
  });
  if (!assembled.ok) return { ok: false as const, error: assembled.error };
  const tier = resolveModelTier(data.modelTier, text || "image", process.env);
  const requested = isConnectedGrokModel(data.requestedModel) ? data.requestedModel : null;
  if (requested) tier.model = requested;
  const saveMemoryText = typeof data.saveMemory === "string" ? data.saveMemory : "";
  return {
    ok: true as const,
    assembled,
    memory,
    model: tier.model,
    modelTier: tier,
    provider: routed.id,
    images,
    saveMemoryText,
    userId,
  };
}

export async function completeModelReply(prepared: {
  assembled: { messages: { role: "system" | "user" | "assistant"; content: ChatContent }[]; usedIds: string[] };
  memory: "off" | "on";
  model: string;
  modelTier: ResolvedModelTier;
}) {
  if (!allowedModelIds(process.env).has(prepared.model)) {
    return { ok: false as const, error: "That model is not available. Another provider is not substituted." };
  }
  const keyed = resolveXaiInferenceApiKey(process.env);
  if (!keyed.ok) return { ok: false as const, error: keyed.error };
  const apiKey = keyed.key;
  let res: Response;
  try {
    res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(
        buildRelayModelBody(prepared.model, prepared.assembled.messages, {
          temperature: prepared.modelTier.params.temperature,
          max_tokens: prepared.modelTier.params.max_tokens,
          reasoning_effort: prepared.modelTier.params.reasoning_effort,
        }),
      ),
    });
  } catch {
    return { ok: false as const, error: CHAT_TIMEOUT_REPLY };
  }
  if (!res.ok) return { ok: false as const, error: `Grok returned ${res.status}. Nothing was saved as a success.` };
  const parsed = readModelPayload(await res.text());
  if (!parsed.text) return { ok: false as const, error: "Grok returned an empty reply." };
  return {
    ok: true as const,
    text: parsed.text,
    model: prepared.model,
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function logicSse(input: {
  text: string;
  model: string;
  requestedModel: string | null;
  route: LogicRouteId;
  usedIds: string[];
  credentialFallback: "OPENAI_API_KEY" | null;
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
  };
  const body = `event: delta\ndata: ${JSON.stringify({ text: input.text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}

async function handleLogicTurn(userId: string, data: TurnBody, route: LogicRouteId): Promise<Response> {
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
  const assembled = assembleTurn({ memory, history, text, memoryContext, images: [], personalityId: data.personalityId, customPersonality: data.customPersonality, botKnowledge: data.botKnowledge });
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
  const limited = consumeMindRateLimit("chat", userId, 12);
  if (!limited.ok) return jsonRateLimited(CHAT_RATE_LIMIT_REPLY, limited.retryAfterSec);
  const ran = await runLogicRoute({
    route,
    messages: flat.messages,
    env: process.env,
    inspect: async () => inspected,
  });
  if (!ran.ok) return json({ ok: false, error: ran.error, logicRoute: route, provider: route }, ran.called ? 502 : 503);
  return logicSse({
    text: ran.content,
    model: ran.model,
    requestedModel: ran.requestedModel,
    route: ran.provider,
    usedIds: assembled.usedIds,
    credentialFallback: ran.credentialFallback,
  });
}

export async function handleMindTurn(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
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
  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  let body = read.body as TurnBody;
  if (adrianPcEnabled() && typeof body.text === "string" && body.text.trim()) {
    const { haltIsOn } = await import("./halt.server.ts");
    const halted = body.halted === true || await haltIsOn(userId);
    const pc = await runAdrianPc({ text: body.text, halted });
    if (pc.ran) {
      body = { ...body, text: `${body.text}\n\nAdrian PC result: ${pc.output}` };
    }
  }
  if (typeof body.text === "string") {
    ensureLocalCapabilityFile(path.join(process.cwd(), ".data", "local-capabilities.json"));
    const local = runLocalCommand(body.text);
    if (local) {
      const done = { text: local, model: "adrian-local", provider: "Adrian", usage: null, usedIds: [], requestId: null };
      const stream = `event: delta\ndata: ${JSON.stringify({ text: local })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    }
  }
  let consultHelp = "";
  if (body.composerMode === "orchestrator") {
    const asked = typeof body.text === "string" ? body.text.trim() : "";
    const orchestrator = typeof body.orchestrator === "string" && body.orchestrator
      ? body.orchestrator
      : typeof body.provider === "string" ? body.provider : "";
    const modules = await modulesConnectedNow(userId);
    const planned = planModelConsult({ orchestrator, modules, question: asked });
    if (!planned.ok) return json({ ok: false, error: planned.error, provider: orchestrator }, 400);
    if (sanitizeAttachments(body.images).length && planned.plan.orchestrator !== "grok") {
      return json({
        ok: false,
        error: "That connected model cannot see images in this app. Remove the images or choose a connected model that can. Another model was not substituted.",
        provider: planned.plan.orchestrator,
      }, 400);
    }
    const help = await collectConsultHelp(planned.plan, (id, requestText) => askConnectedModule(userId, id, requestText));
    consultHelp = orchestratorInstruction(planned.plan, help);
    body = { ...body, provider: planned.plan.orchestrator, logicRoute: undefined };
  }
  const tierField = parseModelTierField(body.modelTier);
  if (!tierField.ok) return json({ ok: false, error: tierField.error }, 400);
  const logicField = resolveRequestedRoute({ logicRoute: body.logicRoute, provider: body.provider });
  if (!logicField.ok) return json({ ok: false, error: logicField.error }, 400);
  if (logicField.route) return handleLogicTurn(userId, body, logicField.route);
  if (typeof body.provider === "string" && body.provider.startsWith("custom:")) {
    const chosen = parseCustomProviderChoice(body.provider);
    if (!chosen.ok) return json(chosen, 400);
    const { haltIsOn } = await import("./halt.server.ts");
    if (await haltIsOn(userId) || body.halted === true) return json({ ok: false, error: "Emergency stop is on." }, 403);
    const images = sanitizeAttachments(body.images);
    if (images.length) return json({ ok: false, error: "This custom API route currently supports text only. Remove image attachments." }, 400);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ ok: false, error: "Write a message first." }, 400);
    const memory = body.memory === "on" ? "on" : body.memory === "off" ? "off" : null;
    if (!memory) return json({ ok: false, error: "Invalid memory setting." }, 400);
    const history = Array.isArray(body.history) ? body.history.filter(isHistory).slice(-12) : [];
    const memoryContext = Array.isArray(body.memoryContext) ? body.memoryContext.filter(isNote).slice(0, 12) : [];
    const sized = checkTurnSize({ text, history, memoryContext, images: [] });
    if (!sized.ok) return json(sized, 400);
    const gate = envCheck();
    if (!gate.ok) return json({ ok: false, error: gate.error }, 503);
    const assembled = assembleTurn({ memory, history, text, memoryContext, images: [], personalityId: body.personalityId, customPersonality: body.customPersonality, botKnowledge: body.botKnowledge, consultHelp });
    if (!assembled.ok) return json({ ok: false, error: assembled.error }, 400);
    const formatted = toAdapterMessages(assembled.messages);
    if (!formatted.ok) return json({ ok: false, error: formatted.error }, 400);
    const limited = consumeMindRateLimit("chat", userId, 12);
    if (!limited.ok) return jsonRateLimited(CHAT_RATE_LIMIT_REPLY, limited.retryAfterSec);
    try {
      const result = await executeCustomChat(userId, chosen, formatted.messages);
      if (!result.ok) return json(result, 502);
      const done = { text: result.text, model: result.model, provider: result.provider, usedIds: assembled.usedIds, usage: result.usage, requestId: result.requestId };
      const stream = `event: delta\ndata: ${JSON.stringify({ text: result.text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    } catch {
      return json({ ok: false, error: "The custom API or provider database is unavailable." }, 503);
    }
  }
  const pendingImages = sanitizeAttachments(body.images);
  const requestedProvider = body.provider == null || body.provider === "" ? "grok" : body.provider;
  // Prefer vision honesty over missing-key when a non-Grok provider is requested with images.
  if (pendingImages.length > 0 && typeof requestedProvider === "string" && requestedProvider !== "grok") {
    return json({
      ok: false,
      error: `${requestedProvider} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
      provider: requestedProvider,
    });
  }
  const selected = selectProvider(body.provider, process.env);
  if (requestedProvider === "nemotron" || requestedProvider === "ollama" || requestedProvider === "openrouter") {
    const routed = await routeSelectedModel({
      id: requestedProvider,
      prompt: typeof body.text === "string" ? body.text : "",
      env: process.env,
      fetch: globalThis.fetch,
    });
    if (!routed.ok) return json({ ok: false, error: routed.error, provider: requestedProvider });
    const done = { text: routed.text, model: routed.model, provider: requestedProvider, usage: null, usedIds: [], requestId: null };
    const stream = "event: delta\ndata: " + JSON.stringify({ text: routed.text }) + "\n\nevent: done\ndata: " + JSON.stringify(done) + "\n\n";
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }
  if (!selected.ok) {
    // If images somehow accompany a failed non-Grok selection, still prefer cannot-see copy.
    if (pendingImages.length > 0 && requestedProvider !== "grok") {
      return json({
        ok: false,
        error: `${requestedProvider} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
        provider: requestedProvider,
      });
    }
    return json(selected);
  }
  if (selected.id !== "grok") {
    if (pendingImages.length > 0) {
      return json({
        ok: false,
        error: `${selected.id} cannot see images in this app. Choose Grok, or remove the attached images. Another provider is not substituted.`,
        provider: selected.id,
      });
    }
    const { haltIsOn } = await import("./halt.server");
    if ((await haltIsOn(userId)) || body.halted === true) return json({ ok: false, error: "Emergency stop is on. No new action can run." });
    // Same chat rate limit as Grok — non-Grok must not skip the token bucket.
    const limited = consumeMindRateLimit("chat", userId, 12);
    if (!limited.ok) return jsonRateLimited(CHAT_RATE_LIMIT_REPLY, limited.retryAfterSec);
    const key = process.env[selected.id === "openai" ? "OPENAI_API_KEY" : selected.id === "anthropic" ? "ANTHROPIC_API_KEY" : selected.id === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"] ?? "";
    const history = Array.isArray(body.history)
      ? body.history.filter(isHistory).slice(-12).map((item) => ({ role: item.role, content: item.content }))
      : [];
    const called = await callConfiguredProvider({
      id: selected.id,
      key,
      prompt: typeof body.text === "string" ? body.text : "",
      systemPrompt: [ADRIAN_MIND_IDENTITY, personalityInstruction(body.personalityId, body.customPersonality), botKnowledgeLine(body.botKnowledge), consultHelp].filter(Boolean).join(" "),
      history,
      fetch: globalThis.fetch,
    });
    if (!called.ok) return json({ ok: false, error: called.error, provider: selected.id }, 502);
    // Use the same SSE contract as the Grok and custom-provider chat paths.
    const done = { text: called.text, model: selected.model, provider: selected.id, usage: null, usedIds: [], requestId: null };
    const stream = "event: delta\ndata: " + JSON.stringify({ text: called.text }) +
      "\n\nevent: done\ndata: " + JSON.stringify(done) + "\n\n";
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }
  const prepared = await prepareMindTurnWithHelp(userId, body, consultHelp);
  if (!prepared.ok) return json(prepared);
  if (!allowedModelIds(process.env).has(prepared.model)) {
    return json({ ok: false, error: "That model is not available. Another provider is not substituted." });
  }
  const hasMultimodalContent = prepared.assembled.messages.some((message) => typeof message.content !== "string");
  const keyed = resolveXaiInferenceApiKey(process.env);
  const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const chatMessages = prepared.assembled.messages
    .map((message) => ({ role: message.role, content: typeof message.content === "string" ? message.content : "" }))
    .filter((message) => message.content.length > 0);
  if (!keyed.ok) {
    if (hasMultimodalContent) {
      return json({ ok: false, error: "Grok is unavailable and OpenAI fallback was not used because it cannot preserve this image-bearing request. No successful reply was received." });
    }
    const { directChatWithFallback } = await import("./voice/provider-fallback");
    const chat = await directChatWithFallback({ messages: chatMessages, openaiKey });
    if (!chat.ok) return json({ ok: false, error: chat.error });
    return sseChatDone(chat, prepared.assembled.usedIds);
  }
  const apiKey = keyed.key;
  let memorySaved = false;
  let savedMemoryId: string | null = null;
  const { shouldPersistTurnMemory, memorySignalFromSave } = await import("./memory/signal");
  if (shouldPersistTurnMemory({ memory: prepared.memory, saveText: prepared.saveMemoryText })) {
    const { getSql } = await import("../db");
    const { createOwnerMemory } = await import("./memory/owner-ops");
    const saved = await createOwnerMemory(await getSql(), userId, {
      scope: "chat",
      text: prepared.saveMemoryText,
      source: "turn",
      projectId: null,
      chatId: null,
    });
    const signal = memorySignalFromSave(saved.ok ? { ok: true, id: saved.item.id } : { ok: false });
    memorySaved = signal.memorySaved;
    savedMemoryId = signal.savedMemoryId;
  }
  return relayModelStream({
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
      modelTier: prepared.modelTier.selected,
      resolvedTier: prepared.modelTier.resolved,
      tierReason: prepared.modelTier.reason,
      images: prepared.images.length,
      memorySaved,
      savedMemoryId,
    },
    authFallback: async () => {
      if (hasMultimodalContent) {
        return { ok: false as const, error: "xAI authentication failed and OpenAI fallback was not used because it cannot preserve this image-bearing request. No successful reply was received." };
      }
      const { openAiDirectChat } = await import("./voice/provider-fallback");
      const chat = await openAiDirectChat({ messages: chatMessages, apiKey: openaiKey });
      if (!chat.ok) return { ok: false as const, error: "xAI and OpenAI did not return a successful reply." };
      return { ok: true as const, text: chat.text, model: chat.model, provider: "OpenAI" };
    },
  });
}

function sseChatDone(chat: { text: string; model: string; provider: string }, usedIds: string[]): Response {
  const payload = { text: chat.text, model: chat.model, provider: chat.provider, usage: null, usedIds, requestId: null };
  return new Response(`event: done\ndata: ${JSON.stringify(payload)}\n\n`, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
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
    modules.push(...customModules(saved.map((item) => ({
      id: item.id,
      label: item.label,
      models: item.models,
      hasKey: item.hasKey,
    }))));
  } catch {
    /* A disconnected custom list is not invented. */
  }
  return modules;
}

async function askConnectedModule(userId: string, id: string, requestText: string): Promise<{ ok: boolean; text: string }> {
  if (id.startsWith("custom:")) {
    const chosen = parseCustomProviderChoice(id);
    if (!chosen.ok) return { ok: false, text: "" };
    const result = await executeCustomChat(userId, chosen, [
      { role: "system", content: ADRIAN_MIND_IDENTITY },
      { role: "user", content: requestText },
    ]);
    return result.ok ? { ok: true, text: result.text } : { ok: false, text: "" };
  }
  if (id === "grok") {
    const keyed = resolveXaiInferenceApiKey(process.env);
    if (!keyed.ok) return { ok: false, text: "" };
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
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
      return parsed.text ? { ok: true, text: parsed.text } : { ok: false, text: "" };
    } catch {
      return { ok: false, text: "" };
    }
  }
  const selected = selectProvider(id, process.env);
  if (!selected.ok || selected.id === "grok") return { ok: false, text: "" };
  const keyName = selected.id === "openai" ? "OPENAI_API_KEY" : selected.id === "anthropic" ? "ANTHROPIC_API_KEY" : selected.id === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
  const key = process.env[keyName] ?? "";
  if (!key) return { ok: false, text: "" };
  const called = await callConfiguredProvider({
    id: selected.id,
    key,
    prompt: requestText,
    systemPrompt: ADRIAN_MIND_IDENTITY,
    fetch: globalThis.fetch,
  });
  return called.ok ? { ok: true, text: called.text } : { ok: false, text: "" };
}
