import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addAgentFromTemplate,
  assignDelegation,
  claimFleetModelStep,
  completeFleetModelStep,
  addConnection,
  addCustomAgent,
  editBot,
  readFleet,
  addMailbox,
  addSchedule,
  approveRunAction,
  buildTaskPlan,
  canTransition,
  cancelRun,
  delegationGoals,
  deployAgent,
  enqueueRun,
  gmailConnectAttempt,
  haltFleet,
  pauseRun,
  runDueSchedules,
  tickFleet,
  togglePin,
  toolCatalog,
} from "./fleet.ts";
import { paletteHits } from "./palette.ts";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";

const NOW = "2026-04-01T12:00:00.000Z";
const LATER = "2026-04-01T12:00:31.000Z";

function started(template = "Personal assistant", goal = "pier") {
  const made = addAgentFromTemplate(emptyWorkspace(), template, NOW);
  if (!made.ok) throw new Error("template failed");
  const queued = enqueueRun(made.ws, made.agent.id, goal, NOW);
  if (!queued.ok) throw new Error("queue failed");
  return queued.ws;
}

function tick(ws: ReturnType<typeof emptyWorkspace>, now = LATER, extra: Partial<Parameters<typeof tickFleet>[1]> = {}) {
  return tickFleet(ws, { now, workerId: "test-worker", ...extra });
}

