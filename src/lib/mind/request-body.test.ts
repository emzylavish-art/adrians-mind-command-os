import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MIND_BODY_UNREADABLE, parseModelTierField, readJsonObjectBody } from "./request-body.ts";

const LIMIT = 1_000;

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://local.test/api/mind/turn", { method: "POST", body, headers });
}

describe("readJsonObjectBody (shared body guard)", () => {
  const bad: [string, BodyInit | null][] = [
    ["literal null", "null"],
    ["array", "[]"],
    ["string", '"str"'],
    ["number", "42"],
    ["boolean", "true"],
    ["invalid JSON", "{nope"],
    ["empty body", ""],
    ["no body", null],
    ["whitespace body", "   \n "],
  ];
  for (const [label, body] of bad) {
    it(`rejects ${label} with an honest 400`, async () => {
      const read = await readJsonObjectBody(post(body), LIMIT);
      assert.equal(read.ok, false);
      if (read.ok) return;
      assert.equal(read.status, 400);
      assert.equal(read.error, MIND_BODY_UNREADABLE);
    });
  }

  it("accepts {} and returns a plain object", async () => {
    const read = await readJsonObjectBody(post("{}"), LIMIT);
    assert.equal(read.ok, true);
    if (read.ok) assert.deepEqual(read.body, {});
  });

  it("rejects an oversized body with 413 without buffering past the limit", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 50) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(400).fill(0x20));
      },
    });
    const request = new Request("http://local.test/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const read = await readJsonObjectBody(request, LIMIT);
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.status, 413);
    assert.ok(pulled < 10, `reader stopped early (pulled ${pulled})`);
  });

  it("rejects an oversized declared content-length before reading", async () => {
    const read = await readJsonObjectBody(post("{}", { "content-length": String(LIMIT * 10) }), LIMIT);
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.status, 413);
  });

  it("counts bytes, not UTF-16 characters (multi-byte text cannot sneak past)", async () => {
    const text = JSON.stringify({ text: "€".repeat(400) }); // ~1200 bytes, ~410 chars
    assert.ok(text.length < LIMIT);
    const read = await readJsonObjectBody(post(text), LIMIT);
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.status, 413);
  });

  it("rejects invalid UTF-8 instead of silently replacing bytes", async () => {
    const read = await readJsonObjectBody(post(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])), LIMIT);
    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.status, 400);
      assert.equal(read.error, MIND_BODY_UNREADABLE);
    }
  });

  it("rejects __proto__ instead of accepting a stripped body", async () => {
    const read = await readJsonObjectBody(post('{"__proto__":{"polluted":true},"text":"hi"}'), LIMIT);
    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.status, 400);
      assert.equal(read.error, MIND_BODY_UNREADABLE);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

describe("parseModelTierField", () => {
  it("treats missing / null / empty as Auto", () => {
    for (const value of [undefined, null, ""]) {
      const parsed = parseModelTierField(value);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.tier, "Auto");
    }
  });

  it("accepts each known tier exactly", () => {
    for (const tier of ["Auto", "Fast", "Expert", "Heavy", "Build"]) {
      const parsed = parseModelTierField(tier);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.tier, tier);
    }
  });

  for (const value of ["__proto__", "constructor", "toString", "hasOwnProperty", "fast", "Ultra", " Fast", 1, {}, [], true]) {
    it(`rejects ${JSON.stringify(value)} instead of silently mapping it`, () => {
      const parsed = parseModelTierField(value);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.match(parsed.error, /Unknown model tier/);
    });
  }

  it("never echoes a huge or control-character tier back verbatim", () => {
    const parsed = parseModelTierField(`x\n${"A".repeat(5000)}`);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.error.length < 200);
      assert.equal(parsed.error.includes("\n"), false);
    }
  });
});

describe("handlers use the shared guard (no raw JSON.parse of request bodies)", () => {
  for (const file of ["turn.server.ts", "agent-run.server.ts"]) {
    it(`${file} routes body + modelTier through request-body.ts`, () => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      assert.match(source, /readJsonObjectBody\(/);
      assert.match(source, /parseModelTierField\(/);
      assert.equal(/JSON\.parse\(/.test(source), false, "raw JSON.parse would let null/[] bodies reach property access");
      assert.equal(/request\.text\(\)/.test(source), false, "unbounded request.text() buffers huge bodies");
    });
  }
});


describe("prototype-pollution keys are rejected (not stripped)", () => {
  for (const [label, body] of [
    ["top-level __proto__ with valid fields", '{"text":"hi","memory":"off","__proto__":{"x":1}}'],
    ["top-level constructor", '{"text":"hi","constructor":{"prototype":{"x":1}}}'],
    ["top-level prototype", '{"text":"hi","prototype":{"x":1}}'],
    ["nested __proto__", '{"text":"hi","nested":{"__proto__":{"polluted":true}}}'],
    ["nested constructor", '{"text":"hi","a":{"b":{"constructor":{"x":1}}}}'],
    ["forbidden-key-only __proto__", '{"__proto__":{}}'],
    ["forbidden-key-only constructor", '{"constructor":{"prototype":{}}}'],
  ] as const) {
    it(`rejects ${label} with 400 unreadable`, async () => {
      const read = await readJsonObjectBody(post(body), LIMIT);
      assert.equal(read.ok, false);
      if (!read.ok) {
        assert.equal(read.status, 400);
        assert.equal(read.error, MIND_BODY_UNREADABLE);
      }
      assert.equal(({} as Record<string, unknown>).polluted, undefined);
      assert.equal(({} as Record<string, unknown>).x, undefined);
    });
  }

  it("treats Unicode lookalike keys as ordinary unknown keys (accepted, not pollution)", async () => {
    // Fullwidth underscore lookalike — not the real __proto__ key.
    const lookalike = '{"text":"hi","＿＿proto＿＿":{"x":1}}';
    const read = await readJsonObjectBody(post(lookalike), LIMIT);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.body.text, "hi");
      assert.equal(({} as Record<string, unknown>).x, undefined);
    }
  });
});
