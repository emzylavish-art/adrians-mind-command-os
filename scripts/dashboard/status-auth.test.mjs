import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/api/mind/dashboard/status.ts", "utf8");

test("dashboard status is intentionally public and read-only", () => {
  assert.match(route, /Public read-only status snapshot/);
  assert.match(route, /await buildDashboardStatus\\(\\)/);
  assert.doesNotMatch(route, /requireUserId|isMindOwnerId|getSessionUser/);
  assert.doesNotMatch(route, /POST:|PUT:|PATCH:|DELETE:/);
});

test("public status does not trust caller-supplied identity", () => {
  assert.doesNotMatch(route, /request\\.json\\(\\)|searchParams\\.get\\(["']userId/);
});

test("dashboard status response is uncached and hardens browser interpretation", () => {
  assert.match(route, /["']cache-control["']:\\s*["']no-store["']/);
  assert.match(route, /["']x-content-type-options["']:\\s*["']nosniff["']/);
  assert.match(route, /["']referrer-policy["']:\\s*["']strict-origin-when-cross-origin["']/);
  assert.match(route, /["']x-frame-options["']:\\s*["']DENY["']/);
});
