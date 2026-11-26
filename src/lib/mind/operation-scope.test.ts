import test from "node:test";
import assert from "node:assert/strict";
import { createOperationScope } from "./operation-scope.ts";
import { sessionInstanceId } from "../auth/session-identity.ts";

test("late results and cleanup cannot cross A-B-A login epochs", () => {
  const scope = createOperationScope(); scope.bind("a", "session1");
  const old = scope.begin("image");
  scope.bind("b", "session2"); scope.bind("a", "session3");
  const current = scope.begin("image");
  assert.equal(scope.current(old), false); assert.equal(scope.finish(old), false);
  assert.equal(scope.current(current), true); assert.equal(scope.finish(current), true);
});
test("retry owns its callbacks and independent research can finish alongside chat", () => {
  const scope = createOperationScope(); scope.bind("a");
  const first = scope.begin("research"); const chat = scope.begin("chat");
  const retry = scope.begin("research");
  assert.equal(scope.finish(first), false);
  assert.equal(scope.finish(chat), true); assert.equal(scope.current(retry), true);
  scope.invalidate(); assert.equal(scope.finish(retry), false);
});

test("same-owner cookie reauthentication invalidates old operations without requiring an observed sign-out", () => {
  const scope = createOperationScope();
  scope.bind("owner", sessionInstanceId({ id: "first-login", token: "never-used" })!);
  const old = scope.begin("video");
  scope.bind("owner", sessionInstanceId({ id: "second-login", token: "never-used" })!);
  assert.equal(scope.current(old), false);
  const current = scope.begin("video");
  scope.bind("owner", sessionInstanceId({ id: "second-login", updatedAt: "2026-04-01T00:00:00Z", token: "changed-not-a-new-login" })!);
  assert.equal(scope.current(current), true, "token refresh preserves the login instance");
  assert.equal(sessionInstanceId({ token: "must-not-become-an-identity" }), null);
});
