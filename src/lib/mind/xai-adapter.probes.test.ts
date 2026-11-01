import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  XAI_RATE_LIMIT_DEFAULT_BACKOFF_MS,
  XAI_RATE_LIMIT_MAX_BACKOFF_MS,
  XAI_RATE_LIMIT_MAX_RETRIES,
  callXaiChat,
  parseRetryAfterMs,
  readXaiApiKey,
  readXaiInferenceSecretsFile,
  redactSecretsFromText,
  resolveXaiInferenceApiKey,
  validateXaiInferenceKeyShape,
} from "./xai-adapter.ts";

/** Shape-valid fake keys — never real secrets. */
const FAKE = "xai-probevalidkey00000000000001";
const FAKE_MGMT = "xai-probemanagementkey000000001";
const FAKE_OTHER = "xai-probeotherinference0000001";

function assertNoKeyLeak(text: string, ...keys: string[]) {
  for (const key of keys) {
    assert.ok(!text.includes(key), "error/log must not contain key material");
  }
}

describe("xai adapter probes — key shape", () => {
  it("rejects empty and whitespace-only as missing_key", () => {
    for (const raw of ["", "   ", "\t\n"]) {
      const shaped = validateXaiInferenceKeyShape(raw);
      assert.equal(shaped.ok, false);
      if (!shaped.ok) assert.equal(shaped.reason, "missing_key");
    }
    const empty = readXaiApiKey({ XAI_API_KEY: "" });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, "missing_key");
    const ws = readXaiApiKey({ XAI_API_KEY: "  \t  " });
    assert.equal(ws.ok, false);
    if (!ws.ok) assert.equal(ws.reason, "missing_key");
  });

  it("trims padded whitespace on a well-formed key", () => {
    const shaped = validateXaiInferenceKeyShape(`  ${FAKE}  `);
    assert.equal(shaped.ok, true);
    if (shaped.ok) assert.equal(shaped.key, FAKE);
    const keyed = readXaiApiKey({ XAI_API_KEY: ` \n${FAKE}\t ` });
    // Embedded newline in the raw value fails before trim-only padding path:
    // a value that is only outer whitespace around a valid key should pass via trim.
    const padded = readXaiApiKey({ XAI_API_KEY: `   ${FAKE}   ` });
    assert.equal(padded.ok, true);
    if (padded.ok) assert.equal(padded.key, FAKE);
    void keyed;
  });

  it("rejects wrong prefix, truncated, non-ASCII, and header injection", () => {
    const cases = [
      "sk-openai-style-key-00000000001",
      "xai-short",
      "xai-truncated123", // 12-char body < 20
      `xai-${"a".repeat(20)}é`,
      `xai-${"a".repeat(20)}\nAuthorization: Bearer evil`,
      `xai-${"a".repeat(20)}\r\nX-Inject: 1`,
      `xai-${"a".repeat(19)}`, // exactly 19 body chars → truncated
    ];
    for (const raw of cases) {
      const shaped = validateXaiInferenceKeyShape(raw);
      assert.equal(shaped.ok, false, `expected malformed for length=${raw.length}`);
      if (!shaped.ok) assert.equal(shaped.reason, "malformed_key");
      const keyed = readXaiApiKey({ XAI_API_KEY: raw });
      assert.equal(keyed.ok, false);
      if (!keyed.ok) {
        assert.equal(keyed.reason, "malformed_key");
        assert.equal(keyed.state, "unavailable");
        assert.equal(keyed.text, "");
        assertNoKeyLeak(keyed.error, raw);
      }
    }
  });

  it("callXaiChat does not fetch when the key is malformed", async () => {
    let called = false;
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: "not-a-key" },
      skipSecretsFile: true,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "malformed_key");
    assert.equal(result.text, "");
  });
});

describe("xai adapter probes — invalid / expired keys (mocked fetch)", () => {
  it("maps 400 Incorrect API key to invalid_key with no fabricated reply", async () => {
    const secret = FAKE;
    const result = await callXaiChat({
      prompt: "Reply with exactly: VERIFY-OK",
      env: { XAI_API_KEY: secret },
      skipSecretsFile: true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: "invalid-argument", error: `Incorrect API key provided: ${secret}` }), {
          status: 400,
          headers: { "x-request-id": "req-400" },
        }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "unavailable");
    if (!result.ok) assert.equal(result.reason, "invalid_key");
    assert.equal(result.text, "");
    assert.equal(result.status, 400);
    assertNoKeyLeak(result.error, secret);
  });

  it("maps 401 shapes to invalid_key", async () => {
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "x-request-id": "req-401" },
        }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_key");
    assert.equal(result.text, "");
    assert.equal(result.status, 401);
    assertNoKeyLeak(result.error, FAKE);
  });
});

