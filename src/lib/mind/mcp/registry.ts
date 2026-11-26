import { randomUUID } from "node:crypto";
import {
  BUILTIN_TOOL_DEFS,
  notionAppendSection,
  notionReadPage,
  pcRunShell,
  pgliteListSchema,
  pgliteQuery,
  type BuiltinToolName,
  type SqlLike,
  type ToolResult,
} from "./tools.ts";
import { isBlockedChildEnvKey } from "./stdio-policy.ts";
import type { StdioOptions } from "./stdio.ts";
import {
  databaseConfigured,
  loadRegistry,
  registryBuiltinId,
  saveRegistry,
  setMcpRegistryDirectory,
  type RegistryDb,
  type RegistryRecord,
} from "./registry-store.ts";
import { type McpCallRpc, type McpCallTransport, type McpResultCode, mcpRpcFromResult, safeReason } from "./call-contract.ts";
import {
  defaultDnsLookup,
  isLocalHostname,
  isPrivateAddressLiteral,
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./http-dns-pin.ts";
import { haltIsOn } from "../halt.server.ts";

export type McpServerKind = "builtin" | "http" | "command";

export type RegistryServer = {
  id: string;
  label: string;
  kind: McpServerKind;
  enabled: boolean;
  /** For kind=http */
  url?: string;
  /** For kind=command (stdio) — spawned only when enabled AND a list/call is requested */
  command?: string;
  args?: string[];
  /** Server-specific env for kind=command. The app's own env is never passed through (only PATH/HOME). Never returned to the client. */
  env?: Record<string, string>;
  /** Optional per-server timeouts for kind=command (ms). */
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  /** Opaque token for external HTTP MCP; never returned to the client */
  token?: string;
  builtin?: boolean;
  /** mcp is JSON-RPC. http is a single GET or POST. Absent means mcp. */
  protocol?: "mcp" | "http";
  httpMethod?: "GET" | "POST";
};

export type RegistryServerPublic = Omit<RegistryServer, "token" | "env"> & { hasToken: boolean; envKeys?: string[] };

export type ToolCallStatus = "running" | "ok" | "error" | "timeout";

export type RegistryToolCallResult = {
  status: ToolCallStatus;
  ok: boolean;
  serverId: string;
  tool: string;
  text: string;
  data?: Record<string, unknown> | Record<string, unknown>[] | string | number | boolean | null;
  /** Stable code. Absent on older in-process callers that only read ok/text. */
  code?: McpResultCode;
  /** HTTP transport. Null when the call never left the process (built-in, refused before fetch). */
  transport?: McpCallTransport | null;
  /** Upstream JSON-RPC tool result. Null when the server did not return one. */
  rpc?: McpCallRpc;
};

const BUILTIN_ID = registryBuiltinId();

export { setMcpRegistryDirectory, databaseConfigured };
export type { RegistryDb };

async function readServers(userId: string, db?: RegistryDb | null): Promise<RegistryRecord[]> {
  return (await loadRegistry(userId, db)).servers;
}

function toPublic(server: RegistryRecord): RegistryServerPublic {
  const { token: _token, env, tokenEnc: _tokenEnc, envEnc: _envEnc, secretUnreadable: _unread, operations: _operations, state: _state, error: _error, ...rest } = server;
  return {
    ...rest,
    hasToken: Boolean(server.token || server.tokenEnc || server.secretUnreadable),
    ...(env ? { envKeys: Object.keys(env) } : {}),
  };
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Sanitize a server-specific env map (bounded keys/values). */
export function sanitizeServerEnv(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 20)) {
    if (!ENV_KEY.test(key) || isBlockedChildEnvKey(key)) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    out[key] = String(value).slice(0, 1000);
  }
  return Object.keys(out).length ? out : undefined;
}

function timeoutField(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(300_000, Math.max(100, Math.floor(n)));
}

export type StdioDeps = {
  /** Options forwarded to the stdio runner (timeouts, caps). */
  stdio?: StdioOptions;
  /** Emergency-stop check. Defaults to the authoritative stop state. When halted, no stdio child is spawned. */
  isHalted?: (userId: string) => Promise<boolean> | boolean;
};

function stdioConfig(server: RegistryServer) {
  return {
    id: server.id,
    label: server.label,
    command: server.command ?? "",
    args: server.args ?? [],
    env: server.env,
    connectTimeoutMs: server.connectTimeoutMs,
    callTimeoutMs: server.callTimeoutMs,
  };
}

