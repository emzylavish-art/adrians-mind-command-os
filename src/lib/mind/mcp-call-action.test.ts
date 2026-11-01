import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  McpCallActionStatusRows,
  onceRetry,
  runMcpTrySelect,
  snapshotMcpTrySelectParams,
} from "./mcp-call-action.ts";

describe("MCP Try SELECT 1 action failures", () => {
  it("snapshots identical serverId/tool/sql for Retry", () => {
    const params = snapshotMcpTrySelectParams({ serverId: "builtin", serverLabel: "Built-in" });
    assert.deepEqual(params, {
      serverId: "builtin",
      serverLabel: "Built-in",
      tool: "pglite_query",
      args: { sql: "SELECT 1 AS n" },
    });
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.mcp_try_select_failed), "network_failure");
  });

  it("rejected call shows red banner; Retry re-runs identical params once", async () => {
    const params = snapshotMcpTrySelectParams({ serverId: "s1", serverLabel: "S1" });
    let calls = 0;
    const seen: unknown[] = [];
    const call = async (input: { data: { serverId: string; tool: string; args: { sql: string } } }) => {
      calls += 1;
      seen.push(input.data);
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { status: "ok", text: "{\"n\":1}" };
    };
    let result = await runMcpTrySelect(params, call);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const html = renderToStaticMarkup(
      createElement(McpCallActionStatusRows, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner|failure-retry/);
    assert.match(result.message, /Try SELECT 1/);

    const pending: Promise<Awaited<ReturnType<typeof runMcpTrySelect>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runMcpTrySelect(result.ok === false ? result.params : params, call));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(seen[0], seen[1]);
    assert.deepEqual(seen[0], { serverId: "s1", tool: "pglite_query", args: { sql: "SELECT 1 AS n" } });
  });

  it("status error/timeout from registry is a banner, not muted ok", async () => {
    const params = snapshotMcpTrySelectParams({ serverId: "s2", serverLabel: "S2" });
    const errored = await runMcpTrySelect(params, async () => ({ status: "error", text: "PGLite query error: x" }));
    assert.equal(errored.ok, false);
    if (errored.ok) return;
    assert.equal(errored.kind, "mcp_tool_failed");
    const timed = await runMcpTrySelect(params, async () => ({ status: "timeout", text: "hung" }));
    assert.equal(timed.ok, false);
    if (timed.ok) return;
    assert.equal(timed.kind, "network_failure");
  });

  it("successful call has no banner", async () => {
    const params = snapshotMcpTrySelectParams({ serverId: "s3", serverLabel: "S3" });
    const result = await runMcpTrySelect(params, async () => ({ status: "ok", text: "1" }));
    assert.deepEqual(result, { ok: true, note: "ok: 1", status: "ok" });
    assert.equal(
      renderToStaticMarkup(createElement(McpCallActionStatusRows, { state: { status: "ok", note: "ok: 1" }, onRetry: () => undefined })),
      "",
    );
  });
});
