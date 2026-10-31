import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("hosted worker does nothing without a dedicated database", () => {
  const result = spawnSync(process.execPath, ["scripts/mind-worker.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Nothing ran/);
  assert.equal(result.stdout.includes("completed"), false);
});
