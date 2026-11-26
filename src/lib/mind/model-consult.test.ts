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
  normalizeConsultAttempts,
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
      helperIds: ["grok", "custom:saved:desk-model"],
      allowPaidHelpers: true,
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
      question: "Compare durable formats and verify tradeoffs.",
      helperIds: ["openai", "openrouter"],
      allowPaidHelpers: true,
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
    assert.deepEqual(called, ["openai", "openrouter"]);
    assert.deepEqual(help.map((item) => item.id), ["openai"]);
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

it("C2 AA044/090: simple requests make no helper calls, and paid helpers require explicit authorization", () => {
  const modules = builtinModules({ grokConfigured: true, providers: { openai: true, openrouter: true }, openrouterModel: "vendor/free:free" });
  const direct = planModelConsult({ orchestrator: "grok", modules, question: "Hello" });
  assert.equal(direct.ok && direct.plan.helpers.length, 0);
  const complex = planModelConsult({ orchestrator: "grok", modules, question: "Review the implementation and test failure paths" });
  assert.equal(complex.ok && complex.plan.helpers.length, 2);
  if (complex.ok) {
    assert.ok(complex.plan.helpers.every((helper) => helper.id !== "openai"));
    assert.deepEqual(complex.plan.helpers.map((helper) => helper.role), ["implementation", "critique"]);
    assert.equal(complex.plan.maxCalls, 3);
  }
  const denied = planModelConsult({ orchestrator: "grok", modules, question: "Review this", helperIds: ["openai"] });
  assert.equal(denied.ok, false);
  assert.equal(planModelConsult({ orchestrator: "grok", modules, question: "Review this", helperIds: ["openai"], allowPaidHelpers: true }).ok, true);
  assert.equal(planModelConsult({ orchestrator: "grok", modules, question: "Review this", freeOnly: true }).ok, false);
});

it("C2 AA049: OpenRouter and Nemotron aliases share one actual model route", () => {
  const modules = builtinModules({ grokConfigured: true, providers: { openrouter: true }, openrouterModel: "nvidia/nemotron-nano-9b-v2:free" });
  const plan = planModelConsult({ orchestrator: "grok", modules, question: "Review code and compare outcomes" });
  assert.equal(plan.ok && plan.plan.helpers.length, 1);
  const sameAsOrchestrator = planModelConsult({ orchestrator: "nemotron", modules, question: "Review code and compare outcomes" });
  assert.equal(sameAsOrchestrator.ok && sameAsOrchestrator.plan.helpers.length, 0);
});

it("C2 AA049: a custom alias for the selected official API is not a second independent helper", () => {
  const modules = [
    ...builtinModules({ grokConfigured: true }),
    ...customModules([{ id: "saved", host: "api.x.ai", label: "Same API", models: ["grok-4.5"], hasKey: true, status: "configured" }]),
  ];
  const plan = planModelConsult({ orchestrator: "grok", modules, question: "Review code", helperIds: ["custom:saved:grok-4.5"], allowPaidHelpers: true });
  assert.equal(plan.ok && plan.plan.helpers.length, 0);
});

it("C2 AA044/090: a remote runner is not automatically classified as free local inference", () => {
  for (const url of ["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434"]) {
    const modules = builtinModules({ grokConfigured: false, localRunner: true, localRunnerUrl: url });
    assert.equal(planModelConsult({ orchestrator: "ollama", modules, question: "Hello", freeOnly: true }).ok, true);
  }
  for (const url of [undefined, "https://paid-runner.fixture.invalid/api", "http://localhost.fixture.invalid", "http://owner:secret@localhost:11434"]) {
    const modules = builtinModules({ grokConfigured: false, localRunner: true, localRunnerUrl: url });
    assert.equal(planModelConsult({ orchestrator: "ollama", modules, question: "Hello", freeOnly: true }).ok, false);
  }
});

it("C2 AA045–048/084: bounded concurrent helpers preserve dissent, missing failures and truncation receipts", async () => {
  const { collectConsultReport } = await import("./model-consult.ts");
  const planned = planModelConsult({ orchestrator: "main", question: "Review evidence for this decision", modules: [
    { id: "main", label: "Main", connected: true, cost: "local" },
    { id: "a", label: "A", connected: true, cost: "free" },
    { id: "b", label: "B", connected: true, cost: "free" },
    { id: "c", label: "C", connected: true, cost: "free" },
  ] });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  let active = 0; let peak = 0;
  const releases: Array<() => void> = [];
  const pending = collectConsultReport(planned.plan, async (id) => {
    active++; peak = Math.max(active, peak);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return id === "a" ? { ok: true, text: `Supports the conclusion. ${"x".repeat(2300)} However, stronger evidence contradicts this and uncertainty remains.`, provider: "provider-a", model: "reported-a", requestedModel: "requested-a" } : { ok: false, text: "", error: "Provider b rate limited the request.", provider: "provider-b" };
  });
  assert.equal(releases.length, 2);
  releases.forEach((release) => release());
  const report = await pending;
  assert.equal(peak, 2);
  assert.deepEqual(report.attempts.map((item) => item.status), ["completed", "failed"]);
  assert.equal(report.help[0].truncated, true);
  assert.match(report.help[0].text, /stronger evidence contradicts/);
  assert.equal(report.attempts[0].model, "reported-a");
  const instruction = orchestratorInstruction(planned.plan, report.help, report.attempts);
  assert.match(instruction, /Explicitly preserve contradictions/);
  assert.match(instruction, /rate limited/);
  assert.match(instruction, /verified execution receipts/i);
  assert.doesNotMatch(ADRIAN_MIND_IDENTITY, /Do not say which model or API/);
});

it("C2 AA046/047: cancellation and deadline receipts stop further consultation", async () => {
  const { collectConsultReport } = await import("./model-consult.ts");
  const plan = { orchestrator: "main", available: ["main", "helper"], helpers: [{ id: "helper", request: "Question" }], purpose: "synthesize" };
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const canceled = await collectConsultReport(plan, async () => { calls++; return { ok: true, text: "Unexpected" }; }, { signal: controller.signal });
  assert.equal(calls, 0);
  assert.equal(canceled.attempts[0].status, "canceled");
  const timed = await collectConsultReport(plan, async (_id, _request, signal) => {
    return new Promise((resolve) => signal!.addEventListener("abort", () => resolve({ ok: false, text: "" }), { once: true }));
  }, { timeoutMs: 5 });
  assert.equal(timed.attempts[0].status, "timed_out");
});

it("C2 AA047: persisted usage receipts contain only bounded serializable token counters", () => {
  const attempts = normalizeConsultAttempts([{ id: "helper", status: "completed", truncated: false, durationMs: 20,
    usage: { prompt_tokens: Infinity, completion_tokens: 9_000_000_000, private_metadata: { secret: "not a receipt field" } } }]);
  assert.equal(attempts[0].usage?.prompt_tokens, undefined);
  assert.equal(attempts[0].usage?.completion_tokens, 1_000_000_000);
  assert.equal(JSON.stringify(attempts).includes("secret"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(attempts))[0].usage, { completion_tokens: 1_000_000_000 });
});
