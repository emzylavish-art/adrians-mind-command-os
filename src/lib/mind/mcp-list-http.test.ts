import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadMcpWithHttpFallback } from "./mcp-list-http.ts";

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("MCP transport fallback", () => {
  it("keeps the primary successful response without making another request", async () => {
    let calls = 0;
    const result = await loadMcpWithHttpFallback(async () => ({ servers: [{ id: "one" }] }), "registry", {
      fetchImpl: async () => { calls += 1; return response(200, { servers: [] }); },
    });
    assert.deepEqual(result, { servers: [{ id: "one" }] });
    assert.equal(calls, 0);
  });
  it("falls back once on a transport failure without inventing an empty list", async () => {
    let calls = 0;
    const result = await loadMcpWithHttpFallback(async () => { throw new TypeError("Failed to fetch"); }, "saved", {
      bearerToken: "test-token",
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url, "/api/mind/mcp/servers?view=saved");
        assert.equal(init?.method, "GET");
        assert.equal(init?.credentials, "same-origin");
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-token");
        return response(200, { ok: true, servers: [{ id: "s1", label: "test" }] });
      },
    });
    assert.deepEqual(result, { ok: true, servers: [{ id: "s1", label: "test" }] });
    assert.equal(calls, 1);
  });
  it("never retries a permission denial", async () => {
    let called = false;
    const denial = Object.assign(new Error("Unauthorized"), { status: 401 });
    await assert.rejects(() => loadMcpWithHttpFallback(async () => { throw denial; }, "registry", {
      fetchImpl: async () => { called = true; return response(200, { servers: [] }); },
    }), (err: unknown) => err === denial);
    assert.equal(called, false);
  });
  it("preserves REST authorization errors rather than hiding them as empty", async () => {
    await assert.rejects(() => loadMcpWithHttpFallback(async () => { throw new Error("transport"); }, "registry", {
      fetchImpl: async () => response(401, { ok: false, error: "Sign in is required." }),
    }), (e: unknown) => e instanceof Error && e.message === "Sign in is required." && (e as Error & { status?: number }).status === 401);
  });
  it("rejects malformed successful payloads", async () => {
    await assert.rejects(() => loadMcpWithHttpFallback(async () => { throw new Error("transport"); }, "registry", {
      fetchImpl: async () => response(200, { ok: true }),
    }), /missing its servers array/);
  });
  it("does not retry a failed REST fallback indefinitely", async () => {
    let calls = 0;
    await assert.rejects(() => loadMcpWithHttpFallback(async () => { throw new Error("transport"); }, "registry", {
      fetchImpl: async () => { calls += 1; return response(503, {}); },
    }), /HTTP 503/);
    assert.equal(calls, 1);
  });
});
