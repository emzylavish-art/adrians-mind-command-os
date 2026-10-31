import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmationKey, runAgentTurn, type AgentTool } from "./orchestrator.ts";
import { hostedDatabaseDecision } from "./hosted-db.ts";
import { synthesizeSpeech } from "./speech.ts";

const projects: AgentTool = { id: "list_projects", confirm: false, available: true, unavailableReason: "", run: () => ({ ok: true, text: "Harbor" }) };
const notes: AgentTool = { id: "search_notes", confirm: false, available: true, unavailableReason: "", run: () => ({ ok: true, text: "dock note" }) };
const due: AgentTool = { id: "run_due_schedules", confirm: true, available: true, unavailableReason: "", run: () => ({ ok: true, text: "queued" }) };
const notion: AgentTool = { id: "notion", confirm: false, available: false, unavailableReason: "Notion is not connected. Nothing was searched.", run: () => ({ ok: true, text: "should not run" }) };

describe("agent orchestrator", () => {
  it("runs one real tool and returns only that result", () => {
    const turn = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "show my projects", modality: "chat", tools: [projects], toolId: "list_projects" });
    assert.equal(turn.status, "completed");
    assert.equal(turn.text, "Harbor");
    assert.equal(turn.calls, 1);
    assert.equal(turn.events.some((event) => event.status === "completed"), true);
  });

  it("feeds a tool result back to the model and stops at the call limit", () => {
    let seen = "";
    const turn = runAgentTurn({
      userId: "owner-a",
      sessionId: "chat-1",
      text: "show my projects",
      modality: "chat",
      tools: [projects, notes],
      toolId: "list_projects",
      maxCalls: 3,
      complete: (prompt) => {
        seen = prompt;
        return prompt.includes("dock") ? { ok: true, text: "done" } : { ok: true, text: "", toolId: "search_notes" };
      },
    });
    assert.equal(turn.status, "completed");
    assert.match(seen, /Harbor/);
    assert.equal(turn.text, "done");
    assert.equal(turn.calls, 2);
  });

  it("does not run a disconnected tool, a failed tool, or a model that failed", () => {
    const down = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "search notion", modality: "chat", tools: [notion], toolId: "notion" });
    assert.equal(down.status, "failed");
    assert.match(down.text, /not connected/);
    const failed = runAgentTurn({
      userId: "owner-a",
      sessionId: "chat-1",
      text: "show my projects",
      modality: "chat",
      tools: [{ ...projects, run: () => ({ ok: false, text: "The read failed." }) }],
      toolId: "list_projects",
    });
    assert.equal(failed.status, "failed");
    assert.match(failed.text, /read failed/);
    const model = runAgentTurn({
      userId: "owner-a",
      sessionId: "chat-1",
      text: "show my projects",
      modality: "chat",
      tools: [projects],
      toolId: "list_projects",
      complete: () => ({ ok: false, text: "" }),
    });
    assert.match(model.text, /not substituted/);
  });

  it("requires the same user, session, and input before a confirmed action", () => {
    const first = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "run due schedules", modality: "chat", tools: [due], toolId: "run_due_schedules", nowMs: 1_000 });
    assert.equal(first.status, "awaiting_confirmation");
    assert.equal(first.calls, 0);
    const grant = first.confirm;
    assert.ok(grant);
    const other = runAgentTurn({ userId: "owner-b", sessionId: "chat-1", text: "run due schedules", modality: "chat", tools: [due], toolId: "run_due_schedules", confirm: grant, nowMs: 1_000 });
    assert.match(other.text, /confirmation|Nothing ran/);
    const changed = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "run due schedules now", modality: "chat", tools: [due], toolId: "run_due_schedules", confirm: grant, nowMs: 1_000 });
    assert.equal(changed.status, "awaiting_confirmation");
    const stale = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "run due schedules", modality: "chat", tools: [due], toolId: "run_due_schedules", confirm: { ...grant, at: new Date(0).toISOString() }, nowMs: 11 * 60_000 });
    assert.match(stale.text, /stale/);
    const ok = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "run due schedules", modality: "chat", tools: [due], toolId: "run_due_schedules", confirm: grant, nowMs: 1_000 });
    assert.equal(ok.status, "completed");
    assert.equal(ok.text, "queued");
    assert.equal(confirmationKey("owner-a", "chat-1", "run_due_schedules", "run due schedules"), `${"owner-a"}|chat-1|run_due_schedules|run due schedules`);
  });

  it("cancels, times out, and refuses an unknown tool", () => {
    const cancelled = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "show my projects", modality: "voice", tools: [projects], toolId: "list_projects", signal: { aborted: true } });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.calls, 0);
    const timed = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "show my projects", modality: "chat", tools: [projects], toolId: "list_projects", timeoutMs: 10, startedMs: 0, nowMs: 50 });
    assert.equal(timed.status, "timed_out");
    const missing = runAgentTurn({ userId: "owner-a", sessionId: "chat-1", text: "go", modality: "chat", tools: [], toolId: "missing" });
    assert.match(missing.text, /not registered/);
    const limit = runAgentTurn({
      userId: "owner-a",
      sessionId: "chat-1",
      text: "show my projects",
      modality: "chat",
      tools: [projects],
      maxCalls: 1,
      complete: () => ({ ok: true, text: "", toolId: "list_projects" }),
    });
    assert.match(limit.text, /Stopped after 1/);
  });
});

describe("hosted database and speech", () => {
  it("does not use a forbidden Supabase project and does not call speech without a voice key", async () => {
    const decision = hostedDatabaseDecision([{ ref: "ybxowvzicirinpdcfyqe" }, { ref: "espmxiitzucooxblmnpr" }], ["ybxowvzicirinpdcfyqe", "espmxiitzucooxblmnpr"]);
    assert.equal(decision.connected, false);
    assert.equal(decision.realtime, false);
    assert.match(decision.reason, /forbidden/);
    let called = false;
    const speech = await synthesizeSpeech({
      text: "hello",
      voiceKey: undefined,
      fetch: async () => {
        called = true;
        return { ok: true, status: 200, bytes: async () => new Uint8Array(40) };
      },
    });
    assert.equal(called, false);
    assert.match(speech.error, /chat key is not used/);
  });
});
