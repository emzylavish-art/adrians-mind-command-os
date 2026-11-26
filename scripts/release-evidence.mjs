import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CANDIDATE_CHECKS = ["tests", "typecheck", "build", "auth-invariant", "migration-compatibility", "visual-layout"];

/** Evidence is scoped to the actual revision and environment that produced it. */
export function validateReleaseEvidence(report, { revision, environment = "candidate", now = Date.now(), maxAgeMs = 7 * 86400000 } = {}) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/.test(revision || "")) errors.push("An exact 40-character candidate revision is required.");
  if (!report || typeof report !== "object" || report.schema !== "mind-verification/v1") return { ok: false, errors: [...errors, "A versioned verification report is required."] };
  if (report.revision !== revision) errors.push("The report belongs to another revision; historical evidence is not a current pass.");
  if (report.dirty !== false) errors.push("Release evidence must come from a clean checkout of the candidate revision.");
  const observed = Date.parse(report.createdAt);
  if (!Number.isFinite(observed) || observed > now + 300000 || now - observed > maxAgeMs) errors.push("The verification timestamp is invalid or stale.");
  if (report.environment !== environment) errors.push(`Expected ${environment} evidence; ${report.environment || "unspecified"} evidence cannot substitute for it.`);
  const checks = Array.isArray(report.checks) ? report.checks : [];
  for (const id of CANDIDATE_CHECKS) {
    const check = checks.find((item) => item?.id === id);
    if (!check || check.status !== "passed" || typeof check.artifact !== "string" || !check.artifact || check.revision !== revision) errors.push(`${id}: missing, failed, skipped or not pinned to this revision.`);
  }
  if (environment === "production") {
    for (const id of ["production-health", "production-owner-isolation"]) {
      const check = checks.find((item) => item?.id === id);
      if (!check || check.status !== "passed" || check.scope !== "live-deployment" || check.revision !== revision || !check.artifact) errors.push(`${id}: live deployment evidence is required; local fixtures do not establish integration readiness.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function readEvidenceFile(path) {
  if (!path) throw new Error("Pass a verification report file explicitly.");
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => args[args.indexOf(flag) + 1];
  try {
    const result = validateReleaseEvidence(readEvidenceFile(get("--report")), { revision: get("--revision"), environment: args.includes("--production") ? "production" : "candidate" });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
