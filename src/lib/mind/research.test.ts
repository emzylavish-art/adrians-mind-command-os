import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCitations, performSearch, runResearch } from "./research.ts";

describe("research gate", () => {
  it("refuses a query without searching or citing", () => {
    const result = runResearch("Toledo Bend waterfront");
    assert.equal(result.ok, false);
    assert.equal(result.configured, false);
    assert.deepEqual(result.citations, []);
    assert.match(result.error, /Nothing was searched/);
  });

  it("asks for a query instead of inventing a result", () => {
    const result = runResearch("  ");
    assert.equal(result.citations.length, 0);
    assert.match(result.error, /Write what you want researched/);
  });

  it("does not call the provider when no key is configured", async () => {
    let called = false;
    const result = await performSearch({
      query: "pier",
      fetchImpl: async () => {
        called = true;
        return new Response("[]");
      },
    });
    assert.equal(called, false);
    assert.deepEqual(result.citations, []);
    assert.match(result.error, /Nothing was searched/);
  });

  it("keeps only http citations the provider returned", async () => {
    const result = await performSearch({
      query: "pier",
      endpoint: "https://search.example/query",
      key: "test-key",
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://search.example/query");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
        return Response.json({
          results: [
            { title: "Pier guide", url: "https://example.com/pier" },
            { title: "Bad", url: "javascript:alert(1)" },
            { title: "", url: "https://example.com/empty" },
            { title: "Notes", url: "not a url" },
          ],
        });
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.citations, [{ title: "Pier guide", url: "https://example.com/pier" }]);
    assert.equal(JSON.stringify(result).includes("test-key"), false);
  });

  it("does not invent citations when the provider fails or returns nothing usable", async () => {
    const failed = await performSearch({
      query: "pier",
      endpoint: "https://search.example/query",
      key: "test-key",
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.citations, []);
    assert.match(failed.error, /503/);
    const empty = await performSearch({
      query: "pier",
      endpoint: "https://search.example/query",
      key: "test-key",
      fetchImpl: async () => Response.json({ results: [{ title: "Skip", url: "file:///tmp/secret" }] }),
    });
    assert.deepEqual(empty.citations, []);
    assert.equal(normalizeCitations("nope").length, 0);
  });
});
