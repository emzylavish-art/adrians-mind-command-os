import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { performDeepResearch, researchRetryAllowed, researchSummary, withResearchProvenance, type ResearchStep } from "./research.ts";
import { researchRouteIdentity } from "./research-route.server.ts";
import { extractResearchAnswer, searchWithGrok } from "./xai-search.ts";

const route = (endpoint = "https://search.example/query", key = "fake-fixture-key") => researchRouteIdentity({ provider: "configured-search", endpoint, key, strategy: "multi_query" });

describe("C2 research recovery and evidence", () => {
  it("AA-040 retry identity changes for endpoint or credential changes without exposing either", () => {
    const original = route();
    const other = route("https://other.example/query?secret=private");
    assert.equal(researchRetryAllowed(["failed query"], original.routeFingerprint, original), true);
    assert.equal(researchRetryAllowed(["failed query"], original.routeFingerprint, other), false);
    assert.equal(researchRetryAllowed(["failed query"], original.routeFingerprint, route(undefined, "second-fixture-key")), false);
    assert.equal(researchRetryAllowed(["failed query"], undefined, original), false);
    assert.equal(researchRetryAllowed(undefined, undefined, other), true);
    assert.doesNotMatch(JSON.stringify(other), /private|https:|fixture-key/);
  });

  it("AA-038/042 balances retained citations across queries and retains all query evidence", async () => {
    let count = 0;
    const result = await performDeepResearch({ query: "harbor planning", endpoint: "https://search.example/query", key: "fixture-key", fetchImpl: async () => {
      const query = ++count;
      return Response.json({ results: Array.from({ length: 8 }, (_, index) => ({ title: `Q${query} source ${index}`, url: `https://example.com/q${query}/${index}` })) });
    } });
    assert.equal(count, 3);
    assert.equal(result.citations.length, 8);
    assert.equal(result.evidence?.length, 24);
    assert.ok(result.steps?.every((step) => (step.retainedCount ?? 0) > 0));
    assert.match(result.summary ?? "", /24 distinct sources/);
    assert.match(result.summary ?? "", /not independently opened or verified/);
    const attributed = withResearchProvenance(result, route(), "harbor planning");
    assert.ok(attributed.evidence?.every((item) => item.providerId === "configured-search" && item.routeFingerprint === route().routeFingerprint && item.verification === "provider_returned"));
    assert.ok(attributed.steps?.every((step) => typeof step.at === "string"));
  });

  it("AA-041 recovery rebuilds source coverage and preserves failed-attempt history", () => {
    const before: ResearchStep[] = [{ query: "harbor", ok: true, count: 1 }, { query: "harbor risks", ok: false, count: 0, error: "Search timed out." }];
    const recovered: ResearchStep = { query: "harbor risks", ok: true, count: 1 };
    const text = researchSummary({ citations: [{ title: "Evidence", url: "https://example.com/evidence" }], steps: [before[0]!, recovered], attempts: [...before, recovered], providerIdentity: route() });
    assert.match(text, /2 of 2 searches succeeded/);
    assert.match(text, /3 query attempts/);
    assert.match(text, /Some attempts timed out/);
    assert.match(text, /Evidence — https:\/\/example.com\/evidence/);
    assert.match(text, /provider-returned sources/);
  });

  it("AA-039 single-search xAI does not claim a multi-query plan or add paid fan-out", async () => {
    let calls = 0;
    const result = await searchWithGrok("deep research harbor planning", { apiKey: "fake-fixture-key", fetchImpl: async () => {
      calls++;
      return Response.json({ citations: ["https://example.com/evidence"], output: [{ content: [{ text: "Provider answer", annotations: [] }] }] });
    } });
    const identity = researchRouteIdentity({ provider: "xai", endpoint: "https://api.x.ai/v1/responses", key: "fake-fixture-key", strategy: "single_query", model: "fixture-model" });
    const attributed = withResearchProvenance(result, identity, "deep research harbor planning");
    assert.equal(calls, 1);
    assert.match(attributed.summary ?? "", /multi-query research plan was not executed/);
    assert.equal(attributed.annotatedAnswer?.text, "Provider answer");
  });

  it("AA-043 preserves passage offsets across provider blocks and rejects unsafe citations", () => {
    const answer = extractResearchAnswer({ output: [{ content: [
      { text: "First claim", annotations: [{ url: "https://example.com/first", start_index: 0, end_index: 5 }] },
      { text: "Second claim", annotations: [{ url: "https://example.com/second", start_index: 0, end_index: 6 }, { url: "javascript:bad", start_index: 0, end_index: 3 }, { url: "https://example.com/unknown", start_index: -1, end_index: 999 }] },
    ] }] });
    assert.equal(answer.text, "First claim\n\nSecond claim");
    assert.deepEqual(answer.annotations[0], { url: "https://example.com/first", start: 0, end: 5 });
    assert.deepEqual(answer.annotations[1], { url: "https://example.com/second", start: 13, end: 19 });
    assert.deepEqual(answer.annotations[2], { url: "https://example.com/unknown", start: null, end: null });
    assert.equal(answer.annotations.length, 3);
  });
});
