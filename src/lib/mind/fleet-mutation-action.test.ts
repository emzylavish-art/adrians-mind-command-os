import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { addCustomAgent, enqueueRun } from "./fleet.ts";
import { emptyWorkspace } from "./workspace.ts";
import {
  FleetMutationFailureBanner,
  onceRetry,
  runFleetMutation,
  snapshotFleetMutationParams,
} from "./fleet-mutation-action.ts";

describe("fleet-mutation-action", () => {
  it("snapshots enqueue params so Retry keeps identical agentId/goal", () => {
    const snap = snapshotFleetMutationParams({
      kind: "enqueue",
      agentId: "agent-1",
      goal: "Ship H29",
    });
    assert.deepEqual(snap, { kind: "enqueue", agentId: "agent-1", goal: "Ship H29" });
  });

  it("ok:false mutation shows red banner; Retry re-runs identical params once", () => {
    const ws = emptyWorkspace();
    const params = snapshotFleetMutationParams({
      kind: "add_custom",
      name: "",
      instructions: "x",
      tools: ["list_projects"],
    });
    const result = runFleetMutation(params, (p) => {
      if (p.kind !== "add_custom") return { ok: false, error: "wrong kind" };
      return addCustomAgent(ws, {
        name: p.name,
        instructions: p.instructions,
        tools: p.tools,
      });
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, "Name the agent.");
    assert.equal(result.params.kind, "add_custom");

    const html = renderToStaticMarkup(
      createElement(FleetMutationFailureBanner, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /role="alert"/);
    assert.match(html, /data-testid="failure-banner"/);
    assert.match(html, /data-failure-kind="fleet_mutation_failed"/);
    assert.match(html, /Retry/);
    assert.doesNotMatch(html, /text-muted/);

    let calls = 0;
    const retry = onceRetry(() => {
      calls += 1;
      return runFleetMutation(result.params, (p) => {
        if (p.kind !== "add_custom") return { ok: false, error: "wrong kind" };
        return addCustomAgent(ws, {
          name: p.name,
          instructions: p.instructions,
          tools: p.tools,
        });
      });
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(calls, 1);
  });

  it("emergency stop enqueue classifies as emergency_stop_active", () => {
    const made = addCustomAgent(emptyWorkspace(), {
      name: "Bot",
      instructions: "Stay local.",
      tools: ["list_projects"],
    });
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const ws = { ...made.ws, halted: true };
    const result = runFleetMutation(
      { kind: "enqueue", agentId: made.agent.id, goal: "do it" },
      (p) => {
        if (p.kind !== "enqueue") return { ok: false, error: "wrong" };
        return enqueueRun(ws, p.agentId, p.goal);
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "emergency_stop_active");
    assert.match(result.message, /Emergency stop/i);
  });
});
