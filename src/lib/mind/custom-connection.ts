/**
 * Custom MCP and custom HTTP connections stored in the shared MCP registry.
 * Bearer tokens are sealed with CONNECTOR_TOKEN_SECRET before a database write.
 * model.generate is refused. Gmail OAuth is not started here.
 */
import { randomUUID } from "node:crypto";
import {
  isLocalHostname,
  isPrivateAddressLiteral,
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./mcp/http-dns-pin.ts";
import { loadRegistry, saveRegistry, type RegistryDb, type RegistryRecord } from "./mcp/registry-store.ts";
import type { McpCallRpc, McpCallTransport, McpContentPart } from "./mcp/call-contract.ts";
import { privacyErrorText } from "./mcp/call-contract.ts";

export type ArgType = "string" | "boolean" | "integer";

export type OperationSchema = {
  type: "object";
  properties: Record<string, { type: ArgType; description?: string }>;
  required: string[];
};

export type PublicOperation = {
  name: string;
  description: string;
  inputSchema: OperationSchema | null;
  compatible: boolean;
};

export type ConnectionState = "unchecked" | "ready" | "unauthorized" | "missing_config" | "incompatible" | "failed";

export type PublicConnection = {
  id: string;
  label: string;
  kind: "mcp" | "http";
  host: string;
  method: "GET" | "POST" | "MCP";
  auth: "none" | "bearer";
  hasToken: boolean;
  state: ConnectionState;
  operations: PublicOperation[];
  error: string;
};

export type CallStatus = "ok" | "error" | "unauthorized" | "missing_config" | "incompatible" | "timeout";

export type ConnectionDb = RegistryDb;

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function toPublic(server: RegistryRecord): PublicConnection | null {
  if (!server.url || server.kind === "builtin" || server.kind === "command") return null;
  const kind = server.protocol === "http" ? "http" : "mcp";
  const operations = Array.isArray(server.operations) ? server.operations as PublicOperation[] : [];
  return {
    id: server.id,
    label: server.label,
    kind,
    host: hostOf(server.url),
    method: kind === "http" ? (server.httpMethod === "POST" ? "POST" : "GET") : "MCP",
    auth: server.token || server.tokenEnc ? "bearer" : "none",
    hasToken: Boolean(server.token || server.tokenEnc),
    state: (server.state as ConnectionState) || "unchecked",
    operations,
    error: server.secretUnreadable ? "The saved credential cannot be decrypted. Nothing was called." : server.error ?? "",
  };
}

export async function listCustomConnections(db: ConnectionDb | null, userId: string): Promise<PublicConnection[]> {
  const loaded = await loadRegistry(userId, db);
  return loaded.servers.map(toPublic).filter((row): row is PublicConnection => Boolean(row));
}

export function endpointProblem(value: string): { ok: true; url: string; host: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, error: "That is not a URL. Nothing was saved." };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "Put the secret in the token field, not the URL. Nothing was saved." };
  const host = parsed.hostname.toLowerCase();
  const local = isLocalHostname(host);
  if (!(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))) {
    return { ok: false, error: "Only https, or http on localhost, can be saved. Nothing was saved." };
  }
  if (!local && (isPrivateAddressLiteral(host) || host === "metadata.google.internal" || host.endsWith(".internal"))) {
    return { ok: false, error: "Private, link-local and metadata hosts are refused. Nothing was saved." };
  }
  return { ok: true, url: parsed.toString(), host: parsed.host };
}

export function readOperationSchema(input: unknown): OperationSchema | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const schema = input as Record<string, unknown>;
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return null;
  const properties: OperationSchema["properties"] = {};
  for (const [key, raw] of Object.entries(schema.properties).slice(0, 12)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key) || !raw || typeof raw !== "object") return null;
    const type = (raw as { type?: unknown }).type;
    if (type !== "string" && type !== "boolean" && type !== "integer") return null;
    const description = typeof (raw as { description?: unknown }).description === "string" ? (raw as { description: string }).description.slice(0, 160) : undefined;
    properties[key] = description ? { type, description } : { type };
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && item in properties)
    : [];
  return { type: "object", properties, required };
}

