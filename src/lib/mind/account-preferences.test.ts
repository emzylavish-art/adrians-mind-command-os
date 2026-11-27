import assert from "node:assert/strict";
import { test } from "node:test";
import { accountPreferences } from "./account-preferences.ts";

test("routing, fallback, local endpoint, voice and skill settings belong only to their account", () => {
  const data = new Map<string, string>([["amcos.failover.v1", "grok"]]);
  const raw = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const a = accountPreferences(raw, "A"), b = accountPreferences(raw, "B");
  for (const key of ["amcos.failover.v1", "amcos.selection.v1", "amcos.ollama.base", "amcos.skills.v1", "adrian-speak-auto-read"]) {
    assert.equal(a.getItem(key), null); a.setItem(key, "A's choice"); assert.equal(b.getItem(key), null);
    b.setItem(key, "B's choice"); assert.equal(accountPreferences(raw, "A").getItem(key), "A's choice");
    b.removeItem(key); assert.equal(a.getItem(key), "A's choice");
  }
  assert.equal(raw.getItem("amcos.failover.v1"), "grok", "legacy data remains available for an explicit migration, never silently adopted");
});

test("missing browser storage is isolated and usable for this session", () => {
  const one = accountPreferences(null, "A"), two = accountPreferences(null, "B");
  one.setItem("provider", "gemini"); assert.equal(one.getItem("provider"), "gemini"); assert.equal(two.getItem("provider"), null);
});
