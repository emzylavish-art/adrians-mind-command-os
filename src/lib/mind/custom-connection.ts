/**
 * Custom MCP and custom HTTP connections stored in the shared MCP registry.
 * Bearer tokens are sealed with CONNECTOR_TOKEN_SECRET before a database write.
 * model.generate is refused. Gmail OAuth is not started here.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  isLocalHostname,
  isPrivateAddressLiteral,
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./mcp/http-dns-pin.ts";
import { loadRegistry, saveRegistry, type RegistryDb, type RegistryRecord } from "./mcp/registry-store.ts";
import type { McpCallRpc, McpCallTransport } from "./mcp/call-contract.ts";
import { safeReason, mcpRpcFromResult } from "./mcp/call-contract.ts";
import { readCappedBody } from "./mcp/http-body.ts";

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
  definitionRevision?: string;
};

export type ConnectionState = "unchecked" | "ready" | "unauthorized" | "missing_config" | "incompatible" | "failed";

export type PublicConnection = {
  discoveryStatus?: CallStatus;
  enabled?: boolean;
  capabilityRevision?: string;
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

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

export function connectionCapabilityRevision(row: Pick<RegistryRecord, "id" | "url" | "enabled" | "operations">): string {
  return createHash("sha256").update(JSON.stringify(canonical([row.id, row.url, row.enabled, row.operations ?? []]))).digest("hex");
}

function toPublic(server: RegistryRecord): PublicConnection | null {
  if (!server.url || server.kind === "builtin" || server.kind === "command") return null;
  const kind = server.protocol === "http" ? "http" : "mcp";
  const operations = Array.isArray(server.operations) ? server.operations as PublicOperation[] : [];
  return {
    enabled: server.enabled,
    capabilityRevision: connectionCapabilityRevision(server),
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
  const fields = Object.entries(schema.properties);
  if (fields.length > 12) return null;
  for (const [key, raw] of fields) {
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
      if (value.length > 500) return { ok: false, error: `${key} exceeds 500 characters. Nothing was called.` };
      out[key] = value;
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

const HTTP_TIMEOUT_MS = 15_000;
const HTTP_MAX_BYTES = 1_000_000;

async function send(url: string, init: RequestInit, deps: { fetch?: FetchLike; lookup?: DnsLookupFn; timeoutMs?: number; maxBytes?: number }, token: string): Promise<{ ok: true; status: number; text: string; sessionId: string | null } | { ok: false; status: CallStatus; httpStatus: number; error: string }> {
  const checked = endpointProblem(url);
  if (!checked.ok) return { ok: false, status: "incompatible", httpStatus: 0, error: checked.error };
  const parsed = new URL(checked.url);
  const timeoutMs = deps.timeoutMs ?? HTTP_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? HTTP_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  const timed = { ...init, redirect: "manual" as const, signal: controller.signal };
  const fail = (status: CallStatus, error: string, httpStatus = 0) => ({ ok: false as const, status, httpStatus, error });
  const operation = async () => {
    let response: Awaited<ReturnType<FetchLike>>;
    if (!isLocalHostname(parsed.hostname)) {
      const pin = await resolveAndPinMcpHostname(parsed.hostname, deps.lookup);
      controller.signal.throwIfAborted();
      if (!pin.ok) return fail("error", `${pin.error} Nothing was called.`);
      response = deps.fetch
        ? await deps.fetch(checked.url, timed)
        : await pinnedHttpFetch(parsed, pin.pinnedAddress, pin.hostname, timed);
    } else {
      const fetchImpl = deps.fetch ?? (globalThis.fetch as FetchLike);
      response = await fetchImpl(checked.url, timed);
    }
    controller.signal.throwIfAborted();
    if (response.status === 401 || response.status === 403) return fail("unauthorized", `The server returned ${response.status}. Nothing was accepted.`, response.status);
    if (response.status >= 300 && response.status < 400) return fail("error", "Redirects are not followed. Nothing was called.", response.status);
    if (!response.ok) return fail("error", `The server returned ${response.status}. Nothing was called.`, response.status);
    const body = await readCappedBody(response, maxBytes);
    controller.signal.throwIfAborted();
    if (!body.ok) {
      controller.abort();
      return fail("error", `The response was larger than ${maxBytes} bytes and was dropped. Nothing was retried.`, response.status);
    }
    const text = redact(body.text, token);
    return { ok: true as const, status: response.status, text, sessionId: response.headers.get("mcp-session-id") };
  };
  try {
    return await Promise.race([operation(), deadline]);
  } catch {
    if (timedOut) return fail("timeout", "The server did not answer in time. Nothing was retried.");
    return fail("error", "The server could not be reached.");
  } finally {
    clearTimeout(timer);
    deadline.catch(() => undefined);
  }
}

function rpcEnvelope(text: string): { result?: unknown; error?: string } {
  const chunks = text.includes("data:") ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()) : [text.trim()];
  for (const chunk of chunks) {
    if (!chunk || chunk === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) return { error: parsed.error.message || "The MCP server returned an error." };
      if ("result" in parsed) return { result: parsed.result };
    } catch {
      /* ignore non-json */
    }
  }
  return { error: "The MCP server did not return a JSON-RPC result." };
}

