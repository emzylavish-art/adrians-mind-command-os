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
  assert.match(route, /request\.headers\.get\(["']authorization["']\)/);
  assert.match(route, /authorization\?\.toLowerCase\(\)\.startsWith\(["']bearer ["']\)/);
  assert.doesNotMatch(route, /request\.json\(\)|searchParams\.get\(["']userId/);
});

test("unauthorized and verifier failures return stable non-sensitive errors", () => {
  assert.match(route, /error\.message\s*===\s*["']Unauthorized["']/);
  assert.match(route, /Sign in is required\./);
  assert.match(route, /Unable to verify session\./);
  assert.match(route, /unauthorized\s*\?\s*401\s*:\s*500/);
  assert.match(route, /Unable to load dashboard status\./);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
});

test("dashboard status response is private and hardens browser interpretation", () => {
  assert.match(route, /["']cache-control["']:\s*["']no-store["']/);
  assert.match(route, /["']x-content-type-options["']:\s*["']nosniff["']/);
  assert.match(route, /["']referrer-policy["']:\s*["']strict-origin-when-cross-origin["']/);
  assert.match(route, /["']x-frame-options["']:\s*["']DENY["']/);
});
