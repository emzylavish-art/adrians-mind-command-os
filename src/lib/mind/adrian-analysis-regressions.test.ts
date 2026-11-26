import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyWorkspace, normalizeWorkspace, pushUsage } from "./workspace.ts";
import { shareWriteForView, writeShareSearch, resolveShare, settingsPaneFromSearch } from "./app-location.ts";
import { paletteHits } from "./palette.ts";
import { selectContextHistory, contextBudget, contextReceiptNotice } from "./context-budget.ts";
import { currentMemoryContext } from "./context-permission.ts";
import { chatTurnBody } from "./logic-routes.ts";
import { buildHistoryMessages } from "./media/history.ts";
import { checkpointReply, completedHistory } from "./partial-reply.ts";
import { prepareRegenerate, prepareRetry, exportChat } from "./transcript.ts";
import { loadNotionRecovery, saveNotionRecovery } from "./notion-recovery.ts";
import { applyExecutionUsage } from "./execution-usage.ts";
import { withExecutionReceipts } from "./execution-response.ts";
import { consumeMindTurn, checkTurnReceipt } from "./live-turn.ts";
import type { ConsultExecutionReceipt } from "./model-consult.ts";

const at = "2026-11-25T12:00:00.000Z";
const operation = `${Date.now()}-${randomUUID()}`;
function fixture() {
  const ws = emptyWorkspace();
  ws.chats = [{ id: "chat-a", title: "Review", memory: "on", temporary: false, autonomy: "ask", projectId: "project-a", retrievalLog: [],
    messages: [{ id: "user-a", role: "user", content: "Review the plan", at, deliveryOperationId: operation, delivery: "unconfirmed" }] }];
  return ws;
}
const noRecords = { projects: [], chats: [], memories: [], files: [], agents: [], runs: [] };

test("AA006/008 settings panes and Intelligence identity survive navigation serialization", () => {
  const sections = ["command", "chat", "code", "settings"];
  const settings = writeShareSearch("?section=chat&chat=old", { ...shareWriteForView("settings", { chat: null, project: null, file: null, bot: null }), pane: "voice" }, sections);
  assert.equal(settingsPaneFromSearch(settings), "voice");
  assert.equal(settingsPaneFromSearch("?section=settings&pane=unknown"), null);
  assert.equal(settingsPaneFromSearch("?section=chat&pane=voice"), null);
  const link = writeShareSearch(settings, shareWriteForView("code", { chat: "chat-a", project: null, file: null, bot: null }), sections);
  assert.equal(new URLSearchParams(link).has("pane"), false);
  const resolved = resolveShare(link, { chats: [{ id: "chat-a" }, { id: "other" }], projects: [], files: [], agents: [] }, sections);
  assert.equal(resolved.chatId, "chat-a"); assert.equal(resolved.view, "code");
});

test("AA020/022 memory context changes immediately with revocation, archive, project or temporary mode", () => {
  const ws = fixture();
  ws.memories = [{ id: "memory-a", text: "Private constraint", scope: "project", projectId: "project-a", chatId: null, source: "fixture", archived: false, createdAt: at, updatedAt: at, versions: [] }];
  const before = currentMemoryContext(ws, "chat-a")!;
  assert.equal(before.notes.length, 1);
  const off = { ...ws, chats: ws.chats.map((chat) => ({ ...chat, memory: "off" as const })) };
  assert.equal(currentMemoryContext(off, "chat-a")!.notes.length, 0);
  assert.notEqual(currentMemoryContext(off, "chat-a")!.permissionKey, before.permissionKey);
  const moved = { ...ws, chats: ws.chats.map((chat) => ({ ...chat, projectId: "project-b" })) };
  assert.equal(currentMemoryContext(moved, "chat-a")!.notes.length, 0);
  const temporary = { ...ws, chats: ws.chats.map((chat) => ({ ...chat, temporary: true })) };
  assert.equal(currentMemoryContext(temporary, "chat-a")!.notes.length, 0);
  const archived = { ...ws, memories: ws.memories.map((note) => ({ ...note, archived: true })) };
  assert.equal(currentMemoryContext(archived, "chat-a")!.notes.length, 0);
  assert.equal(currentMemoryContext({ ...ws, chats: [] }, "chat-a"), null);
});