export async function listRegistryServers(userId: string, db?: RegistryDb | null): Promise<RegistryServerPublic[]> {
  return (await readServers(userId, db)).map(toPublic);
}

async function invalidatePendingApprovals(userId: string, db?: RegistryDb | null) {
  const target = db || (databaseConfigured() ? await (await import("../../db.ts")).getSql() : null);
  // Existing approval records are owner/request-bound but not connection indexed.
  // Revoking all pending MCP reviews for this owner is conservative; new reviews
  // remain possible after the explicitly changed connection is re-enabled.
  if (target) await target.query("DELETE FROM mind_mcp_call_approvals WHERE owner_id = $1", [userId]);
}

export async function setServerEnabled(userId: string, id: string, enabled: boolean, db?: RegistryDb | null): Promise<RegistryServerPublic[]> {
  const servers = await readServers(userId, db);
  const server = servers.find((item) => item.id === id);
  if (!server) throw new Error("This MCP connection is no longer saved for this account.");
  await invalidatePendingApprovals(userId, db);
  server.enabled = enabled === true;
  const saved = await saveRegistry(userId, servers, db);
  if (!saved.ok) throw new Error(saved.error);
  return servers.map(toPublic);
}

export async function registerExternalServer(
  userId: string,
  input: {
    label: string;
    url?: string;
    command?: string;
    args?: string[];
    token?: string;
    env?: Record<string, unknown>;
    connectTimeoutMs?: number;
    callTimeoutMs?: number;
  },
  db?: RegistryDb | null,
): Promise<{ ok: true; servers: RegistryServerPublic[] } | { ok: false; error: string; code?: "missing_config" }> {
  const label = input.label.trim().slice(0, 80);
  if (!label) return { ok: false, error: "A label is required. Nothing was saved." };
  const servers = await readServers(userId, db);
  if (input.url?.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(input.url.trim());
    } catch {
      return { ok: false, error: "That is not a URL. Nothing was saved." };
    }
    const refused = httpServerUrlProblem(parsed);
    if (refused) return { ok: false, error: `${refused} Nothing was saved.` };
    servers.push({
      id: randomUUID(),
      label,
      kind: "http",
      enabled: true,
      protocol: "mcp",
      url: parsed.toString(),
      token: input.token?.slice(0, 500) || undefined,
    });
    const saved = await saveRegistry(userId, servers, db);
    if (!saved.ok) return saved;
    return { ok: true, servers: servers.map(toPublic) };
  }
  if (input.command?.trim()) {
    servers.push({
      id: randomUUID(),
      label,
      kind: "command",
      enabled: false,
      command: input.command.trim().slice(0, 200),
      args: Array.isArray(input.args) ? input.args.map((a) => String(a).slice(0, 300)).slice(0, 20) : [],
      env: sanitizeServerEnv(input.env),
      connectTimeoutMs: timeoutField(input.connectTimeoutMs),
      callTimeoutMs: timeoutField(input.callTimeoutMs),
    });
    const saved = await saveRegistry(userId, servers, db);
    if (!saved.ok) return saved;
    return { ok: true, servers: servers.map(toPublic) };
  }
  return { ok: false, error: "Provide a URL or a command. Nothing was saved." };
}

export async function removeRegistryServer(userId: string, id: string, db?: RegistryDb | null): Promise<RegistryServerPublic[]> {
  const servers = await readServers(userId, db);
  if (id === BUILTIN_ID) return servers.map(toPublic);
  await invalidatePendingApprovals(userId, db);
  const { deleteRegistryServer } = await import("./registry-store.ts");
  const removed = await deleteRegistryServer(userId, id, db);
  if (!removed.ok) throw new Error(removed.error);
  return (await readServers(userId, db)).map(toPublic);
}

export type ListedTool = {
  serverId: string;
  serverLabel: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Honest listing status for this row (placeholder rows carry error/timeout/disabled). */
  status?: "ok" | "error" | "timeout" | "disabled";
  /** Object argument schema from tools/list. Null means incompatible; callers must not invent {text}. */
  inputSchema?: { type: "object"; properties: Record<string, { type: string }>; required: string[] } | null;
};

