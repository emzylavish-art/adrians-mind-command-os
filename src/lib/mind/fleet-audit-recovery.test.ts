import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, addSchedule, approveRunAction, buildTaskPlan, cancelRun, enqueueRun, haltFleet, readFleet, runDueSchedules, setScheduleEnabled, setSchedulePolicy, tickFleet } from "./fleet.ts";
import { emptyWorkspace } from "./workspace.ts";
import { decide, classifyAction } from "./policy.ts";
import { applyWorkbenchCommand } from "./workbench-command.ts";
import { scheduleRecovery } from "./schedule-recovery.ts";

const NOW = "2026-11-25T12:00:00.000Z";
const NEXT = "2026-11-25T12:01:00.000Z";
const env = (now = NOW) => ({ now, workerId: "audit-worker" });
function queued(template = "Personal assistant", goal = "alpha", memory?: "on") {
  const made = addAgentFromTemplate(emptyWorkspace(), template, NOW);
  if (!made.ok) throw new Error(made.error);
  assert.equal(made.ok, true);
  if (memory) made.agent.memory = memory;
  const result = enqueueRun(made.ws, made.agent.id, goal, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.ws;
}
function scheduled() {
  const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
  if (!made.ok) throw new Error(made.error);
  const result = addSchedule(made.ws, "Local inventory", made.agent.id, 60, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.ws;
}

describe("C2 fleet execution and approval regressions", () => {
  it("AA-034 chooses explicit goal tools without adding capabilities or inventing an AI plan", () => {
    const tools = ["list_projects", "list_chats", "search_notes"] as const;
    const projects = buildTaskPlan("List my projects", [...tools]);
    assert.deepEqual(projects.map((step) => step.tool), ["list_projects"]);
    assert.equal(projects[0]?.selection, "goal");
    const notes = buildTaskPlan("Find saved notes about harbor", [...tools]);
    assert.deepEqual(notes.map((step) => step.tool), ["search_notes"]);
    assert.deepEqual(buildTaskPlan("Harbor", [...tools]).map((step) => step.selection), ["template", "template", "template"]);
    assert.deepEqual(buildTaskPlan("Research harbor", ["list_projects"]), []);
    const made = addAgentFromTemplate(emptyWorkspace(), "Personal assistant", NOW);
    if (!made.ok) throw new Error(made.error);
    const refused = enqueueRun(made.ws, made.agent.id, "Research harbor", NOW);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.error, /no substitute workflow/);
  });

  it("AA-101/104 passes the approved objective to a read-page driver and retains its evidence", () => {
    let ws = tickFleet(queued("Browser operator", "Inspect https://example.com/harbor for opening hours"), env());
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, NOW);
    ws = tickFleet(ws, { ...env(NEXT), browser: (url, objective) => {
      assert.equal(url, "https://example.com/harbor");
      assert.equal(objective.capability, "read_page");
      assert.match(objective.goal, /opening hours/);
      return { ok: true, title: "Harbor", excerpt: "Opens at 08:00" };
    } });
    assert.match(ws.runs[0]!.stepResults?.[0]?.output ?? "", /Opens at 08:00/);
    assert.match(ws.browserSessions[0]!.lastAction, /No page interaction/);
    const missing = tickFleet(queued("Browser operator", "Read the page for opening hours"), env());
    assert.equal(missing.runs[0]!.state, "waiting_external");
    assert.match(missing.runs[0]!.error, /explicit http\(s\) destination/);
    assert.deepEqual(missing.runs[0]!.approvalHistory, []);
  });

  it("AA-033 executes the saved tool order even if the live list is reordered", () => {
    let ws = queued();
    ws = tickFleet(ws, env());
    ws.agents[0]!.tools = ["search_notes", "list_projects", "list_chats"];
    const next = tickFleet(ws, env(NEXT));
    assert.equal(next.runs[0]!.stepResults?.[1]?.tool, "list_chats");
    assert.equal(next.runs[0]!.plan[1]!.tool, "list_chats");
  });

  it("AA-033 pauses if the saved capability is removed instead of substituting a tool", () => {
    const ws = queued();
    ws.agents[0]!.tools = ["web_search"];
    let calls = 0;
    const next = tickFleet(ws, { ...env(), search: () => { calls++; return { ok: true, citations: [], error: "" }; } });
    assert.equal(next.runs[0]!.state, "paused");
    assert.match(next.runs[0]!.error, /no longer permits/);
    assert.equal(calls, 0);
  });

  it("AA-035 passes a declared prior record identity and blocks missing dependencies", () => {
    let ws = queued("Personal assistant", "alpha", "on");
    ws.projects = [{ id: "PROJECT_ALPHA", name: "Alpha", description: "", createdAt: NOW }];
    ws.runs[0]!.plan[1] = { id: "step-2", tool: "search_notes", need: "none", title: "Use selected identity", dependsOn: ["step-1"], inputFrom: { stepId: "step-1", field: "recordIds" } };
    ws.memories = [{ id: "n", text: "PROJECT_ALPHA evidence", source: "fixture", scope: "global", projectId: null, chatId: null, createdAt: NOW, updatedAt: NOW, archived: false, versions: [] }];
    ws = tickFleet(ws, env());
    assert.deepEqual(ws.runs[0]!.stepResults?.[0]?.recordIds, ["PROJECT_ALPHA"]);
    const next = tickFleet(ws, env(NEXT));
    assert.match(next.runs[0]!.stepResults?.[1]?.output ?? "", /PROJECT_ALPHA evidence/);
    ws.runs[0]!.stepResults = [];
    const failed = tickFleet(ws, env(NEXT));
    assert.equal(failed.runs[0]!.state, "failed");
    assert.match(failed.runs[0]!.error, /required step result/);
  });

  it("AA-036 a step budget never reports the unexecuted remainder as completed", () => {
    let ws = queued();
    ws.runs[0]!.maxSteps = 1;
    ws = tickFleet(ws, env());
    ws = tickFleet(ws, env(NEXT));
    assert.equal(ws.runs[0]!.state, "failed");
    assert.match(ws.runs[0]!.error, /1 of 3 planned steps/);
    assert.equal(ws.runs[0]!.step, 1);
  });

  it("AA-056 unknown operation kinds fail closed even with matching approval text", () => {
    assert.equal(classifyAction("new_unregistered_send"), "unknown");
    assert.equal(decide({ kind: "new_unregistered_send", autonomy: "automatic", halted: false, approvalToken: "a", expectedToken: "a" }).decision, "deny");
    assert.equal(decide({ kind: "lookup", autonomy: "automatic", halted: false, approvalToken: null, expectedToken: null }).decision, "allow");
  });

  it("AA-057/058 binds approval to exact plan and destination and refuses ineligible mutations", () => {
    let ws = tickFleet(queued("Browser operator", "https://example.com/a"), env());
    const id = ws.runs[0]!.id;
    assert.equal(approveRunAction(ws, id, "gmail_send", NOW), ws);
    const halted = { ...ws, halted: true };
    assert.equal(approveRunAction(halted, id, "browser", NOW), halted);
    ws = approveRunAction(ws, id, ws.runs[0]!.pendingApproval!.id, NOW);
    assert.equal(ws.runs[0]!.state, "queued");
    ws.runs[0]!.goal = "https://example.com/b";
    let calls = 0;
    const driver = () => { calls++; return { ok: true as const, title: "fixture", excerpt: "" }; };
    ws = tickFleet(ws, { ...env(NEXT), browser: driver });
    assert.equal(ws.runs[0]!.state, "waiting_approval");
    assert.equal(calls, 0);
    ws = approveRunAction(ws, id, ws.runs[0]!.pendingApproval!.id, NEXT);
    ws = tickFleet(ws, { ...env(NEXT), browser: driver });
    assert.equal(calls, 1);
    assert.equal(ws.runs[0]!.approvalHistory?.find(entry => entry.state === "consumed")?.updatedAt, NEXT);
    ws = tickFleet(ws, env(NEXT));
    assert.equal(approveRunAction(ws, id, "browser", NEXT), ws);
  });

  it("AA-057 ignores legacy blanket approvals and expired operation approval", () => {
    let ws = queued("Browser operator", "https://example.com/a");
    ws.runs[0]!.approvedActions = ["browser"];
    let calls = 0;
    const browser = () => { calls++; return { ok: true as const, title: "fixture", excerpt: "" }; };
    ws = tickFleet(ws, { ...env(), browser });
    assert.equal(ws.runs[0]!.state, "waiting_approval");
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, NOW);
    ws = tickFleet(ws, { ...env("2026-11-25T12:11:00.000Z"), browser });
    assert.equal(ws.runs[0]!.state, "waiting_approval");
    assert.equal(calls, 0);
  });

  it("AA-059 a driver failure after dispatch consumes approval and records an unknown external outcome", () => {
    let ws = tickFleet(queued("Browser operator", "https://example.com/a"), env());
    ws = approveRunAction(ws, ws.runs[0]!.id, ws.runs[0]!.pendingApproval!.id, NOW);
    let calls = 0;
    ws = tickFleet(ws, { ...env(NEXT), browser: () => { calls++; throw new Error("fixture driver closed"); } });
    assert.equal(calls, 1);
    assert.equal(ws.runs[0]!.state, "failed");
    assert.equal(ws.runs[0]!.stopDispatchOutcome, "outcome_unknown");
    assert.equal(ws.runs[0]!.approvalHistory?.find(entry => entry.state === "consumed")?.updatedAt, NEXT);
    assert.equal(tickFleet(ws, env(NEXT)), ws);
  });

  it("AA-059 differentiates a stopped queued run from a potentially dispatched run", () => {
    const ws = queued();
    const id = ws.runs[0]!.id;
    assert.equal(cancelRun(ws, id, NOW).runs[0]!.stopDispatchOutcome, "not_dispatched");
    ws.runs[0]!.state = "running";
    const stopped = haltFleet({ ...ws, halted: true }, NEXT);
    assert.equal(stopped.runs[0]!.stopDispatchOutcome, "outcome_unknown");
    assert.match(stopped.runs[0]!.error, /previously dispatched/);
  });

  it("AA-086/089 repeated resume, pause, cancel and mismatched approval report no change", () => {
    let ws = queued(); const id = ws.runs[0]!.id;
    assert.equal(applyWorkbenchCommand(ws, { type: "resume", runId: id }, NOW).ok, false);
    ws = applyWorkbenchCommand(ws, { type: "pause", runId: id }, NOW).workspace;
    assert.equal(applyWorkbenchCommand(ws, { type: "pause", runId: id }, NOW).ok, false);
    ws = applyWorkbenchCommand(ws, { type: "cancel", runId: id }, NOW).workspace;
    assert.equal(applyWorkbenchCommand(ws, { type: "cancel", runId: id }, NOW).ok, false);
    ws = tickFleet(queued("Browser operator", "https://example.com"), env());
    assert.equal(applyWorkbenchCommand(ws, { type: "approve", runId: ws.runs[0]!.id, actionId: "gmail_send" }, NOW).ok, false);
  });

  it("AA-062/088 leased and empty fleets preserve identity and report no advancement", () => {
    const empty = emptyWorkspace();
    assert.equal(tickFleet(empty, env()), empty);
    assert.equal(runDueSchedules(empty, NOW), empty);
    assert.equal(applyWorkbenchCommand(empty, { type: "step" }, NOW).ok, false);
    const ws = queued();
    ws.runs[0]!.workerId = "another-worker";
    ws.runs[0]!.leaseUntil = NEXT;
    assert.equal(tickFleet(ws, env()), ws);
    assert.equal(applyWorkbenchCommand(ws, { type: "step" }, NOW).ok, false);
  });

  it("AA-023/099 excludes deleted-project context, archived and temporary chats", () => {
    const orphaned = queued();
    orphaned.agents[0]!.projectId = "gone";
    assert.equal(tickFleet(orphaned, env()).runs[0]!.state, "paused");
    let ws = queued();
    ws.chats = [
      { id: "visible", title: "Visible", memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] },
      { id: "hidden", title: "PRIVATE_ARCHIVED", memory: "off", temporary: false, archived: true, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] },
      { id: "temp", title: "PRIVATE_TEMP", memory: "off", temporary: true, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] },
    ];
    ws = tickFleet(tickFleet(ws, env()), env(NEXT));
    assert.match(ws.runs[0]!.result, /Visible/);
    assert.doesNotMatch(ws.runs[0]!.result, /PRIVATE_/);
  });
});