test("AA036/037 context keeps early constraints and recent turns within explicit provider budgets", () => {
  const history = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: index === 0 ? "Never publish the original account's private notes." : `Turn ${index}: ${"detail ".repeat(30)}` }));
  const selected = selectContextHistory(history, { provider: "ollama", reservedText: "Current question" });
  assert.ok(selected.omittedMessages > 0);
  assert.equal(selected.history[0].content, history[0].content);
  assert.equal(selected.history.at(-1)?.content, history.at(-1)?.content);
  assert.equal(selected.budget, 4096);
  assert.ok(contextBudget("grok") > contextBudget("ollama"));
  assert.equal(contextBudget("openrouter", "fixture:free"), 8192);
  const small = history.map((item, index) => ({ ...item, content: `Short ${index}` }));
  assert.equal(selectContextHistory(small, { provider: "grok" }).history.length, 40);
  assert.equal(buildHistoryMessages(small as { role: "user" | "assistant"; content: string }[]).length, 40);
  assert.deepEqual(selected.includedIndices, [...selected.includedIndices].sort((a,b) => a-b));
});

test("AA033/038 context receipt counts omitted images and gives missing-byte recovery", () => {
  const images = [{ dataUrl: "data:image/png;base64,YQ==", name: "fixture.png" }];
  const history = Array.from({ length: 6 }, (_, index) => ({ role: "user", content: `Image ${index}`, images }));
  const base = { text: "Compare", memory: "off" as const, halted: false, history, memoryContext: [], provider: "grok", modelTier: "Auto" as const, logicRoute: null, images: [] };
  const body = chatTurnBody(base);
  assert.equal((body.contextReceipt as { excludedImages: number }).excludedImages, 3);
  const other = chatTurnBody({ ...base, provider: "gemini" });
  assert.equal((other.contextReceipt as { excludedImages: number }).excludedImages, 6);
  assert.ok((other.history as { images: unknown[] }[]).every((message) => !message.images.length));
  assert.equal(history[0].images.length, 1, "no mutation of original archive");
  assert.match(contextReceiptNotice({ includedMessages: 12, omittedMessages: 3, excludedImages: 2, unavailableImages: 1, budget: 8192 }), /1 earlier images unavailable.*Reattach/);
});

test("AA039/040/042 partial checkpoints survive normalization, preserve operation and cannot regenerate", () => {
  let ws = checkpointReply(fixture(), "chat-a", operation, "First", "streaming", at);
  ws = checkpointReply(ws, "chat-a", operation, "First second", "interrupted", at);
  const reloaded = normalizeWorkspace(JSON.parse(JSON.stringify(ws)));
  assert.equal(reloaded.chats[0].messages.length, 2);
  assert.equal(reloaded.chats[0].messages[1].content, "First second");
  assert.equal(reloaded.chats[0].messages[1].replyStatus, "interrupted");
  assert.equal(completedHistory(reloaded.chats[0].messages).length, 1);
  assert.ok("error" in prepareRegenerate(reloaded, "chat-a"));
  const retry = prepareRetry(reloaded, "chat-a");
  assert.ok(!("error" in retry));
  if (!("error" in retry)) assert.equal(retry.chat.messages.at(-1)?.deliveryOperationId, operation);
  const exported = exportChat(reloaded, "chat-a");
  assert.ok(!("error" in exported));
  if (!("error" in exported)) assert.equal(JSON.parse(exported.json).chat.messages[1].replyStatus, "interrupted");
  const done = { ...ws, chats: ws.chats.map((chat) => ({ ...chat, messages: [...chat.messages, { id: "done", role: "assistant" as const, content: "Full reply", replyOperationId: operation, replyStatus: "complete" as const, at }] })) };
  assert.deepEqual(checkpointReply(done, "chat-a", operation, "late partial", "interrupted", at), done);
});

test("AA001 Notion recovery remains owner/workspace/page/operation bound across reload", () => {
  const map = new Map<string,string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key,value); } };
  const record = { owner: "owner-a", operationId: randomUUID(), chatId: "chat-a", workspaceId: "notion-a", pageId: "page-a", text: "Append fixture", state: "accepted" as const };
  assert.ok(saveNotionRecovery("owner-a", [record, { ...record, owner: "owner-b" }], storage));
  assert.deepEqual(loadNotionRecovery("owner-a", storage), [record]);
  assert.deepEqual(loadNotionRecovery("owner-b", storage), []);
  assert.deepEqual(loadNotionRecovery(null, storage), []);
});

