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
  listStdioTools,
  resolveStdioTimeouts,
} from "./stdio.ts";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/mcp/fixture-stdio-server.mjs");

function fixture(env?: Record<string, string>) {
  return { id: "fx", label: "Fixture", command: process.execPath, args: [FIXTURE], env };
}

describe("stdio MCP runner", () => {
  it("passes only PATH/HOME from the app env plus the server env", () => {
    const env = buildStdioChildEnv({ OWN: "1" }, { PATH: "/bin", HOME: "/h", XAI_API_KEY: "s", NOTION_TOKEN: "t" });
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", OWN: "1" });
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
      { connectTimeoutMs: 2000 },
    );
    assert.equal(called.status, "error");
    assert.equal(called.ok, false);
    assert.equal(existsSync(join(dir, "no-such-binary")), false);
  });
});
