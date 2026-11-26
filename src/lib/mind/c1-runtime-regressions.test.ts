import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProviderReceipt } from "./provider-call.ts";
import { executeConsultPlan, planModelConsult } from "./model-consult.ts";
import { addAgentFromTemplate, enqueueRun, tickFleet, runDueSchedules, addSchedule, cancelRun, readFleet } from "./fleet.ts";
import { countRuns } from "./core-runtime.ts";
import { emptyWorkspace } from "./workspace.ts";
import { DEFAULT_RESOURCE_POLICY, readResourcePolicy, resourceEstimate, resourcePlanAllowed, isAutomaticallyFreeModelRoute } from "./resource-policy.ts";
import { modelExecutionPlan } from "./execution-plan.ts";

const modules = ["grok", "openai", "gemini", "anthropic"].map((id) => ({ id, label: id, connected: true }));
test("AA014 preserves provider counters, identity and finish metadata without fabricating missing counters", () => {
  assert.deepEqual(normalizeProviderReceipt("anthropic", { id: "req", stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 0 } }), { usage: { prompt_tokens: 12, completion_tokens: 0 }, requestId: "req", finishReason: "end_turn" });
  assert.deepEqual(normalizeProviderReceipt("gemini", { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: -1 }, responseId: "g", candidates: [{ finishReason: "STOP" }] }).usage, { prompt_tokens: 4 });
  assert.equal(normalizeProviderReceipt("openai", { usage: { prompt_tokens: "20" } }).usage, null);
  assert.deepEqual(normalizeProviderReceipt("ollama", { prompt_eval_count: 7, eval_count: 9 }).usage, { prompt_tokens: 7, completion_tokens: 9 });
});
test("AA015 connected providers do not become authorized helpers", () => {
  const none = planModelConsult({ orchestrator: "grok", modules, question: "hello" });
  assert(none.ok); assert.deepEqual(none.plan.helpers, []);
  const selected = planModelConsult({ orchestrator: "grok", modules, question: "hello", allowPaidHelpers: true, helperIds: ["gemini"] });
  assert(selected.ok); assert.deepEqual(selected.plan.helpers.map((v) => v.id), ["gemini"]);
  assert.equal(planModelConsult({ orchestrator: "grok", modules, question: "hello", allowPaidHelpers: true, helperIds: ["missing"] }).ok, false);
});
test("AA016/017 bounded helpers preserve failed receipts and stop new dispatch after cancel", async () => {
  const plan = planModelConsult({ orchestrator: "grok", modules, question: "test", allowPaidHelpers: true, helperIds: ["openai", "gemini", "anthropic"], maxConcurrency: 2 });
  assert(plan.ok);
  let active = 0, peak = 0;
  const result = await executeConsultPlan(plan.plan, async (id) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return id === "gemini" ? { ok: false, text: "", error: "rate limited" } : { ok: true, text: id, model: "reported", requestId: id, usage: { prompt_tokens: 10 } };
  });
  assert.equal(peak, 2); assert.equal(result.receipts.length, 3); assert.equal(result.help.length, 2);
  assert.equal(result.receipts[1]?.error, "rate limited"); assert.equal(result.receipts[0]?.model, "reported");
  const controller = new AbortController(); let calls = 0;
  await executeConsultPlan({ ...plan.plan, maxConcurrency: 1 }, async () => { calls++; controller.abort(); return { ok: true, text: "already completed" }; }, { signal: controller.signal });
  assert.equal(calls, 1);
});
function runFixture() {
  let workspace = emptyWorkspace();
  const added = addAgentFromTemplate(workspace, "Personal assistant");
  assert(added.ok); workspace = added.ws;
  const agent = workspace.agents[0]!;
  workspace = { ...workspace, agents: [{ ...agent, tools: ["list_projects", "list_chats"], maxSteps: 4 }] };
  const queued = enqueueRun(workspace, agent.id, "list my workspace", "2026-01-01T00:00:00Z");
  assert(queued.ok); return { workspace: queued.ws, runId: queued.run.id, agentId: agent.id };
}
test("AA019 active run uses immutable tool order and honors revocation", () => {
  const { workspace, runId } = runFixture();
  let next = tickFleet(workspace, { now: "2026-01-01T00:00:01Z", workerId: "test" });
  next.agents[0] = { ...next.agents[0]!, version: 2, tools: ["list_chats", "list_projects"] };
  next = tickFleet(next, { now: "2026-01-01T00:00:02Z", workerId: "test" });
  assert.equal(next.runs.find((r) => r.id === runId)?.step, 2);
  assert.equal(next.runs[0]?.definition?.version, 1);
  next = { ...workspace, agents: [{ ...workspace.agents[0]!, tools: ["list_chats"] }] };
  next = tickFleet(next, { now: "2026-01-01T00:00:02Z", workerId: "test" });
  assert.equal(next.runs[0]?.state, "paused"); assert.match(next.runs[0]!.error, /removed/);
});
test("AA020/021 local execution is distinct from objective verification and budget exhaustion", () => {
  const { workspace } = runFixture();
  workspace.runs[0]!.maxSteps = 1;
  let next = tickFleet(workspace, { now: "2026-01-01T00:00:01Z", workerId: "test" });
  next = tickFleet(next, { now: "2026-01-01T00:00:02Z", workerId: "test" });
  assert.equal(next.runs[0]?.state, "failed"); assert.equal(next.runs[0]?.completion?.execution, "budget_exhausted");
  assert.equal(next.runs[0]?.completion?.objective, "unverified"); assert.equal(next.runs[0]?.executionRuntime, "browser-local");
});
test("AA022 schedule retains individual occurrences and queues overlap", () => {
  const { workspace, agentId } = runFixture();
  workspace.runs = [];
  const added = addSchedule(workspace, "repeat", agentId, 5, "2026-01-01T00:00:00Z"); assert(added.ok);
  added.ws.schedules[0]!.nextRunAt = "2026-01-01T00:00:00Z";
  const first = runDueSchedules(added.ws, "2026-01-01T00:00:00Z");
  const second = runDueSchedules(first, "2026-01-01T00:10:00Z");
  assert.equal(second.runs.length, 1); assert.equal(second.schedules[0]?.occurrences?.length, 1); assert.match(second.schedules[0]!.lastError, /waiting/);
  second.schedules[0]!.overlapPolicy = "parallel";
  const parallel = runDueSchedules(second, "2026-01-01T00:10:00Z"); assert.equal(parallel.runs.length, 2); assert.equal(parallel.schedules[0]?.occurrences?.length, 2);
});
test("AA023 cancellation preserves results and records local acknowledgement", () => {
  const { workspace, runId } = runFixture(); workspace.runs[0]!.result = "completed step";
  const canceled = cancelRun(workspace, runId, "2026-01-01T00:00:00Z");
  assert.equal(canceled.runs[0]?.result, "completed step"); assert.equal(canceled.runs[0]?.cancellation?.scope, "local-worker");
  assert(readFleet(canceled).runs[0]?.cancellation?.acknowledgedAt);
});
test("AA091–096 unknown prices and existing reservations cannot be treated as free allowance", () => {
  const policy = { ...DEFAULT_RESOURCE_POLICY, maxDailyUsdMicros: 100, maxCallUsdMicros: 100 };
  const base = { policy, free: false, calls: 0, active: 0, tokens: 0, committed: 60 };
  assert.match(resourcePlanAllowed({ ...base, estimate: null })!, /unknown/);
  assert.match(resourcePlanAllowed({ ...base, estimate: 50 })!, /Insufficient/);
  assert.equal(resourcePlanAllowed({ ...base, estimate: 40 }), null);
  assert.equal(resourceEstimate({ revision: "fixture-v1", inputUsdMicrosPerMillion: 1_000_000, outputUsdMicrosPerMillion: 2_000_000 }, 10, 5), 20);
  assert.throws(() => readResourcePolicy({ ...policy, freeOnly: "false" }), /explicit/);
});
test("AA104 shared plan preserves independent comparison and synthesis dependencies", () => {
  const compare = modelExecutionPlan("independent", ["a", "b"]); assert.deepEqual(compare.participants.map((p) => p.dependsOn), [[], []]);
  const synth = modelExecutionPlan("synthesis", ["a"], ["b"]); assert.deepEqual(synth.participants[1]?.dependsOn, ["b"]);
  assert.equal(synth.maxProviderCalls, 2); assert.throws(() => modelExecutionPlan("independent", ["a"], ["b"]));
});
test("AA107 unresolved counts include waiting and paused work consistently", () => {
  const { workspace } = runFixture();
  const runs = ["queued", "running", "waiting_approval", "waiting_external", "paused", "cancel_requested"].map((state, i) => ({ ...workspace.runs[0]!, id: String(i), state: state as typeof workspace.runs[0]["state"] }));
  assert.deepEqual(countRuns(runs), { executing: 1, queued: 1, waitingApproval: 1, waitingExternal: 1, cancellationPending: 1, paused: 1, unresolved: 6 });
});


