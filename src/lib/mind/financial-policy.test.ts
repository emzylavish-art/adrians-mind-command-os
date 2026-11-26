import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { DEFAULT_FINANCIAL_POLICY, dollarsToMicros, financialPeriods, parseFinancialPolicy, type FinancialPolicy, type MonetaryDispatchContext } from "./financial-policy.ts";
import { approveFinancialRequest, readFinancialSnapshot, reconcileFinancialInvoice, refreshVerifiedFreePricing, saveFinancialPolicy, settleFinancialReservation } from "./financial-policy.server.ts";
import { readDispatchPolicy, reserveOwnerDispatch } from "./dispatch-controls.server.ts";

// Real isolated PostgreSQL semantics, one in-memory engine for all cases; never app storage.
const pg = new PGlite();
function sqlFor(db: Pick<PGlite,"query"> & Partial<Pick<PGlite,"transaction">>): Sql {
  const sql = (async (parts: TemplateStringsArray,...args:unknown[]) => {
    const query = parts.reduce((all,part,i) => all + (i ? `$${i}` : "") + part, "");
    return (await db.query(query,args)).rows;
  }) as Sql;
  sql.query = async <T = Record<string,unknown>>(query: string,args:unknown[] = []) => (await db.query(query,args)).rows as T[];
  if (db.transaction) sql.transaction = work => db.transaction!(tx => work(sqlFor(tx)));
  return sql;
}
const sql=sqlFor(pg);
const NOW=Date.parse("2026-11-26T12:00:00.000Z");
const EXPIRY="2027-12-31T00:00:00.000Z";
let serial=0;
const context=(overrides: Partial<MonetaryDispatchContext> = {}):MonetaryDispatchContext=>({operationId:`fixture-${++serial}`,provider:"openai",model:"fixture-model",taskId:"fixture-task",projectId:"project-a",requestHash:"a".repeat(64),textOnly:true,...overrides});
const policy=(overrides:Partial<FinancialPolicy> = {})=>({...structuredClone(DEFAULT_FINANCIAL_POLICY),enabled:true,dailyLimitMicros:10_000_000,weeklyLimitMicros:10_000_000,monthlyLimitMicros:10_000_000,taskLimitMicros:10_000_000,approvalAboveMicros:10_000_000,ceilings:[{provider:"openai",model:"fixture-model",ceilingMicros:250_000,expiresAt:EXPIRY,note:"Fixture owner estimate, not a price",basis:"owner_estimate" as const}],...overrides});
async function owner(overrides: Partial<FinancialPolicy> = {}) {const id=`owner-${++serial}`; assert.deepEqual(await saveFinancialPolicy(id,{...policy(overrides),expectedRevision:0},sql),{ok:true});return id;}
async function reserve(id:string,request=context(),now=NOW) {return reserveOwnerDispatch(id,sql,now,request);}
async function reserved(id:string,request=context(),now=NOW) {const result=await reserve(id,request,now);assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.ok&&result.reservationId);return result.reservationId;}
before(async()=>{await pg.waitReady;for(const name of ["0019_c3_dispatch_controls.sql","0021_c3_financial_policy.sql"])await pg.exec(readFileSync(new URL(`../../../migrations/${name}`,import.meta.url),"utf8"));});
after(async()=>{await pg.close();});

test("money values are exact microdollars and period boundaries are explicit UTC",()=>{
  assert.equal(dollarsToMicros("0.000001"),1); assert.equal(dollarsToMicros("1.2"),1_200_000); assert.equal(dollarsToMicros("1.0000001"),null);assert.equal(dollarsToMicros("-1"),null);
  assert.deepEqual(financialPeriods(Date.parse("2026-03-01T23:59:59Z")),{day:"2026-03-01",week:"2026-02-23",month:"2026-03"});
  assert.deepEqual(financialPeriods(Date.parse("2026-03-02T00:00:00Z")),{day:"2026-03-02",week:"2026-03-02",month:"2026-03"});
  for(const changes of [{dailyLimitMicros:0.1},{monthlyLimitMicros:Infinity},{providerMonthlyCaps:{p:-1}},{ceilings:[{provider:"x",model:"y",ceilingMicros:2,expiresAt:"invalid",basis:"owner_estimate",note:""}]}])assert.equal(parseFinancialPolicy({...policy(),expectedRevision:0,...changes}).ok,false);
});

