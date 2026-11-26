import assert from "node:assert/strict";
import { test } from "node:test";
import { providerDependencies } from "./provider-dependencies.ts";
test("connection removal lists dependent resources and never rewrites their selections", () => {
  const choice = "custom:provider-a:chosen";
  const ws = { chats: [{ id: "c", title: "Chat", botProvider: choice }], agents: [{ id: "a", name: "Agent", chatProvider: choice }, { id: "b", chatProvider: "custom:provider-b:model" }], runs: [{ id: "r", agentId: "a", state: "queued" }, { id: "done", agentId: "a", state: "completed" }], schedules: [{ id: "s", agentId: "a" }] };
  const before = JSON.stringify(ws);
  assert.deepEqual(providerDependencies("provider-a", ws).map(row => row.kind), ["chat", "agent", "run", "schedule"]);
  assert.equal(JSON.stringify(ws), before);
  assert.deepEqual(providerDependencies("removed", ws), []);
});
