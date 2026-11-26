import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveOAuthAccessToken } from "./token-refresh.ts";
import { tokenExpiresAt } from "./token-expiry.ts";
import { clearConnection, getAccessToken, getRefreshToken, readConnection, readLocalOAuthRecovery, saveLocalOAuthRecovery, setConnectorDirectory, storeAccessToken } from "./store.ts";
import { connectionStatus, disconnectProvider, revocationSucceeded } from "./oauth-provider.ts";
import { getProvider } from "./providers.ts";

const env = { clientId: "fixture-client", clientSecret: "fixture-secret", tokenUrl: "https://fixture.invalid/token", redirectUri: "https://fixture.invalid/callback", revokeUrl: "https://fixture.invalid/revoke" };
function setup() {
  setConnectorDirectory(mkdtempSync(join(tmpdir(), "c2-oauth-")));
  process.env.CONNECTOR_TOKEN_SECRET = "fixture-only-secret";
}
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => "" });

test("expired token renews once, retains exact account and rotates encrypted refresh token", async () => {
  setup();
  const original = storeAccessToken({ ownerId: "owner", connector: "google_drive", accessToken: "old-access", refreshToken: "old-refresh", accountLabel: "fixture@example.invalid", expiresAt: new Date(0).toISOString(), scopes: "drive.readonly" });
  let calls = 0;
  const fetch = async (_url: string, init?: RequestInit) => {
    calls++;
    assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "refresh_token");
    return reply({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "drive.readonly" });
  };
  const first = await resolveOAuthAccessToken({ ownerId: "owner", connector: "google_drive", env, fetch, now: 10_000 });
  assert.equal(first.ok, true);
  assert.equal(getAccessToken("owner", "google_drive"), "new-access");
  assert.equal(getRefreshToken("owner", "google_drive"), "new-refresh");
  const saved = readConnection("owner", "google_drive")!;
  assert.equal(saved.accountLabel, original.accountLabel);
  assert.equal(saved.connectedAt, original.connectedAt);
  assert.doesNotMatch(saved.accessTokenEnc, /new-access/);
  await resolveOAuthAccessToken({ ownerId: "owner", connector: "google_drive", env, fetch, now: 11_000 });
  assert.equal(calls, 1);
});

test("rejected refresh persists reconnect state and does not loop on subsequent access", async () => {
  setup();
  storeAccessToken({ ownerId: "owner", connector: "notion", workspaceId: "A", accessToken: "old", refreshToken: "refresh", expiresAt: new Date(0).toISOString() });
  let calls = 0;
  const fetch = async () => { calls++; return reply({ error: "invalid_grant", access_token: "must-not-appear" }, 400); };
  const first = await resolveOAuthAccessToken({ ownerId: "owner", connector: "notion", workspaceId: "A", env, fetch });
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.reconnect, true);
  await resolveOAuthAccessToken({ ownerId: "owner", connector: "notion", workspaceId: "A", env, fetch });
  assert.equal(calls, 1);
  const publicStatus = connectionStatus(getProvider("notion"), "owner", env);
  assert.equal(publicStatus.recovery?.status, "reconnect_required");
  assert.doesNotMatch(JSON.stringify(publicStatus), /must-not-appear/);
});

test("disconnect during token refresh cannot recreate the removed grant", async () => {
  setup();
  storeAccessToken({ ownerId: "owner", connector: "gmail", accessToken: "old", refreshToken: "refresh", expiresAt: new Date(0).toISOString() });
  const result = await resolveOAuthAccessToken({ ownerId: "owner", connector: "gmail", env, fetch: async () => {
    clearConnection("owner", "gmail");
    return reply({ access_token: "late-token", expires_in: 3600 });
  } });
  assert.equal(result.ok, false);
  assert.equal(readConnection("owner", "gmail"), null);
});

