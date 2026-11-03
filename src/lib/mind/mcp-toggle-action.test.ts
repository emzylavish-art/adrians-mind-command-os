import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  McpToggleActionStatusRows,
  onceRetry,
  runMcpToggle,
  snapshotMcpToggleParams,
} from "./mcp-toggle-action.ts";

describe("MCP toggle action failures", () => {
  it("classifies mcp_toggle_failed as network_failure", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.mcp_toggle_failed), "network_failure");
  });

  it("snapshots id/enabled so Retry keeps identical toggle", () => {
    assert.deepEqual(snapshotMcpToggleParams({ id: "srv_1", enabled: false, label: "Local PG" }), {
      id: "srv_1",
      enabled: false,
      label: "Local PG",
    });
  });

  it("rejection shows red banner; Retry re-toggles identical params once", async () => {
    const params = snapshotMcpToggleParams({ id: "s1", enabled: true, label: "S1" });
    let calls = 0;
    const seen: unknown[] = [];
    const toggle = async (input: { data: { id: string; enabled: boolean } }) => {
      calls += 1;
      seen.push(input.data);
      if (calls === 1) throw new Error("Unauthorized");
      return { servers: [{ id: "s1", label: "S1", kind: "builtin", enabled: true }] };
    };
    let result = await runMcpToggle(params, toggle);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "auth_required");
    const html = renderToStaticMarkup(
      createElement(McpToggleActionStatusRows, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);
    assert.match(html, /data-mcp-toggle-id="s1"/);

    const pending: Promise<Awaited<ReturnType<typeof runMcpToggle>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runMcpToggle(result.ok === false ? result.params : params, toggle));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(seen[0], seen[1]);
    assert.deepEqual(seen[0], { id: "s1", enabled: true });
  });

  it("successful toggle returns servers without a banner", async () => {
    const params = snapshotMcpToggleParams({ id: "s2", enabled: false });
    const result = await runMcpToggle(params, async () => ({
      servers: [{ id: "s2", label: "S2", kind: "http", enabled: false }],
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.note, /disabled/);
    assert.equal(
      renderToStaticMarkup(
        createElement(McpToggleActionStatusRows, {
          state: { status: "ok", note: result.note },
          onRetry: () => undefined,
        }),
      ),
      "",
    );
  });
});
