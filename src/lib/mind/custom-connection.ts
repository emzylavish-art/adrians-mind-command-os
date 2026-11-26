/**
 * Custom MCP and custom HTTP connections stored in the shared MCP registry.
 * Bearer tokens are sealed with CONNECTOR_TOKEN_SECRET before a database write.
 * model.generate is refused. Gmail OAuth is not started here.
 */
import { createHash, randomUUID } from "node:crypto";
import { haltIsOn } from "./halt.server.ts";
import { connectionRevision, toolDefinitionFingerprint } from "./mcp/approval-snapshot.ts";
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

export type OperationProperty = {
  type: ArgType;
  description?: string;
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};
export type OperationSchema = {
  type: "object";
  properties: Record<string, OperationProperty>;
  required: string[];
};

export type PublicOperation = {
  name: string;
  description: string;
  inputSchema: OperationSchema | null;
  compatible: boolean;
  /** Full advertised definition, including constraints not represented in the form. */
  definitionFingerprint?: string;
  annotations?: { readOnlyHint?: boolean };
  revision?: string;
  definitionRevision?: string;
};

export type ConnectionState = "unchecked" | "ready" | "unauthorized" | "missing_config" | "incompatible" | "failed";

export type PublicConnection = {
  revision?: string;
  enabled?: boolean;
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
  discoveryStatus?: CallStatus;
  capabilityRevision?: string;
};

