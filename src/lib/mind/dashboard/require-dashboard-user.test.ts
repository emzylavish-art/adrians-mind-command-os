import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard session gate", () => {
  it("keeps verification server-only, redirects signed-out visitors, and serializes authenticated access", () => {
    const route = readFileSync(new URL("../../../routes/dashboard.tsx", import.meta.url), "utf8");
    const component = readFileSync(new URL("../../../components/mind/dashboard-3d/dashboard-page.tsx", import.meta.url), "utf8");
    const gate = readFileSync(new URL("./require-dashboard-user.ts", import.meta.url), "utf8");
    assert.equal(/from ["']@\/lib\/auth\/verify\.server["']/.test(route), false);
    assert.match(route, /requireDashboardUser/);
    assert.match(gate, /getSessionUser/);
    assert.match(gate, /to:\s*"\/login"/);
    assert.match(gate, /dashboardLoginSearch/);
    assert.equal(gate.includes("requireUserId"), false);
    assert.match(gate, /export type DashboardAccess/);
    assert.match(gate, /return \{ forbidden: true \}/);
    assert.match(gate, /forbidden: false/);
    assert.doesNotMatch(gate, /throw new Response\("Forbidden"/);
    assert.match(route, /access: await requireDashboardUser\(\)/);
    assert.match(route, /import \{ DashboardPage \} from "@\/components\/mind\/dashboard-3d\/dashboard-page"/);
    assert.match(route, /component: DashboardPage/);
    assert.match(component, /getRouteApi\("\/dashboard"\)/);
    assert.match(component, /if \(access\.forbidden\)/);
    assert.match(component, /Access denied/);
    assert.match(component, /return <DashboardApp \/>/);
  });
});