test("reconnect to another account while renewal is delayed preserves replacement credentials", async () => {
  setup();
  storeAccessToken({ ownerId: "owner", connector: "gmail", accessToken: "old", refreshToken: "refresh", accountLabel: "A@example.invalid", expiresAt: new Date(0).toISOString() });
  const result = await resolveOAuthAccessToken({ ownerId: "owner", connector: "gmail", env, fetch: async () => {
    storeAccessToken({ ownerId: "owner", connector: "gmail", accessToken: "replacement", accountLabel: "B@example.invalid" });
    return reply({ access_token: "late-A-token", expires_in: 3600 });
  } });
  assert.equal(result.ok, false);
  assert.equal(getAccessToken("owner", "gmail"), "replacement");
});

test("unconfirmed revocation remains visible after reload without retaining credentials", async () => {
  setup();
  storeAccessToken({ ownerId: "owner", connector: "gmail", accessToken: "to-remove", refreshToken: "also-remove" });
  const result = await disconnectProvider(getProvider("gmail"), { ownerId: "owner", env, fetch: async () => { throw new Error("fixture network down"); } });
  assert.equal(result.revokeOk, false);
  assert.equal(getAccessToken("owner", "gmail"), null);
  assert.equal(getRefreshToken("owner", "gmail"), null);
  const status = connectionStatus(getProvider("gmail"), "owner", env);
  assert.equal(status.state, "not_connected");
  assert.equal(status.recovery?.status, "revocation_unknown");
  assert.match(status.detail, /account settings/);
  assert.doesNotMatch(JSON.stringify(readLocalOAuthRecovery("owner", "gmail")), /to-remove|also-remove/);
});

test("revocation interprets each provider response contract, not arbitrary HTTP success", async () => {
  assert.equal(await revocationSucceeded("github_basic", reply({}, 204)), true);
  assert.equal(await revocationSucceeded("github_basic", reply({}, 202)), false);
  assert.equal(await revocationSucceeded("form_token", reply({}, 200)), true);
  assert.equal(await revocationSucceeded("notion_basic", reply({}, 200)), true);
  assert.equal(await revocationSucceeded("slack_auth_revoke", reply({ ok: true, revoked: false })), false);
  assert.equal(await revocationSucceeded("slack_auth_revoke", reply({ ok: true, revoked: true })), true);
  assert.equal(await revocationSucceeded("slack_auth_revoke", reply({ ok: false, error: "invalid_auth" })), false);
});

test("expiry parsing does not treat omitted, null or malformed metadata as a valid lifetime", () => {
  for (const value of [undefined, null, "", false, -1, Infinity, "tomorrow"]) assert.equal(tokenExpiresAt(value), undefined);
  assert.equal(tokenExpiresAt("3600", 0), "1970-01-01T01:00:00.000Z");
});


test("account switch before refresh dispatch does not renew or return the replacement account", async () => {
  setup();
  storeAccessToken({ ownerId: "owner", connector: "gmail", accessToken: "old", refreshToken: "refresh-a", accountLabel: "A@example.invalid", expiresAt: new Date(0).toISOString() });
  let calls = 0;
  const pending = resolveOAuthAccessToken({ ownerId: "owner", connector: "gmail", env, fetch: async () => { calls++; return reply({ access_token: "unexpected", expires_in: 3600 }); } });
  storeAccessToken({ ownerId: "owner", connector: "gmail", accessToken: "replacement", refreshToken: "refresh-b", accountLabel: "B@example.invalid", expiresAt: new Date(0).toISOString() });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  assert.equal(getAccessToken("owner", "gmail"), "replacement");
});


test("a fresh connection's successful refresh cannot erase older unresolved revocation", () => {
  setup();
  saveLocalOAuthRecovery("owner", "gmail", { connectionAt: "old-grant", status: "revocation_unknown", detail: "Review the previous account’s app access.", at: "2026-11-26T10:00:00.000Z" });
  saveLocalOAuthRecovery("owner", "gmail", { connectionAt: "new-grant", status: "refreshed", detail: "Authorization renewed.", at: "2026-11-26T10:01:00.000Z" });
  assert.equal(readLocalOAuthRecovery("owner", "gmail")!.status, "revocation_unknown");
  assert.equal(readLocalOAuthRecovery("owner", "gmail", "new-grant")!.status, "refreshed");
  const status = connectionStatus(getProvider("gmail"), "owner", env);
  assert.equal(status.recovery?.status, "revocation_unknown");
});
