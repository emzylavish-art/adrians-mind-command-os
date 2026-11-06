/**
 * Free-plan Cloudflare Worker MCP entrypoint.
 * Static bearer auth. OPENAI_API_KEY stays on the Worker secret.
 * Python team/mcp_http.py is not executed here.
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MAX_BODY = 100_000;
const MAX_READ = 48_000;
const TEXT_CAP = 8_000;

export const WORKER_NAME = "adrians-mind-mcp-tools";

const INVENTORY = [
  {
    category: "chat.completions",
    tool: "model.generate",
    dispatch: "implemented",
    endpoint: "POST /v1/chat/completions",
    live_account_verified: false,
    notes: "Non-stream and stream are one Worker call and one usage object. Stream text is aggregated; usage is the final usage object, not a sum of chunks. Missing usage is unknown, not zero.",
  },
  {
    category: "responses",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/responses",
    live_account_verified: false,
    notes: "Not dispatched. Responses being recommended does not mean this Worker verified the account.",
  },
  {
    category: "embeddings",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/embeddings",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "images",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/images/generations and /v1/images/edits",
    live_account_verified: false,
    notes: "Not dispatched. Older GPT Image model shutdown notices are not a live probe.",
  },
  {
    category: "audio.speech",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/audio/speech",
    live_account_verified: false,
    notes: "Not dispatched. Consulted deprecation notes list some TTS models shutting down 2027-01-06.",
  },
  {
    category: "audio.transcriptions",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/audio/transcriptions",
    live_account_verified: false,
    notes: "Not dispatched. Consulted notes list whisper/gpt-4o transcribe models shutting down 2027-02-26.",
  },
  {
    category: "audio.translations",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/audio/translations",
    live_account_verified: false,
    notes: "Not dispatched. Consulted notes list this endpoint shutting down 2027-02-26.",
  },
  {
    category: "files",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "/v1/files",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "batches",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "/v1/batches",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "moderations",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/moderations",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "models",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "GET /v1/models",
    live_account_verified: false,
    notes: "Not dispatched. Model ids are not inferred from an account list.",
  },
  {
    category: "assistants.threads",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "/v1/assistants and /v1/threads",
    live_account_verified: false,
    notes: "Not dispatched. Official shutdown date consulted: 2026-08-26. This build did not probe the account.",
  },
  {
    category: "vector_stores",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "/v1/vector_stores",
    live_account_verified: false,
    notes: "Not dispatched and not live-verified.",
  },
  {
    category: "fine_tuning",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "/v1/fine_tuning/jobs",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "conversations",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "Conversations API",
    live_account_verified: false,
    notes: "Named as the Assistants replacement in consulted docs. Not dispatched.",
  },
  {
    category: "realtime",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "Realtime API",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "legacy.completions",
    tool: null,
    dispatch: "unimplemented",
    endpoint: "POST /v1/completions",
    live_account_verified: false,
    notes: "Not dispatched.",
  },
  {
    category: "admin.billing.arbitrary_url",
    tool: null,
    dispatch: "not_exposed",
    endpoint: null,
    live_account_verified: false,
    notes: "Account, billing, secret management, and arbitrary URL proxy are intentionally not exposed.",
  },
];

const MODEL_GENERATE_SCHEMA = {
  type: "object",
  properties: {
    provider: { type: "string", enum: ["openai"] },
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
};

export function toolSpecs() {
  return [
    {
      name: "model.generate",
      description: "OpenAI chat completions using the Worker secret OPENAI_API_KEY. One call records usage once. Astra, Sol, Luna, Grok, OpenRouter, and Ollama are not dispatched. Provider billing allowance is unknown. No durable usage store.",
      inputSchema: MODEL_GENERATE_SCHEMA,
    },
    {
      name: "mind.tool_inventory",
      description: "Local inventory of OpenAI API categories. implemented means this Worker can dispatch. unimplemented means not dispatched, not a live claim that OpenAI removed the endpoint. No network call.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

function json(status, payload, headers) {
  return new Response(payload == null ? null : JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(headers || {}),
    },
  });
}

async function digest(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(bytes);
}

async function tokenMatches(presented, expected) {
  if (!presented || !expected) return false;
  const left = await digest(presented);
  const right = await digest(expected);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
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
      /* ignore a broken frame; do not invent usage */
    }
  }
  return { content, usage: usageFrom(usage) };
}

