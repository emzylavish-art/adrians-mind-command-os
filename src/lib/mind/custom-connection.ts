/**
 * Custom MCP (JSON-RPC over HTTP) and custom HTTP read/status connections.
 * Tokens stay in the per-user server file. Public records expose schemas only.
 * Gmail OAuth is not started here. model.generate is refused.
 */
import { randomUUID } from "node:crypto";
import {
  isLocalHostname,
  isPrivateAddressLiteral,
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./mcp/http-dns-pin.ts";

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

export type ConnectionDb = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type Stored = PublicConnection & { url: string; token: string; ownerId: string };

async function readAll(db: ConnectionDb, userId: string): Promise<Stored[]> {
  const rows = await db.query<{ record: Stored | string }>(
    "select record from mind_custom_connection where user_id = $1",
    [userId],
  );
  const out: Stored[] = [];
  for (const row of rows) {
    const record = typeof row.record === "string" ? JSON.parse(row.record) as Stored : row.record;
    if (record?.ownerId === userId) out.push(record);
  }
  return out;
}

async function upsert(db: ConnectionDb, userId: string, row: Stored) {
  await db.query(
    "insert into mind_custom_connection (user_id, id, record) values ($1, $2, $3::jsonb) on conflict (user_id, id) do update set record = excluded.record",
    [userId, row.id, JSON.stringify(row)],
  );
}
type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

function toPublic(row: Stored): PublicConnection {
  const { url: _url, token: _token, ownerId: _owner, ...rest } = row;
  return { ...rest, hasToken: Boolean(row.token) };
}

export async function listCustomConnections(db: ConnectionDb, userId: string): Promise<PublicConnection[]> {
  return (await readAll(db, userId)).map(toPublic);
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

function rpcResult(text: string, token: string): { result?: unknown; error?: string } {
  const chunks = text.includes("data:") ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()) : [text.trim()];
  for (const chunk of chunks) {
    if (!chunk || chunk === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) return { error: redact(parsed.error.message || "The MCP server returned an error.", token) };
      if ("result" in parsed) return { result: parsed.result };
    } catch {
      /* ignore non-json */
    }
  }
  return { error: "The MCP server did not return a JSON-RPC result." };
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

export async function saveCustomConnection(db: ConnectionDb, userId: string, input: {
  label: string;
  kind: "mcp" | "http";
  url: string;
  method?: "GET" | "POST";
  auth?: "none" | "bearer";
  token?: string;
  fields?: string[];
}, deps: { fetch?: FetchLike; lookup?: DnsLookupFn } = {}): Promise<{ ok: true; connection: PublicConnection } | { ok: false; error: string }> {
  const checked = endpointProblem(input.url);
  if (!checked.ok) return checked;
  const label = input.label.trim().slice(0, 80) || checked.host;
  const auth = input.auth === "bearer" ? "bearer" : "none";
  const token = (input.token ?? "").slice(0, 500);
  if (auth === "bearer" && !token) return { ok: false, error: "Bearer auth needs a token stored on the server. Nothing was saved." };
  const method = input.kind === "http" ? (input.method === "POST" ? "POST" : "GET") : "MCP";
  const fields = (input.fields ?? []).map((field) => field.trim()).filter((field) => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(field)).slice(0, 12);
  const httpSchema: OperationSchema = {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" as const }])),
    required: fields,
  };
  const row: Stored = {
    id: randomUUID(),
    label,
    kind: input.kind,
    host: checked.host,
    url: checked.url,
    method,
    auth,
    token,
    hasToken: Boolean(token),
    ownerId: userId,
    state: "unchecked",
    operations: input.kind === "http" ? [{ name: "request", description: `${method} ${checked.host}`, inputSchema: httpSchema, compatible: true }] : [],
    error: "",
  };
  await upsert(db, userId, row);
  if (input.kind === "mcp") return { ok: true, connection: await refreshMcp(db, userId, row.id, deps) };
  row.state = "ready";
  await upsert(db, userId, row);
  return { ok: true, connection: toPublic(row) };
}

async function refreshMcp(db: ConnectionDb, userId: string, id: string, deps: { fetch?: FetchLike; lookup?: DnsLookupFn }): Promise<PublicConnection> {
  const connections = await readAll(db, userId);
  const row = connections.find((item) => item.id === id);
  if (!row) return { id, label: "", kind: "mcp", host: "", method: "MCP", auth: "none", hasToken: false, state: "failed", operations: [], error: "That connection is not saved." };
  const opened = await send(row.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } } }),
  }, deps, row.token);
  if (!opened.ok) {
    row.state = opened.status === "unauthorized" ? "unauthorized" : "failed";
    row.operations = [];
    row.error = opened.error;
    await upsert(db, userId, row);
    return toPublic(row);
  }
  const listed = await send(row.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }, deps, row.token);
  if (!listed.ok) {
    row.state = listed.status === "unauthorized" ? "unauthorized" : "failed";
    row.operations = [];
    row.error = listed.error;
    await upsert(db, userId, row);
    return toPublic(row);
  }
  const parsed = rpcResult(listed.text, row.token);
  const tools = parsed.result && typeof parsed.result === "object" && Array.isArray((parsed.result as { tools?: unknown }).tools)
    ? (parsed.result as { tools: { name?: unknown; description?: unknown; inputSchema?: unknown }[] }).tools
    : [];
  row.operations = tools.map(operationFromTool).filter((item): item is PublicOperation => Boolean(item));
  row.state = row.operations.some((item) => item.compatible) ? "ready" : "incompatible";
  row.error = row.state === "incompatible" ? "No tool advertised an object argument schema. A generic text argument was not assumed." : "";
  await upsert(db, userId, row);
  return toPublic(row);
}

