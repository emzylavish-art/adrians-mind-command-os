export type AdvertisedState = "advertised" | "not_advertised" | "unknown";

export type CapabilityFlag = {
  path: string;
  state: "advertised" | "not_advertised";
};

export type CapabilityInventory = {
  agent: { name?: string; version?: string };
  flags: CapabilityFlag[];
  sessionMethods: {
    fork: AdvertisedState;
    load: AdvertisedState;
  };
  evidence: "initialize" | "missing_initialize_capabilities";
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = [...value].map((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function safeLabel(value: unknown, max = 180): string | undefined {
  const text = boundedText(value, max);
  if (!text) return undefined;
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function collectBooleanFlags(value: unknown, path: string, out: CapabilityFlag[], depth: number): void {
  if (out.length >= 100 || depth > 5 || !isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (out.length >= 100) return;
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === "boolean") {
      out.push({ path: childPath, state: child ? "advertised" : "not_advertised" });
    } else if (isObject(child)) {
      collectBooleanFlags(child, childPath, out, depth + 1);
    }
  }
}

function explicitSessionMethodState(capabilities: unknown, method: "session/fork" | "session/load"): AdvertisedState {
  if (!isObject(capabilities)) return "unknown";
  const advertisedMethods = capabilities.supportedMethods;
  if (!Array.isArray(advertisedMethods) || !advertisedMethods.every((item) => typeof item === "string")) return "unknown";
  return advertisedMethods.includes(method) ? "advertised" : "not_advertised";
}

/**
 * Build a non-inferential view of ACP initialize data. Only booleans explicitly
 * reported by the runtime are surfaced; missing fields stay unknown. Raw
 * capability objects and arbitrary metadata are never returned to the UI.
 */
export function inventoryInitializeCapabilities(response: unknown): CapabilityInventory {
  const root = isObject(response) ? response : {};
  const agentInfo = isObject(root.agentInfo) ? root.agentInfo : {};
  const capabilities = root.agentCapabilities;
  const flags: CapabilityFlag[] = [];
  collectBooleanFlags(capabilities, "", flags, 0);

  return {
    agent: {
      ...(safeLabel(agentInfo.name, 100) ? { name: safeLabel(agentInfo.name, 100) } : {}),
      ...(safeLabel(agentInfo.version, 60) ? { version: safeLabel(agentInfo.version, 60) } : {}),
    },
    flags: flags.sort((a, b) => a.path.localeCompare(b.path)),
    sessionMethods: {
      fork: explicitSessionMethodState(capabilities, "session/fork"),
      load: explicitSessionMethodState(capabilities, "session/load"),
    },
    evidence: isObject(capabilities) ? "initialize" : "missing_initialize_capabilities",
  };
}

export type TimelineEvent = {
  kind: "assistant_message" | "tool_call" | "tool_call_update" | "plan_progress" | "unknown_update";
  updateType: string;
  summary: string;
  text?: string;
  callId?: string;
  title?: string;
  status?: "pending" | "running" | "completed" | "failed" | "unknown";
  planStepCount?: number;
  completedStepCount?: number;
};

function safeStatus(value: unknown): TimelineEvent["status"] {
  if (value === "pending" || value === "running" || value === "in_progress") return value === "in_progress" ? "running" : value;
  if (value === "completed" || value === "done") return "completed";
  if (value === "failed" || value === "error") return "failed";
  return "unknown";
}

/**
 * Convert ACP session/update data into a small, UI-safe Timeline payload.
 * Tool arguments/results and raw update payloads are deliberately omitted.
 * Private reasoning/thinking updates are suppressed rather than rendered.
 */
export function normalizeSessionUpdate(input: unknown): TimelineEvent | null {
  const envelope = isObject(input) ? input : {};
  const update = isObject(envelope.update) ? envelope.update : envelope;
  const updateType = boundedText(update.sessionUpdate, 80);
  if (!updateType) return null;
  if (/reason|thought|chain.of.thought|thinking/i.test(updateType)) return null;

  if (updateType === "agent_message_chunk") {
    const content = isObject(update.content) ? update.content : {};
    if (content.type !== "text") return null;
    const text = safeLabel(content.text, 4_000);
    if (!text) return null;
    return { kind: "assistant_message", updateType, summary: "Assistant response chunk", text };
  }

  if (updateType === "tool_call" || updateType === "tool_call_update") {
    const callId = safeLabel(update.toolCallId, 120);
    const title = safeLabel(update.title, 180);
    const status = safeStatus(update.status);
    return {
      kind: updateType,
      updateType,
      summary: updateType === "tool_call" ? "Tool call started" : "Tool call status updated",
      ...(callId ? { callId } : {}),
      ...(title ? { title } : {}),
      status,
    };
  }

  if (updateType === "plan") {
    const entries = Array.isArray(update.entries) ? update.entries : [];
    const completedStepCount = entries.filter((entry) => isObject(entry) && (entry.status === "completed" || entry.status === "done")).length;
    return {
      kind: "plan_progress",
      updateType,
      summary: "Plan progress updated",
      planStepCount: Math.min(entries.length, 200),
      completedStepCount: Math.min(completedStepCount, 200),
    };
  }

  return { kind: "unknown_update", updateType, summary: "Unrecognized ACP update received" };
}

export type PublicMcpServer = {
  id: string;
  label: string;
  kind: "builtin" | "http" | "command";
  enabled: boolean;
  command?: string;
  args?: string[];
  envKeys?: string[];
};

export type AcpMcpServer = {
  name: string;
  command: string;
  args: string[];
};

export type McpMappingDecision = {
  serverId: string;
  state: "mapped" | "disabled" | "approval_required" | "transport_unverified" | "command_not_allowlisted" | "secret_injection_unavailable" | "invalid";
};

export type McpMappingResult = {
  servers: AcpMcpServer[];
  decisions: McpMappingDecision[];
};

function acpName(input: string): string | undefined {
  const name = input.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return name || undefined;
}

/**
 * Project only explicitly approved, enabled, allowlisted stdio MCP servers.
 * Current Adrian HTTP/OAuth and built-in connectors are not converted because
 * the captured Kimi runtime's transport/auth contract is not verified. Secret
 * environment injection is also intentionally blocked until a secure runtime
 * resolver is connected.
 */
export function mapApprovedMcpServers(
  entries: readonly PublicMcpServer[],
  options: { approvedServerIds: ReadonlySet<string>; allowedCommands: ReadonlySet<string>; verifiedTransports: ReadonlySet<"stdio"> },
): McpMappingResult {
  const servers: AcpMcpServer[] = [];
  const decisions: McpMappingDecision[] = [];
  const names = new Set<string>();

  for (const entry of entries.slice(0, 100)) {
    const decide = (state: McpMappingDecision["state"]) => decisions.push({ serverId: boundedText(entry.id, 120) ?? "unknown", state });
    if (!entry.id || !entry.label) { decide("invalid"); continue; }
    if (!entry.enabled) { decide("disabled"); continue; }
    if (!options.approvedServerIds.has(entry.id)) { decide("approval_required"); continue; }
    if (entry.kind !== "command") { decide("transport_unverified"); continue; }
    if (!options.verifiedTransports.has("stdio")) { decide("transport_unverified"); continue; }
    if (typeof entry.command !== "string" || !options.allowedCommands.has(entry.command)) { decide("command_not_allowlisted"); continue; }
    if ((entry.envKeys?.length ?? 0) > 0) { decide("secret_injection_unavailable"); continue; }
    const name = acpName(entry.id);
    if (!name || names.has(name)) { decide("invalid"); continue; }
    const args = Array.isArray(entry.args) ? entry.args.slice(0, 20).filter((arg) => typeof arg === "string" && arg.length <= 300) : [];
    if (Array.isArray(entry.args) && args.length !== entry.args.length) { decide("invalid"); continue; }
    if (args.some((arg) => /\b(bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=])/i.test(arg))) {
      decide("secret_injection_unavailable");
      continue;
    }
    names.add(name);
    servers.push({ name, command: entry.command, args });
    decide("mapped");
  }

  return { servers, decisions };
}
