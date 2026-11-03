import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OAUTH_TOKEN_HOSTS,
  OAUTH_REVOKE_HOSTS,
  validateOAuthTokenUrl,
  validateOAuthRevokeUrl,
  exchangeAuthorizationCode,
} from "./oauth-provider.ts";
import { getProvider, OAUTH_PROVIDERS } from "./providers.ts";
import { CONNECTOR_IDS, setConnectorDirectory, type ConnectorId } from "./store.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuthorizeUrl } from "./oauth-provider.ts";

describe("OAuth token URL host allowlist", () => {
  it("defines an exact host allowlist for every connector", () => {
    for (const id of CONNECTOR_IDS) {
      const hosts = OAUTH_TOKEN_HOSTS[id];
      assert.ok(Array.isArray(hosts) && hosts.length >= 1, id);
      for (const h of hosts) {
        assert.equal(h, h.toLowerCase());
        assert.equal(h.includes("/"), false);
        assert.equal(h.includes("@"), false);
      }
      const def = new URL(OAUTH_PROVIDERS[id].defaults.tokenUrl);
      assert.equal(def.protocol, "https:");
      assert.ok(hosts.includes(def.hostname), `${id} default token host ${def.hostname}`);
    }
  });

  for (const connector of CONNECTOR_IDS) {
    it(`${connector}: accepts official https token host`, () => {
      const url = OAUTH_PROVIDERS[connector].defaults.tokenUrl;
      const ok = validateOAuthTokenUrl(connector, url);
      assert.equal(ok.ok, true, connector);
    });

    it(`${connector}: rejects http, private, and lookalike token hosts`, () => {
      assert.equal(validateOAuthTokenUrl(connector, "http://evil.example/token").ok, false);
      assert.equal(validateOAuthTokenUrl(connector, "https://evil.example/token").ok, false);
      assert.equal(validateOAuthTokenUrl(connector, "https://127.0.0.1/token").ok, false);
      assert.equal(validateOAuthTokenUrl(connector, "https://169.254.169.254/token").ok, false);
      const goodHost = OAUTH_TOKEN_HOSTS[connector][0];
      assert.equal(
        validateOAuthTokenUrl(connector, `https://evil-${goodHost}/token`).ok,
        false,
      );
      assert.equal(
        validateOAuthTokenUrl(connector, `https://user:pass@${goodHost}/token`).ok,
        false,
      );
      assert.equal(
        validateOAuthTokenUrl(connector, `https://${goodHost}:8443/token`).ok,
        false,
      );
    });
  }

  it("validateOAuthTokenUrl uses exact host equality (no suffix match)", () => {
    assert.equal(
      validateOAuthTokenUrl("google_drive", "https://oauth2.googleapis.com.evil.example/token").ok,
      false,
    );
    assert.equal(validateOAuthTokenUrl("dropbox", "https://dropboxapi.com/oauth2/token").ok, false);
  });

  it("exchangeAuthorizationCode refuses non-allowlisted token URL before fetch", async () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-token-guard-")));
    process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-token-url-guard";
    const provider = getProvider("gmail");
    const env = {
      clientId: "c",
      clientSecret: "s",
      redirectUri: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      authorizeUrl: provider.defaults.authorizeUrl,
      tokenUrl: "https://evil.example/token",
    };
    const started = buildAuthorizeUrl(provider, { ownerId: "owner", env });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    let fetched = 0;
    const result = await exchangeAuthorizationCode(provider, {
      code: "x",
      state: started.state,
      expectedOwnerId: "owner",
      env,
      fetch: async () => {
        fetched += 1;
        throw new Error("should not fetch");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /token URL is not allowed/i);
    assert.equal(fetched, 0);
  });

  it("exchangeAuthorizationCode refuses redirect responses from token endpoint", async () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-token-redir-")));
    process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-token-url-guard";
    const provider = getProvider("gmail");
    const env = {
      clientId: "c",
      clientSecret: "s",
      redirectUri: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      authorizeUrl: provider.defaults.authorizeUrl,
      tokenUrl: provider.defaults.tokenUrl,
    };
    const started = buildAuthorizeUrl(provider, { ownerId: "owner", env });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const result = await exchangeAuthorizationCode(provider, {
      code: "x",
      state: started.state,
      expectedOwnerId: "owner",
      env,
      fetch: async () => ({
        ok: false,
        status: 302,
        json: async () => ({}),
        text: async () => "",
      }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /redirect/i);
  });
});

describe("OAuth revoke URL host allowlist", () => {
  it("rejects non-allowlisted revoke hosts", () => {
    assert.equal(validateOAuthRevokeUrl("gmail", "https://evil.example/revoke").ok, false);
    assert.equal(validateOAuthRevokeUrl("gmail", "http://oauth2.googleapis.com/revoke").ok, false);
    assert.equal(validateOAuthRevokeUrl("gmail", "https://oauth2.googleapis.com/revoke").ok, true);
    assert.ok(OAUTH_REVOKE_HOSTS.github.includes("api.github.com"));
  });
});