export function validateArgs(schema: OperationSchema, args: Record<string, unknown>): { ok: true; args: Record<string, string | number | boolean> } | { ok: false; error: string } {
  const unexpected = Object.keys(args).filter((key) => !(key in schema.properties));
  if (unexpected.length) return { ok: false, error: `Unexpected argument ${unexpected[0]}. Nothing was called.` };
  const out: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(schema.properties)) {
    const value = args[key];
    if (value == null || value === "") {
      if (schema.required.includes(key)) return { ok: false, error: `Missing ${key}. Nothing was called.` };
      continue;
    }
    if (spec.type === "string") {
      if (typeof value !== "string") return { ok: false, error: `${key} must be a string. Nothing was called.` };
      out[key] = value.slice(0, 500);
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") return { ok: false, error: `${key} must be boolean. Nothing was called.` };
      out[key] = value;
    } else if (!Number.isInteger(value)) {
      return { ok: false, error: `${key} must be an integer. Nothing was called.` };
    } else {
      out[key] = value as number;
    }
  }
  return { ok: true, args: out };
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join("[redacted]") : text;
}

async function send(url: string, init: RequestInit, deps: { fetch?: FetchLike; lookup?: DnsLookupFn }, token: string): Promise<{ ok: true; status: number; text: string } | { ok: false; status: CallStatus; error: string }> {
  const checked = endpointProblem(url);
  if (!checked.ok) return { ok: false, status: "incompatible", error: checked.error };
  const parsed = new URL(checked.url);
  if (!isLocalHostname(parsed.hostname)) {
    const pin = await resolveAndPinMcpHostname(parsed.hostname, deps.lookup);
    if (!pin.ok) return { ok: false, status: "error", error: `${pin.error} Nothing was called.` };
    if (!deps.fetch) {
      try {
        const response = await pinnedHttpFetch(parsed, pin.pinnedAddress, pin.hostname, { ...init, redirect: "manual" });
        if (response.status === 401 || response.status === 403) return { ok: false, status: "unauthorized", error: `The server returned ${response.status}. Nothing was accepted.` };
        if (response.status >= 300 && response.status < 400) return { ok: false, status: "error", error: "Redirects are not followed. Nothing was called." };
        if (!response.ok) return { ok: false, status: "error", error: `The server returned ${response.status}. Nothing was called.` };
        const text = redact(await response.text(), token).slice(0, 8000);
        return { ok: true, status: response.status, text };
      } catch {
        return { ok: false, status: "error", error: "The server could not be reached." };
      }
    }
  }
  const fetchImpl = deps.fetch ?? (globalThis.fetch as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(checked.url, { ...init, redirect: "manual" });
  } catch {
    return { ok: false, status: "error", error: "The server could not be reached." };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, status: "unauthorized", error: `The server returned ${response.status}. Nothing was accepted.` };
  if (response.status >= 300 && response.status < 400) return { ok: false, status: "error", error: "Redirects are not followed. Nothing was called." };
  if (!response.ok) return { ok: false, status: "error", error: `The server returned ${response.status}. Nothing was called.` };
  const text = redact(await response.text(), token).slice(0, 8000);
  return { ok: true, status: response.status, text };
}

function rpcEnvelope(text: string, token: string): { result?: unknown; error?: string } {
  const chunks = text.includes("data:") ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()) : [text.trim()];
  for (const chunk of chunks) {
    if (!chunk || chunk === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) return { error: privacyErrorText(parsed.error.message || "The MCP server returned an error.", token) };
      if ("result" in parsed) return { result: parsed.result };
    } catch {
      /* ignore non-json */
    }
  }
  return { error: "The MCP server did not return a JSON-RPC result." };
}

function rpcFromResult(result: unknown, token: string): McpCallRpc {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (!("content" in record) && !("isError" in record) && !("structuredContent" in record)) return null;
  const content = Array.isArray(record.content)
    ? record.content.filter((part) => part && typeof part === "object").slice(0, 20).map((part) => {
        const copy = { ...(part as McpContentPart) };
        if (typeof copy.text === "string") copy.text = redact(copy.text, token).slice(0, 8000);
        return copy;
      })
    : [];
  return {
    isError: record.isError === true,
    content,
    structuredContent: "structuredContent" in record ? record.structuredContent ?? null : null,
  };
}

function operationFromTool(tool: { name?: unknown; description?: unknown; inputSchema?: unknown }): PublicOperation | null {
  if (typeof tool.name !== "string" || !tool.name.trim() || tool.name.toLowerCase() === "model.generate") return null;
  const schema = readOperationSchema(tool.inputSchema);
  return {
    name: tool.name.slice(0, 80),
    description: typeof tool.description === "string" ? tool.description.slice(0, 180) : "",
    inputSchema: schema,
    compatible: Boolean(schema),
  };
}

