import type { ModelUsage } from "./stream.ts";

export function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
export function normalizeProviderUsage(provider: string, payload: unknown): ModelUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, any>;
  const source = provider === "gemini" ? p.usageMetadata : provider === "ollama" ? p : p.usage;
  if (!source || typeof source !== "object") return null;
  const prompt = validTokenCount(provider === "gemini" ? source.promptTokenCount : provider === "anthropic" ? source.input_tokens : provider === "ollama" ? source.prompt_eval_count : source.prompt_tokens);
  const completion = validTokenCount(provider === "gemini" ? source.candidatesTokenCount : provider === "anthropic" ? source.output_tokens : provider === "ollama" ? source.eval_count : source.completion_tokens);
  return prompt === undefined && completion === undefined ? null : {
    ...(prompt === undefined ? {} : { prompt_tokens: prompt }),
    ...(completion === undefined ? {} : { completion_tokens: completion }),
  };
}
export function providerRequestId(headers?: Pick<Headers, "get">, payload?: unknown): string | null {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const value = headers?.get("x-request-id") || headers?.get("request-id") || headers?.get("x-goog-request-id") || p.responseId || p.id;
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z0-9_.:/-]+$/.test(value) ? value : null;
}