describe("local agent worker", () => {
  it("runs a local read and finishes from that result", () => {
    let ws = started();
    ws.projects.push({ id: "p1", name: "Lake", description: "", createdAt: NOW });
    ws = tick(ws);
    ws = tick(ws, "2026-04-01T12:01:00.000Z");
    ws = tick(ws, "2026-04-01T12:02:00.000Z");
    ws = tick(ws, "2026-04-01T12:03:00.000Z");
    const run = ws.runs.find((item) => !item.parentId);
    assert.equal(run?.state, "completed");
    assert.match(run?.result ?? "", /Lake|No projects|No chats|No matching notes/);
    assert.equal(ws.runEvents.some((item) => item.kind === "tool_result"), true);
  });

  it("does not call search or invent a citation when no provider is passed", () => {
    let ws = started("Research", "pier");
    ws = tick(ws);
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, LATER);
    ws = tick(ws);
    ws = tick(ws, "2026-04-01T12:01:00.000Z");
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, "2026-04-01T12:01:00.000Z");
    ws = tick(ws, "2026-04-01T12:01:00.000Z");
    const run = ws.runs[0];
    assert.equal(run?.state, "waiting_external");
    assert.match(run?.error ?? "", /no citations/i);
    assert.equal(JSON.stringify(ws).includes("https://"), false);
  });

  it("asks before a browser open and does not open a page without a driver", () => {
    let ws = started("Browser operator", "https://example.com/pier");
    ws = tick(ws);
    assert.equal(ws.runs[0]?.state, "waiting_approval");
    assert.equal(ws.browserSessions.length, 0);
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, LATER);
    ws = tick(ws, "2026-04-01T12:01:00.000Z", {
      browser: () => ({ ok: true, title: "Pier", excerpt: "Water is low." }),
    });
    assert.equal(ws.browserSessions[0]?.title, "Pier");
    assert.match(ws.browserSessions[0]?.excerpt ?? "", /Water is low/);
  });

  it("does not read or send Gmail without a connected mailbox", () => {
    const attempt = gmailConnectAttempt();
    assert.match(attempt.error, /not configured/);
    let ws = emptyWorkspace();
    for (let index = 0; index < 60; index += 1) {
      const added = addMailbox(ws, `Box ${index}`, `owner${index}@example.com`);
      assert.equal(added.ok, true);
      if (added.ok) ws = added.ws;
    }
    assert.equal(ws.mailboxes.length, 60);
    assert.equal(ws.mailboxes.every((item) => item.status === "not_connected"), true);
    const made = addAgentFromTemplate(ws, "Email", NOW);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    made.ws.agents[0] = { ...made.ws.agents[0]!, tools: ["gmail_send"] };
    const queued = enqueueRun(made.ws, made.ws.agents[0]!.id, "Send the note", NOW);
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    let next = tick(queued.ws);
    assert.equal(next.runs[0]?.state, "waiting_approval");
    next = approveRunAction(next, next.runs[0]!.id, next.runs[0]!.pendingApproval!.id, LATER);
    next = tick(next, "2026-04-01T12:01:00.000Z");
    assert.equal(next.runs[0]?.state, "waiting_external");
    assert.match(next.runs[0]?.error ?? "", /Nothing was read or sent/);
    assert.equal(next.mailboxes.length, 60);
  });

  it("keeps a hosted deployment from looking ready", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const local = deployAgent(made.ws, made.agent.id, "local-worker", NOW);
    const hosted = deployAgent(made.ws, made.agent.id, "hosted-worker", NOW);
    assert.equal(local.ok && local.ws.deployments[0]?.state, "local-ready");
    assert.equal(hosted.ok && hosted.ws.deployments[0]?.state, "external-required");
    assert.match(hosted.ok ? hosted.ws.deployments[0]!.error : "", /does not start a remote process/);
  });

  it("cancels work on emergency stop and does not run a paused task", () => {
    let ws = started();
    ws = pauseRun(ws, ws.runs[0]!.id);
    ws = tick(ws);
    assert.equal(ws.runs[0]?.state, "paused");
    ws = { ...ws, halted: true };
    ws = haltFleet(ws, LATER);
    assert.equal(ws.runs[0]?.state, "canceled");
  });

  it("does not steal a live lease from another worker", () => {
    let ws = started();
    ws.runs[0] = { ...ws.runs[0]!, state: "running", workerId: "other", leaseUntil: "2026-04-01T12:05:00.000Z", step: 0 };
    const before = ws.runs[0]!.step;
    ws = tick(ws, LATER);
    assert.equal(ws.runs[0]?.step, before);
    assert.equal(ws.runs[0]?.workerId, "other");
  });

  it("delegates one level and keeps child runs", () => {
    let ws = started("Project manager", "Lake and Dock");
    ws.projects.push({ id: "p", name: "Lake", description: "", createdAt: NOW });
    for (let minute = 1; minute <= 8; minute += 1) {
      ws = tick(ws, `2026-04-01T12:0${minute}:00.000Z`);
    }
    const children = ws.runs.filter((item) => item.parentId);
    assert.equal(children.length, 2);
    assert.equal(children.every((item) => item.depth === 1), true);
  });

  it("queues a due schedule and stores connections without secrets", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Documents", NOW);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const scheduled = addSchedule(made.ws, "Morning notes", made.agent.id, 1440, NOW);
    assert.equal(scheduled.ok, true);
    if (!scheduled.ok) return;
    const ran = runDueSchedules(scheduled.ws, NOW);
    assert.equal(ran.runs.length, 1);
    assert.equal(ran.schedules[0]?.lastError, "");
    const connected = addConnection(ran, "openai", "Work GPT");
    assert.equal(connected.ok, true);
    if (!connected.ok) return;
    assert.equal(connected.ws.connections[0]?.secretStored, false);
    assert.equal(connected.ws.connections[0]?.status, "unconfigured");
    const saved = normalizeWorkspace(connected.ws);
    assert.equal(saved.connections[0]?.label, "Work GPT");
    assert.equal(JSON.stringify(saved).includes("sk-"), false);
  });

  it("does not call a model from the worker", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Personal assistant", NOW);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    made.ws.agents[0] = { ...made.ws.agents[0]!, tools: ["model"] };
    const queued = enqueueRun(made.ws, made.ws.agents[0]!.id, "Think", NOW);
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    let ws = tick(queued.ws);
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, LATER);
    ws = tick(ws);
    assert.match(ws.runs[0]?.error ?? "", /does not call a model/);
  });

  it("builds an ordered plan and refuses a finished run going back to running", () => {
    const plan = buildTaskPlan("pier", ["list_projects", "search_notes", "delegate"]);
    assert.deepEqual(plan.map((step) => step.tool), ["list_projects", "search_notes", "delegate"]);
    assert.deepEqual(plan[1]?.dependsOn, ["step-1"]);
    assert.equal(plan.every((step) => step.need === "none"), true);
    assert.equal(canTransition("completed", "running"), false);
    assert.equal(canTransition("paused", "queued"), true);
    let ws = started();
    ws = tick(ws);
    ws = tick(ws, "2026-04-01T12:01:00.000Z");
    ws = tick(ws, "2026-04-01T12:02:00.000Z");
    ws = tick(ws, "2026-04-01T12:03:00.000Z");
    const done = ws.runs.find((item) => !item.parentId);
    assert.equal(done?.state, "completed");
    assert.equal(done?.plan.length, 3);
    const paused = pauseRun(ws, done!.id);
    assert.equal(paused.runs.find((item) => item.id === done!.id)?.state, "completed");
  });

  it("caps delegation at two children and records the plan", () => {
    assert.equal(delegationGoals("Lake and Dock and Pier").length, 2);
    let ws = started("Project manager", "Lake and Dock and Pier");
    ws = tick(ws);
    ws = tick(ws, "2026-04-01T12:01:00.000Z");
    const parent = ws.runs.find((item) => !item.parentId);
    assert.equal(ws.runs.filter((item) => item.parentId).length, 2);
    assert.equal(ws.runEvents.some((item) => item.kind === "plan_generated" && item.runId === parent?.id), true);
    assert.equal(JSON.stringify(ws).includes("https://"), false);
  });

  it("pins a chat in the workspace snapshot and removes it on the second toggle", () => {
    let ws = emptyWorkspace();
    ws.chats.push({ id: "c1", title: "Pier", memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] });
    ws = togglePin(ws, "chat", "c1");
    assert.equal(ws.pins[0]?.ref, "c1");
    const saved = normalizeWorkspace(ws);
    assert.equal(saved.pins[0]?.kind, "chat");
    const cleared = togglePin(saved, "chat", "c1");
    assert.equal(cleared.pins.length, 0);
  });

  it("saves a custom agent only with a name and a real tool", () => {
    const blank = addCustomAgent(emptyWorkspace(), { name: " ", instructions: "x", tools: ["list_projects"] }, NOW);
    assert.equal(blank.ok, false);
    const made = addCustomAgent(emptyWorkspace(), { name: "Pier notes", instructions: "Read notes only.", tools: ["search_notes", "gmail_send"] }, NOW);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    assert.equal(made.agent.approval, "ask");
    assert.equal(made.agent.tools.includes("gmail_send"), true);
    assert.equal(toolCatalog().find((tool) => tool.id === "gmail_send")?.available, false);
    assert.equal(toolCatalog().find((tool) => tool.id === "list_projects")?.available, true);
  });

  it("finds an agent from the command palette without calling a model", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Documents", NOW);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const hits = paletteHits({
      query: "doc",
      projects: [],
      chats: [],
      memories: [],
      files: [],
      agents: made.ws.agents,
      runs: [],
    });
    assert.equal(hits.some((hit) => hit.meta === "Agent" && hit.label === "Documents"), true);
    assert.equal(JSON.stringify(hits).includes("sk-"), false);
  });
});

