import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyWorkspace } from "./workspace.ts";
import { mergeWorkspaceEdits, reconcileWorkspace } from "./workspace-edits.ts";
import { synchronizeWorkspace } from "./sync.ts";
import type { AgentRun, Chat, Workspace } from "./types.ts";

const chat = (id: string): Chat => ({ id, title: id, memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] });
const workspace = (ids: string[]): Workspace => ({ ...emptyWorkspace(), chats: ids.map(chat) });

describe("C4 workspace reconciliation", () => {
  it("refreshes on Retry save and preserves independent conversations across devices", async () => {
    const base = workspace(["old"]);
    let remote = workspace(["old", "phone"]);
    let revision = "R2";
    let reads = 0;
    const saved = await synchronizeWorkspace({ local: workspace(["old", "computer"]), base, current: () => true,
      load: async () => { reads++; return { ok: true, workspace: remote, revision }; },
      save: async (candidate, expected) => { assert.equal(expected, "R2"); remote = candidate; revision = "R3"; return { ok: true, revision }; },
    });
    assert.equal(saved.ok, true);
    assert.equal(reads, 1);
    assert.deepEqual(new Set(remote.chats.map((row) => row.id)), new Set(["old", "phone", "computer"]));
  });

  it("uses another fresh comparison if the server advances during recovery", async () => {
    let reads = 0;
    let saves = 0;
    const result = await synchronizeWorkspace({ local: workspace(["old", "computer"]), base: workspace(["old"]), current: () => true,
      load: async () => ({ ok: true, workspace: workspace(reads++ ? ["old", "phone", "tablet"] : ["old", "phone"]), revision: `R${reads}` }),
      save: async (candidate, revision) => {
        if (!saves++) return { ok: false, conflict: true, error: "changed" };
        assert.equal(revision, "R2");
        assert.deepEqual(new Set(candidate.chats.map((row) => row.id)), new Set(["old", "phone", "tablet", "computer"]));
        return { ok: true, revision: "R3" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(reads, 2);
  });

  it("cannot convert a reload with no known base into silent replacement", async () => {
    let saves = 0;
    const local = workspace(["shared", "computer"]);
    local.chats[0].title = "Computer title";
    const remote = workspace(["shared", "phone"]);
    remote.chats[0].title = "Phone title";
    const result = await synchronizeWorkspace({ local, base: null, current: () => true,
      load: async () => ({ ok: true, workspace: remote, revision: "R2" }),
      save: async () => { saves++; return { ok: true, revision: "R3" }; },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.conflicts, [{ collection: "chats", id: "shared", field: "title" }]);
    assert.equal(saves, 0);
    assert.equal(local.chats[0].title, "Computer title");
    assert.equal(remote.chats[0].title, "Phone title");
  });

  it("requires another choice when the reviewed remote revision changes", async () => {
    const base = workspace(["shared"]);
    const local = structuredClone(base); local.chats[0].title = "Local";
    const remote = structuredClone(base); remote.chats[0].title = "New remote edit";
    let calls = 0;
    const result = await synchronizeWorkspace({ local, base, current: () => true, resolution: { preference: "local", revision: "R2" },
      load: async () => ({ ok: true, workspace: remote, revision: "R3" }),
      save: async () => { calls++; return { ok: true, revision: "R4" }; },
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  });

  it("applies an explicit conflicting-field choice while retaining unrelated changes", () => {
    const base = workspace(["shared"]);
    const local = structuredClone(base); local.chats[0].title = "Local";
    const remote = structuredClone(base); remote.chats[0].title = "Remote"; remote.chats.push(chat("phone"));
    assert.equal(reconcileWorkspace(remote, base, local).conflicts.length, 1);
    const kept = reconcileWorkspace(remote, base, local, "local");
    assert.equal(kept.workspace.chats[0].title, "Local");
    assert.equal(kept.workspace.chats[1].id, "phone");
    assert.equal(kept.conflicts.length, 0);
  });

  it("holds a remote deletion against a new local message for explicit review", () => {
    const base = workspace(["shared"]);
    const local = structuredClone(base);
    local.chats[0].messages.push({ id: "unsynced", role: "user", content: "Keep my work", at: "now" });
    const remote = workspace(["phone"]);
    const held = reconcileWorkspace(remote, base, local);
    assert.deepEqual(held.conflicts, [{ collection: "chats", id: "shared", field: "record deletion" }]);
    const kept = reconcileWorkspace(remote, base, local, "local");
    assert.equal(kept.workspace.chats.find((row) => row.id === "shared")?.messages[0].content, "Keep my work");
    assert.equal(kept.workspace.chats.some((row) => row.id === "phone"), true);
    assert.equal(reconcileWorkspace(remote, base, local, "server").workspace.chats.some((row) => row.id === "shared"), false);
  });

  it("merges independent fields and reflects creation, rename and deletion across tabs", () => {
    const base = workspace(["shared", "removed"]);
    base.projects = [{ id: "p", name: "Before", description: "Old", createdAt: "2026-01-01T00:00:00.000Z" }];
    const local = structuredClone(base); local.projects[0].description = "Local instructions";
    const remote = structuredClone(base); remote.projects[0].name = "New name"; remote.chats = [chat("shared"), chat("added")];
    const result = mergeWorkspaceEdits(remote, base, local);
    assert.deepEqual(result.projects[0], { ...base.projects[0], name: "New name", description: "Local instructions" });
    assert.deepEqual(result.chats.map((row) => row.id), ["shared", "added"]);
  });

  it("retains a remote halt for an unchanged device and permits an explicit clear based on that halt", () => {
    const base = workspace([]);
    assert.equal(reconcileWorkspace({ ...base, halted: true }, base, base).workspace.halted, true);
    assert.equal(reconcileWorkspace({ ...base, halted: true }, { ...base, halted: true }, { ...base, halted: false }).workspace.halted, false);
  });

  it("preserves a terminal run receipt when a stale device later edits its progress", () => {
    const base = workspace([]);
    const running: AgentRun = { id: "run", agentId: "agent", parentId: null, depth: 0, goal: "fixture", state: "running", step: 1,
      maxSteps: 3, workerId: "worker", leaseUntil: "later", approvedActions: [], plan: [], result: "", error: "", createdAt: "before", updatedAt: "before" };
    base.runs = [running];
    const remote = { ...base, runs: [{ ...running, state: "completed" as const, step: 3, result: "final receipt", workerId: null, leaseUntil: null, updatedAt: "complete" }] };
    const local = { ...base, runs: [{ ...running, step: 2, updatedAt: "stale" }] };
    const merged = mergeWorkspaceEdits(remote, base, local);
    assert.equal(merged.runs[0].state, "completed");
    assert.equal(merged.runs[0].step, 3);
    assert.equal(merged.runs[0].result, "final receipt");
    assert.equal(merged.runs[0].updatedAt, "complete");
  });

  it("does not publish after an account switch and preserves local changes when load fails", async () => {
    let current = true; let calls = 0;
    const result = await synchronizeWorkspace({ local: workspace(["private"]), base: null, current: () => current,
      load: async () => { current = false; return { ok: true, workspace: workspace([]), revision: "R1" }; },
      save: async () => { calls++; return { ok: true, revision: "R2" }; },
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
    const local = workspace(["private"]);
    const failed = await synchronizeWorkspace({ local, base: null, current: () => true,
      load: async () => ({ ok: false, error: "offline" }), save: async () => { throw Error("must not save"); },
    });
    assert.deepEqual(failed, { ok: false, error: "offline" });
    assert.equal(local.chats[0].id, "private");
  });
});
