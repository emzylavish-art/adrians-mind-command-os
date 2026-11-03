import type { ChatContent } from "./media/types.ts";

export type ProviderName = "grok" | "openai" | "anthropic" | "gemini" | "openrouter";

const KEYS: Record<Exclude<ProviderName, "grok">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function configuredProviders(env: Record<string, string | undefined>): Record<Exclude<ProviderName, "grok">, boolean> {
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
  };
}

export function selectProvider(id: unknown, env: Record<string, string | undefined>): { ok: true; id: ProviderName; model: string } | { ok: false; error: string } {
  const name = id == null || id === "" ? "grok" : id;
  if (name === "grok") return { ok: true, id: "grok", model: "grok-4.5" };
  if (name !== "openai" && name !== "anthropic" && name !== "gemini" && name !== "openrouter") {
    return { ok: false, error: "That provider is not known. Another provider is not substituted." };
  }
  if (!env[KEYS[name]]) return { ok: false, error: `No ${name} key is configured. Another provider is not substituted.` };
  const model = name === "openai" ? "gpt-4.1-mini" : name === "anthropic" ? "claude-sonnet-4-5" : name === "gemini" ? "gemini-2.0-flash" : "openrouter/auto";
  return { ok: true, id: name, model };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** A message as assembled by assembleTurn (string or OpenAI-style multimodal parts). */
export type AssembledMessage = { role: "system" | "user" | "assistant"; content: ChatContent };
export type TextMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Upper bound on the text context sent to a non-Grok provider. Primary-side limits
 * (checkTurnSize: 8000-char turn, 12 × 8000 history, 12 × 2000 notes) keep a real turn
 * well below this, so a valid turn is sent exactly as the primary got it.
 */
export const FALLBACK_CONTEXT_MAX_CHARS = 200_000;
/** Max provider response body read (JSON). Large enough that long replies are not cut mid-JSON. */
const MAX_RESPONSE_CHARS = 2_000_000;
export const IMAGE_STUB = "[An image was attached here. This provider was sent text only and cannot see it.]";

/**
 * Flatten assembled messages to text for text-only providers. Image parts become a stub
 * (no data-URL/base64 is ever forwarded). Unknown roles and non-text content are dropped.
 * If over budget, the OLDEST non-system history is dropped first; system messages and the
 * final message (the current turn) are always kept.
 */
export function toTextOnlyMessages(messages: readonly AssembledMessage[], maxChars = FALLBACK_CONTEXT_MAX_CHARS): TextMessage[] {
  const flat: TextMessage[] = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: unknown }).role;
    if (role !== "system" && role !== "user" && role !== "assistant") continue;
    const content = (message as { content?: unknown }).content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      const pieces: string[] = [];
      let sawImage = false;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const type = (part as { type?: unknown }).type;
        if (type === "text" && typeof (part as { text?: unknown }).text === "string") pieces.push((part as { text: string }).text);
        else if (type === "image_url") sawImage = true;
      }
      text = pieces.join("\n");
      if (sawImage) text = text.trim() ? `${text}\n\n${IMAGE_STUB}` : IMAGE_STUB;
    } else continue;
    if (!text.trim()) continue;
    flat.push({ role, content: text });
  }
  const size = (list: TextMessage[]) => list.reduce((n, m) => n + m.content.length, 0);
  let total = size(flat);
  const lastIndex = flat.length - 1;
  const dropped = new Set<number>();
  for (let i = 0; i < lastIndex && total > maxChars; i++) {
    if (flat[i]!.role === "system") continue;
    dropped.add(i);
    total -= flat[i]!.content.length;
  }
  const kept = flat.filter((_, i) => !dropped.has(i));
  if (total > maxChars) {
    // Still over (pathological system/current turn): hard-cap each kept message's share.
    const share = Math.max(1, Math.floor(maxChars / Math.max(1, kept.length)));
    return kept.map((m) => ({ role: m.role, content: m.content.slice(0, share) }));
  }
  return kept;
}

/** Merge consecutive same-role turns (Anthropic/Gemini require alternation). */
function alternate(list: TextMessage[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of list) {
    if (m.role === "system") continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  // Both require the first turn to be the user's; keep a leading assistant reply as context.
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "[Earlier in this conversation:]" });
  return out;
}

/** Provider-specific JSON body for the same text-only conversation. Model ids come from the catalog. */
export function buildProviderRequestBody(id: Exclude<ProviderName, "grok">, messages: TextMessage[]): Record<string, unknown> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  if (id === "openai" || id === "openrouter") {
    return { model: id === "openai" ? "gpt-4.1-mini" : "openrouter/auto", messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  }
  const turns = alternate(messages);
  if (id === "anthropic") {
    return { model: "claude-sonnet-4-5", max_tokens: 400, ...(system ? { system } : {}), messages: turns };
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
  };
}

export async function callConfiguredProvider(input: {
  id: Exclude<ProviderName, "grok">;
  key: string;
  /** Legacy single-message call (non-Grok primary). Ignored when `messages` is given. */
  prompt?: string;
  /** Full assembled context (system, history, memory, current turn) — shared with the primary. */
  messages?: readonly AssembledMessage[];
  fetch: FetchLike;
}): Promise<{ ok: boolean; text: string; error: string }> {
  if (!input.key) return { ok: false, text: "", error: `No ${input.id} key is configured. Nothing was sent.` };
  const conversation = input.messages
    ? toTextOnlyMessages(input.messages)
    : [{ role: "user" as const, content: (typeof input.prompt === "string" ? input.prompt : "").slice(0, 4000) }];
  const last = conversation[conversation.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) {
    return { ok: false, text: "", error: `There was no message to send to ${input.id}. Nothing was sent.` };
  }
  const body = JSON.stringify(buildProviderRequestBody(input.id, conversation));
  const endpoints: Record<Exclude<ProviderName, "grok">, { url: string; headers: Record<string, string> }> = {
    openai: { url: "https://api.openai.com/v1/chat/completions", headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" } },
    anthropic: { url: "https://api.anthropic.com/v1/messages", headers: { "x-api-key": input.key, "anthropic-version": "2023-06-01", "content-type": "application/json" } },
    gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(input.key)}`, headers: { "content-type": "application/json" } },
    openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" } },
  };
  const target = endpoints[input.id];
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await input.fetch(target.url, { method: "POST", headers: target.headers, body });
  } catch {
    return { ok: false, text: "", error: `${input.id} could not be reached. Nothing was substituted.` };
  }
  if (response.status === 429) return { ok: false, text: "", error: `${input.id} rate limited the request. Nothing was substituted.` };
  if (!response.ok) return { ok: false, text: "", error: `${input.id} returned ${response.status}. Nothing was substituted.` };
  const text = await response.text();
  return { ok: Boolean(text.trim()), text: text.slice(0, MAX_RESPONSE_CHARS), error: text.trim() ? "" : `${input.id} returned an empty reply.` };
}

/** Map provider selection failures to HTTP status. Unknown → 400; missing key/config → 503. */
export function httpStatusForProviderSelection(error: string): 400 | 503 {
  if (/not known/i.test(error)) return 400;
  if (/not configured|No .+ key is configured/i.test(error)) return 503;
  return 400;
}

/**
 * Map a Grok-path turn failure message to HTTP status so failures are never 200.
 * Halt → 409; server misconfig / model unavailable → 503; validation → 400.
 */
export function httpStatusForTurnFailure(error: string): 400 | 409 | 503 {
  if (/emergency stop/i.test(error)) return 409;
  if (/not configured|not available|forbidden project|project URL and project ref/i.test(error)) return 503;
  return 400;
}
