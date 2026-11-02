/**
 * Real per-connector verification for the Tools panel.
 * Never trusts a stored status badge — each verify runs a live probe.
 *
 * MCP servers: initialize → tools/list → one read-only test call when safe.
 * Built-in probe is ALWAYS pglite_list_schema (never pc_run_shell / writing SQL).
 * OAuth connectors: token decrypt + one minimal read-only provider call.
 */
import { sanitizeVerifyError, type ConnectorKind, type ConnectorVerifyResult } from "./connector-verify-shared.ts";

export {
  buildConnectorVerifyPayload,
  formatVerifyBadge,
  sanitizeVerifyError,
  type ConnectorKind,
  type ConnectorVerifyPayload,
  type ConnectorVerifyResult,
  type ConnectorVerifyStateName,
} from "./connector-verify-shared.ts";

import {
  BUILTIN_ID,
  callRegistryTool,
  listRegistryServers,
  listRegistryTools,
  type HttpRpcOptions,
  type ListedTool,
  type RegistryServerPublic,
  type StdioDeps,
} from "./registry.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
import { BUILTIN_TOOL_DEFS, type SqlLike } from "./tools.ts";
import {
  CONNECTOR_DISPLAY_NAMES,
  CONNECTOR_IDS,
  getAccessToken,
  readConnection,
  type ConnectorId,
} from "../connectors/store.ts";

export const VERIFY_TIMEOUT_MS = 8_000;
export const VERIFY_MAX_BYTES = 64_000;
/** Sole allowed built-in probe — never pc_run_shell, never pglite_query with caller SQL. */
export const BUILTIN_VERIFY_PROBE_TOOL = "pglite_list_schema" as const;
export const FORBIDDEN_BUILTIN_PROBES = ["pc_run_shell", "pglite_query", "notion_append_section"] as const;

const WRITE_OR_SHELL =
  /^(pc_run_shell|.*(?:write|create|update|delete|append|insert|drop|exec|shell|send|post|put|patch|remove|mutate|run_command).*)$/i;
const READ_HINT =
  /^(?:get_|list_|read_|describe_|schema_|search_|find_|fetch_|status_|ping_|health_|show_|count_|inspect_|query_)/i;

/**
 * Pick ONE clearly read-only tool for an external MCP probe.
 * Returns null when nothing is clearly safe — caller must stop at tools/list.
 * Never returns pc_run_shell or other write/shell tools.
 */
export function pickReadOnlyProbeTool(
  tools: ReadonlyArray<{ name?: string; description?: string }>,
): string | null {
  for (const tool of tools) {
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name) continue;
    if (FORBIDDEN_BUILTIN_PROBES.includes(name as (typeof FORBIDDEN_BUILTIN_PROBES)[number])) continue;
    if (WRITE_OR_SHELL.test(name)) continue;
    const desc = typeof tool.description === "string" ? tool.description : "";
    if (/read[\s-]?only|list schema|does not write|no side.?effect/i.test(desc) || READ_HINT.test(name)) {
      return name.slice(0, 80);
    }
  }
  return null;
}

/** True when a tool name is forbidden as a verify probe. */
export function isForbiddenVerifyProbe(toolName: string): boolean {
  const name = toolName.trim();
  if (!name) return true;
  if ((FORBIDDEN_BUILTIN_PROBES as readonly string[]).includes(name)) return true;
  return WRITE_OR_SHELL.test(name);
}

export type VerifyFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}>;

