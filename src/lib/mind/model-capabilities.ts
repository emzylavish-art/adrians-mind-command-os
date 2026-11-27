/** Capability declarations are separate from successful inference evidence. */
export type ModelCapabilities = {
  imageInput: "supported" | "unsupported" | "unknown";
  source: "catalogue" | "adapter_profile" | "unknown";
  reasoningLevels: string[];
  contextWindowTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  limitsSource?: "catalogue";
};
export type ModelCapabilityRegistry = Record<string, ModelCapabilities>;
const tokenLimit = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

function declaredLimits(item: Record<string, unknown>): Pick<ModelCapabilities, "contextWindowTokens" | "maxInputTokens" | "maxOutputTokens" | "limitsSource"> {
  const topProvider = item.top_provider && typeof item.top_provider === "object" ? item.top_provider as Record<string, unknown> : {};
  const contextWindowTokens = tokenLimit(item.context_length ?? item.context_window);
  const maxInputTokens = tokenLimit(item.input_token_limit ?? item.inputTokenLimit ?? item.max_input_tokens);
  const maxOutputTokens = tokenLimit(item.output_token_limit ?? item.outputTokenLimit ?? item.max_output_tokens ?? topProvider.max_completion_tokens);
  return { ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }), ...(maxInputTokens === undefined ? {} : { maxInputTokens }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }), ...(contextWindowTokens !== undefined || maxInputTokens !== undefined || maxOutputTokens !== undefined ? { limitsSource: "catalogue" as const } : {}) };
}

export function modelCapabilities(host: string, id: string, metadata?: unknown): ModelCapabilities {
  const item = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const architecture = item.architecture && typeof item.architecture === "object" ? item.architecture as Record<string, unknown> : {};
  const declared = architecture.input_modalities ?? item.input_modalities;
  const modalities = Array.isArray(declared) ? declared.filter((value): value is string => typeof value === "string") : [];
  const limits = declaredLimits(item);
  if (modalities.length) return { imageInput: modalities.includes("image") ? "supported" : "unsupported", source: "catalogue", reasoningLevels: [], ...limits };
  // Conservative adapter profiles for documented vision families. Unknown model
  // names do not inherit vision merely because they share a provider hostname.
  const knownVision = (host === "api.openai.com" && /^(?:gpt-4o(?:-|$)|gpt-4\.1(?:-|$)|gpt-5(?:-(?:mini|nano))?$)/.test(id)) ||
    (host === "api.anthropic.com" && /^(?:claude-3(?:-|\.)|claude-(?:sonnet|opus|haiku)-4(?:-|\.)|claude-(?:sonnet|opus|haiku)-4$)/.test(id)) ||
    (host === "generativelanguage.googleapis.com" && /^(?:models\/)?gemini-(?:2\.0-flash|2\.5-(?:flash|pro)|3-(?:flash|pro))(?:-|$)/.test(id)) ||
    (host === "api.x.ai" && /^grok-(?:4\.[3-7]|4\.20-0309-non-reasoning)$/.test(id));
  return { imageInput: knownVision ? "supported" : "unknown", source: knownVision ? "adapter_profile" : "unknown", reasoningLevels: [], ...limits };
}

export function catalogCapabilities(host: string, entries: unknown[], ids: string[]): ModelCapabilityRegistry {
  const byId = new Map(entries.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id : typeof value.name === "string" ? value.name : "";
    return id ? [[id, value] as const] : [];
  }));
  return Object.fromEntries(ids.map(id => [id, modelCapabilities(host, id, byId.get(id))]));
}

export function readModelCapabilityRegistry(value: unknown): ModelCapabilityRegistry {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return {}; } }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
    if (!entry || typeof entry !== "object" || !["supported", "unsupported", "unknown"].includes(entry.imageInput) || !["catalogue", "adapter_profile", "unknown"].includes(entry.source)) return [];
    const limits = entry.limitsSource === "catalogue" ? declaredLimits({ context_length: entry.contextWindowTokens, input_token_limit: entry.maxInputTokens, output_token_limit: entry.maxOutputTokens }) : {};
    return [[id, { imageInput: entry.imageInput, source: entry.source, reasoningLevels: Array.isArray(entry.reasoningLevels) ? entry.reasoningLevels.filter((level: unknown) => typeof level === "string" && level.length < 30).slice(0, 12) : [], ...limits } as ModelCapabilities]];
  }));
}

export function imageCapabilityBlockReason(host: string, id: string, registry: unknown): string | null {
  const capability = readModelCapabilityRegistry(registry)[id] || modelCapabilities(host, id);
  if (capability.imageInput === "supported") return null;
  return capability.imageInput === "unsupported"
    ? "The selected model is declared text-only. Choose an image-capable model explicitly; nothing was sent."
    : "Image support for the selected model is unconfirmed. Refresh its catalogue or choose a documented image-capable model explicitly; nothing was sent.";
}
