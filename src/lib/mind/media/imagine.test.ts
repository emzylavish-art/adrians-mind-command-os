import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateImagineImages,
  GROK_IMAGINE_MODEL,
  normalizeImaginePrompt,
  parseImagineCommand,
} from "./imagine.ts";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("imagine prompt helpers", () => {
  it("normalizes and rejects empty prompts", () => {
    assert.equal(normalizeImaginePrompt("  a red cube  ").ok, true);
    assert.equal(normalizeImaginePrompt("").ok, false);
    assert.equal(normalizeImaginePrompt("   ").ok, false);
  });

  it("parses /imagine commands", () => {
    assert.equal(parseImagineCommand("/imagine a lighthouse"), "a lighthouse");
    assert.equal(parseImagineCommand("/IMAGINE blue sky"), "blue sky");
    assert.equal(parseImagineCommand("imagine a cat"), null);
    assert.equal(parseImagineCommand("/imagine"), "");
  });
});

describe("generateImagineImages", () => {
  it("returns missing-key honestly when no key is provided", async () => {
    const result = await generateImagineImages(
      { prompt: "a red circle" },
      {
        apiKey: "",
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /API key/i);
  });

  it("maps b64_json responses into persistent data URLs", async () => {
    const result = await generateImagineImages(
      { prompt: "tiny", n: 1 },
      {
        apiKey: "test-key",
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string; response_format?: string };
          assert.equal(body.model, GROK_IMAGINE_MODEL);
          assert.equal(body.response_format, "b64_json");
          return new Response(
            JSON.stringify({
              data: [{ b64_json: TINY_PNG_B64, mime_type: "image/png" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.model, GROK_IMAGINE_MODEL);
      assert.equal(result.images.length, 1);
      assert.match(result.images[0]!.dataUrl, /^data:image\/png;base64,/);
    }
  });

  it("downloads URL responses into data URLs", async () => {
    const png = Buffer.from(TINY_PNG_B64, "base64");
    const result = await generateImagineImages(
      { prompt: "via url", responseFormat: "url" },
      {
        apiKey: "test-key",
        fetchImpl: async (url) => {
          if (String(url).includes("images/generations")) {
            return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/gen.png" }] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.images[0]!.dataUrl, /^data:image\/png;base64,/);
      assert.equal(result.images[0]!.sourceUrl, "https://cdn.example/gen.png");
    }
  });

  it("surfaces API errors without inventing images", async () => {
    const result = await generateImagineImages(
      { prompt: "denied" },
      {
        apiKey: "test-key",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "Access to the image endpoint is denied." }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.match(result.error, /denied/i);
    }
  });
});

describe("editImagineImage", () => {
  it("posts image_url JSON to the edits endpoint and maps b64", async () => {
    const { editImagineImage, XAI_IMAGES_EDITS_URL } = await import("./imagine.ts");
    const tiny =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const input = `data:image/png;base64,${tiny}`;
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const result = await editImagineImage(
      { prompt: "make it blue", imageDataUrl: input },
      {
        apiKey: "test-key",
        fetchImpl: async (url, init) => {
          seenUrl = String(url);
          seenBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(JSON.stringify({ data: [{ b64_json: tiny, mime_type: "image/png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    assert.equal(seenUrl, XAI_IMAGES_EDITS_URL);
    assert.equal(seenBody.image_url, input);
    assert.equal(seenBody.response_format, "b64_json");
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.images[0]!.dataUrl, /^data:image\/png;base64,/);
  });

  it("rejects edits without an image data URL", async () => {
    const { editImagineImage } = await import("./imagine.ts");
    const result = await editImagineImage(
      { prompt: "blue", imageDataUrl: "https://example.com/a.png" },
      { apiKey: "test-key", fetchImpl: async () => new Response("{}") },
    );
    assert.equal(result.ok, false);
  });
});
