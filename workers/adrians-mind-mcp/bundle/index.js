/**
 * Nonproduction edge MCP for adrians-mind-mcp-test.
 * OAuth matches team/oauth.py + team/mcp_http.py. No static bearer labelled as OAuth.
 * Calls only https://api.openai.com/v1/chat/completions. No tunnels, localhost, or PC tools.
 */

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const SCOPE = "mind.tools";
const MAX_BODY = 100_000;
const MAX_READ = 48_000;
const TEXT_CAP = 8_000;

const ROUTES = [
  { id: "astra", modelEnv: "ASTRA_MODEL", defaultModel: "gpt-6-astra", keyEnv: "ASTRA_API_KEY", baseEnv: "ASTRA_API_BASE_URL" },
  { id: "sol", modelEnv: "SOL_MODEL", defaultModel: "gpt-6-sol", keyEnv: "SOL_API_KEY", baseEnv: "SOL_API_BASE_URL" },
  { id: "luna", modelEnv: "LUNA_MODEL", defaultModel: "gpt-6-luna", keyEnv: "LUNA_API_KEY", baseEnv: "LUNA_API_BASE_URL" },
];

export function toolSpecs() {
  return [
    {
      name: "provider.status",
      description: "Reports Astra/Sol/Luna configuration and app-budget accounting. Does not call a provider.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "model.generate",
      description: "Routes Astra, then Sol, then Luna through POST https://api.openai.com/v1/chat/completions. Requires an OAuth access token with mind.tools. Owner override MIND_COMMAND_BUDGET_OWNER_OVERRIDE=1 does not pause the app cap. Provider allowance stays unknown.",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["auto", "astra", "sol", "luna"] },
          prompt: { type: "string", maxLength: TEXT_CAP },
          messages: {
            type: "array",
            maxItems: 16,
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["system", "user", "assistant"] },
                content: { type: "string", maxLength: TEXT_CAP },
              },
              required: ["role", "content"],
              additionalProperties: false,
            },
          },
          model: { type: "string", minLength: 1, maxLength: 120 },
          stream: { type: "boolean" },
          timeout_seconds: { type: "integer", minimum: 1, maximum: 20 },
        },
        additionalProperties: false,
      },
    },
  ];
}

function json(status, payload, headers) {
  return new Response(payload == null ? null : JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(headers || {}) },
  });
}

function bytesToB64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function pkceChallenge(verifier) {
  return bytesToB64Url(await sha256(verifier));
}

async function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64Url(bytes);
}

function nowSec(deps) {
  return Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
}

function safeRedirect(uri) {
  try {
    const parsed = new URL(uri);
    return Boolean(parsed.protocol === "https:" && parsed.hostname && !parsed.hash);
  } catch {
    return false;
  }
}

const TEST_CLIENT_ID = "adrians-mind-mcp-test";
const PROD_CLIENT_ID = "adrians-mind-mcp";
const PUBLIC_MCP_ORIGINS = new Set([
  "https://adrians-mind-mcp-test.operation-beat-magnus.workers.dev",
  "https://adrians-mind-mcp.operation-beat-magnus.workers.dev",
]);
const GENERATION_LEDGERS = {
  once: "audit:model.generate:once",
  "retest-1": "audit:model.generate:retest-1",
};

function generationChoice(value) {
  if (value === true || value === "once") return "once";
  if (value === "retest-1") return "retest-1";
  return null;
}

function callbackPath(env) {
  return env.MCP_OAUTH_CALLBACK_PATH === "/oauth/callback" ? "/oauth/callback" : "/oauth/test-callback";
}

function workerName(env) {
  return env.MCP_WORKER_NAME === "adrians-mind-mcp" ? "adrians-mind-mcp" : "adrians-mind-mcp-test";
}

