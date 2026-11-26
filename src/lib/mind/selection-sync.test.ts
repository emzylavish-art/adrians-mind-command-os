import assert from "node:assert/strict";
import { test } from "node:test";
import { readSelection, writeSelection } from "./logic-routes.ts";
import { commitSelectionChanges, exactModelForChat, ownerSelectionStorage } from "./selection-sync.ts";
import { createChat, emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { effortModelTier, resolveSendPath, saveComposerEffort } from "./composer-modes.ts";
import type { Workspace } from "./types.ts";

test("C5 changing tier in a stale tab preserves another tab's provider and isolates owners", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const a = ownerSelectionStorage(store, "owner-A"), b = ownerSelectionStorage(store, "owner-B");
  const before = readSelection(a);
  writeSelection(a, { ...before, provider: "gemini" });
  const merged = commitSelectionChanges(a, before, { ...before, modelTier: "Expert" });
  assert.equal(merged.provider, "gemini"); assert.equal(merged.modelTier, "Expert");
  assert.equal(readSelection(b).provider, "grok");
});
test("C5 global exact Grok choice never overrides a pinned bot tier", () => {
  assert.equal(exactModelForChat({ botProvider: "grok", botTier: "Fast", selectedProvider: "grok", grokModel: "grok-4.5" }), null);
  assert.equal(exactModelForChat({ botProvider: "grok", botTier: "Fast", botExactModel: "grok-4.6", selectedProvider: "grok", grokModel: "grok-4.5" }), "grok-4.6");
  assert.equal(exactModelForChat({ selectedProvider: "grok", grokModel: "grok-4.5" }), "grok-4.5");
  assert.equal(exactModelForChat({ botProvider: "gemini", selectedProvider: "gemini", grokModel: "grok-4.5", providerModel: "fixture-gemini" }), "fixture-gemini");
});

test("C5 explicit bot exact model survives reload without changing another bot", () => {
  const first = createChat(emptyWorkspace(), { memory: "off", autonomy: "ask", temporary: false, projectId: null });
  const second = createChat(first.ws, { memory: "off", autonomy: "ask", temporary: false, projectId: null });
  const ws = { ...second.ws, chats: second.ws.chats.map(chat => ({ ...chat, botProvider: "grok" as const, botTier: "Fast" as const, ...(chat.id === first.chat.id ? { botExactModel: "grok-4.6" } : {}) })) };
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(ws)));
  const selected = restored.chats.find(chat => chat.id === first.chat.id)!;
  const other = restored.chats.find(chat => chat.id === second.chat.id)!;
  assert.equal(exactModelForChat({ ...selected, selectedProvider: "grok", grokModel: "grok-4.5" }), "grok-4.6");
  assert.equal(exactModelForChat({ ...other, selectedProvider: "grok", grokModel: "grok-4.5" }), null);
});

test("C5 actual Effort handler clears the scoped override and retains the chosen provider", () => {
  const app = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url).pathname.replace("/lib/components/", "/components/"), "utf8");
  const start = app.indexOf("  function chooseComposerEffort(");
  const end = app.indexOf("  const consultModules", start);
  assert.ok(start >= 0 && end > start);
  for (const provider of ["grok", "gemini"] as const) {
    const created = createChat(emptyWorkspace(), { memory: "off", autonomy: "ask", temporary: false, projectId: null });
    let ws: Workspace = { ...created.ws, chats: created.ws.chats.map(chat => ({ ...chat, botProvider: provider, botTier: "Heavy", botExactModel: provider === "grok" ? "grok-4.6" : undefined })) };
    let override: string | null = "grok-4.6", tier = "Heavy";
    const noop = () => undefined;
    const context = vm.createContext({ preferenceStorage: null, active: ws.chats[0], effortModelTier, resolveSendPath, saveComposerEffort, setComposerEffort: noop, setNotice: noop, setLogicRoute: noop, setGrokModel: (value: string | null) => { override = value; }, setModelTier: (value: string) => { tier = value; }, setWs: (update: (value: Workspace) => Workspace) => { ws = update(ws); }, applyVoiceMode: noop, setView: noop });
    vm.runInContext(stripTypeScriptTypes(app.slice(start, end)) + '\nchooseComposerEffort("fast");', context);
    assert.equal(tier, "Fast"); assert.equal(override, null);
    assert.equal(ws.chats[0].botProvider, provider);
    assert.equal(ws.chats[0].botTier, "Fast"); assert.equal(ws.chats[0].botExactModel, undefined);
  }
});
