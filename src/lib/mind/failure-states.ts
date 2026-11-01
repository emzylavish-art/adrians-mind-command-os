/**
 * Honest UI failure states already defined in this app.
 * Messages match server/client copy in turn.server, server.ts, policy, fleet, and live-turn.
 * Banner 5 (mcp_tool_failed) matches the MCP integration copy in mcp.ts / mcp/registry.ts / mcp/tools.ts
 * (status "error", ok false, "Nothing was called." / "Nothing was invented.").
 */

export type HonestFailureKind = "model_unavailable" | "database_write_failed" | "emergency_stop_active" | "mcp_tool_failed";

export const HONEST_FAILURE_MESSAGES = {
  model_unavailable: "That model is not available. Another provider is not substituted.",
  model_unreachable: "Grok could not be reached.",
  model_unconfigured: "Grok is not configured on the server.",
  database_write_failed: "The server copy could not be saved. The browser copy was kept.",
  emergency_stop_active: "Emergency stop is on. No new action can run.",
  mcp_tool_failed: "The MCP tool call failed. Nothing was invented.",
  mcp_unreachable: "The MCP server could not be reached. Nothing was called.",
} as const;

export const HONEST_FAILURE_ACTIONS: Record<HonestFailureKind, string> = {
  model_unavailable: "model_unavailable",
  database_write_failed: "database_write_failed",
  emergency_stop_active: "emergency_stop_active",
  mcp_tool_failed: "mcp_tool_failed",
};

/** Copy the MCP integration code returns when a tool call fails (status "error"). */
const MCP_TOOL_FAILURE_MARKERS = [
  "The MCP server could not be reached",
  "The MCP server returned",
  "The MCP server did not return a JSON-RPC result",
  "The MCP server returned no text",
  "MCP returned nothing",
  "That MCP server is not registered",
  "No MCP server is saved",
  "Unknown built-in tool",
  "Stdio MCP command servers are registered but not executed",
  "No paired PC online",
  "PGLite query error:",
  "MCP tool failed",
  "The MCP tool call failed",
];

const MCP_TOOL_FAILURE_PATTERNS = [/^MCP server “.+” is disabled\./, /^MCP tool “.+” failed\./];

const MODEL_UNAVAILABLE_MARKERS = [
  HONEST_FAILURE_MESSAGES.model_unavailable,
  HONEST_FAILURE_MESSAGES.model_unreachable,
  HONEST_FAILURE_MESSAGES.model_unconfigured,
  "No Grok key is configured",
  "Another provider is not substituted",
  "Grok did not answer in time",
  "Grok returned an empty reply",
  "That provider is not known",
];

export function classifyHonestFailure(message: string): HonestFailureKind | null {
  const text = message.trim();
  if (!text) return null;
  if (text === HONEST_FAILURE_MESSAGES.emergency_stop_active || text.startsWith("Emergency stop is on.")) {
    return "emergency_stop_active";
  }
  if (text === HONEST_FAILURE_MESSAGES.database_write_failed || text.includes("could not be saved")) {
    return "database_write_failed";
  }
  if (MCP_TOOL_FAILURE_PATTERNS.some((pattern) => pattern.test(text)) || MCP_TOOL_FAILURE_MARKERS.some((marker) => text.includes(marker))) {
    return "mcp_tool_failed";
  }
  if (MODEL_UNAVAILABLE_MARKERS.some((marker) => text.includes(marker))) {
    return "model_unavailable";
  }
  return null;
}

export function honestFailureDescription(kind: HonestFailureKind, message?: string): string {
  if (message?.trim()) return message.trim();
  switch (kind) {
    case "model_unavailable":
      return HONEST_FAILURE_MESSAGES.model_unreachable;
    case "database_write_failed":
      return HONEST_FAILURE_MESSAGES.database_write_failed;
    case "emergency_stop_active":
      return HONEST_FAILURE_MESSAGES.emergency_stop_active;
    case "mcp_tool_failed":
      return HONEST_FAILURE_MESSAGES.mcp_tool_failed;
  }
}

export function honestFailureAuditAction(kind: HonestFailureKind): string {
  return HONEST_FAILURE_ACTIONS[kind];
}

/** Retry keeps the same parameters object identity for the caller's closure to re-invoke. */
export function bindRetry<T extends unknown[]>(action: (...args: T) => void, args: T): () => void {
  return () => action(...args);
}

/**
 * Shape shared by the MCP integration results: mcpCommand (ok/error/text/needsConfirmation),
 * callRegistryTool (status/ok/serverId/tool/text), and the built-in tool handlers (status/ok/text).
 */
export type McpToolCallOutcome = {
  ok: boolean;
  status?: "running" | "ok" | "error";
  text?: string;
  error?: string;
  tool?: string;
  serverId?: string;
  needsConfirmation?: boolean;
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Banner 5: an MCP tool call that came back failed. Returns null for success, a pending
 * confirmation (nothing was called yet, not a failure), or a still-running call.
 * The description is one line and keeps the server's honest copy unchanged.
 */
export function mcpToolFailure(outcome: McpToolCallOutcome): { kind: "mcp_tool_failed"; message: string; target: string } | null {
  if (outcome.needsConfirmation) return null;
  if (outcome.status === "running") return null;
  if (outcome.ok && outcome.status !== "error") return null;
  const detail = oneLine(outcome.error || "") || oneLine(outcome.text || "");
  const tool = outcome.tool?.trim();
  const prefix = tool ? `MCP tool “${tool}” failed.` : "";
  const body = detail || HONEST_FAILURE_MESSAGES.mcp_tool_failed;
  const message = prefix ? `${prefix} ${body}` : classifyHonestFailure(body) === "mcp_tool_failed" ? body : `MCP tool failed. ${body}`;
  const target = outcome.serverId || tool ? `mcp:${outcome.serverId ?? "?"}/${tool ?? "?"}` : "mcp";
  return { kind: "mcp_tool_failed", message, target };
}
