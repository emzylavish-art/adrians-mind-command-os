import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkMcpStorage } from "./mcp-storage-status.ts";

function respond(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
describe("owner-scoped MCP storage probe", () => {
  it("reports schema health but does not imply remote MCP is connected", async () => {
    const result = await checkMcpStorage({ bearerToken: "test-bearer", fetchImpl: (async (url, init) => {
      assert.equal(url, "/api/mind/mcp/servers?view=health");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.method, "GET");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-bearer");
      return respond(200, { ok: true, code: "ready", savedRegistryRows: 2 });
    }) as typeof fetch });
    assert.equal(result.state, "ready");
    assert.match(result.detail, /Remote MCP servers have not been tested/);
  });
  it("identifies missing migrations without secrets", async () => {
    const result = await checkMcpStorage({ fetchImpl: (async () => respond(503, {
      ok: false, code: "migrations_pending", migrations: {
        "0005_custom_connection.sql": true, "0006_ai_providers.sql": true, "0007_oauth_connections.sql": false,
      },
    })) as typeof fetch });
    assert.equal(result.code, "migrations_pending");
    assert.match(result.detail, /0007_oauth_connections.sql/);
  });
  it("does not treat unauthorized as a network error", async () => {
    const result = await checkMcpStorage({ fetchImpl: (async () =>
      respond(401, { ok: false, error: "Sign in is required." })) as typeof fetch });
    assert.equal(result.code, "sign_in_required");
  });
  it("reports a server error when network or decoding fails", async () => {
    const error = await checkMcpStorage({ fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch });
    assert.equal(error.code, "network_failure");
    const invalid = await checkMcpStorage({ fetchImpl: (async () =>
      new Response("<html>", { status: 200 })) as typeof fetch });
    assert.equal(invalid.code, "invalid_response");
  });
});
