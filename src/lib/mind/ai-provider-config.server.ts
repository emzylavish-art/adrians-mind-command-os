/**
 * Server-only, durable bring-your-own-API registry for OpenAI-compatible models.
 * Credentials never go to the browser, logs, or model completion events.
 * Network requests are DNS-validated and pinned, with no redirect following.
 */
import { randomUUID } from "node:crypto";
import { discoveryFailureState } from "./provider-health.ts";
import { implementedProviderCapabilities, preserveProviderModel, providerRestriction, providerRetryAt, type ProviderCapabilities } from "./provider-lifecycle.ts";
import { providerWireProtocol, modelDiscoveryHeaders, buildProviderChatRequest, parseProviderText, type AiWireProtocol, type ParsedAnswer, type ProviderChatOptions, type TextTurn } from "./ai-provider-native.ts";
import { consumeProviderStream } from "./ai-provider-stream.ts";
import { mergeProviderReceipt } from "./provider-call-stream.ts";
import { readProviderReceipt, type ProviderReceipt } from "./provider-usage.ts";
import { providerDependencies, type ProviderDependency } from "./provider-dependencies.ts";
import { catalogCapabilities, imageCapabilityBlockReason, readModelCapabilityRegistry, type ModelCapabilityRegistry, type ModelCapabilities } from "./model-capabilities.ts";
import type { Sql } from "../db.ts";
import { connectorTokenSecretStatus, encryptSecret, decryptSecret } from "./connectors/crypto.ts";
import { isLocalHostname, isPrivateAddressLiteral, pinnedHttpFetch, resolveAndPinMcpHostname } from "./mcp/http-dns-pin.ts";
import { customProviderBlockReason, isOpenRouterFreeModel, OPENROUTER_FREE_MODEL_REQUIRED, rankCatalogModels, normalizeCatalogModels, modelCompatibility, type CatalogModelProfile, type ModelExecution, validCatalogModelId } from "./provider-catalog.ts";
import { normalizeProviderReceipt } from "./provider-receipt.ts";
import { reportedModel } from "./stream.ts";

export type PublicAiProvider = {
  id: string;
  label: string;
  host: string;
  defaultModel: string;
  models: string[];
  modelProfiles?: CatalogModelProfile[];
  status: string;
  lastError: string;
  hasKey: boolean;
  selectedModelAvailable?: boolean;
  catalogCheckedAt?: string | null;
  inferenceVerifiedAt?: string | null;
  inferenceModel?: string;
  inferenceFailedAt?: string | null;
  retryAt?: string | null;
  rateLimitedModel?: string;
  capabilities?: ProviderCapabilities;
  modelCapabilities?: ModelCapabilityRegistry;
};

type StoredProvider = {
  id: string;
  label: string;
  base_url: string;
  key_ciphertext: string;
  default_model: string;
  models: unknown;
  model_profiles?: unknown;
  status: string;
  last_error: string;
  catalog_checked_at?: string | Date | null;
  inference_verified_at?: string | Date | null;
  inference_model?: string;
  inference_failed_at?: string | Date | null;
  retry_after?: string | Date | null;
  rate_limit_model?: string;
  model_capabilities?: unknown;
};

export type AiProviderDependencies = {
  sql?: Sql;
  request?: typeof requestProvider;
  decrypt?: (ciphertext: string) => string | null;
  options?: ProviderChatOptions;
  onDelta?: (text: string) => void;
};
async function providerSql(deps: AiProviderDependencies): Promise<Sql> {
  return deps.sql || (await import("../db.ts")).getSql();
}
const PROVIDER_COLUMNS = "id, label, base_url, key_ciphertext, default_model, models, status, last_error, catalog_checked_at, inference_verified_at, inference_model, inference_failed_at, retry_after, rate_limit_model, model_capabilities";
function timestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function validModelId(value: string): boolean {
  return validCatalogModelId(value);
}

