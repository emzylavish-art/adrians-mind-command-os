import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_TOOL_DEFS,
  notionAppendSection,
  notionReadPage,
  pcRunShell,
  pgliteQuery,
  type BuiltinToolName,
  type SqlLike,
  type ToolResult,
} from "./tools.ts";

export type McpServerKind = "builtin" | "http" | "command";

export type RegistryServer = {
  id: string;
  label: string;
  kind: McpServerKind;
  enabled: boolean;
  /** For kind=http */
  url?: string;
  /** For kind=command (stdio) — not executed until explicitly enabled and called */
  command?: string;
  args?: string[];
  /** Opaque token for external HTTP MCP; never returned to the client */
  token?: string;
  builtin?: boolean;
};

export type RegistryServerPublic = Omit<RegistryServer, "token"> & { hasToken: boolean };

export type ToolCallStatus = "running" | "ok" | "error";

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
  const { token: _token, ...rest } = server;
  return { ...rest, hasToken: Boolean(server.token) };
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
  input: { label: string; url?: string; command?: string; args?: string[]; token?: string },
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
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (!(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))) {
      return { ok: false, error: "Only https, or http on localhost, can be saved. Nothing was saved." };
    }
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
      args: Array.isArray(input.args) ? input.args.map((a) => String(a).slice(0, 100)).slice(0, 20) : [],
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

export type ListedTool = { serverId: string; serverLabel: string; name: string; description: string; enabled: boolean };

export function listBuiltinTools(enabled: boolean): ListedTool[] {
  return BUILTIN_TOOL_DEFS.map((tool) => ({
    serverId: BUILTIN_ID,
    serverLabel: "Mind built-in",
    name: tool.name,
    description: tool.description,
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

async function rpc(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  session: string | null,
  message: unknown,
): Promise<{ ok: true; result: unknown; session: string | null } | { ok: false; error: string; session: string | null }> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(message),
    });
  } catch {
    return { ok: false, error: "The MCP server could not be reached.", session };
  }
  const nextSession = response.headers.get("mcp-session-id") || session;
  if (!response.ok) return { ok: false, error: `The MCP server returned ${response.status}. Nothing was called.`, session: nextSession };
  const parsed = rpcMessage(await response.text());
  if (parsed.error) return { ok: false, error: parsed.error, session: nextSession };
  return { ok: true, result: parsed.result, session: nextSession };
}

export async function listRegistryTools(
  userId: string,
  fetchImpl: FetchLike = globalThis.fetch as FetchLike,
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
      });
      continue;
    }
    if (server.kind === "command") {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: "(stdio)",
        description: `Command MCP “${server.command}” is registered but stdio calls are not wired in this lane. Nothing was called.`,
        enabled: true,
      });
      continue;
    }
    if (!server.url) continue;
    const opened = await rpc(fetchImpl, server.url, server.token ?? "", null, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } },
    });
    if (!opened.ok) {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: "(unreachable)",
        description: opened.error,
        enabled: true,
      });
      continue;
    }
    await rpc(fetchImpl, server.url, server.token ?? "", opened.session, { jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = await rpc(fetchImpl, server.url, server.token ?? "", opened.session, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    if (!listed.ok || !listed.result || typeof listed.result !== "object") {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: "(error)",
        description: listed.ok ? "No tools returned." : listed.error,
        enabled: true,
      });
      continue;
    }
    const remoteTools = Array.isArray((listed.result as { tools?: unknown }).tools)
      ? ((listed.result as { tools: { name?: string; description?: string }[] }).tools)
      : [];
    for (const tool of remoteTools) {
      if (!tool?.name) continue;
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name: tool.name.slice(0, 80),
        description: (tool.description ?? "").slice(0, 200),
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
}): Promise<RegistryToolCallResult> {
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
    return {
      status: "error",
      ok: false,
      serverId: server.id,
      tool: input.tool,
      text: "Stdio MCP command servers are registered but not executed in this lane. Nothing was called.",
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
  });
  if (!opened.ok) {
    return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: opened.error };
  }
  const called = await rpc(fetchImpl, server.url, server.token ?? "", opened.session, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: input.tool, arguments: args },
  });
  if (!called.ok) {
    return { status: "error", ok: false, serverId: server.id, tool: input.tool, text: called.error };
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
