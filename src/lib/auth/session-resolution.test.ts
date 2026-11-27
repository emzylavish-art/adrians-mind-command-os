import assert from "node:assert/strict";
import test from "node:test";
import { classifySessionError, reconcileSessionReads, SessionResolutionError } from "./session-resolution.ts";
const owner = { id: "owner-a", email: "a@example.test" };
test("an outage cannot select a fallback account", () => { assert.throws(() => reconcileSessionReads({ state: "unavailable" }, { state: "verified", user: owner }), (error) => error instanceof SessionResolutionError && error.status === 503); });
test("different verified identities never merge by email or provider priority", () => { assert.throws(() => reconcileSessionReads({ state: "verified", user: owner }, { state: "verified", user: { ...owner, id: "owner-b" } }), (error) => error instanceof SessionResolutionError && error.code === "identity_conflict"); });
test("a genuinely absent authority may use the other verified identity", () => { assert.deepEqual(reconcileSessionReads({ state: "absent" }, { state: "verified", user: owner }), owner); assert.equal(reconcileSessionReads({ state: "absent" }, { state: "absent" }), null); });
test("invalid credentials and missing credentials have different recovery states", () => { assert.equal(classifySessionError({ name: "AuthSessionMissingError" }, false).state, "absent"); assert.equal(classifySessionError({ name: "AuthSessionMissingError" }, true).state, "rejected"); assert.equal(classifySessionError(new TypeError("network"), false).state, "unavailable"); assert.throws(() => reconcileSessionReads({ state: "rejected" }, { state: "verified", user: owner })); });