describe("C2 scheduled occurrences", () => {
  it("AA-028 delivers a completed result only to the selected conversation, once", () => {
    let ws = scheduled();
    ws.chats = [{ id: "selected", title: "Selected", memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] }, { id: "other", title: "Other", memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] }];
    ws.schedules[0]!.chatId = "selected";
    ws = runDueSchedules(ws, NOW);
    ws.runs[0] = { ...ws.runs[0]!, state: "completed", result: "Synthetic task result", updatedAt: NEXT };
    ws = tickFleet(ws, env(NEXT));
    assert.equal(ws.chats[0]!.messages.length, 0); // default destination is Runs only
    ws = setSchedulePolicy(ws, ws.schedules[0]!.id, { resultDelivery: "conversation" });
    ws = tickFleet(ws, env(NEXT));
    assert.equal(ws.chats[0]!.messages.length, 1);
    assert.equal(ws.chats[1]!.messages.length, 0);
    assert.match(ws.chats[0]!.messages[0]!.content, /Synthetic task result/);
    assert.equal(ws.chats[0]!.messages[0]!.provider, "Local workflow");
    assert.equal(ws.schedules[0]!.occurrences?.[0]?.deliveredAt, NEXT);
    const reopened = { ...ws, ...readFleet(ws) };
    assert.equal(tickFleet(reopened, env(NEXT)), reopened);
    assert.equal(reopened.chats[0]!.messages.length, 1);
  });

  it("AA-028 never resurrects or substitutes a missing or archived result destination", () => {
    for (const mode of ["missing", "archived"] as const) {
      let ws = scheduled();
      ws.schedules[0]!.chatId = "original";
      ws.chats = [{ id: "original", title: "Original", memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] }];
      ws = setSchedulePolicy(ws, ws.schedules[0]!.id, { resultDelivery: "conversation" });
      ws = runDueSchedules(ws, NOW);
      ws.runs[0] = { ...ws.runs[0]!, state: "completed", result: "Private result", updatedAt: NEXT };
      ws.chats = mode === "missing" ? [] : [{ ...ws.chats[0]!, archived: true }];
      ws = tickFleet(ws, env(NEXT));
      assert.equal(ws.chats.length, mode === "missing" ? 0 : 1);
      assert.equal(ws.chats[0]?.messages.length ?? 0, 0);
      assert.match(ws.schedules[0]!.occurrences?.[0]?.deliveryError ?? "", /original conversation/);
      assert.equal(tickFleet(ws, env(NEXT)), ws);
    }
  });

  it("keeps a queued result bound to the conversation selected when scheduled", () => {
    let ws = scheduled();
    ws.chats = ["original", "replacement"].map((id) => ({ id, title: id, memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] }));
    ws.schedules[0]!.chatId = "original";
    ws = setSchedulePolicy(ws, ws.schedules[0]!.id, { resultDelivery: "conversation" });
    ws = runDueSchedules(ws, NOW);
    ws = { ...ws, ...readFleet(ws) };
    ws.schedules[0]!.chatId = "replacement";
    ws.runs[0] = { ...ws.runs[0]!, state: "completed", result: "Original conversation only", updatedAt: NEXT };
    ws = tickFleet(ws, env(NEXT));
    assert.equal(ws.chats.flatMap((chat) => chat.messages).length, 0);
    assert.equal(ws.runs[0]!.result, "Original conversation only");
    assert.match(ws.schedules[0]!.occurrences?.[0]?.deliveryError ?? "", /original conversation/);
  });

  it("AA-026 preserves cadence and records one bounded catch-up with missed count", () => {
    const ws = scheduled();
    const later = "2026-11-25T15:30:00.000Z";
    const next = runDueSchedules(ws, later);
    assert.equal(next.runs.length, 1);
    assert.equal(next.schedules[0]!.nextRunAt, "2026-11-25T16:00:00.000Z");
    assert.equal(next.schedules[0]!.occurrences?.[0]?.missedCount, 3);
    assert.equal(runDueSchedules(next, later), next);
    const normalized = readFleet(next);
    assert.equal(normalized.schedules[0]!.occurrences?.[0]?.runId, next.runs[0]!.id);
  });

  it("AA-026 skip and review never dispatch missed work", () => {
    for (const policy of ["skip", "review"] as const) {
      let ws = scheduled();
      ws = setSchedulePolicy(ws, ws.schedules[0]!.id, { missedPolicy: policy });
      const next = runDueSchedules(ws, "2026-11-25T15:30:00.000Z");
      assert.equal(next.runs.length, 0);
      if (policy === "skip") assert.equal(next.schedules[0]!.occurrences?.[0]?.state, "skipped");
      else assert.equal(next.schedules[0]!.enabled, false);
    }
  });

  it("AA-026 an explicit one-time catch-up resolves review without changing future policy", () => {
    let ws = scheduled();
    const id = ws.schedules[0]!.id;
    const later = "2026-11-25T15:30:00.000Z";
    ws = setSchedulePolicy(ws, id, { missedPolicy: "review" });
    ws = runDueSchedules(ws, later);
    assert.equal(ws.schedules[0]!.enabled, false);
    ws = setScheduleEnabled(ws, id, true, later, true);
    ws = runDueSchedules(ws, later);
    assert.equal(ws.runs.length, 1);
    assert.equal(ws.schedules[0]!.missedPolicy, "review");
    assert.equal(ws.schedules[0]!.approvedCatchUpFor, undefined);
    assert.equal(ws.schedules[0]!.nextRunAt, "2026-11-25T16:00:00.000Z");
    assert.equal(runDueSchedules(ws, later), ws);
  });

  it("AA-027 waits by default and tracks separately authorized overlapping outcomes", () => {
    let ws = scheduled(); const id = ws.schedules[0]!.id;
    ws = runDueSchedules(ws, NOW);
    const first = ws.runs[0]!.id;
    const waited = runDueSchedules(ws, "2026-11-25T13:00:00.000Z");
    assert.equal(waited.runs.length, 1);
    assert.match(waited.schedules[0]!.lastError, /Waiting/);
    ws = setSchedulePolicy(waited, id, { overlapPolicy: "parallel" });
    ws = runDueSchedules(ws, "2026-11-25T13:00:00.000Z");
    const second = ws.runs.find((run) => run.id !== first)!.id;
    ws.runs = ws.runs.map((run) => ({ ...run, state: run.id === second ? "completed" as const : "waiting_approval" as const, updatedAt: NEXT }));
    ws = tickFleet(ws, env(NEXT));
    assert.equal(ws.schedules[0]!.occurrences?.find((item) => item.runId === second)?.state, "completed");
    assert.equal(ws.schedules[0]!.occurrences?.find((item) => item.runId === first)?.state, "waiting_approval");
    ws.runs = ws.runs.map((run) => run.id === first ? { ...run, state: "failed" as const, error: "fixture failure", updatedAt: "2026-11-25T13:03:00.000Z" } : run);
    ws = tickFleet(ws, env("2026-11-25T13:03:00.000Z"));
    assert.equal(ws.schedules[0]!.occurrences?.find((item) => item.runId === first)?.state, "failed");
    assert.equal(ws.schedules[0]!.occurrences?.find((item) => item.runId === second)?.state, "completed");
  });

  it("clock schedule recovery uses the timezone resolver without replaying effects", () => {
    const result = scheduleRecovery({ nextRunAt: NOW, intervalMinutes: 1440, timeZone: "UTC", clockHour: 12, clockMinute: 0 }, "2026-11-27T12:00:00.000Z");
    assert.equal(result.dueCount, 3);
    assert.equal(result.nextRunAt, "2026-11-28T12:00:00.000Z");
  });
});
