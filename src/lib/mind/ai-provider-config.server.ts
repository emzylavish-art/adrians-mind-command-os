/**
 * Server-only, durable bring-your-own-API registry for OpenAI-compatible models.
 * Credentials never go to the browser, logs, or model completion events.
 * Network requests are DNS-validated and pinned, with no redirect following.
 */
import { randomUUID } from "node:crypto";
import { providerWireProtocol, modelDiscoveryHeaders, buildProviderChatRequest, parseProviderText } from "./ai-provider-native.ts";
import { getSql, type Sql } from "../db.ts";
import { connectorTokenSecretStatus, encryptSecret, decryptSecret } from "./connectors/crypto.ts";
import { isLocalHostname, isPrivateAddressLiteral, pinnedHttpFetch, resolveAndPinMcpHostname } from "./mcp/http-dns-pin.ts";
import { customProviderBlockReason, rankCatalogModels, validCatalogModelId } from "./provider-catalog.ts";

export type PublicAiProvider = {
  id: string;
  label: string;
  host: string;
  defaultModel: string;
  models: string[];
  status: string;
  lastError: string;
  hasKey: boolean;
};

type StoredProvider = {
  id: string;
  label: string;
  base_url: string;
  key_ciphertext: string;
  default_model: string;
  models: unknown;
  status: string;
  last_error: string;
};

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
  return {
    id: row.id,
    label: row.label,
    host,
    defaultModel: row.default_model,
    models: asModels(row.models),
    status: row.status,
    lastError: row.last_error,
    hasKey: Boolean(row.key_ciphertext),
  };
}

async function rows(sql: Sql, userId: string): Promise<StoredProvider[]> {
  return sql.query<StoredProvider>(
    "select id, label, base_url, key_ciphertext, default_model, models, status, last_error from mind_ai_providers where user_id = $1 order by created_at desc",
    [userId],
  );
}

export async function listAiProviders(userId: string): Promise<PublicAiProvider[]> {
  const sql = await getSql();
  return (await rows(sql, userId)).map(publicRow);
}

export async function saveAiProvider(
  userId: string,
  input: { label?: unknown; baseUrl?: unknown; apiKey?: unknown; model?: unknown },
): Promise<{ ok: true; provider: PublicAiProvider } | { ok: false; error: string }> {
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 80) : "";
  const url = baseUrl(typeof input.baseUrl === "string" ? input.baseUrl : "");
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!label) return { ok: false, error: "A provider name is required." };
  if (!url.ok) return url;
  if (!apiKey || apiKey.length > 1500 || /[\r\n\x00-\x1f]/.test(apiKey)) {
    return { ok: false, error: "Enter a valid API key of at most 1500 characters." };
  }
  if (model && !validModelId(model)) return { ok: false, error: "The model ID contains unsupported characters." };
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
  const sql = await getSql();
  await sql.query(
    "insert into mind_ai_providers (user_id,id,label,base_url,key_ciphertext,default_model,models,status,last_error) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
    [userId, record.id, record.label, record.base_url, record.key_ciphertext, record.default_model, JSON.stringify(record.models), record.status, record.last_error],
  );
  return { ok: true, provider: publicRow(record) };
}

export async function deleteAiProvider(userId: string, id: string): Promise<{ ok: boolean }> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return { ok: false };
  const sql = await getSql();
  const current = await sql.query<{ id: string }>("select id from mind_ai_providers where user_id = $1 and id = $2", [userId, id]);
  if (!current.length) return { ok: false };
  await sql.query("delete from mind_ai_providers where user_id = $1 and id = $2", [userId, id]);
  return { ok: true };
}

export async function setAiProviderModel(userId: string, id: string, model: string):
  Promise<{ ok: true; provider: PublicAiProvider } | { ok: false; error: string }> {
  const next = model.trim();
  if (!validModelId(next)) return { ok: false, error: "Invalid model ID." };
  const sql = await getSql();
  const row = (await rows(sql, userId)).find((item) => item.id === id);
  if (!row) return { ok: false, error: "Provider not found for this account." };
  const current = asModels(row.models);
  const models = current.includes(next) ? current : [next, ...current];
  const [updated] = await sql.query<StoredProvider>(
    "update mind_ai_providers set default_model = $3, models = $4::jsonb, status = case when status = 'awaiting_discovery' then 'configured' else status end, updated_at = now() where user_id = $1 and id = $2 returning id, label, base_url, key_ciphertext, default_model, models, status, last_error",
    [userId, id, next, JSON.stringify(models)],
  );
  return updated ? { ok: true, provider: publicRow(updated) } : { ok: false, error: "Provider not found for this account." };
}

async function requestProvider(
  row: StoredProvider,
  path: string,
  init: RequestInit,
): Promise<{ status: number; text: string; requestId: string | null }> {
  const checked = baseUrl(row.base_url);
  if (!checked.ok) throw new Error("The saved provider endpoint is not valid.");
  const url = new URL(checked.value + "/" + path);
  const pin = await resolveAndPinMcpHostname(url.hostname);
  if (!pin.ok) throw new Error("The provider hostname is not publicly reachable.");
  const response = await pinnedHttpFetch(url, pin.pinnedAddress, pin.hostname, {
    ...init,
    redirect: "manual",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
  });
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("The provider response exceeded the allowed size.");
  return { status: response.status, text, requestId: response.headers.get("x-request-id") };
}

