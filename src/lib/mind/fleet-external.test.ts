import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../db.ts";
import type { Workspace } from "./types.ts";
import { addCustomAgent, approveRunAction, enqueueRun, tickFleet } from "./fleet.ts";
import { emptyWorkspace } from "./workspace.ts";
import { runExternalFleetStep } from "./fleet-external.ts";
import { preserveServerRunAuthority } from "./store.ts";

const NOW = "2026-11-25T12:00:00.000Z";
function prepared() {
  const made = addCustomAgent(emptyWorkspace(), { name: "Fixture", tools: ["model"], instructions: "Read only", chatProvider: "gemini" }, NOW); assert.ok(made.ok);
  const queued = enqueueRun(made.ws, made.agent.id, "Analyze fixture", NOW); assert.ok(queued.ok);
  const pending = tickFleet(queued.ws, { now: NOW, workerId: "local" });
  return approveRunAction(pending, pending.runs[0]!.id, pending.runs[0]!.pendingApproval!.id, NOW);
}
function database(ws: Workspace) {
  const rows = new Map<string, string>([["owner-a", JSON.stringify(ws)]]);
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    const owner = String(values[0]);
    if (text.includes("select payload")) return rows.has(owner) ? [{ payload: rows.get(owner) }] : [];
    if (text.includes("insert into mind_snapshot")) {
      if (values.length > 1) rows.set(owner, String(values[1]));
      else if (!rows.has(owner)) rows.set(owner, "{}");
    }
    return [];
  }) as Sql;
  sql.query = async () => [];
  let last = Promise.resolve();
  sql.transaction = async fn => {
    const previous = last; let release!: () => void;
    last = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(sql); } finally { release(); }
  };
  return { sql, rows, read: () => JSON.parse(rows.get("owner-a")!) as Workspace, write: (next: Workspace) => rows.set("owner-a", JSON.stringify(next)) };
}
function input(ws: Workspace) { return { runId: ws.runs[0]!.id, approvalId: ws.runs[0]!.pendingApproval!.id }; }
const success = { ok: true as const, text: "Fixture response", provider: "gemini", model: "fixture-model" };

test("connected dispatch commits the claim before calling the adapter, then persists its receipt", async () => {
  const ws = prepared(); const db = database(ws); let called = 0;
  const result = await runExternalFleetStep(db.sql, "owner-a", input(ws), {
    now: () => NOW, stop: async () => "off", execute: async request => {
      called++;
      assert.equal(request.provider, "gemini");
      assert.equal(db.read().runs[0]!.externalOperation!.state, "dispatching");
      assert.equal(db.read().runs[0]!.pendingApproval, undefined);
      return success;
    },
  });
  assert.equal(called, 1); assert.equal(result.ok, true);
  assert.equal(db.read().runs[0]!.step, 1);
  assert.equal(db.read().runs[0]!.externalOperation!.state, "succeeded");
  assert.equal(db.read().runs[0]!.stepResults![0]!.receipt!.provider, "gemini");
});

test("two simultaneous deliveries dispatch exactly once", async () => {
  const ws = prepared(); const db = database(ws); let called = 0;
  const deps = { now: () => NOW, stop: async () => "off" as const, execute: async () => { called++; return success; } };
  const results = await Promise.all([runExternalFleetStep(db.sql, "owner-a", input(ws), deps), runExternalFleetStep(db.sql, "owner-a", input(ws), deps)]);
  assert.equal(called, 1); assert.equal(results.filter(result => result.ok).length, 1);
});

test("another signed-in owner cannot execute this owner's saved authorization", async () => {
  const ws = prepared(); const db = database(ws);
  const result = await runExternalFleetStep(db.sql, "owner-b", input(ws), { now: () => NOW, stop: async () => "off", execute: async () => { throw Error("cross-owner dispatch"); } });
  assert.equal(result.ok, false);
  assert.equal(db.read().runs[0]!.externalOperation, undefined);
});

