import assert from "node:assert/strict";
import { test } from "node:test";
import { accountPreferences } from "./account-preferences.ts";
import { PLUGIN_SELECTION_KEY, pluginReadiness, pluginMayDispatch, readPluginSelections } from "./plugin-catalog.ts";
test("adding a link is a bookmark, and MCP readiness needs matching usable evidence", () => {
  const selection = { id: "plugin", enabled: true, connectionId: "c" };
  assert.equal(pluginReadiness("instructions", selection).state, "setup_required");
  assert.equal(pluginReadiness("mcp", selection).state, "unavailable");
  const connection = { id: "c", state: "connected", tools: [{ name: "read", permission: "read" as const }, { name: "write", permission: "write" as const }, { name: "unclassified" }] };
  assert.deepEqual(pluginReadiness("mcp", selection, connection).capabilities.map(item => item.permission), ["read", "write", "unknown"]);
  assert.equal(pluginMayDispatch(selection, connection), true);
  assert.equal(pluginMayDispatch({ ...selection, enabled: false }, connection), false);
  assert.equal(pluginMayDispatch(undefined, connection), false);
});
test("plugin bookmarks and bindings remain in their owner scope", () => {
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) || null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
  const a = accountPreferences(storage, "a"), b = accountPreferences(storage, "b");
  a.setItem(PLUGIN_SELECTION_KEY, JSON.stringify([{ id: "plugin", enabled: true, connectionId: "a-connection" }]));
  assert.equal(readPluginSelections(b.getItem(PLUGIN_SELECTION_KEY)).length, 0);
  assert.equal(readPluginSelections(a.getItem(PLUGIN_SELECTION_KEY))[0].connectionId, "a-connection");
});