function baseUrl(raw: string): { ok: true; value: string; host: string } | { ok: false; error: string } {
  try {
    const url = new URL(canonicalProviderBase(raw.trim()));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
        !hostname || isLocalHostname(hostname) || isPrivateAddressLiteral(hostname) ||
        hostname === "metadata.google.internal" || hostname.endsWith(".internal") ||
        hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      return { ok: false, error: "Use an HTTPS API base URL on a public host, without embedded credentials or query parameters." };
    }
    const clean = url.toString().replace(/\/+$/, "");
    if (clean.length > 350) return { ok: false, error: "API URL is too long." };
    return { ok: true, value: clean, host: url.host };
  } catch {
    return { ok: false, error: "Enter a valid HTTPS API base URL." };
  }
}

function asModels(value: unknown): string[] {
  let models = value;
  if (typeof models === "string") {
    try { models = JSON.parse(models); } catch { models = []; }
  }
  return Array.isArray(models)
    ? [...new Set(models.filter((v): v is string => typeof v === "string" && validModelId(v)))]
    : [];
}

function asProfiles(value: unknown): CatalogModelProfile[] {
  let raw = value;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return []; } }
  return normalizeCatalogModels(Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : []);
}
function profileRecord(profiles: CatalogModelProfile[]): Record<string, CatalogModelProfile> {
  return Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
}
/** Atomic per-model receipt update: concurrent different-model calls do not overwrite one another. */
export async function recordModelExecution(sql: Sql, ownerId: string, providerId: string, model: string, receipt: ModelExecution): Promise<void> {
  await sql.query("update mind_ai_providers set model_profiles = jsonb_set(model_profiles, ARRAY[$3::text], coalesce(model_profiles -> $3, '{}'::jsonb) || jsonb_build_object('id', $3::text, 'lastExecution', $4::jsonb), true) where user_id=$1 and id=$2", [ownerId, providerId, model, JSON.stringify(receipt)]);
}

/** A catalog response may race inference. Retain each latest stored execution receipt atomically. */
export async function recordModelCatalogue(sql: Sql, ownerId: string, providerId: string, input: {
  baseUrl: string; defaultModel: string; models: string[]; status: string; lastError: string; profiles: CatalogModelProfile[];
}): Promise<void> {
  await sql.query(
    `update mind_ai_providers set base_url=$3, default_model=$4, models=$5::jsonb, status=$6, last_error=$7,
     model_profiles=coalesce((select jsonb_object_agg(incoming.key, incoming.value ||
       case when model_profiles -> incoming.key ? 'lastExecution'
       then jsonb_build_object('lastExecution', model_profiles -> incoming.key -> 'lastExecution') else '{}'::jsonb end)
       from jsonb_each($8::jsonb) incoming), '{}'::jsonb), updated_at=now() where user_id=$1 and id=$2`,
    [ownerId, providerId, input.baseUrl, input.defaultModel, JSON.stringify(input.models), input.status, input.lastError, JSON.stringify(profileRecord(input.profiles))],
  );
}

const OFFICIAL_API_BASES: Record<string, string> = {
  "aistudio.google.com": "https://generativelanguage.googleapis.com/v1beta",
  "ai.google.dev": "https://generativelanguage.googleapis.com/v1beta",
  "makersuite.google.com": "https://generativelanguage.googleapis.com/v1beta",
  "platform.openai.com": "https://api.openai.com/v1",
  "console.anthropic.com": "https://api.anthropic.com/v1",
  "console.x.ai": "https://api.x.ai/v1",
  "openrouter.ai": "https://openrouter.ai/api/v1",
};

export function canonicalProviderBase(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const official = OFFICIAL_API_BASES[url.hostname.toLowerCase()];
    return official ?? raw.trim();
  } catch {
    return raw.trim();
  }
}

function publicRow(row: StoredProvider): PublicAiProvider {
  let host = "";
  try { host = new URL(row.base_url).host; } catch { /* never expose a malformed URL */ }
  const models = host === "openrouter.ai" ? asModels(row.models).filter(isOpenRouterFreeModel) : asModels(row.models);
  return {
    id: row.id,
    label: row.label,
    host,
    defaultModel: preserveProviderModel(row.default_model, models).model,
    selectedModelAvailable: preserveProviderModel(row.default_model, models).available,
    models,
    modelProfiles: asProfiles(row.model_profiles).filter((profile) => models.includes(profile.id)),
    status: row.status,
    lastError: row.last_error,
    hasKey: Boolean(row.key_ciphertext),
    catalogCheckedAt: timestamp(row.catalog_checked_at), inferenceVerifiedAt: timestamp(row.inference_verified_at),
    inferenceModel: row.inference_model || "", inferenceFailedAt: timestamp(row.inference_failed_at),
    retryAt: timestamp(row.retry_after), rateLimitedModel: row.rate_limit_model || "", capabilities: implementedProviderCapabilities(host),
    modelCapabilities: readModelCapabilityRegistry(row.model_capabilities),
  };
}

