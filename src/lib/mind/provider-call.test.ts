import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callConfiguredProvider, configuredProviders, selectProvider, parseProviderText } from "./provider-call.ts";

describe("provider calls", () => {
  it("refuses a missing key without contacting a provider", async () => {
    let called = false;
    const selected = selectProvider("openai", {});
    assert.equal(selected.ok, false);
    const result = await callConfiguredProvider({
      id: "openai", key: "", prompt: "hello",
      fetch: async () => { called = true; return { ok: true, status: 200, text: async () => "nope" }; },
    });
    assert.equal(called, false);
    assert.match(result.error, /Nothing was sent/);
    assert.equal(configuredProviders({}).openai, false);
    assert.equal(selectProvider("grok", {}).ok, true);
  });
  it("delivers the full prompt and history and keeps a long vendor reply", async () => {
    const prompt = "p".repeat(6000) + "!";
    const history = "h".repeat(7000) + "?";
    const reply = "r".repeat(6200) + ".";
    for (const id of ["gemini", "openrouter"] as const) {
      const result = await callConfiguredProvider({
        id, model: id === "openrouter" ? "vendor/example:free" : undefined, key: "fixture", prompt, history: [{ role: "user", content: history }],
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          assert.deepEqual(id === "gemini" ? body.contents.map((row: { parts: { text: string }[] }) => row.parts[0].text) :
            body.messages.map((row: { content: string }) => row.content), [history, prompt]);
          const payload = id === "gemini" ? { candidates: [{ content: { parts: [{ text: reply }] } }] } : { choices: [{ message: { content: reply } }] };
          return Response.json(payload);
        },
      });
      assert.equal(result.text, reply);
    }
  });

  it("forwards cancellation to the actual pending vendor fetch", async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const result = callConfiguredProvider({
      id: "gemini", key: "fixture", prompt: "wait", signal: controller.signal,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { sawAbort = true; reject(new Error("stopped")); });
      }),
    });
    controller.abort();
    assert.equal((await result).ok, false);
    assert.ok(sawAbort);
  });

  it("reports a rate limit without substituting", async () => {
    const result = await callConfiguredProvider({
      id: "anthropic", key: "test-key", prompt: "hello",
      fetch: async (url, init) => {
        assert.match(url, /anthropic/);
        assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-key");
        return { ok: false, status: 429, headers: new Headers({ "retry-after": "12" }), text: async () => "" };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /rate limited/);
    assert.equal(result.httpStatus, 429);
    assert.equal(result.retryAfter, "12");
    assert.equal(result.text, "");
  });
  it("maps personality system instructions to each provider's native field", async () => {
    const inputs = [
      ["openai", "messages"],
      ["openrouter", "messages"],
      ["anthropic", "system"],
      ["gemini", "systemInstruction"],
    ] as const;
    for (const [id, field] of inputs) {
      const requests: Record<string, unknown>[] = [];
      const result = await callConfiguredProvider({
        id, model: id === "openrouter" ? "vendor/example:free" : undefined, key: "test-key", prompt: "hello", systemPrompt: "Style preference only.",
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return { ok: true, status: 200, text: async () => id === "gemini"
            ? JSON.stringify({ candidates: [{ content: { parts: [{ text: "reply" }] } }] })
            : id === "anthropic"
              ? JSON.stringify({ content: [{ type: "text", text: "reply" }] })
              : JSON.stringify({ choices: [{ message: { content: "reply" } }] }) };
        },
      });
      assert.equal(result.ok, true);
      const request = requests[0];
      assert.ok(request);
      if (field === "messages") {
        assert.deepEqual((request.messages as unknown[])[0], { role: "system", content: "Style preference only." });
      } else if (field === "system") {
        assert.equal(request.system, "Style preference only.");
        assert.deepEqual(request.messages, [{ role: "user", content: "hello" }]);
      } else {
        assert.deepEqual(request.systemInstruction, { parts: [{ text: "Style preference only." }] });
        assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "hello" }] }]);
      }
    }
  });
  it("extracts assistant text from each provider response", () => {
    assert.equal(parseProviderText("openai", JSON.stringify({ choices: [{ message: { content: "hello" } }] })), "hello");
    assert.equal(parseProviderText("openrouter", JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "one" }] } }] })), "one");
    assert.equal(parseProviderText("anthropic", JSON.stringify({ content: [{ type: "text", text: "two" }] })), "two");
    assert.equal(parseProviderText("gemini", JSON.stringify({ candidates: [{ content: { parts: [{ text: "three" }] } }] })), "three");
    assert.equal(parseProviderText("openai", "not json"), "");
    assert.equal(parseProviderText("anthropic", JSON.stringify({ content: [{ type: "tool_use", input: { token: "secret" } }] })), "");
  });
  it("preserves recent conversation messages but not provider JSON", async () => {
    const result = await callConfiguredProvider({
      id: "openai", key: "key", prompt: "second", history: [{ role: "user", content: "first" }],
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.messages, [{ role: "user", content: "first" }, { role: "user", content: "second" }]);
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "reply" } }] }) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.text, "reply");
  });
});


it("blocks OpenRouter automatic and paid models and sends the exact free model with a zero-price cap", async () => {
  let calls = 0;
  const send = (model: string) => callConfiguredProvider({
    id: "openrouter", model, key: "fixture", prompt: "Synthetic check",
    fetch: async (url, init) => {
      calls++;
      assert.match(url, /^https:\/\/openrouter\.ai\//);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "vendor/example:free");
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 });
      return { ok: true, status: 200, text: async () => JSON.stringify({ model: body.model, choices: [{ message: { content: "Fixture response" } }] }) };
    },
  });
  for (const model of ["openrouter/auto", "openrouter/free", "vendor/example", ""]) {
    assert.equal((await send(model)).httpStatus, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await send("vendor/example:free")).model, "vendor/example:free");
  assert.equal(calls, 1);
});

it("selects the supported Gemini default and sends credentials only in headers", async () => {
  const model = "gemini-3.1-flash-lite";
  assert.deepEqual(selectProvider("gemini", { GEMINI_API_KEY: "fixture" }), { ok: true, id: "gemini", model });
  const result = await callConfiguredProvider({
    id: "gemini", key: "fixture-secret", prompt: "Synthetic check",
    fetch: async (url, init) => {
      assert.match(url, new RegExp(model + ":generateContent$"));
      assert.equal(url.includes("fixture-secret"), false);
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "fixture-secret");
      return { ok: true, status: 200, text: async () => JSON.stringify({ modelVersion: model, candidates: [{ content: { parts: [{ text: "Fixture response" }] } }] }) };
    },
  });
  assert.equal(result.model, model);
});