it("cancels delegated children and preserves the third part of a goal", () => {
  let ws = started("Project manager", "Lake and Dock and Pier");
  ws = tick(ws);
  ws = tick(ws, "2026-04-01T12:01:00.000Z");
  const parent = ws.runs.find(r => !r.parentId)!;
  assert.ok(ws.runs.some(r => r.goal === "Dock and Pier"));
  const canceled = cancelRun(ws, parent.id);
  assert.ok(canceled.runs.every(r => r.state === "canceled"));
  for (const child of ws.runs.filter(r => r.parentId)) ws = cancelRun(ws, child.id);
  ws = tick(ws, "2026-04-01T12:02:00.000Z");
  assert.equal(ws.runs.find(r => r.id === parent.id)?.state, "canceled");
});


describe("C5 pinned fleet contracts", () => {
  it("uses the queued plan after tools are reordered and rejects revoked tools", () => {
    const ws = tick(started());
    ws.agents[0].tools = ["search_notes", "list_projects", "list_chats"];
    const next = tick(ws);
    assert.equal(next.runs[0].step, 2);
    assert.match(next.runEvents[0].detail, /chat|conversation/i);
    ws.agents[0].tools = ["list_projects"];
    const blocked = tick(ws).runs[0];
    assert.equal(blocked.state, "paused");
    assert.equal(blocked.step, ws.runs[0].step);
  });
  it("approval cannot authorize a changed goal, destination or agent revision", () => {
    const waiting = tick(started("Browser operator", "Open https://one.example"));
    const approved = approveRunAction(waiting, waiting.runs[0].id, "browser");
    for (const change of ["goal", "version"] as const) {
      const ws = structuredClone(approved);
      if (change === "goal") ws.runs[0].goal = "Open https://two.example";
      else ws.agents[0].version += 1;
      let calls = 0;
      const result = tick(ws, LATER, { browser: () => { calls++; return { ok: true, title: "x", excerpt: "x" }; } });
      assert.equal(calls, 0);
      assert.equal(result.runs[0].state, "waiting_approval");
    }
  });
  it("delegation preserves its parent plan and selects explicitly assigned specialists", () => {
    const manager = addAgentFromTemplate(emptyWorkspace(), "Project manager", NOW);
    assert.ok(manager.ok);
    manager.agent.tools = ["delegate", "search_notes", "list_projects"];
    const queued = enqueueRun(manager.ws, manager.agent.id, "Delegate a project review and a note lookup", NOW);
    assert.ok(queued.ok);
    let ws = queued.ws;
    const documents = addAgentFromTemplate(ws, "Documents", NOW);
    assert.equal(documents.ok, true);
    if (!documents.ok) return;
    ws = assignDelegation(documents.ws, ws.runs[0].id, 1, documents.agent.id);
    const parentId = ws.runs[0].id;
    const plan = ws.runs[0].plan;
    ws = tick(tick(ws));
    assert.deepEqual(ws.runs.find((run) => run.id === parentId)?.plan, plan);
    const child = ws.runs.find((run) => run.parentId === parentId && run.agentId === documents.agent.id);
    assert.ok(child);
    assert.deepEqual(child.plan.map((step) => step.tool), ["search_notes"]);
    assert.deepEqual(child.approvedActions, []);
    assert.equal(child.execution?.memory, "off");
  });
  it("claims one model call with pinned instructions and rejects mismatched provider results", () => {
    const ws = started();
    ws.agents[0] = { ...ws.agents[0], tools: ["model"], chatProvider: "gemini", instructions: "Fixture distinctive instruction" };
    const queued = enqueueRun(ws, ws.agents[0].id, "A bounded answer", NOW);
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const claim = claimFleetModelStep(queued.ws, queued.run.id, "operation-1", NOW);
    assert.equal(claim.ok, true);
    if (!claim.ok) return;
    assert.equal(claim.request.provider, "gemini");
    assert.equal(claim.request.instructions, "Fixture distinctive instruction");
    assert.equal(claim.request.maxCalls, 1);
    assert.equal(claimFleetModelStep(claim.ws, queued.run.id, "operation-2", NOW).ok, false);
    const wrong = completeFleetModelStep(claim.ws, claim.request, { ok: true, provider: "grok", text: "wrong" }, NOW);
    assert.equal(wrong.runs[0].result, "");
    const right = completeFleetModelStep(claim.ws, claim.request, { ok: true, provider: "gemini", model: "fixture", text: "verified fixture answer" }, NOW);
    assert.equal(right.runs[0].result, "verified fixture answer");
    assert.equal(right.runs[0].step, 1);
  });
});