export function listBuiltinTools(enabled: boolean): ListedTool[] {
  return BUILTIN_TOOL_DEFS.map((tool) => ({
    serverId: BUILTIN_ID,
    serverLabel: "Mind built-in",
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.name === "pglite_list_schema"
      ? { type: "object" as const, properties: {} as Record<string, { type: string }>, required: [] as string[] }
      : tool.name === "pglite_query"
        ? { type: "object" as const, properties: { sql: { type: "string" } }, required: ["sql"] }
        : null) satisfies ListedTool["inputSchema"],
    enabled,
  }));
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

function rpcMessage(body: string): { result?: unknown; error?: string; errorData?: unknown } {
  const chunks = body.includes("data:")
    ? body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    : [body.trim()];
  for (const chunk of chunks) {
    if (!chunk || chunk === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) return { error: parsed.error.message || "The MCP server returned an error.", errorData: parsed.error };
      if ("result" in parsed) return { result: parsed.result };
    } catch {
      /* skip */
    }
  }
  return { error: "The MCP server did not return a JSON-RPC result." };
}

function rpcFromResult(result: unknown, token = ""): McpCallRpc {
  return mcpRpcFromResult(result, token);
}

/** Per-request deadline for remote (http) MCP servers. */
export const HTTP_RPC_TIMEOUT_MS = 15_000;
/** Largest response body read from a remote MCP server. */
export const HTTP_RPC_MAX_BYTES = 1_000_000;

export type HttpRpcOptions = { timeoutMs?: number; maxBytes?: number; lookup?: DnsLookupFn };


/** Re-export: private/loopback/link-local/ULA/metadata IP literals. */
export { isPrivateAddressLiteral, isLocalHostname } from "./http-dns-pin.ts";
export type { DnsLookupFn } from "./http-dns-pin.ts";

/** Why a remote MCP URL may not be saved or called, or null if it is fine. */
export function httpServerUrlProblem(parsed: URL): string | null {
  if (parsed.username || parsed.password) return "URLs with embedded credentials are refused; use the token field.";
  const local = isLocalHostname(parsed.hostname);
  if (!(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))) {
    return "Only https, or http on localhost, can be saved.";
  }
  if (!local && isPrivateAddressLiteral(parsed.hostname)) {
    return "Private, link-local and internal IP addresses are refused.";
  }
  return null;
}

type RpcFailure = {
  ok: false;
  error: string;
  session: string | null;
  timedOut?: boolean;
  state: "unauthorized" | "transport" | "rpc";
  httpStatus: number;
  rpc: McpCallRpc;
};

async function readCappedBody(
  response: Awaited<ReturnType<FetchLike>> & { body?: unknown },
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  const body = response.body as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null | undefined;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      text += decoder.decode(value, { stream: true });
    }
    return { ok: true, text: text + decoder.decode() };
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false };
  return { ok: true, text };
}

