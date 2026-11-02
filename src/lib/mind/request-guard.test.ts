import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideFetchSite, isAllowedAppHost } from "./request-guard.ts";

describe("cross-site requests", () => {
  it("allows the app's own origin, a direct load, and a non-browser client", () => {
    assert.equal(decideFetchSite({ site: "same-origin", mode: "cors", dest: "empty", method: "POST" }), "allow");
    assert.equal(decideFetchSite({ site: "none", mode: "navigate", dest: "document", method: "GET" }), "allow");
    assert.equal(decideFetchSite({ site: null, mode: null, dest: null, method: "POST" }), "allow");
  });

  it("blocks a scripted cross-site or sibling request without our Origin", () => {
    assert.equal(decideFetchSite({ site: "cross-site", mode: "cors", dest: "empty", method: "POST" }), "block");
    assert.equal(decideFetchSite({ site: "same-site", mode: "cors", dest: "empty", method: "POST" }), "block");
  });

  it("allows a top-level GET navigation and still blocks embedded or non-GET loads", () => {
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "document", method: "GET" }), "allow");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "object", method: "GET" }), "block");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "embed", method: "GET" }), "block");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "navigate", dest: "document", method: "POST" }), "block");
  });

  it("allows same-site when Origin host matches request host or allowlist", () => {
    assert.equal(
      decideFetchSite({
        site: "same-site",
        mode: "cors",
        dest: "empty",
        method: "POST",
        origin: "https://adrians-mind.vercel.app",
        host: "adrians-mind.vercel.app",
      }),
      "allow",
    );
    assert.equal(
      decideFetchSite({
        site: "same-site",
        mode: "cors",
        dest: "empty",
        method: "POST",
        origin: "https://evil.example",
        host: "adrians-mind.vercel.app",
      }),
      "block",
    );
  });

  it("allows embedded/in-app browsers that mark cross-site but send our prod Origin", () => {
    assert.equal(
      decideFetchSite({
        site: "cross-site",
        mode: "cors",
        dest: "empty",
        method: "POST",
        origin: "https://adrians-mind.vercel.app",
        host: "adrians-mind.vercel.app",
      }),
      "allow",
    );
  });

  it("allows preview hosts *-adrian-8a30.vercel.app with matching Origin", () => {
    assert.equal(
      decideFetchSite({
        site: "cross-site",
        mode: "cors",
        dest: "empty",
        method: "POST",
        origin: "https://os-coordination-adrian-8a30.vercel.app",
        forwardedHost: "os-coordination-adrian-8a30.vercel.app",
      }),
      "allow",
    );
  });

  it("still blocks a foreign Origin even when Sec-Fetch-Site is cross-site", () => {
    assert.equal(
      decideFetchSite({
        site: "cross-site",
        mode: "cors",
        dest: "empty",
        method: "POST",
        origin: "https://evil.example",
        host: "adrians-mind.vercel.app",
      }),
      "block",
    );
  });
});

describe("isAllowedAppHost", () => {
  it("allows prod, preview pattern, and localhost only", () => {
    assert.equal(isAllowedAppHost("adrians-mind.vercel.app"), true);
    assert.equal(isAllowedAppHost("foo-adrian-8a30.vercel.app"), true);
    assert.equal(isAllowedAppHost("localhost"), true);
    assert.equal(isAllowedAppHost("evil.vercel.app"), false);
    assert.equal(isAllowedAppHost("other-team.vercel.app"), false);
  });
});
