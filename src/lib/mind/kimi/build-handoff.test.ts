import assert from "node:assert/strict";
import test from "node:test";
import type { Chat, LocalFile } from "../types.ts";
import { parseChatBuildHandoff, prepareChatBuildHandoff } from "./build-handoff.ts";

const at = "2026-11-27T18:00:00.000Z";
const chat: Chat = {
  id: "chat-a", title: "Fixture", memory: "off", temporary: false, autonomy: "ask",
  projectId: "project-a", retrievalLog: [],
  messages: [
    { id: "first", role: "user", content: "Chosen prompt", at },
    { id: "unselected", role: "assistant", content: "Excluded reply", at },
    { id: "final", role: "assistant", content: "Chosen reply", at },
    { id: "failed", role: "assistant", content: "Interrupted", replyStatus: "interrupted", at },
  ],
};
const retained: LocalFile = { id: "file-a", name: "notes.txt", text: "Selected file bytes", bytes: 19, projectId: "project-a", createdAt: at, partial: true };
const unrelated: LocalFile = { ...retained, id: "other", projectId: "project-b", text: "Excluded workspace content" };

test("copies only reviewed messages and in-scope files in their conversation order", () => {
  const result = prepareChatBuildHandoff("owner-a", chat, [retained, unrelated], { chatId: "chat-a", messages: ["final", "first"], files: ["file-a"] });
  assert.ok(result.handoff);
  assert.equal(result.handoff.messageCount, 2);
  assert.equal(result.handoff.fileCount, 1);
  assert.match(result.handoff.text, /Chosen prompt[\s\S]*Chosen reply[\s\S]*retained excerpt[\s\S]*Selected file bytes/);
  assert.doesNotMatch(result.handoff.text, /Excluded|Interrupted/);
  assert.deepEqual(parseChatBuildHandoff(JSON.stringify(result.handoff), "owner-a"), result.handoff);
  assert.equal(parseChatBuildHandoff(JSON.stringify(result.handoff), "owner-b"), null);
  assert.equal(chat.messages.length, 4);
});

test("rejects private conversations, changed selections, unrelated files and over-limit content", () => {
  const selected = { chatId: "chat-a", messages: ["first"], files: [] };
  assert.ok(prepareChatBuildHandoff("owner-a", { ...chat, temporary: true }, [], selected).error);
  assert.ok(prepareChatBuildHandoff("owner-a", chat, [unrelated], { ...selected, files: ["other"] }).error);
  assert.ok(prepareChatBuildHandoff("owner-a", chat, [], { ...selected, messages: ["failed"] }).error);
  const largerFile = { ...retained, text: "x".repeat(8001) };
  assert.match(prepareChatBuildHandoff("owner-a", chat, [largerFile], { ...selected, files: ["file-a"] }).error ?? "", /8,000/);
});
