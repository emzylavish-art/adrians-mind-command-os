import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { mergeWorkspaceEdits, resolveWorkspaceConflict } from "./workspace-edits.ts";
import { reconcileServerWorkspace, serverCheckpointKey } from "./sync.ts";
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
