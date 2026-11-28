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

test("Work carries explicitly selected images and exact available original references without copying unchecked content", () => {
  const source = { ...chat, messages: [{ ...chat.messages[0], images: [{ blobId: "image-a", name: "chosen.png" }, { blobId: "image-b", name: "unchosen.png" }] }] };
  const binary = { ...retained, name: "original.bin", text: "", original: { blobId: "binary", sha256: "a".repeat(64), bytes: 3, mime: "application/octet-stream", name: "original.bin" } };
  const handoff = prepareChatBuildHandoff("owner-a", source, [binary], { chatId: source.id, messages: [], files: [binary.id], images: ["first:0"] });
  assert.ok(handoff.handoff);
  assert.deepEqual(handoff.handoff.media, { images: [{ messageId: "first", index: 0, name: "chosen.png", imageId: "image-a" }], originals: [{ fileId: "file-a", name: "original.bin", sha256: "a".repeat(64) }] });
  assert.match(handoff.handoff.text, /Original file for review/);
  assert.doesNotMatch(handoff.handoff.text, /unchosen.png/);
  assert.deepEqual(parseChatBuildHandoff(JSON.stringify(handoff.handoff), "owner-a"), handoff.handoff);
  assert.ok(prepareChatBuildHandoff("owner-a", source, [], { chatId: source.id, messages: [], files: [], images: ["missing:0"] }).error);
});