const execution: ConsultExecutionReceipt = { executionId: "parent:helper:0", parentOperationId: "parent", role: "helper", provider: "gemini", model: "fixture-model", requestedModel: "selected-model", usage: { prompt_tokens: 12, completion_tokens: 4 }, requestId: "request-a", executionLocation: "hosted", outcome: "completed" };
test("AA043/044/046 helper receipts survive a failed final answer and reconcile without double counting", async () => {
  const response = await withExecutionReceipts(new Response(JSON.stringify({ ok: false, error: "Final model timed out" }), { status: 502, headers: { "content-type": "application/json" } }), [execution]);
  const result = await consumeMindTurn({ url: "/fixture", body: {}, headers: {}, signal: new AbortController().signal, onDelta() {}, fetchImpl: async () => response });
  assert.equal(result.ok, false);
  assert.deepEqual(result.executions, [execution]);
  const first = applyExecutionUsage(fixture(), "chat-a", result.executions!, at);
  const twice = applyExecutionUsage(first, "chat-a", result.executions!, at);
  assert.equal(twice.usage.length, 1); assert.equal(twice.usage[0].promptTokens, 12);
  const unknown = applyExecutionUsage(twice, "chat-a", [{ ...execution, outcome: "unknown", usage: null }], at);
  assert.equal(unknown.usage[0].outcome, "completed");
  let method = "";
  const receipt = await checkTurnReceipt("/api/mind/turn", "parent", {}, undefined, async (_url, init) => { method = init!.method!; return Response.json({ ownerId: "owner-a", state: "responded", executions: [execution] }); });
  assert.equal(method, "GET"); assert.deepEqual(receipt.executions, [execution]);
});

test("AA045 bounded recent usage is retained as attempts with unknown usage preserved", () => {
  let ws = fixture();
  for (let i=0;i<201;i++) ws = pushUsage(ws, { id: String(i), chatId: "chat-a", at, model: "model unknown", requestId: null, promptTokens: null, completionTokens: null, outcome: "unknown" });
  assert.equal(ws.usage.length, 200); assert.equal(ws.usage[0].id, "200");
  assert.equal(ws.usage.at(-1)?.id, "1"); assert.ok(ws.usage.every((row) => row.kind === "unknown"));
});

test("AA047/048/049 search finds multiple keyword matches, ranks exact titles and has stable identities", () => {
  const hits = paletteHits({ ...noRecords, query: "  production   verified  ", chats: [
    { id: "same", title: "Production verified", messages: [{ id: "first", content: "production deployment verified", at }, { id: "second", content: "verified production on the next build", at: "2026-11-25T13:00:00Z" }] },
  ], files: [{ id: "same", name: "notes.txt", text: "Production was verified" }], projects: [{ id: "same", name: "Production", description: "verified" }] });
  assert.equal(hits[0].messageId, "second");
  assert.equal(hits.filter((hit) => hit.view === "chat").length, 2);
  assert.equal(new Set(hits.map((hit) => hit.key)).size, hits.length);
  const quoted = paletteHits({ ...noRecords, query: '"production verified"', files: [{ id: "f", name: "notes", text: "production was verified" }] });
  assert.equal(quoted.length, 0);
  assert.equal(paletteHits({ ...noRecords, query: "deploymnt", files: [{ id: "f", name: "notes", text: "deployment" }] }).length, 0, "typo search is not advertised");
});

test("AA050/051 each new local record category has exact focus and match-centered evidence", () => {
  const filler = "Unrelated context. ".repeat(15);
  const hits = paletteHits({ ...noRecords, query: "needle", schedules: [{ id: "s", name: "Daily needle", instruction: "report", timeZone: "UTC" }],
    connections: [{ id: "c", label: "Needle account", provider: "openai", status: "unconfigured" }],
    browserSessions: [{ id: "b", title: "Needle page", url: "https://example.test", excerpt: "", lastAction: "read" }],
    research: [{ id: "r", question: "Needle research", summary: "fixture", at }],
    agents: [{ id: "a", name: "Agent", description: "", archived: false, version: 1 }],
    deployments: [{ id: "d", agentId: "a", agentVersion: 1, target: "needle", state: "local-ready", error: "" }],
    activity: [{ id: "e", action: "fixture", target: "", result: filler + "needle at the end", at }],
    memories: [{ id: "n", text: filler + "needle note", archived: false }, { id: "gone", text: "needle archived", archived: true }],
    files: [{ id: "f", name: "record.txt", text: filler + "needle file" }] });
  for (const focus of ["schedule-s", "connection-c", "browser-b", "research-r", "deployment-d", "audit-e"]) assert.ok(hits.some((hit) => hit.focusId === focus), focus);
  for (const id of ["n", "f", "e"]) assert.match(hits.find((hit) => hit.ref === id)!.excerpt!, /needle/);
  assert.equal(hits.some((hit) => hit.ref === "gone"), false);
});
