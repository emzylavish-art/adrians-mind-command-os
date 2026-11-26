import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../db.ts";
import { addAgentFromTemplate, enqueueRun } from "./fleet.ts";
import { executeFleetModelStep } from "./fleet-model.server.ts";
import { emptyWorkspace } from "./workspace.ts";
import { preserveServerRunAuthority, snapshotRevision, updateOwnerWorkspace } from "./store.ts";
import type { UsageReceipt } from "./usage-ledger.ts";

function fixture(provider = "gemini") {
  const made = addAgentFromTemplate(emptyWorkspace(), "Personal assistant", "2026-01-01T00:00:00.000Z");
  if (!made.ok) throw Error(made.error);
  made.ws.agents[0] = { ...made.ws.agents[0], instructions: "Answer with fixture evidence", tools: ["model"], chatProvider: provider };
  const queued = enqueueRun(made.ws, made.agent.id, "Use my exact instruction");
  if (!queued.ok) throw Error(queued.error);
  let snapshot = JSON.stringify(queued.ws);
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");
    if (query.includes("select payload")) return [{ payload: JSON.parse(snapshot) }];
    if (query.includes("insert into mind_snapshot") && values.length === 2) snapshot = String(values[1]);
    return [];
  }) as Sql;
  sql.query = async () => [];
  let tail = Promise.resolve();
  sql.transaction = async (fn) => {
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await fn(sql); } finally { release(); }
  };
  return { sql, queued, read: () => JSON.parse(snapshot) };
}

test("C5 two workers claim one model operation and record its actual provider usage", async () => {
  const f = fixture();
  const records: UsageReceipt[] = [];
  let calls = 0;
  const input = { runId: f.queued.run.id, expectedRevision: snapshotRevision(f.queued.ws), freeOnly: false, allowPaid: true };
  const deps = {
    stop: async () => "off" as const,
    call: async (_owner: string, provider: string, prompt: string, dispatch: () => void) => {
      dispatch(); calls++;
      assert.equal(provider, "gemini");
      assert.match(prompt, /Answer with fixture evidence/);
      return { ok: true, text: "Fixture provider answered", model: "fixture-gemini", usage: { prompt_tokens: 12, completion_tokens: 3 }, requestId: "fixture-request" };
    },
    record: async (_sql: Sql, _owner: string, receipt: UsageReceipt) => { records.push(receipt); },
  };
  const results = await Promise.all([executeFleetModelStep(f.sql, "owner", input, deps), executeFleetModelStep(f.sql, "owner", input, deps)]);
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(f.read().runs[0].result, "Fixture provider answered");
  assert.equal(records.at(-1)?.promptTokens, 12);
  assert.equal(records.at(-1)?.requestId, "fixture-request");
});

test("C5 free-only and unconfirmed provider results cannot trigger a paid fallback or replay", async () => {
  const f = fixture();
  let calls = 0;
  const deps = { stop: async () => "off" as const, record: async () => {}, call: async (_owner: string, _provider: string, _text: string, dispatch: () => void) => { calls++; dispatch(); throw Error("fixture connection lost"); } };
  const input = { runId: f.queued.run.id, expectedRevision: snapshotRevision(f.queued.ws), allowPaid: true, freeOnly: true };
  assert.equal((await executeFleetModelStep(f.sql, "owner", input, deps)).ok, false);
  assert.equal(calls, 0);
  assert.equal((await executeFleetModelStep(f.sql, "owner", { ...input, freeOnly: false }, deps)).ok, true);
  const current = f.read();
  assert.equal(current.runs[0].modelOperation.state, "uncertain");
  await executeFleetModelStep(f.sql, "owner", { ...input, freeOnly: false, expectedRevision: snapshotRevision(current) }, deps);
  assert.equal(calls, 1);
});

