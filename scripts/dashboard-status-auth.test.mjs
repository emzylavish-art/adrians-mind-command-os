import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync("src/routes/api/mind/dashboard/status.ts", "utf8");

describe("dashboard status API access and response contract", () => {
  it("serves the read-only dashboard snapshot without requiring a session", () => {
    assert.doesNotMatch(route, /requireUserId|isMindOwnerId|getSessionUser/);
    assert.match(route, /GET:\\s*async\\s*\\(\\s*\\)/);
    assert.match(route, /await buildDashboardStatus\\(\\)/);
    assert.match(route, /Public read-only status snapshot/);
  });

  it("does not accept caller-supplied identity or expose mutation handlers", () => {
    assert.doesNotMatch(route, /request\\.json\\(\\)|searchParams\\.get\\(["']userId/);
    assert.doesNotMatch(route, /POST:|PUT:|PATCH:|DELETE:/);
  });

  it("keeps responses uncached and applies browser response hardening", () => {
    assert.match(route, /["']cache-control["']:\\s*["']no-store["']/);
    assert.match(route, /["']x-content-type-options["']:\\s*["']nosniff["']/);
    assert.match(route, /["']referrer-policy["']:\\s*["']strict-origin-when-cross-origin["']/);
    assert.match(route, /["']x-frame-options["']:\\s*["']DENY["']/);
    assert.match(route, /Unable to load dashboard status\\./);
    assert.doesNotMatch(route, /error instanceof Error \\? error\\.message/);
  });
});