async function rows(sql: Sql, userId: string): Promise<StoredProvider[]> {
  return sql.query<StoredProvider>(
    `select ${PROVIDER_COLUMNS} from mind_ai_providers where user_id = $1 order by created_at desc`,
    [userId],
  );
}

export async function listAiProviders(userId: string, deps: AiProviderDependencies = {}): Promise<PublicAiProvider[]> {
  const sql = await providerSql(deps);
  return (await rows(sql, userId)).map(publicRow);
}

export async function saveAiProvider(
  userId: string,
  input: { label?: unknown; baseUrl?: unknown; apiKey?: unknown; model?: unknown },
  deps: AiProviderDependencies = {},
): Promise<{ ok: true; provider: PublicAiProvider } | { ok: false; error: string }> {
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 80) : "";
  const url = baseUrl(typeof input.baseUrl === "string" ? input.baseUrl : "");
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!label) return { ok: false, error: "A provider name is required." };
  if (!url.ok) return url;
  if (!apiKey || apiKey.length > 1500 || /\p{Cc}/u.test(apiKey)) {
    return { ok: false, error: "Enter a valid API key of at most 1500 characters." };
  }
  if (model && !validModelId(model)) return { ok: false, error: "The model ID contains unsupported characters." };
  if (model && url.host === "openrouter.ai" && !isOpenRouterFreeModel(model)) return { ok: false, error: OPENROUTER_FREE_MODEL_REQUIRED };
  const secret = connectorTokenSecretStatus();
  if (!secret.ok) return { ok: false, error: "Credential encryption is not configured. Nothing was saved." };
  const record = {
    id: randomUUID(),
    label,
    base_url: url.value,
    key_ciphertext: encryptSecret(apiKey).ciphertext,
    default_model: model,
    models: model ? [model] : [],
    status: model ? "configured" : "awaiting_discovery",
    last_error: "",
  };
  const sql = await providerSql(deps);
  await sql.query(
    "insert into mind_ai_providers (user_id,id,label,base_url,key_ciphertext,default_model,models,status,last_error) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
    [userId, record.id, record.label, record.base_url, record.key_ciphertext, record.default_model, JSON.stringify(record.models), record.status, record.last_error],
  );
  return { ok: true, provider: publicRow(record) };
}

export async function deleteAiProvider(userId: string, id: string, deps: AiProviderDependencies = {}): Promise<{ ok: boolean }> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return { ok: false };
  const sql = await providerSql(deps);
  const current = await sql.query<{ id: string }>("select id from mind_ai_providers where user_id = $1 and id = $2", [userId, id]);
  if (!current.length) return { ok: false };
  await sql.query("delete from mind_ai_providers where user_id = $1 and id = $2", [userId, id]);
  return { ok: true };
}

export async function listAiProviderDependencies(userId: string, id: string, deps: AiProviderDependencies = {}): Promise<{ ok: true; dependencies: ProviderDependency[] } | { ok: false; error: string }> {
  const sql = await providerSql(deps);
  if (!(await rows(sql, userId)).some(row => row.id === id)) return { ok: false, error: "Provider not found for this account." };
  const [row] = await sql.query<{ payload: unknown }>("select payload from mind_snapshot where user_id = $1", [userId]);
  return { ok: true, dependencies: providerDependencies(id, row?.payload) };
}

