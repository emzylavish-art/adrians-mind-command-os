import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpPublicException, mcpRpcFromResult, safeReason } from "./call-contract.ts";
import { registryRpc } from "./registry.ts";

const PRIVATE = "fictional private narrative https://internal.example/path?token=other-secret Authorization: Bearer different-credential";

describe("MCP public failure boundary", () => {
  it("drops every upstream error content field and structured payload", () => {
    const failed = mcpRpcFromResult({
      isError: true,
      content: [{ type: "text", text: PRIVATE }, { type: "resource", uri: PRIVATE, data: PRIVATE }],
      structuredContent: { private: PRIVATE, token: "other-secret" },
    }, "saved-token");
    assert.deepEqual(failed, {
      isError: true,
      content: [{ type: "text", text: safeReason("error") }],
      structuredContent: null,
    });
    assert.equal(JSON.stringify(failed).includes("fictional"), false);
    assert.equal(JSON.stringify(failed).includes("other-secret"), false);
  });

  it("preserves successful text, images, and structured output", () => {
    const result = { isError: false, content: [{ type: "text", text: "status:7" }, { type: "image", data: "abc", mimeType: "image/png" }], structuredContent: { id: "7" } };
    assert.deepEqual(mcpRpcFromResult(result), result);
  });

  it("keeps the known sign-in refusal and masks all other exceptions", () => {
    assert.deepEqual(mcpPublicException(new Error("Unauthorized")), { status: 401, message: "Sign in is required." });
    for (const value of [new Error(PRIVATE), PRIVATE, { message: PRIVATE }, null]) {
      assert.deepEqual(mcpPublicException(value), { status: 500, message: safeReason("error") });
      assert.equal(JSON.stringify(mcpPublicException(value)).includes("different-credential"), false);
    }
  });

  it("bounds a nonsettling registry DNS lookup without issuing or retrying a request", async () => {
    let calls = 0;
    const result = await registryRpc(async () => {
      calls += 1;
      throw new Error("No network request is allowed in this test");
    }, "https://mcp.example/mcp", "", null, { method: "initialize" }, {
      timeoutMs: 20,
      lookup: async () => new Promise<never>(() => {}),
    });
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.timedOut, true);
    assert.equal(result.httpStatus, 0);
    assert.equal(result.rpc, null);
  });

  it("does not publish raw JSON-RPC errors through the registry envelope", async () => {
    const result = await registryRpc(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: PRIVATE } }),
    }), "http://127.0.0.1:9/mcp", "saved-token", null, { method: "tools/call" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.state, "rpc");
    assert.equal(result.httpStatus, 200);
    assert.equal(result.error, safeReason("error"));
    assert.equal(result.rpc?.structuredContent, null);
    for (const piece of ["fictional", "internal.example", "other-secret", "different-credential"]) {
      assert.equal(JSON.stringify(result).includes(piece), false);
    }
  });
});
