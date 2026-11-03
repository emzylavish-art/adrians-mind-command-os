/**
 * Spend-cap race + accounting hardening (media-evolve-spend-race).
 * Zero live spend: every upstream call is an injected fetchImpl mock.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { editImagineImage, generateImagineImages } from "./imagine.ts";
import { checkImagineRateLimit, resetImagineRateLimitForTests, setImagineRateLimitStore } from "./harden.ts";
import { createFileRateLimitStore } from "./rate-limit-store.ts";
import {
  createFileSpendLedger,
  createMemorySpendLedger,
  getImagineDailyCap,
  resetImagineSpendLedgerForTests,
  setImagineSpendLedger,
  type ImagineSpendLedger,
} from "./spend-ledger.ts";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG = `data:image/png;base64,${TINY_PNG_B64}`;

function okResponse() {
  return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }], model: "grok-imagine-image" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fillTo(ledger: ImagineSpendLedger, owner: string, count: number) {
  for (let i = 0; i < count; i++) ledger.record({ ownerId: owner, model: "grok-imagine-image", n: 1 });
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "imagine-race-"));
  resetImagineRateLimitForTests();
  resetImagineSpendLedgerForTests();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetImagineRateLimitForTests();
  resetImagineSpendLedgerForTests();
});

for (const backend of ["memory", "file"] as const) {
  describe(`race: parallel generate at cap-1 (${backend} ledger)`, () => {
    it("8 concurrent generate calls produce exactly 1 upstream fetch", async () => {
      const ledger = backend === "memory" ? createMemorySpendLedger() : createFileSpendLedger(join(dir, "l.json"));
      setImagineSpendLedger(ledger);
      const owner = `race-${backend}`;
      const cap = getImagineDailyCap();
      fillTo(ledger, owner, cap - 1);
      let fetches = 0;
      const fetchImpl = async () => {
        fetches += 1;
        await new Promise((r) => setTimeout(r, 15));
        return okResponse();
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          generateImagineImages(
            { prompt: `race ${i}`, n: 1 },
            { apiKey: "test-key", fetchImpl, meter: { ownerId: owner, sessionId: `s${i}` } },
          ),
        ),
      );
      assert.equal(fetches, 1);
      assert.equal(results.filter((r) => r.ok).length, 1);
      for (const r of results.filter((x) => !x.ok)) {
        if (!r.ok) assert.equal(r.status, 429);
      }
      assert.equal(ledger.summary(owner).count, cap);
    });
  });
}

describe("race: parallel edit at cap-1", () => {
  it("4 concurrent edits produce exactly 1 upstream fetch", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "race-edit";
    fillTo(ledger, owner, getImagineDailyCap() - 1);
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      await new Promise((r) => setTimeout(r, 15));
      return okResponse();
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        editImagineImage(
          { prompt: `edit ${i}`, imageDataUrl: TINY_PNG },
          { apiKey: "test-key", fetchImpl, meter: { ownerId: owner, sessionId: `e${i}` } },
        ),
      ),
    );
    assert.equal(fetches, 1);
    assert.equal(results.filter((r) => r.ok).length, 1);
  });
});

describe("accounting: billed-but-failed requests stay counted", () => {
  it("upstream 200 with URL whose download fails is still charged", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "dl-fail";
    const result = await generateImagineImages(
      { prompt: "x", n: 1, responseFormat: "url" },
      {
        apiKey: "test-key",
        meter: { ownerId: owner },
        lookup: async () => ["8.8.8.8"],
        fetchImpl: async (url) => {
          if (url.includes("/images/")) {
            return new Response(JSON.stringify({ data: [{ url: "https://imgen.x.ai/a.png" }] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("nope", { status: 500 });
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(ledger.summary(owner).count, 1);
  });

  it("upstream 200 with SSRF-refused URL is still charged", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "ssrf-fail";
    const result = await generateImagineImages(
      { prompt: "x", n: 1, responseFormat: "url" },
      {
        apiKey: "test-key",
        meter: { ownerId: owner },
        lookup: async () => ["127.0.0.1"],
        fetchImpl: async () =>
          new Response(JSON.stringify({ data: [{ url: "https://evil.example/a.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    assert.equal(result.ok, false);
    assert.equal(ledger.summary(owner).count, 1);
  });

  it("upstream 200 with non-JSON body is still charged", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "bad-json";
    const result = await generateImagineImages(
      { prompt: "x" },
      { apiKey: "test-key", meter: { ownerId: owner }, fetchImpl: async () => new Response("<html>", { status: 200 }) },
    );
    assert.equal(result.ok, false);
    assert.equal(ledger.summary(owner).count, 1);
  });

  it("ambiguous network failure (timeout after send) keeps the charge", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "timeout";
    const result = await generateImagineImages(
      { prompt: "x" },
      {
        apiKey: "test-key",
        meter: { ownerId: owner },
        fetchImpl: async () => {
          throw new DOMException("The operation timed out.", "TimeoutError");
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(ledger.summary(owner).count, 1);
  });

  it("5xx keeps the charge (ambiguous)", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "5xx";
    await editImagineImage(
      { prompt: "x", imageDataUrl: TINY_PNG },
      {
        apiKey: "test-key",
        meter: { ownerId: owner },
        fetchImpl: async () => new Response(JSON.stringify({ error: "boom" }), { status: 502 }),
      },
    );
    assert.equal(ledger.summary(owner).count, 1);
  });
});

describe("accounting: definite non-billing failures are refunded", () => {
  for (const status of [400, 401, 429]) {
    it(`upstream ${status} refunds the reservation`, async () => {
      const ledger = createMemorySpendLedger();
      setImagineSpendLedger(ledger);
      const owner = `refund-${status}`;
      const result = await generateImagineImages(
        { prompt: "x" },
        {
          apiKey: "test-key",
          meter: { ownerId: owner },
          fetchImpl: async () => new Response(JSON.stringify({ error: "no" }), { status }),
        },
      );
      assert.equal(result.ok, false);
      assert.equal(ledger.summary(owner).count, 0);
    });
  }

  it("connection refused before send refunds the reservation", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "refused";
    await generateImagineImages(
      { prompt: "x" },
      {
        apiKey: "test-key",
        meter: { ownerId: owner },
        fetchImpl: async () => {
          throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
        },
      },
    );
    assert.equal(ledger.summary(owner).count, 0);
  });

  it("missing API key (never sent) refunds the reservation", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "nokey";
    const prev = process.env.XAI_API_KEY;
    const result = await generateImagineImages(
      { prompt: "x" },
      { apiKey: "", meter: { ownerId: owner }, fetchImpl: async () => okResponse() },
    );
    if (prev !== undefined) process.env.XAI_API_KEY = prev;
    if (!result.ok && result.status === 503) assert.equal(ledger.summary(owner).count, 0);
  });

  it("success settles exactly one charge (no double record)", async () => {
    const ledger = createMemorySpendLedger();
    setImagineSpendLedger(ledger);
    const owner = "settle";
    const result = await generateImagineImages(
      { prompt: "x", n: 1 },
      { apiKey: "test-key", meter: { ownerId: owner }, fetchImpl: async () => okResponse() },
    );
    assert.equal(result.ok, true);
    assert.equal(ledger.summary(owner).count, 1);
  });
});

describe("file ledger: corrupt file fails closed", () => {
  it("corrupt JSON refuses generation, reports 0 remaining, and is not overwritten", async () => {
    const file = join(dir, "corrupt.json");
    writeFileSync(file, "{\"events\":[{\"ownerId\":\"o\",", "utf8");
    const ledger = createFileSpendLedger(file);
    setImagineSpendLedger(ledger);
    let fetches = 0;
    const result = await generateImagineImages(
      { prompt: "x" },
      {
        apiKey: "test-key",
        meter: { ownerId: "o" },
        fetchImpl: async () => {
          fetches += 1;
          return okResponse();
        },
      },
    );
    assert.equal(fetches, 0);
    assert.equal(result.ok, false);
    const summary = ledger.summary("o");
    assert.equal(summary.remaining, 0);
    assert.throws(() => ledger.record({ ownerId: "o", model: "grok-imagine-image", n: 1 }));
    assert.equal(readFileSync(file, "utf8"), "{\"events\":[{\"ownerId\":\"o\",");
  });

  it("wrong shape (events not an array) also fails closed", () => {
    const file = join(dir, "shape.json");
    writeFileSync(file, JSON.stringify({ events: "nope" }), "utf8");
    const ledger = createFileSpendLedger(file);
    assert.equal(ledger.summary("o").remaining, 0);
    assert.equal(ledger.reserve({ ownerId: "o", model: "grok-imagine-image", n: 1 }).ok, false);
  });
});

describe("file ledger: atomic write + cross-instance consistency", () => {
  it("writes via temp file + rename (inode changes, no temp left behind)", () => {
    const file = join(dir, "atomic.json");
    const ledger = createFileSpendLedger(file);
    ledger.record({ ownerId: "a", model: "grok-imagine-image", n: 1 });
    // Hold the old inode open so it cannot be recycled; an in-place write would keep it.
    const fd = openSync(file, "r");
    ledger.record({ ownerId: "a", model: "grok-imagine-image", n: 1 });
    assert.notEqual(fstatSync(fd).ino, statSync(file).ino);
    closeSync(fd);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock")), []);
    assert.equal(ledger.summary("a").count, 2);
  });

  it("two ledger instances on one path (two processes) cannot both reserve the last slot", () => {
    const file = join(dir, "shared.json");
    const a = createFileSpendLedger(file);
    const b = createFileSpendLedger(file);
    fillTo(a, "o", getImagineDailyCap() - 1);
    assert.equal(a.reserve({ ownerId: "o", model: "grok-imagine-image", n: 1 }).ok, true);
    assert.equal(b.reserve({ ownerId: "o", model: "grok-imagine-image", n: 1 }).ok, false);
  });

  it("a held cross-process lock makes reserve fail closed; a stale lock is broken", () => {
    const file = join(dir, "locked.json");
    const ledger = createFileSpendLedger(file, { lockTimeoutMs: 50, staleLockMs: 5_000 });
    writeFileSync(`${file}.lock`, "other-pid", "utf8");
    assert.equal(ledger.reserve({ ownerId: "o", model: "grok-imagine-image", n: 1 }).ok, false);
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${file}.lock`, old, old);
    assert.equal(ledger.reserve({ ownerId: "o", model: "grok-imagine-image", n: 1 }).ok, true);
  });
});

describe("rate-limit file store", () => {
  it("corrupt rate-limit file denies instead of resetting the window", () => {
    const file = join(dir, "rl.json");
    writeFileSync(file, "{broken", "utf8");
    setImagineRateLimitStore(createFileRateLimitStore(file));
    assert.equal(checkImagineRateLimit("imagine:o:s").ok, false);
    assert.equal(readFileSync(file, "utf8"), "{broken");
  });

  it("writes atomically and two stores on one path share the window", () => {
    const file = join(dir, "rl2.json");
    const a = createFileRateLimitStore(file);
    const b = createFileRateLimitStore(file);
    setImagineRateLimitStore(a);
    for (let i = 0; i < 4; i++) assert.equal(checkImagineRateLimit("imagine:o:s").ok, true);
    const fd = openSync(file, "r");
    setImagineRateLimitStore(b);
    for (let i = 0; i < 4; i++) assert.equal(checkImagineRateLimit("imagine:o:s").ok, true);
    assert.notEqual(fstatSync(fd).ino, statSync(file).ino);
    closeSync(fd);
    assert.equal(checkImagineRateLimit("imagine:o:s").ok, false);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock")), []);
  });
});
