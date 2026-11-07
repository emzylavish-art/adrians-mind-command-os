import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import { callStdioTool, isBlockedChildEnvKey, listStdioTools, type StdioOptions } from "./stdio.ts";
import {
  defaultDnsLookup,
  isLocalHostname,
  isPrivateAddressLiteral,
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./http-dns-pin.ts";
import { readHaltFile } from "../halt-file.ts";

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
};

type StoreFile = { servers: RegistryServer[] };

const BUILTIN_ID = "builtin-mind";

let directory = join(process.cwd(), ".data", "mind-mcp-registry");

export function setMcpRegistryDirectory(next: string) {
  directory = next;
}

function fileFor(userId: string) {
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

function defaultServers(): RegistryServer[] {
  return [
    {
      id: BUILTIN_ID,
      label: "Mind built-in",
      kind: "builtin",
      enabled: true,
      builtin: true,
    },
  ];
}

function readStore(userId: string): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(userId), "utf8")) as StoreFile;
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    if (!servers.some((s) => s.id === BUILTIN_ID)) {
      return { servers: [...defaultServers(), ...servers] };
    }
    return { servers };
  } catch {
    return { servers: defaultServers() };
  }
}

function writeStore(userId: string, store: StoreFile) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(fileFor(userId), JSON.stringify(store, null, 2));
}

function toPublic(server: RegistryServer): RegistryServerPublic {
  const { token: _token, env, ...rest } = server;
  return { ...rest, hasToken: Boolean(server.token), ...(env ? { envKeys: Object.keys(env) } : {}) };
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
  /** Emergency-stop check. Defaults to the durable halt file. When halted, no stdio child is spawned. */
  isHalted?: (userId: string) => Promise<boolean> | boolean;
};

function defaultIsHalted(userId: string): boolean {
  const file = readHaltFile(userId);
  return file.ownerId ? file.halted : false;
}

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

export function listRegistryServers(userId: string): RegistryServerPublic[] {
  return readStore(userId).servers.map(toPublic);
}

export function setServerEnabled(userId: string, id: string, enabled: boolean): RegistryServerPublic[] {
  const store = readStore(userId);
  const server = store.servers.find((item) => item.id === id);
  if (!server) return store.servers.map(toPublic);
  server.enabled = enabled === true;
  writeStore(userId, store);
  return store.servers.map(toPublic);
}

export function registerExternalServer(
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
): { ok: true; servers: RegistryServerPublic[] } | { ok: false; error: string } {
  const label = input.label.trim().slice(0, 80);
  if (!label) return { ok: false, error: "A label is required. Nothing was saved." };
  const store = readStore(userId);
  if (input.url?.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(input.url.trim());
    } catch {
      return { ok: false, error: "That is not a URL. Nothing was saved." };
    }
    const refused = httpServerUrlProblem(parsed);
    if (refused) return { ok: false, error: `${refused} Nothing was saved.` };
    store.servers.push({
      id: randomUUID(),
      label,
      kind: "http",
      enabled: true,
      url: parsed.toString(),
      token: input.token?.slice(0, 500),
    });
    writeStore(userId, store);
    return { ok: true, servers: store.servers.map(toPublic) };
  }
  if (input.command?.trim()) {
    store.servers.push({
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
    writeStore(userId, store);
    return { ok: true, servers: store.servers.map(toPublic) };
  }
  return { ok: false, error: "Provide a URL or a command. Nothing was saved." };
}

export function removeRegistryServer(userId: string, id: string): RegistryServerPublic[] {
  const store = readStore(userId);
  if (id === BUILTIN_ID) return store.servers.map(toPublic);
  store.servers = store.servers.filter((item) => item.id !== id);
  writeStore(userId, store);
  return store.servers.map(toPublic);
}

export type ListedTool = {
  serverId: string;
  serverLabel: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Object argument schema from tools/list. Null means incompatible; callers must not invent {text}. */
  inputSchema?: { type: "object"; properties: Record<string, { type: string }>; required: string[] } | null;
};

export function listBuiltinTools(enabled: boolean): ListedTool[] {
  return BUILTIN_TOOL_DEFS.map((tool) => ({
    serverId: BUILTIN_ID,
    serverLabel: "Mind built-in",
    name: tool.name,
    description: tool.description,
    inputSchema: tool.name === "pglite_list_schema"
      ? { type: "object", properties: {}, required: [] }
      : tool.name === "pglite_query"
        ? { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] }
        : null,
    enabled,
  }));
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

function rpcMessage(body: string): { result?: unknown; error?: string } {
  const chunks = body.includes("data:")
    ? body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    : [body.trim()];
  for (const chunk of chunks) {
    if (!chunk || chunk === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) return { error: parsed.error.message || "The MCP server returned an error." };
      if ("result" in parsed) return { result: parsed.result };
    } catch {
      /* skip */
    }
  }
  return { error: "The MCP server did not return a JSON-RPC result." };
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

type RpcFailure = { ok: false; error: string; session: string | null; timedOut?: boolean };

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

async function rpc(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  session: string | null,
  message: unknown,
  options: HttpRpcOptions = {},
): Promise<{ ok: true; result: unknown; session: string | null } | RpcFailure> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: "The saved MCP URL is invalid. Nothing was called.", session };
  }
  // Re-check at call time: stores saved before this guard existed may hold internal targets.
  const refused = httpServerUrlProblem(parsedUrl);
  if (refused) return { ok: false, error: `${refused} Nothing was called.`, session };

  // DNS rebinding guard for non-local external hosts: resolve now, refuse every
  // answer, pin the connection to a validated public IP.
  let pinnedAddress: string | null = null;
  let pinHostname: string | null = null;
  if (!isLocalHostname(parsedUrl.hostname)) {
    const pin = await resolveAndPinMcpHostname(parsedUrl.hostname, options.lookup ?? defaultDnsLookup);
    if (!pin.ok) return { ok: false, error: `${pin.error} Nothing was called.`, session };
    pinnedAddress = pin.pinnedAddress;
    pinHostname = pin.hostname;
  }

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
    error: `The MCP server did not answer within ${Math.round(timeoutMs / 1000) || 1}s. Nothing was called.`,
    session,
    timedOut: true,
  });
  try {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
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
      return { ok: false, error: "The MCP server could not be reached.", session };
    }
    const nextSession = response.headers.get("mcp-session-id") || session;
    if ((response.status >= 300 && response.status < 400) || response.status === 0) {
      return { ok: false, error: "The MCP server tried to redirect. Redirects are not followed. Nothing was called.", session: nextSession };
    }
    if (!response.ok) return { ok: false, error: `The MCP server returned ${response.status}. Nothing was called.`, session: nextSession };
    let body: Awaited<ReturnType<typeof readCappedBody>>;
    try {
      body = await Promise.race([readCappedBody(response, maxBytes), deadline]);
    } catch {
      if (timedOut) return timeoutFailure();
      return { ok: false, error: "The MCP server response could not be read.", session: nextSession };
    }
    if (!body.ok) {
      controller.abort();
      return { ok: false, error: `The MCP server response was larger than ${maxBytes} bytes and was dropped.`, session: nextSession };
    }
    const parsed = rpcMessage(body.text);
    if (parsed.error) return { ok: false, error: parsed.error, session: nextSession };
    return { ok: true, result: parsed.result, session: nextSession };
  } finally {
    clearTimeout(timer);
    deadline.catch(() => undefined);
  }
}

