/**
 * Server-only, durable bring-your-own-API registry for OpenAI-compatible models.
 * Credentials never go to the browser, logs, or model completion events.
 * Network requests are DNS-validated and pinned, with no redirect following.
 */
import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "../db.ts";
import { connectorTokenSecretStatus, encryptSecret, decryptSecret } from "./connectors/crypto.ts";
import { isLocalHostname, isPrivateAddressLiteral, pinnedHttpFetch, resolveAndPinMcpHostname } from "./mcp/http-dns-pin.ts";

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
  return value.length > 0 && value.length <= 150 && /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/.test(value);
}

function baseUrl(raw: string): { ok: true; value: string; host: string } | { ok: false; error: string } {
  try {
    const url = new URL(raw.trim());
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
    ? [...new Set(models.filter((v): v is string => typeof v === "string" && validModelId(v)))].slice(0, 120)
    : [];
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
  const models = [next, ...asModels(row.models).filter((item) => item !== next)].slice(0, 120);
  await sql.query(
    "update mind_ai_providers set default_model = $3, models = $4::jsonb, status = 'configured', last_error = '', updated_at = now() where user_id = $1 and id = $2",
    [userId, id, next, JSON.stringify(models)],
  );
  return { ok: true, provider: publicRow({ ...row, default_model: next, models, status: "configured", last_error: "" }) };
}

async function requestProvider(
  row: StoredProvider,
  path: "models" | "chat/completions",
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
    signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("The provider response exceeded the allowed size.");
  return { status: response.status, text, requestId: response.headers.get("x-request-id") };
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
  let status = "configured";
  let lastError = "";
  let models = asModels(row.models);
  try {
    const res = await requestProvider(row, "models", {
      method: "GET",
      headers: { authorization: "Bearer " + key, accept: "application/json" },
    });
    if (res.status !== 200) {
      lastError = providerError(res.status);
      status = res.status === 402 || res.status === 429 ? "quota_or_rate_limited" : "unavailable";
    } else {
      const body = JSON.parse(res.text) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown } | string> };
      const found = Array.isArray(body.data) ? body.data.map((m) => m.id) :
        Array.isArray(body.models) ? body.models.map((m) => typeof m === "string" ? m : m.id ?? m.name) : [];
      const parsed = asModels(found);
      if (parsed.length) {
        models = row.default_model && !parsed.includes(row.default_model) ? [row.default_model, ...parsed].slice(0, 120) : parsed;
        status = "catalogued";
      } else {
        lastError = "The API did not expose a compatible model catalogue. Your manually configured model remains available.";
      }
    }
  } catch {
    lastError = "Model discovery could not complete. The saved model ID remains available for manual use.";
  }
  const defaultModel = row.default_model || models[0] || "";
  await sql.query(
    "update mind_ai_providers set default_model = $3, models = $4::jsonb, status = $5, last_error = $6, updated_at = now() where user_id = $1 and id = $2",
    [userId, id, defaultModel, JSON.stringify(models), status, lastError],
  );
  return { ok: true, provider: publicRow({ ...row, default_model: defaultModel, models, status, last_error: lastError }) };
}

export function parseCustomProviderChoice(value: unknown):
  { ok: true; id: string; model: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.startsWith("custom:")) return { ok: false, error: "Not a custom provider selection." };
  const match = /^custom:([0-9a-f-]{36}):(.{1,300})$/i.exec(value);
  if (!match) return { ok: false, error: "Malformed custom provider selection." };
  let model: string;
  try { model = decodeURIComponent(match[2]); } catch { return { ok: false, error: "Invalid encoded model ID." }; }
  if (!validModelId(model)) return { ok: false, error: "Invalid custom model ID." };
  return { ok: true, id: match[1], model };
}

export async function executeCustomChat(
  userId: string,
  selection: { id: string; model: string },
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<
  { ok: true; text: string; model: string; provider: string; requestId: string | null; usage: { prompt_tokens?: number; completion_tokens?: number } | null } |
  { ok: false; error: string }
> {
  const sql = await getSql();
  const row = (await rows(sql, userId)).find((item) => item.id === selection.id);
  if (!row) return { ok: false, error: "Custom provider is not saved for this account." };
  if (!asModels(row.models).includes(selection.model)) return { ok: false, error: "Model is not in the saved provider's catalogue." };
  const key = decryptSecret(row.key_ciphertext);
  if (!key) return { ok: false, error: "The saved provider credential could not be decrypted." };
  if (!messages.length || !messages.some((m) => m.role === "user")) return { ok: false, error: "No user message was supplied." };
  try {
    const res = await requestProvider(row, "chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key, accept: "application/json" },
      body: JSON.stringify({ model: selection.model, messages: messages.slice(-15), stream: false }),
    });
    if (res.status < 200 || res.status >= 300) return { ok: false, error: providerError(res.status) };
    const body = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = body.choices?.[0]?.message;
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) return {
      ok: false, error: "This model requested tools. Tool execution is not enabled for this provider. Nothing was executed.",
    };
    const content = message?.content;
    const text = typeof content === "string" ? content.trim() :
      Array.isArray(content) ? content.filter((part): part is { type: string; text: string } =>
        Boolean(part && typeof part === "object" && part.type === "text" && typeof part.text === "string"))
        .map((part) => part.text).join("").trim() : "";
    if (!text) return { ok: false, error: "The provider returned no assistant text." };
    return {
      ok: true, text, model: selection.model, provider: row.label,
      requestId: res.requestId, usage: body.usage ?? null,
    };
  } catch {
    return { ok: false, error: "The provider could not be reached or returned an unreadable response." };
  }
}
