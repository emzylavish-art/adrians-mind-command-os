import assert from "node:assert/strict";
import test from "node:test";
import type { Chat, Msg } from "./types.ts";
import { shareableChatText, chatTextDigest } from "./chat-share.ts";

const message: Msg = { id: "one", role: "assistant", content: "Reviewed answer", at: "2026-01-01" };
const chat = { title: "Reviewed title", messages: [message] } as Chat;

test("review includes only completed text and omits attachment and account metadata", () => {
  const messages: Msg[] = [
    { ...message, videoUrl: "private asset", savedMemoryId: "private reference" },
    { ...message, kind: "error" }, { ...message, delivery: "unconfirmed" },
    { ...message, replyStatus: "streaming" }, { ...message, replyStatus: "interrupted" },
    { ...message, content: " " },
  ];
  assert.deepEqual(shareableChatText({ ...chat, messages }), {
    title: chat.title, messages: [{ role: "assistant", text: message.content }],
  });
  assert.equal(shareableChatText({ ...chat, temporary: true }), null);
  assert.equal(shareableChatText({ ...chat, messages: [] }), null);
});

test("digest binds the title, speaker and exact approved text", async () => {
  const reviewed = shareableChatText(chat)!;
  const digest = await chatTextDigest(reviewed);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(await chatTextDigest(structuredClone(reviewed)), digest);
  for (const edited of [
    { ...reviewed, title: "Changed" },
    { ...reviewed, messages: [{ role: "user" as const, text: message.content }] },
    { ...reviewed, messages: [{ role: "assistant" as const, text: message.content + "!" }] },
  ]) assert.notEqual(await chatTextDigest(edited), digest);
});
