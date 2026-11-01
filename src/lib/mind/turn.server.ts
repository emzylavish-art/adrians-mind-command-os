import { requireUserId } from "../auth/verify.server";
import { guardMindEnv } from "./isolation";
import { CHAT_RATE_LIMIT_REPLY, checkTurnSize, consumeMindRateLimit, jsonRateLimited } from "./limits";
import { assembleTurn } from "./prompt";
import { sanitizeAttachments, type ImageAttachment } from "./media";
import type { ChatContent } from "./media/types";
import { resolveXaiInferenceApiKey } from "./xai-adapter";
import type { HistoryInputMessage } from "./media/history";
import { allowedModelIds, resolveModelTier, type ResolvedModelTier } from "./model-tiers";
import { assertLiveProvider } from "./providers";
import { callConfiguredProvider, httpStatusForProviderSelection, selectProvider } from "./provider-call";
import { buildRelayModelBody, relayModelStream } from "./relay";
import { CHAT_TIMEOUT_REPLY, chatTurnTimeoutMs } from "./turn-timeouts";
import { decideFetchSite } from "./request-guard";
import { parseModelTierField, readJsonObjectBody } from "./request-body";
import { readModelPayload } from "./stream";
import { resolveDatabaseUrl } from "../env.server.ts";

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
  /** UI picker: Auto | Fast | Expert | Heavy | Build */
  modelTier?: unknown;
  /** Optional image attachments (data-URLs) for multimodal Direct turns. */
  images?: unknown;
  /** Optional explicit note to persist with this turn (owner-scoped). */
  saveMemory?: unknown;
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
  const { haltIsOn } = await import("./halt.server");
  if ((await haltIsOn(userId)) || data.halted === true) {
    return { ok: false as const, error: "Emergency stop is on. No new action can run." };
  }
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
  });
  if (!assembled.ok) return { ok: false as const, error: assembled.error };
  const tier = resolveModelTier(data.modelTier, text || "image", process.env);
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
  const body = read.body as TurnBody;
  const tierField = parseModelTierField(body.modelTier);
  if (!tierField.ok) return json({ ok: false, error: tierField.error }, 400);
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
    const called = await callConfiguredProvider({ id: selected.id, key, prompt: typeof body.text === "string" ? body.text : "", fetch: globalThis.fetch });
    return json({ ...called, provider: selected.id });
  }
  const prepared = await prepareMindTurn(userId, body);
  if (!prepared.ok) return json(prepared);
  if (!allowedModelIds(process.env).has(prepared.model)) {
    return json({ ok: false, error: "That model is not available. Another provider is not substituted." });
  }
  const keyed = resolveXaiInferenceApiKey(process.env);
  if (!keyed.ok) return json({ ok: false, error: keyed.error });
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
  });
}

/** Exported for scripts/tests that build a multimodal Direct turn without the HTTP handler. */
export type { ImageAttachment };
