import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDataPath } from "../local-data.ts";
import type { OperationSchema } from "./custom-connection.ts";

export type McpTool = { name: string; description: string; inputSchema?: OperationSchema; annotations?: { readOnlyHint?: boolean } };

export type McpPublic = {
  id: string;
  label: string;
  host: string;
  state: "unchecked" | "connected" | "failed";
  tools: McpTool[];
  error: string;
};

type Stored = McpPublic & { url: string; token: string; ownerId: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

let directory = localDataPath("mind-mcp");

export function setMcpDirectory(next: string) {
  directory = next;
}

function fileFor(userId: string) {
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

function readAll(userId: string): Stored[] {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(userId), "utf8")) as { servers?: Stored[] };
    return Array.isArray(parsed.servers) ? parsed.servers.filter((item) => item.ownerId === userId) : [];
  } catch {
    return [];
  }
}

function writeAll(userId: string, servers: Stored[]) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(fileFor(userId), JSON.stringify({ servers }));
}

export function toPublic(server: Stored): McpPublic {
  return {
    id: server.id,
    label: server.label,
    host: server.host,
    state: server.state,
    tools: server.tools,
    error: server.error,
  };
}

export function listMcp(userId: string): McpPublic[] {
  return readAll(userId).map(toPublic);
}

export function allowedMcpUrl(value: string): { ok: true; url: string; host: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, error: "That is not a URL. Nothing was saved." };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "Put the secret in the token field, not the URL. Nothing was saved." };
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && local)) {
    return { ok: true, url: parsed.toString(), host: parsed.host };
  }
  return { ok: false, error: "Only https, or http on localhost, can be saved. Nothing was saved." };
}

export function saveMcp(userId: string, input: { label: string; url: string; token: string }): { ok: true; server: McpPublic } | { ok: false; error: string } {
  const checked = allowedMcpUrl(input.url);
  if (!checked.ok) return checked;
  const label = input.label.trim().slice(0, 80) || checked.host;
  const servers = readAll(userId);
  const stored: Stored = {
    id: randomUUID(),
    label,
    host: checked.host,
    url: checked.url,
    token: input.token.slice(0, 500),
    ownerId: userId,
    state: "unchecked",
    tools: [],
    error: "",
  };
  servers.push(stored);
  writeAll(userId, servers);
  return { ok: true, server: toPublic(stored) };
}

export function removeMcp(userId: string, id: string): McpPublic[] {
  writeAll(userId, readAll(userId).filter((item) => item.id !== id));
  return listMcp(userId);
}

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
      /* a non-JSON line is not a tool list */
    }
  }
  return { error: "The MCP server did not return a JSON-RPC result." };
}

function toolsFrom(result: unknown): McpTool[] {
  if (!result || typeof result !== "object" || !Array.isArray((result as { tools?: unknown }).tools)) return [];
  const tools: McpTool[] = [];
  for (const item of (result as { tools: unknown[] }).tools) {
    if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") continue;
    const name = (item as { name: string }).name.slice(0, 80);
    const description = typeof (item as { description?: unknown }).description === "string" ? (item as { description: string }).description.slice(0, 180) : "";
    tools.push({ name, description });
  }
  return tools;
}

