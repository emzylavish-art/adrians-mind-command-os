import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGIC_ROUTES,
  adapterCliArgs,
  chatTurnBody,
  modelGenerateArgs,
  readSelection,
  readinessFromProviderStatus,
  resolveRequestedRoute,
  respondedRouteLabel,
  writeSelection,
  type ProviderStatusSnapshot,
} from "./logic-routes.ts";
import { invokeProviderRouter, loadProviderStatus, runLogicRoute } from "./logic-route-adapter.server.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

function snapshot(routes: ProviderStatusSnapshot["providers"], budget?: ProviderStatusSnapshot["app_budget"], live = false): ProviderStatusSnapshot {
  return { live_verified: live, app_budget: budget ?? { paused: false, accounting: "env" }, providers: routes };
}

describe("selection persistence", () => {
  it("restores catalog, tool, service and local provider choices without substituting Grok", () => {
    const storage = memoryStorage();
    const longId = "custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:" + encodeURIComponent("a" + "/".repeat(149));
    for (const provider of [longId, "custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:vendor%2Fchat%3Afree", "mcp:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:read_file", "service:drive", "nemotron", "ollama"]) {
      writeSelection(storage, { provider, modelTier: "Auto", logicRoute: null });
      assert.equal(readSelection(memoryStorage(storage.dump())).provider, provider);
    }
  });

  it("restores exact Grok models and clears stale model overrides when a tier is chosen", () => {
    const storage = memoryStorage();
    writeSelection(storage, { provider: "grok", modelTier: "Auto", logicRoute: null, grokModel: "grok-4.6" });
    assert.equal(readSelection(memoryStorage(storage.dump())).grokModel, "grok-4.6");
    writeSelection(storage, { provider: "grok", modelTier: "Expert", logicRoute: null });
    assert.equal(readSelection(storage).grokModel, undefined);
  });

  it("restores model, provider, and logic route after a reload", () => {
    const first = memoryStorage();
    writeSelection(first, { provider: "sol", modelTier: "Heavy", logicRoute: "sol" });
    const reloaded = memoryStorage(first.dump());
    assert.deepEqual(readSelection(reloaded), { provider: "sol", modelTier: "Heavy", logicRoute: "sol" });
    writeSelection(reloaded, { provider: "grok", modelTier: "Fast", logicRoute: null });
    assert.equal(reloaded.getItem("amcos.logicRoute.v1"), null);
    assert.equal(readSelection(reloaded).logicRoute, null);
    assert.equal(readSelection(reloaded).modelTier, "Fast");
  });
});

describe("request carries the selection", () => {
  it("preserves explicit helper authorization and free-only mode through the actual request body", () => {
    const base = { text: "Review the implementation", memory: "off" as const, halted: false, history: [], memoryContext: [], provider: "grok", modelTier: "Auto" as const, logicRoute: null, images: [], composerMode: "orchestrator", orchestrator: "grok" };
    for (const consent of [false, true]) {
      const consult = { available: ["grok", "openai"], helpers: [], purpose: "Synthesize", helperIds: ["openai"], allowPaidHelpers: consent };
      const body = JSON.parse(JSON.stringify(chatTurnBody({ ...base, consult, freeOnly: !consent })));
      assert.deepEqual(body.consult.helperIds, ["openai"]);
      assert.equal(body.consult.allowPaidHelpers, consent);
      assert.equal(body.freeOnly, !consent);
    }
    assert.equal("freeOnly" in chatTurnBody(base), false);
    assert.equal("consult" in chatTurnBody(base), false);
  });

  it("puts a different logicRoute and provider on each selection and does not send {text} to model.generate", () => {
    const bodies = LOGIC_ROUTES.map((route) =>
      chatTurnBody({
        text: "hello",
        memory: "off",
        halted: false,
        history: [],
        memoryContext: [],
        provider: "grok",
        modelTier: "Auto",
        logicRoute: route,
        images: [],
      }),
    );
    assert.deepEqual(bodies.map((body) => body.logicRoute), ["astra", "sol", "luna"]);
    assert.deepEqual(bodies.map((body) => body.provider), ["astra", "sol", "luna"]);
    for (const route of LOGIC_ROUTES) {
      const spec = modelGenerateArgs(route, [{ role: "user", content: "hello" }], route === "sol" ? "gpt-6-sol" : `${route}-model`);
      assert.equal("text" in spec, false);
      assert.equal(spec.provider, route);
      assert.equal(spec.stream, false);
      assert.deepEqual(spec.messages, [{ role: "user", content: "hello" }]);
      const argv = adapterCliArgs(spec);
      assert.equal(argv.includes("--route"), false);
      assert.equal(argv[argv.indexOf("--provider") + 1], route);
      assert.equal(argv.includes("--model"), true);
    }
  });

  it("forwards a selected chat personality and defaults legacy callers", () => {
    const shared = {
      text: "hello",
      memory: "off" as const,
      halted: false,
      history: [],
      memoryContext: [],
      provider: "grok",
      modelTier: "Auto" as const,
      logicRoute: null,
      images: [],
    };
    assert.equal(chatTurnBody({ ...shared, personalityId: "unhinged" }).personalityId, "unhinged");
    assert.equal(chatTurnBody(shared).personalityId, "assistant");
    assert.equal(
      chatTurnBody({ ...shared, personalityId: "custom", customPersonality: "Candid and concise." }).customPersonality,
      "Candid and concise.",
    );
    assert.equal(chatTurnBody(shared).customPersonality, "");
  });

  it("refuses a provider and logicRoute that disagree", () => {
    const conflict = resolveRequestedRoute({ logicRoute: "sol", provider: "luna" });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.match(conflict.error, /Nothing was sent/);
    assert.deepEqual(resolveRequestedRoute({ logicRoute: "sol", provider: "sol" }), { ok: true, route: "sol" });
    assert.deepEqual(resolveRequestedRoute({ logicRoute: "", provider: "astra" }), { ok: true, route: "astra" });
  });
});

