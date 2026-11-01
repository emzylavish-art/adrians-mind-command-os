import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAuthCallbackUrl, oauthAuthorizeTarget } from "./oauth-redirect.ts";

describe("buildAuthCallbackUrl", () => {
  it("uses the request origin so preview hosts work", () => {
    assert.equal(
      buildAuthCallbackUrl("https://adrians-mind-git-preview-ui-completion.vercel.app", "/dashboard"),
      "https://adrians-mind-git-preview-ui-completion.vercel.app/auth/callback?next=%2Fdashboard",
    );
  });

  it("strips a trailing slash on origin", () => {
    assert.equal(
      buildAuthCallbackUrl("http://127.0.0.1:8104/", "/dashboard"),
      "http://127.0.0.1:8104/auth/callback?next=%2Fdashboard",
    );
  });

  it("falls back to /dashboard for unsafe next values", () => {
    assert.equal(
      buildAuthCallbackUrl("https://example.com", "https://evil.test"),
      "https://example.com/auth/callback?next=%2Fdashboard",
    );
  });
});

describe("oauthAuthorizeTarget", () => {
  const url = "https://xarxhdsnprpnosimehon.supabase.co/auth/v1/authorize?provider=google&redirect_to=x";
  it("follows an ok Supabase authorize URL", () => {
    assert.equal(oauthAuthorizeTarget({ ok: true, url }), url);
  });
  it("does not treat a returned URL as an error result", () => {
    assert.notEqual(oauthAuthorizeTarget({ ok: true, url }), null);
  });
  it("ignores failures, non-https and non-authorize URLs", () => {
    assert.equal(oauthAuthorizeTarget({ ok: false, error: "x" }), null);
    assert.equal(oauthAuthorizeTarget({ ok: true, url: "http://a.supabase.co/auth/v1/authorize" }), null);
    assert.equal(oauthAuthorizeTarget({ ok: true, url: "https://evil.com/phish" }), null);
    assert.equal(oauthAuthorizeTarget({ ok: true, url: "javascript:alert(1)" }), null);
    assert.equal(oauthAuthorizeTarget(undefined), null);
  });
});
