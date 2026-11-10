import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, addSchedule } from "./fleet.ts";
import { emptyWorkspace } from "./workspace.ts";
import { applyWorkbenchCommand } from "./workbench-command.ts";

const NOW = "2026-11-10T12:00:00.000Z";

function withAgent() {
  const added = addAgentFromTemplate(emptyWorkspace(), "Personal assistant", NOW);
  if (!added.ok) throw new Error(added.error);
  return added;
}

describe("workbench commands", () => {
  it("queues, steps, pauses and cancels a real local run", () => {
    const added = withAgent();
    const queued = applyWorkbenchCommand(added.ws, { type: "enqueue", agentId: added.agent.id, goal: "List the projects already stored" }, NOW);
    assert.equal(queued.ok, true);
    assert.equal(queued.workspace.runs[0]?.state, "queued");
    const stepped = applyWorkbenchCommand(queued.workspace, { type: "step" }, NOW);
    assert.equal(stepped.ok, true);
    assert.notEqual(stepped.workspace.runs[0]?.state, "queued");
    const paused = applyWorkbenchCommand(stepped.workspace, { type: "pause", runId: stepped.workspace.runs[0]!.id }, NOW);
    assert.equal(paused.workspace.runs[0]?.state, "paused");
    const canceled = applyWorkbenchCommand(paused.workspace, { type: "cancel", runId: paused.workspace.runs[0]!.id }, NOW);
    assert.equal(canceled.workspace.runs[0]?.state, "canceled");
    assert.match(canceled.workspace.runs[0]?.error ?? "", /Stopped/);
  });

  it("refuses new work while the emergency stop is on and still allows cancel", () => {
    const added = withAgent();
    const queued = applyWorkbenchCommand(added.ws, { type: "enqueue", agentId: added.agent.id, goal: "List projects" }, NOW);
    const halted = { ...queued.workspace, halted: true };
    const again = applyWorkbenchCommand(halted, { type: "enqueue", agentId: added.agent.id, goal: "Do more" }, NOW);
    assert.equal(again.ok, false);
    assert.equal(again.workspace.runs.length, 1);
    const canceled = applyWorkbenchCommand(halted, { type: "cancel", runId: halted.runs[0]!.id }, NOW);
    assert.equal(canceled.ok, true);
    assert.equal(canceled.workspace.runs[0]?.state, "canceled");
  });

  it("pauses a schedule without pretending it ran", () => {
    const added = withAgent();
    const scheduled = addSchedule(added.ws, "Morning check", added.agent.id, 60, NOW);
    assert.equal(scheduled.ok, true);
    const paused = applyWorkbenchCommand(scheduled.ws, { type: "set_schedule", id: scheduled.ws.schedules[0]!.id, enabled: false }, NOW);
    assert.equal(paused.ok, true);
    assert.equal(paused.workspace.schedules[0]?.enabled, false);
    assert.equal(paused.workspace.runs.length, 0);
  });
});