test("C5 a changed or unknown stop aborts active model transport and never replays the uncertain call", async () => {
  for (const stopped of ["on", "unknown"] as const) {
    const f = fixture();
    const records: UsageReceipt[] = [];
    let checks = 0, calls = 0, aborted = false, cleared = false;
    const deps = {
      stop: async () => cleared || ++checks < 3 ? "off" as const : stopped,
      record: async (_sql: Sql, _owner: string, row: UsageReceipt) => { records.push(row); },
      call: async (_owner: string, _provider: string, _text: string, dispatched: () => void, signal: AbortSignal) => {
        calls++; dispatched();
        return new Promise<{ ok: boolean; text: string }>((resolve) => {
          signal.addEventListener("abort", () => { aborted = true; resolve({ ok: false, text: "" }); }, { once: true });
        });
      },
    };
    const result = await executeFleetModelStep(f.sql, "owner", { runId: f.queued.run.id, expectedRevision: snapshotRevision(f.queued.ws), freeOnly: false, allowPaid: true }, deps);
    assert.equal(result.ok, true); assert.equal(aborted, true); assert.equal(calls, 1);
    assert.equal(f.read().halted, true);
    assert.equal(f.read().runs[0].modelOperation.state, "uncertain");
    assert.equal(records.at(-1)?.outcome, "unconfirmed"); assert.equal(records.at(-1)?.dispatched, true);
    cleared = true;
    await updateOwnerWorkspace(f.sql, "owner", ws => ({ workspace: { ...ws, halted: false }, result: undefined }));
    const retry = await executeFleetModelStep(f.sql, "owner", { runId: f.queued.run.id, expectedRevision: snapshotRevision(f.read()), freeOnly: false, allowPaid: true }, deps);
    assert.equal(retry.ok, false); assert.equal(calls, 1);
  }
});

test("C5 fleet receipts preserve the selected Nemotron route while recording its actual provider and unknown model", async () => {
  const f = fixture("nemotron");
  const records: UsageReceipt[] = [];
  const result = await executeFleetModelStep(f.sql, "owner", { runId: f.queued.run.id, expectedRevision: snapshotRevision(f.queued.ws), freeOnly: true }, {
    stop: async () => "off",
    record: async (_sql, _owner, row) => { records.push(row); },
    call: async (_owner, provider, _text, dispatched) => { assert.equal(provider, "nemotron"); dispatched(); return { ok: true, text: "Fixture answer without model metadata" }; },
  });
  assert.equal(result.ok, true);
  assert.equal(records[0].provider, "openrouter");
  assert.equal(records[0].requestedModel, "nvidia/nemotron-nano-9b-v2:free");
  assert.equal(records[0].model, "model unknown");
  assert.equal(records.at(-1)?.provider, "openrouter");
  assert.equal(records.at(-1)?.model, "model unknown");
});

test("account stop retains a completed provider answer without queuing another step", async () => {
  const f = fixture();
  let stopped = false;
  const result = await executeFleetModelStep(f.sql, "owner", { runId: f.queued.run.id, expectedRevision: snapshotRevision(f.queued.ws), freeOnly: false, allowPaid: true }, {
    stop: async () => stopped ? "on" : "off",
    record: async () => {},
    call: async (_owner, _provider, _text, mark) => { mark(); stopped = true; return { ok: true, text: "Completed before stop", model: "fixture-model" }; },
  });
  assert(result.ok);
  const run = result.workspace.runs.find(row => row.id === f.queued.run.id)!;
  assert.equal(run.state, "canceled");
  assert.equal(run.modelOperation?.state, "completed");
  assert.match(run.result, /Completed before stop/);
});

test("a stale browser snapshot cannot rewind, omit or manufacture a model operation", () => {
  const { queued } = fixture();
  const claim = { ...queued.run, state: "waiting_external" as const, modelOperation: { id: "claimed-operation", state: "claimed" as const, provider: "gemini" } };
  assert.deepEqual(preserveServerRunAuthority([claim], [queued.run])[0]?.modelOperation, claim.modelOperation);
  assert.deepEqual(preserveServerRunAuthority([claim], []), [claim]);
  assert.equal(preserveServerRunAuthority([], [claim])[0]?.modelOperation, undefined);
});
