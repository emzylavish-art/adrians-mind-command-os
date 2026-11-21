import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptPolishedText, polishDictationWithXai, WHISPER_FLOW_LLM_REFINE_SYSTEM } from "./llm-refine.ts";

describe("whisper-flow llm refine", () => {
  it("accepts modest polish and rejects empty or huge expansions", () => {
    assert.equal(acceptPolishedText("hello there", "Hello there.").ok, true);
    assert.equal(acceptPolishedText("hello", "").ok, false);
    const huge = "x".repeat(500);
    assert.equal(acceptPolishedText("hi", huge).ok, false);
  });

  it("posts to xAI chat completions and returns polished text", async () => {
    let seenModel = "";
    const result = await polishDictationWithXai({
      text: "um hello there",
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}")) as {
          model?: string;
          messages?: Array<{ role: string; content: string }>;
        };
        seenModel = body.model || "";
        assert.equal(body.messages?.[0]?.content, WHISPER_FLOW_LLM_REFINE_SYSTEM);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Hello there." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "Hello there.");
    assert.match(seenModel, /grok/i);
  });

  it("honestly skips when the key is missing", async () => {
    const result = await polishDictationWithXai({ text: "hello", apiKey: "" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Local refinement was kept/);
  });
});
