import { consumeProviderStream } from "./ai-provider-stream.ts";
import { consumeOllamaStream, mergeProviderReceipt } from "./provider-call-stream.ts";
/** Bounded provider-specific chat calls with normalised assistant text. */
import { reportedModel, type ModelUsage } from "./stream.ts";
import { isOpenRouterFreeModel, OPENROUTER_FREE_MODEL_REQUIRED, OPENROUTER_FREE_ROUTING } from "./provider-catalog.ts";
import { normalizeProviderReceipt as executionReceipt } from "./provider-receipt.ts";
import { parseModelControls, type ModelControls } from "./model-tiers.ts";
import { readProviderReceipt, type ProviderReceipt as UsageReceipt, normalizeProviderUsage, providerRequestId } from "./provider-usage.ts";

export type ProviderName = "grok" | "openai" | "anthropic" | "gemini" | "openrouter";

export type ProviderReceipt = {
  usage?: ModelUsage | null;
  executionLocation?: "local" | "hosted";
  requestId?: string | null;
  finishReason?: string | null;
};

/** Missing or invalid counters remain unknown; zero is retained only when reported. */
export function normalizeProviderReceipt(id: string, payload: Record<string, any>, headers?: Pick<Headers, "get">): ProviderReceipt {
  const source = id === "gemini" ? payload.usageMetadata : id === "ollama" ? payload : payload.usage;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const prompt_tokens = count(id === "gemini" ? source?.promptTokenCount : id === "anthropic" ? source?.input_tokens : id === "ollama" ? source?.prompt_eval_count : source?.prompt_tokens);
  const completion_tokens = count(id === "gemini" ? source?.candidatesTokenCount : id === "anthropic" ? source?.output_tokens : id === "ollama" ? source?.eval_count : source?.completion_tokens);
  const label = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
  return {
    executionLocation: executionReceipt(id, payload, headers).executionLocation,
    usage: prompt_tokens === undefined && completion_tokens === undefined ? null : { ...(prompt_tokens !== undefined ? { prompt_tokens } : {}), ...(completion_tokens !== undefined ? { completion_tokens } : {}) },
    requestId: label(headers?.get("x-request-id")) ?? label(headers?.get("request-id")) ?? label(payload.id) ?? label(payload.responseId),
    finishReason: label(id === "gemini" ? payload.candidates?.[0]?.finishReason : id === "anthropic" ? payload.stop_reason : id === "ollama" ? payload.done_reason : payload.choices?.[0]?.finish_reason),
  };
}
type OtherProvider = Exclude<ProviderName, "grok">;
type History = { role: "user" | "assistant"; content: string };
export type ProviderCallResult = { dispatched?: boolean; ok: boolean; text: string; error: string; model?: string; httpStatus?: number; retryAfter?: string; delivery?: "streamed" | "buffered" } & Partial<ProviderReceipt & UsageReceipt>;
const KEYS: Record<OtherProvider, string> = {
  openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY",
};
const MODELS: Record<OtherProvider, string> = {
  openai: "gpt-4.1-mini", anthropic: "claude-sonnet-4-5",
  gemini: "gemini-3.1-flash-lite", openrouter: "",
};
export function configuredProviders(env: Record<string, string | undefined>): Record<OtherProvider, boolean> {
  return {
    openai: Boolean(env.OPENAI_API_KEY?.trim()), anthropic: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    gemini: Boolean(env.GEMINI_API_KEY?.trim()), openrouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
  };
}
export function selectProvider(id: unknown, env: Record<string, string | undefined>):
  { ok: true; id: ProviderName; model: string } | { ok: false; error: string } {
  const name = id == null || id === "" ? "grok" : id;
  if (name === "grok") return { ok: true, id: "grok", model: "grok-4.5" };
  if (name !== "openai" && name !== "anthropic" && name !== "gemini" && name !== "openrouter") {
    return { ok: false, error: "That provider is not known. Another provider is not substituted." };
  }
  if (!env[KEYS[name]]?.trim()) return { ok: false, error: "No " + name + " key is configured. Another provider is not substituted." };
  const model = name === "openrouter" ? env.OPENROUTER_MODEL?.trim() ?? "" : MODELS[name];
  if (name === "openrouter" && !isOpenRouterFreeModel(model)) return { ok: false, error: OPENROUTER_FREE_MODEL_REQUIRED };
  return { ok: true, id: name, model };
}
type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; headers?: Pick<Headers, "get">; body?: ReadableStream<Uint8Array> | null; text: () => Promise<string> }>;
function readableBlocks(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const p = part as { type?: unknown; text?: unknown };
    return typeof p.text === "string" && (p.type === "text" || p.type === "output_text" || p.type == null) ? p.text : "";
  }).join("");
}
/** Extract assistant content only: never put upstream JSON into chat history. */
export function parseProviderText(id: OtherProvider, raw: string): string {
  if (raw.length > 500_000) return "";
  let json: any;
  try { json = JSON.parse(raw); } catch { return ""; }
  if (!json || typeof json !== "object") return "";
  return extractAssistantText(id, json);
}

