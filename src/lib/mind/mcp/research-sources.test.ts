import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterCitationsBySitesAllowlist,
  hostMatchesSitesAllowlist,
  parseSitesAllowlist,
  researchConnectorRead,
  researchDeep,
  researchFetchAllowlistedUrl,
  RESEARCH_SAFE_REGISTRY_TOOLS,
  RESEARCH_UNSAFE_FOR_CORPUS,
} from "./research-sources.ts";

describe("sites allowlist", () => {
  it("parses and matches hosts including wildcards", () => {
    const list = parseSitesAllowlist("Example.COM, *.wikipedia.org, docs.github.com");
    assert.deepEqual(list, ["example.com", "*.wikipedia.org", "docs.github.com"]);
    assert.equal(hostMatchesSitesAllowlist("example.com", list), true);
    assert.equal(hostMatchesSitesAllowlist("en.wikipedia.org", list), true);
    assert.equal(hostMatchesSitesAllowlist("evil.com", list), false);
  });

  it("filters citations server-side", () => {
    const { kept, dropped } = filterCitationsBySitesAllowlist(
      [
        { title: "A", url: "https://example.com/a" },
        { title: "B", url: "https://evil.test/b" },
      ],
      ["example.com"],
    );
    assert.equal(kept.length, 1);
    assert.equal(dropped, 1);
    assert.equal(kept[0]?.url, "https://example.com/a");
  });
});

describe("research_deep", () => {
  it("needs-config without search env", async () => {
    const result = await researchDeep({ query: "piers", env: {} });
    assert.equal(result.status, "needs-config");
    assert.match(result.text, /MIND_SEARCH/);
  });

  it("keeps only allowlisted citations from a mocked provider", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: "Ok", url: "https://example.com/ok" },
            { title: "No", url: "https://blocked.test/x" },
          ],
        }),
        { status: 200 },
      );
    const result = await researchDeep({
      query: "deep research piers",
      endpoint: "https://search.example/query",
      key: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sitesAllowlist: ["example.com"],
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /example.com\/ok/);
    assert.equal(result.text.includes("blocked.test"), false);
  });
});

describe("research_connector_read", () => {
  it("refuses unknown sources and missing notion config", async () => {
    const bad = await researchConnectorRead({ source: "gmail", page_id: "x" });
    assert.equal(bad.ok, false);
    assert.match(bad.text, /not available/);
    const notion = await researchConnectorRead({
      source: "notion",
      page_id: "40b1aa27632381768d58cde0731f142a",
      env: {},
    });
    assert.equal(notion.status, "needs-config");
  });
});

describe("research_fetch_url SSRF / allowlist", () => {
  it("refuses private hosts and requires allowlist", async () => {
    const priv = await researchFetchAllowlistedUrl({
      url: "https://127.0.0.1/secret",
      env: { MIND_RESEARCH_SITES_ALLOWLIST: "example.com" },
    });
    assert.equal(priv.ok, false);
    const empty = await researchFetchAllowlistedUrl({ url: "https://example.com/", env: {} });
    assert.equal(empty.status, "needs-config");
  });
});

describe("research safe tool docs", () => {
  it("lists safe vs unsafe corpus tools without fabricating connectors", () => {
    assert.ok(RESEARCH_SAFE_REGISTRY_TOOLS.includes("research_deep"));
    assert.ok(RESEARCH_UNSAFE_FOR_CORPUS.includes("pc_run_shell"));
    assert.ok(RESEARCH_UNSAFE_FOR_CORPUS.includes("notion_append_section"));
  });
});
