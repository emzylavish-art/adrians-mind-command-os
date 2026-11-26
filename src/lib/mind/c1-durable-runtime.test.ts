import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { DEFAULT_RESOURCE_POLICY } from "./resource-policy.ts";
import { reserveResourceOperation, settleResourceOperation, saveResourcePolicy, resourceLedger } from "./resource-governor.server.ts";
import { recoverableTurnResponse, readTurnRecovery } from "./turn-recovery.ts";
import { setCoordinationSqlForTests, registerAgent, findAgentByToken, onlineAgents, enqueueJob, acceptJob, requestJobCancel, completeJob, markJobTimeout, unregisterAgent, appendJobEvent, listJobEvents, recordCapabilities, deviceReadiness } from "./pc-pairing/coordination.server.ts";
import { saveResearchReport, listResearchReports, readResearchReport, researchVersions, editResearchMetadata } from "./research-library.server.ts";
import { saveInstructionPreferences, readInstructionPreferences, recordLoadedInstructions, instructionHistory, type InstructionMetadata } from "./skill-instructions.server.ts";
import { readSharedHalt, updateSharedHalt } from "./halt.server.ts";
import { importLegacyDeviceSnapshot } from "./pc-pairing/import-legacy.server.ts";
let pg: PGlite;
let sql: Sql;
function adapter(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Sql {
  const call = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
    return (await client.query(query, values)).rows;
  }) as Sql;
  call.query = async <T>(query: string, params: unknown[] = []) => (await client.query(query, params)).rows as T[];
  return call;
}
before(async () => {
  pg = new PGlite(); await pg.waitReady;
  await pg.exec("create table mind_control(user_id text primary key,halted boolean default false,updated_at timestamptz default now()); create table mind_audit(user_id text,id text,at timestamptz,action text,target text,result text,primary key(user_id,id))");
  await pg.exec("create table mind_turn_receipt(user_id text,operation_id text,expires_at timestamptz,responded boolean default false,retryable boolean default false,primary key(user_id,operation_id))");
  await pg.exec(readFileSync(new URL("../../../migrations/0018_c1_resource_authority.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../../../migrations/0020_c1_device_coordination.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../../../migrations/0021_c1_research_skills.sql", import.meta.url), "utf8"));
  sql = adapter(pg); sql.transaction = (fn) => pg.transaction((tx) => fn(adapter(tx)));
  setCoordinationSqlForTests(sql);
});
after(async () => { setCoordinationSqlForTests(); await pg?.close(); });
test("AA091/092/094/095 atomic account reservations share one allowance and settle exactly once", async () => {
  const policy = { ...DEFAULT_RESOURCE_POLICY, maxCallsPerDay: 10, maxDailyUsdMicros: 100, prices: { "test:model": { revision: "fixture-v1", inputUsdMicrosPerMillion: 1_000_000, outputUsdMicrosPerMillion: 1_000_000 } } };
  await saveResourcePolicy("budget-owner", policy, 0, sql);
  const attempt = () => reserveResourceOperation({ owner: "budget-owner", taskId: "task", provider: "test", model: "model", free: false, inputTokens: 30, outputTokens: 30, db: sql });
  const results = await Promise.allSettled([attempt(), attempt()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const reservation = results.find((r) => r.status === "fulfilled"); assert(reservation?.status === "fulfilled");
  await settleResourceOperation(reservation.value, { outcome: "succeeded", usage: { prompt_tokens: 10, completion_tokens: 10 }, requestId: "fixture-request" }, sql);
  await settleResourceOperation(reservation.value, { outcome: "succeeded", usage: { prompt_tokens: 10, completion_tokens: 10 } }, sql);
  const [day] = await sql.query<{ calls: number; calculated_usd_micros: number; reserved_usd_micros: number }>("select * from mind_resource_day where owner_id='budget-owner'");
  assert.equal(day.calls, 1); assert.equal(Number(day.calculated_usd_micros), 20); assert.equal(Number(day.reserved_usd_micros), 0);
  assert.equal((await resourceLedger("other", sql)).length, 0);
  await assert.rejects(saveResourcePolicy("budget-owner", policy, 0, sql), /changed elsewhere/);
});
test("AA093 persisted free-only overrides a request that omits the preference", async () => {
  await saveResourcePolicy("free-owner", { ...DEFAULT_RESOURCE_POLICY, freeOnly: true }, 0, sql);
  await assert.rejects(reserveResourceOperation({ owner: "free-owner", taskId: "t", provider: "openai", model: "m", free: false, inputTokens: 5, outputTokens: 5, db: sql }), /Free-only/);
  const approved = await reserveResourceOperation({ owner: "free-owner", taskId: "t", provider: "ollama", model: "local", free: true, inputTokens: 5, outputTokens: 5, db: sql });
  assert.equal(approved.estimate, 0);
});
test("AA096 unknown cost is retained as null after a failed attempted call", async () => {
  const reservation = await reserveResourceOperation({ owner: "unknown-owner", taskId: "t", provider: "custom", model: "m", free: false, inputTokens: 5, outputTokens: 5, db: sql });
  await settleResourceOperation(reservation, { outcome: "unknown" }, sql);
  const [row] = await resourceLedger("unknown-owner", sql) as { calculated_usd_micros: unknown }[];
  assert.equal(row.calculated_usd_micros, null);
});
test("AA061 exact response recovery is owner-bound and respects temporary retention", async () => {
  for (const operation of ["ordinary", "temporary"]) await sql.query("insert into mind_turn_receipt(user_id,operation_id,expires_at) values('owner',$1,now()+interval '1 day')", [operation]);
  const text = 'event: done\ndata: {"text":"finished"}\n\n';
  await recoverableTurnResponse({ sql, owner: "owner", operation: "ordinary", retain: true, dispatched: true, response: new Response(text, { headers: { "content-type": "text/event-stream" } }) }).text();
  assert.equal(await (await readTurnRecovery(sql, "owner", "ordinary"))?.text(), text);
  assert.equal(await readTurnRecovery(sql, "other", "ordinary"), null);
  await recoverableTurnResponse({ sql, owner: "owner", operation: "temporary", retain: false, dispatched: true, response: new Response("private") }).text();
  assert.equal(await readTurnRecovery(sql, "owner", "temporary"), null);
});
test("AA043–049 shared device queue preserves late outcomes and isolates indexed history", async () => {
  const registered = await registerAgent({ ownerId: "device-owner", label: "Fixture computer" }); assert(registered.ok);
  const agent = await findAgentByToken(registered.agentToken); assert(agent);
  assert.equal((await onlineAgents("other")).length, 0);
  const job = await enqueueJob({ ownerId: "device-owner", agentId: agent.id, command: "fixture", confirm: true });
  const accepted = await acceptJob(agent.id, job.id, "receipt-1"); assert.equal(accepted?.status, "running");
  assert.equal((await acceptJob(agent.id, job.id, "receipt-1"))?.id, job.id);
  assert.equal(await acceptJob(agent.id, job.id, "receipt-2"), null);
  await requestJobCancel("device-owner", job.id);
  const completed = await completeJob({ jobId: job.id, agentId: agent.id, receiptId: "receipt-1", ok: true, output: "changed" });
  assert.equal(completed?.status, "done"); assert.equal(completed?.output, "changed"); assert.equal(completed?.lateOutcome, "completed_after_cancel");
  const late = await enqueueJob({ ownerId: "device-owner", agentId: agent.id, command: "fixture2", confirm: true });
  await acceptJob(agent.id, late.id, "receipt"); await markJobTimeout(late.id);
  assert.equal((await completeJob({ jobId: late.id, agentId: agent.id, ok: true, output: "done later" }))?.lateOutcome, "completed_after_timeout");
  await appendJobEvent({ jobId: late.id, agentId: agent.id, type: "result", payload: { message: "first" } });
  const first = (await listJobEvents("device-owner", late.id, 1))[0]!;
  await appendJobEvent({ jobId: late.id, agentId: agent.id, type: "result", payload: { message: "second" } });
  assert.equal((await listJobEvents("device-owner", late.id, 10, `${first.createdAt}|${first.id}`)).length, 1);
  assert.equal((await listJobEvents("other", late.id)).length, 0);
  assert.equal(deviceReadiness(agent).capabilitiesVerified, false);
  assert(await recordCapabilities(agent.id, { version: "fixture1", shell: true, fileProtocol: 2, cancellation: true, codingRuntime: false, localModel: false, busy: false, workspaceIds: [] }));
  const ready = (await onlineAgents("device-owner"))[0]!;
  assert.equal(deviceReadiness(ready).fileReady, true); assert.equal(deviceReadiness(ready).codingReady, false);
  const queued = await enqueueJob({ ownerId: "device-owner", agentId: agent.id, command: "never execute", confirm: true });
  assert(await unregisterAgent("device-owner", agent.id));
  assert.equal(await acceptJob(agent.id, queued.id, "no"), null);
  assert.equal(await findAgentByToken(registered.agentToken), null);
});


test("AA029 research survives more than eight reports with owner isolation, revisions, pagination and explicit archive", async () => {
  const result = { ok: true, configured: true, citations: [{ title: "Fixture", url: "https://example.com/fixture" }], error: "" };
  for (let index = 0; index < 12; index++) await saveResearchReport("research-owner", { question: `Question ${index}`, result, tags: ["fixture"], projectId: "project-1" }, sql);
  const first = await listResearchReports("research-owner", { limit: 5, tag: "fixture" }, sql);
  assert.equal(first.items.length, 5); assert(first.nextCursor);
  const second = await listResearchReports("research-owner", { limit: 5, before: first.nextCursor! }, sql);
  assert.equal(second.items.length, 5); assert(!second.items.some((item) => first.items.some((old) => old.reportId === item.reportId)));
  assert.equal((await listResearchReports("other", {}, sql)).items.length, 0);
  const item = first.items[0];
  assert.equal(await readResearchReport("other", item.reportId, sql), null);
  const revised = await saveResearchReport("research-owner", { question: item.question, result: { ...result, summary: "Updated evidence" }, reportId: item.reportId, expectedRevision: 1 }, sql);
  assert.equal(revised.revision, 2); assert.equal((await researchVersions("research-owner", item.reportId, sql)).length, 2);
  await assert.rejects(saveResearchReport("research-owner", { question: item.question, result, reportId: item.reportId, expectedRevision: 1 }, sql), /changed/);
  await editResearchMetadata("research-owner", item.reportId, 2, { archived: true }, sql);
  assert.equal((await listResearchReports("research-owner", { archived: true }, sql)).items.length, 1);
  await assert.rejects(editResearchMetadata("other", item.reportId, 3, { delete: true }, sql), /unavailable/);
  await editResearchMetadata("research-owner", item.reportId, 3, { delete: true }, sql);
  assert.equal((await researchVersions("research-owner", item.reportId, sql)).length, 0);
});

test("AA033 instruction review and dispatch history persist under owner CAS without claiming procedure success", async () => {
  const catalog: InstructionMetadata[] = [{ id: "fixture", name: "Fixture", description: "Test only", body: "Check actual evidence.", revision: "fixture-sha", origin: "fixture", category: "instruction" }];
  const saved = await saveInstructionPreferences("skill-owner", { fixture: { enabled: true, agents: ["chat"], reviewedRevision: "fixture-sha" } }, 0, catalog, sql);
  assert.equal(saved.revision, 1); assert.equal((await readInstructionPreferences("other", sql)).revision, 0);
  await assert.rejects(saveInstructionPreferences("skill-owner", {}, 0, catalog, sql), /changed elsewhere/);
  await recordLoadedInstructions("skill-owner", [{ id: "fixture", revision: "fixture-sha", body: "Check actual evidence.", agentId: "chat" }], "fixture-operation", sql);
  await recordLoadedInstructions("skill-owner", [{ id: "fixture", revision: "fixture-sha", body: "Check actual evidence.", agentId: "chat" }], "fixture-operation", sql);
  const history = await instructionHistory("skill-owner", sql) as { status: string; detail: string }[];
  assert.equal(history.length, 1); assert.equal(history[0].status, "instructions_loaded"); assert.match(history[0].detail, /remain unverified/);
  assert.equal((await instructionHistory("other", sql)).length, 0);
  const removed = await saveInstructionPreferences("skill-owner", {}, saved.revision, [], sql);
  assert.deepEqual(removed.preferences, {}, "Unavailable instructions can be unassigned without losing prior dispatch history");
  assert.equal((await instructionHistory("skill-owner", sql)).length, 1);
});


test("AA057/058 account resume compares the exact stop revision and audit survives conflicting control", async () => {
  const initial = await readSharedHalt(sql, "halt-owner"); assert.equal(initial.state, "off");
  await updateSharedHalt(sql, "halt-owner", true);
  const on = await readSharedHalt(sql, "halt-owner"); assert.equal(on.state, "on"); assert.notEqual(on.revision, initial.revision);
  await assert.rejects(updateSharedHalt(sql, "halt-owner", false, initial.revision!), /changed elsewhere/);
  assert.equal((await readSharedHalt(sql, "halt-owner")).state, "on");
  await updateSharedHalt(sql, "halt-owner", false, on.revision!);
  assert.equal((await readSharedHalt(sql, "halt-owner")).state, "off");
  const rows = await sql.query("select * from mind_audit where user_id='halt-owner'"); assert.equal(rows.length, 2);
  assert.equal((await readSharedHalt(sql, "other-owner")).state, "off");
});


test("AA043 one-time legacy import preserves token hashes and outcomes without reviving revoked records", async () => {
  const snapshot = { owner: "legacy-owner", fingerprint: "f".repeat(64), agents: [{ id: "1".repeat(24), ownerId: "legacy-owner", label: "Legacy fixture", tokenHash: "e".repeat(64), registeredAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z" }], jobs: [{ id: "2".repeat(24), ownerId: "legacy-owner", agentId: "1".repeat(24), kind: "shell" as const, command: "fixture", confirm: true, status: "done" as const, output: "completed earlier", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z" }], events: [] };
  const first = await importLegacyDeviceSnapshot(sql, snapshot); assert.equal(first.imported, true); assert.equal(first.jobs, 1);
  const [row] = await sql.query<{ record: { output: string } }>("select record from mind_pc_jobs where owner_id='legacy-owner'"); assert.equal(row.record.output, "completed earlier");
  await sql.query("delete from mind_pc_agents where owner_id='legacy-owner'");
  const repeated = await importLegacyDeviceSnapshot(sql, snapshot); assert.equal(repeated.imported, false);
  assert.equal((await sql.query("select agent_id from mind_pc_agents where owner_id='legacy-owner'")).length, 0);
  await assert.rejects(importLegacyDeviceSnapshot(sql, { ...snapshot, owner: "wrong-owner" }), /exactly one owner/);
});


test("AA094 token-capped accounts cannot authorize opaque internal model usage as zero tokens", async () => {
  await saveResourcePolicy("opaque-owner", { ...DEFAULT_RESOURCE_POLICY, maxTokensPerDay: 5000 }, 0, sql);
  const attempt = { owner: "opaque-owner", taskId: "opaque-task", provider: "hosted-acp", model: "process", free: false, unknownCost: true, unknownTokens: true, inputTokens: 0, outputTokens: 0, db: sql };
  await assert.rejects(reserveResourceOperation(attempt), /Token usage is unknown/);
  assert.equal((await resourceLedger("opaque-owner", sql)).length, 0, "Rejected process does not create a dispatch reservation");
  await saveResourcePolicy("opaque-owner", DEFAULT_RESOURCE_POLICY, 1, sql);
  const allowed = await reserveResourceOperation(attempt);
  assert.equal(allowed.estimate, null);
});