/** Credential replacement retains the connection identity used by saved chats and model choices. */
export async function rotateAiProviderKey(userId: string, id: string, apiKey: unknown, deps: AiProviderDependencies = {}): Promise<{ ok: true; provider: PublicAiProvider } | { ok: false; error: string }> {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key || key.length > 1500 || /\p{Cc}/u.test(key)) return { ok: false, error: "Enter a valid replacement API key." };
  if (!connectorTokenSecretStatus().ok) return { ok: false, error: "Credential encryption is unavailable. The previous key was preserved." };
  const sql = await providerSql(deps);
  const row = (await rows(sql, userId)).find(item => item.id === id);
  if (!row) return { ok: false, error: "Provider not found for this account." };
  const [updated] = await sql.query<StoredProvider>(`update mind_ai_providers set key_ciphertext=$3,status=$4,last_error='',catalog_checked_at=null,inference_verified_at=null,inference_model='',inference_failed_at=null,retry_after=null,rate_limit_model='',updated_at=now() where user_id=$1 and id=$2 returning ${PROVIDER_COLUMNS}`, [userId, id, encryptSecret(key).ciphertext, row.default_model ? "configured" : "awaiting_discovery"]);
  return updated ? { ok: true, provider: publicRow(updated) } : { ok: false, error: "The connection changed before its credential was replaced." };
}

/** Server-only lookup for the audio adapters already implemented here. Never return this to a client. */
export async function aiProviderSpeechCredential(userId: string, id: string, deps: AiProviderDependencies = {}): Promise<{ ok: true; provider: "xai" | "openai"; key: string } | { ok: false; error: string }> {
  const sql = await providerSql(deps);
  const row = (await rows(sql, userId)).find(item => item.id === id);
  if (!row) return { ok: false, error: "The selected speech connection is not saved for this account." };
  const url = new URL(row.base_url);
  const host = url.hostname;
  if (url.port || url.pathname.replace(/\/+$/, "") !== "/v1") return { ok: false, error: "Speech requires the official provider v1 endpoint; this custom endpoint has no audio adapter." };
  if (host !== "api.x.ai" && host !== "api.openai.com") return { ok: false, error: "This connected provider has no speech adapter in Mind OS. Keep it as the answer model and select a separate compatible speech engine." };
  const reason = customProviderBlockReason({ ...publicRow(row), model: "speech" });
  if (reason) return { ok: false, error: reason };
  const key = (deps.decrypt || decryptSecret)(row.key_ciphertext);
  if (!key) return { ok: false, error: "The selected speech credential could not be read. Nothing was substituted." };
  return { ok: true, provider: host === "api.x.ai" ? "xai" : "openai", key };
}

export async function setAiProviderModel(userId: string, id: string, model: string, deps: AiProviderDependencies = {}):
  Promise<{ ok: true; provider: PublicAiProvider } | { ok: false; error: string }> {
  const next = model.trim();
  if (!validModelId(next)) return { ok: false, error: "Invalid model ID." };
  const sql = await providerSql(deps);
  const row = (await rows(sql, userId)).find((item) => item.id === id);
  if (!row) return { ok: false, error: "Provider not found for this account." };
  if (publicRow(row).host === "openrouter.ai" && !isOpenRouterFreeModel(next)) return { ok: false, error: OPENROUTER_FREE_MODEL_REQUIRED };
  const current = asModels(row.models);
  const models = current.includes(next) ? current : [next, ...current];
  const [updated] = await sql.query<StoredProvider>(
    `update mind_ai_providers set default_model = $3, models = $4::jsonb, status = case when status = 'awaiting_discovery' then 'configured' else status end, updated_at = now() where user_id = $1 and id = $2 returning ${PROVIDER_COLUMNS}`,
    [userId, id, next, JSON.stringify(models)],
  );
  return updated ? { ok: true, provider: publicRow(updated) } : { ok: false, error: "Provider not found for this account." };
}

