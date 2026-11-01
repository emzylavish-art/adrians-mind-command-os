import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveImagineModel, GROK_IMAGINE_MODEL, GROK_IMAGINE_QUALITY_MODEL } from "./imagine-shared.ts";
import { editImagineImage, generateImagineImages } from "./imagine.ts";
import { IMAGINE_MAX_N, mapImagineHttpError, resetImagineRateLimitForTests, checkImagineRateLimit, imagineRateLimitKey } from "./harden.ts";
import { resolveXaiInferenceApiKey } from "./xai-key.ts";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("H4: model allowlist + n clamp + rate limit keys", () => {
  it("collapses arbitrary model ids to the allowlist", () => {
    assert.equal(resolveImagineModel("grok-imagine-image-pro-ultra"), GROK_IMAGINE_MODEL);
    assert.equal(resolveImagineModel(GROK_IMAGINE_QUALITY_MODEL), GROK_IMAGINE_QUALITY_MODEL);
    assert.equal(resolveImagineModel("gpt-image-1"), GROK_IMAGINE_MODEL);
  });

  it("clamps n to IMAGINE_MAX_N", async () => {
    let seenN: unknown;
    await generateImagineImages(
      { prompt: "x", n: 99 },
      {
        skipSpendControls: true,
        apiKey: "k",
        fetchImpl: async (_url, init) => {
          seenN = JSON.parse(String(init?.body)).n;
          return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG.split(",")[1] }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    assert.equal(seenN, IMAGINE_MAX_N);
  });

  it("rate-limits per owner+session key", () => {
    resetImagineRateLimitForTests();
    const a = imagineRateLimitKey({ ownerId: "o1", sessionId: "s1" });
    const b = imagineRateLimitKey({ ownerId: "o1", sessionId: "s2" });
    for (let i = 0; i < 8; i++) assert.equal(checkImagineRateLimit(a).ok, true);
    assert.equal(checkImagineRateLimit(a).ok, false);
    assert.equal(checkImagineRateLimit(b).ok, true);
    resetImagineRateLimitForTests();
  });
});

describe("H5: edit image size cap", () => {
  it("rejects oversized edit data URLs with 413", async () => {
    const huge = `data:image/png;base64,${"a".repeat(2_000_000)}`;
    const result = await editImagineImage({ prompt: "x", imageDataUrl: huge }, { skipSpendControls: true, apiKey: "k" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 413);
      assert.match(result.error, /too large/i);
    }
  });
});

describe("H6: client errors are 400 and provider text is sanitized", () => {
  it("returns status 400 when edit has no image", async () => {
    const result = await editImagineImage({ prompt: "x" }, { skipSpendControls: true, apiKey: "k" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.match(result.error, /image/i);
    }
  });

  it("mapImagineHttpError never echoes raw upstream text", () => {
    const mapped = mapImagineHttpError(500, "internal stack trace secret_token=abc");
    assert.equal(mapped.includes("secret_token"), false);
    assert.equal(mapped.includes("stack"), false);
    assert.match(mapped, /failed/i);
  });
});

describe("H7: xai-key does not mutate process.env", () => {
  it("returns file key without writing env", () => {
    const dir = join(tmpdir(), `xai-key-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "xai.env");
    writeFileSync(file, "XAI_API_KEY=from-file-not-for-logging\n");
    const env: Record<string, string | undefined> = { XAI_API_KEY: "from-env-stale" };
    const before = env.XAI_API_KEY;
    const key = resolveXaiInferenceApiKey(env, file);
    assert.equal(key, "from-file-not-for-logging");
    assert.equal(env.XAI_API_KEY, before); // unchanged
    rmSync(dir, { recursive: true, force: true });
  });
});
