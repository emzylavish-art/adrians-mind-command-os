import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGitHubAuthorizeUrl,
  buildGoogleAuthorizeUrl,
  decodeOAuthState,
  isFirstPartyAuthorizeUrl,
  mintOAuthState,
} from "./first-party-oauth.ts";

describe("first-party OAuth state", () => {
  it("round-trips a signed state payload", () => {
    const { state, payload } = mintOAuthState(
      "google",
      "/dashboard",
      "test-secret",
      1_000_000,
      "abc",
    );
    const decoded = decodeOAuthState(state, "test-secret", 1_000_000);
    assert.deepEqual(decoded, payload);
    assert.equal(decodeOAuthState(state, "wrong", 1_000_000), null);
    assert.equal(decodeOAuthState(state, "test-secret", payload.e + 1), null);
  });
});

describe("first-party authorize URLs", () => {
  it("builds Google and GitHub authorize URLs on provider hosts", () => {
    const g = buildGoogleAuthorizeUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "https://adrians-mind.vercel.app/auth/google/callback",
      state: "st",
    });
    assert.match(g, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.equal(isFirstPartyAuthorizeUrl(g), true);
    assert.equal(g.includes("supabase.co"), false);

    const gh = buildGitHubAuthorizeUrl({
      clientId: "Ov23liyoFNKAehh9yjxX",
      redirectUri: "https://adrians-mind.vercel.app/auth/github/callback",
      state: "st",
    });
    assert.match(gh, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    assert.equal(isFirstPartyAuthorizeUrl(gh), true);
    assert.equal(gh.includes("supabase.co"), false);
  });
});
