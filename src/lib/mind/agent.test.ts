import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentModelBody, readAgentMessage, runBoundedAgent, toProviderMessages, type AgentModel } from "./agent.ts";
import { emptyWorkspace } from "./workspace.ts";

function workspace() {
  const ws = emptyWorkspace();
  ws.projects.push({ id: "p1", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
  ws.chats.push({
    id: "c1",
    title: "Dock",
    memory: "off",
    temporary: false,
    autonomy: "ask",
    projectId: null,
    retrievalLog: [],
    messages: [],
  });
  ws.memories.push({
    id: "n1",
    scope: "global",
    projectId: null,
    chatId: null,
    text: "The pier needs paint.",
    source: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
    versions: [],
  });
  return ws;
}

const signal = () => new AbortController().signal;

describe("bounded agent", () => {
  it("runs the tool the model chose and returns the model's final text", async () => {
    let calls = 0;
    const model: AgentModel = async ({ messages }) => {
      calls += 1;
      if (calls === 1) return { text: "", toolCalls: [{ id: "call-1", name: "search_notes", arguments: { query: "pier" } }] };
      const tool = messages.find((message) => message.role === "tool");
      assert.equal(tool?.role, "tool");
      if (tool?.role === "tool") assert.match(tool.content, /pier needs paint/);
      return { text: "The note says the pier needs paint.", toolCalls: [] };
    };
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Find the pier note",
      model,
      signal: signal(),
      autonomy: "ask",
      halted: false,
      approved: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.text, "The note says the pier needs paint.");
    assert.equal(result.log.length, 1);
    assert.equal(result.log[0]?.tool, "search_notes");
    assert.equal(result.log[0]?.ok, true);
  });

  it("rejects a tool that is not registered and does not run later tools", async () => {
    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Do it",
      model: async () => {
        calls += 1;
        return { text: "", toolCalls: [{ id: "call-1", name: "shell", arguments: { command: "rm -rf /" } }] };
      },
      signal: signal(),
      autonomy: "automatic",
      halted: false,
      approved: true,
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not registered/);
    assert.equal(result.log[0]?.ok, false);
  });

  it("rejects malformed arguments", async () => {
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Search",
      model: async () => ({ text: "", toolCalls: [{ id: "call-1", name: "search_notes", arguments: { query: 4 } }] }),
      signal: signal(),
      autonomy: "ask",
      halted: false,
      approved: true,
    });
    assert.match(result.error ?? "", /query string/);
  });

  it("does not call the model when emergency stop is on or approval is missing", async () => {
    let calls = 0;
    const model: AgentModel = async () => {
      calls += 1;
      return { text: "no", toolCalls: [] };
    };
    const halted = await runBoundedAgent({ ws: workspace(), goal: "Go", model, signal: signal(), autonomy: "automatic", halted: true, approved: true });
    const unapproved = await runBoundedAgent({ ws: workspace(), goal: "Go", model, signal: signal(), autonomy: "ask", halted: false, approved: false });
    assert.equal(calls, 0);
    assert.match(halted.error ?? "", /Emergency stop/);
    assert.match(unapproved.error ?? "", /not approved/);
  });

  it("stops when time runs out before a model call", async () => {
    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Go",
      model: async () => {
        calls += 1;
        return { text: "late", toolCalls: [] };
      },
      signal: signal(),
      autonomy: "automatic",
      halted: false,
      approved: true,
      now: () => 100,
      deadlineMs: 0,
    });
    assert.equal(calls, 0);
    assert.match(result.error ?? "", /out of time/);
  });

  it("stops when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Go",
      model: async () => {
        calls += 1;
        return { text: "no", toolCalls: [] };
      },
      signal: controller.signal,
      autonomy: "automatic",
      halted: false,
      approved: true,
    });
    assert.equal(calls, 0);
    assert.match(result.error ?? "", /Stopped/);
  });

  it("records a tool failure and does not invent a final answer", async () => {
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Go",
      model: async () => ({ text: "", toolCalls: [{ id: "call-1", name: "list_projects", arguments: {} }] }),
      signal: signal(),
      autonomy: "automatic",
      halted: false,
      approved: true,
      execute: () => ({ ok: false, lines: ["list_projects: disk failed"] }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.text, "");
    assert.match(result.error ?? "", /disk failed/);
  });

  it("stops after the step limit instead of calling the model forever", async () => {
    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Keep going",
      model: async () => {
        calls += 1;
        return { text: "", toolCalls: [{ id: `call-${calls}`, name: "list_chats", arguments: {} }] };
      },
      signal: signal(),
      autonomy: "automatic",
      halted: false,
      approved: true,
      maxSteps: 2,
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /2 tool steps/);
    assert.equal(result.log.length, 2);
    assert.equal(calls, 3);
  });

  it("sends tool results back in tool-message form and registers read tools plus imagine", () => {
    const body = buildAgentModelBody([
      { role: "user", content: "List chats" },
      { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "list_chats", arguments: {} }] },
      { role: "tool", toolCallId: "call-1", name: "list_chats", content: "Dock" },
    ]);
    assert.equal(body.model, "grok-4.5");
    assert.equal(buildAgentModelBody([], { model: "grok-build-0.1" }).model, "grok-build-0.1");
    assert.deepEqual(body.tools.map((tool) => tool.function.name), ["list_projects", "list_chats", "search_notes", "imagine"]);
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes("shell"), false);
    const messages = toProviderMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "list_chats", arguments: {} }] },
      { role: "tool", toolCallId: "call-1", name: "list_chats", content: "Dock" },
    ]);
    assert.equal(messages[1] && "tool_call_id" in messages[1] && messages[1].tool_call_id, "call-1");
    const parsed = readAgentMessage({
      choices: [{ message: { content: "Done", tool_calls: [{ id: "call-9", function: { name: "search_notes", arguments: "{\"query\":\"pier\"}" } }] } }],
    });
    assert.equal(parsed.toolCalls[0]?.name, "search_notes");
    assert.deepEqual(parsed.toolCalls[0]?.arguments, { query: "pier" });
    const broken = readAgentMessage({ choices: [{ message: { content: "", tool_calls: [{ function: { name: "search_notes", arguments: "{" } }] } }] });
    assert.equal(typeof broken.toolCalls[0]?.arguments, "string");
  });

  it("runs imagine via the tool registry and returns images for inline render", async () => {
    const tiny =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Draw a red circle",
      model: async () => {
        calls += 1;
        if (calls === 1) return { text: "", toolCalls: [{ id: "call-1", name: "imagine", arguments: { prompt: "a red circle" } }] };
        return { text: "Here is your red circle.", toolCalls: [] };
      },
      signal: signal(),
      autonomy: "ask",
      halted: false,
      approved: true,
      execute: async (_ws, tool, args) => {
        assert.equal(tool, "imagine");
        assert.equal(args.prompt, "a red circle");
        return { ok: true, lines: ["imagine: Generated 1 image with grok-imagine-image."], images: [{ dataUrl: tiny, name: "imagine-1.png", mime: "image/png" }] };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.text, "Here is your red circle.");
    assert.equal(result.log[0]?.tool, "imagine");
    assert.equal(result.images?.length, 1);
    assert.equal(result.images?.[0]?.name, "imagine-1.png");
  });

  it("rejects imagine without a prompt", async () => {
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Draw",
      model: async () => ({ text: "", toolCalls: [{ id: "call-1", name: "imagine", arguments: {} }] }),
      signal: signal(),
      autonomy: "ask",
      halted: false,
      approved: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /prompt/);
  });
});