async function requestProvider(
  row: StoredProvider,
  path: string,
  init: RequestInit,
  stream?: { kind: AiWireProtocol; onDelta: (text: string) => void },
): Promise<{ status: number; text: string; requestId: string | null; retryAfter?: string | null; answer?: ParsedAnswer; receipt?: ProviderReceipt; observedModel?: string }> {
  const checked = baseUrl(row.base_url);
  if (!checked.ok) throw new Error("The saved provider endpoint is not valid.");
  const url = new URL(checked.value + "/" + path);
  const pin = await resolveAndPinMcpHostname(url.hostname);
  if (!pin.ok) throw new Error("The provider hostname is not publicly reachable.");
  const response = await pinnedHttpFetch(url, pin.pinnedAddress, pin.hostname, {
    ...init,
    streamResponse: Boolean(stream),
    redirect: "manual",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
  });
  if (stream && response.ok && response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
    const protocol = url.hostname === "openrouter.ai" ? "openrouter" : stream.kind;
    let receipt = readProviderReceipt(protocol, null, response.headers);
    let observedModel: string | undefined;
    const answer = await consumeProviderStream(stream.kind, response.body, stream.onDelta, event => {
      const value = stream.kind === "anthropic" && event.type === "message_start" && event.message && typeof event.message === "object" ? event.message as Record<string, unknown> : event;
      receipt = mergeProviderReceipt(receipt, readProviderReceipt(protocol, value, response.headers));
      const model = value.model ?? value.modelVersion;
      if (typeof model === "string" && model.trim()) observedModel = model.trim();
    });
    return { status: response.status, text: "", requestId: receipt.requestId, answer, receipt, observedModel };
  }
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("The provider response exceeded the allowed size.");
  return { status: response.status, text, requestId: response.headers.get("x-request-id"), retryAfter: response.headers.get("retry-after") };
}

function providerError(status: number): string {
  if (status === 401 || status === 403) return "The provider rejected the API key or permissions.";
  if (status === 402) return "The provider requires billing or additional API credit.";
  if (status === 429) return "The provider returned 429 (quota or rate limit). Check your account's allowance.";
  if (status >= 300 && status < 400) return "Provider redirects are not followed.";
  return "The provider returned HTTP " + status + ".";
}

export async function discoverAiModels(userId: string, id: string, deps: AiProviderDependencies = {}):
  Promise<{ ok: true; provider: PublicAiProvider; stage: "catalogue"; usable: boolean } | { ok: false; error: string; provider?: PublicAiProvider; stage: "catalogue" }> {
  const sql = await providerSql(deps);
  const row = (await rows(sql, userId)).find((item) => item.id === id);
  if (!row) return { ok: false, stage: "catalogue", error: "Provider not found for this account." };
  const key = (deps.decrypt || decryptSecret)(row.key_ciphertext);
  if (!key) return { ok: false, stage: "catalogue", error: "The saved provider credential could not be decrypted.", provider: publicRow(row) };
  const canonical = canonicalProviderBase(row.base_url);
  const requestRow = canonical === row.base_url ? row : { ...row, base_url: canonical };
  let status = row.status;
  let lastError = "";
  let models = asModels(row.models);
  let retryAt: string | null = null;
  let capabilities = readModelCapabilityRegistry(row.model_capabilities);
  try {
    const res = await (deps.request || requestProvider)(requestRow, "models", {
      method: "GET",
      headers: modelDiscoveryHeaders(providerWireProtocol(requestRow.base_url), key),
    });
    if (res.status !== 200) {
      lastError = providerError(res.status);
      if ((res.status === 404 || res.status === 405) && models.length && row.status !== "credentials_rejected" && !["quota_or_rate_limited", "billing_required", "rate_limited"].includes(row.status)) {
        status = "configured";
        lastError = "Model listing is unsupported. The saved model can be tried manually; inference is unverified.";
      } else {
        status = providerRestriction(res.status) ?? "unavailable";
        if (res.status === 429) retryAt = providerRetryAt(res.retryAfter);
      }
    } else {
      const body = JSON.parse(res.text) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown } | string> };
      const found = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
      const ranked = rankCatalogModels(found);
      const parsed = publicRow(requestRow).host === "openrouter.ai" ? ranked.filter(isOpenRouterFreeModel) : ranked;
      if (parsed.length) {
        models = parsed;
        capabilities = catalogCapabilities(publicRow(requestRow).host, found, parsed);
        status = "catalogued";
      } else {
        status = models.length ? "configured" : "awaiting_discovery";
        lastError = models.length ? "No models were listed. You can try the saved model manually." : "The API did not expose a compatible model catalogue.";
      }
    }
  } catch {
    if (status !== "credentials_rejected" && !["quota_or_rate_limited", "billing_required", "rate_limited"].includes(status)) status = "unavailable";
    lastError = "Model discovery could not complete. Check the connection and refresh.";
  }
  const defaultModel = preserveProviderModel(row.default_model, models).model;
  if (defaultModel && !models.includes(defaultModel) && status === "catalogued") lastError = "The selected default model is no longer listed. It was preserved; choose a replacement explicitly before using that selection.";
  await sql.query(
    "update mind_ai_providers set base_url = $3, default_model = $4, models = $5::jsonb, status = $6, last_error = $7, catalog_checked_at = now(), retry_after = $8, rate_limit_model = '', model_capabilities = $10::jsonb, updated_at = now() where user_id = $1 and id = $2 and key_ciphertext = $9",
    [userId, id, requestRow.base_url, defaultModel, JSON.stringify(models), status, lastError, retryAt, row.key_ciphertext, JSON.stringify(capabilities)],
  );
  const provider = publicRow({ ...requestRow, default_model: defaultModel, models, status, last_error: lastError, catalog_checked_at: new Date().toISOString(), retry_after: retryAt, rate_limit_model: "", model_capabilities: capabilities });
  const usable = !customProviderBlockReason(provider);
  return usable ? { ok: true, provider, stage: "catalogue", usable } : { ok: false, error: lastError || "Provider discovery did not establish readiness.", provider, stage: "catalogue" };
}

