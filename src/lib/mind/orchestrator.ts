export type ToolStatus = "queued" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled" | "timed_out";

export type AgentTool = {
  id: string;
  confirm: boolean;
  available: boolean;
  unavailableReason: string;
  run: (text: string) => { ok: boolean; text: string };
};

export type ToolEvent = { id: string; toolId: string; status: ToolStatus; text: string; atMs?: number };

export type ConfirmGrant = { userId: string; sessionId: string; toolId: string; input: string; at: string };

export function confirmationKey(userId: string, sessionId: string, toolId: string, input: string) {
  return `${userId}|${sessionId}|${toolId}|${input.trim()}`;
}

export function selectTool(text: string): string | null {
  const lower = text.toLowerCase();
  if (/turn (this|that) into a reusable skill/.test(lower) || /make this a reusable skill/.test(lower)) return "save_chat_skill";
  if (/\brun due schedules\b/.test(lower)) return "run_due_schedules";
  if (/\b(list|show)\s+(my\s+)?schedules\b/.test(lower)) return "list_schedules";
  if (/\b(list|show)\s+(my\s+)?projects\b/.test(lower)) return "list_projects";
  if (/\b(list|show)\s+(my\s+)?(chats|conversations)\b/.test(lower)) return "list_chats";
  if (/\bsearch\s+(my\s+)?notes\b/.test(lower)) return "search_notes";
  if (/\bskills?\b/.test(lower)) return "search_skills";
  if (/\bnotion\b/.test(lower)) return "notion";
  if (/\brealtime voice\b/.test(lower)) return "realtime_voice";
  return null;
}

export function runAgentTurn(input: {
  userId: string;
  sessionId: string;
  text: string;
  modality: "chat" | "voice";
  tools: AgentTool[];
  maxCalls?: number;
  timeoutMs?: number;
  startedMs?: number;
  nowMs?: number;
  signal?: { aborted: boolean };
  confirm?: ConfirmGrant | null;
  toolId?: string | null;
  complete?: (prompt: string) => { ok: boolean; text: string; toolId?: string };
  /** Optional observer for UI timelines. Does not change tool selection or outcomes. */
  onEvent?: (event: ToolEvent) => void;
}): { status: ToolStatus | "completed"; text: string; events: ToolEvent[]; confirm: ConfirmGrant | null; calls: number } {
  const maxCalls = input.maxCalls ?? 3;
  const events: ToolEvent[] = [];
  const emit = (event: ToolEvent) => {
    // Wall-clock stamp for UI elapsed time; timeout/staleness still use input.nowMs.
    const stamped = { ...event, atMs: event.atMs ?? Date.now() };
    events.push(stamped);
    input.onEvent?.(stamped);
  };
  const results: string[] = [];
  let calls = 0;
  let pending = input.confirm ?? null;
  const choose = (prompt: string) => (input.complete ? input.complete(prompt).toolId : selectTool(prompt)) ?? null;

  if (!input.userId || !input.sessionId) {
    return { status: "failed", text: "The session could not be verified. Nothing ran.", events, confirm: null, calls: 0 };
  }
  if (input.signal?.aborted) {
    return { status: "cancelled", text: "The turn was cancelled. Nothing else ran.", events, confirm: null, calls: 0 };
  }

  let nextTool = input.toolId ?? choose(input.text);
  let guard = 0;
  while (nextTool && guard < maxCalls + 1) {
    guard += 1;
    if (input.signal?.aborted) {
      return { status: "cancelled", text: "The turn was cancelled. Completed tool results were kept.", events, confirm: null, calls };
    }
    if (input.timeoutMs != null && input.startedMs != null && input.nowMs != null && input.nowMs - input.startedMs > input.timeoutMs) {
      emit({ id: `timeout-${guard}`, toolId: nextTool, status: "timed_out", text: "The turn timed out. Nothing else ran." });
      return { status: "timed_out", text: "The turn timed out. Nothing else ran.", events, confirm: null, calls };
    }
    if (calls >= maxCalls) {
      return { status: "failed", text: `Stopped after ${maxCalls} tool calls. Nothing else ran.`, events, confirm: null, calls };
    }
    const tool = input.tools.find((item) => item.id === nextTool);
    if (!tool) {
      emit({ id: `missing-${guard}`, toolId: nextTool, status: "failed", text: "That tool is not registered. Nothing ran." });
      return { status: "failed", text: "That tool is not registered. Nothing ran.", events, confirm: null, calls };
    }
    if (!tool.available) {
      emit({ id: `down-${tool.id}`, toolId: tool.id, status: "failed", text: tool.unavailableReason });
      return { status: "failed", text: tool.unavailableReason, events, confirm: null, calls };
    }
    if (tool.confirm) {
      const key = confirmationKey(input.userId, input.sessionId, tool.id, input.text);
      const grant = pending;
      pending = null;
      if (!grant || confirmationKey(grant.userId, grant.sessionId, grant.toolId, grant.input) !== key) {
        const fresh: ConfirmGrant = { userId: input.userId, sessionId: input.sessionId, toolId: tool.id, input: input.text.trim(), at: new Date(input.nowMs ?? Date.now()).toISOString() };
        emit({ id: `wait-${tool.id}`, toolId: tool.id, status: "awaiting_confirmation", text: `Waiting for confirmation before ${tool.id}.` });
        return { status: "awaiting_confirmation", text: `Waiting for confirmation before ${tool.id}. Nothing ran.`, events, confirm: fresh, calls };
      }
      if (input.nowMs != null && input.nowMs - Date.parse(grant.at) > 10 * 60_000) {
        return { status: "failed", text: "That confirmation is stale. Nothing ran.", events, confirm: null, calls };
      }
    }
    calls += 1;
    emit({ id: `run-${tool.id}-${calls}`, toolId: tool.id, status: "running", text: `Running ${tool.id}.` });
    const outcome = tool.run(input.text);
    emit({ id: `done-${tool.id}-${calls}`, toolId: tool.id, status: outcome.ok ? "completed" : "failed", text: outcome.text });
    if (!outcome.ok) return { status: "failed", text: outcome.text || "The tool failed. Nothing was invented.", events, confirm: null, calls };
    results.push(outcome.text);
    if (!input.complete) break;
    const model = input.complete(results.join("\n"));
    if (!model.ok) return { status: "failed", text: "The model did not answer. Another provider was not substituted.", events, confirm: null, calls };
    if (!model.toolId) return { status: "completed", text: model.text, events, confirm: null, calls };
    nextTool = model.toolId;
  }
  const text = results.join("\n") || "No tool was needed.";
  return { status: "completed", text, events, confirm: null, calls };
}
