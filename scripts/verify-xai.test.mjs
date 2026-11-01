import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("verify-xai missing-key path runs without a live call", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/verify-xai.mjs"], {
    encoding: "utf8",
    env: { ...process.env, MIND_LIVE_XAI: "", XAI_API_KEY: "should-not-be-used-when-live-off-for-missing-check" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /missing-key: unavailable/);
  assert.match(result.stdout, /live: skipped/);
  assert.match(result.stdout, /persistence\(local\): match/);
  assert.equal(/\bfabricated reply\b/i.test(result.stdout) && !/no fabricated reply/i.test(result.stdout), false);
  assert.doesNotMatch(result.stdout, /VERIFY-OK(?!-LOCAL)/);
});

test("verify-xai with key unset still exits cleanly when live is off", () => {
  const env = { ...process.env, MIND_LIVE_XAI: "" };
  delete env.XAI_API_KEY;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/verify-xai.mjs"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /missing-key: unavailable/);
});
