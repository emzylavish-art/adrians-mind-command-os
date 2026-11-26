import assert from "node:assert/strict";
import test from "node:test";
import { publicSessionRows, sessionToRevoke } from "./session-center.ts";
test("session center never publishes tokens and cannot revoke another owner or current session", () => {
  const rows = [{ id: "current", userId: "a", token: "secret-a", createdAt: "", updatedAt: "", expiresAt: "" }, { id: "other", userId: "b", token: "secret-b", createdAt: "", updatedAt: "", expiresAt: "" }, { id: "old", userId: "a", token: "secret-old", createdAt: "", updatedAt: "", expiresAt: "" }];
  assert.equal(JSON.stringify(publicSessionRows(rows, "a", "current")).includes("secret"), false); assert.equal(publicSessionRows(rows, "a").length, 2); assert.equal(sessionToRevoke(rows, "a", "other").ok, false); assert.equal(sessionToRevoke(rows, "a", "current", "current").ok, false); assert.deepEqual(sessionToRevoke(rows, "a", "old", "current"), { ok: true, token: "secret-old" });
});
