import assert from "node:assert/strict";
import { test } from "node:test";
import { addCustomAgent, addSchedule, approveRunAction, approveRunBatch, clearFinishedRuns, cancelRun, configureSchedulePolicy, enqueueRun, readFleet, resumeRun, revokeRunApproval, reviewMissedSchedule, runDueSchedules, selectDelegatedAgent, tickFleet, type FleetTool, type TickEnv } from "./fleet.ts";
import { emptyWorkspace } from "./workspace.ts";
import { scheduleOccurrences } from "./schedule-policy.ts";

const NOW = "2026-11-25T12:00:00.000Z";
const LATER = "2026-11-25T12:01:00.000Z";
function queued(tools: FleetTool[], goal = "Read https://example.test/a", extra = {}) {
  const agent = addCustomAgent(emptyWorkspace(), { name: "Fixture", instructions: "Only use approved resources.", tools, ...extra }, NOW);
  assert.ok(agent.ok);
  const run = enqueueRun(agent.ws, agent.agent.id, goal, NOW);
  assert.ok(run.ok);
  return run.ws;
}
function tick(ws: ReturnType<typeof emptyWorkspace>, env: Partial<TickEnv> = {}) { return tickFleet(ws, { now: NOW, workerId: "fixture", ...env }); }
function approve(ws: ReturnType<typeof emptyWorkspace>) { return approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, NOW); }

test("AA107: the validated plan, not the available-tools array, chooses the dispatched operation", () => {
  const ws = queued(["list_projects", "list_chats", "search_notes"]);
  ws.runs[0]!.plan = [{ id: "chosen", title: "List chats", tool: "list_chats", dependsOn: [], need: "none" }];
  const result = tick(ws);
  assert.equal(result.runs[0]!.stepResults![0]!.tool, "list_chats");
  assert.doesNotMatch(result.runs[0]!.result, /list_projects/);
});

test("AA107: invalid dependencies and capabilities fail closed", () => {
  for (const plan of [
    [{ id: "bad", title: "bad", tool: "model" as const, dependsOn: [], need: "model" as const }],
    [{ id: "bad", title: "bad", tool: "list_chats" as const, dependsOn: ["missing"], need: "none" as const }],
  ]) {
    const ws = queued(["list_chats"]); ws.runs[0]!.plan = plan;
    assert.equal(tick(ws).runs[0]!.state, "failed");
  }
});

test("AA109: the execution retains its agent configuration across serialization and rejects mid-run drift", () => {
  const ws = queued(["list_projects"]);
  assert.equal(readFleet(ws).runs[0]!.configuration!.version, 1);
  ws.agents[0]!.version = 2;
  const next = tick(ws);
  assert.equal(next.runs[0]!.state, "failed");
  assert.equal(next.runs[0]!.configuration!.version, 1);
});

test("AA110: long instructions and goals are rejected without silently dropping requirements", () => {
  const made = addCustomAgent(emptyWorkspace(), { name: "Long", tools: ["list_projects"], instructions: "x".repeat(2000) + "MANDATORY" }, NOW);
  assert.equal(made.ok, false);
  const ws = queued(["list_projects"]);
  assert.equal(enqueueRun(ws, ws.agents[0]!.id, "x".repeat(2000) + "MANDATORY", NOW).ok, false);
});

test("AA111/223: exhausting a step limit cannot mark unfinished work complete", () => {
  let ws = queued(["list_projects", "list_chats"]);
  ws.runs[0]!.maxSteps = 1;
  ws = tick(tick(ws));
  assert.equal(ws.runs[0]!.state, "failed");
  assert.match(ws.runs[0]!.error, /unfinished/);
  assert.equal(ws.runs[0]!.stepResults!.length, 1);
});

test("AA111/223: completed steps and verified objectives are distinct", () => {
  let ws = queued(["list_projects"]);
  ws = tick(tick(ws));
  assert.equal(ws.runs[0]!.state, "completed");
  assert.equal(ws.runs[0]!.verification!.state, "unverified");
  const missing = tick(tick(queued(["list_projects"])), { verify: () => ({ met: false, detail: "The requested report is missing." }) });
  assert.equal(missing.runs[0]!.state, "failed");
  assert.equal(missing.runs[0]!.verification!.state, "not_met");
});

