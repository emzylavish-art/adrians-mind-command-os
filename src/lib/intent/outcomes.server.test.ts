import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertPatternOutcomes } from "./outcomes.server.ts";
import type { ValidatedOutcomeItem } from "./outcome-validate.ts";

const PATTERN = "11111111-1111-4111-8111-111111111111";
const MISSING = "22222222-2222-4222-8222-222222222222";

function item(partial: Partial<ValidatedOutcomeItem> & Pick<ValidatedOutcomeItem, "intentId" | "hit" | "observedAt">): ValidatedOutcomeItem {
  return {
    patternId: null,
    note: null,
    clientId: null,
    ...partial,
  };
}

describe("insertPatternOutcomes", () => {
  it("returns 503 when service role env is missing", async () => {
    const result = await insertPatternOutcomes(
      [item({ intentId: "a", hit: true, observedAt: new Date().toISOString(), patternId: PATTERN, clientId: "1" })],
      { env: {}, fetchImpl: async () => new Response("no", { status: 500 }) },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });

  it("acks and drops rows without patternId; inserts only known patterns", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.includes("/patterns?")) {
        return new Response(JSON.stringify([{ id: PATTERN }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/pattern_outcomes") && method === "POST") {
        return new Response(null, { status: 201 });
      }
      return new Response("nope", { status: 404 });
    };

    const result = await insertPatternOutcomes(
      [
        item({ intentId: "no-pat", hit: true, observedAt: "2026-11-01T00:00:00.000Z", clientId: "c0" }),
        item({
          intentId: "known",
          hit: true,
          observedAt: "2026-11-01T00:00:01.000Z",
          patternId: PATTERN,
          clientId: "c1",
        }),
        item({
          intentId: "unknown",
          hit: false,
          observedAt: "2026-11-01T00:00:02.000Z",
          patternId: MISSING,
          clientId: "c2",
        }),
      ],
      {
        env: {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.inserted, 1);
      assert.equal(result.droppedNoPattern, 1);
      assert.equal(result.droppedUnknownPattern, 1);
      assert.deepEqual(result.acknowledged, ["c0", "c1", "c2"]);
    }
    assert.equal(calls.some((c) => c.method === "POST" && c.url.includes("pattern_outcomes")), true);
    const post = calls.find((c) => c.method === "POST");
    assert.ok(post?.body);
    const payload = JSON.parse(post!.body!);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].pattern_id, PATTERN);
  });

  it("returns 503 quietly when patterns table is missing", async () => {
    const result = await insertPatternOutcomes(
      [
        item({
          intentId: "x",
          hit: true,
          observedAt: "2026-11-01T00:00:00.000Z",
          patternId: PATTERN,
          clientId: "c1",
        }),
      ],
      {
        env: {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
        },
        fetchImpl: async () =>
          new Response(JSON.stringify({ message: "PGRST205", code: "PGRST205" }), { status: 404 }),
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
});