export function oauthReadiness(env) {
  const missing = [];
  if (!env.OAUTH_KV) missing.push("OAUTH_KV");
  const issuer = String(env.MCP_OAUTH_ISSUER || "").replace(/\/$/, "");
  if (!issuer.startsWith("https://")) missing.push("MCP_OAUTH_ISSUER");
  if (!String(env.MCP_OAUTH_SECRET || "")) missing.push("MCP_OAUTH_SECRET");
  const path = callbackPath(env);
  const callback = issuer.startsWith("https://") ? `${issuer}${path}` : "";
  const extra = String(env.MCP_OAUTH_REDIRECT_URIS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (extra.some((uri) => !safeRedirect(uri))) missing.push("MCP_OAUTH_REDIRECT_URIS");
  const redirects = callback && safeRedirect(callback) ? [callback, ...extra.filter((uri) => uri !== callback)] : [];
  const requestedClient = String(env.MCP_OAUTH_CLIENT_ID || "");
  const clientId = requestedClient === PROD_CLIENT_ID ? PROD_CLIENT_ID : TEST_CLIENT_ID;
  const audience = String(env.MCP_OAUTH_AUDIENCE || (issuer ? `${issuer}/mcp` : ""));
  return { ok: missing.length === 0, missing, issuer, audience, redirects, clientId, testCallback: callback };
}

function metadata(ready) {
  return {
    issuer: ready.issuer,
    authorization_endpoint: `${ready.issuer}/oauth/authorize`,
    token_endpoint: `${ready.issuer}/oauth/token`,
    revocation_endpoint: `${ready.issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [SCOPE],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

function resourceMetadata(ready) {
  return {
    resource: ready.audience,
    authorization_servers: [ready.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
}

function scopesOk(raw) {
  const scopes = String(raw || "").split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((scope) => scope === SCOPE);
}

const ACCESS_TEAM = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

function accessSettings(env) {
  const trust = env.MCP_TRUST_ACCESS_IDENTITY === "1";
  const team = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim().toLowerCase();
  const aud = String(env.CF_ACCESS_AUD || "").trim();
  const allowed = String(env.CF_ACCESS_ALLOWED_EMAIL || "").trim().toLowerCase();
  const audOk = /^[A-Za-z0-9_-]{16,128}$/.test(aud);
  const emailOk = /^[^\s@]+@[^\s@]+$/.test(allowed);
  return { trust, team, aud, allowed, ready: trust && ACCESS_TEAM.test(team) && audOk && emailOk };
}

function decodePart(part) {
  try {
    const pad = "=".repeat((4 - (part.length % 4)) % 4);
    const bin = atob(part.replaceAll("-", "+").replaceAll("_", "/") + pad);
    const bytes = Uint8Array.from(bin, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function verifyAccessJwt(jwt, settings, deps) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) return "";
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !payload) return "";
  const certUrl = `https://${settings.team}/cdn-cgi/access/certs`;
  let response;
  try {
    response = await (deps.fetchImpl || fetch)(certUrl, { signal: AbortSignal.timeout(5000) });
  } catch {
    return "";
  }
  if (!response.ok) return "";
  let keys = [];
  try {
    keys = (await response.json()).keys || [];
  } catch {
    return "";
  }
  const jwk = keys.find((key) => key && key.kid === header.kid && key.kty === "RSA" && key.n && key.e);
  if (!jwk) return "";
  let signature;
  try {
    const pad = "=".repeat((4 - (parts[2].length % 4)) % 4);
    const bin = atob(parts[2].replaceAll("-", "+").replaceAll("_", "/") + pad);
    signature = Uint8Array.from(bin, (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return "";
  } catch {
    return "";
  }
  const now = nowSec(deps);
  const aud = payload.aud;
  const audOk = aud === settings.aud || (Array.isArray(aud) && aud.includes(settings.aud));
  if (payload.iss !== `https://${settings.team}` || !audOk) return "";
  if (typeof payload.exp !== "number" || payload.exp <= now) return "";
  if (typeof payload.email !== "string" || !payload.email.includes("@") || payload.email.length > 200) return "";
  return payload.email;
}

async function accessIdentity(request, env, deps) {
  const settings = accessSettings(env);
  if (!settings.trust) return { email: "", reason: "access_trust_disabled" };
  if (!settings.ready) return { email: "", reason: "access_unconfigured" };
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  if (!jwt) return { email: "", reason: "login_required" };
  const email = await verifyAccessJwt(jwt, settings, deps);
  if (!email) return { email: "", reason: "login_required" };
  if (email.toLowerCase() !== settings.allowed) return { email: "", reason: "owner_mismatch" };
  return { email, reason: "ok" };
}

async function kvGet(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvPut(kv, key, value, expiration) {
  await kv.put(key, JSON.stringify(value), expiration ? { expiration } : undefined);
}

function parseBudget(raw, fallback) {
  if (raw == null || raw === "") return { value: fallback, source: "baseline" };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return { value: null, source: "invalid" };
  return { value, source: "env" };
}

export function budgetDecision(env) {
  const limit = parseBudget(env.MIND_COMMAND_BUDGET_LIMIT_USD, 500);
  const spent = parseBudget(env.MIND_COMMAND_BUDGET_SPENT_USD, 0);
  const ownerOverride = env.MIND_COMMAND_BUDGET_OWNER_OVERRIDE === "1";
  const invalid = limit.value == null || spent.value == null;
  const paused = invalid || (!ownerOverride && spent.value >= limit.value);
  return {
    limit_usd: limit.value,
    spent_usd: spent.value,
    owner_override: ownerOverride,
    accounting: limit.source === "baseline" && spent.source === "baseline" ? "baseline" : invalid ? "invalid" : "env",
    cap_enforced: !ownerOverride,
    paused,
    provider_billing_allowance: "unknown",
    app_cap: ownerOverride ? "owner_override" : "bounded",
  };
}

function allowedChatUrl(raw) {
  try {
    const url = new URL(raw || CHAT_URL);
    return url.origin === "https://api.openai.com" && url.pathname === "/v1/chat/completions" && !url.username && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function routePlan(env) {
  return ROUTES.map((route) => {
const dedicated = typeof env[route.keyEnv] === "string" ? env[route.keyEnv] : "";
    const shared = typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY : "";
    const key = dedicated || shared;
    const base = String(env[route.baseEnv] || env.OPENAI_API_BASE_URL || CHAT_URL);
    const model = String(env[route.modelEnv] || route.defaultModel);
    const urlOk = allowedChatUrl(base);
    return {
      id: route.id,
      configured: Boolean(key) && urlOk && Boolean(model.trim()),
      model: model.trim() || null,
      endpoint: urlOk ? CHAT_URL : null,
      credential: dedicated ? route.keyEnv : key ? "OPENAI_API_KEY" : "unset",
      credential_length: key.length,
      key,
      url: urlOk ? CHAT_URL : null,
    };
  });
}

export function credentialLengths(env) {
  const names = ["OPENAI_API_KEY", "ASTRA_API_KEY", "SOL_API_KEY", "LUNA_API_KEY"];
  const lengths = {};
  for (const name of names) {
    const value = env[name];
    lengths[name] = typeof value === "string" ? value.length : 0;
  }
  return lengths;
}

export function publicStatus(env) {
  const budget = budgetDecision(env);
  const routes = routePlan(env).map(({ id, configured, model, endpoint, credential, credential_length }) => ({
    id, configured, model, endpoint, credential, credential_length,
  }));
  return {
    worker: workerName(env),
    live_verified: false,
    upstream_called: false,
    oauth: { scope: SCOPE, configured: oauthReadiness(env).ok },
    app_budget: budget,
    route_order: ["astra", "sol", "luna"],
    credential_lengths: credentialLengths(env),
    providers: routes,
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

export function usageFrom(raw) {
  if (!raw || typeof raw !== "object") {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null, usage_status: "unknown" };
  }
  const prompt = numberOrNull(raw.prompt_tokens) ?? numberOrNull(raw.input_tokens);
  const completion = numberOrNull(raw.completion_tokens) ?? numberOrNull(raw.output_tokens);
  const total = numberOrNull(raw.total_tokens);
  if (prompt == null && completion == null && total == null) {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null, usage_status: "unknown" };
  }
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, usage_status: "reported" };
}

function parseSse(text) {
  let content = "";
  let usage = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const event = JSON.parse(raw);
      const delta = event?.choices?.[0]?.delta?.content ?? event?.choices?.[0]?.message?.content;
      if (typeof delta === "string") content += delta;
      if (event?.usage && typeof event.usage === "object") usage = event.usage;
    } catch {
      /* ignore a broken frame */
    }
  }
  return { content, usage: usageFrom(usage) };
}

function messagesFrom(args) {
  if (Array.isArray(args.messages)) {
    if (args.messages.length < 1 || args.messages.length > 16) return { error: "messages must contain 1..16 items." };
    const messages = [];
    for (const item of args.messages) {
      if (!item || !["system", "user", "assistant"].includes(item.role)) return { error: "message role is invalid." };
      if (typeof item.content !== "string" || !item.content.trim() || item.content.length > TEXT_CAP) {
        return { error: "message content must be a non-empty string within the cap." };
      }
      messages.push({ role: item.role, content: item.content });
    }
    return { messages };
  }
  if (typeof args.prompt !== "string" || !args.prompt.trim() || args.prompt.length > TEXT_CAP) {
    return { error: "model.generate requires prompt or messages." };
  }
  return { messages: [{ role: "user", content: args.prompt }] };
}

function resultText(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (size < MAX_READ) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    size += step.value.byteLength;
    if (size >= MAX_READ) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out).slice(0, MAX_READ);
}

function redact(text, env) {
  let out = text;
  for (const key of ["OPENAI_API_KEY", "ASTRA_API_KEY", "SOL_API_KEY", "LUNA_API_KEY", "MCP_OAUTH_SECRET"]) {
    const value = env[key];
    if (value) out = out.split(value).join("[redacted]");
  }
  return out;
}

async function generate(args, env, fetchImpl) {
  const budget = budgetDecision(env);
  if (budget.paused) {
    return {
      isError: true,
      ...resultText({
        error: budget.accounting === "invalid"
          ? "Budget values are invalid. Nothing was sent."
          : "App budget cap is exhausted. Nothing was sent.",
        app_budget: budget,
        upstream_called: false,
      }),
    };
  }
  const provider = args.provider || "auto";
  if (!["auto", "astra", "sol", "luna"].includes(provider)) {
    return { isError: true, ...resultText({ implementation: "not_implemented_on_this_worker", provider, upstream_called: false }) };
  }
  const built = messagesFrom(args);
  if (built.error) return { isError: true, ...resultText({ error: built.error, upstream_called: false }) };
  const plan = routePlan(env).filter((route) => (provider === "auto" ? route.configured : route.id === provider));
  if (!plan.length || plan.some((route) => provider !== "auto" && !route.configured)) {
    return { isError: true, ...resultText({ error: "No configured Astra, Sol, or Luna route. Nothing was sent.", upstream_called: false, app_budget: budget }) };
  }
  const timeout = Number.isInteger(args.timeout_seconds) ? Math.min(20, Math.max(1, args.timeout_seconds)) : 20;
  const stream = args.stream === true;
  const attempted = [];
  const errors = [];
  for (const route of plan) {
    attempted.push(route.id);
    const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : route.model;
    const body = { model, messages: built.messages, stream };
    if (stream) body.stream_options = { include_usage: true };
    let response;
    try {
      response = await fetchImpl(route.url, {
        method: "POST",
        headers: { authorization: `Bearer ${route.key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout * 1000),
      });
    } catch {
      errors.push({ provider: route.id, error: "request failed" });
      continue;
    }
    const text = await readCapped(response);
    if (!response.ok) {
      errors.push({ provider: route.id, error: `HTTP ${response.status}` });
      continue;
    }
    let content = "";
    let usage = usageFrom(null);
    if (stream) {
      const parsed = parseSse(text);
      content = parsed.content;
      usage = parsed.usage;
    } else {
      try {
        const payload = JSON.parse(text);
        content = payload?.choices?.[0]?.message?.content ?? "";
        usage = usageFrom(payload?.usage);
      } catch {
        errors.push({ provider: route.id, error: "unreadable response" });
        continue;
      }
    }
    if (typeof content !== "string" || !content.trim()) {
      errors.push({ provider: route.id, error: "no assistant text" });
      continue;
    }
    return {
      isError: false,
      ...resultText({
        provider: route.id,
        model,
        content: content.slice(0, 12_000),
        streamed: stream,
        usage,
        usage_accounting: "single_response",
        route: { attempted, selected: route.id, errors },
        app_budget: budget,
        provider_billing_allowance: "unknown",
        cost_usd: null,
        live_account_verified: false,
      }),
    };
  }
  return {
    isError: true,
    ...resultText({ error: "No configured Astra, Sol, or Luna route succeeded.", route: { attempted, selected: null, errors }, app_budget: budget, upstream_called: true }),
  };
}

async function callTool(name, args, env, deps) {
  if (name === "provider.status") return { isError: false, ...resultText(publicStatus(env)) };
  if (name === "model.generate") return generate(args || {}, env, deps.fetchImpl || fetch);
  return { isError: true, ...resultText({ error: `Tool unavailable: ${name}` }) };
}

async function issueToken(kv, ready, record, now) {
  const access = await randomToken();
  const refresh = await randomToken();
  const accessHash = hex(await sha256(access));
  const refreshHash = hex(await sha256(refresh));
  await kvPut(kv, `t:${accessHash}`, {
    subject: record.subject,
    clientId: record.clientId,
    scope: SCOPE,
    aud: ready.audience,
    expires: now + 3600,
    refreshHash,
    refreshExpires: now + 30 * 24 * 60 * 60,
  }, now + 30 * 24 * 60 * 60);
  await kvPut(kv, `r:${refreshHash}`, { accessHash }, now + 30 * 24 * 60 * 60);
  return { access_token: access, token_type: "Bearer", expires_in: 3600, scope: SCOPE, refresh_token: refresh };
}

async function authorize(request, env, ready, deps) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const identity = await accessIdentity(request, env, deps);
  if (!identity.email) {
    const description = identity.reason === "access_trust_disabled"
      ? "Cloudflare Access enforcement is not enabled."
      : identity.reason === "access_unconfigured"
        ? "Access JWT verification is not configured."
        : identity.reason === "owner_mismatch"
          ? "The verified Access identity is not the allowed owner."
          : "A verified Cloudflare Access JWT is required.";
    return json(401, { error: "login_required", error_description: description });
  }
  const subject = identity.email;
  if (params.client_id !== ready.clientId || !ready.redirects.includes(params.redirect_uri || "")) {
    return json(400, { error: "invalid_request", error_description: "Unknown client or redirect URI." });
  }
  if (params.response_type !== "code") return json(400, { error: "unsupported_response_type", error_description: "Only response_type=code is supported." });
  if (params.code_challenge_method !== "S256" || !params.code_challenge) {
    return json(400, { error: "invalid_request", error_description: "PKCE S256 is required." });
  }
  if (!scopesOk(params.scope)) return json(400, { error: "invalid_scope", error_description: "Only the mind.tools scope is supported." });
  const code = await randomToken();
  const now = nowSec(deps);
  await kvPut(env.OAUTH_KV, `c:${hex(await sha256(code))}`, {
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    challenge: params.code_challenge,
    subject,
    scope: SCOPE,
    expires: now + 600,
  }, now + 600);
  const location = new URL(params.redirect_uri);
  location.searchParams.set("code", code);
  if (params.state != null) location.searchParams.set("state", params.state);
  return new Response(null, { status: 302, headers: { location: location.toString(), "cache-control": "no-store" } });
}

async function token(request, env, ready, deps) {
  const type = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return json(415, { error: "invalid_request", error_description: "Content-Type must be application/x-www-form-urlencoded." });
  const params = Object.fromEntries(new URLSearchParams(await request.text()).entries());
  const now = nowSec(deps);
  const grant = params.grant_type || "authorization_code";
  if (grant === "refresh_token") {
    const refreshHash = hex(await sha256(params.refresh_token || ""));
    const pointer = await kvGet(env.OAUTH_KV, `r:${refreshHash}`);
    const previous = pointer ? await kvGet(env.OAUTH_KV, `t:${pointer.accessHash}`) : null;
    if (!previous || previous.refreshExpires <= now || params.client_id !== previous.clientId) {
      return json(400, { error: "invalid_grant", error_description: "Refresh token is invalid or expired." });
    }
    await env.OAUTH_KV.delete(`r:${refreshHash}`);
    await env.OAUTH_KV.delete(`t:${pointer.accessHash}`);
    return json(200, await issueToken(env.OAUTH_KV, ready, previous, now));
  }
  if (grant !== "authorization_code") return json(400, { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported." });
  const exchanged = await exchangeCode(params, env, ready, deps);
  if (!exchanged.ok) return json(400, { error: "invalid_grant", error_description: exchanged.error });
  return json(200, exchanged.issued);
}

async function exchangeCode(params, env, ready, deps) {
  const now = nowSec(deps);
  const record = await kvGet(env.OAUTH_KV, `c:${hex(await sha256(params.code || ""))}`);
  await env.OAUTH_KV.delete(`c:${hex(await sha256(params.code || ""))}`);
  if (!record || record.expires <= now) return { ok: false, error: "Authorization code is invalid or expired." };
  if (params.client_id !== record.clientId || params.redirect_uri !== record.redirectUri) {
    return { ok: false, error: "Client or redirect URI does not match authorization code." };
  }
  if ((await pkceChallenge(params.code_verifier || "")) !== record.challenge) {
    return { ok: false, error: "PKCE verification failed." };
  }
  return { ok: true, subject: record.subject, issued: await issueToken(env.OAUTH_KV, ready, record, now) };
}

const HARNESS_NOTE = "Sign-in finished. No authorization code or token is shown.";

async function revokeValue(env, tokenValue) {
  if (!tokenValue) return;
  const hash = hex(await sha256(tokenValue));
  const access = await kvGet(env.OAUTH_KV, `t:${hash}`);
  if (access?.refreshHash) await env.OAUTH_KV.delete(`r:${access.refreshHash}`);
  await env.OAUTH_KV.delete(`t:${hash}`);
}

async function testStart(request, env, ready, deps) {
  const identity = accessSettings(env);
  if (!identity.ready) {
    return json(401, { error: "login_required", error_description: identity.trust ? "Access JWT verification is not configured." : "Cloudflare Access enforcement is not enabled." });
  }
  const generation = generationChoice(new URL(request.url).searchParams.get("generation"));
  const state = await randomToken();
  const verifier = await randomToken();
  const now = nowSec(deps);
  await kvPut(env.OAUTH_KV, `h:${hex(await sha256(state))}`, { verifier, expires: now + 600, generation }, now + 600);
  const location = new URL(`${ready.issuer}/oauth/authorize`);
  location.searchParams.set("response_type", "code");
  location.searchParams.set("client_id", ready.clientId);
  location.searchParams.set("redirect_uri", ready.testCallback);
  location.searchParams.set("scope", SCOPE);
  location.searchParams.set("code_challenge_method", "S256");
  location.searchParams.set("code_challenge", await pkceChallenge(verifier));
  location.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: location.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

const HIDDEN_HEADERS = new Set(["authorization", "cookie", "set-cookie", "cf-access-jwt-assertion", "proxy-authorization"]);

function publicMcpUrl(ready) {
  return PUBLIC_MCP_ORIGINS.has(ready.issuer) ? `${ready.issuer}/mcp` : null;
}

function sanitizedHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HIDDEN_HEADERS.has(name)) return;
    out[name] = String(value).slice(0, 180);
  });
  return out;
}

async function publicCall(env, testedURL, accessToken, deps, method, body) {
  const fetchImpl = deps.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(testedURL, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { method, http_status: null, headers: {}, response: null, error: error instanceof Error ? error.name : "fetch_failed" };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    parsed = null;
  }
  let safe = null;
  try {
    safe = JSON.parse(redact(JSON.stringify(parsed), env).split(accessToken).join("[redacted]"));
  } catch {
    safe = null;
  }
  return { method, http_status: response.status, headers: sanitizedHeaders(response.headers), response: safe };
}

function callSucceeded(call) {
  if (call.http_status !== 200 || !call.response?.result) return false;
  if (call.method === "tools/call" && call.response.result.isError === true) return false;
  return true;
}

async function claimGeneration(env, deps, generation) {
  const ledger = GENERATION_LEDGERS[generation];
  if (!ledger) return { ok: false, reason: "not_opted_in" };
  const existing = await kvGet(env.OAUTH_KV, ledger);
  if (!existing || existing.phase !== "authorized") {
    return { ok: false, reason: existing ? "already_used" : "not_authorized" };
  }
  const nonce = await randomToken();
  const now = nowSec(deps);
  await kvPut(env.OAUTH_KV, ledger, { phase: "attempted", nonce, at: now });
  const confirm = await kvGet(env.OAUTH_KV, ledger);
  if (!confirm || confirm.nonce !== nonce || confirm.phase !== "attempted") return { ok: false, reason: "ledger_race" };
  return { ok: true, ledger };
}

async function finishGeneration(env, deps, ledger, fields) {
  const now = nowSec(deps);
  await kvPut(env.OAUTH_KV, ledger, { phase: "completed", at: now, ...fields });
}

async function mcpEvidence(env, ready, accessToken, deps, generation) {
  const testedURL = publicMcpUrl(ready);
  const evidence = {
    transport: "public_https",
    testedURL,
    fetch_path: deps.fetchImpl ? "injected" : "global_fetch",
    external_network_verified: false,
    upstream_called: false,
    live_account_verified: false,
    calls: [],
    generation: { called: false, reason: generation ? "not_authorized" : "not_opted_in", ledger: generation ? GENERATION_LEDGERS[generation] : null },
  };
  if (!testedURL) return { ...evidence, ok: false, error: "issuer_not_allowed" };
  const requests = [
    ["initialize", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }],
    ["tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }],
    ["tools/call", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "provider.status", arguments: {} } }],
  ];
  for (const [method, body] of requests) evidence.calls.push(await publicCall(env, testedURL, accessToken, deps, method, body));
  evidence.ok = evidence.calls.length === 3 && evidence.calls.every(callSucceeded);
  if (!generation) return evidence;
  const claim = await claimGeneration(env, deps, generation);
  if (!claim.ok) {
    evidence.generation = { called: false, reason: claim.reason, ledger: GENERATION_LEDGERS[generation] };
    evidence.ok = false;
    return evidence;
  }
  const generated = await publicCall(env, testedURL, accessToken, deps, "tools/call", {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "model.generate", arguments: { provider: "auto", prompt: "Reply with OK", stream: false } },
  });
  let tool = null;
  try {
    tool = JSON.parse(generated.response?.result?.content?.[0]?.text || "null");
  } catch {
    tool = null;
  }
  const attempted = Array.isArray(tool?.route?.attempted) ? tool.route.attempted : null;
  const unreached = attempted ? ["astra", "sol", "luna"].filter((id) => !attempted.includes(id)) : null;
  evidence.calls.push(generated);
  evidence.generation = {
    called: true,
    ledger: claim.ledger,
    http_status: generated.http_status,
    isError: generated.response?.result?.isError === true,
    provider: tool?.provider ?? null,
    model: tool?.model ?? null,
    route: tool?.route ?? null,
    attempted,
    unreached,
    usage: tool?.usage ?? { prompt_tokens: null, completion_tokens: null, total_tokens: null, usage_status: "unknown" },
    cost_usd: null,
    provider_billing_allowance: "unknown",
  };
  evidence.upstream_called = true;
  evidence.ok = evidence.ok && callSucceeded(generated);
  await finishGeneration(env, deps, claim.ledger, { http_status: generated.http_status, provider: evidence.generation.provider });
  return evidence;
}

async function testCallback(request, env, ready, deps) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const opaque = /^[A-Za-z0-9_-]{20,200}$/;
  if (!opaque.test(code) || !opaque.test(state)) return new Response(HARNESS_NOTE, { status: 400, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", referrer: "no-referrer" } });
  const stateKey = `h:${hex(await sha256(state))}`;
  const harness = await kvGet(env.OAUTH_KV, stateKey);
  await env.OAUTH_KV.delete(stateKey);
  const now = nowSec(deps);
  if (!harness || harness.expires <= now) return new Response(HARNESS_NOTE, { status: 400, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const exchanged = await exchangeCode({
    code,
    client_id: ready.clientId,
    redirect_uri: ready.testCallback,
    code_verifier: harness.verifier,
  }, env, ready, deps);
  if (!exchanged.ok || exchanged.subject.toLowerCase() !== accessSettings(env).allowed) {
    if (exchanged.ok) await revokeValue(env, exchanged.issued.access_token);
    return new Response(HARNESS_NOTE, { status: 400, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const evidence = await mcpEvidence(env, ready, exchanged.issued.access_token, deps, generationChoice(harness.generation));
  await revokeValue(env, exchanged.issued.access_token);
  await revokeValue(env, exchanged.issued.refresh_token);
  const handle = await randomToken();
  await kvPut(env.OAUTH_KV, `e:${hex(await sha256(handle))}`, { evidence, expires: now + 120 }, now + 120);
  return new Response(null, { status: 302, headers: { location: `/oauth/test-result?handle=${handle}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

async function testResult(request, env, deps) {
  const handle = new URL(request.url).searchParams.get("handle") || "";
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(handle)) return new Response(HARNESS_NOTE, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const key = `e:${hex(await sha256(handle))}`;
  const row = await kvGet(env.OAUTH_KV, key);
  await env.OAUTH_KV.delete(key);
  if (!row || row.expires <= nowSec(deps)) return new Response(HARNESS_NOTE, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return json(200, row.evidence);
}

async function revoke(request, env) {
  const type = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return json(415, { error: "invalid_request" });
  const params = Object.fromEntries(new URLSearchParams(await request.text()).entries());
  const hash = hex(await sha256(params.token || ""));
  const access = await kvGet(env.OAUTH_KV, `t:${hash}`);
  if (access?.refreshHash) await env.OAUTH_KV.delete(`r:${access.refreshHash}`);
  await env.OAUTH_KV.delete(`t:${hash}`);
  const pointer = await kvGet(env.OAUTH_KV, `r:${hash}`);
  if (pointer?.accessHash) {
    const record = await kvGet(env.OAUTH_KV, `t:${pointer.accessHash}`);
    if (record?.refreshHash) await env.OAUTH_KV.delete(`r:${record.refreshHash}`);
    await env.OAUTH_KV.delete(`t:${pointer.accessHash}`);
    await env.OAUTH_KV.delete(`r:${hash}`);
  }
  return json(200, {});
}

async function accessClaims(tokenValue, env, ready, deps) {
  const record = await kvGet(env.OAUTH_KV, `t:${hex(await sha256(tokenValue))}`);
  if (!record || record.expires <= nowSec(deps)) return { error: "invalid_token", status: 401 };
  if (record.aud !== ready.audience) return { error: "invalid_token", status: 401 };
  if (!String(record.scope || "").split(/\s+/).includes(SCOPE)) return { error: "insufficient_scope", status: 403 };
  return { record };
}

function unconfigured(ready) {
  return json(503, { error: "oauth_unconfigured", missing: ready.missing });
}

export async function handleRequest(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const ready = oauthReadiness(env);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, {
      status: "ok",
      worker: workerName(env),
      live_verified: false,
      oauth_configured: ready.ok,
      missing: ready.ok ? [] : ready.missing,
    });
  }
  if (url.pathname === "/.well-known/oauth-authorization-server" && request.method === "GET") {
    return ready.ok ? json(200, metadata(ready)) : unconfigured(ready);
  }
  if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
    return ready.ok ? json(200, resourceMetadata(ready)) : unconfigured(ready);
  }
  if ((url.pathname === "/oauth/test-start" || url.pathname === "/oauth/start") && request.method === "GET") return ready.ok ? testStart(request, env, ready, deps) : unconfigured(ready);
  if ((url.pathname === "/oauth/test-callback" || url.pathname === "/oauth/callback") && request.method === "GET") return ready.ok ? testCallback(request, env, ready, deps) : unconfigured(ready);
  if ((url.pathname === "/oauth/test-result" || url.pathname === "/oauth/result") && request.method === "GET") return ready.ok ? testResult(request, env, deps) : unconfigured(ready);
  if (url.pathname === "/oauth/authorize" && request.method === "GET") return ready.ok ? authorize(request, env, ready, deps) : unconfigured(ready);
  if (url.pathname === "/oauth/token" && request.method === "POST") return ready.ok ? token(request, env, ready, deps) : unconfigured(ready);
  if (url.pathname === "/oauth/revoke" && request.method === "POST") return ready.ok ? revoke(request, env) : unconfigured(ready);
  if (url.pathname !== "/mcp") return json(404, { error: "Not found." });
  if (request.method !== "POST") return json(405, { error: "Use JSON POST." });
  if (!ready.ok) return unconfigured(ready);
  const header = request.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const claims = await accessClaims(presented, env, ready, deps);
  if (claims.error) {
    return json(claims.status, { error: claims.error === "insufficient_scope" ? "insufficient_scope" : "Unauthorized." }, {
      "www-authenticate": `Bearer realm="mind-mcp", resource_metadata="${ready.issuer}/.well-known/oauth-protected-resource"`,
    });
  }
  const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return json(415, { error: "Content-Type must be application/json." });
  const raw = await request.text();
  if (!raw || raw.length > MAX_BODY) return json(raw.length > MAX_BODY ? 413 : 400, { error: "Request body must be 1..100000 bytes." });
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return json(400, { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request." } });
  }
  const id = message.id ?? null;
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (message.method === "ping") return json(200, { jsonrpc: "2.0", id, result: {} });
  if (message.method === "initialize") {
    return json(200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: workerName(env), version: "0.2.0" },
      },
    });
  }
  if (message.method === "tools/list") return json(200, { jsonrpc: "2.0", id, result: { tools: toolSpecs() } });
  if (message.method === "tools/call") {
    const params = message.params || {};
    if (typeof params.name !== "string" || !params.name) {
      return json(200, { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call requires a tool name." } });
    }
    if (params.arguments != null && (typeof params.arguments !== "object" || Array.isArray(params.arguments))) {
      return json(200, { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call arguments must be an object." } });
    }
    const result = await callTool(params.name, params.arguments || {}, env, deps);
    return json(200, { jsonrpc: "2.0", id, result: JSON.parse(redact(JSON.stringify(result), env)) });
  }
  return json(200, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
