import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";
import { catalogCapabilities } from "./model-capabilities.ts";
import { validCatalogModelId } from "./provider-catalog.ts";
import { modelDiscoveryHeaders, providerWireProtocol } from "./ai-provider-native.ts";
import { readXaiApiKey, resolveXaiInferenceApiKey } from "./xai-adapter.ts";
import { ENVIRONMENT_PROVIDERS, environmentProvider, environmentModelReadiness, normalizeEnvironmentCatalog, type EnvironmentModelCatalog, type EnvironmentProvider } from "./environment-model-catalog.ts";

type CatalogRow = { provider: string; credential_fingerprint: string; state: string; models: unknown; capabilities: unknown; last_error: string; checked_at: string | Date };
export type EnvironmentCatalogDeps = { sql?: Sql; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => number };
const sqlFor = async (deps: EnvironmentCatalogDeps) => deps.sql ?? (await import("../db.ts")).getSql();
function connection(provider: EnvironmentProvider, env: Record<string, string | undefined>, loadSecrets = true) {
  const bases = { grok: "https://api.x.ai/v1", openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta", openrouter: "https://openrouter.ai/api/v1", ollama: "" };
  const names = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY" };
  const xai = provider === "grok" ? loadSecrets ? resolveXaiInferenceApiKey(env) : readXaiApiKey(env) : null;
  const key = provider === "grok" ? xai?.ok ? xai.key : "" : provider === "ollama" ? "" : env[names[provider]]?.trim() || "";
  let base = bases[provider], supported = true;
  if (provider === "ollama") {
    try { const url = new URL(env.LOCAL_MODEL_URL?.trim() || ""); supported = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname.replace(/\/$/, "") === "/api/generate"; base = supported ? url.origin : env.LOCAL_MODEL_URL?.trim() || ""; }
    catch { supported = false; base = env.LOCAL_MODEL_URL?.trim() || ""; }
  }
  return { base, key, supported, configured: provider === "ollama" ? Boolean(env.LOCAL_MODEL_URL?.trim()) : Boolean(key),
    fingerprint: createHash("sha256").update(JSON.stringify([provider, base, key, provider === "ollama" ? env.LOCAL_MODEL_URL : null])).digest("hex") };
}
function unobserved(provider: EnvironmentProvider, target: ReturnType<typeof connection>): EnvironmentModelCatalog {
  return { provider, configured: target.configured, discoverySupported: target.supported, state: target.configured ? "unverified" : "unconfigured", models: [], capabilities: {}, checkedAt: null, expiresAt: null, error: null, inferenceVerified: false };
}
export function unavailableEnvironmentCatalogs(env: Record<string, string | undefined> = process.env): EnvironmentModelCatalog[] {
  return ENVIRONMENT_PROVIDERS.map(provider => { const row = unobserved(provider, connection(provider, env)); return row.configured ? { ...row, state: "unavailable", error: "Current model catalogue storage is unavailable. Refresh after recovery; inference availability is unverified." } : row; });
}

export async function listEnvironmentModelCatalogs(ownerId: string, deps: EnvironmentCatalogDeps = {}): Promise<EnvironmentModelCatalog[]> {
  const env = deps.env ?? process.env, now = deps.now?.() ?? Date.now();
  const rows = await (await sqlFor(deps)).query<CatalogRow>("select provider,credential_fingerprint,state,models,capabilities,last_error,checked_at from mind_environment_model_catalogs where user_id=$1", [ownerId]);
  return ENVIRONMENT_PROVIDERS.map(provider => {
    const target = connection(provider, env, deps.env === undefined), prior = rows.find(row => row.provider === provider && row.credential_fingerprint === target.fingerprint);
    if (!prior || !target.configured) return unobserved(provider, target);
    const json = (value: unknown, fallback: unknown) => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return fallback; } };
    return normalizeEnvironmentCatalog({ ...unobserved(provider, target), state: prior.state, models: json(prior.models, []), capabilities: json(prior.capabilities, {}), error: prior.last_error,
      checkedAt: prior.checked_at instanceof Date ? prior.checked_at.toISOString() : prior.checked_at }, now)!;
  });
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("empty");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let raw = "", bytes = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 8_000_000) throw new Error("size"); raw += decoder.decode(next.value, { stream: true }); }
    raw += decoder.decode(); const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return value as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** GET model metadata on explicit owner refresh. No inference, auto retry or fallback. */