describe("provider.status readiness", () => {
  it("does not treat Sol or Luna as absent when provider.status reports the default model", async () => {
    const env = { PATH: process.env.PATH, OPENAI_API_KEY: "openai-key-value-not-logged" };
    const status = await loadProviderStatus(env);
    const views = readinessFromProviderStatus(status);
    for (const id of ["sol", "luna"] as const) {
      const view = views.find((item) => item.id === id);
      assert.ok(view);
      assert.equal(view?.state, "configured");
      assert.equal(view?.ready, true);
      assert.equal(view?.model, id === "sol" ? "gpt-6-sol" : "gpt-6-luna");
      assert.equal(view?.credentialFallback, "OPENAI_API_KEY");
      assert.deepEqual(view?.missing, []);
      assert.match(view?.reason ?? "", /Credential fallback: OPENAI_API_KEY/);
      assert.equal(JSON.stringify(view).includes("openai-key-value-not-logged"), false);
    }
  });

  it("names the missing key when provider.status says the route is not configured", async () => {
    const status = await loadProviderStatus({ PATH: process.env.PATH });
    const sol = readinessFromProviderStatus(status).find((item) => item.id === "sol");
    assert.equal(sol?.state, "needs-config");
    assert.equal(sol?.ready, false);
    assert.equal(sol?.model, "gpt-6-sol");
    assert.ok(sol?.missing.includes("SOL_API_KEY"));
    assert.ok(sol?.missing.includes("OPENAI_API_KEY"));
    assert.equal(sol?.missing.includes("SOL_MODEL"), false);
    assert.match(sol?.reason ?? "", /Missing SOL_API_KEY, OPENAI_API_KEY/);
  });

  it("blocks when provider.status says the budget is paused and does not claim authenticated without a live probe", () => {
    const paused = readinessFromProviderStatus(
      snapshot(
        [{ id: "luna", configured: true, model: "gpt-6-luna", endpoint: "https://api.openai.com/v1/chat/completions", credential: "LUNA_API_KEY" }],
        { paused: true, accounting: "env" },
      ),
    ).find((item) => item.id === "luna");
    assert.equal(paused?.state, "blocked");
    assert.match(paused?.reason ?? "", /blocked/);
    const configured = readinessFromProviderStatus(
      snapshot([{ id: "astra", configured: true, model: "gpt-6-astra", endpoint: "https://api.openai.com/v1/chat/completions", credential: "ASTRA_API_KEY" }], { paused: false }),
    ).find((item) => item.id === "astra");
    assert.equal(configured?.state, "configured");
    assert.notEqual(configured?.state, "authenticated");
    const authed = readinessFromProviderStatus(
      snapshot([{ id: "astra", configured: true, model: "gpt-6-astra", endpoint: "https://api.openai.com/v1/chat/completions", credential: "ASTRA_API_KEY" }], { paused: false }, true),
    ).find((item) => item.id === "astra");
    assert.equal(authed?.state, "authenticated");
  });
});