test("disabled monetary policy preserves request quota behavior without manufacturing a ledger",async()=>{
  const id=`disabled-${++serial}`;const granted=await reserveOwnerDispatch(id,sql,NOW);assert.deepEqual(granted,{ok:true});
  const snapshot=await readFinancialSnapshot(id,sql,NOW);assert.equal(snapshot.policy.enabled,false);assert.equal(snapshot.ledger.length,0);assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,1);
});

test("enabled missing context, unknown model, zero estimate and expired estimate stop before quotas or reservations",async()=>{
  const id=await owner();assert.equal((await reserveOwnerDispatch(id,sql,NOW)).ok,false);
  assert.equal((await reserve(id,context({model:""}))).ok,false);assert.equal((await reserve(id,context({model:"unknown"}))).ok,false);
  for(const change of [{ceilingMicros:0},{expiresAt:"2026-01-01T00:00:00Z"}]){
    const p=policy();const who=await owner({ceilings:[{...p.ceilings[0]!,...change}]});assert.equal((await reserve(who)).ok,false);
  }
  assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,0);assert.equal((await readFinancialSnapshot(id,sql,NOW)).ledger.length,0);
});

test("concurrent reservations enforce the same owner budget atomically and isolate other owners",async()=>{
  const id=await owner({dailyLimitMicros:1_000_000});
  const results=await Promise.all(Array.from({length:9},()=>reserve(id)));
  assert.equal(results.filter(row=>row.ok).length,4);assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,4);
  const snapshot=await readFinancialSnapshot(id,sql,NOW);assert.equal(snapshot.totals.dayMicros,1_000_000);assert.equal(snapshot.ledger.length,4);assert.equal(snapshot.totals.unknownCount,4);
  assert.equal((await reserve(await owner())).ok,true);
});

test("daily, weekly, monthly, task, provider and project caps each block only their concrete scope",async()=>{
  const cases:Array<{name:string;changes:Partial<FinancialPolicy>;secondNow?:number;second?:Partial<MonetaryDispatchContext>}>=[
    {name:"daily",changes:{dailyLimitMicros:400_000}},
    {name:"weekly",changes:{weeklyLimitMicros:400_000},secondNow:NOW+86400000},
    {name:"monthly",changes:{monthlyLimitMicros:400_000},secondNow:Date.parse("2026-11-30T12:00:00Z")},
    {name:"task",changes:{taskLimitMicros:400_000},secondNow:Date.parse("2026-12-03T12:00:00Z")},
    {name:"provider monthly",changes:{providerMonthlyCaps:{openai:400_000}},second:{projectId:"another-project",taskId:"another-task"}},
    {name:"project monthly",changes:{projectMonthlyCaps:{"project-a":400_000}},second:{taskId:"another-task"}},
  ];
  for(const scenario of cases){const id=await owner(scenario.changes);await reserved(id);const denied=await reserve(id,context(scenario.second),scenario.secondNow??NOW);assert.equal(denied.ok,false,scenario.name);if(!denied.ok)assert.match(denied.error,new RegExp(scenario.name));}
  const projects=await owner({projectMonthlyCaps:{"project-a":250_000}});await reserved(projects);assert.equal((await reserve(projects,context({projectId:"project-b"}))).ok,true);
});

test("one Speak task budget accumulates distinct input, answer and output operations", async () => {
  const taskId = `speak-task-${++serial}`;
  const id = await owner({ taskLimitMicros: 500_000 });
  const stage = (name: "input" | "answer" | "output") => context({ operationId: `${taskId}:${name}`, taskId, projectId: "speak-project" });
  const input = await reserved(id, stage("input"));
  const answer = await reserved(id, stage("answer"));
  // A returned transcript/answer without a dollar receipt is still a budget commitment.
  await settleFinancialReservation(id, input, { outcome: "completed" }, sql);
  await settleFinancialReservation(id, answer, { outcome: "completed" }, sql);
  const output = await reserve(id, stage("output"));
  assert.equal(output.ok, false);
  if (!output.ok) assert.match(output.error, /task/i);
  const snapshot = await readFinancialSnapshot(id, sql, NOW);
  assert.equal(snapshot.ledger.length, 2);
  assert.ok(snapshot.ledger.every(row => row.taskId === taskId && row.state === "unknown"));
  assert.equal(snapshot.totals.dayMicros, 500_000);
  assert.equal((await readDispatchPolicy(id, sql, NOW)).usedToday, 2);
});