export async function refreshEnvironmentModelCatalog(ownerId: string, providerRaw: unknown, deps: EnvironmentCatalogDeps = {}): Promise<{ ok: true; catalog: EnvironmentModelCatalog } | { ok: false; error: string; catalog?: EnvironmentModelCatalog }> {
  const provider = environmentProvider(providerRaw);
  if (!provider) return { ok: false, error: "Unknown environment provider." };
  const target = connection(provider, deps.env ?? process.env, deps.env === undefined), sql = await sqlFor(deps), now = deps.now?.() ?? Date.now();
  if (!target.configured) return { ok: false, error: "The selected server provider has no configured credential or endpoint.", catalog: unobserved(provider, target) };
  if (!target.supported) return { ok: false, error: "This legacy local runner has no model-list adapter. Its configuration remains unverified; no probe or inference was sent.", catalog: unobserved(provider, target) };
  let state = "catalogued", error = "", entries: Record<string, unknown>[] = [];
  try {
    const url = new URL(provider === "ollama" ? target.base + "/api/tags" : target.base + (provider === "grok" ? "/language-models" : "/models"));
    if (provider === "gemini") url.searchParams.set("pageSize", "1000");
    if (provider === "anthropic") url.searchParams.set("limit", "1000");
    const seenPages = new Set<string>();
    for (let page = 0; page < 8; page++) {
      if (seenPages.has(url.href)) throw new Error("pagination"); seenPages.add(url.href);
      const response = await (deps.fetchImpl ?? fetch)(url.href, { method: "GET", headers: provider === "ollama" ? {} : modelDiscoveryHeaders(providerWireProtocol(target.base), target.key), redirect: "manual", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`http:${response.status}`);
      const payload = await readBoundedJson(response);
      const listed = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : null;
      if (!listed) throw new Error("shape");
      for (const raw of listed) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("shape");
        const row = raw as Record<string, unknown>;
        if (row.lifecycle === "retired") continue;
        if (provider === "gemini" && Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes("generateContent")) continue;
        const name = row.id ?? row.name ?? row.model;
        if (typeof name !== "string") throw new Error("shape");
        const id = provider === "gemini" ? name.replace(/^models\//, "") : name;
        if (!validCatalogModelId(id)) throw new Error("shape");
        entries.push({ ...row, id, ...(provider === "anthropic" ? { max_output_tokens: row.max_tokens } : {}) });
        if (Array.isArray(row.aliases)) for (const alias of row.aliases) if (typeof alias === "string" && validCatalogModelId(alias)) entries.push({ ...row, id: alias });
      }
      if (entries.length > 4000) throw new Error("size");
      if (payload.has_more === true && provider !== "anthropic") throw new Error("pagination");
      const next = provider === "gemini" ? payload.nextPageToken : provider === "anthropic" && payload.has_more === true ? payload.last_id : null;
      if (!next) { if (provider === "anthropic" && payload.has_more === true) throw new Error("pagination"); break; }
      if (typeof next !== "string" || next.length > 2000 || page === 7) throw new Error("pagination");
      url.searchParams.set(provider === "gemini" ? "pageToken" : "after_id", next);
    }
  } catch (caught) {
    state = "unavailable"; entries = [];
    const status = caught instanceof Error && /^http:\d{3}$/.test(caught.message) ? Number(caught.message.slice(5)) : null;
    error = status === 401 || status === 403 ? "The provider rejected model discovery credentials or permissions. Review the connection and refresh explicitly." : status === 429 ? "Model discovery is rate limited. Retry the refresh explicitly later; no inference was sent." : "Model discovery did not return a complete usable catalogue. Refresh explicitly; no inference or substitute model was sent.";
  }
  const models = [...new Set(entries.map(row => String(row.id)))];
  const capabilities = catalogCapabilities(new URL(target.base).hostname, entries, models);
  await sql.query("insert into mind_environment_model_catalogs(user_id,provider,credential_fingerprint,state,models,capabilities,last_error,checked_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) on conflict(user_id,provider) do update set credential_fingerprint=excluded.credential_fingerprint,state=excluded.state,models=excluded.models,capabilities=excluded.capabilities,last_error=excluded.last_error,checked_at=excluded.checked_at", [ownerId, provider, target.fingerprint, state, JSON.stringify(models), JSON.stringify(capabilities), error, new Date(now).toISOString()]);
  const catalog = (await listEnvironmentModelCatalogs(ownerId, deps)).find(row => row.provider === provider)!;
  return state === "catalogued" ? { ok: true, catalog } : { ok: false, error, catalog };
}

/** Read current credential-bound evidence immediately before dispatch, without contacting a provider. */
export async function validateEnvironmentModel(ownerId: string, provider: unknown, model: string, requirements: { images?: number; outputTokens?: number } = {}, deps: EnvironmentCatalogDeps = {}) {
  const id = environmentProvider(provider);
  if (!id) return { ok: true as const, availability: "unverified" as const, verifiedInference: false as const };
  try {
    const catalog = (await listEnvironmentModelCatalogs(ownerId, deps)).find(row => row.provider === id);
    return environmentModelReadiness(catalog, model, requirements, deps.now?.() ?? Date.now());
  } catch { return { ok: false as const, availability: "unavailable" as const, verifiedInference: false as const, error: "Current model-catalogue evidence could not be read. This dispatch was blocked; any earlier calls remain recorded." }; }
}
