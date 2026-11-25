import assert from "node:assert/strict";
import test from "node:test";
import { browserAddress, browserPreferencesKey, defaultBrowserPreferences, parseBrowserPreferences, websitePermission } from "./browser-permissions.ts";

test("website permissions are account-scoped and exact-origin", () => {
  const url = browserAddress("example.com/path")!;
  const prefs = parseBrowserPreferences(JSON.stringify({ defaultPermission: "block", sites: { [url.origin]: "allow" } }));
  assert.equal(websitePermission(prefs, url), "allow");
  assert.equal(websitePermission(prefs, new URL("https://shop.example.com")), "block");
  assert.equal(websitePermission(defaultBrowserPreferences, url), "ask");
  assert.notEqual(browserPreferencesKey("a"), browserPreferencesKey("b"));
});

test("unsafe addresses and invalid stored rules fail closed", () => {
  for (const address of ["file:///a", "javascript:void(0)", "https://u:p@example.com", "bad address"]) assert.equal(browserAddress(address), null);
  for (const raw of ["{}", "bad json", '{"defaultPermission":"allow","sites":{"https://example.com/path":"allow"}}']) assert.throws(() => parseBrowserPreferences(raw));
});
