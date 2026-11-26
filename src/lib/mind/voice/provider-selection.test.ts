import assert from "node:assert/strict";
import { test } from "node:test";
import { loadVoiceStages, VOICE_STAGES_KEY } from "./provider-selection.ts";
import { resolveSelectedSpeechCredential, speakSelected, transcribeSelected } from "./provider-selection.server.ts";
import { snapshotSpeakRetryParams } from "./speak-action.ts";

test("voice stages persist independent speech providers while answers follow chat", () => {
  const mem = new Map([[VOICE_STAGES_KEY, JSON.stringify({ inputProvider: "openai", answerProvider: "chat", outputProvider: "xai" })]]);
  assert.deepEqual(loadVoiceStages({ getItem: key => mem.get(key) || null }), { inputProvider: "openai", answerProvider: "chat", outputProvider: "xai" });
  const snapshot = snapshotSpeakRetryParams({ inputProvider: "openai", answerProvider: "custom:answer", outputProvider: "xai", chatCommitted: true, reply: "saved" });
  assert.equal(snapshotSpeakRetryParams(snapshot).answerProvider, "custom:answer"); assert.equal(snapshot.outputProvider, "xai");
});

test("explicit speech selection never tries an alternative provider on failure", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { calls.push(String(url)); return new Response("", { status: 401 }); }) as typeof fetch;
  const spoken = await speakSelected({ selected: { ok: true, provider: "openai", key: "synthetic" }, text: "answer", fetchImpl });
  assert.equal(spoken.ok, false); assert.deepEqual(calls, ["https://api.openai.com/v1/audio/speech"]);
  calls.length = 0;
  const heard = await transcribeSelected({ selected: { ok: true, provider: "xai", key: "synthetic" }, bytes: new Uint8Array(32), fetchImpl });
  assert.equal(heard.ok, false); assert.deepEqual(calls, ["https://api.x.ai/v1/stt"]);
});

test("missing or incompatible speech choices fail without dispatch and custom lookup keeps owner", async () => {
  let resolved = "";
  const unsupported = await resolveSelectedSpeechCredential("owner-a", "gemini", { env: {} });
  assert.equal(unsupported.ok, false);
  const selected = await resolveSelectedSpeechCredential("owner-a", "custom:11111111-1111-4111-8111-111111111111", { customCredential: async (owner, id) => { resolved = `${owner}:${id}`; return { ok: true, provider: "openai", key: "synthetic" }; } });
  assert.equal(selected.ok, true); assert.ok(resolved.startsWith("owner-a:"));
});