test("AA208/209/211: approval identifies one exact destination and rejects tool labels and changed operations", () => {
  let ws = tick(queued(["browser"]));
  const request = ws.runs[0]!.pendingApproval!;
  assert.equal(request.destination, "https://example.test/a");
  assert.equal(approveRunAction(ws, ws.runs[0]!.id, "browser", NOW).runs[0]!.state, "waiting_approval");
  ws = approve(ws);
  ws.runs[0]!.goal = "Read https://example.test/b";
  let calls = 0;
  ws = tick(ws, { browser: () => { calls++; return { ok: true, title: "B", excerpt: "B" }; } });
  assert.equal(calls, 0);
  assert.equal(ws.runs[0]!.state, "waiting_approval");
  assert.equal(ws.runs[0]!.pendingApproval!.destination, "https://example.test/b");
  assert.notEqual(ws.runs[0]!.pendingApproval!.id, request.id);
});

test("AA209: completed and canceled runs cannot acquire new authorization", () => {
  let ws = tick(queued(["browser"]));
  const request = ws.runs[0]!.pendingApproval!;
  ws = cancelRun(ws, ws.runs[0]!.id, NOW);
  assert.equal(approveRunAction(ws, ws.runs[0]!.id, request.id, NOW).runs[0]!.pendingApproval!.state, "revoked");
  ws.runs[0]!.state = "completed";
  assert.equal(approveRunAction(ws, ws.runs[0]!.id, request.id, NOW).runs[0]!.state, "completed");
});

test("AA210: grants expire and are consumed once on dispatch", () => {
  let ws = approve(tick(queued(["browser"])));
  const expired = tick(ws, { now: "2026-11-25T12:06:00.000Z", browser: () => { throw Error("must not dispatch"); } });
  assert.equal(expired.runs[0]!.state, "waiting_approval");
  let calls = 0;
  ws = tick(ws, { browser: () => { calls++; return { ok: true, title: "A", excerpt: "Confirmed page" }; } });
  ws = tick(ws, { browser: () => { calls++; return { ok: true, title: "A", excerpt: "Duplicated" }; } });
  assert.equal(calls, 1);
  assert.equal(ws.runs[0]!.pendingApproval, undefined);
  assert.equal(ws.runs[0]!.approvalHistory!.at(-1)!.state, "consumed");
});

test("AA211: multiple possible browser destinations fail before requesting approval", () => {
  const ws = tick(queued(["browser"], "Read https://example.test/a and https://example.test/b"));
  assert.equal(ws.runs[0]!.state, "failed");
  assert.equal(ws.runs[0]!.pendingApproval, undefined);
});

test("AA212: ask-mode local reads require the specific current grant", () => {
  let ws = queued(["search_notes"]);
  ws.agents[0]!.approval = "ask"; ws.runs[0]!.configuration!.approval = "ask";
  ws = tick(ws);
  assert.equal(ws.runs[0]!.state, "waiting_approval");
  assert.equal(ws.runs[0]!.step, 0);
  ws = tick(approve(ws));
  assert.equal(ws.runs[0]!.step, 1);
});

test("AA213: delegated children retain permission ceilings and inherit no grants", () => {
  let ws = queued(["list_projects", "delegate"], "Alpha and Beta");
  ws = tick(tick(ws));
  const parent = ws.runs.find(run => !run.parentId)!;
  const children = ws.runs.filter(run => run.parentId);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.deepEqual(child.approvedActions, []);
    assert.equal(child.pendingApproval, undefined);
    assert.equal(child.configuration!.projectId, parent.configuration!.projectId);
    assert.ok(child.plan.every(step => step.tool !== "delegate" && parent.configuration!.tools.includes(step.tool)));
  }
});

test("AA215: revocation prevents a queued dispatch and resume requests a fresh grant", () => {
  let ws = approve(tick(queued(["browser"])));
  ws = revokeRunApproval(ws, ws.runs[0]!.id, NOW);
  assert.equal(ws.runs[0]!.state, "paused");
  ws = resumeRun(ws, ws.runs[0]!.id);
  ws = tick(ws, { browser: () => { throw Error("revoked dispatch"); } });
  assert.equal(ws.runs[0]!.state, "waiting_approval");
});

test("AA218/219: a successful empty search is a structured successful result", () => {
  let ws = tick(queued(["web_search"], "missing query"), { search: () => ({ ok: true, citations: [], error: "" }) });
  assert.equal(ws.runs[0]!.stepResults![0]!.status, "empty");
  ws = tick(ws);
  assert.equal(ws.runs[0]!.state, "completed");
});

