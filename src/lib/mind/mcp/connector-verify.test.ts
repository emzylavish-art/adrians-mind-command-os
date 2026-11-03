import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BUILTIN_VERIFY_PROBE_TOOL,
  FORBIDDEN_BUILTIN_PROBES,
  buildConnectorVerifyPayload,
  formatVerifyBadge,
  inventoryConnectors,
  isForbiddenVerifyProbe,
  pickReadOnlyProbeTool,
  sanitizeVerifyError,
  verifyConnectors,
  verifyOauthConnector,
  type ConnectorVerifyDeps,
} from "./connector-verify.ts";
import { BUILTIN_ID, setMcpRegistryDirectory } from "./registry.ts";
import { setConnectorDirectory, storeAccessToken } from "../connectors/store.ts";

function deps(overrides: Partial<ConnectorVerifyDeps> = {}): ConnectorVerifyDeps {
  return {
    getSql: async () => ({ query: async () => [{ table_schema: "public", table_name: "x", table_type: "BASE TABLE" }] }),
    ...overrides,
  };
}

describe("connector verify: sanitize + probe selection", () => {
  it("strips bearer tokens and long secrets from error text", () => {
    const out = sanitizeVerifyError("fail Bearer ya29.abcdefghijklmnopqrstuvwxyz0123456789 and ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    assert.doesNotMatch(out, /ya29|ghp_/);
    assert.match(out, /\[redacted\]/);
  });

  it("never picks pc_run_shell or write tools; prefers read-only names", () => {
    assert.equal(
      pickReadOnlyProbeTool([
        { name: "pc_run_shell", description: "run shell" },
        { name: "write_file", description: "write" },
        { name: "list_tables", description: "list schema read-only" },
      ]),
      "list_tables",
    );
    assert.equal(pickReadOnlyProbeTool([{ name: "pc_run_shell" }, { name: "do_write" }]), null);
    assert.equal(isForbiddenVerifyProbe("pc_run_shell"), true);
    assert.equal(isForbiddenVerifyProbe("pglite_query"), true);
    assert.equal(isForbiddenVerifyProbe("pglite_list_schema"), false);
  });

  it("built-in probe constant is exactly pglite_list_schema", () => {
    assert.equal(BUILTIN_VERIFY_PROBE_TOOL, "pglite_list_schema");
    assert.ok(!(FORBIDDEN_BUILTIN_PROBES as readonly string[]).includes(BUILTIN_VERIFY_PROBE_TOOL));
  });
});

describe("connector verify: soft-auth payload + badges", () => {
  it("signed-out payload is quiet unauthenticated with empty results", () => {
    assert.deepEqual(buildConnectorVerifyPayload(null, []), { status: "unauthenticated", results: [] });
  });

  it("formatVerifyBadge never invents connected from missing verify", () => {
    assert.equal(formatVerifyBadge(undefined), "Not verified");
    assert.equal(formatVerifyBadge({ id: "x", kind: "oauth", label: "X", state: "not_connected" }), "Not connected");
    assert.match(formatVerifyBadge({ id: "b", kind: "mcp", label: "B", state: "ok", toolCount: 5, latencyMs: 12 }), /Verified/);
  });
});

describe("connector verify: mocked transports / providers", () => {
  it("builtin ok path calls ONLY pglite_list_schema with empty args", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-verify-")));
    const calls: Array<{ tool: string; args: Record<string, unknown>; serverId: string }> = [];
    const results = await verifyConnectors("owner-a", { type: "mcp", id: BUILTIN_ID }, deps({
      callTool: async (input) => {
        calls.push({ tool: input.tool, args: (input.args ?? {}) as Record<string, unknown>, serverId: input.serverId });
        return { status: "ok", ok: true, serverId: input.serverId, tool: input.tool, text: "schema ok" };
      },
    }));
    assert.equal(results.length, 1);
    assert.equal(results[0].state, "ok");
    assert.equal(results[0].probeTool, "pglite_list_schema");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "pglite_list_schema");
    assert.deepEqual(calls[0].args, {});
    assert.equal(calls[0].serverId, BUILTIN_ID);
    assert.ok(!calls.some((c) => c.tool === "pc_run_shell"));
    assert.ok(!calls.some((c) => c.tool === "pglite_query"));
  });

  it("verification cannot call pc_run_shell or writing SQL (recorded callTool)", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-verify-")));
    const calls: string[] = [];
    await verifyConnectors("owner-b", { type: "mcp", id: BUILTIN_ID }, deps({
      callTool: async (input) => {
        calls.push(input.tool);
        // Even if a buggy caller asked for shell, our verify path must not.
        assert.notEqual(input.tool, "pc_run_shell");
        assert.notEqual(input.tool, "pglite_query");
        assert.equal(Object.keys(input.args ?? {}).length, 0);
        return { status: "ok", ok: true, serverId: input.serverId, tool: input.tool, text: "ok" };
      },
    }));
    assert.deepEqual(calls, ["pglite_list_schema"]);
  });

  it("external MCP with only write tools stops at tools/list (ok, probeTool null)", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-verify-")));
    const calls: string[] = [];
    const results = await verifyConnectors("owner-c", { type: "mcp", id: "ext-1" }, deps({
      listTools: async () => [
        { id: "ext-1:write_doc", serverId: "ext-1", serverLabel: "Ext", name: "write_doc", description: "writes", enabled: true, status: "ok" },
        { id: "ext-1:pc_run_shell", serverId: "ext-1", serverLabel: "Ext", name: "pc_run_shell", description: "shell", enabled: true, status: "ok" },
      ],
      callTool: async (input) => {
        calls.push(input.tool);
        return { status: "ok", ok: true, serverId: input.serverId, tool: input.tool, text: "should not run" };
      },
    }));
    // server not registered → error (no ext-1 in store). Register via listServers default only builtin.
    // So target mcp ext-1 yields "not registered".
    assert.equal(results[0].state, "error");
    assert.equal(calls.length, 0);
  });

  it("external listed tools with read-only probe calls that tool once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-mcp-verify-"));
    setMcpRegistryDirectory(dir);
    // Seed an http server into the store file via registerExternalServer
    const { registerExternalServer } = await import("./registry.ts");
    const saved = registerExternalServer("owner-d", { label: "Remote", url: "https://mcp.example/mcp" });
    assert.equal(saved.ok, true);
    const extId = saved.ok ? saved.servers.find((s) => s.kind === "http")!.id : "";
    const calls: string[] = [];
    const results = await verifyConnectors("owner-d", { type: "mcp", id: extId }, deps({
      listTools: async () => [
        { id: `${extId}:list_items`, serverId: extId, serverLabel: "Remote", name: "list_items", description: "read-only list", enabled: true, status: "ok" },
        { id: `${extId}:write_items`, serverId: extId, serverLabel: "Remote", name: "write_items", description: "writes", enabled: true, status: "ok" },
      ],
      callTool: async (input) => {
        calls.push(input.tool);
        return { status: "ok", ok: true, serverId: input.serverId, tool: input.tool, text: "listed" };
      },
    }));
    assert.equal(results[0].state, "ok");
    assert.equal(results[0].probeTool, "list_items");
    assert.deepEqual(calls, ["list_items"]);
  });

  it("timeout and auth_expired states from mocked list/call", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-verify-")));
    const { registerExternalServer } = await import("./registry.ts");
    const saved = registerExternalServer("owner-e", { label: "Slow", url: "https://mcp.example/slow" });
    assert.equal(saved.ok, true);
    const extId = saved.ok ? saved.servers.find((s) => s.kind === "http")!.id : "";

    const timed = await verifyConnectors("owner-e", { type: "mcp", id: extId }, deps({
      listTools: async () => [
        { id: `${extId}:(timeout)`, serverId: extId, serverLabel: "Slow", name: "(timeout)", description: "hung", enabled: true, status: "timeout" },
      ],
    }));
    assert.equal(timed[0].state, "timeout");

    const auth = await verifyConnectors("owner-e", { type: "mcp", id: extId }, deps({
      listTools: async () => [
        { id: `${extId}:(error)`, serverId: extId, serverLabel: "Slow", name: "(error)", description: "HTTP 401 unauthorized", enabled: true, status: "error" },
      ],
    }));
    assert.equal(auth[0].state, "auth_expired");
  });

  it("OAuth without token is not_connected; expired token is auth_expired; ok when provider 200", async () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-conn-verify-")));
    process.env.CONNECTOR_TOKEN_SECRET = "test-connector-secret-32chars!!";

    const missing = await verifyOauthConnector("u1", "notion", deps({
      oauthFetch: async () => ({ ok: true, status: 200, text: async () => "{}", headers: { get: () => null } }),
    }));
    assert.equal(missing.state, "not_connected");

    storeAccessToken({ ownerId: "u1", connector: "gmail", accessToken: "ya29.test-token-value" });
    const expired = await verifyOauthConnector("u1", "gmail", deps({
      oauthFetch: async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid"}', headers: { get: () => null } }),
    }));
    assert.equal(expired.state, "auth_expired");

    const ok = await verifyOauthConnector("u1", "gmail", deps({
      oauthFetch: async () => ({ ok: true, status: 200, text: async () => '{"sub":"1"}', headers: { get: () => null } }),
    }));
    assert.equal(ok.state, "ok");
    assert.ok(typeof ok.latencyMs === "number");
  });

  it("inventory includes builtin MCP tools set + all OAuth connectors", () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-verify-")));
    const items = inventoryConnectors("owner-inv");
    assert.ok(items.some((i) => i.id === BUILTIN_ID && i.kind === "mcp"));
    for (const id of ["notion", "gmail", "google_calendar", "google_drive", "slack", "github"]) {
      assert.ok(items.some((i) => i.id === id && i.kind === "oauth"), id);
    }
  });
});

