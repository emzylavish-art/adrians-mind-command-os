import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { oauthStatusFailure } from "./status-http.ts";

describe("OAuth status error sanitization", () => {
  it("returns a true 401 for an unauthenticated visitor", () => {
    const status = oauthStatusFailure(new Error("Unauthorized"));
    assert.equal(status.status, 401);
    assert.match(status.body.detail, /sign in required/);
  });
  it("reports upstream database errors as 503 without leaking their message", () => {
    const secret = "postgres://admin:password@example.com/secret";
    const status = oauthStatusFailure(new Error("Database connection failed " + secret));
    assert.equal(status.status, 503);
    assert.equal(JSON.stringify(status).includes(secret), false);
    assert.equal(status.body.state, "unavailable");
  });
  it("does not treat unexpected exceptions as a 403 permission denial", () => {
    const status = oauthStatusFailure(new TypeError("socket disconnected"));
    assert.equal(status.status, 503);
  });
});