async function rpc(fetchImpl: FetchLike, url: string, token: string, session: string | null, message: unknown): Promise<{ ok: true; result: unknown; session: string | null } | { ok: false; error: string; session: string | null }> {
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

export async function probeMcp(userId: string, id: string, fetchImpl: FetchLike): Promise<McpPublic> {
  const servers = readAll(userId);
  const server = servers.find((item) => item.id === id);
  if (!server) return { id, label: "", host: "", state: "failed", tools: [], error: "That MCP server is not saved for this workspace." };
  const opened = await rpc(fetchImpl, server.url, server.token, null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } },
  });
  if (!opened.ok) {
    server.state = "failed";
    server.tools = [];
    server.error = opened.error;
    writeAll(userId, servers);
    return toPublic(server);
  }
  await rpc(fetchImpl, server.url, server.token, opened.session, { jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await rpc(fetchImpl, server.url, server.token, opened.session, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  if (!listed.ok) {
    server.state = "failed";
    server.tools = [];
    server.error = listed.error;
    writeAll(userId, servers);
    return toPublic(server);
  }
  server.state = "connected";
  server.tools = toolsFrom(listed.result);
  server.error = "";
  writeAll(userId, servers);
  return toPublic(server);
}

export function parseMcpIntent(text: string): { action: "list" } | { action: "call"; tool: string; args: string; serverId?: string } | { action: "unclear" } {
  const lower = text.toLowerCase();
  if (!/\bmcp\b/.test(lower)) return { action: "unclear" };
  const call = text.match(/\b(?:call|use|run)\b[\s\S]{0,40}\bmcp\b[\s\S]{0,20}\btool\s+([A-Za-z0-9_-]+)(?:\s+on server\s+([0-9a-f-]{36}))?\s*([\s\S]*)/i);
  if (call?.[1]) return { action: "call", tool: call[1], serverId: call[2], args: (call[3] ?? "").trim() };
  if (/\b(list|show|what)\b/.test(lower)) return { action: "list" };
  return { action: "unclear" };
}

export async function runMcpTurn(input: {
  userId: string;
  text: string;
  confirmed: boolean;
  fetch: FetchLike;
}): Promise<{ ok: boolean; needsConfirmation: boolean; servers: McpPublic[]; text: string; error: string }> {
  const servers = readAll(input.userId);
  if (servers.length === 0) {
    return { ok: false, needsConfirmation: false, servers: [], text: "", error: "No MCP server is saved. Add one on Connected. Nothing was called." };
  }
  const intent = parseMcpIntent(input.text);
  if (intent.action === "unclear") {
    return { ok: false, needsConfirmation: false, servers: servers.map(toPublic), text: "", error: "Say list MCP tools, or call an MCP tool by name. Nothing was called." };
  }
  if (intent.action === "list") {
    const probed = [];
    for (const server of servers) probed.push(await probeMcp(input.userId, server.id, input.fetch));
    const names = probed.flatMap((server) => server.tools.map((tool) => `${server.label}: ${tool.name}`));
    const failed = probed.filter((server) => server.state !== "connected");
    return {
      ok: failed.length === 0,
      needsConfirmation: false,
      servers: probed,
      text: names.join("\n"),
      error: failed[0]?.error ?? (names.length ? "" : "The server connected and returned no tools."),
    };
  }
  const target = intent.serverId
    ? servers.find((server) => server.id === intent.serverId)
    : servers.find((server) => server.state === "connected") ?? servers[0];
  if (intent.serverId && !target) {
    return { ok: false, needsConfirmation: false, servers: servers.map(toPublic), text: "", error: "That MCP server is not saved. Nothing was called and another server was not substituted." };
  }
  if (!target) return { ok: false, needsConfirmation: false, servers: [], text: "", error: "No MCP server is saved. Nothing was called." };
  if (!input.confirmed) {
    return { ok: false, needsConfirmation: true, servers: [toPublic(target)], text: "", error: `Call “${intent.tool}” on ${target.label} only after you confirm. Nothing was called.` };
  }
  const opened = await rpc(input.fetch, target.url, target.token, null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adrians-mind", version: "1" } },
  });
  if (!opened.ok) return { ok: false, needsConfirmation: false, servers: [toPublic(target)], text: "", error: opened.error };
  const called = await rpc(input.fetch, target.url, target.token, opened.session, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: intent.tool, arguments: { text: intent.args } },
  });
  if (!called.ok) return { ok: false, needsConfirmation: false, servers: [toPublic(target)], text: "", error: called.error };
  const content = called.result && typeof called.result === "object" && Array.isArray((called.result as { content?: unknown }).content)
    ? (called.result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("\n").slice(0, 4000)
    : "";
  return { ok: Boolean(content), needsConfirmation: false, servers: [toPublic(target)], text: content, error: content ? "" : "The MCP server returned no text. Nothing was invented." };
}
