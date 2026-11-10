import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, addSchedule, enqueueRun } from "./fleet.ts";
import { applyCorePass } from "./core-runtime.ts";
import { emptyWorkspace } from "./workspace.ts";

const NOW = "2026-11-10T12:00:00.000Z";

describe("core runtime pass", () => {
  it("cancels open work and pauses schedules when halted, without dropping memory", () => {
    const added = addAgentFromTemplate(emptyWorkspace(), "Personal assistant", NOW);
    if (!added.ok) throw new Error(added.error);
    const queued = enqueueRun(added.ws, added.agent.id, "List projects", NOW);
    if (!queued.ok) throw new Error(queued.error);
    const scheduled = addSchedule(queued.ws, "Hourly", added.agent.id, 60, NOW);
    if (!scheduled.ok) throw new Error(scheduled.error);
    const held = {
      ...scheduled.ws,
      halted: true,
      memories: [{
        id: "mem-1",
        scope: "global" as const,
        projectId: null,
        chatId: null,
        text: "Keep this",
        source: "owner",
        createdAt: NOW,
        updatedAt: NOW,
        archived: false,
        versions: [],
      }],
    };
    const result = applyCorePass({ workspace: held, now: NOW, workerId: "hosted-worker" });
    assert.equal(result.summary.halted, true);
    assert.equal(result.workspace.runs[0]?.state, "canceled");
    assert.equal(result.workspace.schedules[0]?.enabled, false);
    assert.equal(result.workspace.memories[0]?.text, "Keep this");
    assert.equal(result.workspace.audit.length >= 0, true);
  });

  it("steps a saved local run without calling a remote agent", () => {
    const added = addAgentFromTemplate(emptyWorkspace(), "Personal assistant", NOW);
    if (!added.ok) throw new Error(added.error);
    const queued = enqueueRun(added.ws, added.agent.id, "List projects", NOW);
    if (!queued.ok) throw new Error(queued.error);
    const result = applyCorePass({ workspace: queued.ws, now: NOW, workerId: "hosted-worker" });
    assert.equal(result.summary.halted, false);
    assert.match(result.summary.message, /No model, Paperclip agent/);
    assert.notEqual(result.workspace.runs[0]?.state, "queued");
  });
});
