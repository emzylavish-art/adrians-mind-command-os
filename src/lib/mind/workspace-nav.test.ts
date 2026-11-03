import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORKSPACE_ROUTE_LINKS } from "./workspace-nav.ts";

describe("workspace-nav", () => {
  it("includes Dashboard linking to /dashboard", () => {
    const dash = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "dashboard");
    assert.ok(dash, "Dashboard workspace route link missing");
    assert.equal(dash.label, "Dashboard");
    assert.equal(dash.href, "/dashboard");
    assert.equal(dash.iconSrc, "/icons/dashboard.svg");
  });

  it("includes Explore linking to /explore", () => {
    const explore = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "explore");
    assert.ok(explore, "Explore workspace route link missing");
    assert.equal(explore.label, "Explore");
    assert.equal(explore.href, "/explore");
    assert.ok(explore.iconSrc.startsWith("/icons/"));
  });
});