describe("C5 scheduled occurrences", () => {
  function scheduled() {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
    if (!made.ok) throw new Error(made.error);
    const scheduled = addSchedule(made.ws, "Hourly", made.agent.id, 60, NOW);
    if (!scheduled.ok) throw new Error(scheduled.error);
    return scheduled.ws;
  }
  it("applies missed run policies with bounded catch-up and deterministic identities", () => {
    const after = "2026-04-01T14:00:00.000Z";
    for (const policy of ["run-once", "skip", "review", "catch-up"] as const) {
      const ws = scheduled(); ws.schedules[0].missedPolicy = policy; ws.schedules[0].overlapPolicy = "queue";
      const next = runDueSchedules(ws, after);
      assert.equal(next.runs.length, policy === "catch-up" ? 3 : policy === "run-once" ? 1 : 0);
      assert.equal(new Set(next.runs.map((run) => run.id)).size, next.runs.length);
      if (policy === "review") assert.equal(next.schedules[0].enabled, false);
      if (policy === "skip") assert.equal(next.schedules[0].skippedCount, 3);
    }
  });
  it("does not accumulate unreviewed occurrences by default and allows bounded explicit queueing", () => {
    const ws = runDueSchedules(scheduled(), NOW);
    ws.runs[0].state = "waiting_approval";
    const later = "2026-04-02T12:00:00.000Z";
    assert.equal(runDueSchedules(ws, later).runs.length, 1);
    ws.schedules[0].overlapPolicy = "skip";
    const skipped = runDueSchedules(ws, later);
    assert.equal(skipped.runs.length, 1);
    assert.ok(skipped.schedules[0].skippedCount! > 0);
  });
  it("retains chat destination across queue, completion and repeated worker ticks", () => {
    const ws = scheduled();
    ws.chats = ["A", "B"].map((id) => ({ id, title: id, memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: [] }));
    ws.schedules[0].chatId = "A";
    ws.schedules[0].resultDelivery = "conversation";
    let next = runDueSchedules(ws, NOW);
    assert.equal(next.runs[0].chatId, "A");
    next = tick(tick(next));
    next = tick(next);
    assert.equal(next.chats[0].messages.length, 1);
    assert.equal(next.chats[1].messages.length, 0);
    assert.match(next.chats[0].messages[0].id, /^scheduled-result:/);
  });
});

