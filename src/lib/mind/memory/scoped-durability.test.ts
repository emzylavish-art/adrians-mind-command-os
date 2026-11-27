import assert from "node:assert/strict";
import { it } from "node:test";
import { createOwnerMemory, editOwnerMemory, deleteOwnerMemory, listOwnerMemories } from "./owner-ops.ts";
import { rankMemories } from "./relevant.ts";
import { addMemory, createChat, emptyWorkspace, mergeWorkspace, normalizeWorkspace, replaceFromArchive, workspaceForChat } from "../workspace.ts";
import { eveAccessNotes } from "../eve-access.ts";
import { readSnapshot, snapshotRevision, writeSnapshot } from "../store.ts";
import { readRatings, saveRating } from "../routing-modes.ts";

it("preserves simultaneous acknowledgements, corrections and forget across stale saves and imports", async () => {
  // The normal DB adapter must use disposable node:test storage, never a configured hosted DB.
  const { dbSource, getSql } = await import("../../db.ts");
  assert.equal(dbSource, "pglite");
  const sql = await getSql();
  const owner = crypto.randomUUID();
  const results = await Promise.all(["A", "B"].map((text) => createOwnerMemory(sql, owner, { scope: "global", text })));
  assert.ok(results[0].ok && results[1].ok);
  const before = normalizeWorkspace(await readSnapshot(sql, owner));
  assert.deepEqual(before.memories.map((note) => note.text).sort(), ["A", "B"]);
  const a = results[0].item.id, b = results[1].item.id;
  await Promise.all([deleteOwnerMemory(sql, owner, a), editOwnerMemory(sql, owner, b, "corrected")]);
  assert.equal(await writeSnapshot(sql, owner, before), null, "stale writes without an explicit revision are rejected");
  const after = normalizeWorkspace(await readSnapshot(sql, owner));
  assert.deepEqual(after.memories.map((note) => note.text), ["corrected"]);
  assert.deepEqual(mergeWorkspace(after, before).memories.map((note) => note.text), ["corrected"]);
  assert.deepEqual((await listOwnerMemories(sql, crypto.randomUUID())).memories, []);
  const restored = replaceFromArchive(after, before);
  await writeSnapshot(sql, owner, restored, snapshotRevision(await readSnapshot(sql, owner)));
  const reopened = normalizeWorkspace(await readSnapshot(sql, owner));
  assert.deepEqual(reopened.memories.map((note) => note.text).sort(), ["A", "B"]);
  assert.ok(!reopened.memories.some((note) => note.id === a));
});

it("keeps project, chat and disabled-memory markers out of voice/tool context and ranks relevant notes first", () => {
  const initial = emptyWorkspace();
  initial.projects = ["one", "two"].map((id) => ({ id, name: id, description: "", createdAt: "2026-01-01T00:00:00.000Z" }));
  const one = createChat(initial, { projectId: "one", temporary: false, memory: "on", autonomy: "ask" });
  const two = createChat(one.ws, { projectId: "two", temporary: false, memory: "on", autonomy: "ask" });
  two.chat.title = "Foreign marker";
  let ws = two.ws;
  for (const chat of [one.chat, two.chat]) {
    ws = addMemory(ws, { text: chat.projectId + " release language", scope: "project", projectId: chat.projectId, chatId: null, source: "owner" });
  }
  for (let i = 0; i < 12; i++) ws = addMemory(ws, { text: "unrelated", scope: "global", projectId: null, chatId: null, source: "owner" });
  const visible = workspaceForChat(ws, one.chat);
  assert.doesNotMatch(JSON.stringify(eveAccessNotes(visible)), /Foreign marker/);
  assert.ok(!visible.memories.some((note) => note.text.startsWith("two")));
  assert.equal(rankMemories(visible.memories, "preferred release language")[0].item.text, "one release language");
  const off = workspaceForChat(ws, { ...one.chat, memory: "off" });
  assert.deepEqual(off.memories, []);
  assert.deepEqual(off.chats, []);
});

it("retrieves feedback only in the owner's namespace", () => {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  saveRating(storage, { messageId: "one", score: 4, model: "fixture", mode: "A", at: "now" }, "account:alpha");
  assert.equal(readRatings(storage, "account:alpha").length, 1);
  assert.deepEqual(readRatings(storage, "account:beta"), []);
  assert.deepEqual(readRatings(storage), []);
});