function providerRestriction(status: number): string | null {
  if (status === 401 || status === 403) return "credentials_rejected";
  if (status === 402 || status === 429) return "quota_or_rate_limited";
  return null;
}

function providerError(status: number): string {
  if (status === 401 || status === 403) return "The provider rejected the API key or permissions.";
  if (status === 402) return "The provider requires billing or additional API credit.";
  if (status === 429) return "The provider returned 429 (quota or rate limit). Check your account's allowance.";
  if (status >= 300 && status < 400) return "Provider redirects are not followed.";
  return "The provider returned HTTP " + status + ".";
}

export async function discoverAiModels(userId: string, id: string):
  Promise<{ ok: true; provider: PublicAiProvider } | { ok: false; error: string }> {
  const sql = await getSql();
  const row = (await rows(sql, userId)).find((item) => item.id === id);
  if (!row) return { ok: false, error: "Provider not found for this account." };
  const key = decryptSecret(row.key_ciphertext);
  if (!key) return { ok: false, error: "The saved provider credential could not be decrypted." };
  const canonical = canonicalProviderBase(row.base_url);
  const requestRow = canonical === row.base_url ? row : { ...row, base_url: canonical };
  let status = row.status;
  let lastError = "";
  let models = asModels(row.models);
  try {
    const res = await requestProvider(requestRow, "models", {
      method: "GET",
      headers: modelDiscoveryHeaders(providerWireProtocol(requestRow.base_url), key),
    });
    if (res.status !== 200) {
      lastError = providerError(res.status);
      if ((res.status === 404 || res.status === 405) && models.length && row.status !== "credentials_rejected" && row.status !== "quota_or_rate_limited") {
        status = "configured";
        lastError = "Model listing is unsupported. The saved model can be tried manually; inference is unverified.";
      } else {
        status = providerRestriction(res.status) ?? "unavailable";
      }
    } else {
      const body = JSON.parse(res.text) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown } | string> };
      const found = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
      const parsed = rankCatalogModels(found);
      if (parsed.length) {
        models = parsed;
        status = "catalogued";
      } else {
        status = models.length ? "configured" : "awaiting_discovery";
        lastError = models.length ? "No models were listed. You can try the saved model manually." : "The API did not expose a compatible model catalogue.";
      }
    }
  } catch {
    if (status !== "credentials_rejected" && status !== "quota_or_rate_limited") status = "unavailable";
    lastError = "Model discovery could not complete. Check the connection and refresh.";
  }
  const defaultModel = row.default_model && models.includes(row.default_model) ? row.default_model : models[0] || "";
  await sql.query(
    "update mind_ai_providers set base_url = $3, default_model = $4, models = $5::jsonb, status = $6, last_error = $7, updated_at = now() where user_id = $1 and id = $2",
    [userId, id, requestRow.base_url, defaultModel, JSON.stringify(models), status, lastError],
  );
  return { ok: true, provider: publicRow({ ...requestRow, default_model: defaultModel, models, status, last_error: lastError }) };
}

export { parseCustomProviderChoice } from "./provider-catalog.ts";

export async function executeCustomChat(
  userId: string,
  selection: { id: string; model: string },
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  signal?: AbortSignal,
): Promise<
  { ok: true; text: string; model: string; provider: string; requestId: string | null; usage: { prompt_tokens?: number; completion_tokens?: number } | null } |
  { ok: false; error: string }
> {
  const sql = await getSql();
  const row = (await rows(sql, userId)).find((item) => item.id === selection.id);
  if (!row) return { ok: false, error: "Custom provider is not saved for this account." };
  const blockReason = customProviderBlockReason({ status: row.status, hasKey: Boolean(row.key_ciphertext) });
  if (blockReason) return { ok: false, error: blockReason };
  if (!asModels(row.models).includes(selection.model)) return { ok: false, error: "Model is not in the saved provider's catalogue." };
  const key = decryptSecret(row.key_ciphertext);
  if (!key) return { ok: false, error: "The saved provider credential could not be decrypted." };
  if (!messages.length || !messages.some((m) => m.role === "user")) return { ok: false, error: "No user message was supplied." };
  try {
    const kind = providerWireProtocol(row.base_url);
    const request = buildProviderChatRequest(kind, key, selection.model, messages);
    const res = await requestProvider(row, request.path, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal,
    });
    if (res.status < 200 || res.status >= 300) {
      const error = providerError(res.status);
      const restriction = providerRestriction(res.status);
      if (restriction) {
        await sql.query("update mind_ai_providers set status=$3,last_error=$4,updated_at=now() where user_id=$1 and id=$2", [userId, row.id, restriction, error]);
      }
      return { ok: false, error };
    }
    const parsed = parseProviderText(kind, res.text);
    if (!parsed.ok) return parsed;
    return {
      ok: true, text: parsed.text, model: parsed.model, provider: row.label,
      requestId: res.requestId, usage: parsed.usage,
    };
  } catch {
    return { ok: false, error: "The provider could not be reached or returned an unreadable response." };
  }
}
