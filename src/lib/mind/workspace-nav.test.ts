import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORKSPACE_ROUTE_LINKS } from "./workspace-nav.ts";

describe("workspace-nav", () => {
  it("keeps Explore, Dashboard, Research, Social, and the GPT wrapper available from the Workspace navigation", () => {
    const explore = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "explore");
    const dashboard = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "dashboard");
    const research = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "research");
    const social = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "social");
    const wrapper = WORKSPACE_ROUTE_LINKS.find((item) => item.id === "gpt-wrapper");
    assert.ok(explore, "Explore workspace route link missing");
    assert.equal(explore.label, "Explore");
    assert.equal(explore.href, "/explore");
    assert.ok(dashboard, "Dashboard workspace route link missing");
    assert.equal(dashboard.label, "Dashboard");
    assert.equal(dashboard.href, "/dashboard");
    assert.ok(research, "Research workspace route link missing");
    assert.equal(research.label, "Research");
    assert.equal(research.href, "/research");
    assert.ok(social, "Social workspace route link missing");
    assert.equal(social.label, "Social");
    assert.equal(social.href, "/social");
    assert.ok(wrapper, "GPT wrapper workspace route link missing");
    assert.equal(wrapper.label, "GPT wrapper");
    assert.equal(wrapper.href, "/gpt-wrapper");
  });
});
