import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORKSPACE_ROUTE_LINKS } from "./workspace-nav.ts";

describe("workspace-nav", () => {
  it("keeps Explore and Dashboard available from the Workspace navigation", () => {
    const explore = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "explore");
    const dashboard = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "dashboard");
    assert.ok(explore, "Explore workspace route link missing");
    assert.equal(explore.label, "Explore");
    assert.equal(explore.href, "/explore");
    assert.ok(dashboard, "Dashboard workspace route link missing");
    assert.equal(dashboard.label, "Dashboard");
    assert.equal(dashboard.href, "/dashboard");
  });
});