export async function registryRpc(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  session: string | null,
  message: unknown,
  options: HttpRpcOptions = {},
): Promise<{ ok: true; result: unknown; session: string | null; httpStatus: number; rpc: McpCallRpc } | RpcFailure> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, state: "transport", httpStatus: 0, rpc: null, error: "The saved MCP URL is invalid. Nothing was called.", session };
  }
  // Re-check at call time: stores saved before this guard existed may hold internal targets.
  const refused = httpServerUrlProblem(parsedUrl);
  if (refused) return { ok: false, state: "transport", httpStatus: 0, rpc: null, error: `${refused} Nothing was called.`, session };

  // DNS rebinding guard for non-local external hosts: resolve now, refuse every
  // answer, pin the connection to a validated public IP.
  let pinnedAddress: string | null = null;
  let pinHostname: string | null = null;

  const timeoutMs = options.timeoutMs ?? HTTP_RPC_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? HTTP_RPC_MAX_BYTES;
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
  const timeoutFailure = (): RpcFailure => ({
    ok: false,
    state: "transport",
    httpStatus: 0,
    rpc: null,
    error: `The MCP server did not answer within ${Math.round(timeoutMs / 1000) || 1}s. Nothing was called.`,
    session,
    timedOut: true,
  });
  try {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      if (!isLocalHostname(parsedUrl.hostname)) {
        const pin = await Promise.race([
          resolveAndPinMcpHostname(parsedUrl.hostname, options.lookup ?? defaultDnsLookup),
          deadline,
        ]);
        controller.signal.throwIfAborted();
        if (!pin.ok) return { ok: false, state: "transport", httpStatus: 0, rpc: null, error: `${pin.error} Nothing was called.`, session };
        pinnedAddress = pin.pinnedAddress;
        pinHostname = pin.hostname;
      }
      const init = {
          method: "POST",
          redirect: "manual" as const,
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(session ? { "mcp-session-id": session } : {}),
          },
          body: JSON.stringify(message),
        };
      const doFetch = () =>
        pinnedAddress && pinHostname
          ? pinnedHttpFetch(parsedUrl, pinnedAddress, pinHostname, init)
          : fetchImpl(parsedUrl.toString(), init);
      response = await Promise.race([doFetch(), deadline]);
    } catch {
      if (timedOut) return timeoutFailure();
      return { ok: false, state: "transport", httpStatus: 0, rpc: null, error: "The MCP server could not be reached.", session };
    }
    const nextSession = response.headers.get("mcp-session-id") || session;
    if ((response.status >= 300 && response.status < 400) || response.status === 0) {
      return { ok: false, state: "transport", httpStatus: response.status, rpc: null, error: "The MCP server tried to redirect. Redirects are not followed. Nothing was called.", session: nextSession };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, state: "unauthorized", httpStatus: response.status, rpc: null, error: `The MCP server returned ${response.status}. Nothing was called.`, session: nextSession };
    }
    if (!response.ok) return { ok: false, state: "transport", httpStatus: response.status, rpc: null, error: `The MCP server returned ${response.status}. Nothing was called.`, session: nextSession };
    let body: Awaited<ReturnType<typeof readCappedBody>>;
    try {
      body = await Promise.race([readCappedBody(response, maxBytes), deadline]);
    } catch {
      if (timedOut) return timeoutFailure();
      return { ok: false, state: "transport", httpStatus: response.status, rpc: null, error: "The MCP server response could not be read.", session: nextSession };
    }
    if (!body.ok) {
      controller.abort();
      return { ok: false, state: "transport", httpStatus: response.status, rpc: null, error: `The MCP server response was larger than ${maxBytes} bytes and was dropped.`, session: nextSession };
    }
    const parsed = rpcMessage(body.text);
    if (parsed.error) {
      const reason = safeReason("error");
      return {
        ok: false,
        state: "rpc",
        httpStatus: response.status,
        rpc: { isError: true, content: [{ type: "text", text: reason }], structuredContent: null },
        error: reason,
        session: nextSession,
      };
    }
    const rpcBody = rpcFromResult(parsed.result, token);
    return { ok: true, result: parsed.result, session: nextSession, httpStatus: response.status, rpc: rpcBody };
  } finally {
    clearTimeout(timer);
    deadline.catch(() => undefined);
  }
}

