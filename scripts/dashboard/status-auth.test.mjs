import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/api/mind/dashboard/status.ts", "utf8");

test("dashboard status verifies the session before returning private status", () => {
  const authCheck = route.indexOf("await requireUserId(bearer)");
  const statusBuild = route.indexOf("await buildDashboardStatus()");
  assert.notEqual(authCheck, -1);
  assert.notEqual(statusBuild, -1);
  assert.ok(authCheck < statusBuild, "session must be verified before reading status");
});

test("dashboard status is non-cacheable and does not expose internal failures", () => {
  assert.match(route, /["']cache-control["']:\s*["']no-store["']/);
  assert.match(route, /["']x-content-type-options["']:\s*["']nosniff["']/);
  assert.match(route, /Unable to load dashboard status\./);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
});