export { parseCustomProviderChoice } from "./provider-catalog.ts";

/** Side-effect-free configuration preflight for a plan, before any helper/model request. */
export async function validateCustomProviderSelection(userId: string, selection: { id: string; model: string }, deps: AiProviderDependencies = {}): Promise<{ ok: true; capabilities?: ModelCapabilities } | { ok: false; error: string }> {
  const row = (await rows(await providerSql(deps), userId)).find(item => item.id === selection.id);
  if (!row) return { ok: false, error: "The selected provider is no longer saved for this account. Choose a connection explicitly." };
  const blocked = customProviderBlockReason({ ...publicRow(row), model: selection.model });
  if (blocked) return { ok: false, error: blocked };
  if (!asModels(row.models).includes(selection.model)) return { ok: false, error: "The selected model is not in this connection's catalogue. Refresh and choose a model explicitly." };
  if (publicRow(row).host === "openrouter.ai" && !isOpenRouterFreeModel(selection.model)) return { ok: false, error: OPENROUTER_FREE_MODEL_REQUIRED };
  const capabilities = readModelCapabilityRegistry(row.model_capabilities)[selection.model];
  const effectiveOutputTokens = deps.options?.controls?.answerTokens ?? (providerWireProtocol(row.base_url) === "anthropic" ? 2048 : undefined);
  if (effectiveOutputTokens !== undefined && capabilities?.maxOutputTokens !== undefined && effectiveOutputTokens > capabilities.maxOutputTokens) return { ok: false, error: `The selected model declares a maximum output of ${capabilities.maxOutputTokens} tokens. Reduce the answer budget explicitly; nothing was sent.` };
  if (deps.options?.images?.length) { const imageReason = imageCapabilityBlockReason(publicRow(row).host, selection.model, row.model_capabilities); if (imageReason) return { ok: false, error: imageReason }; }
  if (!(deps.decrypt || decryptSecret)(row.key_ciphertext)) return { ok: false, error: "The selected provider credential could not be read. No helpers were called." };
  return { ok: true, capabilities };
}

export async function executeCustomChat(
  userId: string,
  selection: { id: string; model: string },
  messages: TextTurn[],
  signal?: AbortSignal,
  deps: AiProviderDependencies = {},
): Promise<
  ({ ok: true; text: string; model: string; provider: string; delivery: "streamed" | "buffered"; requestId: string | null; usage: { prompt_tokens?: number; completion_tokens?: number } | null } |
  { ok: false; error: string; httpStatus?: number; model?: string; provider?: string }) & Partial<ProviderReceipt>