export async function listRegistryTools(
  userId: string,
  fetchImpl: FetchLike = globalThis.fetch as FetchLike,
  deps: StdioDeps & { http?: HttpRpcOptions; registryDb?: RegistryDb | null } = {},
): Promise<ListedTool[]> {
  const servers = await readServers(userId, deps.registryDb);
  const tools: ListedTool[] = [];
  for (const server of servers) {
    if (server.kind === "builtin") {
      tools.push(...listBuiltinTools(server.enabled));
      continue;
    }
    if (!server.enabled) {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: "(disabled)",
        description: "Server is disabled. Enable it to list tools.",
        enabled: false,
        status: "disabled",
      });
      continue;
    }
    if (await (deps.isHalted ?? haltIsOn)(userId)) {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: "(halted)",
        description: "Emergency stop is on or unavailable. The server was not contacted.",
        enabled: true,
        status: "error",
      });
      continue;
    }
    if (server.kind === "command") {
      const { listStdioTools } = await import("./stdio.ts");
      const listed = await listStdioTools(stdioConfig(server), deps.stdio);
      if (listed.status !== "ok") {
        tools.push({
          serverId: server.id,
          serverLabel: server.label,
          name: listed.status === "timeout" ? "(timeout)" : "(error)",
          description: `${listed.error}${listed.stderr ? ` · stderr: ${listed.stderr.slice(0, 160)}` : ""}`.slice(0, 400),
          enabled: true,
          status: listed.status,
        });
        continue;
      }
      if (listed.tools.length === 0) {
        tools.push({
          serverId: server.id,
          serverLabel: server.label,
          name: "(no tools)",
          description: "The stdio server started and answered tools/list with no tools.",
          enabled: true,
          status: "ok",
        });
        continue;
      }
      for (const tool of listed.tools) {
        tools.push({
          serverId: server.id,
          serverLabel: server.label,
          name: tool.name,
          description: tool.description,
          enabled: true,
          status: "ok",
        });
      }
      continue;
    }
    if (!server.url) continue;
    const opened = await registryRpc(fetchImpl, server.url, server.token ?? "", null, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } },
    }, deps.http);
    if (!opened.ok) {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: opened.timedOut ? "(timeout)" : "(unreachable)",
        description: opened.error,
        enabled: true,
        status: opened.timedOut ? "timeout" : "error",
      });
      continue;
    }
    await registryRpc(fetchImpl, server.url, server.token ?? "", opened.session, { jsonrpc: "2.0", method: "notifications/initialized" }, deps.http);
    const listed = await registryRpc(fetchImpl, server.url, server.token ?? "", opened.session, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }, deps.http);
    if (!listed.ok || !listed.result || typeof listed.result !== "object") {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: !listed.ok && listed.timedOut ? "(timeout)" : "(error)",
        description: listed.ok ? "No tools returned." : listed.error,
        enabled: true,
        status: !listed.ok && listed.timedOut ? "timeout" : "error",
      });
      continue;
    }
    const remoteTools = Array.isArray((listed.result as { tools?: unknown }).tools)
      ? ((listed.result as { tools: { name?: string; description?: string; inputSchema?: unknown }[] }).tools)
      : [];
    for (const tool of remoteTools) {
      if (!tool?.name || tool.name.toLowerCase() === "model.generate") continue;
      const schema = tool.inputSchema && typeof tool.inputSchema === "object" && (tool.inputSchema as { type?: string }).type === "object"
        ? tool.inputSchema as { type: "object"; properties: Record<string, { type: string }>; required?: string[] }
        : null;
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: tool.name.slice(0, 80),
        description: (tool.description ?? "").slice(0, 200),
        inputSchema: schema ? { type: "object", properties: schema.properties ?? {}, required: schema.required ?? [] } : null,
        enabled: true,
      });
    }
  }
  return tools;
}

async function callBuiltin(
  name: string,
  args: Record<string, unknown>,
  deps: { getSql: () => Promise<SqlLike>; ownerId?: string },
): Promise<ToolResult> {
  switch (name as BuiltinToolName) {
    case "notion_read_page":
      return notionReadPage({ pageIdOrUrl: String(args.page_id ?? args.pageIdOrUrl ?? args.url ?? ""), ownerId: deps.ownerId });
    case "notion_append_section":
      return notionAppendSection({
        pageIdOrUrl: String(args.page_id ?? args.pageIdOrUrl ?? args.url ?? ""),
        heading: String(args.heading ?? ""),
        markdown: String(args.markdown ?? args.content ?? ""),
        ownerId: deps.ownerId,
      });
    case "pc_run_shell":
      return pcRunShell({
        command: String(args.command ?? ""),
        confirm: args.confirm === true,
        ownerId: deps.ownerId,
      });
    case "pglite_query": {
      const sqlClient = await deps.getSql();
      return pgliteQuery({
        sql: String(args.sql ?? args.query ?? ""),
        params: Array.isArray(args.params) ? args.params : undefined,
        sqlClient,
      });
    }
    case "pglite_list_schema": {
      const sqlClient = await deps.getSql();
      return pgliteListSchema({ sqlClient });
    }
    default:
      return { ok: false, status: "error", text: `Unknown built-in tool “${name}”. Nothing was called.` };
  }
}