test("unknown cost retains the full estimate, known non-dispatch releases it, and a real USD receipt settles it",async()=>{
  const id=await owner({dailyLimitMicros:500_000});const first=await reserved(id);const second=await reserved(id);
  assert.deepEqual(await settleFinancialReservation(id,first,{outcome:"completed"},sql),{ok:true});
  let snapshot=await readFinancialSnapshot(id,sql,NOW);assert.equal(snapshot.ledger.find(r=>r.id===first)!.state,"unknown");assert.equal(snapshot.ledger.find(r=>r.id===first)!.actualMicros,null);assert.equal(snapshot.totals.dayMicros,500_000);assert.equal((await reserve(id)).ok,false);
  await settleFinancialReservation(id,second,{outcome:"not_sent"},sql);snapshot=await readFinancialSnapshot(id,sql,NOW);assert.equal(snapshot.totals.dayMicros,250_000);assert.equal(snapshot.ledger.find(r=>r.id===second)!.state,"released");
  await settleFinancialReservation(id,first,{outcome:"completed",currency:"USD",actualCostMicros:10_000,providerRequestId:"fixture-request"},sql);snapshot=await readFinancialSnapshot(id,sql,NOW);assert.equal(snapshot.totals.dayMicros,10_000);assert.equal(snapshot.ledger.find(r=>r.id===first)!.costBasis,"provider_reported");assert.equal(snapshot.ledger.find(r=>r.id===first)!.providerRequestId,"fixture-request");
  await settleFinancialReservation(id,first,{outcome:"not_sent"},sql);assert.equal((await readFinancialSnapshot(id,sql,NOW)).totals.dayMicros,10_000);
});

test("invalid dollar receipts stay unknown, contradictory positive receipts cannot be released, and ownership is checked",async()=>{
  const id=await owner();const a=await reserved(id);const b=await reserved(id);const other=await owner();
  assert.equal((await settleFinancialReservation(other,a,{outcome:"not_sent"},sql)).ok,false);
  await settleFinancialReservation(id,a,{outcome:"completed",actualCostMicros:0},sql);assert.equal((await readFinancialSnapshot(id,sql,NOW)).ledger.find(row=>row.id===a)!.actualMicros,null);
  await settleFinancialReservation(id,b,{outcome:"not_sent",currency:"USD",actualCostMicros:1234},sql);const row=(await readFinancialSnapshot(id,sql,NOW)).ledger.find(row=>row.id===b)!;assert.equal(row.state,"settled");assert.equal(row.actualMicros,1234);
});

test("duplicate operation ID and changed arguments cannot replay a provider request",async()=>{
  const id=await owner();const request=context();const reservation=await reserved(id,request);
  assert.equal((await reserve(id,request)).ok,false);const changed=await reserve(id,{...request,requestHash:"b".repeat(64)});assert.equal(changed.ok,false);if(!changed.ok)assert.match(changed.error,/different financial arguments/);
  await settleFinancialReservation(id,reservation,{outcome:"not_sent"},sql);assert.equal((await reserve(id,request)).ok,false);assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,1);
});

test("expensive execution requires exact owner review, consumes once and creates no request before approval",async()=>{
  const id=await owner({approvalAboveMicros:100_000});const request=context();const pending=await reserve(id,request);
  assert.equal(pending.ok,false);assert.ok(!pending.ok&&pending.approvalId);assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,0);assert.equal((await readFinancialSnapshot(id,sql,NOW)).ledger.length,0);
  const approvalId=!pending.ok?pending.approvalId!:"";assert.equal((await approveFinancialRequest(await owner(),approvalId,true,sql,NOW)).ok,false);
  assert.equal((await approveFinancialRequest(id,approvalId,true,sql,NOW)).ok,true);
  const changed=await reserve(id,{...request,requestHash:"b".repeat(64)});assert.equal(changed.ok,false);assert.notEqual(!changed.ok&&changed.approvalId,approvalId);
  assert.equal((await reserve(id,request)).ok,true);assert.equal((await reserve(id,request)).ok,false);assert.equal((await approveFinancialRequest(id,approvalId,true,sql,NOW)).ok,false);assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,1);
});

