import assert from "node:assert/strict";
import { test } from "node:test";
import { CANDIDATE_CHECKS, validateReleaseEvidence } from "./release-evidence.mjs";
import { planReleasePreparation } from "./release-promotion.mjs";

const revision = "a".repeat(40);
const report = () => ({ schema: "mind-verification/v1", revision, dirty: false, environment: "candidate", createdAt: new Date().toISOString(), checks: CANDIDATE_CHECKS.map((id) => ({ id, status: "passed", revision, artifact: `artifacts/${id}.json`, scope: "isolated-fixture" })) });
test("old verification and dirty source cannot establish a new candidate pass", () => {
  assert.equal(validateReleaseEvidence(report(), { revision }).ok, true);
  assert.equal(validateReleaseEvidence(report(), { revision: "b".repeat(40) }).ok, false);
  assert.equal(validateReleaseEvidence({ ...report(), dirty: true }, { revision }).ok, false);
  const skipped = report(); skipped.checks[0].status = "skipped";
  assert.equal(validateReleaseEvidence(skipped, { revision }).ok, false);
});
test("successful isolated fixtures never become a production integration receipt", () => {
  const candidate = report();
  assert.equal(validateReleaseEvidence(candidate, { revision, environment: "production" }).ok, false);
  const deployed = { ...candidate, environment: "production", checks: [...candidate.checks, { id: "production-health", status: "failed", revision, scope: "live-deployment", artifact: "health.json" }] };
  const result = validateReleaseEvidence(deployed, { revision, environment: "production" });
  assert.equal(result.ok, false); assert.match(result.errors.join(" "), /production-health/);
});
test("failed candidate and missing authorization block schema preparation before dispatch", () => {
  const input = { report: report(), revision, actualRevision: revision, dirty: false, approved: true };
  assert.ok(planReleasePreparation(input).command);
  assert.equal(planReleasePreparation({ ...input, approved: false }).command, null);
  input.report.checks.find((item) => item.id === "build").status = "failed";
  assert.equal(planReleasePreparation(input).command, null);
});
