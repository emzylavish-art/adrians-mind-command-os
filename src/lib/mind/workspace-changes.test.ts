import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWorkspaceChanges, planWorkspaceChanges, validateWorkspaceChanges } from "./workspace-changes.ts";
import { createChat, emptyWorkspace, normalizeWorkspace } from "./workspace.ts";

test("changed resources preserve client order while unchanged collections are omitted", () => {
  const first = createChat(emptyWorkspace(), { memory: "off", temporary: false, autonomy: "ask", projectId: null });
  const second = createChat(first.ws, { memory: "off", temporary: false, autonomy: "ask", projectId: null });
  const changes = planWorkspaceChanges(first.ws, second.ws);
  assert.equal(changes.upserts.chats?.length, 1); assert.equal(changes.upserts.memories, undefined);
  assert.deepEqual(normalizeWorkspace(applyWorkspaceChanges(first.ws, changes)), normalizeWorkspace(second.ws));
});

test("explicit resource deletion creates tombstones even for a legacy caller", () => {
  const first = createChat(emptyWorkspace(), { memory: "off", temporary: false, autonomy: "ask", projectId: null });
  const changed = applyWorkspaceChanges(first.ws, { version: 1, upserts: {}, deletes: { chats: [first.chat.id] } });
  assert.deepEqual(changed.chats, []); assert.deepEqual(changed.deletedChatIds, [first.chat.id]);
});

test("delta validation rejects oversized, unknown, duplicate, and contradictory resources", () => {
  assert.equal(validateWorkspaceChanges({ version: 1, upserts: {}, deletes: {} }).ok, true);
  assert.equal(validateWorkspaceChanges({ version: 1, upserts: { secrets: [{ id: "x" }] }, deletes: {} }).ok, false);
  assert.equal(validateWorkspaceChanges({ version: 1, upserts: { chats: [{ id: "x" }, { id: "x" }] }, deletes: {} }).ok, false);
  assert.equal(validateWorkspaceChanges({ version: 1, upserts: { chats: [{ id: "x" }] }, deletes: { chats: ["x"] } }).ok, false);
  assert.equal(validateWorkspaceChanges({ version: 1, upserts: { chats: [{ id: "x", content: "x".repeat(1_500_000) }] }, deletes: {} }).ok, false);
});
