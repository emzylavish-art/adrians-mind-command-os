import type { ModelUsage } from "./stream.ts";

export type ProviderReceipt = {
  usage: ModelUsage | null;
  requestId: string | null;
  executionLocation: "local" | "hosted";
};

export function normalizeProviderReceipt(provider: string, raw: unknown, headers?: Pick<Headers, "get">): ProviderReceipt {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const gemini = body.usageMetadata && typeof body.usageMetadata === "object" ? body.usageMetadata as Record<string, unknown> : {};
  const valid = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const prompt_tokens = valid(provider === "anthropic" ? usage.input_tokens : provider === "gemini" ? gemini.promptTokenCount
    : provider === "ollama" ? body.prompt_eval_count ?? usage.prompt_tokens : usage.prompt_tokens);
  const completion_tokens = valid(provider === "anthropic" ? usage.output_tokens : provider === "gemini" ? gemini.candidatesTokenCount
    : provider === "ollama" ? body.eval_count ?? usage.completion_tokens : usage.completion_tokens);
  const id = [headers?.get("x-request-id"), headers?.get("request-id"), body.request_id, body.requestId, body.responseId, body.id]
    .find((value) => typeof value === "string" && value.trim() && value.length <= 300 && !/[\r\n]/.test(value));
  return {
    usage: prompt_tokens === undefined && completion_tokens === undefined ? null : {
      ...(prompt_tokens !== undefined ? { prompt_tokens } : {}), ...(completion_tokens !== undefined ? { completion_tokens } : {}),
    },
    requestId: typeof id === "string" ? id.trim() : null,
    executionLocation: provider === "ollama" ? "local" : "hosted",
  };
}
