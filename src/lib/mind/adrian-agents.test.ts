import assert from "node:assert/strict";
import test from "node:test";
import { addAgentBot, agentStatus, agentTurn, configureAgentLimits, loadAgentSkills, noteAgentService, resetAgentRuntime, setConnectedBrains } from "./adrian-agents.ts";

test("the agent layer is Adrian's Mind and is not running until noted", () => {
  resetAgentRuntime();
  const status = agentStatus();
  assert.equal(status.product, "Adrian's Mind");
  assert.equal(status.service, "not-running");
  assert.equal(agentTurn("desk", "hello").refused, "Adrian's Mind agents are not running on this PC.");
});

test("a bot can use only an API that is connected now", () => {
  resetAgentRuntime();
  setConnectedBrains(["local-ollama"]);
  assert.equal(addAgentBot({ id: "desk", channel: "telegram", brain: "cloud-other", token: "telegram-token-value" }).refused, "That API is not connected.");
  const added = addAgentBot({ id: "desk", channel: "telegram", brain: "local-ollama", token: "telegram-token-value" });
  assert.equal("brain" in added && added.brain, "local-ollama");
  assert.equal(JSON.stringify(agentStatus()).includes("telegram-token-value"), false);
  noteAgentService(true, 8787);
  const turn = agentTurn("desk", "hello");
  assert.equal("brain" in turn && turn.brain, "local-ollama");
});

test("agents refuse a Mind OS port", () => {
  resetAgentRuntime();
  assert.equal(configureAgentLimits({ port: 9400, workerThreads: 2, memoryCeilingMb: 1024, pollIntervalMs: 15000 }).refused, "Adrian's Mind agents cannot use a Mind OS port.");
  assert.deepEqual(loadAgentSkills(["skills/files/SKILL.md"]), ["skills/files/SKILL.md"]);
});
