import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { jobCompletionTransition, type PcJob } from "../pc-pairing/store.ts";
import { buildArtifactName, BUILD_ARTIFACT_LIMIT } from "./build-artifact.ts";
import { buildArtifactBytes, completionBuildArtifact } from "./build-artifact.server.ts";
import { pairedBuildRunResult } from "./paired-build-receipt.ts";

const bytes = Buffer.from([0, 255, 128, 10, 0]);
const artifact = { name: "output.bin", status: "saved" as const, bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64") };
const job: PcJob = { id: "a".repeat(32), ownerId: "owner", agentId: "device", kind: "kimi-acp", status: "running",
  receiptId: "b".repeat(32), createdAt: "2026-11-28", updatedAt: "2026-11-28", command: "", confirm: false,
  payload: { artifactName: artifact.name, reviewScope: { projectId: "project-a", source: null } } };
const complete = { jobId: job.id, agentId: job.agentId, receiptId: job.receiptId, ok: true, buildArtifact: artifact };

test("binary result accepts only the exact reviewed filename and verified canonical bytes", () => {
  for (const invalid of ["../out.bin", "artifacts/out.bin", "x.exe", ".env", "CON.pdf", "a\\" + "out.bin"]) assert.equal(buildArtifactName(invalid), false);
  for (const reported of [{ ...artifact, name: "other.bin" }, { ...artifact, bytes: BUILD_ARTIFACT_LIMIT + 1 },
    { ...artifact, sha256: "a".repeat(64) }, { ...artifact, base64: " " + artifact.base64 }]) {
    assert.deepEqual(completionBuildArtifact(artifact.name, reported), { name: artifact.name, status: "unavailable" });
  }
  assert.equal(completionBuildArtifact(undefined, artifact), undefined);
  assert.deepEqual(buildArtifactBytes(completionBuildArtifact(artifact.name, artifact)), bytes);
});

test("binary completion is bound to an accepted receipt and cannot replace a terminal result", () => {
  assert.equal(jobCompletionTransition(job, { ...complete, receiptId: undefined }), null);
  assert.equal(jobCompletionTransition(job, { ...complete, agentId: "another" }), null);
  const late = jobCompletionTransition({ ...job, status: "cancel_requested" }, complete);
  assert.deepEqual(late && late !== "unchanged" && late.buildArtifact, { name: artifact.name, status: "unavailable" });
  const result = jobCompletionTransition(job, complete);
  assert.ok(result && result !== "unchanged");
  const completed: PcJob = { ...job, ...result };
  assert.equal(jobCompletionTransition(completed, { ...complete, buildArtifact: {} }), "unchanged");
  assert.equal(pairedBuildRunResult(completed, "other", "project-a"), null);
  assert.equal(pairedBuildRunResult(completed, "owner", "project-b"), null);
  const ownerReview = pairedBuildRunResult(completed, "owner", "project-a");
  assert.equal(ownerReview?.receipt?.artifact?.status, "saved");
  assert.doesNotMatch(JSON.stringify(ownerReview), /base64/);
  assert.deepEqual(buildArtifactBytes(completed.buildArtifact), bytes);
});
