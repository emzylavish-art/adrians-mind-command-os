import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addAgentFromTemplate,
  addConnection,
  addMailbox,
  addSchedule,
  approveRunAction,
  deployAgent,
  enqueueRun,
  gmailConnectAttempt,
  haltFleet,
  pauseRun,
  runDueSchedules,
  tickFleet,
} from "./fleet.ts";
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
    ws = approveRunAction(ws, ws.runs[0]!.id, "browser");
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
    next = approveRunAction(next, next.runs[0]!.id, "gmail_send");
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
    const ws = tick(queued.ws);
    assert.match(ws.runs[0]?.error ?? "", /does not call a model/);
  });
});
