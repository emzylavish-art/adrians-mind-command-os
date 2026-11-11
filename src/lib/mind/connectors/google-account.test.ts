import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailFromGoogleUserinfo } from "./google-account.server.ts";

describe("google account email", () => {
  it("keeps a real mailbox and ignores a scope name", () => {
    assert.equal(emailFromGoogleUserinfo({ email: "emzylavish@gmail.com" }), "emzylavish@gmail.com");
    assert.equal(emailFromGoogleUserinfo({ email: "userinfo.email" }), null);
    assert.equal(emailFromGoogleUserinfo({}), null);
  });
});
