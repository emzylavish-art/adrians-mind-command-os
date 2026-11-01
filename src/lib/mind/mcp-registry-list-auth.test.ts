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