function messagesFrom(args) {
  if (Array.isArray(args.messages)) {
    if (args.messages.length < 1 || args.messages.length > 16) return { error: "messages must contain 1..16 items." };
    const messages = [];
    for (const item of args.messages) {
      if (!item || typeof item !== "object") return { error: "each message must be an object." };
      if (!["system", "user", "assistant"].includes(item.role)) return { error: "message role is invalid." };
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
  let truncated = false;
  while (size < MAX_READ) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    size += step.value.byteLength;
    if (size >= MAX_READ) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const text = new TextDecoder().decode(concat(chunks));
  return truncated ? text.slice(0, MAX_READ) : text;
}

function concat(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function generate(args, env, fetchImpl) {
  if (args.provider != null && args.provider !== "openai") {
    return {
      isError: true,
      ...resultText({
        implementation: "not_implemented_on_this_worker",
        provider: args.provider,
        live_account_verified: false,
        note: "This Worker dispatches provider openai only. Other providers are not called and are not declared unsupported.",
      }),
    };
  }
  const key = env.OPENAI_API_KEY || "";
  if (!key) {
    return {
      isError: true,
      ...resultText({
        implementation: "implemented",
        this_call: "unconfigured",
        provider: "openai",
        live_account_verified: false,
        note: "OPENAI_API_KEY is not set on the Worker. Nothing was sent.",
      }),
    };
  }
  const built = messagesFrom(args);
  if (built.error) return { isError: true, ...resultText({ error: built.error }) };
  const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : (env.OPENAI_MODEL || "").trim();
  if (!model || model.length > 120) {
    return { isError: true, ...resultText({ error: "A model name is required (argument model or Worker variable OPENAI_MODEL)." }) };
  }
  const stream = args.stream === true;
  const timeout = Number.isInteger(args.timeout_seconds) ? Math.min(20, Math.max(1, args.timeout_seconds)) : 20;
  const body = { model, messages: built.messages, stream };
  if (stream) body.stream_options = { include_usage: true };
  let response;
  try {
    response = await fetchImpl(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout * 1000),
    });
  } catch {
    return {
      isError: true,
      ...resultText({
        provider: "openai",
        model,
        ok: false,
        error: "openai request failed",
        usage: usageFrom(null),
        provider_billing_allowance: "unknown",
        cost_usd: null,
      }),
    };
  }
  const text = await readCapped(response);
  if (!response.ok) {
    return {
      isError: true,
      ...resultText({
        provider: "openai",
        model,
        ok: false,
        error: `openai returned HTTP ${response.status}`,
        usage: usageFrom(null),
        provider_billing_allowance: "unknown",
        cost_usd: null,
        live_account_verified: false,
      }),
    };
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
      return { isError: true, ...resultText({ error: "openai returned an unreadable response", usage: usageFrom(null) }) };
    }
  }
  if (typeof content !== "string" || !content.trim()) {
    return { isError: true, ...resultText({ error: "openai returned no assistant text", usage, provider: "openai", model }) };
  }
  return {
    isError: false,
    ...resultText({
      provider: "openai",
      model,
      content: content.slice(0, 12_000),
      truncated: content.length > 12_000,
      streamed: stream,
      usage,
      usage_accounting: "single_response",
      usage_persistence: "not_durable_on_this_worker",
      provider_billing_allowance: "unknown",
      cost_usd: null,
      app_budget: "not_enforced_here",
      live_account_verified: false,
      implementation: "implemented",
    }),
  };
}

function inventory() {
  return {
    isError: false,
    ...resultText({
      worker: WORKER_NAME,
      implemented_tools: ["model.generate", "mind.tool_inventory"],
      live_account_verified: false,
      provider_billing_allowance: "unknown",
      usage_persistence: "not_durable_on_this_worker",
      python_mcp_http: "not_running_on_workers",
      categories: INVENTORY,
    }),
  };
}

async function callTool(name, args, env, fetchImpl) {
  if (name === "mind.tool_inventory") return inventory();
  if (name === "model.generate") return generate(args || {}, env, fetchImpl);
  return { isError: true, ...resultText({ error: `Tool unavailable: ${name}` }) };
}

export async function handleRequest(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, {
      status: "ok",
      worker: WORKER_NAME,
      live_verified: false,
      auth_configured: Boolean(env.MCP_AUTH_TOKEN),
      openai_key_configured: Boolean(env.OPENAI_API_KEY),
    });
  }
  if (url.pathname !== "/mcp") return json(404, { error: "Not found." });
  if (request.method !== "POST") return json(405, { error: "Use JSON POST." });
  if (!env.MCP_AUTH_TOKEN) return json(503, { error: "MCP_AUTH_TOKEN is not configured." });
  const presented = bearer(request);
  if (!(await tokenMatches(presented, env.MCP_AUTH_TOKEN))) {
    return json(401, { error: "Unauthorized." }, { "www-authenticate": 'Bearer realm="mind-mcp"' });
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
        serverInfo: { name: WORKER_NAME, version: "0.1.0" },
      },
    });
  }
  if (message.method === "tools/list") {
    return json(200, { jsonrpc: "2.0", id, result: { tools: toolSpecs() } });
  }
  if (message.method === "tools/call") {
    const params = message.params || {};
    if (typeof params.name !== "string" || !params.name) {
      return json(200, { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call requires a tool name." } });
    }
    if (params.arguments != null && (typeof params.arguments !== "object" || Array.isArray(params.arguments))) {
      return json(200, { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call arguments must be an object." } });
    }
    const result = await callTool(params.name, params.arguments || {}, env, deps.fetchImpl || fetch);
    const serialized = JSON.stringify(result);
    if ((env.OPENAI_API_KEY && serialized.includes(env.OPENAI_API_KEY)) || serialized.includes(env.MCP_AUTH_TOKEN)) {
      return json(200, {
        jsonrpc: "2.0",
        id,
        result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "response redacted" }) }] },
      });
    }
    return json(200, { jsonrpc: "2.0", id, result });
  }
  return json(200, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