test("AA219/217: the model receives structured sources and records the selected provider", () => {
  let ws = tick(queued(["web_search", "model"], "Analyze fixture", { chatProvider: "gemini" }), { search: () => ({ ok: true, citations: [{ id: "S1", title: "Source", url: "https://example.test", excerpt: "UNIQUE_PASSAGE" }], error: "" }) });
  ws = tick(ws);
  ws = approve(ws);
  ws = tick(ws, { model: request => {
    assert.equal(request.provider, "gemini");
    assert.equal(request.results[0]!.sources[0]!.excerpt, "UNIQUE_PASSAGE");
    return { ok: true, text: "Fixture answer", provider: "gemini", model: "fixture-model" };
  } });
  assert.equal(ws.runs[0]!.step, 2);
  assert.match(ws.runs[0]!.result, /Fixture answer/);
});

test("AA216: Gmail receipt must identify the exact selected account and operation", () => {
  let ws = queued(["gmail_send"]);
  ws.runs[0]!.plan[0]!.input = { accountId: "owner@example.test", recipients: ["recipient@example.test"], subject: "Fixture", body: "Synthetic message" };
  ws = approve(tick(ws));
  const bad = tick(ws, { gmail: () => ({ ok: true, accountId: "other@example.test", operationId: "id1", text: "Sent" }) });
  assert.equal(bad.runs[0]!.state, "failed");
  const good = tick(ws, { gmail: () => ({ ok: true, accountId: "owner@example.test", operationId: "id1", text: "Accepted by provider" }) });
  assert.equal(good.runs[0]!.step, 1);
});

test("AA220/221: the full bounded browser extraction reaches the next step and marks its short preview", () => {
  let ws = approve(tick(queued(["browser", "model"], "Read https://example.test/a", { chatProvider: "gemini" })));
  const passage = "x".repeat(9900) + "ESSENTIAL_END";
  ws = tick(ws, { browser: () => ({ ok: true, title: "Example", excerpt: passage }) });
  assert.equal(ws.browserSessions[0]!.excerpt.length, 500);
  assert.equal(ws.browserSessions[0]!.excerptTruncated, true);
  assert.match(ws.runs[0]!.stepResults![0]!.text, /ESSENTIAL_END/);
  const restored = readFleet(ws);
  assert.match(restored.runs[0]!.stepResults![0]!.text, /ESSENTIAL_END/);
});

test("AA222: a thrown adapter fails only its run and keeps unrelated execution working", () => {
  const ws = queued(["web_search"], "Query");
  const local = addCustomAgent(ws, { name: "Local", tools: ["list_projects"], instructions: "Read" }, NOW); assert.ok(local.ok);
  const second = enqueueRun(local.ws, local.agent.id, "List", NOW); assert.ok(second.ok);
  const result = tick(second.ws, { search: () => { throw Error("private credential details must not leak"); } });
  assert.equal(result.runs.find(run => run.id === ws.runs[0]!.id)!.state, "failed");
  assert.equal(result.runs.find(run => run.id === second.run.id)!.step, 1);
  assert.doesNotMatch(JSON.stringify(result), /private credential/);
});

test("AA061/062: fixed-rate scheduling preserves its anchor and fixed-delay is explicit", () => {
  const job = { nextRunAt: NOW, intervalMinutes: 60, timeZone: "UTC", clockHour: null, clockMinute: null };
  const delayed = "2026-11-25T15:12:00.000Z";
  assert.equal(scheduleOccurrences(job, delayed).nextRunAt, "2026-11-25T16:00:00.000Z");
  assert.equal(scheduleOccurrences({ ...job, timing: "fixed_delay" }, delayed).nextRunAt, "2026-11-25T16:12:00.000Z");
  assert.equal(scheduleOccurrences({ ...job, missedPolicy: "skip" }, delayed).occurrences.length, 0);
  assert.equal(scheduleOccurrences({ ...job, missedPolicy: "ask" }, delayed).needsReview, true);
  assert.equal(scheduleOccurrences({ ...job, missedPolicy: "all" }, delayed).occurrences.length, 4);
  assert.equal(scheduleOccurrences(job, delayed).occurrences.length, 1);
});

test("AA061: recovery records stable occurrence IDs and never queues a duplicate", () => {
  const ws = queued(["list_projects"]);
  const saved = addSchedule(ws, "Hourly", ws.agents[0]!.id, 60, NOW); assert.ok(saved.ok);
  const configured = configureSchedulePolicy(saved.ws, saved.ws.schedules[0]!.id, { missedPolicy: "all" });
  const now = "2026-11-25T15:12:00.000Z";
  const first = runDueSchedules(configured, now);
  assert.equal(first.runs.filter(run => run.id.startsWith("scheduled:")).length, 4);
  const repeated = runDueSchedules(first, now);
  assert.equal(repeated.runs.length, first.runs.length);
  assert.equal(first.schedules[0]!.nextRunAt, "2026-11-25T16:00:00.000Z");
});