export async function listRegistryTools(
  userId: string,
  fetchImpl: FetchLike = globalThis.fetch as FetchLike,
  deps: StdioDeps & { http?: HttpRpcOptions } = {},
): Promise<ListedTool[]> {
  const store = readStore(userId);
  const tools: ListedTool[] = [];
  for (const server of store.servers) {
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
    if (server.kind === "command") {
      if (await (deps.isHalted ?? defaultIsHalted)(userId)) {
        tools.push({
          serverId: server.id,
          serverLabel: server.label,
          name: "(halted)",
          description: "Emergency stop is on. The stdio server was not started.",
          enabled: true,
          status: "error",
        });
        continue;
      }
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
    const opened = await rpc(fetchImpl, server.url, server.token ?? "", null, {
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
    await rpc(fetchImpl, server.url, server.token ?? "", opened.session, { jsonrpc: "2.0", method: "notifications/initialized" }, deps.http);
    const listed = await rpc(fetchImpl, server.url, server.token ?? "", opened.session, {
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
} & StdioDeps): Promise<RegistryToolCallResult> {
  const store = readStore(input.userId);
  const server = store.servers.find((item) => item.id === input.serverId);
  if (!server) {
    return { status: "error", ok: false, serverId: input.serverId, tool: input.tool, text: "That MCP server is not registered. Nothing was called." };
  }
  if (!server.enabled) {
    return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: `MCP server “${server.label}” is disabled. Nothing was called.` };
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
    if (await (input.isHalted ?? defaultIsHalted)(input.userId)) {
      return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: "Emergency stop is on. No MCP tool was called." };
    }
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
    return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: "Server has no URL. Nothing was called." };
  }
  const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
  const opened = await rpc(fetchImpl, server.url, server.token ?? "", null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } },
  }, input.http);
  if (!opened.ok) {
    return { status: opened.timedOut ? "timeout" : "error", ok: false, serverId: server.id, tool: input.tool, text: opened.error };
  }
  const called = await rpc(fetchImpl, server.url, server.token ?? "", opened.session, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: input.tool, arguments: args },
  }, input.http);
  if (!called.ok) {
    return { status: called.timedOut ? "timeout" : "error", ok: false, serverId: server.id, tool: input.tool, text: called.error };
  }
  const content =
    called.result && typeof called.result === "object" && Array.isArray((called.result as { content?: unknown }).content)
      ? (called.result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("\n").slice(0, 8000)
      : "";
  const isError = Boolean(called.result && typeof called.result === "object" && (called.result as { isError?: boolean }).isError);
  return {
    status: isError || !content ? "error" : "ok",
    ok: !isError && Boolean(content),
    serverId: server.id,
    tool: input.tool,
    text: content || "The MCP server returned no text. Nothing was invented.",
  };
}

export { BUILTIN_ID };
