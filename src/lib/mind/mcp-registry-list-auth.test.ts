import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Contract: mcpRegistryList soft-auth payload shapes the Tools panel expects. */
export type McpRegistryListResult =
  | { status: "ok"; servers: { id: string; label: string; kind: string; enabled: boolean }[] }
  | { status: "unauthenticated"; servers: [] };

export function mcpListUiState(result: McpRegistryListResult | { servers: unknown } | null, thrown?: unknown): "sign-in" | "empty" | "ready" | "error-empty" {
  if (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown ?? "");
    if (message === "Unauthorized" || /sign in is required/i.test(message)) return "sign-in";
    return "error-empty";
  }
  if (!result || typeof result !== "object") return "error-empty";
  if ("status" in result && result.status === "unauthenticated") return "sign-in";
  const servers = Array.isArray((result as { servers?: unknown }).servers) ? (result as { servers: unknown[] }).servers : null;
  if (!servers) return "error-empty";
  return servers.length === 0 ? "empty" : "ready";
}

describe("mcpRegistryList signed-out UI contract", () => {
  it("typed unauthenticated is a quiet sign-in state", () => {
    assert.equal(mcpListUiState({ status: "unauthenticated", servers: [] }), "sign-in");
  });
  it("legacy Unauthorized throw is also sign-in, not a silent empty list", () => {
    assert.equal(mcpListUiState(null, new Error("Unauthorized")), "sign-in");
  });
  it("ok with servers is ready; ok empty is empty", () => {
    assert.equal(mcpListUiState({ status: "ok", servers: [{ id: "b", label: "Built-in", kind: "builtin", enabled: true }] }), "ready");
    assert.equal(mcpListUiState({ status: "ok", servers: [] }), "empty");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Item 2 (loose ends): anonymous GET /api/mind/mcp/servers returns 401
 * "Sign in is required." That is correct for a REST API.
 *
 * Case that applies: nothing in the UI calls GET /api/mind/mcp/servers.
 * The Tools panel and command-app use the soft-auth mcpRegistryList server
 * function, which returns typed `unauthenticated` (quiet notice, no red banner).
 * Only scripts/mcp/verify-live.mjs probes the REST path for live checks.
 * Keep the 401; do not soften the API.
 */
describe("GET /api/mind/mcp/servers anonymous auth (API keeps 401)", () => {
  const root = join(import.meta.dirname, "../..");

  it("UI callers use mcpRegistryList, not fetch('/api/mind/mcp/servers')", () => {
    const fleet = readFileSync(join(root, "components/mind/fleet-panels.tsx"), "utf8");
    const command = readFileSync(join(root, "components/mind/command-app.tsx"), "utf8");
    assert.match(fleet, /mcpRegistryList/);
    assert.match(command, /mcpRegistryList/);
    assert.doesNotMatch(fleet, /fetch\([^)]*\/api\/mind\/mcp\/servers/);
    assert.doesNotMatch(command, /fetch\([^)]*\/api\/mind\/mcp\/servers/);
    // Soft-auth path: loadMcpList + unauthenticated quiet state
    assert.match(fleet, /loadMcpList/);
    assert.match(fleet, /unauthenticated/);
  });

  it("REST route requires requireUserId and maps Unauthorized to 401 Sign in is required", () => {
    const route = readFileSync(join(root, "routes/api/mind/mcp/servers.ts"), "utf8");
    assert.match(route, /requireUserId/);
    assert.match(route, /Sign in is required\./);
    assert.match(route, /401/);
    // Soft-auth unauthenticated payload must NOT be on this REST route
    assert.doesNotMatch(route, /status:\s*["']unauthenticated["']/);
  });

  it("mcpRegistryList soft-auth stays the quiet UI path (server.ts)", () => {
    const server = readFileSync(join(root, "lib/mind/server.ts"), "utf8");
    assert.match(server, /export const mcpRegistryList/);
    assert.match(server, /status:\s*"unauthenticated"/);
  });
});
