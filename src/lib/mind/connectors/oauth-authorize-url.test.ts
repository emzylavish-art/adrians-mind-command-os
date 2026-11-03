import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach } from "node:test";
import {
  buildAuthorizeUrl,
  OAUTH_AUTHORIZE_HOSTS,
  validateOAuthAuthorizeUrl,
  validateOAuthRedirectUri,
} from "./oauth-provider.ts";
import { getProvider, OAUTH_PROVIDERS } from "./providers.ts";
import { CONNECTOR_IDS, setConnectorDirectory, type ConnectorId } from "./store.ts";

function baseEnv(connector: ConnectorId) {
  const provider = getProvider(connector);
  return {
    clientId: "client-id",
    clientSecret: "client-secret-value",
    redirectUri: `https://app.example.com/api/mind/oauth/${connector}/callback`,
    authorizeUrl: provider.defaults.authorizeUrl,
    tokenUrl: provider.defaults.tokenUrl,
  };
}

describe("OAuth authorize URL host allowlist", () => {
  beforeEach(() => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-authz-")));
  });

  it("defines an exact host allowlist for every connector", () => {
    for (const id of CONNECTOR_IDS) {
      const hosts = OAUTH_AUTHORIZE_HOSTS[id];
      assert.ok(Array.isArray(hosts) && hosts.length >= 1, id);
      for (const h of hosts) {
        assert.equal(h, h.toLowerCase());
        assert.equal(h.includes("/"), false);
        assert.equal(h.includes("@"), false);
        assert.equal(h.startsWith("."), false);
      }
      // Provider default authorize URL must already be allowlisted.
      const def = new URL(OAUTH_PROVIDERS[id].defaults.authorizeUrl);
      assert.equal(def.protocol, "https:");
      assert.ok(hosts.includes(def.hostname), `${id} default host ${def.hostname}`);
    }
  });

  for (const connector of CONNECTOR_IDS) {
    describe(connector, () => {
      it("accepts the official https authorize host", () => {
        const provider = getProvider(connector);
        const env = baseEnv(connector);
        const started = buildAuthorizeUrl(provider, { ownerId: "owner", env });
        assert.equal(started.ok, true);
        if (!started.ok) return;
        const url = new URL(started.url);
        assert.equal(url.protocol, "https:");
        assert.ok(OAUTH_AUTHORIZE_HOSTS[connector].includes(url.hostname));
        assert.equal(url.username, "");
        assert.equal(url.password, "");
        assert.equal(url.port, "");
        assert.equal(url.searchParams.get("client_id"), "client-id");
        assert.ok(url.searchParams.get("state"));
        // Error / URL must not leak client secret
        assert.equal(JSON.stringify(started).includes("client-secret-value"), false);
      });

      it("rejects javascript/data/http schemes and userinfo / lookalike / odd-port overrides", () => {
        const provider = getProvider(connector);
        const goodHost = OAUTH_AUTHORIZE_HOSTS[connector][0];
        const attacks = [
          "javascript:alert(1)",
          "data:text/html,hi",
          `http://${goodHost}/oauth`,
          `https://evil@${goodHost}/oauth`,
          `https://user:pass@${goodHost}/oauth`,
          `https://${goodHost}.evil.com/oauth`,
          `https://evil-${goodHost}/oauth`,
          `https://not-${goodHost}/oauth`,
          `https://${goodHost}:8443/oauth`,
          `https://${goodHost}:80/oauth`,
          "https://accounts.google.com.evil.com/o/oauth2/v2/auth",
          "https://login.microsoftonline.com.attacker.tld/common/oauth2/v2.0/authorize",
          "https://api.notion.com.evil.com/v1/oauth/authorize",
        ];
        for (const authorizeUrl of attacks) {
          const started = buildAuthorizeUrl(provider, {
            ownerId: "owner",
            env: { ...baseEnv(connector), authorizeUrl },
          });
          assert.equal(started.ok, false, `${connector} should reject ${authorizeUrl}`);
          if (started.ok) continue;
          assert.match(started.error, /authorize URL is not allowed/i);
          assert.equal(started.error.includes(authorizeUrl), false);
          assert.equal(started.error.includes("client-secret-value"), false);
          assert.equal(started.error.includes("javascript:"), false);
        }
      });

      it("rejects bad redirect_uri origins (scheme/userinfo) without leaking secrets", () => {
        const provider = getProvider(connector);
        const badRedirects = [
          "javascript:alert(1)",
          "data:text/html,hi",
          "http://evil.example.com/callback",
          "https://user:pass@app.example.com/callback",
          "https://good@evil.example.com/callback",
          "ftp://app.example.com/callback",
          "https://app.example.com:8443/callback",
        ];
        for (const redirectUri of badRedirects) {
          const started = buildAuthorizeUrl(provider, {
            ownerId: "owner",
            env: { ...baseEnv(connector), redirectUri },
          });
          assert.equal(started.ok, false, `${connector} should reject redirect ${redirectUri}`);
          if (started.ok) continue;
          assert.match(started.error, /redirect URI is not allowed/i);
          assert.equal(started.error.includes(redirectUri), false);
          assert.equal(started.error.includes("client-secret-value"), false);
        }
      });

      it("allows https redirect and http loopback redirect", () => {
        const provider = getProvider(connector);
        for (const redirectUri of [
          `https://app.example.com/api/mind/oauth/${connector}/callback`,
          `http://127.0.0.1:8080/api/mind/oauth/${connector}/callback`,
          `http://localhost:53682/callback`,
        ]) {
          const started = buildAuthorizeUrl(provider, {
            ownerId: "owner",
            env: { ...baseEnv(connector), redirectUri },
          });
          assert.equal(started.ok, true, `${connector} redirect ${redirectUri}`);
        }
      });
    });
  }

  it("validateOAuthAuthorizeUrl uses exact host equality (no suffix match)", () => {
    const ok = validateOAuthAuthorizeUrl("google_drive", "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(ok.ok, true);
    const evil = validateOAuthAuthorizeUrl(
      "google_drive",
      "https://accounts.google.com.evil.com/o/oauth2/v2/auth",
    );
    assert.equal(evil.ok, false);
    const dropboxEvil = validateOAuthAuthorizeUrl("dropbox", "https://dropbox.com/oauth2/authorize");
    // www.dropbox.com is allowlisted, apex dropbox.com is not (exact list)
    assert.equal(dropboxEvil.ok, false);
  });

  it("validateOAuthRedirectUri rejects credentials and non-local http", () => {
    assert.equal(validateOAuthRedirectUri("https://app.example.com/cb").ok, true);
    assert.equal(validateOAuthRedirectUri("http://127.0.0.1:8080/cb").ok, true);
    assert.equal(validateOAuthRedirectUri("http://example.com/cb").ok, false);
    assert.equal(validateOAuthRedirectUri("https://u:p@app.example.com/cb").ok, false);
  });
});