async function writeRow(db: ConnectionDb | null, userId: string, row: RegistryRecord): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadRegistry(userId, db);
  const servers = loaded.servers.filter((server) => server.id !== row.id);
  servers.push(row);
  const saved = await saveRegistry(userId, servers, db);
  return saved.ok ? { ok: true } : { ok: false, error: saved.error };
}

export async function saveCustomConnection(db: ConnectionDb | null, userId: string, input: {
  label: string;
  kind: "mcp" | "http";
  url: string;
  method?: "GET" | "POST";
  auth?: "none" | "bearer";
  token?: string;
  fields?: string[];
}, deps: { fetch?: FetchLike; lookup?: DnsLookupFn } = {}): Promise<{ ok: true; connection: PublicConnection } | { ok: false; error: string; code?: "missing_config" }> {
  const checked = endpointProblem(input.url);
  if (!checked.ok) return checked;
  const label = input.label.trim().slice(0, 80) || checked.host;
  const auth = input.auth === "bearer" ? "bearer" : "none";
  const token = (input.token ?? "").slice(0, 500);
  if (auth === "bearer" && !token) return { ok: false, code: "missing_config", error: "Bearer auth needs a token stored on the server. Nothing was saved." };
  const method = input.kind === "http" ? (input.method === "POST" ? "POST" : "GET") : "MCP";
  const fields = (input.fields ?? []).map((field) => field.trim()).filter((field) => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(field)).slice(0, 12);
  const httpSchema: OperationSchema = {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" as const }])),
    required: fields,
  };
  const row: RegistryRecord = {
    id: randomUUID(),
    label,
    kind: "http",
    enabled: true,
    url: checked.url,
    protocol: input.kind === "http" ? "http" : "mcp",
    httpMethod: method === "POST" ? "POST" : method === "GET" ? "GET" : undefined,
    token: token || undefined,
    state: "unchecked",
    error: "",
    operations: input.kind === "http" ? [{ name: "request", description: `${method} ${checked.host}`, inputSchema: httpSchema, compatible: true }] : [],
  };
  const saved = await writeRow(db, userId, row);
  if (!saved.ok) return { ok: false, code: "missing_config", error: saved.error };
  if (input.kind === "mcp") return { ok: true, connection: await refreshMcp(db, userId, row.id, deps) };
  row.state = "ready";
  await writeRow(db, userId, row);
  const listed = await listCustomConnections(db, userId);
  return { ok: true, connection: listed.find((item) => item.id === row.id) ?? toPublic({ ...row, token: undefined, tokenEnc: token ? "sealed" : undefined })! };
}

async function refreshMcp(db: ConnectionDb | null, userId: string, id: string, deps: { fetch?: FetchLike; lookup?: DnsLookupFn }): Promise<PublicConnection> {
  const loaded = await loadRegistry(userId, db);
  const row = loaded.servers.find((item) => item.id === id);
  if (!row?.url) return { id, label: "", kind: "mcp", host: "", method: "MCP", auth: "none", hasToken: false, state: "failed", operations: [], error: "That connection is not saved." };
  const fail = async (state: ConnectionState, error: string) => {
    row.state = state;
    row.operations = [];
    row.error = error;
    await writeRow(db, userId, row);
    return toPublic(row)!;
  };
  const opened = await send(row.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } } }),
  }, deps, row.token ?? "");
  if (!opened.ok) return fail(opened.status === "unauthorized" ? "unauthorized" : "failed", opened.error);
  const listed = await send(row.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }, deps, row.token ?? "");
  if (!listed.ok) return fail(listed.status === "unauthorized" ? "unauthorized" : "failed", listed.error);
  const parsed = rpcEnvelope(listed.text, row.token ?? "");
  const tools = parsed.result && typeof parsed.result === "object" && Array.isArray((parsed.result as { tools?: unknown }).tools)
    ? (parsed.result as { tools: { name?: unknown; description?: unknown; inputSchema?: unknown }[] }).tools
    : [];
  row.operations = tools.map(operationFromTool).filter((item): item is PublicOperation => Boolean(item));
  row.state = row.operations.some((item) => item.compatible) ? "ready" : "incompatible";
  row.error = row.state === "incompatible" ? "No tool advertised an object argument schema. A generic text argument was not assumed." : "";
  await writeRow(db, userId, row);
  return toPublic(row)!;
}

