import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/api/mind/dashboard/status.ts", "utf8");

test("dashboard status is intentionally public and read-only", () => {
  assert.ok(route.includes("Public read-only status snapshot"));
  assert.ok(route.includes("await buildDashboardStatus()"));
  assert.doesNotMatch(route, /requireUserId|isMindOwnerId|getSessionUser/);
  assert.doesNotMatch(route, /POST:|PUT:|PATCH:|DELETE:/);
});

test("public status does not trust caller-supplied identity", () => {
  assert.doesNotMatch(route, /request\.json\(\)|searchParams\.get\(["']userId/);
});

test("dashboard status response is uncached and hardens browser interpretation", () => {
  assert.ok(route.includes('"cache-control": "no-store"'));
  assert.ok(route.includes('"x-content-type-options": "nosniff"'));
  assert.ok(route.includes('"referrer-policy": "strict-origin-when-cross-origin"'));
  assert.ok(route.includes('"x-frame-options": "DENY"'));
});
