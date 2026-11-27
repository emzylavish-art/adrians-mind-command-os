import { readModelCapabilityRegistry, type ModelCapabilities, type ModelCapabilityRegistry } from "./model-capabilities.ts";
import { validCatalogModelId } from "./provider-catalog.ts";

export const ENVIRONMENT_PROVIDERS = ["grok", "openai", "anthropic", "gemini", "openrouter", "ollama"] as const;
export type EnvironmentProvider = typeof ENVIRONMENT_PROVIDERS[number];
export const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export type EnvironmentModelCatalog = {
  provider: EnvironmentProvider;
  configured: boolean;
  discoverySupported: boolean;
  state: "unverified" | "catalogued" | "stale" | "unavailable" | "unconfigured";
  models: string[];
  capabilities: ModelCapabilityRegistry;
  checkedAt: string | null;
  expiresAt: string | null;
  error: string | null;
  inferenceVerified: false;
};
export function environmentProvider(value: unknown): EnvironmentProvider | null {
  if (value === "xai") return "grok";
  if (value === "nemotron") return "openrouter";
  return ENVIRONMENT_PROVIDERS.includes(value as EnvironmentProvider) ? value as EnvironmentProvider : null;
}

export function normalizeEnvironmentCatalog(value: unknown, now = Date.now()): EnvironmentModelCatalog | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>, provider = environmentProvider(row.provider);
  if (!provider || !Array.isArray(row.models) || row.models.length > 4000) return null;
  const models = [...new Set(row.models.filter((id): id is string => typeof id === "string" && validCatalogModelId(id)))];
  const checkedAt = typeof row.checkedAt === "string" && Number.isFinite(Date.parse(row.checkedAt)) ? row.checkedAt : null;
  const expiresAt = checkedAt ? new Date(Date.parse(checkedAt) + MODEL_CATALOG_TTL_MS).toISOString() : null;
  let state: EnvironmentModelCatalog["state"] = row.configured !== true ? "unconfigured" : row.state === "catalogued" || row.state === "stale" ? row.state : row.state === "unavailable" ? "unavailable" : "unverified";
  if ((state === "catalogued" || state === "stale") && (!expiresAt || Date.parse(expiresAt) <= now || Date.parse(checkedAt!) > now + 60_000)) state = "stale";
  return { provider, configured: row.configured === true, discoverySupported: row.discoverySupported === true, state, models,
    capabilities: readModelCapabilityRegistry(row.capabilities), checkedAt, expiresAt,
    error: typeof row.error === "string" && row.error ? row.error.slice(0, 500) : null, inferenceVerified: false };
}

/** Shared by picker, Auto validation and the last server preflight; never selects a replacement. */
export function environmentModelReadiness(catalog: EnvironmentModelCatalog | null | undefined, model: string, requirements: { images?: number; outputTokens?: number } = {}, now = Date.now()):
  { ok: true; availability: "unverified" | "catalogued"; verifiedInference: false; capabilities?: ModelCapabilities } |
  { ok: false; availability: "unavailable" | "stale" | "unconfigured"; verifiedInference: false; error: string } {
  const snapshot = normalizeEnvironmentCatalog(catalog, now);
  if (!snapshot || snapshot.state === "unverified") return { ok: true, availability: "unverified", verifiedInference: false };
  const fail = (availability: "unavailable" | "stale" | "unconfigured", error: string) => ({ ok: false as const, availability, verifiedInference: false as const, error });
  if (snapshot.state === "unconfigured") return fail("unconfigured", "The selected environment provider is not configured. Nothing was substituted.");
  if (snapshot.state === "stale") return fail("stale", "The selected provider's model catalogue is stale. Refresh models explicitly before this request; another model is not substituted.");
  if (snapshot.state === "unavailable") return fail("unavailable", snapshot.error || "The selected provider catalogue is unavailable. Refresh it before sending; another model is not substituted.");
  if (!snapshot.models.includes(model)) return fail("unavailable", `The selected model ${model} is absent from the current provider catalogue. Your choice was preserved; choose another model explicitly.`);
  const capabilities = snapshot.capabilities[model];
  if (requirements.images && capabilities?.imageInput !== "supported") return fail("unavailable", capabilities?.imageInput === "unsupported" ? "The current catalogue declares this model text-only. The current image request is blocked." : "Image support is not declared for this model. The current image request is blocked.");
  if (requirements.outputTokens !== undefined && capabilities?.maxOutputTokens !== undefined && requirements.outputTokens > capabilities.maxOutputTokens) return fail("unavailable", `The selected model declares at most ${capabilities.maxOutputTokens} output tokens. Reduce the answer budget explicitly.`);
  return { ok: true, availability: "catalogued", verifiedInference: false, ...(capabilities ? { capabilities } : {}) };
}

export function catalogForProvider(catalogs: readonly EnvironmentModelCatalog[], provider: unknown): EnvironmentModelCatalog | undefined {
  const id = environmentProvider(provider); return catalogs.find(catalog => catalog.provider === id);
}

export function environmentModelChoices(catalog: EnvironmentModelCatalog | null | undefined, configuredModels: readonly string[], selected?: string | null) {
  const models = [...new Set([...(selected ? [selected] : []), ...configuredModels, ...(catalog?.models ?? [])])];
  return models.map(model => ({ model, ...environmentModelReadiness(catalog, model) }));
}
