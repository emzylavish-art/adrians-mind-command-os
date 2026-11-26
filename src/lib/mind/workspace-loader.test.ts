import assert from "node:assert/strict";
import { Worker as NodeWorker } from "node:worker_threads";
import { test } from "node:test";
import { emptyWorkspace, readWorkspaceRawForAccount, accountWorkspaceKey, WORKSPACE_KEY } from "./workspace.ts";
import { parseWorkspaceDeferred, type WorkspaceParserWorker, type WorkspaceParseResponse } from "./workspace-loader.ts";
import { createWorkspaceMediaLoader, applyWorkspaceImagePatches } from "./workspace-media-loader.ts";
import { createWorkspaceCheckpoint } from "./workspace-checkpoint.ts";
import type { Chat } from "./types.ts";

const AT = "2026-11-26T12:00:00.000Z";
const DATA = "data:image/png;base64,eA==";
function savedChat(id: string): Chat { return { id, title: id, memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: [{ id: `${id}-message`, role: "assistant", content: `Final answer ${id}`, at: AT, images: [{ blobId: `image-${id}`, name: `${id}.png` }] }] }; }

test("a real isolated worker decodes thousands of messages and hundreds of resources before enabling a complete snapshot", async () => {
  const source = emptyWorkspace();
  source.chats = Array.from({ length: 200 }, (_, c) => ({ ...savedChat(`chat-${c}`), messages: Array.from({ length: 10 }, (_, m) => ({ id: `m-${c}-${m}`, role: "assistant" as const, content: `Preserve conversation ${c}, message ${m}`, at: AT, images: [{ blobId: `blob-${c}-${m}` }] })) }));
  source.projects = Array.from({ length: 300 }, (_, p) => ({ id: `p-${p}`, name: `Project ${p}`, description: "", createdAt: AT }));
  source.files = Array.from({ length: 300 }, (_, f) => ({ id: `f-${f}`, name: `File ${f}`, bytes: 8, projectId: null, text: `File-${f}`, createdAt: AT }));
  source.deletedChatIds = ["deleted-chat"]; source.deletedMemoryIds = ["deleted-memory"];
  const raw = JSON.stringify(source);
  let releaseShell: (() => void) | undefined; const shellPaint = new Promise<void>((resolve) => { releaseShell = resolve; });
  let ready = false; let workerId = 0; let terminated = false;
  const pending = parseWorkspaceDeferred(raw, {
    yieldControl: () => shellPaint,
    createWorker: () => {
      const codec = new URL("./workspace-codec.ts", import.meta.url).href;
      const code = `import { parentPort } from "node:worker_threads"; import { handleWorkspaceParse } from ${JSON.stringify(codec)}; parentPort.on("message", request => parentPort.postMessage(handleWorkspaceParse(request)));`;
      const thread = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(code)}`), { execArgv: ["--experimental-strip-types"] });
      workerId = thread.threadId;
      const bridge: WorkspaceParserWorker = { onmessage: null, onerror: null, postMessage: (request) => thread.postMessage(request), terminate: () => { terminated = true; void thread.terminate(); } };
      thread.on("message", (data: WorkspaceParseResponse) => bridge.onmessage?.({ data })); thread.on("error", (error) => bridge.onerror?.(error));
      return bridge;
    },
  }).then((result) => { ready = true; return result; });
  assert.equal(ready, false); assert.equal(workerId, 0); // The shell can run before parsing begins.
  releaseShell!();
  const result = await pending;
  assert.equal(result.method, "worker"); assert.ok(workerId > 0); assert.equal(terminated, true);
  assert.equal(result.workspace.chats.flatMap((chat) => chat.messages).length, 2000);
  assert.equal(result.workspace.projects.length, 300); assert.equal(result.workspace.files.length, 300);
  assert.deepEqual(result.workspace.deletedChatIds, ["deleted-chat"]); assert.deepEqual(result.workspace.deletedMemoryIds, ["deleted-memory"]);
  assert.equal(result.workspace.chats[199].messages[9].content, "Preserve conversation 199, message 9");
  assert.equal(JSON.stringify(source), raw);
});

test("account cancellation terminates its parser and never yields an empty replacement", async () => {
  const abort = new AbortController(); let terminated = false; let posted = false;
  const worker: WorkspaceParserWorker = { onmessage: null, onerror: null, postMessage: () => { posted = true; }, terminate: () => { terminated = true; } };
  const pending = parseWorkspaceDeferred(JSON.stringify(emptyWorkspace()), { signal: abort.signal, createWorker: () => worker, yieldControl: async () => {} });
  await Promise.resolve(); assert.equal(posted, true); abort.abort();
  await assert.rejects(pending, /previous account/); assert.equal(terminated, true);
});

test("corrupt data fails without overwriting bytes and unsupported Worker browsers use a yielded full-data fallback", async () => {
  const corrupt = "{do-not-replace-this-copy";
  await assert.rejects(parseWorkspaceDeferred(corrupt, { createWorker: null, yieldControl: async () => {} }));
  let yielded = false;
  const source = { ...emptyWorkspace(), chats: [savedChat("complete")], deletedChatIds: ["gone"] };
  const result = await parseWorkspaceDeferred(JSON.stringify(source), { createWorker: () => { throw new Error("Worker unavailable"); }, yieldControl: async () => { yielded = true; } });
  assert.equal(yielded, true); assert.equal(result.method, "yielded-main-thread"); assert.equal(result.workspace.chats[0].messages[0].content, "Final answer complete"); assert.deepEqual(result.workspace.deletedChatIds, ["gone"]);
});

test("raw snapshot selection preserves the exact account boundary before worker dispatch", () => {
  const rows = new Map([[accountWorkspaceKey("one"), "one"], [accountWorkspaceKey("two"), "two"], [WORKSPACE_KEY, "shared legacy"]]);
  const storage = { getItem: (key: string) => rows.get(key) ?? null };
  assert.equal(readWorkspaceRawForAccount(storage, "one"), "one"); assert.equal(readWorkspaceRawForAccount(storage, "two"), "two");
  assert.equal(readWorkspaceRawForAccount(storage, "unknown", "another@example.test"), null); assert.equal(readWorkspaceRawForAccount(storage, null), null);
});

test("complete metadata is usable before historical media finishes, and active-chat copies take priority", async () => {
  const workspace = { ...emptyWorkspace(), chats: [savedChat("old"), savedChat("active"), savedChat("later")] };
  const reads: string[] = []; const batches: string[] = []; let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const loader = createWorkspaceMediaLoader({ put: async () => {}, get: async (id) => { reads.push(id); if (id === "image-old") await held; return DATA; } });
  let current = workspace;
  const run = loader.progressively(workspace, { isCurrent: () => true, priorityChatId: () => "active", batchSize: 1, yieldControl: async () => {}, onBatch: (patches) => { current = applyWorkspaceImagePatches(current, patches); batches.push(patches[0].chatId); } });
  while (!reads.includes("image-old")) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.chats.length, 3); assert.equal(current.chats[0].messages[0].content, "Final answer old");
  assert.equal(current.chats[1].messages[0].images?.[0].dataUrl, DATA); assert.equal(current.chats[0].messages[0].images?.[0].dataUrl, undefined);
  assert.deepEqual(batches, ["active"]); release!();
  const result = await run; assert.equal(result.completed, 3); assert.equal(result.cancelled, false);
});

test("late image pixels cannot resurrect removed conversations or replace edited messages or blob identities", () => {
  const base = { ...emptyWorkspace(), chats: [savedChat("one"), savedChat("two")], deletedChatIds: ["deleted"] };
  const patches = [{ chatId: "one", messageId: "one-message", imageIndex: 0, blobId: "image-one", dataUrl: DATA }];
  const removed = { ...base, chats: [base.chats[1]], deletedChatIds: ["deleted", "one"] };
  assert.equal(applyWorkspaceImagePatches(removed, patches), removed);
  const edited = structuredClone(base); edited.chats[0].messages[0].content = "Changed while images loaded";
  const merged = applyWorkspaceImagePatches(edited, patches);
  assert.equal(merged.chats[0].messages[0].content, "Changed while images loaded"); assert.deepEqual(merged.deletedChatIds, ["deleted"]);
  edited.chats[0].messages[0].images![0].blobId = "replacement-image";
  assert.equal(applyWorkspaceImagePatches(edited, patches), edited);
});

test("hydration cancellation publishes no late pixels and checkpoints retain compact refs without extra writes", async () => {
  const workspace = { ...emptyWorkspace(), chats: [savedChat("one")] }; let active = true; let release: (() => void) | undefined; let batches = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const loader = createWorkspaceMediaLoader({ put: async () => { throw new Error("No write expected"); }, get: async () => { await held; return DATA; } });
  const run = loader.progressively(workspace, { isCurrent: () => active, yieldControl: async () => {}, onBatch: () => { batches++; } });
  await Promise.resolve(); active = false; release!(); const result = await run;
  assert.equal(result.cancelled, true); assert.equal(batches, 0);
  const checkpoint = createWorkspaceCheckpoint();
  const patches = await loader.chatPatches(workspace.chats[0]);
  const hydrated = applyWorkspaceImagePatches(workspace, patches, checkpoint.rememberHydratedImage);
  assert.equal(hydrated.chats[0].messages[0].images?.[0].dataUrl, DATA);
  assert.equal(checkpoint.snapshot(hydrated).chats[0].messages[0].images?.[0].dataUrl, undefined);
  assert.equal(checkpoint.snapshot(hydrated).chats[0].messages[0].images?.[0].blobId, "image-one");
});

test("active-chat loading bounds concurrent image reads and cancellation stops later batches", async () => {
  const chat = savedChat("many"); chat.messages[0].images = Array.from({ length: 40 }, (_, i) => ({ blobId: `image-${i}` }));
  let concurrent = 0; let peak = 0; let calls = 0; let active = true;
  const loader = createWorkspaceMediaLoader({ put: async () => {}, get: async () => { calls++; concurrent++; peak = Math.max(peak, concurrent); await new Promise((resolve) => setTimeout(resolve, 0)); concurrent--; if (calls >= 8) active = false; return DATA; } });
  const patches = await loader.chatPatches(chat, () => active);
  assert.equal(calls, 8); assert.equal(peak, 8); assert.deepEqual(patches, []);
});
