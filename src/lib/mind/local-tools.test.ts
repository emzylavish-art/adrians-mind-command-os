import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLocalPlan } from "./local-tools.ts";
import { emptyWorkspace } from "./workspace.ts";

describe("local workspace lookup", () => {
  it("stops before the first tool when the emergency stop is on", () => {
    const ws = emptyWorkspace();
    ws.memories.push({
      id: "n1",
      scope: "global",
      projectId: null,
      chatId: null,
      text: "Secret dock",
      source: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      versions: [],
    });
    const result = runLocalPlan(ws, [{ id: "s1", tool: "search_notes", query: "dock" }], {
      autonomy: "automatic",
      halted: true,
      tokens: { s1: "approve:s1" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.lines.join(" ").includes("Secret dock"), false);
  });

  it("runs the approved steps in order and does not run a later step after a refusal", () => {
    const ws = emptyWorkspace();
    ws.projects.push({ id: "p", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    const result = runLocalPlan(
      ws,
      [
        { id: "a", tool: "list_projects" },
        { id: "b", tool: "search_notes", query: "dock" },
      ],
      { autonomy: "ask", halted: false, tokens: { a: "approve:a" } },
    );
    assert.equal(result.ok, false);
    assert.match(result.lines[0] ?? "", /Lake/);
    assert.match(result.lines[1] ?? "", /Ask mode/);
    assert.equal(result.lines.length, 2);
  });
});
