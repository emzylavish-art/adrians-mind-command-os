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

/** Provider-reported counts only. A missing value does not mean zero or free. */
export type ProviderUsage = ModelUsage & {
  total_tokens?: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
};
export type ProviderReceipt = {
  usage: ProviderUsage | null; requestId: string | null; responseId: string | null;
  /** OpenRouter credit charge reported by that response, excluding separately billed BYOK usage. */
  reportedCostUsd?: number;
  currency?: "USD";
  /** Present only when the reported non-BYOK charge has exact integer-microdollar precision. */
  actualCostMicros?: number;
  costScope?: "openrouter_credits";
};
type UsageProtocol = "openai" | "openrouter" | "anthropic" | "gemini" | "ollama";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._~:/+=-]{1,300}$/.test(value) ? value : null;

/** Do not round a submicro charge down to free or manufacture precision from binary arithmetic. */
function exactMicros(value: number): number | undefined {
  const [coefficient, exponent = "0"] = String(value).split("e");
  const [whole, decimal = ""] = coefficient!.split(".");
  const scale = 6 + Number(exponent) - decimal.length;
  const digits = BigInt(whole! + decimal);
  const divisor = scale < 0 ? 10n ** BigInt(-scale) : 1n;
  if (digits % divisor !== 0n) return undefined;
  const micros = scale < 0 ? digits / divisor : digits * 10n ** BigInt(scale);
  return micros <= 1_000_000_000_000n ? Number(micros) : undefined;
}

/** Keep request headers separate from the completion/message ID in a JSON body. */
export function readProviderReceipt(protocol: UsageProtocol, payload: unknown, headers?: Pick<Headers, "get">): ProviderReceipt {
  const body = record(payload), usage = record(body.usage), metadata = record(body.usageMetadata);
  const values: Record<keyof ProviderUsage, unknown> = protocol === "anthropic" ? {
    prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.total_tokens,
    cached_input_tokens: usage.cache_read_input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens, reasoning_tokens: undefined,
  } : protocol === "gemini" ? {
    prompt_tokens: metadata.promptTokenCount, completion_tokens: metadata.candidatesTokenCount, total_tokens: metadata.totalTokenCount,
    cached_input_tokens: metadata.cachedContentTokenCount, cache_creation_input_tokens: undefined, reasoning_tokens: metadata.thoughtsTokenCount,
  } : protocol === "ollama" ? {
    prompt_tokens: body.prompt_eval_count, completion_tokens: body.eval_count, total_tokens: undefined,
    cached_input_tokens: undefined, cache_creation_input_tokens: undefined, reasoning_tokens: undefined,
  } : {
    prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens,
    cached_input_tokens: record(usage.prompt_tokens_details).cached_tokens, cache_creation_input_tokens: undefined,
    reasoning_tokens: record(usage.completion_tokens_details).reasoning_tokens,
  };
  const normalized: ProviderUsage = {};
  for (const [key, value] of Object.entries(values)) {
    const valid = count(value);
    if (valid !== undefined) normalized[key as keyof ProviderUsage] = valid;
  }
  // Official usage-accounting defines cost as router credits; support docs denominate credits in USD.
  // A generic OpenAI-shaped cost has no verified currency. BYOK can carry a separate upstream bill,
  // so it must retain the conservative reservation until an owner reconciles that complete charge.
  const cost = protocol === "openrouter" && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 && usage.cost <= 1_000_000 ? usage.cost : undefined;
  const micros = cost !== undefined && usage.is_byok !== true ? exactMicros(cost) : undefined;
  return {
    ...(cost !== undefined ? { reportedCostUsd: cost, currency: "USD" as const, costScope: "openrouter_credits" as const, ...(micros === undefined ? {} : { actualCostMicros: micros }) } : {}),
    usage: Object.keys(normalized).length ? normalized : null,
    requestId: identifier(headers?.get("x-request-id")) || identifier(headers?.get("request-id")) || identifier(headers?.get("x-goog-request-id")) || identifier(body.request_id),
    responseId: identifier(protocol === "gemini" ? body.responseId : body.id),
  };
}
