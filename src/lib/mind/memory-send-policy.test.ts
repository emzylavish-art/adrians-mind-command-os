import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace, createChat, addMemory, reviseMemory, deleteMemory } from "./workspace.ts";
import { memorySendRevision, checkMemorySendRevision } from "./memory-send-policy.ts";

test("C5 memory permission and note changes invalidate pending preparation and frozen retry", () => {
  let ws = emptyWorkspace();
  const { chat } = createChat(ws, { memory: "on", autonomy: "ask", temporary: false, projectId: null });
  ws.chats = [chat];
  ws = addMemory(ws, { text: "original private note", scope: "global", projectId: null, chatId: null, source: "fixture" });
  const rev = memorySendRevision(ws, chat);
  assert.equal(checkMemorySendRevision(ws, chat.id, rev), true);
  assert.equal(checkMemorySendRevision({ ...ws, chats: [{ ...chat, memory: "off" }] }, chat.id, rev), false);
  assert.equal(checkMemorySendRevision(reviseMemory(ws, ws.memories[0].id, "corrected note"), chat.id, rev), false);
  assert.equal(checkMemorySendRevision(deleteMemory(ws, ws.memories[0].id), chat.id, rev), false);
  assert.equal(checkMemorySendRevision({ ...ws, memories: ws.memories.map(n => ({ ...n, archived: true })) }, chat.id, rev), false);
  assert.equal(checkMemorySendRevision({ ...ws, audit: [{ id: "a", at: "", action: "opened", target: "settings", result: "ok" }] }, chat.id, rev), true);
});
