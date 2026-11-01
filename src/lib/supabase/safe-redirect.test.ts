import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath, SAFE_REDIRECT_DEFAULT } from "./safe-redirect.ts";

describe("safeRedirectPath", () => {
  it("defaults to /dashboard", () => {
    assert.equal(safeRedirectPath(undefined), SAFE_REDIRECT_DEFAULT);
    assert.equal(safeRedirectPath(null), SAFE_REDIRECT_DEFAULT);
    assert.equal(safeRedirectPath(""), SAFE_REDIRECT_DEFAULT);
  });

  it("allows same-origin relative paths", () => {
    assert.equal(safeRedirectPath("/dashboard"), "/dashboard");
    assert.equal(safeRedirectPath("/settings?tab=voice"), "/settings?tab=voice");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    assert.equal(safeRedirectPath("https://evil.example/phish"), SAFE_REDIRECT_DEFAULT);
    assert.equal(safeRedirectPath("//evil.example"), SAFE_REDIRECT_DEFAULT);
    assert.equal(safeRedirectPath("http://localhost/dashboard"), SAFE_REDIRECT_DEFAULT);
  });

  it("rejects backslash and control characters", () => {
    assert.equal(safeRedirectPath("/\\evil"), SAFE_REDIRECT_DEFAULT);
    assert.equal(safeRedirectPath("/dash\nboard"), SAFE_REDIRECT_DEFAULT);
  });

  it("rejects paths that do not start with /", () => {
    assert.equal(safeRedirectPath("dashboard"), SAFE_REDIRECT_DEFAULT);
    assert.equal(safeRedirectPath(" login"), SAFE_REDIRECT_DEFAULT);
  });
});