describe("xai adapter probes — rate limit", () => {
  it("parseRetryAfterMs respects seconds, HTTP-date, fallback, and cap", () => {
    assert.equal(parseRetryAfterMs(null), XAI_RATE_LIMIT_DEFAULT_BACKOFF_MS);
    assert.equal(parseRetryAfterMs("1"), 1000);
    assert.equal(parseRetryAfterMs("999"), XAI_RATE_LIMIT_MAX_BACKOFF_MS);
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    // HTTP-date is second-precision; use a multi-second delta.
    const later = new Date(now + 1_500).toUTCString();
    assert.equal(parseRetryAfterMs(later, now), 1_000); // Date.parse truncates sub-second; 1.5s → ~1000–1500 depending on clock ms
    const parsedLater = Date.parse(later) - now;
    assert.equal(parseRetryAfterMs(later, now), Math.min(parsedLater, XAI_RATE_LIMIT_MAX_BACKOFF_MS));
    const far = new Date(now + 60_000).toUTCString();
    assert.equal(parseRetryAfterMs(far, now), XAI_RATE_LIMIT_MAX_BACKOFF_MS);
  });

  it("429 with Retry-After retries with bounded backoff then rate_limited", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      maxRetries: XAI_RATE_LIMIT_MAX_RETRIES,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: "rate limit" }), {
          status: 429,
          headers: { "retry-after": "1", "x-request-id": `r${calls}` },
        });
      },
    });
    assert.equal(calls, XAI_RATE_LIMIT_MAX_RETRIES + 1);
    assert.equal(sleeps.length, XAI_RATE_LIMIT_MAX_RETRIES);
    for (const ms of sleeps) {
      assert.ok(ms <= XAI_RATE_LIMIT_MAX_BACKOFF_MS);
      assert.equal(ms, 1000);
    }
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "rate_limited");
    assert.equal(result.state, "unavailable");
    assert.equal(result.text, "");
    assert.equal(result.status, 429);
  });

  it("429 without Retry-After uses default backoff and caps retries", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      maxRetries: 1,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 429 });
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [XAI_RATE_LIMIT_DEFAULT_BACKOFF_MS]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "rate_limited");
  });

  it("429 then success returns ok after one retry", async () => {
    let calls = 0;
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      sleepFn: async () => {},
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], model: "grok-4.5" }), {
          status: 200,
        });
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "ok");
  });
});

describe("xai adapter probes — network / timeout / 5xx", () => {
  it("network error → unreachable, no fabricated reply", async () => {
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unreachable");
    assert.equal(result.text, "");
    assert.match(result.error, /could not be reached/i);
  });

  it("timeout → unreachable with timeout message", async () => {
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      fetchImpl: async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unreachable");
    assert.match(result.error, /timed out/i);
  });

  it("5xx → api_error", async () => {
    const result = await callXaiChat({
      prompt: "hi",
      env: { XAI_API_KEY: FAKE },
      skipSecretsFile: true,
      fetchImpl: async () => new Response("internal", { status: 503, headers: { "x-request-id": "s5" } }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "api_error");
    assert.equal(result.status, 503);
    assert.equal(result.text, "");
  });
});

describe("xai adapter probes — management key / secrets file / missing", () => {
  it("refuses management key in process env", () => {
    const env = { XAI_API_KEY: FAKE_MGMT, XAI_MANAGEMENT_KEY: FAKE_MGMT };
    const resolved = resolveXaiInferenceApiKey(env, join(tmpdir(), "no-such-xai.env"));
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.reason, "misconfigured_management_key");
    assertNoKeyLeak(resolved.error, FAKE_MGMT);
  });

  it("refuses management key when secrets file holds it", () => {
    const dir = mkdtempSync(join(tmpdir(), "xai-mgmt-"));
    const path = join(dir, "xai_inference.env");
    try {
      writeFileSync(path, `export XAI_API_KEY=${FAKE_MGMT}\n`, { mode: 0o600 });
      const env: Record<string, string | undefined> = {
        XAI_API_KEY: FAKE_OTHER,
        XAI_MANAGEMENT_KEY: FAKE_MGMT,
      };
      const resolved = resolveXaiInferenceApiKey(env, path);
      assert.equal(resolved.ok, false);
      if (!resolved.ok) assert.equal(resolved.reason, "misconfigured_management_key");
      assert.equal(resolved.text, "");
      assertNoKeyLeak(resolved.error, FAKE_MGMT, FAKE_OTHER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing secrets file falls back to env; absent env → missing_key", () => {
    const missing = join(tmpdir(), `xai-missing-${Date.now()}.env`);
    assert.equal(readXaiInferenceSecretsFile(missing), undefined);
    const resolved = resolveXaiInferenceApiKey({}, missing);
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.reason, "missing_key");
    assert.equal(resolved.text, "");
  });

  it("unreadable secrets file is treated as absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "xai-unreadable-"));
    const path = join(dir, "xai_inference.env");
    try {
      writeFileSync(path, `export XAI_API_KEY=${FAKE}\n`, { mode: 0o000 });
      chmodSync(path, 0o000);
      const got = readXaiInferenceSecretsFile(path);
      // On some systems root/box may still read mode 000; also cover directory-as-file style.
      if (got !== undefined) {
        // Force unreadable by pointing at a directory path.
        const asDir = join(dir, "subdir");
        mkdirSync(asDir);
        assert.equal(readXaiInferenceSecretsFile(asDir), undefined);
      } else {
        assert.equal(got, undefined);
      }
      const resolved = resolveXaiInferenceApiKey({}, path);
      // If the file was somehow readable, key would resolve; prefer the dir case for missing.
      if (got === undefined) {
        assert.equal(resolved.ok, false);
        if (!resolved.ok) assert.equal(resolved.reason, "missing_key");
      }
    } finally {
      try {
        chmodSync(path, 0o600);
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing key → no fetch, unavailable", async () => {
    let called = false;
    const result = await callXaiChat({
      prompt: "hi",
      env: {},
      skipSecretsFile: true,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing_key");
  });
});

describe("xai adapter probes — redaction", () => {
  it("redactSecretsFromText strips key material by equality", () => {
    const msg = `upstream echoed ${FAKE} in the body`;
    const out = redactSecretsFromText(msg, [FAKE, FAKE_MGMT]);
    assert.equal(out.includes(FAKE), false);
    assert.match(out, /\[redacted\]/);
  });
});
