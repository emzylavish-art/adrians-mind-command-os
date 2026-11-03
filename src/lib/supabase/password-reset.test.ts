import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PASSWORD_RESET_PATH,
  PASSWORD_RESET_REDIRECT,
  PASSWORD_RESET_REQUEST_NEUTRAL,
  buildFirstPartyResetUrl,
  canSubmitPasswordReset,
  firstPartyUrlFromGenerateLink,
  parsePasswordResetSearch,
  validateNewPassword,
} from "./password-reset.ts";

describe("password-reset helpers", () => {
  it("builds a first-party reset URL that never points at supabase.co", () => {
    const url = buildFirstPartyResetUrl({
      tokenHash: "abc123",
      type: "recovery",
    });
    assert.equal(
      url,
      "https://adrians-mind.vercel.app/auth/reset?token_hash=abc123&type=recovery",
    );
    assert.ok(!url.includes("supabase.co"));
    assert.equal(PASSWORD_RESET_REDIRECT.endsWith(PASSWORD_RESET_PATH), true);
  });

  it("parses token_hash / code / error from the reset landing search", () => {
    assert.deepEqual(
      parsePasswordResetSearch({
        token_hash: "tok",
        type: "recovery",
        error_description: "expired",
      }),
      { tokenHash: "tok", type: "recovery", code: "", error: "expired" },
    );
    assert.deepEqual(parsePasswordResetSearch({ code: "pkce-code" }), {
      tokenHash: "",
      type: "recovery",
      code: "pkce-code",
      error: "",
    });
    assert.deepEqual(parsePasswordResetSearch(null), {
      tokenHash: "",
      type: "recovery",
      code: "",
      error: "",
    });
  });

  it("validates new passwords and submit readiness", () => {
    assert.equal(validateNewPassword("short").ok, false);
    assert.equal(validateNewPassword("long-enough").ok, true);
    assert.equal(
      canSubmitPasswordReset({ tokenHash: "t", code: "", password: "short" }),
      false,
    );
    assert.equal(
      canSubmitPasswordReset({ tokenHash: "", code: "", password: "long-enough" }),
      false,
    );
    assert.equal(
      canSubmitPasswordReset({
        tokenHash: "t",
        code: "",
        password: "long-enough",
      }),
      true,
    );
    assert.equal(
      canSubmitPasswordReset({
        tokenHash: "",
        code: "c",
        password: "long-enough",
      }),
      true,
    );
  });

  it("maps admin generateLink hashed_token to a first-party URL", () => {
    const url = firstPartyUrlFromGenerateLink({
      hashedToken: "hash_1",
      redirectTo: PASSWORD_RESET_REDIRECT,
    });
    assert.equal(
      url,
      "https://adrians-mind.vercel.app/auth/reset?token_hash=hash_1&type=recovery",
    );
    assert.equal(firstPartyUrlFromGenerateLink({ hashedToken: "" }), null);
    assert.ok(PASSWORD_RESET_REQUEST_NEUTRAL.toLowerCase().includes("if an account"));
  });
});
