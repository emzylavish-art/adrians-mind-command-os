import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyXaiInferenceSecrets,
  callXaiChat,
  readXaiApiKey,
  readXaiInferenceSecretsFile,
  resolveXaiInferenceApiKey,
} from "./xai-adapter.ts";

/** Well-formed fake inference key (shape only; never a real secret). */
const FAKE_INFERENCE = "xai-testinvalidkey00000000000001";

describe("xai adapter", () => {
  it("returns unavailable missing_key with no fabricated reply when XAI_API_KEY is unset", async () => {
    const keyed = readXaiApiKey({});
    assert.equal(keyed.ok, false);
    if (keyed.ok) return;
    assert.equal(keyed.state, "unavailable");
    assert.equal(keyed.reason, "missing_key");
    assert.equal(keyed.text, "");
    assert.match(keyed.error, /unavailable|missing/i);

    let called = false;
    const result = await callXaiChat({
      prompt: "Reply with exactly: VERIFY-OK",
      env: {},
      skipSecretsFile: true,
      fetchImpl: async () => {
        called = true;
        return new Response(JSON.stringify({ choices: [{ message: { content: "fabricated" } }] }), { status: 200 });
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.state, "unavailable");
    if (!result.ok) assert.equal(result.reason, "missing_key");
    assert.equal(result.text, "");
  });

  it("reports invalid_key without inventing text when xAI rejects the key", async () => {
    const result = await callXaiChat({
      prompt: "Reply with exactly: VERIFY-OK",
      env: { XAI_API_KEY: FAKE_INFERENCE },
      skipSecretsFile: true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: "invalid-argument", error: "Incorrect API key provided." }), {
          status: 400,
          headers: { "x-request-id": "req-test" },
        }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "unavailable");
    if (!result.ok) assert.equal(result.reason, "invalid_key");
    assert.equal(result.text, "");
    assert.equal(result.status, 400);
    assert.doesNotMatch(result.error, /xai-testinvalidkey/);
  });

  it("refuses process env that holds the management key when no secrets file is present", () => {
    const env: Record<string, string | undefined> = {
      XAI_API_KEY: "xai-management-same-key-000001",
      XAI_MANAGEMENT_KEY: "xai-management-same-key-000001",
    };
    const missingPath = join(tmpdir(), `xai-absent-${Date.now()}.env`);
    const resolved = resolveXaiInferenceApiKey(env, missingPath);
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.state, "unavailable");
    assert.equal(resolved.reason, "misconfigured_management_key");
    assert.match(resolved.error, /misconfigured: management key/i);
    assert.equal(resolved.text, "");
  });

  it("prefers the inference secrets file over a process env that holds the management key", () => {
    const dir = mkdtempSync(join(tmpdir(), "xai-sec-"));
    const path = join(dir, "xai_inference.env");
    try {
      writeFileSync(path, `export XAI_API_KEY=${FAKE_INFERENCE}\n`);
      const env: Record<string, string | undefined> = {
        XAI_API_KEY: "xai-management-same-key-000001",
        XAI_MANAGEMENT_KEY: "xai-management-same-key-000001",
      };
      const resolved = resolveXaiInferenceApiKey(env, path);
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.key, FAKE_INFERENCE);
      assert.equal(env.XAI_API_KEY, FAKE_INFERENCE);
      assert.notEqual(resolved.key, env.XAI_MANAGEMENT_KEY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("xai secrets file", () => {
  it("loads export XAI_API_KEY from a secrets file into env", () => {
    const dir = mkdtempSync(join(tmpdir(), "xai-sec-"));
    const path = join(dir, "xai_inference.env");
    try {
      writeFileSync(path, `export XAI_API_KEY=${FAKE_INFERENCE}\n`);
      const env: Record<string, string | undefined> = {};
      assert.equal(applyXaiInferenceSecrets(env, path), true);
      assert.equal(env.XAI_API_KEY, FAKE_INFERENCE);
      assert.equal(readXaiInferenceSecretsFile(path), FAKE_INFERENCE);
      assert.equal(readXaiApiKey(env).ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not invent a key when the secrets file is absent", () => {
    const env: Record<string, string | undefined> = {};
    assert.equal(applyXaiInferenceSecrets(env, join(tmpdir(), "missing-xai-inference.env")), false);
    assert.equal(readXaiApiKey(env).ok, false);
  });
});
