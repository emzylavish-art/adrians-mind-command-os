import test from "node:test";
import assert from "node:assert/strict";
import { hasSupabaseCredential, identitiesAgree, sessionFallbackAllowed } from "./identity-continuity.ts";
test("expired or revoked primary credential never falls through to a different account", () => {
  assert.equal(hasSupabaseCredential("theme=dark; sb-project-auth-token.0=fake"), true);
  assert.equal(sessionFallbackAllowed({ supabasePresented: true, supabaseVerified: false }), false);
  assert.equal(sessionFallbackAllowed({ supabasePresented: false, supabaseVerified: false }), true);
  assert.equal(identitiesAgree("owner-a", "owner-b"), false);
  assert.equal(identitiesAgree("owner-a", "owner-a"), true);
});
