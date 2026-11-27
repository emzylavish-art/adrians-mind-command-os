import assert from "node:assert/strict";
import { test } from "node:test";
import { withFleetDispatchLimit } from "./fleet-dispatch.ts";

test("owner provider policy denies before dispatch and preserves the known not-sent outcome", async () => {
  let dispatched = 0;
  const result = await withFleetDispatchLimit("owner", async owner => { assert.equal(owner, "owner"); return { ok: false, error: "Daily limit reached" }; }, async () => { dispatched++; return { ok: true, text: "answer", provider: "fixture", model: "fixture" }; });
  assert.equal(dispatched, 0);
  assert.deepEqual(result, { ok: false, error: "Daily limit reached", outcome: "not_sent" });
});

test("one granted reservation permits one dispatch and a failed policy read fails closed", async () => {
  let reserved = 0;
  let dispatched = 0;
  const dispatch = async () => { dispatched++; return { ok: true as const, text: "answer", provider: "fixture", model: "fixture" }; };
  const result = await withFleetDispatchLimit("owner", async () => { reserved++; return { ok: true }; }, dispatch);
  assert.equal(result.ok, true);
  assert.equal(reserved, 1);
  assert.equal(dispatched, 1);
  const failed = await withFleetDispatchLimit("owner", async () => { throw new Error("database unavailable"); }, dispatch);
  assert.equal(failed.ok, false);
  assert.equal(dispatched, 1);
});

test("fleet money gates bind project, task, step, real provider/model and arguments before one dispatched call", async () => {
  const { withFleetModelBudget } = await import("./fleet-dispatch.ts");
  const request = { action: "model" as const, runId: "run-a", stepId: "model-step", goal: "Synthetic goal", instructions: "Read only", projectId: "project-a", provider: "nemotron", modelTier: null, results: [], input: undefined };
  const identities: import("./financial-policy.ts").MonetaryDispatchContext[] = [];
  const settlements: import("./financial-policy.ts").MonetarySettlement[] = [];
  let calls = 0;
  const work = async () => { calls++; return { ok: true, text: "Synthetic provider answer", model: "fixture/model:free", requestId: "provider-a", actualCostMicros: 123, currency: "USD" }; };
  const reserve = async (_owner: string, context: import("./financial-policy.ts").MonetaryDispatchContext) => { identities.push(context); return identities.length === 1 ? { ok: false as const, error: "Review this ceiling", status: 409 } : { ok: true as const, reservationId: "reservation-a" }; };
  const settle = async (_owner: string, id: string | undefined, receipt: import("./financial-policy.ts").MonetarySettlement) => { assert.equal(id,"reservation-a"); settlements.push(receipt); };
  const denied = await withFleetModelBudget("owner",request,{provider:"openrouter",model:"fixture/model:free"},work,{reserve,settle});
  assert.equal(denied.ok,false); assert.equal(calls,0); assert.equal(settlements.length,0);
  const result = await withFleetModelBudget("owner",request,{provider:"openrouter",model:"fixture/model:free"},work,{reserve,settle});
  assert.equal(result.ok,true);assert.equal(calls,1);assert.deepEqual(identities[0],identities[1]);
  assert.equal(identities[0]!.provider,"openrouter");assert.equal(identities[0]!.model,"fixture/model:free");assert.equal(identities[0]!.projectId,"project-a");assert.equal(identities[0]!.taskId,"run-a");assert.equal(identities[0]!.textOnly,true);assert.equal(JSON.stringify(identities[0]).includes("Synthetic goal"),false);
  assert.deepEqual(settlements,[{outcome:"completed",actualCostMicros:123,currency:"USD",providerRequestId:"provider-a"}]);
});

test("fleet lost provider response stays financially unknown and pre-dispatch refusals remain not sent", async () => {
  const { withFleetModelBudget } = await import("./fleet-dispatch.ts");
  const request = { action: "model" as const, runId: "run-b", stepId: "model-step", goal: "Fixture", instructions: "", provider: "grok", modelTier: null, results: [], input: undefined };
  const settlements: import("./financial-policy.ts").MonetarySettlement[]=[];
  const deps={reserve:async()=>({ok:true as const,reservationId:"r"}),settle:async(_owner:string,_id:string|undefined,receipt:import("./financial-policy.ts").MonetarySettlement)=>{settlements.push(receipt);}};
  await assert.rejects(withFleetModelBudget("owner",request,{provider:"xai",model:"fixture"},async()=>{throw Error("network fixture");},deps),/network fixture/);
  assert.deepEqual(settlements,[{outcome:"unknown"}]);
  const denied=await withFleetModelBudget("owner",request,{provider:"xai",model:"fixture"},async()=>({ok:false,error:"Missing key",dispatched:false}),deps);
  assert.equal(denied.ok,false);if(!denied.ok)assert.equal(denied.outcome,"not_sent");assert.deepEqual(settlements[1],{outcome:"not_sent"});
});

test("delegated model steps keep distinct operations under the shared parent task budget",async()=>{
  const {withFleetModelBudget}=await import("./fleet-dispatch.ts");const seen:import("./financial-policy.ts").MonetaryDispatchContext[]=[];
  for(const runId of ["child-a","child-b"])await withFleetModelBudget("owner",{action:"model",runId,taskId:"parent-task",projectId:"project-a",stepId:"model",goal:"Fixture",instructions:"",provider:"gemini",modelTier:null,results:[],input:undefined},{provider:"gemini",model:"fixture"},async()=>({ok:true,text:"Fixture",model:"fixture"}),{reserve:async(_owner,context)=>{seen.push(context);return {ok:false,error:"Fixture no dispatch",status:403};},settle:async()=>{throw Error("Unexpected settlement");}});
  assert.equal(seen[0]!.taskId,"parent-task");assert.equal(seen[1]!.taskId,"parent-task");assert.notEqual(seen[0]!.operationId,seen[1]!.operationId);
});
