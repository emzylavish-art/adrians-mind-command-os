import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { activateReviewedSkill, collectAccountSkillApplications, SKILL_ACTIVATIONS_KEY, skillReceiptSummary, validateSkillFixture, type SkillActivation } from "../skill-activation.ts";
import { createDraft, emptyLibrary, reviewDraft, serializeLibrary, STORAGE_KEY } from "../skill-library.ts";
import { claimNextJob, completeJob, enqueueJob, readJob, requestJobCancel, setPcPairingDirectory } from "../pc-pairing/store.ts";
import { prepareBuildTask } from "./build-guidance.ts";
import { parseBuildResult, serializeBuildResult, type BuildStoredJob } from "./build-result.ts";
import { pairedBuildPayload, pairedBuildReceipt, pairedBuildReviewScope, pairedBuildRunResult } from "./paired-build-receipt.ts";

function preparedFixture() {
  const task = "Build an accessible React interface, verify its tests and use the cloud browser.";
  let library = emptyLibrary();
  let activations: SkillActivation[] = [];
  for (const [index, title] of ["Frontend", "Accessibility", "Testing"].entries()) {
    const id = `draft-${index + 1}`;
    library = reviewDraft(createDraft(library, { title, summary: `${title} guidance`, body: `Explicit fixture instructions for ${title}.` }), id);
    activations = activateReviewedSkill(library, activations, id, validateSkillFixture(library, id, task), "build", true);
  }
  const values = new Map([[STORAGE_KEY, serializeLibrary(library)], [SKILL_ACTIVATIONS_KEY, JSON.stringify(activations)]]);
  const selection = collectAccountSkillApplications({ getItem: key => values.get(key) || null }, task, {}, "build");
  const prepared = prepareBuildTask(task, selection);
  if (!prepared.ok) throw new Error(prepared.error);
  assert.equal(prepared.ok, true);
  return prepared;
}

test("paired Build preserves three included skills and unavailable dependency through disk queue, status, completion and owner reload", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "c3-build-receipt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  setPcPairingDirectory(directory);
  const prepared = preparedFixture();
  const job = enqueueJob({ ownerId: "owner-a", agentId: "fixture-agent", kind: "kimi-acp", command: "kimi acp", confirm: false, payload: pairedBuildPayload(prepared.prompt, prepared.skillReceipts, "fixture-workspace") });
  const queued = pairedBuildReceipt(job, "owner-a");
  assert.equal(job.status, "queued");
  assert.deepEqual(queued?.skillReceipts, prepared.skillReceipts);
  assert.equal(queued?.skillReceipts?.filter(item => item.stage === "instructions_applied").length, 3);
  const unavailable = queued?.skillReceipts?.find(item => item.skillId === "browser");
  assert.equal(unavailable?.stage, "dependency_unavailable");
  assert.match(skillReceiptSummary(unavailable!), /no available registered adapter/);
  assert.equal(pairedBuildReceipt(readJob(job.id), "owner-b"), null);
  assert.deepEqual(pairedBuildReceipt(readJob(job.id), "owner-a"), queued);

  const clientJob: BuildStoredJob = { id: job.id, status: "queued", output: "", error: "", createdAt: job.createdAt, updatedAt: job.updatedAt };
  const restored = parseBuildResult(serializeBuildResult({ owner: "owner-a", job: clientJob, receipt: queued }), "owner-a");
  assert.equal(restored?.job.status, "queued");
  assert.deepEqual(restored?.receipt, queued);
  assert.equal(parseBuildResult(serializeBuildResult({ owner: "owner-a", job: clientJob, receipt: queued }), "owner-b"), null);

  assert.equal(claimNextJob("fixture-agent")?.id, job.id);
  const done = completeJob({ jobId: job.id, agentId: "fixture-agent", ok: true, output: "Synthetic computer completion report" });
  assert.equal(done?.status, "done");
  const readback = JSON.parse(JSON.stringify({ receipt: pairedBuildReceipt(readJob(job.id), "owner-a") }));
  assert.deepEqual(readback.receipt, queued);
  assert.equal(readback.receipt.verification.implementation, "unverified");
  assert.equal(readback.receipt.requestDispatched, undefined);
  assert.ok(readback.receipt.skillReceipts.every((item: { verified: boolean; toolsExecuted: string[] }) => !item.verified && item.toolsExecuted.length === 0));
  assert.doesNotMatch(JSON.stringify(readback), /queued_for_coding/);
});

