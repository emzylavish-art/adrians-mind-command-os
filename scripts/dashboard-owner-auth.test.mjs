import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
const page = readFileSync("src/routes/dashboard.tsx", "utf8");
const component = readFileSync("src/components/mind/dashboard-3d/dashboard-page.tsx", "utf8");
const api = readFileSync("src/routes/api/mind/dashboard/status.ts", "utf8");
describe("public read-only dashboard contract", () => {
  it("does not gate the dashboard page on owner identity or login", () => {
    assert.doesNotMatch(page, /requireDashboardUser|beforeLoad/);
    assert.doesNotMatch(component, /Access denied|forbidden/);
    assert.match(component, /DashboardApp/);
  });
  it("serves a public read-only status snapshot with no-store headers", () => {
    assert.doesNotMatch(api, /requireUserId|isMindOwnerId|authorization/);
    assert.match(api, /buildDashboardStatus\(\)/);
    assert.match(api, /"cache-control": "no-store"/);
  });
});
