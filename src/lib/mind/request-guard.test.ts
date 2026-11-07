import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideFetchSite, decideRequestIsolation } from "./request-guard.ts";

describe("cross-site requests", () => {
  it("allows the app's own origin, a direct load, and a non-browser client", () => {
    assert.equal(decideFetchSite({ site: "same-origin", mode: "cors", dest: "empty", method: "POST" }), "allow");
    assert.equal(decideFetchSite({ site: "none", mode: "navigate", dest: "document", method: "GET" }), "allow");
    assert.equal(decideFetchSite({ site: null, mode: null, dest: null, method: "POST" }), "allow");
  });

  it("blocks a scripted cross-site or sibling request", () => {
    assert.equal(decideFetchSite({ site: "cross-site", mode: "cors", dest: "empty", method: "POST" }), "block");
    assert.equal(decideFetchSite({ site: "same-site", mode: "cors", dest: "empty", method: "POST" }), "block");
  });

  it("allows a same-origin Tools POST when Origin matches the request URL", () => {
    const headers = new Headers({
      origin: "https://adrians-mind.vercel.app",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
      "x-forwarded-host": "evil.example",
    });
    assert.equal(
      decideRequestIsolation({
        method: "POST",
        url: "https://adrians-mind.vercel.app/api/mind/mcp/call",
        headers,
      }),
      "allow",
    );
  });

  it("still blocks a sibling or foreign POST and does not trust x-forwarded-host", () => {
    assert.equal(
      decideRequestIsolation({
        method: "POST",
        url: "https://app.grok.me/api/mind/mcp/call",
        headers: new Headers({
          origin: "https://evil.grok.me",
          "sec-fetch-site": "same-site",
          "sec-fetch-mode": "cors",
          "x-forwarded-host": "app.grok.me",
        }),
      }),
      "block",
    );
    assert.equal(
      decideRequestIsolation({
        method: "POST",
        url: "https://adrians-mind.vercel.app/api/mind/mcp/call",
        headers: new Headers({
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "cors",
          "x-forwarded-host": "adrians-mind.vercel.app",
        }),
      }),
      "block",
    );
  });

  it("allows a top-level GET navigation and still blocks embedded or non-GET loads", () => {
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "document", method: "GET" }), "allow");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "object", method: "GET" }), "block");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "embed", method: "GET" }), "block");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "document", method: "POST" }), "block");
  });
});