export type CallStatus = "ok" | "error" | "unauthorized" | "missing_config" | "incompatible" | "definition_changed" | "timeout";

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
  const needsDiscovery = kind === "mcp" && operations.some((operation) => operation.compatible && !operation.definitionFingerprint);
  return {
    enabled: server.enabled,
    revision: connectionRevision(server),
    id: server.id,
    label: server.label,
    kind,
    host: hostOf(server.url),
    method: kind === "http" ? (server.httpMethod === "POST" ? "POST" : "GET") : "MCP",
    auth: server.token || server.tokenEnc ? "bearer" : "none",
    hasToken: Boolean(server.token || server.tokenEnc),
    state: needsDiscovery ? "unchecked" : (server.state as ConnectionState) || "unchecked",
    operations,
    error: server.secretUnreadable ? "The saved credential cannot be decrypted. Nothing was called." : needsDiscovery ? "Refresh tools to review the current full definitions before calling this connection." : server.error ?? "",
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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical((key === "required" || key === "enum") && Array.isArray(value) ? [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function connectionCapabilityRevision(row: Pick<RegistryRecord, "id" | "url" | "enabled" | "operations">): string {
  return createHash("sha256").update(JSON.stringify(canonical([row.id, row.url, row.enabled, row.operations ?? []]))).digest("hex");
}

export function operationRevision(operation: Pick<PublicOperation, "name" | "description" | "inputSchema">): string {
  return createHash("sha256").update(canonical({ name: operation.name, description: operation.description, inputSchema: operation.inputSchema })).digest("hex");
}

/** Patterns outside this deliberately bounded, single-atom subset are incompatible. */
function supportedPattern(pattern: string): boolean {
  return pattern.length <= 160 && /^\^?(?:\[(?:\\.|[^\]\\])+\]|[A-Za-z0-9 _-])(?:[+*?]|\{[0-9]{1,3}(?:,[0-9]{0,3})?\})?\$?$/.test(pattern);
}

export function readOperationSchema(input: unknown): OperationSchema | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const schema = input as Record<string, unknown>;
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return null;
  const rootKeys = new Set(["type", "properties", "required", "additionalProperties", "description", "title", "$schema", "$id"]);
  if (Object.keys(schema).some((key) => !rootKeys.has(key)) || (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean")) return null;
  const properties: OperationSchema["properties"] = Object.create(null);
  const fields = Object.entries(schema.properties);
  if (fields.length > 12) return null;
  const keys = new Set(["type", "description", "title", "default", "examples", "enum", "minimum", "maximum", "minLength", "maxLength", "pattern"]);
  for (const [key, raw] of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const prop = raw as Record<string, unknown>;
    if (Object.keys(prop).some((key) => !keys.has(key))) return null;
    const type = prop.type;
    if (type !== "string" && type !== "boolean" && type !== "integer") return null;
    const spec: OperationProperty = { type };
    if (typeof prop.description === "string") spec.description = prop.description.slice(0, 160);
    if (prop.enum !== undefined) {
      if (!Array.isArray(prop.enum) || !prop.enum.length || prop.enum.length > 50 || prop.enum.some((value) => type === "integer" ? !Number.isSafeInteger(value) : typeof value !== type || (typeof value === "string" && value.length > 500))) return null;
      spec.enum = prop.enum as (string | number | boolean)[];
    }
    for (const bound of ["minimum", "maximum", "minLength", "maxLength"] as const) {
      if (prop[bound] === undefined) continue;
      const value = prop[bound];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      if (bound === "minimum" || bound === "maximum") { if (type !== "integer") return null; }
      else if (type !== "string" || !Number.isSafeInteger(value) || value < 0) return null;
      spec[bound] = value;
    }
    if ((spec.minimum !== undefined && spec.maximum !== undefined && spec.minimum > spec.maximum) || (spec.minLength !== undefined && spec.maxLength !== undefined && spec.minLength > spec.maxLength)) return null;
    if (prop.pattern !== undefined) {
      if (type !== "string" || typeof prop.pattern !== "string" || !supportedPattern(prop.pattern)) return null;
      try { new RegExp(prop.pattern, "u"); } catch { return null; }
      spec.pattern = prop.pattern;
    }
    properties[key] = spec;
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string" || !Object.hasOwn(properties, item)))) return null;
  const required = Array.isArray(schema.required) ? [...new Set(schema.required as string[])].sort() : [];
  return { type: "object", properties, required };
}

export function validateArgs(schema: OperationSchema, args: Record<string, unknown>): { ok: true; args: Record<string, string | number | boolean> } | { ok: false; error: string } {
  const unexpected = Object.keys(args).filter((key) => !Object.hasOwn(schema.properties, key));
  if (unexpected.length) return { ok: false, error: `Unexpected argument ${unexpected[0]}. Nothing was called.` };
  const out: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(schema.properties)) {
    const value = args[key];
    const fail = (detail: string) => ({ ok: false as const, error: `${key} ${detail}. Nothing was called.` });
    if (value == null) {
      if (schema.required.includes(key)) return { ok: false, error: `Missing ${key}. Nothing was called.` };
      continue;
    }
    if (spec.type === "string") {
      if (typeof value !== "string") return fail("must be a string");
      if ([...value].length > 500) return fail("exceeds 500 characters");
      if (spec.minLength !== undefined && [...value].length < spec.minLength) return fail(`needs at least ${spec.minLength} characters`);
      if (spec.maxLength !== undefined && [...value].length > spec.maxLength) return fail(`exceeds ${spec.maxLength} characters`);
      if (spec.pattern && !new RegExp(spec.pattern, "u").test(value)) return fail("does not match the advertised pattern");
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") return fail("must be boolean");
    } else {
      if (!Number.isSafeInteger(value)) return fail("must be an integer within the supported range");
      if (spec.minimum !== undefined && (value as number) < spec.minimum) return fail(`must be at least ${spec.minimum}`);
      if (spec.maximum !== undefined && (value as number) > spec.maximum) return fail(`must be at most ${spec.maximum}`);
    }
    if (spec.enum && !spec.enum.includes(value as string | number | boolean)) return fail("must be one of the advertised choices");
    out[key] = value as string | number | boolean;
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

function operationFromTool(tool: { name?: unknown; description?: unknown; inputSchema?: unknown; annotations?: { readOnlyHint?: unknown } }): PublicOperation | null {
  if (typeof tool.name !== "string" || !tool.name.trim() || tool.name.toLowerCase() === "model.generate") return null;
  if (tool.name.length > 80) return null;
  const schema = readOperationSchema(tool.inputSchema);
  return {
    name: tool.name,
    definitionFingerprint: toolDefinitionFingerprint(tool),
    description: typeof tool.description === "string" ? tool.description.slice(0, 180) : "",
    inputSchema: schema,
    ...(typeof tool.annotations?.readOnlyHint === "boolean" ? { annotations: { readOnlyHint: tool.annotations.readOnlyHint } } : {}),
    compatible: Boolean(schema),
    revision: createHash("sha256").update(canonical(tool)).digest("hex"),
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

async function publishDiscovery(db: ConnectionDb | null, owner: string, previous: RegistryRecord, next: RegistryRecord): Promise<boolean> {
  if (db) {
    const changed = await db.query("UPDATE mind_mcp_registry SET record = record || $3::jsonb WHERE user_id=$1 AND id=$2 AND record->>'url'=$4 AND record->>'tokenEnc' IS NOT DISTINCT FROM $5 AND record->'operations' IS NOT DISTINCT FROM $6::jsonb AND record->>'state' IS NOT DISTINCT FROM $7 AND record->>'enabled'='true' AND record->>'deleted' IS DISTINCT FROM 'true' RETURNING id",
      [owner, previous.id, JSON.stringify({ operations: next.operations, state: next.state, error: next.error }), previous.url, previous.tokenEnc ?? null, previous.operations === undefined ? null : JSON.stringify(previous.operations), previous.state ?? null]);
    return changed.length === 1;
  }
  const latest = (await loadRegistry(owner, db)).servers.find(item => item.id === previous.id);
  if (!latest?.enabled || connectionRevision(latest) !== connectionRevision(previous)) return false;
  return (await writeRow(db, owner, { ...latest, operations: next.operations, state: next.state, error: next.error })).ok;
}

export async function refreshMcp(db: ConnectionDb | null, userId: string, id: string, deps: { fetch?: FetchLike; lookup?: DnsLookupFn }): Promise<PublicConnection> {
  const loaded = await loadRegistry(userId, db);
  const row = loaded.servers.find((item) => item.id === id);
  if (!row?.url) return { id, label: "", kind: "mcp", host: "", method: "MCP", auth: "none", hasToken: false, state: "failed", operations: [], error: "That connection is not saved." };
  if (!row.enabled) return { ...toPublic(row)!, error: "This connection is disabled. No tools were refreshed." };
  const publish = async (next: RegistryRecord, discoveryStatus?: CallStatus) => await publishDiscovery(db, userId, row, next) ? { ...toPublic(next)!, ...(discoveryStatus ? { discoveryStatus } : {}) }
    : { ...toPublic(row)!, state: "failed" as const, operations: [], error: "The connection changed during discovery. Refresh its current state." };
  const fail = (state: ConnectionState, error: string, status?: CallStatus) => publish({ ...row, state, error }, status);
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
    if (!notified.ok) return fail("failed", notified.error, notified.status);
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
  const state = operations.some(item => item.compatible) ? "ready" : "incompatible";
  return publish({ ...row, operations, state, error: state === "incompatible" ? "No tool has a supported argument schema. Nothing was called." : "" });
}

export async function callCustomConnection(input: {
  userId: string;
  db: ConnectionDb | null;
  id: string;
  operation: string;
  args?: Record<string, unknown>;
  confirmed?: boolean;
  expectedRevision?: string;
  reviewedRevision?: string;
  isHalted?: (userId: string) => boolean | Promise<boolean>;
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
  const revision = connectionRevision(row);
  const stale = () => ({ ok: false, status: "incompatible" as const, text: "The connection or tool definition changed. Review the current connection and approve again. Nothing was called.", connection, transport: null, rpc: null });
  if (input.expectedRevision && input.expectedRevision !== revision) return stale();
  async function stillReviewed() {
    try {
      const latest = (await loadRegistry(input.userId, input.db)).servers.find((item) => item.id === input.id);
      return Boolean(latest?.enabled && connectionRevision(latest) === revision && !(input.isHalted && await input.isHalted(input.userId)));
    } catch { return false; }
  }

  if (input.operation.toLowerCase() === "model.generate") {
    return { ok: false, status: "incompatible", text: "model.generate is not a connectivity check. Nothing was called.", connection, transport: null, rpc: null };
  }
  const operation = connection.operations.find((item) => item.name === input.operation);
  if (input.reviewedRevision && input.reviewedRevision !== operation?.revision) return stale();
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
    if (!await stillReviewed()) return stale();
    const url = new URL(row.url ?? "");
    for (const [key, value] of Object.entries(checked.args)) url.searchParams.set(key, String(value));
    const sent = await send(url.toString(), { method: "GET", headers }, input, token);
    if (!sent.ok) return reportTransportFailure(sent);
    await recordAccess("ready", "");
    return { ok: true, status: "ok", text: sent.text.slice(0, 8000), connection, transport: { ok: true, status: sent.status, ms: Date.now() - started }, rpc: null };
  }
  if (connection.kind === "http") {
    if (!await stillReviewed()) return stale();
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
  // Recheck the advertised definition in this exact session before a consequential call.
  const cursors = new Set<string>();
  let cursor: string | undefined;
  const refreshed: PublicOperation[] = [];
  let currentOperation: PublicOperation | null = null;
  do {
    const listed = await send(row.url ?? "", {
      method: "POST", headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream", ...protocolHeaders },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10 + cursors.size, method: "tools/list", params: cursor ? { cursor } : {} }),
    }, input, token);
    if (!listed.ok) return reportTransportFailure(listed);
    const catalogue = rpcEnvelope(listed.text).result as { tools?: Parameters<typeof operationFromTool>[0][]; nextCursor?: unknown } | undefined;
    if (!Array.isArray(catalogue?.tools)) return stale();
    for (const tool of catalogue.tools) {
      const candidate = operationFromTool(tool);
      if (candidate) refreshed.push(candidate);
      if (refreshed.length > 256) return stale();
      if (candidate?.name === operation.name) {
        if (currentOperation) return stale(); // ambiguous duplicate names are not executable
        currentOperation = candidate;
      }
    }
    cursor = typeof catalogue.nextCursor === "string" ? catalogue.nextCursor : undefined;
    if (cursor && (cursors.has(cursor) || cursors.size >= 15)) return stale();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  // Legacy catalogues have no full-definition fingerprint and need rediscovery first.
  if (!operation.definitionFingerprint || currentOperation?.definitionFingerprint !== operation.definitionFingerprint) {
    const next = { ...row, operations: refreshed, state: refreshed.some(item => item.compatible) ? "ready" : "incompatible", error: "" };
    const published = await publishDiscovery(input.db, input.userId, row, next);
    return { ...stale(), status: "definition_changed", connection: published ? toPublic(next) : null };
  }
  try {
    if (await (input.isHalted ?? haltIsOn)(input.userId)) return { ...stale(), status: "error", text: "Emergency stop is on. No MCP tool was called." };
  } catch { return { ...stale(), status: "error", text: "Emergency stop could not be verified. No MCP tool was called." }; }
  if (!await stillReviewed()) return stale();
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
