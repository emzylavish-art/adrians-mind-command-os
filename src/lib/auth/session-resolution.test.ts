import assert from "node:assert/strict";
import test from "node:test";
import { classifySessionError, reconcileSessionReads, SessionResolutionError } from "./session-resolution.ts";
import { handleSessionIdentity } from "./session-http.ts";
const owner = { id: "owner-a", email: "a@example.test" };
test("an outage cannot select a fallback account", () => { assert.throws(() => reconcileSessionReads({ state: "unavailable" }, { state: "verified", user: owner }), (error) => error instanceof SessionResolutionError && error.status === 503); });
test("different verified identities never merge by email or provider priority", () => { assert.throws(() => reconcileSessionReads({ state: "verified", user: owner }, { state: "verified", user: { ...owner, id: "owner-b" } }), (error) => error instanceof SessionResolutionError && error.code === "identity_conflict"); });
test("a genuinely absent authority may use the other verified identity", () => { assert.deepEqual(reconcileSessionReads({ state: "absent" }, { state: "verified", user: owner }), { ...owner, sessionSource: "better-auth" }); assert.equal(reconcileSessionReads({ state: "absent" }, { state: "absent" }), null); });
test("invalid credentials and missing credentials have different recovery states", () => { assert.equal(classifySessionError({ name: "AuthSessionMissingError" }, false).state, "absent"); assert.equal(classifySessionError({ name: "AuthSessionMissingError" }, true).state, "rejected"); assert.equal(classifySessionError(new TypeError("network"), false).state, "unavailable"); assert.throws(() => reconcileSessionReads({ state: "rejected" }, { state: "verified", user: owner })); });

test("canonical identity endpoint preserves authority and does not collapse a conflict or rejected credential into an outage", async () => {
  const request = new Request("https://mind.test/api/mind/session");
  const verified = { state: "verified", user: owner } as const;
  const absent = { state: "absent" } as const;
  for (const [primary, secondary, authority] of [[verified, absent, "supabase"], [absent, verified, "better-auth"], [verified, verified, "both"]] as const) {
    const response = await handleSessionIdentity(request, async () => reconcileSessionReads(primary, secondary));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.sessionSource, authority);
  }
  const conflict = await handleSessionIdentity(request, async () => reconcileSessionReads(verified, { state: "verified", user: { id: "other", email: "other@example.test" } }));
  assert.equal(conflict.status, 409);
  const body = await conflict.json();
  assert.equal(body.status, "conflict");
  assert.equal(body.user, null);
  assert.doesNotMatch(JSON.stringify(body), /example\.test/);
  const rejected = await handleSessionIdentity(request, async () => reconcileSessionReads(verified, { state: "rejected" }));
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).code, "session_rejected");
});
