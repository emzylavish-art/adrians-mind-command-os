import assert from "node:assert/strict";
import { test } from "node:test";
import { VISUAL_FIXTURES, fixtureRequestDecision, fixtureResponse, installVisualFixture } from "./fixture-states.mjs";
test("AA100 deterministic states refuse external hosts, RPC writes and unrecognized operations", () => {
  assert.throws(() => fixtureRequestDecision("https://adrians-mind.vercel.app", "https://adrians-mind.vercel.app/", "GET"), /local preview/);
  for (const url of ["https://api.x.ai/v1/chat", "https://notion.so", "http://localhost:9999/"]) assert.equal(fixtureRequestDecision("http://localhost:8080", url, "GET"), "block");
  assert.equal(fixtureRequestDecision("http://localhost:8080", "http://localhost:8080/_serverFn/save", "POST"), "fixture");
  assert.equal(fixtureRequestDecision("http://localhost:8080", "http://localhost:8080/unknown", "DELETE"), "block");
  for (const name of Object.keys(VISUAL_FIXTURES)) {
    assert.equal(fixtureResponse(name, "POST", "/api/mind/paid-live-provider").status, 503);
    assert.equal(fixtureResponse(name, "POST", "/_serverFn/save").status, 503);
  }
  assert.equal(fixtureResponse("build-revision-conflict", "POST", "/api/mind/build/files", { operation: "write" }).status, 409);
  assert.equal(fixtureResponse("settings-save-failed", "PUT", "/api/mind/resources").status, 503);
});
test("AA100 actual fixture installer routes rather than forwards every API request", async () => {
  await assert.rejects(installVisualFixture({}, "http://localhost:8080", "plugins-connected"), /cannot isolate WebSockets/);
  let handler; let seed; let socketsBlocked = false;
  await installVisualFixture({ route: async (_pattern, fn) => { handler = fn; }, routeWebSocket: async () => { socketsBlocked = true; }, addInitScript: async (_fn, data) => { seed = data; } }, "http://localhost:8080", "plugins-permission-denied");
  let response;
  await handler({ request: () => ({ method: () => "POST", url: () => "http://localhost:8080/api/mind/build/session", postDataJSON: () => ({ prompt: "must not execute" }) }), fulfill: async (value) => { response = value; }, continue: () => assert.fail("Live mutation forwarded") });
  assert.equal(response.status, 503); assert.equal(socketsBlocked, true); assert.equal(seed.fixtureId, "plugins-permission-denied");
  assert.equal(seed.workspace.connections.length, 0);
});