function extractAssistantText(id: OtherProvider, json: Record<string, any>): string {
  let text = "";
  if (id === "openai" || id === "openrouter") {
    text = readableBlocks(json.choices?.[0]?.message?.content);
  } else if (id === "anthropic") {
    text = readableBlocks(json.content);
  } else if (id === "gemini") {
    const parts = json.candidates?.[0]?.content?.parts;
    text = Array.isArray(parts) ? parts.filter((p: { thought?: unknown }) => p?.thought !== true).map((p: { text?: unknown }) => typeof p?.text === "string" ? p.text : "").join("") : "";
  }
  return text.trim();
}
export async function callConfiguredProvider(input: {
  id: OtherProvider;
  key: string;
  prompt: string;
  model?: string;
  systemPrompt?: string;
  history?: History[];
  controls?: ModelControls;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onDispatch?: () => void;
  fetch: FetchLike;
}): Promise<ProviderCallResult> {
  if (!input.key) return { dispatched: false, ok: false, text: "", error: "No " + input.id + " key is configured. Nothing was sent." };
  const prompt = input.prompt.trim();
  if (!prompt) return { dispatched: false, ok: false, text: "", error: "Write a message first." };
  const controls = parseModelControls(input.controls);
  if (!controls.ok) return { dispatched: false, ok: false, text: "", error: controls.error, httpStatus: 400 };
  const answerTokens = controls.controls.answerTokens;
  const history = (input.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  const systemPrompt = input.systemPrompt?.trim();
  const messages = [...history, { role: "user" as const, content: prompt }];
  const completionMessages = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...messages,
  ];
  const models = { ...MODELS, [input.id]: input.model || MODELS[input.id] };
  if (input.id === "openrouter" && !isOpenRouterFreeModel(models.openrouter)) {
    return { dispatched: false, ok: false, text: "", error: OPENROUTER_FREE_MODEL_REQUIRED, httpStatus: 400 };
  }
  const endpoints: Record<OtherProvider, { url: string; init: RequestInit }> = {
    openai: {
      url: "https://api.openai.com/v1/chat/completions",
      init: { headers: { authorization: "Bearer " + input.key, "content-type": "application/json" },
        body: JSON.stringify({ model: models.openai, messages: completionMessages, ...(answerTokens === undefined ? {} : { max_tokens: answerTokens }) }) },
    },
    anthropic: {
      url: "https://api.anthropic.com/v1/messages",
      init: { headers: { "x-api-key": input.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: models.anthropic, max_tokens: answerTokens ?? 400, ...(systemPrompt ? { system: systemPrompt } : {}), messages }) },
    },
    gemini: {
      url: "https://generativelanguage.googleapis.com/v1beta/models/" + models.gemini + ":generateContent",
      init: { headers: { "content-type": "application/json", "x-goog-api-key": input.key }, body: JSON.stringify({
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
        ...(answerTokens === undefined ? {} : { generationConfig: { maxOutputTokens: answerTokens } }),
      }) },
    },
    openrouter: {
      url: "https://openrouter.ai/api/v1/chat/completions",
      init: { headers: { authorization: "Bearer " + input.key, "content-type": "application/json" },
        body: JSON.stringify({ model: models.openrouter, messages: completionMessages, provider: OPENROUTER_FREE_ROUTING, ...(answerTokens === undefined ? {} : { max_tokens: answerTokens }) }) },
    },
  };
  const target = endpoints[input.id];
  if (input.onDelta) {
    if (input.id === "gemini") target.url = target.url.replace(":generateContent", ":streamGenerateContent?alt=sse");
    else target.init.body = JSON.stringify({ ...JSON.parse(String(target.init.body)), stream: true, ...(["openai", "openrouter"].includes(input.id) ? { stream_options: { include_usage: true } } : {}) });
  }
  if (input.signal?.aborted) return { dispatched: false, ok: false, text: "", error: "Canceled before dispatch." };
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    input.onDispatch?.();
    response = await input.fetch(target.url, { method: "POST", ...target.init, signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) });
  } catch {
    return { ok: false, text: "", dispatched: true, error: input.id + " could not be reached. Nothing was substituted." };
  }
  let errorModel: string | undefined;
  let errorMetadata: unknown = null;
  if (!response.ok) {
    try {
      const raw = await response.text();
      if (raw.length <= 500_000) {
        const payload = JSON.parse(raw);
        errorMetadata = payload;
        const label = input.id === "gemini" ? payload?.modelVersion : payload?.model;
        if (typeof label === "string" && label.length <= 300 && !/\p{Cc}/u.test(label)) errorModel = label;
      }
    } catch { /* Status and response headers remain usable without a JSON body. */ }
  }
  let responseReceipt = readProviderReceipt(input.id, errorMetadata, response.headers);
  if (response.status === 429) {
    const rawDelay = response.headers?.get("retry-after")?.trim();
    const retryAfter = rawDelay && (/^\d{1,8}$/.test(rawDelay) || (rawDelay.length <= 40 && Number.isFinite(Date.parse(rawDelay)))) ? rawDelay : undefined;
    return { dispatched: true, ok: false, text: "", model: errorModel, ...responseReceipt, httpStatus: 429, retryAfter, error: input.id + " rate limited the request. Nothing was substituted." };
  }
  if (response.status === 401 || response.status === 403) return { dispatched: true, ok: false, text: "", model: errorModel, ...responseReceipt, httpStatus: response.status, error: input.id + " rejected the API key or account permissions." };
  if (!response.ok) return { dispatched: true, ok: false, text: "", model: errorModel, ...responseReceipt, httpStatus: response.status >= 400 && response.status < 500 ? response.status : undefined, error: input.id + " returned HTTP " + response.status + ". Nothing was substituted." };
  if (input.onDelta && response.body && response.headers?.get("content-type")?.includes("text/event-stream")) {
    const kind = input.id === "anthropic" || input.id === "gemini" ? input.id : "openai";
    const parsed = await consumeProviderStream(kind, { getReader: () => response.body!.getReader() }, input.onDelta, event => {
      const payload = input.id === "anthropic" && event.type === "message_start" ? event.message : event;
      responseReceipt = mergeProviderReceipt(responseReceipt, readProviderReceipt(input.id, payload, response.headers));
    });
    return parsed.ok ? { dispatched: true, ok: true, text: parsed.text, ...responseReceipt, usage: parsed.usage ?? responseReceipt.usage, model: parsed.model, delivery: "streamed", error: "" }
      : { dispatched: true, ok: false, text: "", model: errorModel, ...responseReceipt, delivery: "streamed", error: parsed.error };
  }
  try {
    const raw = await response.text();
    if (raw.length > 500_000) return { dispatched: true, ok: false, text: "", model: errorModel, ...responseReceipt, error: input.id + " returned a response larger than the supported limit." };
    const payload = JSON.parse(raw);
    const parsed = payload && typeof payload === "object" ? extractAssistantText(input.id, payload) : "";
    const receipt = readProviderReceipt(input.id, payload, response.headers);
    if (parsed) input.onDelta?.(parsed);
    return parsed ? { dispatched: true, ok: true, text: parsed, ...receipt, ...(input.onDelta ? { delivery: "buffered" as const } : {}), model: reportedModel(input.id === "gemini" ? payload.modelVersion : payload.model), error: "" } :
      { dispatched: true, ok: false, text: "", ...receipt, error: input.id + " returned no assistant text or an unsupported response format." };
  } catch {
    return { dispatched: true, ok: false, text: "", model: errorModel, ...responseReceipt, error: input.id + " returned an unreadable response." };
  }
}
export function httpStatusForProviderSelection(error: string): 400 | 503 {
  if (/not known/i.test(error)) return 400;
  if (/not configured|No .+ key is configured/i.test(error)) return 503;
  return 400;
}

