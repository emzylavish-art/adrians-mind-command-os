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
    assert.match(bad.text, /gdrive/);
    const notion = await researchConnectorRead({
      source: "notion",
      page_id: "40b1aa27632381768d58cde0731f142a",
      env: {},
    });
    assert.equal(notion.status, "needs-config");
    assert.match(notion.text, /ServiceBoard|NOTION_TOKEN|Connect Notion/i);
  });

  it("gdrive refuses missing file_id and invalid ids", async () => {
    const missing = await researchConnectorRead({ source: "gdrive", env: {} });
    assert.equal(missing.ok, false);
    assert.match(missing.text, /file_id/);
    const badId = await researchConnectorRead({ source: "gdrive", file_id: "../etc/passwd", env: {} });
    assert.equal(badId.ok, false);
    assert.match(badId.text, /not a valid/);
  });

  it("gdrive reports needs-config for unknown lane", async () => {
    const result = await researchConnectorRead({
      source: "gdrive",
      file_id: "1AbCdefghijkLMNOPqrstuvwxYZ012345",
      lane_id: "gdrive-does-not-exist",
      env: {},
      configPath: "/tmp/mind-no-such-accounts.json",
    });
    assert.equal(result.ok, false);
    assert.ok(result.status === "needs-config" || result.status === "needs-reconnect");
    assert.match(result.text, /gdrive-does-not-exist|not configured|Unknown storage lane/i);
  });

  it("gdrive exports plain text via mocked Drive API", async () => {
    const fileId = "1AbCdefghijkLMNOPqrstuvwxYZ012345";
    const fetchImpl = async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/files/" + fileId) && !u.includes("alt=media") && !u.includes("/export")) {
        return new Response(
          JSON.stringify({
            id: fileId,
            name: "notes.txt",
            mimeType: "text/plain",
            size: "11",
            trashed: false,
          }),
          { status: 200 },
        );
      }
      if (u.includes("alt=media")) {
        return new Response("hello world", { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    };
    const result = await researchConnectorRead({
      source: "gdrive",
      file_id: fileId,
      lane_id: "gdrive-emzylavish",
      env: { MIND_STORAGE_LANE_GDRIVE_EMZYLAVISH_TOKEN: "test-token" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      configPath: new URL("../media/storage/media-storage-accounts.example.json", import.meta.url).pathname,
    });
    assert.equal(result.ok, true, result.text);
    assert.match(result.text, /hello world/);
    assert.equal((result.data as { via?: string })?.via, "download");
  });

  it("gdrive refuses binary mime types", async () => {
    const fileId = "1AbCdefghijkLMNOPqrstuvwxYZ012345";
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: fileId,
          name: "photo.png",
          mimeType: "image/png",
          size: "100",
          trashed: false,
        }),
        { status: 200 },
      );
    const result = await researchConnectorRead({
      source: "gdrive",
      file_id: fileId,
      env: { MIND_STORAGE_LANE_GDRIVE_EMZYLAVISH_TOKEN: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      configPath: new URL("../media/storage/media-storage-accounts.example.json", import.meta.url).pathname,
    });
    assert.equal(result.ok, false);
    assert.match(result.text, /not a supported text/);
  });

  it("gdrive maps 401 on files.get to needs-reconnect", async () => {
    const fileId = "1AbCdefghijkLMNOPqrstuvwxYZ012345";
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const result = await researchConnectorRead({
      source: "gdrive",
      file_id: fileId,
      env: { MIND_STORAGE_LANE_GDRIVE_EMZYLAVISH_TOKEN: "stale" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      configPath: new URL("../media/storage/media-storage-accounts.example.json", import.meta.url).pathname,
    });
    assert.equal(result.status, "needs-reconnect");
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
