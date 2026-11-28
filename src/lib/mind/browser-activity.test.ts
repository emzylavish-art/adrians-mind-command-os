import test from "node:test";
import assert from "node:assert/strict";
import { activityOwnerPrefix, activityStorageKey, readBrowserActivity, websiteOpening, safeBrowserScreenshot } from "./browser-activity.ts";
import { browserPreferencesKey } from "./browser-permissions.ts";

test("handoff checks the exact site, current owner's rules and an explicit confirmation", () => {
  const items = new Map([[browserPreferencesKey("a"), JSON.stringify({ defaultPermission: "ask", sites: { "https://github.com": "block" } })]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null };
  assert.match(websiteOpening(storage, "a", "github.com", true).error ?? "", /blocked/);
  assert.match(websiteOpening(storage, "b", "github.com", false).error ?? "", /Confirm/);
  assert.equal(websiteOpening(storage, "b", "https://github.com/session", true).url?.pathname, "/session");
  for (const url of ["javascript:alert(1)", "https://user:pass@github.com", "data:text/html,test", "https://github.com\\@evil.test"]) {
    assert.ok(websiteOpening(storage, "a", url, true).error);
  }
});

test("activity storage is scoped and old or tampered values cannot become executable or reveal a destination path", () => {
  assert.ok(activityStorageKey("alice", "chat-1").startsWith(activityOwnerPrefix("alice")));
  assert.ok(!activityStorageKey("alice-other", "chat-1").startsWith(activityOwnerPrefix("alice")));
  assert.notEqual(activityStorageKey("alice", "chat-1"), activityStorageKey("alice", "project-1"));
  const row = { id: "one", kind: "website", title: "private", at: 1, outcome: "returned" };
  assert.deepEqual(readBrowserActivity(JSON.stringify([
    { ...row, origin: "https://github.com", extra: "secret" },
    { ...row, origin: "https://github.com/token" }, { ...row, origin: "https://a@github.com" }, { ...row },
    { ...row, kind: "screenshot", outcome: "saved", image: "data:image/svg+xml;base64,YQ==" }, { ...row, at: 1e30, origin: "https://github.com" },
  ])), [{ ...row, title: "https://github.com", origin: "https://github.com" }]);
  assert.equal(safeBrowserScreenshot("https://github.com/a.jpg"), false);
});