test("expired, revoked and changed-policy reviews cannot authorize an operation",async()=>{
  for(const mode of ["expired","revoked","policy"] as const){const id=await owner({approvalAboveMicros:0});const request=context();const pending=await reserve(id,request);assert.ok(!pending.ok&&pending.approvalId);const approvalId=pending.approvalId;
    assert.equal((await approveFinancialRequest(id,approvalId,true,sql,NOW)).ok,true);
    if(mode==="revoked")assert.equal((await approveFinancialRequest(id,approvalId,false,sql,NOW)).ok,true);
    if(mode==="policy"){const current=(await readFinancialSnapshot(id,sql,NOW)).policy;assert.equal((await saveFinancialPolicy(id,{...current,expectedRevision:current.revision,monthlyLimitMicros:9_000_000},sql)).ok,true);}
    assert.equal((await reserve(id,request,mode==="expired"?NOW+300001:NOW)).ok,false);assert.equal((await readFinancialSnapshot(id,sql,NOW)).ledger.length,0);
  }
});

test("stale policy save cannot overwrite current budgets and revoked reviews stay retired",async()=>{
  const id=await owner();const current=(await readFinancialSnapshot(id,sql,NOW)).policy;
  assert.equal((await saveFinancialPolicy(id,{...current,expectedRevision:current.revision,dailyLimitMicros:1},sql)).ok,true);
  assert.equal((await saveFinancialPolicy(id,{...current,expectedRevision:current.revision,dailyLimitMicros:99},sql)).ok,false);
  assert.equal((await readFinancialSnapshot(id,sql,NOW)).policy.dailyLimitMicros,1);
});

test("invoice reconciliation preserves correction history, is owner scoped and blocks future over-budget work",async()=>{
  const id=await owner({dailyLimitMicros:500_000});const reservationId=await reserved(id);const invoice={reservationId,invoiceRef:"fixture-invoice-1",actualCostMicros:750_000,currency:"USD",confirmed:true};
  assert.equal((await reconcileFinancialInvoice(id,{...invoice,confirmed:false},sql)).ok,false);assert.equal((await reconcileFinancialInvoice(await owner(),invoice,sql)).ok,false);
  assert.equal((await reconcileFinancialInvoice(id,invoice,sql)).ok,true);assert.equal((await reconcileFinancialInvoice(id,invoice,sql)).ok,true);assert.equal((await reconcileFinancialInvoice(id,{...invoice,actualCostMicros:0},sql)).ok,false);
  assert.equal((await reserve(id)).ok,false);assert.equal((await reconcileFinancialInvoice(id,{...invoice,invoiceRef:"fixture-correction-2",actualCostMicros:100_000},sql)).ok,true);
  const row=(await readFinancialSnapshot(id,sql,NOW)).ledger[0]!;assert.equal(row.actualMicros,100_000);assert.equal(row.costBasis,"owner_invoice");
  const changes=await sql<{actual_micros:unknown;previous_micros:unknown}>`select actual_micros,previous_micros from mind_financial_reconciliation where user_id=${id} order by created_at`;
  assert.equal(changes.length,2);assert.equal(Number(changes[1]!.previous_micros),750_000);assert.equal((await reserve(id)).ok,true);
});

