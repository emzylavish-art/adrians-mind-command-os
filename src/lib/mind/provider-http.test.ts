import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { httpStatusForProviderSelection, selectProvider } from "./provider-call.ts";
import { CHAT_RATE_LIMIT_REPLY, consumeMindRateLimit, createChatTurnPreflight, jsonRateLimited, resetMindRateLimitsForTests } from "./limits.ts";
import { consumeMindTurn } from "./live-turn.ts";

describe("provider selection HTTP status", () => {
  it("unknown provider is 400 with the honest message", () => {
    const selected = selectProvider("turbo-cloud", {});
    assert.equal(selected.ok, false);
    if (!selected.ok) {
      assert.equal(httpStatusForProviderSelection(selected.error), 400);
      assert.match(selected.error, /not known/);
    }
  });

  it("missing provider key is 503 with the honest message", () => {
    const selected = selectProvider("openai", {});
    assert.equal(selected.ok, false);
    if (!selected.ok) {
      assert.equal(httpStatusForProviderSelection(selected.error), 503);
      assert.match(selected.error, /No openai key is configured/);
    }
  });

  it("client still surfaces a 503 provider-config error body", async () => {
    const message = "No openai key is configured. Another provider is not substituted.";
    const result = await consumeMindTurn({
      url: "http://local.test/api/mind/turn",
      body: { provider: "openai", text: "hi" },
      headers: {},
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: message }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, message);
      assert.equal(result.error.includes("could not be reached"), false);
    }
  });
});

describe("non-Grok provider path rate limit", () => {
  it("checks the request preflight before consulting helpers and dispatching direct providers", () => {
    const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
    const helper = source.slice(source.indexOf("const help = await collectConsultHelp"), source.indexOf("consultation = help"));
    const preflight = helper.indexOf("const denied = await preflight(context,");
    const denial = helper.indexOf("if (denied)");
    const failure = helper.indexOf("return { ok: false", denial);
    const dispatch = helper.indexOf("markDispatched();", failure);
    const invoke = helper.indexOf("askConnectedModule(", dispatch);
    assert.ok(preflight >= 0 && denial > preflight && failure > denial && dispatch > failure && invoke > dispatch, "each helper checks its exact dispatch context and returns a denial before invoking its adapter");
    assert.ok(source.indexOf("contextValidation") < source.indexOf("const help = await collectConsultHelp"));
    for (const [branch, call] of [
      ['if (requestedProvider === "nemotron"', "() => routeSelectedModel("],
      ['if (selected.id !== "grok")', "() => callConfiguredProvider("],
    ]) {
      const start = source.indexOf(branch);
      const dispatch = source.indexOf(call, start);
      assert.ok(start >= 0 && dispatch > start);
      assert.match(source.slice(start, dispatch), /const blocked = await preflight\(\);\s*if \(blocked\) return blocked;/);
    }
  });

  it("charges once per turn, checks for a later stop and blocks the next turn over budget", async () => {
    resetMindRateLimitsForTests();
    const user = "orchestrated-turn";
    for (let i = 0; i < 11; i++) assert.equal(consumeMindRateLimit("chat", user, 12).ok, true);
    let halted = false;
    const turn = createChatTurnPreflight(user, async () => halted);
    assert.equal(await turn(), null);
    assert.equal(await turn(), null);
    const next = createChatTurnPreflight(user, async () => false);
    assert.equal((await next())?.status, 429);
    halted = true;
    assert.equal((await turn())?.status, 403);
  });

  it("shared chat bucket blocks a non-Grok attempt after a burst", () => {
    resetMindRateLimitsForTests();
    const user = "provider-burst";
    for (let i = 0; i < 12; i += 1) {
      assert.equal(consumeMindRateLimit("chat", user, 12, 60_000, 1_000 + i).ok, true);
    }
    const blocked = consumeMindRateLimit("chat", user, 12, 60_000, 2_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      const res = jsonRateLimited(CHAT_RATE_LIMIT_REPLY, blocked.retryAfterSec);
      assert.equal(res.status, 429);
    }
  });
});
