import test from "node:test";
import assert from "node:assert/strict";
import { pollSavedVideo } from "./video-poll.ts";
test("video recovery tolerates bounded network/status failures and retains one accepted operation", async () => {
  let clock = 0, calls = 0;
  const result = await pollSavedVideo({ now: () => clock, wait: async (ms) => { clock += ms; }, current: () => true,
    status: async () => { calls++; if (calls === 1) throw new Error("lost response"); if (calls === 2) return { status: 429, retryAfter: 9, body: {} }; return { status: 200, body: { ok: true, state: "done", url: "https://example.test/synthetic.mp4" } }; } });
  assert.equal(result.kind, "done"); assert.equal(calls, 3); assert.equal(clock, 19000);
});
test("failed status checks are not labeled generation failure and never restart generation", async () => {
  let clock = 0, calls = 0;
  const result = await pollSavedVideo({ now: () => clock, wait: async (ms) => { clock += ms; }, current: () => true,
    status: async () => { calls++; return { status: 503, body: {} }; } });
  assert.equal(result.kind, "interrupted"); assert.equal(calls, 4);
});
test("session changes discard late video completion and explicit provider failures remain failures", async () => {
  let current = true;
  const late = await pollSavedVideo({ wait: async () => {}, current: () => current, status: async () => { current = false; return { status: 200, body: { ok: true, state: "done", url: "https://example.test/video" } }; } });
  assert.equal(late.kind, "stopped");
  const failed = await pollSavedVideo({ wait: async () => {}, current: () => true, status: async () => ({ status: 200, body: { ok: false, state: "failed" } }) });
  assert.equal(failed.kind, "failed");
});
