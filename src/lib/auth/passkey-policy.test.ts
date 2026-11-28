import assert from "node:assert/strict";
import { test } from "node:test";
import { freshPasskeySession, passkeyAccess, passkeyConfiguration } from "./passkey-policy.ts";

test("passkeys require the fixed Better Auth origin", () => {
  const production = {
    ADRIAN_PASSKEY_ORIGIN: "https://app.example",
    BETTER_AUTH_URL: "https://app.example/",
    NODE_ENV: "production",
  };
  assert.deepEqual(passkeyConfiguration(production), { origin: "https://app.example", rpID: "app.example" });
  for (const origin of ["https://elsewhere.example", "http://app.example", "https://app.example:8080",
    "https://app.example/login", "https://app.example/?query=1", "https://user@app.example"]) {
    assert.equal(passkeyConfiguration({ ...production, ADRIAN_PASSKEY_ORIGIN: origin }), null);
  }
  assert.equal(passkeyConfiguration({ ...production, VITE_AUTH_ENABLED: "false" }), null);
  assert.equal(passkeyConfiguration({ ...production, BETTER_AUTH_URL: "https://app.example/staging" }), null);
});

test("HTTP passkeys are limited to explicit localhost development", () => {
  const local = { ADRIAN_PASSKEY_ORIGIN: "http://localhost:8080", BETTER_AUTH_URL: "http://localhost:8080" };
  assert.equal(passkeyConfiguration(local)?.rpID, "localhost");
  assert.equal(passkeyConfiguration({ ...local, NODE_ENV: "production" }), null);
  assert.equal(passkeyConfiguration({ ...local, VERCEL: "1" }), null);
  const ip = { ADRIAN_PASSKEY_ORIGIN: "http://127.0.0.1:8080", BETTER_AUTH_URL: "http://127.0.0.1:8080" };
  assert.equal(passkeyConfiguration(ip), null);
});

test("passkey routes classify exact sign-in, read, and credential-mutation actions", () => {
  assert.equal(passkeyAccess("/api/auth/sign-in/email"), null);
  assert.equal(passkeyAccess("/api/auth/passkey/verify-authentication"), "sign-in");
  assert.equal(passkeyAccess("/api/auth/passkey/list-user-passkeys"), "read");
  assert.equal(passkeyAccess("/api/auth/%70asskey/delete-passkey"), "change");
  assert.equal(passkeyAccess("/api/auth/passkey/verify-registration/"), "unknown");
  assert.equal(passkeyAccess("/api/auth/passkey"), "unknown");
});

test("credential changes require a session less than five minutes old", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  assert.equal(freshPasskeySession(new Date(now - 299_999), now), true);
  assert.equal(freshPasskeySession(new Date(now - 300_000), now), false);
  assert.equal(freshPasskeySession(new Date(now + 1), now), false);
  assert.equal(freshPasskeySession("invalid", now), false);
});
