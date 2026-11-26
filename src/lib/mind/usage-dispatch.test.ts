import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readJsonObjectBody } from "./request-body.ts";
import { decideFetchSite } from "./request-guard.ts";
import { turnOperationExpiry } from "./turn-receipt.ts";
import { trackUsageResponse } from "./usage-ledger.server.ts";
import type { UsageReceipt } from "./usage-ledger.ts";

// Execute the checked-in HTTP handler with isolated account/storage/provider
// boundaries. The response-accounting wrapper and request parsing remain real.
const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("turn.server.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  const node = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Missing actual ${name} handler`);
  return node.getText(ast);
}
const executable = ts.transpileModule(`${declaration("json")}\n${declaration("handleMindTurn")}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type FixtureOptions = {
  dispatch: (markDispatched: () => void) => Promise<Response>;
  failWrite?: (attempt: number, receipt: UsageReceipt) => boolean;
};

function fixture(options: FixtureOptions) {
  const operationId = `${Date.now()}-${crypto.randomUUID()}`;
  const sql = { fixture: "owner-database" };
  const state = {
    attempts: [] as UsageReceipt[],
    durable: new Map<string, UsageReceipt>(),
    finished: [] as boolean[],
    dispatches: 0,
    providerCalls: 0,
    receipt: "absent" as "absent" | "claimed" | "retryable" | "responded",
  };
  const exported: { handleMindTurn?: (request: Request) => Promise<Response> } = {};
  runInNewContext(executable, {
    exports: exported, Response, Error, Date, crypto, MAX_BODY: 2_500_000,
    require: (specifier: string) => {
      assert.equal(specifier, "../db", "Only the SQL boundary can be imported by this fixture");
      return { getSql: async () => sql };
    },
    decideFetchSite, readJsonObjectBody, turnOperationExpiry, trackUsageResponse,
    requireUserId: async () => "fixture-owner",
    envCheck: () => ({ ok: true }),
    claimTurn: async (database: unknown, owner: string, id: string) => {
      assert.equal(database, sql); assert.equal(owner, "fixture-owner"); assert.equal(id, operationId);
      if (state.receipt === "responded") return "responded";
      if (state.receipt === "claimed") return "waiting";
      state.receipt = "claimed";
      return "claimed";
    },
    finishTurnReceipt: async (database: unknown, owner: string, id: string, retryable: boolean) => {
      assert.equal(database, sql); assert.equal(owner, "fixture-owner"); assert.equal(id, operationId);
      state.finished.push(retryable);
      state.receipt = retryable ? "retryable" : "responded";
    },
    pruneTurnReceipts: async () => {},
    writeUsageReceipt: async (database: unknown, owner: string, receipt: UsageReceipt) => {
      assert.equal(database, sql); assert.equal(owner, "fixture-owner");
      state.attempts.push(structuredClone(receipt));
      if (options.failWrite?.(state.attempts.length, receipt)) throw new Error("fixture accounting unavailable");
      state.durable.set(receipt.id, structuredClone(receipt));
    },
    dispatchMindTurn: async (_request: Request, owner: string, _body: Record<string, unknown>, markDispatched: () => void) => {
      assert.equal(owner, "fixture-owner");
      state.dispatches++;
      return options.dispatch(() => { state.providerCalls++; markDispatched(); });
    },
  });
  assert.equal(typeof exported.handleMindTurn, "function");
  return {
    state, operationId,
    send: () => exported.handleMindTurn!(new Request("https://fixture.example/api/mind/turn", {
      method: "POST", headers: { "content-type": "application/json", "x-mind-turn-id": operationId },
      body: JSON.stringify({ text: "fixture request", provider: "gemini", memory: "off", chatId: "fixture-chat" }),
    })),
  };
}

test("C5 actual turn handler refuses dispatch when the initial durable usage write fails and permits retry", async () => {
  const f = fixture({
    failWrite: attempt => attempt === 1,
    dispatch: async mark => { mark(); return Response.json({ ok: true, text: "fixture answer" }); },
  });
  const blocked = await f.send();
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get("x-mind-dispatch"), "none");
  assert.match((await blocked.json()).error, /Execution accounting is unavailable/);
  assert.equal(f.state.dispatches, 0);
  assert.equal(f.state.providerCalls, 0);
  assert.equal(f.state.durable.size, 0);
  assert.deepEqual(f.state.finished, [true]);
  assert.equal(f.state.receipt, "retryable");
  const recovered = await f.send();
  assert.equal(recovered.status, 200);
  assert.equal(f.state.providerCalls, 1);
  assert.deepEqual(f.state.finished, [true, false]);
});

test("C5 actual turn handler records rejected preflight as undispatched and leaves the same send retryable", async () => {
  let ready = false;
  const f = fixture({ dispatch: async mark => {
    if (!ready) return Response.json({ ok: false, error: "fixture stop status unavailable" }, { status: 503 });
    mark(); return Response.json({ ok: true, text: "fixture answer" });
  } });
  const blocked = await f.send();
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get("x-mind-dispatch"), "none");
  assert.equal(f.state.providerCalls, 0);
  const record = f.state.durable.get(`${f.operationId}/answer`)!;
  assert.equal(record.outcome, "rejected_before_dispatch");
  assert.equal(record.dispatched, false);
  assert.deepEqual(f.state.finished, [true]);
  ready = true;
  assert.equal((await f.send()).status, 200);
  assert.equal(f.state.providerCalls, 1);
  assert.deepEqual(f.state.finished, [true, false]);
});

test("C5 actual turn handler preserves response bytes after final accounting failure without repeating inference", async () => {
  const bodies = [
    { contentType: "text/event-stream", text: 'event: delta\ndata: {"text":"fixture answer"}\n\nevent: done\ndata: {"text":"fixture answer","model":"fixture-gemini","provider":"gemini","requestId":"fixture-provider-request","usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n' },
    { contentType: "application/json", text: '{"ok":true,"text":"fixture answer","requestId":"fixture-provider-request"}' },
  ];
  for (const body of bodies) {
    const f = fixture({
      failWrite: attempt => attempt > 1,
      dispatch: async mark => {
        mark();
        return new Response(body.text, { headers: { "content-type": body.contentType, "x-request-id": "fixture-provider-request" } });
      },
    });
    const delivered = await f.send();
    assert.equal(delivered.status, 200);
    assert.equal(delivered.headers.get("x-mind-dispatch"), "sent");
    assert.equal(delivered.headers.get("x-request-id"), "fixture-provider-request");
    assert.equal(await delivered.text(), body.text, "Accounting failure must preserve every response byte");
    assert.equal(f.state.providerCalls, 1);
    assert.deepEqual(f.state.finished, [false]);
    const durable = f.state.durable.get(`${f.operationId}/answer`)!;
    assert.equal(durable.outcome, "unconfirmed");
    assert.equal(durable.promptTokens, null);
    assert.equal(durable.requestId, null);
    if (body.contentType === "text/event-stream") {
      assert.equal(f.state.attempts.at(-1)?.outcome, "completed", "The real SSE wrapper attempted the final receipt");
      assert.equal(f.state.attempts.at(-1)?.promptTokens, 7);
    }
    const replay = await f.send();
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).duplicate, true);
    assert.equal(f.state.dispatches, 1);
    assert.equal(f.state.providerCalls, 1);
    assert.equal(f.state.durable.get(`${f.operationId}/answer`)?.outcome, "unconfirmed");
  }
});
