import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPABILITIES, isVerifiedCapability } from "./registry.ts";

describe("capability labels", () => {
  it("does not call a configured key a verified integration", () => {
    const grok = CAPABILITIES.find((item) => item.id === "chat.grok");
    const voice = CAPABILITIES.find((item) => item.id === "voice");
    assert.equal(grok?.status, "configured");
    assert.equal(voice?.status, "configured");
    assert.equal(isVerifiedCapability("configured"), false);
    assert.equal(isVerifiedCapability("ready"), true);
    assert.equal(isVerifiedCapability("live_verified"), true);
  });

  it("keeps the planner configured until a live tool call is verified", () => {
    assert.equal(CAPABILITIES.find((item) => item.id === "agents")?.name, "Local workspace lookup");
    assert.equal(CAPABILITIES.find((item) => item.id === "agents")?.status, "ready");
    assert.equal(CAPABILITIES.find((item) => item.id === "agents.planner")?.status, "configured");
    assert.equal(isVerifiedCapability("configured"), false);
  });

  it("does not call an unhealthy REA install or in-memory database ready", () => {
    assert.equal(CAPABILITIES.find((item) => item.id === "rea")?.status, "blocked");
    assert.equal(CAPABILITIES.find((item) => item.id === "supabase")?.status, "blocked");
    assert.match(CAPABILITIES.find((item) => item.id === "supabase")?.why ?? "", /not cloud backup/);
    assert.equal(CAPABILITIES.find((item) => item.id === "research")?.status, "unconfigured");
  });
});
