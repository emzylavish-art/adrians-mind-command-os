import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMAND_DEEP_LINK_PATHS, viewForDeepLinkPath } from "./deep-link-views.ts";

describe("command deep-link paths", () => {
  it("lists the shareable SPA paths that must not 404", () => {
    assert.deepEqual(
      [...COMMAND_DEEP_LINK_PATHS].sort(),
      [
        "/app",
        "/artifacts",
        "/chat",
        "/command",
        "/connectors",
        "/library",
        "/mcp",
        "/projects",
        "/settings",
        "/tools",
        "/voice",
      ].sort(),
    );
  });

  it("maps each path to a CommandApp view (never dashboard)", () => {
    for (const path of COMMAND_DEEP_LINK_PATHS) {
      const view = viewForDeepLinkPath(path);
      assert.ok(view, `missing view for ${path}`);
      assert.notEqual(view, "dashboard");
    }
    assert.equal(viewForDeepLinkPath("/settings"), "settings");
    assert.equal(viewForDeepLinkPath("/library"), "files");
    assert.equal(viewForDeepLinkPath("/projects"), "projects");
    assert.equal(viewForDeepLinkPath("/voice"), "command");
    assert.equal(viewForDeepLinkPath("/connectors"), "connected");
    assert.equal(viewForDeepLinkPath("/artifacts"), "files");
    assert.equal(viewForDeepLinkPath("/mcp"), "tools");
    assert.equal(viewForDeepLinkPath("/tools"), "tools");
    assert.equal(viewForDeepLinkPath("/chat"), "chat");
    assert.equal(viewForDeepLinkPath("/command"), "command");
    assert.equal(viewForDeepLinkPath("/app"), "command");
    assert.equal(viewForDeepLinkPath("/dashboard"), null);
  });
});
