import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { escapeHtml, oauthCallbackHtml, oauthProviderErrorMessage } from "./oauth-callback-html.ts";
import {
  PENDING_OAUTH_TTL_MS,
  isValidOAuthState,
  newOAuthState,
  pendingOAuthPath,
  pruneStalePendingOAuth,
  savePendingOAuth,
  setConnectorDirectory,
  takePendingOAuth,
} from "./store.ts";
import { buildConnectorAuthorizeUrl, exchangeConnectorCode, disconnectConnector } from "./connector-oauth.ts";
import { connectorTokenSecretStatus, encryptSecret } from "./crypto.ts";
import { assertSameOrigin } from "./oauth-csrf.ts";

describe("oauth security H1 XSS", () => {
  it("escapes XSS payloads in HTML helper", () => {
    const payload = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(payload);
    assert.equal(escaped.includes("<img"), false);
    assert.equal(escaped.includes("onerror"), true); // text may remain but tags escaped
    assert.match(escaped, /&lt;img/);
    const res = oauthCallbackHtml({
      connector: "gmail",
      message: `Provider returned error: ${payload}. Nothing was stored.`,
      ok: false,
    });
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok(res.headers.get("content-security-policy"));
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  it("does not reflect raw error codes; maps to fixed messages", async () => {
    const msg = oauthProviderErrorMessage("Gmail", '<script>alert(1)</script>');
    assert.equal(msg.includes("<script>"), false);
    assert.match(msg, /OAuth error/i);
    const res = oauthCallbackHtml({ connector: "gmail", message: msg, ok: false });
    const body = await res.text();
    assert.equal(body.includes("<script>alert"), false);
    assert.equal(body.includes("onerror="), false);
  });

  it("unknown connector path does not echo raw connector name as HTML", async () => {
    const res = oauthCallbackHtml({
      connector: '<svg onload=alert(1)>',
      message: "Unknown OAuth connector. Nothing was stored.",
      ok: false,
    });
    const body = await res.text();
    assert.equal(body.includes("<svg"), false);
    assert.match(body, /Connector connect failed/);
  });
});

describe("oauth security H2 path traversal", () => {
  it("rejects traversal states and never reads outside pending/", () => {
    const root = mkdtempSync(join(tmpdir(), "mind-oauth-trav-"));
    setConnectorDirectory(join(root, "conn"));
    mkdirSync(join(root, "victim"), { recursive: true });
    const victim = join(root, "victim", "important.json");
    writeFileSync(victim, JSON.stringify({ keep: "me" }));

    for (const bad of ["../../victim/important", "..%2f..%2fvictim", "/tmp/x", "x\0y", "../x", "a/b", ".." ]) {
      assert.equal(isValidOAuthState(bad), false);
      assert.equal(pendingOAuthPath(bad), null);
      assert.equal(takePendingOAuth(bad), null);
    }
    assert.equal(existsSync(victim), true);
    assert.equal(JSON.parse(readFileSync(victim, "utf8")).keep, "me");
  });
});

describe("oauth security H3 TTL single-use cross-provider", () => {
  it("rejects expired and reused state; binds connector", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-oauth-ttl-"));
    setConnectorDirectory(dir);
    process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-security-suite";
    const { state } = newOAuthState();
    assert.equal(isValidOAuthState(state), true);
    savePendingOAuth({
      state,
      ownerId: "owner-a",
      connector: "gmail",
      codeVerifier: "v",
      redirectUri: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      createdAt: new Date(Date.now() - PENDING_OAUTH_TTL_MS - 1000).toISOString(),
    });
    assert.equal(takePendingOAuth(state), null);

    const fresh = newOAuthState();
    const env = {
      clientId: "c",
      clientSecret: "s",
      redirectUri: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
    };
    const started = buildConnectorAuthorizeUrl("gmail", { ownerId: "owner-a", env });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const fetchOk = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "tok", token_type: "bearer", scope: "x" }),
      text: async () => "",
    });
    const first = await exchangeConnectorCode("gmail", {
      code: "c1",
      state: started.state,
      expectedOwnerId: "owner-a",
      env,
      fetch: fetchOk,
    });
    assert.equal(first.ok, true);
    const reuse = await exchangeConnectorCode("gmail", {
      code: "c2",
      state: started.state,
      expectedOwnerId: "owner-a",
      env,
      fetch: fetchOk,
    });
    assert.equal(reuse.ok, false);

    const cross = buildConnectorAuthorizeUrl("slack", {
      ownerId: "owner-a",
      env: {
        clientId: "c",
        clientSecret: "s",
        redirectUri: "http://127.0.0.1:8099/api/mind/oauth/slack/callback",
        authorizeUrl: "https://slack.com/oauth/v2/authorize",
        tokenUrl: "https://slack.com/api/oauth.v2.access",
      },
    });
    assert.equal(cross.ok, true);
    if (!cross.ok) return;
    const wrongProvider = await exchangeConnectorCode("gmail", {
      code: "c3",
      state: cross.state,
      expectedOwnerId: "owner-a",
      env,
      fetch: fetchOk,
    });
    assert.equal(wrongProvider.ok, false);

    const ownerMismatch = buildConnectorAuthorizeUrl("gmail", { ownerId: "owner-a", env });
    assert.equal(ownerMismatch.ok, true);
    if (!ownerMismatch.ok) return;
    const badOwner = await exchangeConnectorCode("gmail", {
      code: "c4",
      state: ownerMismatch.state,
      expectedOwnerId: "owner-b",
      env,
      fetch: fetchOk,
    });
    assert.equal(badOwner.ok, false);
  });

  it("pruneStalePendingOAuth removes expired files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-oauth-prune-"));
    setConnectorDirectory(dir);
    const { state } = newOAuthState();
    savePendingOAuth({
      state,
      ownerId: "o",
      connector: "github",
      codeVerifier: "v",
      redirectUri: "http://127.0.0.1:8099/cb",
      createdAt: new Date(Date.now() - PENDING_OAUTH_TTL_MS - 5000).toISOString(),
    });
    const removed = pruneStalePendingOAuth();
    assert.ok(removed >= 1);
    assert.equal(takePendingOAuth(state), null);
  });
});