export async function callCustomConnection(input: {
  userId: string;
  db: ConnectionDb | null;
  id: string;
  operation: string;
  args?: Record<string, unknown>;
  confirmed?: boolean;
  fetch?: FetchLike;
  lookup?: DnsLookupFn;
}): Promise<{ ok: boolean; status: CallStatus; text: string; connection: PublicConnection | null; transport: McpCallTransport | null; rpc: McpCallRpc }> {
  const started = Date.now();
  const loaded = await loadRegistry(input.userId, input.db);
  const row = loaded.servers.find((item) => item.id === input.id);
  const connection = row ? toPublic(row) : null;
  if (!row || !connection) return { ok: false, status: "error", text: "That connection is not saved. Nothing was called.", connection: null, transport: null, rpc: null };
  if (input.operation.toLowerCase() === "model.generate") {
    return { ok: false, status: "incompatible", text: "model.generate is not a connectivity check. Nothing was called.", connection, transport: null, rpc: null };
  }
  const operation = connection.operations.find((item) => item.name === input.operation);
  if (!operation?.compatible || !operation.inputSchema) {
    return { ok: false, status: "incompatible", text: "This operation has no compatible argument schema. Nothing was called.", connection, transport: null, rpc: null };
  }
  if (connection.auth === "bearer" && !row.token) {
    return { ok: false, status: "missing_config", text: "Bearer auth is selected and no usable token is stored. Nothing was called.", connection, transport: null, rpc: null };
  }
  const mutating = connection.kind === "mcp" || connection.method === "POST";
  if (mutating && input.confirmed !== true) {
    return { ok: false, status: "error", text: "Confirm this call before it runs. Nothing was called.", connection, transport: null, rpc: null };
  }
  const checked = validateArgs(operation.inputSchema, input.args ?? {});
  if (!checked.ok) return { ok: false, status: "incompatible", text: checked.error, connection, transport: null, rpc: null };
  const headers: Record<string, string> = { accept: "application/json", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) };
  const token = row.token ?? "";
  if (connection.kind === "http" && connection.method === "GET") {
    const url = new URL(row.url ?? "");
    for (const [key, value] of Object.entries(checked.args)) url.searchParams.set(key, String(value));
    const sent = await send(url.toString(), { method: "GET", headers }, input, token);
    if (!sent.ok) return { ok: false, status: sent.status, text: sent.error, connection, transport: { ok: false, status: sent.status === "unauthorized" ? 401 : 0, ms: Date.now() - started }, rpc: null };
    return { ok: true, status: "ok", text: sent.text, connection, transport: { ok: true, status: sent.status, ms: Date.now() - started }, rpc: null };
  }
  if (connection.kind === "http") {
    const sent = await send(row.url ?? "", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(checked.args) }, input, token);
    if (!sent.ok) return { ok: false, status: sent.status, text: sent.error, connection, transport: { ok: false, status: sent.status === "unauthorized" ? 401 : 0, ms: Date.now() - started }, rpc: null };
    return { ok: true, status: "ok", text: sent.text, connection, transport: { ok: true, status: sent.status, ms: Date.now() - started }, rpc: null };
  }
  const opened = await send(row.url ?? "", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } } }),
  }, input, token);
  if (!opened.ok) return { ok: false, status: opened.status, text: opened.error, connection, transport: { ok: false, status: opened.status === "unauthorized" ? 401 : 0, ms: Date.now() - started }, rpc: null };
  const called = await send(row.url ?? "", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: operation.name, arguments: checked.args } }),
  }, input, token);
  if (!called.ok) return { ok: false, status: called.status, text: called.error, connection, transport: { ok: false, status: called.status === "unauthorized" ? 401 : 0, ms: Date.now() - started }, rpc: null };
  const parsed = rpcEnvelope(called.text, token);
  if (parsed.error) {
    return { ok: false, status: "error", text: parsed.error, connection, transport: { ok: true, status: called.status, ms: Date.now() - started }, rpc: { isError: true, content: [{ type: "text", text: parsed.error }], structuredContent: null } };
  }
  const rpc = rpcFromResult(parsed.result, token);
  const text = rpc?.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") ?? "";
  const hasPayload = Boolean(text) || Boolean(rpc && (rpc.content.length > 0 || rpc.structuredContent != null));
  const isError = Boolean(rpc?.isError);
  return {
    ok: !isError && hasPayload,
    status: isError || !hasPayload ? "error" : "ok",
    text: text || (hasPayload ? "" : "The MCP server returned no content. Nothing was invented."),
    connection,
    transport: { ok: true, status: called.status, ms: Date.now() - started },
    rpc,
  };
}
