import assert from "node:assert/strict";
import { test, describe, it } from "node:test";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { mergeWorkspaceEdits, resolveWorkspaceConflict, reconcileWorkspace } from "./workspace-edits.ts";
import { reconcileServerWorkspace, serverCheckpointKey, synchronizeWorkspace } from "./sync.ts";
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
import { applyWorkspaceDelta, createWorkspaceDelta, deltaIsEmpty, splitWorkspaceDelta, workspaceJsonBytes } from "./workspace-delta.ts";

const project = { id: "p", name: "Alpha", description: "Original", createdAt: "2026-01-01T00:00:00.000Z" };
const base = () => ({ ...emptyWorkspace(), projects: [project] });

test("C1/AA010-012: independent fields and additions survive active-state reconciliation", () => {
  const before = base();
  const remote = { ...before, projects: [{ ...project, name: "Beta" }] };
  const local = { ...before, projects: [{ ...project, description: "Updated" }, { ...project, id: "second", name: "Second" }] };
  const merged = reconcileServerWorkspace(local, remote, before);
  assert.equal(merged.needsReview, false);
  assert.deepEqual(merged.workspace.projects, [{ ...project, name: "Beta", description: "Updated" }, local.projects[1]]);
  assert.deepEqual(mergeWorkspaceEdits(merged.workspace, remote, merged.workspace), merged.workspace);
});

test("same-field conflicts preserve both values across normalization and require explicit resolution", () => {
  const before = base();
  const remote = { ...before, projects: [{ ...project, name: "Account" }] };
  const local = { ...before, projects: [{ ...project, name: "Device" }] };
  const merged = normalizeWorkspace(mergeWorkspaceEdits(remote, before, local));
  assert.equal(merged.projects[0].name, "Account");
  assert.equal(merged.syncConflicts?.[0].local, "Device");
  assert.equal(merged.syncConflicts?.[0].remote, "Account");
  const resolved = resolveWorkspaceConflict(merged, merged.syncConflicts![0].id, "local");
  assert.equal(resolved.projects[0].name, "Device");
  assert.deepEqual(resolved.syncConflicts, []);
  const persisted = mergeWorkspaceEdits(merged, merged, resolved);
  assert.equal(persisted.projects[0].name, "Device");
  assert.equal(persisted.syncConflicts?.length ?? 0, 0, "a reviewed conflict must not reappear during local persistence");
  assert.equal(mergeWorkspaceEdits(persisted, merged, merged).syncConflicts?.length ?? 0, 0, "an old tab must not restore a resolved conflict");
});

test("deleted records never silently return from an old tab; edited variant remains reviewable", () => {
  const before = base();
  const local = { ...before, projects: [{ ...project, name: "Stale edit" }] };
  const merged = mergeWorkspaceEdits({ ...before, projects: [] }, before, local);
  assert.deepEqual(merged.projects, []);
  assert.equal((merged.syncConflicts?.[0].local as typeof project).name, "Stale edit");
  assert.equal(merged.syncConflicts?.[0].remote, null);
});

test("missing common ancestor never guesses whether a missing record was deleted", () => {
  const local = base();
  const server = { ...emptyWorkspace(), projects: [{ ...project, id: "remote" }] };
  const merged = reconcileServerWorkspace(local, server, null);
  assert.equal(merged.needsReview, true);
  assert.deepEqual(merged.workspace.projects, local.projects);
  assert.equal(merged.workspace.syncConflicts?.length, 2);
  assert.notEqual(serverCheckpointKey("a"), serverCheckpointKey("b"));
});

test("missing-ancestor tool settings have an explicit resolvable conflict instead of an invisible sync hold", () => {
  const local = { ...emptyWorkspace(), toolPermissions: { search_notes: true } };
  const server = { ...emptyWorkspace(), toolPermissions: { search_notes: false } };
  const merged = reconcileServerWorkspace(local, server, null);
  assert.equal(merged.needsReview, true);
  const conflict = merged.workspace.syncConflicts![0];
  assert.equal(conflict.collection, "workspace");
  const resolved = resolveWorkspaceConflict(merged.workspace, conflict.id, "remote");
  assert.equal(resolved.toolPermissions?.search_notes, false);
  assert.equal(resolved.syncConflicts?.length, 0);
});

