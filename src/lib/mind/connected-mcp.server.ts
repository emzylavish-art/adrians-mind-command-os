import { createHash, randomUUID } from "node:crypto";
import {
  callCustomConnection,
  validateArgs,
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
  const ready = connection.enabled !== false && connection.state === "ready" && schemaReady && !connection.error;
  return {
    id: connection.id,
    label: connection.label,
    host: connection.host,
    state: ready ? "connected" : connection.state === "unchecked" ? "unchecked" : "failed",
    tools: connection.operations.filter((op) => op.compatible && op.inputSchema).map(({ name, description }) => ({ name, description })),
    error: connection.enabled === false ? "This connection is disabled." : connection.error || (connection.state === "ready" && !schemaReady ? "No compatible tool schema is saved. Reconnect before calling tools." : ""),
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

type TurnResult = { approvalId?: string; approvalServerId?: string; ok: boolean; needsConfirmation: boolean; servers: McpPublic[]; text: string; error: string };

/** Chat uses the same durable rows and schema/confirmation enforcement as Tools. */
export async function runConnectedMcpTurn(input: {
  db: RegistryDb | null;
  userId: string;
  text: string;
  confirmed: boolean;
  approvalServerId?: string;
  approvalId?: string;
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
      text: servers.filter((server) => enabledIds.has(server.id) && server.state === "connected").flatMap((server) => server.tools.map((tool) => `${server.label}: ${tool.name}`)).join("\n"),
      error: failed?.error || (failed ? "An MCP connection is not ready. Reconnect on Connected." : ""),
    };
  }
  if (input.confirmed && !input.approvalServerId) return refused("Select the connection again to confirm this call.", servers);
  const requestedId = input.approvalServerId || intent.serverId;
  if (intent.serverId && requestedId !== intent.serverId) return refused("The reviewed connection does not match the request.", servers);
  const candidates = connections.filter((connection) => (!requestedId || requestedId === connection.id) && enabledIds.has(connection.id) && (connectedMcpPublic(connection).state === "connected" || (Boolean(requestedId) && connection.state === "unauthorized")) && connection.operations.some((operation) => operation.name === intent.tool && operation.compatible));
  if (candidates.length !== 1) return refused(candidates.length ? "That tool name is ambiguous across saved servers. Select a connection in Tools. Nothing was called." : "That tool is not available on a ready, enabled MCP connection. Nothing was called.", servers);
  const target = candidates[0];
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(intent.args || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    args = parsed as Record<string, unknown>;
  } catch {
    return refused("Use JSON object arguments matching the tool schema. A generic text argument was not assumed. Nothing was called.", servers);
  }
  const operation = target.operations.find((item) => item.name === intent.tool);
  if (!operation?.inputSchema) return refused("This tool has no supported argument schema.", servers);
  const checked = validateArgs(operation.inputSchema, args);
  if (!checked.ok) return refused(checked.error, servers);
  const hash = createHash("sha256").update(JSON.stringify([target.id, intent.tool, operation.revision, checked.args])).digest("hex");
  if (!input.confirmed) {
    const approvalId = randomUUID();
    await input.db.query("DELETE FROM mind_mcp_call_approvals WHERE expires_at <= now()");
    await input.db.query("INSERT INTO mind_mcp_call_approvals (approval_id, owner_id, request_hash, expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')", [approvalId, input.userId, hash]);
    return { ...refused(`Call “${intent.tool}” on ${target.label} only after you confirm. Nothing was called.`, servers, true), approvalServerId: target.id, approvalId };
  }
  if (!input.approvalId || !/^[0-9a-f-]{36}$/.test(input.approvalId)) return refused("Review the exact call again.", servers);
  const consumed = await input.db.query("DELETE FROM mind_mcp_call_approvals WHERE approval_id=$1 AND owner_id=$2 AND request_hash=$3 AND expires_at>now() RETURNING approval_id", [input.approvalId, input.userId, hash]);
  if (!consumed.length) return refused("The call changed or its approval expired or was already used. Review it again.", servers);
  // Recheck immediately before dispatch; do not weaken the wrapper's halt gate.
  if (await halted(input.userId, input)) return refused(STOPPED, servers);
  const result = await callCustomConnection({ ...input, id: target.id, operation: intent.tool, args, reviewedRevision: operation.revision });
  const latest = result.connection;
  return { ok: result.ok, needsConfirmation: false, servers: latest ? servers.map((server) => server.id === latest.id ? connectedMcpPublic(latest) : server) : servers, text: result.ok ? result.text : "", error: result.ok ? "" : result.text };
}
