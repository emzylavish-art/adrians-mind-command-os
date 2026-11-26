import { createHash } from "node:crypto";
export const DEFAULT_VISUAL_POLICY = Object.freeze({ version: 1, thresholds: { critical: 0, serious: 0, documentOverflowPx: 1, overflowingControls: 0, smallTargets: 0 }, exceptions: [] });
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function visualFindings(report, policy = DEFAULT_VISUAL_POLICY) {
  const thresholds = { ...DEFAULT_VISUAL_POLICY.thresholds, ...policy.thresholds };
  const result = [];
  const add = (state, kind, value, threshold, evidence = null) => {
    if (value <= threshold) return;
    const identity = { viewport: state.viewport, theme: state.theme, label: state.label, fixture: state.fixture?.id || null, kind };
    result.push({ ...identity, value, threshold, fingerprint: fingerprint({ ...identity, value, evidence }) });
  };
  for (const state of report.states || []) {
    add(state, "documentOverflowPx", state.layout?.documentOverflow ?? 0, thresholds.documentOverflowPx);
    add(state, "overflowingControls", state.layout?.overflowingControls?.length ?? 0, thresholds.overflowingControls, state.layout?.overflowingControls);
    add(state, "smallTargets", state.layout?.smallTargets?.length ?? 0, thresholds.smallTargets, state.layout?.smallTargets);
    for (const impact of ["critical", "serious"]) {
      const violations = (state.axe?.violations || []).filter((item) => item.impact === impact);
      add(state, impact, violations.reduce((sum, item) => sum + (item.nodes || 1), 0), thresholds[impact], violations.map(({ id, targets }) => ({ id, targets })));
    }
    if (!state.layout || !state.axe || !Array.isArray(state.axe.violations)) add(state, "capture_incomplete", 1, 0);
    if (!state.destination?.verified) add(state, "destination_unverified", 1, 0);
  }
  for (const failure of report.failures || []) add(failure, "navigation_or_capture_failure", 1, 0, failure.error);
  return result;
}
export function evaluateVisualReport(report, { policy = DEFAULT_VISUAL_POLICY, baseline = null, mode = "report", now = new Date().toISOString() } = {}) {
  if (!["report", "release"].includes(mode)) throw new Error("Visual mode must be report or release.");
  if (policy.version !== 1) throw new Error("Unsupported visual policy version.");
  const all = visualFindings(report, policy);
  const errors = [];
  for (const [key, value] of Object.entries(policy.thresholds || {})) if (!(key in DEFAULT_VISUAL_POLICY.thresholds) || typeof value !== "number" || !Number.isFinite(value) || value < 0) errors.push(`Invalid threshold ${key}`);
  const exceptions = (policy.exceptions || []).filter((item) => {
    const valid = /^[a-f0-9]{64}$/.test(item.fingerprint || "") && typeof item.reason === "string" && item.reason.trim().length >= 10 && typeof item.reviewedBy === "string" && item.reviewedBy.trim() && Date.parse(item.expiresAt) > Date.parse(now) && /^[a-f0-9]{40}$/.test(item.revision || "") && item.revision === report.revision;
    if (!valid) errors.push("An exception is expired, unreviewed, malformed or belongs to another revision.");
    return valid;
  });
  const structural = new Set(["destination_unverified", "capture_incomplete", "navigation_or_capture_failure"]);
  const waived = all.filter((finding) => !structural.has(finding.kind) && exceptions.some((item) => item.fingerprint === finding.fingerprint));
  const blocking = all.filter((finding) => !waived.includes(finding));
  const old = baseline ? visualFindings(baseline, policy) : [];
  const currentKeys = new Set(all.map((item) => item.fingerprint));
  const oldKeys = new Set(old.map((item) => item.fingerprint));
  const regressions = baseline ? all.filter((item) => !oldKeys.has(item.fingerprint)) : [];
  const resolved = baseline ? old.filter((item) => !currentKeys.has(item.fingerprint)) : [];
  if (!report.states?.length) errors.push("No screen state was verified.");
  const provenanceErrors = !/^[a-f0-9]{40}$/.test(report.revision || "") || report.dirty !== false ? ["Release visual evidence requires an exact clean candidate revision."] : [];
  if (mode === "release") errors.push(...provenanceErrors);
  return { mode, policyVersion: policy.version, findingCount: all.length, blocking, waived, errors, comparison: baseline ? { baselineRevision: baseline.revision ?? null, regressions, resolved } : null,
    provenanceErrors, releaseEligible: blocking.length === 0 && errors.length === 0 && provenanceErrors.length === 0,
    exitCode: mode === "release" ? (blocking.length || errors.length ? 1 : 0) : (report.failures?.length || errors.length ? 1 : 0) };
}
