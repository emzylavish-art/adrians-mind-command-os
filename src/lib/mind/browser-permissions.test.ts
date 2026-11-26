import assert from "node:assert/strict";
import test from "node:test";
import { browserAddress, browserPreferencesKey, defaultBrowserPreferences, parseBrowserPreferences, websitePermission } from "./browser-permissions.ts";

test("handoffs honor the exact origin and the current default after reload", () => {
  const url = browserAddress("example.com/path")!;
  assert.equal(websitePermission(defaultBrowserPreferences, url), "ask");
  const restored = parseBrowserPreferences(JSON.stringify({ defaultPermission: "block", sites: { [url.origin]: "allow" } }));
  assert.equal(websitePermission(restored, url), "allow");
  for (const address of ["http://example.com/path", "https://shop.example.com", "https://example.com:8443"]) {
    assert.equal(websitePermission(restored, new URL(address)), "block");
  }
  assert.notEqual(browserPreferencesKey("a"), browserPreferencesKey("b"));
});

test("invalid stored rules fail closed and non-web or credentialed URLs are refused", () => {
  for (const address of ["file:///a", "javascript:void(0)", "https://u:p@example.com", "bad address"]) {
    assert.equal(browserAddress(address), null);
  }
  for (const raw of ["{}", "bad json", '{"defaultPermission":"allow","sites":{"https://example.com/path":"allow"}}']) {
    assert.throws(() => parseBrowserPreferences(raw));
  }
});


test("website-opening permission never authorizes autonomous inspection or writes", async () => {
  const { authorizeBrowserAction } = await import("./browser-permissions.ts");
  const target = new URL("https://example.com/page");
  const allowed = { defaultPermission: "allow" as const, sites: {} };
  assert.equal(authorizeBrowserAction(allowed, target, "open").allowed, true);
  assert.equal(authorizeBrowserAction(allowed, target, "inspect").allowed, false);
  assert.equal(authorizeBrowserAction(allowed, target, "submit").allowed, false);
  assert.equal(authorizeBrowserAction({ ...allowed, sites: { [target.origin]: "block" } }, target, "open").allowed, false);
  assert.equal(authorizeBrowserAction({ defaultPermission: "ask", sites: {} }, target, "open").needsConfirmation, true);
});
