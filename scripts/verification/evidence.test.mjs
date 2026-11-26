import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateFeatureEvidence, validateEnvironmentEvidence, validateReleaseEvidence } from "./evidence.mjs";
const revision = "a".repeat(40), oldRevision = "b".repeat(40), now = "2026-11-26T12:00:00.000Z";
const evidence = ["https://example.invalid/synthetic-evidence"], date = "2026-11-26T10:00:00.000Z";
const proof = () => ({ observedAt: date, evidence });
const environment = () => ({ id: "authenticated-production", state: "passed", revision, authenticated: true, executedAt: date, evidence, nextAction: "Repeat when the candidate revision changes." });
function release() {
  return {
    schemaVersion: 1, repository: "emzylavish-art/adrians-mind-command-os", candidateRevision: revision,
    ci: { revision, status: "passed", ...proof(), checks: ["tests", "typecheck", "build"].map((name) => ({ name, revision, status: "passed", evidence })) },
    build: { revision, status: "passed", artifactSha256: "c".repeat(64), artifactUrl: evidence[0], ...proof() },
    database: { revision, environment: "production", compatibility: "verified", migrationIds: ["0017_fixture_only"], ...proof() },
    deployment: { revision, environment: "production", id: "fixture-deployment", status: "READY", url: "https://example.invalid/synthetic-deployment", artifactSha256: "c".repeat(64), ...proof() },
    alias: { revision, url: "https://adrians-mind.vercel.app", deploymentId: "fixture-deployment", ...proof() },
    journeys: ["signed-out-navigation", "signed-in-plugins-settings"].map((id) => ({ id, revision, status: "passed", deploymentId: "fixture-deployment", environment: "production", authenticated: id !== "signed-out-navigation", ...proof() })),
    environmentEvidence: { schemaVersion: 1, environments: [environment(), { id: "physical-ios", state: "unverified", nextAction: "Run on a physical iPhone." }] },
    rollback: { revision: oldRevision, deploymentId: "fixture-previous", databaseCompatible: true, recoveryTested: true, ...proof() },
  };
}
test("AA102 prior revision proof remains historical instead of promoting current completion", () => {
  const doc = { schemaVersion: 1, features: [{ id: "VOICE", title: "Voice", status: "verified", verification: { state: "passed", revision: oldRevision, environment: "unit-fixture", executedAt: date, evidence, blockers: [] } }] };
  const result = validateFeatureEvidence(doc, { revision, now });
  assert.equal(result.ok, true); assert.equal(result.records[0].verifiedCurrent, false); assert.equal(result.records[0].verification, "historical");
  assert.equal(validateFeatureEvidence(doc, { revision, now, requireCurrent: true }).ok, false);
  doc.features[0].verification.revision = revision;
  assert.equal(validateFeatureEvidence(doc, { revision, now, requireCurrent: true }).ok, true);
  doc.features[0].verification.evidence = [];
  assert.equal(validateFeatureEvidence(doc, { revision, now }).ok, false);
  doc.features[0].verification.evidence = ["artifacts/../unverified.json"];
  assert.equal(validateFeatureEvidence(doc, { revision, now }).ok, false);
  doc.features[0].verification.state = "unverified";
  assert.equal(validateFeatureEvidence(doc, { revision, now }).ok, false);
});
test("AA101 emulation, missing authentication and future observations cannot prove another environment", () => {
  const matrix = { schemaVersion: 1, environments: [{ ...environment(), id: "physical-ios", physicalDevice: false }] };
  assert.equal(validateEnvironmentEvidence(matrix, { revision, now }).ok, false);
  matrix.environments[0] = { ...environment(), authenticated: false };
  assert.equal(validateEnvironmentEvidence(matrix, { revision, now }).ok, false);
  matrix.environments[0] = { ...environment(), executedAt: "2030-01-01T00:00:00.000Z" };
  assert.equal(validateEnvironmentEvidence(matrix, { revision, now }).ok, false);
});
test("AA103 release linking checks the exact tested revision, build, alias, migrations and journeys", () => {
  assert.equal(validateReleaseEvidence(release(), { revision, now }).ok, true);
  const corruptions = [
    (x) => { x.ci.revision = oldRevision; },
    (x) => { x.ci.checks[0].status = "skipped"; },
    (x) => { x.ci.checks.push(x.ci.checks[0]); },
    (x) => { x.deployment.artifactSha256 = "d".repeat(64); },
    (x) => { x.alias.deploymentId = "wrong-deployment"; },
    (x) => { x.database.environment = "preview"; },
    (x) => { x.journeys[1].authenticated = false; },
    (x) => { x.journeys[1].status = "canceled"; },
    (x) => { x.rollback.recoveryTested = false; },
    (x) => { x.environmentEvidence.environments[0].state = "unverified"; },
  ];
  for (const corrupt of corruptions) { const doc = release(); corrupt(doc); assert.equal(validateReleaseEvidence(doc, { revision, now }).ok, false); }
});
test("AA101-103 checked-in records preserve unverified product and physical states", () => {
  const read = (file) => JSON.parse(readFileSync(new URL(`../../docs/verification/${file}`, import.meta.url), "utf8"));
  const features = validateFeatureEvidence(read("feature-evidence.json"), { revision, now });
  assert.equal(features.ok, true); assert.ok(features.records.every((item) => !item.verifiedCurrent));
  const environments = validateEnvironmentEvidence(read("environment-evidence.json"), { revision, now });
  assert.equal(environments.ok, true); assert.ok(environments.outstanding.some((item) => item.id === "physical-ios"));
  assert.equal(validateReleaseEvidence(read("release-evidence.template.json"), { revision, now }).ok, false);
});
