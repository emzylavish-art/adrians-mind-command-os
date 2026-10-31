import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function run(url, env = {}) {
  return spawnSync(process.execPath, ["scripts/mind-browser.mjs", url], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("opens a local html document without a network page", () => {
  const result = run("data:text/html,<title>Pier</title><p>Water is low.</p>", { MIND_BROWSER_ALLOW_DATA: "1" });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.title, "Pier");
  assert.match(payload.excerpt, /Water is low/);
});

test("refuses a credential URL and a non-http page", () => {
  const secret = run("https://user:pass@example.com/private");
  assert.match(JSON.parse(secret.stdout).error, /refused/);
  const file = run("file:///etc/passwd");
  assert.match(JSON.parse(file.stdout).error, /No page was opened/);
});
