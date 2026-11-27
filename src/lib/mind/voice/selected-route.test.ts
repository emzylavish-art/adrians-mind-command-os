import test from "node:test";
import assert from "node:assert/strict";
import { selectedVoiceRoute } from "./selected-route.ts";
import { commitVoiceMode, readStoredVoiceMode } from "./mode.ts";
test("a transient local failure blocks dispatch and preserves the owner's selected route across reload", () => {
  const rows = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => { rows.set(key, value); }, getItem: (key: string) => rows.get(key) ?? null };
  commitVoiceMode("orchestrator", storage);
  let minted = 0;
  const failed = selectedVoiceRoute(readStoredVoiceMode(storage), false);
  if (failed.ok) minted++;
  assert.equal(minted, 0);
  assert.equal(readStoredVoiceMode(storage), "orchestrator");
  assert.equal(selectedVoiceRoute(readStoredVoiceMode(storage), true).ok, true);
  commitVoiceMode("direct", storage);
  assert.deepEqual(selectedVoiceRoute(readStoredVoiceMode(storage), false), { ok: true, mode: "direct" });
});
