import assert from "node:assert/strict";
import test from "node:test";
import { providerResponse } from "./provider-response.ts";
test("provider delta reaches client before completion; failure never emits success", async () => {
  let finish!: () => void; const wait = new Promise<void>((resolve) => { finish = resolve; });
  const response = providerResponse(async (delta) => { delta("First"); await wait; return { ok: false, error: "Disconnected" }; }, () => ({ text: "wrong" }), new AbortController().signal);
  const reader = response.body!.getReader(); const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /First/); finish(); let rest = ""; for (;;) { const next = await reader.read(); if (next.done) break; rest += new TextDecoder().decode(next.value); } assert.match(rest, /Disconnected/); assert.doesNotMatch(rest, /event: done/);
});