test("AA057 malformed emergency controls cannot become permission to resume", async () => {
  const { parseHaltControlRequest } = await import("./halt-request.ts");
  for (const input of [null, {}, { on: "true" }, { on: 0 }, { on: false }]) assert.throws(() => parseHaltControlRequest(input));
  assert.deepEqual(parseHaltControlRequest({ on: true }), { on: true });
  assert.deepEqual(parseHaltControlRequest({ on: false, expectedRevision: "reviewed" }), { on: false, expectedRevision: "reviewed" });
});

test("AA059 an agent rechecks authorization before redispatching earlier tool evidence", async () => {
  const { runBoundedAgent } = await import("./agent.ts");
  let checks = 0, calls = 0;
  const result = await runBoundedAgent({ ws: emptyWorkspace(), goal: "List projects", signal: new AbortController().signal, autonomy: "automatic", halted: false, approved: true,
    beforeStep: async () => { checks++; if (checks > 2) throw new Error("Context revoked"); },
    model: async () => { calls++; return { text: "", toolCalls: [{ id: "first", name: "list_projects", arguments: {} }] }; },
  });
  assert.equal(calls, 1); assert.equal(result.ok, false); assert.equal(result.log.length, 1);
});


test("AA093 an Ollama label cannot treat remote or cloud model calls as automatically free", () => {
  assert.equal(isAutomaticallyFreeModelRoute("ollama", "local-model", "http://127.0.0.1:11434/api/chat"), true);
  assert.equal(isAutomaticallyFreeModelRoute("ollama", "local-model", "http://[::1]:11434/api/chat"), true);
  assert.equal(isAutomaticallyFreeModelRoute("ollama", "model:cloud", "http://localhost:11434/api/chat"), false);
  assert.equal(isAutomaticallyFreeModelRoute("ollama", "local-model", "https://paid.example/api/chat"), false);
  assert.equal(isAutomaticallyFreeModelRoute("ollama", "local-model"), false);
  assert.equal(isAutomaticallyFreeModelRoute("openrouter", "model:free"), true);
  assert.equal(isAutomaticallyFreeModelRoute("openrouter", "paid-model"), false);
});
