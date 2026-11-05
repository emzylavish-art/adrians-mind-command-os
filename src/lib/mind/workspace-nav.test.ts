import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIDEBAR_WORKSPACE_NAV_IDS,
  WORKSPACE_ROUTE_LINKS,
  isSidebarWorkspaceRoute,
} from "./workspace-nav.ts";

describe("workspace-nav", () => {
  it("keeps only Library, Projects, and Scheduled in the sidebar's in-app workspace group", () => {
    assert.deepEqual(SIDEBAR_WORKSPACE_NAV_IDS, ["files", "projects", "scheduled"]);
  });

  it("puts Explore in the sidebar and keeps Dashboard available as an app route", () => {
    const explore = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "explore");
    const dashboard = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "dashboard");
    assert.ok(explore, "Explore workspace route link missing");
    assert.equal(explore.label, "Explore");
    assert.equal(explore.href, "/explore");
    assert.ok(dashboard, "Dashboard workspace route link missing");
    assert.equal(dashboard.label, "Dashboard");
    assert.equal(dashboard.href, "/dashboard");
    assert.equal(isSidebarWorkspaceRoute("explore"), true);
    assert.equal(isSidebarWorkspaceRoute("dashboard"), false);
  });
});
