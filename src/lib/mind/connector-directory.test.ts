import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { curatedConnectors, parseRegistryPage, registryPageUrl } from "./connector-directory.ts";

const meta = { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } };
test("registry search and cursor are scoped and encoded", () => {
  const url = registryPageUrl("  test & a  ", "x:y&limit=1");
  assert.equal(registryPageUrl("Superbase").searchParams.get("search"), "supabase");
  assert.equal(url.hostname, "registry.modelcontextprotocol.io");
  assert.equal(url.searchParams.get("search"), "test & a");
  assert.equal(url.searchParams.get("cursor"), "x:y&limit=1");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("version"), "latest");
});
test("registry presents published identity and only compatible concrete remote endpoints", () => {
  const server = {
    name: "com.publisher/example", title: "Example", websiteUrl: "javascript:alert(1)",
    repository: { url: "https://github.com/publisher/example" },
    icons: [{ src: "https://publisher.com.fake.com/logo.png" }, { src: "https://cdn.publisher.com/logo.png" }],
    remotes: [
      { type: "streamable-http", url: "https://mcp.publisher.com/api" },
      { type: "streamable-http", url: "https://mcp.publisher.com/api" },
      { type: "streamable-http", url: "https://{tenant}.publisher.com/mcp" },
      { type: "streamable-http", url: "https://user:pass@publisher.com/" },
      { type: "streamable-http", url: "https://127.0.0.1/" },
      { type: "streamable-http", url: "https://mcp.publisher.com/key", headers: [{ name: "X-Api-Key", isRequired: true }] },
      { type: "sse", url: "https://mcp.publisher.com/sse" },
    ],
  };
  const page = parseRegistryPage({ metadata: { nextCursor: "page-2" }, servers: [{ server, _meta: meta }, { server, _meta: {} }] });
  assert.equal(page.cursor, "page-2");
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0].endpoints, ["https://mcp.publisher.com/api"]);
  assert.equal(page.items[0].logo, "https://cdn.publisher.com/logo.png");
  assert.equal(page.items[0].website, "https://github.com/publisher/example");
  assert.throws(() => parseRegistryPage({ error: "offline" }));
});
test("featured service marks exist and the public API index contains distinct, source-backed specifications", () => {
  for (const item of curatedConnectors) {
    const svg = readFileSync(new URL(`../../../public/brand/logos/${item.logo}.svg`, import.meta.url), "utf8");
    assert.match(svg, /<path/);
  }
  const catalog = JSON.parse(readFileSync(new URL("../../../public/catalog/apis.json", import.meta.url), "utf8"));
  const ids = new Set();
  for (const row of catalog.entries) {
    assert.match(row.specification, /^https:\/\/api\.apis\.guru\/v2\/specs\//);
    assert(!row.logo || row.logo.startsWith("https://api.apis.guru/v2/cache/logo/"));
    assert(!row.logo.includes("no-logo"));
    ids.add(row.id);
  }
  assert.equal(ids.size, catalog.entries.length);
  assert(ids.size >= 1000);
});