> {
  const sql = await providerSql(deps);
  const row = (await rows(sql, userId)).find((item) => item.id === selection.id);
  if (!row) return { ok: false, error: "Custom provider is not saved for this account." };
  const blockReason = customProviderBlockReason({ ...publicRow(row), model: selection.model });
  if (blockReason) return { ok: false, error: blockReason };
  if (!asModels(row.models).includes(selection.model)) return { ok: false, error: "Model is not in the saved provider's catalogue." };
  const maxOutputTokens = readModelCapabilityRegistry(row.model_capabilities)[selection.model]?.maxOutputTokens;
  const effectiveOutputTokens = deps.options?.controls?.answerTokens ?? (providerWireProtocol(row.base_url) === "anthropic" ? 2048 : undefined);
  if (effectiveOutputTokens !== undefined && maxOutputTokens !== undefined && effectiveOutputTokens > maxOutputTokens) return { ok: false, error: `The selected model declares a maximum output of ${maxOutputTokens} tokens. Reduce the answer budget explicitly; nothing was sent.`, httpStatus: 400 };
  const key = (deps.decrypt || decryptSecret)(row.key_ciphertext);
  if (!key) return { ok: false, error: "The saved provider credential could not be decrypted." };
  if (!messages.length || !messages.some((m) => m.role === "user")) return { ok: false, error: "No user message was supplied." };
  try {
    const kind = providerWireProtocol(row.base_url);
    const freeOpenRouter = publicRow(row).host === "openrouter.ai";
    if (freeOpenRouter && !isOpenRouterFreeModel(selection.model)) return { ok: false, error: OPENROUTER_FREE_MODEL_REQUIRED };
    if (deps.options?.images?.length || messages.some(message => message.images?.length)) { const imageReason = imageCapabilityBlockReason(publicRow(row).host, selection.model, row.model_capabilities); if (imageReason) return { ok: false, error: imageReason }; }
    const request = buildProviderChatRequest(kind, key, selection.model, messages, freeOpenRouter, { ...deps.options, stream: Boolean(deps.onDelta) });
    const res = await (deps.request || requestProvider)(row, request.path, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal,
    }, deps.onDelta ? { kind, onDelta: deps.onDelta } : undefined);
    let payload: Record<string, unknown> | null = null;
    try { const value: unknown = JSON.parse(res.text); if (value && typeof value === "object" && !Array.isArray(value)) payload = value as Record<string, unknown>; } catch { /* Stream receipts and HTTP headers can still carry observed usage. */ }
    const receipt = res.receipt ?? readProviderReceipt(freeOpenRouter ? "openrouter" : kind, payload);
    const observedModel = res.observedModel ?? payload?.model ?? payload?.modelVersion;
    const evidence = { ...receipt, requestId: res.requestId ?? receipt.requestId, provider: row.label,
      ...(typeof observedModel === "string" && observedModel.trim() ? { model: observedModel.trim() } : {}) };
    if (res.status < 200 || res.status >= 300) {
      const error = providerError(res.status);
      const restriction = providerRestriction(res.status) || (res.status >= 500 ? "unavailable" : row.status);
      try { await sql.query("update mind_ai_providers set status=$3,last_error=$4,inference_failed_at=now(),retry_after=$5,rate_limit_model=$6,updated_at=now() where user_id=$1 and id=$2 and key_ciphertext=$7", [userId, row.id, restriction, error, res.status === 429 ? providerRetryAt(res.retryAfter) : null, res.status === 429 ? selection.model : "", row.key_ciphertext]); } catch { /* A bookkeeping outage cannot erase an actual provider failure receipt. */ }
      return { ...evidence, ok: false, error, httpStatus: res.status >= 400 && res.status < 500 ? res.status : undefined };
    }
    const parsed = res.answer || parseProviderText(kind, res.text);
    if (parsed.ok && !res.answer && deps.onDelta) deps.onDelta(parsed.text);
    if (!parsed.ok) return { ...evidence, ...parsed };
    // A completed paid answer is retained even if readiness bookkeeping is temporarily unavailable.
    try { await sql.query("update mind_ai_providers set status='catalogued',last_error='',inference_verified_at=now(),inference_model=$3,retry_after=null,rate_limit_model='',updated_at=now() where user_id=$1 and id=$2 and key_ciphertext=$4", [userId, row.id, parsed.model, row.key_ciphertext]); } catch { /* The response itself remains the inference evidence. */ }
    return {
      ...evidence, ok: true, text: parsed.text, model: parsed.model, provider: row.label,
      delivery: res.answer ? "streamed" : "buffered", requestId: res.requestId ?? receipt.requestId, usage: receipt.usage ?? parsed.usage,
    };
  } catch {
    return { ok: false, error: "The provider could not be reached or returned an unreadable response." };
  }
}
