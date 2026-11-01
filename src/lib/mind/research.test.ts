import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCitations,
  performDeepResearch,
  performSearch,
  planDeepQueries,
  runResearch,
  searchConfigError,
  shouldRunDeepResearch,
} from "./research.ts";

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

  it("does not call the provider when endpoint or key is missing", async () => {
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      return new Response("[]");
    };
    const neither = await performSearch({ query: "pier", fetchImpl });
    assert.equal(called, 0);
    assert.match(neither.error, /Nothing was searched/);
    const noKey = await performSearch({ query: "pier", endpoint: "https://search.example/query", fetchImpl });
    assert.equal(called, 0);
    assert.match(noKey.error, /MIND_SEARCH_KEY/);
    const noEndpoint = await performSearch({ query: "pier", key: "test-key", fetchImpl });
    assert.equal(called, 0);
    assert.match(noEndpoint.error, /MIND_SEARCH_ENDPOINT/);
    assert.match(searchConfigError(undefined, "k") ?? "", /ENDPOINT/);
    assert.match(searchConfigError("https://x", undefined) ?? "", /KEY/);
    assert.equal(searchConfigError("https://x", "k"), null);
  });

  it("keeps only http citations the provider returned", async () => {
    const result = await performSearch({
      query: "pier",
      endpoint: "https://search.example/query",
      key: "test-key",
      deep: false,
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
      deep: false,
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.citations, []);
    assert.match(failed.error, /503/);
    const empty = await performSearch({
      query: "pier",
      endpoint: "https://search.example/query",
      key: "test-key",
      deep: false,
      fetchImpl: async () => Response.json({ results: [{ title: "Skip", url: "file:///tmp/secret" }] }),
    });
    assert.deepEqual(empty.citations, []);
    assert.equal(normalizeCitations("nope").length, 0);
  });
});

describe("deep research", () => {
  it("plans several queries and merges real citations only", async () => {
    assert.ok(planDeepQueries("Toledo Bend marina zoning").length >= 2);
    assert.equal(shouldRunDeepResearch("short", false), false);
    assert.equal(shouldRunDeepResearch("x".repeat(160)), true);
    assert.equal(shouldRunDeepResearch("please deep research this topic"), true);

    let calls = 0;
    const result = await performDeepResearch({
      query: "Toledo Bend marina zoning",
      endpoint: "https://search.example/query",
      key: "test-key",
      fetchImpl: async (_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
        return Response.json({
          results: [{ title: `Hit ${calls}`, url: `https://example.com/${calls}?q=${encodeURIComponent(body.query ?? "")}` }],
        });
      },
    });
    assert.equal(result.ok, true);
    assert.ok(calls >= 2);
    assert.ok((result.steps?.length ?? 0) >= 2);
    assert.ok(result.citations.every((item) => item.url.startsWith("https://")));
    assert.match(result.summary ?? "", /Deep research used/);
    assert.equal(JSON.stringify(result).includes("test-key"), false);
  });

  it("refuses deep research when env is incomplete and never invents citations", async () => {
    let called = false;
    const result = await performDeepResearch({
      query: "topic",
      endpoint: "https://search.example/query",
      fetchImpl: async () => {
        called = true;
        return Response.json({ results: [{ title: "X", url: "https://example.com" }] });
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.deepEqual(result.citations, []);
    assert.match(result.error, /MIND_SEARCH_KEY/);
  });
});