describe("oauth security attacker pass extras", () => {
  it("rejects missing/weak CONNECTOR_TOKEN_SECRET", () => {
    assert.equal(connectorTokenSecretStatus("").ok, false);
    assert.equal(connectorTokenSecretStatus("short").ok, false);
    assert.equal(connectorTokenSecretStatus("long-enough-secret!!").ok, true);
    assert.throws(() => encryptSecret("tok", "short"));
  });

  it("assertSameOrigin blocks foreign Origin", () => {
    const req = new Request("http://127.0.0.1:8080/api/mind/oauth/gmail/disconnect", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(assertSameOrigin(req).ok, false);
    const ok = new Request("http://127.0.0.1:8080/api/mind/oauth/gmail/disconnect", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:8080" },
    });
    assert.equal(assertSameOrigin(ok).ok, true);
  });

  it("disconnect reports revoke failure honestly while clearing local token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-oauth-rev-"));
    setConnectorDirectory(dir);
    process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-security-suite";
    const env = {
      clientId: "c",
      clientSecret: "s",
      redirectUri: "http://127.0.0.1:8099/api/mind/oauth/gmail/callback",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
    };
    const started = buildConnectorAuthorizeUrl("gmail", { ownerId: "owner", env });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    await exchangeConnectorCode("gmail", {
      code: "c",
      state: started.state,
      expectedOwnerId: "owner",
      env,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "secret-tok", token_type: "bearer" }),
        text: async () => "",
      }),
    });
    const after = await disconnectConnector("gmail", {
      ownerId: "owner",
      env,
      fetch: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "nope" }),
        text: async () => "",
      }),
    });
    assert.equal(after.revokeOk, false);
    assert.match(after.detail, /revoke failed/i);
    assert.equal(JSON.stringify(after).includes("secret-tok"), false);
  });

  it("rejects non-https redirect URIs outside localhost", () => {
    setConnectorDirectory(mkdtempSync(join(tmpdir(), "mind-oauth-redir-")));
    const started = buildConnectorAuthorizeUrl("gmail", {
      ownerId: "o",
      env: {
        clientId: "c",
        clientSecret: "s",
        redirectUri: "http://evil.example/cb",
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
      },
    });
    assert.equal(started.ok, false);
  });
});