describe("adapter reply handling", () => {
  it("returns the provider and model the mock adapter actually answered", async () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const ran = await runLogicRoute({
      route: "sol",
      messages: [{ role: "user", content: "hi" }],
      env: { PATH: process.env.PATH, OPENAI_API_KEY: "openai-key-value-not-logged" },
      inspect: async () => readinessFromProviderStatus(await loadProviderStatus({ PATH: process.env.PATH, OPENAI_API_KEY: "openai-key-value-not-logged" })),
      invoke: async (input) => {
        calls.push({ args: ["python3", "provider_router.py", ...adapterCliArgs(input.spec)], env: { SOL_API_BASE_URL: input.endpoint ?? "" } });
        return { ok: true, provider: input.spec.provider, model: "gpt-6-sol", content: "ok" };
      },
    });
    assert.equal(ran.ok, true);
    if (ran.ok) {
      assert.equal(ran.provider, "sol");
      assert.equal(ran.model, "gpt-6-sol");
      assert.equal(ran.credentialFallback, "OPENAI_API_KEY");
      assert.match(respondedRouteLabel(ran), /Responded sol · gpt-6-sol/);
      assert.match(respondedRouteLabel(ran), /Credential fallback: OPENAI_API_KEY/);
    }
    assert.equal(calls[0]?.args.includes("--route"), false);
    assert.equal(calls[0]?.args.includes("text"), false);
  });

  it("does not call the adapter when the route needs config", async () => {
    let called = false;
    const ran = await runLogicRoute({
      route: "luna",
      messages: [{ role: "user", content: "hi" }],
      inspect: async () => readinessFromProviderStatus(await loadProviderStatus({ PATH: process.env.PATH })),
      invoke: async () => {
        called = true;
        return { ok: true, provider: "luna", model: "gpt-6-luna", content: "nope" };
      },
    });
    assert.equal(called, false);
    assert.equal(ran.ok, false);
    if (!ran.ok) {
      assert.equal(ran.called, false);
      assert.match(ran.error, /LUNA_API_KEY/);
    }
  });

  it("rejects a malformed adapter body and a different provider instead of falling back", async () => {
    const base = {
      spec: modelGenerateArgs("astra", [{ role: "user", content: "hi" }], "gpt-6-astra"),
      env: { PATH: process.env.PATH },
    };
    const malformed = await invokeProviderRouter({
      ...base,
      spawnImpl: async () => ({ code: 0, stdout: "{\"provider\":\"astra\"}", stderr: "", timedOut: false }),
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.match(malformed.error, /empty or unnamed|unreadable/);
    const other = await invokeProviderRouter({
      ...base,
      spawnImpl: async () => ({
        code: 0,
        stdout: JSON.stringify({ provider: "luna", model: "gpt-6-luna", content: "switched" }),
        stderr: "",
        timedOut: false,
      }),
    });
    assert.equal(other.ok, false);
    if (!other.ok) assert.match(other.error, /Requested Astra but the adapter ran luna/);
    const junk = await invokeProviderRouter({
      ...base,
      spawnImpl: async () => ({ code: 0, stdout: "not-json", stderr: "", timedOut: false }),
    });
    assert.equal(junk.ok, false);
  });
});

it("drops the oldest historical image to fit the request while retaining text and the current attachment", () => {
  const image = { dataUrl: "data:image/png;base64," + "a".repeat(980_000) };
  const history = [1, 2].map((n) => ({ role: "user", content: String(n), images: [image] }));
  const body = chatTurnBody({ text: "continue", memory: "off", halted: false, history, memoryContext: [],
    provider: "grok", modelTier: "Auto", logicRoute: null, images: [image] });
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 2_500_000);
  const sent = body.history as typeof history;
  assert.deepEqual(sent[0].images, []);
  assert.match(sent[0].content, /not included because this request exceeded/);
  assert.deepEqual(sent[1], history[1]);
  assert.deepEqual(body.historyImageOmissions, [{ messageIndex: 0, name: "image 1", reason: "request_body_budget" }]);
  assert.deepEqual(body.images, [image]);
  assert.equal(history[0].images.length, 1);
});
