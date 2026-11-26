import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { it } from "node:test";
import ts from "typescript";
import * as workspaceModule from "./workspace.ts";
import * as edits from "./workspace-edits.ts";
import * as sync from "./sync.ts";
import * as attachments from "./media/attachment-integrity.ts";
import * as checkpoints from "./workspace-checkpoint.ts";
import * as saveErrors from "./save-error.ts";
import { createMemoryBlobStore } from "./media/blob-store.ts";
import type { Workspace } from "./types.ts";

/** Deterministic hooks host exercises the actual application hook and asynchronous
 * callbacks. Storage/transport are fixtures; no browser account or server is used. */
function mount(input: { workspace?: Workspace; load: () => Promise<{ ok: true; workspace: Workspace | null; revision: string }>; save: (workspace: Workspace) => Promise<{ ok: true; revision: string }> }) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let dirty = false;
  let args: [string | null, string | null, boolean] = ["owner", null, false];
  let effects: (() => void)[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const rows = new Map<string, string>();
  const reads: string[] = [];
  const storage = { getItem(key: string) { reads.push(key); return rows.get(key) ?? null; }, setItem(key: string, value: string) { rows.set(key, value); }, removeItem(key: string) { rows.delete(key); } };
  if (input.workspace) storage.setItem(workspaceModule.accountWorkspaceKey("owner"), JSON.stringify(input.workspace));
  const changed = (a: unknown[] | undefined, b: unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((value, i) => value !== b[i]);
  const useMemo = (fn: () => unknown, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (changed(slot.deps, deps)) { slot.value = fn(); slot.deps = deps; }
    return slot.value;
  };
  const effect = (fn: () => (() => void) | undefined, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (changed(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); }
  };
  const react = {
    useMemo, useCallback: (fn: unknown, deps: unknown[]) => useMemo(() => fn, deps), useEffect: effect, useLayoutEffect: effect,
    useRef(value: unknown) { const slot = slots[cursor++] ??= { value: { current: value } }; return slot.value; },
    useState(value: unknown) {
      const slot = slots[cursor++] ??= { value };
      return [slot.value, (action: unknown) => {
        const next = typeof action === "function" ? action(slot.value) : action;
        if (slot.value !== next) { slot.value = next; dirty = true; }
      }];
    },
  };
  const imports: Record<string, unknown> = {
    react, "./workspace": workspaceModule, "./workspace-edits": edits, "./sync": sync,
    "./media/attachment-integrity": attachments, "./workspace-checkpoint": checkpoints, "./save-error": saveErrors,
    "./media/blob-store": { accountImageStore: () => ({ ...createMemoryBlobStore(), clear: async () => {}, allowOwnedLegacyReferences: () => {} }) },
    "./use-composer-draft": { clearAccountDrafts: () => {} },
    "./server": { loadMindCopy: input.load, saveMindCopy: ({ data }: { data: { workspace: Workspace } }) => input.save(data.workspace),
      saveAccountAttachment: async () => { throw Error("no image expected"); }, loadAccountAttachment: async () => ({ ok: false }) },
  };
  const source = ts.transpileModule(readFileSync(new URL("./use-mind-workspace.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { useMindWorkspace?: (...values: [string | null, string | null, boolean]) => Record<string, unknown> } = {};
  vm.runInNewContext(source, { exports, require: (name: string) => { if (!(name in imports)) throw Error(name); return imports[name]; },
    localStorage: storage, navigator: {}, window: {
      setTimeout: () => 1, clearTimeout: () => {},
      addEventListener: (name: string, fn: (event: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
      removeEventListener: (name: string, fn: (event: unknown) => void) => listeners.get(name)?.delete(fn),
    } });
  let value: Record<string, unknown> = {};
  const render = () => { cursor = 0; dirty = false; effects = []; value = exports.useMindWorkspace!(...args); for (const run of effects) run(); };
  const settle = async () => { for (let i = 0; i < 50; i++) { await Promise.resolve(); if (dirty) render(); } };
  return {
    reads, storage, render, settle, get value() { return value as unknown as { ws: Workspace; ready: boolean; setWs: (value: Workspace) => void; syncConflicts: unknown[] }; },
    setArgs(next: typeof args) { args = next; render(); },
    storageEvent(next: Workspace) { const key = workspaceModule.accountWorkspaceKey("owner"); storage.setItem(key, JSON.stringify(next)); for (const fn of listeners.get("storage") ?? []) fn({ key, storageArea: storage }); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}

const ws = (ids: string[]): Workspace => ({ ...workspaceModule.emptyWorkspace(), chats: ids.map((id) => ({ id, title: id, memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] })) });

it("C4 actual hook does not read guest storage or dispatch saves while auth is pending", async () => {
  let loads = 0; let saves = 0;
  const app = mount({ load: async () => { loads++; return { ok: true, workspace: null, revision: "R1" }; }, save: async () => { saves++; return { ok: true, revision: "R2" }; } });
  app.setArgs([null, null, true]); await app.settle();
  assert.equal(app.value.ready, false); assert.equal(loads, 0); assert.equal(saves, 0); assert.equal(app.reads.length, 0);
  app.setArgs(["owner", null, false]); await app.settle();
  assert.equal(app.value.ready, true); assert.equal(loads, 1); assert.equal(saves, 0);
  app.unmount();
});

it("C4 actual hook preserves remote conversations when local input arrives during initial load", async () => {
  let release!: (result: { ok: true; workspace: Workspace; revision: string }) => void;
  const pending = new Promise<{ ok: true; workspace: Workspace; revision: string }>((resolve) => { release = resolve; });
  let loads = 0;
  let saved: Workspace | undefined;
  const app = mount({ load: () => ++loads === 1 ? pending : Promise.resolve({ ok: true, workspace: ws(["phone"]), revision: "R1" }),
    save: async (candidate) => { saved = candidate; return { ok: true, revision: "R2" }; } });
  app.render(); await app.settle();
  app.value.setWs(ws(["computer"])); await app.settle();
  release({ ok: true, workspace: ws(["phone"]), revision: "R1" }); await app.settle();
  assert.deepEqual(new Set(saved?.chats.map((chat) => chat.id)), new Set(["phone", "computer"]));
  assert.deepEqual(new Set(app.value.ws.chats.map((chat) => chat.id)), new Set(["phone", "computer"]));
  app.unmount();
});

it("C4 actual storage listener reconciles live creates, renames and deletes", async () => {
  const initial = ws(["existing", "removed"]);
  const app = mount({ workspace: initial, load: async () => ({ ok: true, workspace: initial, revision: "R1" }), save: async () => ({ ok: true, revision: "R2" }) });
  app.render(); await app.settle();
  const other = ws(["existing", "new"]); other.chats[0].title = "Renamed elsewhere";
  app.storageEvent(other); await app.settle();
  assert.deepEqual(app.value.ws.chats.map((chat) => chat.id), ["existing", "new"]);
  assert.equal(app.value.ws.chats[0].title, "Renamed elsewhere");
  app.unmount();
});
