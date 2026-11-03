import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard session gate", () => {
  it("keeps verify.server out of the client route and still redirects signed-out visitors", () => {
    const route = readFileSync(new URL("../../../routes/dashboard.tsx", import.meta.url), "utf8");
    const gate = readFileSync(new URL("./require-dashboard-user.ts", import.meta.url), "utf8");
    assert.equal(/from ["']@\/lib\/auth\/verify\.server["']/.test(route), false);
    assert.match(route, /requireDashboardUser/);
    assert.match(gate, /getSessionUser/);
    assert.match(gate, /to:\s*"\/login"/);
    assert.match(gate, /dashboardLoginSearch/);
    assert.equal(gate.includes("requireUserId"), false);
  });
});
