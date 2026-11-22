import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatTurnBody } from "./logic-routes.ts";
import { routeFailureAction } from "./route-failure.ts";
import {
  claimSend,
  dismissFailure,
  feedbackAfterSelectionChange,
  gateTurn,
  legacyProviderOption,
  providerBoardCards,
  resolveOpenAiFallback,
  selectionForRetry,
  selectionIdentity,
  type TurnSelection,
} from "./selection-routing.ts";
import type { LogicRoutePublic } from "./logic-routes.ts";

function route(partial: Partial<LogicRoutePublic> & Pick<LogicRoutePublic, "id">): LogicRoutePublic {
  return {
    label: partial.id === "astra" ? "Astra" : partial.id === "sol" ? "Sol" : "Luna",
    state: "needs-config",
    ready: false,
    model: null,
    missing: [],
    reason: "needs config",
    credential: null,
    credentialFallback: null,
    ...partial,
  };
}

const base: TurnSelection = { provider: "grok", modelTier: "Auto", logicRoute: null, orchestrator: null };

describe("routeFailureAction", () => {
  it("uses Setup and not Retry for needs-config, blocked, budget, and database", () => {
    assert.equal(routeFailureAction({ state: "needs-config" }), "setup");
    assert.equal(routeFailureAction({ state: "blocked" }), "setup");
    assert.equal(routeFailureAction({ state: "missing-db" }), "setup");
    assert.equal(routeFailureAction({ error: "Missing MIND_COMMAND_BUDGET_LIMIT_USD." }), "setup");
    assert.equal(routeFailureAction({ error: "Needs DATABASE_URL." }), "setup");
    assert.equal(routeFailureAction({ state: "configured", error: "The model route timed out." }), "retry");
    assert.equal(routeFailureAction({}), "none");
  });
});

describe("unwired providers and OpenAI fallback", () => {
  it("routes Claude, Gemini, OpenRouter, and Ollama only when their key or runner is present", () => {
    for (const id of ["anthropic", "gemini", "openrouter", "ollama"] as const) {
      const option = legacyProviderOption(id, true);
      assert.equal(option.enabled, true);
      const missing = gateTurn({ ...base, provider: id }, [], true);
      assert.equal(missing.ok, false);
      if (!missing.ok) {
        assert.equal(missing.failureAction, "setup");
        assert.match(missing.error, /is not connected/);
        assert.equal(missing.error.includes("substituted"), false);
      }
      const gate = gateTurn({ ...base, provider: id }, [], true, { [id]: true });
      assert.equal(gate.ok, true);
      if (gate.ok) assert.equal(gate.provider, id);
    }
  });

  it("sends OpenAI through its own adapter without substituting another route", () => {
    const none = resolveOpenAiFallback([route({ id: "sol", state: "needs-config", missing: ["SOL_API_KEY", "OPENAI_API_KEY"] })]);
    assert.equal(none.ok, false);
    const sol = route({
      id: "sol",
      state: "configured",
      ready: true,
      model: "gpt-6-sol",
      credential: "OPENAI_API_KEY",
      credentialFallback: "OPENAI_API_KEY",
      reason: "configured",
    });
    const one = resolveOpenAiFallback([sol]);
    assert.equal(one.ok && one.route, "sol");
    const many = resolveOpenAiFallback([
      sol,
      route({ id: "luna", state: "configured", ready: true, credentialFallback: "OPENAI_API_KEY", model: "gpt-6-luna" }),
    ]);
    assert.equal(many.ok, false);
    if (!many.ok) assert.match(many.error, /Choose Astra, Sol, or Luna/);
    const gate = gateTurn({ ...base, provider: "openai" }, [sol], true);
    assert.equal(gate.ok, true);
    if (gate.ok) {
      assert.equal(gate.provider, "openai");
      assert.equal(gate.logicRoute, null);
      assert.match(gate.note ?? "", /OpenAI adapter/);
      const body = chatTurnBody({
        text: "hi",
        memory: "off",
        halted: false,
        history: [],
        memoryContext: [],
        provider: gate.provider,
        modelTier: gate.modelTier,
        logicRoute: gate.logicRoute,
        orchestrator: gate.orchestrator,
        images: [],
      });
      assert.equal(body.logicRoute, undefined);
      assert.equal(body.provider, "openai");
    }
  });

  it("does not label provider cards Connected", () => {
    const cards = providerBoardCards({
      grokConfigured: true,
      logicRoutes: [route({ id: "luna", state: "needs-config", missing: ["LUNA_API_KEY"], reason: "Luna needs config. Missing LUNA_API_KEY." })],
    });
    assert.equal(cards.some((card) => card.state === "Connected"), false);
    assert.match(cards.find((card) => card.name === "Claude")?.detail ?? "", /ANTHROPIC_API_KEY/);
    assert.match(cards.find((card) => card.name === "Ollama")?.detail ?? "", /OLLAMA_MODEL/);
  });
});

describe("retry and selection changes", () => {
  it("retries the failed selection and ignores a later picker change", () => {
    const failed: TurnSelection = { provider: "sol", modelTier: "Heavy", logicRoute: "sol", orchestrator: null };
    const later: TurnSelection = { provider: "luna", modelTier: "Fast", logicRoute: "luna", orchestrator: "astra" };
    const retry = selectionForRetry(failed, later);
    assert.deepEqual(retry, failed);
    const body = chatTurnBody({
      text: "again",
      memory: "off",
      halted: false,
      history: [],
      memoryContext: [],
      provider: retry.provider,
      modelTier: retry.modelTier,
      logicRoute: retry.logicRoute,
      orchestrator: retry.orchestrator,
      images: [],
    });
    assert.equal(body.logicRoute, "sol");
    assert.equal(body.provider, "sol");
    assert.equal(body.modelTier, "Heavy");
  });

  it("clears a stale error and a stale success notice when the selection changes", () => {
    const kept = feedbackAfterSelectionChange("sol", "sol", { error: "down", liveText: "partial", notice: "Responded sol" });
    assert.equal(kept.error, "down");
    const cleared = feedbackAfterSelectionChange("sol", "grok", { error: "down", liveText: "partial", notice: "Responded sol" });
    assert.deepEqual(cleared, { error: null, liveText: "", notice: null });
    assert.equal(dismissFailure(), null);
  });

  it("drops a second Send or Retry while a turn is in flight", () => {
    const sent: string[] = [];
    let inFlight = false;
    function click(id: string) {
      if (!claimSend(inFlight)) return;
      inFlight = true;
      sent.push(id);
      inFlight = false;
    }
    click("sol");
    inFlight = true;
    click("sol");
    click("luna");
    assert.deepEqual(sent, ["sol"]);
    assert.notEqual(selectionIdentity(base), selectionIdentity({ ...base, logicRoute: "sol", provider: "sol" }));
  });
});
