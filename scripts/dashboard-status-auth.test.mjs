import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync("src/routes/api/mind/dashboard/status.ts", "utf8");

describe("dashboard status API access and response contract", () => {
  it("serves the read-only dashboard snapshot without requiring a session", () => {
    assert.ok(route.includes("Public read-only status snapshot"));
    assert.ok(route.includes("GET: async () =>"));
    assert.ok(route.includes("await buildDashboardStatus()"));
    assert.doesNotMatch(route, /requireUserId|isMindOwnerId|getSessionUser/);
  });

  it("does not accept caller-supplied identity or expose mutation handlers", () => {
    assert.doesNotMatch(route, /request\.json\(\)|searchParams\.get\(["']userId/);
    assert.doesNotMatch(route, /POST:|PUT:|PATCH:|DELETE:/);
  });

  it("keeps responses uncached and applies browser response hardening", () => {
    assert.ok(route.includes('"cache-control": "no-store"'));
    assert.ok(route.includes('"x-content-type-options": "nosniff"'));
    assert.ok(route.includes('"referrer-policy": "strict-origin-when-cross-origin"'));
    assert.ok(route.includes('"x-frame-options": "DENY"'));
    assert.ok(route.includes("Unable to load dashboard status."));
  });
});