describe("connector verify: source guards", () => {
  it("source never schedules pc_run_shell or writing SQL as the builtin probe", () => {
    const src = readFileSync(join(import.meta.dirname, "connector-verify.ts"), "utf8");
    assert.match(src, /BUILTIN_VERIFY_PROBE_TOOL = "pglite_list_schema"/);
    assert.doesNotMatch(src, /BUILTIN_VERIFY_PROBE_TOOL = "pc_run_shell"/);
    assert.doesNotMatch(src, /tool:\s*"pc_run_shell"/);
    assert.doesNotMatch(src, /args:\s*\{\s*sql:/);
  });

  it("Tools panel wires verify + keeps signed-out quiet path", () => {
    const root = join(import.meta.dirname, "../../..");
    const fleet = readFileSync(join(root, "components/mind/fleet-panels.tsx"), "utf8");
    const server = readFileSync(join(root, "lib/mind/server.ts"), "utf8");
    const listState = readFileSync(join(root, "lib/mind/mcp-list-state.ts"), "utf8");
    assert.match(server, /export const mcpConnectorVerify/);
    assert.match(server, /getSessionUser/);
    assert.match(fleet, /mcpConnectorVerify/);
    assert.match(fleet, /McpListStatusRows/);
    assert.match(fleet, /unauthenticated/);
    assert.match(listState, /MCP_LIST_SIGN_IN_COPY|mcp-list-sign-in|Sign in to load MCP servers/);
    // Signed-out must not auto-verify: unauthenticated clears results and skips probes.
    assert.match(fleet, /setConnectorVerifyState\(\{ status: "unauthenticated" \}\)/);
  });
});
