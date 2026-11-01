import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAuthCallbackUrl } from "./oauth-redirect.ts";

describe("buildAuthCallbackUrl", () => {
  it("uses the request origin so preview hosts work", () => {
    assert.equal(
      buildAuthCallbackUrl("https://adrians-mind-git-preview-ui-completion.vercel.app", "/dashboard"),
      "https://adrians-mind-git-preview-ui-completion.vercel.app/auth/callback?next=%2Fdashboard",
    );
  });

  it("strips a trailing slash on origin", () => {
    assert.equal(
      buildAuthCallbackUrl("http://127.0.0.1:8104/", "/dashboard"),
      "http://127.0.0.1:8104/auth/callback?next=%2Fdashboard",
    );
  });

  it("falls back to /dashboard for unsafe next values", () => {
    assert.equal(
      buildAuthCallbackUrl("https://example.com", "https://evil.test"),
      "https://example.com/auth/callback?next=%2Fdashboard",
    );
  });
});