export const NEMOTRON_MODEL = "nvidia/nemotron-nano-9b-v2:free";

/** Sends the selected model to its own runner. Never substitutes Grok. */
export async function routeSelectedModel(input: {
  id: string;
  prompt: string;
  env: Record<string, string | undefined>;
  systemPrompt?: string;
  history?: History[];
  controls?: ModelControls;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onDispatch?: () => void;
  fetch: FetchLike;
}): Promise<ProviderCallResult & { model: string; requestedModel?: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) return { dispatched: false, ok: false, text: "", error: "Write a message first. Nothing was sent.", model: input.id };
  const controls = parseModelControls(input.controls);
  if (!controls.ok) return { dispatched: false, ok: false, text: "", error: controls.error, model: input.id, httpStatus: 400 };
  if (input.id === "nemotron" || input.id === "openrouter") {
    const key = input.env.OPENROUTER_API_KEY;
    if (!key) return { dispatched: false, ok: false, text: "", error: "OpenRouter is selected, but no OpenRouter key is connected. Nothing was sent and Grok was not substituted.", model: input.id };
    const model = input.id === "nemotron" ? NEMOTRON_MODEL : input.env.OPENROUTER_MODEL?.trim() ?? "";
    const called = await callConfiguredProvider({
      id: "openrouter",
      key,
      prompt,
      systemPrompt: input.systemPrompt,
      history: input.history,
      controls: controls.controls,
      signal: input.signal,
      onDelta: input.onDelta,
      model,
      fetch: input.fetch, onDispatch: input.onDispatch,
    });
    return { ...called, model: reportedModel(called.model), requestedModel: model };
  }
  if (input.id === "ollama") {
    const url = input.env.LOCAL_MODEL_URL;
    if (!url) return { dispatched: false, ok: false, text: "", error: "Local model is selected, but no local runner is reachable. Nothing was sent and Grok was not substituted.", model: "ollama" };
    let nativeOllama = false;
    try { nativeOllama = new URL(url).pathname.replace(/\/$/, "") === "/api/generate"; } catch { /* The existing runner connection reports invalid URL errors without dispatch fallback. */ }
    if (controls.controls.answerTokens !== undefined && !nativeOllama) return { dispatched: false, ok: false, text: "", error: "The configured local runner does not declare the native Ollama answer-budget contract. Choose the provider default or configure its /api/generate endpoint. Nothing was sent.", model: "ollama", httpStatus: 400 };
    if (input.signal?.aborted) return { dispatched: false, ok: false, text: "", error: "Canceled before dispatch.", model: "model unknown" };
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      input.onDispatch?.();
      response = await input.fetch(url, { method: "POST", signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ model: input.env.OLLAMA_MODEL || "local", prompt, ...(input.systemPrompt ? { system: input.systemPrompt } : {}), ...(nativeOllama ? { stream: Boolean(input.onDelta), ...(controls.controls.answerTokens === undefined ? {} : { options: { num_predict: controls.controls.answerTokens } }) } : {}) }) });
    } catch {
      return { dispatched: true, ok: false, text: "", error: "Local model runner could not be reached. Nothing was substituted.", model: "ollama" };
    }
    const responseReceipt = readProviderReceipt("ollama", null, response.headers);
    if (!response.ok) return { dispatched: true, ok: false, text: "", ...responseReceipt, error: "Local model runner returned HTTP " + response.status + ". Nothing was substituted.", model: "ollama" };
    if (nativeOllama && input.onDelta && response.body) return { ...await consumeOllamaStream({ getReader: () => response.body!.getReader() }, input.onDelta, response.headers), dispatched: true };
    try {
      const raw = await response.text();
      if (raw.length > 500_000) return { dispatched: true, ok: false, text: "", ...responseReceipt, error: "Local model runner returned a response larger than the supported limit.", model: "ollama" };
      const json = JSON.parse(raw) as { text?: unknown; response?: unknown; model?: unknown };
      const text = typeof json?.text === "string" ? json.text.trim() : nativeOllama && typeof json?.response === "string" ? json.response.trim() : "";
      const receipt = readProviderReceipt("ollama", json, response.headers);
      if (text) input.onDelta?.(text);
      return text ? { dispatched: true, ok: true, text, error: "", ...receipt, ...(input.onDelta ? { delivery: "buffered" as const } : {}), model: reportedModel(json.model) } : { dispatched: true, ok: false, text: "", ...receipt, error: "Local model runner returned no text. Nothing was substituted.", model: "ollama" };
    } catch {
      return { dispatched: true, ok: false, text: "", ...responseReceipt, error: "Local model runner returned an unreadable response.", model: "ollama" };
    }
  }
  return { dispatched: false, ok: false, text: "", error: "That model is not a routed runner. Nothing was substituted.", model: input.id };
}
