import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateVisualReport, DEFAULT_VISUAL_POLICY } from "./policy.mjs";
import { verifyDestination } from "./destinations.mjs";
const sha = "a".repeat(40);
const now = "2026-11-26T00:00:00.000Z";
const report = () => ({ revision: sha, dirty: false, states: [{ viewport: "mobile", theme: "dark", label: "Plugins", destination: { verified: true }, layout: { documentOverflow: 0, overflowingControls: [], smallTargets: [] }, axe: { violations: [] } }], failures: [] });
test("AA098 report-only success never becomes a release guarantee", () => {
  const input = report(); input.states[0].axe.violations.push({ id: "label", impact: "serious", nodes: 1 });
  assert.equal(evaluateVisualReport(input).exitCode, 0);
  assert.equal(evaluateVisualReport(input).releaseEligible, false);
  assert.equal(evaluateVisualReport(input, { mode: "release" }).exitCode, 1);
  input.states[0].axe.violations = []; input.states[0].layout.documentOverflow = 20;
  assert.equal(evaluateVisualReport(input, { mode: "release" }).exitCode, 1);
  input.states[0].layout.documentOverflow = 0;
  assert.equal(evaluateVisualReport(input, { mode: "release" }).exitCode, 0);
});
test("AA098 exceptions bind exact finding and candidate; expiry and regressions are visible", () => {
  const base = report(); const current = report(); current.states[0].layout.smallTargets = [{}];
  const failed = evaluateVisualReport(current, { mode: "release", baseline: base });
  assert.equal(failed.comparison.regressions.length, 1);
  const exception = { fingerprint: failed.blocking[0].fingerprint, revision: sha, reviewedBy: "fixture reviewer", reason: "Reviewed inline control exception", expiresAt: "2026-12-01T00:00:00.000Z" };
  const policy = { ...DEFAULT_VISUAL_POLICY, exceptions: [exception] };
  assert.equal(evaluateVisualReport(current, { mode: "release", policy, now }).exitCode, 0);
  const changedTarget = structuredClone(current); changedTarget.states[0].layout.smallTargets = [{ label: "Another control" }];
  assert.equal(evaluateVisualReport(changedTarget, { mode: "release", policy, now }).exitCode, 1);
  assert.equal(evaluateVisualReport({ ...current, revision: "b".repeat(40) }, { mode: "release", policy, now }).exitCode, 1);
  assert.equal(evaluateVisualReport(current, { mode: "release", policy, now: "2027-01-01" }).exitCode, 1);
  assert.equal(evaluateVisualReport({ ...base, dirty: true }, { mode: "release" }).exitCode, 1);
  assert.equal(evaluateVisualReport({ states: [], failures: [] }, { mode: "release" }).exitCode, 1);
});
test("AA099 destination verification cannot succeed from a click or wrong screen", async () => {
  const seen = [];
  const locator = (selector) => ({ waitFor: async () => { seen.push(selector); if (selector.includes('data-view="wrong"')) throw Error("Wrong destination"); }, first() { return this; }, getByRole: (_role, options) => locator(options.name) });
  const page = { locator, waitForFunction: async () => { seen.push("ready"); }, url: () => "https://fixture.invalid/?section=connected" };
  const actual = await verifyDestination(page, { view: "connected", heading: "Connected" });
  assert.equal(actual.verified, true); assert.deepEqual(seen, ['#mind-workspace[data-view="connected"]', "Connected", "ready"]);
  await assert.rejects(verifyDestination(page, { view: "wrong", heading: "Connected" }), /Wrong destination/);
});