function rpcFromResult(result: unknown, token: string): McpCallRpc {
  return mcpRpcFromResult(result, token);
}

function initialized(text: string): boolean {
  const envelope = rpcEnvelope(text);
  return !envelope.error && Boolean(envelope.result) && typeof envelope.result === "object" && !Array.isArray(envelope.result);
}

function operationFromTool(tool: { name?: unknown; description?: unknown; inputSchema?: unknown; annotations?: unknown }): PublicOperation | null {
  if (typeof tool.name !== "string" || !tool.name.trim() || tool.name.toLowerCase() === "model.generate") return null;
  if (tool.name.length > 80) return null;
  const schema = readOperationSchema(tool.inputSchema);
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description.slice(0, 180) : "",
    inputSchema: schema,
    compatible: Boolean(schema),
    definitionRevision: createHash("sha256").update(JSON.stringify(canonical({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }))).digest("hex"),
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

export async function refreshMcp(db: ConnectionDb | null, userId: string, id: string, deps: { fetch?: FetchLike; lookup?: DnsLookupFn; timeoutMs?: number; maxBytes?: number }): Promise<PublicConnection> {
  const loaded = await loadRegistry(userId, db);
  const row = loaded.servers.find((item) => item.id === id);
  if (!row?.url) return { id, label: "", kind: "mcp", host: "", method: "MCP", auth: "none", hasToken: false, state: "failed", operations: [], error: "That connection is not saved." };
  const expected = { url: row.url, tokenEnc: row.tokenEnc ?? null, operations: row.operations === undefined ? null : JSON.stringify(row.operations), state: row.state ?? null };
  const publish = async (next: RegistryRecord): Promise<PublicConnection> => {
    if (db) {
      // Discovery is a metadata update, never a replacement registration. The
      // exact saved credential, endpoint and prior definition must still exist.
      const updated = await db.query("UPDATE mind_mcp_registry SET record = record || $3::jsonb WHERE user_id=$1 AND id=$2 AND record->>'url'=$4 AND record->>'tokenEnc' IS NOT DISTINCT FROM $5 AND record->'operations' IS NOT DISTINCT FROM $6::jsonb AND record->>'state' IS NOT DISTINCT FROM $7 AND record->>'enabled'='true' AND record->>'deleted' IS DISTINCT FROM 'true' RETURNING id", [userId, id, JSON.stringify({ operations: next.operations, state: next.state, error: next.error }), expected.url, expected.tokenEnc, expected.operations, expected.state]);
      if (updated.length) return toPublic(next)!;
    } else {
      const current = (await loadRegistry(userId, db)).servers.find((item) => item.id === id);
      if (current?.enabled && current.url === expected.url && current.tokenEnc === row.tokenEnc && connectionCapabilityRevision(current) === connectionCapabilityRevision(row)) {
        await writeRow(db, userId, next);
        return toPublic(next)!;
      }
    }
    return { ...toPublic(row)!, state: "failed", error: "The connection changed or was removed during discovery. Refresh its current state. No saved change was overwritten.", operations: [] };
  };
  const fail = async (state: ConnectionState, error: string, discoveryStatus: CallStatus = "error") => {
    // Retain the last reviewed definition for recovery, but state is not ready.
    return { ...await publish({ ...row, state, error }), discoveryStatus };
  };
  const opened = await send(row.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } } }),
  }, deps, row.token ?? "");
  if (!opened.ok) return fail(opened.status === "unauthorized" ? "unauthorized" : "failed", opened.error, opened.status);
  if (!initialized(opened.text) && !opened.sessionId) return fail("failed", "The MCP initialize handshake failed. The connection is not connected.");
  const meta = rpcEnvelope(opened.text).result;
  const version = meta && typeof meta === "object" && typeof (meta as { protocolVersion?: unknown }).protocolVersion === "string"
    ? (meta as { protocolVersion: string }).protocolVersion : "2024-11-05";
  const protocolHeaders: Record<string, string> = {};
  if (opened.sessionId) {
    protocolHeaders["mcp-session-id"] = opened.sessionId;
    protocolHeaders["mcp-protocol-version"] = version;
  }
  if (opened.sessionId) {
    const notified = await send(row.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...protocolHeaders, ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }, deps, row.token ?? "");
    if (!notified.ok) return fail("failed", "The MCP initialized notification was not accepted.", notified.status);
  }
  const operations: PublicOperation[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const listed = await send(row.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...protocolHeaders, ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2 + cursors.size, method: "tools/list", params: cursor ? { cursor } : {} }),
    }, deps, row.token ?? "");
    if (!listed.ok) return fail(listed.status === "unauthorized" ? "unauthorized" : "failed", listed.error, listed.status);
    const data = rpcEnvelope(listed.text).result as { tools?: Parameters<typeof operationFromTool>[0][]; nextCursor?: unknown } | undefined;
    if (!Array.isArray(data?.tools)) return fail("failed", "Tool discovery returned an unreadable page.");
    operations.push(...data.tools.map(operationFromTool).filter((item): item is PublicOperation => Boolean(item)));
    cursor = typeof data.nextCursor === "string" ? data.nextCursor : undefined;
    if (operations.length > 256 || (cursor && (cursors.has(cursor) || cursors.size >= 15))) return fail("failed", "Tool discovery was incomplete. Check the server and test again.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const state = operations.some((item) => item.compatible) ? "ready" : "incompatible";
  return publish({ ...row, operations, state, error: state === "incompatible" ? "No tool advertised an object argument schema. A generic text argument was not assumed." : "" });
}