test("verified free requires fresh official all-zero pricing and the exact text-only canonical route",async()=>{
  const id=await owner({freeOnly:true,dailyLimitMicros:0,weeklyLimitMicros:0,monthlyLimitMicros:0,taskLimitMicros:0,ceilings:[]});
  const catalog={data:[{id:"fixture/ok:free",pricing:{prompt:"0",completion:"0",request:"0.000"}},{id:"fixture/paid:free",pricing:{prompt:"0",completion:"0",web_search:"0.1"}},{id:"fixture/conditional:free",pricing:{prompt:"0",completion:"0",overrides:[{prompt:"1"}]}},{id:"fixture/no-proof:free",pricing:{prompt:"0"}},{id:"fixture/not-free",pricing:{prompt:"0",completion:"0"}}]};
  let calls=0;assert.deepEqual(await refreshVerifiedFreePricing(id,sql,async(url,init)=>{calls++;assert.equal(String(url),"https://openrouter.ai/api/v1/models");assert.equal(init?.redirect,"error");return Response.json(catalog);},NOW),{ok:true,count:1});assert.equal(calls,1);
  const free=context({provider:"openrouter",model:"fixture/ok:free"});assert.equal((await reserve(id,free)).ok,true);const row=(await readFinancialSnapshot(id,sql,NOW)).ledger[0]!;assert.equal(row.reservedMicros,0);assert.equal(row.actualMicros,null);assert.equal(row.costBasis,"verified_free");
  for(const change of [{textOnly:false},{provider:"custom:fixture"},{model:"fixture/paid:free"},{model:"fixture/conditional:free"}])assert.equal((await reserve(id,context({...free,...change,operationId:`another-${++serial}`}))).ok,false);
  assert.equal((await reserve(id,context({...free,operationId:`expired-${++serial}`}),NOW+15*60000)).ok,false);
});

test("pricing failure keeps prior records but never extends their authorization expiry",async()=>{
  const id=await owner({freeOnly:true});const catalogue={data:[{id:"fixture/ok:free",pricing:{prompt:"0",completion:"0"}}]};await refreshVerifiedFreePricing(id,sql,async()=>Response.json(catalogue),NOW);
  const failed=await refreshVerifiedFreePricing(id,sql,async()=>new Response("unavailable",{status:503}),NOW+14*60000);assert.equal(failed.ok,false);
  assert.equal((await reserve(id,context({provider:"openrouter",model:"fixture/ok:free"}),NOW+16*60000)).ok,false);
});

test("missing transactional storage and corrupted policy fail closed",async()=>{
  const id=await owner();const nonAtomic=sqlFor({query:pg.query.bind(pg)});assert.equal((await reserveOwnerDispatch(id,nonAtomic,NOW,context())).ok,false);
  await sql`update mind_financial_policy set policy='{}'::jsonb where user_id=${id}`;const result=await reserve(id);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.status,503);assert.equal((await readDispatchPolicy(id,sql,NOW)).usedToday,0);
});

test("bounded pricing refresh rejects slow, oversized and malformed bodies without changing prior eligibility",async()=>{
  const id=await owner({freeOnly:true});
  const never=await refreshVerifiedFreePricing(id,sql,async()=>new Promise<Response>(()=>{}),NOW,5);assert.equal(never.ok,false);if(!never.ok)assert.match(never.error,/timed out/);
  const stalled=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});}});
  const bodyTimeout=await refreshVerifiedFreePricing(id,sql,async()=>new Response(stalled),NOW,5);assert.equal(bodyTimeout.ok,false);
  const oversized=await refreshVerifiedFreePricing(id,sql,async()=>new Response("x",{headers:{"content-length":"5000001"}}),NOW);assert.equal(oversized.ok,false);
  const malformed=await refreshVerifiedFreePricing(id,sql,async()=>new Response("{"),NOW);assert.equal(malformed.ok,false);
  const duplicate=await refreshVerifiedFreePricing(id,sql,async()=>Response.json({data:[{id:"fixture/duplicate:free",pricing:{prompt:"0",completion:"0"}},{id:"fixture/duplicate:free",pricing:{prompt:"0",completion:"0.1"}}]}),NOW);assert.equal(duplicate.ok,false);
  assert.equal((await readFinancialSnapshot(id,sql,NOW)).verifiedFreeModels.length,0);
});

test("invoice export retains distinct revisions and older unknown reservations remain visibly unknown",async()=>{
  const id=await owner();const reservationId=await reserved(id,context(),Date.parse("2026-10-01T12:00:00Z"));
  assert.equal((await readFinancialSnapshot(id,sql,NOW)).totals.unknownCount,1);
  for(const [ref,actual] of [["one",123],["two",456]] as const)await reconcileFinancialInvoice(id,{reservationId,invoiceRef:ref,actualCostMicros:actual,currency:"USD",confirmed:true},sql);
  const exported=await readFinancialSnapshot(id,sql,NOW);assert.equal(exported.reconciliations.length,2);assert.equal(exported.reconciliations.find(row=>row.invoiceRef==="two")!.previousMicros,123);assert.equal(exported.incompleteHistory,false);
});