test("security-sensitive concurrent agent edits do not create an unreviewed combination", () => {
  const agent = { id: "a", name: "Agent", version: 1, role: "documents" as const, description: "", instructions: "reviewed", tools: ["list_projects" as const], projectId: null, memory: "off" as const, maxSteps: 2, approval: "ask" as const, archived: false, createdAt: project.createdAt, updatedAt: project.createdAt };
  const before = { ...emptyWorkspace(), agents: [agent] };
  const remote = { ...before, agents: [{ ...agent, instructions: "new procedure" }] };
  const local = { ...before, agents: [{ ...agent, approval: "automatic" as const }] };
  const merged = mergeWorkspaceEdits(remote, before, local);
  assert.equal(merged.agents[0].approval, "ask");
  assert.equal(merged.syncConflicts?.[0].field, "*");
});

test("C1/AA013,065: delta size follows changed records, not unrelated workspace capacity", () => {
  const before = base();
  before.files = Array.from({ length: 60 }, (_, index) => ({ id: `f${index}`, name: `${index}.txt`, text: "x".repeat(39000), bytes: 39000, projectId: null, createdAt: project.createdAt }));
  const next = { ...before, projects: [{ ...project, name: "Small edit" }] };
  const delta = createWorkspaceDelta(before, next);
  assert.ok(workspaceJsonBytes(before) > 1_500_000);
  assert.ok(workspaceJsonBytes(delta) < 1000);
  assert.deepEqual(applyWorkspaceDelta(before, delta), normalizeWorkspace(next));
  assert.equal(deltaIsEmpty(createWorkspaceDelta(next, next)), true);
  assert.throws(() => applyWorkspaceDelta(before, { version: 1, collections: { evil: { upsert: [], remove: [] } } }));
  assert.ok(workspaceJsonBytes({ text: "😀" }) > JSON.stringify({ text: "😀" }).length);
});

test("large initial workspaces split into bounded batches and resume from the last confirmed copy", () => {
  const before = emptyWorkspace();
  const next = normalizeWorkspace({ ...base(), files: Array.from({ length: 20 }, (_, index) => ({ id: `file-${index}`, name: `${index}.txt`, text: "j".repeat(100_000), projectId: null, createdAt: project.createdAt })),
    chats: [{ id: "long-chat", memory: "off", messages: Array.from({ length: 400 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", content: "x".repeat(5000), at: project.createdAt })) }] });
  const batches = splitWorkspaceDelta(createWorkspaceDelta(before, next));
  assert.ok(batches.length >= 3);
  assert.ok(batches.every((batch) => workspaceJsonBytes(batch) <= 1_500_000));
  const partiallySaved = applyWorkspaceDelta(before, batches[0]);
  const resumed = splitWorkspaceDelta(createWorkspaceDelta(partiallySaved, next)).reduce(applyWorkspaceDelta, partiallySaved);
  assert.deepEqual(resumed, next);
  const last = next.chats[0].messages.at(-1)!;
  const edited = { ...next, chats: [{ ...next.chats[0], messages: [...next.chats[0].messages.slice(0, -1), { ...last, content: "Corrected final answer" }] }] };
  const incremental = createWorkspaceDelta(next, edited);
  assert.ok(workspaceJsonBytes(incremental) < 1000);
  assert.equal(incremental.chatMessages?.["long-chat"].upsert.length, 1);
  assert.deepEqual(applyWorkspaceDelta(next, incremental), edited);
});

test("message deletion and reordering preserve untouched history and reject changes to missing conversations", () => {
  const before = normalizeWorkspace({ chats: [{ id: "chat", messages: ["one", "two", "three"].map((id) => ({ id, role: "user", content: id, at: project.createdAt })) }] });
  const next = { ...before, chats: [{ ...before.chats[0], title: "Renamed", messages: [before.chats[0].messages[2], before.chats[0].messages[0]] }] };
  assert.deepEqual(applyWorkspaceDelta(before, createWorkspaceDelta(before, next)), next);
  assert.throws(() => applyWorkspaceDelta(emptyWorkspace(), { version: 1, collections: {}, chatMessages: { missing: { upsert: [], remove: [] } } }), /Invalid conversation/);
});
