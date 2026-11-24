/** Bounded provider-specific chat calls with normalised assistant text. */
import { reportedModel } from "./stream.ts";

export type ProviderName = "grok" | "openai" | "anthropic" | "gemini" | "openrouter";
type OtherProvider = Exclude<ProviderName, "grok">;
type History = { role: "user" | "assistant"; content: string };
const KEYS: Record<OtherProvider, string> = {
  openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY",
};
const MODELS: Record<OtherProvider, string> = {
  openai: "gpt-4.1-mini", anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.0-flash", openrouter: "openrouter/auto",
};
export function configuredProviders(env: Record<string, string | undefined>): Record<OtherProvider, boolean> {
  return {
    openai: Boolean(env.OPENAI_API_KEY), anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY), openrouter: Boolean(env.OPENROUTER_API_KEY),
  };
}
export function selectProvider(id: unknown, env: Record<string, string | undefined>):
  { ok: true; id: ProviderName; model: string } | { ok: false; error: string } {
  const name = id == null || id === "" ? "grok" : id;
  if (name === "grok") return { ok: true, id: "grok", model: "grok-4.5" };
  if (name !== "openai" && name !== "anthropic" && name !== "gemini" && name !== "openrouter") {
    return { ok: false, error: "That provider is not known. Another provider is not substituted." };
  }
  if (!env[KEYS[name]]) return { ok: false, error: "No " + name + " key is configured. Another provider is not substituted." };
  return { ok: true, id: name, model: MODELS[name] };
}
type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
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
    text = Array.isArray(parts) ? parts.map((p: { text?: unknown }) => typeof p?.text === "string" ? p.text : "").join("") : "";
  }
  return text.trim().slice(0, 4000);
}
export async function callConfiguredProvider(input: {
  id: OtherProvider;
  key: string;
  prompt: string;
  systemPrompt?: string;
  history?: History[];
  fetch: FetchLike;
}): Promise<{ ok: boolean; text: string; error: string; model?: string }> {
  if (!input.key) return { ok: false, text: "", error: "No " + input.id + " key is configured. Nothing was sent." };
  const prompt = input.prompt.trim().slice(0, 4000);
  if (!prompt) return { ok: false, text: "", error: "Write a message first." };
  const history = (input.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const systemPrompt = input.systemPrompt?.trim().slice(0, 5000);
  const messages = [...history, { role: "user" as const, content: prompt }];
  const completionMessages = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...messages,
  ];
  const models = MODELS;
  const endpoints: Record<OtherProvider, { url: string; init: RequestInit }> = {
    openai: {
      url: "https://api.openai.com/v1/chat/completions",
      init: { headers: { authorization: "Bearer " + input.key, "content-type": "application/json" },
        body: JSON.stringify({ model: models.openai, messages: completionMessages }) },
    },
    anthropic: {
      url: "https://api.anthropic.com/v1/messages",
      init: { headers: { "x-api-key": input.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: models.anthropic, max_tokens: 400, ...(systemPrompt ? { system: systemPrompt } : {}), messages }) },
    },
    gemini: {
      url: "https://generativelanguage.googleapis.com/v1beta/models/" + models.gemini + ":generateContent?key=" + encodeURIComponent(input.key),
      init: { headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      }) },
    },
    openrouter: {
      url: "https://openrouter.ai/api/v1/chat/completions",
      init: { headers: { authorization: "Bearer " + input.key, "content-type": "application/json" },
        body: JSON.stringify({ model: models.openrouter, messages: completionMessages }) },
    },
  };
  const target = endpoints[input.id];
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await input.fetch(target.url, { method: "POST", ...target.init, signal: AbortSignal.timeout(25_000) });
  } catch {
    return { ok: false, text: "", error: input.id + " could not be reached. Nothing was substituted." };
  }
  if (response.status === 429) return { ok: false, text: "", error: input.id + " rate limited the request. Nothing was substituted." };
  if (response.status === 401 || response.status === 403) return { ok: false, text: "", error: input.id + " rejected the API key or account permissions." };
  if (!response.ok) return { ok: false, text: "", error: input.id + " returned HTTP " + response.status + ". Nothing was substituted." };
  try {
    const raw = await response.text();
    const payload = raw.length <= 500_000 ? JSON.parse(raw) : null;
    const parsed = payload && typeof payload === "object" ? extractAssistantText(input.id, payload) : "";
    return parsed ? { ok: true, text: parsed, model: reportedModel(input.id === "gemini" ? payload.modelVersion : payload.model), error: "" } :
      { ok: false, text: "", error: input.id + " returned no assistant text or an unsupported response format." };
  } catch {
    return { ok: false, text: "", error: input.id + " returned an unreadable response." };
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
  history?: History[];
  fetch: FetchLike;
}): Promise<{ ok: boolean; text: string; error: string; model: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, text: "", error: "Write a message first. Nothing was sent.", model: input.id };
  if (input.id === "nemotron" || input.id === "openrouter") {
    const key = input.env.OPENROUTER_API_KEY;
    if (!key) return { ok: false, text: "", error: "OpenRouter is selected, but no OpenRouter key is connected. Nothing was sent and Grok was not substituted.", model: input.id };
    const model = input.id === "nemotron" ? NEMOTRON_MODEL : (input.env.OPENROUTER_MODEL || "openrouter/auto");
    const called = await callConfiguredProvider({
      id: "openrouter",
      key,
      prompt,
      history: input.history,
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        body.model = model;
        return input.fetch(url, { ...init, body: JSON.stringify(body) });
      },
    });
    return { ...called, model: reportedModel(called.model) };
  }
  if (input.id === "ollama") {
    const url = input.env.LOCAL_MODEL_URL;
    if (!url) return { ok: false, text: "", error: "Local model is selected, but no local runner is reachable. Nothing was sent and Grok was not substituted.", model: "ollama" };
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await input.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: input.env.OLLAMA_MODEL || "local", prompt }) });
    } catch {
      return { ok: false, text: "", error: "Local model runner could not be reached. Nothing was substituted.", model: "ollama" };
    }
    if (!response.ok) return { ok: false, text: "", error: "Local model runner returned HTTP " + response.status + ". Nothing was substituted.", model: "ollama" };
    try {
      const json = JSON.parse(await response.text()) as { text?: unknown; model?: unknown };
      const text = typeof json.text === "string" ? json.text.trim() : "";
      return text ? { ok: true, text, error: "", model: reportedModel(json.model) } : { ok: false, text: "", error: "Local model runner returned no text. Nothing was substituted.", model: "ollama" };
    } catch {
      return { ok: false, text: "", error: "Local model runner returned an unreadable response.", model: "ollama" };
    }
  }
  return { ok: false, text: "", error: "That model is not a routed runner. Nothing was substituted.", model: input.id };
}
