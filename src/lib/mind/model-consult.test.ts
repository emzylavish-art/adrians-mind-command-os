import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADRIAN_MIND_IDENTITY,
  ORCHESTRATOR_PURPOSE,
  builtinModules,
  collectConsultHelp,
  customModules,
  helpRequest,
  orchestratorInstruction,
  planModelConsult,
} from "./model-consult.ts";

describe("model consult", () => {
  it("checks which modules are connected at this moment and skips the rest", () => {
    const modules = [
      ...builtinModules({ grokConfigured: true, providers: { openai: true, anthropic: false } }),
      ...customModules([{ id: "saved", label: "Desk", models: ["desk-model"], hasKey: true, status: "configured" }]),
      ...customModules([{ id: "limited", label: "Limited", models: ["old"], hasKey: true, status: "quota_or_rate_limited" }]),
      ...customModules([{ id: "gone", label: "Gone", models: ["old"], hasKey: false, status: "catalogued" }]),
    ];
    const planned = planModelConsult({
      orchestrator: "openai",
      modules,
      question: "What file formats last?",
      purpose: ORCHESTRATOR_PURPOSE,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.deepEqual(planned.plan.available, ["grok", "openai", "custom:saved:desk-model"]);
    assert.deepEqual(planned.plan.helpers.map((item) => item.id), ["grok", "custom:saved:desk-model"]);
    assert.equal(planned.plan.helpers.some((item) => item.id === "anthropic"), false);
    for (const helper of planned.plan.helpers) {
      assert.equal(helper.request.includes(ORCHESTRATOR_PURPOSE), false);
      assert.match(helper.request, /What file formats last/);
    }
  });

  it("refuses a disconnected orchestrator instead of substituting one", () => {
    const planned = planModelConsult({
      orchestrator: "gemini",
      modules: builtinModules({ grokConfigured: true, providers: {} }),
      question: "Hello",
    });
    assert.equal(planned.ok, false);
  });

  it("keeps only help that returned and tells the orchestrator it was born here", async () => {
    const planned = planModelConsult({
      orchestrator: "grok",
      modules: builtinModules({ grokConfigured: true, providers: { openai: true, openrouter: true } }),
      question: "Name a durable format.",
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    const called: string[] = [];
    const help = await collectConsultHelp(planned.plan, async (id, request) => {
      called.push(id);
      assert.equal(request.includes(planned.plan.purpose), false);
      if (id === "openrouter") return { ok: false, text: "" };
      return { ok: true, text: `${id} help` };
    });
    assert.deepEqual(called, ["openai", "openrouter", "nemotron"]);
    assert.deepEqual(help.map((item) => item.id), ["openai", "nemotron"]);
    const instruction = orchestratorInstruction(planned.plan, help);
    assert.match(instruction, /born inside Adrian's Mind/);
    assert.match(instruction, /openrouter/);
    assert.equal(instruction.includes("You are Grok"), false);
    assert.equal(ADRIAN_MIND_IDENTITY.includes("You are Grok"), false);
  });

  it("does not put the purpose inside a help request", () => {
    const request = helpRequest("What is a durable file format?");
    assert.equal(request.includes(ORCHESTRATOR_PURPOSE), false);
  });
});