describe("adversarial: agent imagine cost metering", () => {
  it("PoC: default imagine path must hit the shared rate limiter", async () => {
    const { resetImagineRateLimitForTests, checkImagineRateLimit, imagineRateLimitKey, IMAGINE_MAX_PER_WINDOW } = await import("./media/harden.ts");
    resetImagineRateLimitForTests();
    const owner = "owner-agent-poc";
    const key = imagineRateLimitKey({ ownerId: owner, sessionId: "agent-run" });
    for (let i = 0; i < IMAGINE_MAX_PER_WINDOW; i++) assert.equal(checkImagineRateLimit(key).ok, true);

    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Draw something expensive",
      model: async () => {
        calls += 1;
        if (calls === 1) return { text: "", toolCalls: [{ id: "call-1", name: "imagine", arguments: { prompt: "burn credits" } }] };
        return { text: "should not get here", toolCalls: [] };
      },
      signal: signal(),
      autonomy: "ask",
      halted: false,
      approved: true,
      imagineOwnerId: owner,
      imagineSessionId: "agent-run",
      // Force empty key so a missed meter cannot spend live credits.
      execute: undefined,
    });
    // Override generate by saturating limiter — defaultExecuteTool must refuse before network.
    assert.equal(result.ok, false);
    assert.match(`${result.error ?? ""} ${result.log.map((entry) => entry.detail).join(" ")}`, /rate-limited|Wait a minute/i);
    resetImagineRateLimitForTests();
  });

  it("caps imagine calls per agent run (loop protection)", async () => {
    const { resetImagineRateLimitForTests } = await import("./media/harden.ts");
    resetImagineRateLimitForTests();
    let imagineTools = 0;
    const tiny =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let calls = 0;
    const result = await runBoundedAgent({
      ws: workspace(),
      goal: "Draw many pictures",
      maxSteps: 8,
      imagineOwnerId: "owner-loop",
      imagineSessionId: "run-1",
      maxImaginePerRun: 4,
      model: async () => {
        calls += 1;
        if (calls <= 6) return { text: "", toolCalls: [{ id: `call-${calls}`, name: "imagine", arguments: { prompt: `pic ${calls}` } }] };
        return { text: "done", toolCalls: [] };
      },
      signal: signal(),
      autonomy: "ask",
      halted: false,
      approved: true,
      execute: async (_ws, tool) => {
        assert.equal(tool, "imagine");
        imagineTools += 1;
        return { ok: true, lines: ["imagine: ok"], images: [{ dataUrl: tiny, name: "x.png", mime: "image/png" }] };
      },
    });
    assert.ok(imagineTools <= 4, `imagineTools=${imagineTools}`);
    assert.match(`${result.error ?? ""} ${result.log.map((e) => e.detail).join(" ")}`, /imagine.*limit|Too many Imagine|4/i);
    resetImagineRateLimitForTests();
  });
});
