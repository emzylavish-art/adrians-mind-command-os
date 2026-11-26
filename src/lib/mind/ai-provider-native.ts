/**
 * Provider-specific REST format adapters for the encrypted BYOK registry.
 * All inputs are server-owned and credentials are never echoed into results.
 * Host and HTTPS/DNS validation happens in requestProvider() before dispatch.
 */
import { reportedModel } from "./stream.ts";
import { OPENROUTER_FREE_ROUTING } from "./provider-catalog.ts";

export type AiWireProtocol = "openai" | "anthropic" | "gemini";
export type TextTurn = { role: "system" | "user" | "assistant"; content: string };
export type ProviderRequest = { path: string; headers: Record<string, string>; body: string };
export type ParsedAnswer =
  | { ok: true; text: string; model: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null }
  | { ok: false; error: string };

export function providerWireProtocol(baseUrl: string): AiWireProtocol {
  let host = "";
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return "openai"; }
  if (host === "api.anthropic.com") return "anthropic";
  if (host === "generativelanguage.googleapis.com") return "gemini";
  return "openai";
}

export function modelDiscoveryHeaders(kind: AiWireProtocol, key: string): Record<string, string> {
  if (kind === "anthropic") return {
    "x-api-key": key, "anthropic-version": "2023-06-01", accept: "application/json",
  };
  if (kind === "gemini") return { "x-goog-api-key": key, accept: "application/json" };
  return { authorization: "Bearer " + key, accept: "application/json" };
}

export function buildProviderChatRequest(
  kind: AiWireProtocol, key: string, model: string, turns: TextTurn[], freeOpenRouter = false,
): ProviderRequest {
  const messages = turns.slice(-15);
  const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversational = messages.filter((m) => m.role !== "system");
  if (kind === "anthropic") {
    return {
      path: "messages",
      headers: { ...modelDiscoveryHeaders(kind, key), "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 2048,
        ...(systemText ? { system: systemText } : {}),
        messages: conversational.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    };
  }
  if (kind === "gemini") {
    const id = model.startsWith("models/") ? model.slice("models/".length) : model;
    return {
      path: "models/" + encodeURIComponent(id) + ":generateContent",
      headers: { ...modelDiscoveryHeaders(kind, key), "content-type": "application/json" },
      body: JSON.stringify({
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        generationConfig: { maxOutputTokens: 2048 },
        contents: conversational.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      }),
    };
  }
  return {
    path: "chat/completions",
    headers: { ...modelDiscoveryHeaders(kind, key), "content-type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 2048, stream: false, ...(freeOpenRouter ? { provider: OPENROUTER_FREE_ROUTING } : {}) }),
  };
}

const trimmedText = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const usagePair = (prompt: unknown, completion: unknown) => {
  const prompt_tokens = typeof prompt === "number" && Number.isFinite(prompt) && prompt >= 0 ? prompt : undefined;
  const completion_tokens = typeof completion === "number" && Number.isFinite(completion) && completion >= 0 ? completion : undefined;
  return prompt_tokens === undefined && completion_tokens === undefined ? null : { prompt_tokens, completion_tokens };
};
const toolRefused: ParsedAnswer = {
  ok: false,
  error: "The model requested tool execution, which is not enabled for this custom provider. Nothing was executed.",
};

export function parseProviderText(kind: AiWireProtocol, raw: string): ParsedAnswer {
  let data: unknown;
  try { data = JSON.parse(raw); } catch {
    return { ok: false, error: "The provider returned an unreadable JSON response." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "The provider returned an unexpected response." };
  }
  const body = data as Record<string, unknown>;
  let text = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  if (kind === "anthropic") {
    const content = Array.isArray(body.content) ? body.content as Record<string, unknown>[] : [];
    if (content.some((p) => p && p.type === "tool_use") || body.stop_reason === "tool_use") return toolRefused;
    text = content.filter((p) => p && p.type === "text").map((p) => trimmedText(p.text)).filter(Boolean).join("\n").trim();
    const u = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
    usage = usagePair(u.input_tokens, u.output_tokens);
  } else if (kind === "gemini") {
    const candidates = Array.isArray(body.candidates) ? body.candidates as Record<string, unknown>[] : [];
    const first = candidates[0] ?? {};
    const content = first.content && typeof first.content === "object" ? first.content as Record<string, unknown> : {};
    const parts = Array.isArray(content.parts) ? content.parts as Record<string, unknown>[] : [];
    if (parts.some((p) => p && "functionCall" in p)) return toolRefused;
    text = parts.map((p) => trimmedText(p?.text)).filter(Boolean).join("\n").trim();
    const u = body.usageMetadata && typeof body.usageMetadata === "object" ? body.usageMetadata as Record<string, unknown> : {};
    usage = usagePair(u.promptTokenCount, u.candidatesTokenCount);
  } else {
    const choices = Array.isArray(body.choices) ? body.choices as Record<string, unknown>[] : [];
    const first = choices[0] ?? {};
    const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) return toolRefused;
    if (typeof message.content === "string") text = trimmedText(message.content);
    else if (Array.isArray(message.content)) {
      text = (message.content as Record<string, unknown>[]).filter((p) => p?.type === "text")
        .map((p) => trimmedText(p.text)).filter(Boolean).join("\n").trim();
    }
    const u = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
    usage = usagePair(u.prompt_tokens, u.completion_tokens);
  }
  if (!text) return { ok: false, error: "The provider returned no assistant text." };
  return { ok: true, text, model: reportedModel(kind === "gemini" ? body.modelVersion : body.model), usage };
}
