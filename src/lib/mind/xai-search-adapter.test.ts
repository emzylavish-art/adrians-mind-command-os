import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  XAI_MIND_SEARCH_ADAPTER_ENDPOINT,
  callXaiWebSearch,
  createXaiMindSearchFetch,
  extractUrlsFromXaiResponse,
  resolveMindSearchBackend,
} from "./xai-search-adapter.ts";

describe("resolveMindSearchBackend", () => {
  it("prefers dedicated MIND_SEARCH_* over the adapter", () => {
    const backend = resolveMindSearchBackend(
      {
        MIND_SEARCH_ENDPOINT: "https://search.example/query",
        MIND_SEARCH_KEY: "dedicated-key",
        XAI_API_KEY: "xai-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      { skipSecretsFile: true },
    );
    assert.equal(backend.kind, "dedicated");
    if (backend.kind === "dedicated") {
      assert.equal(backend.endpoint, "https://search.example/query");
      assert.equal(backend.key, "dedicated-key");
    }
  });

  it("falls back to xai-adapter when dedicated env is absent but inference key is set", () => {
    const backend = resolveMindSearchBackend(
      { XAI_API_KEY: "xai-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { skipSecretsFile: true },
    );
    assert.equal(backend.kind, "xai-adapter");
    if (backend.kind === "xai-adapter") {
      assert.equal(backend.endpoint, XAI_MIND_SEARCH_ADAPTER_ENDPOINT);
      assert.equal(backend.apiKey.startsWith("xai-"), true);
    }
  });

  it("returns none when nothing is configured", () => {
    const backend = resolveMindSearchBackend({}, { skipSecretsFile: true });
    assert.equal(backend.kind, "none");
  });
});

describe("extractUrlsFromXaiResponse", () => {
  it("keeps only real http(s) URLs from citations and never invents hosts", () => {
    const results = extractUrlsFromXaiResponse({
      citations: ["https://example.com/a", "javascript:alert(1)", "https://example.com/a"],
      output: [{ content: [{ type: "output_text", text: "See https://docs.example.com/guide" }] }],
    });
    assert.deepEqual(
      results.map((r) => r.url).sort(),
      ["https://docs.example.com/guide", "https://example.com/a"].sort(),
    );
  });
});

describe("createXaiMindSearchFetch", () => {
  it("implements the MIND_SEARCH POST contract via Responses API", async () => {
    let saw = false;
    const fetchImpl = createXaiMindSearchFetch({
      apiKey: "xai-test-key-not-real-but-long-enough",
      fetchImpl: (async (_url, init) => {
        saw = true;
        assert.match(String(init?.headers && new Headers(init.headers).get("authorization")), /Bearer /);
        return Response.json({
          citations: ["https://lake.example/pier"],
          output: [],
        });
      }) as typeof fetch,
    });
    const res = await fetchImpl(XAI_MIND_SEARCH_ADAPTER_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ query: "Toledo Bend pier" }),
    });
    assert.equal(res.ok, true);
    const body = (await res.json()) as { results: { url: string }[] };
    assert.equal(body.results[0]?.url, "https://lake.example/pier");
    assert.equal(saw, true);
  });

  it("callXaiWebSearch refuses empty query without inventing citations", async () => {
    const result = await callXaiWebSearch({
      query: "  ",
      apiKey: "xai-test-key-not-real-but-long-enough",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    assert.equal(result.ok, false);
  });
});