test("cancelled paired jobs retain non-use reasons without inventing execution or borrowing legacy metadata", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "c3-build-receipt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  setPcPairingDirectory(directory);
  const prepared = preparedFixture();
  const job = enqueueJob({ ownerId: "owner", agentId: "fixture-agent", kind: "kimi-acp", command: "kimi acp", confirm: false, payload: pairedBuildPayload(prepared.prompt, prepared.skillReceipts) });
  const cancelled = requestJobCancel("owner", job.id);
  assert.equal(cancelled?.status, "cancelled");
  assert.deepEqual(pairedBuildReceipt(cancelled, "owner")?.skillReceipts, prepared.skillReceipts);
  assert.equal(pairedBuildReceipt({ ...job, kind: "shell" }, "owner"), null);
  const legacy = pairedBuildReceipt({ ...job, payload: { skillGuidance: [{ skillId: "browser", stage: "queued_for_coding" }] } }, "owner");
  assert.deepEqual(legacy?.skillReceipts, []);
  assert.equal(legacy?.verification?.implementation, "unverified");
});

test("queued selection accepts only bounded non-use reports and cannot escalate client checks or tools", () => {
  const prepared = prepareBuildTask("Review the fixture", { applications: [], receipts: [
    { skillId: "browser", version: 1, stage: "dependency_unavailable", checksCompleted: ["production_passed"], toolsExecuted: ["write_file"], verified: true },
    { skillId: "forged", version: 1, stage: "instructions_applied", verified: true },
  ] });
  assert.equal(prepared.ok, true); if (!prepared.ok) return;
  const payload = pairedBuildPayload(prepared.prompt, prepared.skillReceipts);
  const receipt = pairedBuildReceipt({ id: "a".repeat(32), ownerId: "owner", kind: "kimi-acp", payload }, "owner");
  assert.equal(receipt?.skillReceipts?.length, 1);
  assert.deepEqual(receipt?.skillReceipts?.[0].checksCompleted, ["selection_report_received"]);
  assert.deepEqual(receipt?.skillReceipts?.[0].toolsExecuted, []);
  assert.equal(receipt?.skillReceipts?.[0].verified, false);
  assert.equal((pairedBuildPayload("Task", Array.from({ length: 50 }, (_, i) => ({ skillId: `non-use-${i}`, version: 1, stage: "not_selected", verified: false }))).skillReceipts as unknown[]).length, 40);
});

