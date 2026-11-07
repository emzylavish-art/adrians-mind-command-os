import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAuthCallback } from "./callback.server.ts";

describe("OAuth callback redirect response", () => {
  it("returns a mutable no-store redirect with the safe next path", async () => {
    const response = await handleAuthCallback(
      new Request("https://example.test/auth/callback?error=denied&next=%2Fdashboard"),
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin, "https://example.test");
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), "/dashboard");
    response.headers.delete("set-cookie");
    response.headers.append("set-cookie", "first=1; Path=/; HttpOnly");
    response.headers.append("set-cookie", "second=2; Path=/; HttpOnly");
    assert.equal(response.headers.getSetCookie().length, 2);
  });
  it("blocks external next redirects", async () => {
    const response = await handleAuthCallback(
      new Request("https://example.test/auth/callback?error=denied&next=%2F%2Fevil.test"),
    );
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.get("next"), "/dashboard");
  });
});