test("AA061: approving missed work does not loop back to the same review", () => {
  const ws = queued(["list_projects"]);
  const saved = addSchedule(ws, "Hourly", ws.agents[0]!.id, 60, NOW); assert.ok(saved.ok);
  const job = saved.ws.schedules[0]!;
  let next = configureSchedulePolicy(saved.ws, job.id, { missedPolicy: "ask" });
  next = runDueSchedules(next, "2026-11-25T15:12:00.000Z");
  assert.equal(next.schedules[0]!.recoveryPending, true);
  next = reviewMissedSchedule(next, job.id, true, "2026-11-25T15:12:00.000Z");
  next = runDueSchedules(next, "2026-11-25T15:12:10.000Z");
  assert.equal(next.schedules[0]!.recoveryPending, false);
  assert.equal(next.runs.filter(run => run.id.startsWith("scheduled:")).length, 1);
  assert.equal(next.schedules[0]!.missedPolicy, "ask");
});

test("AA108/213: delegation chooses a matching specialist only within the parent's capability and project ceiling", () => {
  const ws = queued(["web_search", "model", "delegate"], "Research sources and Analyze findings", { chatProvider: "gemini" });
  const parent = ws.agents[0]!;
  const research = addCustomAgent(ws, { name: "Research specialist", instructions: "Read sources", tools: ["web_search"], chatProvider: "gemini" }, NOW); assert.ok(research.ok);
  const analyst = addCustomAgent(research.ws, { name: "Analyze specialist", instructions: "Analyze", tools: ["model"], chatProvider: "gemini" }, NOW); assert.ok(analyst.ok);
  assert.equal(selectDelegatedAgent(analyst.ws.agents, parent, "Research sources").id, research.agent.id);
  assert.equal(selectDelegatedAgent(analyst.ws.agents, parent, "Analyze findings").id, analyst.agent.id);
  const escalated = { ...research.agent, tools: ["web_search", "gmail_send"] as FleetTool[] };
  assert.equal(selectDelegatedAgent([escalated], parent, "Research sources").id, parent.id);
  assert.equal(selectDelegatedAgent([{ ...research.agent, projectId: "other-project" }], parent, "Research sources").id, parent.id);
});

test("AA214: a batch authorizes only fifty exact requests and cannot expand to a different project", () => {
  let ws = queued(["browser"]);
  for (let index = 1; index < 51; index++) {
    const made = enqueueRun(ws, ws.agents[0]!.id, `Read https://example.test/${index}`, NOW); assert.ok(made.ok); ws = made.ws;
  }
  for (let index = 0; index < 13; index++) ws = tick(ws);
  const requests = ws.runs.slice(0, 50).map(run => ({ runId: run.id, approvalId: run.pendingApproval!.id }));
  const approved = approveRunBatch(ws, requests, null, 50, NOW); assert.ok(approved.ok);
  assert.equal(approved.ws.runs.filter(run => run.pendingApproval?.state === "granted").length, 50);
  assert.equal(approved.ws.runs[50]!.pendingApproval!.state, "requested");
  assert.equal(approveRunBatch(ws, [...requests, { runId: ws.runs[50]!.id, approvalId: ws.runs[50]!.pendingApproval!.id }], null, 50, NOW).ok, false);
  assert.equal(approveRunBatch(ws, requests, "other-project", 50, NOW).ok, false);
});

test("AA112: clearing selected finished history preserves active work and unresolved external evidence", () => {
  let ws = tick(tick(queued(["list_projects"])));
  const finished = ws.runs[0]!;
  const next = enqueueRun(ws, ws.agents[0]!.id, "Continue", NOW); assert.ok(next.ok); ws = next.ws;
  ws.runs.push({ ...finished, id: "unknown", state: "failed", externalOperation: { id: "operation", stepId: "step-1", state: "unknown", startedAt: NOW } });
  const cleared = clearFinishedRuns(ws, ws.runs.map(run => run.id));
  assert.equal(cleared.runs.some(run => run.id === finished.id), false);
  assert.equal(cleared.runs.some(run => run.id === next.run.id), true);
  assert.equal(cleared.runs.some(run => run.id === "unknown"), true);
});
