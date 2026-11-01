import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HONEST_FAILURE_MESSAGES,
  bindRetry,
  classifyHonestFailure,
  honestFailureAuditAction,
  honestFailureDescription,
  mcpToolFailure,
} from "./failure-states.ts";

describe("honest failure states", () => {
  it("classifies the three defined states from existing copy", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.emergency_stop_active), "emergency_stop_active");
    assert.equal(classifyHonestFailure("Emergency stop is on. Inspection is blocked."), "emergency_stop_active");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.database_write_failed), "database_write_failed");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unavailable), "model_unavailable");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unreachable), "model_unavailable");
    assert.equal(classifyHonestFailure("No Grok key is configured on the server. Another provider is not substituted."), "model_unavailable");
    assert.equal(classifyHonestFailure("Sign in is required."), null);
  });

  it("keeps one-line descriptions and audit action names stable", () => {
    assert.equal(honestFailureDescription("emergency_stop_active"), HONEST_FAILURE_MESSAGES.emergency_stop_active);
    assert.equal(honestFailureDescription("database_write_failed"), HONEST_FAILURE_MESSAGES.database_write_failed);
    assert.equal(honestFailureDescription("model_unavailable", "custom"), "custom");
    assert.equal(honestFailureAuditAction("model_unavailable"), "model_unavailable");
    assert.equal(honestFailureAuditAction("database_write_failed"), "database_write_failed");
    assert.equal(honestFailureAuditAction("emergency_stop_active"), "emergency_stop_active");
  });

  it("retries with identical parameters", () => {
    const calls: Array<[string, number]> = [];
    const retry = bindRetry((query: string, limit: number) => {
      calls.push([query, limit]);
    }, ["harbor dredge", 3] as [string, number]);
    retry();
    retry();
    assert.deepEqual(calls, [
      ["harbor dredge", 3],
      ["harbor dredge", 3],
    ]);
  });

  it("banner 5: classifies MCP tool-call failure copy from the MCP integration", () => {
    for (const message of [
      "The MCP server could not be reached.",
      "The MCP server returned 502. Nothing was called.",
      "The MCP server did not return a JSON-RPC result.",
      "The MCP server returned no text. Nothing was invented.",
      "That MCP server is not registered. Nothing was called.",
      "MCP server “Docs” is disabled. Nothing was called.",
      "Unknown built-in tool “nope”. Nothing was called.",
      "No paired PC online. Nothing ran on a laptop or phone.",
      "PGLite query error: relation does not exist",
      HONEST_FAILURE_MESSAGES.mcp_tool_failed,
      HONEST_FAILURE_MESSAGES.mcp_unreachable,
    ]) {
      assert.equal(classifyHonestFailure(message), "mcp_tool_failed", message);
    }
    // Earlier states keep priority and are not swallowed.
    assert.equal(classifyHonestFailure("Emergency stop is on. Nothing was called."), "emergency_stop_active");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unreachable), "model_unavailable");
    assert.equal(honestFailureAuditAction("mcp_tool_failed"), "mcp_tool_failed");
    assert.equal(honestFailureDescription("mcp_tool_failed"), HONEST_FAILURE_MESSAGES.mcp_tool_failed);
  });

  it("banner 5: builds a one-line description from an MCP tool-call result", () => {
    assert.equal(mcpToolFailure({ ok: true, status: "ok", text: "1" }), null);
    assert.equal(mcpToolFailure({ ok: false, needsConfirmation: true, error: "Call “x” on Docs only after you confirm. Nothing was called." }), null);
    assert.equal(mcpToolFailure({ ok: false, status: "running" }), null);
    const registry = mcpToolFailure({
      ok: false,
      status: "error",
      serverId: "builtin",
      tool: "pglite_query",
      text: "PGLite query error:\n relation   \"x\" does not exist",
    });
    assert.deepEqual(registry, {
      kind: "mcp_tool_failed",
      message: "MCP tool “pglite_query” failed. PGLite query error: relation \"x\" does not exist",
      target: "mcp:builtin/pglite_query",
    });
    assert.ok(!registry!.message.includes("\n"));
    assert.equal(classifyHonestFailure(registry!.message), "mcp_tool_failed");
    const command = mcpToolFailure({ ok: false, error: "The MCP server returned 500. Nothing was called.", text: "" });
    assert.deepEqual(command, { kind: "mcp_tool_failed", message: "The MCP server returned 500. Nothing was called.", target: "mcp" });
    const bare = mcpToolFailure({ ok: false, status: "error" });
    assert.equal(bare?.message, HONEST_FAILURE_MESSAGES.mcp_tool_failed);
    const isError = mcpToolFailure({ ok: true, status: "error", tool: "notion_read", serverId: "builtin", text: "Notion returned 401. Nothing was invented." });
    assert.equal(isError?.message, "MCP tool “notion_read” failed. Notion returned 401. Nothing was invented.");
  });

  it("banner 5: retry re-runs the same MCP call with identical parameters", () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const args = { sql: "SELECT 1" };
    const retry = bindRetry((serverId: string, tool: string, input: Record<string, unknown>) => {
      calls.push([serverId, tool, input]);
    }, ["builtin", "pglite_query", args] as [string, string, Record<string, unknown>]);
    retry();
    retry();
    assert.deepEqual(calls, [
      ["builtin", "pglite_query", { sql: "SELECT 1" }],
      ["builtin", "pglite_query", { sql: "SELECT 1" }],
    ]);
    assert.equal(calls[0][2], args);
    assert.equal(calls[1][2], args);
  });
});