test("an unknown external outcome is retained and never replayed on another delivery or worker tick", async () => {
  const ws = prepared(); const db = database(ws); let called = 0;
  const deps = { now: () => NOW, stop: async () => "off" as const, execute: async () => { called++; throw Error("network response lost"); } };
  const first = await runExternalFleetStep(db.sql, "owner-a", input(ws), deps);
  assert.equal(first.ok, false); assert.equal(first.run!.externalOperation!.state, "unknown");
  await runExternalFleetStep(db.sql, "owner-a", input(ws), deps);
  tickFleet(db.read(), { now: "2026-11-26T12:00:00.000Z", workerId: "new-worker", model: () => { called++; return success; } });
  assert.equal(called, 1);
});

test("a stop raised between durable claim and dispatch prevents the external call", async () => {
  const ws = prepared(); const db = database(ws); let checks = 0; let called = 0;
  const result = await runExternalFleetStep(db.sql, "owner-a", input(ws), { now: () => NOW, stop: async () => ++checks === 1 ? "off" : "on", execute: async () => { called++; return success; } });
  assert.equal(called, 0); assert.equal(result.ok, false); assert.equal(db.read().runs[0]!.state, "canceled");
});

test("cancellation after dispatch remains canceled while preserving the confirmed external receipt", async () => {
  const ws = prepared(); const db = database(ws);
  const result = await runExternalFleetStep(db.sql, "owner-a", input(ws), { now: () => NOW, stop: async () => "off", execute: async () => {
    const next = db.read(); next.runs[0]!.state = "canceled"; db.write(next); return success;
  } });
  assert.equal(result.run!.state, "canceled");
  assert.equal(result.run!.externalOperation!.state, "succeeded");
  assert.equal(result.run!.stepResults![0]!.text, "Fixture response");
});

test("stale or changed grant fails before any adapter dispatch", async () => {
  const ws = prepared(); ws.runs[0]!.goal = "Changed destination"; const db = database(ws); let called = 0;
  const result = await runExternalFleetStep(db.sql, "owner-a", input(ws), { now: () => NOW, stop: async () => "off", execute: async () => { called++; return success; } });
  assert.equal(result.ok, false); assert.equal(called, 0); assert.equal(result.run!.state, "waiting_approval");
});

test("snapshot saves cannot rewind dispatch authority or erase an unknown outcome", async () => {
  const ws = prepared(); const db = database(ws);
  const old = ws.runs[0]!;
  await runExternalFleetStep(db.sql, "owner-a", input(ws), { now: () => NOW, stop: async () => "off", execute: async () => { throw Error("unknown"); } });
  const saved = db.read().runs;
  const merged = preserveServerRunAuthority(saved, [old]);
  assert.equal(merged[0]!.externalOperation!.state, "unknown");
  assert.equal(merged[0]!.pendingApproval, undefined);
  assert.equal(merged[0]!.state, "failed");
  assert.equal(preserveServerRunAuthority(saved, []).length, 1);
});

test("a succeeded operation permits subsequent local progress while protecting its provider evidence", async () => {
  const ws = prepared(); const db = database(ws);
  const outcome = await runExternalFleetStep(db.sql, "owner-a", input(ws), { now: () => NOW, stop: async () => "off", execute: async () => success });
  const saved = db.read().runs;
  const completed = tickFleet(db.read(), { now: NOW, workerId: "local" }).runs;
  const merged = preserveServerRunAuthority(saved, completed);
  assert.equal(merged[0]!.state, "completed");
  assert.equal(merged[0]!.step, outcome.run!.step);
  assert.equal(merged[0]!.stepResults![0]!.text, "Fixture response");
  completed[0]!.stepResults![0]!.text = "Forged provider text";
  assert.equal(preserveServerRunAuthority(saved, completed)[0]!.stepResults![0]!.text, "Fixture response");
});

