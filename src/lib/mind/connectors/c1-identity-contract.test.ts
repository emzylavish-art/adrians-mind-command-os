import assert from "node:assert/strict";
import { after, test } from "node:test";
import { dbSource, getSql } from "../../db.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { newOAuthState, sameExternalAccount, type ConnectorId, type StoredConnection } from "./store.ts";
import { clearDurableConnection, readDurableConnection, saveDurableConnection, saveDurablePendingOAuth, takeDurablePendingOAuth, updateDurableAccountIdentity } from "./durable-oauth.server.ts";
import { labelFromGoogle } from "./oauth-provider.ts";
import { googleAccountIdentity, identityFromGoogleUserinfo } from "./google-account.server.ts";

const owner = "c1-identity-fixture";
async function save(connector: ConnectorId, subject: string, refreshToken?: string, accountLabel = `${subject}@example.test`) {
  const { state, codeVerifier } = newOAuthState();
  const claim = newOAuthState().state;
  await saveDurablePendingOAuth({ ownerId: owner, connector, state, codeVerifier, redirectUri: "https://fixture.invalid", createdAt: new Date().toISOString() });
  assert.ok(await takeDurablePendingOAuth(state, claim));
  return saveDurableConnection({ ownerId: owner, connector, accessToken: "access-" + subject, externalAccountId: subject, accountLabel, refreshToken }, claim);
}

test("C1 AA002: delayed Google identity cannot overwrite any replacement grant, even at one timestamp", async () => {
  assert.equal(dbSource, "pglite", "isolated embedded database only");
  process.env.CONNECTOR_TOKEN_SECRET = "c1-fixture-not-a-real-secret";
  for (const connector of ["gmail", "google_calendar", "google_drive", "youtube"] as const) {
    const a = await save(connector, "A", "refresh-A", "Google account");
    let release!: (value: { email: string; subject: string }) => void;
    const identity = new Promise<{ email: string; subject: string }>((resolve) => { release = resolve; });
    const pending = labelFromGoogle(owner, connector, a, { lookup: async (token) => { assert.equal(token, "access-A"); return identity; } });
    const b = await save(connector, "B", "refresh-B");
    await (await getSql()).query("UPDATE mind_oauth_connections SET connected_at=$3 WHERE owner_id=$1 AND connector=$2", [owner, connector, a.connectedAt]);
    assert.notEqual(a.grantGeneration, b.grantGeneration);
    release({ email: "A@example.test", subject: "A" });
    const result = await pending;
    assert.equal(result?.accountLabel, "B@example.test");
    assert.equal(result?.externalAccountId, "B");
    assert.equal(decryptSecret(result?.refreshTokenEnc ?? ""), "refresh-B");
    assert.equal(await updateDurableAccountIdentity(a, { email: "late@example.test", subject: "A" }), false);
  }
});

test("C1 AA002: disconnect/reconnect, unknown identity, and valid same-sub renewal preserve ownership", async () => {
  process.env.CONNECTOR_TOKEN_SECRET = "c1-fixture-not-a-real-secret";
  const a = await save("gmail", "A", "refresh-A");
  await clearDurableConnection(owner, "gmail");
  assert.equal(await updateDurableAccountIdentity(a, { email: "A@example.test", subject: "A" }), false);
  assert.equal(await readDurableConnection(owner, "gmail"), null);
  const b = await save("gmail", "B", "refresh-B", "same@example.test");
  assert.equal(await updateDurableAccountIdentity(a, { email: "same@example.test", subject: "A" }), false);
  const other = await save("gmail", "A", undefined, "same@example.test");
  assert.equal(other.refreshTokenEnc, undefined, "equal emails do not authorize refresh-token reuse");
  const legacy: StoredConnection = { ...b, externalAccountId: undefined, accessTokenEnc: encryptSecret("legacy").ciphertext };
  assert.equal(sameExternalAccount(legacy, { accountLabel: "same@example.test" }), false);
  await save("gmail", "B", "refresh-B");
  const renewal = await save("gmail", "B", undefined, "renamed@example.test");
  assert.equal(decryptSecret(renewal.refreshTokenEnc ?? ""), "refresh-B");
  assert.equal(renewal.accountLabel, "renamed@example.test");
});

test("C1 AA002: identity parsing uses verified endpoint sub and bounds an unresponsive lookup", async () => {
  assert.deepEqual(identityFromGoogleUserinfo({ email: "same@example.test", sub: "123" }), { email: "same@example.test", subject: "123" });
  assert.equal(identityFromGoogleUserinfo({ email: "same@example.test", id: "untrusted-legacy-id" }).subject, null);
  let endpoint = "";
  const identity = await googleAccountIdentity("fake-access", async (url) => {
    endpoint = url;
    return { ok: true, json: async () => ({ sub: "subject", email: "A@example.test" }) };
  });
  assert.equal(endpoint, "https://openidconnect.googleapis.com/v1/userinfo");
  assert.equal(identity?.subject, "subject");
  assert.equal(await googleAccountIdentity("fake-access", () => new Promise(() => undefined), 5), null);
});

// Close the embedded fixture backend so the normal Node test worker exits cleanly.
after(async () => {
  const globals = globalThis as typeof globalThis & { __pgBootstrapPromise__?: Promise<void>; __pgliteInstance__?: Promise<{ close(): Promise<void> }> };
  await globals.__pgBootstrapPromise__;
  if (globals.__pgliteInstance__) await (await globals.__pgliteInstance__).close();
});
