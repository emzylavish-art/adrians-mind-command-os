import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("the live Grok check does not run unless it is opted in", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-grok.mjs"], {
    encoding: "utf8",
    env: { ...process.env, MIND_LIVE_GROK: "" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /skipped/);
  assert.equal(result.stdout.includes("returned text"), false);
});
