import assert from "node:assert/strict";
import { it } from "node:test";
import type { Workspace } from "./types.ts";
import { createChat, addMemory, archiveWorkspace, canonical, emptyWorkspace, mergeChatDeletionState, mergeWorkspace, normalizeWorkspace, packWorkspace, pushAudit, replaceFromArchive, selectArchiveCategories, sha256, unpackWorkspace } from "./workspace.ts";
import { removeConversations } from "./conversation-sections.ts";
import { quoteIntoNewChat } from "./conversation-actions.ts";
import { mergeWorkspaceEdits } from "./workspace-edits.ts";

function fixture() {
  const one = createChat(emptyWorkspace(), { memory: "on", autonomy: "ask", temporary: false, projectId: null });
  const two = createChat(one.ws, { memory: "on", autonomy: "ask", temporary: false, projectId: null });
  return { original: two.ws, first: one.chat.id, second: two.chat.id };
}

it("a deleted conversation stays deleted after archive, browser and server reconciliation", () => {
  const { original, first, second } = fixture();
  const removed = removeConversations(original, [first]);
  assert.deepEqual(removed.deletedChatIds, [first]);
  for (const result of [mergeWorkspace(removed, original), mergeWorkspace(original, removed), mergeWorkspaceEdits(removed, original, original), normalizeWorkspace({ ...original, deletedChatIds: [first] }), { ...original, ...mergeChatDeletionState(original, removed) }]) {
    assert.deepEqual(result.chats.map((chat) => chat.id), [second]);
    assert.deepEqual(result.deletedChatIds, [first]);
  }
});

it("explicit replacement restores a deleted transcript under a new identity while retaining the deletion marker", () => {
  const { original, first } = fixture();
  const archive = addMemory(original, { scope: "chat", chatId: first, projectId: null, text: "saved note", source: "owner" });
  const restored = replaceFromArchive(removeConversations(original, [first]), archive);
  const recovered = restored.chats.find((chat) => chat.id !== original.chats[0].id)!;
  assert.notEqual(recovered.id, first);
  assert.equal(restored.memories[0].chatId, recovered.id);
  assert.ok(restored.deletedChatIds?.includes(first));
});

it("temporary exports remove linked resource markers while preserving explicitly saved unrelated notes", async () => {
  const made = createChat(emptyWorkspace(), { memory: "on", autonomy: "automatic", temporary: true, projectId: null });
  assert.equal(made.chat.memory, "off");
  const id = made.chat.id;
  made.chat.messages.push({ id: "m", role: "user", content: "TEMP_UNIQUE_MARKER", at: "2026-01-01" });
  let ws = addMemory(made.ws, { scope: "chat", chatId: id, projectId: null, text: "TEMP_UNIQUE_MARKER", source: "fixture" });
  ws = addMemory(ws, { scope: "global", chatId: null, projectId: null, text: "Keep owner note", source: "owner" });
  ws = pushAudit(ws, "read", id, "TEMP_UNIQUE_MARKER");
  ws.usage.push({ id: "u", chatId: id, at: "2026-01-01", model: "TEMP_UNIQUE_MARKER", requestId: null, promptTokens: null, completionTokens: null, kind: "unknown" });
  ws.pins.push({ id: "pin", kind: "chat", ref: id });
  const packed = await packWorkspace(ws, false);
  assert.doesNotMatch(JSON.stringify(packed.workspace), /TEMP_UNIQUE_MARKER/);
  assert.deepEqual(packed.workspace.memories.map((note) => note.text), ["Keep owner note"]);
  assert.equal(packed.workspace.pins.length, 0);
  assert.match(JSON.stringify(archiveWorkspace(ws, true)), /TEMP_UNIQUE_MARKER/);
});

it("older valid temporary archives keep integrity verification while normalizing effective memory off", async () => {
  const made = createChat(emptyWorkspace(), { memory: "on", autonomy: "ask", temporary: true, projectId: null });
  const old = { ...made.ws, chats: [{ ...made.chat, memory: "on" }] };
  const envelope = { product: "adrians-mind", format: 1, workspace: old, sha256: await sha256(canonical(old)) };
  const result = await unpackWorkspace(JSON.stringify(envelope));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.workspace.chats[0].memory, "off");
  envelope.workspace.chats[0].title = "tampered";
  assert.equal((await unpackWorkspace(JSON.stringify(envelope))).ok, false);
});

it("bulk deletion records all identities without their content; quote provenance survives normalization", () => {
  const { original, first, second } = fixture();
  const copy = quoteIntoNewChat(original, original.chats[0]);
  const quoted = normalizeWorkspace(copy.ws).chats.find((chat) => chat.id === copy.chatId)!;
  assert.equal(quoted.quotedFrom?.chatId, second);
  const gone = pushAudit(removeConversations(copy.ws, [first, second]), "delete_chat", first, "browser removed; server pending", [first, second]);
  const reloaded = normalizeWorkspace(gone);
  assert.deepEqual(reloaded.audit[0].targetIds, [first, second]);
  assert.equal(reloaded.chats[0].id, copy.chatId);
});

it("selective restoration preserves unrelated data and never imports execution authority", () => {
  const { original } = fixture();
  const archive: Workspace = { ...emptyWorkspace(), files: [{ id: "f", name: "saved.txt", text: "keep", bytes: 4, projectId: null, createdAt: "2026-01-01" }], schedules: [{ id: "job", name: "Unsafe inherited job", agentId: null, enabled: true, intervalMinutes: 60, nextRunAt: "2026-01-01", lastRunAt: null, lastError: "", timeZone: "UTC", clockHour: null, clockMinute: null, leaseWorker: "old-worker", leaseUntil: "future", lastStatus: "" }] };
  const selected = mergeWorkspace(original, selectArchiveCategories(archive, ["files"]));
  assert.deepEqual(selected.chats, original.chats);
  assert.equal(selected.files[0].id, "f");
  assert.equal(selected.schedules.length, 0);
  const all = mergeWorkspace(original, archive);
  assert.equal(all.schedules[0].enabled, false);
  assert.equal(all.schedules[0].leaseWorker, null);
  const replaced = replaceFromArchive(original, archive);
  assert.equal(replaced.schedules[0].enabled, false);
});