export async function callRegistryTool(input: {
  userId: string;
  serverId: string;
  tool: string;
  args?: Record<string, unknown>;
  getSql: () => Promise<SqlLike>;
  fetch?: FetchLike;
  http?: HttpRpcOptions;
  registryDb?: RegistryDb | null;
} & StdioDeps): Promise<RegistryToolCallResult> {
  const started = Date.now();
  const servers = await readServers(input.userId, input.registryDb);
  const server = servers.find((item) => item.id === input.serverId);
  if (!server) {
    return { status: "error", ok: false, serverId: input.serverId, tool: input.tool, text: "That MCP server is not registered. Nothing was called.", transport: null, rpc: null };
  }
  if (!server.enabled) {
    return { status: "error", ok: false, code: "disabled", serverId: server.id, tool: input.tool, text: `MCP server “${server.label}” is disabled. Nothing was called.`, transport: null, rpc: null };
  }
  if (server.secretUnreadable || (server.tokenEnc && !server.token)) {
    return { status: "error", ok: false, code: "missing_config", serverId: server.id, tool: input.tool, text: "The saved credential cannot be decrypted. Set CONNECTOR_TOKEN_SECRET and save the token again. Nothing was called.", transport: null, rpc: null };
  }
  if (await (input.isHalted ?? haltIsOn)(input.userId)) {
    return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: "Emergency stop is on or unavailable. No MCP tool was called." };
  }
  const args = input.args && typeof input.args === "object" ? input.args : {};
  if (server.kind === "builtin") {
    const result = await callBuiltin(input.tool, args, { getSql: input.getSql, ownerId: input.userId });
    return {
      status: result.status,
      ok: result.ok,
      serverId: server.id,
      tool: input.tool,
      text: result.text,
      data: (result.data ?? undefined) as RegistryToolCallResult["data"],
    };
  }
  if (server.kind === "command") {
    const { callStdioTool } = await import("./stdio.ts");
    const result = await callStdioTool(stdioConfig(server), input.tool, args, input.stdio);
    return {
      status: result.status,
      ok: result.ok,
      serverId: server.id,
      tool: input.tool,
      text: result.text,
      data: result.data ?? undefined,
    };
  }
  if (!server.url) {
    return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: "Server has no URL. Nothing was called.", transport: null, rpc: null };
  }
  const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
  if (server.protocol === "http") {
    return { status: "error", ok: false, code: "incompatible", serverId: server.id, tool: input.tool, text: "This connection is a custom HTTP call, not JSON-RPC. Nothing was called.", transport: null, rpc: null };
  }
  const opened = await registryRpc(fetchImpl, server.url, server.token ?? "", null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } },
  }, input.http);
  if (!opened.ok) return rpcFailureResult(server.id, input.tool, opened, started);
  const called = await registryRpc(fetchImpl, server.url, server.token ?? "", opened.session, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: input.tool, arguments: args },
  }, input.http);
  if (!called.ok) return rpcFailureResult(server.id, input.tool, called, started);
  return rpcSuccessResult(server.id, input.tool, called.rpc, called.httpStatus, started);
}

function textFromRpc(rpc: McpCallRpc): string {
  if (!rpc) return "";
  return rpc.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").slice(0, 8000);
}

function rpcFailureResult(serverId: string, tool: string, failure: RpcFailure, started: number): RegistryToolCallResult {
  const code: McpResultCode = failure.state === "unauthorized" ? "unauthorized" : failure.timedOut ? "timeout" : failure.error.toLowerCase().includes("refused") || failure.error.toLowerCase().includes("private") ? "ssrf_denied" : "error";
  const httpOk = failure.state === "rpc" && failure.httpStatus >= 200 && failure.httpStatus < 300;
  return {
    status: failure.timedOut ? "timeout" : "error",
    ok: false,
    code,
    serverId,
    tool,
    text: failure.error,
    transport: { ok: httpOk, status: failure.httpStatus, ms: Date.now() - started },
    rpc: failure.rpc,
  };
}

function rpcSuccessResult(serverId: string, tool: string, rpc: McpCallRpc, httpStatus: number, started: number): RegistryToolCallResult {
  const text = textFromRpc(rpc);
  const hasPayload = Boolean(text) || Boolean(rpc && (rpc.content.length > 0 || rpc.structuredContent != null));
  const isError = Boolean(rpc?.isError);
  return {
    status: isError || !hasPayload ? "error" : "ok",
    ok: !isError && hasPayload,
    code: isError ? "error" : hasPayload ? "ok" : "error",
    serverId,
    tool,
    text: text || (hasPayload ? "" : "The MCP server returned no content. Nothing was invented."),
    transport: { ok: true, status: httpStatus, ms: Date.now() - started },
    rpc,
    ...(rpc?.structuredContent && typeof rpc.structuredContent === "object" ? { data: rpc.structuredContent as RegistryToolCallResult["data"] } : {}),
  };
}

export { BUILTIN_ID };