export async function callCustomConnection(input: {
  userId: string;
  db: ConnectionDb | null;
  id: string;
  operation: string;
  args?: Record<string, unknown>;
  confirmed?: boolean;
  expectedRevision?: string;
  fetch?: FetchLike;
  lookup?: DnsLookupFn;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<{ ok: boolean; status: CallStatus; text: string; connection: PublicConnection | null; transport: McpCallTransport | null; rpc: McpCallRpc }> {
  const started = Date.now();
  const loaded = await loadRegistry(input.userId, input.db);
  const row = loaded.servers.find((item) => item.id === input.id);
  const connection = row ? toPublic(row) : null;
  if (!row || !connection) return { ok: false, status: "error", text: "That connection is not saved. Nothing was called.", connection: null, transport: null, rpc: null };
  if (!row.enabled) return { ok: false, status: "error", text: "This connection is disabled.", connection, transport: null, rpc: null };
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
  if (input.expectedRevision && input.expectedRevision !== connection.capabilityRevision) {
    return { ok: false, status: "incompatible", text: "This connection or its tool definitions changed. Refresh and review the call again. Nothing was called.", connection, transport: null, rpc: null };
  }
  if (connection.kind === "mcp") {
    const fresh = await refreshMcp(input.db, input.userId, row.id, input);
    if (fresh.state !== "ready" || fresh.capabilityRevision !== connection.capabilityRevision) {
      return { ok: false, status: fresh.discoveryStatus === "timeout" ? "timeout" : fresh.state === "unauthorized" ? "unauthorized" : "incompatible", text: fresh.error || "The available tool definition changed. Review the refreshed arguments and confirm again. Nothing was called.", connection: fresh, transport: null, rpc: null };
    }
    const latest = (await loadRegistry(input.userId, input.db)).servers.find((item) => item.id === row.id);
    if (!latest?.enabled || latest.url !== row.url || latest.token !== row.token || connectionCapabilityRevision(latest) !== fresh.capabilityRevision) {
      return { ok: false, status: "error", text: "The connection changed while checking its tools. Review it again. Nothing was called.", connection: latest ? toPublic(latest) : null, transport: null, rpc: null };
    }
    row.tokenEnc = latest.tokenEnc;
  }
  const headers: Record<string, string> = { accept: "application/json", ...(row.token ? { authorization: `Bearer ${row.token}` } : {}) };
  const token = row.token ?? "";
  async function recordAccess(state: "ready" | "unauthorized", error: string) {
    if (!row || row.state === state) return;
    if (input.db) {
      await input.db.query(
        "UPDATE mind_mcp_registry SET record = record || $3::jsonb WHERE user_id=$1 AND id=$2 AND record->>'url'=$4 AND record->>'tokenEnc' IS NOT DISTINCT FROM $5 AND record->>'state' IS NOT DISTINCT FROM $6",
        [input.userId, row.id, JSON.stringify({ state, error }), row.url, row.tokenEnc ?? null, row.state ?? null],
      );
    } else {
      await writeRow(input.db, input.userId, { ...row, state, error });
    }
    if (connection) { connection.state = state; connection.error = error; }
  }
  async function reportTransportFailure(response: Extract<Awaited<ReturnType<typeof send>>, { ok: false }>) {
    if (response.status === "unauthorized") await recordAccess("unauthorized", response.error);
    return { ok: false, status: response.status, text: response.error, connection, transport: { ok: false, status: response.httpStatus, ms: Date.now() - started }, rpc: null };
  }
  if (connection.kind === "http" && connection.method === "GET") {
    const url = new URL(row.url ?? "");
    for (const [key, value] of Object.entries(checked.args)) url.searchParams.set(key, String(value));
    const sent = await send(url.toString(), { method: "GET", headers }, input, token);
    if (!sent.ok) return reportTransportFailure(sent);
    await recordAccess("ready", "");
    return { ok: true, status: "ok", text: sent.text.slice(0, 8000), connection, transport: { ok: true, status: sent.status, ms: Date.now() - started }, rpc: null };
  }
  if (connection.kind === "http") {
    const sent = await send(row.url ?? "", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(checked.args) }, input, token);
    if (!sent.ok) return reportTransportFailure(sent);
    await recordAccess("ready", "");
    return { ok: true, status: "ok", text: sent.text.slice(0, 8000), connection, transport: { ok: true, status: sent.status, ms: Date.now() - started }, rpc: null };
  }
  const opened = await send(row.url ?? "", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } } }),
  }, input, token);
  if (!opened.ok) return reportTransportFailure(opened);
  if (!initialized(opened.text)) return { ok: false, status: "error", text: safeReason("error"), connection, transport: { ok: true, status: opened.status, ms: Date.now() - started }, rpc: { isError: true, content: [{ type: "text", text: safeReason("error") }], structuredContent: null } };
  const reply = rpcEnvelope(opened.text).result;
  const version = reply && typeof reply === "object" && typeof (reply as { protocolVersion?: unknown }).protocolVersion === "string"
    ? (reply as { protocolVersion: string }).protocolVersion : "2024-11-05";
  const protocolHeaders: Record<string, string> = opened.sessionId ? { "mcp-session-id": opened.sessionId, "mcp-protocol-version": version } : {};
  if (opened.sessionId) {
    const ready = await send(row.url ?? "", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", ...protocolHeaders },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }, input, token);
    if (!ready.ok) return reportTransportFailure(ready);
  }
  const called = await send(row.url ?? "", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream", ...protocolHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: operation.name, arguments: checked.args } }),
  }, input, token);
  if (!called.ok) return reportTransportFailure(called);
  const parsed = rpcEnvelope(called.text);
  if (parsed.error) {
    const reason = safeReason("error");
    return {
      ok: false,
      status: "error",
      text: reason,
      connection,
      transport: { ok: true, status: called.status, ms: Date.now() - started },
      rpc: { isError: true, content: [{ type: "text", text: reason }], structuredContent: null },
    };
  }
  await recordAccess("ready", "");
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
