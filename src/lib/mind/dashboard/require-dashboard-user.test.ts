import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("public dashboard route", () => {
  it("renders the dashboard without a sign-in or owner gate", () => {
    const route = readFileSync(new URL("../../../routes/dashboard.tsx", import.meta.url), "utf8");
    const component = readFileSync(new URL("../../../components/mind/dashboard-3d/dashboard-page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(route, /requireDashboardUser|beforeLoad/);
    assert.match(route, /component: AgentCommandCenter/);
    const commandCenter = readFileSync(new URL("../../../components/mind/agent-command-center.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(commandCenter, /requireDashboardUser|beforeLoad|DashboardAccess|forbidden|Access denied/);
    assert.doesNotMatch(component, /DashboardAccess|forbidden|Access denied/);
    assert.match(component, /return <DashboardApp \/>/);
  });
});
