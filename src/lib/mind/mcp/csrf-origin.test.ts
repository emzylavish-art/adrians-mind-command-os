/**
 * CSRF Origin / Sec-Fetch-Site guards on MCP state-changing POST routes.
 * Reuses assertSameOrigin (OAuth connectors helper) — same policy:
 * same-origin allowed, cross-origin rejected, missing Origin allowed (curl/bearer).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertSameOrigin } from "../connectors/oauth-csrf.ts";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers });
}

describe("assertSameOrigin CSRF policy (MCP + OAuth)", () => {
  const app = "http://127.0.0.1:8080/api/mind/mcp/servers";

  it("allows same-origin Origin", () => {
    assert.equal(assertSameOrigin(req(app, { origin: "http://127.0.0.1:8080" })).ok, true);
  });

  it("rejects cross-origin Origin", () => {
    const result = assertSameOrigin(req(app, { origin: "https://evil.example" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Cross-origin request blocked/);
  });

  it("allows missing Origin/Referer (non-browser / bearer clients)", () => {
    assert.equal(assertSameOrigin(req(app)).ok, true);
  });

  it("rejects cross-origin Referer when Origin absent", () => {
    const result = assertSameOrigin(req(app, { referer: "https://evil.example/x" }));
    assert.equal(result.ok, false);
  });

  it("allows same-origin Referer when Origin absent", () => {
    assert.equal(assertSameOrigin(req(app, { referer: "http://127.0.0.1:8080/tools" })).ok, true);
  });

  it("rejects Sec-Fetch-Site cross-site even with matching Origin spoof attempt", () => {
    const result = assertSameOrigin(
      req(app, { origin: "http://127.0.0.1:8080", "sec-fetch-site": "cross-site" }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects Sec-Fetch-Site same-site (sibling preview tenants)", () => {
    const result = assertSameOrigin(
      req(app, { origin: "http://127.0.0.1:8080", "sec-fetch-site": "same-site" }),
    );
    assert.equal(result.ok, false);
  });

  it("allows Sec-Fetch-Site same-origin", () => {
    assert.equal(
      assertSameOrigin(req(app, { origin: "http://127.0.0.1:8080", "sec-fetch-site": "same-origin" })).ok,
      true,
    );
  });
});

describe("MCP state-changing POST routes wire assertSameOrigin", () => {
  const root = join(import.meta.dirname, "../../../routes/api/mind");
  const files = [
    "mcp/servers.ts",
    "mcp/call.ts",
    "mcp/builtin.ts",
    "pc/approve.ts",
    "pc/deny.ts",
  ];

  for (const rel of files) {
    it(`${rel} imports and calls assertSameOrigin before mutating`, () => {
      const source = readFileSync(join(root, rel), "utf8");
      assert.match(source, /assertSameOrigin/);
      assert.match(source, /originCheck/);
    });
  }

  it("OAuth connector disconnect/start already covered (not regressed)", () => {
    for (const rel of [
      "oauth/notion/disconnect.ts",
      "oauth/notion/start.ts",
      "oauth/$connector/disconnect.ts",
      "oauth/$connector/start.ts",
    ]) {
      const source = readFileSync(join(root, rel), "utf8");
      assert.match(source, /assertSameOrigin/);
    }
  });
});


describe("MCP routes wire assertAllowedRequestHost (DNS rebinding)", () => {
  const root = join(import.meta.dirname, "../../../routes/api/mind");
  const files = [
    "mcp/servers.ts",
    "mcp/call.ts",
    "mcp/builtin.ts",
    "mcp/tools.ts",
    "pc/approve.ts",
    "pc/deny.ts",
  ];
  for (const rel of files) {
    it(`${rel} imports and calls assertAllowedRequestHost`, () => {
      const source = readFileSync(join(root, rel), "utf8");
      assert.match(source, /assertAllowedRequestHost/);
      assert.match(source, /hostCheck/);
    });
  }
});
