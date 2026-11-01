import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildNotionAuthorizeUrl,
  disconnectNotion,
  exchangeNotionCode,
  notionConnectionStatus,
  notionOAuthConfigured,
  readNotionOAuthEnv,
} from "./notion-oauth.ts";
import { setConnectorDirectory, getAccessToken } from "./store.ts";

const env = {
  NOTION_OAUTH_CLIENT_ID: "client-id",
  NOTION_OAUTH_CLIENT_SECRET: "client-secret",
  NOTION_OAUTH_REDIRECT_URI: "http://127.0.0.1:8099/api/mind/oauth/notion/callback",
  NOTION_OAUTH_TOKEN_URL: "http://127.0.0.1:9/token",
};

describe("notion oauth", () => {
  it("reports not configured when env is missing", () => {
    assert.equal(notionOAuthConfigured(readNotionOAuthEnv({})), false);
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-")));
    const status = notionConnectionStatus("owner", readNotionOAuthEnv({}));
    assert.equal(status.state, "not_configured");
    assert.match(status.detail, /not configured/i);
  });

  it("builds an authorize URL with state and PKCE challenge", () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-")));
    const started = buildNotionAuthorizeUrl({ ownerId: "owner", env: readNotionOAuthEnv(env) });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const url = new URL(started.url);
    assert.equal(url.searchParams.get("client_id"), "client-id");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), started.state);
    assert.ok(url.searchParams.get("code_challenge"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("redirect_uri"), env.NOTION_OAUTH_REDIRECT_URI);
  });

  it("exchanges a code via mock token endpoint and never returns the token", async () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-")));
    process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-unit";
    const oauthEnv = readNotionOAuthEnv({ ...env, NOTION_OAUTH_TOKEN_URL: "http://mock/token" });
    const started = buildNotionAuthorizeUrl({ ownerId: "owner", env: oauthEnv });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const fetchMock = async (_url: string, init?: RequestInit) => {
      const body = String(init?.body || "");
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code=auth-code/);
      assert.match(body, /code_verifier=/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "secret-access-token",
          token_type: "bearer",
          workspace_name: "Adrian Workspace",
          workspace_id: "ws-1",
          owner: { user: { name: "Adrian", person: { email: "adrian@example.com" } } },
        }),
        text: async () => "",
      };
    };
    const exchanged = await exchangeNotionCode({
      code: "auth-code",
      state: started.state,
      env: oauthEnv,
      fetch: fetchMock,
    });
    assert.equal(exchanged.ok, true);
    if (!exchanged.ok) return;
    assert.equal(exchanged.public.state, "connected");
    assert.match(exchanged.public.detail, /Adrian Workspace/);
    assert.equal(JSON.stringify(exchanged).includes("secret-access-token"), false);
    assert.equal(getAccessToken("owner", "notion"), "secret-access-token");
    const status = notionConnectionStatus("owner", oauthEnv);
    assert.equal(status.state, "connected");
    assert.equal(JSON.stringify(status).includes("secret-access-token"), false);
  });

  it("rejects a bad state and does not store a token", async () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-")));
    const oauthEnv = readNotionOAuthEnv(env);
    const result = await exchangeNotionCode({
      code: "auth-code",
      state: "forged",
      env: oauthEnv,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ access_token: "x" }), text: async () => "" }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /state/i);
    assert.equal(getAccessToken("owner", "notion"), null);
  });

  it("disconnect clears the record and returns not_connected", async () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-")));
    process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-unit";
    const oauthEnv = readNotionOAuthEnv({ ...env, NOTION_OAUTH_TOKEN_URL: "http://mock/token" });
    const started = buildNotionAuthorizeUrl({ ownerId: "owner", env: oauthEnv });
    if (!started.ok) return;
    await exchangeNotionCode({
      code: "auth-code",
      state: started.state,
      env: oauthEnv,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "secret-access-token", workspace_name: "Adrian Workspace" }),
        text: async () => "",
      }),
    });
    const after = await disconnectNotion({ ownerId: "owner", env: oauthEnv });
    assert.equal(after.state, "not_connected");
    assert.equal(getAccessToken("owner", "notion"), null);
  });
});
