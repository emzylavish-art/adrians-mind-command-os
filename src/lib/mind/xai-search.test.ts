import assert from "node:assert/strict";
import { it } from "node:test";
import { researchEvidenceFromResponse, searchWithGrok } from "./xai-search.ts";

it("keeps provider summary and links five explicitly cited spans to their own sources", async () => {
  const claims = Array.from({ length: 5 }, (_, i) => ({ text: `Finding ${i + 1}`, url: `https://example.com/${i + 1}` }));
  const result = await searchWithGrok("fixture research", { apiKey: "fixture-not-real", fetchImpl: async () => Response.json({ output: [{ content: claims.map((claim) => ({ type: "output_text", text: claim.text, annotations: [{ type: "url_citation", title: claim.text, url: claim.url, start_index: 0, end_index: claim.text.length }] })) }] }) });
  assert.equal(result.ok, true);
  assert.equal(result.claims?.length, 5);
  assert.equal(result.summary, claims.map((claim) => claim.text).join("\n"));
  for (let i = 0; i < 5; i++) assert.deepEqual(result.claims?.[i], { text: claims[i].text, sourceUrls: [claims[i].url], kind: "provider-cited" });
});

it("does not turn unrelated bibliography links or invalid spans into claim verification", () => {
  const result = researchEvidenceFromResponse({ output_text: "Unverified conclusion", citations: ["https://example.com"], output: [{ content: [{ text: "Claim", annotations: [{ url: "https://example.com", start_index: -1, end_index: 100 }] }] }] }, [{ title: "Link", url: "https://example.com" }]);
  assert.equal(result.summary, "Unverified conclusion");
  assert.deepEqual(result.claims, []);
});