it("C5 a browser worker does not execute a queued occurrence assigned to another environment", () => {
  const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
  if (!made.ok) throw Error(made.error);
  const scheduled = addSchedule(made.ws, "Local job", made.agent.id, 60, NOW);
  if (!scheduled.ok) throw Error(scheduled.error);
  scheduled.ws.schedules[0].executionTarget = "local-worker";
  const queued = runDueSchedules(scheduled.ws, NOW, "local-worker");
  const ignored = tickFleet(queued, { now: NOW, workerId: "browser", environment: "browser" });
  assert.equal(ignored.runs[0].step, 0);
  const advanced = tickFleet(ignored, { now: NOW, workerId: "local", environment: "local-worker" });
  assert.equal(advanced.runs[0].step, 1);
});


it("keeps a bot's Telegram username and knowledge links when edited and reloaded", () => {
  const draft = { name: "Research desk", instructions: "", tools: ["list_projects"] as const };
  const result = addCustomAgent(emptyWorkspace(), { ...draft, tools: [...draft.tools], telegramUsername: "@Desk_Bot", knowledgeDocumentIds: ["notes"] });
  assert(result.ok);
  assert.equal(readFleet(result.ws).agents[0]?.telegramUsername, "Desk_Bot");
  const updated = editBot(result.ws, result.agent.id, { ...draft, tools: [...draft.tools], name: "Renamed" });
  assert(updated.ok);
  assert.deepEqual(updated.agent.knowledgeDocumentIds, ["notes"]);
  assert.equal(updated.agent.telegramUsername, "Desk_Bot");
  const invalid = addCustomAgent(emptyWorkspace(), { ...draft, tools: [...draft.tools], telegramUsername: "12345:token" });
  assert.equal(invalid.ok, false);
  const cleared = editBot(updated.ws, updated.agent.id, { ...draft, tools: [...draft.tools], telegramUsername: "" });
  assert(cleared.ok);
  assert.equal(cleared.agent.telegramUsername, "");
});
