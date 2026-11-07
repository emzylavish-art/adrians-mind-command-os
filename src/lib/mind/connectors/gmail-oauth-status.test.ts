import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { connectorConnectionStatus } from "./connector-oauth.ts";
import { providerConfigured } from "./oauth-provider.ts";
import { getProvider } from "./providers.ts";
import { setConnectorDirectory } from "./store.ts";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_GMAIL_REDIRECT_URI",
  "GOOGLE_OAUTH_REDIRECT_URI",
] as const;

function withGoogleEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) previous.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value) process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const key of ENV_KEYS) {
      const prior = previous.get(key);
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
  }
}

describe("Gmail GOOGLE_OAUTH status", () => {
  it("is not_configured and names the missing GOOGLE_OAUTH_* variables", () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "gmail-oauth-missing-")));
    withGoogleEnv({}, () => {
      const provider = getProvider("gmail");
      const env = provider.readEnv(process.env);
      assert.equal(providerConfigured(env), false);
      assert.match(provider.notConfiguredDetail ?? "", /GOOGLE_OAUTH_CLIENT_ID/);
      assert.match(provider.notConfiguredDetail ?? "", /GOOGLE_OAUTH_CLIENT_SECRET/);
      assert.match(provider.notConfiguredDetail ?? "", /GOOGLE_OAUTH_GMAIL_REDIRECT_URI/);
      const status = connectorConnectionStatus("gmail", "owner");
      assert.equal(status.state, "not_configured");
      assert.match(status.detail, /not configured/i);
    });
  });

  it("is not_connected when GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_GMAIL_REDIRECT_URI are set", () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "gmail-oauth-present-")));
    withGoogleEnv(
      {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        GOOGLE_OAUTH_GMAIL_REDIRECT_URI: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      },
      () => {
        const provider = getProvider("gmail");
        const env = provider.readEnv(process.env);
        assert.equal(env.clientId, "client-id");
        assert.equal(env.clientSecret, "client-secret");
        assert.equal(env.redirectUri, "http://127.0.0.1:8099/api/mind/oauth/gmail/callback");
        assert.equal(providerConfigured(env), true);
        const status = connectorConnectionStatus("gmail", "owner");
        assert.equal(status.state, "not_connected");
        assert.equal(status.detail.includes("not configured"), false);
      },
    );
  });

  it("accepts GOOGLE_OAUTH_REDIRECT_URI when GOOGLE_OAUTH_GMAIL_REDIRECT_URI is unset", () => {
    withGoogleEnv(
      {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      },
      () => {
        const env = getProvider("gmail").readEnv(process.env);
        assert.equal(env.redirectUri, "http://127.0.0.1:8099/api/mind/oauth/gmail/callback");
        assert.equal(providerConfigured(env), true);
      },
    );
  });
});