export async function callCustomConnection(input: {
  userId: string;
  db: ConnectionDb;
  id: string;
  operation: string;
  args?: Record<string, unknown>;
  confirmed?: boolean;
  fetch?: FetchLike;
  lookup?: DnsLookupFn;
}): Promise<{ ok: boolean; status: CallStatus; text: string; connection: PublicConnection | null }> {
  const connections = await readAll(input.db, input.userId);
  const row = connections.find((item) => item.id === input.id);
  if (!row) return { ok: false, status: "error", text: "That connection is not saved. Nothing was called.", connection: null };
  if (input.operation.toLowerCase() === "model.generate") {
    return { ok: false, status: "incompatible", text: "model.generate is not a connectivity check. Nothing was called.", connection: toPublic(row) };
  }
  const operation = row.operations.find((item) => item.name === input.operation);
  if (!operation?.compatible || !operation.inputSchema) {
    return { ok: false, status: "incompatible", text: "This operation has no compatible argument schema. Nothing was called.", connection: toPublic(row) };
  }
  if (row.auth === "bearer" && !row.token) {
    return { ok: false, status: "missing_config", text: "Bearer auth is selected and no token is stored. Nothing was called.", connection: toPublic(row) };
  }
  const mutating = row.kind === "mcp" || row.method === "POST";
  if (mutating && input.confirmed !== true) {
    return { ok: false, status: "error", text: "Confirm this call before it runs. Nothing was called.", connection: toPublic(row) };
  }
  const checked = validateArgs(operation.inputSchema, input.args ?? {});
  if (!checked.ok) return { ok: false, status: "incompatible", text: checked.error, connection: toPublic(row) };
  const headers: Record<string, string> = { accept: "application/json", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) };
  if (row.kind === "http" && row.method === "GET") {
    const url = new URL(row.url);
    for (const [key, value] of Object.entries(checked.args)) url.searchParams.set(key, String(value));
    const sent = await send(url.toString(), { method: "GET", headers }, input, row.token);
    if (!sent.ok) return { ok: false, status: sent.status, text: sent.error, connection: toPublic(row) };
    return { ok: true, status: "ok", text: sent.text, connection: toPublic(row) };
  }
  if (row.kind === "http") {
    const sent = await send(row.url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(checked.args) }, input, row.token);
    if (!sent.ok) return { ok: false, status: sent.status, text: sent.error, connection: toPublic(row) };
    return { ok: true, status: "ok", text: sent.text, connection: toPublic(row) };
  }
  const opened = await send(row.url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } } }),
  }, input, row.token);
  if (!opened.ok) return { ok: false, status: opened.status, text: opened.error, connection: toPublic(row) };
  const called = await send(row.url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: operation.name, arguments: checked.args } }),
  }, input, row.token);
  if (!called.ok) return { ok: false, status: called.status, text: called.error, connection: toPublic(row) };
  const parsed = rpcResult(called.text, row.token);
  if (parsed.error) return { ok: false, status: "error", text: parsed.error, connection: toPublic(row) };
  const content = parsed.result && typeof parsed.result === "object" && Array.isArray((parsed.result as { content?: unknown }).content)
    ? (parsed.result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("\n")
    : "";
  const isError = Boolean(parsed.result && typeof parsed.result === "object" && (parsed.result as { isError?: boolean }).isError);
  return {
    ok: !isError && Boolean(content),
    status: isError || !content ? "error" : "ok",
    text: redact(content || "The MCP server returned no text. Nothing was invented.", row.token),
    connection: toPublic(row),
  };
}
