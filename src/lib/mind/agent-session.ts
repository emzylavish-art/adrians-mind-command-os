import { relevantMemories } from "./memory.ts";
import { runAgentTurn, type AgentTool } from "./orchestrator.ts";
import type { Workspace } from "./types.ts";

export function applyAgentTurn(ws: Workspace, input: {
  chatId: string;
  text: string;
  modality: "chat" | "voice";
  tools: AgentTool[];
  toolId?: string;
  now: string;
  memories?: { id: string; text: string; archived?: boolean }[];
  complete?: (prompt: string) => { ok: boolean; text: string; toolId?: string };
}): {
  ws: Workspace;
  status: string;
  finalText: string;
  run: { id: string; tool: string; action: string; ok: boolean; detail: string } | null;
} {
  const remembered = relevantMemories(input.memories ?? [], input.text);
  const complete = input.complete
    ? (prompt: string) => input.complete!(remembered.length ? `Remembered:\n${remembered.map((item) => item.text).join("\n")}\n\n${prompt}` : prompt)
    : undefined;
  const turn = runAgentTurn({
    userId: input.chatId ? "session" : "",
    sessionId: input.chatId,
    text: input.text,
    modality: input.modality,
    tools: input.tools,
    toolId: input.toolId,
    nowMs: Date.parse(input.now),
    complete,
  });
  if (!input.chatId || turn.status === "awaiting_confirmation" || turn.status === "cancelled") {
    const audit = input.chatId
      ? [{ id: `audit-${input.chatId}-${input.now}`, at: input.now, action: turn.status === "cancelled" ? "agent_cancelled" : "awaiting_confirmation", target: input.toolId ?? "none", result: turn.text.slice(0, 300) }, ...ws.audit].slice(0, 200)
      : ws.audit;
    return { ws: { ...ws, audit }, status: turn.status, finalText: turn.text, run: null };
  }
  const existing = ws.chats.find((chat) => chat.id === input.chatId);
  const chat = existing ?? {
    id: input.chatId,
    title: input.text.replace(/\s+/g, " ").slice(0, 48),
    memory: "off" as const,
    temporary: false,
    autonomy: "ask" as const,
    projectId: null,
    messages: [],
    retrievalLog: [],
  };
  const at = input.now;
  const messages = [
    ...chat.messages,
    { id: `user-${at}`, role: "user" as const, content: input.text, at },
    { id: `assistant-${at}`, role: "assistant" as const, content: turn.text, at, model: input.complete ? "model" : "local-tool" },
  ];
  const next = { ...chat, title: chat.messages.length > 0 ? chat.title : input.text.replace(/\s+/g, " ").slice(0, 48), messages };
  const chats = existing ? ws.chats.map((item) => (item.id === chat.id ? next : item)) : [next, ...ws.chats];
  const toolEvent = [...turn.events].reverse().find((event) => event.status === "completed" || event.status === "failed");
  const run = toolEvent
    ? { id: `run-${input.chatId}-${at}`, tool: toolEvent.toolId, action: input.modality, ok: toolEvent.status === "completed", detail: toolEvent.text.slice(0, 500) }
    : null;
  const audit = [{ id: `audit-${input.chatId}-${at}`, at, action: "agent_turn", target: toolEvent?.toolId ?? "none", result: `${input.modality} ${turn.status}`.slice(0, 300) }, ...ws.audit].slice(0, 200);
  return { ws: { ...ws, chats, audit }, status: turn.status, finalText: turn.text, run };
}
