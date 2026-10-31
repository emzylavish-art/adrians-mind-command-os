import { runLocalPlan, type LocalTool } from "./local-tools.ts";
import type { Autonomy } from "./policy.ts";
import type { Workspace } from "./types.ts";

export const AGENT_MAX_STEPS = 4;
export const AGENT_DEADLINE_MS = 20_000;

export const AGENT_TOOLS = [
  {
    name: "list_projects",
    description: "List project names stored on this device.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_chats",
    description: "List chat titles stored on this device.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "search_notes",
    description: "Find notes on this device that contain a word. This does not search the web.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string" } },
    },
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number]["name"];

export type AgentToolCall = { id: string; name: string; arguments: unknown };

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AgentModel = (input: { messages: AgentMessage[]; signal: AbortSignal }) => Promise<{ text: string; toolCalls: AgentToolCall[] }>;

export type AgentLogEntry = { step: number; tool: string; ok: boolean; detail: string };

export type AgentRunResult = { ok: boolean; text: string; log: AgentLogEntry[]; error?: string };

const STOPPED = "Stopped. The unfinished reply was not saved.";

export function validateToolCall(call: AgentToolCall): { ok: true; tool: AgentToolName; query?: string } | { ok: false; error: string } {
  const known = AGENT_TOOLS.find((tool) => tool.name === call.name);
  if (!known) return { ok: false, error: "That tool is not registered." };
  const args = call.arguments == null ? {} : call.arguments;
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "Tool arguments must be an object." };
  const record = args as Record<string, unknown>;
  if (known.name === "search_notes") {
    if (typeof record.query !== "string" || !record.query.trim()) return { ok: false, error: "search_notes requires a query string." };
    return { ok: true, tool: "search_notes", query: record.query.trim().slice(0, 200) };
  }
  return { ok: true, tool: known.name };
}

export function toProviderMessages(messages: AgentMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export function readAgentMessage(payload: unknown): { text: string; toolCalls: AgentToolCall[] } {
  const message = (payload as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] } | null)?.choices?.[0]?.message;
  const text = typeof message?.content === "string" ? message.content : "";
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: AgentToolCall[] = [];
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const record = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof record.function?.name === "string" ? record.function.name : "";
    let args: unknown = {};
    const raw = record.function?.arguments;
    if (typeof raw === "string") {
      try {
        args = JSON.parse(raw) as unknown;
      } catch {
        args = raw;
      }
    } else if (raw && typeof raw === "object") args = raw;
    toolCalls.push({ id: typeof record.id === "string" ? record.id : `call-${toolCalls.length + 1}`, name, arguments: args });
  }
  return { text, toolCalls };
}

export function buildAgentModelBody(messages: AgentMessage[]) {
  return {
    model: "grok-4.5",
    messages: toProviderMessages(messages),
    tools: AGENT_TOOLS.map((tool) => ({ type: "function", function: tool })),
    tool_choice: "auto",
    max_tokens: 500,
    temperature: 0.2,
    stream: false,
  };
}

export async function runBoundedAgent(input: {
  ws: Workspace;
  goal: string;
  model: AgentModel;
  signal: AbortSignal;
  autonomy: Autonomy;
  halted: boolean;
  approved: boolean;
  maxSteps?: number;
  deadlineMs?: number;
  now?: () => number;
  execute?: (ws: Workspace, tool: LocalTool, query?: string) => { ok: boolean; lines: string[] };
}): Promise<AgentRunResult> {
  const maxSteps = input.maxSteps ?? AGENT_MAX_STEPS;
  const started = (input.now ?? Date.now)();
  const deadline = started + (input.deadlineMs ?? AGENT_DEADLINE_MS);
  const now = input.now ?? Date.now;
  const log: AgentLogEntry[] = [];
  const goal = input.goal.trim().slice(0, 2000);
  if (!goal) return { ok: false, text: "", log, error: "Write what the agent should do." };
  if (input.halted) return { ok: false, text: "", log, error: "Emergency stop is on. No new action can run." };
  if (!input.approved) return { ok: false, text: "", log, error: "This agent run was not approved." };

  const execute = input.execute ?? ((ws: Workspace, tool: LocalTool, query?: string) =>
    runLocalPlan(ws, [{ id: tool, tool, query }], {
      autonomy: "automatic",
      halted: false,
      tokens: { [tool]: `approve:${tool}` },
    }));
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: "You may only call list_projects, list_chats, and search_notes. They read this device. Do not claim a web search, a file change, or a shell command. When you are finished, answer with no tool call.",
    },
    { role: "user", content: goal },
  ];
  let toolsRun = 0;
  while (toolsRun <= maxSteps) {
    if (input.signal.aborted) return { ok: false, text: "", log, error: STOPPED };
    if (now() >= deadline) return { ok: false, text: "", log, error: "The agent stopped because it ran out of time. Nothing was marked finished." };
    let reply: { text: string; toolCalls: AgentToolCall[] };
    try {
      reply = await input.model({ messages, signal: input.signal });
    } catch {
      return { ok: false, text: "", log, error: input.signal.aborted ? STOPPED : "The model did not answer. Nothing was marked finished." };
    }
    if (input.signal.aborted) return { ok: false, text: "", log, error: STOPPED };
    const call = reply.toolCalls[0];
    if (!call) {
      const text = reply.text.trim();
      if (!text) return { ok: false, text: "", log, error: "The model returned an empty reply." };
      return { ok: true, text, log };
    }
    if (toolsRun >= maxSteps) return { ok: false, text: "", log, error: `Stopped after ${maxSteps} tool steps.` };
    toolsRun += 1;
    const parsed = validateToolCall(call);
    if (!parsed.ok) {
      log.push({ step: toolsRun, tool: call.name || "unknown", ok: false, detail: parsed.error });
      return { ok: false, text: "", log, error: parsed.error };
    }
    const executed = execute(input.ws, parsed.tool, parsed.query);
    const detail = executed.lines.join(" ").slice(0, 500);
    log.push({ step: toolsRun, tool: parsed.tool, ok: executed.ok, detail });
    if (!executed.ok) return { ok: false, text: "", log, error: detail || "The tool failed." };
    messages.push({ role: "assistant", content: reply.text, toolCalls: [call] });
    messages.push({ role: "tool", toolCallId: call.id, name: parsed.tool, content: detail });
  }
  return { ok: false, text: "", log, error: `Stopped after ${maxSteps} tool steps.` };
}
