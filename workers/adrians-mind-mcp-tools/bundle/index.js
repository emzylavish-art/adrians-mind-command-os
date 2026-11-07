/**
 * Nonproduction edge MCP for adrians-mind-mcp-test.
 * OAuth matches team/oauth.py + team/mcp_http.py. No static bearer labelled as OAuth.
 * Calls only https://api.openai.com/v1/chat/completions. No tunnels, localhost, or PC tools.
 */

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const WORKER_NAME = "adrians-mind-mcp-test";
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

export function oauthReadiness(env) {
  const missing = [];
  if (!env.OAUTH_KV) missing.push("OAUTH_KV");
  const issuer = String(env.MCP_OAUTH_ISSUER || "");
  if (!issuer.startsWith("https://")) missing.push("MCP_OAUTH_ISSUER");
  if (!String(env.MCP_OAUTH_SECRET || "")) missing.push("MCP_OAUTH_SECRET");
  if (!String(env.MCP_OAUTH_CLIENT_ID || "")) missing.push("MCP_OAUTH_CLIENT_ID");
  const redirects = String(env.MCP_OAUTH_REDIRECT_URIS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!redirects.length || redirects.some((uri) => !safeRedirect(uri))) missing.push("MCP_OAUTH_REDIRECT_URIS");
  const audience = String(env.MCP_OAUTH_AUDIENCE || (issuer ? `${issuer.replace(/\/$/, "")}/mcp` : ""));
  return { ok: missing.length === 0, missing, issuer: issuer.replace(/\/$/, ""), audience, redirects, clientId: String(env.MCP_OAUTH_CLIENT_ID || "") };
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

function subjectFor(request, env) {
  if (env.MCP_TRUST_ACCESS_IDENTITY === "1") {
    return request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  }
  if (env.MCP_ENV === "development") return String(env.MCP_OAUTH_DEV_SUBJECT || "");
  return "";
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
    const key = String(env[route.keyEnv] || env.OPENAI_API_KEY || "");
    const base = String(env[route.baseEnv] || env.OPENAI_API_BASE_URL || CHAT_URL);
    const model = String(env[route.modelEnv] || route.defaultModel);
    const urlOk = allowedChatUrl(base);
    return {
      id: route.id,
      configured: Boolean(key) && urlOk && Boolean(model.trim()),
      model: model.trim() || null,
      endpoint: urlOk ? CHAT_URL : null,
      key,
      url: urlOk ? CHAT_URL : null,
    };
  });
}

export function publicStatus(env) {
  const budget = budgetDecision(env);
  const routes = routePlan(env).map(({ id, configured, model, endpoint }) => ({ id, configured, model, endpoint }));
  return {
    worker: WORKER_NAME,
    live_verified: false,
    upstream_called: false,
    oauth: { scope: SCOPE, configured: oauthReadiness(env).ok },
    app_budget: budget,
    route_order: ["astra", "sol", "luna"],
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
  const subject = subjectFor(request, env);
  if (!subject) return json(401, { error: "login_required", error_description: "Cloudflare Access identity is required." });
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
  const codeHash = hex(await sha256(params.code || ""));
  const record = await kvGet(env.OAUTH_KV, `c:${codeHash}`);
  await env.OAUTH_KV.delete(`c:${codeHash}`);
  if (!record || record.expires <= now) return json(400, { error: "invalid_grant", error_description: "Authorization code is invalid or expired." });
  if (params.client_id !== record.clientId || params.redirect_uri !== record.redirectUri) {
    return json(400, { error: "invalid_grant", error_description: "Client or redirect URI does not match authorization code." });
  }
  if ((await pkceChallenge(params.code_verifier || "")) !== record.challenge) {
    return json(400, { error: "invalid_grant", error_description: "PKCE verification failed." });
  }
  return json(200, await issueToken(env.OAUTH_KV, ready, record, now));
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
      worker: WORKER_NAME,
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
        serverInfo: { name: WORKER_NAME, version: "0.2.0" },
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
