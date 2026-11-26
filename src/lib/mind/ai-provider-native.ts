/**
 * Provider-specific REST format adapters for the encrypted BYOK registry.
 * All inputs are server-owned and credentials are never echoed into results.
 * Host and HTTPS/DNS validation happens in requestProvider() before dispatch.
 */
import { reportedModel } from "./stream.ts";
import { sanitizeAttachments } from "./media/pack.ts";
import { MAX_DATA_URL_CHARS, type ChatContent, type ImageAttachment } from "./media/types.ts";
import type { ModelControls } from "./model-tiers.ts";
import { OPENROUTER_FREE_ROUTING } from "./provider-catalog.ts";

export type AiWireProtocol = "openai" | "anthropic" | "gemini";
export type TextTurn = { role: "system" | "user" | "assistant"; content: string; images?: ImageAttachment[] };
export type ProviderRequest = { path: string; headers: Record<string, string>; body: string };
export type ProviderChatOptions = { stream?: boolean; images?: ImageAttachment[]; controls?: ModelControls };
export type ParsedAnswer =
  | { ok: true; text: string; model: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null }
  | { ok: false; error: string };

/** Preserve historical source labels and turn position; resolve no external image URLs. */
export function toNativeProviderTurns(messages: { role: "system" | "user" | "assistant"; content: ChatContent }[]): { ok: true; messages: TextTurn[] } | { ok: false; error: string } {
  const turns: TextTurn[] = [];
  let imageCount = 0, imageChars = 0;
  for (const message of messages) {
    if (typeof message.content === "string") { turns.push({ role: message.role, content: message.content }); continue; }
    const text: string[] = [], images: ImageAttachment[] = [];
    for (const part of message.content) {
      if (part.type === "text") text.push(part.text);
      else if (part.type === "image_url") {
        const safe = sanitizeAttachments([{ dataUrl: part.image_url.url }]);
        if (safe.length !== 1 || message.role !== "user") return { ok: false, error: "Historical image content must use validated embedded data in a labelled user reference. Nothing was sent." };
        images.push(safe[0]); imageCount++; imageChars += safe[0].dataUrl.length;
      } else return { ok: false, error: "The provider adapter does not support one of the message content parts. Nothing was sent." };
    }
    if (imageCount > 7 || imageChars > MAX_DATA_URL_CHARS * 3) return { ok: false, error: "Historical and current images exceed this adapter's bounded image context. Choose fewer image references explicitly." };
    turns.push({ role: message.role, content: text.join("\n"), ...(images.length ? { images } : {}) });
  }
  return { ok: true, messages: turns };
}

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
  kind: AiWireProtocol, key: string, model: string, turns: TextTurn[], freeOpenRouter = false, options: ProviderChatOptions = {},
): ProviderRequest {
  const messages = turns;
  const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversational = messages.filter((m) => m.role !== "system");
  const lastUser = messages.map(turn => turn.role).lastIndexOf("user");
  if (options.images?.length && lastUser < 0) throw new Error("Image input requires a user message.");
  let imageCount = 0, imageChars = 0;
  const imageParts = new Map<TextTurn, { mime: string; data: string; dataUrl: string }[]>();
  messages.forEach((message, index) => {
    const supplied = [...(message.images || []), ...(index === lastUser ? options.images || [] : [])];
    const images = sanitizeAttachments(supplied);
    if (images.length !== supplied.length || (images.length && message.role !== "user")) throw new Error("One or more images could not be validated at their source turn. Nothing was sent.");
    imageCount += images.length; imageChars += images.reduce((sum, image) => sum + image.dataUrl.length, 0);
    imageParts.set(message, images.map(image => {
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
      if (!match) throw new Error("An image is not supported by this provider adapter.");
      return { mime: match[1], data: match[2], dataUrl: image.dataUrl };
    }));
  });
  if (imageCount > 7 || imageChars > MAX_DATA_URL_CHARS * 3) throw new Error("The selected image context exceeds this provider adapter's supported bound. Nothing was sent.");
  const answerTokens = options.controls?.answerTokens;
  if (answerTokens !== undefined && (!Number.isInteger(answerTokens) || answerTokens < 128 || answerTokens > 16384)) throw new Error("Invalid answer token budget.");
  if (kind === "anthropic") {
    return {
      path: "messages",
      headers: { ...modelDiscoveryHeaders(kind, key), "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: answerTokens ?? 2048,
        ...(systemText ? { system: systemText } : {}),
        messages: conversational.map(m => { const parts = imageParts.get(m) || []; return { role: m.role, content: parts.length ? [{ type: "text", text: m.content }, ...parts.map(image => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } }))] : m.content }; }),
        stream: options.stream === true,
      }),
    };
  }
  if (kind === "gemini") {
    const id = model.startsWith("models/") ? model.slice("models/".length) : model;
    return {
      path: "models/" + encodeURIComponent(id) + (options.stream ? ":streamGenerateContent?alt=sse" : ":generateContent"),
      headers: { ...modelDiscoveryHeaders(kind, key), "content-type": "application/json" },
      body: JSON.stringify({
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents: conversational.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }, ...(imageParts.get(m) || []).map(image => ({ inlineData: { mimeType: image.mime, data: image.data } }))],
        })),
        ...(answerTokens ? { generationConfig: { maxOutputTokens: answerTokens } } : {}),
      }),
    };
  }
  return {
    path: "chat/completions",
    headers: { ...modelDiscoveryHeaders(kind, key), "content-type": "application/json" },
    body: JSON.stringify({ model, messages: messages.map(message => { const parts = imageParts.get(message) || []; return { role: message.role, content: parts.length ? [{ type: "text", text: message.content }, ...parts.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))] : message.content }; }), stream: options.stream === true, ...(options.stream ? { stream_options: { include_usage: true } } : {}), ...(answerTokens ? { max_tokens: answerTokens } : {}), ...(freeOpenRouter ? { provider: OPENROUTER_FREE_ROUTING } : {}) }),
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
    text = parts.filter((p) => p?.thought !== true).map((p) => trimmedText(p?.text)).filter(Boolean).join("\n").trim();
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
