import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  activeStdioChildren,
  buildStdioChildEnv,
  callStdioTool,
  isBlockedChildEnvKey,
  listStdioTools,
  resolveStdioTimeouts,
  stdioCommandAllowed,
  stdioSpawnCount,
} from "./stdio.ts";

// The operator allowlist is required for any spawn. Tests allow only this node binary.
process.env.MIND_MCP_STDIO_ALLOW = process.execPath;

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/mcp/fixture-stdio-server.mjs");

function fixture(env?: Record<string, string>) {
  return { id: "fx", label: "Fixture", command: process.execPath, args: [FIXTURE], env };
}

describe("stdio MCP runner", () => {
  it("passes only PATH/HOME from the app env plus the server env", () => {
    const env = buildStdioChildEnv({ OWN: "1" }, { PATH: "/bin", HOME: "/h", XAI_API_KEY: "s", NOTION_TOKEN: "t" });
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", OWN: "1" });
  });

  it("drops loader-injection env keys from server config (LD_PRELOAD, NODE_OPTIONS, PATH override)", () => {
    const env = buildStdioChildEnv(
      { LD_PRELOAD: "/tmp/evil.so", NODE_OPTIONS: "--require /tmp/evil.js", PATH: "/tmp/evil", DYLD_INSERT_LIBRARIES: "x", BASH_ENV: "/tmp/x", OK_KEY: "1" },
      { PATH: "/bin", HOME: "/h" },
    );
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", OK_KEY: "1" });
    assert.equal(isBlockedChildEnvKey("ld_preload"), true);
    assert.equal(isBlockedChildEnvKey("API_KEY"), false);
  });

  it("allowlist is exact-match only and empty by default", () => {
    assert.equal(stdioCommandAllowed("/usr/bin/node", {}), false);
    assert.equal(stdioCommandAllowed("/usr/bin/node", { MIND_MCP_STDIO_ALLOW: "/usr/bin/node;/opt/mcp/server" }), true);
    assert.equal(stdioCommandAllowed("/opt/mcp/server", { MIND_MCP_STDIO_ALLOW: "/usr/bin/node, /opt/mcp/server" }), true);
    assert.equal(stdioCommandAllowed("/usr/bin/node; touch /tmp/x", { MIND_MCP_STDIO_ALLOW: "/usr/bin/node" }), false);
    assert.equal(stdioCommandAllowed("/usr/bin/nodejs", { MIND_MCP_STDIO_ALLOW: "/usr/bin/node" }), false);
  });

  it("REGRESSION: refuses to spawn a command that is not on the operator allowlist", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "mind-stdio-allow-")), "spawned");
    const before = stdioSpawnCount();
    const listed = await listStdioTools(fixture({ MCP_FIXTURE_MARKER: marker }), { allowEnv: {} });
    assert.equal(listed.status, "error");
    assert.match((listed as { error?: string }).error ?? "", /allowlist/);
    const called = await callStdioTool(fixture({ MCP_FIXTURE_MARKER: marker }), "echo", { text: "x" }, { allowEnv: { MIND_MCP_STDIO_ALLOW: "/bin/true" } });
    assert.equal(called.ok, false);
    assert.equal(called.status, "error");
    assert.match(called.text, /allowlist/);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(existsSync(marker), false, "child must never have started");
    assert.equal(stdioSpawnCount(), before);
  });

  it("passes shell metacharacters in args/arguments literally (no shell)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-stdio-inj-"));
    const pwned = join(dir, "pwned");
    const called = await callStdioTool(fixture(), "echo", { text: `$(touch ${pwned}); \`touch ${pwned}\` | touch ${pwned}` });
    assert.equal(called.status, "ok");
    assert.match(called.text, /\$\(touch/);
    const injected = await listStdioTools({ ...fixture(), args: [FIXTURE, `; touch ${pwned}`, `&& touch ${pwned}`] });
    assert.equal(injected.status, "ok");
    assert.equal(existsSync(pwned), false);
  });

  it("bounds a flood of newline-less stdout and kills the child", async () => {
    const started = Date.now();
    const listed = await listStdioTools(fixture({ MCP_FIXTURE_FLOOD: "1" }), { connectTimeoutMs: 1500, stdoutCapBytes: 256 * 1024 });
    assert.notEqual(listed.status, "ok");
    assert.ok(Date.now() - started < 15_000);
    assert.equal(activeStdioChildren(), 0);
  });

  it("treats malformed JSON-RPC output as failure, not success", async () => {
    const listed = await listStdioTools(fixture({ MCP_FIXTURE_GARBAGE: "1" }), { connectTimeoutMs: 1000 });
    assert.notEqual(listed.status, "ok");
    assert.equal(activeStdioChildren(), 0);
  });

  it("resolves timeouts: option > server > env > default", () => {
    assert.deepEqual(resolveStdioTimeouts({}, {}, {}), { connectTimeoutMs: 10_000, callTimeoutMs: 30_000 });
    assert.deepEqual(
      resolveStdioTimeouts({}, {}, { MIND_MCP_STDIO_CONNECT_TIMEOUT_MS: "2000", MIND_MCP_STDIO_CALL_TIMEOUT_MS: "4000" }),
      { connectTimeoutMs: 2000, callTimeoutMs: 4000 },
    );
    assert.deepEqual(resolveStdioTimeouts({ connectTimeoutMs: 3000, callTimeoutMs: 5000 }, { callTimeoutMs: 700 }, {}), {
      connectTimeoutMs: 3000,
      callTimeoutMs: 700,
    });
  });

  it("lists real tools from the fixture and closes the child", async () => {
    const listed = await listStdioTools(fixture());
    assert.equal(listed.status, "ok");
    if (listed.status === "ok") {
      const names = listed.tools.map((t) => t.name).sort();
      assert.deepEqual(names, ["add", "echo", "env_probe", "fail", "sleep"]);
    }
    assert.equal(activeStdioChildren(), 0);
  });

  it("calls a real tool and returns ok", async () => {
    const called = await callStdioTool(fixture(), "add", { a: 2, b: 40 });
    assert.equal(called.status, "ok");
    assert.equal(called.ok, true);
    assert.equal(called.text, "42");
    assert.deepEqual(called.data, { sum: 42 });
    assert.equal(activeStdioChildren(), 0);
  });

  it("does not leak app secrets into the child", async () => {
    process.env.MIND_FAKE_APP_SECRET = "do-not-leak";
    try {
      const called = await callStdioTool(fixture({ OWN_KEY: "x" }), "env_probe", {
        keys: ["MIND_FAKE_APP_SECRET", "OWN_KEY", "PATH"],
      });
      assert.equal(called.status, "ok");
      assert.deepEqual(JSON.parse(called.text), { MIND_FAKE_APP_SECRET: false, OWN_KEY: true, PATH: true });
    } finally {
      delete process.env.MIND_FAKE_APP_SECRET;
    }
  });

  it("reports MCP tool errors as status error", async () => {
    const called = await callStdioTool(fixture(), "fail", {});
    assert.equal(called.status, "error");
    assert.equal(called.ok, false);
    assert.match(called.text, /fixture failure/);
  });

  it("times out a slow call, reports timeout, and kills the child", async () => {
    const started = Date.now();
    const called = await callStdioTool(fixture(), "sleep", { ms: 120_000 }, { callTimeoutMs: 500 });
    assert.equal(called.status, "timeout");
    assert.equal(called.ok, false);
    assert.match(called.text, /timed out/);
    assert.ok(Date.now() - started < 60_000, "should not wait for the slow tool");
    assert.equal(activeStdioChildren(), 0);
  });

  it("times out a server that never initializes", async () => {
    const listed = await listStdioTools(fixture({ MCP_FIXTURE_HANG_INIT: "1" }), { connectTimeoutMs: 500 });
    assert.equal(listed.status, "timeout");
    assert.equal(activeStdioChildren(), 0);
  });

  it("returns error for a command that does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-stdio-"));
    const called = await callStdioTool(
      { id: "x", label: "Missing", command: join(dir, "no-such-binary") },
      "echo",
      { text: "hi" },
      { connectTimeoutMs: 2000, allowEnv: { MIND_MCP_STDIO_ALLOW: join(dir, "no-such-binary") } },
    );
    assert.equal(called.status, "error");
    assert.doesNotMatch(called.text, /allowlist/);
    assert.equal(called.ok, false);
    assert.equal(existsSync(join(dir, "no-such-binary")), false);
  });
});
