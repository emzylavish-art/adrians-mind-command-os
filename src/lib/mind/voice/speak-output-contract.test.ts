import assert from "node:assert/strict";
import { test } from "node:test";
import { runSpeakAction, type SpeakRetryParams } from "./speak-action.ts";

const params: SpeakRetryParams = { correlationId: "fake-operation", chatCommitted: false, transcript: "Question", reply: null, audio: null, text: "Question", messageId: "fake-message", voiceId: "eve" };

for (const audio of [undefined, "", "   "]) test(`missing speech output fails and retries only speech (${JSON.stringify(audio)})`, async () => {
  let chatCalls = 0; let playCalls = 0;
  const deps = { chatTurn: async () => { chatCalls++; return { ok: true, text: "Retained answer" }; }, synthesize: async () => ({ ok: true, audio }), play: async () => { playCalls++; } };
  const first = await runSpeakAction(params, deps);
  assert.equal(first.ok, false); assert.equal(first.params.reply, "Retained answer"); assert.equal(first.params.chatCommitted, true); assert.equal(playCalls, 0);
  const retry = await runSpeakAction(first.params, { ...deps, synthesize: async () => ({ ok: true, audio: "ZmFrZQ==" }) });
  assert.equal(retry.ok, true); assert.equal(chatCalls, 1); assert.equal(playCalls, 1);
});

test("playback failure retains synthesized audio and retry does not call either provider again", async () => {
  let chats = 0; let syntheses = 0;
  const first = await runSpeakAction(params, { chatTurn: async () => { chats++; return { ok: true, text: "Answer" }; }, synthesize: async () => { syntheses++; return { ok: true, audio: "ZmFrZQ==" }; }, play: async () => { throw new Error("The browser blocked playback."); } });
  assert.equal(first.ok, false); assert.equal(first.params.audio, "ZmFrZQ==");
  const retry = await runSpeakAction(first.params, { chatTurn: async () => { chats++; }, synthesize: async () => { syntheses++; }, play: async () => {} });
  assert.equal(retry.ok, true); assert.equal(chats, 1); assert.equal(syntheses, 1);
});