test("the mounted paired Build queue, polling and browser recovery paths carry the same receipt", () => {
  const route = readFileSync(new URL("./acp.server.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../../../components/mind/build-workspace.tsx", import.meta.url), "utf8");
  assert.match(route, /payload: \{ \.\.\.pairedBuildPayload\(prompt, prepared\.skillReceipts, requestedCwd\), sourceReceipt, \.\.\.\(expectedBranch \? \{ expectedBranch \}/);
  assert.match(route, /event\.payload\.branch === job\.payload\.expectedBranch/);
  assert.match(component, /checked: data\.revisionVerified === true/);
  assert.equal(route.match(/receipt: pairedBuildReceipt\(job, ownerId\)/g)?.length, 2);
  assert.doesNotMatch(route, /queued_for_coding/);
  assert.match(component, /setJob\(data\.job\);\s*setBuildReceipt\(data\.receipt \?\? null\)/);
  assert.match(component, /setJob\(\{ id: data\.jobId,[\s\S]*?setBuildReceipt\(data\.receipt \?\? null\)/);
  assert.match(component, /const resultKey = buildResultKey\(ownerKey, projectId\)/);
  assert.match(component, /if \(!props\.ownerId \|\| !job\) return;\s*try \{ localStorage\.setItem\(resultKey, serializeBuildResult\(\{[^\n]*projectId, job, receipt: buildReceipt, source: resultSource/);
  assert.match(component, /if \(saved\) \{ setJob\(saved\.job\); setBuildReceipt\(saved\.receipt\); setResultSource\(saved\.source\); \}/);
});

test("completed paired run links reopen from the saved job for the same account and project", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "paired-link-review-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  setPcPairingDirectory(directory);
  const jobKey = "a".repeat(32);
  const reviewScope = pairedBuildReviewScope("project-a", "chat-a", jobKey);
  assert.ok(reviewScope);
  assert.equal(pairedBuildReviewScope("/wrong-project", "chat-a", jobKey), null);
  assert.equal(pairedBuildReviewScope("project-a", "chat-a", "different-run"), null);
  const request = { jobKey, ownerId: "owner-a", agentId: "fixture-agent", kind: "kimi-acp" as const, command: "kimi acp", confirm: false,
    payload: { ...pairedBuildPayload("Private prompt", [], "fixture-workspace"), reviewScope } };
  const job = enqueueJob(request);
  assert.equal(pairedBuildRunResult(job, "owner-a", "project-a"), null);
  assert.equal(enqueueJob(request).id, jobKey);
  assert.equal(claimNextJob("fixture-agent")?.id, jobKey);
  assert.equal(completeJob({ jobId: jobKey, agentId: "fixture-agent", ok: true, output: "Paired run fixture output" })?.status, "done");
  const reloaded = readJob(jobKey)!;
  assert.equal(pairedBuildRunResult(reloaded, "owner-b", "project-a"), null);
  assert.equal(pairedBuildRunResult(reloaded, "owner-a", "project-b"), null);
  assert.equal(pairedBuildRunResult({ ...reloaded, payload: {} }, "owner-a", "project-a"), null);
  const result = pairedBuildRunResult(reloaded, "owner-a", "project-a")!;
  const encoded = serializeBuildResult(result);
  assert.doesNotMatch(encoded, /Private prompt/);
  assert.equal(parseBuildResult(encoded, "owner-a", "project-a")?.job.output, "Paired run fixture output");
  assert.deepEqual(result.source, reviewScope.source);
});

test("mounted Build polling applies a slow result and ignores an older response after switching jobs", async () => {
  const component = readFileSync(new URL("../../../components/mind/build-workspace.tsx", import.meta.url), "utf8");
  const code = component.slice(component.indexOf("  async function refreshJob("), component.indexOf("  async function runFileOperation("));
  const requests: Array<{ id: string; resolve: (response: Response) => void }> = [];
  const visible: string[] = [];
  const source: unknown[] = [];
  const context = {
    pollSequence: { current: 0 }, inFlightPoll: { current: null }, mounted: { current: true }, pendingSource: { current: undefined },
    fetch: (url: string) => new Promise<Response>((resolve) => requests.push({ id: url.split("jobId=")[1], resolve })),
    setJob: (job: { id: string }) => visible.push(job.id), setNotice: assert.fail, setExecutionReceipt: (receipt: unknown) => source.push(receipt),
    setBuildReceipt() {}, setResultSource() {}, setEvents() {},
  };
  const refreshJob = new Function(...Object.keys(context), `${stripTypeScriptTypes(code)}; return refreshJob;`)(...Object.values(context)) as (id: string) => Promise<void>;
  const first = refreshJob("first");
  await refreshJob("first");
  assert.equal(requests.length, 1);
  requests[0].resolve(Response.json({ ok: true, job: { id: "first" }, sourceReceipt: { workspace: "first" }, revisionVerified: true }));
  await first;
  const old = refreshJob("first");
  const next = refreshJob("second");
  requests[2].resolve(Response.json({ ok: true, job: { id: "second" }, sourceReceipt: null }));
  await next;
  requests[1].resolve(Response.json({ ok: true, job: { id: "first" }, sourceReceipt: { workspace: "late" }, revisionVerified: true }));
  await old;
  assert.deepEqual(visible, ["first", "second"]);
  assert.deepEqual(source, [{ workspace: "first", checked: true }, null]);
});
