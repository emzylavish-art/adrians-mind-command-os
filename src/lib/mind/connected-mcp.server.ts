import {
  callCustomConnection,
  listCustomConnections,
  saveCustomConnection,
  type PublicConnection,
} from "./custom-connection.ts";
import { connectorTokenSecretStatus } from "./connectors/crypto.ts";
import { haltIsOn } from "./halt.server.ts";
import { parseMcpIntent, type McpPublic } from "./mcp.ts";
import { loadRegistry, type RegistryDb } from "./mcp/registry-store.ts";
import { removeRegistryServer } from "./mcp/registry.ts";

const NO_DB = "No durable database is configured (DATABASE_URL or POSTGRES_URL). Nothing was saved or called.";
const STOPPED = "Emergency stop is on. Nothing was saved or called.";
type ConnectionDeps = Parameters<typeof saveCustomConnection>[3];
type Dependencies = ConnectionDeps & { isHalted?: (userId: string) => boolean | Promise<boolean> };

async function halted(userId: string, deps: Dependencies): Promise<boolean> {
  return (deps.isHalted ?? haltIsOn)(userId);
}

/** Deliberate legacy UI DTO: no URL, bearer, ciphertext or registry internals. */
export function connectedMcpPublic(connection: PublicConnection): McpPublic {
  const schemaReady = connection.operations.some((operation) => operation.compatible && operation.inputSchema);
  const ready = connection.state === "ready" && schemaReady && !connection.error;
  return {
    id: connection.id,
    label: connection.label,
    host: connection.host,
    state: ready ? "connected" : connection.state === "unchecked" ? "unchecked" : "failed",
    tools: connection.operations.map(({ name, description }) => ({ name, description })),
    error: connection.error || (connection.state === "ready" && !schemaReady ? "No compatible tool schema is saved. Reconnect before calling tools." : ""),
  };
}

export async function listConnectedMcp(db: RegistryDb | null, userId: string): Promise<McpPublic[]> {
  if (!db) throw new Error(NO_DB);
  return (await listCustomConnections(db, userId)).filter((connection) => connection.kind === "mcp").map(connectedMcpPublic);
}

export async function saveConnectedMcp(
  db: RegistryDb | null,
  userId: string,
  input: { label: string; url: string; token: string },
  deps: Dependencies = {},
): Promise<{ ok: true; servers: McpPublic[]; savedId: string } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: NO_DB };
  if (await halted(userId, deps)) return { ok: false, error: STOPPED };
  const secret = connectorTokenSecretStatus();
  if (!secret.ok) return { ok: false, error: `${secret.error} Nothing was saved.` };
  const saved = await saveCustomConnection(db, userId, {
    ...input,
    kind: "mcp",
    auth: input.token ? "bearer" : "none",
  }, deps);
  if (!saved.ok) return saved;
  const servers = await listConnectedMcp(db, userId);
  return { ok: true, servers, savedId: saved.connection.id };
}

export async function removeConnectedMcp(db: RegistryDb | null, userId: string, id: string): Promise<McpPublic[]> {
  if (!db) throw new Error(NO_DB);
  await removeRegistryServer(userId, id, db);
  return listConnectedMcp(db, userId);
}

type TurnResult = { ok: boolean; needsConfirmation: boolean; servers: McpPublic[]; text: string; error: string };

/** Chat uses the same durable rows and schema/confirmation enforcement as Tools. */
export async function runConnectedMcpTurn(input: {
  db: RegistryDb | null;
  userId: string;
  text: string;
  confirmed: boolean;
} & Dependencies): Promise<TurnResult> {
  const refused = (error: string, servers: McpPublic[] = [], needsConfirmation = false): TurnResult => ({ ok: false, needsConfirmation, servers, text: "", error });
  if (!input.db) return refused(NO_DB);
  if (await halted(input.userId, input)) return refused(STOPPED);
  const connections = (await listCustomConnections(input.db, input.userId)).filter((connection) => connection.kind === "mcp");
  const servers = connections.map(connectedMcpPublic);
  if (!servers.length) return refused("No MCP server is saved. Add one on Connected. Nothing was called.");
  const intent = parseMcpIntent(input.text);
  if (intent.action === "unclear") return refused("Say list MCP tools, or call an MCP tool by name with JSON object arguments. Nothing was called.", servers);
  const loaded = await loadRegistry(input.userId, input.db);
  const enabledIds = new Set(loaded.servers.filter((server) => server.enabled).map((server) => server.id));
  if (intent.action === "list") {
    const failed = servers.find((server) => server.state !== "connected");
    return {
      ok: !failed,
      needsConfirmation: false,
      servers,
      text: servers.filter((server) => enabledIds.has(server.id)).flatMap((server) => server.tools.map((tool) => `${server.label}: ${tool.name}`)).join("\n"),
      error: failed?.error || (failed ? "An MCP connection is not ready. Reconnect on Connected." : ""),
    };
  }
  const candidates = connections.filter((connection) => enabledIds.has(connection.id) && connectedMcpPublic(connection).state === "connected" && connection.operations.some((operation) => operation.name === intent.tool));
  if (candidates.length !== 1) return refused(candidates.length ? "That tool name is ambiguous across saved servers. Select a connection in Tools. Nothing was called." : "That tool is not available on a ready, enabled MCP connection. Nothing was called.", servers);
  const target = candidates[0];
  if (!input.confirmed) return refused(`Call “${intent.tool}” on ${target.label} only after you confirm. Nothing was called.`, servers, true);
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(intent.args || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    args = parsed as Record<string, unknown>;
  } catch {
    return refused("Use JSON object arguments matching the tool schema. A generic text argument was not assumed. Nothing was called.", servers);
  }
  // Recheck immediately before dispatch; do not weaken the wrapper's halt gate.
  if (await halted(input.userId, input)) return refused(STOPPED, servers);
  const result = await callCustomConnection({ ...input, id: target.id, operation: intent.tool, args });
  return { ok: result.ok, needsConfirmation: false, servers, text: result.ok ? result.text : "", error: result.ok ? "" : result.text };
}
