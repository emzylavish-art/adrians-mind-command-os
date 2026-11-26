import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { runNotionTurn } from "./notion.ts";
import { closeRecovery, saveRecovery } from "./recovery-inbox.ts";
import { emptyWorkspace } from "./workspace.ts";
import type { NotionOperation, NotionOperationStore } from "./notion-operation-store.ts";

const source = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("command-app.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
let handlerSource = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "askNotion") handlerSource = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handlerSource, "the actual CommandApp Notion handler must remain wired");
const compiled = ts.transpileModule(`${handlerSource}\nexports.askNotion = askNotion;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const text = "Append new note to the Notion page about roadmap";
const page = { object: "page", id: "p1", url: "https://www.notion.so/p1", properties: { Name: { title: [{ plain_text: "Roadmap" }] } } };
const block = { object: "block", id: "new-block", type: "paragraph", paragraph: { rich_text: [{ plain_text: "new note" }] } };

function fixture(options: { loseWriteResponse?: boolean; denied?: boolean } = {}) {
  const rows = new Map<string, NotionOperation>();
  const store: NotionOperationStore = {
    read: async (id) => rows.has(id) ? structuredClone(rows.get(id)!) : null,
    prepare: async (operation) => { rows.set(operation.id, structuredClone(operation)); return operation; },
    claim: async (id, fingerprint) => {
      const row = rows.get(id);
      if (!row || row.fingerprint !== fingerprint || !["prepared", "rejected"].includes(row.state)) return false;
      row.state = "dispatched"; return true;
    },
    finish: async (id, state, ids) => { const row = rows.get(id)!; row.state = state; if (ids) row.blockIds = ids; },
  };
  const chat = { id: "chat-a", notionWorkspaceId: "workspace-A" };
  const wsRef = { current: { ...emptyWorkspace(), chats: [chat] } as ReturnType<typeof emptyWorkspace> };
  const requests: Array<{ confirmed: boolean; operationId?: string; workspaceId?: string; pageId?: string | null }> = [];
  let pending: { run: () => void } | undefined;
  let retry: (() => void) | null = null;
  let writes = 0;
  let readsAllowed = options.loseWriteResponse === true;
  let lost = false;
  let lastError = "";
  let failureAction: string | undefined;
  const exports: { askNotion?: (...args: unknown[]) => Promise<void> } = {};
  const fetch = async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      writes++;
      return options.denied ? { ok: false, status: 403, json: async () => ({ code: "restricted_resource" }) } : { ok: true, status: 200, json: async () => ({ results: [block] }) };
    }
    if (url.endsWith("/search")) return { ok: true, status: 200, json: async () => ({ results: [page] }) };
    return { ok: readsAllowed, status: readsAllowed ? 200 : 503, json: async () => block };
  };
  const context = {
    exports, Date,
    wsRef, turnOwner: { current: "owner-a" }, draftOwner: "owner-a", notionEpoch: { current: 0 },
    saveRecovery, closeRecovery,
    setWs: (update: (previous: ReturnType<typeof emptyWorkspace>) => ReturnType<typeof emptyWorkspace>) => { wsRef.current = update(wsRef.current); },
    setBusy: () => {}, setError: (error: string | null) => { lastError = error ?? ""; },
    setNotion: () => {}, setNotionPreview: () => {}, recordToolTurn: () => {},
    setPending: (value: { run: () => void }) => { pending = value; },
    reportFailure: (message: string, _action: string, _target: string, callback: (() => void) | null, recoveryAction?: string) => { lastError = message; retry = callback; failureAction = recoveryAction; },
    mountFailure: (failure: { message: string }, callback: () => void) => ({ ...failure, retry: callback }),
    emitFailure: (_channel: string, failure: { message: string; retry: () => void }) => { lastError = failure.message; retry = failure.retry; return true; },
    listNotionWorkspaces: async () => { throw new Error("An already-bound chat must not substitute its selected workspace."); },
    notionCommand: async ({ data }: { data: { text: string; confirmed: boolean; operationId?: string; workspaceId?: string; pageId?: string | null } }) => {
      requests.push({ ...data });
      const result = await runNotionTurn({ ...data, pageId: data.pageId ?? null, token: "fixture-only", disabled: false, fetch, operationStore: store });
      if (options.loseWriteResponse && data.confirmed && !lost) { lost = true; throw new Error("response lost after accepted append"); }
      return result;
    },
  };
  runInNewContext(compiled, context);
  return {
    chat, wsRef, rows, requests,
    ask: () => exports.askNotion!(chat, text),
    confirm: () => { assert.ok(pending); pending!.run(); },
    retry: () => { assert.ok(retry); retry!(); },
    allowRead: () => { readsAllowed = true; },
    get writes() { return writes; }, get lastError() { return lastError; }, get retryAvailable() { return !!retry; }, get failureAction() { return failureAction; },
  };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 30; i++) { if (check()) return; await new Promise<void>((resolve) => setImmediate(resolve)); }
  assert.fail("the fixture did not settle");
}

test("actual CommandApp confirmation and Retry preserve operation ID and never confirm an accepted write twice", async () => {
  const app = fixture();
  await app.ask();
  app.confirm();
  await until(() => app.retryAvailable);
  assert.equal(app.writes, 1);
  const operationId = app.requests[1]!.operationId;
  assert.ok(operationId);
  assert.equal(app.requests[1]!.confirmed, true);
  assert.equal(app.wsRef.current.recovery?.[0]?.operationId, operationId);
  app.allowRead();
  app.retry();
  await until(() => app.wsRef.current.recovery?.[0]?.state === "resolved");
  assert.equal(app.requests[2]!.confirmed, false);
  assert.equal(app.requests[2]!.operationId, operationId);
  assert.equal(app.requests[2]!.workspaceId, "workspace-A");
  assert.equal(app.rows.size, 1);
  assert.equal(app.writes, 1);
});

test("actual CommandApp network-error Retry checks the durable operation after a lost success response", async () => {
  const app = fixture({ loseWriteResponse: true });
  await app.ask();
  app.confirm();
  await until(() => app.retryAvailable);
  assert.match(app.lastError, /uncertain|existing operation/i);
  const operationId = app.requests[1]!.operationId;
  assert.equal(app.wsRef.current.recovery?.[0]?.operationId, operationId);
  app.retry();
  await until(() => app.wsRef.current.recovery?.[0]?.state === "resolved");
  assert.equal(app.requests[2]!.confirmed, false);
  assert.equal(app.requests[2]!.operationId, operationId);
  assert.equal(app.rows.size, 1);
  assert.equal(app.writes, 1);
});

test("actual CommandApp permission rejection offers setup instead of a generic write retry", async () => {
  const app = fixture({ denied: true });
  await app.ask();
  app.confirm();
  await until(() => !!app.failureAction);
  assert.equal(app.failureAction, "setup");
  assert.equal(app.retryAvailable, false);
  assert.match(app.lastError, /permission|access|reconnect/i);
  assert.equal(app.writes, 1);
});

test("captured Notion approval cannot dispatch after the chat switches workspace", async () => {
  const app = fixture();
  await app.ask();
  app.wsRef.current = { ...app.wsRef.current, chats: app.wsRef.current.chats.map((chat) => ({ ...chat, notionWorkspaceId: "workspace-B" })) };
  app.confirm();
  assert.equal(app.requests.length, 1);
  assert.equal(app.writes, 0);
  assert.match(app.lastError, /workspace.*changed|changed.*workspace/i);
});

test("captured existing-operation recovery cannot call the server after a workspace switch", async () => {
  const app = fixture();
  await app.ask();
  app.confirm();
  await until(() => app.retryAvailable);
  app.wsRef.current = { ...app.wsRef.current, chats: app.wsRef.current.chats.map((chat) => ({ ...chat, notionWorkspaceId: "workspace-B" })) };
  app.retry();
  assert.equal(app.requests.length, 2);
  assert.equal(app.writes, 1);
  assert.match(app.lastError, /workspace.*changed|changed.*workspace/i);
});