test("a normal pending request can be granted by the owner and a consumed ID cannot be revived", () => {
  const ws = prepared(); const granted = ws.runs[0]!;
  const pending = { ...granted, state: "waiting_approval" as const, pendingApproval: { ...granted.pendingApproval!, state: "requested" as const } };
  assert.equal(preserveServerRunAuthority([pending], [granted])[0]!.pendingApproval!.state, "granted");
  const consumed = { ...granted, pendingApproval: undefined, approvalHistory: [{ ...granted.pendingApproval!, state: "consumed" as const }] };
  assert.equal(preserveServerRunAuthority([consumed], [granted])[0]!.pendingApproval, undefined);
});

test("known pre-dispatch budget refusal pauses, then explicit resume requests a fresh tool grant for the same step", async () => {
  const { resumeRun }=await import("./fleet.ts");
  const ws=prepared();const db=database(ws);const oldApproval=ws.runs[0]!.pendingApproval!.id;
  const blocked=await runExternalFleetStep(db.sql,"owner-a",input(ws),{now:()=>NOW,stop:async()=>"off",execute:async()=>({ok:false,error:"Review this exact request ceiling in Usage & budgets.",outcome:"not_sent"})});
  assert.equal(blocked.ok,false);assert.equal(blocked.run!.state,"paused");assert.equal(blocked.run!.externalOperation!.state,"not_sent");assert.equal(blocked.run!.pendingApproval,undefined);
  const resumed=resumeRun(db.read(),ws.runs[0]!.id);resumed.runs=preserveServerRunAuthority(db.read().runs,resumed.runs);assert.equal(resumed.runs[0]!.state,"queued");
  const pending=tickFleet(resumed,{now:"2026-11-25T12:01:00.000Z",workerId:"local"});assert.equal(pending.runs[0]!.state,"waiting_approval");assert.notEqual(pending.runs[0]!.pendingApproval!.id,oldApproval);
  const authorized=approveRunAction(pending,pending.runs[0]!.id,pending.runs[0]!.pendingApproval!.id,"2026-11-25T12:01:00.000Z");authorized.runs=preserveServerRunAuthority(db.read().runs,authorized.runs);assert.equal(authorized.runs[0]!.pendingApproval!.state,"granted");db.write(authorized);
  let calls=0;const executed=await runExternalFleetStep(db.sql,"owner-a",input(authorized),{now:()=>"2026-11-25T12:01:00.000Z",stop:async()=>"off",execute:async request=>{calls++;assert.equal(request.runId,ws.runs[0]!.id);assert.equal(request.stepId,ws.runs[0]!.plan[0]!.id);return success;}});
  assert.equal(executed.ok,true);assert.equal(calls,1);assert.equal(executed.run!.externalOperation!.state,"succeeded");
});

test("a known unsent receipt still cannot be advanced, declared complete or resumed after cancellation by a snapshot",async()=>{
  const ws=prepared();const db=database(ws);
  await runExternalFleetStep(db.sql,"owner-a",input(ws),{now:()=>NOW,stop:async()=>"off",execute:async()=>({ok:false,error:"Before dispatch refusal",outcome:"not_sent"})});
  const saved=db.read().runs;const forged={...saved[0]!,state:"completed" as const,step:1};
  assert.equal(preserveServerRunAuthority(saved,[forged])[0]!.state,"paused");assert.equal(preserveServerRunAuthority(saved,[forged])[0]!.step,0);
  const canceled={...saved[0]!,state:"canceled" as const};assert.equal(preserveServerRunAuthority([canceled],[{...forged,state:"queued",step:0}])[0]!.state,"canceled");
});

test("an unsent attempt with a closed reservation requires a new run rather than reusing its operation ID",async()=>{
  const ws=prepared();const db=database(ws);const result=await runExternalFleetStep(db.sql,"owner-a",input(ws),{now:()=>NOW,stop:async()=>"off",execute:async()=>({ok:false,error:"Reservation closed; queue a new run.",outcome:"not_sent",retryable:false})});
  assert.equal(result.run!.state,"failed");assert.equal(result.run!.externalOperation!.state,"not_sent");
  const forged={...result.run!,state:"queued" as const};assert.equal(preserveServerRunAuthority(db.read().runs,[forged])[0]!.state,"failed");
});
