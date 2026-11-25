import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeImage } from "./image-analyze.ts";

const imageBase64 = Buffer.concat([Buffer.from("ffd8ff", "hex"), Buffer.alloc(97)]).toString("base64");

describe("image analysis", () => {
  it("does not call a provider when no vision key is set", async () => {
    let called = false;
    const result = await analyzeImage({
      name: "dock.png",
      bytes: 100,
      imageBase64,
      visionKey: undefined,
      fetch: async () => {
        called = true;
        return { ok: true, status: 200, text: async () => "a lake" };
      },
    });
    assert.equal(called, false);
    assert.equal(result.analyzed, false);
    assert.match(result.error, /Nothing was analyzed/);
  });

  it("returns only the provider text and does not invent a reply on failure", async () => {
    const ok = await analyzeImage({
      name: "dock.png",
      bytes: 100,
      imageBase64,
      visionKey: "vision-key",
      fetch: async (url, init) => {
        assert.match(url, /openai/);
        assert.match(JSON.stringify(init?.headers), /vision-key/);
        assert.match(String(init?.body), /image\/jpeg/);
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "A dock." } }] }) };
      },
    });
    assert.equal(ok.analyzed, true);
    assert.equal(ok.text, "A dock.");
    const failed = await analyzeImage({
      name: "dock.png",
      bytes: 100,
      imageBase64,
      visionKey: "vision-key",
      fetch: async () => ({ ok: false, status: 401, text: async () => "" }),
    });
    assert.equal(failed.analyzed, false);
    assert.equal(failed.text, "");
    assert.match(failed.error, /Nothing was invented/);
  });
});