export type ConnectorVerifyDeps = {
  getSql: () => Promise<SqlLike>;
  fetch?: FetchLike;
  http?: HttpRpcOptions;
  stdio?: StdioDeps["stdio"];
  isHalted?: StdioDeps["isHalted"];
  oauthFetch?: VerifyFetch;
  readToken?: (ownerId: string, connector: ConnectorId) => string | null;
  /** Optional override for MCP tool listing (tests). */
  listTools?: (
    userId: string,
    fetchImpl?: FetchLike,
    deps?: StdioDeps & { http?: HttpRpcOptions },
  ) => Promise<ListedTool[]>;
  /** Optional override for MCP tool calls (tests). Records every probe. */
  callTool?: typeof callRegistryTool;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000) || 1}s.`), {
          name: "TimeoutError",
          timedOut: true,
        }),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isTimedOut(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as { name?: string; timedOut?: boolean; message?: string };
  return record.timedOut === true || record.name === "TimeoutError" || /timed out|timeout/i.test(record.message ?? "");
}

function httpOpts(deps: ConnectorVerifyDeps): HttpRpcOptions {
  return {
    timeoutMs: deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
    maxBytes: deps.maxBytes ?? VERIFY_MAX_BYTES,
    ...(deps.http ?? {}),
  };
}

async function verifyBuiltin(
  userId: string,
  server: RegistryServerPublic,
  deps: ConnectorVerifyDeps,
): Promise<ConnectorVerifyResult> {
  const started = (deps.now ?? Date.now)();
  const toolCount = BUILTIN_TOOL_DEFS.length;
  const probe = BUILTIN_VERIFY_PROBE_TOOL;
  if (probe !== "pglite_list_schema" || isForbiddenVerifyProbe(probe)) {
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: "error",
      toolCount,
      detail: "Built-in verify probe is misconfigured. Nothing was called.",
      probeTool: null,
    };
  }
  const call = deps.callTool ?? callRegistryTool;
  try {
    const result = await withTimeout(
      call({
        userId,
        serverId: BUILTIN_ID,
        tool: probe,
        args: {},
        getSql: deps.getSql,
        fetch: deps.fetch,
        http: httpOpts(deps),
        stdio: deps.stdio,
        isHalted: deps.isHalted,
      }),
      deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
      "Built-in MCP verify",
    );
    const latencyMs = Math.max(0, (deps.now ?? Date.now)() - started);
    if (result.status === "timeout") {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "timeout",
        toolCount,
        latencyMs,
        detail: sanitizeVerifyError(result.text, "Built-in MCP verify timed out."),
        probeTool: probe,
      };
    }
    if (!result.ok) {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "error",
        toolCount,
        latencyMs,
        detail: sanitizeVerifyError(result.text),
        probeTool: probe,
      };
    }
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: "ok",
      toolCount,
      latencyMs,
      detail: `Verified with ${probe}.`,
      probeTool: probe,
    };
  } catch (err) {
    const latencyMs = Math.max(0, (deps.now ?? Date.now)() - started);
    if (isTimedOut(err)) {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "timeout",
        toolCount,
        latencyMs,
        detail: sanitizeVerifyError(err, "Built-in MCP verify timed out."),
        probeTool: probe,
      };
    }
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: "error",
      toolCount,
      latencyMs,
      detail: sanitizeVerifyError(err),
      probeTool: probe,
    };
  }
}

function resultFromListedTools(
  server: RegistryServerPublic,
  forServer: ListedTool[],
  started: number,
  now: () => number,
): ConnectorVerifyResult | null {
  const statusRow = forServer.find((t) => t.name.startsWith("("));
  if (!statusRow) return null;
  if (statusRow.status === "timeout" || statusRow.name === "(timeout)") {
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: "timeout",
      toolCount: 0,
      latencyMs: Math.max(0, now() - started),
      detail: sanitizeVerifyError(statusRow.description, "MCP verify timed out."),
      probeTool: null,
    };
  }
  if (
    statusRow.status === "error" ||
    statusRow.status === "disabled" ||
    statusRow.name === "(unreachable)" ||
    statusRow.name === "(error)" ||
    statusRow.name === "(halted)" ||
    statusRow.name === "(disabled)"
  ) {
    if (statusRow.name === "(disabled)" || statusRow.status === "disabled") {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "not_connected",
        toolCount: 0,
        latencyMs: Math.max(0, now() - started),
        detail: "Server is disabled. Enable it to verify.",
        probeTool: null,
      };
    }
    const authish = /401|403|unauthor|auth|forbidden|expired/i.test(statusRow.description);
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: authish ? "auth_expired" : "error",
      toolCount: 0,
      latencyMs: Math.max(0, now() - started),
      detail: sanitizeVerifyError(statusRow.description),
      probeTool: null,
    };
  }
  return null;
}

async function verifyExternalMcp(
  userId: string,
  server: RegistryServerPublic,
  deps: ConnectorVerifyDeps,
  listedForServer?: ListedTool[],
): Promise<ConnectorVerifyResult> {
  const started = (deps.now ?? Date.now)();
  const now = deps.now ?? Date.now;
  try {
    let forServer = listedForServer;
    if (!forServer) {
      const listFn = deps.listTools ?? listRegistryTools;
      const tools = await withTimeout(
        listFn(userId, deps.fetch ?? (globalThis.fetch as FetchLike), {
          http: httpOpts(deps),
          stdio: deps.stdio,
          isHalted: deps.isHalted,
        }),
        deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
        `MCP verify ${server.label}`,
      );
      forServer = tools.filter((t) => t.serverId === server.id);
    }

    const early = resultFromListedTools(server, forServer, started, now);
    if (early) return early;

    const realTools = forServer.filter((t) => !t.name.startsWith("("));
    const probe = pickReadOnlyProbeTool(realTools.map((t) => ({ name: t.name, description: t.description })));
    if (!probe || isForbiddenVerifyProbe(probe)) {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "ok",
        toolCount: realTools.length,
        latencyMs: Math.max(0, now() - started),
        detail: "tools/list ok; no clearly read-only tool to probe.",
        probeTool: null,
      };
    }

    const call = deps.callTool ?? callRegistryTool;
    const called = await withTimeout(
      call({
        userId,
        serverId: server.id,
        tool: probe,
        args: {},
        getSql: deps.getSql,
        fetch: deps.fetch,
        http: httpOpts(deps),
        stdio: deps.stdio,
        isHalted: deps.isHalted,
      }),
      deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
      `MCP probe ${probe}`,
    );
    const latencyMs = Math.max(0, now() - started);
    if (called.status === "timeout") {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "timeout",
        toolCount: realTools.length,
        latencyMs,
        detail: sanitizeVerifyError(called.text, "MCP probe timed out."),
        probeTool: probe,
      };
    }
    if (!called.ok) {
      const authish = /401|403|unauthor|auth|forbidden|expired/i.test(called.text);
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: authish ? "auth_expired" : "error",
        toolCount: realTools.length,
        latencyMs,
        detail: sanitizeVerifyError(called.text),
        probeTool: probe,
      };
    }
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: "ok",
      toolCount: realTools.length,
      latencyMs,
      detail: `Verified with ${probe}.`,
      probeTool: probe,
    };
  } catch (err) {
    const latencyMs = Math.max(0, now() - started);
    if (isTimedOut(err)) {
      return {
        id: server.id,
        kind: "mcp",
        label: server.label,
        state: "timeout",
        latencyMs,
        detail: sanitizeVerifyError(err, "MCP verify timed out."),
        probeTool: null,
      };
    }
    return {
      id: server.id,
      kind: "mcp",
      label: server.label,
      state: "error",
      latencyMs,
      detail: sanitizeVerifyError(err),
      probeTool: null,
    };
  }
}

async function verifyMcpServer(
  userId: string,
  server: RegistryServerPublic,
  deps: ConnectorVerifyDeps,
  listedForServer?: ListedTool[],
): Promise<ConnectorVerifyResult> {
  if (server.kind === "builtin") return verifyBuiltin(userId, server, deps);
  return verifyExternalMcp(userId, server, deps, listedForServer);
}

const OAUTH_PROBE: Record<
  ConnectorId,
  {
    url: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    /** Dropbox-style POST with literal JSON null body (Bearer auth only). */
    emptyJsonBody?: boolean;
  }
> = {
  notion: {
    url: "https://api.notion.com/v1/users/me",
    method: "GET",
    headers: { "Notion-Version": "2022-06-28" },
  },
  gmail: { url: "https://www.googleapis.com/oauth2/v3/userinfo", method: "GET" },
  google_calendar: { url: "https://www.googleapis.com/oauth2/v3/userinfo", method: "GET" },
  google_drive: { url: "https://www.googleapis.com/oauth2/v3/userinfo", method: "GET" },
  dropbox: { url: "https://api.dropboxapi.com/2/users/get_current_account", method: "POST", emptyJsonBody: true },
  onedrive: { url: "https://graph.microsoft.com/v1.0/me", method: "GET" },
  slack: { url: "https://slack.com/api/auth.test", method: "POST" },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    headers: { Accept: "application/vnd.github+json", "User-Agent": "adrians-mind-command-os" },
  },
};

async function defaultOauthFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    headers: response.headers,
  };
}

export async function verifyOauthConnector(
  ownerId: string,
  connector: ConnectorId,
  deps: ConnectorVerifyDeps,
): Promise<ConnectorVerifyResult> {
  const label = CONNECTOR_DISPLAY_NAMES[connector];
  const started = (deps.now ?? Date.now)();
  const readToken = deps.readToken ?? getAccessToken;
  const stored = readConnection(ownerId, connector);
  if (!stored) {
    return {
      id: connector,
      kind: "oauth",
      label,
      state: "not_connected",
      detail: `${label} is not connected. No token is stored.`,
    };
  }
  let token: string | null;
  try {
    token = readToken(ownerId, connector);
  } catch (err) {
    return {
      id: connector,
      kind: "oauth",
      label,
      state: "error",
      detail: sanitizeVerifyError(err, "Token could not be decrypted."),
    };
  }
  if (!token) {
    return {
      id: connector,
      kind: "oauth",
      label,
      state: "auth_expired",
      detail: `${label} token is missing or could not be decrypted.`,
    };
  }

  const probe = OAUTH_PROBE[connector];
  const fetchImpl = deps.oauthFetch ?? defaultOauthFetch;
  try {
    const response = await withTimeout(
      fetchImpl(probe.url, {
        method: probe.method,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(probe.headers ?? {}),
          ...(probe.method === "POST"
            ? {
                "Content-Type": probe.emptyJsonBody
                  ? "application/json"
                  : "application/x-www-form-urlencoded",
              }
            : {}),
        },
        body:
          probe.method === "POST"
            ? probe.emptyJsonBody
              ? "null"
              : new URLSearchParams({ token }).toString()
            : undefined,
      }),
      deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
      `${label} verify`,
    );
    const latencyMs = Math.max(0, (deps.now ?? Date.now)() - started);

    let body: unknown = null;
    try {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > (deps.maxBytes ?? VERIFY_MAX_BYTES)) {
        return {
          id: connector,
          kind: "oauth",
          label,
          state: "error",
          latencyMs,
          detail: "Provider response was too large and was dropped.",
        };
      }
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (response.status === 401 || response.status === 403) {
      return {
        id: connector,
        kind: "oauth",
        label,
        state: "auth_expired",
        latencyMs,
        detail: `${label} rejected the token (HTTP ${response.status}).`,
      };
    }

    if (connector === "slack" && body && typeof body === "object" && (body as { ok?: unknown }).ok === false) {
      const errCode =
        typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "error";
      const expired = /invalid_auth|token_expired|not_authed|account_inactive/i.test(errCode);
      return {
        id: connector,
        kind: "oauth",
        label,
        state: expired ? "auth_expired" : "error",
        latencyMs,
        detail: sanitizeVerifyError(`Slack auth.test: ${errCode}`),
      };
    }

    if (!response.ok) {
      return {
        id: connector,
        kind: "oauth",
        label,
        state: "error",
        latencyMs,
        detail: sanitizeVerifyError(`${label} returned HTTP ${response.status}.`),
      };
    }

    return {
      id: connector,
      kind: "oauth",
      label,
      state: "ok",
      toolCount: 0,
      latencyMs,
      detail: `${label} token verified with a read-only provider call.`,
      probeTool: null,
    };
  } catch (err) {
    const latencyMs = Math.max(0, (deps.now ?? Date.now)() - started);
    if (isTimedOut(err)) {
      return {
        id: connector,
        kind: "oauth",
        label,
        state: "timeout",
        latencyMs,
        detail: sanitizeVerifyError(err, `${label} verify timed out.`),
      };
    }
    return {
      id: connector,
      kind: "oauth",
      label,
      state: "error",
      latencyMs,
      detail: sanitizeVerifyError(err),
    };
  }
}

export type VerifyTarget =
  | { type: "mcp"; id: string }
  | { type: "oauth"; id: ConnectorId }
  | { type: "all" };

/** Inventory every connector the Tools page should show. */
export function inventoryConnectors(userId: string): Array<{ id: string; kind: ConnectorKind; label: string }> {
  const servers = listRegistryServers(userId).map((s) => ({
    id: s.id,
    kind: "mcp" as const,
    label: s.label,
  }));
  const oauth = CONNECTOR_IDS.map((id) => ({
    id,
    kind: "oauth" as const,
    label: CONNECTOR_DISPLAY_NAMES[id],
  }));
  return [...servers, ...oauth];
}

export async function verifyConnectors(
  userId: string,
  target: VerifyTarget,
  deps: ConnectorVerifyDeps,
): Promise<ConnectorVerifyResult[]> {
  const servers = listRegistryServers(userId);
  const results: ConnectorVerifyResult[] = [];

  const mcpTargets = servers.filter(
    (s) => target.type === "all" || (target.type === "mcp" && target.id === s.id),
  );

  // One tools/list pass for external MCP when verifying all (or multiple), then per-server probe.
  let listed: ListedTool[] | null = null;
  const needsExternalList = mcpTargets.some((s) => s.kind !== "builtin");
  if (needsExternalList) {
    try {
      const listFn = deps.listTools ?? listRegistryTools;
      listed = await withTimeout(
        listFn(userId, deps.fetch ?? (globalThis.fetch as FetchLike), {
          http: httpOpts(deps),
          stdio: deps.stdio,
          isHalted: deps.isHalted,
        }),
        deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
        "MCP tools/list",
      );
    } catch (err) {
      // Fall through: each server verify will report its own error/timeout.
      if (isTimedOut(err)) {
        for (const server of mcpTargets) {
          if (server.kind === "builtin") {
            results.push(await verifyMcpServer(userId, server, deps));
          } else {
            results.push({
              id: server.id,
              kind: "mcp",
              label: server.label,
              state: "timeout",
              detail: sanitizeVerifyError(err, "MCP tools/list timed out."),
              probeTool: null,
            });
          }
        }
        for (const id of CONNECTOR_IDS) {
          if (target.type === "all" || (target.type === "oauth" && target.id === id)) {
            results.push(await verifyOauthConnector(userId, id, deps));
          }
        }
        return results;
      }
      listed = null;
    }
  }

  for (const server of mcpTargets) {
    const forServer = listed ? listed.filter((t) => t.serverId === server.id) : undefined;
    results.push(await verifyMcpServer(userId, server, deps, forServer));
  }

  for (const id of CONNECTOR_IDS) {
    if (target.type === "all" || (target.type === "oauth" && target.id === id)) {
      results.push(await verifyOauthConnector(userId, id, deps));
    }
  }

  if (target.type === "mcp" && !results.some((r) => r.id === target.id)) {
    results.push({
      id: target.id,
      kind: "mcp",
      label: target.id,
      state: "error",
      detail: "That MCP server is not registered.",
    });
  }

  return results;
}

