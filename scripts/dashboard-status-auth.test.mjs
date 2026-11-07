import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync("src/routes/api/mind/dashboard/status.ts", "utf8");

describe("dashboard status API access and response contract", () => {
  it("requires a verified user before building or returning dashboard status", () => {
    assert.match(route, /import\s*\{\s*requireUserId\s*\}\s*from\s*["']@\/lib\/auth\/verify\.server["']/);
    assert.match(route, /GET:\s*async\s*\(\{\s*request\s*\}\)\s*=>/);
    const authIndex = route.indexOf("await requireUserId(");
    const buildIndex = route.indexOf("await buildDashboardStatus()");
    assert.ok(authIndex >= 0, "GET handler must resolve an authenticated user");
    assert.ok(buildIndex > authIndex, "status data must not be built before authentication");
  });

  it("accepts an existing bearer session without trusting a caller-supplied user id", () => {
    assert.match(route, /request\.headers\.get\(["']authorization["']\)/);
    assert.match(route, /authorization\?\.toLowerCase\(\)\.startsWith\(["']bearer ["']\)/);
    assert.match(route, /await requireUserId\(bearer\)/);
    assert.doesNotMatch(route, /request\.json\(\)|searchParams\.get\(["']userId/);
  });

  it("returns a stable 401 for unauthenticated requests and does not expose verifier details", () => {
    assert.match(route, /error\.message\s*===\s*["']Unauthorized["']/);
    assert.match(route, /unauthorized\s*\?\s*401\s*:\s*500/);
    assert.match(route, /Sign in is required\./);
    assert.match(route, /Unable to verify session\./);
  });

  it("keeps dashboard responses private and applies basic response hardening", () => {
    assert.match(route, /["']cache-control["']:\s*["']no-store["']/);
    assert.match(route, /["']x-content-type-options["']:\s*["']nosniff["']/);
    assert.match(route, /["']referrer-policy["']:\s*["']strict-origin-when-cross-origin["']/);
    assert.match(route, /["']x-frame-options["']:\s*["']DENY["']/);
    assert.match(route, /Unable to load dashboard status\./);
    assert.doesNotMatch(route, /JSON\.stringify\(\s*\{\s*ok:\s*false,\s*error\s*\}\s*,\s*500\s*\)/);
  });
});
