import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAuthCallbackUrl,
  oauthAuthorizeTarget,
} from "./oauth-redirect.ts";

describe("buildAuthCallbackUrl", () => {
  it("uses the request origin so preview hosts work", () => {
    assert.equal(
      buildAuthCallbackUrl(
        "https://adrians-mind-git-preview-ui-completion.vercel.app",
        "/dashboard",
      ),
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
      buildAuthCallbackUrl("https://example.com", "//evil"),
      "https://example.com/auth/callback?next=%2Fdashboard",
    );
  });
});

describe("oauthAuthorizeTarget", () => {
  it("follows first-party Google authorize URLs", () => {
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fadrians-mind.vercel.app%2Fauth%2Fgoogle%2Fcallback&state=s";
    assert.equal(oauthAuthorizeTarget({ ok: true, url }), url);
  });

  it("follows first-party GitHub authorize URLs", () => {
    const url =
      "https://github.com/login/oauth/authorize?client_id=Ov23liyoFNKAehh9yjxX&redirect_uri=https%3A%2F%2Fadrians-mind.vercel.app%2Fauth%2Fgithub%2Fcallback&state=s";
    assert.equal(oauthAuthorizeTarget({ ok: true, url }), url);
  });

  it("still allows Supabase authorize for transitional Apple hops", () => {
    const url =
      "https://xarxhdsnprpnosimehon.supabase.co/auth/v1/authorize?provider=apple&redirect_to=x";
    assert.equal(oauthAuthorizeTarget({ ok: true, url }), url);
  });

  it("does not treat a returned URL as an error result", () => {
    assert.equal(
      oauthAuthorizeTarget({
        ok: false,
        error: "nope",
        url: "https://accounts.google.com/o/oauth2/v2/auth",
      }),
      null,
    );
  });

  it("ignores failures, non-https and non-authorize URLs", () => {
    assert.equal(oauthAuthorizeTarget({ ok: true, url: "http://a.supabase.co/auth/v1/authorize" }), null);
    assert.equal(oauthAuthorizeTarget({ ok: true, url: "https://evil.example/phish" }), null);
  });
});
