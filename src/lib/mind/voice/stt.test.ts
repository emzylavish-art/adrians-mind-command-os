import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STT_MODEL, STT_URL, transcribeWavBytes } from "./stt.ts";

describe("stt", () => {
  it("refuses without a key or bytes", async () => {
    const noKey = await transcribeWavBytes({ bytes: new Uint8Array([1]), apiKey: "" });
    assert.equal(noKey.ok, false);
    const empty = await transcribeWavBytes({ bytes: new Uint8Array(), apiKey: "k" });
    assert.equal(empty.ok, false);
  });

  it("posts multipart audio to /v1/stt and returns text", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenModel = "";
    const result = await transcribeWavBytes({
      bytes: new Uint8Array([1, 2, 3, 4]),
      apiKey: "test-key",
      mime: "audio/webm",
      filename: "clip.webm",
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        const headers = init?.headers as Record<string, string>;
        seenAuth = headers.Authorization;
        const body = init?.body as FormData;
        seenModel = String(body.get("model"));
        return new Response(JSON.stringify({ text: " hello world ", duration: 1.2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(seenUrl, STT_URL);
    assert.equal(seenAuth, "Bearer test-key");
    assert.equal(seenModel, STT_MODEL);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.text, "hello world");
      assert.equal(result.duration, 1.2);
    }
  });


  it("falls back unsafe mime and sanitises path filenames before upload", async () => {
    let seenName = "";
    let seenType = "";
    await transcribeWavBytes({
      bytes: new Uint8Array([1, 2, 3, 4]),
      apiKey: "test-key",
      mime: "text/html",
      filename: "../../etc/passwd",
      fetchImpl: async (_url, init) => {
        const body = init?.body as FormData;
        const file = body.get("file") as File;
        seenName = file.name;
        seenType = file.type;
        return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
      },
    });
    assert.equal(seenType, "audio/wav");
    assert.equal(seenName.includes("/"), false);
    assert.equal(seenName.includes(".."), false);
  });
});
